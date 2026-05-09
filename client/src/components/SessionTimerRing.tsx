import { Eye, EyeOff } from "lucide-react";
import { cn, formatTime } from "@/lib/utils";

/**
 * Rich session timer used during the active practice phase. Mirrors the
 * pre-session reading-countdown visual (SVG ring + central tabular-nums),
 * scaled down for the sticky header. Replaces the legacy thin TimerBar.
 *
 * Behavior:
 *  - Ring fills from full → empty as elapsed → totalSeconds.
 *  - Color ramp: primary (calm) → amber (warning) → emerald (final stretch) →
 *    amber (overtime).
 *  - Overtime: ring stays empty, central text shows `+m:ss` in amber, label
 *    flips to "Over time" so the user can see by how much they've gone past.
 *  - `hidden=true` collapses the ring to a small "Show timer" pill so the
 *    user can practice without time-anxiety. Default is shown.
 */
export function SessionTimerRing({
  totalSeconds,
  elapsedSeconds,
  hidden,
  onToggleHide,
  className,
}: {
  totalSeconds: number;
  elapsedSeconds: number;
  hidden?: boolean;
  onToggleHide?: () => void;
  className?: string;
}) {
  if (hidden) {
    return (
      <div className={cn("flex items-center justify-center", className)}>
        <button
          type="button"
          onClick={onToggleHide}
          className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          aria-label="Show timer"
        >
          <Eye className="h-3.5 w-3.5" aria-hidden />
          Show timer
        </button>
      </div>
    );
  }

  const remaining = totalSeconds - elapsedSeconds;
  const isOver = remaining < 0;
  const overBy = isOver ? -remaining : 0;
  const progress = Math.min(Math.max(elapsedSeconds / totalSeconds, 0), 1);

  // Same palette as TimerBar / ReadingPhase: primary → amber → emerald.
  const ringColor = isOver
    ? "text-brand-accent"
    : progress >= 0.85
      ? "text-success"
      : progress >= 0.6
        ? "text-brand-accent"
        : "text-primary";
  const textColor = isOver
    ? "text-brand-accent"
    : progress >= 0.85
      ? "text-success"
      : progress >= 0.6
        ? "text-brand-accent"
        : "text-foreground";

  // SVG geometry — compact for sticky-top header.
  const ringSize = 88;
  const stroke = 6;
  const radius = (ringSize - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  // In overtime the ring is empty (full dashOffset).
  const fillFraction = isOver ? 0 : 1 - progress;
  const dashOffset = circumference * (1 - fillFraction);

  const centerText = isOver ? `+${formatTime(overBy)}` : formatTime(Math.max(remaining, 0));
  const labelText = isOver ? "Over time" : "Remaining";

  return (
    <div className={cn("flex flex-col items-center gap-1.5", className)}>
      <div
        className="relative"
        style={{ width: ringSize, height: ringSize }}
        role="timer"
        aria-live="off"
        aria-label={isOver ? `${formatTime(overBy)} over time` : `${formatTime(Math.max(remaining, 0))} remaining`}
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
            className="text-border/40"
            fill="none"
          />
          <circle
            cx={ringSize / 2}
            cy={ringSize / 2}
            r={radius}
            stroke="currentColor"
            strokeWidth={stroke}
            className={cn("transition-[stroke-dashoffset,color] duration-700 ease-linear", ringColor)}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className={cn(
              "font-display font-semibold tabular-nums leading-none",
              isOver ? "text-[20px]" : "text-[22px]",
              textColor,
            )}
          >
            {centerText}
          </span>
          <span className="mt-1 text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            {labelText}
          </span>
        </div>
      </div>

      {onToggleHide && (
        <button
          type="button"
          onClick={onToggleHide}
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          aria-label="Hide timer"
        >
          <EyeOff className="h-3 w-3" aria-hidden />
          Hide timer
        </button>
      )}
    </div>
  );
}
