# Haven Design System & Visual Specification (DESIGN.md)

**Version:** 1.0.0  
**Design Direction:** Obsidian Precision (High-Density Modern Desktop Communication)  
**Target Platform:** Desktop Electron (Windows / macOS / Linux) & Web (React 19 / Vite)  
**Stitch MCP Project:** `projects/15602523423719124295`  
**Stitch Design System Asset:** `assets/8932113219067286008`

---

## 1. Executive Philosophy & Visual Language

Haven is a self-hosted, independent community communication platform built for serious conversations, gaming sessions, and crystal-clear voice/screen sharing.

### 1.1 Core Tenets
1. **Visual Discipline & Restraint**: Avoid generic AI cliches—no garish purple gradients, no fuzzy glassmorphism that obscures text, and no oversized card padding that wastes desktop viewport space.
2. **High Information Density Without Clutter**: Inspired by the precision of Linear and the interaction fluency of Discord, Haven uses disciplined 1px hairline dividers, distinct surface tiers, and calibrated typographic hierarchies to maximize visible content without cognitive overload.
3. **Gaming Performance & Low Visual Fatigue**: Designed for 8+ hour gaming and voice sessions. Deep obsidian neutrals (`#090B0E` to `#181C26`) protect night-adjusted vision. Micro-animations are kept under 200ms and completely bypass layout thrashing or heavy backdrop filters.
4. **Peripheral Comms Awareness**: Voice states (speaking, muted, deafened) are instantaneously readable through distinctive emerald halos (`#10B981`) and crisp, quiet status icons.
5. **Quiet Normal State, Rich Hover Diagnostics**: Never display persistent ping, latency, RTT, jitter, packet loss, or network graphs on headers, tiles, or sidebars. Connection quality is represented exclusively by the existing 3-bar Wi-Fi indicator in the voice dock; detailed diagnostics are exposed only on hover/focus.
6. **Zero Invented Features**: Every visible control, button, input, and state in the design maps 1:1 to an existing, working feature in Haven 0.4.1. No fake dashboards or monitoring panels.
7. **Haven-Only Identity**: Product name is Haven. Zero infrastructure labels, cloud region codes (e.g. Mumbai, ap-south-1), or technical marketing fluff.

---

## 2. Design Tokens & Color Palette

All colors adhere to WCAG 2.1 AA standards (minimum 4.5:1 for body text, 7:1+ for headers and critical telemetry).

### 2.1 Surface Layers (Dark Theme Source of Truth)
| Token | Hex Value | Semantic Usage |
| :--- | :--- | :--- |
| `--haven-bg-void` | `#090B0E` | Deepest root background behind modals & overlays |
| `--haven-bg-app` | `#0D0F14` | Server Rail background, outer application frame |
| `--haven-bg-sidebar` | `#12151C` | Channel sidebar, friend navigation panel |
| `--haven-bg-surface` | `#171B24` | Main chat timeline, topbar, active item backgrounds |
| `--haven-bg-surface-elevated` | `#1E2330` | Hover states, message actions, cards, input backgrounds |
| `--haven-bg-surface-highlight` | `#262D3D` | Active selection, button secondary hover, selected pills |
| `--haven-bg-modal` | `#151821` | Floating dialogs, quick switcher, settings modal |

### 2.2 Borders & Dividers
| Token | CSS Value | Usage |
| :--- | :--- | :--- |
| `--haven-border-subtle` | `rgba(255, 255, 255, 0.06)` | Channel row dividers, panel boundaries, rail divider |
| `--haven-border-default` | `rgba(255, 255, 255, 0.10)` | Input borders, card outlines, header bottom borders |
| `--haven-border-strong` | `rgba(255, 255, 255, 0.18)` | Active card highlights, focused modal frames |
| `--haven-border-focus` | `rgba(79, 142, 247, 0.65)` | Keyboard accessible focus rings (2px outline, offset 2px) |

### 2.3 Typography & Text Foreground
| Token | Hex Value | Contrast on Surface | Role |
| :--- | :--- | :--- | :--- |
| `--haven-text-primary` | `#F1F5F9` | 13.8:1 (AAA) | Message text, server titles, input values |
| `--haven-text-secondary` | `#94A3B8` | 6.8:1 (AA) | Channel names, timestamps, role tags, descriptions |
| `--haven-text-muted` | `#64748B` | 4.6:1 (AA) | Subtext, placeholder hints, shortcut keys (<kbd>) |
| `--haven-text-disabled` | `#475569` | 3.1:1 | Disabled button labels, inactive indicators |

