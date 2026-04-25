# Architecture

Socrates AI is a single-process Node/Express server that serves both the JSON API and (in
production) the built React bundle. PostgreSQL is the only persistent store. All AI calls are
server-side.

## High-level diagram

```
              ┌────────────────────────────────────────────────────────┐
              │                         Browser                        │
              │  ┌──────────────┐  ┌────────────────┐  ┌────────────┐  │
              │  │ React / Vite │  │ wouter router  │  │ TanStack QC │  │
              │  │  (TS + TW)   │  │  + ProtectedR. │  │   cache     │  │
              │  └──────┬───────┘  └────────┬───────┘  └─────┬──────┘  │
              │         └─── fetch(...) + WebSocket ─────────┘         │
              └──────────────────────────┬─────────────────────────────┘
                                         │ session cookie (httpOnly, SameSite=strict)
                                         │
                    ┌────────────────────┴─────────────────────┐
                    │                Express (Node)            │
                    │  helmet → CORS → json → session+passport │
                    │         → generalLimiter                 │
                    │  ┌────────────────────────────────────┐  │
                    │  │ /api/auth       routes/auth.ts     │  │
                    │  │ /api/stations   routes/stations.ts │  │
                    │  │ /api/collections                   │  │
                    │  │ /api/sessions                      │  │
                    │  │ /api/practice   (AI-enabled)       │  │
                    │  │ /api/ai         (AI-enabled)       │  │
                    │  │ /api/gemini     (Live-API proxy)   │  │
                    │  │ /api/mock-exams                    │  │
                    │  │ /api/library    (community browse) │  │
                    │  │ /api/reports    /api/admin         │  │
                    │  │ /api/invites    /api/users         │  │
                    │  │ /api/uploads    /api/stats         │  │
                    │  └──────────────┬─────────────────────┘  │
                    │                 │                        │
                    │  services/ ─────┼─── OpenAI (REST)       │
                    │     checklist-matcher                    │
                    │     patient-simulator                    │
                    │     examiner-evaluator                   │
                    │     feedback-generator                   │
                    │     speech-to-text / text-to-speech      │
                    │  services/gemini-live.ts ── Google GenAI │
                    │     (Gemini Live bidi WS)                │
                    │                 │                        │
                    │  storage.ts (IStorage) ── Drizzle ── PG  │
                    └─────────────────┼────────────────────────┘
                                      │
                             ┌────────▼─────────┐
                             │   PostgreSQL     │
                             │  (users, sessions│
                             │   stations,      │
                             │   item_results,  │
                             │   ai_costs, …)   │
                             └──────────────────┘
```

## Request flow (typical authenticated API call)

`client → fetch(credentials:"include") → helmet → CORS → express.json →
sessionMiddleware → passport.session → generalLimiter → route handler →
middleware chain (requireAuth, rate limiters, spend-cap) → storage → drizzle → pg`.

1. `helmet` sets the standard hardening headers. CSP is off in dev, default in production.
2. CORS allow-list is pulled from `CORS_ORIGIN` in production; dev lets everything through. See
   `server/index.ts`.
3. JSON body parser has a 500 kB limit. Three paths bypass it: `/api/ai/transcribe`,
   `/api/practice/:id/transcribe` (raw audio), and `/api/uploads/image` (multipart).
4. `express-session` with Passport's local strategy hydrates `req.user`. In production the
   session store is PostgreSQL (`connect-pg-simple`, table `user_sessions`); in development it
   is `memorystore`.
5. `generalLimiter` (200 req/min keyed by user id if authenticated, else IP) is applied
   globally after auth.
6. Per-router middleware then applies `requireAuth`, `aiLimiter`, `aiDailyLimiter`, and
   `dailySpendCap` where appropriate.
7. The route calls `storage` (see `server/storage.ts`). `storage` is the single Drizzle-backed
   implementation of the `IStorage` interface. Writes that touch counters (stars, forks,
   practice count) run inside `db.transaction` to keep the counter and the join-row consistent.

Error flow: handlers use `next(err)` for unexpected errors. The global error middleware in
`server/index.ts` logs method/path/status without a body and returns a generic message in
production (full message in dev).

## AI request flow (OpenAI)

```
client ──POST /api/ai/*──▶ requireAuth ──▶ aiLimiter (30/min)
                                        ──▶ aiDailyLimiter (500/day)
                                        ──▶ dailySpendCap ($5/day default)
                                        ──▶ route handler
                                              ├─ service/*.ts → openai.*.create(...)
                                              └─ db.insert(aiCosts) (best-effort)
```

- Cost is logged to `ai_costs` with `estimateCostUsd` from `shared/ai-models.ts`. Failure to
  log is swallowed so billing concerns never fail a user request.
- `dailySpendCap` caches the trailing-24h spend per user for 60 seconds; the cap is soft by
  that window. See `server/middleware/spend-cap.ts`.

## Gemini Live (real-time voice) flow

Two transports: a plain HTTP session-creation endpoint and a WebSocket that proxies the
Gemini bidirectional audio stream.

