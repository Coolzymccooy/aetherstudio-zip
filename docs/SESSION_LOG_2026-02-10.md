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

---

## Update (2026-02-23) - Production Incident Follow-up

### Incident
- Production landing page failed with runtime overlay:
  - `Something went wrong`
  - `Download is not defined`

### Root cause
- Commit `e835c60` added `<Download />` in `components/Landing/LandingPage.tsx` but did not import `Download` from `lucide-react`.
- Separate deploy warning in Vercel:
  - `Failed to fetch one or more git submodules`
  - Caused by a stale gitlink entry (`aetherstudio-zip-github`) without `.gitmodules`.
- Desktop release asset on GitHub (`v0.1.0`) was stale and still bundled old frontend JS, so desktop users still saw the same runtime error after install.

### Fixes implemented
- Frontend runtime fix:
  - Added missing icon import in `components/Landing/LandingPage.tsx`.
- Desktop CTA hardening:
  - Added canonical fallback desktop release URL in landing page.
  - Added typo normalization for old owner slug variant.
- Production URL correction:
  - Fixed `VITE_DESKTOP_DOWNLOAD_URL` typo to use `Coolzymccooy`.
- Vercel submodule warning fix:
  - Removed stale gitlink `aetherstudio-zip-github` from repo index.
- Deployment config and runbook:
  - Added `vercel.json` (Vite build/output settings).
  - Added `render.yaml` (relay web service definition).
  - Added `docs/PROD_RENDER_VERCEL_SETUP.md` and linked from `README.md`.
- Ignore hygiene:
  - Added `.local-run/` and `aetherstudio-zip-github/` to `.gitignore`.

### Commits / release actions
- Pushed fix commit to `master`:
  - `46e91db` - Fix production landing crash and desktop download deployment config
- Rebuilt desktop package from fixed code:
  - `release/AetherStudio-win32-x64.zip`
- Published new GitHub release:
  - `v0.1.1`
  - Asset: `AetherStudio-win32-x64.zip`
  - SHA256: `c974bf8d6f910821531753db7479c2066e91adaef3519ada7f446e822b7f5316`

### Verification
- `npm run build`: pass
- `npm --prefix aether-relay test`: pass
- Vercel production:
  - Site responds with new bundle.
  - Landing no longer throws `Download is not defined`.
  - Desktop download URL points to correct repo owner.
- Render relay:
  - `/health`: 200
  - `/ffmpeg`: 200
  - `/ai/health`: 200
- GitHub releases:
  - Latest now `v0.1.1`
  - Desktop asset size matches rebuilt package.

### Current state
- Web production path is stable (Vercel + Render healthy).
- Desktop users must install `v0.1.1` (older desktop zips remain broken due to stale bundled JS).

---

## Update (2026-02-24) - CI/CD + Desktop Publish Stabilization

### Goals
- Add GitHub Actions workflows for desktop publishing, Vercel deploy, and Render health checks.
- Resolve desktop publish failure: `cannot expand pattern "AetherStudio-${version}-${arch}-${target}.${ext}": macro target is not defined`.

### Build issue observed
- `npm run desktop:publish` failed in `electron-builder` because `win.artifactName` used `${target}`, which is not always defined for that path.

### Fixes implemented
- Updated `package.json`:
  - `build.win.artifactName` changed to:
    - `AetherStudio-${version}-${arch}.${ext}`
- Added GitHub workflows:
  - `.github/workflows/desktop-publish.yml`
    - Runs on tag push (`v*`) and manual dispatch
    - Uses `GH_TOKEN` secret
    - Runs `npm run desktop:publish` on `windows-latest`
  - `.github/workflows/vercel-deploy.yml`
    - Runs on `main`/`master` push and manual dispatch
    - Uses `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
    - Runs `vercel pull`, `vercel build`, `vercel deploy --prod`
  - `.github/workflows/render-health-check.yml`
    - Runs every 30 minutes, manual dispatch, and after Vercel workflow completion
    - Validates:
      - `/health` returns `ok:true`
      - `/ai/health` returns `ok:true`
    - Optional Render API status call with `RENDER_API_KEY`

### Production config alignment
- Updated `.env.production` to Ohio relay:
  - `VITE_SIGNAL_URL=wss://aether-relay-9g68.onrender.com`
  - `VITE_AI_BASE_URL=https://aether-relay-9g68.onrender.com`
  - Added local variants aligned to same host for desktop packaging.

