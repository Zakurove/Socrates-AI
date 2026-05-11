import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Pause,
  Square,
  Volume2,
  VolumeX,
  Volume,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SessionTimerRing } from "@/components/SessionTimerRing";
import { cn, formatTime } from "@/lib/utils";

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
  // For multiple_choice: selected option index. For multi_select: array of option indexes (submitted).
  selectedIndex?: number;
  selectedIndexes?: number[];
  submitted?: boolean;
  score: number;
};

const LIVE_CHECK_INTERVAL_MS = 30_000;

type StatusLabel = "Listening…" | "Processing…" | "Muted" | "Starting…";

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
  const [hintDismissed, setHintDismissed] = useState(false);

  const focusedQuestion = questions[focusIdx];

  // Karaoke reveal: word count revealed per question
  const [revealedWords, setRevealedWords] = useState<Map<number, number>>(
    () => new Map(),
  );

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
  }, []);

  const playTtsForQuestion = useCallback(
    async (q: ExaminerQuestion) => {
      cleanupAudio();
      // Always reveal full text if TTS is muted or sessionId missing
      const wordCount = q.question.trim().split(/\s+/).filter(Boolean).length;
      if (!sessionId || ttsMuted) {
        setRevealedWords((prev) => {
          const next = new Map(prev);
          next.set(q.id, wordCount);
          return next;
        });
        return;
      }
      // Start with zero revealed words for this question
      setRevealedWords((prev) => {
        const next = new Map(prev);
        next.set(q.id, 0);
        return next;
      });
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
          const dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : wordCount * 0.35;
          const intervalMs = Math.max(80, (dur * 1000) / Math.max(1, wordCount));
          let revealed = 0;
          if (karaokeTimerRef.current) clearInterval(karaokeTimerRef.current);
          karaokeTimerRef.current = setInterval(() => {
            revealed += 1;
            setRevealedWords((prev) => {
              const next = new Map(prev);
              next.set(q.id, revealed);
              return next;
            });
            if (revealed >= wordCount && karaokeTimerRef.current) {
              clearInterval(karaokeTimerRef.current);
              karaokeTimerRef.current = null;
            }
          }, intervalMs);
        };
        audio.addEventListener("canplaythrough", beginKaraoke, { once: true });
        audio.addEventListener("ended", () => {
          // Ensure final reveal
          setRevealedWords((prev) => {
            const next = new Map(prev);
            next.set(q.id, wordCount);
            return next;
          });
        });
        try {
          await audio.play();
        } catch {
          // Autoplay blocked — still reveal text
          setRevealedWords((prev) => {
            const next = new Map(prev);
            next.set(q.id, wordCount);
            return next;
          });
        }
      } catch {
        // Fallback: reveal everything
        setRevealedWords((prev) => {
          const next = new Map(prev);
          next.set(q.id, wordCount);
          return next;
        });
      }
    },
    [cleanupAudio, sessionId, ttsMuted],
  );

  // Auto play TTS when focus changes
  useEffect(() => {
    if (!focusedQuestion) return;
    void playTtsForQuestion(focusedQuestion);
    return () => {
      cleanupAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusIdx, focusedQuestion?.id]);

  useEffect(() => {
    return () => {
      cleanupAudio();
    };
  }, [cleanupAudio]);

  // Live coverage check on a 30s interval
  const gradableQuestions = useMemo(
    () =>
      questions.filter(
        (q) => q.questionType === "free_text" || q.questionType === "checklist",
      ),
    [questions],
  );

  const transcriptRef = useRef("");
  transcriptRef.current = narration.transcript;

  const postCheck = useCallback(
    async (final: boolean) => {
      if (!sessionId) return;
      if (gradableQuestions.length === 0) return;
      const transcript = transcriptRef.current.trim();
      if (!transcript && !final) return;
      try {
        const path = final ? "examiner-final-check" : "examiner-check";
        const res = await fetch(`/api/practice/${sessionId}/${path}`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcript: transcript || " ",
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
            // Monotonic on score: keep higher score so a noisier later pass
            // can't undo a stronger earlier one.
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
        // Silent — UI keeps last known coverage
      }
    },
    [gradableQuestions, sessionId, setCoverage],
  );

  useEffect(() => {
    // Fire immediately on mount, then every 30s
    void postCheck(false);
    const id = setInterval(() => {
      void postCheck(false);
    }, LIVE_CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [postCheck]);

  // Handle MCQ tap
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

  const statusLabel: StatusLabel = isListenMuted
    ? "Muted"
    : narration.isTranscribing
      ? "Processing…"
      : narration.isListening
        ? "Listening…"
        : "Starting…";

  // Hint logic
  const showHint = useMemo(() => {
    if (hintDismissed) return false;
    if (elapsedSeconds <= totalSeconds * 0.8) return false;
    if (totalSeconds <= 0) return false;
    let anyUncovered = false;
    for (const q of questions) {
      if (q.questionType === "free_text") {
        const c = coverage.get(q.id);
        if (!c || c.score < 0.6) {
          anyUncovered = true;
          break;
        }
      } else if (q.questionType === "checklist") {
        const c = coverage.get(q.id);
        const kp = q.keyPoints ?? [];
        if (kp.length === 0) continue;
        if (!c?.pointResults) {
          anyUncovered = true;
          break;
        }
        const covered = c.pointResults.filter((p) => p.status === "present").length;
        if (covered / kp.length < 0.6) {
          anyUncovered = true;
          break;
        }
      }
    }
    return anyUncovered;
  }, [hintDismissed, elapsedSeconds, totalSeconds, questions, coverage]);

  const remainingSecs = Math.max(0, totalSeconds - elapsedSeconds);

  const goNext = () => {
    if (focusIdx < questions.length - 1) setFocusIdx(focusIdx + 1);
  };
  const goPrev = () => {
    if (focusIdx > 0) setFocusIdx(focusIdx - 1);
  };

  const renderQuestionBody = (q: ExaminerQuestion) => {
    const cov = coverage.get(q.id);
    const tap = tapAnswers.get(q.id);

    if (q.questionType === "free_text") {
      const pct = cov ? Math.round(cov.score * 100) : null;
      return (
        <div className="mt-3">
          {pct !== null ? (
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-semibold tabular-nums",
                pct >= 60
                  ? "bg-success/15 text-success"
                  : pct >= 30
                    ? "bg-brand-accent/15 text-brand-accent"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {pct}%
            </span>
          ) : (
            <span className="text-caption text-muted-foreground">Not graded yet</span>
          )}
        </div>
      );
    }

    if (q.questionType === "checklist") {
      const kp = q.keyPoints ?? [];
      const lookup = new Map<string, "present" | "missed">();
      for (const pr of cov?.pointResults ?? []) lookup.set(pr.point, pr.status);
      return (
        <ul className="mt-3 space-y-1.5">
          {kp.map((point, i) => {
            const status = lookup.get(point) ?? "missed";
            const covered = status === "present";
            return (
              <li
                key={i}
                className={cn(
                  "flex items-start gap-2 rounded-lg border px-3 py-2 text-[14px] leading-snug transition-colors",
                  covered
                    ? "border-success/30 bg-success/8 text-foreground"
                    : "border-border/60 bg-card text-muted-foreground",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
                    covered ? "bg-success text-white" : "bg-muted",
                  )}
                >
                  {covered ? <Check className="h-3 w-3" /> : null}
                </span>
                <span>{point}</span>
              </li>
            );
          })}
          {kp.length === 0 && (
            <li className="text-caption text-muted-foreground">No keypoints defined.</li>
          )}
        </ul>
      );
    }

    if (q.questionType === "multiple_choice") {
      const options: { text: string; isCorrect: boolean }[] = q.config?.options ?? [];
      const revealed = tap?.submitted;
      const correctIdx = options.findIndex((o) => o.isCorrect);
      return (
        <div className="mt-3 space-y-2">
          {options.map((opt, i) => {
            const isChosen = tap?.selectedIndex === i;
            const isCorrect = i === correctIdx;
            let classes = "border-border bg-card hover:border-primary/40";
            if (revealed) {
              if (isCorrect)
                classes = "border-success/40 bg-success/10 text-success";
              else if (isChosen)
                classes =
                  "border-destructive/40 bg-destructive/10 text-destructive";
              else classes = "border-border bg-card opacity-70";
            } else if (isChosen) {
              classes = "border-primary bg-primary/10 text-primary";
            }
            return (
              <button
                key={i}
                type="button"
                disabled={revealed}
                onClick={() => handleMcTap(q, i)}
                className={cn(
                  "w-full rounded-xl border px-3 py-2 text-left text-[14px] transition-smooth active:scale-[0.99] disabled:cursor-default",
                  classes,
                )}
              >
                {opt.text}
              </button>
            );
          })}
        </div>
      );
    }

    if (q.questionType === "multi_select") {
      const options: { text: string; isCorrect: boolean }[] = q.config?.options ?? [];
      const correctCount = options.filter((o) => o.isCorrect).length;
      const threshold = (q.config?.threshold ?? correctCount) as number;
      const selected = new Set(tap?.selectedIndexes ?? []);
      const submitted = !!tap?.submitted;
      return (
        <div className="mt-3 space-y-2">
          <p className="text-caption text-muted-foreground">
            Pick at least {threshold} correct option{threshold === 1 ? "" : "s"}.
          </p>
          {options.map((opt, i) => {
            const isChecked = selected.has(i);
            let classes = "border-border bg-card hover:border-primary/40";
            if (submitted) {
              if (opt.isCorrect && isChecked)
                classes = "border-success/40 bg-success/10 text-success";
              else if (opt.isCorrect && !isChecked)
                classes =
                  "border-success/20 bg-success/5 text-success/80";
              else if (!opt.isCorrect && isChecked)
                classes =
                  "border-destructive/40 bg-destructive/10 text-destructive";
              else classes = "border-border bg-card opacity-70";
            } else if (isChecked) {
              classes = "border-primary bg-primary/10 text-primary";
            }
            return (
              <button
                key={i}
                type="button"
                disabled={submitted}
                onClick={() => handleMsToggle(q, i)}
                className={cn(
                  "w-full rounded-xl border px-3 py-2 text-left text-[14px] transition-smooth active:scale-[0.99] disabled:cursor-default",
                  classes,
                )}
              >
                {opt.text}
              </button>
            );
          })}
          {!submitted && (
            <Button
              size="sm"
              onClick={() => handleMsSubmit(q)}
              disabled={selected.size === 0}
              className="mt-2 rounded-full"
            >
              Submit
            </Button>
          )}
          {submitted && (
            <p className="mt-2 text-caption text-muted-foreground">
              Scored {Math.round((tap?.score ?? 0) * 100)}%.
            </p>
          )}
        </div>
      );
    }

    return null;
  };

  const renderQuestionText = (q: ExaminerQuestion, isFocused: boolean) => {
    const words = q.question.trim().split(/\s+/).filter(Boolean);
    const revealed = revealedWords.get(q.id) ?? words.length;
    if (!isFocused || revealed >= words.length) {
      return <span>{q.question}</span>;
    }
    return (
      <span>
        {words.map((w, i) => (
          <span
            key={i}
            className={cn(
              "transition-opacity duration-300",
              i < revealed ? "opacity-100" : "opacity-30",
            )}
          >
            {w}
            {i < words.length - 1 ? " " : ""}
          </span>
        ))}
      </span>
    );
  };

  const typeLabel: Record<ExaminerQuestion["questionType"], string> = {
    free_text: "Spoken",
    checklist: "Checklist",
    multiple_choice: "MCQ",
    multi_select: "Multi-select",
  };

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Top strip — listening indicator, mirrors phase1 listen */}
      <div className="flex items-center justify-center gap-2 px-5 pt-6 pb-2">
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
          {statusLabel.replace("…", "…")}
        </span>
        {narration.chunkError && (
          <span
            aria-label="Reconnecting"
            className="ml-2 h-1.5 w-1.5 rounded-full bg-brand-accent"
          />
        )}
      </div>

      {/* Compact timer header */}
      <div className="px-5 pb-2">
        <SessionTimerRing
          totalSeconds={totalSeconds}
          elapsedSeconds={elapsedSeconds}
          hidden={timerVisibility.hidden}
          onToggleHide={timerVisibility.toggle}
        />
      </div>

      {/* Questions list */}
      <div className="flex-1 overflow-y-auto px-5 py-2">
        <div className="mx-auto w-full max-w-2xl space-y-3">
          {showHint && (
            <div
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="rounded-xl border border-brand-accent/30 bg-brand-accent/8 px-4 py-3 text-[13px] text-foreground"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="leading-snug">
                  Heads up — only{" "}
                  <span className="font-semibold tabular-nums">
                    {formatTime(remainingSecs)}
                  </span>{" "}
                  left and a few items are still uncovered. Anything more to add?
                </p>
                <button
                  type="button"
                  onClick={() => setHintDismissed(true)}
                  className="shrink-0 text-caption text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {questions.map((q, idx) => {
            const isFocused = idx === focusIdx;
            return (
              <div
                key={q.id}
                role="group"
                aria-current={isFocused ? "true" : undefined}
                aria-label={`Question ${idx + 1} of ${questions.length}`}
                className={cn(
                  "rounded-2xl border bg-card p-4 shadow-card transition-colors",
                  isFocused
                    ? "border-primary/60 ring-2 ring-primary/20"
                    : "border-border/60",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Question {idx + 1} of {questions.length}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {typeLabel[q.questionType]}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setFocusIdx(idx);
                      void playTtsForQuestion(q);
                    }}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                    aria-label="Replay question audio"
                  >
                    <Volume className="h-4 w-4" />
                  </button>
                </div>

                {q.imageUrl && (
                  <img
                    src={q.imageUrl}
                    alt=""
                    className="mt-3 max-h-48 w-full rounded-lg object-contain"
                  />
                )}

                <p className="mt-2 text-[15px] font-medium leading-snug text-foreground">
                  {renderQuestionText(q, isFocused)}
                </p>

                {renderQuestionBody(q)}
              </div>
            );
          })}

          {/* Prev/Next nav */}
          {questions.length > 1 && (
            <div className="flex items-center justify-between gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={goPrev}
                disabled={focusIdx === 0}
                className="rounded-full gap-1"
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <span className="text-caption text-muted-foreground">
                Focus follows your voice — taps just change what's read aloud.
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={goNext}
                disabled={focusIdx === questions.length - 1}
                className="rounded-full gap-1"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="border-t border-border/60 bg-background/80 px-5 pt-4 pb-6 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <button
            type="button"
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

          <button
            type="button"
            onClick={() => {
              setTtsMuted((v) => {
                const next = !v;
                if (next) cleanupAudio();
                return next;
              });
            }}
            aria-label={ttsMuted ? "Unmute readout" : "Mute readout"}
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all active:scale-[0.96]",
              ttsMuted
                ? "bg-muted text-muted-foreground"
                : "bg-transparent text-foreground hover:bg-muted",
            )}
            title={ttsMuted ? "Question read-aloud is off" : "Question read-aloud is on"}
          >
            <Volume className="h-5 w-5" />
          </button>

          <Button
            variant="outline"
            onClick={onPause}
            className="h-11 flex-1 rounded-full gap-2 text-[14px] font-semibold"
          >
            <Pause className="h-4 w-4" />
            Pause
          </Button>

          <Button
            variant="default"
            onClick={onEndSession}
            className="h-11 flex-1 rounded-full gap-2 text-[14px] font-semibold"
          >
            <Square className="h-3.5 w-3.5" />
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
