// Persistence helpers for in-progress practice sessions.
// Wraps localStorage with quota / Safari Private mode safety.

const SESSION_PREFIX = "socrates-session-";
const ACTIVE_PREFIX = "socrates-active-station-";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface PersistedSession {
  checkedItems: number[];
  checkTimestamps: [number, number][];
  elapsedSeconds: number;
  practiceStartedAtMs?: number;
  phase: "reading" | "practice" | "questions" | "complete";
  currentQuestionIdx: number;
  questionScores?: [number, number][];
  savedAt: number;
}

export function sessionKey(sessionId: number): string {
  return `${SESSION_PREFIX}${sessionId}`;
}

export function activeStationKey(stationId: number | string): string {
  return `${ACTIVE_PREFIX}${stationId}`;
}

export function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    console.warn("[practice-storage] setItem failed", key, err);
    return false;
  }
}

export function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    console.warn("[practice-storage] getItem failed", key, err);
    return null;
  }
}

export function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch (err) {
    console.warn("[practice-storage] removeItem failed", key, err);
  }
}

export function persistSession(sessionId: number, data: Omit<PersistedSession, "savedAt">): void {
  const payload: PersistedSession = { ...data, savedAt: Date.now() };
  safeSetItem(sessionKey(sessionId), JSON.stringify(payload));
}

export function loadSession(sessionId: number): PersistedSession | null {
  const raw = safeGetItem(sessionKey(sessionId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistedSession;
  } catch {
    return null;
  }
}

export function getActiveSessionId(stationId: number | string): number | null {
  const raw = safeGetItem(activeStationKey(stationId));
  if (!raw) return null;
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

export function setActiveSessionId(stationId: number | string, sessionId: number): void {
  safeSetItem(activeStationKey(stationId), String(sessionId));
}

export function clearActiveSession(stationId: number | string, sessionId: number): void {
  safeRemoveItem(activeStationKey(stationId));
  safeRemoveItem(sessionKey(sessionId));
}

/** Garbage-collect persisted practice sessions older than 7 days. */
export function gcPracticeStorage(): void {
  try {
    const toDelete: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(SESSION_PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as Partial<PersistedSession>;
        if (!parsed.savedAt || Date.now() - parsed.savedAt > MAX_AGE_MS) {
          toDelete.push(key);
        }
      } catch {
        toDelete.push(key);
      }
    }
    toDelete.forEach((k) => safeRemoveItem(k));
  } catch (err) {
    console.warn("[practice-storage] gc failed", err);
  }
}
