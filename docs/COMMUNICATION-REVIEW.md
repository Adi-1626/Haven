# Haven 0.2 communication review

## What changed

| Area | Root problem and resulting behavior |
| --- | --- |
| Voice rooms | The media hook already lived above text navigation, but the interface presented a call panel over every conversation. A separate persistent connection panel now stays below channel navigation. Selecting a voice channel opens its shared-room view; opening text, friends or settings leaves the room connection intact. The sidebar shows actual members, speaking, mute, deafen and streaming state. |
| Speaking and input | The original voice path had no actual activity detector or input controls. A shared Web Audio pipeline applies input gain, a compressor, measured RMS, sensitivity gating with hysteresis and a 500 ms hangover. Only speaking transitions are signaled; the backend sends authorized activity updates without reloading the whole bootstrap. |
| Microphone testing | Voice & Audio now has **Mic Test → Let’s Check / Stop Test**, a measured input meter, input volume/sensitivity and selected output routing. A separate capture uses the same processing pipeline and limited 30% playback. It is not mixed into room transmission and is cleaned up on stop, close, failure or canceled permissions. An active room remains connected. |
| Streams | A dedicated viewer expands the stream beyond the old thumbnail-height limit. Actual fullscreen applies to the whole viewer, preserving its controls and video aspect ratio. Mute/deafen remain available inside it. Stop Sharing is visible in the persistent panel, room controls and the broadcaster’s viewer. Capture tracks, senders and preview resources stop, while microphone voice continues. A stopped stream does not reopen itself on the next broadcast. |
| Invitations | A community code did not identify the desktop’s randomly allocated backend address. New full links carry `/invite/code`, preview the community before authentication, survive registration/sign-in, and require an explicit join. Codes remain useful on the same host. Host addresses and community invitations have distinct screens and explanations. Localhost links are labeled same-computer only. |
| Invite authorization | New invitations expire after seven days by default, with selectable expiry and moderator revocation. Public previews expose only a community name/icon and expiry, not private membership or messages. Redemption requires an authenticated account. Legacy permanent invites survive an additive database migration. `PUBLIC_URL` supplies an operator-configured, reachable HTTPS origin. |
| Friends | A second standalone backend has different accounts, so friend lookups could never find Desktop Account A from a browser on the wrong backend. Clients can now discover/open the desktop’s exact host. Friend forms show/copy the exact username, normalize @/case/whitespace, show clear success/errors and expose incoming/accepted/outgoing/canceled state. Updates reach both clients, including offline recipients on their next login. |
| Blocking | Persistent blocks clear friendship and pending requests atomically. New direct messages, reactions, edits, title changes, requests and new conversation invitations honor the block. Existing history and deletion of one’s own messages remain available. Shared community rooms/groups are not hidden by a personal block. |
| Multiple clients | **Test with another account** exposes the actual backend URL and opens the system browser or a separate temporary Electron cookie partition. Account B does not replace Account A. Main-window closure shuts down dependent clients; closing an isolated client preserves the main login. The embedded backend remains loopback-only. |

The native capture maximum, source-bounded downscaling, 15/30/60 fps targets, independent system audio, soundboard mixing and WebRTC transport remain in place. No static or simulated production features replaced these paths.

## Behavioral references and REA evidence

Discord’s public [microphone testing guide](https://support.discord.com/hc/en-us/articles/360020641332-Mic-Testing) describes starting the check from voice settings with **Let’s Check** and using the configured input/output. Its [streaming guide](https://support.discord.com/hc/en-us/articles/360040816151-Go-Live-and-Screen-Share) describes discovering a live stream from a voice-channel member’s live indicator. These informed the visible mic-test and room/stream controls; Haven’s implementation is independent.

The local shipped `app-1.0.9261/modules/discord_voice-2/discord_voice` package was inspected again with REA, selecting only `package.json` and `index.js`. Parent evidence: `ev_5b98a044473393d146610e31c292081dc714b45dfc9f9b8ae55a703e9aeb42fb`; summary: `ev_4dc0ec725748c68cd8765388ea4aa2238810b5640feca0100ae73cb20f3a0d35`; selected wrapper item: `ev_f7e55e97d6b1514ef5146e65eccfa2ed75a3c7c0615e951caa1468edf07cf6db`. Wrapper SHA-256: `1c12139ccbf818a992fb813b4954a68b1d64b4e96b0f6a97e12862ca5eef764a`.

The selected wrapper parsed as inert text. A bounded direct read corroborated native-facing self-mute/deafen, per-user volume and desktop-source/lifecycle boundaries. These are declarations and static wrapper observations, not evidence of native algorithms, runtime defaults, actual microphone-test acoustics or achieved streaming performance. REA explicitly left 478 inventoried files outside the selected source scope, and dynamic relationships remain partial. Discord was not launched with debugging flags; no account data, credentials, private conversations, proprietary code or assets were copied into Haven.

The existing codebase-memory entry had no meaningful source graph, so ordinary source reads and actual application tests supplied the repository-level analysis. REA coverage limits did not block ordinary development.

## Verification

- `npm test`: 27 unit/integration cases covering persistence, migration, permissions, mutual friendship/races, blocks, invite expiry/revocation, authorized activity, source quality, input processing and cancellation-safe media lifecycle.
- `npm run test:e2e`: eight browser/desktop cases, including existing functionality and the complete new communication flow.
- `npm run test:desktop-clients`: real Electron Account A, real Chrome Account B and isolated Electron Account C share one backend while keeping independent sessions and local storage. Fresh temporary clients, owner preservation, invitation paths, fullscreen and synthetic microphone cleanup pass.
- Native window capture was sent from the actual Electron picker to an independent browser viewer; the stream viewer entered/exited actual fullscreen in both Chrome and Electron. Short current samples encoded/received 1424 × 900 with a 60 fps target and measured 57–59 fps after warm-up.
- Mic tests used real `getUserMedia` with Chromium’s synthetic device: measured meter activity, real processed playback stream at 30%, selected routing, stopped tracks, and an uninterrupted active voice connection.
- The soundboard transport regression sets microphone gain to zero, waits for stable receiver audio energy, plays a known WAV, and checks that actual inbound WebRTC audio energy rises. This distinguishes transmitted soundboard output from an unrelated live microphone.
- Source shrink/growth, share-stop cleanup, continued voice packets after stopping capture, and repeated joins remain covered. Missing packet-loss measurements display as unavailable.

These are local functional checks. They do not establish physical microphone/speaker quality, real-room feedback suppression, Windows loopback acoustics, reliable two-physical-device LAN behavior, TURN-only internet connectivity, sustained 4K/60 operation or long-duration load/security guarantees. Voice rooms still use an eight-connection mesh. The portable build remains unsigned.

## Manual acceptance

Follow [the exact Desktop A / Browser B walkthrough](MULTI-CLIENT.md). It explains the current backend URL, separate browser/private sessions, usernames, invite redemption, mic tests, speaking state, soundboard, fullscreen, stopping capture and disconnecting. It also gives LAN binding/firewall/trusted-HTTPS guidance and the separate requirements for Internet hosting, STUN and TURN.

The updated executable is in `release/Haven-0.2.0-win32-x64/Haven.exe`. Keep the whole folder. The prior build and actual user profile are preserved; building and automated testing use disposable profiles rather than migrating a live private profile.
