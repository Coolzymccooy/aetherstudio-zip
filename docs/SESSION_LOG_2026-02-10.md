# Aether Studio - Session Log (2026-02-10)

## Summary
This document summarizes the work completed today and where we stopped.  
Primary focus areas were: reliability fixes, settings UX, multi-input handling polish, relay/AI checks, licensing, and PWA readiness.

---

## Completed Changes

### 1) UI/UX + Settings
- Inputs panel became **collapsible sections** to keep actions visible.
- Settings became **floating + draggable** (non-modal), so users can see the app while adjusting.
- Settings were **partitioned into collapsible sections**:
  - Signaling Diagnostic
  - Room Management
  - Connection Mode
  - Pro License
  - Streaming
- Added **Admin panel** inside Settings for issuing licenses (see Licensing section).
- Added one-line hint: **Local uses this computer (localhost:9000)**; **Advanced** is for remote/VPS servers.

### 2) AI Graceful Fallback
- AI panel now shows **-AI backend not available-** instead of throwing errors.
- Added AI availability check (`/ai/health` then fallback `/ai/chat` probe).
- AI image parsing now accepts JSON **or** plain-text data URL responses.
- AI UI surfaces backend error text (so diagnosis is visible).

### 3) Relay/FFmpeg Health Checks
- **Relay Check** and **FFmpeg Check** buttons added to Settings.
- Added `/health` and `/ffmpeg` endpoints to signaling server.
- Relay now supports **ping/pong** and shows stream health stats.

### 4) Streaming Gating Fix
- -Go Live- now depends on **Relay + Stream Key** only (not PeerJS).

### 5) PeerJS + QR Improvements
- QR URLs now include PeerJS config automatically.
- Localhost PeerJS is rewritten to LAN IP for phones.
- Added -Wi-Fi Friendly Mode- (lower bitrate + 720p/24fps).

### 6) Licensing (Real Business-Ready)
- Server-side license verification:
  - `POST /license/verify`
  - Signed keys verified server-side (HMAC).
- License issuing endpoint:
  - `POST /license/issue` with admin token
- Admin UI inside app to issue keys.
- Frontend now **verifies keys with server**.
- Relay now allows `X-Admin-Token` in CORS headers.

### 7) PWA Readiness
- Added **service worker** with cache-first fallback.
- Updated manifest with local icons.
- Added local SVG icons.
- Updated theme color and meta tags.

### 8) Visual Design Refresh
- New **sleek palette** (teal + ember accent).
- Added **background gradient + subtle pattern**.
- New typography (Space Grotesk + Unbounded).
- Footer updated to **2026** and **Tiwaton Tech**.
- Studio layout now scrolls vertically when viewport is tight (no forced 80% browser zoom).
- Audio mixer height reduced on small screens.

---

## Licensing - How It Works

### Verification
```
POST /license/verify
{ "key": "PRO_..." }
```
Returns:
```
{ "ok": true, "pro": true, "message": "verified" }
```

### Issue a License
```
POST /license/issue
Header: x-admin-token: <LICENSE_ADMIN_TOKEN>
Body: { "email": "...", "days": 365, "plan": "pro" }
```

### Required Relay Env
- `LICENSE_SECRET`
- `LICENSE_ADMIN_TOKEN`

### Optional Frontend Env
- `VITE_ADMIN_EMAILS=you@example.com`
- `VITE_ALLOW_OFFLINE_PRO=true` (dev only)

---

## PWA Assets
- `public/service-worker.js`
- `public/manifest.json`
- `public/manifest-companion.json`
- `public/companion.html`
- `public/icons/icon.svg`
- `public/icons/icon-maskable.svg`

---

## Key Files Updated Today
- `components/Studio/StudioCore.tsx`
- `components/AI/AIPanel.tsx`
- `services/geminiService.ts`
- `services/licenseService.ts`
- `server/signaling.cjs` (historical; now deprecated shim)
- `aether-relay/server.js`
- `index.html`
- `manifest.json`
- `service-worker.js`

---

## Current State / Where We Stopped

### - Completed
- Floating, draggable settings with collapsible sections.
- License issuing UI (admin only).
- Licensing endpoints + verification flow.
- PWA scaffolding.
- Companion PWA installer page.
- Visual palette + fonts + background pattern.
- Footer text updated to Tiwaton Tech (2026).
- Studio view overflow fixes (no forced browser zoom).

