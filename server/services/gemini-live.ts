import { GoogleGenAI, Modality, Session } from "@google/genai";
import type { LiveServerMessage } from "@google/genai";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GeminiSessionConfig {
  persona: "patient" | "examiner";
  station: StationData;
  questions?: ExaminerQuestionData[];
}

export interface StationData {
  title: string;
  type: string;
  scenario?: string | null;
  patientBriefing?: string | null;
  sections: {
    title: string;
    items: { text: string; subItems?: { text: string }[] }[];
  }[];
}

export interface ExaminerQuestionData {
  question: string;
  idealAnswer?: string | null;
}

export interface GeminiLiveSession {
  id: string;
  session: Session;
  persona: "patient" | "examiner";
  transcript: { role: "user" | "assistant"; content: string }[];
  stationData: StationData;
  questions?: ExaminerQuestionData[];
  createdAt: number;
  /**
   * Set to true when Gemini sends its first `setupComplete` server message.
   * The SDK resolves `client.live.connect` after the WS opens but BEFORE
   * the server acks setup — if we fire `sendClientContent` during that
   * window, Gemini may drop the message. Callers that need a live session
   * (notably `primeExaminerTurn`) must wait for this flag.
   */
  isReady: boolean;
  /**
   * Set to true when the Gemini SDK fires `onclose` for this session OR
   * when we explicitly close it (e.g. during `switchPersona`). Even if the
   * map entry has been replaced, checking this flag on a captured reference
   * lets us distinguish "entry in map but dead" from "entry active".
   */
  closed: boolean;
  /**
   * Captured from Gemini's `onerror` callback. Used so the prime endpoint
   * can surface the actual Gemini-side failure reason (quota, wrong model,
   * auth) instead of the generic `session_not_active` when the session has
   * just died during setup.
   */
  setupError: string | null;
  /**
   * Tracks whether `primeExaminerTurn` has already been successfully sent
   * for this session. Prime is idempotent — a repeat call is a cheap no-op
   * rather than a second priming turn (which would confuse Gemini).
   */
  primed: boolean;
  /** Resolves on first `setupComplete`. Used by `waitUntilReady()`. */
  readyPromise: Promise<void>;
  /** Internal — resolves `readyPromise`. */
  markReady: () => void;
}

// ---------------------------------------------------------------------------
// Diagnosis safety filter (mirrors patient-simulator.ts)
// ---------------------------------------------------------------------------

const BLOCKED_DIAGNOSIS_TERMS: string[] = [
  "fracture", "dislocation", "ligament tear", "meniscus tear",
  "rotator cuff tear", "impingement", "tendinitis", "tendinopathy",
  "bursitis", "carpal tunnel syndrome", "de quervain", "plantar fasciitis",
  "osteoarthritis", "rheumatoid arthritis", "gout", "septic arthritis",
  "osteomyelitis", "compartment syndrome", "deep vein thrombosis", "dvt",
  "pulmonary embolism", "stroke", "transient ischemic attack", "tia",
  "myocardial infarction", "heart attack", "angina", "heart failure",
  "pneumonia", "tuberculosis", "copd", "asthma exacerbation", "pneumothorax",
  "appendicitis", "cholecystitis", "pancreatitis", "bowel obstruction",
  "diverticulitis", "crohn", "ulcerative colitis", "celiac disease",
  "peptic ulcer", "gastritis", "hepatitis", "cirrhosis", "kidney stone",
  "pyelonephritis", "urinary tract infection", "uti", "ectopic pregnancy",
  "preeclampsia", "eclampsia", "meningitis", "encephalitis",
  "multiple sclerosis", "guillain-barr", "bell's palsy", "parkinson",
  "epilepsy", "diabetes mellitus", "diabetic ketoacidosis", "dka",
  "hypothyroidism", "hyperthyroidism", "addison", "cushing", "anemia",
  "leukemia", "lymphoma", "melanoma", "carcinoma", "sarcoma", "malignant",
  "benign tumor", "neoplasm", "cancer", "metastasis", "cellulitis",
  "abscess", "hernia", "herpes zoster", "shingles", "depression",
  "anxiety disorder", "bipolar", "schizophrenia", "anorexia nervosa", "bulimia",
];

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

