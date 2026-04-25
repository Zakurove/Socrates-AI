# AI Architecture

Socrates AI uses two model families: OpenAI (text, audio, embeddings) and Google Gemini
(real-time voice). All model IDs and prices live in `shared/ai-models.ts` so cost logs and the
spend-cap cannot drift from what is actually called. All AI calls are server-side.

## Model registry

From `shared/ai-models.ts`:

| Semantic name | Model ID | Pricing (USD / 1M tokens) | Used for |
| --- | --- | --- | --- |
| `patientSimulator` | `gpt-4o` | in $2.50 · out $10.00 | Standardized-patient reply (text turn + SSE stream). |
| `checklistMatcher` | `gpt-4o-mini` | in $0.15 · out $0.60 | Checklist hit/miss matcher over rolling transcript. |
| `examinerEvaluator` | `gpt-4o-mini` | same | Grading examiner-question answers. |
| `feedbackGenerator` | `gpt-4o-mini` | same | Short constructive feedback paragraph after a session. |
| `whisper` | `whisper-1` | flat per-minute | Speech-to-text. English forced. |
| `tts` | `tts-1` | flat per-minute | Socrates' voice playback. |
| `embedding` | `text-embedding-3-small` | in $0.02 · out $0 | Pre-filter for checklist matching. |
| `geminiLive` | `gemini-3.1-flash-live-preview` | in $0.30 · out $2.50 | Real-time bidirectional voice. |

`estimateCostUsd(model, tokensIn, tokensOut)` is the one function the server uses to convert a
model response into a dollar figure. The spend cap and the per-request `ai_costs` row both call
it, so the in-memory cap math equals the daily-sum math to the cent.

## Three AI pipelines

### 1. Self-check

No AI. The user ticks items themselves. Included for quiet environments, zero-cost practice,
and as the baseline mode for features like the public-station demo.

### 2. AI Listen (narration)

Rolling transcription + checklist matching. Target latency: transcript update every 3–5 s,
matcher update every 4–6 s. The user speaks freely; the UI ticks items as they light up.

```
MediaRecorder chunk
  └─▶ POST /api/practice/:sid/transcribe   (multipart or raw; language:"en")
        └─▶ services/speech-to-text.ts  (whisper-1)
              └─▶ transcript appended client-side
                    └─▶ debounced POST /api/practice/:sid/check
                          └─▶ services/checklist-matcher.ts
                                ├─ text-embedding-3-small pre-filter
                                └─ gpt-4o-mini JSON-mode matcher
                                      └─▶ { hits: [itemId...] } → UI ticks
```

Key implementation notes:

- Whisper is always called with `language: "en"`. Auto-detect produced Arabic transcripts in
  founder testing. See `server/routes/ai.ts` and `server/routes/practice.ts`.
- The matcher runs in JSON mode with a schema requiring `hits: string[]`. It grades only **leaf
  items** — parent items are rolled up from their leaves. See
  `server/services/checklist-matcher.ts`.
- An embedding pre-filter cuts the candidate pool before the `gpt-4o-mini` call — items whose
  embedding is below a cosine threshold with the current transcript are dropped. The model
  then only has to decide among the top-K semantically close items. This keeps the token cost
  per check below ~2k.
- Per-session token cap is 25,000 input tokens; after that `/check` returns a 429 and the
  client switches to local-only ticking. This is belt-and-braces on top of the daily spend
  cap.

### 3. AI Conversation (Gemini Live)

Real-time bidirectional voice with a patient or examiner persona.

```
Browser (Web Audio API, 16 kHz mic)
    │
    │  POST /api/gemini/session
    │     ─── returns { sessionId, persona, voice }
    │
    │  WS /api/gemini/ws/:sessionId  (cookie re-verified at upgrade)
    │     ─── binary frames: mic audio in  ↔  synthesized audio out (24 kHz)
    │     ─── JSON frames: input/output transcription, turn events
    │
    │  REST (while WS open):
    │     POST /api/gemini/switch-persona/:sid    patient ⇌ examiner
    │     POST /api/gemini/prime/:sid             inject examiner prompt
    │     DELETE /api/gemini/session/:sid         close + flush cost
    │
Server (services/gemini-live.ts)
    │  @google/genai bidi stream to gemini-3.1-flash-live-preview
    │  responseModalities: [AUDIO]
    │  outputAudioTranscription: {}   (so we can score what the patient said)
    │  inputAudioTranscription:  {}   (so we can score what the candidate said)
    │  voice: Aoede (patient) · Charon (examiner)
    │  systemInstruction: persona prompt + station briefing + diagnosis-leak filter
```

