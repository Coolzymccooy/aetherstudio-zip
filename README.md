<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

## Run Locally

**Prerequisites:**  Node.js

1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run frontend only:
   `npm run dev`
4. Run full local stack (frontend + relay + peer server):
   `npm run dev:all`

## Relay Operations

- Active relay implementation: `aether-relay/server.js`
- Compatibility shim only: `server/signaling.cjs` (deprecated)
- Operations guide: `docs/RELAY_OPERATIONS.md`
- Production setup guide (Render + Vercel): `docs/PROD_RENDER_VERCEL_SETUP.md`
