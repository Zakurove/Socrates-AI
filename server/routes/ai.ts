import { Router, raw } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { aiLimiter, aiDailyLimiter } from "../middleware/rate-limit.js";
import { dailySpendCap } from "../middleware/spend-cap.js";
import { transcribeAudio } from "../services/speech-to-text.js";
import { generateSpeech, type TTSVoice } from "../services/text-to-speech.js";
import {
  simulatePatient,
  type Message,
} from "../services/patient-simulator.js";
import {
  matchUtteranceToChecklist,
  type ChecklistItem,
} from "../services/checklist-matcher.js";
import {
  evaluateAnswer,
  evaluateExaminerTranscript,
} from "../services/examiner-evaluator.js";
import { generateSessionFeedback } from "../services/feedback-generator.js";
import { storage } from "../storage.js";

const router = Router();
router.use(requireAuth);
router.use(aiLimiter);
router.use(aiDailyLimiter);
router.use(dailySpendCap);

const MAX_AUDIO_BYTES = 26 * 1024 * 1024; // 26 MB

// ============================================================================
// POST /api/ai/transcribe
// Accepts raw audio in the request body (application/octet-stream)
// ============================================================================
router.post("/transcribe", raw({ type: "*/*", limit: MAX_AUDIO_BYTES }), async (req, res, next) => {
  try {
    const audioBuffer = Buffer.isBuffer(req.body)
      ? (req.body as Buffer)
      : Buffer.alloc(0);

    if (audioBuffer.length > MAX_AUDIO_BYTES) {
      return res.status(413).json({ message: "Audio payload too large" });
    }

    if (audioBuffer.length === 0) {
      return res.status(400).json({ message: "No audio data received" });
    }

    // Whisper is forced to English. The founder flagged auto-detect
    // as a regression because the app is English-only and code-switching
    // inside a single session produced Arabic transcripts. See memory:
    // feedback_first_real_testing.
    const transcript = await transcribeAudio(audioBuffer, "en");

    return res.json({ transcript });
  } catch (error: any) {
    if (error.message?.includes("Audio") || error.message?.includes("audio")) {
      return res.status(400).json({ message: error.message });
    }
    next(error);
  }
});

// ============================================================================
// POST /api/ai/patient-respond
// ============================================================================

// Strict schema — blocks { role: "system" } injection.
const patientRespondSchema = z
  .object({
    stationId: z.number().int().positive(),
    message: z.string().min(1).max(2000),
    conversationHistory: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            content: z.string().max(4000),
          })
          .strict(),
      )
      .max(40)
      .default([]),
  })
  .strict();

// In-memory cache of PatientSimulator instances keyed by `userId:stationId`
const simulatorCache = new Map<
  string,
  ReturnType<typeof simulatePatient>
>();

// Invalidate all cached simulators for a given stationId (any user).
export function invalidateSimulatorCache(stationId: number): void {
  const suffix = `:${stationId}`;
  for (const key of Array.from(simulatorCache.keys())) {
    if (key.endsWith(suffix)) simulatorCache.delete(key);
  }
}

router.post("/patient-respond", async (req, res, next) => {
  try {
    const parsed = patientRespondSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten(),
      });
    }
    const { stationId, message, conversationHistory } = parsed.data;

    const station = await storage.getStation(stationId);
    if (!station) {
      return res.status(404).json({ message: "Station not found" });
    }
    if (station.userId !== req.user!.id) {
      return res.status(403).json({ message: "Forbidden" });
    }
    if (!station.patientBriefing) {
      return res.status(400).json({
        message: "This station does not have a patient briefing configured",
      });
    }

    const cacheKey = `${req.user!.id}:${stationId}`;
    let simulator = simulatorCache.get(cacheKey);
    if (!simulator) {
      simulator = simulatePatient({
        patientBriefing: station.patientBriefing,
        stationTitle: station.title,
        stationType: station.type,
      });
      simulatorCache.set(cacheKey, simulator);

      setTimeout(() => {
        simulatorCache.delete(cacheKey);
      }, 30 * 60 * 1000);
    }

    // Defense in depth: even though Zod already filters, re-filter the array
    // to user/assistant only before passing to the simulator.
    const history: Message[] = conversationHistory
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content }));

    const response = await simulator.respondToQuestion(message, history);

    return res.json({ response });
  } catch (error: any) {
    next(error);
  }
});