### Secrets required for workflows
- `GH_TOKEN` (desktop release publish)
- `VERCEL_TOKEN` (Vercel CLI deploy)
- `VERCEL_ORG_ID` (Vercel project scope)
- `VERCEL_PROJECT_ID` (Vercel project scope)
- `RENDER_API_KEY` (optional for Render API status step)

### Operational note
- `desktop:publish` now targets NSIS publish path and is stable with current artifact name format.
- If secrets rotate, update GitHub Actions secrets before rerunning workflows.

### CI follow-up (same day)
- First workflow run after push showed:
  - `Vercel Deploy`: failed at `actions/setup-node` step.
  - `Render Health Check`: created failed runs with no jobs.
- Hardening changes applied:
  - `vercel-deploy.yml`: switched setup-node to `node-version: 20.x` and removed npm cache coupling.
  - Replaced `render-health-check.yml` with `render-health.yml` (fresh workflow registration), using deterministic triggers and direct endpoint checks.
- Final status after follow-up commits:
  - `Vercel Deploy`: passing on latest `master`.
  - `Render Health Check`: passing on latest `master`.
  - `Desktop Publish`: workflow reaches publish gate and fails at `Ensure GH token exists` because `GH_TOKEN` is not set in repository Actions secrets.

---

## Update (2026-02-24) - Desktop Stability + Streaming Reliability Fixes

### Goals
- Fix ENOENT crash in packaged builds by hardening child-process startup.
- Make desktop cloud-first (no local relay/peer autostart in packaged builds).
- Remove Firebase config blocker for desktop users.
- Fix image-source render performance (per-frame `new Image()` replaced with cache).
- Stabilize studio layout (overflow-hidden root, composition cap constant).
- Improve relay fatal diagnostics and restart tolerance.

### Changes implemented

#### electron/main.cjs
- Added `CLOUD_FIRST` flag: packaged builds skip local service spawn unless `AETHER_DESKTOP_LOCAL_SERVICES=1`.
- Wrapped `spawn` in try/catch with `child.on("error")` handler.
- Changed `cwd` to `getRunDir()` in packaged builds (avoids asar ENOENT).
- Guarded local service startup with `!CLOUD_FIRST`.

#### electron/preload.cjs
- Changed `aether_peer_ui_mode` from `"local"` to `"auto"`.
- Changed `aether_peer_mode` from `"custom"` to `"cloud"`.

#### App.tsx
- Firebase config guard now checks `!isDesktopRuntime`: desktop bypasses to Studio, web still shows blocker.

#### components/Studio/CanvasStage.tsx
- Added `imageElementsRef` (persistent image cache by layer ID).
- Draw loop uses cached `HTMLImageElement` instead of creating `new Image()` per frame.
- Added stale image cache cleanup in video lifecycle `useEffect`.

#### components/Studio/StudioCore.tsx
- Root container changed from `overflow-x-hidden overflow-y-auto` to `overflow-hidden`.
- Added `MAX_COMPOSED_CAMERAS` constant (configurable via `VITE_MAX_COMPOSED_CAMERAS`, default 4).
- Expanded `applyRelayFatalStatus` reason map with `max_restart_exceeded`, `relay_hard_congestion`, `all_destinations_failed`.
- Added diagnostic metadata (attempts, lastError) to fatal toast messages.
- Updated relay_fatal handler call to pass full message metadata.

#### aether-relay/server.js
- Increased `MAX_RESTART_ATTEMPTS` default from 6 to 10.
- Increased `RELAY_SOAK_RESET_MS` default from 30000 to 45000.
- Enriched `relay_fatal` payload for `max_restart_exceeded` with `lastError` and `lastCloseCode`.

#### docs/RELEASE_CHECKLIST.md
- Added smoke tests: cloud-first desktop, Firebase bypass, image stress, multi-camera stress, relay fatal recovery.

#### docs/DESKTOP_DISTRIBUTION.md
- Updated runtime behavior section to document cloud-first default and local-service opt-in override.

---

## Update (2026-02-24) - Pro Audio & UX Hardening

