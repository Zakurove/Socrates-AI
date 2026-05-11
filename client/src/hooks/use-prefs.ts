import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export interface Prefs {
  timerSounds: boolean;
  ttsEnabled: boolean;
  theme: Theme;
}

const DEFAULTS: Prefs = {
  timerSounds: true,
  ttsEnabled: false,
  // Default to light. Users can opt into dark or "follow system" via
  // Settings. Previously we defaulted to "system" which flipped folks
  // on OS dark mode unexpectedly into a dark UI before they'd had a
  // chance to see the product's intended palette.
  theme: "light",
};

const STORAGE_KEY = "socrates-prefs";

function readPrefs(): Prefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    // Migrate older stored values that may lack "system"
    const merged = { ...DEFAULTS, ...parsed } as Prefs;
    if (merged.theme !== "light" && merged.theme !== "dark" && merged.theme !== "system") {
      merged.theme = "light";
    }
    return merged;
  } catch {
    return DEFAULTS;
  }
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === "system") return getSystemTheme();
  return theme;
}

export function usePrefs() {
  const [prefs, setPrefsState] = useState<Prefs>(() => readPrefs());
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => getSystemTheme());

  // Sync across tabs / instances
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setPrefsState(readPrefs());
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  // Listen for system color-scheme changes
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? "dark" : "light");
    };
    if (mql.addEventListener) mql.addEventListener("change", handler);
    else mql.addListener(handler);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener("change", handler);
      else mql.removeListener(handler);
    };
  }, []);

  const setPref = useCallback(<K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    setPrefsState((prev) => {
      const next = { ...prev, [key]: value };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {}
      // Apply theme change synchronously to the document to avoid a
      // one-frame flash when the user navigates right after toggling.
      if (key === "theme" && typeof document !== "undefined") {
        const resolved =
          value === "system" ? getSystemTheme() : (value as ResolvedTheme);
        const root = document.documentElement;
        if (resolved === "dark") root.classList.add("dark");
        else root.classList.remove("dark");
      }
      return next;
    });
  }, []);

  const resolvedTheme: ResolvedTheme =
    prefs.theme === "system" ? systemTheme : prefs.theme;

  return { prefs, setPref, resolvedTheme };
}
