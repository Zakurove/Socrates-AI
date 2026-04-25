# Backend

Node 20 + Express 4 + TypeScript, Drizzle ORM over PostgreSQL, Passport local strategy,
OpenAI SDK, Google GenAI SDK for Gemini Live. Single process — in production the same server
serves the built React bundle and the JSON API.

Entry point: `server/index.ts`. Routes are mounted by `server/routes/index.ts`. Persistence is
abstracted behind `IStorage` in `server/storage.ts`. Schema is declared in `shared/schema.ts`
and synced with `drizzle-kit push`.

## Bootstrap

`server/index.ts` is intentionally linear — every middleware position matters.

| Step | What it does | Reference |
| --- | --- | --- |
| 1 | `helmet()` sets hardening headers. CSP off in dev. | `server/index.ts` |
| 2 | CORS allow-list from `CORS_ORIGIN`. Prod boot fails if unset. | `server/index.ts` |
| 3 | `express.json({ limit: "500kb" })` with a `skip` for three raw paths | see below |
| 4 | `setupAuth(app)` — installs `express-session` + Passport strategies | `server/auth.ts` |
| 5 | `generalLimiter` (200 req/min, keyed by user id or IP) | `server/middleware/rate-limit.ts` |
| 6 | Static `/uploads/items` served from `uploads/items/` on disk | `server/index.ts` |
| 7 | `registerRoutes(app)` mounts every router under `/api/*` | `server/routes/index.ts` |
| 8 | Fallback `/assets` + SPA index serve (prod only) | `server/index.ts` |
| 9 | Global error handler. Strips message bodies in prod unless `DEBUG_ERRORS=1` | `server/index.ts` |
| 10 | `attachGeminiWebSocket(server)` after `server.listen` | `server/routes/gemini.ts` |

JSON parser skip list (any path beginning with these is forwarded untouched so the route can
consume `req` as a raw stream):

- `/api/ai/transcribe` — raw audio bytes
- `/api/practice/:sessionId/transcribe` — raw audio bytes
- `/api/uploads/image` — `multipart/form-data`

## Middleware chain

Middleware is applied in layers. Per-route chains on AI endpoints always stack in this order:

```
requireAuth → aiLimiter → aiDailyLimiter → dailySpendCap → handler
```

| Middleware | File | Purpose |
| --- | --- | --- |
| `requireAuth` | `server/middleware/auth.ts` | Returns 401 if `!req.isAuthenticated()`. |
| `requireAdmin` | `server/middleware/admin.ts` | Returns 403 if `!req.user?.isAdmin`. Stacks after `requireAuth`. |
| `authLimiter` | `server/middleware/rate-limit.ts` | 5 requests / 15 min for `/api/auth/login`, `/register`, `/forgot-password`, `/reset-password`. |
| `aiLimiter` | same | 30 requests / minute on `/api/ai/*`, `/api/practice/*`, `/api/gemini/*`. |
| `aiDailyLimiter` | same | 500 requests / day on the same group — catches stuck clients. |
| `generalLimiter` | same | 200 requests / minute, applied globally. |
| `libraryLimiter` | same | 120 requests / minute on `/api/library/*`. |
| `reportLimiter` | same | 10 reports / day on `POST /api/reports`. |
| `dailySpendCap` | `server/middleware/spend-cap.ts` | Reads 24-hour sum from `ai_costs`, 429 with `code:"daily_spend_cap"` when over `AI_DAILY_SPEND_CAP_USD` (default $5). |

All limiters share one key function, `userOrIpKey`, which prefers the authenticated user id
over `req.ip` so shared NATs do not block individual users. When `RATE_LIMIT_DISABLED=1` and
`NODE_ENV !== "production"`, the auth, general, and report limiters short-circuit. AI and spend
caps always apply, even in tests — Playwright tests that hit AI routes use mocked model
responses.

## Route groups

All routers are mounted at `/api/*`. Methods marked `auth` require the session cookie; `admin`
requires `is_admin=true`.

| Prefix | File | Auth | Scope |
| --- | --- | --- | --- |
| `/api/auth` | `server/routes/auth.ts` | mixed | Register, login, logout, me, profile, forgot, reset. |
| `/api/users` | same | auth | Public (auth-gated) user profile for `/u/:id`. |
| `/api/stations` | `server/routes/stations.ts` | auth | CRUD + publish / unpublish, fork, star. |
| `/api/collections` | `server/routes/collections.ts` | auth | CRUD, members, invites, stations-in-collection, publish / fork / star. |
| `/api/sessions` | `server/routes/sessions.ts` | auth | Create, update, item/question result writes, finalize. |
| `/api/ai` | `server/routes/ai.ts` | auth + AI chain | Transcribe, patient reply, checklist match, examiner grade, feedback, TTS. |
| `/api/practice` | `server/routes/practice.ts` | auth + AI chain | Per-session narration pipeline. Feature-flagged on `FEATURE_AI_PRACTICE_REAL=1`. |
| `/api/gemini` | `server/routes/gemini.ts` | auth + AI chain | Live-voice session create / switch / prime / close. WS upgrade on `/api/gemini/ws/:sid`. |
| `/api/mock-exams` | `server/routes/mockExams.ts` | auth | Template CRUD, attempts, advance, abort, results. |
| `/api/library` | `server/routes/library.ts` | auth | Public browse of community-shared stations and collections. |
| `/api/invites` | `server/routes/invites.ts` | mixed | Public preview of invite; accept endpoint requires auth. |
| `/api/reports` | `server/routes/stations.ts` (exported sub-router) | auth + reportLimiter | Submit a report against a station, collection, or user. |
| `/api/admin` | `server/routes/admin.ts` | admin | Report triage + hard delete. |
| `/api/uploads` | `server/routes/uploads.ts` | auth | `multipart/form-data` image upload for item media. |
| `/api/stats` | `server/routes/stats.ts` | auth | Progress-page aggregates. |

