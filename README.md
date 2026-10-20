# Attendence-Hos

Hostel attendance web app (Pakistan, `Asia/Karachi`). A student can mark their own attendance only:

- from their **registered phone number** (password set by the admin, account locked to one phone),
- while connected to the **hostel Wi-Fi** (checked by the building's public IP, not mobile data),
- with a **selfie that matches their registered photo**, checked on the server (3 tries per session).

Admins add students (name, phone, guardian phone, photo, ID card), manage the building IP and session times, review attendance with selfies beside registered photos, correct attendance with an audit trail, and export CSVs.

Built with Next.js 16 · Neon Postgres · Cloudinary · face-api (self-hosted, free) · Vercel.

## Setup

1. **Install:** `npm install`
2. **Keys:** fill in `.env.local` (the template is `.env.example`; never put real values in the template).
   - `DATABASE_URL`: Neon → your project → **Connect** → pooled connection string
   - `CLOUDINARY_*`: Cloudinary console → **Settings → API Keys**
   - In Cloudinary, turn on **Settings → Security → "Allow delivery of PDF and ZIP files"** (needed for PDF ID cards)
   - `NEXT_PUBLIC_BUILDING_TIMEZONE`: `Asia/Karachi`
   - `CRON_SECRET`: any long random string
   - `INITIAL_ADMIN_*`: the first admin's name, username and password (10+ characters)
3. **Create/upgrade tables and the first admin:** `npm run setup` (safe to re-run; run it after every update)
4. **Run locally:** `npm run dev`, then open
   - Admin: http://localhost:3000/admin
   - Student: http://localhost:3000/login
5. **In the app:** Settings → add the building's IP. Then Students → add each student with a clear, front-facing photo (the app refuses photos without exactly one clear face).

> Phones need **HTTPS** for the camera, so test the phone flow on the Vercel deployment, not on a `http://192.168…` address.

## Face verification

- Runs on the server with [`@vladmandic/face-api`](https://github.com/vladmandic/face-api) (the maintained fork of face-api.js, MIT) on TensorFlow.js' WebAssembly backend. No account, key or paid API. Model files ship inside the npm package and are deployed with the app.
- Each student gets **3 counted tries per session**. Only face rejections count (no face, several faces, poor quality, not matching). Technical errors, cancelled or retaken shots and wrong-network refusals don't. After 3, the student is asked to see the warden, who reviews the attempts and records the result on the **Correct** page (logged with name, reason and time).
- Optional tuning: `FACE_MATCH_MAX_DISTANCE` (default `0.5`; lower = stricter) and `FACE_MIN_DETECTION_SCORE` (default `0.8`).
- **Limits:** this is face *matching*, not liveness detection. It can't tell a live person from a good photo of them, and the Wi-Fi check doesn't prove physical presence. Use spot checks and the review page.

## Deploy (Vercel)

1. Push to GitHub and import the repo in Vercel (Framework: Next.js; defaults are fine).
2. Project → Settings → Environment Variables: add `DATABASE_URL`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CRON_SECRET`, `NEXT_PUBLIC_BUILDING_TIMEZONE` (not the `INITIAL_ADMIN_*` ones).
3. Run `npm run setup` against the production database after each update that adds migrations (locally, with the same `DATABASE_URL`).
4. Deploy. On the live site, open **Settings** from the hostel Wi-Fi and add the building IP shown there.
5. The daily job in `vercel.json` deletes selfies after 90 days and cleans up unfinished attempts.

## Development

See [AGENTS.md](AGENTS.md) for rules, commands and a map of the code. `npm test` runs unit tests, real face-engine tests and database integration tests (in-memory Postgres; no setup needed).
