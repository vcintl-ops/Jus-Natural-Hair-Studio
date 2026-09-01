# Jus Natural Hair Studio — staff app

A real, database-backed version of the salon staff app: appointments, clients,
staff & payroll, services & products, reports, and promotions.

## Setup (see the full guide from Claude for click-by-click steps)

1. Create a free project at supabase.com.
2. In the Supabase SQL Editor, run `supabase-schema.sql` (edit the placeholder
   owner email near the bottom first).
3. In Supabase, go to Authentication → Providers → Email and turn OFF
   "Confirm email" (so new staff can sign in immediately after accepting an
   invite).
4. Copy your Supabase Project URL and anon public key
   (Project Settings → API).
5. Push this folder to a new GitHub repository.
6. Import that repository into a new Vercel project.
7. In Vercel → Project Settings → Environment Variables, add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
8. Deploy. Open the live URL, click "Have an invite code?", and use the
   code `WELCOME1` with the owner email you set in step 2 to create your
   first real login.

## Local development (optional, requires Node.js installed)

```
npm install
npm run dev
```