### Session-end flow (all three modes)

```
PUT /api/sessions/:id { status:"completed", endedAt }
   └─▶ storage.finalizeSession (transaction)
         ├─ buildSessionScoring  ← re-aggregate from item_results / examiner_question_results
         ├─ update sessions row with composite score
         ├─ if station public → stations.practiceCount += 1  (best-effort)
         └─ return final scoring tree

POST /api/ai/session-feedback       ← gpt-4o-mini, 1 paragraph
POST /api/ai/evaluate-examiner-transcript  ← gpt-4o-mini, per-question rubric
```

The composite score is recomputed on every GET `/api/sessions/:id` — the value stored on
`sessions` is a cached convenience, and `buildSessionScoring` always re-aggregates from source
tables. This is what lets a user edit their station after a session without corrupting past
results.

## Prompting strategy

Four prompt families, each in its own service file.

### Patient simulator — `server/services/patient-simulator.ts`

System prompt enforces:

- 1 to 3 sentences per reply.
- Lay language. No medical vocabulary unless the candidate uses it first.
- Answer only what was asked — no volunteering.
- Never state a diagnosis, differential, or investigation result unless explicitly in the
  briefing.

A diagnosis-leak filter post-processes the response. `BLOCKED_DIAGNOSIS_TERMS` is a list of
roughly 80 common keywords (`"MI"`, `"stroke"`, `"appendicitis"`, etc.). If the response
contains any term, the service retries with a stricter prompt reminding the model to stay in
character as a patient who does not know the diagnosis. If the second attempt still leaks, the
term is replaced with a neutral phrase.

Parameters: `max_tokens: 200`, `temperature: 0.7`. Per-station simulator history is cached in
memory keyed by `userId:stationId` with a 30-minute TTL so multi-turn flows stay cheap.
`invalidateSimulatorCache(userId, stationId)` is called when a station is edited.

### Checklist matcher — `server/services/checklist-matcher.ts`

- JSON-mode call to `gpt-4o-mini`.
- Schema: `{ hits: string[] }` where each string is a leaf-item UUID.
- Prompt includes only the leaf items as an enumerated list; parents are hidden from the model
  because rollup is computed deterministically.
- Transcript window: latest 1200 tokens. Older content is pruned to keep per-request tokens
  bounded.
- Embedding pre-filter: `text-embedding-3-small` computes a vector for the transcript window
  and for each item title+explanation. Top-K by cosine similarity is passed to the matcher;
  the rest are excluded.

### Examiner evaluator — `server/services/examiner-evaluator.ts`

Two call shapes:

- `evaluateAnswer` — one question, one student answer, returns `{ score: 0-1, correct: bool,
  feedback: string }`.
- `evaluateExaminerTranscript` — the full transcript plus every examiner question, returns
  a row per question. Used in AI Conversation mode where the examiner segment is interleaved
  and not cleanly turn-separated.

Both use `gpt-4o-mini` JSON mode. The rubric is the user's own answer field on each question —
the evaluator does not apply a universal standard.

### Feedback generator — `server/services/feedback-generator.ts`

Single `gpt-4o-mini` call. Input: the scoring summary (coverage, critical-miss count,
examiner-question results, time used). Output: a 2–4 sentence paragraph in the style of a kind
attending. System prompt explicitly forbids vague praise — the model is told to call out one
specific strength and one specific thing to improve.

## Cost accounting

`ai_costs` table (migration `0011_ai_costs_user_id.sql` added `user_id`):

