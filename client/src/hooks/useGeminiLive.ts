import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Turn {
  role: "user" | "ai";
  text: string;
}

interface UseGeminiLiveReturn {
  // Connection
  connect: (stationId: number, persona: "patient" | "examiner") => Promise<void>;
  disconnect: () => void;
  isConnected: boolean;

  // State
  isAISpeaking: boolean;
  isUserSpeaking: boolean;

  // Conversation
  turns: Turn[];
  currentAIText: string;
  fullTranscript: string;

  // Controls
  switchPersona: (
    persona: "examiner",
    questions: Array<{ question: string; idealAnswer: string | null }>,
  ) => Promise<void>;
  /**
   * Explicitly resume the audio context and ask the server to send the
   * priming turn. MUST be called from a user-gesture handler (tap/click)
   * so the browser actually unblocks audio playback. Used by the
   * "Start examiner" button in the examiner phase.
   */
  startExaminer: () => Promise<void>;
  setMuted: (muted: boolean) => void;
  isMuted: boolean;

  // Feedback
  error: string | null;
  analyser: AnalyserNode | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INPUT_SAMPLE_RATE = 16_000; // What Gemini wants for mic input (PCM 16 LE)
const OUTPUT_SAMPLE_RATE_DEFAULT = 24_000; // Gemini Live outputs 24kHz audio
const AUDIO_SEND_INTERVAL_MS = 100;
const SCRIPT_PROCESSOR_BUFFER = 4096;
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_BASE_DELAY_MS = 1000;
const SPEAKING_THRESHOLD = 0.02; // RMS threshold for "user is speaking"

function devLog(...args: unknown[]): void {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log(...args);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Downsample Float32 audio from `fromRate` to `toRate` (linear interpolation). */
function downsample(buffer: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return buffer;
  const ratio = fromRate / toRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const srcIdx = i * ratio;
    const low = Math.floor(srcIdx);
    const high = Math.min(low + 1, buffer.length - 1);
    const frac = srcIdx - low;
    result[i] = buffer[low] * (1 - frac) + buffer[high] * frac;
  }
  return result;
}

/** Convert Float32 [-1,1] to PCM 16-bit signed LE as Uint8Array. */
function float32ToPcm16(float32: Float32Array): Uint8Array {
  const pcm = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return new Uint8Array(pcm.buffer);
}

/** Convert a Uint8Array to base64 string. */
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Decode base64 PCM 16-bit LE to Float32Array. */
function base64PcmToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
  }
  return float32;
}

