# API Reference

Every route under `/api/*`. Authentication is via the session cookie (see
`Documentation/SECURITY.md`). Content-Type is `application/json` unless noted. Request bodies
are validated with Zod; unrecognised fields are stripped. All identifiers are UUIDs unless the
field name says otherwise.

Common error codes referenced below:

| Code | HTTP | Meaning |
| --- | --- | --- |
| — | 400 | Zod validation failure. Body: `{ message, errors: ZodIssue[] }`. |
| — | 401 | Missing or invalid session. |
| — | 403 | Authenticated but forbidden (not owner, not admin, wrong role). |
| — | 404 | Resource not found or visibility hides it from the caller. |
| `self_fork` | 422 | Cannot fork your own station or collection. |
| `last_owner` | 422 | Cannot demote or remove the only owner of a collection. |
| `min_content` | 422 | Station / collection does not meet the publish minimum. |
| `daily_spend_cap` | 429 | Per-user daily AI spend cap reached. |
| `mime_mismatch` | 415 | Upload bytes do not match declared MIME type. |
| `storage_quota_exceeded` | 507 | `uploads/items/` directory is full. |

Feature-flagged endpoints return `503 { message: "feature disabled" }` when the flag is off.

---

## Auth (`/api/auth`)

### POST `/api/auth/register`

| | |
| --- | --- |
| Auth | none |
| Limits | `authLimiter` |
| Body | `{ email: string, password: string(min 10), displayName: string }` |
| 201 | `{ user: SanitizedUser }` on new registration; `{ pending: true }` if email is taken (enumeration-safe) |

Creates a user, auto-logs in (session regenerated), and returns the sanitized user. `password`
is stripped before the response.

### POST `/api/auth/login`

| | |
| --- | --- |
| Auth | none |
| Limits | `authLimiter` |
| Body | `{ email: string, password: string }` |
| 200 | `{ user: SanitizedUser }` |
| 401 | `{ message: "Invalid email or password" }` |

Constant-time against "email not found" via a dummy-hash compare.

### POST `/api/auth/logout`

| | |
| --- | --- |
| Auth | session optional |
| 204 | no body |

### GET `/api/auth/me`

| | |
| --- | --- |
| Auth | session optional |
| 200 | `{ user: SanitizedUser \| null }` |

Returns `null` if not authenticated — the client uses this to decide whether to redirect.

### PUT `/api/auth/profile`

| | |
| --- | --- |
| Auth | required |
| Body | `{ displayName?: string, bio?: string, currentPassword?: string, newPassword?: string(min 10) }` |
| 200 | `{ user: SanitizedUser }` |
| 401 | wrong current password when `newPassword` is provided |

If `newPassword` is set, `currentPassword` is required and verified.

### POST `/api/auth/forgot-password`

| | |
| --- | --- |
| Auth | none |
| Limits | `authLimiter` |
| Body | `{ email: string }` |
| 200 | `{ message: "If that email is registered..." }` — always |

Sends a reset email through Resend if `RESEND_API_KEY` is set and the email is known. Raw
token emailed; server stores only `sha256(token)` in `password_resets`. TTL 1 hour.

### POST `/api/auth/reset-password`

| | |
| --- | --- |
| Auth | none |
| Limits | `authLimiter` |
| Body | `{ token: string, password: string(min 10) }` |
| 200 | `{ user: SanitizedUser }` (auto-logs in) |
| 400 | token expired, consumed, or unknown |

Consuming a token invalidates every other active reset for that user.

---

## Users (`/api/users`)

### GET `/api/users/:id`

| | |
| --- | --- |
| Auth | required |
| 200 | `{ id, displayName, bio, createdAt, publishedStationCount, publishedCollectionCount }` |

Auth-gated public profile used by `/u/:userId`.

---

## Stations (`/api/stations`)

### GET `/api/stations`

| | |
| --- | --- |
| Auth | required |
| 200 | `Station[]` owned by the caller |

### GET `/api/stations/:id`

| | |
| --- | --- |
| Auth | optional (visibility-aware) |
| 200 | `StationWithSectionsAndItems` |
| 404 | private and not owner, or shared and not collection-member |

### POST `/api/stations`

| | |
| --- | --- |
| Auth | required |
| Body | `createStationSchema` (title + optional sections with items and sub-items up to 2 levels, optional examiner questions) |
| 201 | created station |

