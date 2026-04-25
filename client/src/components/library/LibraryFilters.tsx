import { useState, useEffect } from "react";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { stationTypeLabel, cn } from "@/lib/utils";
import type { StationSort } from "@/hooks/use-library";

const TYPE_FILTERS: Array<{ value: string; label: string }> = [
  { value: "__all__", label: "All" },
  { value: "history_taking", label: stationTypeLabel("history_taking") },
  { value: "physical_exam", label: stationTypeLabel("physical_exam") },
  { value: "communication", label: stationTypeLabel("communication") },
  { value: "image_id", label: stationTypeLabel("image_id") },
  { value: "qa", label: stationTypeLabel("qa") },
  { value: "custom", label: stationTypeLabel("custom") },
];

const SORTS: { value: StationSort; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "popular", label: "Most starred" },
  { value: "forks", label: "Most forked" },
  { value: "practices", label: "Most practiced" },
];

const DIFFICULTIES = [
  { value: "__all__", label: "Any" },
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
];

interface LibraryFiltersProps {
  value: {
    type?: string;
    specialty?: string;
    difficulty?: string;
    sort?: StationSort;
  };
  onChange: (v: LibraryFiltersProps["value"]) => void;
}

const ALL = "__all__";

export function LibraryFilters({ value, onChange }: LibraryFiltersProps) {
  const [specialty, setSpecialty] = useState(value.specialty ?? "");
  const [showSpecialty, setShowSpecialty] = useState(!!value.specialty);

  useEffect(() => {
    const t = setTimeout(() => {
      if ((specialty || "") !== (value.specialty || "")) {
        onChange({ ...value, specialty: specialty || undefined });
      }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specialty]);

  useEffect(() => {
    setSpecialty(value.specialty ?? "");
  }, [value.specialty]);

  const activeType = value.type ?? ALL;
  const activeDifficulty = value.difficulty ?? ALL;
  const activeSort = value.sort ?? "recent";

  return (
    <div className="space-y-3">
      {/* Type chips — horizontal scroll, edge fade */}
      <div
        className="-mx-5 flex gap-2 overflow-x-auto px-5 no-scrollbar"
        style={{
          maskImage: "linear-gradient(to right, black 88%, transparent)",
          WebkitMaskImage:
            "linear-gradient(to right, black 88%, transparent)",
        }}
      >
        {TYPE_FILTERS.map((f) => {
          const active = activeType === f.value;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() =>
                onChange({
                  ...value,
                  type: f.value === ALL ? undefined : f.value,
                })
              }
              className={cn(
                "shrink-0 h-9 rounded-full px-4 text-[13px] font-medium transition-smooth",
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/60 text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Sort + Difficulty row */}
      <div className="flex items-center gap-2">
        <Select
          value={activeSort}
          onValueChange={(v) => onChange({ ...value, sort: v as StationSort })}
        >
          <SelectTrigger className="h-9 w-auto rounded-full border-border/60 bg-muted/60 px-4 text-[13px] font-medium gap-1.5 [&>svg]:opacity-60">
            <span className="text-muted-foreground">Sort:</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={activeDifficulty}
          onValueChange={(v) =>
            onChange({ ...value, difficulty: v === ALL ? undefined : v })
          }
        >
          <SelectTrigger className="h-9 w-auto rounded-full border-border/60 bg-muted/60 px-4 text-[13px] font-medium gap-1.5 [&>svg]:opacity-60">
            <span className="text-muted-foreground">Level:</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DIFFICULTIES.map((d) => (
              <SelectItem key={d.value} value={d.value}>
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <button
          type="button"
          onClick={() => {
            if (showSpecialty && specialty) {
              setSpecialty("");
            }
            setShowSpecialty((v) => !v);
          }}
          className={cn(
            "ml-auto h-9 shrink-0 rounded-full px-4 text-[13px] font-medium transition-smooth",
            showSpecialty || specialty
              ? "bg-primary/10 text-primary"
              : "bg-muted/60 text-muted-foreground hover:text-foreground",
          )}
          aria-pressed={showSpecialty}
        >
          Specialty
        </button>
      </div>

      {showSpecialty && (
        <input
          type="search"
          value={specialty}
          onChange={(e) => setSpecialty(e.target.value)}
          placeholder="e.g. Orthopaedics"
          className="h-10 w-full rounded-xl border border-border/60 bg-card px-3 text-[13px] outline-none focus:border-primary/50"
          aria-label="Filter by specialty"
        />
      )}
    </div>
  );
}
