# AGENTS.md

Guidance for any AI coding agent (Claude Code, Codex, Cursor, etc.) working in this repository.

## Project

**Attendence-Hos** is a web app for taking attendance. A student can mark attendance only when **all three** checks pass:

1. **Approved phone number**: the student is registered by an admin, and their identity is tied to that phone number.
2. **Building internet only**: the request must come from the building's network (Wi-Fi/LAN), not mobile data.
3. **Live selfie**: a photo taken in the moment with the device camera, stored with the attendance record.

Two sides:

- **Admin**: manage students (name, phone, guardian phone, photo, ID card upload), view attendance and selfies.
- **User (student)**: log in, take a selfie, mark attendance.

## Status

Phase 1 plus verified selfie attendance (2026-10-20) is built and tested locally: unit tests, DB integration tests, real-engine face tests, and browser runs against a throwaway Postgres. Face matching is self-hosted (face-api); no paid API.

## Non-negotiable rules

These hold whatever stack is chosen.

- **Every check runs on the server.** The client may pre-check for user experience (UX), but the server alone decides whether attendance is accepted. Never trust a client-sent flag like `onWifi: true` or `phoneVerified: true`.
- **Network check = the request's source IP.** A browser cannot tell Wi-Fi from mobile data, so the server compares the request's public IP against an admin-managed allowlist of the building's IPs or ranges. Read the client IP correctly behind proxies (trust `X-Forwarded-For` only from known proxies).
- **A website cannot read a phone's SIM number.** "Approved phone number" means the student logs in with a phone number that an admin registered, and proves ownership (OTP or admin-issued credentials, plus device binding, as decided in the plan).
- **Self-marking requires a verified attempt.** The browser sends only a single-use token and the captured image; the **server** decodes it, runs face-api, and compares the descriptor 1:1 with the student's active registration. Never accept a client-computed descriptor, score or success flag, never run matching in the browser, and never bypass verification when the engine is unavailable; block and point to staff marking instead.
- **Three counted tries per student per occurrence.** Only biometric rejections (no face, several faces, poor quality, mismatch) count. Technical failures, invalid files, cancellations and expired tokens must never count.
- Face matching is **not** liveness or proof of presence; don't describe it as such in UI or docs.
- **Face registrations change only through admin actions** (photo upload / re-check), as new versions. The attendance flow never alters a reference.
- **Store each attendance record with its evidence**: student ID, server timestamp, source IP, selfie file reference, device identifier, and result (accepted or rejected, plus the reason).
- **Rejected attempts are logged too**, so an admin can spot abuse.

## Privacy & security

This app stores sensitive personal data: ID cards, faces, phone numbers, and likely minors' data.

