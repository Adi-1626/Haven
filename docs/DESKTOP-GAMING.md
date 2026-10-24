# Desktop, background voice and gaming

## Configure Haven

Open **User settings → desktop & gaming**. Changes are applied immediately, except shortcut text fields which use **Apply shortcuts**.

- **Low-resource gaming mode** pauses animated emoji, uses a 32 kbit/s maximum Opus voice payload per peer instead of 48 kbit/s, and limits outgoing sharing to at most 720p, 30 FPS and 3 Mbit/s per viewer. Smaller sources are never upscaled. Turn gaming mode off to restore access to native/60 FPS sharing and adjust sharing quality again if desired.
- **Animate emoji** controls the original bundled SVG motion emoji in messages, reactions and the picker. Ordinary Unicode stays unchanged. The six animated tokens are also ordinary text, for example `:haven_wave:`. Unknown tokens remain literal text. Motion stops for reduced-motion users, offscreen emoji, background windows and gaming mode. At most 24 visible emoji animate simultaneously, with no remote image fetches or per-emoji timers.
- **Close to system tray** hides the main window instead of exiting. **Minimize to system tray** also hides its taskbar button. Both are optional and disabled by default. Voice and active sharing keep running. The tray offers opening Haven, mute, deafen and full quit. Hiding is not a privacy stop: explicitly stop sharing or mute when needed.
- **Start Haven at Windows sign-in** is opt-in. Place the entire portable folder in its final location before enabling it. Moving it later requires disabling and reenabling startup from the new location. **Start minimized to tray** applies to startup launches and requires a tray option so Haven remains reachable.
- **Push-to-talk shortcut** accepts any single key (for example `` ` `` / Backquote, a function, numpad, punctuation or navigation key), a lone modifier such as Right Control, or Control/Alt/Shift plus one key. Keys are matched by physical position (scan code, like `KeyboardEvent.code`), so a binding means the same key on every keyboard layout. **Global mute shortcut** and **Global deafen shortcut** are registered as Windows hotkeys and need Control, Alt and/or Shift plus one registrable key. Defaults are Control+Shift+Space, Control+Shift+M and Control+Shift+D. Duplicate, reserved, Haven quick-switch and OS-occupied bindings are rejected. An empty desktop binding disables that action. Games can use bindings without registering them with Windows, so Haven cannot discover every in-game conflict.

Enable **Push to talk** in **voice & audio** before using its shortcut. Global shortcuts control only the main desktop client, not independent test clients. The Windows helper runs only while joined to voice with push-to-talk enabled. It observes configured press/release transitions through a low-level keyboard hook, does not suppress input (a bare typing key is still typed into the active game or chat) or save typing, and uses no polling loop while idle. While push-to-talk is held, a 40 ms watchdog compares the hook with the physical key state, so a lost key-up (hook timeout, lock screen, UAC/secure desktop) closes the microphone within about half a second. A hotkey conflict with another application is reported, but the hook still works. Windows blocks hooks from seeing input sent to elevated (administrator) windows, which this helper does not work around: run Haven elevated, or the game unelevated, if push-to-talk stops only for one elevated program. Anti-cheat software may also block global hooks; verify with your game. The portable build includes the compiled helper; development can compile the included source using Windows .NET Framework. Errors are shown in settings and never silently treated as success.

Browsers and isolated test clients support focused push-to-talk only. Browsers expose no API to read the keyboard while another window has focus, so web push-to-talk cannot work in the background; it releases the microphone when the page loses focus or is hidden. They also lack system-wide shortcuts, Windows startup and tray control. Do not use the browser to conclude that background desktop hotkeys fail.

## Audio devices and settings

In **voice & audio**, choose **Detect audio devices** to grant microphone permission, reveal real Windows device names and immediately release the discovery capture. Inputs and outputs also enumerate on opening settings, after capture and on `devicechange`. Plugging in a device adds it without a restart. Removing a selected device switches to the system default and reacquires the microphone without intentionally leaving the room. The operating system can still interrupt audio briefly while its endpoint changes.

Device selection, processing, input volume/sensitivity, push-to-talk, gaming mode, notification/emoji preferences and mute/deafen survive desktop restarts even when the embedded backend chooses a different port. Only these whitelisted client preferences use profile storage; session cookies and account databases are not copied. Independent test windows have separate temporary preferences and cookies. Browser preferences remain scoped to their origin/profile.

**Let's Check** uses a separate capture and the same processing settings as room voice. Changes update/restart only the necessary pipeline, superseded captures are stopped, and monitoring remains capped at 30%. Stop Test or close settings to release it. Use headphones: two clients on the same physical machine cannot prove independent real-device conversation or feedback-free acoustics.

Mute/deafen states are retained until explicitly changed, including when rejoining a room. A muted microphone must not become live merely because a network connection reconnects.

## Background and reconnect behavior

Cancel, Escape or the source picker's close button resolve the pending capture request once. They do not leave voice or display an unhandled JavaScript error. A later share request remains usable.

Minimizing, hiding to tray or changing focus does not close WebRTC, stop the microphone or end sharing. Rendering and emoji motion pause separately from the audio path. Electron background timer throttling is disabled for media continuity; Haven explicitly reduces visual/statistics work instead of risking delayed push-to-talk release or audio gates.

Temporary signaling loss retains live local microphone and screen tracks and automatically rejoins the authorized room after Socket.IO reconnects. Remote peer connections are rebuilt. Failed/disconnected ICE connections use bounded delayed ICE restarts; leaving cancels pending recovery. This does not guarantee seamless delivery through sleep, disabled devices, expired sessions, lost membership or a stopped hosting backend. The app still needs HTTPS and appropriate STUN/TURN for non-local connections, as described in `MULTI-CLIENT.md`.

Use **Quit Haven (disconnect voice)** in the tray to stop all clients, capture, global keyboard helpers and the embedded backend. Closing without close-to-tray retains the original full-exit behavior. Quitting ends sessions; it does not sign the account out of its persisted login.

## Network and resource design

Opus voice negotiation requests mono, variable-rate audio, discontinuous transmission and in-band forward error correction. Sender bitrate is bounded to 48 kbit/s normally, 32 kbit/s in gaming mode, and 24 kbit/s under measured loss/high RTT. Actual encoded payload can be lower. Protocol overhead, additional peers and soundboard audio still consume bandwidth. WebRTC controls congestion; these caps are not Windows network QoS or a guarantee that router queues cannot grow.

Voice activity is computed locally and signaled only on transitions. Mute/deafen/share updates no longer trigger redundant full-bootstrap downloads. Idle typing cleanup no longer wakes React every second. Statistics sampling is inactive without peers, slower for voice/background/gaming, and faster only for foreground video. Native keyboard output is queued off the hook callback. Profile writes are coalesced rather than synchronously writing every slider event. No game process is inspected, injected into, elevated or modified.

## Manual Windows gaming checks

1. Keep Account A in desktop and use **Test with another account** for Account B on the same backend. Use two computers and headsets for meaningful acoustic and game-network checks.
2. Grant device permission; compare names against Windows Sound settings. Switch input and output while talking and running Mic Test. Unplug/replug a USB headset, verify fallback, select it again, stop Test and confirm voice continues.
3. Enter different PTT/mute/deafen combinations. Try duplicate bindings and Control+K; verify clear rejection without replacing working shortcuts. Enable PTT, hold/release the configured combination behind another app, then repeat in your game. Release modifiers before the main key too: transmit must close.
4. Cancel, close and Escape the share picker repeatedly, then successfully share. Have B verify both audio and received video. Minimize A, hide A to tray and restore. Test tray mute/deafen; stopping sharing must leave voice connected.
5. Disconnect the network briefly and restore it. Verify the same room rejoins, remote audio/video resumes and muted state remains muted. Explicitly leave while disconnected and verify it does not rejoin later.
6. Change preferences, quit and restart desktop. Confirm settings and mute/deafen survive. Test startup behavior at the next actual Windows sign-in; automation does not change the real user's startup registry.
7. For actual Valorant testing, record a no-Haven baseline and repeated voice-only runs, then gaming-mode runs under comparable server/route, room size and network load. Compare the game's network RTT/jitter/loss and frame-time percentiles, not only average FPS. Separate voice-only from sharing runs. Use built-in game diagnostics/approved capture tooling; do not install hooks into the game or bypass anti-cheat. If input interception is blocked, choose a supported binding/device workflow rather than weakening security.

There is no claim of Valorant compatibility, unchanged internet ping, zero packet loss, verified anti-cheat interoperability or improved game frame times without that real-world test. Short local measurements cannot establish any of those claims.

The measured CPU, memory, payload and localhost latency comparison is in `PERFORMANCE-MEASUREMENTS.md`, with raw samples under `measurements/`. It shows no demonstrated CPU/RAM reduction versus the previous build; gaming mode reduced outgoing audio payload in the short local sample.

## Reference boundary

REA statically inspected selected installed Discord voice and input-capture wrappers as behavioral context, without running Discord or accessing account data. Voice analysis parent: `ev_fdaf54d2489a99933feb340d8d4e73f155b1d1225b66634b4548422a84b2ba38`; input analysis parent: `ev_ed2d34573d6aa32d3c3600b7a2b7558810659900961d66b5e9aae72fdfce6436`. The wrappers expose mute/deafen/device/source boundaries and distinct key press/release capture. Native algorithms, game behavior and unselected sources remain unknown. Haven's code and SVG assets are independent implementations.

API/design references: [Electron global shortcuts](https://www.electronjs.org/docs/latest/api/global-shortcut), [Electron background throttling](https://www.electronjs.org/docs/latest/api/browser-window), [Windows low-level keyboard callbacks](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelkeyboardproc), [Opus RTP parameters](https://www.rfc-editor.org/rfc/rfc7587).
