# Deployment

Socrates AI deploys to **Railway** (Node + managed Postgres). Earlier R&D ran on Replit; that
path is gone. This document covers the env var surface, migration order, the local first-run
steps, and the Railway production checklist.

## Environment variables

All read at boot. `.env.example` is the authoritative template at repo root.

### Required

| Variable | Where | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | server | Postgres connection string. Drizzle uses it directly. On Railway this is auto-injected by the Postgres plugin. |
| `SESSION_SECRET` | server | 32+ hex/base64 chars. Boot fails in production if shorter. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `OPENAI_API_KEY` | server | OpenAI. Used by services/openai.ts. |
| `PORT` | server | Defaults to `5000` in `server/index.ts`. Railway auto-injects `PORT` — do not set manually. Local dev uses `4000` per `.env.example`. |
| `CORS_ORIGIN` | server | Required in production. Comma-separated allow-list. Boot fails if unset when `NODE_ENV=production`. Dev lets everything through. |

### Required if using real-time voice

| Variable | Purpose |
| --- | --- |
| `GOOGLE_AI_API_KEY` | Google Generative AI key for Gemini Live. Read directly by `server/services/gemini-live.ts`. |
| `FEATURE_AI_PRACTICE_REAL` | Set to `1` to enable real-time voice routes. When unset, the AI Practice flows fall back / 503. |

### Optional — email (community library invites and password reset)

| Variable | Default | Notes |
| --- | --- | --- |
| `RESEND_API_KEY` | unset | If unset, invite email is skipped and the owner gets a copy-link fallback. Password reset emails silently fail when unset — acceptable in dev, required in prod. |
| `EMAIL_FROM` | `Socrates AI <noreply@socratesai.app>` | Sender identity for all outgoing mail. |
| `APP_URL` | `http://localhost:4000` | Used to build invite and reset URLs. Must match the public origin in production. |

### Optional — cost and safety

| Variable | Default | Notes |
| --- | --- | --- |
| `AI_DAILY_SPEND_CAP_USD` | `5` | Per-user daily AI spend cap. Lowering is safe; raising expands risk. |
| `DEBUG_ERRORS` | unset | When `1`, 500 responses include the underlying message. Leave unset in prod. |

### Dev / test only

| Variable | Behavior | Production behavior |
| --- | --- | --- |
| `RATE_LIMIT_DISABLED` | When `1` and `NODE_ENV !== "production"`, skips `authLimiter`, `generalLimiter`, `reportLimiter` for Playwright tests. | Ignored. |

### Deprecated

| Variable | Replacement |
| --- | --- |
| `ADMIN_EMAILS` | Removed as a privilege-escalation vector on DB resets. Admins must now be promoted with explicit SQL. See below. |

## First-run checklist (local dev)

Assumes macOS or Linux with Node 20+, pnpm or npm, and a local Postgres reachable at the URL
in `.env`.

```bash
# 1. Clone and install
git clone <repo>
cd SocratesAI
npm install

# 2. Copy the env template and fill in secrets
cp .env.example .env
# Edit .env — set at minimum DATABASE_URL, SESSION_SECRET, OPENAI_API_KEY.

# 3. Create the database
createdb socrates_ai

# 4. Apply the Drizzle schema (also runs migrations sequentially if the tool requires it)
npm run db:push

# 5. Apply community-library migration 0008's admin seed (one-off)
psql socrates_ai -f migrations/0008_community_library.sql   # if not already applied
# Or promote yourself manually:
psql socrates_ai -c "UPDATE users SET is_admin=true WHERE email='you@example.com';"

# 6. Start the dev server
npm run dev        # tsx with --env-file=.env — Vite middleware + Express on PORT

# 7. Visit http://localhost:4000 (or whatever PORT you set) and register.
```

Note on `db:push` vs migrations: Drizzle's `push` syncs the schema in `shared/schema.ts` to
the database. Migrations in `migrations/` are historical reference and hand-authored SQL for
things that `push` cannot infer (data backfills, renames, seed inserts). In this project we
use `db:push` as the primary path and apply individual migration files only when they contain
data changes.

