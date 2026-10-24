# Planetary website brief

Mode: persuade, with a cinematic tour. Audience: friends, gaming groups and small creative communities deciding whether to open Haven. Primary action: open the hosted app. Secondary: the Windows app (pending until the approved installer is published).

Direction: Haven's authentication scene is the world the site happens in. The planet is Haven itself; its four moons hold Communities, the Windows app, How it works and Questions. Selecting a world (or scrolling) moves the camera to it and the section settles in beside it. The tour ends by pulling back to the whole system for the closing call to action.

Product story: chat, voice and screen sharing are one experience, so they share one interactive replica of the Haven window with three moments (talk, drop into voice, share a screen) rather than three planets.

Implementation: the auth `OrbitalScene` imported from `apps/web/src/orbital`, a CPU projection of its orbits for waypoints and camera targets, semantic sections in normal document flow, native dialog and disclosures. No new dependencies, services or hosting.

Boundaries: `apps/landing` only, evidence under `output/landing-premium-20261024`. No commit, push, deployment or publication.
