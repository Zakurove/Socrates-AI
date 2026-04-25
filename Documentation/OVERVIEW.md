# Socrates AI — Overview

Socrates AI is an OSCE practice partner for medical students and residents. It lets a candidate
build their own exam stations, then rehearse them out loud with a voice-driven AI that plays the
patient or the examiner. The app is tool-first: there is no pre-built station catalogue. Users
create their own stations from their notes, course material, or exam syllabus, and optionally
publish them to a community library.

This document is the product-level orientation. For engineering detail see
`Documentation/ARCHITECTURE.md`, `Documentation/BACKEND.md`, `Documentation/FRONTEND.md`, and
`Documentation/AI_ARCHITECTURE.md`.

## Who it is for

- Medical students preparing for clinical-skills exams (OSCE, Clinical Skills Assessment, MCCQE
  Part II, USMLE Step 2 CS-style formats).
- Residents rehearsing scenarios for in-training exams and exit exams (Royal College of
  Physicians and Surgeons of Canada, ABMS member boards, Arab Board, etc.).
- Clinical educators who want to author scenarios once and share them with a cohort.

The founder — Nasser Alharbi, Canadian Physiatry Resident — is the primary reference user. The
pain point that seeded the app: OSCE practice requires a partner to stand in as the patient or
examiner, and a partner is rarely available at 11 pm the night before a station. Socrates plays
the partner and keeps its mouth shut about the diagnosis.

## Product philosophy

1. **Tool, not content.** The app does not ship a station library. It ships an editor, a
   simulator, and a feedback engine. Users own their content. The community library (shipped
   2026-04-18) lets users share what they wrote — it is not a curated catalogue authored by the
   Socrates team.
2. **Voice-first practice.** A clinical skills exam is spoken. Typing defeats the point.
   Whisper-based STT, an LLM patient, and TTS playback keep the user's hands free and their
   mouth moving.
3. **Brevity in the AI.** The simulator speaks like a real patient — 1 to 3 sentences, lay
   language, no volunteering. See `server/services/patient-simulator.ts`.
4. **The candidate writes the rubric.** Every station is owned by the user who made it. The
   checklist is their rubric. Socrates grades against that rubric, not against a universal one.
5. **Founder-reviewed English only.** Whisper is pinned to `language: "en"` at every call site
   because auto-detect was producing Arabic transcripts mid-session. See
   `server/routes/ai.ts` and `server/routes/practice.ts` where this is enforced.

## Vocabulary (canonical)

Use these terms in code, UI, and documentation:

| Term | Meaning |
| --- | --- |
| **Station** | One OSCE practice unit. Has a title, scenario, time limit, and a checklist. |
| **Collection** | A named group of Stations. Can be shared with other users. |
| **Section** | A named group within a Station (e.g. "Inspection", "Palpation"). |
| **Item** | A single checklist entry inside a Section. May contain sub-items (up to 2 levels). |
| **Sub-item** | A child checklist entry underneath an Item. |
| **Examiner Questions** | The Q and A portion at the end of a station. Never called "Viva". |
| **Session** | One practice run through a Station. Produces a transcript and scores. |
| **Mock Exam** | A timed multi-station circuit with an enforced rest period between stations. |
| **Socrates** | The AI persona. Always capitalised. |

Legacy enum values (`equipment_id`, `oral_qa`) exist in Postgres for backwards compatibility
only — see `shared/schema.ts` `stationTypeEnum`. Do not create new rows with those values.

## Station taxonomy

A Station has a `type`. The type drives smart defaults (time limit, whether a patient briefing
exists, whether AI patient is enabled). See `shared/schema.ts` `STATION_TYPES` and
`getStationTypeDefaults`.

- `history_taking` — AI patient on, 8 min default.
- `physical_exam` — AI patient off, 7 min default. The user narrates what they would do.
- `communication` — AI patient on, 10 min default. Breaking-bad-news style scenarios.
- `image_id` — AI patient off, 5 min default. Anatomy or radiograph identification.
- `qa` — Examiner-questions-only, 5 min default. Rapid-fire viva-style drills.
- `custom` — Fully user-defined.