## Migration order

Applied sequentially. Do not skip.

| # | File | What it does |
| --- | --- | --- |
| 0001 | `0001_premium_overhaul.sql` | Baseline schema — users, stations, sections, items, sessions, item_results, ai_costs. |
| 0003 | `0003_mock_exams.sql` | Adds `mock_exams` template table and wires `sessions.mock_exam_id`. |
| 0004 | `0004_station_reference_image.sql` | Station-level reference image URL. |
| 0005 | `0005_section_media_and_item_media.sql` | Media columns on sections and the `item_media` join table. |
| 0006 | `0006_mock_exam_practice_mode.sql` | Adds `practice_mode` enum on templates. |
| 0007 | `0007_mock_exam_attempts.sql` | Introduces `mock_exam_attempts` with unique `(user_id, mock_exam_id, attempt_number)`. Splits template from run. |
| 0008 | `0008_community_library.sql` | Adds `visibility` enums on stations and collections; collection roles; invites; stars; reports; `is_admin` flag on users; seeds founder admin. |
| 0009 | `0009_fork_of_fk.sql` | Backfills `fork_of` foreign key on stations for attribution. |
| 0010 | `0010_qa_stations.sql` | Adds `qa` to `station_type` enum; relaxes required-field constraints for QA-only stations. |
| 0011 | `0011_ai_costs_user_id.sql` | Adds `user_id` to `ai_costs` with index; enables the per-user daily spend cap. |
| 0012 | `0012_password_resets.sql` | `password_resets` table with indexes on `user_id` and `expires_at`. |

Missing number 0002 is intentional — it was rolled into 0001 during early development.

## Production deploy — Railway

The production target is Railway. The app builds via Nixpacks (auto-detected from
`package.json`) and runs `npm run start`, which serves both the API and the bundled web
client from a single Node process. WebSocket upgrades for `/api/gemini/ws/:sid` work over
Railway's edge.

### One-time setup

```bash
# From the repo root.
railway login                       # interactive — opens browser
railway init                        # create a new project (or `railway link` to attach)
railway add --plugin postgresql     # provisions Postgres; auto-injects DATABASE_URL
```

### Environment variables

Set on the Railway service (NOT on the Postgres plugin). Use the dashboard or CLI:

```bash
railway variables --set NODE_ENV=production \
  --set SESSION_SECRET="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')" \
  --set OPENAI_API_KEY=sk-... \
  --set GOOGLE_AI_API_KEY=... \
  --set FEATURE_AI_PRACTICE_REAL=1 \
  --set CORS_ORIGIN=https://your-app.up.railway.app \
  --set APP_URL=https://your-app.up.railway.app \
  --set RESEND_API_KEY=re_... \
  --set EMAIL_FROM='Socrates AI <noreply@yourdomain>' \
  --set AI_DAILY_SPEND_CAP_USD=5
```

`PORT` is auto-injected by Railway. Do not set it.

### Migrations

Run after the first deploy provisions the database:

```bash
# Pull the Railway DATABASE_URL into your shell, then:
railway run npm run db:push
```

For data-bearing migrations (0008 admin seed, 0009 fork-of FK, 0011 ai_costs user_id), apply
the corresponding SQL files manually if `db:push` does not pick them up:

```bash
railway run psql "$DATABASE_URL" -f migrations/0008_community_library.sql
```

### Persistent storage

`uploads/items/` is **on-disk** and not in the database. On Railway, attach a volume mounted
at the project's `uploads/` directory or migrate to object storage before launch (see "Static
uploads" below). A redeploy without a mounted volume will drop every uploaded image.

### Generic checklist

For any Node host (Railway, Render, Fly, DIY VPS) the production-deploy contract is the
same:

### Process

1. Build client + server:
   ```bash
   npm run build
   ```
   This runs `vite build` (outputs `dist/public`) and `esbuild` on the server (outputs
   `dist/index.js`).
2. Start:
   ```bash
   NODE_ENV=production node dist/index.js
   ```
