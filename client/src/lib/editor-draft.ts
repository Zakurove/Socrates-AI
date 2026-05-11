const DRAFT_PREFIX = "socrates:editor-draft:";
const DRAFT_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

interface MediaEntry {
  type: "image" | "video";
  url: string;
  caption?: string | null;
  order: number;
}

interface LearningContent {
  explanation?: string | null;
  imageUrl?: string | null;
  imageCaption?: string | null;
  videoUrl?: string | null;
  media?: MediaEntry[];
}

interface DraftSubSubItem extends LearningContent {
  id: string;
  text: string;
  isCritical: boolean;
  points: number;
}

interface DraftSubItem extends LearningContent {
  id: string;
  text: string;
  isCritical: boolean;
  points: number;
  subItems: DraftSubSubItem[];
}

interface DraftItem extends LearningContent {
  id: string;
  text: string;
  isCritical: boolean;
  points: number;
  subItems: DraftSubItem[];
}

interface DraftSection {
  id: string;
  title: string;
  collapsed: boolean;
  description?: string | null;
  imageUrl?: string | null;
  imageCaption?: string | null;
  items: DraftItem[];
}

interface DraftChecklistKeyPoint {
  id: string;
  text: string;
}

interface DraftQuestion {
  id: string;
  question: string;
  idealAnswer: string | null;
  questionType?: "free_text" | "multiple_choice" | "multi_select" | "checklist";
  options?: { text: string; isCorrect: boolean }[];
  threshold?: number;
  imageUrl?: string | null;
  // For "checklist" type: editable list of expected items.
  keyPoints?: DraftChecklistKeyPoint[];
}

export interface DraftData {
  title: string;
  type: string;
  scenario: string;
  patientBriefing: string;
  specialty: string;
  defaultTimeMinutes: number;
  readingTimeMinutes: number;
  sections: DraftSection[];
  questions: DraftQuestion[];
  referenceImageUrl: string | null;
  referenceImageCaption: string;
  hasPatientBriefing: boolean;
  aiPatientEnabled: boolean;
  savedAt: number;
}

export function saveDraft(key: string, data: Omit<DraftData, "savedAt">): void {
  try {
    localStorage.setItem(
      DRAFT_PREFIX + key,
      JSON.stringify({ ...data, savedAt: Date.now() })
    );
  } catch {
    /* quota exceeded — silently fail */
  }
}

export function loadDraft(key: string): DraftData | null {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + key);
    if (!raw) return null;
    const data = JSON.parse(raw) as DraftData;
    if (Date.now() - data.savedAt > DRAFT_TTL) {
      localStorage.removeItem(DRAFT_PREFIX + key);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(DRAFT_PREFIX + key);
  } catch {
    /* ignore */
  }
}

export interface DraftSummary {
  key: string; // the full localStorage key, e.g. "socrates:editor-draft:new"
  id: string; // "new" or a station ID as string
  title: string;
  sectionCount: number;
  itemCount: number;
  updatedAt: number; // timestamp
}

function countItems(sections: DraftSection[] | undefined): number {
  if (!Array.isArray(sections)) return 0;
  let total = 0;
  for (const section of sections) {
    if (!section || !Array.isArray(section.items)) continue;
    for (const item of section.items) {
      total += 1;
      if (Array.isArray(item.subItems)) {
        for (const sub of item.subItems) {
          total += 1;
          if (Array.isArray(sub.subItems)) {
            total += sub.subItems.length;
          }
        }
      }
    }
  }
  return total;
}

export function listAllDrafts(): DraftSummary[] {
  const summaries: DraftSummary[] = [];
  let keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(DRAFT_PREFIX)) keys.push(k);
    }
  } catch {
    return [];
  }

  const now = Date.now();
  for (const fullKey of keys) {
    try {
      const raw = localStorage.getItem(fullKey);
      if (!raw) continue;
      const data = JSON.parse(raw) as DraftData;
      if (
        !data ||
        typeof data.savedAt !== "number" ||
        now - data.savedAt > DRAFT_TTL
      ) {
        // Expired or malformed — clean up.
        try {
          localStorage.removeItem(fullKey);
        } catch {
          /* ignore */
        }
        continue;
      }
      const id = fullKey.slice(DRAFT_PREFIX.length);
      const title =
        typeof data.title === "string" && data.title.trim().length > 0
          ? data.title.trim()
          : "Untitled station";
      summaries.push({
        key: fullKey,
        id,
        title,
        sectionCount: Array.isArray(data.sections) ? data.sections.length : 0,
        itemCount: countItems(data.sections),
        updatedAt: data.savedAt,
      });
    } catch {
      // Corrupt JSON — skip (and try to remove so it doesn't linger).
      try {
        localStorage.removeItem(fullKey);
      } catch {
        /* ignore */
      }
    }
  }

  summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  return summaries;
}

export function discardDraft(key: string): void {
  // Accepts either a full key (with prefix) or the raw id.
  try {
    const full = key.startsWith(DRAFT_PREFIX) ? key : DRAFT_PREFIX + key;
    localStorage.removeItem(full);
  } catch {
    /* ignore */
  }
}
