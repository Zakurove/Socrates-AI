import { useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { CheckSquare, Mic, MessageCircle } from "lucide-react";

type PracticeMode = "self-check" | "ai-listen" | "ai-conversation";

interface PracticeModeSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stationId: number;
  stationType: string;
  hasPatientBriefing: boolean;
  hasExaminerQuestions: boolean;
}

const modes: Array<{
  key: PracticeMode;
  icon: typeof CheckSquare;
  title: string;
  description: string;
}> = [
  {
    key: "self-check",
    icon: CheckSquare,
    title: "Self-check",
    description: "Check items off yourself as you go.",
  },
  {
    key: "ai-listen",
    icon: Mic,
    title: "AI Listen",
    description: "Speak aloud — AI listens and marks your checklist.",
  },
  {
    key: "ai-conversation",
    icon: MessageCircle,
    title: "AI Conversation",
    description: "Talk with a simulated patient, then answer examiner questions.",
  },
];

/**
 * Pre-highlight the most appropriate AI mode by default.
 *   - If a patient briefing is present, default to AI Conversation.
 *   - Otherwise, default to AI Listen.
 *   - Fall back to Self-check only when no AI option is compelling
 *     (kept as a safety net — today both AI modes are always applicable
 *     at least in Listen form, so this effectively never triggers).
 */
function getSmartDefault(
  stationType: string,
  hasPatientBriefing: boolean
): PracticeMode {
  // Q&A stations: no narration sense — default to self-check so the user can
  // read, pick, and move through questions. (AI voice mode for MCQ lands later.)
  if (stationType === "qa") return "self-check";
  if (hasPatientBriefing) return "ai-conversation";
  return "ai-listen";
}

export function PracticeModeSheet({
  open,
  onOpenChange,
  stationId,
  stationType,
  hasPatientBriefing,
  hasExaminerQuestions,
}: PracticeModeSheetProps) {
  const [, navigate] = useLocation();
  const smartDefault = useMemo(
    () => getSmartDefault(stationType, hasPatientBriefing),
    [stationType, hasPatientBriefing]
  );

  const isQA = stationType === "qa";
  const handleSelect = useCallback(
    (mode: PracticeMode) => {
      if (mode === "ai-conversation" && !hasPatientBriefing) return;
      if (mode === "ai-listen" && isQA) return;

      onOpenChange(false);

      switch (mode) {
        case "self-check":
          navigate(`/station/${stationId}/practice`);
          break;
        case "ai-listen":
          navigate(`/station/${stationId}/ai-practice?mode=listen`);
          break;
        case "ai-conversation":
          navigate(`/station/${stationId}/ai-practice?mode=conversation`);
          break;
      }
    },
    [stationId, hasPatientBriefing, navigate, onOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px] rounded-3xl p-0 gap-0 border-border/60 shadow-lg">
        <DialogHeader className="px-6 pt-6 pb-2 text-left space-y-2">
          <DialogTitle className="font-display text-h2 text-foreground">
            Choose practice mode
          </DialogTitle>
          {hasExaminerQuestions && (
            <DialogDescription className="text-caption text-muted-foreground">
              This station includes examiner questions
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="flex flex-col gap-3 px-6 pt-4 pb-6">
          {modes.map(({ key, icon: Icon, title, description }) => {
            const isDisabled =
              (key === "ai-conversation" && !hasPatientBriefing) ||
              (key === "ai-listen" && isQA);
            const isDefault = key === smartDefault && !isDisabled;

            return (
              <button
                key={key}
                onClick={() => handleSelect(key)}
                disabled={isDisabled}
                className={cn(
                  "relative flex w-full min-h-[72px] items-center gap-4 rounded-2xl border px-4 py-3 text-left transition-all",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  isDisabled
                    ? "opacity-60 cursor-not-allowed border-border/40 bg-muted/30"
                    : "border-border/60 bg-card hover:border-brand-accent/50 hover:shadow-card active:scale-[0.99] cursor-pointer",
                  isDefault && "ring-1 ring-primary/30"
                )}
              >
                <div
                  className={cn(
                    "flex-shrink-0 flex h-8 w-8 items-center justify-center rounded-full",
                    isDisabled
                      ? "bg-muted text-muted-foreground"
                      : "bg-primary/10 text-primary"
                  )}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0 pr-16">
                  <p className="text-[17px] font-semibold text-foreground">
                    {title}
                  </p>
                  <p className="text-caption text-muted-foreground mt-0.5">
                    {isDisabled && key === "ai-conversation"
                      ? "Add a patient briefing to enable AI Conversation."
                      : description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