```
1. client POST /api/gemini/session  { stationId, persona }
          ── server creates `sessionId = "gemini_" + random(24)`
          ── stores ownership in sessionOwners Map<sessionId, {userId,stationId}>
          ── stores pending config in pendingConfigs Map<sessionId, cfg>
          ── returns { sessionId, wsUrl: "/api/gemini/ws/:sessionId" }

2. client opens WS to wsUrl (same origin, session cookie attached)
          ── server 'upgrade' handler:
               · matches /api/gemini/ws/:sessionId
               · looks up sessionOwners[sessionId] → must exist
               · runs sessionMiddleware against the upgrade request
               · verifies session.passport.user === ownership.userId
               · 401 if mismatch, 404 if missing, 500 if middleware absent
          ── handleUpgrade → wss.emit("connection", ws, _, sessionId)

3. on connection:
          ── server calls createGeminiSession(cfg, cb, sessionId) in services/gemini-live.ts
          ── Gemini SDK client.live.connect opens WS to Google
          ── server sends { type: "connected", sessionId, persona, outputSampleRate }
          ── client audio frames → sendAudio(sessionId, base64pcm)
          ── Gemini audio → callbacks.onAudio → WS send { type:"audio", data:base64 }
          ── Gemini transcripts → onText / onUserText → WS send
          ── turn boundaries → onTurnComplete → WS send

4. persona switch (optional): POST /api/gemini/switch-persona/:sessionId
   prime:                     POST /api/gemini/prime/:sessionId
   end:                       DELETE /api/gemini/session/:sessionId
```

The key security property: a leaked `sessionId` alone cannot be used. The WebSocket upgrade
re-authenticates the session cookie and cross-checks against the in-memory `sessionOwners`
map. See `server/routes/gemini.ts` `attachGeminiWebSocket`.

## Session and auth flow

```
register (POST /api/auth/register)
  ├─ authLimiter (5 / 15 min / IP)
  ├─ zod validate { email, password ≥ 10, displayName }
  ├─ existing? → 201 { pending:true } (no user enumeration)
  ├─ bcrypt.hash(pw, 12) → storage.createUser
  └─ req.session.regenerate → req.login → 201 user

login  (POST /api/auth/login)
  ├─ authLimiter
  ├─ passport local strategy
  │    (dummy bcrypt compare when email not found, to equalize latency)
  ├─ req.session.regenerate → req.login → 200 user

logout (POST /api/auth/logout) → req.logout → 200

me     (GET /api/auth/me)      → req.isAuthenticated() ? user : 401

forgot (POST /api/auth/forgot-password)
  ├─ authLimiter
  ├─ always 200 { ok:true }
  ├─ if user exists:
  │     raw = randomBytes(32).hex
  │     storage.createPasswordReset({ token: sha256(raw), expires: +1h, ip })
  │     sendPasswordResetEmail(raw)
  └─ emails contain raw; DB holds digest only

reset  (POST /api/auth/reset-password)
  ├─ authLimiter
  ├─ lookup by sha256(token) → timing-safe compare
  ├─ bcrypt.hash(newPw, 12) → updateUser
  └─ markUsed + invalidateOtherPasswordResets
```

## Community Library data model

Stations and Collections each carry a `visibility` column (`private | shared | public`) and a
`publishedAt` timestamp. Collections carry a role table. Together they implement three layers of
access.

```
users ──┬──────── collections (owner = users.id)
        │             │
        │             └── collection_members (userId, role: owner|editor|viewer)
        │                       │
        │                       └── access control for `shared` visibility
        │
        ├──────── collection_invites (email, token, expires_at, accepted_at)
        │
        ├──────── stations (owner = users.id; visibility private|shared|public)
        │              │
        │              ├── sections → items → sub-items (up to 2 levels deep)
        │              ├── examiner_questions
        │              └── station_stars / collection_stars (join tables)
        │
        ├──────── sessions (owner = users.id; mode: self_check | ai_history | …)
        │              ├── item_results (per-leaf coverage)
        │              └── examiner_question_results (per-question score)
        │
        ├──────── mock_exams (template) ─── mock_exam_attempts (per run)
        │                                          └── sessions.mockExamAttemptId
        │
        ├──────── password_resets (hashed token, expires in 1h)
        │
        ├──────── ai_costs  (userId, model, tokens_in, tokens_out, cost_estimate_usd)
        │
        └──────── reports (targetType: station|collection|user, status: open|reviewed_ok|removed)
```

Full column definitions live in `shared/schema.ts`.

Visibility semantics:

- `private` — only the owner (and admins, who get a bypass for moderation) can read or mutate.
- `shared` — members of any Collection that contains the Station inherit read access. Still
  owner-only to mutate.
- `public` — readable by any signed-in user via `/api/library/*`. Content is sanitised through
  `sanitizePublicStation` before serving (strips userId on the row, leaves author projection).

Fork semantics (`server/storage.ts` `forkStation` / `forkCollection`):

- Deep copy: sections, items, sub-items, examiner questions are all duplicated.
- `forkOf` FK preserves attribution.
- Source `forkCount` is bumped inside the same transaction.
- A user cannot fork their own content (HTTP 422).

