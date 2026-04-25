import { useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import {
  Sparkles,
  Plus,
  LogIn,
  Star,
  GitFork,
  Clock,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LibrarySearchBar } from "@/components/library/LibrarySearchBar";
import { LibraryFilters } from "@/components/library/LibraryFilters";
import {
  PublicStationCard,
  PublicStationCardSkeleton,
} from "@/components/library/PublicStationCard";
import {
  PublicStationRow,
  PublicStationRowSkeleton,
} from "@/components/library/PublicStationRow";
import {
  useLibraryStations,
  useFeaturedLibrary,
  type StationSort,
} from "@/hooks/use-library";
import { useAuth } from "@/hooks/use-auth";
import type { PublicStationSummary } from "@shared/schema";

// ─── URL query helpers ─────────────────────────────────────────

function parseQuery(search: string): URLSearchParams {
  return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
}

function useQueryParams() {
  const [location, navigate] = useLocation();
  const search = typeof window !== "undefined" ? window.location.search : "";
  const params = useMemo(() => parseQuery(search), [search, location]);

  const update = (next: Record<string, string | undefined>) => {
    const merged = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined || v === "") merged.delete(k);
      else merged.set(k, v);
    }
    const qs = merged.toString();
    navigate(`/library${qs ? `?${qs}` : ""}`, { replace: true });
  };

  return { params, update };
}

// ─── Page ──────────────────────────────────────────────────────

export default function LibraryPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { params, update } = useQueryParams();

  const q = params.get("q") ?? "";
  const type = params.get("type") ?? undefined;
  const specialty = params.get("specialty") ?? undefined;
  const difficulty = params.get("difficulty") ?? undefined;
  const sort = (params.get("sort") as StationSort) ?? "recent";

  useEffect(() => {
    document.title = "Community library — Socrates AI";
  }, []);

  const filtersActive = !!(q || type || specialty || difficulty);

  const listQuery = useLibraryStations({
    q: q || undefined,
    type,
    specialty,
    difficulty,
    sort,
    pageSize: 24,
  });

  const featured = useFeaturedLibrary();
  const featuredItems: PublicStationSummary[] = featured.data?.items ?? [];

  const recent = useLibraryStations({ sort: "recent", pageSize: 12 });
  const mostStarred = useLibraryStations({ sort: "popular", pageSize: 12 });
  const mostForked = useLibraryStations({ sort: "forks", pageSize: 12 });

  const items = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;

  return (
    <div className="min-h-screen pb-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom)+1.5rem)]">
      <div className="safe-top" />
      <div className="mx-auto max-w-3xl px-5 pt-6 space-y-6">
        <div>
          <h1 className="text-h1 text-foreground">Library</h1>
          <p className="mt-1 text-caption text-muted-foreground">
            Stations shared by residents and students worldwide.
          </p>
        </div>

        <LibrarySearchBar value={q} onChange={(v) => update({ q: v })} />

        <LibraryFilters
          value={{ type, specialty, difficulty, sort }}
          onChange={(v) =>
            update({
              type: v.type,
              specialty: v.specialty,
              difficulty: v.difficulty,
              sort: v.sort,
            })
          }
        />

        {filtersActive ? (
          <ResultsList
            isLoading={listQuery.isLoading}
            isError={listQuery.isError}
            items={items}
            total={total}
            onRetry={() => listQuery.refetch()}
          />
        ) : sort !== "recent" ? (
          <ResultsList
            isLoading={listQuery.isLoading}
            isError={listQuery.isError}
            items={items}
            total={total}
            onRetry={() => listQuery.refetch()}
            heading={sortHeading(sort)}
          />
        ) : (
          <>
            {/* Featured — horizontal scroll carousel of cards */}
            {featured.isLoading ? (
              <FeaturedSkeleton />
            ) : featuredItems.length > 0 ? (
              <FeaturedCarousel items={featuredItems.slice(0, 8)} />
            ) : (
              <EmptyLibrary
                isSignedIn={!!user}
                onPublish={() => navigate("/my-stations")}
                onSignIn={() => navigate("/auth?from=/library")}
              />
            )}

            {/* Recently published — list rows */}
            {recent.data?.items && recent.data.items.length > 0 && (
              <ListSection
                title="Recently published"
                icon={<Clock className="h-4 w-4" aria-hidden />}
                items={recent.data.items}
                loading={recent.isLoading}
              />
            )}

            {mostStarred.data?.items &&
              mostStarred.data.items.length > 0 && (
                <ListSection
                  title="Most starred"
                  icon={
                    <Star className="h-4 w-4 text-brand-accent" aria-hidden />
                  }
                  items={mostStarred.data.items}
                  loading={mostStarred.isLoading}
                />
              )}

            {mostForked.data?.items &&
              mostForked.data.items.filter((s) => s.forkCount > 0).length >=
                3 && (
                <ListSection
                  title="Most forked"
                  icon={<GitFork className="h-4 w-4" aria-hidden />}
                  items={mostForked.data.items.filter((s) => s.forkCount > 0)}
                  loading={mostForked.isLoading}
                />
              )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Subviews ─────────────────────────────────────────────────

function sortHeading(sort: StationSort): string {
  switch (sort) {
    case "popular":
      return "Most starred";
    case "forks":
      return "Most forked";
    case "practices":
      return "Most practiced";
    default:
      return "Stations";
  }
}

function ResultsList({
  isLoading,
  isError,
  items,
  total,
  onRetry,
  heading = "Results",
}: {
  isLoading: boolean;
  isError: boolean;
  items: PublicStationSummary[];
  total: number;
  onRetry: () => void;
  heading?: string;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-h2 text-foreground">{heading}</h2>
        <p className="text-caption text-muted-foreground tabular-nums">
          {isLoading ? "..." : `${total} station${total === 1 ? "" : "s"}`}
        </p>
      </div>

      {isLoading ? (
        <div className="rounded-2xl bg-card border border-border/60 shadow-card divide-y divide-border/60 overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <PublicStationRowSkeleton key={i} />
          ))}
        </div>
      ) : isError ? (
        <ErrorCard onRetry={onRetry} />
      ) : items.length === 0 ? (
        <EmptyResults />
      ) : (
        <div className="rounded-2xl bg-card border border-border/60 shadow-card divide-y divide-border/60 overflow-hidden">
          {items.map((s) => (
            <PublicStationRow key={s.id} station={s} />
          ))}
        </div>
      )}
    </section>
  );
}

function FeaturedCarousel({ items }: { items: PublicStationSummary[] }) {
  return (
    <section className="mb-8 space-y-3">
      <h2 className="flex items-center gap-2 text-h2 text-foreground">
        <Star className="h-4 w-4 text-brand-accent" aria-hidden />
        Featured
      </h2>
      <div
        className="-mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-2 no-scrollbar"
        style={{
          maskImage: "linear-gradient(to right, black 92%, transparent)",
          WebkitMaskImage: "linear-gradient(to right, black 92%, transparent)",
        }}
      >
        {items.map((s) => (
          <div
            key={s.id}
            className="w-[260px] shrink-0 snap-start"
          >
            <PublicStationCard station={s} />
          </div>
        ))}
      </div>
    </section>
  );
}

function FeaturedSkeleton() {
  return (
    <section className="mb-8 space-y-3">
      <h2 className="flex items-center gap-2 text-h2 text-foreground">
        <Star className="h-4 w-4 text-brand-accent" aria-hidden />
        Featured
      </h2>
      <div className="-mx-5 flex gap-3 overflow-x-auto px-5 pb-2 no-scrollbar">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="w-[260px] shrink-0">
            <PublicStationCardSkeleton />
          </div>
        ))}
      </div>
    </section>
  );
}