Nested writes (sections, items, sub-items, examiner questions) are in one transaction.

### PUT `/api/stations/:id`

| | |
| --- | --- |
| Auth | required (owner only) |
| Body | full tree; storage reconciles creates / updates / deletes |
| 200 | updated station |

Calls `invalidateSimulatorCache(userId, stationId)` so the next patient turn re-reads the
briefing.

### DELETE `/api/stations/:id`

| | |
| --- | --- |
| Auth | required (owner only) |
| 204 | no body |

### POST `/api/stations/:id/publish`

| | |
| --- | --- |
| Auth | required (owner only) |
| Body | `{ attestations: { original: true, noPhi: true, ccby: true } }` |
| 200 | `{ station }` with `visibility="public"`, `publishedAt=now()` |
| 422 | `code: "min_content"` — title + at least 1 item or 1 examiner question required |

### DELETE `/api/stations/:id/publish`

Unpublish. Flips `visibility` to `private`. Existing forks are unaffected.

### POST `/api/stations/:id/fork`

| | |
| --- | --- |
| Auth | required |
| 201 | deep-copy station owned by caller, `forkOf` points at source |
| 422 | `code: "self_fork"` — cannot fork your own station |

### POST `/api/stations/:id/star` — idempotent

| | |
| --- | --- |
| Auth | required |
| 200 | `{ starred: true, starCount }` |

### DELETE `/api/stations/:id/star` — idempotent

---

## Collections (`/api/collections`)

### GET `/api/collections`

| | |
| --- | --- |
| Auth | required |
| Query | `tab=owned \| shared` |
| 200 | `Collection[]` |

### GET `/api/collections/:id`

Returns collection with members, stations, and the caller's role.

### POST `/api/collections`

| Body | `{ title: string, description?: string, visibility?: "private" \| "shared" \| "public" }` |
| --- | --- |
| 201 | created collection; caller set as `owner` in `collectionMembers` |

### PUT `/api/collections/:id`

Owner only.

### DELETE `/api/collections/:id`

Owner only. Cascades into `collectionStations` and `collectionMembers`. Contained stations
are **not** deleted.

### POST `/api/collections/:id/stations`

| | |
| --- | --- |
| Auth | required (editor or owner) |
| Body | `{ stationId: string, position?: number }` |
| 201 | updated collection |

### DELETE `/api/collections/:id/stations/:stationId`

Editor or owner.

### GET `/api/collections/:id/members`

Any member role. Returns `{ members: [{ userId, displayName, role, joinedAt }] }`.

### PATCH `/api/collections/:id/members/:userId`

| | |
| --- | --- |
| Auth | owner only |
| Body | `{ role: "owner" \| "editor" \| "viewer" }` |
| 422 | `code: "last_owner"` when demoting the only owner |

### DELETE `/api/collections/:id/members/:userId`

Owner removes anyone; members can remove themselves. Owners cannot remove themselves (must
transfer; transfer is a v2 feature).

### POST `/api/collections/:id/invites`

| Body | `{ email: string, role: "editor" \| "viewer" }` |
| --- | --- |
| 201 | `{ invite, inviteUrl }` |

Owner only. Re-inviting the same email cancels the previous invite. If `RESEND_API_KEY` is
set an email is sent; `inviteUrl` is always returned for copy-link fallback.

### GET `/api/collections/:id/invites`

Owner only. Returns open invites.

### DELETE `/api/collections/:id/invites/:inviteId`

Owner only. Revoke an open invite.

### POST `/api/collections/:id/publish` · DELETE `/api/collections/:id/publish`

Same contract as station publish. Min-content is at least one station in the collection.

### POST `/api/collections/:id/fork`

Deep-copy collection + recursively fork each contained station.

### POST `/api/collections/:id/star` · DELETE `/api/collections/:id/star`

Idempotent. Shape matches station-star.

---

## Sessions (`/api/sessions`)

### GET `/api/sessions`

| | |
| --- | --- |
| Auth | required |
| Query | `stationId?: string` |
| 200 | `Session[]` for the caller |

### GET `/api/sessions/:id`

Returns the session with live re-aggregated scoring via `buildSessionScoring`. The stored
`compositeScore` is treated as a cache — the response always reflects current station
structure.

### POST `/api/sessions`