Counter semantics (stars, forks, practice count): every increment/decrement runs in a Drizzle
transaction alongside the join-row insert/delete. The counter uses
`GREATEST(counter - 1, 0)` on decrement to avoid negative values in the face of concurrent
unstars.

## File layout

```
/Users/nasser/Development/SocratesAI/
├── client/
│   ├── index.html
│   ├── public/
│   │   └── manifest.webmanifest                (PWA)
│   └── src/
│       ├── App.tsx                             (wouter routes + 440px phone-frame)
│       ├── main.tsx
│       ├── index.css                           (CSS variables / brand tokens)
│       ├── components/
│       │   ├── ui/                             (shadcn primitives)
│       │   ├── library/                        (PublishDialog, ForkButton, StarButton, …)
│       │   ├── collections/                    (MemberList, InviteMemberDialog, RoleBadge)
│       │   ├── practice/                       (timer, checklist view, narration UI)
│       │   └── ProtectedRoute.tsx, ErrorBoundary.tsx
│       ├── hooks/
│       │   ├── use-auth.ts, use-stations.ts, use-collections.ts
│       │   ├── use-library.ts, use-stars.ts, use-fork.ts, use-publish.ts
│       │   ├── use-reports.ts, use-admin.ts, use-invites.ts
│       │   ├── useGeminiLive.ts                (WS client)
│       │   ├── useMediaRecorder.ts, useNarrationMode.ts, useChecklistMatcher.ts
│       │   └── use-prefs.ts (theme, tts toggle)
│       ├── lib/
│       │   ├── queryClient.ts                  (TanStack Query + 401 handler)
│       │   ├── editor-draft.ts                 (localStorage draft cache)
│       │   ├── practice-storage.ts
│       │   └── utils.ts
│       └── pages/                              (one per route in App.tsx)
│
├── server/
│   ├── index.ts                                (bootstrap, CORS, helmet, errors)
│   ├── auth.ts                                 (passport, bcrypt, sessionMiddleware)
│   ├── db.ts                                   (pg Pool + drizzle()
│   ├── storage.ts                              (IStorage implementation)
│   ├── vite.ts                                 (dev SSR + prod static)
│   ├── middleware/
│   │   ├── auth.ts                             (requireAuth)
│   │   ├── admin.ts                            (requireAdmin)
│   │   ├── rate-limit.ts                       (auth/ai/library/report limiters)
│   │   └── spend-cap.ts                        (daily $ cap)
│   ├── routes/
│   │   ├── index.ts        (registerRoutes)
│   │   ├── auth.ts         (register/login/logout/me/profile/forgot/reset + /api/users/:id)
│   │   ├── stations.ts     (CRUD + publish + fork + star + /api/reports)
│   │   ├── collections.ts  (CRUD + members + invites + publish + fork + star)
│   │   ├── sessions.ts     (session CRUD + item_results + examiner_question_results)
│   │   ├── practice.ts     (AI narration: transcribe / patient-turn / check / tts)
│   │   ├── ai.ts           (one-shot AI endpoints)
│   │   ├── gemini.ts       (real-time voice REST + WS upgrade)
│   │   ├── mockExams.ts    (templates + attempts + legacy /results)
│   │   ├── library.ts      (public browse: stations / collections / featured)
│   │   ├── admin.ts        (reports queue, cascading takedowns)
│   │   ├── invites.ts      (preview + accept)
│   │   ├── uploads.ts      (image upload with magic-byte sniff)
│   │   └── stats.ts        (progress / streak / best improvement)
│   └── services/
│       ├── openai.ts                           (shared OpenAI client)
│       ├── speech-to-text.ts                   (whisper-1)
│       ├── text-to-speech.ts                   (tts-1)
│       ├── patient-simulator.ts                (gpt-4o, diagnosis filter)
│       ├── checklist-matcher.ts                (embedding pre-filter + coverage tree)
│       ├── examiner-evaluator.ts               (gpt-4o-mini rubric grader)
│       ├── feedback-generator.ts               (gpt-4o-mini closing paragraph)
│       ├── session-scoring.ts                  (composite score from source tables)
│       ├── gemini-live.ts                      (Google GenAI bidi WS)
│       ├── moderation.ts                       (sanitizePublicStation, takedowns)
│       └── email.ts                            (Resend or copy-link fallback)
│
├── shared/
│   ├── schema.ts                               (drizzle tables + zod schemas)
│   ├── scoring.ts                              (computeCompositeScore)
│   └── ai-models.ts                            (canonical model ids + pricing)
│
├── migrations/                                 (0001 … 0012)
├── tests/e2e/                                  (Playwright; serial, workers:1)
├── drizzle.config.ts
├── playwright.config.ts
├── tailwind.config.ts                          (brand tokens, type scale)
└── package.json                                (scripts: dev / build / start / check / db:push)
```

Cross-reference: see `Documentation/BACKEND.md` for the full route table and middleware chain
detail, and `Documentation/FRONTEND.md` for the wouter route map and shared components.
