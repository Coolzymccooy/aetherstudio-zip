# Relay Operations Guide

This guide is for the active relay implementation at `aether-relay/server.js`.

## Required Environment

- `RELAY_TOKEN`
  - Must match frontend `VITE_RELAY_TOKEN` used at build time.
- `RTMP_URL_PRIMARY`
  - Default YouTube ingest base, for example `rtmps://a.rtmp.youtube.com/live2`.

## Optional Environment

- `RTMP_URL_FALLBACK`
  - Used only for single-destination raw stream key mode.
- `FFMPEG_PATH`
  - Override ffmpeg binary location.
- `RELAY_MAX_DESTINATIONS`
  - Max output fan-out count (default `4`).
- `RELAY_SOFT_QUEUE_BYTES`
  - Relay soft congestion threshold (default `2097152`).
- `RELAY_HARD_QUEUE_BYTES`
  - Relay hard congestion threshold (default `8388608`).
- `RELAY_RESTART_BASE_MS`
  - Base restart backoff delay (default `1500`).
- `RELAY_RESTART_MAX_MS`
  - Max restart backoff delay (default `12000`).
- `RELAY_MAX_RESTART_ATTEMPTS`
  - Restart attempt cap before fatal stop (default `6`).
- `RELAY_INPUT_CHUNK_TIMEOUT_MS`
  - Max wait for first ingest chunk after ffmpeg start (default `15000`).

## Health and Diagnostics

### `GET /health`

Returns relay health with runtime metrics:

- `activeStreams`
- `totalStarts`
- `totalRestarts`
- `restartAttempts`
- `lastDestinationCount`
- `lastCloseCode`
- `lastFfmpegPid`
- `lastError`
- `lastErrorAt`
- `ingestIgnoredNoStream`
- `ingestIgnoredNoFfmpeg`
- `ingestIgnoredNotActiveHost`
- `lastStartAt`
- `lastFirstChunkAt`
- `lastFirstChunkDelayMs`
- `ffmpegPath`

### `GET /ffmpeg`

Returns ffmpeg availability/version and binary path.

## WebSocket Event Meanings

- `destination_status`
  - Per-destination status updates: `starting`, `up`, `degraded`, `down`.
- `relay_congestion`
  - Relay ingest queue level transitions: `soft`, `hard`, `recovered`.
- `relay_fatal`
  - Non-recoverable relay stop reason (for example max restarts exceeded).
  - `no_input_data_from_encoder` includes `timeoutMs` and `sessionId`.
- `ffmpeg_restarting`
  - Backoff restart attempt metadata.

## Render Deployment Runbook

1. Service root: `aether-relay/`
2. Start command: `npm start`
3. Instance type: `Standard (2 GB RAM, 1 CPU)`
4. Region: set to US region closest to primary encoder clients
5. Configure required env vars (`RELAY_TOKEN`, `RTMP_URL_PRIMARY`)
6. Deploy manually and monitor logs

## First Soak Checklist

1. Verify `GET /health` is healthy and metrics fields are populated.
2. Verify `GET /ffmpeg` returns an ffmpeg version line.
3. Start one 30-minute YouTube stream and confirm no repeated `relay_fatal`.
4. Start YouTube + secondary destination and verify primary remains stable if secondary degrades.
5. Confirm start/stop cycles do not leave orphan ffmpeg processes.