/** Build a WebSocket URL from the relative path returned by the server. */
function buildWsUrl(path: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${path}`;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useGeminiLive(): UseGeminiLiveReturn {
  // -- React state --
  const [isConnected, setIsConnected] = useState(false);
  const [isAISpeaking, setIsAISpeaking] = useState(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [currentAIText, setCurrentAIText] = useState("");
  const [isMuted, setIsMutedState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  // -- Refs (avoid stale closures in WS/audio callbacks) --
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const scriptNodeRef = useRef<ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const isMutedRef = useRef(false);
  const sendBufferRef = useRef<Float32Array[]>([]);
  const sendTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const turnsRef = useRef<Turn[]>([]);
  const currentAITextRef = useRef("");
  // Accumulates the student's current-utterance transcription from Gemini's
  // inputAudioTranscription stream. Flushed to `turns` when the AI starts
  // its next turn, when `turn_complete` fires, or on disconnect. Without this
  // `fullTranscript` would contain zero Student: lines and the examiner
  // evaluator would score every answer 0 (the iter10 Echo bug).
  const currentUserTextRef = useRef("");
  const reconnectAttemptsRef = useRef(0);
  const reconnectConfigRef = useRef<{
    stationId: number;
    persona: "patient" | "examiner";
  } | null>(null);
  const isConnectedRef = useRef(false);
  const playbackQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);
  const cleaningUpRef = useRef(false);
  const outputSampleRateRef = useRef<number>(OUTPUT_SAMPLE_RATE_DEFAULT);

  // -- Derived state --
  const fullTranscript = turns.map((t) => `${t.role === "user" ? "Student" : "AI"}: ${t.text}`).join("\n");

  // -----------------------------------------------------------------------
  // Audio playback (queue-based to avoid overlapping buffers)
  // -----------------------------------------------------------------------

  const playNextInQueue = useCallback(() => {
    if (isPlayingRef.current) return;
    const chunk = playbackQueueRef.current.shift();
    if (!chunk) {
      setIsAISpeaking(false);
      return;
    }
    isPlayingRef.current = true;
    setIsAISpeaking(true);

    const outputRate = outputSampleRateRef.current;

    let ctx = playbackCtxRef.current;
    if (!ctx || ctx.state === "closed") {
      // CRITICAL: Gemini Live outputs audio at 24kHz. If the AudioContext is
      // created at a different sample rate (iter7 used 16kHz) the buffer is
      // resampled incorrectly and sounds wrong or plays silent on some
      // devices. We use the rate the server reports on the "connected"
      // message, which matches the Gemini spec.
      ctx = new AudioContext({ sampleRate: outputRate });
      playbackCtxRef.current = ctx;
      devLog("[gemini-client] AudioContext created", {
        sampleRate: ctx.sampleRate,
        state: ctx.state,
      });
    }

    // Safari (and iOS) auto-suspends AudioContext until a user gesture or
    // after it's been idle. Resume before playing so the examiner's first
    // audio actually comes out of the speakers.
    devLog("[gemini-client] AudioContext state=" + ctx.state);
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {
        // If resume fails we still try to play — the browser will surface
        // its own error, and the visual "AI speaking" indicator will keep
        // the user informed.
      });
    }

    const buf = ctx.createBuffer(1, chunk.length, outputRate);
    buf.getChannelData(0).set(chunk);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onended = () => {
      isPlayingRef.current = false;
      devLog("[gemini-client] audio chunk played");
      playNextInQueue();
    };
    src.start();
  }, []);

  const enqueuePlayback = useCallback(
    (float32: Float32Array) => {
      playbackQueueRef.current.push(float32);
      playNextInQueue();
    },
    [playNextInQueue],
  );

  // -----------------------------------------------------------------------
  // WebSocket message handler
  // -----------------------------------------------------------------------

  const flushUserTurn = useCallback(() => {
    const userText = currentUserTextRef.current.trim();
    if (!userText) return;
    const newTurn: Turn = { role: "user", text: userText };
    turnsRef.current = [...turnsRef.current, newTurn];
    setTurns(turnsRef.current);
    currentUserTextRef.current = "";
    devLog("[gemini-client] flushed user turn", {
      chars: userText.length,
      preview: userText.slice(0, 80),
    });
  }, []);

  const handleWsMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case "connected":
            devLog("[gemini-client] WS connected", {
              sessionId: msg.sessionId,
              persona: msg.persona,
              outputSampleRate: msg.outputSampleRate,
            });
            if (typeof msg.outputSampleRate === "number" && msg.outputSampleRate > 0) {
              outputSampleRateRef.current = msg.outputSampleRate;
            }
            setIsConnected(true);
            isConnectedRef.current = true;
            reconnectAttemptsRef.current = 0;
            setError(null);
            break;

          case "audio":
            if (msg.data) {
              const pcm = base64PcmToFloat32(msg.data);
              devLog("[gemini-client] audio chunk received", {
                base64Bytes: msg.data.length,
                samples: pcm.length,
              });
              enqueuePlayback(pcm);
            }
            break;

          case "text":
            if (msg.text) {
              // If the AI is starting to speak but we still have pending
              // user transcription from the previous turn, flush it first
              // so the transcript preserves ordering (Student → AI → ...).
              if (currentUserTextRef.current.trim().length > 0) {
                flushUserTurn();
              }
              currentAITextRef.current += msg.text;
              setCurrentAIText(currentAITextRef.current);
            }
            break;

          case "user_text":
            // Gemini input-audio transcription chunk for what the student
            // just said. Accumulate until the AI takes its turn or
            // turn_complete fires, then flush to `turns`.
            if (msg.text) {
              currentUserTextRef.current += msg.text;
              devLog("[gemini-client] user_text chunk", {
                chars: msg.text.length,
                totalChars: currentUserTextRef.current.length,
              });
            }
            break;

          case "turn_complete": {
            // Flush any pending user text FIRST so the transcript order is
            // Student → AI (the natural conversational order).
            if (currentUserTextRef.current.trim().length > 0) {
              flushUserTurn();
            }
            const aiText = currentAITextRef.current.trim();
            if (aiText) {
              const newTurn: Turn = { role: "ai", text: aiText };
              turnsRef.current = [...turnsRef.current, newTurn];
              setTurns(turnsRef.current);
            }
            currentAITextRef.current = "";
            setCurrentAIText("");
            // AI speaking will be cleared when playback queue drains
            break;
          }

          case "error":
            // eslint-disable-next-line no-console
            console.error("[gemini-client] server error message", {
              message: msg.message,
              code: msg.code,
            });
            setError(msg.message ?? "Unknown server error");
            break;

          default:
            break;
        }
      } catch {
        // Non-JSON or malformed — ignore
      }
    },
    [enqueuePlayback, flushUserTurn],
  );

  // -----------------------------------------------------------------------
  // Mic capture setup
  // -----------------------------------------------------------------------

  const startMicCapture = useCallback(() => {
    const ac = audioCtxRef.current;
    const stream = micStreamRef.current;
    if (!ac || !stream) return;

    const source = ac.createMediaStreamSource(stream);
    sourceNodeRef.current = source;

    const analyserNode = ac.createAnalyser();
    analyserNode.fftSize = 2048;
    analyserNodeRef.current = analyserNode;
    setAnalyser(analyserNode);
    source.connect(analyserNode);

    // ScriptProcessorNode to capture raw PCM
    const scriptNode = ac.createScriptProcessor(SCRIPT_PROCESSOR_BUFFER, 1, 1);
    scriptNodeRef.current = scriptNode;

    scriptNode.onaudioprocess = (e) => {
      if (isMutedRef.current) return;
      const input = e.inputBuffer.getChannelData(0);

      // Voice activity detection (simple RMS)
      let sum = 0;
      for (let i = 0; i < input.length; i++) {
        sum += input[i] * input[i];
      }
      const rms = Math.sqrt(sum / input.length);
      setIsUserSpeaking(rms > SPEAKING_THRESHOLD);

      // If user speaks, capture text from current AI turn (if any) so far
      // We still let Gemini handle barge-in; we just record the audio.

      // Accumulate for sending
      sendBufferRef.current.push(new Float32Array(input));
    };

    source.connect(scriptNode);
    // Connect to destination to keep the processor running (output silence).
    scriptNode.connect(ac.destination);

    // Periodically send buffered audio
    sendTimerRef.current = setInterval(() => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (sendBufferRef.current.length === 0) return;

      // Merge buffers
      const totalLen = sendBufferRef.current.reduce((a, b) => a + b.length, 0);
      const merged = new Float32Array(totalLen);
      let offset = 0;
      for (const buf of sendBufferRef.current) {
        merged.set(buf, offset);
        offset += buf.length;
      }
      sendBufferRef.current = [];

      // Downsample mic to 16kHz before sending to Gemini (required input rate).
      const downsampled = downsample(merged, audioCtxRef.current?.sampleRate ?? 48000, INPUT_SAMPLE_RATE);
      const pcmBytes = float32ToPcm16(downsampled);
      const base64 = uint8ToBase64(pcmBytes);

      ws.send(JSON.stringify({ type: "audio", data: base64 }));
    }, AUDIO_SEND_INTERVAL_MS);
  }, []);

  // -----------------------------------------------------------------------
  // Cleanup helpers
  // -----------------------------------------------------------------------

  const stopMicCapture = useCallback(() => {
    if (sendTimerRef.current) {
      clearInterval(sendTimerRef.current);
      sendTimerRef.current = null;
    }
    sendBufferRef.current = [];

    if (scriptNodeRef.current) {
      scriptNodeRef.current.disconnect();
      scriptNodeRef.current = null;
    }
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    if (analyserNodeRef.current) {
      analyserNodeRef.current = null;
      setAnalyser(null);
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setIsUserSpeaking(false);
  }, []);

  const stopPlayback = useCallback(() => {
    playbackQueueRef.current = [];
    isPlayingRef.current = false;
    setIsAISpeaking(false);
    if (playbackCtxRef.current) {
      playbackCtxRef.current.close().catch(() => {});
      playbackCtxRef.current = null;
    }
  }, []);

  const deleteServerSession = useCallback(async (sid: string) => {
    try {
      await fetch(`/api/gemini/session/${sid}`, {
        method: "DELETE",
        credentials: "include",
      });
    } catch {
      // Best-effort cleanup
    }
  }, []);

  // -----------------------------------------------------------------------
  // Disconnect
  // -----------------------------------------------------------------------

  const disconnect = useCallback(() => {
    cleaningUpRef.current = true;

    // Flush any pending user transcription so the last answer isn't lost
    // when the caller tears down the session (e.g. handleEndSession fires
    // immediately after the student finishes the last answer).
    if (currentUserTextRef.current.trim().length > 0) {
      flushUserTurn();
    }

    stopMicCapture();
    stopPlayback();

    const ws = wsRef.current;
    if (ws) {
      ws.close();
      wsRef.current = null;
    }

    const sid = sessionIdRef.current;
    if (sid) {
      deleteServerSession(sid);
      sessionIdRef.current = null;
    }

    setIsConnected(false);
    isConnectedRef.current = false;
    reconnectConfigRef.current = null;
    reconnectAttemptsRef.current = 0;
    setCurrentAIText("");
    currentAITextRef.current = "";
    currentUserTextRef.current = "";
    setError(null);

    cleaningUpRef.current = false;
  }, [stopMicCapture, stopPlayback, deleteServerSession, flushUserTurn]);

  // -----------------------------------------------------------------------
  // Connect (with reconnect support)
  // -----------------------------------------------------------------------

  const connectInternal = useCallback(
    async (stationId: number, persona: "patient" | "examiner") => {
      // 1. Create session via REST
      const res = await fetch("/api/gemini/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ stationId, persona }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "request_failed" }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      const { sessionId, wsUrl } = (await res.json()) as {
        sessionId: string;
        wsUrl: string;
      };
      sessionIdRef.current = sessionId;
      devLog("[gemini-client] session created", {
        sessionId,
        wsUrl,
        persona,
      });

      // 2. Get mic permission + AudioContext
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtxRef.current = new AudioCtx();

      // 3. Open WebSocket
      return new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(buildWsUrl(wsUrl));
        wsRef.current = ws;

        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error("WebSocket connection timed out"));
        }, 10_000);

        ws.onopen = () => {
          // Wait for the "connected" message before resolving
        };

        ws.onmessage = (event) => {
          // Check for initial connected message
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "connected") {
              clearTimeout(timeout);
              handleWsMessage(event);
              startMicCapture();
              resolve();
              return;
            }
          } catch {
            // fall through
          }
          handleWsMessage(event);
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("WebSocket connection failed"));
        };

        ws.onclose = () => {
          clearTimeout(timeout);
          if (cleaningUpRef.current) return;

          // If we were connected and unexpectedly lost connection, try reconnect
          if (isConnectedRef.current && reconnectConfigRef.current) {
            setIsConnected(false);
            isConnectedRef.current = false;
            stopMicCapture();
            stopPlayback();
            attemptReconnect();
          }
        };
      });
    },
    [handleWsMessage, startMicCapture, stopMicCapture, stopPlayback],
  );

  const attemptReconnect = useCallback(() => {
    const config = reconnectConfigRef.current;
    if (!config) return;
    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      setError("Connection lost. Please reconnect.");
      return;
    }

    reconnectAttemptsRef.current += 1;
    const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttemptsRef.current - 1);

    setTimeout(async () => {
      try {
        await connectInternal(config.stationId, config.persona);
      } catch {
        attemptReconnect();
      }
    }, delay);
  }, [connectInternal]);

  const connect = useCallback(
    async (stationId: number, persona: "patient" | "examiner") => {
      // Reset state for a fresh session
      setTurns([]);
      turnsRef.current = [];
      setCurrentAIText("");
      currentAITextRef.current = "";
      currentUserTextRef.current = "";
      setError(null);
      reconnectAttemptsRef.current = 0;
      reconnectConfigRef.current = { stationId, persona };

      try {
        await connectInternal(stationId, persona);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to connect";
        setError(msg);
        stopMicCapture();
        throw err;
      }
    },
    [connectInternal, stopMicCapture],
  );

  // -----------------------------------------------------------------------
  // switchPersona
  // -----------------------------------------------------------------------

  const switchPersona = useCallback(
    async (
      persona: "examiner",
      questions: Array<{ question: string; idealAnswer: string | null }>,
    ) => {
      const sid = sessionIdRef.current;
      if (!sid) throw new Error("No active session");

      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log("[gemini-live] switchPersona → examiner", {
          sid,
          questionCount: questions.length,
        });
      }

      // Clear any leftover audio from the patient session so the examiner's
      // first audio plays immediately and isn't queued behind stale chunks.
      playbackQueueRef.current = [];
      isPlayingRef.current = false;
      currentAITextRef.current = "";
      setCurrentAIText("");
      // Flush any in-flight user transcription from the patient phase so it
      // doesn't get prepended to the first examiner-phase student turn.
      if (currentUserTextRef.current.trim().length > 0) {
        flushUserTurn();
      }
      currentUserTextRef.current = "";

      // Resume the playback context now so the first examiner chunk plays.
      if (playbackCtxRef.current && playbackCtxRef.current.state === "suspended") {
        playbackCtxRef.current.resume().catch(() => {});
      }

      const res = await fetch(`/api/gemini/switch-persona/${sid}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ persona, questions }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({
          error: "switch_failed",
        }))) as { error?: string; message?: string };
        // eslint-disable-next-line no-console
        console.error("[gemini-client] switch-persona failed", {
          sid,
          status: res.status,
          body,
        });
        throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
      }

      // Add a separator turn
      const sep: Turn = { role: "ai", text: "[Switching to Examiner mode]" };
      turnsRef.current = [...turnsRef.current, sep];
      setTurns(turnsRef.current);

      if (reconnectConfigRef.current) {
        reconnectConfigRef.current.persona = persona;
      }
    },
    [flushUserTurn],
  );

  // -----------------------------------------------------------------------
  // startExaminer — called from a user gesture (tap) on the examiner phase.
  // This unblocks the AudioContext and tells the server to send the priming
  // turn. The gesture is essential — without it Safari and some Chrome
  // builds keep the AudioContext suspended and the first audio chunk never
  // plays, which is exactly the "Waiting for examiner" symptom.
  // -----------------------------------------------------------------------

  const startExaminer = useCallback(async () => {
    const sid = sessionIdRef.current;
    devLog("[gemini-client] startExaminer: tap handler entered", {
      sid,
      isConnected: isConnectedRef.current,
      wsReadyState: wsRef.current?.readyState,
    });
    if (!sid) {
      // eslint-disable-next-line no-console
      console.error("[gemini-client] startExaminer: no sessionId in ref");
      throw new Error("No active session");
    }

    // If the WS is not open the prime request will succeed at the HTTP
    // level but the client will never hear the audio chunks. Surface this
    // specifically so the toast is actionable.
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      // eslint-disable-next-line no-console
      console.error("[gemini-client] startExaminer: WS not open", {
        sid,
        readyState: ws?.readyState,
      });
      throw new Error(
        "Live connection is not open. Please wait a moment and try again.",
      );
    }

    // 1) Create (if missing) and resume the playback AudioContext NOW, while
    //    we're still in the same call stack as the user's tap. Creating a
    //    context inside a click handler on iOS is the only reliable way to
    //    get a "running" state context on that platform.
    let ctx = playbackCtxRef.current;
    if (!ctx || ctx.state === "closed") {
      ctx = new AudioContext({ sampleRate: outputSampleRateRef.current });
      playbackCtxRef.current = ctx;
      devLog("[gemini-client] AudioContext created (tap)", {
        sampleRate: ctx.sampleRate,
        state: ctx.state,
      });
    }
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
        devLog("[gemini-client] AudioContext resumed");
      } catch {
        // Fall through — the POST below will still fire; if playback fails
        // the user can tap again.
      }
    }
    devLog("[gemini-client] AudioContext state=" + ctx.state);

    // 2) Unlock the audio output pipeline by playing a tiny silent buffer.
    //    This is a Safari/iOS trick: some browsers keep the output pipeline
    //    gated until an actual buffer source plays inside the gesture.
    try {
      const silent = ctx.createBuffer(1, 1, ctx.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = silent;
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      // best-effort — do not block the prime call
    }

    // 3) Ask the server to send the priming turn so the examiner speaks.
    //    Retry once on transient failures — the examiner session may still be
    //    waiting for Gemini's `setupComplete` when the user taps very
    //    quickly, and a fresh request a moment later usually succeeds.
    const callPrime = async (
      attempt: number,
    ): Promise<
      | { ok: true; alreadyPrimed?: boolean }
      | { ok: false; status: number; error: string; message?: string; reason?: string }
    > => {
      devLog("[gemini-client] POST /api/gemini/prime", { sid, attempt });
      const res = await fetch(`/api/gemini/prime/${sid}`, {
        method: "POST",
        credentials: "include",
      });
      const body = (await res.json().catch(() => ({
        error: "prime_failed_bad_json",
      }))) as {
        ok?: boolean;
        alreadyPrimed?: boolean;
        error?: string;
        message?: string;
        reason?: string;
      };
      devLog("[gemini-client] prime response", {
        sid,
        attempt,
        status: res.status,
        body,
      });
      if (res.ok) {
        return { ok: true, alreadyPrimed: body.alreadyPrimed };
      }
      return {
        ok: false,
        status: res.status,
        error: body.error ?? "prime_failed",
        message: body.message,
        reason: body.reason,
      };
    };

    // Errors that are worth retrying once after a short delay — a fast
    // user tap can land before Gemini's `setupComplete` ack.
    const TRANSIENT_ERRORS = new Set([
      "session_not_active",
      "setup_timeout",
      "prime_failed",
      "wrong_persona",
    ]);

    let result = await callPrime(1);
    if (!result.ok && TRANSIENT_ERRORS.has(result.error)) {
      devLog("[gemini-client] prime transient failure — retrying", result);
      await new Promise((r) => setTimeout(r, 600));
      result = await callPrime(2);
    }

    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.error("[gemini-client] prime failed (final)", result);
      // Prefer the server's human-readable message. For Gemini-side
      // failures the message already explains WHY (quota / model / auth).
      throw new Error(result.message || result.error || `HTTP ${result.status}`);
    }
    devLog("[gemini-client] prime ok", {
      alreadyPrimed: result.alreadyPrimed ?? false,
    });
  }, []);

  // -----------------------------------------------------------------------
  // setMuted
  // -----------------------------------------------------------------------

  const setMuted = useCallback((muted: boolean) => {
    isMutedRef.current = muted;
    setIsMutedState(muted);
  }, []);

  // -----------------------------------------------------------------------
  // Cleanup on unmount
  // -----------------------------------------------------------------------

  useEffect(() => {
    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -----------------------------------------------------------------------
  // Return
  // -----------------------------------------------------------------------

  return {
    connect,
    disconnect,
    isConnected,
    isAISpeaking,
    isUserSpeaking,
    turns,
    currentAIText,
    fullTranscript,
    switchPersona,
    startExaminer,
    setMuted,
    isMuted,
    error,
    analyser,
  };
}