### Goals
- Implement professional-grade audio monitoring and signal analysis.
- Resolve critical UX bugs (camera blackout on switch, tab jumping).
- Overhaul help system for self-service troubleshooting.
- Enhance UI legibility across the core Studio interface.

### Changes implemented

#### Pro Audio Monitoring (`AudioMixer.tsx`)
- **High-Precision Metering**: Full rewrite using Web Audio API `AnalyserNode` for real-time RMS and Peak calculation.
- **Signal Quality Intelligence**: Automatic categorization into `Silent`, `Low`, `Optimal`, `Hot`, and `Clipping` zones with visual indicators.
- **Voice Clarity Engine**: Mid-range frequency analysis (300Hz-3kHz) to detect and highlight active speech.
- **Delivery Verification**: Added a "Stream Feed Active" heartbeat badge to confirm signal delivery to the mix destination.
- **Resource Optimization**: Refactored to share a single `AudioContext` from `StudioCore.tsx`, ensuring perfect sync and lower CPU overhead.

#### Critical Bug Fixes (`StudioCore.tsx`)
- **Black Screen on "Make Main"**: Removed `runTransition` wrapper from `makeMain` function which was applying a fade-to-black overlay during instant switches.
- **Tab Jumping Fix**: Added logical guards to the `selectedLayerId` observer to prevent auto-switching to the 'Properties' tab when the user is actively working in the 'Inputs' panel.
- **Default Transition**: Changed default system transition from `'fade'` to `'cut'` for more predictable default behavior.

#### Help System Overhaul (`HelpModal.tsx`)
- **Sidebar Navigation**: Replaced flat list with 11 categorized sections covering all major features.
- **Expanded Knowledge Base**: Increased FAQ from 7 to 14 entries with detailed troubleshooting steps for common stream issues.
- **Interactive Help Bot**: Added a searchable assistance interface with fuzzy matching and optimized keyboard support.

#### UI Legibility & Contrast
- **Font Scaling**: Increased base sizes for section headers (`xs` -> `13px`), subtitles, and helper text across the entire Studio sidebar.
- **Contrast Optimization**: Adjusted gray levels (`text-gray-500` -> `text-gray-300`) and increased status badge weight for better visibility on high-DPI displays.
- **Control Refinement**: Enlarged toggle switches and buttons by ~10% for improved click targets and visibility.

### Verification status
- `npm run build`: Pass (verified clean production bundle).
- Audio Signal Analysis: Confirmed working across local and mobile inputs.
- Camera Switching: Verified instant (no blackout) on "Make Main".
- Repository: All changes pushed to `master` (commit `3c5a7b8`).

---

## Update (2026-02-24) - Audience Message Submission (v0.1.4)

### Goals
- Implement a remote submission portal for congregation members.
- Enable the Studio host to ingest audience messages in real-time.
- Integrate audience portal generation into the existing QR connection workflow.
- Ensure seamless routing for mobile users via deep links.

### Changes implemented

#### Studio Core (`StudioCore.tsx`)
- **Real-time Ingestion**: Added a PeerJS data handler for `audience-message` types.
- **Message Formatting**: Automatically prepends message categories (Q&A, Prayer, etc.) to incoming text.
- **Status Feedback**: Added logic to trigger a host-side status notification when new audience messages arrive.

#### Mobile Studio (`MobileStudio.tsx`)
- **Audience Mode**: Implemented a dedicated UI for congregation members to select message categories and submit text.
- **Connection Management**: Created a lightweight PeerJS data-only connection logic specifically for one-off message submission.
- **Submission UI**: Added Lucide-icons, category selectors, and a success feedback state for user interaction.

#### QR Portal (`QRConnectModal.tsx`)
- **Mode Selector**: Added a UI toggle to switch between "Camera Mode" and "Audience Mode".
- **Dynamic URL Generation**: Updated `getMobileUrl` to append `mode=audience` to the generated connection string.
- **Themed UI**: Updated the modal header and descriptions to reflect the selected mode.

#### App Routing (`App.tsx`)
- **Deep Link Detection**: Updated URL parameter parsing to recognize `mode=audience`.
- **Persistent Routing**: Integrated audience mode into the local storage rehydration logic to ensure users stay in the portal after refreshes.