export function buildPatientPrompt(station: StationData): string {
  const diagnosisFilter = BLOCKED_DIAGNOSIS_TERMS.map((t) => `"${t}"`).join(", ");

  return `You are a standardized patient in an OSCE (Objective Structured Clinical Examination) station. This is a medical-training role-play — the person speaking to you is a medical trainee practicing their clinical skills, and they know it is practice.

STATION: ${station.title}
STATION TYPE: ${station.type}

YOUR PATIENT BRIEFING (memorize this — it is your entire reality):
---
${station.patientBriefing ?? "(No briefing provided)"}
---

RULES YOU MUST FOLLOW:
1. Stay in character at all times. You ARE this patient.
2. Answer ONLY what is directly asked — never volunteer extra information.
3. Use everyday, lay language. Do NOT use medical terminology.
4. NEVER reveal, suggest, hint at, or name a diagnosis. You do not know what is wrong with you — you only know your symptoms and experiences.
5. Keep every response to 1-3 sentences. Be concise like a real patient would be.
6. If asked something not covered in your briefing, respond naturally with "I'm not sure" or "No, I don't think so" or "I can't remember."
7. Stay emotionally consistent with the case.
8. If the student asks you a question you already answered, you may briefly repeat or refer back to what you said.
9. Do not break character under any circumstances.
10. Do not provide information in a list or structured format. Speak naturally, as a real person would.
11. NEVER use any of these diagnosis terms: ${diagnosisFilter}
12. NEVER include medical-advice disclaimers of any kind. Do NOT say "this does not constitute medical advice", "consult a healthcare professional", "see a doctor", "I am an AI", or any similar meta-commentary. You are a patient in a role-play — stay in character and say nothing about being an AI or about medical advice. The student is a medical trainee; they know this is practice.

Remember: you are helping a medical student practice. Being realistic and consistent is more important than being helpful.`;
}

