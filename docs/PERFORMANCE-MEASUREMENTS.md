# Background voice measurements

Measured 2026-10-15 on this Windows computer: Intel Core i5-12500H, 16 logical processors, 15.71 GiB RAM. The baseline is the preserved v0.2.0 portable executable; the updated sample uses v0.3.0 source Electron with the new media, desktop and permission code. Subsequent final UI-only copy/quality-control changes do not alter the sampled codec policy.

## Method and limits

`scripts/measure-background.mjs` launches disposable profiles with one Electron account and one authenticated headless Chrome account on the same embedded backend. Both join a real Haven voice room using Chromium synthetic microphones and real WebRTC. Each phase waits two seconds, then collects seven samples 1.5 seconds apart. The script samples Electron process metrics, RTP counters, selected-candidate RTT and a single localhost health request per interval. It does not saturate the network, run a game, benchmark the GPU or send external ping traffic. The original user's profile is never opened.

CPU is the sum of Electron's reported per-process `percentCPUUsage`, not a validated Windows Task Manager or game CPU percentage. Working set is summed across Electron processes and can double-count shared pages; private bytes provide a separate, narrower memory view. These exclude the embedded Node server, Chrome receiver, operating system, drivers and keyboard helper. The helper is inactive in voice-activity mode. Therefore these are **not whole-system resource totals**. RTP payload excludes IP/UDP/SRTP/RTCP overhead and is not total NIC traffic.

The runs are short and sequential, not a randomized controlled benchmark. Warmup, audio patterns, Windows scheduling and other applications introduce noise. They establish local continuity and observed resource ranges, not causal performance gains or game compatibility.

## Observed samples

| Minimized voice phase | v0.2 baseline | v0.3 normal | v0.3 gaming |
| --- | ---: | ---: | ---: |
| Sum of reported Electron CPU metric, mean | 0.81 | 1.57 | 0.99 |
| Summed working set, mean MiB | 642 | 656 | 661 |
| Summed private bytes, mean MiB | 288 | 303 | 308 |
| Outgoing audio RTP payload, kbit/s | 21.4 | 33.2 | 15.9 |
| Incoming audio RTP payload, kbit/s | 24.3 | 36.8 | 37.4 |
| Local HTTP RTT median / sampled p95, ms | 2.1 / 2.8 | 1.8 / 1.9 | 1.8 / 2.1 |
| Mean incoming audio jitter, ms | 0.14 | 0.14 | 0.00 |
| Lost incoming packets in sampled interval | 0 | 0 | 0 |

Gaming mode reduced **observed outgoing** payload versus normal v0.3 in this sample. Only the desktop sender enabled gaming mode; the receiver's outgoing audio remained normally configured. Codec limits are deterministic, but actual payload reductions vary with speech, DTX, FEC, peers and congestion. Normal v0.3 did not use less outgoing bandwidth than v0.2 in this sample. There is **no demonstrated CPU or RAM reduction versus v0.2** here, and Electron retains a substantial memory baseline. Do not interpret the local RTT numbers as Valorant ping or the absence of local loss as a WAN guarantee.

All sampled minimized phases continued receiving audio. A separate Windows test kept real captured-window video and a synthetic microphone transmitting through minimize and close-to-tray; one final source run increased RTP bytes from 22,680 to 28,897 over 1.6 seconds while connections and tracks remained live. This tests background continuity, not human-perceived media quality.

## Repeat without stress traffic

```powershell
node scripts/measure-background.mjs baseline-020 'C:\Users\adity\OneDrive\Desktop\space\release\Haven-0.2.0-win32-x64\Haven.exe'
node scripts/measure-background.mjs current-030
```

Raw samples are retained in `measurements/background-baseline-020.json` and `measurements/background-current-030.json`, outside Playwright's auto-cleared `test-results` directory. The real-device inventory check is `measurements/windows-audio-devices.json`: actual Intel microphone and Realtek headphone/speaker names were detected, a short real microphone capture stopped successfully, and Chromium accepted a silent non-default output selection. No microphone recording was saved/transmitted/played; this does not verify acoustic output routing or physical USB hot swapping.

The current implementation reduces avoidable work through transition-only speaking events, no redundant bootstrap fetch on voice-state updates, no idle typing/statistics interval, slower background statistics, paused visual motion, coalesced preference writes and a nonblocking event-driven PTT helper. Those implementation changes do not substitute for measured whole-system improvements.

## Still required on a gaming setup

- Repeat comparable baseline/voice/gaming runs in the actual game, recording frame-time p95/p99, network RTT, jitter and loss; include both uncongested and normally busy home-network conditions without deliberately flooding it.
- Measure total CPU, actual private/process-tree RAM including the backend/helper, GPU utilization and encoding cost with approved OS/game tools over longer runs.
- Test physical microphones/headphones, device removal/reconnection, acoustic echo and input/output latency.
- Verify global key release in the actual game's privilege level and anti-cheat environment. Never bypass anti-cheat or weaken Windows security to make it work.
- Test real router/NAT/TURN paths and multiple room peers. Mesh audio and each screen viewer add bandwidth; HTTPS alone does not remove congestion.

See `DESKTOP-GAMING.md` for the complete manual checklist. No Valorant process was launched, inspected, modified or injected into.
