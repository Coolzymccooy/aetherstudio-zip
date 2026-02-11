# PWA Setup - Aether Studio

## What exists
- Main app PWA:
  - `public/manifest.json`
  - `public/service-worker.js`
  - `public/icons/icon.svg`
  - `public/icons/icon-maskable.svg`

- Companion (phone camera) PWA:
  - `public/manifest-companion.json`
  - `public/companion.html`

## How to install
1. Open the main app in Chrome (HTTPS or localhost).
2. Use the browser "Install" icon or "Add to Home Screen".

## Companion install
1. Open `/companion.html` on the phone.
2. Use "Add to Home Screen".
3. The companion PWA starts at `/?mode=companion`.

## Notes
- Service worker caches core files only.
- For offline support of all assets, add build artifacts to the cache list.
