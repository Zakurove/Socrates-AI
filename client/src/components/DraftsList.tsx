import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { ChevronRight, X as XIcon, FileEdit } from "lucide-react";
import {
  listAllDrafts,
  discardDraft,
  type DraftSummary,
} from "@/lib/editor-draft";
import { useToast } from "@/components/ui/use-toast";
import { ToastAction } from "@/components/ui/toast";

function relativeTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function draftDestination(id: string): string {
  return id === "new" ? "/station/new" : `/station/${id}/edit`;
}

interface DraftsListProps {
  /** Optional section heading. Defaults to "Unsaved drafts". Pass null to render no heading. */
  heading?: string | null;
  className?: string;
}

/**
 * Lists in-progress editor drafts found in localStorage and lets the user
 * resume or discard them. Renders nothing if there are no drafts.
 */
export function DraftsList({
  heading = "Unsaved drafts",
  className,
}: DraftsListProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [drafts, setDrafts] = useState<DraftSummary[]>(() => listAllDrafts());

  // Rescan on mount (covers remount after navigation) and when another tab
  // mutates localStorage.
  useEffect(() => {
    setDrafts(listAllDrafts());
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key.startsWith("socrates:editor-draft:")) {
        setDrafts(listAllDrafts());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const handleDiscard = useCallback(
    (draft: DraftSummary, e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      discardDraft(draft.key);
      setDrafts((prev) => prev.filter((d) => d.key !== draft.key));
      toast({
        title: "Draft discarded",
        description: `"${draft.title}" has been removed.`,
        action: (
          <ToastAction
            altText="Open editor to recreate the draft"
            onClick={() => navigate(draftDestination(draft.id))}
          >
            Open editor
          </ToastAction>
        ),
      });
    },
    [toast, navigate]
  );

  if (drafts.length === 0) return null;

  return (
    <section className={className}>
      {heading && (
        <h2 className="text-h2 text-foreground mb-3">
          {heading}
        </h2>
      )}
      <div className="space-y-2">
        {drafts.map((draft) => (
          <div
            key={draft.key}
            className="relative w-full rounded-2xl bg-card border border-border/50 shadow-card transition-smooth hover:border-border"
          >
            <button
              onClick={() => navigate(draftDestination(draft.id))}
              className="w-full h-[72px] flex items-center gap-3 pl-4 pr-12 text-left active:scale-[0.99] transition-smooth rounded-2xl"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <FileEdit className="h-[18px] w-[18px]" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold text-foreground truncate">
                  {draft.title}
                </div>
                <p className="text-caption text-muted-foreground mt-0.5">
                  {draft.sectionCount} section
                  {draft.sectionCount === 1 ? "" : "s"} &middot;{" "}
                  {draft.itemCount} item{draft.itemCount === 1 ? "" : "s"}
                  {" · "}
                  {relativeTime(draft.updatedAt)}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
            <button
              onClick={(e) => handleDiscard(draft, e)}
              aria-label={`Discard draft ${draft.title}`}
              className="absolute right-2 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground/70 hover:text-foreground hover:bg-muted/60 transition-smooth"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

export default DraftsList;
