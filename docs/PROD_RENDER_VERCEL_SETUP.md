# Production Setup: Render + Vercel

Use this exact order:

1. Deploy relay on Render.
2. Verify relay health endpoints.
3. Deploy frontend on Vercel with matching relay values.

## 1) Render (aether-relay)

Service settings:

- Type: `Web Service`
- Root Directory: `aether-relay`
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`
- Region: same region as your main users

Environment variables:

- `RELAY_TOKEN` = strong random token (must match Vercel `VITE_RELAY_TOKEN`)
- `RTMP_URL_PRIMARY` = `rtmps://a.rtmp.youtube.com/live2`
- `RTMP_URL_FALLBACK` = `rtmp://a.rtmp.youtube.com/live2`
- `GEMINI_API_KEY` = your Gemini key (required for AI endpoints)
- `LICENSE_SECRET` = required if license APIs are used
- `LICENSE_ADMIN_TOKEN` = required to issue licenses

Validate after deploy:

- `https://<your-relay-host>/health` should return `ok: true`
- `https://<your-relay-host>/ffmpeg` should return `ok: true`
- `https://<your-relay-host>/ai/health` should return `ok: true` when `GEMINI_API_KEY` is set

## 2) Vercel (frontend)

Project settings:

- Framework: `Vite`
- Install Command: `npm install`
- Build Command: `npm run build`
- Output Directory: `dist`

Required production env vars:

- `VITE_MOBILE_BASE_URL=https://aetherstudio-zip.vercel.app`
- `VITE_PEER_HOST=aether-peerjs-server.onrender.com`
- `VITE_PEER_PORT=443`
- `VITE_PEER_SECURE=true`
- `VITE_PEER_PATH=/peerjs`
- `VITE_SIGNAL_URL=wss://<your-relay-host>`
- `VITE_RELAY_TOKEN=<same as Render RELAY_TOKEN>`
- `VITE_AI_BASE_URL=https://<your-relay-host>`
- `VITE_USE_RELAY_FOR_MOBILE=false`
- `VITE_DESKTOP_DOWNLOAD_URL=https://github.com/Coolzymccooy/aetherstudio-zip/releases/latest`

Important:

- If your Vercel dashboard has an old value with `Coolzymccoy`, replace it with `Coolzymccooy`.
- Redeploy after saving env vars.

## 3) Final verification

On the deployed Vercel URL:

1. Landing page loads without error overlay.
2. `Download Desktop App` button is visible.
3. Download link opens GitHub Releases page.
4. Studio can connect to relay (`Relay` shows online in studio).