| Column | Purpose |
| --- | --- |
| `id` | PK. |
| `userId` | Set on every insert. Enables per-user spend sum. |
| `model` | One of the `ModelId` values. |
| `tokensIn`, `tokensOut` | As reported by the model response. `0` for whisper/tts where unit is minutes. |
| `costUsd` | Rounded to 6 decimals. Computed by `estimateCostUsd`. |
| `route` | The Express path that triggered the cost. E.g. `"/api/ai/patient-respond"`. |
| `createdAt` | `now()`. |

Every AI service returns `{ result, usage: { tokensIn, tokensOut, model } }`. The calling route
handler calls `storage.logAiCost` after the response is read. Failures in cost logging are
swallowed — they must never break the user's request — but they are logged via `console.error`.

Gemini Live cost is batched. `services/gemini-live.ts` accumulates token counts per session and
flushes a single `ai_costs` row in the `onClose` handler (or via the explicit DELETE). A
disconnected WebSocket also triggers a flush.

### Daily spend cap

- `AI_DAILY_SPEND_CAP_USD` (default $5) is enforced per user.
- `dailySpendCap` middleware (`server/middleware/spend-cap.ts`) calls
  `getUserSpendLast24h(userId)` which does a `SELECT COALESCE(SUM(cost_usd), 0) FROM ai_costs
  WHERE user_id = $1 AND created_at > now() - interval '24 hours'`.
- Result is cached in memory for 60 seconds per user. `invalidateSpendCache(userId)` is called
  after every successful `logAiCost` so the next request sees the fresh total within seconds.
- When over the cap, the middleware returns HTTP 429 with
  `{ message, code: "daily_spend_cap", capUsd, spentUsd }`.
- The client switches on `code === "daily_spend_cap"` and renders a dialog pointing the user at
  their settings and a "tomorrow" resume message.

## Why Gemini Live (not OpenAI Realtime)

Decision, not a placeholder. Three reasons driven by founder testing:

1. **First-token audio latency.** Gemini Live had measurably lower first-audio latency in
   founder tests, which matters for OSCE where the patient should feel interrupting-responsive,
   not Siri-pausing.
2. **Output-audio transcription.** Gemini Live returns input and output transcripts as a
   first-class feature (`outputAudioTranscription: {}`). That transcript is the input to the
   scoring pipeline after the session — the whole post-session feedback flow depends on it.
3. **Cost profile.** At $0.30/1M input tokens, Gemini Live is meaningfully cheaper than the
   GPT-4o Realtime pricing for the volume Socrates expects during an 8-minute history-taking
   station.

The commitment is reviewable. If Gemini Live quality degrades or pricing changes, swapping is
localized to `server/services/gemini-live.ts` — the WS protocol between client and server is
our own, not Gemini's.

## Whisper — why English-only at every call site

Every Whisper call is hard-pinned to `language: "en"`. This is checked in code review for every
new call site. Context:

- Auto-detect was returning Arabic transcripts mid-session when the founder (a native Arabic
  speaker) code-switched for a single word, or when background noise was parsed as speech.
- Arabic transcripts do not match English checklist items, so the matcher silently failed.
- The fix: explicit `language: "en"` in `POST /api/ai/transcribe` and
  `POST /api/practice/:sessionId/transcribe`. See `server/routes/ai.ts` and
  `server/routes/practice.ts`.
- The app does not support Arabic UI or Arabic content (see `Documentation/OVERVIEW.md` "What
  the app deliberately does NOT do"). This is the matching technical decision.

## Rate limits (review)

AI surface is protected by a three-layer chain:

1. `aiLimiter` — 30/min per user. Catches pathologically tight loops.
2. `aiDailyLimiter` — 500/day per user. Catches stuck clients.
3. `dailySpendCap` — catches expensive long-prompt abuse that would slip under request caps.

The per-session 25k-token cap on `/api/practice/:sid/check` is a fourth layer specific to
narration mode.

## Where to go next

- Route shapes for every AI endpoint: `Documentation/API_REFERENCE.md`.
- Rate-limit + spend-cap threat model: `Documentation/SECURITY.md`.
- Service files listed in `Documentation/BACKEND.md` "File layout".
