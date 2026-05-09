import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useReducer,
} from "react";
import { useParams, useLocation } from "wouter";
import { useStation } from "@/hooks/use-stations";
import { queryClient } from "@/lib/queryClient";
import {
  useCreateSession,
  useUpdateSession,
  useSaveItemResults,
} from "@/hooks/use-sessions";
import { useNarrationMode } from "@/hooks/useNarrationMode";
import { useGeminiLive } from "@/hooks/useGeminiLive";
import { TimerBar } from "@/components/TimerBar";
import { MicButton } from "@/components/practice/MicButton";
import { ConversationArea } from "@/components/practice/ConversationArea";
import { PhaseTransition } from "@/components/practice/PhaseTransition";
import { ReadingPhase } from "@/components/practice/ReadingPhase";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, MicOff, Square, VolumeX, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { computeCompositeScore } from "@shared/scoring";

// ---------------------------------------------------------------------------
// Phase State Machine
// ---------------------------------------------------------------------------

type Phase =
  | "loading"
  | "reading"
  | "phase1"
  | "transitioning"
  | "examiner"
  | "ending";

type AIMode = "listen" | "conversation";

type PhaseAction =
  | { type: "LOADED" }
  | { type: "BEGIN" }
  | { type: "TRANSITION_TO_EXAMINER" }
  | { type: "TRANSITION_COMPLETE" }
  | { type: "END" };