3. Put a reverse proxy (nginx / Caddy / your platform's ingress) in front that:
   - Terminates TLS.
   - Forwards to the Node process.
   - Upgrades WebSocket connections at `/api/gemini/ws/:sid`.
   - Sets `X-Forwarded-For` correctly so the rate-limit IP fallback works.

### Checklist before going live

- [ ] `NODE_ENV=production`.
- [ ] `SESSION_SECRET` is 32+ random hex characters.
- [ ] `DATABASE_URL` points at a managed Postgres (not a local container).
- [ ] `CORS_ORIGIN` is set to the exact public origin (no wildcards).
- [ ] `OPENAI_API_KEY` is the production key, not the dev key.
- [ ] `GOOGLE_AI_API_KEY` is set only if `FEATURE_AI_PRACTICE_REAL=1`.
- [ ] `APP_URL` matches the public origin (used in invite and password-reset URLs).
- [ ] `RESEND_API_KEY` and `EMAIL_FROM` are set (password reset needs email delivery).
- [ ] `AI_DAILY_SPEND_CAP_USD` is set — default $5 is fine to start.
- [ ] `DEBUG_ERRORS` is unset.
- [ ] `RATE_LIMIT_DISABLED` is unset (it is hard-ignored in production but set an expectation
  in your deploy).
- [ ] Migrations applied up to and including `0012`.
- [ ] Founder account is seeded and flagged `is_admin=true` via the 0008 migration. Any
  additional admins promoted with explicit SQL.
- [ ] Static uploads directory (`uploads/items/`) is on a persistent volume. It is not in the
  database. Disk quota is enforced to 500 MB by the upload route, but your host should also
  provision at least 1 GB to be safe.
- [ ] TLS is terminated before Node and `Strict-Transport-Security` reaches the browser.
- [ ] Backups of Postgres are scheduled (daily minimum for v1).
- [ ] Sentry / equivalent error tracking is wired — currently the project logs to stdout and
  relies on the host's log aggregation.

### Logs

- Server writes structured-ish `console.log` / `console.error`. Expect your host's log
  aggregator to pick these up.
- Request log line includes method, path, status, latency, and user id when authenticated.
- Password, tokens, and raw audio are never logged.
- `console.error` is always called on unhandled errors, even when the response body is
  stripped in production.

## Admin promotion

The only supported path in production:

```sql
UPDATE users SET is_admin = true WHERE email = 'someone@example.com';
```

Admin demotion:

```sql
UPDATE users SET is_admin = false WHERE email = 'someone@example.com';
```

There is no UI to promote / demote. This is intentional (see
`Documentation/SECURITY.md` → "Admin model").

## Static uploads

- Directory: `uploads/items/` relative to the server process.
- Served at `/uploads/items/` by `server/index.ts` via `express.static`.
- In production, put this directory on a persistent volume. A container restart that drops
  the volume will break every item-media URL in the database.
- Consider migrating to object storage (S3, R2) before launch. The upload route is small
  enough that the switch is a one-file change in `server/routes/uploads.ts`.

## Rolling back

- `npm run db:push` does not run down-migrations. Drizzle's `push` reconciles against the
  current schema definition; rolling the code back and re-running `push` is the supported
  path for column removals.
- For data-bearing migrations (0008, 0009, 0011), a rollback requires hand-written SQL.
  Back up the database before rolling back.

## Known limitations

- **No feature flags beyond env vars.** `FEATURE_AI_PRACTICE_REAL` is the only runtime flag.
  The rest of the app is always on.
- **No background workers.** Everything runs in the request-handling process. Long-running
  tasks (scoring, feedback generation) block the request. This is fine for pre-launch — revisit
  at scale.
- **No multi-instance.** The Gemini live-session registry (`sessionOwners`) is in-memory, so
  horizontal scaling needs a shared store first. The in-memory patient-simulator cache has the
  same constraint. Both are intentional for pre-launch simplicity.
- **Uploads are on-disk.** See above.

## Where to go next

- Full env var threat model: `Documentation/SECURITY.md`.
- Migration-by-migration schema details: read the SQL files themselves; they are short.
- Endpoint surface the prod proxy needs to handle: `Documentation/API_REFERENCE.md`.