### -- Pending / Next Steps
1. **Stripe integration**:
   - Add `/stripe/webhook` on relay.
   - Auto-issue license after payment.
2. **Full mobile adaptive layout** in Studio:
   - Hide/stack side panels on small screens.
   - Add mobile-friendly top/bottom nav.
3. **Final build/test**:
   - Run `npm run build` to verify.
   - Verify PWA install prompt in Chrome.
4. **AI routing in dev/prod**:
   - Ensure `VITE_AI_BASE_URL(_LOCAL)` points to the AI relay, not signaling.
   - Restart dev server after env changes.
   - Unregister service worker if cached JS is stuck.
   - For prod: set envs in Vercel and **redeploy**.
5. **License issuing errors**:
   - Ensure `LICENSE_SECRET` + `LICENSE_ADMIN_TOKEN` are set on relay.
   - Issue endpoint requires `x-admin-token` header to match.

---

## Notes / Caveats
- Service worker uses a simple cache-first fallback (safe, but not optimized).
- The PWA manifest start URL is now `/` (not companion mode).
  - If you want a companion-only PWA, we should add a second manifest.
- Vite env values are read at **build/start time** only; prod requires a redeploy after env changes.

---

## Quick Environment Checklist
- Frontend:
  - `VITE_AI_BASE_URL`
  - `VITE_FIREBASE_*`
  - `VITE_ADMIN_EMAILS` (optional)
- Relay:
  - `LICENSE_SECRET`
  - `LICENSE_ADMIN_TOKEN`
  - `GEMINI_API_KEY`
  - `RELAY_TOKEN` (optional)
  - `FFMPEG_PATH` (optional)

---

## Active Issues Observed
- **AI requests still hitting `http://localhost:8080/ai/image`** even after env update.
  - Likely cause: dev server not restarted or service worker caching old bundle.
  - Fix: stop dev server, restart `npm run dev:all`, unregister service worker, hard refresh.
- **Production AI failures** likely due to build-time env values.
  - Fix: set envs in Vercel and redeploy.

---

If you want me to continue with **Stripe integration** or **mobile layout upgrades**, say which to prioritize.

---

## Update (2026-02-23)

### Goal
- Complete deterministic relay hardening.
- Stabilize local and desktop streaming path.
- Add distributable desktop app workflow and download entry on landing page.

### Completed today
- Streaming/relay hardening:
  - Unified relay usage to `aether-relay/server.js`.
  - Added relay utilities and tests.
  - Added `/health` and `/ffmpeg` diagnostics expansion.
  - Added bounded restart/backoff and congestion signaling.
  - Added destination normalization and tee fanout isolation behavior.
- Studio encoder/bootstrap hardening:
  - Chunk-gated `start-stream` flow.
  - Recorder start guard, first-chunk timeout, fallback stages.
  - Persistent fatal messages for root-cause visibility.
  - Added encoder bootstrap diagnostics in settings.
- Multi-phone reliability polish:
  - Added max phone slot guard (`VITE_MAX_PHONE_CAMS`, default 4).
  - Added per-source call tracking to prevent overlapping call conflicts.
  - Improved reconnect/disconnect cleanup for stream/layer/audio state.
- Desktop runtime:
  - Added Electron main/preload runtime with single-instance lock.
  - Added local defaults for peer/relay setup.
  - Added LAN mobile base URL auto-population for QR phone onboarding.
  - Allowed Virtual Cable popup window in desktop runtime.
- Distribution:
  - Added desktop scripts:
    - `desktop:bundle`
    - `desktop:zip`
    - `desktop:dist`
    - `desktop:dist:installer` (optional, environment-dependent)
  - Added docs:
    - `docs/DESKTOP_LOCAL_RUNBOOK.md`
    - `docs/DESKTOP_DISTRIBUTION.md`
  - Landing page now supports a download CTA via `VITE_DESKTOP_DOWNLOAD_URL`.

### Verification status
- `npm --prefix aether-relay test`: pass.
- `npm run build`: pass.
- Desktop bundle produced:
  - `release/Aether Studio-win32-x64/Aether Studio.exe`
  - `release/AetherStudio-win32-x64.zip`

### Operational note
- `npm run desktop:zip` can take several minutes due archive size (~400MB+).
- Installer builds via `electron-builder` may fail on Windows without symlink privileges; `desktop:bundle` and `desktop:zip` are the stable path.
