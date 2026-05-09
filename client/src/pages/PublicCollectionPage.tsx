import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import {
  MoreVertical,
  Flag,
  BookOpen,
  Star,
  GitFork,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { safeFrom } from "@/lib/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AuthorBadge } from "@/components/library/AuthorBadge";
import { ForkButton } from "@/components/library/ForkButton";
import { StarButton } from "@/components/library/StarButton";
import { ReportDialog } from "@/components/library/ReportDialog";
import {
  PublicStationCard,
  PublicStationCardSkeleton,
} from "@/components/library/PublicStationCard";
import { usePublicCollection } from "@/hooks/use-library";
import { useAuth } from "@/hooks/use-auth";

function setMetaTags(opts: {
  title: string;
  description?: string;
  image?: string;
}) {
  document.title = opts.title;
  const setMeta = (property: string, content: string) => {
    let el = document.head.querySelector(
      `meta[property="${property}"]`,
    ) as HTMLElement | null;
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute("property", property);
      document.head.appendChild(el);
    }
    el.setAttribute("content", content);
  };
  setMeta("og:title", opts.title);
  if (opts.description) setMeta("og:description", opts.description);
  if (opts.image) setMeta("og:image", opts.image);
}

function relativeDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const day = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (day === 0) return "today";
  if (day === 1) return "yesterday";
  if (day < 30) return `${day} days ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function PublicCollectionPage() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { data, isLoading, isError } = usePublicCollection(params.id);
  const { user } = useAuth();
  const isOwner = !!(user && data && user.id === data.author.id);
  const [reportOpen, setReportOpen] = useState(false);
  const fromParam =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("from")
      : null;
  const backTo = safeFrom(fromParam, "/library");

  useEffect(() => {
    if (data) {
      const excerpt = (data.description ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200);
      setMetaTags({
        title: `${data.title} — Socrates AI`,
        description:
          excerpt ||
          `A collection shared by ${data.author.displayName} on Socrates AI.`,
        image: "/og-default.svg",
      });
    }
  }, [data]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-[960px] px-5 py-6 safe-top">
          <div className="mb-2 h-8 w-2/3 animate-pulse rounded bg-warm-100" />
          <div className="mb-6 h-3 w-1/2 animate-pulse rounded bg-warm-100" />
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <PublicStationCardSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-body text-foreground">
          This collection is no longer available.
        </p>
        <Button variant="outline" onClick={() => navigate(backTo)}>
          Back
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-32">
      <PageHeader
        backTo={backTo}
        backLabel="Back"
        wide
        actions={
          <>
            <StarButton
              target={{ type: "collection", id: data.id }}
              count={data.starCount}
              isStarred={!!data.isStarred}
              size="sm"
            />
            {!isOwner && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="More actions"
                    className="h-11 w-11 rounded-full"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      setReportOpen(true);
                    }}
                  >
                    <Flag className="mr-2 h-4 w-4" />
                    Report
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />

      <main className="mx-auto max-w-[960px] px-5 pt-6">
        <header className="mb-6">
          <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <BookOpen className="h-5 w-5" />
          </div>
          <h1 className="mb-2 font-display text-h1 text-foreground">
            {data.title}
          </h1>
          <div className="mb-3">
            <AuthorBadge author={data.author} size="md" />
          </div>
          {data.description && (
            <p className="mb-3 whitespace-pre-wrap text-body text-muted-foreground">
              {data.description}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3 text-caption text-muted-foreground tabular-nums">
            <span className="inline-flex items-center gap-1">
              <Star className="h-3.5 w-3.5 text-brand-accent" aria-hidden />
              {data.starCount}
            </span>
            <span className="inline-flex items-center gap-1">
              <GitFork className="h-3.5 w-3.5" aria-hidden />
              {data.forkCount}
            </span>
            <span className="inline-flex items-center gap-1">
              <BookOpen className="h-3.5 w-3.5" aria-hidden />
              {data.stations.length} stations
            </span>
            <span>Published {relativeDate(data.publishedAt)}</span>
          </div>

          {!isOwner && (
            <div className="mt-5">
              <ForkButton
                target={{ type: "collection", id: data.id }}
                authorId={data.author.id}
                size="lg"
                className="w-full"
              />
            </div>
          )}
        </header>

        <section className="mb-8">
          <h2 className="mb-3 font-display text-h2 text-foreground">Stations</h2>
          {data.stations.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/70 bg-card/40 px-5 py-8 text-center">
              <p className="text-body text-muted-foreground">
                This collection is empty.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {data.stations.map((s) => (
                <PublicStationCard key={s.id} station={s} />
              ))}
            </div>
          )}
        </section>

        <footer className="mb-6 rounded-2xl border border-border/40 bg-card/60 px-5 py-4">
          <p className="text-caption text-muted-foreground">
            Shared by{" "}
            <span className="font-medium text-foreground">
              {data.author.displayName}
            </span>{" "}
            under CC-BY 4.0 · Credit the author if you fork and share.
          </p>
        </footer>
      </main>

      {!isOwner && (
        <div className="fixed bottom-0 left-0 right-0 z-40 lg:hidden border-t border-border/40 bg-background/80 px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] backdrop-blur-xl">
          <div className="mx-auto w-full max-w-[960px]">
            <ForkButton
              target={{ type: "collection", id: data.id }}
              authorId={data.author.id}
              size="lg"
              className="w-full"
            />
          </div>
        </div>
      )}

      <ReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        target={{ targetType: "collection", targetId: data.id }}
        targetLabel={data.title}
      />
    </div>
  );
}
