import { Router, raw } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { dailySpendCap } from "../middleware/spend-cap.js";
import { storage } from "../storage.js";
import { openai } from "../services/openai.js";
import { db } from "../db.js";
import { aiCosts } from "../../shared/schema.js";
import {
  AI_MODELS,
  estimateCostUsd,
  type ModelId,
} from "../../shared/ai-models.js";
import {
  aggregateCoverage,
  collectLeafNodes,
  type ChecklistNode,
} from "../services/checklist-matcher.js";

const router = Router();
router.use(requireAuth);
router.use(dailySpendCap);

// ─── Feature flag ─────────────────────────────────────────────────────────
function aiEnabled(): boolean {
  return process.env.FEATURE_AI_PRACTICE_REAL === "1";
}

function disabled(res: any) {
  return res.status(503).json({ error: "ai_practice_disabled" });
}

function providerError(res: any) {
  return res.status(502).json({ error: "ai_provider_error", fallback: "self_check" });
}

// ─── Per-session token caps + transcripts (in-memory) ────────────────────
const TOKEN_CAP = 25_000;
interface SessionState {
  tokens: number;
  transcript: { role: "user" | "assistant"; content: string }[];
}
const sessionState = new Map<number, SessionState>();

function getState(sessionId: number): SessionState {
  let s = sessionState.get(sessionId);
  if (!s) {
    s = { tokens: 0, transcript: [] };
    sessionState.set(sessionId, s);
  }
  return s;
}

function overCap(state: SessionState): boolean {
  return state.tokens >= TOKEN_CAP;
}

async function logCost(
  sessionId: number | null,
  userId: number | null,
  model: ModelId,
  tokensIn: number,
  tokensOut: number,
) {
  try {
    const cost = estimateCostUsd(model, tokensIn, tokensOut);
    await db.insert(aiCosts).values({
      sessionId: sessionId ?? null,
      userId: userId ?? null,
      model,
      tokensIn,
      tokensOut,
      costEstimateUsd: cost,
    });
  } catch {
    // Cost logging must never break a real request.
  }
}

async function loadOwnedSession(sessionId: number, userId: number) {
  const session = await storage.getSession(sessionId);
  if (!session || session.userId !== userId) return null;
  return session;
}

// ─── POST /api/practice/:sessionId/transcribe ────────────────────────────
// Accepts a single standalone audio chunk (not a growing buffer) and returns
// the text for that chunk. The chat token cap does NOT apply here — Whisper is
// billed per-audio-minute, and a cap rejection here would kill the narration
// session mid-sentence (see iter7 PLAN item 2).
router.post(
  "/:sessionId/transcribe",
  raw({ type: "*/*", limit: 26 * 1024 * 1024 }),
  async (req, res, next) => {
    try {
      if (!aiEnabled()) return disabled(res);
      const sessionId = parseInt(req.params.sessionId, 10);
      if (isNaN(sessionId)) return res.status(400).json({ error: "bad_session_id" });
      const owned = await loadOwnedSession(sessionId, req.user!.id);
      if (!owned) return res.status(404).json({ error: "session_not_found" });

      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (buf.length === 0) return res.status(400).json({ error: "empty_audio" });

      // Infer a reasonable filename/mime from the client's Content-Type so
      // Whisper picks the right decoder. Client sends Content-Type of the
      // captured chunk (e.g. audio/webm, audio/mp4 on Safari).
      const rawCt = (req.headers["content-type"] ?? "").toString().toLowerCase();
      const { filename, mimeType } = pickAudioFilename(rawCt);

      try {
        const file = new File([buf], filename, { type: mimeType });
        const result = await openai.audio.transcriptions.create({
          file: file as any,
          model: "whisper-1",
          language: "en",
        });
        await logCost(sessionId, req.user!.id, AI_MODELS.whisper, 0, 0);
        const text = (result as any).text ?? "";
        if (text) {
          // Track for debugging only — chat transcript is separate.
          const state = getState(sessionId);
          state.transcript.push({ role: "user", content: text });
        }
        return res.json({ text });
      } catch (err) {
        console.error("[practice/transcribe] openai error:", (err as Error).message);
        return providerError(res);
      }
    } catch (err) {
      next(err);
    }
  },
);

