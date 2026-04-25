import { cn } from "@/lib/utils";
import { Check, AlertTriangle } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useId } from "react";

export type ChecklistItemStatus =
  | "pending"
  | "checked"
  | "missed"
  | "checked_after_time"
  | "partial";

interface ChecklistItemProps {
  text: string;
  status: ChecklistItemStatus;
  isCritical: boolean;
  isSubItem?: boolean;
  depth?: number;
  onToggle?: () => void;
  disabled?: boolean;
  childCount?: { checked: number; total: number };
}

export function ChecklistItem({
  text,
  status,
  isCritical,
  isSubItem = false,
  depth = 0,
  onToggle,
  disabled = false,
  childCount,
}: ChecklistItemProps) {
  const isChecked = status === "checked" || status === "checked_after_time";
  const isMissed = status === "missed";
  const labelId = useId();
  const shouldReduce = useReducedMotion();

  return (
    <motion.button
      type="button"
      role="checkbox"
      aria-checked={isChecked}
      aria-labelledby={labelId}
      onClick={disabled ? undefined : onToggle}
      disabled={disabled}
      className={cn(
        "flex w-full min-h-[56px] items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors",
        (isSubItem || depth === 1) && "pl-8",
        depth === 2 && "pl-14",
        !disabled && "active:bg-muted/50"
      )}
      whileTap={disabled || shouldReduce ? {} : { scale: 0.99 }}
    >
      {/* Circular check indicator */}
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
          !isChecked && "border-border",
          isChecked && "border-success bg-success"
        )}
      >
        {isChecked && (
          shouldReduce ? (
            <Check className="h-4 w-4 text-white" strokeWidth={3} />
          ) : (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 24 }}
            >
              <Check className="h-4 w-4 text-white" strokeWidth={3} />
            </motion.span>
          )
        )}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <span
          id={labelId}
          className={cn(
            "text-body",
            isChecked && "text-success",
            isMissed && "text-destructive",
            !isChecked && !isMissed && "text-foreground"
          )}
        >
          {text}
        </span>

        {childCount && childCount.total > 0 && (
          <span className="ml-2 text-caption text-muted-foreground tabular-nums">
            ({childCount.checked}/{childCount.total})
          </span>
        )}
      </div>

      {isCritical && (
        <span
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-accent/10 px-2 py-0.5 text-label text-brand-accent"
          aria-label="Critical item"
        >
          <AlertTriangle className="h-3 w-3" />
          Critical
        </span>
      )}
    </motion.button>
  );
}