| Body | `{ stationId, mode: "self_check" \| "ai_history" \| "ai_observer" \| "ai_communication", mockExamAttemptId?: string }` |
| --- | --- |
| 201 | created session with `status="in_progress"` |

### PUT `/api/sessions/:id`

Used to end a session. Body may include `{ status: "completed", endedAt }` — calls
`finalizeSession` which runs the scoring transaction, caches the composite score, and bumps
`practiceCount` on the (public) station.

### POST `/api/sessions/:id/item-results`

| Body | `{ itemId, status: "done" \| "missed", confidence?: number, transcriptExcerpt?: string }` |
| --- | --- |
| 201 | created row |

Cross-checks that the item belongs to the session's station.

### POST `/api/sessions/:id/question-results`

| Body | `{ questionId, studentAnswer: string, score?: number, correct?: boolean, feedback?: string }` |
| --- | --- |
| 201 | created row |

Same cross-check. Score fields are optional because the practice UI posts the raw answer and
the evaluator endpoint fills them in on request.

---

## AI (`/api/ai`)

Every route in this section stacks: `requireAuth → aiLimiter → aiDailyLimiter → dailySpendCap`.

### POST `/api/ai/transcribe`

| | |
| --- | --- |
| Content-Type | raw audio bytes (`audio/webm`, `audio/wav`, `audio/mp4`, etc.) |
| Max size | 26 MB |
| 200 | `{ text: string }` |

Whisper forced `language: "en"`. File extension inferred from declared Content-Type.

### POST `/api/ai/patient-respond`

| Body | `{ stationId, userText, history?: [{ role, text }] }` |
| --- | --- |
| 200 | `{ text, usage: { tokensIn, tokensOut, model } }` |

`gpt-4o` patient simulator. Diagnosis-leak filter + single retry. Per-user in-memory
simulator cache keyed by `userId:stationId` with 30-min TTL.

### POST `/api/ai/match-checklist`

| Body | `{ stationId, transcript: string }` |
| --- | --- |
| 200 | `{ hits: string[] }` (leaf item UUIDs) |

`gpt-4o-mini` JSON mode + embedding pre-filter.

### POST `/api/ai/evaluate-answer`

| Body | `{ questionId, studentAnswer }` |
| --- | --- |
| 200 | `{ score: number(0..1), correct: boolean, feedback: string }` |

### POST `/api/ai/evaluate-examiner-transcript`

| Body | `{ sessionId, transcript }` |
| --- | --- |
| 200 | `{ results: [{ questionId, score, correct, feedback }] }` |

Batched per-question grading used when examiner segment is not turn-separated (AI Conversation
mode).

### POST `/api/ai/speak`

| Body | `{ text, voice?: "nova" \| "onyx" \| ... }` |
| --- | --- |
| 200 | audio stream (`audio/mpeg`) |

`tts-1`. Default voice `nova`. Response is an audio stream, not JSON.

### POST `/api/ai/session-feedback`

| Body | `{ sessionId }` |
| --- | --- |
| 200 | `{ feedback: string }` |

`gpt-4o-mini`. Short constructive paragraph.

---

## Practice (`/api/practice`) — feature-flagged

All routes return 503 when `FEATURE_AI_PRACTICE_REAL` is not `1`. Same middleware stack as
`/api/ai`.

### POST `/api/practice/:sessionId/transcribe`

Raw audio, Whisper-backed. Content-Type picks the filename extension (`audio/webm → .webm`,
`audio/wav → .wav`, `audio/mp4 → .m4a`, fallback `.webm`). English forced.

### POST `/api/practice/:sessionId/patient-turn`

| Body | `{ userText, history?: [{ role, text }] }` |
| --- | --- |
| 200 | `text/event-stream` (SSE) with `data:` frames carrying partial text |

`gpt-4o` streaming. Final frame is `data: [DONE]`.

### POST `/api/practice/:sessionId/check`

| Body | `{ transcript: string }` |
| --- | --- |
| 200 | `{ hits: string[], confidences: number[] }` |
| 429 | per-session 25k-token cap reached; body `{ code: "token_cap" }` |

### POST `/api/practice/:sessionId/tts`

Same contract as `/api/ai/speak` but logs cost against the session.

---

## Gemini Live (`/api/gemini`)

Real-time voice. REST creates / manages sessions; a separate WebSocket carries audio.

