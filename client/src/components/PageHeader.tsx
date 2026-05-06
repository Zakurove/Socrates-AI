import { useLocation } from "wouter";
import { ArrowLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type PageHeaderVariant = "default" | "fullscreen" | "modal";

export interface PageHeaderProps {
  /** Main title. Omit for fullscreen runners. */
  title?: string;
  /** Optional secondary line (e.g. collection context under a station title). */
  subtitle?: React.ReactNode;
  /**
   * Where tapping back should go. Pass a string path to navigate, a function
   * to intercept (e.g. confirm-before-exit), or omit to render no back
   * control (tab-root pages).
   */
  backTo?: string | (() => void);
  /** ARIA label override for the back button. */
  backLabel?: string;
  /** Right-slot actions (icon buttons, overflow menu). */
  actions?: React.ReactNode;
  /** Visual variant: default | fullscreen | modal. */
  variant?: PageHeaderVariant;
  /** For modal variant: label for the primary right-side button (e.g. "Save"). */
  rightLabel?: string;
  /** For modal variant: handler for the primary right-side button. */
  onRightPress?: () => void;
  /** For modal variant: disable the primary right-side button. */
  rightDisabled?: boolean;
  /**
   * Use the wider 960px inner container.
   *
   * @deprecated Only `/admin/reports` still uses this. All other pages should
   * rely on the `AppShell` layout (SideNav + flex-1 content) at `lg+` instead
   * of a hard `max-w-[960px]` cap. Do not add new usages. Remove once the
   * admin page is reworked.
   */
  wide?: boolean;
  /** Extra class names for the outer header element. */
  className?: string;
  /** Center-align the title (used for certain modal flows). Default false. */
  centerTitle?: boolean;
}

/**
 * Single source of truth for page chrome. Replaces the ad-hoc sticky
 * headers that drifted across pages with different icons, sizes, z-indexes,
 * and back destinations.
 *
 * Tab-root pages (Home, MyStations, Library, etc.) pass no `backTo` and
 * optionally pass `actions` for their right-side CTA.
 *
 * Detail pages pass `backTo` as an explicit route string (never rely on
 * history; use `parentOf(location)` from `lib/navigation.ts`).
 *
 * Fullscreen practice runners use `variant="fullscreen"` and pass a
 * function `backTo` that triggers a confirm-before-exit dialog.
 */
export function PageHeader({
  title,
  subtitle,
  backTo,
  backLabel,
  actions,
  variant = "default",
  rightLabel,
  onRightPress,
  rightDisabled,
  wide = false,
  className,
  centerTitle = false,
}: PageHeaderProps) {
  const [, navigate] = useLocation();

  const handleBack = () => {
    if (typeof backTo === "function") return backTo();
    if (typeof backTo === "string") return navigate(backTo);
  };

  const isFullscreen = variant === "fullscreen";
  const isModal = variant === "modal";

  const BackIcon = isFullscreen ? X : ArrowLeft;

  return (
    <header
      className={cn(
        "sticky top-0 z-30 safe-top",
        isFullscreen
          ? "bg-background/60 backdrop-blur-md"
          : "border-b border-border/40 bg-background/75 backdrop-blur-xl backdrop-saturate-150 supports-[backdrop-filter]:bg-background/60",
        className,
      )}
    >
      <div
        className={cn(
          "mx-auto flex h-14 w-full items-center gap-2 px-4",
          wide ? "max-w-[960px]" : "max-w-[440px]",
        )}
      >
        {/* Left slot */}
        <div className="flex h-11 w-11 shrink-0 items-center justify-start">
          {backTo !== undefined && !isModal && (
            <button
              type="button"
              aria-label={backLabel ?? (isFullscreen ? "Close" : "Go back")}
              onClick={handleBack}
              className="-ml-1 inline-flex h-11 w-11 items-center justify-center rounded-full text-foreground/80 transition-colors hover:bg-muted active:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <BackIcon className="h-5 w-5" strokeWidth={2} aria-hidden />
            </button>
          )}
          {isModal && backTo !== undefined && (
            <button
              type="button"
              aria-label={backLabel ?? "Cancel"}
              onClick={handleBack}
              className="-ml-1 inline-flex h-11 items-center justify-center rounded-full px-3 text-[14px] font-medium text-foreground/80 transition-colors hover:bg-muted active:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Cancel
            </button>
          )}
        </div>

        {/* Title */}
        <div
          className={cn(
            "min-w-0 flex-1",
            centerTitle ? "text-center" : "text-left",
          )}
        >
          {title && (
            <h1 className="truncate text-[17px] font-semibold tracking-tight text-foreground">
              {title}
            </h1>
          )}
          {subtitle && (
            <div className="truncate text-[12px] leading-tight text-muted-foreground">
              {subtitle}
            </div>
          )}
        </div>

        {/* Right slot */}
        <div className="flex min-h-11 min-w-11 shrink-0 items-center justify-end gap-1">
          {isModal && rightLabel ? (
            <Button
              type="button"
              size="sm"
              onClick={onRightPress}
              disabled={rightDisabled}
            >
              {rightLabel}
            </Button>
          ) : (
            actions
          )}
        </div>
      </div>
    </header>
  );
}
