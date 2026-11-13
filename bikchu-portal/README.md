# BIKCHU Client Portal

A separate Vercel project inside this repository. In Vercel, import this repository and set **Root Directory** to `bikchu-portal`.

## Required environment variables

- `POSTGRES_URL`: supplied by your connected Vercel Postgres/Neon-compatible database integration.
- `ADMIN_PASSWORD`: a long, unique admin password. Do not reuse a personal password.
- `OPENROUTER_API_KEY`: your OpenRouter key (needed for AI project planning).

After connecting the database and setting environment variables, redeploy.

## What works

- Public client project-request form.
- Requests stored in Postgres.
- Private admin dashboard with password-protected request listing.
- Admin-only AI project brief and suggested quote using OpenRouter.
- Quotes are suggestions only; the owner reviews and sends them manually.

## Important

This first version does not automatically email clients, accept payments, or deliver apps. Do not advertise those features until a proper email/payment/delivery workflow is implemented and tested. Keep client data private and only collect what is needed.