- Uploaded files (photos, ID cards, selfies) are **private**. Never put them in a public bucket or at a guessable URL. Serve them only to authenticated admins, through signed or short-lived URLs or an authenticated endpoint.
- Admin routes require admin authentication and authorization on the **server**, not just hidden UI.
- Validate uploads: allowlist image/PDF types, cap the size, and generate the stored filenames yourself (never use the user's filename).
- Never log OTPs, passwords, tokens, or full ID-card data.
- Secrets go in environment variables, never in the repo. Keep `.env.example` up to date.

## Conventions

- Keep phase 1 small. Do not add features beyond the approved plan without asking.
- Mobile first: students use phones. Admin pages must also work on a laptop.
- Phone numbers are stored in E.164 format (e.g. `+923001234567`) and must be unique per student. Local input defaults to Pakistan (`0300 1234567`).
- All times come from `src/lib/timezone.ts` (`BUILDING_TIME_ZONE`, `buildingFormat`). Never hard-code an offset or a zone in components.
- Every schema change goes through a migration. No manual database edits.
- Write tests for the attendance-acceptance logic (IP allowlist, phone/device checks, time windows). That is the core of the product.

## Decisions (agreed 2026-10-19)

- [x] **Stack/hosting**: Next.js (App Router, TypeScript) on **Vercel**, with a **Neon** Postgres database (created through the Vercel integration) and **Cloudinary** for files.
- [x] **Auth**: custom, inside the app (no auth provider). Passwords are hashed with bcrypt/argon2. Sessions use httpOnly, secure cookies. Admins and students are separate roles.
- [x] **File storage (Cloudinary)**: every upload uses `type: "authenticated"`, **never** the default public `upload` type. Files are never linked directly. The browser loads them from our admin-only `/api/media/...` routes, which check the admin session, fetch the asset server-side with a signed Cloudinary URL, and stream it back. Signed URLs do not expire, so they must never be sent to the browser. Uploads are signed server-side, and the API secret never reaches the browser. "Allow delivery of PDF and ZIP files" must be enabled in Cloudinary security settings for ID-card PDFs.
- [x] **Selfie retention**: selfie files are deleted **90 days** after capture by a scheduled job (Vercel Cron). The attendance record itself is kept forever, with its selfie marked as expired. Student photos and ID cards are kept while the student exists.
- [x] **Phone verification**: the admin sets each student's password, and the student logs in with phone number + password. The first device they log in from is **bound** to the account. Logins from other devices are refused until an admin resets the binding. No SMS in phase 1.
- [x] **Network**: the building has a **static public IP**. The admin manages the allowlist in Settings.
- [x] **Location** (2026-10-20): the hostel is in **Pakistan**. Building time zone `Asia/Karachi` (env `NEXT_PUBLIC_BUILDING_TIMEZONE`), phones default to +92. An earlier version wrongly assumed India (IST).
- [x] **Schedule**: three fixed sessions covering the whole day, editable by the admin. Times are wall-clock times in the building zone:
  - Session 1: 08:00–14:30
  - Session 2: 14:30–21:00
  - Session 3: 21:00–08:00 next day. **It crosses midnight**: an attempt at 02:00 belongs to the session that started at 21:00 the *previous* date. Store a `session_date` = the date the session started.
  - Sessions must not overlap. Validate this when the admin edits them.
  - One accepted record per student, per session, per `session_date`.
- [x] **Late marking**: allowed. A mark made within the **grace period** (admin setting, default 30 min) from the session start is `on_time`; anything later in the session is `late`. A student who never marks is `absent`. A session can be marked only while it is open.
- [x] **Passwords**: only an admin sets or resets a student's password. Students cannot change it.
- [x] **ID card**: image (JPG/PNG/WebP) **or** PDF accepted.
- [x] **Face verification** (2026-10-20, replaces the brief AWS Rekognition design): **self-hosted face-api** (`@vladmandic/face-api` 1.7.15, the maintained fork of face-api.js; MIT) on TensorFlow.js' WASM backend, server-side. SSD MobileNet v1 + 68 landmarks + 128-d recognition. Env thresholds `FACE_MATCH_MAX_DISTANCE` (default 0.5, 0.3–0.6) and `FACE_MIN_DETECTION_SCORE` (default 0.8, 0.5–0.99). No liveness detection. Students give versioned biometric consent (notice v2).
- [x] **Staff corrections** (2026-10-20): admins can mark Present (on time/late) or Absent for a started occurrence with a required reason; every change is stored in `attendance_corrections` (actor, reason, previous, next, time). Self-mark evidence is never deleted.
- [x] **Leave**: not now. **Buildings**: one.
- [x] **Guardian alerts**: not in phase 1. The guardian phone number is stored only.
- [x] **Scale**: under 200 students, 1–2 admins, one building.
- [x] **Language**: English only.

## Phase 1 scope

**Admin**
- Admin login (admins are created by seed/script; there is no public sign-up)
- Students: add, edit, deactivate, search. Fields: name, phone, guardian phone, photo, ID card (image/PDF), password. Includes a "Reset device" action.
- Settings: allowed IPs, attendance sessions (name, start time, end time), and the late grace period in minutes
- Dashboard: per session per day, each student's status (on time, late or absent). Each record shows the selfie next to the registered photo, the time and the IP. Rejected attempts show their reason.
- History by date or student, with CSV export

**Student**
- Log in with phone number + password (device bound on first login)
- Mark attendance: shows the current session, takes a live front-camera selfie, and submits
- Clear result messages: marked on time, marked late, not on building Wi-Fi, already marked for this session, device not recognised

**Out of scope for now:** leave requests, guardian SMS/WhatsApp, multiple buildings, Urdu/Hindi, native app.

## Commands

```bash
npm run dev          # local dev server (http://localhost:3000)
npm run setup        # apply migrations, seed default sessions, create the first admin (safe to re-run)
npm test             # unit tests (Node test runner via tsx); list new test files in the script
npm run typecheck    # next typegen + tsc
npm run lint
npm run build
npm run db:generate  # after editing src/db/schema.ts: writes a new SQL migration to drizzle/
```

Env vars: `.env.example` is the committed template and holds **no values**. Real values go in `.env.local` (git-ignored) and in the Vercel project settings.

## Codebase map

- `src/lib/attempts.ts`: **the only way a student marks attendance.** `startAttempt` (eligibility → single-use token, 5-min TTL; never counts) → browser capture → `submitAttempt` (atomic claim under a per-student row lock: ownership, expiry, single use, no other check in flight, < 3 counted failures → re-check eligibility → server face analysis → quality checks → 1:1 distance vs the active registration → private upload → transaction insert guarded by the unique (student, session, session_date) index). External work never runs inside a DB transaction. Dependencies (engine, storage, clock) are injected; test doubles exist only in tests.
- `src/lib/face-engine.ts` (face-api on WASM: image decode/validation with sharp, detection, descriptors, metadata-free JPEG), `src/lib/face.ts` (config status + thresholds), `src/lib/face-policy.ts` (pure rules), `src/lib/enrollment.ts` (versioned registrations; descriptor + model id, server-only), `src/lib/consent.ts`, `src/lib/corrections.ts` (audited staff changes), `src/lib/throttle.ts` (login lockout).
- Deployment: `next.config.ts` lists face-api/tfjs/sharp in `serverExternalPackages` and traces the model + `.wasm` files with `outputFileTracingIncludes`. If you add a route that analyses faces, add it there.
- `src/lib/attendance.ts`: read-only "today" status for the student page.
- `src/lib/timezone.ts` + `src/lib/schedule.ts`: building-zone wall clock ↔ instants (DST-safe), overnight sessions, grace period, overlap check. Tested in `schedule.test.ts` / `timezone.test.ts`.
- Absence is **derived** (closed occurrence + no Present record), so there is no closure job to race with self-marks; writes are refused after the occurrence ends.
- `src/lib/ip.ts`: allowlist matching (IPv4, IPv6, CIDR; rejects shorthands like `1.2.3`). `src/lib/request-ip.ts` reads `x-real-ip` / `x-forwarded-for`. These are only trustworthy because Vercel sets them. Revisit this if hosting changes.
- `src/lib/auth.ts`: DB-backed sessions (the cookie holds a random token; the DB stores its SHA-256). A student session is valid only with an active account **and** the bound device cookie (`ah_device`). Call `requireAdmin` / `requireStudent` (or `getAdmin` / `getStudent`) in every page, Server Action and Route Handler. `src/proxy.ts` is only an optimistic redirect.
- `src/lib/reports.ts`: builds the register (on_time / late / absent / pending) used by the dashboard, history and CSV export. A student is expected in every session that had not ended when they were added.
- `src/lib/cloudinary.ts`, `src/lib/media.ts`, `src/app/api/media/**`: private file storage and admin-only delivery.
- `src/app/api/cron/purge-selfies`: daily Vercel Cron (`vercel.json`), protected by `CRON_SECRET`.
- `src/db/schema.ts` + `drizzle/`: schema and generated migrations. `scripts/setup.ts`: setup and seeding.

## Next.js 16 gotchas hit in this repo

- Cache Components is on. Anything that reads cookies, headers or the DB goes inside `<Suspense>`: each page is a static shell plus an async content component.
- `new Date()` during a prerender is an error. `sessionTokenHash` in `src/lib/auth.ts` calls `connection()` first, so all session-dependent code runs at request time.
- The Server Actions body limit is raised to 4 MB in `next.config.ts` (Vercel caps requests at 4.5 MB). Images are compressed in the browser before upload.
- To dispatch a `useActionState` action after an `await`, wrap the dispatch in a fresh `startTransition`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