## User journey

### 1. Register

Users create an account with email, password (minimum 10 characters), and display name.
Registration auto-logs in and regenerates the session to prevent fixation. Password reset flow
is available at `/auth/forgot` and `/auth/reset/:token` — the reset token is hashed with SHA-256
before storage, and the email delivery goes through Resend. See `server/routes/auth.ts`.

There is no guest mode.

### 2. Create a Station

From `/my-stations`, the user opens the editor (`/station/new`). The editor walks the user
through title and type, then lets them build a checklist section by section. Items can have
sub-items two levels deep, critical flags, point weights, explanations, and attached media
(images, videos). Drafts are cached in localStorage so a tab crash does not destroy an hour of
work. See `client/src/lib/editor-draft.ts` and `client/src/pages/StationEditorPage.tsx`.

If the station has a patient (history, communication), the user fills in a hidden patient
briefing. This briefing is the entire reality of the AI patient — it is never shown to the
candidate during practice.

### 3. Practice in one of three modes

Every Station can be practised in three modes:

- **Self-check (silent).** No AI. User walks through the checklist, ticking items themselves.
  Used when the user is in a quiet place or does not want to spend AI credits.
- **AI Listen (narration).** The user narrates aloud. The app transcribes with Whisper, sends
  the rolling transcript to the checklist matcher (`gpt-4o-mini`), and the checklist ticks
  itself in near-real-time. See `server/routes/practice.ts`.
- **AI Conversation.** Powered by Gemini Live. Real-time bidirectional audio with a patient or
  examiner persona. The user speaks, the patient replies aloud, and Gemini's output
  transcription is logged for later scoring. See `server/services/gemini-live.ts` and
  `server/routes/gemini.ts`.

All three modes share the same scoring pipeline. See `shared/scoring.ts` and
`server/services/session-scoring.ts`.

### 4. Review feedback

When time is up or the user ends the session, the app:

1. Calls `generateSessionFeedback` (`gpt-4o-mini`) to produce a short, constructive feedback
   paragraph in the style of a kind attending.
2. Evaluates examiner-question answers (`evaluateExaminerTranscript` or per-question
   `evaluateAnswer`).
3. Computes a composite score using `computeCompositeScore` in `shared/scoring.ts`.

The user lands on `/session/:id/results` with a breakdown: checklist coverage, critical items
missed, examiner-question scores, and the generated feedback paragraph.

### 5. Build progress over time

The `/progress` page (backed by `GET /api/stats`) shows:

- Sessions this week and this month.
- Total practice minutes.
- Stations practised out of total stations authored.
- Current daily streak.
- Best single-session improvement (same-station attempt-over-attempt delta).

### 6. Run a Mock Exam

Users assemble Stations they own into a Mock Exam template (`/mock-exam/new`). The template
pins a practice mode (`self_check`, `ai_listen`, or `ai_conversation`) for the whole circuit.
Starting an attempt creates a `mock_exam_attempts` row and steps the user through each station
with an enforced rest period. The results page composites per-station scores into an overall
attempt score. See `server/routes/mockExams.ts`.

### 7. Share via the Community Library

After a station has content (title plus at least one item or one examiner question), the owner
can publish it to the community library. Other signed-in users can browse, fork, star, and
report. Three roles on Collections (`owner`, `editor`, `viewer`) and three visibilities on both
Stations and Collections (`private`, `shared`, `public`) — see the data model in
`Documentation/ARCHITECTURE.md`.

The library is sign-in gated. Published content is licensed CC-BY 4.0 (attestation enforced at
publish time in the Publish dialog).

## Session, Mock Exam, and sharing at a glance

```
Station (owned by a user)
 ├─ Section ── Item ── Sub-item ── Sub-item
 ├─ Examiner Questions (free_text | multiple_choice | multi_select)
 └─ visibility: private | shared | public
        │
        ├── Collection (groups stations; has role-based members)
        │     ├─ visibility: private | shared | public
        │     └─ owner | editor | viewer
        │
        └── Session (one practice run)
              ├─ mode: self_check | ai_history | ai_observer | ai_communication
              ├─ item_results (per-item coverage)
              ├─ examiner_question_results (per-question score)
              └─ optional mock_exam_attempt_id
```