Exact request/response shapes are in `Documentation/API_REFERENCE.md`.

## Storage layer (`IStorage`)

`server/storage.ts` is the only module that talks to Drizzle. Every route calls `storage.X()`
rather than importing tables directly. The interface is surface-oriented, not table-oriented:
one method per business operation, often spanning multiple tables behind a transaction.

Grouped surface:

| Group | Representative methods |
| --- | --- |
| Auth / users | `createUser`, `getUserByEmail`, `getUserById`, `updateUserProfile`, `updatePassword`, `createPasswordReset`, `consumePasswordReset`. |
| Stations | `createStation`, `getStationById`, `listStationsForUser`, `updateStation`, `deleteStation`, `publishStation`, `unpublishStation`, `forkStation`, `starStation`, `unstarStation`. |
| Sections / items | Nested writes live inside `createStation` and `updateStation` — the editor sends the whole tree and storage reconciles it. `uploadItemMedia` attaches media rows. |
| Examiner questions | `listExaminerQuestions`, `upsertExaminerQuestion`, `deleteExaminerQuestion`. |
| Collections | `createCollection`, `listCollectionsForUser`, `listSharedWithMe`, `getCollectionById`, `updateCollection`, `deleteCollection`, `addStationToCollection`, `removeStationFromCollection`, `publishCollection`, `unpublishCollection`, `forkCollection`, `starCollection`, `unstarCollection`. |
| Members / invites | `listCollectionMembers`, `updateMemberRole`, `removeMember`, `createInvite`, `cancelInvite`, `acceptInvite`, `getInviteByToken`. |
| Sessions | `createSession`, `updateSession`, `finalizeSession`, `recordItemResult`, `recordQuestionResult`, `listSessions`, `getSessionById`. |
| Mock exams | `createMockExam`, `listMockExamsForUser`, `getMockExamById`, `updateMockExam`, `deleteMockExam`, `startMockExamAttempt`, `advanceAttempt`, `abortAttempt`, `getAttemptById`. |
| Library | `listPublicStations`, `listPublicCollections`, `getPublicStation`, `getPublicCollection`, `listFeatured`. |
| Reports | `createReport`, `listReports`, `resolveReport`. |
| AI costs | `logAiCost`, `getUserSpendLast24h`. |

## Drizzle transaction patterns

Three patterns recur across the storage layer.

### 1. Counter + join row

Stars and forks bump a counter on the parent row and insert/delete a join row. Both must
succeed atomically.

```ts
await db.transaction(async (tx) => {
  const inserted = await tx
    .insert(stationStars)
    .values({ stationId, userId })
    .onConflictDoNothing()
    .returning({ stationId: stationStars.stationId });
  if (inserted.length > 0) {
    await tx
      .update(stations)
      .set({ starCount: sql`${stations.starCount} + 1` })
      .where(eq(stations.id, stationId));
  }
});
```

On the reverse path (`unstarStation`, `unstarCollection`) the counter is decremented with
`GREATEST(count - 1, 0)` so repeated DELETEs cannot drive it negative. The same pattern is used
for `forkCount` and (best-effort) `practiceCount`.

### 2. Deep-copy fork

`forkStation` and `forkCollection` run the whole copy inside a single transaction so a partial
fork can never surface. Sections, items, sub-items, item media, and examiner questions are
cloned with new UUIDs; `forkOf` on the new row points at the source for attribution. On
collection fork, each contained station is recursively forked and inserted into the new
collection preserving ordering.

### 3. Finalize session

`finalizeSession` converts a `session` from `in_progress` to `completed`, computes the composite
score via `buildSessionScoring` (re-aggregated from `item_results` and
`examiner_question_results` against the current station), stamps `endedAt`, and — if the
station is public — bumps `practiceCount`. All three writes are in one transaction so the
`/session/:id/results` GET never sees a half-finalized row.

Important detail: `item_results` and `examiner_question_results` are treated as **source of
truth**. The composite score on `sessions` is a denormalized convenience; `buildSessionScoring`
re-computes from the join tables every time the results page is loaded, so editing the station
after a session does not produce stale per-item labels. See `server/services/session-scoring.ts`.

## Error handling convention

Routes throw, the global handler in `server/index.ts` formats. Three response shapes exist:

