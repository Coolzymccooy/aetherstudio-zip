# Desktop Local Runbook (Windows)

This run path is for deterministic local testing with Electron + local relay + local PeerJS.

## 1) Start clean

```powershell
npm run desktop:clean
```

## 2) Launch desktop stack

```powershell
npm run desktop:dev
```

What this launches:
- Vite UI on `http://127.0.0.1:5174`
- Electron desktop window
- Local relay (`:8080`) and PeerJS (`:9000`) if not already running

## 3) Verify services

```powershell
Invoke-RestMethod http://localhost:8080/health
Invoke-RestMethod http://localhost:8080/ffmpeg
```

Expected:
- `ok=true`
- `activeWsConnections >= 1` when desktop is open

## 4) Connection mode in desktop app

Desktop preload forces local defaults each launch:
- Mode: local/custom local server
- Host: `127.0.0.1`
- Port: `9000`
- Path: `/peerjs`
- TLS: off
- Mobile base URL: auto-set to your LAN IP (for QR links on phones)

Do not use old Cloudflare/ngrok host values in desktop-local testing.

## 4.1) Phone camera capacity (stability limit)

- Default max phone slots: `4` (configurable with `VITE_MAX_PHONE_CAMS`)
- Recommended for stable 720p live on one desktop: `2-4` phone cams
- If you need more than 4, increase `VITE_MAX_PHONE_CAMS` and retest CPU/network headroom

## 5) Streaming validation gate

After clicking **Go Live**, run:

```powershell
while ($true) {
  $m = (Invoke-RestMethod http://localhost:8080/health).metrics
  "{0} req={1} acc={2} streams={3} chunks={4} bytes={5} err={6}" -f (Get-Date -Format T),$m.startRequests,$m.startAccepted,$m.activeStreams,$m.ingestChunksTotal,$m.ingestBytesTotal,$m.lastError
  Start-Sleep 1
}
```

Pass condition (first 10 seconds):
- `startRequests` increments
- `startAccepted` increments
- `ingestChunksTotal` keeps increasing
- `lastError` stays empty

## 6) Build installable desktop app

```powershell
npm run desktop:bundle
```

Primary desktop artifact:
- `release/Aether Studio-win32-x64/Aether Studio.exe`

Optional zip (for upload/download hosting):

```powershell
npm run desktop:zip
```
