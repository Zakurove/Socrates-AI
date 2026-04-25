import { Router } from "express";
import { z } from "zod";
import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";
import { randomBytes } from "crypto";
import { requireAuth } from "../middleware/auth.js";
import { dailySpendCap } from "../middleware/spend-cap.js";
import { sessionMiddleware } from "../auth.js";
import { storage } from "../storage.js";
import { db } from "../db.js";
import { aiCosts } from "../../shared/schema.js";
import { AI_MODELS, estimateCostUsd } from "../../shared/ai-models.js";
import {
  createGeminiSession,
  sendAudio,
  sendEndOfTurn,
  switchPersona,
  getSession,
  closeSession,
  getTranscript,
  primeExaminerTurn,
  peekRecentSessionError,
  getActiveSessionIds,
  GEMINI_OUTPUT_SAMPLE_RATE,
  type CreateSessionCallbacks,
  type ExaminerQuestionData,
} from "../services/gemini-live.js";

const router = Router();
router.use(requireAuth);
router.use(dailySpendCap);

// Dev-gated verbose logging for Gemini route handlers. Turn on explicitly
// with DEBUG_GEMINI=1 in production for a one-off investigation.
const GEMINI_DEBUG =
  process.env.NODE_ENV !== "production" || process.env.DEBUG_GEMINI === "1";

// ---------------------------------------------------------------------------
// In-memory session ownership map
// ---------------------------------------------------------------------------

interface SessionOwnership {
  userId: number;
  stationId: number;
  createdAt: number;
}

const sessionOwners = new Map<string, SessionOwnership>();

// ---------------------------------------------------------------------------
// Cost logging
// ---------------------------------------------------------------------------

async function logGeminiCost(
  appSessionId: number | null,
  userId: number | null,
  estimatedTokensIn: number,
  estimatedTokensOut: number,
): Promise<void> {
  try {
    const cost = estimateCostUsd(
      AI_MODELS.geminiLive,
      estimatedTokensIn,
      estimatedTokensOut,
    );
    await db.insert(aiCosts).values({
      sessionId: appSessionId,
      userId,
      model: AI_MODELS.geminiLive,
      tokensIn: estimatedTokensIn,
      tokensOut: estimatedTokensOut,
      costEstimateUsd: cost,
    });
  } catch {
    // Cost logging must never break a real request.
  }
}

// ---------------------------------------------------------------------------
// POST /api/gemini/session — create a new Gemini Live session
// ---------------------------------------------------------------------------

const createSessionSchema = z.object({
  stationId: z.number().int().positive(),
  persona: z.enum(["patient", "examiner"]),
});

