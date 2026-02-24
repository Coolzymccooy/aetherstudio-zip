# Release Checklist

Use this checklist for every desktop + web production release.

## 1) Preflight

- Confirm relay host choice (for example: `aether-relay-9g68.onrender.com`) and keep it consistent.
- Confirm required GitHub Actions secrets exist:
  - `GH_TOKEN`
  - `VERCEL_TOKEN`
  - `VERCEL_ORG_ID`
  - `VERCEL_PROJECT_ID`
  - `RENDER_API_KEY` (for Render API health step)
- Confirm Render service envs are set:
  - `RELAY_TOKEN`
  - `GEMINI_API_KEY`
- Confirm Vercel envs are set:
  - `VITE_SIGNAL_URL`
  - `VITE_AI_BASE_URL`
  - `VITE_RELAY_TOKEN`

## 2) Desktop env file

- Update `.env.production` and verify:
  - `VITE_SIGNAL_URL=wss://<relay-host>`
  - `VITE_SIGNAL_URL_LOCAL=wss://<relay-host>`
  - `VITE_AI_BASE_URL=https://<relay-host>`
  - `VITE_AI_BASE_URL_LOCAL=https://<relay-host>`
  - `VITE_RELAY_TOKEN=<exact Render RELAY_TOKEN>`

## 3) Health checks before release

- Confirm relay is healthy:
  - `https://<relay-host>/health`
  - `https://<relay-host>/ai/health`
- Both must return `"ok": true`.

## 4) Versioning

- Bump app version in `package.json` (and lockfile if tracked).
- Use semver patch increments (`0.0.3` -> `0.0.4`) for routine releases.

## 5) Validate locally

- Run:
  - `npm run build`
- Ensure build completes without runtime errors.

## 6) Push and trigger CI

- Push `master`/`main` to trigger:
  - `Vercel Deploy`
  - `Render Health Check`
- Create and push release tag to trigger:
  - `Desktop Publish` (creates GitHub release assets + `latest.yml`)

Example:

```powershell
git push origin master
git tag v0.0.4
git push origin v0.0.4
```

## 7) Verify GitHub release

- Confirm release tag exists and is published.
- Confirm assets include:
  - `AetherStudio-<version>-x64.exe`
  - `AetherStudio-<version>-x64.exe.blockmap`
  - `latest.yml`

## 8) Post-release smoke test

- Install latest `.exe` on clean machine.
- Launch app and verify:
  - Relay shows online.
  - AI panel is available.
  - `Check Updates` button is visible.
- **Cloud-first desktop**: confirm no local relay/peer child processes are spawned in packaged mode (check Task Manager / `relay.desktop.out.log`).
- **Firebase bypass**: with missing Firebase env vars, desktop opens Studio directly; web still shows the "Missing Firebase Config" blocker.
- **Image stress test**: add 5+ large image layers rapidly; verify UI remains responsive and no panel lock/stutter.
- **Multi-camera stress test**: connect 4+ cameras; verify extra inputs beyond composition cap stay connected but UI remains stable.
- **Relay fatal recovery test**: force relay disconnect; verify fatal toast shows clear reason, attempt count, and recovery guidance.

## 9) Security hygiene

- If any token/key is exposed in logs/chat/screenshots:
  - Rotate immediately.
  - Update envs/secrets.
  - Redeploy.
