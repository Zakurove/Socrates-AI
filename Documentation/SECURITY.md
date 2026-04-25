# Security

Socrates AI handles low-sensitivity data by design: there is no PHI in the app, no payment
data, and no PII beyond email, display name, and optional author bio. Still, every account
action costs money (AI tokens), so the threat model centers on account takeover and abuse.

This document is the hardening checklist + rationale. Implementation lives under
`server/auth.ts`, `server/middleware/`, and the route files.

## Threat model (brief)

| Threat | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Credential stuffing | high | account takeover → AI spend on user's account | authLimiter + bcrypt 12 + dummy-hash timing equaliser |
| Session fixation | low | unauthorised access | `req.session.regenerate` on login and register |
| CSRF | low | unauthorised writes | SameSite=strict cookie + same-origin enforced via CORS |
| XSS | low | cookie theft → impersonation | httpOnly cookie, helmet headers, no innerHTML in app code |
| AI cost abuse | high | surprise bill | rate limiters + per-user daily spend cap |
| Enumeration of registered emails | medium | targeted phishing | constant-time register and login responses; forgot always 200 |
| Admin privilege escalation | medium | mass content deletion | admin set via explicit SQL only; `ADMIN_EMAILS` deprecated |
| Upload-based code exec | low | server compromise | magic-byte sniff + MIME allow-list + disk quota |
| WS hijack post-auth | low | cost charged to wrong user | WS upgrade re-verifies cookie and cross-checks session user id |
| Unpublished PHI leaking via library | medium | content removal, user complaint | publish attestations + admin takedown queue |

## Authentication

### Session cookies

- Store in production: `connect-pg-simple`, PostgreSQL table `user_sessions` created on boot.
- Store in development: `memorystore` (in-process).
- Cookie: `httpOnly: true`, `sameSite: "strict"`, `secure` in production, `maxAge: 7 days`.
- `SESSION_SECRET` validated at boot. 32+ hex/base64 characters. Short secrets abort startup
  in production with a fatal error.
- `req.session.regenerate` is called on login and on register to prevent fixation (the
  pre-auth cookie is discarded, a fresh session id is minted).
- Logout calls `req.logout()` and then destroys the session.

### Passwords

- Hashed with `bcrypt` at cost 12.
- Minimum length 10 (enforced in the Zod schema for register and reset).
- `DUMMY_PASSWORD_HASH` is generated at boot and reused whenever the login email does not
  exist, so `bcrypt.compare` runs with the same CPU cost regardless of whether the email is
  registered. An attacker cannot distinguish "user exists / wrong password" from "user does
  not exist" by latency.
- Password reset tokens: the client sees a raw 32-byte token; the server stores only
  `sha256(token)` in `password_resets` (migration 0012). The token is single-use and has a
  1-hour TTL. Consuming a token invalidates every other active reset token for that user.

### Register response shape

`POST /api/auth/register` returns 201 with `{ pending: true }` when the email already exists,
identical to the success shape. This prevents enumeration. The duplicate email is silently
dropped server-side — no email is sent, no state is changed for the existing user. The actual
user row is returned only when the registration succeeded.

### Forgot-password response

`POST /api/auth/forgot-password` always returns 200 with a generic message, regardless of
whether the email is registered. The reset email is only sent when the email matches a real
user; otherwise nothing happens. Timing is equalised by a constant-time dummy DB lookup.

## Authorization

### Route guards

- `requireAuth` — 401 if no session. Applied on every route except `/auth/*`,
  `/invites/:token` preview, and a handful of static-serve paths.
- `requireAdmin` — 403 if not `users.is_admin`. Stacks after `requireAuth` on `/api/admin/*`.

### Resource-level checks

- Stations and collections check ownership or collection-role on every mutation.
- Collection role hierarchy is enforced by `assertCollectionRole(role, minRole)` in
  `server/routes/collections.ts`. `owner > editor > viewer`. Viewers can read; editors can add
  or remove stations; only owners can invite, change roles, or delete.
- A collection cannot demote its only owner. `PATCH /api/collections/:id/members/:userId`
  with `role` below `owner` returns 422 `last_owner` when the target is the only owner.
- Self-removal from a collection: only non-owners can use `DELETE
  /api/collections/:id/members/me`. Owners must transfer first (not yet implemented — blocked
  until v2).

### Admin model

`users.is_admin = true` is set **only by explicit SQL**.

- The legacy `ADMIN_EMAILS` env var that auto-promoted on registration was removed as a
  privilege-escalation vector on database resets. See `.env.example`.