### POST `/api/gemini/session`

| Body | `{ stationId, persona: "patient" \| "examiner" }` |
| --- | --- |
| 201 | `{ sessionId, wsPath: "/api/gemini/ws/:sid", persona, voice, model }` |

Stores ownership in `sessionOwners` (in-memory) so the WS upgrade handler can cross-check.

### WebSocket `/api/gemini/ws/:sessionId`

Upgrade handler re-parses the session cookie via `sessionMiddleware`, then verifies
`sessionOwners[sessionId] === req.session.passport.user`. Wire protocol (after open):

- Client → server binary frames: PCM-16 16 kHz mono mic audio.
- Server → client binary frames: PCM-16 24 kHz synthesized audio.
- Server → client text frames (JSON): `{ type: "input_transcript", text }`,
  `{ type: "output_transcript", text }`, `{ type: "turn_complete" }`, `{ type: "error", message }`.

### POST `/api/gemini/switch-persona/:sessionId`

| Body | `{ persona: "patient" \| "examiner" }` |
| --- | --- |
| 200 | `{ ok: true }` |

Re-primes the live session with the new persona without disconnecting.

### POST `/api/gemini/prime/:sessionId`

| Body | `{ text: string }` |
| --- | --- |
| 200 | `{ ok: true }` |

Injects an examiner prompt (e.g. a stored question) so the live voice will speak it next turn.

### DELETE `/api/gemini/session/:sessionId`

Closes the live session and flushes the accumulated `ai_costs` row.

---

## Mock Exams (`/api/mock-exams`)

### GET `/api/mock-exams`

Returns templates owned by the caller, each with `{ attemptCount, bestScore, averageScore,
lastAttemptedAt }`.

### GET `/api/mock-exams/:id`

Single template with station order and stats.

### POST `/api/mock-exams`

| Body | `{ title, restSeconds?: number, stations: [{ stationId, position }], practiceMode: "self_check" \| "ai_listen" \| "ai_conversation" }` |
| --- | --- |
| 201 | created template |

### PATCH `/api/mock-exams/:id`

Partial update of template. Reordering supported by sending the full station list.

### DELETE `/api/mock-exams/:id`

Deletes the template. Existing attempts are preserved (they keep station snapshots).

### GET `/api/mock-exams/:id/attempts`

List of attempts for this template, most recent first.

### POST `/api/mock-exams/:id/attempts`

| | |
| --- | --- |
| 201 | `{ attempt }` with `attemptNumber = MAX(prev)+1`, `status="in_progress"` |

DB unique index on `(userId, mockExamId, attemptNumber)` guarantees monotonicity.

### GET `/api/mock-exams/:id/attempts/:attemptId`

Full attempt with per-station progress and session ids.

### POST `/api/mock-exams/:id/attempts/:attemptId/advance`

| Body | `{ fromIndex: number, phase?: "rest" \| "station" }` |
| --- | --- |
| 200 | updated attempt |
| 409 | stale `fromIndex` — attempt has already advanced |

Optimistic-concurrency guard via `fromIndex` keeps a second tab from double-advancing.

### POST `/api/mock-exams/:id/attempts/:attemptId/abort`

Marks the attempt `aborted`, clears in-progress sessions.

### GET `/api/mock-exams/:id/results`

Legacy results route for the simplest attempt (most recent completed). Returns composite score
via `computeAttemptOverallScore`.

---

## Community Library (`/api/library`)

Limited by `libraryLimiter` (120/min). All reads are visibility-filtered to public rows and
star-decorated per user.

### GET `/api/library/stations`

| Query | `q?`, `type?`, `sort? = stars \| recent \| forks \| practice`, `limit?`, `offset?` |
| --- | --- |
| 200 | `{ stations: PublicStation[], hasMore: boolean }` |

`userId` is stripped from every row via `sanitizePublicStation`; `authorName` is included.

### GET `/api/library/collections`

Same shape for public collections.

### GET `/api/library/featured`

Curated list — hand-picked by admin action, falls back to top-starred.

### GET `/api/library/stations/:id`

Public station detail. Includes sections, items, media URLs, attached questions, star state
for caller.

### GET `/api/library/collections/:id`

Public collection detail with contained stations.

---

## Invites (`/api/invites`)

### GET `/api/invites/:token`