router.post("/session", async (req, res, next) => {
  try {
    const parsed = createSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_failed", details: parsed.error.flatten() });
    }

    const { stationId, persona } = parsed.data;
    const userId = req.user!.id;

    // Load station and validate ownership
    const station = await storage.getStation(stationId);
    if (!station || station.userId !== userId) {
      return res.status(404).json({ error: "station_not_found" });
    }

    // Prepare questions if examiner persona
    const questions: ExaminerQuestionData[] | undefined =
      persona === "examiner"
        ? station.examinerQuestions.map((q) => ({
            question: q.question,
            idealAnswer: (q as any).idealAnswer ?? null,
          }))
        : undefined;

    // Cryptographically random session ID (192 bits). Used as the second
    // factor on WS upgrade alongside the signed session cookie — the client
    // must present both to connect.
    const sessionId = `gemini_${randomBytes(24).toString("hex")}`;

    sessionOwners.set(sessionId, { userId, stationId, createdAt: Date.now() });

    // Store pending config for when WS connects
    pendingConfigs.set(sessionId, {
      persona,
      station: {
        title: station.title,
        type: station.type,
        scenario: station.scenario ?? null,
        patientBriefing: station.patientBriefing ?? null,
        sections: station.sections.map((s) => ({
          title: s.title,
          items: s.items.map((it) => ({
            text: it.text,
            subItems: it.subItems?.map((sub) => ({ text: sub.text })),
          })),
        })),
      },
      questions,
    });

    return res.json({
      sessionId,
      wsUrl: `/api/gemini/ws/${sessionId}`,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Pending configs (session created via REST, Gemini connects on WS open)
// ---------------------------------------------------------------------------

interface PendingConfig {
  persona: "patient" | "examiner";
  station: {
    title: string;
    type: string;
    scenario: string | null;
    patientBriefing: string | null;
    sections: { title: string; items: { text: string; subItems?: { text: string }[] }[] }[];
  };
  questions?: ExaminerQuestionData[];
}

const pendingConfigs = new Map<string, PendingConfig>();

// ---------------------------------------------------------------------------
// POST /api/gemini/switch-persona/:sessionId
// ---------------------------------------------------------------------------

const switchSchema = z.object({
  persona: z.literal("examiner"),
  questions: z.array(
    z.object({
      question: z.string().min(1),
      idealAnswer: z.string().optional(),
    }),
  ),
});

router.post("/switch-persona/:sessionId", async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const ownership = sessionOwners.get(sessionId);
    if (!ownership || ownership.userId !== req.user!.id) {
      return res.status(404).json({ error: "session_not_found" });
    }

    const parsed = switchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_failed" });
    }

    const wsConn = wsConnections.get(sessionId);
    if (!wsConn || wsConn.readyState !== WebSocket.OPEN) {
      console.error(`[gemini-ws] switch-persona: no active WS connection`, {
        sessionId,
      });
      return res.status(400).json({ error: "no_active_ws_connection" });
    }

    // Log estimated cost for the patient session that is about to end
    // (capture BEFORE switchPersona wipes the old session's transcript).
    const prevTranscript = getTranscript(sessionId);
    const approxTokens = Math.ceil(
      prevTranscript.reduce((acc, t) => acc + t.content.length, 0) / 4,
    );
    await logGeminiCost(null, ownership.userId, approxTokens, approxTokens);

    console.log(`[gemini-ws] switch-persona: starting examiner`, {
      sessionId,
      questionCount: parsed.data.questions.length,
      activeSessions: getActiveSessionIds(),
    });

    const callbacks = buildWsCallbacks(wsConn, sessionId);
    try {
      await switchPersona(sessionId, "examiner", parsed.data.questions, callbacks);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to switch persona";
      // eslint-disable-next-line no-console
      console.error("[gemini-ws] switch-persona failed", {
        sessionId,
        err: message,
      });
      // Notify the connected WS client so its UI can surface something
      // more useful than a generic connect error.
      if (wsConn.readyState === WebSocket.OPEN) {
        wsConn.send(
          JSON.stringify({
            type: "error",
            message,
            code: "switch_persona_failed",
          }),
        );
      }
      return res.status(502).json({
        error: "switch_persona_failed",
        message,
      });
    }

    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/gemini/prime/:sessionId — re-send the priming turn
// ---------------------------------------------------------------------------
// Called by the client when the user taps "Start examiner". The tap is a
// user gesture that unblocks the browser AudioContext, so we want the
// priming turn to fire AFTER the gesture (not at connection time). This
// guarantees the first audio chunk will actually play.

router.post("/prime/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  const userId = req.user?.id;

  if (GEMINI_DEBUG) {
    // eslint-disable-next-line no-console
    console.log("[gemini-prime] received request", {
      sessionId,
      userId,
      activeSessions: getActiveSessionIds(),
      knownOwners: Array.from(sessionOwners.keys()),
    });
  }

  try {
    const ownership = sessionOwners.get(sessionId);
    if (GEMINI_DEBUG) {
      // eslint-disable-next-line no-console
      console.log("[gemini-prime] ownership lookup", {
        sessionId,
        found: !!ownership,
        ownerUserId: ownership?.userId,
      });
    }
    if (!ownership) {
      return res.status(404).json({
        error: "session_not_found",
        message: "No session with this id on the server.",
      });
    }
    if (ownership.userId !== userId) {
      return res.status(404).json({
        error: "session_not_found",
        message: "Session belongs to a different user.",
      });
    }

    const session = getSession(sessionId);
    if (GEMINI_DEBUG) {
      // eslint-disable-next-line no-console
      console.log("[gemini-prime] session lookup", {
        sessionId,
        hasSession: !!session,
        persona: session?.persona,
        isReady: session?.isReady,
        closed: session?.closed,
        setupError: session?.setupError,
        primed: session?.primed,
        createdAt: session?.createdAt,
        ageMs: session ? Date.now() - session.createdAt : undefined,
      });
    }

    // If the session is missing OR the closed flag is set, check whether
    // Gemini rejected it at setup (quota / model / auth). That reason is
    // the real cause — surface it specifically instead of the generic
    // `session_not_active`.
    if (!session || session.closed) {
      const recentReason = peekRecentSessionError(sessionId);
      if (GEMINI_DEBUG) {
        // eslint-disable-next-line no-console
        console.log("[gemini-prime] session not alive", {
          sessionId,
          reason: !session ? "map_miss" : "closed_flag_set",
          recentReason,
          sessionPersona: session?.persona,
          sessionSetupError: session?.setupError,
        });
      }
      const gemReason =
        session?.setupError ?? recentReason ?? null;
      if (gemReason) {
        return res.status(502).json({
          error: "gemini_rejected_session",
          message: `Gemini rejected this session: ${gemReason}`,
          reason: gemReason,
        });
      }
      return res.status(400).json({
        error: "session_not_active",
        message:
          "The Gemini Live session is not active (may have closed before prime).",
        // Extra fields to make the server state debuggable from the
        // network panel without needing server logs.
        mapMiss: !session,
        closedFlag: !!session?.closed,
      });
    }

    // Persona check — if the session is still patient we're being called
    // before switchPersona finished. Tell the client explicitly so they
    // can retry rather than swallowing it.
    if (session.persona !== "examiner") {
      if (GEMINI_DEBUG) {
        // eslint-disable-next-line no-console
        console.warn("[gemini-prime] persona is not examiner", {
          sessionId,
          persona: session.persona,
        });
      }
      return res.status(409).json({
        error: "wrong_persona",
        message: `Expected examiner persona, got '${session.persona}'. The persona switch may not have completed yet.`,
        currentPersona: session.persona,
      });
    }

    if (GEMINI_DEBUG) {
      // eslint-disable-next-line no-console
      console.log("[gemini-prime] calling primeExaminerTurn", { sessionId });
    }

    const result = await primeExaminerTurn(session);

    if (GEMINI_DEBUG) {
      // eslint-disable-next-line no-console
      console.log("[gemini-prime] primeExaminerTurn result", {
        sessionId,
        result,
      });
    }

    if (!result.ok) {
      // Surface setup-related Gemini failures as 502 so the client can
      // distinguish "Gemini is broken" from "session missing".
      const reason = result.reason;
      const isGeminiSetupFailure =
        reason === "setup_timeout" ||
        reason.startsWith("gemini_close") ||
        reason.startsWith("switch_persona_failed") ||
        reason.startsWith("send_client_content_threw");
      return res.status(isGeminiSetupFailure ? 502 : 500).json({
        error: "gemini_error",
        message: reason,
        reason,
      });
    }

    return res.json({ ok: true, alreadyPrimed: result.alreadyPrimed ?? false });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[gemini-prime] unhandled error", {
      sessionId,
      err: err instanceof Error ? err.message : err,
      stack: err instanceof Error ? err.stack : undefined,
    });
    // Still surface a specific error instead of falling through to the
    // generic error handler (which returns an opaque 500).
    return res.status(500).json({
      error: "gemini_error",
      message: err instanceof Error ? err.message : "Unknown prime failure.",
    });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/gemini/session/:sessionId
// ---------------------------------------------------------------------------

router.delete("/session/:sessionId", async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const ownership = sessionOwners.get(sessionId);
    if (!ownership || ownership.userId !== req.user!.id) {
      return res.status(404).json({ error: "session_not_found" });
    }

    // Log final cost estimate
    const transcript = getTranscript(sessionId);
    const approxTokens = Math.ceil(
      transcript.reduce((acc, t) => acc + t.content.length, 0) / 4,
    );
    if (approxTokens > 0) {
      await logGeminiCost(null, ownership.userId, approxTokens, approxTokens);
    }

    closeSession(sessionId);
    sessionOwners.delete(sessionId);
    pendingConfigs.delete(sessionId);
    wsConnections.delete(sessionId);

    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// WebSocket upgrade handling
// ---------------------------------------------------------------------------

const wsConnections = new Map<string, WebSocket>();

function buildWsCallbacks(ws: WebSocket, sessionId: string): CreateSessionCallbacks {
  return {
    onAudio: (base64Pcm: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "audio", data: base64Pcm }));
      }
    },
    onText: (text: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "text", text }));
      }
    },
    onUserText: (text: string) => {
      // User-side transcription forwarded to the client so the UI
      // can render it as a Student turn and so `fullTranscript`
      // includes student content for the scoring evaluator.
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "user_text", text }));
      }
    },
    onTurnComplete: () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "turn_complete" }));
      }
    },
    onError: (error: Error) => {
      console.error(`[gemini-ws] session=${sessionId} error:`, error.message);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "error", message: error.message }));
      }
    },
  };
}

