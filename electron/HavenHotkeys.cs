using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Collections.Generic;
using System.Collections.Concurrent;

class HavenHotkeys {
    delegate IntPtr HookCallback(int code, IntPtr message, IntPtr data);
    [StructLayout(LayoutKind.Sequential)] struct KeyboardData { public uint key; public uint scan; public uint flags; public uint time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct Message { public IntPtr window; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; public uint unused; }
    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetWindowsHookEx(int type, HookCallback callback, IntPtr module, uint thread);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll")] static extern int GetMessage(out Message message, IntPtr window, uint min, uint max);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string module);
    static readonly object gate = new object();
    static readonly HashSet<int> modifierKeys = new HashSet<int>();
    static readonly ConcurrentQueue<string> output = new ConcurrentQueue<string>();
    static readonly AutoResetEvent outputReady = new AutoResetEvent(false);
    static int keyCode, requiredModifiers, modifiers;
    static bool enabled, pressed, keyArmed;
    static IntPtr hook;
    static HookCallback callback = OnKey;
    static void SetPressed(bool value) {
        if (pressed == value) return;
        pressed = value;
        output.Enqueue(value ? "{\"type\":\"ptt\",\"pressed\":true}" : "{\"type\":\"ptt\",\"pressed\":false}");
        outputReady.Set();
    }
    static int ModifierMask(int key) { return key == 0x10 || key == 0xA0 || key == 0xA1 ? 4 : key == 0x11 || key == 0xA2 || key == 0xA3 ? 2 : key == 0x12 || key == 0xA4 || key == 0xA5 ? 1 : key == 0x5B || key == 0x5C ? 8 : 0; }
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
                    if (modifier != 0) {
                        if (down) modifierKeys.Add((int)entry.key); else modifierKeys.Remove((int)entry.key);
                        modifiers = 0;
                        foreach (int key in modifierKeys) modifiers |= ModifierMask(key);
                    }
                    if (up && entry.key == keyCode) keyArmed = true;
                    if (!enabled || !keyArmed || modifiers != requiredModifiers || (up && entry.key == keyCode)) SetPressed(false);
                    else if (down && entry.key == keyCode) SetPressed(true);
                }
            }
        }
        return CallNextHookEx(hook, code, message, data);
    }
    static void ReadCommands() {
        string line;
        while ((line = Console.ReadLine()) != null) {
            string[] parts = line.Split(' ');
            lock (gate) {
                SetPressed(false);
                enabled = parts.Length == 3 && parts[0] == "CONFIG" && int.TryParse(parts[1], out keyCode) && int.TryParse(parts[2], out requiredModifiers);
                keyArmed = !enabled || (GetAsyncKeyState(keyCode) & 0x8000) == 0;
                modifierKeys.Clear(); modifiers = 0;
                foreach (int key in new int[] { 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5, 0x5B, 0x5C }) if ((GetAsyncKeyState(key) & 0x8000) != 0) { modifierKeys.Add(key); modifiers |= ModifierMask(key); }
            }
        }
        Environment.Exit(0);
    }
    static int Main() {
        hook = SetWindowsHookEx(13, callback, GetModuleHandle(null), 0);
        if (hook == IntPtr.Zero) { Console.WriteLine("{\"type\":\"error\",\"message\":\"Windows keyboard hook could not start\"}"); return 1; }
        Console.WriteLine("{\"type\":\"ready\"}"); Console.Out.Flush();
        Thread writer = new Thread(WriteEvents); writer.IsBackground = true; writer.Start();
        Thread reader = new Thread(ReadCommands); reader.IsBackground = true; reader.Start();
        Message message;
        while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0) {}
        UnhookWindowsHookEx(hook);
        return 0;
    }
}
