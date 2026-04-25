import { GitFork, Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useForkStation, useForkCollection } from "@/hooks/use-fork";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

interface ForkButtonProps {
  target: { type: "station" | "collection"; id: number };
  /**
   * userId of the source's author. When equal to the current user's id, the
   * button hides entirely — forking your own station is a no-op the server
   * rejects with 422, and showing the button creates a confusing UX.
   */
  authorId?: number;
  size?: "sm" | "md" | "lg";
  className?: string;
  variant?: "primary" | "outline";
}

export function ForkButton({
  target,
  authorId,
  size = "md",
  className,
  variant = "primary",
}: ForkButtonProps) {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const forkStation = useForkStation();
  const forkCollection = useForkCollection();

  const pending = forkStation.isPending || forkCollection.isPending;

  // Hide the fork button when the viewer IS the author — forking your own
  // content is nonsense, and showing the CTA would confuse owners who
  // navigate to their own public detail pages to preview how they look.
  if (user && authorId !== undefined && user.id === authorId) {
    return null;
  }

  const handleClick = async () => {
    if (!user) {
      const next = encodeURIComponent(
        window.location.pathname + window.location.search,
      );
      navigate(`/auth?from=${next}`);
      return;
    }
    try {
      if (target.type === "station") {
        const result = await forkStation.mutateAsync(target.id);
        toast({
          title: "Added to My Stations",
          description: "Customize as you like",
        });
        navigate(`/station/${result.id}`);
      } else {
        const result = await forkCollection.mutateAsync(target.id);
        toast({
          title: "Added to your collections",
          description: "Customize as you like",
        });
        navigate(`/collections/${result.id}`);
      }
    } catch (err) {
      const msg = (err as Error).message.replace(/^\d+:\s*/, "");
      toast({
        title: "Fork failed",
        description: msg || "Please try again.",
        variant: "destructive",
      });
    }
  };

  const label = !user
    ? "Sign in to fork"
    : target.type === "station"
      ? "Fork to my stations"
      : "Fork collection";

  const height = size === "lg" ? "h-12" : size === "sm" ? "h-9" : "h-11";
  const textSize = size === "lg" ? "text-[16px]" : "text-[14px]";

  return (
    <Button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className={cn(
        "gap-2 rounded-full font-semibold",
        height,
        textSize,
        variant === "primary"
          ? "bg-primary text-primary-foreground hover:bg-primary/90"
          : "bg-card text-foreground border border-border hover:bg-muted",
        className,
      )}
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <GitFork className="h-4 w-4" />
      )}
      {pending ? "Forking..." : label}
    </Button>
  );
}