### 2.4 Accents & Telemetry Tones
| Token | Hex Value | Role |
| :--- | :--- | :--- |
| `--haven-accent-primary` | `#4F8EF7` | Haven Signature Electric Blue (CTA, primary buttons, active links) |
| `--haven-accent-hover` | `#6BA1FF` | Hover state for primary buttons |
| `--haven-accent-indigo` | `#6366F1` | Secondary brand accent, server boost/featured indicators |
| `--haven-status-online` | `#10B981` | Online presence indicator |
| `--haven-status-speaking` | `#10B981` | Real-time speaking ring & audio waveform glow |
| `--haven-status-idle` | `#F59E0B` | Away / Idle status badge |
| `--haven-status-dnd` | `#EF4444` | Do Not Disturb status badge |
| `--haven-status-live` | `#EC4899` | `LIVE` stream broadcast pill badge |
| `--haven-status-danger` | `#EF4444` | Delete, Leave Server, Block, Kick actions |
| `--haven-status-warning` | `#F59E0B` | Packet loss warning, high latency indicator |

---

## 3. Typography Hierarchy

### 3.1 Fonts
- **Headings & Display**: `Manrope`, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
- **Body & Controls**: `DM Sans`, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
- **Telemetry & Codes**: `JetBrains Mono`, 'SF Mono', Consolas, monospace

### 3.2 Type Scale
- **Display 1 (Auth Slogan)**: 36px / line-height 1.15 / weight 800 / tracking -0.03em (`Manrope`)
- **Heading 1 (Channel Welcome)**: 24px / line-height 1.25 / weight 750 / tracking -0.02em (`Manrope`)
- **Heading 2 (Modal Titles / Topbar)**: 18px / line-height 1.3 / weight 700 / tracking -0.015em (`Manrope`)
- **Heading 3 (Section Labels)**: 14px / line-height 1.4 / weight 600 (`Manrope`)
- **Body Regular (Message Content)**: 14px / line-height 1.55 / weight 400 (`DM Sans`)
- **Body Small (Channel Rows / Members)**: 13px / line-height 1.45 / weight 500 (`DM Sans`)
- **Caption / Timestamp**: 11px / line-height 1.3 / weight 500 (`DM Sans`)
- **Micro / Section Eyebrow**: 10px / line-height 1.2 / weight 700 / uppercase / tracking 0.08em (`Manrope`)
- **Monospace Metrics (Ping / RTT / Bitrate)**: 11px / tabular-nums / weight 600 (`JetBrains Mono`)

---

## 4. Spacing, Elevation & Corner Radii

### 4.1 Radii
- `--haven-radius-xs`: `3px` (Pills, tag badges, unread indicators)
- `--haven-radius-sm`: `6px` (Buttons, input fields, channel item rows)
- `--haven-radius-md`: `8px` (Message bubbles, cards, user context menus)
- `--haven-radius-lg`: `12px` (Modals, quick switcher, stream viewer windows)
- `--haven-radius-full`: `9999px` (Avatars, circular icon buttons, presence dots)

### 4.2 Shadows & Depth
- `--haven-shadow-subtle`: `0 1px 3px rgba(0, 0, 0, 0.35)`
- `--haven-shadow-elevated`: `0 6px 20px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.06)`
- `--haven-shadow-modal`: `0 24px 60px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.10)`
- `--haven-shadow-speaking`: `0 0 0 2px #10B981, 0 0 14px rgba(16, 185, 129, 0.35)`

---

## 5. Layout Architecture & Responsive Breakpoints

```
+--------------------------------------------------------------------------------------------------+
| HAVEN DESKTOP SHELL (1920x1080 / 1366x768)                                                      |
+--------+---------------------+----------------------------------------------------+--------------+
| SERVER | CHANNEL SIDEBAR     | TOPBAR (56px) - Channel name, topic, tools, status | MEMBER LIST  |
| RAIL   | (240px)             +----------------------------------------------------+ (220px)      |
| (72px) | - Header / Dropdown | MESSAGE TIMELINE / VOICE ROOM VIEW                 | - Grouped by |
|        | - Text Channels     | - Welcome block / History                          |   Online/    |
| - Home | - Voice Channels    | - Date dividers                                    |   Offline    |
| - Guild| - Voice Connection  | - High-contrast messages & attachments             | - Roles &    |
| - Add  | - User Panel Footer | - Reactions & Context actions                      |   Moderation |
| - Join |   (Mic/Deafen/Gear) +----------------------------------------------------+              |
|        |                     | COMPOSER (File upload, Emoji, Input, Send)         |              |
+--------+---------------------+----------------------------------------------------+--------------+
```

