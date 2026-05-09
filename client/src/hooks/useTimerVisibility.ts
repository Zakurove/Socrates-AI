import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "practice-timer-hidden";

/**
 * Persists the user's "hide the session timer" preference across sessions.
 * Default is shown (hidden=false). The toggle survives page reloads via
 * localStorage so practitioners who prefer to train without time-pressure
 * don't have to flip it every run.
 */
export function useTimerVisibility() {
  const [hidden, setHidden] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(hidden));
    } catch {
      /* storage may be unavailable — ignore */
    }
  }, [hidden]);

  const toggle = useCallback(() => setHidden((v) => !v), []);

  return { hidden, toggle };
}