/**
 * Attaches a WebSocket server to the HTTP server for Gemini Live audio proxying.
 * Call this from server/index.ts after creating the HTTP server.
 */
export function attachGeminiWebSocket(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = request.url ?? "";
    const match = url.match(/^\/api\/gemini\/ws\/(.+?)(\?|$)/);
    if (!match) return; // Not ours — let other handlers deal with it

    const sessionId = match[1];
    const ownership = sessionOwners.get(sessionId);

    if (!ownership) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    // Verify the signed session cookie and match the user against the
    // ownership record. This closes the hijack window where a leaked
    // sessionId alone would be sufficient to attach.
    if (!sessionMiddleware) {
      socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
      socket.destroy();
      return;
    }

    // The session middleware expects Request/Response shapes. We only need
    // it to parse the cookie and hydrate `request.session`, so we pass a
    // stub response with the minimum surface it touches.
    const stubRes: any = {
      setHeader: () => {},
      getHeader: () => undefined,
      end: () => {},
      on: () => {},
      emit: () => {},
    };

    sessionMiddleware(request as any, stubRes, () => {
      const session = (request as any).session as
        | { passport?: { user?: number } }
        | undefined;
      const sessionUserId = session?.passport?.user;

      if (!sessionUserId || sessionUserId !== ownership.userId) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request, sessionId);
      });
    });
  });

  wss.on("connection", async (ws: WebSocket, _request: any, sessionId: string) => {
    wsConnections.set(sessionId, ws);

    const config = pendingConfigs.get(sessionId);
    if (!config) {
      ws.send(JSON.stringify({ type: "error", message: "No pending session config" }));
      ws.close();
      return;
    }

    // Connect to Gemini Live
    const callbacks = buildWsCallbacks(ws, sessionId);

    try {
      await createGeminiSession(
        {
          persona: config.persona,
          station: config.station,
          questions: config.questions,
        },
        callbacks,
        // Force the service to use the route-level sessionId so that
        // `sendAudio`, `sendEndOfTurn`, `switchPersona`, and `closeSession`
        // calls from this route find the session in the service's map.
        sessionId,
      );

      pendingConfigs.delete(sessionId);

      ws.send(
        JSON.stringify({
          type: "connected",
          sessionId,
          persona: config.persona,
          outputSampleRate: GEMINI_OUTPUT_SAMPLE_RATE,
        }),
      );
      console.log(`[gemini-ws] session connected`, {
        sessionId,
        persona: config.persona,
        activeSessions: getActiveSessionIds(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to connect to Gemini";
      console.error(`[gemini-ws] Failed to create session: ${message}`);
      ws.send(
        JSON.stringify({
          type: "error",
          message,
          code: "gemini_connect_failed",
        }),
      );
      ws.close();
      return;
    }

    // Handle messages from client
    ws.on("message", (data: Buffer | string) => {
      try {
        const msg = JSON.parse(typeof data === "string" ? data : data.toString());

        if (msg.type === "audio" && msg.data) {
          sendAudio(sessionId, msg.data);
        } else if (msg.type === "end") {
          sendEndOfTurn(sessionId);
        }
      } catch (err) {
        console.error(`[gemini-ws] Invalid message from client:`, err);
      }
    });

    ws.on("close", () => {
      wsConnections.delete(sessionId);
      closeSession(sessionId);
      sessionOwners.delete(sessionId);
      pendingConfigs.delete(sessionId);
    });

    ws.on("error", (err) => {
      console.error(`[gemini-ws] WebSocket error for session=${sessionId}:`, err.message);
    });
  });
}

export default router;