## AI personas

| Persona | Model | Purpose |
| --- | --- | --- |
| Standardized patient (text turn) | `gpt-4o` | `POST /api/ai/patient-respond` — non-streaming back-and-forth reply. |
| Standardized patient (streamed) | `gpt-4o` | `POST /api/practice/:sessionId/patient-turn` — SSE stream during narration mode. |
| Standardized patient (real-time voice) | `gemini-3.1-flash-live-preview` | `POST /api/gemini/session` → WS `/api/gemini/ws/:sessionId`. |
| Examiner (real-time voice) | `gemini-3.1-flash-live-preview` | Persona `"examiner"` on the same endpoint. |
| Checklist matcher | `gpt-4o-mini` | `POST /api/practice/:sessionId/check` and `POST /api/ai/match-checklist`. |
| Examiner-answer grader | `gpt-4o-mini` | `POST /api/ai/evaluate-answer` and `POST /api/ai/evaluate-examiner-transcript`. |
| Session feedback writer | `gpt-4o-mini` | `POST /api/ai/session-feedback`. |
| Speech-to-text | `whisper-1` | `POST /api/ai/transcribe` and `POST /api/practice/:sessionId/transcribe`. English forced. |
| Text-to-speech | `tts-1` | `POST /api/ai/speak` and `POST /api/practice/:sessionId/tts`. |
| Embedding | `text-embedding-3-small` | Pre-filter for checklist matching. |

All IDs and prices live in `shared/ai-models.ts`.

## What the app deliberately does NOT do

- No pre-built station library maintained by the Socrates team.
- No Arabic localisation. English only in the UI and in Whisper.
- No free-tier scraping of published content — the library requires authentication.
- No diagnosis from the AI patient. The diagnosis term filter in
  `server/services/patient-simulator.ts` blocks roughly 80 common keywords and retries with a
  stricter prompt if a leak is detected.
- No multi-owner collections. A Collection has exactly one owner in v1. Transfer is not yet
  supported.
- No guest mode. Every action that produces data requires an account.

## Safety, privacy, and cost guardrails

- Per-user daily AI spend cap (default $5/day, configurable via `AI_DAILY_SPEND_CAP_USD`). See
  `server/middleware/spend-cap.ts` and `Documentation/SECURITY.md`.
- Per-route rate limits (auth, AI, library, reports). See `server/middleware/rate-limit.ts`.
- Session cookies are HTTP-only, `sameSite=strict`, and `secure` in production.
- Password hashing uses bcrypt with 12 rounds and a dummy-hash timing equaliser when the email
  is unknown, so attackers cannot distinguish "user exists" from "wrong password" by latency.
- Moderation queue at `/admin/reports` is gated by `users.is_admin`. Admins are promoted by
  explicit SQL only — registration does not auto-promote. The legacy `ADMIN_EMAILS` env var is
  deprecated; see `Documentation/DEPLOYMENT.md`.
- Published content attests to CC-BY 4.0, original authorship, and no PHI.

## Platform status

- Feature-complete; first production deployment to **Railway** (Node + managed Postgres).
- Final form factor will be a mobile app via Capacitor; the frontend is already laid out inside
  a 440 px phone-frame so the visual language stays stable during the port. See
  `client/src/App.tsx` `phone-frame` block and `Documentation/FRONTEND.md`.
- All AI runs server-side. The client never holds an API key.

## Where to go next

- Architecture diagrams and request flow: `Documentation/ARCHITECTURE.md`.
- Express routes and middleware: `Documentation/BACKEND.md` and `Documentation/API_REFERENCE.md`.
- React app structure: `Documentation/FRONTEND.md`.
- AI pipelines and cost: `Documentation/AI_ARCHITECTURE.md`.
- Visual identity: `Documentation/BRAND_GUIDELINES.md`.
- Hardening and threat model: `Documentation/SECURITY.md`.
- Test strategy: `Documentation/TESTING.md`.
- Environment and rollout: `Documentation/DEPLOYMENT.md`.