export function buildExaminerPrompt(
  station: StationData,
  questions: ExaminerQuestionData[],
): string {
  const questionList = questions
    .map((q, i) => `${i + 1}. Question: "${q.question}"${q.idealAnswer ? `\n   Ideal answer: "${q.idealAnswer}"` : ""}`)
    .join("\n");

  return `You are an OSCE examiner conducting the oral questioning portion of a clinical examination. This is a medical-training role-play — the person speaking to you is a medical trainee practicing for their exam, and they know it is practice.

STATION: ${station.title}
STATION TYPE: ${station.type}
SCENARIO: ${station.scenario ?? "(none)"}

YOUR QUESTIONS (ask one at a time, in the order given):
---
${questionList}
---

HOW TO OPEN:
Your VERY FIRST utterance must be the first examiner question, asked directly and naturally, exactly as a real OSCE examiner would ask it. Do NOT preface the question with acknowledgements like "Understood", "Okay", "Sure", "Alright", "Of course", or "Great". Do NOT introduce yourself. Do NOT greet the student. Do NOT narrate what you are about to do ("For your first question..."). Just ask the question and wait for the student's answer.

HOW TO RUN THE EXAM:
1. Ask each question from the list above exactly once, in the order provided.
2. After the student answers, give at most ONE brief, neutral acknowledgement (e.g. "Thank you.", "Okay.", or a single short clarifying follow-up if the answer is genuinely unclear) — then move directly to the next question. Do NOT grade, correct, reveal the ideal answer, or lecture.
3. If the student says "I don't know" or gives no answer, acknowledge neutrally ("Alright.") and move on to the next question.
4. Keep your utterances short. This is an exam, not a tutorial. Speak naturally, as a real examiner speaks. Do not use lists or structured formats.
5. Maintain a professional, calm, supportive tone. You are evaluating, not intimidating.

HOW TO CLOSE:
After the student has answered the FINAL question in the list and you have given your brief acknowledgement, your next utterance must be exactly one closing line and nothing else:
"That concludes the examination. Thank you."
After that closing line, stop speaking. Do NOT ask further questions, do NOT add disclaimers, do NOT continue the conversation.

ABSOLUTELY FORBIDDEN:
- Do NOT include medical-advice disclaimers of any kind. Never say "this does not constitute medical advice", "consult a healthcare professional", "see a doctor for health concerns", "I am an AI", or any similar disclaimer or meta-commentary. The student is a medical trainee and this is an OSCE role-play.
- Do NOT break character as the examiner.
- Do NOT reveal the ideal answers.
- Do NOT preface your first utterance with filler like "Understood" or "Okay".`;
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

const activeSessions = new Map<string, GeminiLiveSession>();

/**
 * Short-lived cache of reasons a session died. When Gemini rejects a setup
 * (quota / model / auth) the session is removed from `activeSessions` almost
 * immediately after creation; a subsequent `/api/gemini/prime/:id` would
 * then return a generic `session_not_active`. By remembering the real reason
 * here we can surface a specific error to the caller. Entries expire after
 * a short window — just long enough for the UI's prime retry to read them.
 */
const recentSessionErrors = new Map<
  string,
  { reason: string; at: number }
>();
const RECENT_ERROR_TTL_MS = 30_000;

function recordSessionError(sessionId: string, reason: string): void {
  recentSessionErrors.set(sessionId, { reason, at: Date.now() });
}

function consumeRecentSessionError(sessionId: string): string | null {
  const entry = recentSessionErrors.get(sessionId);
  if (!entry) return null;
  if (Date.now() - entry.at > RECENT_ERROR_TTL_MS) {
    recentSessionErrors.delete(sessionId);
    return null;
  }
  return entry.reason;
}

/**
 * Exposed so routes can check whether Gemini itself rejected a session
 * when the map lookup misses. Does NOT remove the entry — the caller
 * decides based on context.
 */
export function peekRecentSessionError(sessionId: string): string | null {
  return consumeRecentSessionError(sessionId);
}

/**
 * Exposed for diagnostics. Returns a snapshot of currently active session
 * ids so routes can log "what the server thinks is alive" when a lookup
 * misses.
 */
export function getActiveSessionIds(): string[] {
  return Array.from(activeSessions.keys());
}

let genaiClient: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!genaiClient) {
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      throw new Error("GOOGLE_AI_API_KEY environment variable is not set");
    }
    genaiClient = new GoogleGenAI({ apiKey });
  }
  return genaiClient;
}

export interface CreateSessionCallbacks {
  onAudio: (base64Pcm: string) => void;
  onText: (text: string) => void;
  /**
   * Transcription of the user's spoken audio, emitted by Gemini's
   * `inputAudioTranscription` pathway. Without this the server never
   * captures what the student said, so the downstream evaluator (which
   * only sees AI turns) would score every question 0 — that was the
   * iter10 Echo-station bug.
   */
  onUserText: (text: string) => void;
  onTurnComplete: () => void;
  onError: (error: Error) => void;
}

const DEBUG =
  process.env.NODE_ENV !== "production" || process.env.DEBUG_GEMINI === "1";

function debugLog(...args: unknown[]): void {
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log("[gemini-live]", ...args);
  }
}

// One-time startup env check so it's obvious on boot whether the AI path
// will even work. Prints a masked key (last 4 chars) — never the full key.
let envCheckLogged = false;
function logEnvCheckOnce(): void {
  if (envCheckLogged) return;
  envCheckLogged = true;
  const key = process.env.GOOGLE_AI_API_KEY;
  const masked = key
    ? `${"*".repeat(Math.max(0, key.length - 4))}${key.slice(-4)}`
    : "MISSING";
  const flag = process.env.FEATURE_AI_PRACTICE_REAL ?? "unset";
  // eslint-disable-next-line no-console
  console.log(
    `[gemini] env check — GOOGLE_AI_API_KEY: ${
      key ? `set (${masked})` : "MISSING"
    }, FEATURE_AI_PRACTICE_REAL: ${flag}`,
  );
}

