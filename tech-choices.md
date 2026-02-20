# Tech Choices and Design Rationale (KGBaby v0.2)

This document captures the architectural choices and the real-world reasons behind them.

## Core Architecture

- **WebRTC via PeerJS (P2P)**
  - Why: Lowest possible latency and avoids routing baby audio through a server. This is critical for trust and response time.
  - Tradeoff: Requires signaling and can fail on some networks (TURN optional).

- **Browser-first, no build step**
  - Why: Parents can open a URL on any device quickly; no install friction.
  - Tradeoff: Mobile backgrounding and autoplay policies are stricter than native apps.

## Audio Capture and Processing

- **Always-on transmission (no Minimal mode)**
  - Why: Parents want to hear all vocalizations, including quiet grunts and whines. VAD gating missed “medium” sounds in practice.
  - Tradeoff: Higher bandwidth and CPU usage, accepted for reliability.

- **Echo cancellation enabled**
  - Why: Real rooms contain reflective surfaces; enables better suppression of playback leaking into the mic.
  - Tradeoff: Slightly alters audio fidelity, acceptable for monitoring.

- **Auto-gain + noise suppression**
  - Why: Baby sounds are often quiet at distance; auto-gain helps pick them up while noise suppression reduces ambient hums.
  - Tradeoff: Can introduce pumping; acceptable compared to missed sounds.

- **Mic boost hard-coded to 3.0x**
  - Why: In real usage it’s almost always on; removing UI reduces mistakes and simplifies control surface.
  - Tradeoff: More distortion; acceptable for alerting use.

- **VAD retained only for cry detection**
  - Why: “Last cry” indicator is useful metadata even though we transmit continuously.
  - Tradeoff: Small CPU cost; tuned with a longer interval (250ms) for efficiency.

## White Noise Design

- **White noise plays on child only and is suppressed from parent audio**
  - Why: Parents want soothing sounds in the room without masking live audio in the parent feed.
  - How: White noise is routed through the audio graph and subtracted from the outgoing stream, plus echo cancellation.
  - Tradeoff: Cancellation is best-effort; some residual noise may remain depending on acoustics.

- **Timer options: 30 / 60 / infinite**
  - Why: Simple and matches real sleep routines without complex scheduling UI.

- **Autoplay handling**
  - Why: Mobile browsers often block audio playback until a gesture. A CTA on the child device avoids silent failures.

## Power and Reliability

- **Wake Lock API (screen)**
  - Why: Prevents the screen from sleeping during monitoring sessions, which would stop audio capture.
  - Tradeoff: Not supported everywhere; a hidden video loop is retained as a fallback.

- **True black dim overlay**
  - Why: OLED power savings; avoids wasting battery on near-black pixels.

- **Local storage for settings**
  - Why: Survives reloads in a real-world “nighttime” use case without a server.
  - Tradeoff: Per-device state only; not synced across accounts.

## Networking

- **Local-network friendly defaults**
  - Why: Typical use is within the same home or travel Wi‑Fi; reduces complexity.
  - Tradeoff: Some constrained networks need TURN, which is optional and documented.

## UX Principles

- **Minimal controls**
  - Why: Night-time use on phones requires low cognitive load.
  - Examples: Removal of Mic Boost toggle and Minimal mode.

- **Visual confirmation**
  - Why: Parents need to know the connection is alive even when muted.
  - Example: Audio meter and “Audio connected” status.

## Open Constraints

- **Mobile backgrounding**
  - Limitation of browsers; even with Wake Lock, audio may stop if the tab is suspended.

- **Cancellation quality**
  - Best-effort suppression of white noise; depends on device mic/speaker placement.
