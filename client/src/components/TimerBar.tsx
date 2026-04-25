import { cn, formatTime } from "@/lib/utils";

interface TimerBarProps {
  totalSeconds: number;
  elapsedSeconds: number;
  onTimeUp?: () => void;
  showText?: boolean;
  className?: string;
}

export function TimerBar({
  totalSeconds,
  elapsedSeconds,
  showText = true,
  className,
}: TimerBarProps) {
  const progress = Math.min((elapsedSeconds / totalSeconds) * 100, 100);
  const remaining = Math.max(totalSeconds - elapsedSeconds, 0);
  const isTimeUp = remaining <= 0;

  // Spec §0.5: no red. Ramp gray → Wisdom Amber → sage (emerald/success).
  const barColor =
    progress < 60
      ? "bg-warm-200"
      : progress < 85
        ? "bg-brand-accent"
        : "bg-success";

  const textColor =
    progress < 60
      ? "text-muted-foreground"
      : progress < 85
        ? "text-brand-accent"
        : "text-success";

  return (
    <div className={cn("w-full", className)}>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-linear", barColor)}
          style={{ width: `${progress}%` }}
        />
      </div>
      {showText && (
        <div className="mt-1 flex items-center justify-end gap-2">
          {isTimeUp && (
            <span className="label rounded-full bg-brand-accent/15 px-2 py-0.5 text-brand-accent">
              Overtime
            </span>
          )}
          <span
            className={cn(
              "tabular-nums font-semibold text-sm w-[5ch] text-right",
              isTimeUp ? "text-brand-accent" : textColor
            )}
          >
            {isTimeUp ? "0:00" : formatTime(remaining)}
          </span>
        </div>
      )}
    </div>
  );
}