- Migration `0008_community_library.sql` flips `is_admin=true` for the founder's email on
  migration time. Any other admins are manually promoted:

  ```sql
  UPDATE users SET is_admin = true WHERE email = 'someone@example.com';
  ```

- No UI exists to promote. This is intentional.

## CORS and CSRF

- `CORS_ORIGIN` is required in production. `server/index.ts` aborts boot if unset when
  `NODE_ENV === "production"`.
- Dev allows any origin for convenience. This is gated on `NODE_ENV !== "production"` and can
  never leak into a production deployment.
- CSRF: the session cookie is `sameSite: "strict"`, meaning cross-site requests do not carry
  the cookie. Combined with the same-origin CORS policy, a CSRF POST from a third-party page
  cannot authenticate. No separate CSRF token is issued.

## Rate limiting

All limiters are in `server/middleware/rate-limit.ts`. The key function `userOrIpKey` prefers
the authenticated user id over IP so shared NAT does not block individual users.

| Limiter | Window | Count | Scope |
| --- | --- | --- | --- |
| `authLimiter` | 15 min | 5 | Login, register, forgot, reset. Skipped when `RATE_LIMIT_DISABLED=1` (non-prod). |
| `generalLimiter` | 1 min | 200 | Applied globally after auth. Skipped when `RATE_LIMIT_DISABLED=1` (non-prod). |
| `aiLimiter` | 1 min | 30 | All `/api/ai/*`, `/api/practice/*`, `/api/gemini/*`. Never skipped. |
| `aiDailyLimiter` | 24 h | 500 | Same group as aiLimiter. Never skipped. |
| `libraryLimiter` | 1 min | 120 | `/api/library/*`. |
| `reportLimiter` | 24 h | 10 | `POST /api/reports`. Skipped when `RATE_LIMIT_DISABLED=1`. |

All limiters return HTTP 429 with `{ message: "...", retryAfter: seconds }`.

`RATE_LIMIT_DISABLED=1` is only honoured when `NODE_ENV !== "production"`. The check is
hard-coded in `server/middleware/rate-limit.ts` — the flag cannot disable limits in a prod
deploy even by accident.

## AI spend cap

`server/middleware/spend-cap.ts` enforces a per-user daily dollar cap — the only safety layer
that accounts for expensive long-prompt abuse that would slip under request-count limits.

- Default cap: $5 USD / user / day. Configurable via `AI_DAILY_SPEND_CAP_USD`.
- Implementation: `getUserSpendLast24h(userId)` runs
  `SELECT COALESCE(SUM(cost_usd), 0) FROM ai_costs
   WHERE user_id = $1 AND created_at > now() - interval '24 hours'`.
- Result is cached in memory for 60 seconds keyed by user id. The cache is invalidated after
  every successful `logAiCost` via `invalidateSpendCache(userId)`.
- On cap-hit, middleware returns HTTP 429 with:

  ```json
  {
    "message": "You've hit today's AI spend limit.",
    "code": "daily_spend_cap",
    "capUsd": 5,
    "spentUsd": 5.02
  }
  ```

- The client switches on `code === "daily_spend_cap"` and shows a dedicated dialog pointing at
  the user's settings page and a "try again tomorrow" message.
- Cost is logged by route handlers, not the middleware, because the middleware runs before the
  AI call. The service returns `{ tokensIn, tokensOut, model }`; the handler calls
  `storage.logAiCost(...)` after the response is read and before returning 200.

## Upload safety

`server/routes/uploads.ts` accepts JPEG, PNG, and WebP item media.

- `multer` memoryStorage, 5 MB per file.
- Magic-byte sniffer rejects files whose bytes do not match the declared MIME type. Returns
  HTTP 415 with `code: "mime_mismatch"`.
- 500 MB total disk quota across the `uploads/items/` directory; uploads over quota return
  HTTP 507 with `code: "storage_quota_exceeded"`.
- Files are written with random UUID names; the original filename is not preserved.
- No videos. YouTube / Vimeo embeds are supported as item media but only as URL metadata, not
  as uploaded media. See `client/src/lib/video.ts`.

## Gemini WebSocket upgrade

The WS endpoint `/api/gemini/ws/:sessionId` is the highest-value privilege escalation surface
in the app — a hijacked WS connection would charge AI tokens to the wrong user. Upgrade is
secured with three checks:

1. The session cookie is re-verified through the same `sessionMiddleware` instance used by
   the Express app. A stub `res` is constructed so `express-session` populates
   `req.session.passport.user`.