### Breakpoints & Adaptive Modes
1. **Ultra / Desktop Wide (>= 1600px)**: 72px rail, 260px sidebar, fluid center, 240px member list.
2. **Standard Desktop (1280px - 1599px)**: 72px rail, 240px sidebar, fluid center, 220px member list.
3. **Compact Desktop / Game Overlay (960px - 1279px)**: 64px rail, 220px sidebar, fluid center, collapsible member sidebar (toggled via header button).
4. **Mini Window (< 960px)**: Collapsible sidebar into sliding drawer; single-pane focus.

---

## 6. Key Screen Specifications

### 6.1 Server Rail
- Clean, tactile server glyphs (44x44px, transitioning to 12px squircle on hover).
- Active server marked with pill indicator on left edge (3px wide, 32px tall).
- Unread badge: small 8px indicator with subtle ring border matching rail background.
- Home Haven icon rendered in crisp brand electric blue with signature starburst glyph.

### 6.2 Voice Experience & Clean Comms Architecture
- **Participant Grid**: Balanced, auto-fitting grid tiles on dark surface `#171B24`.
- **Speaking State**: Active speaker's avatar is encircled by a crisp 2px emerald halo (`#10B981`) with clean status.
- **Mute / Deafen**: Subtle, high-contrast microphone muted glyph displayed only when participant is muted. No technical bitrate or codec badges on cards.
- **Connection Quality**: Quiet, unobtrusive 3-bar Wi-Fi signal icon in the bottom-left voice status bar. Detailed WebRTC telemetry (RTT, jitter, packet loss) appears *only* when the user hovers or focuses this icon.
- **Participant Controls**: Right-click or contextual 3-dots hover action reveals participant volume slider and moderation actions.

### 6.3 Message Composer & Reactions
- Single unified border container with interior toolbar.
- Attachments show icon, file size, download button, and close badge.
- Reaction bubbles show SVG emoji + count; own reactions highlighted with subtle blue border (`rgba(79, 142, 247, 0.4)`) and tinted background.

### 6.4 Fullscreen Screen Sharing (StreamViewer.tsx Exact)
- **Maximum Usable Area**: Shared desktop or game stream occupies the maximum viewport area in 16:9 on pitch-black obsidian (`#07090D`).
- **Zero Persistent Telemetry**: No floating telemetry HUD, no bitrate/loss pills, no giant participant sidebars obstructing gameplay.
- **Production Controls (StreamViewer.tsx)**:
  * Top bar: Return to voice room button (`<ArrowLeft />`), `LIVE` pill, Stream Title (`Alex’s screen`), and native resolution indicator (`1920 × 1080`).
  * Bottom bar: Invariant notice (`Voice stays connected · Aspect ratio preserved · Native size or smaller`), Mic mute toggle (`<Mic />`), Deafen toggle (`<Headphones />`), and Fullscreen toggle (`<Minimize /> Exit fullscreen` with `<kbd>Esc</kbd>`).

### 6.5 Authentication & Desktop Window (App.tsx Exact)
- Frameless Electron titlebar with drag region, centered Haven wordmark, and native window controls.
- Split screen layout: Left art panel (`auth-art`) with orbital graphic and brand copy; Right form panel (`auth-form`) on `#141722`.
- Production fields strictly: `EMAIL ADDRESS`, `PASSWORD` (with eye toggle), `Forgot your password?` link, and `Sign in` primary CTA with right arrow.
- Bottom navigation toggle: `New around here? Join Haven`.
- Zero Server Host inputs, zero passkey buttons, zero cloud infrastructure labels, and zero region tags.

---

## 7. Gaming Mode & Background Performance Rules

- **Zero Heavy Filter Loads**: When Haven is minimized or in Gaming Mode (`data-gaming="true"`), all background transitions and CSS blurs are disabled (`filter: none !important; backdrop-filter: none !important`).
- **Deferred Speaking Halos**: Speaking animations throttle to simple opacity toggles rather than continuous box-shadow repaints.
- **Strict Frame Capping**: Stream thumbnail previews reduce to 1 FPS when backgrounded.
- **Resource Discipline**: Total background CPU usage strictly under 1.0% on 8-core CPUs.

---

## 8. Refined Stitch MCP Screen Reference Inventory

All screens are generated and maintained in Stitch MCP Project `15602523423719124295`:

| # | Screen Description | Stitch Screen ID | High-Res Preview URL |
| :--- | :--- | :--- | :--- |
| **1** | **Main Desktop Chat Shell (`#general`)** | `0edbe1e4b2da4616b435476c532bc420` | [Preview Screen 1](https://lh3.googleusercontent.com/aida/AEtjO1XPwljTH7Dnn0apJ43hNaFr10PN05mke6WAocgifknteEDtSGzXbVUidsjaztxfkogahytOhvVQD0ps8AXTBxtLf_PuGqQu31Q7eMxAPuS3fj6IZjNFClTVa3gm16KYzmH-vtoFjKPcvUsZ8JaHrKinnHOuxsfnL4uCvSVZHVUSP6yJWQCvagb8umxJu3I82bRmJf4lUdu9lZsAfl4MNMwj6enM-u1MtWk4jD7tJVp9qOe9QAh1g_rXlYk) |
| **2** | **Production Voice Room (`Ranked Duo`)** | `c7ea7ce6026d4a2cad9e812929d53bc1` | [Preview Screen 2](https://lh3.googleusercontent.com/aida/AEtjO1VNYVS7qplj0dJwTi14rhfMIJZ8feVvx3-syxV3Ac8FTXFj4mJpj2J7p6a2rEy5Oja728ARKRdedaeF9Ff8D97pgrPLgXwr6B9hohzCrYmsQUmNbvqNtilDCbxQsoChym0m1UXSbCxizwlS3i8wy8Ok6f5IzFiF6jAr2nJ5nNQsSHmY9izRN7QmkAAQ3B7mn-odnNYH_OQqioVWKt-NMNk-SapVoj5s_oDpJvoXKngArWU9Lof09KwQKiVG) |
| **3** | **Voice & Audio Settings Modal** | `774b795d162144e2babb268449ba0c32` | [Preview Screen 3](https://lh3.googleusercontent.com/aida/AEtjO1WoeuxLrLG_Xnj8C31urM7Vr2T7Ii2OnNYadwV2DaueF5CHgjWJKhcfj4BgnDvl-WRgf_y-ITsr6ZUDENRMGgRw1dPpiymv_K6zAWNESlVFRPD-bvw1YV4M_RIH4PIIXNzQ3jJZeS-7cRAmDT2dKKROKDvqPrZLAdKdL_YSzazwpDu4cGs_4UnuX_loOvTp7nK97KuvUZ1tKH9nxhezOr7PHhIQRUx03X5cjdfbbdvptNtzovmiTB4vH8Pd) |
| **4** | **Production Friends & DM Hub** | `5f773d6d68a9472f8a00b91461ca81b7` | [Preview Screen 4](https://lh3.googleusercontent.com/aida/AEtjO1VtBuwpf-5VmYGLClsJScZBtp4UM6zKxcv9cyNrUzSLtsTTzQwqEgFvPg5jmogQBI4qGWlkshIxk3BUuu4e-BF7msEYLKtKbOjV72BechJ5oKxNz2CD8ip3h7Pg7cTnWxpik6kfyCJLgnYuGRIwPDOcwf7Sq72r2hWzo4cNNpuJobuz4-MlBbOtmT6xD__uZLJMerHCzQHh96GwmJatJ_p3jjwHQRZSjgdGYZ92hMZv87zOWCPQfp_RWL08) |
| **5** | **Production Authentication Screen** | `34b5380f1878428396cdaa9bd9a38e79` | [Preview Screen 5](https://lh3.googleusercontent.com/aida/AEtjO1XDVCe2PFugj9a5gQ9HrjrGWtzYecMSoHcJH__XGTDoepANVfVsycbldqsmlFMilfOkkPUStPpd68WJb4DZ1RyoOWLRPkBFJd9qYvlJxf5dXJ-Rg1ShlIclt_AGo-jxN0cNfzy0NeRMW99C1hJeMErv3-2LcnzwNpWrbrtYn48Nx6ptEEXWpPL1TbvdyhRW_qkjAXyTHwk6zW4JC5pNwgIVBq4ZVVbT4xHBNa87NUFkigHLhq6pdUUijK5-) |
| **6** | **Production Fullscreen Stream Viewer** | `b8f9408feeee4e4a902b23e68e2d4eb3` | [Preview Screen 6](https://lh3.googleusercontent.com/aida/AEtjO1Uo3Vbdyp7f5aKA0Dm8TSjmfX5smvwaT8LS2YL6DIqmh364I63ahwKdYN_qA9AYgu8QMDS6-76fIqH4lJuuEJPmD21VsA_6Xgi1cRAA_VqY-AvxNZiMb7CcP7jYxj6aym1SJ48CiVfqLls2AbQILf9tDU282iZ3jxc4djue0FGzdw0XMwMB3CXpPDo78P7JFHa3zM5rztaTC4x9ho0A0jv0OPJkE5Ca2GD0uA3iv_SYwQHu8DFJ-q3yihAS) |