function ListSection({
  title,
  icon,
  items,
  loading,
}: {
  title: string;
  icon?: React.ReactNode;
  items: PublicStationSummary[];
  loading?: boolean;
}) {
  if (loading) {
    return (
      <section className="mb-8 space-y-3">
        <h2 className="flex items-center gap-2 text-h2 text-foreground">
          {icon}
          {title}
        </h2>
        <div className="rounded-2xl bg-card border border-border/60 shadow-card divide-y divide-border/60 overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <PublicStationRowSkeleton key={i} />
          ))}
        </div>
      </section>
    );
  }
  if (items.length === 0) return null;
  return (
    <section className="mb-8 space-y-3">
      <h2 className="flex items-center gap-2 text-h2 text-foreground">
        {icon}
        {title}
      </h2>
      <div className="rounded-2xl bg-card border border-border/60 shadow-card divide-y divide-border/60 overflow-hidden">
        {items.slice(0, 6).map((s) => (
          <PublicStationRow key={s.id} station={s} />
        ))}
      </div>
    </section>
  );
}

function EmptyLibrary({
  isSignedIn,
  onPublish,
  onSignIn,
}: {
  isSignedIn: boolean;
  onPublish: () => void;
  onSignIn: () => void;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border/70 bg-card/40 px-5 py-10 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="h-5 w-5" />
      </div>
      <h3 className="text-h3 text-foreground">
        The community library is just getting started.
      </h3>
      <p className="mt-1 text-body text-muted-foreground">
        Be the first to share a station.
      </p>
      <div className="mt-5">
        {isSignedIn ? (
          <Button
            onClick={onPublish}
            className="gap-2 rounded-full bg-primary px-5 text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Publish a station
          </Button>
        ) : (
          <Button
            onClick={onSignIn}
            className="gap-2 rounded-full bg-primary px-5 text-primary-foreground hover:bg-primary/90"
          >
            <LogIn className="h-4 w-4" />
            Sign in to publish
          </Button>
        )}
      </div>
    </div>
  );
}

function EmptyResults() {
  return (
    <div className="rounded-2xl border border-dashed border-border/70 bg-card/40 px-5 py-10 text-center">
      <Search className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
      <p className="text-body text-muted-foreground">
        No stations match your search.
      </p>
      <p className="mt-1 text-caption text-muted-foreground">
        Try a different specialty or keyword.
      </p>
    </div>
  );
}

function ErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-destructive/40 bg-destructive/5 px-5 py-6 text-center">
      <p className="text-body text-foreground">Couldn't load the library.</p>
      <p className="mt-1 text-caption text-muted-foreground">
        Check your connection and try again.
      </p>
      <Button
        variant="outline"
        onClick={onRetry}
        className="mt-4 rounded-full"
      >
        Retry
      </Button>
    </div>
  );
}