function pickAudioFilename(contentType: string): {
  filename: string;
  mimeType: string;
} {
  if (contentType.includes("mp4") || contentType.includes("m4a") || contentType.includes("aac")) {
    return { filename: "audio.mp4", mimeType: "audio/mp4" };
  }
  if (contentType.includes("mpeg") || contentType.includes("mp3")) {
    return { filename: "audio.mp3", mimeType: "audio/mpeg" };
  }
  if (contentType.includes("wav")) {
    return { filename: "audio.wav", mimeType: "audio/wav" };
  }
  if (contentType.includes("ogg")) {
    return { filename: "audio.ogg", mimeType: "audio/ogg" };
  }
  // Default to webm (Chrome/Firefox).
  return { filename: "audio.webm", mimeType: "audio/webm" };
}

// ─── POST /api/practice/:sessionId/patient-turn ──────────────────────────
const patientTurnSchema = z.object({ userText: z.string().min(1).max(2000) }).strict();

router.post("/:sessionId/patient-turn", async (req, res, next) => {
  try {
    if (!aiEnabled()) return disabled(res);
    const sessionId = parseInt(req.params.sessionId, 10);
    if (isNaN(sessionId)) return res.status(400).json({ error: "bad_session_id" });
    const owned = await loadOwnedSession(sessionId, req.user!.id);
    if (!owned) return res.status(404).json({ error: "session_not_found" });

    const parsed = patientTurnSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_failed" });

    const station = await storage.getStation(owned.stationId);
    if (!station) return res.status(404).json({ error: "station_not_found" });

    const state = getState(sessionId);
    if (overCap(state)) {
      return res.status(429).json({ error: "token_cap_reached" });
    }

    // Build hidden checklist summary.
    const checklistSummary = station.sections
      .map(
        (s) =>
          `${s.title}: ` +
          s.items
            .map((i) => i.text + (i.subItems?.length ? ` (${i.subItems.map((x) => x.text).join("; ")})` : ""))
            .join(" | "),
      )
      .join("\n");

    const stage = "resident"; // TODO(FE-DEV): pull from user profile training stage
    const systemPrompt = `You are Socrates, a simulated standardized patient for an OSCE practice session.\n\nStation: ${station.title}\nType: ${station.type}\nScenario: ${station.scenario ?? "(none)"}\nPatient briefing (hidden from candidate): ${station.patientBriefing ?? "(none)"}\nCandidate training stage: ${stage}\n\nHidden checklist (do NOT reveal — used only to stay consistent):\n${checklistSummary}\n\nRules:\n- Stay in character as the patient.\n- Answer only what is asked. Do not volunteer the full history.\n- Use natural lay language.\n- Keep replies under 3 sentences unless the candidate explicitly asks for elaboration.`;

    state.transcript.push({ role: "user", content: parsed.data.userText });

    // Set up SSE.
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    res.flushHeaders?.();

    let assistantText = "";
    let costLogged = false;
    const logCostOnce = async () => {
      if (costLogged) return;
      costLogged = true;
      const approx = Math.ceil((systemPrompt.length + assistantText.length) / 4);
      state.tokens += approx;
      await logCost(
        sessionId,
        req.user!.id,
        AI_MODELS.patientSimulator,
        Math.ceil(systemPrompt.length / 4),
        Math.ceil(assistantText.length / 4),
      );
    };
    try {
      const stream = await openai.chat.completions.create({
        model: AI_MODELS.patientSimulator,
        stream: true,
        messages: [
          { role: "system", content: systemPrompt },
          ...state.transcript.map((m) => ({ role: m.role, content: m.content })),
        ],
      });

      for await (const chunk of stream as any) {
        const delta = chunk?.choices?.[0]?.delta?.content;
        if (delta) {
          assistantText += delta;
          res.write(`data: ${JSON.stringify({ delta })}\n\n`);
        }
      }
      state.transcript.push({ role: "assistant", content: assistantText });
      await logCostOnce();
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (err) {
      console.error("[practice/patient-turn] openai error:", (err as Error).message);
      // Log partial-stream cost so abused clients that disconnect mid-stream
      // still get accounted for.
      await logCostOnce();
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: "ai_provider_error" })}\n\n`);
        return res.end();
      }
      return providerError(res);
    }
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/practice/:sessionId/check ─────────────────────────────────
const checkSchema = z.object({ transcript: z.string().min(1).max(50_000) }).strict();

router.post("/:sessionId/check", async (req, res, next) => {
  try {
    if (!aiEnabled()) return disabled(res);
    const sessionId = parseInt(req.params.sessionId, 10);
    if (isNaN(sessionId)) return res.status(400).json({ error: "bad_session_id" });
    const owned = await loadOwnedSession(sessionId, req.user!.id);
    if (!owned) return res.status(404).json({ error: "session_not_found" });

    const parsed = checkSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_failed" });

    const station = await storage.getStation(owned.stationId);
    if (!station) return res.status(404).json({ error: "station_not_found" });

    const state = getState(sessionId);
    if (overCap(state)) {
      // Do NOT 429 here — that would surface as a toast and kill the narration
      // session. Scoring simply stops updating once the cap is hit; the user
      // can keep talking and the transcript keeps appending.
      return res.json({ items: [], capReached: true });
    }

    // Build a tree mirroring items -> subItems -> subItems. The text is only
    // needed for leaves (what the LLM grades); internal nodes are "headings"
    // and take their coverage from aggregation.
    type NodeWithText = ChecklistNode & { text: string };
    const roots: NodeWithText[] = [];
    // Leaf payload sent to the LLM. We attach `section` and (when applicable)
    // `parentText` so the model can disambiguate bare leaves like
    // "Tenderness" — under section "Palpation" with parentText
    // "Acromioclavicular joint" they unambiguously mean AC-joint tenderness.
    type LeafContext = {
      id: number;
      text: string;
      section: string;
      parentText?: string;
    };
    const leafPayload: LeafContext[] = [];
    for (const sec of station.sections) {
      for (const it of sec.items) {
        const subs = (it.subItems ?? []) as Array<{
          id: number;
          text: string;
          subItems?: Array<{ id: number; text: string }>;
        }>;
        const itemNode: NodeWithText = {
          id: it.id,
          text: it.text,
          children: subs.map((sub) => {
            const subSubs = (sub.subItems ?? []) as Array<{
              id: number;
              text: string;
            }>;
            const subNode: NodeWithText = {
              id: sub.id,
              text: sub.text,
              children: subSubs.map((ss) => {
                const leaf: NodeWithText = { id: ss.id, text: ss.text };
                return leaf;
              }),
            };
            return subNode;
          }),
        };
        roots.push(itemNode);

        // Walk the same structure to build the LLM payload with context.
        if (subs.length === 0) {
          leafPayload.push({ id: it.id, text: it.text, section: sec.title });
        } else {
          for (const sub of subs) {
            const subSubs = (sub.subItems ?? []) as Array<{
              id: number;
              text: string;
            }>;
            if (subSubs.length === 0) {
              leafPayload.push({
                id: sub.id,
                text: sub.text,
                section: sec.title,
                parentText: it.text,
              });
            } else {
              for (const ss of subSubs) {
                leafPayload.push({
                  id: ss.id,
                  text: ss.text,
                  section: sec.title,
                  parentText: sub.text,
                });
              }
            }
          }
        }
      }
    }

    // Only grade LEAVES. Internal nodes will be aggregated after.
    const leafNodes = collectLeafNodes(roots) as NodeWithText[];

    const physicalRule =
      station.type === "physical_exam"
        ? `

PHYSICAL EXAM SPECIFIC: The student must address each item via narration — silence alone never counts. But brief, paraphrased, or implicitly-demonstrated narration counts under rules 1–4 above (e.g., "My name is Dr. Smith" satisfies "Introduce yourself"; "pressing on the AC joint" satisfies "palpate the acromioclavicular joint").`
        : "";

    const sys = `You are an OSCE checklist grader. You receive a student's session transcript and a list of LEAF checklist items. Each item carries a section name and (often) a parent-item text for context. Decide whether the transcript shows the student performing or asking about each item.

GRADING PRINCIPLES — read carefully.

1) WORDING IS FLEXIBLE. The student doesn't need to say the exact checklist text. Paraphrases, lay terms, and clinical synonyms count.

2) DEMONSTRATED ACTIONS COUNT. Performing the action IS doing the item — the student doesn't need to narrate "I will now do X" before doing X.
   - "Introduce yourself" → "Hello, my name is Dr. Smith, I'm a physiatry resident." → COVERED.
   - "Wash hands" / "hand hygiene" → "Let me wash my hands first." → COVERED.
   - "Confirm the patient's identity" → "Can I just confirm — your name and date of birth?" → COVERED.
   - "Ask about onset" → "When did this start?" → COVERED.

