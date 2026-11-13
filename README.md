# 2ELAGPT V1
**Your intelligence. Without limits.**

A React + Capacitor AI assistant with a custom Cloudflare Worker API. Supabase has been removed.

## Architecture
- Android/web app: React + Vite + Capacitor
- API: Cloudflare Worker in `worker/src/index.js`
- Primary model: Gemini 2.5 Flash
- Fallback: OpenRouter `openrouter/free`
- Streaming: Server-Sent Events
- Chat history: stored locally on the device/browser
- Coding mode: specialist programming system prompt

## 1. Deploy the custom API
1. Create a Cloudflare account and install Wrangler: `npm install`.
2. From the repository root run `npx wrangler login`.
3. Add provider keys as Worker secrets (never commit them):
   ```sh
   npx wrangler secret put GEMINI_API_KEY
   npx wrangler secret put OPENROUTER_API_KEY
   ```
   Add at least one provider key. Gemini is used first in Auto mode; OpenRouter is the fallback when Gemini returns an HTTP error.
4. Deploy:
   ```sh
   npx wrangler deploy
   ```
5. Copy the Worker URL, usually `https://2elagpt-api.<your-subdomain>.workers.dev`.

Free-tier access, model availability, quotas, and pricing can change. Check each provider dashboard before use. The API gateway itself does not create free model inference.

## 2. Connect the Android app
Open 2ELAGPT > API setup and paste the Worker URL. The app saves it on the device. Do not paste provider keys into the app.

## 3. Build the APK
Every push to `main` builds an Android debug APK in GitHub Actions. Open the latest successful run:
https://github.com/cr07thegoat2025-cloud/2ELAGPT/actions
Download the `2ELAGPT-Android-APK` artifact and extract the APK from the ZIP.

## API contract
`POST /chat`, JSON body:
```json
{ "model": "auto", "mode": "coding", "messages": [{ "role": "user", "content": "Hello 2ELAGPT" }] }
```
Supported model choices: `auto`, `gemini-2.5-flash`, `openrouter/free`. Response is SSE with OpenAI-style `choices[0].delta.content` chunks.

## Security and limitations
- Provider keys are stored as Cloudflare Worker secrets and are not bundled into the app.
- The Worker endpoint is public and this starter version has no account-based authentication or persistent cross-device chat sync. Add Cloudflare rate limiting/abuse protection before public release.
- Chat history is local to each device/browser.
- Do not commit API keys, tokens, or local environment files.
