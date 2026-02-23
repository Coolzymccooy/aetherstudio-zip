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