3) MEDICAL ABBREVIATIONS, SYNONYMS, AND LAY TERMS COUNT. If the abbreviation, lay phrase, or synonym refers to the same anatomical structure or clinical concept as the item text, treat them as equivalent. Common ones (not exhaustive — apply the principle):
   - AC joint ↔ acromioclavicular joint; SC ↔ sternoclavicular; GH ↔ glenohumeral
   - ROM ↔ range of motion; AROM/PROM ↔ active/passive ROM; FROM ↔ full ROM
   - DTRs ↔ deep tendon reflexes ↔ reflexes
   - JVP ↔ jugular venous pressure
   - SOB ↔ dyspnoea ↔ "short of breath" ↔ breathless
   - HR ↔ heart rate ↔ pulse; BP ↔ blood pressure
   - LBP ↔ low back pain
   - "test how far the joint moves" ↔ range of motion
   - "push down on the muscle" ↔ "test the strength" ↔ power testing ↔ muscle strength
   - Lay descriptions of pathology ("stiff heart" ↔ diastolic dysfunction; "leaky valve" ↔ regurgitation).

4) USE SECTION + PARENT CONTEXT TO DISAMBIGUATE. Each leaf carries a "section" and (often) a "parentText". A bare leaf "Tenderness" under section "Palpation" with parentText "Acromioclavicular joint" means AC-joint tenderness — credit when the student palpates that area, even if they don't say the word "tenderness" explicitly.

