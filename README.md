# BabyListen - Private Browser-Based Baby Monitor

A secure, zero-latency audio monitor that works over your local network using WebRTC (PeerJS). Designed for travel or backup use.

## Features

- **Zero Latency**: Direct Peer-to-Peer (P2P) audio streaming.
- **Privacy First**: Audio never touches a cloud server (except for the initial handshake).
- **Dark Mode**: OLED-friendly interface for use in dark rooms.
- **Smart Audio**:
    - **Child Unit**: Noise suppression and auto-gain (hears whispers, ignores fans).
    - **Parent Unit**: Visual audio meter to see noise even when muted.
- **Last Cry Indicator**: Parent shows “Last cry” based on sustained noise detection.
- **Reliability**: Auto-reconnection if Wi-Fi drops.

## How to Use

1. **Open the App**: 
   - Host it on GitHub Pages or open `index.html` locally.
   - **HTTPS is required** for microphone access (unless on `localhost`).

2. **Select Role**:
   - **Device 1 (Baby's Room)**: Select **Child Unit**.
   - **Device 2 (Parent)**: Select **Parent Unit**.

3. **Enter Room Name**:
   - Enter the **same** unique room name on both devices (e.g., `cabin123`).

4. **Start Monitoring**:
   - **Child Unit**: Tap "Start". Allow microphone access. Tap "Dim Screen" to save battery.
   - **Parent Unit**: Tap "Start". Wait for the status to turn **Green**. 
   - If audio doesn't play automatically, tap "Start Listening".

## Tuning Cry Detection

Adjust cry sensitivity in `cry-config.js`:

```js
window.CRY_CONFIG = {
  sustainedSeconds: 1.5,        // How long sound must stay above threshold
  minDbAboveNoise: 12,          // dB above rolling noise floor
  cooldownSeconds: 10,          // Minimum time between cry events
  noiseFloorWindowSeconds: 8,   // Rolling window for noise floor tracking
  noiseFloorUpdateMarginDb: 3   // Update floor only when near it
};
```

## Debug Overlay

Append `?debug=1` to the URL to see live network stats (bitrate, RTT, jitter, loss).

## Optional TURN (Hard Networks)

If direct P2P fails on certain networks, you can supply TURN credentials:

```html
<script>
  window.TURN_CONFIG = {
    urls: "turn:your.turn.server:3478",
    username: "user",
    credential: "pass"
  };
</script>
```

TURN relays audio when direct connections are blocked. It requires a TURN server and usually incurs bandwidth costs.

## Requirements

- Two devices with a modern browser (Chrome, Safari, Firefox).
- Both devices connected to the internet (for the initial handshake) or same LAN.
- **HTTPS** context (or `localhost`).

## Troubleshooting

- **No Audio?**: Ensure the Parent unit has tapped "Start Listening" (browsers block auto-play audio).
- **Connection Failed?**: Refresh both pages and try a different Room Name.
- **Echo?**: Ensure the Parent unit is not in the same room as the Child unit.

## Development

Runs with zero build steps.

```bash
# Serve locally
npx serve
```
