import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  ArrowLeft,
  Check,
  CheckSquare,
  Loader2,
  MessageCircle,
  Mic,
  Play,
  Search,
  Sparkles,
} from "lucide-react";
import { useStations } from "@/hooks/use-stations";
import {
  useCreateMockExam,
  useCreateMockExamAttempt,
} from "@/hooks/use-mock-exams";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import type { MockExamPracticeMode } from "@shared/schema";

const REST_OPTIONS = [60, 90, 120, 180];

function formatMinutes(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
}

type Step = 1 | 2 | 3 | 4;

export default function MockExamNewPage() {
  const [, navigate] = useLocation();
  const { data: stations, isLoading } = useStations();
  const [step, setStep] = useState<Step>(1);
  const [title, setTitle] = useState("");
  // Track selection order: server respects array order as the circuit
  // running order, so a Set would silently fall back to insertion-into-Set
  // order which is brittle when toggling. Keep an explicit array.
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const [rest, setRest] = useState(120);
  const [practiceMode, setPracticeMode] =
    useState<MockExamPracticeMode>("self_check");
  const [typeFilter, setTypeFilter] = useState<string | "all">("all");
  const [search, setSearch] = useState("");
  const createMutation = useCreateMockExam();
  const createAttempt = useCreateMockExamAttempt();
  const { toast } = useToast();

  const filtered = useMemo(() => {
    if (!stations) return [];
    return stations.filter((s) => {
      if (typeFilter !== "all" && s.type !== typeFilter) return false;
      if (
        search &&
        !s.title.toLowerCase().includes(search.toLowerCase())
      )
        return false;
      return true;
    });
  }, [stations, typeFilter, search]);

  type StationItem = NonNullable<typeof stations>[number];

  const { stationMinutes, totalSeconds, orderedIds, orderedStations } =
    useMemo(() => {
      const byId = new Map<number, StationItem>();
      if (stations) {
        for (const s of stations) byId.set(s.id, s);
      }
      let mins = 0;
      const ordered: number[] = [];
      const orderedSt: StationItem[] = [];
      for (const id of selectedIds) {
        const st = byId.get(id);
        if (!st) continue;
        ordered.push(id);
        orderedSt.push(st);
        mins += st.defaultTimeMinutes;
      }
      const rests = Math.max(0, ordered.length - 1) * rest;
      return {
        stationMinutes: mins,
        totalSeconds: mins * 60 + rests,
        orderedIds: ordered,
        orderedStations: orderedSt,
      };
    }, [stations, selectedIds, rest]);

  // AI Conversation requires every selected station to carry a patient
  // briefing — otherwise the runner would stall on any station that lacks
  // one. Surface this at mode selection so the user can fix up-stream.
  const aiConversationDisabled = useMemo(() => {
    if (orderedStations.length === 0) return true;
    return orderedStations.some(
      (s) => !s.hasPatientBriefing || !s.patientBriefing?.trim()
    );
  }, [orderedStations]);

  // If the user selected ai_conversation then later edits the circuit to
  // include a station without a briefing, silently demote to self_check so
  // we don't submit an invalid payload.
  useEffect(() => {
    if (practiceMode === "ai_conversation" && aiConversationDisabled) {
      setPracticeMode("self_check");
    }
  }, [practiceMode, aiConversationDisabled]);

  const toggle = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const canAdvanceFrom1 = orderedIds.length > 0;
  const canAdvanceFrom2 = true;
  const canAdvanceFrom3 = true;
  const canSubmit =
    title.trim().length > 0 &&
    orderedIds.length > 0 &&
    !createMutation.isPending;

  const onCreateAndStart = async () => {
    if (!canSubmit) return;
    try {
      const exam = await createMutation.mutateAsync({
        title: title.trim(),
        stationIds: orderedIds,
        restSeconds: rest,
        practiceMode,
      });
      // Templates are now reusable — create the first attempt and route
      // directly into the runner, which will route to the first station.
      const result = await createAttempt.mutateAsync(exam.id);
      const qs = `?mockExamId=${exam.id}&mockExamAttemptId=${result.attempt.id}`;
      const url =
        practiceMode === "ai_listen"
          ? `/station/${result.currentStationId}/ai-practice${qs}&mode=listen`
          : practiceMode === "ai_conversation"
            ? `/station/${result.currentStationId}/ai-practice${qs}&mode=conversation`
            : `/station/${result.currentStationId}/practice${qs}`;
      navigate(url);
    } catch (err) {
      toast({
        title: "Failed to create mock exam",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  const onBack = () => {
    if (step === 1) navigate("/mock-exam");
    else setStep((s) => (s - 1) as Step);
  };

  const stepLabel =
    step === 1
      ? "Select stations"
      : step === 2
        ? "Set rest"
        : step === 3
          ? "Choose mode"
          : "Confirm";

  return (
    <div className="min-h-screen pb-40 bg-background flex flex-col">
      <div className="safe-top" />

      {/* Header */}
      <div className="sticky top-0 z-10 backdrop-blur-xl bg-background/80 border-b border-border/40">
        <div className="px-5 h-14 flex items-center gap-3">
          <button
            onClick={onBack}
            className="h-11 w-11 -ml-2 grid place-items-center rounded-full hover:bg-muted transition-smooth"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-[17px] font-semibold tracking-tight truncate">
            New mock exam
          </h1>
        </div>
        {/* Stepper */}
        <div className="px-5 pb-3">
          <div className="flex items-center gap-2" aria-label="Progress">
            {[1, 2, 3, 4].map((n) => (
              <div
                key={n}
                className={cn(
                  "h-1 flex-1 rounded-full transition-smooth",
                  step >= n ? "bg-primary" : "bg-muted"
                )}
              />
            ))}
          </div>
          <p className="mt-2 text-label text-muted-foreground uppercase">
            Step {step} of 4 · {stepLabel}
          </p>
        </div>
      </div>

      <div className="px-5 pt-6 space-y-6 flex-1">
        {/* STEP 1: stations */}
        {step === 1 && (
          <div className="space-y-4">
            <header className="space-y-1">
              <h2 className="text-h1 text-foreground">Pick stations</h2>
              <p className="text-body text-muted-foreground">
                Choose the stations that will make up your circuit. Order
                follows selection order.
              </p>
            </header>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search stations"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-12 rounded-xl"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {(
                [
                  "all",
                  "history_taking",
                  "physical_exam",
                  "communication",
                  "image_id",
                  "custom",
                ] as const
              ).map((t) => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={cn(
                    "rounded-full px-3.5 h-8 text-[12px] font-semibold border transition-smooth capitalize active:scale-[0.98]",
                    typeFilter === t
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card border-border/60 text-muted-foreground hover:bg-muted"
                  )}
                >
                  {t === "all" ? "All" : t.replace(/_/g, " ")}
                </button>
              ))}
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-body text-muted-foreground py-10 text-center">
                No stations match.
              </p>
            ) : (
              <div className="space-y-2">
                {filtered.map((s) => {
                  const checked = selectedSet.has(s.id);
                  const order = checked
                    ? selectedIds.indexOf(s.id) + 1
                    : null;
                  return (
                    <button
                      type="button"
                      key={s.id}
                      onClick={() => toggle(s.id)}
                      className={cn(
                        "w-full flex items-center gap-3 p-4 rounded-2xl border text-left transition-smooth active:scale-[0.99]",
                        checked
                          ? "bg-primary/5 border-primary/60 shadow-card"
                          : "bg-card border-border/60 hover:bg-muted/40"
                      )}
                    >
                      <div
                        className={cn(
                          "h-8 w-8 rounded-full shrink-0 grid place-items-center text-[12px] font-semibold tabular-nums transition-smooth",
                          checked
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {checked ? order : <Check className="h-4 w-4 opacity-0" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-body font-semibold truncate text-foreground">
                          {s.title}
                        </div>
                        <div className="text-caption text-muted-foreground capitalize">
                          {s.type.replace(/_/g, " ")} ·{" "}
                          {s.defaultTimeMinutes}m
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* STEP 2: rest + title */}
        {step === 2 && (
          <div className="space-y-8">
            <header className="space-y-1">
              <h2 className="text-h1 text-foreground">Name & pacing</h2>
              <p className="text-body text-muted-foreground">
                Give your circuit a name and choose how long to rest between
                stations.
              </p>
            </header>

            <div className="space-y-2">
              <label className="text-label text-muted-foreground uppercase">
                Title
              </label>
              <Input
                placeholder="e.g. Neuro circuit — week 3"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={255}
                className="h-12 rounded-xl text-[17px]"
              />
            </div>

            <div className="space-y-3">
              <label className="text-label text-muted-foreground uppercase">
                Rest between stations
              </label>
              <div className="grid grid-cols-4 gap-2">
                {REST_OPTIONS.map((sec) => (
                  <button
                    key={sec}
                    onClick={() => setRest(sec)}
                    className={cn(
                      "h-12 rounded-xl border text-[15px] font-semibold tabular-nums transition-smooth active:scale-[0.98]",
                      rest === sec
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card border-border/60 hover:bg-muted"
                    )}
                  >
                    {sec}s
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: practice mode */}
        {step === 3 && (
          <div className="space-y-6">
            <header className="space-y-1">
              <h2 className="text-h1 text-foreground">Practice mode</h2>
              <p className="text-body text-muted-foreground">
                All stations in this exam run in the chosen mode — real OSCEs
                are one format throughout.
              </p>
            </header>

            <div className="space-y-2">
              <ModeCard
                active={practiceMode === "self_check"}
                onClick={() => setPracticeMode("self_check")}
                Icon={CheckSquare}
                title="Self-check"
                description="Check items off yourself as you go."
              />
              <ModeCard
                active={practiceMode === "ai_listen"}
                onClick={() => setPracticeMode("ai_listen")}
                Icon={Mic}
                title="AI Listen"
                description="Speak aloud — AI listens and marks your checklist."
                premium
              />
              <ModeCard
                active={practiceMode === "ai_conversation"}
                onClick={() =>
                  !aiConversationDisabled &&
                  setPracticeMode("ai_conversation")
                }
                Icon={MessageCircle}
                title="AI Conversation"
                description="Talk with a simulated patient, then answer examiner questions."
                premium
                disabled={aiConversationDisabled}
                disabledCaption="Every station in this circuit needs a patient briefing. Edit stations to enable."
              />
            </div>
          </div>
        )}

        {/* STEP 4: confirm */}
        {step === 4 && (
          <div className="space-y-6">
            <header className="space-y-1">
              <h2 className="text-h1 text-foreground">Confirm</h2>
              <p className="text-body text-muted-foreground">
                Review before starting.
              </p>
            </header>

            <div className="rounded-3xl bg-card border border-border/60 p-5 shadow-card">
              <p className="text-label text-muted-foreground uppercase">
                Estimated total time
              </p>
              <p className="mt-1 text-[40px] font-bold tabular-nums leading-none tracking-tight text-foreground">
                {formatMinutes(totalSeconds)}
              </p>
              <p className="mt-2 text-caption text-muted-foreground">
                {stationMinutes}m stations
                {orderedIds.length > 1 && (
                  <>
                    {" + "}
                    {Math.max(0, orderedIds.length - 1)} × {rest}s rest
                  </>
                )}
              </p>
              <div className="mt-4 pt-4 border-t border-border/40 flex items-center gap-2">
                <span className="text-caption text-muted-foreground">Mode</span>
                <span className="text-caption font-semibold text-foreground">
                  {practiceMode === "self_check"
                    ? "Self-check"
                    : practiceMode === "ai_listen"
                      ? "AI Listen"
                      : "AI Conversation"}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-label text-muted-foreground uppercase">
                Circuit ({orderedStations.length} station
                {orderedStations.length === 1 ? "" : "s"})
              </p>
              <div className="rounded-2xl bg-card border border-border/60 overflow-hidden divide-y divide-border/40">
                {orderedStations.map((s, i) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-3 p-4"
                  >
                    <div className="h-8 w-8 rounded-full bg-primary/10 grid place-items-center text-[12px] font-semibold text-primary tabular-nums shrink-0">
                      {i + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-body font-semibold truncate">
                        {s.title}
                      </div>
                      <div className="text-caption text-muted-foreground capitalize">
                        {s.type.replace(/_/g, " ")} ·{" "}
                        {s.defaultTimeMinutes}m
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Sticky footer CTA */}
      <div className="fixed bottom-0 inset-x-0 z-20 backdrop-blur-xl bg-background/80 border-t border-border/40 safe-bottom">
        <div className="px-5 py-4">
          {step < 4 ? (
            <Button
              disabled={
                (step === 1 && !canAdvanceFrom1) ||
                (step === 2 && !canAdvanceFrom2) ||
                (step === 3 && !canAdvanceFrom3)
              }
              onClick={() => setStep((s) => (s + 1) as Step)}
              className="w-full rounded-full h-12 text-[17px] font-semibold tracking-tight"
            >
              Continue
              {step === 1 && orderedIds.length > 0 && (
                <span className="ml-2 text-[13px] opacity-80 tabular-nums">
                  ({orderedIds.length} selected)
                </span>
              )}
            </Button>
          ) : (
            <Button
              disabled={!canSubmit}
              onClick={onCreateAndStart}
              className="w-full rounded-full h-12 text-[17px] font-semibold tracking-tight gap-2"
            >
              {createMutation.isPending || createAttempt.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Create & start
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mode card
// ---------------------------------------------------------------------------

function ModeCard({
  active,
  onClick,
  Icon,
  title,
  description,
  premium,
  disabled,
  disabledCaption,
}: {
  active: boolean;
  onClick: () => void;
  Icon: typeof CheckSquare;
  title: string;
  description: string;
  premium?: boolean;
  disabled?: boolean;
  disabledCaption?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full flex items-start gap-3 p-4 rounded-2xl border text-left transition-smooth",
        disabled
          ? "opacity-60 cursor-not-allowed bg-muted/30 border-border/40"
          : active
            ? "bg-primary/5 border-primary/60 shadow-card active:scale-[0.99]"
            : "bg-card border-border/60 hover:bg-muted/40 active:scale-[0.99]"
      )}
    >
      <div
        className={cn(
          "h-10 w-10 rounded-full grid place-items-center shrink-0",
          disabled
            ? "bg-muted text-muted-foreground"
            : active
              ? "bg-primary text-primary-foreground"
              : "bg-primary/10 text-primary"
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-[17px] font-semibold tracking-tight text-foreground">
            {title}
          </p>
          {premium && !disabled && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-accent/15 px-2 py-0.5">
              <Sparkles className="h-3 w-3 text-brand-accent" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-brand-accent">
                Premium
              </span>
            </span>
          )}
        </div>
        <p className="mt-0.5 text-caption text-muted-foreground">
          {disabled && disabledCaption ? disabledCaption : description}
        </p>
      </div>
      {active && !disabled && (
        <div className="h-6 w-6 rounded-full bg-primary grid place-items-center shrink-0">
          <Check className="h-3.5 w-3.5 text-primary-foreground" />
        </div>
      )}
    </button>
  );
}