// Model name for the Gemini Live API. `gemini-3.1-flash-live-preview` is the
// current recommended model for the public Gemini API (non-Vertex) as of
// 2026-04 — the previous `gemini-live-2.5-flash-preview` ID was retired and
// now returns a 1008 close with "model not found for API version v1beta, or
// is not supported for bidiGenerateContent". See
// https://ai.google.dev/gemini-api/docs/live-guide and
// https://ai.google.dev/gemini-api/docs/models for the current model list.
// The Live API still runs on v1beta (the SDK default) — v1alpha is only
// needed for experimental features like affective dialog / proactive audio,
// which we do not use.
const GEMINI_LIVE_MODEL = "gemini-3.1-flash-live-preview";

// Gemini Live output audio sample rate (per API docs). The server forwards
// raw base64 PCM to the client, and the client must create its playback
// AudioContext at this exact rate or audio will play at wrong pitch/speed.
export const GEMINI_OUTPUT_SAMPLE_RATE = 24_000;

export async function createGeminiSession(
  config: GeminiSessionConfig,
  callbacks: CreateSessionCallbacks,
  explicitSessionId?: string,
  opts: { autoPrime?: boolean } = {},
): Promise<GeminiLiveSession> {
  logEnvCheckOnce();
  const client = getClient();

  // Default: auto-prime the examiner server-side. The client still fires its
  // own `/prime` after the user tap (to resume the AudioContext) but the
  // server-side prime guarantees Gemini has the priming turn even if the
  // client is slow — on retry the client call is a cheap no-op.
  const autoPrime = opts.autoPrime ?? (config.persona === "examiner");

  const systemInstruction =
    config.persona === "patient"
      ? buildPatientPrompt(config.station)
      : buildExaminerPrompt(config.station, config.questions ?? []);

  // IMPORTANT: generate the session id BEFORE calling client.live.connect — the
  // SDK callbacks (onmessage, onclose) close over `sessionId` and may fire
  // before the `await` resolves. Previously `sessionId` was declared after the
  // await, which meant those callbacks captured `undefined` and dropped every
  // message → no audio ever made it to the client, especially noticeable when
  // switching to the examiner persona.
  const sessionId = explicitSessionId ?? generateSessionId();
  debugLog("[gemini-server] session opening", {
    sessionId,
    persona: config.persona,
    model: GEMINI_LIVE_MODEL,
    autoPrime,
    activeKeysBefore: Array.from(activeSessions.keys()),
  });

  // NOTE: Gemini Live only accepts ONE responseModality per session. Setting
  // both AUDIO and TEXT (as iter7 did) silently produced no audio. To get a
  // transcript alongside audio, use `outputAudioTranscription: {}` instead —
  // the server then sends transcripts via `serverContent.outputTranscription`.
  const session = await client.live.connect({
    model: GEMINI_LIVE_MODEL,
    config: {
      responseModalities: [Modality.AUDIO],
      outputAudioTranscription: {},
      inputAudioTranscription: {},
      systemInstruction: systemInstruction,
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: config.persona === "patient" ? "Aoede" : "Charon",
          },
        },
      },
    },
    callbacks: {
      onopen: () => {
        debugLog("[gemini-server] WS open", {
          sessionId,
          persona: config.persona,
          activeKeys: Array.from(activeSessions.keys()),
        });
      },
      onmessage: (message: LiveServerMessage) => {
        handleServerMessage(sessionId, message, callbacks);
      },
      onerror: (e: ErrorEvent) => {
        const message = e?.message ?? "Gemini Live connection error";
        // eslint-disable-next-line no-console
        console.error("[gemini-server] onerror", {
          sessionId,
          persona: config.persona,
          message,
        });
        // Persist the reason so that if the session dies during setup, a
        // subsequent `/api/gemini/prime` call can surface it instead of
        // the generic `session_not_active`. We stamp it on the session if
        // it still exists (so waitUntilReady callers can see it) AND in
        // the recentSessionErrors map (so the post-death prime can find
        // it after the map entry is gone).
        const current = activeSessions.get(sessionId);
        if (current && current.session === session) {
          current.setupError = message;
        }
        recordSessionError(sessionId, message);
        callbacks.onError(new Error(message));
      },
      onclose: (e: CloseEvent) => {
        const code = e?.code;
        const reason = e?.reason;
        debugLog("[gemini-server] onclose", {
          sessionId,
          persona: config.persona,
          code,
          reason,
          activeKeysBefore: Array.from(activeSessions.keys()),
        });
        // Mark the captured session object closed regardless of map state
        // — even if the map entry was replaced during switchPersona, any
        // caller still holding THIS session reference sees the truth.
        const currentBefore = activeSessions.get(sessionId);
        // CRITICAL: only remove THIS session from the map. During
        // `switchPersona` we reuse the same sessionId — the OLD session's
        // close callback fires asynchronously and must not stomp the NEW
        // session that replaced it. Compare by identity.
        if (currentBefore && currentBefore.session === session) {
          currentBefore.closed = true;
          // Remember a close-reason if we didn't already capture an error —
          // some Gemini failures (rate limit etc.) arrive only as the close
          // code/reason rather than an explicit `onerror`.
          if (!currentBefore.setupError && (code || reason)) {
            const closeMsg = `gemini_close code=${code ?? "?"} reason=${reason || "(none)"}`;
            currentBefore.setupError = closeMsg;
            recordSessionError(sessionId, closeMsg);
          }
          activeSessions.delete(sessionId);
          debugLog("[gemini-server] session removed from map", {
            sessionId,
            activeKeysAfter: Array.from(activeSessions.keys()),
          });
        } else {
          debugLog(
            "[gemini-server] stale onclose — newer session still live",
            {
              sessionId,
              activeKeysAfter: Array.from(activeSessions.keys()),
            },
          );
        }
      },
    },
  });

  let markReady: () => void = () => {};
  const readyPromise = new Promise<void>((resolve) => {
    markReady = () => resolve();
  });

  const liveSession: GeminiLiveSession = {
    id: sessionId,
    session,
    persona: config.persona,
    transcript: [],
    stationData: config.station,
    questions: config.questions,
    createdAt: Date.now(),
    isReady: false,
    closed: false,
    setupError: null,
    primed: false,
    readyPromise,
    markReady,
  };

  activeSessions.set(sessionId, liveSession);
  debugLog("[gemini-server] session registered", {
    sessionId,
    persona: config.persona,
    activeKeysAfter: Array.from(activeSessions.keys()),
  });

  // If Gemini's `onerror` or `onclose` fired BEFORE `activeSessions.set`
  // above (they can: the SDK resolves `client.live.connect` on WS-open,
  // and Gemini can reject the setup moments later), the callbacks will
  // have recorded a reason in `recentSessionErrors`. Copy it onto the
  // fresh session so `primeExaminerTurn` / route handlers can surface
  // the real cause instead of the generic session-not-active.
  const earlyError = recentSessionErrors.get(sessionId);
  if (earlyError) {
    liveSession.setupError = earlyError.reason;
    liveSession.closed = true;
    debugLog("[gemini-server] session born dead — early error captured", {
      sessionId,
      reason: earlyError.reason,
    });
  }

  // Prime the session so the AI speaks first. Gemini Live uses voice-activity
  // detection and will not spontaneously generate a response from only a
  // system instruction — it needs a user turn to trigger output. The examiner
  // persona must open the conversation with its first question.
  //
  // By default `autoPrime = true` for the examiner persona (see top of this
  // function). Server-side priming triggers Gemini to produce audio as soon
  // as it's ready; the client queues the audio chunks, and when the user
  // taps "Start examiner" the AudioContext resumes and plays the buffered
  // chunks. The explicit client `/prime` POST then becomes an idempotent
  // retry that's almost always a no-op.
  if (config.persona === "examiner" && autoPrime) {
    // Fire-and-forget — the caller shouldn't block on Gemini's setupComplete.
    // Any failure is logged inside primeExaminerTurn.
    void primeExaminerTurn(liveSession).then((result) => {
      debugLog("[gemini-server] auto-prime result", { sessionId, result });
    });
  }

  return liveSession;
}

