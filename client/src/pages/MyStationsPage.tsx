import { useState, useMemo, useEffect, useDeferredValue } from "react";
import { useLocation, Link } from "wouter";
import { useStations } from "@/hooks/use-stations";
import { useMockExams } from "@/hooks/use-mock-exams";
import { StationCardSkeleton } from "@/components/StationCard";
import { DraftsList } from "@/components/DraftsList";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Plus,
  Search,
  X as XIcon,
  ChevronRight,
  MessageSquare,
  Stethoscope,
  MessagesSquare,
  Image as ImageIcon,
  Sparkles,
  ClipboardList,
  Timer,
} from "lucide-react";
import { cn, stationTypeLabel } from "@/lib/utils";
import type { Station } from "@shared/schema";

const TYPE_FILTERS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All" },
  { value: "history_taking", label: "History" },
  { value: "physical_exam", label: "Physical" },
  { value: "communication", label: "Communication" },
  { value: "image_id", label: "Image ID" },
  { value: "custom", label: "Custom" },
];

function stationTypeIcon(type: string) {
  switch (type) {
    case "history_taking":
      return MessageSquare;
    case "physical_exam":
      return Stethoscope;
    case "communication":
      return MessagesSquare;
    case "image_id":
      return ImageIcon;
    case "custom":
      return Sparkles;
    default:
      return ClipboardList;
  }
}

export default function MyStationsPage() {
  const [, navigate] = useLocation();
  const { data: stations, isLoading, error } = useStations();
  const { data: mockExams } = useMockExams();
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const deferredSearch = useDeferredValue(debouncedSearch);

  // Debounce 200ms
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filtered = useMemo(() => {
    if (!stations) return [];
    let list = stations;
    if (typeFilter !== "all") {
      list = list.filter((s) => s.type === typeFilter);
    }
    if (deferredSearch.trim()) {
      const q = deferredSearch.toLowerCase();
      list = list.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.type.toLowerCase().includes(q) ||
          (s.specialty && s.specialty.toLowerCase().includes(q))
      );
    }
    return list;
  }, [stations, deferredSearch, typeFilter]);

  return (
    <div className="min-h-screen pb-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom)+1.5rem)]">
      <div className="safe-top" />

      <div className="mx-auto max-w-3xl px-5 pt-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-h1 text-foreground">My Stations</h1>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search stations"
            className="h-12 rounded-xl bg-muted/50 border-transparent pl-10 pr-10 text-[15px]"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          {searchInput && (
            <button
              onClick={() => setSearchInput("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-smooth"
            >
              <XIcon className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Filter chips — hidden for small libraries */}
        {stations && stations.length > 10 && (
          <div
            className="-mx-5 flex gap-2 overflow-x-auto px-5 no-scrollbar"
            style={{
              maskImage:
                "linear-gradient(to right, black 85%, transparent)",
              WebkitMaskImage:
                "linear-gradient(to right, black 85%, transparent)",
            }}
          >
            {TYPE_FILTERS.map((f) => {
              const active = typeFilter === f.value;
              return (
                <button
                  key={f.value}
                  onClick={() => setTypeFilter(f.value)}
                  className={cn(
                    "shrink-0 h-9 rounded-full px-4 text-[13px] font-medium transition-smooth",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/60 text-muted-foreground hover:text-foreground"
                  )}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="mx-auto max-w-3xl px-5 pt-6 pb-6 space-y-6">
        {/* Unsaved editor drafts (only renders if any exist) */}
        <DraftsList />

        {/* Mock Exams entry — primary discoverability hook */}
        <MockExamsEntryCard
          count={mockExams?.length ?? 0}
          onClick={() => navigate("/mock-exam")}
        />

        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <StationCardSkeleton key={i} />
            ))}
          </div>
        )}

        {error && (
          <div className="py-12 text-center">
            <p className="text-body text-destructive">
              Failed to load stations. Please try again.
            </p>
          </div>
        )}

        {!isLoading && stations && stations.length === 0 && (
          <EmptyState
            onCreateNew={() => navigate("/station/new")}
            onBrowseLibrary={() => navigate("/library")}
          />
        )}

        {!isLoading && filtered.length === 0 && stations && stations.length > 0 && (
          <div className="py-12 text-center">
            <Search className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
            <p className="text-body text-muted-foreground">
              {deferredSearch
                ? `No stations match "${deferredSearch}"`
                : "No stations match this filter"}
            </p>
          </div>
        )}

        {filtered.length > 0 && (
          <div className="rounded-2xl bg-card border border-border/60 shadow-card divide-y divide-border/60 overflow-hidden">
            {filtered.map((station) => (
              <StationRow key={station.id} station={station} />
            ))}
          </div>
        )}
      </div>

      {/* Extended FAB */}
      <Button
        onClick={() => navigate("/station/new")}
        className="fixed bottom-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom)+1rem)] right-[max(1rem,calc(50vw-220px+1rem))] z-30 h-14 gap-2 rounded-full px-5 shadow-lg"
        aria-label="New station"
      >
        <Plus className="h-5 w-5" />
        <span className="font-semibold">New station</span>
      </Button>
    </div>
  );
}

function StationRow({ station }: { station: Station }) {
  const Icon = stationTypeIcon(station.type);
  return (
    <Link
      href={`/station/${station.id}`}
      className="flex w-full items-center gap-3 px-5 py-4 min-h-[72px] transition-colors hover:bg-muted/30 dark:hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-[18px] w-[18px]" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-[15px] font-semibold leading-tight text-foreground">
          {station.title}
        </h3>
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-caption text-muted-foreground">
          <span>{stationTypeLabel(station.type)}</span>
          {station.specialty && (
            <>
              <span aria-hidden>·</span>
              <span>{station.specialty}</span>
            </>
          )}
          <span aria-hidden>·</span>
          <span className="tabular-nums">{station.defaultTimeMinutes}m</span>
        </div>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

function MockExamsEntryCard({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}) {
  const subtitle =
    count > 0
      ? `${count} mock exam${count === 1 ? "" : "s"}`
      : "Timed multi-station practice";
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-2xl bg-card border border-border/60 shadow-card p-4 flex items-center gap-3 text-left transition-smooth active:scale-[0.98] hover:border-border"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Timer className="h-[18px] w-[18px]" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-h3 text-foreground leading-tight">Mock exams</h3>
        <p className="mt-0.5 text-caption text-muted-foreground truncate">
          {subtitle}
        </p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function EmptyState({
  onCreateNew,
  onBrowseLibrary,
}: {
  onCreateNew: () => void;
  onBrowseLibrary: () => void;
}) {
  return (
    <div className="flex flex-col items-center py-16 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
        <ClipboardList className="h-7 w-7" />
      </div>
      <h2 className="mb-2 text-h2 text-foreground">No stations yet</h2>
      <p className="mb-6 max-w-xs text-body text-muted-foreground">
        Build your first OSCE station to start practicing.
      </p>
      <Button onClick={onCreateNew} size="lg" className="gap-2 rounded-full">
        <Plus className="h-4 w-4" />
        Create your first station
      </Button>
      <button
        type="button"
        onClick={onBrowseLibrary}
        className="mt-4 text-caption text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
      >
        or browse the community library
      </button>
    </div>
  );
}
