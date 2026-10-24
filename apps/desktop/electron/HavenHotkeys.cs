using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Collections.Generic;
using System.Collections.Concurrent;

// Global hold-to-talk observer. The key is identified by its hardware scan code (plus the
// E0 extended flag), exactly like KeyboardEvent.code, so it is independent of the keyboard
// layout. The hook never suppresses input. While PTT is held, a watchdog compares the hook's
// view with the physical key state so a lost key-up (hook timeout, secure desktop, UAC,
// lock screen) can never leave the microphone transmitting.
class HavenHotkeys {
    delegate IntPtr HookCallback(int code, IntPtr message, IntPtr data);
    [StructLayout(LayoutKind.Sequential)] struct KeyboardData { public uint key; public uint scan; public uint flags; public uint time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct Message { public IntPtr window; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; public uint unused; }
    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetWindowsHookEx(int type, HookCallback callback, IntPtr module, uint thread);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll")] static extern int GetMessage(out Message message, IntPtr window, uint min, uint max);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, IntPtr process);
    [DllImport("user32.dll")] static extern IntPtr GetKeyboardLayout(uint thread);
    [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint type);
    [DllImport("user32.dll")] static extern uint MapVirtualKeyEx(uint code, uint type, IntPtr layout);
    [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string module);
    static readonly object gate = new object();
    static readonly HashSet<int> modifierKeys = new HashSet<int>();
    static readonly ConcurrentQueue<string> output = new ConcurrentQueue<string>();
    static readonly AutoResetEvent outputReady = new AutoResetEvent(false);
    static readonly int[] modifierCodes = new int[] { 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5, 0x5B, 0x5C };
    static int keyScan, requiredModifiers, modifiers, lastMainEvent, missing;
    static bool keyExtended, mainIsModifier, enabled, pressed, keyArmed, ignoreHook;
    static IntPtr hook;
    static Timer watchdog;
    static HookCallback callback = OnKey;
    static void SetPressed(bool value) {
        if (pressed == value) return;
        pressed = value;
        missing = 0;
        if (watchdog != null) watchdog.Change(value ? 40 : Timeout.Infinite, value ? 40 : Timeout.Infinite);
        output.Enqueue(value ? "{\"type\":\"ptt\",\"pressed\":true}" : "{\"type\":\"ptt\",\"pressed\":false}");
        outputReady.Set();
    }
    static int ModifierMask(int key) { return key == 0x10 || key == 0xA0 || key == 0xA1 ? 4 : key == 0x11 || key == 0xA2 || key == 0xA3 ? 2 : key == 0x12 || key == 0xA4 || key == 0xA5 ? 1 : key == 0x5B || key == 0x5C ? 8 : 0; }
    static bool IsDown(int key) { return (GetAsyncKeyState(key) & 0x8000) != 0; }
    static int PhysicalModifiers() { int mask = 0; foreach (int key in modifierCodes) if (IsDown(key)) mask |= ModifierMask(key); return mask; }
    static void ResyncModifiers() {
        modifierKeys.Clear(); modifiers = 0;
        foreach (int key in modifierCodes) if (IsDown(key)) { modifierKeys.Add(key); modifiers |= ModifierMask(key); }
    }
    // Virtual keys that can represent the configured physical key right now: the
    // foreground layout's mapping plus the NumLock-dependent numpad/navigation aliases.
    // Returns 0 when nothing could be mapped (the watchdog then trusts the hook).
    static int MainState() {
        uint thread = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
        IntPtr layout = GetKeyboardLayout(thread);
        uint mapped = MapVirtualKeyEx((uint)keyScan | (keyExtended ? 0xE000u : 0u), 3, layout);
        List<int> candidates = new List<int>();
        if (mapped != 0) candidates.Add((int)mapped);
        if (!keyExtended) {
            int[] extra;
            switch (keyScan) {
                case 0x47: extra = new int[] { 0x67, 0x24 }; break;
                case 0x48: extra = new int[] { 0x68, 0x26 }; break;
                case 0x49: extra = new int[] { 0x69, 0x21 }; break;
                case 0x4B: extra = new int[] { 0x64, 0x25 }; break;
                case 0x4C: extra = new int[] { 0x65, 0x0C }; break;
                case 0x4D: extra = new int[] { 0x66, 0x27 }; break;
                case 0x4F: extra = new int[] { 0x61, 0x23 }; break;
                case 0x50: extra = new int[] { 0x62, 0x28 }; break;
                case 0x51: extra = new int[] { 0x63, 0x22 }; break;
                case 0x52: extra = new int[] { 0x60, 0x2D }; break;
                case 0x53: extra = new int[] { 0x6E, 0x2E }; break;
                case 0x37: extra = new int[] { 0x6A }; break;
                case 0x4A: extra = new int[] { 0x6D }; break;
                case 0x4E: extra = new int[] { 0x6B }; break;
                default: extra = new int[0]; break;
            }
            candidates.AddRange(extra);
        }
        if (candidates.Count == 0) return 0;
        foreach (int key in candidates) if (IsDown(key)) return 1;
        return -1;
    }
    static void Watch(object state) {
        lock (gate) {
            if (!pressed) return;
            // Recent hook traffic (including auto-repeat) proves the hook is alive.
            if (unchecked(Environment.TickCount - lastMainEvent) < 250) { missing = 0; return; }
            int main = MainState();
            bool intact = main >= 0 && (mainIsModifier || PhysicalModifiers() == requiredModifiers);
            if (intact) { missing = 0; return; }
            if (++missing < 3) return;
            if (main < 0) keyArmed = true;
            ResyncModifiers();
            SetPressed(false);
        }
    }
    static void WriteEvents() {
        while (true) {
            outputReady.WaitOne();
            string line;
            while (output.TryDequeue(out line)) { Console.WriteLine(line); Console.Out.Flush(); }
        }
    }
    static IntPtr OnKey(int code, IntPtr message, IntPtr data) {
        if (code >= 0) {
            int kind = message.ToInt32();
            bool down = kind == 0x100 || kind == 0x104;
            bool up = kind == 0x101 || kind == 0x105;
            if (down || up) {
                KeyboardData entry = (KeyboardData)Marshal.PtrToStructure(data, typeof(KeyboardData));
                int modifier = ModifierMask((int)entry.key);
                lock (gate) {
                    if (ignoreHook) return CallNextHookEx(hook, code, message, data);
                    if (modifier != 0) {
                        if (down) modifierKeys.Add((int)entry.key); else modifierKeys.Remove((int)entry.key);
                        modifiers = 0;
                        foreach (int key in modifierKeys) modifiers |= ModifierMask(key);
                    }
                    int scan = (int)entry.scan;
                    bool extended = (entry.flags & 1) != 0;
                    if (scan == 0) {
                        // Software that injects by virtual key only (macro tools, remappers) supplies no
                        // scan code; derive it so those events match like hardware key presses.
                        uint derived = MapVirtualKey(entry.key, 4);
                        scan = (int)(derived & 0xFF);
                        extended = (derived & 0xFF00) == 0xE000;
                    }
                    bool main = enabled && scan == keyScan && extended == keyExtended;
                    if (main) { lastMainEvent = Environment.TickCount; if (up) keyArmed = true; }
                    if (!enabled || !keyArmed || (!mainIsModifier && modifiers != requiredModifiers) || (main && up)) SetPressed(false);
                    else if (main && down) SetPressed(true);
                }
            }
        }
        return CallNextHookEx(hook, code, message, data);
    }
    static void ReadCommands() {
        string line;
        while ((line = Console.ReadLine()) != null) {
            string[] parts = line.Split(' ');
            // Diagnostic: "IGNORE 1" makes the hook discard events, simulating a hook Windows
            // removed after a timeout, so the lost-key-up watchdog can be verified.
            if (parts[0] == "IGNORE") { lock (gate) { ignoreHook = parts.Length > 1 && parts[1] == "1"; } continue; }
            lock (gate) {
                SetPressed(false);
                int scan = 0, extended = 0, mods = 0;
                enabled = parts.Length == 4 && parts[0] == "CONFIG" && int.TryParse(parts[1], out scan) && int.TryParse(parts[2], out extended) && int.TryParse(parts[3], out mods) && scan > 0;
                keyScan = scan; keyExtended = extended != 0; requiredModifiers = mods;
                mainIsModifier = scan == 0x1D || scan == 0x2A || scan == 0x36 || scan == 0x38;
                // A key that is already held when configured must be released and pressed again.
                keyArmed = !enabled || MainState() <= 0;
                lastMainEvent = Environment.TickCount - 100000;
                ResyncModifiers();
            }
        }
        Environment.Exit(0);
    }
    static int Main() {
        hook = SetWindowsHookEx(13, callback, GetModuleHandle(null), 0);
        if (hook == IntPtr.Zero) { Console.WriteLine("{\"type\":\"error\",\"message\":\"Windows keyboard hook could not start\"}"); return 1; }
        watchdog = new Timer(Watch, null, Timeout.Infinite, Timeout.Infinite);
        Console.WriteLine("{\"type\":\"ready\"}"); Console.Out.Flush();
        Thread writer = new Thread(WriteEvents); writer.IsBackground = true; writer.Start();
        Thread reader = new Thread(ReadCommands); reader.IsBackground = true; reader.Start();
        Message message;
        while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0) {}
        UnhookWindowsHookEx(hook);
        return 0;
    }
}
