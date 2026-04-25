import { useMemo, useState } from "react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn, formatTime } from "@/lib/utils";
import type { StationWithDetails } from "@shared/schema";

interface ReadingPhaseProps {
  /** Station being practiced. */
  station: StationWithDetails;
  /** Current countdown value in seconds. Pass -1 while uninitialized to hide the timer. */
  readingTimeSeconds: number;
  /** Called when the user taps "Begin". */
  onBegin: () => void;
  /** Called when the user confirms cancel (via the close/X). */
  onCancel: () => void;
  /** Disable the Begin button (e.g. while a session is being created). */
  isBeginPending?: boolean;
  /** Optional small mode chip, e.g. "Self-check", "Listen mode", "Conversation mode". */
  modeLabel?: string;
}

/**
 * Shared pre-session reading/countdown/Begin screen used across all three
 * practice modes (Self-check, AI Listen, AI Conversation). Iter7 item 9
 * unifies this screen to match the iter6 AI Listen visual.
 */
export function ReadingPhase({
  station,
  readingTimeSeconds,
  onBegin,
  onCancel,
  isBeginPending = false,
  modeLabel,
}: ReadingPhaseProps) {
  const [showCancelDialog, setShowCancelDialog] = useState(false);

  // Total reading window in seconds, derived from the station. Used to draw
  // the countdown ring fill. Falls back to 60s when the station is set to 0.
  const totalReadingSeconds = useMemo(
    () => Math.max(station.readingTimeMinutes * 60, 1),
    [station.readingTimeMinutes],
  );

  // Clamp progress to [0, 1] for the ring.
  const progress = useMemo(() => {
    if (readingTimeSeconds <= 0) return 0;
    return Math.min(Math.max(readingTimeSeconds / totalReadingSeconds, 0), 1);
  }, [readingTimeSeconds, totalReadingSeconds]);

  const showCountdown =
    station.readingTimeMinutes > 0 && readingTimeSeconds > 0;

  // SVG ring geometry
  const ringSize = 160;
  const stroke = 6;
  const radius = (ringSize - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress);

  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      {/* Close / X — top right, sticky, backdrop-blur chrome */}
      <div className="sticky top-0 z-20 flex items-center justify-end bg-background/80 px-5 py-3 backdrop-blur-xl safe-top">
        <button
          type="button"
          aria-label="Close"
          onClick={() => setShowCancelDialog(true)}
          className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-all hover:bg-muted hover:text-foreground active:scale-[0.96]"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center px-5 pb-10">
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center text-center">
          {/* Optional mode chip */}
          {modeLabel && (
            <p className="mb-4 text-label uppercase text-muted-foreground">
              {modeLabel}
            </p>
          )}

          {/* Title */}
          <h1 className="font-display text-display text-foreground">
            {station.title}
          </h1>

          {/* Reading countdown ring */}
          {showCountdown && (
            <div
              className="relative mt-8 flex items-center justify-center"
              style={{ width: ringSize, height: ringSize }}
            >
              <svg
                width={ringSize}
                height={ringSize}
                viewBox={`0 0 ${ringSize} ${ringSize}`}
                className="-rotate-90"
                aria-hidden="true"
              >
                <circle
                  cx={ringSize / 2}
                  cy={ringSize / 2}
                  r={radius}
                  stroke="currentColor"
                  strokeWidth={stroke}
                  className="text-border/50"
                  fill="none"
                />
                <circle
                  cx={ringSize / 2}
                  cy={ringSize / 2}
                  r={radius}
                  stroke="currentColor"
                  strokeWidth={stroke}
                  className="text-brand-accent transition-[stroke-dashoffset] duration-1000 ease-linear"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                />
              </svg>
              <p className="absolute font-display text-[40px] font-semibold leading-none tabular-nums text-foreground">
                {formatTime(readingTimeSeconds)}
              </p>
            </div>
          )}

          {/* Reference image for image_id stations */}
          {station.type === "image_id" && station.referenceImageUrl && (
            <div className="mt-8 w-full overflow-hidden rounded-2xl border border-border/60 bg-card shadow-card">
              <TransformWrapper>
                <TransformComponent>
                  <img
                    src={station.referenceImageUrl}
                    alt={station.referenceImageCaption || "Reference image"}
                    className="h-auto w-full"
                  />
                </TransformComponent>
              </TransformWrapper>
              {station.referenceImageCaption && (
                <p className="px-4 py-3 text-caption text-muted-foreground">
                  {station.referenceImageCaption}
                </p>
              )}
            </div>
          )}

          {/* Scenario */}
          {station.scenario ? (
            <div className="mt-8 w-full rounded-2xl border border-border/60 bg-card p-5 text-left shadow-card">
              <p className="whitespace-pre-wrap text-body text-foreground">
                {station.scenario}
              </p>
            </div>
          ) : (
            <p className="mt-8 text-body text-muted-foreground">
              No scenario text. Press Begin when ready.
            </p>
          )}

          {/* Patient briefing callout */}
          {station.patientBriefing && (
            <div className="mt-4 w-full rounded-2xl border border-brand-accent/30 bg-brand-accent/10 p-5 text-left">
              <p className="mb-2 text-label uppercase text-brand-accent">
                Patient Briefing
              </p>
              <p className="whitespace-pre-wrap text-body text-foreground/80">
                {station.patientBriefing}
              </p>
            </div>
          )}

          {/* Begin CTA */}
          <div className="w-full max-w-xs pt-10">
            <Button
              onClick={onBegin}
              disabled={isBeginPending}
              className={cn(
                "h-12 w-full rounded-full bg-primary text-[17px] font-semibold tracking-[-0.01em] text-primary-foreground shadow-md transition-all active:scale-[0.98]",
              )}
            >
              {isBeginPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Begin
            </Button>
          </div>
        </div>
      </div>

      {/* Confirm-to-exit dialog */}
      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave this station?</AlertDialogTitle>
            <AlertDialogDescription>
              You haven't started the session yet. You can always come back and
              start again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep reading</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowCancelDialog(false);
                onCancel();
              }}
            >
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
