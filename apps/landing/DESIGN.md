---
name: Haven — Zenith Minimal / Obsidian
description: A cinematic tour through Haven's own orbital system, ending at the hosted app.
colors:
  surface-lowest: "#0b0e14"
  surface: "#101319"
  surface-container-low: "#191c22"
  on-surface: "#e1e2eb"
  muted: "#a6a6b3"
  line: "#ffffff12"
  line-strong: "#ffffff26"
  primary: "#c0c1ff"
  primary-light: "#e1dfff"
  on-primary: "#25264d"
  secondary: "#45dfa4"
  emerald-ink: "#10251f"
  emerald-hover: "#83e9c3"
  world-screen: "#bdcbd5"
  world-start: "#d5cec5"
  danger: "#ffb4ab"
typography:
  display:
    fontFamily: "Space Grotesk, sans-serif"
    fontSize: "clamp(3.3rem, 5.8vw, 5rem)"
    fontWeight: 500
    lineHeight: 1.01
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Space Grotesk, sans-serif"
    fontSize: "clamp(2.5rem, 3.7vw, 3.7rem)"
    fontWeight: 500
    lineHeight: 1.12
    letterSpacing: "-0.04em"
  title:
    fontFamily: "Space Grotesk, sans-serif"
    fontSize: "21px"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Inter, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  description:
    fontFamily: "Inter, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.8
  message:
    fontFamily: "Inter, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.7
  button:
    fontFamily: "Inter, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.5
rounded:
  channel: "5px"
  control: "6px"
  composer: "7px"
  mobile-panel: "9px"
  panel: "12px"
  circle: "50%"
spacing:
  compact: "8px"
  control: "12px"
  inset: "16px"
  group: "20px"
  panel: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "12px 22px"
  button-primary-hover:
    backgroundColor: "{colors.primary-light}"
  button-secondary:
    backgroundColor: "{colors.surface-container-low}"
    textColor: "{colors.on-surface}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "12px 22px"
  button-emerald:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.emerald-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "12px 22px"
  button-emerald-hover:
    backgroundColor: "{colors.emerald-hover}"
  demo-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.panel}"
  chat-composer:
    textColor: "{colors.on-surface}"
    rounded: "{rounded.composer}"
    padding: "4px"
  world-navigation:
    textColor: "{colors.muted}"
    padding: "8px 13px"
---

# Design System: Haven

## Overview

**Creative North Star: "Arriving somewhere"**

The website happens inside Haven's authentication scene. The live WebGL system (planet, rings, moons, dust) is the backdrop for every section; the camera travels to the body that hosts each destination and the copy settles in beside it. Restraint does the rest: an obsidian ground, fine lavender lines, one emerald for anything live.

**Key characteristics**

- The approved orbital scene, never a recreation. Copy calms the scene behind it (`data-calm`) instead of sitting on cards.
- Space Grotesk headings with tight tracking, Inter for reading, JetBrains Mono for coordinates and labels.
- Section eyebrows are orbital coordinates: index, hairline, destination.
- Feature lists are set as spec sheets with hairlines, not card grids.
- Solid surfaces are reserved for things you use: the Haven window replica, the download panel, the invite, the diagram. No simulated features or decorative badges.

## Colors

- **Lavender** `primary` (#c0c1ff): identity, primary actions, focus, coordinates, waypoints.
- **Emerald** `secondary` (#45dfa4): only what is live — voice connected, speaking, transmitting, available.
- **Amber** (#ffcf8a): the single pending state (installer coming soon).
- **Neutrals**: void #090b10 behind the scene, surfaces #101319 → #272a30, text #e1e2eb / #c7c5d0, muted #a6a6b3.

## Motion

Camera flights take 1.5–2.1 s with cubic in-out easing and a gentle zoom-out arc between distant bodies. Copy fades out in 0.32 s, back in over 0.7 s, and arrives with an 18 px rise. The scene renders at 60 fps while moving and 30 fps when still, pausing when hidden. Reduced motion: still frames, instant jumps, no infinite animations, all copy visible.

## Layout

Each destination is a full-height station. Wide screens put copy opposite the focused body; medium screens move bodies left and copy right; narrow screens anchor the body near the top and let copy scroll over it. The Haven window replica adapts with container queries. Content width is 1280 px (1520 px from 2000 px).

## Components

Buttons: primary lavender, quiet glass outline, emerald for confirmed states; 44 px minimum targets. Header: transparent over the hero, blurred obsidian once scrolled; full navigation from 1100 px, native modal drawer below. Position rail: seven ticks on the right edge with hover labels.
