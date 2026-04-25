import { Star } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import {
  useStarStation,
  useUnstarStation,
  useStarCollection,
  useUnstarCollection,
} from "@/hooks/use-stars";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface StarButtonProps {
  target: { type: "station" | "collection"; id: number };
  count: number;
  isStarred?: boolean;
  size?: "sm" | "md";
  className?: string;
}

export function StarButton({
  target,
  count,
  isStarred = false,
  size = "md",
  className,
}: StarButtonProps) {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const starStation = useStarStation();
  const unstarStation = useUnstarStation();
  const starCollection = useStarCollection();
  const unstarCollection = useUnstarCollection();

  // Disable the button between click and server ack to prevent double-fires
  // (a rapid second tap while the mutation is in flight would invert the
  // star twice and desync the count).
  const pending =
    starStation.isPending ||
    unstarStation.isPending ||
    starCollection.isPending ||
    unstarCollection.isPending;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (pending) return;
    if (!user) {
      const next = encodeURIComponent(
        window.location.pathname + window.location.search,
      );
      navigate(`/auth?from=${next}`);
      return;
    }
    if (target.type === "station") {
      if (isStarred) unstarStation.mutate(target.id);
      else starStation.mutate(target.id);
    } else {
      if (isStarred) unstarCollection.mutate(target.id);
      else starCollection.mutate(target.id);
    }
  };

  const iconSize = size === "sm" ? "h-4 w-4" : "h-4 w-4";
  const height = size === "sm" ? "h-8" : "h-10";
  const padding = size === "sm" ? "px-3" : "px-4";

  const button = (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      aria-label={isStarred ? "Unstar" : "Star"}
      aria-pressed={isStarred}
      aria-busy={pending}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card font-medium transition-all active:scale-[0.97]",
        "tabular-nums",
        "disabled:opacity-60 disabled:cursor-not-allowed",
        height,
        padding,
        isStarred
          ? "border-brand-accent/40 bg-brand-accent/10 text-brand-accent"
          : "text-foreground hover:border-border",
        className,
      )}
    >
      <Star
        className={cn(
          iconSize,
          "transition-transform",
          isStarred && "fill-brand-accent text-brand-accent",
        )}
      />
      <span className="text-caption">{count}</span>
    </button>
  );

  if (!user) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>Sign in to star</TooltipContent>
      </Tooltip>
    );
  }
  return button;
}