function phaseReducer(_state: Phase, action: PhaseAction): Phase {
  switch (action.type) {
    case "LOADED":
      return "reading";
    case "BEGIN":
      return "phase1";
    case "TRANSITION_TO_EXAMINER":
      return "transitioning";
    case "TRANSITION_COMPLETE":
      return "examiner";
    case "END":
      return "ending";
    default:
      return _state;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseMode(search: string): AIMode {
  const params = new URLSearchParams(search);
  const mode = params.get("mode");
  return mode === "conversation" ? "conversation" : "listen";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AIPracticeModePage() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { data: station, isLoading, error: stationError } = useStation(params.id);
  const createSession = useCreateSession();
  const updateSession = useUpdateSession();
  const saveItemResults = useSaveItemResults();
  const { toast } = useToast();

  // Parse mode from URL
  const mode: AIMode = useMemo(
    () => parseMode(window.location.search),
    [],
  );

  // Mock exam awareness — if this station is part of a mock circuit the
  // runner is orchestrating the sequence and we need to advance the
  // circuit on completion instead of routing to the single-session
  // results page.
  const mockExamIdRef = useRef<number | null>(null);
  const mockExamAttemptIdRef = useRef<number | null>(null);
  if (
    typeof window !== "undefined" &&
    (mockExamIdRef.current == null || mockExamAttemptIdRef.current == null)
  ) {
    const qs = new URLSearchParams(window.location.search);
    if (mockExamIdRef.current == null) {
      const raw = qs.get("mockExamId");
      const n = raw ? parseInt(raw, 10) : NaN;
      if (!isNaN(n)) mockExamIdRef.current = n;
    }
    if (mockExamAttemptIdRef.current == null) {
      const raw = qs.get("mockExamAttemptId");
      const n = raw ? parseInt(raw, 10) : NaN;
      if (!isNaN(n)) mockExamAttemptIdRef.current = n;
    }
  }

  // Phase management
  const [phase, dispatch] = useReducer(phaseReducer, "loading");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const sessionIdRef = useRef<number | null>(null);

  // Timer
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [readingCountdown, setReadingCountdown] = useState(-1);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseRef = useRef<Phase>("loading");
  phaseRef.current = phase;

  // Mic permission error
  const [micDenied, setMicDenied] = useState(false);

  // Examiner tap-to-start gate. The browser's AudioContext may stay suspended
  // if the examiner phase auto-transitions from narration (no user gesture).
  // A visible "Start examiner" button on this phase both unblocks audio and
  // lets the user mentally prepare. Cleared once the user taps it.
  const [examinerStarted, setExaminerStarted] = useState(false);
  const [examinerStarting, setExaminerStarting] = useState(false);

  // iter11 issue 3: auto-end the session when the examiner speaks its
  // closing line so the user doesn't have to tap End manually. We schedule
  // the end a few seconds after we detect the closing phrase so they hear
  // it finish playing. Cancelled if the user taps End themselves.
  const autoEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoEndScheduledRef = useRef(false);

  // Listen-mode mute (cough toggle). Visual only — the mic keeps listening
  // under the hood so the transcript stream / checklist matcher keep running.
  // We just drop audio-level UI feedback when muted. Future: actually pause
  // the media stream. For now this is a noop reassurance affordance.
  const [isListenMuted, setIsListenMuted] = useState(false);

  // Station data
  const totalSeconds = station ? station.defaultTimeMinutes * 60 : 420;
  const hasExaminerQuestions = station
    ? station.examinerQuestions.length > 0
    : false;

  // Flatten items for checklist (used for saving per-item results — includes
  // parents so the results UI can render the hierarchy).
  // Walks all 3 levels: top-level items → sub-items → sub-sub-items. Missing
  // the 3rd level previously caused sub-sub-item results to silently drop on
  // save, leaving the results page showing only items in itemResults — so the
  // user couldn't see what they missed.
  const flatItems = useMemo(() => {
    if (!station) return [];
    const result: Array<{ id: number; text: string; isCritical: boolean }> = [];
    [...station.sections]
      .sort((a, b) => a.order - b.order)
      .forEach((sec) => {
        [...sec.items]
          .filter((i) => !i.parentItemId)
          .sort((a, b) => a.order - b.order)
          .forEach((item) => {
            result.push({
              id: item.id,
              text: item.text,
              isCritical: item.isCritical,
            });
            if (item.subItems) {
              [...item.subItems]
                .sort((a, b) => a.order - b.order)
                .forEach((sub) => {
                  result.push({
                    id: sub.id,
                    text: sub.text,
                    isCritical: sub.isCritical,
                  });
                  const subSubs = (sub as any).subItems as
                    | Array<{ id: number; text: string; isCritical: boolean; order: number }>
                    | undefined;
                  if (subSubs) {
                    [...subSubs]
                      .sort((a, b) => a.order - b.order)
                      .forEach((ssub) => {
                        result.push({
                          id: ssub.id,
                          text: ssub.text,
                          isCritical: ssub.isCritical,
                        });
                      });
                  }
                });
            }
          });
      });
    return result;
  }, [station]);

  // Tree form for the narration checklist matcher. Mirrors the server's
  // ChecklistNode shape so the matcher can distinguish leaves (scored) from
  // parent headings (derived, not scored).
  const checklistTree = useMemo(() => {
    if (!station) return [] as { id: number; children?: any[] }[];
    return [...station.sections]
      .sort((a, b) => a.order - b.order)
      .flatMap((sec) =>
        [...sec.items]
          .filter((i) => !i.parentItemId)
          .sort((a, b) => a.order - b.order)
          .map((item) => ({
            id: item.id,
            children: (item.subItems ?? [])
              .slice()
              .sort((a: any, b: any) => a.order - b.order)
              .map((sub: any) => ({
                id: sub.id,
                children: ((sub as any).subItems ?? [])
                  .slice()
                  .sort((a: any, b: any) => a.order - b.order)
                  .map((ss: any) => ({ id: ss.id })),
              })),
          })),
      );
  }, [station]);

  // Examiner questions
  const examinerQuestions = useMemo(() => {
    if (!station) return [];
    return [...station.examinerQuestions]
      .sort((a, b) => a.order - b.order)
      .map((q) => ({ question: q.question, idealAnswer: q.idealAnswer }));
  }, [station]);

  // ---------------------------------------------------------------------------
  // AI Hooks
  // ---------------------------------------------------------------------------

  const narration = useNarrationMode({ tree: checklistTree });
  const gemini = useGeminiLive();

  // ---------------------------------------------------------------------------
  // Effects: Station loaded
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (station && phase === "loading") {
      setReadingCountdown(station.readingTimeMinutes * 60);
      dispatch({ type: "LOADED" });
    }
  }, [station, phase]);

  // ---------------------------------------------------------------------------
  // Reading timer countdown
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (phase !== "reading" || readingCountdown <= 0) return;
    const id = setInterval(() => {
      setReadingCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(id);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [phase, readingCountdown > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Practice timer (counts up during phase1, transitioning, examiner)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (phase === "phase1" || phase === "examiner") {
      timerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [phase]);

  // ---------------------------------------------------------------------------
  // Begin practice
  // ---------------------------------------------------------------------------

  const handleBegin = useCallback(async () => {
    if (!station) return;

    const sessionMode = mode === "listen" ? "ai_observer" : "ai_history";

    try {
      const session = await createSession.mutateAsync({
        stationId: station.id,
        mode: sessionMode,
        timeLimitSeconds: station.defaultTimeMinutes * 60,
        ...(mockExamIdRef.current != null
          ? { mockExamId: mockExamIdRef.current }
          : {}),
        ...(mockExamAttemptIdRef.current != null
          ? { mockExamAttemptId: mockExamAttemptIdRef.current }
          : {}),
      });
      setSessionId(session.id);
      sessionIdRef.current = session.id;

      // Start AI
      if (mode === "listen") {
        await narration.start(session.id);
      } else {
        await gemini.connect(station.id, "patient");
      }

      dispatch({ type: "BEGIN" });
    } catch (err: any) {
      if (
        err?.message?.includes("permission") ||
        err?.message?.includes("Permission") ||
        err?.name === "NotAllowedError"
      ) {
        setMicDenied(true);
      } else {
        toast({
          title: "Connection failed",
          description: err?.message || "Could not start AI session.",
          variant: "destructive",
        });
      }
    }
  }, [station, mode, createSession, narration, gemini, toast]);

  // ---------------------------------------------------------------------------
  // Trigger detected in narration mode -> auto-transition
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (
      mode === "listen" &&
      narration.triggerDetected &&
      phase === "phase1"
    ) {
      narration.resetTrigger();
      if (hasExaminerQuestions) {
        handleTransitionToExaminer();
      } else {
        handleEndSession();
      }
    }
  }, [narration.triggerDetected, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Transition to Examiner
  // ---------------------------------------------------------------------------

  const handleTransitionToExaminer = useCallback(async () => {
    if (phase !== "phase1") return;
    dispatch({ type: "TRANSITION_TO_EXAMINER" });

    // Stop narration or prepare conversation switch
    if (mode === "listen") {
      narration.stop();
    }

    // Wait for overlay display, then switch persona
    setTimeout(async () => {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log("[AIPracticeModePage] transitioning to examiner", {
          mode,
          questionCount: examinerQuestions.length,
        });
      }
      try {
        if (mode === "conversation") {
          await gemini.switchPersona("examiner", examinerQuestions);
        } else {
          // In listen mode, connect Gemini Live as examiner
          await gemini.connect(station!.id, "examiner");
        }
        dispatch({ type: "TRANSITION_COMPLETE" });
      } catch (err: any) {
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.error(
            "[AIPracticeModePage] persona switch / connect failed",
            err,
          );
        }
        toast({
          title: "Persona switch failed",
          description: err?.message || "Could not switch to examiner.",
          variant: "destructive",
        });
        // Still advance to the examiner phase so the user sees the "Start
        // examiner" retry button rather than being stuck on the transition
        // overlay. `gemini.isConnected` gates the button — if the connection
        // failed cleanly, the button stays disabled and the toast explains
        // what went wrong.
        dispatch({ type: "TRANSITION_COMPLETE" });
      }
    }, 2000);
  }, [phase, mode, narration, gemini, examinerQuestions, station, toast]);

  // ---------------------------------------------------------------------------
  // End Session
  // ---------------------------------------------------------------------------

  const handleEndSession = useCallback(async () => {
    if (phase === "ending") return;
    // Cancel any scheduled auto-end from the closing-phrase watcher — we're
    // ending now either because the watcher's timer fired or the user tapped
    // End themselves. Either way, we don't want a second firing.
    if (autoEndTimerRef.current) {
      clearTimeout(autoEndTimerRef.current);
      autoEndTimerRef.current = null;
    }
    autoEndScheduledRef.current = true;
    dispatch({ type: "END" });

    // Stop all recording/connections
    narration.stop();
    gemini.disconnect();

    const sid = sessionIdRef.current;
    if (!sid) {
      navigate("/my-stations");
      return;
    }

    try {
      // Score uses the iter10 weighted composite: checklist 60% + examiner 40%
      // when both exist. If the examiner phase was reached, we evaluate the
      // Gemini transcript against the station's examiner questions and feed
      // per-question scores into the composite. Unanswered questions count
      // as 0 so users can't get full marks by skipping examiner Q&A.
      const coveredCount = narration.coveredCount;
      const leafTotal = narration.totalLeaves;
      const stationExaminerQuestions = station?.examinerQuestions ?? [];
      const examinerTotal = stationExaminerQuestions.length;

      let examinerScores: number[] = [];
      let evaluatedExaminerResults: Array<{
        questionId: number;
        userAnswerTranscript: string;
        score: number;
        feedback: string;
      }> = [];
      const transcript = gemini.fullTranscript?.trim() ?? "";

      // Dev diagnostic: the iter10 Echo-station bug ("everything scored 0")
      // was caused by the transcript containing only AI: lines — user
      // transcription was never captured. These logs make it obvious at a
      // glance whether Student: lines are now flowing through.
      if (import.meta.env.DEV) {
        const lines = transcript.split("\n");
        const studentLines = lines.filter((l) => l.startsWith("Student:"));
        const aiLines = lines.filter((l) => l.startsWith("AI:"));
        // eslint-disable-next-line no-console
        console.log("[AIPracticeModePage] pre-evaluate transcript", {
          chars: transcript.length,
          lineCount: lines.length,
          studentLineCount: studentLines.length,
          aiLineCount: aiLines.length,
          first500: transcript.slice(0, 500),
          examinerQuestionCount: stationExaminerQuestions.length,
        });
      }

      if (examinerTotal > 0 && transcript.length > 0) {
        try {
          const evalRes = await fetch(
            "/api/ai/evaluate-examiner-transcript",
            {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                transcript,
                questions: stationExaminerQuestions.map((q) => ({
                  id: q.id,
                  question: q.question,
                  idealAnswer: q.idealAnswer,
                  keyPoints: q.keyPoints ?? [],
                })),
              }),
            },
          );
          if (evalRes.ok) {
            const body = (await evalRes.json()) as {
              results: Array<{
                questionId: number;
                score: number;
                userAnswerTranscript: string;
                feedback: string;
              }>;
            };
            evaluatedExaminerResults = body.results;
            examinerScores = body.results.map((r) => r.score);
          } else if (import.meta.env.DEV) {
            console.warn(
              "[AIPracticeModePage] examiner transcript evaluation failed",
              evalRes.status,
              await evalRes.text().catch(() => ""),
            );
          }
        } catch (evalErr) {
          if (import.meta.env.DEV) {
            console.warn(
              "[AIPracticeModePage] examiner transcript evaluation threw",
              evalErr,
            );
          }
        }
      }

      const { compositeScore } = computeCompositeScore({
        checklistTotal: leafTotal,
        checklistCovered: coveredCount,
        examinerTotal,
        examinerScores,
      });
      const totalScore = Math.round(compositeScore);

      // Save item results for the FULL flat list (parents + leaves) so the
      // results page can render the hierarchy. Parent "checked" status is
      // derived from leaf coverage by the matcher — it's a UI indicator, not
      // a separate point.
      const checkResults = narration.checkResults;
      const itemResults = flatItems.map((item) => {
        const result = checkResults.get(item.id);
        const covered = result?.covered ?? false;
        return {
          itemId: item.id,
          status: covered ? "checked" : "missed",
          timestampSeconds: undefined,
          matchedTranscript: result?.match ?? undefined,
        };
      });

      await saveItemResults.mutateAsync({
        sessionId: sid,
        results: itemResults,
      });

      if (evaluatedExaminerResults.length > 0) {
        try {
          await fetch(`/api/sessions/${sid}/question-results`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              evaluatedExaminerResults.map((r) => ({
                questionId: r.questionId,
                userAnswerTranscript: r.userAnswerTranscript,
                score: r.score,
                feedback: r.feedback,
              })),
            ),
          });
        } catch (saveErr) {
          if (import.meta.env.DEV) {
            console.warn(
              "[AIPracticeModePage] save examiner results failed",
              saveErr,
            );
          }
        }
      }

      // Update session — persist the full cumulative transcript so future
      // false-positive / false-negative reports are auditable.
      await updateSession.mutateAsync({
        id: sid,
        data: {
          endedAt: new Date().toISOString(),
          totalScore,
          timeUsedSeconds: elapsedSeconds,
          transcript: narration.transcript || undefined,
        },
      });

      await finalizeNavigation(sid);
    } catch (err: any) {
      toast({
        title: "Error saving results",
        description: err?.message || "Session data may not be saved.",
        variant: "destructive",
      });
      await finalizeNavigation(sid);
    }
  }, [
    phase,
    narration,
    gemini,
    flatItems,
    elapsedSeconds,
    saveItemResults,
    updateSession,
    navigate,
    toast,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // finalizeNavigation captures only refs and stable functions
  ]);

  // Finalize navigation: if this practice was part of a mock exam attempt,
  // advance the attempt and route to rest / results instead of the
  // single-session results page. iter10 mock exams are reusable templates
  // and per-run state lives on the attempt row.
  async function finalizeNavigation(completedSessionId: number) {
    const mockId = mockExamIdRef.current;
    const attemptId = mockExamAttemptIdRef.current;
    if (mockId == null || attemptId == null) {
      navigate(`/session/${completedSessionId}/results`);
      return;
    }
    try {
      const attemptRes = await fetch(
        `/api/mock-exams/${mockId}/attempts/${attemptId}`,
        { credentials: "include" }
      );
      if (!attemptRes.ok) throw new Error(await attemptRes.text());
      const payload = (await attemptRes.json()) as {
        attempt: { currentStationIndex: number; completedAt: string | null };
      };
      if (payload.attempt.completedAt != null) {
        invalidateMockExamQueries(mockId);
        navigate(`/mock-exam/${mockId}/results?attemptId=${attemptId}`);
        return;
      }
      const fromIndex = payload.attempt.currentStationIndex;
      if (import.meta.env.DEV) {
        console.log(
          `[mock-exam] end session, mockExamId=${mockId}, attemptId=${attemptId}, advancing index from ${fromIndex} to ${fromIndex + 1}`
        );
      }
      const res = await fetch(
        `/api/mock-exams/${mockId}/attempts/${attemptId}/advance`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fromIndex }),
        }
      );
      if (res.status === 409) {
        invalidateMockExamQueries(mockId);
        navigate(`/mock-exam/${mockId}?attemptId=${attemptId}`);
        return;
      }
      if (!res.ok) throw new Error(await res.text());
      const body = (await res.json()) as {
        done: boolean;
        stationIndex?: number;
        currentStationId?: number;
      };
      // CRITICAL: invalidate the runner's cached attempt rows so the next
      // mount reads the new currentStationIndex from the server. Without
      // this, the runner would re-use the stale fromIndex and loop back
      // to the station we just finished. This was iter9's bug 2.
      invalidateMockExamQueries(mockId);
      if (import.meta.env.DEV) {
        console.log(
          `[mock-exam] advance response, done=${body.done}, new index=${body.stationIndex ?? "?"}, next station=${body.currentStationId ?? "?"}`
        );
      }
      if (body.done) {
        navigate(`/mock-exam/${mockId}/results?attemptId=${attemptId}`);
      } else {
        navigate(
          `/mock-exam/${mockId}?phase=rest&attemptId=${attemptId}`
        );
      }
    } catch {
      invalidateMockExamQueries(mockId);
      navigate(`/mock-exam/${mockId}?attemptId=${attemptId}`);
    }
  }

  function invalidateMockExamQueries(mockId: number) {
    queryClient.invalidateQueries({
      predicate: (q) =>
        typeof q.queryKey[0] === "string" &&
        (q.queryKey[0] as string).startsWith("/api/mock-exams"),
    });
    // Best-effort: force the specific exam row to refetch immediately
    // so the runner mount sees fresh data even if something is holding
    // a stale reference.
    queryClient.refetchQueries({
      queryKey: [`/api/mock-exams/${mockId}`],
    });
  }

  // ---------------------------------------------------------------------------
  // Start examiner (tap-to-begin — resumes AudioContext + primes turn)
  // ---------------------------------------------------------------------------

  const handleStartExaminer = useCallback(async () => {
    if (examinerStarting || examinerStarted) return;
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log("[AIPracticeModePage] Start examiner tapped", {
        mode,
        isConnected: gemini.isConnected,
      });
    }
    setExaminerStarting(true);
    try {
      await gemini.startExaminer();
      setExaminerStarted(true);
    } catch (err: any) {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.error("[AIPracticeModePage] Start examiner failed", err);
      }
      toast({
        title: "Could not start examiner",
        description: err?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setExaminerStarting(false);
    }
  }, [examinerStarted, examinerStarting, gemini, mode, toast]);

  // ---------------------------------------------------------------------------
  // Auto-end on examiner closing line (iter11 issue 3)
  // ---------------------------------------------------------------------------
  // Detect phrases like "that concludes the examination" in the incoming AI
  // transcript and schedule a session end so Nasser doesn't have to tap End
  // manually. Delay the end by ~2.5s so the closing audio finishes playing.
  // The delay is cancelled if the user taps End themselves (handleEndSession
  // clears the timer).
  useEffect(() => {
    if (phase !== "examiner") return;
    if (autoEndScheduledRef.current) return;

    // Scan only AI turns (examiner utterances). currentAIText is the
    // in-flight streaming text for the current AI turn — we include it so
    // we trigger the moment the phrase lands, not after turn_complete.
    const aiText = [
      ...gemini.turns.filter((t) => t.role === "ai").map((t) => t.text),
      gemini.currentAIText,
    ]
      .join(" ")
      .toLowerCase();

    // Phrases tight enough not to collide with ideal answers. "Concludes
    // the examination" / "concludes the exam" / "thank you for your time"
    // are all natural OSCE-examiner sign-offs that shouldn't show up in an
    // ideal clinical answer.
    const CLOSING_PHRASES = [
      "concludes the examination",
      "concludes the exam",
      "thank you for your time",
    ];
    const isClosing = CLOSING_PHRASES.some((p) => aiText.includes(p));
    if (!isClosing) return;

    autoEndScheduledRef.current = true;
    // eslint-disable-next-line no-console
    if (import.meta.env.DEV) {
      console.log("[AIPracticeModePage] Examiner closing phrase detected — scheduling auto-end");
    }
    autoEndTimerRef.current = setTimeout(() => {
      autoEndTimerRef.current = null;
      // Guard: phase may have already moved to "ending" if the user tapped
      // End in the interim.
      if (phaseRef.current === "examiner") {
        handleEndSession();
      }
    }, 2_500);
  }, [phase, gemini.turns, gemini.currentAIText, handleEndSession]);

  // Cleanup any scheduled auto-end timer on unmount so it can't fire on a
  // different page.
  useEffect(() => {
    return () => {
      if (autoEndTimerRef.current) {
        clearTimeout(autoEndTimerRef.current);
        autoEndTimerRef.current = null;
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Beforeunload warning
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (
        phaseRef.current === "phase1" ||
        phaseRef.current === "examiner" ||
        phaseRef.current === "transitioning"
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // ---------------------------------------------------------------------------
  // Gemini error handling
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (gemini.error) {
      toast({
        title: "AI Connection Error",
        description: gemini.error,
        variant: "destructive",
      });
    }
  }, [gemini.error, toast]);

  useEffect(() => {
    if (narration.error) {
      toast({
        title: "Recording Error",
        description: narration.error,
        variant: "destructive",
      });
    }
  }, [narration.error, toast]);

  // Graceful session-ceiling handling (hard 30-min cap in useNarrationMode).
  // When hit, the hook has already stopped recording. We nudge the user
  // forward: examiner if available, otherwise results.
  useEffect(() => {
    if (!narration.sessionTimeUp) return;
    if (phase !== "phase1" || mode !== "listen") return;
    toast({
      title: "Time's up",
      description: "Ending session.",
    });
    if (hasExaminerQuestions) {
      handleTransitionToExaminer();
    } else {
      handleEndSession();
    }
  }, [narration.sessionTimeUp, phase, mode, hasExaminerQuestions]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Mic denied screen
  // ---------------------------------------------------------------------------

  if (micDenied) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-6 bg-background px-5">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
          <MicOff className="h-8 w-8 text-destructive" />
        </div>
        <div className="flex flex-col items-center gap-2 text-center">
          <h2 className="text-h2 text-foreground">Microphone access is required</h2>
          <p className="text-body text-muted-foreground max-w-xs">
            Please allow microphone access in your browser settings and reload this
            page to continue.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => window.location.reload()}
          className="h-12 rounded-full px-8"
        >
          Reload
        </Button>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Loading state / Error
  // ---------------------------------------------------------------------------

  if (stationError || (!isLoading && !station)) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-6 bg-background px-5">
        <p className="text-body text-muted-foreground">
          Could not load station. Try again.
        </p>
        <Button
          variant="outline"
          onClick={() => navigate("/library")}
          className="h-12 rounded-full px-8"
        >
          Back to Library
        </Button>
      </div>
    );
  }

  if (phase === "loading" || isLoading || !station) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Reading phase — shared component across Self-check / AI Listen / AI Conversation
  // ---------------------------------------------------------------------------

  if (phase === "reading") {
    return (
      <ReadingPhase
        station={station}
        readingTimeSeconds={readingCountdown}
        onBegin={handleBegin}
        onCancel={() => navigate(`/station/${station.id}`)}
        isBeginPending={createSession.isPending}
        modeLabel={mode === "listen" ? "Listen mode" : "Conversation mode"}
      />
    );
  }

  // ---------------------------------------------------------------------------
  // Phase 1 — Listen mode (narration)
  // ---------------------------------------------------------------------------

  if (phase === "phase1" && mode === "listen") {
    // Derive status label from real state. Checklist runs silently behind
    // this — we never render it in Listen mode (iter7 §1).
    const statusLabel = isListenMuted
      ? "Muted"
      : narration.isTranscribing
        ? "Processing\u2026"
        : narration.isListening
          ? "Listening\u2026"
          : "Starting\u2026";

    const finishCtaLabel = hasExaminerQuestions
      ? "Go to examiner questions"
      : "End session";

    return (
      <div className="flex h-screen flex-col bg-background">
        {/* Timer — single calm top bar. Amber dot if a chunk upload failed
            (silent, non-fatal reassurance — no toast). */}
        <div className="px-5 pt-4 pb-3">
          <div className="relative">
            <TimerBar totalSeconds={totalSeconds} elapsedSeconds={elapsedSeconds} />
            {narration.chunkError && (
              <span
                aria-label="Reconnecting"
                title="Reconnecting\u2026"
                className="absolute left-0 top-0 h-1.5 w-1.5 -translate-x-2 translate-y-0.5 rounded-full bg-brand-accent"
              />
            )}
          </div>
        </div>

        {/* Optional reference image (for image_id stations) — kept small and
            above the hero, so the mic still dominates the screen. */}
        {station.type === "image_id" && station.referenceImageUrl && (
          <div className="px-5 pb-3">
            <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-card">
              <TransformWrapper>
                <TransformComponent>
                  <img
                    src={station.referenceImageUrl}
                    alt={station.referenceImageCaption || "Reference image"}
                    className="h-auto max-h-40 w-full object-contain"
                  />
                </TransformComponent>
              </TransformWrapper>
            </div>
          </div>
        )}

        {/* Hero — single commanding mic indicator. Nothing else. */}
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-5">
          <MicButton
            state="listening"
            analyser={isListenMuted ? null : narration.analyser}
          />
          <div className="flex flex-col items-center gap-1.5 text-center">
            <span className="text-caption text-muted-foreground">
              {statusLabel}
            </span>
            <p className="text-body text-muted-foreground">
              Speak naturally. We're listening.
            </p>
          </div>
        </div>

        {/* Bottom — a single primary action + a quiet mute toggle. */}
        <div className="border-t border-border/60 bg-background/80 px-5 pt-4 pb-6 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsListenMuted((v) => !v)}
              aria-label={isListenMuted ? "Unmute" : "Mute"}
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all active:scale-[0.96]",
                isListenMuted
                  ? "bg-muted text-muted-foreground"
                  : "bg-transparent text-foreground hover:bg-muted",
              )}
            >
              {isListenMuted ? (
                <VolumeX className="h-5 w-5" />
              ) : (
                <Volume2 className="h-5 w-5" />
              )}
            </button>

            <Button
              variant="default"
              onClick={
                hasExaminerQuestions ? handleTransitionToExaminer : handleEndSession
              }
              className="h-12 flex-1 rounded-full text-[17px] font-semibold"
            >
              {finishCtaLabel}
            </Button>
          </div>

          {hasExaminerQuestions && (
            <div className="mt-3 flex items-center justify-center">
              <button
                onClick={handleEndSession}
                className="text-caption text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                End session
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Phase 1 — Conversation mode
  // ---------------------------------------------------------------------------

  if (phase === "phase1" && mode === "conversation") {
    const micState = gemini.isAISpeaking
      ? "ai-speaking"
      : gemini.isUserSpeaking
        ? "recording"
        : gemini.isConnected
          ? "recording"
          : "idle";

    return (
      <div className="flex h-screen flex-col bg-background">
        {/* Timer */}
        <div className="px-5 pt-4 pb-3">
          <TimerBar totalSeconds={totalSeconds} elapsedSeconds={elapsedSeconds} />
        </div>

        {/* Reference image for image_id */}
        {station.type === "image_id" && station.referenceImageUrl && (
          <div className="px-5 pb-3">
            <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-card">
              <TransformWrapper>
                <TransformComponent>
                  <img
                    src={station.referenceImageUrl}
                    alt={station.referenceImageCaption || "Reference image"}
                    className="h-auto max-h-40 w-full object-contain"
                  />
                </TransformComponent>
              </TransformWrapper>
            </div>
          </div>
        )}

        {/* Conversation area */}
        <ConversationArea
          turns={gemini.turns}
          currentAIText={gemini.currentAIText}
          isAISpeaking={gemini.isAISpeaking}
          mode="conversation"
          className="flex-1"
        />

        {/* Streaming dots indicator */}
        {gemini.isAISpeaking && !gemini.currentAIText && (
          <div className="flex items-center justify-start px-5 pb-2">
            <div className="flex gap-1 rounded-2xl bg-muted px-4 py-3">
              <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60" />
            </div>
          </div>
        )}

        {/* Bottom bar — chat bubbles above; mic + primary action here.
            Checklist intentionally not rendered (iter7 §1) — scoring still
            runs silently in the background. */}
        <div className="border-t border-border/60 bg-background/80 px-5 pt-5 pb-6 backdrop-blur-xl">
          <div className="flex items-center justify-center gap-5">
            <button
              onClick={() => gemini.setMuted(!gemini.isMuted)}
              aria-label={gemini.isMuted ? "Unmute" : "Mute"}
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-full transition-all active:scale-[0.96]",
                gemini.isMuted
                  ? "bg-muted text-muted-foreground"
                  : "bg-transparent text-foreground hover:bg-muted",
              )}
            >
              {gemini.isMuted ? (
                <VolumeX className="h-5 w-5" />
              ) : (
                <Volume2 className="h-5 w-5" />
              )}
            </button>

            <MicButton
              state={micState}
              onClick={() => {
                gemini.setMuted(!gemini.isMuted);
              }}
              analyser={gemini.analyser}
              className="h-[72px] w-[72px]"
            />

            <div className="h-11 w-11" aria-hidden />
          </div>

          <div className="mt-4 flex flex-col items-stretch gap-2">
            <Button
              variant="default"
              onClick={
                hasExaminerQuestions ? handleTransitionToExaminer : handleEndSession
              }
              className="h-12 rounded-full text-[17px] font-semibold"
            >
              {hasExaminerQuestions ? "Go to examiner questions" : "End session"}
            </Button>
            {hasExaminerQuestions && (
              <button
                onClick={handleEndSession}
                className="text-caption text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                End session
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Transitioning overlay
  // ---------------------------------------------------------------------------

  if (phase === "transitioning") {
    return (
      <div className="flex h-screen flex-col bg-background">
        <PhaseTransition message="Switching to Examiner..." visible={true} />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Examiner phase
  // ---------------------------------------------------------------------------

  if (phase === "examiner") {
    const micState = gemini.isAISpeaking
      ? "ai-speaking"
      : gemini.isUserSpeaking
        ? "recording"
        : gemini.isConnected
          ? "recording"
          : "idle";

    // Latest examiner question (last AI turn) — shown as large hero
    const latestAIQuestion =
      gemini.currentAIText ||
      [...gemini.turns].reverse().find((t) => t.role === "ai")?.text ||
      "";

    // iter11: the server auto-primes the examiner session as soon as setup
    // completes, so Gemini may start speaking BEFORE the user taps "Start
    // examiner". If that happens the old UI hid the question text behind a
    // Start button the user had already effectively skipped. We now treat
    // any incoming AI audio/text as an implicit start — the question renders
    // immediately, and the tap affordance only appears if we still haven't
    // heard anything (e.g. Safari AudioContext is blocked and no chunks
    // have queued yet).
    const hasExaminerSpoken =
      gemini.isAISpeaking ||
      !!gemini.currentAIText ||
      gemini.turns.some(
        (t) => t.role === "ai" && t.text !== "[Switching to Examiner mode]",
      );
    const showQuestionHero = examinerStarted || hasExaminerSpoken;

    return (
      <div className="flex h-screen flex-col bg-background">
        {/* Timer */}
        <div className="px-5 pt-4 pb-3">
          <TimerBar totalSeconds={totalSeconds} elapsedSeconds={elapsedSeconds} />
        </div>

        {/* Examiner question hero */}
        <div className="flex flex-1 flex-col overflow-y-auto px-5 py-6">
          <p className="mb-4 text-label uppercase text-muted-foreground">
            Examiner
          </p>

          {!showQuestionHero ? (
            <div className="flex flex-col items-start gap-4">
              <p className="text-body text-muted-foreground max-w-prose">
                When you're ready, tap below to let the examiner begin.
              </p>
              <Button
                variant="default"
                onClick={handleStartExaminer}
                disabled={examinerStarting || !gemini.isConnected}
                className="h-12 rounded-full px-8 text-[17px] font-semibold"
              >
                {examinerStarting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Starting…
                  </>
                ) : (
                  "Start examiner"
                )}
              </Button>
            </div>
          ) : latestAIQuestion ? (
            <>
              <p className="text-h2 max-w-prose font-display text-foreground">
                {latestAIQuestion}
                {gemini.isAISpeaking && (
                  <span className="ml-1 inline-block h-5 w-1.5 animate-pulse rounded-sm bg-brand-accent align-middle" />
                )}
              </p>
              {/* If Gemini started talking before the user tapped (iOS may
                  still have a suspended AudioContext), keep a tap CTA visible
                  as a small secondary action so they can resume audio. This
                  does NOT block the text. */}
              {!examinerStarted && (
                <button
                  onClick={handleStartExaminer}
                  disabled={examinerStarting}
                  className="mt-4 self-start text-caption text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
                >
                  {examinerStarting ? "Resuming audio…" : "Tap if you can't hear the examiner"}
                </button>
              )}
            </>
          ) : (
            <p className="text-body text-muted-foreground">
              Examiner is ready…
            </p>
          )}
        </div>

        {/* Bottom bar */}
        <div className="border-t border-border/60 bg-background/80 px-5 pt-5 pb-6 backdrop-blur-xl">
          <div className="flex items-center justify-center gap-5">
            <button
              onClick={() => gemini.setMuted(!gemini.isMuted)}
              aria-label={gemini.isMuted ? "Unmute" : "Mute"}
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-full transition-all active:scale-[0.96]",
                gemini.isMuted
                  ? "bg-muted text-muted-foreground"
                  : "bg-transparent text-foreground hover:bg-muted",
              )}
            >
              {gemini.isMuted ? (
                <VolumeX className="h-5 w-5" />
              ) : (
                <Volume2 className="h-5 w-5" />
              )}
            </button>

            <MicButton
              state={micState}
              onClick={() => {
                gemini.setMuted(!gemini.isMuted);
              }}
              analyser={gemini.analyser}
              className="h-[72px] w-[72px]"
            />

            <Button
              variant="default"
              onClick={handleEndSession}
              className="h-11 gap-1.5 rounded-full px-5"
            >
              <Square className="h-3.5 w-3.5" />
              End
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Ending phase (brief loading state while saving)
  // ---------------------------------------------------------------------------

  return (
    <div className="flex h-screen items-center justify-center bg-background px-5">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-body text-muted-foreground">Saving your session...</p>
      </div>
    </div>
  );
}
