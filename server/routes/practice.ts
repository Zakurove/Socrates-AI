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
      }
    }

    // Only grade LEAVES. Internal nodes will be aggregated after.
    const leafNodes = collectLeafNodes(roots) as NodeWithText[];
    const leafPayload = leafNodes.map((n) => ({ id: n.id, text: n.text }));

    const physicalRule =
      station.type === "physical_exam"
        ? "Mark items as covered only when the student verbally states they are looking for / performing that action. Do not infer from silence."
        : "";

    // Note: we intentionally no longer ask the LLM to consider parent items;
    // both server and client aggregate coverage for headings from their
    // leaves. We REQUIRE the LLM to return a row for EVERY leaf id given —
    // missing ids would otherwise default to covered=false and, combined
    // with LLM flakiness across successive checks, could cause a
    // previously-covered leaf to silently drop out. The client is monotonic
    // so it self-heals, but the immediate UI response should still be right.
    //
    // iter9 item 3: the old prompt was too conservative ("require high
    // confidence… when in doubt, mark as NOT covered"). On single-leaf
    // stations that produced false negatives — the student would speak the
    // item aloud and it never flipped to covered. The new prompt tells the
    // LLM to grade each item independently and to be generous when the
    // transcript clearly addresses the item intent, even with different
    // wording. A false-positive here is less harmful than a false-negative
    // because the student is about to move on and wants to see progress.
    const sys = `You are an OSCE checklist grader. You will receive a student's session transcript and a list of LEAF checklist items. For each item, decide whether the transcript shows the student performing or asking about that item, then return JSON with the shape {"items":[{"id":<number>,"covered":<boolean>,"confidence":<0..1>}]}.

Grading rules:
- Grade each item independently. Whether there is 1 item or 50, apply the same standard.
- Mark an item "covered": true if the transcript contains language that clearly addresses the item's intent — the exact words are not required, paraphrases and close synonyms count. Example: item "Greet the patient" is covered by "Hello, I'm Dr. Smith, nice to meet you."
- Err on the side of marking "covered": true when the transcript plausibly addresses the item. A short transcript may use different words than the checklist; don't punish that. A missed positive is worse than a charitable positive.
- Confidence: use 0.8-1.0 when the match is clear, 0.5-0.8 when you are reasonably sure, below 0.5 if you are not.
- You MUST return exactly one entry per input id. Do not drop ids, do not invent ids. If an item was not addressed, return covered=false with confidence=0.
- Every item is a leaf. Do not try to infer coverage of parent headings — the caller handles that.
${physicalRule}`;

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