```jsonc
// Zod validation failure (400)
{ "message": "Invalid request", "errors": [...zod issues] }

// Known business error (4xx)
{ "message": "You can't fork your own station", "code": "self_fork" }

// Server error (500)
{ "message": "Internal server error" }
```

Conventions:

- Route handlers validate with `schema.parse(req.body)`; the resulting `ZodError` is caught by
  the handler and turned into a 400.
- Authorization failures return 403 with a `code` string (`not_owner`, `not_member`,
  `forbidden_role`).
- Not-found returns 404 with no body.
- `code` strings are stable — the client switches on them (e.g. the spend-cap 429 returns
  `code:"daily_spend_cap"` and the UI shows a dedicated dialog).
- In production, `message` is stripped from 500s. Set `DEBUG_ERRORS=1` locally to see the
  underlying stack. Full stack traces are always logged via `console.error`.

## AI calls and cost logging

Every call into `openai.*.create` or the Gemini Live SDK funnels through a service module in
`server/services/`. Those services return both the model response and an `{ tokensIn, tokensOut,
model }` triplet. The caller (always a route handler) calls `storage.logAiCost({ userId, model,
tokensIn, tokensOut, costUsd, route })` after the response is read. The cost is computed by
`estimateCostUsd` from `shared/ai-models.ts` — the same constant table is used by the spend cap
so the two never drift.

Gemini Live cost logging is batched: the `gemini-live.ts` service accumulates input/output
tokens per session and flushes a single `ai_costs` row when the session closes (normally or
via WS disconnect). See `logGeminiCost` and the `onClose` handler.

Spend cap invalidation: `invalidateSpendCache(userId)` is called after every successful
`logAiCost` so the next request sees the fresh total within seconds rather than up to the 60s
cache TTL.

## Auth layer

`setupAuth(app)` configures:

- `express-session` with `connect-pg-simple` in production (table `user_sessions`, created on
  boot with `createTableIfMissing: true`) and `memorystore` in development.
- `SESSION_SECRET` is validated at boot — 32+ hex characters required in production. Short
  secrets abort startup with a fatal error.
- Cookie is `httpOnly: true`, `sameSite: "strict"`, `secure` in production, `maxAge: 7 days`.
- Passport local strategy with `usernameField: "email"`. Password check uses `bcrypt.compare`
  with 12 rounds. On "user not found" the strategy does a dummy compare against
  `DUMMY_PASSWORD_HASH` so login latency is constant whether the email exists or not.
- `sessionMiddleware` is re-exported so the Gemini WebSocket upgrade handler can verify the
  session cookie using the same store.
- `sanitizeUser(row)` strips the `password` column before sending a user to the client.

Session regeneration runs on login and register via `req.session.regenerate(...)` to prevent
session fixation.

## Feature flags

| Env var | Default | Effect |
| --- | --- | --- |
| `FEATURE_AI_PRACTICE_REAL` | unset (off) | When off, every `/api/practice/*` route returns 503. Flip to `1` in production. |
| `RATE_LIMIT_DISABLED` | unset | Non-prod only. Skips auth/general/report limiters for E2E tests. |
| `DEBUG_ERRORS` | unset | When `1`, 500 responses include the underlying message. Off in prod. |
| `AI_DAILY_SPEND_CAP_USD` | `5` | Per-user daily spend cap. Set to `0` to disable (not recommended). |

See `Documentation/DEPLOYMENT.md` for the full env var checklist.

## File layout (server)

```
server/
├── index.ts              # bootstrap + error handler + Gemini WS attach
├── auth.ts               # setupAuth, passport config, sessionMiddleware export
├── storage.ts            # IStorage implementation — all Drizzle calls live here
├── db.ts                 # drizzle client, connection pool
├── routes/
│   ├── index.ts          # registerRoutes — mount points
│   ├── auth.ts           # + publicUsersRouter
│   ├── stations.ts       # + reportRouter
│   ├── collections.ts
│   ├── sessions.ts
│   ├── ai.ts
│   ├── practice.ts
│   ├── gemini.ts         # REST + WS
│   ├── mockExams.ts
│   ├── library.ts
│   ├── invites.ts
│   ├── admin.ts
│   ├── stats.ts
│   └── uploads.ts
├── middleware/
│   ├── auth.ts           # requireAuth
│   ├── admin.ts          # requireAdmin
│   ├── rate-limit.ts     # 6 limiters + userOrIpKey
│   └── spend-cap.ts      # dailySpendCap + invalidateSpendCache
└── services/
    ├── openai.ts         # shared OpenAI client
    ├── patient-simulator.ts
    ├── checklist-matcher.ts
    ├── examiner-evaluator.ts
    ├── feedback-generator.ts
    ├── speech-to-text.ts
    ├── text-to-speech.ts
    ├── gemini-live.ts
    ├── session-scoring.ts
    ├── moderation.ts
    └── email.ts
```

## Where to go next

- Model-by-model AI details: `Documentation/AI_ARCHITECTURE.md`.
- Endpoint shapes: `Documentation/API_REFERENCE.md`.
- Security posture, rate-limit numbers, env var threat model: `Documentation/SECURITY.md`.
- Drizzle schema and migrations: `shared/schema.ts` and `migrations/`.
