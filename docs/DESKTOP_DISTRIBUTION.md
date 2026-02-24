# Desktop Distribution Guide

This project can ship a real Windows desktop app (installer + portable), not a browser wrapper that depends on a hosted website.

## Build artifacts

```powershell
npm run desktop:bundle
```

Output directory:
- `release/`

Primary artifacts:
- `Aether Studio-win32-x64/Aether Studio.exe`

Optional zip for release upload:

```powershell
npm run desktop:zip
```

Optional installer build (electron-builder):

```powershell
npm run desktop:dist:installer
```

Note: installer build may require Windows Developer Mode/admin symlink privileges on some machines.

## Automatic updates (electron-updater)

Auto-update is enabled for packaged builds and checks on startup, then every 4 hours.

Release requirements:
- Build and publish installer artifacts with `electron-builder` (NSIS target).
- Publish releases to GitHub repo `Coolzymccooy/aetherstudio-zip`.
- Set `GH_TOKEN` in the release environment so `electron-builder` can upload artifacts and update metadata.

Windows PowerShell (current shell session):
```powershell
$env:GH_TOKEN="YOUR_GITHUB_TOKEN"
npm run desktop:publish
```

`desktop:publish` uploads NSIS installer assets and `latest.yml` for auto-update.

Optional runtime env controls:
- `AETHER_AUTO_UPDATE=0` to disable updater.
- `AETHER_AUTO_UPDATE_INTERVAL_MS=<ms>` to change polling interval (minimum 60000 ms).

## Runtime behavior of packaged app

- App UI is served locally from bundled `dist/`.
- Relay (`aether-relay/server.js`) is launched locally.
- PeerJS server (`server/peer.cjs`) is launched locally.
- FFmpeg binary path is resolved from bundled `tools/`.

## Website download link

Landing page reads:
- `VITE_DESKTOP_DOWNLOAD_URL`

Set this to your release URL (for example GitHub Releases latest):
- `https://github.com/Coolzymccooy/aetherstudio-zip/releases/latest`

When set, the landing page shows **Download Desktop App**.