/** Max time we will wait for Gemini's `setupComplete` before priming. */
const SETUP_READY_TIMEOUT_MS = 4_000;

/**
 * Wait for Gemini to finish setup (`setupComplete` message received) before
 * allowing the caller to send client content. Returns true if ready in time,
 * false on timeout. A resolved session is a no-op.
 */
export function waitUntilReady(
  liveSession: GeminiLiveSession,
  timeoutMs: number = SETUP_READY_TIMEOUT_MS,
): Promise<boolean> {
  if (liveSession.isReady) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    liveSession.readyPromise.then(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/**
 * Send the priming turn that tells the examiner persona to start asking.
 * Exposed separately so a client-triggered "Start examiner" button can fire
 * it AFTER the user's audio gesture, which guarantees the browser's
 * AudioContext is in the `running` state when the first audio chunk arrives.
 *
 * Returns `{ ok: true }` on success or `{ ok: false, reason }` on failure.
 * The reason is safe to surface to the (internal-tool) user so they can
 * debug — the app is not a public-facing product.
 */
export async function primeExaminerTurn(
  liveSessionOrId: GeminiLiveSession | string,
): Promise<{ ok: true; alreadyPrimed?: boolean } | { ok: false; reason: string }> {
  const liveSession =
    typeof liveSessionOrId === "string"
      ? activeSessions.get(liveSessionOrId)
      : liveSessionOrId;
  if (!liveSession) {
    debugLog("primeExaminerTurn: session not found", {
      id: typeof liveSessionOrId === "string" ? liveSessionOrId : undefined,
      activeKeys: Array.from(activeSessions.keys()),
    });
    return { ok: false, reason: "session_not_found_in_map" };
  }

  // Idempotent: if we've already sent the priming turn for this session just
  // return ok. The client's `/prime` POST after a user tap is a retry that
  // we want to short-circuit (sending a second priming turn would confuse
  // Gemini mid-conversation).
  if (liveSession.primed) {
    debugLog("[gemini-server] prime: already primed — no-op", {
      sessionId: liveSession.id,
    });
    return { ok: true, alreadyPrimed: true };
  }

  // If Gemini already handed us an error (quota / model / auth) before the
  // prime call landed, surface it specifically rather than waiting for the
  // setup-ready timeout.
  if (liveSession.closed || liveSession.setupError) {
    const reason = liveSession.setupError ?? "session_closed_before_prime";
    // eslint-disable-next-line no-console
    console.error("[gemini-server] prime: session already closed/errored", {
      sessionId: liveSession.id,
      closed: liveSession.closed,
      setupError: liveSession.setupError,
    });
    return { ok: false, reason };
  }

  // Wait for Gemini's `setupComplete` before sending client content. If we
  // fire too early the SDK's `sendClientContent` may succeed at the WS level
  // but Gemini silently drops the message → examiner never speaks.
  const ready = await waitUntilReady(liveSession);
  if (!ready) {
    // If a setupError landed during the wait, prefer that message — it's
    // the real cause (e.g. Gemini closed with a quota error).
    const reason = liveSession.setupError ?? "setup_timeout";
    // eslint-disable-next-line no-console
    console.error("[gemini-server] prime: setup not ready", {
      sessionId: liveSession.id,
      timeoutMs: SETUP_READY_TIMEOUT_MS,
      reason,
    });
    return { ok: false, reason };
  }

  try {
    // Priming turn: Gemini Live needs a user turn to trigger the first
    // response, but any "please begin" phrasing makes the model reply with
    // an acknowledgement ("Understood, for your first question...") BEFORE
    // asking the actual question — amateurish for an OSCE examiner.
    //
    // The trick: phrase the priming turn as an inert scene-setting cue
    // that the system instruction has already told the model to treat as
    // "start asking". Combined with the HOW TO OPEN section of the
    // examiner prompt ("Your very first utterance must be the first
    // examiner question... do NOT preface with Understood/Okay/..."), this
    // produces a clean, direct first question with no acknowledgement
    // leak.
    liveSession.session.sendClientContent({
      turns: [
        {
          role: "user",
          parts: [
            {
              text: "(The student has entered the examination room and is seated, ready for the first question.)",
            },
          ],
        },
      ],
      turnComplete: true,
    });
    liveSession.primed = true;
    debugLog("[gemini-server] priming turn sent", {
      sessionId: liveSession.id,
      persona: liveSession.persona,
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error("[gemini-server] failed to send priming turn", {
      sessionId: liveSession.id,
      err: message,
    });
    return { ok: false, reason: `send_client_content_threw: ${message}` };
  }
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

function handleServerMessage(
  sessionId: string,
  message: LiveServerMessage,
  callbacks: CreateSessionCallbacks,
): void {
  const liveSession = activeSessions.get(sessionId);

  if (message.setupComplete) {
    debugLog("[gemini-server] setupComplete received", {
      sessionId,
      persona: liveSession?.persona,
      activeKeys: Array.from(activeSessions.keys()),
    });
    if (liveSession && !liveSession.isReady) {
      liveSession.isReady = true;
      liveSession.markReady();
    }
  }

  if (message.serverContent) {
    const content = message.serverContent;

    // AUDIO: come through inlineData parts. Count bytes for debugging.
    if (content.modelTurn?.parts) {
      let audioBytes = 0;
      let textFromPart = "";
      for (const part of content.modelTurn.parts) {
        // Some model configurations still include text parts — fine, append.
        if (part.text) {
          textFromPart += part.text;
        }
        if (part.inlineData?.data) {
          audioBytes += part.inlineData.data.length;
          callbacks.onAudio(part.inlineData.data);
        }
      }
      if (audioBytes > 0) {
        debugLog("[gemini-server] message from Gemini type=audio", {
          sessionId,
          bytes: audioBytes,
        });
      }
      if (textFromPart) {
        callbacks.onText(textFromPart);
        appendAssistantText(liveSession, textFromPart);
      }
    }

    // TRANSCRIPT of model's spoken output. With responseModalities=[AUDIO],
    // text is delivered here (NOT as modelTurn.parts[i].text).
    if (content.outputTranscription?.text) {
      const text = content.outputTranscription.text;
      debugLog("[gemini-server] message from Gemini type=transcript", {
        sessionId,
        bytes: text.length,
      });
      callbacks.onText(text);
      appendAssistantText(liveSession, text);
    }

    // TRANSCRIPT of the USER's spoken audio. Gemini's `inputAudioTranscription`
    // config enables this stream; without forwarding it to the client and
    // storing it in `liveSession.transcript`, the examiner-phase transcript
    // we POST to `/api/ai/evaluate-examiner-transcript` contains only AI
    // turns, and the evaluator dutifully returns score=0 for every question
    // because there is no student content to grade. That was the iter10
    // Echo-station symptom Nasser hit.
    if (content.inputTranscription?.text) {
      const text = content.inputTranscription.text;
      debugLog("[gemini-server] message from Gemini type=input_transcript", {
        sessionId,
        bytes: text.length,
      });
      callbacks.onUserText(text);
      appendUserText(liveSession, text);
    }

    // Turn complete signal
    if (content.turnComplete) {
      debugLog("[gemini-server] message from Gemini type=turn_complete", {
        sessionId,
      });
      callbacks.onTurnComplete();
    }

    if (content.interrupted) {
      debugLog("[gemini-server] message from Gemini type=interrupted", {
        sessionId,
      });
    }
  }
}

function appendAssistantText(
  liveSession: GeminiLiveSession | undefined,
  text: string,
): void {
  if (!liveSession) return;
  const last = liveSession.transcript[liveSession.transcript.length - 1];
  if (last && last.role === "assistant") {
    last.content += text;
  } else {
    liveSession.transcript.push({ role: "assistant", content: text });
  }
}

function appendUserText(
  liveSession: GeminiLiveSession | undefined,
  text: string,
): void {
  if (!liveSession) return;
  const last = liveSession.transcript[liveSession.transcript.length - 1];
  if (last && last.role === "user") {
    last.content += text;
  } else {
    liveSession.transcript.push({ role: "user", content: text });
  }
}

// ---------------------------------------------------------------------------
// Session operations
// ---------------------------------------------------------------------------

export function sendAudio(sessionId: string, base64Pcm: string): void {
  const liveSession = activeSessions.get(sessionId);
  if (!liveSession) throw new Error("Session not found");

  liveSession.session.sendRealtimeInput({
    audio: {
      data: base64Pcm,
      mimeType: "audio/pcm;rate=16000",
    },
  });
}

export function sendEndOfTurn(sessionId: string): void {
  const liveSession = activeSessions.get(sessionId);
  if (!liveSession) throw new Error("Session not found");

  // Record that the user finished speaking
  liveSession.session.sendClientContent({ turnComplete: true });
}

export async function switchPersona(
  sessionId: string,
  persona: "examiner",
  questions: ExaminerQuestionData[],
  callbacks: CreateSessionCallbacks,
): Promise<GeminiLiveSession> {
  const existing = activeSessions.get(sessionId);
  if (!existing) throw new Error("Session not found");

  debugLog("[gemini-server] switchPersona: closing old session", {
    sessionId,
    from: existing.persona,
    activeKeysBefore: Array.from(activeSessions.keys()),
  });
  const stationData = existing.stationData;

  // Mark the existing session closed BEFORE invoking .close() so any
  // in-flight reference (e.g. from primeExaminerTurn) sees the truth.
  existing.closed = true;

  // Close old session cleanly — Gemini Live does not support mid-session
  // system-instruction replacement, so we need a fresh connection.
  try {
    existing.session.close();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[gemini-live] error closing previous session", {
      sessionId,
      err: err instanceof Error ? err.message : err,
    });
  }
  activeSessions.delete(sessionId);
  // Clear any stale recent-error entry for this id so a fresh session
  // doesn't inherit the old one's failure reason.
  recentSessionErrors.delete(sessionId);

  // Create new session with examiner persona, reusing the same sessionId so
  // the client's WebSocket continues to route correctly. `autoPrime` defaults
  // to true for examiner sessions — see createGeminiSession. If creation
  // fails mid-way (e.g. Gemini auth error on the new connection) the map
  // entry may not exist; re-throw so the route handler surfaces the reason.
  try {
    const newSession = await createGeminiSession(
      {
        persona,
        station: stationData,
        questions,
      },
      callbacks,
      sessionId,
    );

    debugLog("[gemini-server] switchPersona: new examiner session ready", {
      sessionId,
      activeKeysAfter: Array.from(activeSessions.keys()),
    });
    return newSession;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error("[gemini-server] switchPersona: createGeminiSession threw", {
      sessionId,
      err: message,
    });
    // Preserve the failure reason for the /prime endpoint to surface.
    recordSessionError(sessionId, `switch_persona_failed: ${message}`);
    throw err;
  }
}

export function getSession(sessionId: string): GeminiLiveSession | undefined {
  return activeSessions.get(sessionId);
}

export function closeSession(sessionId: string): void {
  const liveSession = activeSessions.get(sessionId);
  if (liveSession) {
    liveSession.closed = true;
    try {
      liveSession.session.close();
    } catch {
      // Ignore close errors
    }
    activeSessions.delete(sessionId);
    debugLog("[gemini-server] closeSession (explicit)", {
      sessionId,
      activeKeysAfter: Array.from(activeSessions.keys()),
    });
  }
}

export function getTranscript(
  sessionId: string,
): { role: "user" | "assistant"; content: string }[] {
  const liveSession = activeSessions.get(sessionId);
  return liveSession?.transcript ?? [];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateSessionId(): string {
  return `gemini_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