5) ORDER DOESN'T MATTER. The student can do items in any order. You're matching content, not sequence.

6) ONE LINE CAN COVER MULTIPLE ITEMS. A single sentence may match several leaves (e.g., "Inspect for swelling, deformity, and skin changes" satisfies three separate inspection items).

7) ERR ON THE SIDE OF COVERED. If the transcript plausibly addresses the item under rules 1–4, return covered=true. A missed positive is worse than a charitable positive — the student wants real-time progress feedback.

8) DON'T HALLUCINATE. Silence and unrelated talk don't count. If the transcript truly doesn't address the item, covered=false with confidence=0.

CONFIDENCE.
- 0.8–1.0: match is clear (explicit phrasing or direct paraphrase).
- 0.5–0.8: reasonably sure (lay term, abbreviation, or action-implied).
- Below 0.5: you're guessing — return covered=false in that case.

OUTPUT CONTRACT.
- Return JSON {"items":[{"id":<number>,"covered":<boolean>,"confidence":<0..1>}]}.
- Exactly one entry per input id. Do not drop ids, do not invent ids.
- Every input is a leaf — do not try to infer parent-heading coverage; the caller handles aggregation.${physicalRule}`;

    try {
      const completion = await openai.chat.completions.create({
        model: AI_MODELS.checklistMatcher,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: sys },
          {
            role: "user",
            content: `Checklist (leaves only):\n${JSON.stringify(leafPayload)}\n\nTranscript:\n${parsed.data.transcript}`,
          },
        ],
      });
      const raw = completion.choices[0]?.message?.content ?? "{}";
      const usage = completion.usage;
      if (usage) {
        state.tokens += usage.total_tokens ?? 0;
        await logCost(
          sessionId,
          req.user!.id,
          AI_MODELS.checklistMatcher,
          usage.prompt_tokens ?? 0,
          usage.completion_tokens ?? 0,
        );
      }
      let parsedJson: any = {};
      try {
        parsedJson = JSON.parse(raw);
      } catch {
        parsedJson = { items: [] };
      }

      // Build leaf coverage map from the LLM response.
      const validLeafIds = new Set(leafNodes.map((n) => n.id));
      const leafCoverage = new Map<
        number,
        { covered: boolean; confidence: number }
      >();
      for (const entry of Array.isArray(parsedJson.items) ? parsedJson.items : []) {
        if (
          typeof entry?.id === "number" &&
          validLeafIds.has(entry.id) &&
          typeof entry?.covered === "boolean"
        ) {
          const conf =
            typeof entry.confidence === "number"
              ? Math.max(0, Math.min(1, entry.confidence))
              : entry.covered
                ? 0.9
                : 0;
          leafCoverage.set(entry.id, { covered: entry.covered, confidence: conf });
        }
      }

      // Dev-only instrumentation (iter9 item 3): surface per-leaf LLM output
      // so Nasser can see why a spoken item did or did not match. Safe in
      // prod — gated on NODE_ENV so it never spams production logs. We log
      // after the validation pass so we see what actually feeds the
      // aggregator, not whatever the model returned before filtering.
      if (process.env.NODE_ENV !== "production") {
        try {
          for (const leaf of leafNodes) {
            const hit = leafCoverage.get(leaf.id);
            const covered = hit?.covered ?? false;
            const confidence = hit?.confidence ?? 0;
            console.log(
              `[check] session=${sessionId} leaf ${leaf.id} (${JSON.stringify(leaf.text)}) LLM returned: covered=${covered}, confidence=${confidence.toFixed(2)}${hit ? "" : " [MISSING — defaulted]"}`,
            );
          }
        } catch {
          /* never let logging break the request */
        }
      }

      // Aggregate coverage for every node (leaves + internals).
      const aggregated = aggregateCoverage(roots, leafCoverage);

      // Response shape:
      //   items: [{ id, covered, confidence, partial }] — now includes an
      //          entry for EVERY node (leaves + parents), not just leaves,
      //          and each entry carries a `partial` flag. Additive: existing
      //          consumers that only read `covered`/`confidence` are unaffected.
      //   aggregated: Record<itemId, {covered, partial, confidence}> — same
      //          information keyed for O(1) lookup. For new consumers.
      const itemsOut: Array<{
        id: number;
        covered: boolean;
        confidence: number;
        partial: boolean;
      }> = [];
      const aggregatedOut: Record<
        string,
        { covered: boolean; partial: boolean; confidence: number }
      > = {};
      for (const [id, cov] of Array.from(aggregated.entries())) {
        itemsOut.push({
          id,
          covered: cov.covered,
          confidence: cov.confidence,
          partial: cov.partial,
        });
        aggregatedOut[String(id)] = {
          covered: cov.covered,
          partial: cov.partial,
          confidence: cov.confidence,
        };
      }

      return res.json({ items: itemsOut, aggregated: aggregatedOut });
    } catch (err) {
      console.error("[practice/check] openai error:", (err as Error).message);
      return providerError(res);
    }
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/practice/:sessionId/tts ───────────────────────────────────
const ttsSchema = z.object({ text: z.string().min(1).max(2000) }).strict();

router.post("/:sessionId/tts", async (req, res, next) => {
  try {
    if (!aiEnabled()) return disabled(res);
    const sessionId = parseInt(req.params.sessionId, 10);
    if (isNaN(sessionId)) return res.status(400).json({ error: "bad_session_id" });
    const owned = await loadOwnedSession(sessionId, req.user!.id);
    if (!owned) return res.status(404).json({ error: "session_not_found" });

    const parsed = ttsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_failed" });

    try {
      const speech = await openai.audio.speech.create({
        model: AI_MODELS.tts,
        voice: "nova",
        input: parsed.data.text,
      });
      await logCost(sessionId, req.user!.id, AI_MODELS.tts, 0, 0);
      const buf = Buffer.from(await speech.arrayBuffer());
      res.set({
        "Content-Type": "audio/mpeg",
        "Content-Length": buf.length.toString(),
        "Cache-Control": "no-cache",
      });
      return res.send(buf);
    } catch (err) {
      console.error("[practice/tts] openai error:", (err as Error).message);
      return providerError(res);
    }
  } catch (err) {
    next(err);
  }
});

export default router;