2. `sessionOwners` (an in-memory Map set at `POST /api/gemini/session`) is consulted — the
   `sessionId` in the URL must exist and the authenticated user id must equal its recorded
   owner. If the cross-check fails, the server calls `socket.destroy()` before
   `handleUpgrade`.
3. The client never learns the Gemini API key. All audio flows through the server; the
   server talks to Gemini over the service credential in `GOOGLE_AI_API_KEY`.

See `server/routes/gemini.ts`.

## Content safety

### Diagnosis leak filter

`server/services/patient-simulator.ts` blocks approximately 80 common diagnosis keywords
(`BLOCKED_DIAGNOSIS_TERMS`). If the model's first response contains any term, the service
retries with a stricter system prompt. If the retry still leaks, the term is replaced with a
neutral phrase. The goal is not perfect containment — it is to keep the patient in character
for the common case.

### Publish attestations

Before a station or collection goes public the owner must attest three things via the Publish
dialog in the client:

1. Original content (no copyright violation).
2. No PHI — no real patient identifiers, anywhere in briefing, checklist, or media.
3. CC-BY 4.0 licence on the published content.

Server validates minimum content (title + 1 item or 1 examiner question for stations; at
least 1 station for collections). The attestations are stored as a structured record on the
station / collection row for audit. Unpublishing flips `visibility` back to `private`; forks
made while the content was public are preserved with attribution via `forkOf`.

### Reports and moderation

- `POST /api/reports` accepts `{ targetType, targetId, reason }`. Rate-limited to 10/day/user.
- `/admin/reports` queue triages reports. Dismiss leaves the target alone; Remove calls
  `forceUnpublishTarget` which flips the target to `private` and marks the report as
  `removed`.
- Admin actions are logged via `console.log` with user id, target, and action. No structured
  audit-log table yet.

## Security headers (helmet)

Default helmet config. Key headers:

- `Content-Security-Policy` — production default (disabled in dev to keep Vite HMR simple).
- `Strict-Transport-Security` — enabled in production.
- `X-Content-Type-Options: nosniff`.
- `X-Frame-Options: DENY`.
- `Referrer-Policy: no-referrer`.

## Environment variable threat model

| Variable | Sensitivity | Notes |
| --- | --- | --- |
| `SESSION_SECRET` | critical | Access grants forgery of any session. Rotate on compromise. Must be 32+ chars in prod. |
| `DATABASE_URL` | critical | Full DB access. Rotate via Postgres `ALTER ROLE` + redeploy. |
| `OPENAI_API_KEY` | critical | Cost leakage if stolen. Rotate via OpenAI dashboard. |
| `GOOGLE_AI_API_KEY` | critical | Same as above for Gemini Live. |
| `RESEND_API_KEY` | moderate | Can send email as `EMAIL_FROM`. Rotate on compromise. |
| `CORS_ORIGIN` | high | Misconfig broadens cross-origin attack surface. Prod boot fails if unset. |
| `AI_DAILY_SPEND_CAP_USD` | high | Lowering it is safe; raising it expands per-account cost risk. |
| `ADMIN_EMAILS` | **deprecated** | Previously auto-promoted on register. Removed as escalation vector. |
| `APP_URL` | low | Used to construct invite and reset links. Must match the public origin. |
| `RATE_LIMIT_DISABLED` | low | Non-prod only. Hardcoded to no-op when `NODE_ENV==="production"`. |
| `DEBUG_ERRORS` | low | Enables stack-trace bodies on 500. Off by default. |
| `FEATURE_AI_PRACTICE_REAL` | low | Flag. When off, narration endpoints return 503. |

## Logging

- `console.log` / `console.error` only. No structured logger.
- Request logs include method, path, status, and latency. User id is logged on authenticated
  requests; password, token, and raw audio bodies are never logged.
- In production, 500 response bodies are stripped to `{ message: "Internal server error" }`.
  The underlying stack is always printed via `console.error`.
- Set `DEBUG_ERRORS=1` locally to let the client see the underlying message.

## Incident response (minimal, pre-launch)

Until there are more than a handful of users the plan is:

1. Rotate the compromised secret in the host dashboard.
2. Redeploy.
3. If the DB was touched, manually inspect `ai_costs`, `sessions`, and `reports` for anomalies.
4. If a user account was taken over, reset the password manually via SQL and email them
   through `RESEND_API_KEY`.

This section will be revisited before the first cohort of real users is onboarded.

## Where to go next

- Env var names and default values: `Documentation/DEPLOYMENT.md`.
- Rate-limit numbers in context of AI flows: `Documentation/AI_ARCHITECTURE.md`.
- Endpoint shapes including error codes: `Documentation/API_REFERENCE.md`.