Public preview. Returns `{ collectionTitle, ownerName, role, expired, consumed }`. Does not
leak the collection contents.

### POST `/api/invites/:token/accept`

| | |
| --- | --- |
| Auth | required |
| 200 | `{ collectionId, role }` — idempotent on re-accept |
| 403 | `code: "email_mismatch"` — invite is bound to a different email (case-insensitive) |

Idempotent on the happy path — re-accepting returns 200 with the same membership.

---

## Reports (`/api/reports`)

### POST `/api/reports`

| | |
| --- | --- |
| Auth | required |
| Limits | `reportLimiter` (10/day) |
| Body | `{ targetType: "station" \| "collection" \| "user", targetId: string, reason: string(10..2000) }` |
| 201 | `{ report }` |

---

## Admin (`/api/admin`) — `requireAuth + requireAdmin`

### GET `/api/admin/reports`

| Query | `status? = pending \| dismissed \| removed` |
| --- | --- |
| 200 | `{ reports: ReportWithTargetInfo[] }` |

### PATCH `/api/admin/reports/:id`

| Body | `{ status: "dismissed" \| "removed", notes?: string }` |
| --- | --- |
| 200 | updated report |

When `status="removed"`, `forceUnpublishTarget` flips the target's `visibility` to `private`.

### POST `/api/admin/stations/:id/unpublish`

Force-unpublish a station. Used by an admin outside of a report context.

### POST `/api/admin/collections/:id/unpublish`

Same for collections.

### DELETE `/api/admin/stations/:id`

Hard delete. Cascades through sections, items, item media, examiner questions, stars, forks.

---

## Stats (`/api/stats`)

### GET `/api/stats`

| | |
| --- | --- |
| Auth | required |
| 200 | `{ sessionsThisWeek, sessionsThisMonth, totalMinutes, stationsPracticed, totalStations, currentStreak, bestImprovement }` |

`currentStreak` and `bestImprovement` are computed in parallel Drizzle queries.

---

## Uploads (`/api/uploads`)

### POST `/api/uploads/image`

| | |
| --- | --- |
| Auth | required |
| Content-Type | `multipart/form-data` with `file` field |
| 201 | `{ url: string }` |
| 415 | `code: "mime_mismatch"` |
| 507 | `code: "storage_quota_exceeded"` |

JPEG, PNG, WebP only. 5 MB per file, 500 MB total across the `uploads/items/` directory.
Magic-byte sniffer runs in addition to the declared MIME. Response URL is relative:
`/uploads/items/<uuid>.<ext>`.

---

## Response shapes (selected)

### `SanitizedUser`

```ts
{
  id: string;
  email: string;
  displayName: string;
  bio: string | null;
  isAdmin: boolean;
  createdAt: string;   // ISO-8601
}
```

### `Station` (list view)

```ts
{
  id: string;
  userId: string;
  title: string;
  type: "history_taking" | "physical_exam" | "communication"
      | "image_id" | "qa" | "custom"
      | "equipment_id" | "oral_qa";   // legacy
  visibility: "private" | "shared" | "public";
  difficulty: "easy" | "medium" | "hard" | null;
  timeLimitSeconds: number;
  starCount: number;
  forkCount: number;
  practiceCount: number;
  publishedAt: string | null;
  forkOf: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### `Session`

```ts
{
  id: string;
  userId: string;
  stationId: string;
  mockExamAttemptId: string | null;
  mode: "self_check" | "ai_history" | "ai_observer" | "ai_communication";
  status: "in_progress" | "completed" | "aborted";
  startedAt: string;
  endedAt: string | null;
  compositeScore: number | null;     // cached; canonical is buildSessionScoring
  createdAt: string;
}
```

### `Report`

```ts
{
  id: string;
  reporterId: string;
  targetType: "station" | "collection" | "user";
  targetId: string;
  reason: string;
  status: "pending" | "dismissed" | "removed";
  resolvedAt: string | null;
  createdAt: string;
}
```

Full Drizzle definitions in `shared/schema.ts`. Every table that appears in an API response is
enumerated there.

---

## Where to go next

- Request pipeline, middleware stacking, and error contract: `Documentation/BACKEND.md`.
- Auth model, spend cap, rate-limit numbers: `Documentation/SECURITY.md`.
- AI-specific routes in context: `Documentation/AI_ARCHITECTURE.md`.
