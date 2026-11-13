# 2ELAGPT V1
**Your intelligence. Without limits.**

A responsive React chat app with a custom Supabase Edge Function API, Gemini primary routing, OpenRouter fallback, streaming responses, Supabase Auth, chat history, and row-level security.

## Stack
- React + Vite frontend
- Supabase Auth, Postgres and Edge Functions
- Gemini 2.5 Flash primary
- OpenRouter `openrouter/free` fallback
- Server-side provider secrets (never ship provider keys to the browser)

## Setup
1. Create a Supabase project at https://supabase.com.
2. In Supabase SQL Editor, run `supabase/migrations/001_init.sql`.
3. In Authentication > Providers, enable Email. Configure email confirmation as desired.
4. Copy `.env.example` to `.env.local`, then set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
5. Install the Supabase CLI, log in, link your project, then deploy:
   ```sh
   supabase link --project-ref YOUR_PROJECT_REF
   supabase functions deploy chat
   supabase secrets set GEMINI_API_KEY=your_gemini_key OPENROUTER_API_KEY=your_openrouter_key
   ```
   Add at least one provider key. Gemini is tried first in Auto mode; OpenRouter is the fallback.
6. Run locally:
   ```sh
   npm install
   npm run dev
   ```

## API
Endpoint: `POST https://YOUR_PROJECT.supabase.co/functions/v1/chat`

Headers: `Authorization: Bearer USER_ACCESS_TOKEN`, `apikey: SUPABASE_ANON_KEY`, `Content-Type: application/json`

Body:
```json
{ "model": "auto", "messages": [{ "role": "user", "content": "Hello 2ELAGPT" }] }
```
Models: `auto`, `gemini-2.5-flash`, `openrouter/free`. Response is Server-Sent Events using OpenAI-style `choices[0].delta.content` chunks.

## Security notes
- Provider API keys belong only in Supabase Edge Function secrets.
- Never commit `.env.local`, provider keys, service-role keys, or access tokens.
- The hosted chat endpoint requires a signed-in Supabase user.
- The current rate limit is a starter per-user limit; production deployment should add atomic rate limiting and abuse monitoring.
- Free provider availability, quotas, and model IDs can change. Check provider dashboards before relying on them.

## GitHub Actions
Every push to `main` runs the production Vite build and uploads `dist/` as the `2ELAGPT-web-v1` artifact. The workflow verifies frontend compilation; Supabase setup/deployment is a separate step.
