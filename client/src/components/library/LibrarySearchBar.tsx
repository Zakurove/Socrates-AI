import { useEffect, useState, useRef } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface LibrarySearchBarProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

export function LibrarySearchBar({
  value,
  onChange,
  placeholder = "Search stations by keyword, specialty, or author",
  className,
  autoFocus,
}: LibrarySearchBarProps) {
  const [local, setLocal] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync external value → local (e.g. URL param change).
  useEffect(() => {
    setLocal(value);
  }, [value]);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    // Debounce before calling onChange.
    timerRef.current = setTimeout(() => {
      if (local !== value) onChange(local);
    }, 200);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);

  return (
    <div
      className={cn(
        "relative flex items-center rounded-2xl border border-border/60 bg-card shadow-card focus-within:border-primary/50 focus-within:shadow-md transition-all",
        className,
      )}
    >
      <Search className="pointer-events-none absolute left-4 h-4 w-4 text-muted-foreground" />
      <input
        type="search"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={cn(
          "h-12 w-full rounded-2xl bg-transparent pl-11 pr-11 text-[15px] outline-none placeholder:text-muted-foreground/70",
        )}
        aria-label="Search library"
      />
      {local && (
        <button
          type="button"
          onClick={() => {
            setLocal("");
            onChange("");
          }}
          className="absolute right-3 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Clear search"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
