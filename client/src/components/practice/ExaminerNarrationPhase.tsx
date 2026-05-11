import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Square, Volume2, VolumeX, Volume, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SessionTimerRing } from "@/components/SessionTimerRing";
import { MicButton } from "@/components/practice/MicButton";
import { cn } from "@/lib/utils";

export type ExaminerQuestion = {
  id: number;
  question: string;
  questionType: "free_text" | "checklist" | "multiple_choice" | "multi_select";
  idealAnswer: string | null;
  keyPoints: string[];
  config: any;
  imageUrl?: string | null;
  order: number;
};

export type CoverageEntry = {
  score: number;
  pointResults?: Array<{ point: string; status: "present" | "missed" }>;
};

export type TapAnswer = {
  selectedIndex?: number;
  selectedIndexes?: number[];
  submitted?: boolean;
  score: number;
};

const LIVE_CHECK_INTERVAL_MS = 10_000;
const LIVE_CHECK_TRANSCRIPT_DELTA = 30; // chars added since last grading
const AUTO_ADVANCE_DELAY_MS = 600;

export function ExaminerNarrationPhase({
  sessionId,
  questions,
  narration,
  totalSeconds,
  elapsedSeconds,
  timerVisibility,
  isListenMuted,
  setIsListenMuted,
  ttsMuted,
  setTtsMuted,
  coverage,
  setCoverage,
  tapAnswers,
  setTapAnswers,
  onPause,
  onEndSession,
  onDiscardSession,
}: {
  sessionId: number | null;
  questions: ExaminerQuestion[];
  narration: {
    transcript: string;
    isListening: boolean;
    isTranscribing: boolean;
    chunkError: string | null;
    analyser?: AnalyserNode | null;
  };
  totalSeconds: number;
  elapsedSeconds: number;
  timerVisibility: { hidden: boolean; toggle: () => void };
  isListenMuted: boolean;
  setIsListenMuted: (v: boolean | ((p: boolean) => boolean)) => void;
  ttsMuted: boolean;
  setTtsMuted: (v: boolean | ((p: boolean) => boolean)) => void;
  coverage: Map<number, CoverageEntry>;
  setCoverage: (
    updater: (prev: Map<number, CoverageEntry>) => Map<number, CoverageEntry>,
  ) => void;
  tapAnswers: Map<number, TapAnswer>;
  setTapAnswers: (
    updater: (prev: Map<number, TapAnswer>) => Map<number, TapAnswer>,
  ) => void;
  onPause: () => void;
  onEndSession: () => void;
  onDiscardSession: () => void;
}) {
  const [focusIdx, setFocusIdx] = useState(0);
  const focusedQuestion = questions[focusIdx];

  // Browsers block audio.play() unless invoked synchronously from a fresh
  // user gesture. The "Begin" tap on the chooser page is too stale by the
  // time this component mounts (2s transition + fetch). Gate the first
  // question on an explicit tap so the audio context unlocks; subsequent
  // questions can autoplay after that.
  const [started, setStarted] = useState(false);

  // Karaoke reveal: word count revealed for the focused question
  const [revealedWords, setRevealedWords] = useState(0);
  const [isTtsPlaying, setIsTtsPlaying] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioObjectUrlRef = useRef<string | null>(null);
  const karaokeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);

  const cleanupAudio = useCallback(() => {
    if (karaokeTimerRef.current) {
      clearInterval(karaokeTimerRef.current);
      karaokeTimerRef.current = null;
    }
    if (audioRef.current) {
      try {
        audioRef.current.pause();
      } catch {
        // ignore
      }
      audioRef.current = null;
    }
    if (audioObjectUrlRef.current) {
      URL.revokeObjectURL(audioObjectUrlRef.current);
      audioObjectUrlRef.current = null;
    }
    if (ttsAbortRef.current) {
      ttsAbortRef.current.abort();
      ttsAbortRef.current = null;
    }
    setIsTtsPlaying(false);
  }, []);

  const playTtsForQuestion = useCallback(
    async (q: ExaminerQuestion) => {
      cleanupAudio();
      const wordCount = q.question.trim().split(/\s+/).filter(Boolean).length;
      if (!sessionId || ttsMuted) {
        setRevealedWords(wordCount);
        return;
      }
      setRevealedWords(0);
      const controller = new AbortController();
      ttsAbortRef.current = controller;
      try {
        const res = await fetch(`/api/practice/${sessionId}/tts`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: q.question }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`tts_${res.status}`);
        const blob = await res.blob();
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        audioObjectUrlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        const beginKaraoke = () => {
          const dur =
            isFinite(audio.duration) && audio.duration > 0
              ? audio.duration
              : wordCount * 0.35;
          const intervalMs = Math.max(80, (dur * 1000) / Math.max(1, wordCount));
          let revealed = 0;
          if (karaokeTimerRef.current) clearInterval(karaokeTimerRef.current);
          setIsTtsPlaying(true);
          karaokeTimerRef.current = setInterval(() => {
            revealed += 1;
            setRevealedWords(revealed);
            if (revealed >= wordCount && karaokeTimerRef.current) {
              clearInterval(karaokeTimerRef.current);
              karaokeTimerRef.current = null;
            }
          }, intervalMs);
        };
        audio.addEventListener("canplaythrough", beginKaraoke, { once: true });
        audio.addEventListener("ended", () => {
          setRevealedWords(wordCount);
          setIsTtsPlaying(false);
        });
        try {
          await audio.play();
        } catch {
          setRevealedWords(wordCount);
          setIsTtsPlaying(false);
        }
      } catch {
        setRevealedWords(wordCount);
        setIsTtsPlaying(false);
      }
    },
    [cleanupAudio, sessionId, ttsMuted],
  );

  // Play TTS whenever focus changes — but only after the user has
  // unlocked audio via the initial "Begin examiner" tap.
  useEffect(() => {
    if (!focusedQuestion) return;
    if (!started) return;
    void playTtsForQuestion(focusedQuestion);
    return () => {
      cleanupAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedQuestion?.id, started]);

  useEffect(() => {
    return () => cleanupAudio();
  }, [cleanupAudio]);

  // ─── Silent grading: drives auto-advance only — never rendered ─────────
  const gradableQuestions = useMemo(
    () =>
      questions.filter(
        (q) => q.questionType === "free_text" || q.questionType === "checklist",
      ),
    [questions],
  );

  const transcriptRef = useRef("");
  transcriptRef.current = narration.transcript;

  const postCheck = useCallback(async () => {
    if (!sessionId) return;
    if (gradableQuestions.length === 0) return;
    const transcript = transcriptRef.current.trim();
    if (!transcript) return;
    try {
      const res = await fetch(`/api/practice/${sessionId}/examiner-check`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript,
          questions: gradableQuestions.map((q) => ({
            id: q.id,
            questionType: q.questionType,
            question: q.question,
            idealAnswer: q.idealAnswer ?? null,
            keyPoints: q.keyPoints ?? [],
          })),
        }),
      });
      if (!res.ok) return;
      const body = (await res.json()) as {
        items?: Array<{
          questionId: number;
          score: number;
          pointResults?: Array<{ point: string; status: "present" | "missed" }>;
          match?: string;
        }>;
      };
      const items = body.items ?? [];
      if (items.length === 0) return;
      setCoverage((prev) => {
        const next = new Map(prev);
        for (const it of items) {
          const existing = next.get(it.questionId);
          if (!existing || it.score > existing.score || it.pointResults) {
            next.set(it.questionId, {
              score: it.score,
              pointResults: it.pointResults,
            });
          }
        }
        return next;
      });
    } catch {
      // Silent — auto-advance just won't fire this tick.
    }
  }, [gradableQuestions, sessionId, setCoverage]);

  useEffect(() => {
    void postCheck();
    const id = setInterval(() => void postCheck(), LIVE_CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [postCheck]);

  // Eager check: after each Whisper chunk lands, grade as soon as the
  // transcript has grown meaningfully. Keeps auto-advance snappy without
  // waiting for the next 10s tick.
  const lastCheckedLenRef = useRef(0);
  useEffect(() => {
    if (narration.isTranscribing) return;
    const len = narration.transcript.length;
    if (len - lastCheckedLenRef.current < LIVE_CHECK_TRANSCRIPT_DELTA) return;
    lastCheckedLenRef.current = len;
    void postCheck();
  }, [narration.transcript, narration.isTranscribing, postCheck]);

  // ─── Completion threshold + auto-advance ───────────────────────────────
  const isQuestionComplete = useCallback(
    (q: ExaminerQuestion): boolean => {
      if (q.questionType === "free_text") {
        const c = coverage.get(q.id);
        return !!c && c.score >= 0.7;
      }
      if (q.questionType === "checklist") {
        const c = coverage.get(q.id);
        const kp = q.keyPoints ?? [];
        if (kp.length === 0) return false;
        if (!c?.pointResults) return false;
        const presentSet = new Set(
          c.pointResults
            .filter((p) => p.status === "present")
            .map((p) => p.point),
        );
        return kp.every((p) => presentSet.has(p));
      }
      if (
        q.questionType === "multiple_choice" ||
        q.questionType === "multi_select"
      ) {
        return !!tapAnswers.get(q.id)?.submitted;
      }
      return false;
    },
    [coverage, tapAnswers],
  );

  const autoAdvancedFromRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (!focusedQuestion) return;
    if (!isQuestionComplete(focusedQuestion)) return;
    if (autoAdvancedFromRef.current.has(focusedQuestion.id)) return;
    const nextIdx = questions.findIndex(
      (q, i) => i > focusIdx && !isQuestionComplete(q),
    );
    autoAdvancedFromRef.current.add(focusedQuestion.id);
    if (nextIdx < 0) return; // last question — stay; user taps End when ready.
    const t = setTimeout(() => setFocusIdx(nextIdx), AUTO_ADVANCE_DELAY_MS);
    return () => clearTimeout(t);
  }, [coverage, tapAnswers, focusIdx, focusedQuestion, questions, isQuestionComplete]);

  // ─── Tap handlers (MCQ / multi-select) ─────────────────────────────────
  const handleMcTap = useCallback(
    (q: ExaminerQuestion, optionIndex: number) => {
      const options: { text: string; isCorrect: boolean }[] = q.config?.options ?? [];
      const correctIdx = options.findIndex((o) => o.isCorrect);
      const score = optionIndex === correctIdx ? 1 : 0;
      setTapAnswers((prev) => {
        const next = new Map(prev);
        next.set(q.id, { selectedIndex: optionIndex, submitted: true, score });
        return next;
      });
    },
    [setTapAnswers],
  );

  const handleMsToggle = useCallback(
    (q: ExaminerQuestion, optionIndex: number) => {
      setTapAnswers((prev) => {
        const next = new Map(prev);
        const existing = next.get(q.id);
        if (existing?.submitted) return prev;
        const cur = new Set(existing?.selectedIndexes ?? []);
        if (cur.has(optionIndex)) cur.delete(optionIndex);
        else cur.add(optionIndex);
        next.set(q.id, {
          selectedIndexes: Array.from(cur),
          submitted: false,
          score: 0,
        });
        return next;
      });
    },
    [setTapAnswers],
  );

  const handleMsSubmit = useCallback(
    (q: ExaminerQuestion) => {
      const options: { text: string; isCorrect: boolean }[] = q.config?.options ?? [];
      const correctCount = options.filter((o) => o.isCorrect).length;
      const threshold = (q.config?.threshold ?? correctCount) as number;
      setTapAnswers((prev) => {
        const next = new Map(prev);
        const existing = next.get(q.id);
        const selected = existing?.selectedIndexes ?? [];
        const correctHits = selected.filter((i) => options[i]?.isCorrect).length;
        const score = Math.min(1, correctHits / Math.max(1, threshold));
        next.set(q.id, {
          selectedIndexes: selected,
          submitted: true,
          score,
        });
        return next;
      });
    },
    [setTapAnswers],
  );

  // ─── Manual skip — escape hatch if STT undershoots ─────────────────────
  const goNext = useCallback(() => {
    if (!focusedQuestion) return;
    autoAdvancedFromRef.current.add(focusedQuestion.id);
    const nextIdx = focusIdx + 1;
    if (nextIdx >= questions.length) return;
    setFocusIdx(nextIdx);
  }, [focusedQuestion, focusIdx, questions.length]);

  // ─── Render ────────────────────────────────────────────────────────────
  if (!focusedQuestion) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <p className="text-body text-muted-foreground">No questions to examine.</p>
      </div>
    );
  }

  const words = focusedQuestion.question.trim().split(/\s+/).filter(Boolean);
  const showCursor = isTtsPlaying && revealedWords < words.length;

  const micState = isListenMuted
    ? "idle"
    : narration.isTranscribing
      ? "processing"
      : narration.isListening
        ? "listening"
        : "idle";

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Top status strip — minimal, single line */}
      <div className="flex items-center justify-center gap-2 px-5 pt-6 pb-1">
        <span className="relative inline-flex h-2 w-2" aria-hidden>
          {!isListenMuted && narration.isListening && (
            <span className="absolute inset-0 animate-ping rounded-full bg-success/60" />
          )}
          <span
            className={cn(
              "relative inline-flex h-2 w-2 rounded-full",
              isListenMuted
                ? "bg-muted-foreground"
                : narration.isTranscribing
                  ? "bg-brand-accent"
                  : "bg-success",
            )}
          />
        </span>
        <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
          {isListenMuted
            ? "Muted"
            : narration.isTranscribing
              ? "Processing…"
              : narration.isListening
                ? "Listening…"
                : "Starting…"}
        </span>
        {narration.chunkError && (
          <span
            aria-label="Reconnecting"
            className="ml-2 h-1.5 w-1.5 rounded-full bg-brand-accent"
          />
        )}
      </div>

      {/* Timer ring */}
      <div className="px-5 pb-2">
        <SessionTimerRing
          totalSeconds={totalSeconds}
          elapsedSeconds={elapsedSeconds}
          hidden={timerVisibility.hidden}
          onToggleHide={timerVisibility.toggle}
        />
      </div>

      {/* Hero question — single Q at a time, no rubric exposed */}
      <div className="flex flex-1 flex-col overflow-y-auto px-5 py-6">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-label uppercase text-muted-foreground">Examiner</p>
          <span className="text-caption tabular-nums text-muted-foreground">
            {focusIdx + 1} / {questions.length}
          </span>
        </div>

        {!started && (
          <div className="flex flex-col items-start gap-4">
            <p className="text-body text-muted-foreground max-w-prose">
              When you're ready, tap to begin. The examiner will read each
              question aloud — answer when they finish.
            </p>
            <Button
              variant="default"
              onClick={() => setStarted(true)}
              className="h-12 rounded-full px-8 text-[17px] font-semibold"
            >
              Begin examiner
            </Button>
          </div>
        )}

        {started && focusedQuestion.imageUrl && (
          <img
            src={focusedQuestion.imageUrl}
            alt=""
            className="mb-4 max-h-56 w-full rounded-xl object-contain"
          />
        )}

        {started && (
          <p
            className="text-h2 font-display leading-tight text-foreground"
            aria-live="polite"
            aria-atomic="true"
          >
            {words.map((w, i) => (
              <span
                key={i}
                className={cn(
                  "transition-opacity duration-200",
                  i < revealedWords ? "opacity-100" : "opacity-30",
                )}
              >
                {w}
                {i < words.length - 1 ? " " : ""}
              </span>
            ))}
            {showCursor && (
              <span className="ml-1 inline-block h-5 w-1.5 animate-pulse rounded-sm bg-brand-accent align-middle" />
            )}
          </p>
        )}

        {/* MCQ / multi-select tap area — no grading reveal until results */}
        {started &&
          focusedQuestion.questionType === "multiple_choice" &&
          (() => {
            const options: { text: string; isCorrect: boolean }[] =
              focusedQuestion.config?.options ?? [];
            const tap = tapAnswers.get(focusedQuestion.id);
            const submitted = !!tap?.submitted;
            return (
              <div className="mt-6 space-y-2.5">
                {options.map((opt, i) => {
                  const isChosen = tap?.selectedIndex === i;
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={submitted}
                      onClick={() => handleMcTap(focusedQuestion, i)}
                      className={cn(
                        "w-full rounded-xl border px-4 py-3 text-left text-[15px] transition-smooth active:scale-[0.99] disabled:cursor-default",
                        submitted && isChosen
                          ? "border-primary bg-primary/10 text-foreground"
                          : submitted
                            ? "border-border bg-card opacity-60"
                            : isChosen
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border bg-card hover:border-primary/40",
                      )}
                    >
                      {opt.text}
                    </button>
                  );
                })}
              </div>
            );
          })()}

        {started &&
          focusedQuestion.questionType === "multi_select" &&
          (() => {
            const options: { text: string; isCorrect: boolean }[] =
              focusedQuestion.config?.options ?? [];
            const correctCount = options.filter((o) => o.isCorrect).length;
            const threshold = (focusedQuestion.config?.threshold ?? correctCount) as number;
            const tap = tapAnswers.get(focusedQuestion.id);
            const submitted = !!tap?.submitted;
            const selected = new Set(tap?.selectedIndexes ?? []);
            return (
              <div className="mt-6 space-y-2.5">
                <p className="text-caption text-muted-foreground">
                  Pick at least {threshold} option
                  {threshold === 1 ? "" : "s"}.
                </p>
                {options.map((opt, i) => {
                  const isChecked = selected.has(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={submitted}
                      onClick={() => handleMsToggle(focusedQuestion, i)}
                      className={cn(
                        "w-full rounded-xl border px-4 py-3 text-left text-[15px] transition-smooth active:scale-[0.99] disabled:cursor-default",
                        submitted && isChecked
                          ? "border-primary bg-primary/10 text-foreground"
                          : submitted
                            ? "border-border bg-card opacity-60"
                            : isChecked
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border bg-card hover:border-primary/40",
                      )}
                    >
                      {opt.text}
                    </button>
                  );
                })}
                {!submitted && (
                  <Button
                    size="sm"
                    onClick={() => handleMsSubmit(focusedQuestion)}
                    disabled={selected.size === 0}
                    className="mt-2 rounded-full"
                  >
                    Submit
                  </Button>
                )}
              </div>
            );
          })()}

        {/* Skip — escape hatch when STT undershoots on free_text / checklist */}
        {started &&
          focusIdx < questions.length - 1 &&
          (focusedQuestion.questionType === "free_text" ||
            focusedQuestion.questionType === "checklist") && (
            <button
              type="button"
              onClick={goNext}
              className="mt-6 self-start text-caption text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              Skip to next question →
            </button>
          )}
      </div>

      {/* Bottom bar — mirrors Gemini Live examiner layout */}
      <div className="border-t border-border/60 bg-background/80 px-5 pt-5 pb-6 backdrop-blur-xl">
        <div className="flex items-center justify-center gap-5">
          <button
            onClick={() => setIsListenMuted((v) => !v)}
            aria-label={isListenMuted ? "Unmute mic" : "Mute mic"}
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

          <MicButton
            state={micState}
            onClick={() => setIsListenMuted((v) => !v)}
            analyser={narration.analyser ?? null}
            className="h-[72px] w-[72px]"
          />

          <button
            onClick={() => {
              setTtsMuted((v) => {
                const next = !v;
                if (next) cleanupAudio();
                return next;
              });
            }}
            aria-label={ttsMuted ? "Unmute readout" : "Mute readout"}
            title={ttsMuted ? "Read-aloud off" : "Read-aloud on"}
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all active:scale-[0.96]",
              ttsMuted
                ? "bg-muted text-muted-foreground"
                : "bg-transparent text-foreground hover:bg-muted",
            )}
          >
            <Volume className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 flex items-center justify-center gap-3">
          <Button
            variant="outline"
            onClick={onPause}
            className="h-10 rounded-full gap-1.5 px-4 text-[13px]"
          >
            <Pause className="h-3.5 w-3.5" />
            Pause
          </Button>
          <Button
            variant="default"
            onClick={onEndSession}
            className="h-10 rounded-full gap-1.5 px-5 text-[13px] font-semibold"
          >
            <Square className="h-3 w-3" />
            End session
          </Button>
        </div>

        <div className="mt-3 flex items-center justify-center">
          <button
            type="button"
            onClick={onDiscardSession}
            className="text-caption text-muted-foreground underline-offset-4 transition-colors hover:text-destructive hover:underline"
          >
            Discard session
          </button>
        </div>
      </div>
    </div>
  );
}
