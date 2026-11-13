# 2ELAGPT V1
**Your intelligence. Without limits.**

A React + Capacitor AI assistant with a Vercel serverless API. Supabase and Cloudflare are not required.

## Architecture
- Android/web app: React + Vite + Capacitor
- API: Vercel Node.js Function at `/api/chat`
- AI provider: OpenRouter (uses the `openrouter/free` router by default)
- Streaming: Server-Sent Events
- Chat history: stored locally on the device/browser
- Coding mode: specialist programming system prompt

## 1. Deploy to Vercel
1. Sign in at https://vercel.com using GitHub.
2. Import `cr07thegoat2025-cloud/2ELAGPT`.
3. Keep the default project settings. Vercel should detect the Vite app and use the repository's `vercel.json`.
4. In the Vercel project, open **Settings → Environment Variables**.
5. Add:
   - Name: `OPENROUTER_API_KEY`
   - Value: your OpenRouter API key
   - Environments: Production, Preview, and Development (or at least Production)
6. Save the variable, then redeploy from **Deployments → Redeploy** (or push a new commit).
7. Test `https://YOUR-PROJECT.vercel.app/api/chat` with a POST request. A GET request may return a method-not-allowed response; that is expected.

Never commit the API key or put it in the Android app. If a key was ever pasted into a public repo or chat, rotate it in OpenRouter.

## 2. Connect the Android app
Open 2ELAGPT → API setup and paste only the Vercel project URL, e.g. `https://your-project.vercel.app`. Do not paste the OpenRouter key into the app.

## 3. Build the APK
Every push to `main` builds an Android debug APK in GitHub Actions. Open:
https://github.com/cr07thegoat2025-cloud/2ELAGPT/actions
Download the `2ELAGPT-Android-APK` artifact and extract the APK from its ZIP.

## API contract
`POST /api/chat`, JSON body:
```json
{ "model": "openrouter/free", "mode": "coding", "messages": [{ "role": "user", "content": "Hello 2ELAGPT" }] }
```
Response is SSE with OpenAI-style `choices[0].delta.content` chunks.

## Security and limitations
- The OpenRouter key is read only from the Vercel server environment variable `OPENROUTER_API_KEY`; it is never bundled into the APK.
- The API route is publicly reachable. Add Vercel protection/rate limits or authentication before a broad public launch to prevent abuse.
- OpenRouter's free-model availability, quotas, rate limits, and model routing can change. A free router does not guarantee uninterrupted free inference.
- Chat history is local to each device/browser; there is no account sync.