// ============================================================================
// POST /api/ai/match-checklist
// ============================================================================
const matchChecklistSchema = z
  .object({
    utterance: z.string().min(1).max(2000),
    items: z
      .array(
        z
          .object({
            id: z.number().int().positive(),
            text: z.string().min(1).max(500),
            sectionTitle: z.string().max(255),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();

router.post("/match-checklist", async (req, res, next) => {
  try {
    const parsed = matchChecklistSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten(),
      });
    }
    const { utterance, items } = parsed.data;

    const matches = await matchUtteranceToChecklist(
      utterance,
      items as ChecklistItem[],
    );

    return res.json({ matches });
  } catch (error: any) {
    next(error);
  }
});

// ============================================================================
// POST /api/ai/evaluate-answer
// ============================================================================
const evaluateAnswerSchema = z
  .object({
    question: z.string().min(1).max(2000),
    idealAnswer: z.string().min(1).max(4000),
    keyPoints: z.array(z.string().max(500)).max(50).default([]),
    studentAnswer: z.string().min(1).max(4000),
  })
  .strict();

router.post("/evaluate-answer", async (req, res, next) => {
  try {
    const parsed = evaluateAnswerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten(),
      });
    }
    const { question, idealAnswer, keyPoints, studentAnswer } = parsed.data;

    const result = await evaluateAnswer(
      question,
      idealAnswer,
      keyPoints,
      studentAnswer,
    );

    return res.json(result);
  } catch (error: any) {
    next(error);
  }
});

// ============================================================================
// POST /api/ai/evaluate-examiner-transcript
// Used by AI conversational examiner mode: one LLM call extracts per-question
// student answers from the full transcript and scores each against the rubric.
// ============================================================================
const evaluateTranscriptSchema = z
  .object({
    transcript: z.string().min(1).max(40000),
    questions: z
      .array(
        z.object({
          id: z.number().int().positive(),
          question: z.string().min(1).max(2000),
          idealAnswer: z.string().min(1).max(4000),
          keyPoints: z.array(z.string().max(500)).max(50).default([]),
        }),
      )
      .min(1)
      .max(30),
  })
  .strict();

router.post("/evaluate-examiner-transcript", async (req, res, next) => {
  try {
    const parsed = evaluateTranscriptSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten(),
      });
    }
    const { transcript, questions } = parsed.data;

    // Dev diagnostic for iter11 Echo-station "everything scored 0" bug.
    // Log what we actually received so we can tell at a glance whether
    // Student: lines are present. If they're missing, the evaluator has
    // nothing to score and is correctly returning 0 — the bug would be
    // upstream (Gemini input transcription not captured). If Student:
    // lines ARE present but scores are still 0, the bug is in the prompt.
    if (process.env.NODE_ENV !== "production") {
      const lines = transcript.split("\n");
      const studentLines = lines.filter((l) => l.startsWith("Student:"));
      const aiLines = lines.filter((l) => l.startsWith("AI:"));
      // eslint-disable-next-line no-console
      console.log("[ai/evaluate-examiner-transcript] request", {
        transcriptChars: transcript.length,
        lineCount: lines.length,
        studentLineCount: studentLines.length,
        aiLineCount: aiLines.length,
        questionCount: questions.length,
        transcriptHead: transcript.slice(0, 500),
      });
    }

    const results = await evaluateExaminerTranscript(transcript, questions);

    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.log("[ai/evaluate-examiner-transcript] response", {
        resultCount: results.length,
        scores: results.map((r) => ({
          questionId: r.questionId,
          score: r.score,
          answerChars: r.userAnswerTranscript.length,
        })),
      });
    }

    return res.json({ results });
  } catch (error: any) {
    next(error);
  }
});

// ============================================================================
// POST /api/ai/speak
// ============================================================================
const speakSchema = z
  .object({
    text: z.string().min(1).max(4000),
    voice: z
      .enum(["alloy", "echo", "fable", "onyx", "nova", "shimmer"])
      .optional(),
  })
  .strict();

router.post("/speak", async (req, res, next) => {
  try {
    const parsed = speakSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten(),
      });
    }
    const { text, voice } = parsed.data;

    const audioBuffer = await generateSpeech(text, voice as TTSVoice | undefined);

    res.set({
      "Content-Type": "audio/mpeg",
      "Content-Length": audioBuffer.length.toString(),
      "Cache-Control": "no-cache",
    });

    return res.send(audioBuffer);
  } catch (error: any) {
    if (
      error.message?.includes("Text") ||
      error.message?.includes("voice")
    ) {
      return res.status(400).json({ message: error.message });
    }
    next(error);
  }
});

// ============================================================================
// POST /api/ai/session-feedback
// ============================================================================
const sessionFeedbackSchema = z
  .object({
    stationTitle: z.string().min(1).max(255),
    mode: z
      .enum(["self_check", "ai_history", "ai_observer", "ai_communication"])
      .default("self_check"),
    checkedItems: z.array(z.string().max(500)).max(500).default([]),
    missedItems: z.array(z.string().max(500)).max(500).default([]),
    criticalMissed: z.array(z.string().max(500)).max(500).default([]),
    timeUsed: z.number().int().nonnegative().max(24 * 60 * 60).default(0),
    timeLimit: z.number().int().positive().max(24 * 60 * 60).default(420),
    examinerResults: z
      .array(z.any())
      .max(100)
      .default([]),
  })
  .strict();

router.post("/session-feedback", async (req, res, next) => {
  try {
    const parsed = sessionFeedbackSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten(),
      });
    }

    const feedback = await generateSessionFeedback(parsed.data as any);

    return res.json({ feedback });
  } catch (error: any) {
    next(error);
  }
});

export default router;