### Verification status
- `git commit` & `git tag v0.1.4`: Completed.
- `git push origin master --tags`: Successfully triggered CI/CD and Electron publish.
- Message Flow Verification: Confirmed end-to-end delivery from Mobile (Audience Mode) to Studio Queue.
- Release: v0.1.4 is now live.

---

## Update (2026-02-27) - Composer Stabilization + Audio Clarity + Desktop Release (v0.1.8)

### Goals
- Make Composer Mode deterministic across all templates (`Main+Thumbs`, `Split`, `PiP`, `Grid`).
- Eliminate transition/draw-loop dark-frame lockups during rapid layout/preset switching.
- Improve live voice clarity and reduce audio pumping/chatter, including Virtual Audio Cable workflows.
- Publish updated desktop production release.

### Changes implemented

#### Composer / Scene / Transition reliability
- Added pure layout engine:
  - `components/Studio/composerLayout.ts`
  - Deterministic placement and visibility for:
    - `main_thumbs`
    - `side_by_side`
    - `pip_corner`
    - `grid_2x2`
    - `freeform` passthrough behavior
- Added automated helper tests:
  - `components/Studio/composerLayout.test.js` (`node:test`)
- Refactored `StudioCore` composer orchestration:
  - Single deterministic apply path: `applyComposerLayoutState(...)`
  - Explicit camera-layer visibility updates (prevents stale hidden layers)
  - Overflow note when cap hides extras (`hidden by layout cap`)
  - Scene preset compatibility normalization + `version`/`cameraOrder` support
  - Removed old timeout/race layout paths
- Hardened transition pipeline:
  - Tokenized RAF cancellation
  - Alpha reset on complete/cancel paths
  - Transitions now consistently scoped to:
    - Apply Layout
    - Load Scene Preset
    - Cut To Next
    - Auto-Director
  - Manual `Main` remains instant

#### Canvas draw-loop stabilization
- Updated `components/Studio/CanvasStage.tsx`:
  - Moved dynamic draw inputs to refs (`layers`, `selectedLayerId`, `transitionOverlay`, `isPro`)
  - Single stable RAF loop reads current refs
  - Removed stale-closure behavior that could leave dark overlay until interaction

#### Audio clarity and ingest hardening
- Updated `components/Studio/StudioCore.tsx` audio engine:
  - Added master mix bus with subtle EQ + compressor + limiter before stream destination
  - Added per-track tone + compressor profile tuning
  - Improved HyperGate logic with hysteresis/hold adjustments to reduce gate chatter
  - Ensured gate opens cleanly when noise cancellation is disabled
  - Added preferred audio constraints for ingest:
    - `echoCancellation: false`
    - `noiseSuppression: false`
    - `autoGainControl: false`
    - prefer 48kHz path
  - Applied same capture-quality constraints during live microphone switching
- Updated `components/Studio/AudioMixer.tsx`:
  - Restored/added explicit Noise Cancellation toggle button (Sparkles) per track
- Updated `components/Studio/DeviceSelectorModal.tsx`:
  - Clarified Virtual Audio Cable guidance:
    - VAC must be selected under **Audio Input** to be streamed
    - Audio Output is monitor sink only

#### Help text alignment
- Updated `components/Studio/HelpModal.tsx` text so Composer/transition behavior and overflow policy match real runtime behavior.

### Release and deployment actions
- Pushed stabilization commit to `master`:
  - `689050b` - stabilize composer transitions and harden audio clarity pipeline
- Initial `desktop:publish` on `0.1.7` built successfully but skipped GitHub publish because `v0.1.7` already existed.
- Bumped version/tag:
  - `0.1.8` (`v0.1.8`) via patch release commit:
    - `986426b` - chore(release): 0.1.8
- Published desktop release successfully:
  - GitHub release created: `v0.1.8`
  - Uploaded:
    - `AetherStudio-0.1.8-x64.exe`
    - `AetherStudio-0.1.8-x64.exe.blockmap`
    - `latest.yml`

### Verification status
- `node --test --experimental-strip-types components/Studio/composerLayout.test.js`: pass (8/8)
- `npm run build`: pass
- `npm run desktop:publish` (v0.1.8): pass

### Operational note
- For external AI-processed audio chains (e.g., HyperGate app -> VAC), select VAC as **Audio Input** in source selection.
- Selecting VAC as **Audio Output** only changes monitoring destination and does not route it into stream ingest.
