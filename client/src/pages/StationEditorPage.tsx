import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useStation, useCreateStation, useUpdateStation } from "@/hooks/use-stations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Bold,
  BookOpen,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Image as ImageIcon,
  Italic,
  List as ListIcon,
  ListChecks,
  Loader2,
  MoreVertical,
  PlayCircle,
  Plus,
  Save,
  Text as TextIcon,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/use-toast";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn, stationTypeLabel } from "@/lib/utils";
import { SPECIALTIES } from "@/lib/specialties";
import { saveDraft, loadDraft, clearDraft, type DraftData } from "@/lib/editor-draft";

// Sentinel value for the "Unspecified" Select option. Radix Select doesn't
// allow empty-string values, so we map "" <-> NO_SPECIALTY at the boundary.
const NO_SPECIALTY = "__none__";
import { parseVideoUrl } from "@/lib/video";
import { ToastAction } from "@/components/ui/toast";
import type { CreateStationPayload } from "@shared/schema";

// ===================== TYPES =====================

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

interface EditorSubSubItem extends LearningContent {
  id: string;
  text: string;
  isCritical: boolean;
  points: number;
}

interface EditorSubItem extends LearningContent {
  id: string;
  text: string;
  isCritical: boolean;
  points: number;
  subItems: EditorSubSubItem[];
}

interface EditorItem extends LearningContent {
  id: string;
  text: string;
  isCritical: boolean;
  points: number;
  subItems: EditorSubItem[];
}

type SectionDrawerKind = "image" | "description" | null;

interface EditorSection {
  id: string;
  title: string;
  collapsed: boolean;
  description?: string | null;
  imageUrl?: string | null;
  imageCaption?: string | null;
  items: EditorItem[];
}

interface ChecklistKeyPoint {
  id: string;
  text: string;
}

type QuestionType =
  | "free_text"
  | "multiple_choice"
  | "multi_select"
  | "checklist";

interface EditorQuestion {
  id: string;
  question: string;
  idealAnswer: string | null;
  questionType?: QuestionType;
  options?: { text: string; isCorrect: boolean }[];
  threshold?: number;
  imageUrl?: string | null;
  // For "checklist" type: editable list of expected items. Each item is
  // worth 1 point. Stored with stable ids so DnD reorder is identity-safe;
  // serialized to a plain string[] in keyPoints on save.
  keyPoints?: ChecklistKeyPoint[];
}

function genId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 10);
}

// Pure helper: extract LearningContent fields so indent/outdent never lose them.
function pickLearningContent(src: LearningContent): LearningContent {
  return {
    explanation: src.explanation ?? null,
    imageUrl: src.imageUrl ?? null,
    imageCaption: src.imageCaption ?? null,
    videoUrl: src.videoUrl ?? null,
    media: src.media ?? [],
  };
}

// Merge legacy single image/video with media array for backward compat.
function mergeMediaFromLegacy(item: any): MediaEntry[] {
  const media: MediaEntry[] = (item.media ?? []).map((m: any) => ({
    type: m.type as "image" | "video",
    url: m.url,
    caption: m.caption ?? null,
    order: m.order ?? 0,
  }));
  // If legacy imageUrl exists and not already in media, add it
  if (item.imageUrl && !media.some((m: MediaEntry) => m.type === "image" && m.url === item.imageUrl)) {
    media.unshift({ type: "image", url: item.imageUrl, caption: item.imageCaption ?? null, order: 0 });
  }
  // If legacy videoUrl exists and not already in media, add it
  if (item.videoUrl && !media.some((m: MediaEntry) => m.type === "video" && m.url === item.videoUrl)) {
    media.push({ type: "video", url: item.videoUrl, caption: null, order: media.length });
  }
  // Re-number order
  media.forEach((m, i) => { m.order = i; });
  return media;
}

// Horizontal drag distance (px) required to trigger an indent or outdent on
// drop. Chosen to match the visual indent step used throughout the editor.
const INDENT_THRESHOLD_PX = 24;

// ===================== COMPONENT =====================

export default function StationEditorPage() {
  const params = useParams<{ id: string }>();
  const isEditing = !!params.id;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: existingStation, isLoading: isLoadingStation } = useStation(
    isEditing ? params.id : undefined
  );
  const createStation = useCreateStation();
  const updateStation = useUpdateStation();

  // Form state
  const [title, setTitle] = useState("");
  const [type, setType] = useState<string>("custom");
  const [scenario, setScenario] = useState("");
  const [patientBriefing, setPatientBriefing] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [defaultTimeMinutes, setDefaultTimeMinutes] = useState(7);
  const [readingTimeMinutes, setReadingTimeMinutes] = useState(1);
  const [sections, setSections] = useState<EditorSection[]>([]);
  const [sectionPendingDelete, setSectionPendingDelete] = useState<string | null>(null);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const [questions, setQuestions] = useState<EditorQuestion[]>([]);
  const [showBriefing, setShowBriefing] = useState(false);
  const [hasPatientBriefing, setHasPatientBriefing] = useState(true);
  const [aiPatientEnabled, setAiPatientEnabled] = useState(true);
  const [referenceImageUrl, setReferenceImageUrl] = useState<string | null>(null);
  const [referenceImageCaption, setReferenceImageCaption] = useState<string>("");
  const [referenceImageError, setReferenceImageError] = useState<string | null>(null);
  const [templateChosen, setTemplateChosen] = useState(isEditing);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [sectionsError, setSectionsError] = useState<string | null>(null);
  const [sectionItemErrors, setSectionItemErrors] = useState<Record<string, string>>({});
  const [questionErrors, setQuestionErrors] = useState<Record<string, string>>({});

  const titleRef = useRef<HTMLInputElement>(null);
  const sectionsRef = useRef<EditorSection[]>([]);
  useEffect(() => {
    sectionsRef.current = sections;
  }, [sections]);
  const isSaving = createStation.isPending || updateStation.isPending;

  // Autosave / dirty tracking
  const [savedStationId, setSavedStationId] = useState<number | null>(
    isEditing && params.id ? Number(params.id) : null
  );
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "saving">("idle");
  const [, setNowTick] = useState(0);
  const dirtyRef = useRef(false);
  const skipNextDirtyRef = useRef(true); // skip initial state population
  // Track which station id has already been hydrated from the server so that
  // autosave-triggered refetches (which return a fresh `existingStation`
  // reference) don't re-run the load effect. Re-running would call
  // `setSections` with freshly-generated `genId()` ids, changing every React
  // `key` and forcing a full unmount/remount — which resets scroll to top and
  // steals focus from the input the user is editing.
  const loadedStationIdRef = useRef<number | null>(null);

  // Tick to refresh "Saved Xs ago"
  useEffect(() => {
    const i = setInterval(() => setNowTick((n) => n + 1), 5000);
    return () => clearInterval(i);
  }, []);

  // Load existing station data.
  // IMPORTANT: only hydrate local state the FIRST time we see a given station
  // id. Autosave mutations invalidate the station query, which causes
  // `existingStation` to arrive as a new object reference. If we re-ran this
  // effect on every refetch, we'd regenerate all `genId()` keys for sections
  // and items, remounting the entire tree — that's what was scrolling the
  // page back to the top after every keystroke.
  useEffect(() => {
    if (existingStation && isEditing) {
      if (loadedStationIdRef.current === existingStation.id) return;
      loadedStationIdRef.current = existingStation.id;
      setTitle(existingStation.title);
      setType(existingStation.type);
      setScenario(existingStation.scenario || "");
      setPatientBriefing(existingStation.patientBriefing || "");
      setSpecialty(existingStation.specialty || "");
      setDefaultTimeMinutes(existingStation.defaultTimeMinutes);
      setReadingTimeMinutes(existingStation.readingTimeMinutes);
      setShowBriefing(!!existingStation.patientBriefing);
      setHasPatientBriefing(
        (existingStation as any).hasPatientBriefing ?? !!existingStation.patientBriefing
      );
      setAiPatientEnabled((existingStation as any).aiPatientEnabled ?? true);
      setReferenceImageUrl((existingStation as any).referenceImageUrl ?? null);
      setReferenceImageCaption((existingStation as any).referenceImageCaption ?? "");

      const loadedSections: EditorSection[] = [...existingStation.sections]
        .sort((a, b) => a.order - b.order)
        .map((sec) => ({
          id: genId(),
          title: sec.title,
          collapsed: false,
          description: (sec as any).description ?? null,
          imageUrl: (sec as any).imageUrl ?? null,
          imageCaption: (sec as any).imageCaption ?? null,
          items: [...sec.items]
            .filter((item) => !item.parentItemId)
            .sort((a, b) => a.order - b.order)
            .map((item) => ({
              id: genId(),
              text: item.text,
              isCritical: item.isCritical,
              points: item.points,
              explanation: (item as any).explanation ?? null,
              imageUrl: (item as any).imageUrl ?? null,
              imageCaption: (item as any).imageCaption ?? null,
              videoUrl: (item as any).videoUrl ?? null,
              media: mergeMediaFromLegacy(item),
              subItems: [...(item.subItems || [])]
                .sort((a, b) => a.order - b.order)
                .map((sub) => ({
                  id: genId(),
                  text: sub.text,
                  isCritical: sub.isCritical,
                  points: sub.points,
                  explanation: (sub as any).explanation ?? null,
                  imageUrl: (sub as any).imageUrl ?? null,
                  imageCaption: (sub as any).imageCaption ?? null,
                  videoUrl: (sub as any).videoUrl ?? null,
                  media: mergeMediaFromLegacy(sub),
                  subItems: [...((sub as any).subItems || [])]
                    .sort((a: any, b: any) => a.order - b.order)
                    .map((ssub: any) => ({
                      id: genId(),
                      text: ssub.text,
                      isCritical: ssub.isCritical,
                      points: ssub.points,
                      explanation: ssub.explanation ?? null,
                      imageUrl: ssub.imageUrl ?? null,
                      imageCaption: ssub.imageCaption ?? null,
                      videoUrl: ssub.videoUrl ?? null,
                      media: mergeMediaFromLegacy(ssub),
                    })),
                })),
            })),
        }));
      setSections(loadedSections);

      const loadedQuestions: EditorQuestion[] = [...existingStation.examinerQuestions]
        .sort((a, b) => a.order - b.order)
        .map((q: any) => {
          const qType: QuestionType = q.questionType ?? "free_text";
          if (qType === "free_text") {
            return {
              id: genId(),
              question: q.question,
              idealAnswer: q.idealAnswer ?? "",
              questionType: "free_text" as const,
              keyPoints: Array.isArray(q.keyPoints)
                ? q.keyPoints.map((t: string) => ({ id: genId(), text: String(t) }))
                : [],
            };
          }
          if (qType === "checklist") {
            const pts = Array.isArray(q.keyPoints) ? q.keyPoints : [];
            return {
              id: genId(),
              question: q.question,
              idealAnswer: null,
              questionType: "checklist" as const,
              keyPoints: pts.map((t: string) => ({ id: genId(), text: String(t) })),
            };
          }
          const cfg = q.config ?? {};
          const options = Array.isArray(cfg.options) ? cfg.options : [];
          return {
            id: genId(),
            question: q.question,
            idealAnswer: null,
            questionType: qType,
            options: options.map((o: any) => ({
              text: String(o?.text ?? ""),
              isCorrect: !!o?.isCorrect,
            })),
            threshold:
              qType === "multi_select" && typeof cfg.threshold === "number"
                ? cfg.threshold
                : undefined,
          };
        });
      setQuestions(loadedQuestions);
      setTemplateChosen(true);
      // Reset dirty after loading from server
      skipNextDirtyRef.current = true;
      setDirty(false);
      dirtyRef.current = false;
    }
  }, [existingStation, isEditing]);

  // Mark dirty when form fields change (skipping initial load)
  useEffect(() => {
    if (skipNextDirtyRef.current) {
      skipNextDirtyRef.current = false;
      return;
    }
    setDirty(true);
    dirtyRef.current = true;
  }, [
    title,
    type,
    scenario,
    patientBriefing,
    specialty,
    defaultTimeMinutes,
    readingTimeMinutes,
    sections,
    questions,
    referenceImageUrl,
    referenceImageCaption,
  ]);

  // beforeunload guard when dirty
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // --- localStorage draft helpers ---
  const draftKey = savedStationId ? String(savedStationId) : isEditing && params.id ? params.id : "new";

  // Restore draft on mount (runs once)
  const draftRestoredRef = useRef(false);
  useEffect(() => {
    if (draftRestoredRef.current) return;
    draftRestoredRef.current = true;

    const restoreDraft = (draft: DraftData) => {
      skipNextDirtyRef.current = true;
      setTitle(draft.title);
      setType(draft.type);
      setScenario(draft.scenario);
      setPatientBriefing(draft.patientBriefing);
      setSpecialty(draft.specialty);
      setDefaultTimeMinutes(draft.defaultTimeMinutes);
      setReadingTimeMinutes(draft.readingTimeMinutes);
      setSections(draft.sections.map((sec) => ({
        ...sec,
        items: sec.items.map((item) => ({
          ...item,
          subItems: (item.subItems || []).map((sub) => ({
            ...sub,
            subItems: (sub as any).subItems || [],
          })),
        })),
      })));
      setQuestions(draft.questions);
      setReferenceImageUrl(draft.referenceImageUrl);
      setReferenceImageCaption(draft.referenceImageCaption);
      setHasPatientBriefing(draft.hasPatientBriefing);
      setAiPatientEnabled(draft.aiPatientEnabled);
      setShowBriefing(!!draft.patientBriefing);
      if (!isEditing) {
        setTemplateChosen(true);
      }
    };

    if (!isEditing) {
      // New station — ALWAYS start blank. Drafts under the "new" key are
      // recoverable only via the explicit DraftsList UI on Home/Library.
      // Autosave-during-edit still runs; it will overwrite the "new" draft
      // as the user types. See iter8 item 5.
    } else if (params.id) {
      // Editing existing station — check if a draft is newer than server data
      const draft = loadDraft(params.id);
      if (draft && existingStation) {
        const serverUpdatedAt = new Date(existingStation.updatedAt).getTime();
        if (draft.savedAt > serverUpdatedAt) {
          restoreDraft(draft);
          toast({
            title: "Unsaved changes restored",
            description: "A local draft newer than the last save was found.",
            action: (
              <ToastAction
                altText="Discard draft"
                onClick={() => {
                  clearDraft(params.id!);
                  window.location.reload();
                }}
              >
                Discard
              </ToastAction>
            ),
          });
        } else {
          // Server data is newer — discard stale draft
          clearDraft(params.id);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingStation]);

  // Debounced draft save to localStorage (1.5s debounce)
  useEffect(() => {
    if (!dirty) return;
    // Don't save draft for stations that already have server autosave
    // Actually, DO save draft even for existing stations — covers the gap
    // between edits and the next server autosave
    const timeout = setTimeout(() => {
      saveDraft(draftKey, {
        title,
        type,
        scenario,
        patientBriefing,
        specialty,
        defaultTimeMinutes,
        readingTimeMinutes,
        sections,
        questions,
        referenceImageUrl,
        referenceImageCaption,
        hasPatientBriefing,
        aiPatientEnabled,
      });
    }, 1500);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    dirty,
    draftKey,
    title,
    type,
    scenario,
    patientBriefing,
    specialty,
    defaultTimeMinutes,
    readingTimeMinutes,
    sections,
    questions,
    referenceImageUrl,
    referenceImageCaption,
    hasPatientBriefing,
    aiPatientEnabled,
  ]);

  // Apply smart defaults when type is set on a new station
  const applyTypeDefaults = useCallback((nextType: string) => {
    const map: Record<string, { time: number; brief: boolean; ai: boolean }> = {
      history_taking: { time: 8, brief: true, ai: true },
      physical_exam: { time: 7, brief: false, ai: false },
      communication: { time: 10, brief: true, ai: true },
      image_id: { time: 5, brief: false, ai: false },
      custom: { time: 7, brief: false, ai: false },
    };
    const d = map[nextType] || map.custom;
    setDefaultTimeMinutes(d.time);
    setHasPatientBriefing(d.brief);
    setAiPatientEnabled(d.ai);
  }, []);

  // Section operations
  const addSection = useCallback(() => {
    setSections((prev) => [
      ...prev,
      {
        id: genId(),
        title: "",
        collapsed: false,
        items: [{ id: genId(), text: "", isCritical: false, points: 1, subItems: [] }],
      },
    ]);
  }, []);

  const removeSection = useCallback((sectionId: string) => {
    setSections((prev) => prev.filter((s) => s.id !== sectionId));
  }, []);

  const duplicateSection = useCallback((sectionId: string) => {
    setSections((prev) => {
      const idx = prev.findIndex((s) => s.id === sectionId);
      if (idx === -1) return prev;
      const src = prev[idx];
      const cloned: EditorSection = {
        id: genId(),
        title: `${src.title || "Section"} (copy)`,
        collapsed: src.collapsed,
        items: src.items.map((it) => ({
          ...it,
          id: genId(),
          subItems: it.subItems.map((si) => ({ ...si, id: genId() })),
        })),
      };
      const next = [...prev];
      next.splice(idx + 1, 0, cloned);
      return next;
    });
  }, []);

  const updateSectionTitle = useCallback((sectionId: string, title: string) => {
    setSections((prev) =>
      prev.map((s) => (s.id === sectionId ? { ...s, title } : s))
    );
  }, []);

  const toggleSectionCollapse = useCallback((sectionId: string) => {
    setSections((prev) =>
      prev.map((s) => (s.id === sectionId ? { ...s, collapsed: !s.collapsed } : s))
    );
  }, []);

  // Item operations
  const addItem = useCallback((sectionId: string) => {
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              items: [
                ...s.items,
                { id: genId(), text: "", isCritical: false, points: 1, subItems: [] },
              ],
            }
          : s
      )
    );
  }, []);

  const removeItem = useCallback((sectionId: string, itemId: string) => {
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId
          ? { ...s, items: s.items.filter((i) => i.id !== itemId) }
          : s
      )
    );
  }, []);

  const updateItemText = useCallback(
    (sectionId: string, itemId: string, text: string) => {
      setSections((prev) =>
        prev.map((s) =>
          s.id === sectionId
            ? {
                ...s,
                items: s.items.map((i) =>
                  i.id === itemId ? { ...i, text } : i
                ),
              }
            : s
        )
      );
    },
    []
  );

  const toggleItemCritical = useCallback(
    (sectionId: string, itemId: string) => {
      setSections((prev) =>
        prev.map((s) =>
          s.id === sectionId
            ? {
                ...s,
                items: s.items.map((i) =>
                  i.id === itemId ? { ...i, isCritical: !i.isCritical } : i
                ),
              }
            : s
        )
      );
    },
    []
  );

  // Indent: convert item to sub-item of the item above it.
  // Strict-Mode safe: decide outside the updater so the toast side-effect
  // never fires twice when React invokes the setter twice.
  const indentItem = useCallback((sectionId: string, itemId: string) => {
    // Decide outside the updater — Strict-Mode safe (no side effects in setter).
    const section = sectionsRef.current.find((s) => s.id === sectionId);
    if (!section) return;
    const idx = section.items.findIndex((i) => i.id === itemId);
    if (idx <= 0) return; // Can't indent first item
    const item = section.items[idx];
    if (item.subItems.length > 0) {
      toast({
        title: "Can't indent",
        description: "Remove sub-items first.",
        variant: "destructive",
      });
      return;
    }
    setSections((prev) =>
      prev.map((s) => {
        if (s.id !== sectionId) return s;
        const i = s.items.findIndex((it) => it.id === itemId);
        if (i <= 0) return s;
        const moving = s.items[i];
        if (moving.subItems.length > 0) return s;
        const newItems = s.items.filter((it) => it.id !== itemId);
        const parentIdx = i - 1;
        newItems[parentIdx] = {
          ...newItems[parentIdx],
          subItems: [
            ...newItems[parentIdx].subItems,
            {
              id: moving.id,
              text: moving.text,
              isCritical: moving.isCritical,
              points: moving.points,
              subItems: [],
              ...pickLearningContent(moving),
            },
          ],
        };
        return { ...s, items: newItems };
      })
    );
  }, [toast]);

  // Outdent: convert sub-item to standalone item after its parent.
  // Preserves all LearningContent fields.
  const outdentSubItem = useCallback(
    (sectionId: string, parentItemId: string, subItemId: string) => {
      setSections((prev) =>
        prev.map((s) => {
          if (s.id !== sectionId) return s;
          const parentIdx = s.items.findIndex((i) => i.id === parentItemId);
          if (parentIdx === -1) return s;
          const parent = s.items[parentIdx];
          const subItem = parent.subItems.find((si) => si.id === subItemId);
          if (!subItem) return s;

          const newParent = {
            ...parent,
            subItems: parent.subItems.filter((si) => si.id !== subItemId),
          };
          const newItem: EditorItem = {
            id: subItem.id,
            text: subItem.text,
            isCritical: subItem.isCritical,
            points: subItem.points,
            ...pickLearningContent(subItem),
            subItems: (subItem.subItems || []).map((ssi) => ({
              ...ssi,
              subItems: [],
            })),
          };
          const newItems = [...s.items];
          newItems[parentIdx] = newParent;
          newItems.splice(parentIdx + 1, 0, newItem);
          return { ...s, items: newItems };
        })
      );
    },
    []
  );

  // Indent a sub-item into a sub-sub-item of the previous sibling sub-item.
  // Only works if:
  //  - there is a previous sibling sub-item
  //  - the sub-item being indented has no sub-sub-items (leaf)
  const indentSubItem = useCallback(
    (sectionId: string, parentItemId: string, subItemId: string) => {
      const section = sectionsRef.current.find((s) => s.id === sectionId);
      if (!section) return;
      const parent = section.items.find((i) => i.id === parentItemId);
      if (!parent) return;
      const idx = parent.subItems.findIndex((si) => si.id === subItemId);
      if (idx <= 0) return; // no previous sibling
      const moving = parent.subItems[idx];
      if (moving.subItems && moving.subItems.length > 0) {
        toast({
          title: "Can't indent",
          description: "Remove sub-sub-items first.",
          variant: "destructive",
        });
        return;
      }
      setSections((prev) =>
        prev.map((s) => {
          if (s.id !== sectionId) return s;
          return {
            ...s,
            items: s.items.map((i) => {
              if (i.id !== parentItemId) return i;
              const si = i.subItems.findIndex((x) => x.id === subItemId);
              if (si <= 0) return i;
              const mv = i.subItems[si];
              if (mv.subItems && mv.subItems.length > 0) return i;
              const next = i.subItems.filter((x) => x.id !== subItemId);
              const targetIdx = si - 1;
              next[targetIdx] = {
                ...next[targetIdx],
                subItems: [
                  ...(next[targetIdx].subItems || []),
                  {
                    id: mv.id,
                    text: mv.text,
                    isCritical: mv.isCritical,
                    points: mv.points,
                    ...pickLearningContent(mv),
                  },
                ],
              };
              return { ...i, subItems: next };
            }),
          };
        })
      );
    },
    [toast]
  );

  // Outdent a sub-sub-item back to a sub-item after its parent sub-item.
  const outdentSubSubItem = useCallback(
    (
      sectionId: string,
      itemId: string,
      parentSubItemId: string,
      subSubItemId: string
    ) => {
      setSections((prev) =>
        prev.map((s) => {
          if (s.id !== sectionId) return s;
          return {
            ...s,
            items: s.items.map((i) => {
              if (i.id !== itemId) return i;
              const parentIdx = i.subItems.findIndex(
                (si) => si.id === parentSubItemId
              );
              if (parentIdx === -1) return i;
              const parentSub = i.subItems[parentIdx];
              const ssub = (parentSub.subItems || []).find(
                (x) => x.id === subSubItemId
              );
              if (!ssub) return i;
              const newParentSub = {
                ...parentSub,
                subItems: (parentSub.subItems || []).filter(
                  (x) => x.id !== subSubItemId
                ),
              };
              const newSubItem: EditorSubItem = {
                id: ssub.id,
                text: ssub.text,
                isCritical: ssub.isCritical,
                points: ssub.points,
                ...pickLearningContent(ssub),
                subItems: [],
              };
              const nextSubs = [...i.subItems];
              nextSubs[parentIdx] = newParentSub;
              nextSubs.splice(parentIdx + 1, 0, newSubItem);
              return { ...i, subItems: nextSubs };
            }),
          };
        })
      );
    },
    []
  );

  // Sub-item operations
  const addSubItem = useCallback((sectionId: string, itemId: string) => {
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              items: s.items.map((i) =>
                i.id === itemId
                  ? {
                      ...i,
                      subItems: [
                        ...i.subItems,
                        { id: genId(), text: "", isCritical: false, points: 1, subItems: [] },
                      ],
                    }
                  : i
              ),
            }
          : s
      )
    );
  }, []);

  const removeSubItem = useCallback(
    (sectionId: string, itemId: string, subItemId: string) => {
      setSections((prev) =>
        prev.map((s) =>
          s.id === sectionId
            ? {
                ...s,
                items: s.items.map((i) =>
                  i.id === itemId
                    ? { ...i, subItems: i.subItems.filter((si) => si.id !== subItemId) }
                    : i
                ),
              }
            : s
        )
      );
    },
    []
  );

  const updateSubItemText = useCallback(
    (sectionId: string, itemId: string, subItemId: string, text: string) => {
      setSections((prev) =>
        prev.map((s) =>
          s.id === sectionId
            ? {
                ...s,
                items: s.items.map((i) =>
                  i.id === itemId
                    ? {
                        ...i,
                        subItems: i.subItems.map((si) =>
                          si.id === subItemId ? { ...si, text } : si
                        ),
                      }
                    : i
                ),
              }
            : s
        )
      );
    },
    []
  );

  const toggleSubItemCritical = useCallback(
    (sectionId: string, itemId: string, subItemId: string) => {
      setSections((prev) =>
        prev.map((s) =>
          s.id === sectionId
            ? {
                ...s,
                items: s.items.map((i) =>
                  i.id === itemId
                    ? {
                        ...i,
                        subItems: i.subItems.map((si) =>
                          si.id === subItemId
                            ? { ...si, isCritical: !si.isCritical }
                            : si
                        ),
                      }
                    : i
                ),
              }
            : s
        )
      );
    },
    []
  );

  // Question operations
  const addQuestion = useCallback(() => {
    setQuestions((prev) => [
      ...prev,
      { id: genId(), question: "", idealAnswer: "", questionType: "free_text" },
    ]);
  }, []);

  const removeQuestion = useCallback((qId: string) => {
    setQuestions((prev) => prev.filter((q) => q.id !== qId));
  }, []);

  const updateQuestion = useCallback(
    (qId: string, field: "question" | "idealAnswer", value: string) => {
      setQuestions((prev) =>
        prev.map((q) => (q.id === qId ? { ...q, [field]: value } : q))
      );
      setQuestionErrors((prev) => {
        if (!prev[qId]) return prev;
        const next = { ...prev };
        delete next[qId];
        return next;
      });
    },
    []
  );

  // Change question type. Initializes config shape for the chosen type.
  // Preserves keyPoints across free_text <-> checklist switches so user
  // doesn't lose draft work when toggling.
  const changeQuestionType = useCallback(
    (qId: string, newType: QuestionType) => {
      setQuestions((prev) =>
        prev.map((q) => {
          if (q.id !== qId) return q;
          if (newType === "free_text") {
            return {
              ...q,
              questionType: newType,
              options: undefined,
              threshold: undefined,
              idealAnswer: q.idealAnswer ?? "",
              // keep keyPoints around so checklist -> free_text -> checklist
              // round-trips don't lose items
              keyPoints: q.keyPoints ?? [],
            };
          }
          if (newType === "checklist") {
            return {
              ...q,
              questionType: newType,
              idealAnswer: null,
              options: undefined,
              threshold: undefined,
              keyPoints: q.keyPoints && q.keyPoints.length > 0 ? q.keyPoints : [],
            };
          }
          const options = q.options && q.options.length > 0
            ? q.options
            : [
                { text: "", isCorrect: false },
                { text: "", isCorrect: false },
              ];
          return {
            ...q,
            questionType: newType,
            idealAnswer: null,
            options,
            threshold: newType === "multi_select" ? (q.threshold ?? 1) : undefined,
          };
        }),
      );
    },
    [],
  );

  // Checklist key-point operations
  const addChecklistKeyPoint = useCallback((qId: string) => {
    setQuestions((prev) =>
      prev.map((q) => {
        if (q.id !== qId) return q;
        const pts = q.keyPoints ?? [];
        return { ...q, keyPoints: [...pts, { id: genId(), text: "" }] };
      }),
    );
  }, []);

  const updateChecklistKeyPoint = useCallback(
    (qId: string, kpId: string, text: string) => {
      setQuestions((prev) =>
        prev.map((q) => {
          if (q.id !== qId) return q;
          const pts = (q.keyPoints ?? []).map((p) =>
            p.id === kpId ? { ...p, text } : p,
          );
          return { ...q, keyPoints: pts };
        }),
      );
    },
    [],
  );

  const removeChecklistKeyPoint = useCallback(
    (qId: string, kpId: string) => {
      setQuestions((prev) =>
        prev.map((q) => {
          if (q.id !== qId) return q;
          const pts = (q.keyPoints ?? []).filter((p) => p.id !== kpId);
          return { ...q, keyPoints: pts };
        }),
      );
    },
    [],
  );

  const reorderChecklistKeyPoints = useCallback(
    (qId: string, activeId: string, overId: string) => {
      setQuestions((prev) =>
        prev.map((q) => {
          if (q.id !== qId) return q;
          const pts = q.keyPoints ?? [];
          const oldIdx = pts.findIndex((p) => p.id === activeId);
          const newIdx = pts.findIndex((p) => p.id === overId);
          if (oldIdx < 0 || newIdx < 0) return q;
          return { ...q, keyPoints: arrayMove(pts, oldIdx, newIdx) };
        }),
      );
    },
    [],
  );

  // Reorder the whole examiner-questions list. Vertical-only, no re-leveling.
  const reorderQuestions = useCallback(
    (activeId: string, overId: string) => {
      setQuestions((prev) => {
        const oldIdx = prev.findIndex((q) => q.id === activeId);
        const newIdx = prev.findIndex((q) => q.id === overId);
        if (oldIdx < 0 || newIdx < 0) return prev;
        return arrayMove(prev, oldIdx, newIdx);
      });
    },
    [],
  );

  const updateOption = useCallback(
    (qId: string, optIdx: number, patch: { text?: string; isCorrect?: boolean }) => {
      setQuestions((prev) =>
        prev.map((q) => {
          if (q.id !== qId || !q.options) return q;
          const nextOptions = q.options.map((o, i) => {
            if (i !== optIdx) return o;
            return {
              text: patch.text !== undefined ? patch.text : o.text,
              isCorrect:
                patch.isCorrect !== undefined ? patch.isCorrect : o.isCorrect,
            };
          });
          // For multiple_choice, only one option can be correct at a time.
          let finalOptions = nextOptions;
          if (q.questionType === "multiple_choice" && patch.isCorrect === true) {
            finalOptions = nextOptions.map((o, i) => ({
              ...o,
              isCorrect: i === optIdx,
            }));
          }
          return { ...q, options: finalOptions };
        }),
      );
    },
    [],
  );

  const addOption = useCallback((qId: string) => {
    setQuestions((prev) =>
      prev.map((q) => {
        if (q.id !== qId) return q;
        const options = [...(q.options ?? []), { text: "", isCorrect: false }];
        return { ...q, options };
      }),
    );
  }, []);

  const removeOption = useCallback((qId: string, optIdx: number) => {
    setQuestions((prev) =>
      prev.map((q) => {
        if (q.id !== qId || !q.options) return q;
        const options = q.options.filter((_, i) => i !== optIdx);
        return { ...q, options };
      }),
    );
  }, []);

  const updateThreshold = useCallback((qId: string, threshold: number) => {
    setQuestions((prev) =>
      prev.map((q) => (q.id === qId ? { ...q, threshold } : q)),
    );
  }, []);

  // Update item learning content
  const updateItemContent = useCallback(
    (sectionId: string, itemId: string, patch: Partial<LearningContent>) => {
      setSections((prev) =>
        prev.map((s) =>
          s.id === sectionId
            ? {
                ...s,
                items: s.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)),
              }
            : s
        )
      );
    },
    []
  );

  const updateSubItemContent = useCallback(
    (
      sectionId: string,
      itemId: string,
      subItemId: string,
      patch: Partial<LearningContent>
    ) => {
      setSections((prev) =>
        prev.map((s) =>
          s.id === sectionId
            ? {
                ...s,
                items: s.items.map((i) =>
                  i.id === itemId
                    ? {
                        ...i,
                        subItems: i.subItems.map((si) =>
                          si.id === subItemId ? { ...si, ...patch } : si
                        ),
                      }
                    : i
                ),
              }
            : s
        )
      );
    },
    []
  );

  // Sub-sub-item operations
  const addSubSubItem = useCallback(
    (sectionId: string, itemId: string, subItemId: string) => {
      setSections((prev) =>
        prev.map((s) =>
          s.id === sectionId
            ? {
                ...s,
                items: s.items.map((i) =>
                  i.id === itemId
                    ? {
                        ...i,
                        subItems: i.subItems.map((si) =>
                          si.id === subItemId
                            ? {
                                ...si,
                                subItems: [
                                  ...si.subItems,
                                  { id: genId(), text: "", isCritical: false, points: 1 },
                                ],
                              }
                            : si
                        ),
                      }
                    : i
                ),
              }
            : s
        )
      );
    },
    []
  );

  const removeSubSubItem = useCallback(
    (sectionId: string, itemId: string, subItemId: string, subSubItemId: string) => {
      setSections((prev) =>
        prev.map((s) =>
          s.id === sectionId
            ? {
                ...s,
                items: s.items.map((i) =>
                  i.id === itemId
                    ? {
                        ...i,
                        subItems: i.subItems.map((si) =>
                          si.id === subItemId
                            ? { ...si, subItems: si.subItems.filter((ssi) => ssi.id !== subSubItemId) }
                            : si
                        ),
                      }
                    : i
                ),
              }
            : s
        )
      );
    },
    []
  );

  const updateSubSubItemText = useCallback(
    (sectionId: string, itemId: string, subItemId: string, subSubItemId: string, text: string) => {
      setSections((prev) =>
        prev.map((s) =>
          s.id === sectionId
            ? {
                ...s,
                items: s.items.map((i) =>
                  i.id === itemId
                    ? {
                        ...i,
                        subItems: i.subItems.map((si) =>
                          si.id === subItemId
                            ? {
                                ...si,
                                subItems: si.subItems.map((ssi) =>
                                  ssi.id === subSubItemId ? { ...ssi, text } : ssi
                                ),
                              }
                            : si
                        ),
                      }
                    : i
                ),
              }
            : s
        )
      );
    },
    []
  );

  const updateSubSubItemContent = useCallback(
    (sectionId: string, itemId: string, subItemId: string, subSubItemId: string, patch: Partial<LearningContent>) => {
      setSections((prev) =>
        prev.map((s) =>
          s.id === sectionId
            ? {
                ...s,
                items: s.items.map((i) =>
                  i.id === itemId
                    ? {
                        ...i,
                        subItems: i.subItems.map((si) =>
                          si.id === subItemId
                            ? {
                                ...si,
                                subItems: si.subItems.map((ssi) =>
                                  ssi.id === subSubItemId ? { ...ssi, ...patch } : ssi
                                ),
                              }
                            : si
                        ),
                      }
                    : i
                ),
              }
            : s
        )
      );
    },
    []
  );

  // dnd-kit reordering
  const reorderSections = useCallback((activeId: string, overId: string) => {
    setSections((prev) => {
      const oldIdx = prev.findIndex((s) => s.id === activeId);
      const newIdx = prev.findIndex((s) => s.id === overId);
      if (oldIdx < 0 || newIdx < 0) return prev;
      return arrayMove(prev, oldIdx, newIdx);
    });
  }, []);

  const reorderSubItemsInItem = useCallback(
    (sectionId: string, itemId: string, activeId: string, overId: string) => {
      setSections((prev) =>
        prev.map((s) => {
          if (s.id !== sectionId) return s;
          return {
            ...s,
            items: s.items.map((i) => {
              if (i.id !== itemId) return i;
              const oldIdx = i.subItems.findIndex((si) => si.id === activeId);
              const newIdx = i.subItems.findIndex((si) => si.id === overId);
              if (oldIdx < 0 || newIdx < 0) return i;
              return { ...i, subItems: arrayMove(i.subItems, oldIdx, newIdx) };
            }),
          };
        })
      );
    },
    []
  );

  const reorderItemsInSection = useCallback(
    (sectionId: string, activeId: string, overId: string) => {
      setSections((prev) =>
        prev.map((s) => {
          if (s.id !== sectionId) return s;
          const oldIdx = s.items.findIndex((i) => i.id === activeId);
          const newIdx = s.items.findIndex((i) => i.id === overId);
          if (oldIdx < 0 || newIdx < 0) return s;
          return { ...s, items: arrayMove(s.items, oldIdx, newIdx) };
        })
      );
    },
    []
  );

  const reorderSubSubItemsInSubItem = useCallback(
    (
      sectionId: string,
      itemId: string,
      subItemId: string,
      activeId: string,
      overId: string,
    ) => {
      setSections((prev) =>
        prev.map((s) => {
          if (s.id !== sectionId) return s;
          return {
            ...s,
            items: s.items.map((i) => {
              if (i.id !== itemId) return i;
              return {
                ...i,
                subItems: i.subItems.map((si) => {
                  if (si.id !== subItemId) return si;
                  const subSubs = si.subItems ?? [];
                  const oldIdx = subSubs.findIndex((ss) => ss.id === activeId);
                  const newIdx = subSubs.findIndex((ss) => ss.id === overId);
                  if (oldIdx < 0 || newIdx < 0) return si;
                  return { ...si, subItems: arrayMove(subSubs, oldIdx, newIdx) };
                }),
              };
            }),
          };
        }),
      );
    },
    [],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Build payload helper
  const buildPayload = (): CreateStationPayload => ({
    title: title.trim(),
    type: type as CreateStationPayload["type"],
    defaultTimeMinutes,
    readingTimeMinutes,
    scenario: scenario || undefined,
    patientBriefing: hasPatientBriefing ? patientBriefing || undefined : undefined,
    hasPatientBriefing,
    aiPatientEnabled,
    referenceImageUrl: referenceImageUrl || null,
    referenceImageCaption: referenceImageCaption || null,
    specialty: specialty || undefined,
    tags: [],
    sections: sections.map((sec, si) => ({
      title: sec.title || `Section ${si + 1}`,
      order: si,
      description: sec.description || null,
      imageUrl: sec.imageUrl || null,
      imageCaption: sec.imageCaption || null,
      items: sec.items
        .filter((item) => item.text.trim())
        .map((item, ii) => ({
          text: item.text.trim(),
          isCritical: item.isCritical,
          points: item.points,
          order: ii,
          explanation: item.explanation || null,
          imageUrl: item.imageUrl || null,
          imageCaption: item.imageCaption || null,
          videoUrl: item.videoUrl || null,
          media: (item.media ?? []).map((m, mi) => ({ type: m.type, url: m.url, caption: m.caption ?? null, order: mi })),
          subItems: item.subItems
            .filter((sub) => sub.text.trim())
            .map((sub, sii) => ({
              text: sub.text.trim(),
              isCritical: sub.isCritical,
              points: sub.points,
              order: sii,
              explanation: sub.explanation || null,
              imageUrl: sub.imageUrl || null,
              imageCaption: sub.imageCaption || null,
              videoUrl: sub.videoUrl || null,
              media: (sub.media ?? []).map((m, mi) => ({ type: m.type, url: m.url, caption: m.caption ?? null, order: mi })),
              subItems: (sub.subItems || [])
                .filter((ssub) => ssub.text.trim())
                .map((ssub, ssii) => ({
                  text: ssub.text.trim(),
                  isCritical: ssub.isCritical,
                  points: ssub.points,
                  order: ssii,
                  explanation: ssub.explanation || null,
                  imageUrl: ssub.imageUrl || null,
                  imageCaption: ssub.imageCaption || null,
                  videoUrl: ssub.videoUrl || null,
                  media: ((ssub as any).media ?? []).map((m: any, mi: number) => ({ type: m.type, url: m.url, caption: m.caption ?? null, order: mi })),
                })),
            })),
        })),
    })),
    examinerQuestions: questions
      .filter((q) => {
        if (!q.question.trim()) return false;
        const t = q.questionType ?? "free_text";
        if (t === "free_text") return (q.idealAnswer ?? "").trim().length > 0;
        if (t === "checklist") {
          // Persist the question shell even if items are empty — author can
          // come back later. Drops only completely-blank questions.
          return true;
        }
        const opts = q.options ?? [];
        return opts.length >= 2 && opts.some((o) => o.isCorrect) && opts.every((o) => o.text.trim());
      })
      .map((q, qi) => {
        const t = q.questionType ?? "free_text";
        if (t === "free_text") {
          return {
            question: q.question.trim(),
            questionType: "free_text" as const,
            idealAnswer: (q.idealAnswer ?? "").trim(),
            keyPoints: [],
            order: qi,
          };
        }
        if (t === "checklist") {
          const items = (q.keyPoints ?? [])
            .map((p) => p.text.trim())
            .filter((t) => t.length > 0);
          return {
            question: q.question.trim(),
            questionType: "checklist" as const,
            idealAnswer: null,
            keyPoints: items,
            config: null,
            order: qi,
          };
        }
        const options = (q.options ?? []).map((o) => ({
          text: o.text.trim(),
          isCorrect: o.isCorrect,
        }));
        const correctCount = options.filter((o) => o.isCorrect).length;
        const config =
          t === "multi_select"
            ? { options, threshold: Math.min(q.threshold ?? correctCount, correctCount) }
            : { options };
        return {
          question: q.question.trim(),
          questionType: t,
          idealAnswer: null,
          keyPoints: [],
          config,
          order: qi,
        };
      }),
  });

  // Autosave: after first save (savedStationId set), debounce 2s on dirty changes
  useEffect(() => {
    if (!savedStationId) return;
    if (!dirty) return;
    if (!title.trim()) return;
    if (type !== "qa" && sections.length === 0) return;
    const timeout = setTimeout(async () => {
      try {
        setAutosaveStatus("saving");
        const payload = buildPayload();
        await updateStation.mutateAsync({ id: savedStationId, data: payload });
        clearDraft(String(savedStationId));
        setDirty(false);
        dirtyRef.current = false;
        setLastSavedAt(Date.now());
      } catch {
        // leave dirty
      } finally {
        setAutosaveStatus("idle");
      }
    }, 2000);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    dirty,
    savedStationId,
    title,
    type,
    scenario,
    patientBriefing,
    specialty,
    defaultTimeMinutes,
    readingTimeMinutes,
    sections,
    questions,
    referenceImageUrl,
    referenceImageCaption,
  ]);

  // Save
  const handleSave = async () => {
    if (isSaving) return;

    // Validation
    let hasError = false;
    setTitleError(null);
    setSectionsError(null);
    setReferenceImageError(null);
    const newItemErrors: Record<string, string> = {};

    if (type === "image_id" && !referenceImageUrl) {
      setReferenceImageError("Upload a reference image to save this station");
      hasError = true;
    }

    if (!title.trim()) {
      setTitleError("Title is required");
      titleRef.current?.focus();
      hasError = true;
    }

    // Q&A stations skip the sections requirement — they're pure examiner questions.
    if (type === "qa") {
      const hasValidQuestion = questions.some((q) => {
        if (!q.question.trim()) return false;
        const t = q.questionType ?? "free_text";
        if (t === "free_text") return (q.idealAnswer ?? "").trim().length > 0;
        if (t === "checklist") {
          // A checklist question counts as "complete" as long as the prompt
          // is set — empty items are warned about, not blocked.
          return true;
        }
        const opts = q.options ?? [];
        return opts.length >= 2 && opts.some((o) => o.isCorrect);
      });
      if (!hasValidQuestion) {
        setSectionsError("Add at least one complete examiner question");
        hasError = true;
      } else {
        setSectionsError(null);
      }
    } else if (sections.length === 0) {
      setSectionsError("Add at least one section");
      hasError = true;
    } else {
      for (const sec of sections) {
        const validItems = sec.items.filter((i) => i.text.trim());
        if (validItems.length === 0) {
          newItemErrors[sec.id] = "Section must have at least one item with text";
          hasError = true;
        }
      }
    }

    setSectionItemErrors(newItemErrors);

    // Validate examiner questions: incomplete entries are an error.
    const newQuestionErrors: Record<string, string> = {};
    for (const q of questions) {
      const hasQ = q.question.trim().length > 0;
      const qType = q.questionType ?? "free_text";
      if (qType === "free_text") {
        const hasA = (q.idealAnswer ?? "").trim().length > 0;
        if (hasQ && !hasA) {
          newQuestionErrors[q.id] = "Add an ideal answer or clear the question.";
          hasError = true;
        } else if (!hasQ && hasA) {
          newQuestionErrors[q.id] = "Add a question or clear the ideal answer.";
          hasError = true;
        }
      } else if (qType === "checklist") {
        // Checklist questions only need a prompt. Empty-items is a warning
        // (rendered inline below), not a save blocker. The only error case
        // is items entered without a prompt — author probably forgot.
        const filledItems = (q.keyPoints ?? []).filter((p) => p.text.trim());
        if (!hasQ && filledItems.length > 0) {
          newQuestionErrors[q.id] = "Add a question or remove this entry.";
          hasError = true;
        }
      } else {
        const opts = q.options ?? [];
        const filledOpts = opts.filter((o) => o.text.trim().length > 0);
        const correctCount = filledOpts.filter((o) => o.isCorrect).length;
        if (!hasQ) {
          if (filledOpts.length > 0) {
            newQuestionErrors[q.id] = "Add a question or remove this entry.";
            hasError = true;
          }
          continue;
        }
        if (filledOpts.length < 2) {
          newQuestionErrors[q.id] = "Add at least 2 options.";
          hasError = true;
        } else if (qType === "multiple_choice" && correctCount !== 1) {
          newQuestionErrors[q.id] = "Mark exactly one correct option.";
          hasError = true;
        } else if (qType === "multi_select" && correctCount < 1) {
          newQuestionErrors[q.id] = "Mark at least one correct option.";
          hasError = true;
        }
      }
    }
    setQuestionErrors(newQuestionErrors);

    if (hasError) return;

    const payload = buildPayload();

    try {
      if (savedStationId) {
        await updateStation.mutateAsync({ id: savedStationId, data: payload });
        clearDraft(String(savedStationId));
        setDirty(false);
        dirtyRef.current = false;
        setLastSavedAt(Date.now());
        toast({ title: "Station updated" });
        navigate(`/station/${savedStationId}`);
      } else {
        const result = await createStation.mutateAsync(payload);
        clearDraft("new");
        setSavedStationId(result.id);
        setDirty(false);
        dirtyRef.current = false;
        setLastSavedAt(Date.now());
        // Prime the detail cache and mark the ref as already-loaded so the
        // URL swap below doesn't trigger a loading spinner or a server
        // re-hydration that would re-key local section/item ids.
        queryClient.setQueryData([`/api/stations/${result.id}`], result);
        loadedStationIdRef.current = result.id;
        // Silently swap the URL to the real station's edit route so
        // autosave/drafts continue keyed to the new id. No toast — the
        // "Saved" pill is the only feedback needed.
        navigate(`/station/${result.id}/edit`, { replace: true });
      }
    } catch (err: any) {
      toast({
        title: "Save failed",
        description: err.message || "Please try again",
        variant: "destructive",
      });
    }
  };

  // Handle Enter key in item inputs for fast editing
  const handleItemKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    sectionId: string,
    itemId: string,
    isLast: boolean
  ) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (isLast) {
        addItem(sectionId);
      }
      // Focus next input after render
      setTimeout(() => {
        const nextInput = (e.target as HTMLElement)
          .closest("[data-item]")
          ?.nextElementSibling?.querySelector("input");
        if (nextInput) (nextInput as HTMLInputElement).focus();
      }, 50);
    }
    if (e.key === "Tab" && !e.shiftKey) {
      const input = e.target as HTMLInputElement;
      if (input.value.trim()) {
        e.preventDefault();
        indentItem(sectionId, itemId);
      }
    }
  };

  if (isEditing && isLoadingStation) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Type chooser (primary) + templates (secondary)
  if (!templateChosen && !isEditing) {
    const TYPE_CHOICES: Array<{
      key: string;
      label: string;
      description: string;
      emoji: string;
    }> = [
      { key: "history_taking", label: "History taking", description: "Ask questions, build a dx.", emoji: "💬" },
      { key: "physical_exam", label: "Physical exam", description: "Examine and narrate.", emoji: "🩺" },
      { key: "communication", label: "Communication", description: "Break bad news, consent.", emoji: "👥" },
      { key: "image_id", label: "Image ID", description: "X-rays, ECGs, slides.", emoji: "🖼" },
      { key: "qa", label: "Q&A / Oral", description: "Examiner questions only. MCQ, multi-select, free text.", emoji: "❓" },
      { key: "custom", label: "Custom", description: "Build from scratch.", emoji: "✦" },
    ];
    const chooseType = (key: string) => {
      setType(key);
      applyTypeDefaults(key);
      // Q&A stations start with no sections and one blank examiner question.
      if (key === "qa") {
        setSections([]);
        setQuestions([
          { id: genId(), question: "", idealAnswer: "", questionType: "free_text" },
        ]);
      } else {
        // Other types start with one empty section.
        setSections([
          {
            id: genId(),
            title: "Section 1",
            collapsed: false,
            items: [{ id: genId(), text: "", isCritical: false, points: 1, subItems: [] }],
          },
        ]);
      }
      setTemplateChosen(true);
      setTimeout(() => titleRef.current?.focus(), 100);
    };
    return (
      <div className="min-h-screen bg-background">
        {/* Sticky header */}
        <div className="sticky top-0 z-30 h-14 backdrop-blur-xl bg-background/70 border-b border-border/40 safe-top">
          <div className="mx-auto flex h-14 max-w-2xl items-center px-2">
            <button
              onClick={() => navigate("/my-stations")}
              aria-label="Back to Library"
              className="flex h-11 w-11 items-center justify-center rounded-full text-foreground transition-smooth hover:bg-muted active:scale-[0.98]"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="mx-auto max-w-2xl px-5 pt-6 pb-10">
          <h1 className="mb-2 text-h1 text-foreground">
            What are you practicing?
          </h1>
          <p className="mb-8 text-body text-muted-foreground">
            Pick a station type to start with smart defaults.
          </p>

          <div className="space-y-3">
            {TYPE_CHOICES.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => chooseType(t.key)}
                className="flex w-full items-center gap-4 rounded-2xl border border-border/40 bg-card p-5 text-left transition-smooth hover:border-primary/30 hover:bg-primary/5 active:scale-[0.99]"
              >
                <span className="text-2xl" aria-hidden>{t.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-h3 text-foreground">{t.label}</div>
                  <div className="text-caption text-muted-foreground">{t.description}</div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </button>
            ))}
          </div>

        </div>
      </div>
    );
  }

  // Main editor
  return (
    <div className="min-h-screen bg-background pb-24 lg:pb-0">
      {/* Sticky save header */}
      <div className="sticky top-0 z-30 h-14 backdrop-blur-xl bg-background/70 border-b border-border/40 safe-top">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between gap-2 px-2 lg:px-8 lg:max-w-none">
          <button
            onClick={() => {
              if (dirtyRef.current) {
                setConfirmLeaveOpen(true);
                return;
              }
              navigate(savedStationId ? `/station/${savedStationId}` : "/my-stations");
            }}
            aria-label="Back"
            className="flex h-11 w-11 items-center justify-center rounded-full text-foreground transition-smooth hover:bg-muted active:scale-[0.98]"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          {/* Station title — desktop only, centered between back and save chip */}
          <span className="hidden lg:block flex-1 min-w-0 px-4 text-center truncate text-caption text-muted-foreground">
            {title || "Untitled station"}
          </span>
          <div className="pr-2">
            <SaveStatusChip
              dirty={dirty}
              saving={autosaveStatus === "saving" || isSaving}
              lastSavedAt={lastSavedAt}
              onClick={handleSave}
            />
          </div>
        </div>
      </div>

      {/* Side-by-side at lg+: left=metadata (sticky), right=checklist+questions (own scroll) */}
      <div className="lg:grid lg:grid-cols-[2fr_3fr]">
        {/* ── Left panel — station metadata ── */}
        <div className="px-5 pt-6 pb-6 space-y-8 lg:sticky lg:top-14 lg:h-[calc(100vh-56px)] lg:overflow-y-auto lg:border-r lg:border-border/40">
        {/* Title + metadata block */}
        <div className="space-y-3">
          <Input
            ref={titleRef}
            placeholder="Untitled station"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (titleError) setTitleError(null);
            }}
            aria-invalid={!!titleError}
            className="h-auto border-0 bg-transparent text-h1 text-foreground placeholder:text-muted-foreground/40 focus-visible:ring-0 rounded-none px-0 py-0"
          />
          {titleError && (
            <p className="text-caption text-destructive">{titleError}</p>
          )}
          {/* Metadata row */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-7 items-center rounded-full bg-muted px-3 text-caption text-muted-foreground">
              {stationTypeLabel(type)}
            </span>
            <span className="text-caption text-muted-foreground">
              {defaultTimeMinutes || 0} min
            </span>
            <span className="text-muted-foreground/40" aria-hidden>·</span>
            <span className="text-caption text-muted-foreground">
              {readingTimeMinutes || 0} min reading
            </span>
          </div>
        </div>

        {/* Type + Default Time + Reading Time */}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label className="text-label text-muted-foreground">Type</Label>
            <Select
              value={type}
              onValueChange={(v) => {
                setType(v);
                if (!isEditing) applyTypeDefaults(v);
              }}
            >
              <SelectTrigger className="h-12 rounded-xl border-0 bg-muted/30 px-4 text-[17px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-2xl shadow-lg">
                {["history_taking", "physical_exam", "communication", "image_id", "custom"].map((t) => (
                  <SelectItem key={t} value={t} className="h-9">
                    {stationTypeLabel(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-label text-muted-foreground">Default Time (min)</Label>
            <Input
              type="number"
              min={1}
              max={30}
              className="h-12 rounded-xl border-0 bg-muted/30 px-4 text-[17px]"
              value={defaultTimeMinutes === null ? "" : defaultTimeMinutes}
              onChange={(e) => {
                const v = e.target.value;
                setDefaultTimeMinutes(v === "" ? (null as unknown as number) : Number(v));
              }}
              onBlur={(e) => {
                if (e.target.value === "" || Number(e.target.value) < 1) setDefaultTimeMinutes(7);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-label text-muted-foreground">Reading time (min)</Label>
            <Input
              type="number"
              min={0}
              max={5}
              className="h-12 rounded-xl border-0 bg-muted/30 px-4 text-[17px]"
              value={readingTimeMinutes === null ? "" : readingTimeMinutes}
              onChange={(e) => {
                const v = e.target.value;
                setReadingTimeMinutes(v === "" ? (null as unknown as number) : Number(v));
              }}
              onBlur={(e) => {
                if (e.target.value === "") setReadingTimeMinutes(0);
              }}
            />
          </div>
        </div>

        {/* Specialty (always visible — primary metadata for filtering / discovery) */}
        <div className="space-y-1.5">
          <Label className="text-label text-muted-foreground">Specialty</Label>
          <Select
            value={specialty || NO_SPECIALTY}
            onValueChange={(v) => setSpecialty(v === NO_SPECIALTY ? "" : v)}
          >
            <SelectTrigger className="h-12 rounded-xl border-0 bg-muted/30 px-4 text-[17px]">
              <SelectValue placeholder="Select a specialty" />
            </SelectTrigger>
            <SelectContent className="rounded-2xl shadow-lg">
              <SelectItem value={NO_SPECIALTY} className="h-9">— Unspecified —</SelectItem>
              {SPECIALTIES.map((s) => (
                <SelectItem key={s} value={s} className="h-9">
                  {s}
                </SelectItem>
              ))}
              {/* Legacy specialty value not in canonical list — keep editable. */}
              {specialty && !SPECIALTIES.includes(specialty as typeof SPECIALTIES[number]) && (
                <SelectItem value={specialty} className="h-9">
                  {specialty} <span className="text-muted-foreground">(legacy)</span>
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Reference image (Image ID only) */}
        {type === "image_id" && (
          <div className="space-y-2">
            <Label className="text-label text-muted-foreground">Reference image</Label>
            <ImageEditor
              imageUrl={referenceImageUrl}
              imageCaption={referenceImageCaption}
              onChange={(patch) => {
                if ("imageUrl" in patch) {
                  const next = (patch.imageUrl as string | null) ?? null;
                  setReferenceImageUrl(next);
                  if (next) setReferenceImageError(null);
                }
                if ("imageCaption" in patch) setReferenceImageCaption((patch.imageCaption as string | null) ?? "");
              }}
            />
            {referenceImageError && (
              <p className="text-caption text-destructive">{referenceImageError}</p>
            )}
          </div>
        )}

        {/* Scenario */}
        <div className="space-y-1.5">
          <Label className="text-label text-muted-foreground">Scenario / Stem (optional)</Label>
          <Textarea
            placeholder="Enter the scenario text that will be shown during reading time..."
            className="min-h-[100px] resize-y rounded-xl border-0 bg-muted/30 px-4 py-3 text-[17px]"
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
          />
        </div>

        {/* Patient briefing — progressive disclosure (UX_SPEC_V2 §3.8) */}
        {type !== "image_id" && (
          <div className="space-y-3">
            {type !== "history_taking" && type !== "communication" && (
            <label className="flex items-start gap-3 rounded-2xl border border-border/40 bg-card p-4 cursor-pointer transition-smooth hover:border-border/60">
              <input
                type="checkbox"
                checked={hasPatientBriefing}
                onChange={(e) => setHasPatientBriefing(e.target.checked)}
                className="mt-1 h-4 w-4 accent-primary"
              />
              <div>
                <div className="text-body font-medium text-foreground">This station has a patient briefing</div>
                <div className="text-caption text-muted-foreground mt-0.5">
                  {type === "physical_exam"
                    ? "Uncommon for physical exam — the examiner usually reads a one-liner."
                    : "A short brief the AI patient will use to stay in character."}
                </div>
              </div>
            </label>
            )}
            <AnimatePresence initial={false}>
              {(hasPatientBriefing || type === "history_taking" || type === "communication") && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
                  className="overflow-hidden"
                >
                  <Textarea
                    autoFocus
                    placeholder="Hidden prompt for the AI patient simulator. Describe personality, symptoms, responses..."
                    className="min-h-[80px] resize-y rounded-xl border-0 bg-muted/30 px-4 py-3 text-[17px]"
                    value={patientBriefing}
                    onChange={(e) => setPatientBriefing(e.target.value)}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <label className="flex items-start gap-3 rounded-2xl border border-border/40 bg-card p-4 cursor-pointer transition-smooth hover:border-border/60">
              <input
                type="checkbox"
                checked={aiPatientEnabled}
                onChange={(e) => setAiPatientEnabled(e.target.checked)}
                className="mt-1 h-4 w-4 accent-primary"
              />
              <div>
                <div className="text-body font-medium text-foreground">Enable AI patient voice</div>
                <div className="text-caption text-muted-foreground mt-0.5">
                  {type === "physical_exam"
                    ? "Most physical exams have no SP — off by default."
                    : "Practice with a simulated patient that responds to your questions."}
                </div>
              </div>
            </label>
          </div>
        )}
        </div>{/* /left panel */}

        {/* ── Right panel — checklist builder + examiner questions ── */}
        <div className="px-5 pt-6 pb-6 space-y-8 lg:h-[calc(100vh-56px)] lg:overflow-y-auto">
        {/* ==================== SECTIONS ==================== */}
        {type !== "qa" && (
        <div>
          <div className="mb-4 flex items-end justify-between">
            <h2 className="text-h2 text-foreground">Checklist sections</h2>
            <span className="text-caption text-muted-foreground tabular-nums">
              {sections.reduce(
                (acc, s) =>
                  acc +
                  s.items.length +
                  s.items.reduce((a, i) => a + i.subItems.length, 0),
                0
              )}{" "}
              items
            </span>
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(e: DragEndEvent) => {
              if (!e.over) return;
              if (e.active.id !== e.over.id) {
                reorderSections(String(e.active.id), String(e.over.id));
              }
            }}
          >
            <SortableContext
              items={sections.map((s) => s.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-3">
                {sections.map((section, sectionIdx) => (
                  <SortableSection key={section.id} id={section.id}>
                    {(dragHandle) => (
                  <Card className="overflow-hidden rounded-2xl border border-border/40 bg-card p-0 shadow-none">
                    {/* Section header — minimal chrome */}
                    <div className="relative flex items-center gap-2 px-4 py-3">
                      {/* Full-height left-edge drag zone */}
                      <button
                        type="button"
                        className="absolute inset-y-0 left-0 flex w-6 cursor-grab items-center justify-center text-muted-foreground/50 transition-colors hover:text-muted-foreground active:cursor-grabbing"
                        aria-label="Drag section"
                        {...dragHandle}
                      >
                        <DotsHandle />
                      </button>
                      <div className="w-4 shrink-0" aria-hidden />
                      <button
                        onClick={() => toggleSectionCollapse(section.id)}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted"
                        aria-label={section.collapsed ? "Expand section" : "Collapse section"}
                      >
                        {section.collapsed ? (
                          <ChevronRight className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </button>
                      <Input
                        placeholder="Section name"
                        value={section.title}
                        onChange={(e) =>
                          updateSectionTitle(section.id, e.target.value)
                        }
                        className="h-9 flex-1 border-0 bg-transparent px-0 text-h3 text-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0"
                      />
                      <span className="text-caption text-muted-foreground tabular-nums">
                        {section.items.length}
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            aria-label="Section options"
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-2xl shadow-lg">
                          <DropdownMenuItem className="h-9" onSelect={() => duplicateSection(section.id)}>
                            Duplicate section
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="h-9 text-destructive focus:text-destructive"
                            onSelect={() => setSectionPendingDelete(section.id)}
                          >
                            Delete section
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {/* Section toolbar + drawers */}
                    {!section.collapsed && (
                      <SectionToolbar
                        section={section}
                        onUpdate={(patch) => {
                          setSections((prev) =>
                            prev.map((s) => s.id === section.id ? { ...s, ...patch } : s)
                          );
                        }}
                      />
                    )}

                    {/* Section items */}
                    {!section.collapsed && (
                      <div>
                        <CardContent className="space-y-1.5 p-3 pt-2">
                          <DndContext
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            onDragEnd={(e: DragEndEvent) => {
                              const dx = e.delta?.x ?? 0;
                              const dy = e.delta?.y ?? 0;
                              const activeId = String(e.active.id);
                              // Decide reorder vs re-level by gesture
                              // direction. A drag is treated as a re-level
                              // only when it was primarily horizontal AND
                              // crossed the threshold; otherwise it's a
                              // reorder. Previously both fired, so any
                              // vertical drag with a touch of rightward
                              // drift would silently re-level on top of the
                              // reorder.
                              const isRelevel =
                                Math.abs(dx) > Math.abs(dy) &&
                                dx >= INDENT_THRESHOLD_PX;
                              if (isRelevel) {
                                setTimeout(
                                  () => indentItem(section.id, activeId),
                                  0,
                                );
                                return;
                              }
                              if (e.over && e.active.id !== e.over.id) {
                                reorderItemsInSection(
                                  section.id,
                                  activeId,
                                  String(e.over.id),
                                );
                              }
                            }}
                          >
                            <SortableContext
                              items={section.items.map((i) => i.id)}
                              strategy={verticalListSortingStrategy}
                            >
                            {section.items.map((item, itemIdx) => (
                              <SortableItem key={item.id} id={item.id}>
                                {(itemHandle) => (
                                  <ItemRow
                                    item={item}
                                    itemIndex={itemIdx}
                                    isLast={itemIdx === section.items.length - 1}
                                    dragHandle={itemHandle}
                                    onTextChange={(t) => updateItemText(section.id, item.id, t)}
                                    onContentChange={(patch) =>
                                      updateItemContent(section.id, item.id, patch)
                                    }
                                    onDelete={() => removeItem(section.id, item.id)}
                                    onIndent={() => indentItem(section.id, item.id)}
                                    onAddSubItem={() => addSubItem(section.id, item.id)}
                                    onKeyDown={(e) =>
                                      handleItemKeyDown(
                                        e,
                                        section.id,
                                        item.id,
                                        itemIdx === section.items.length - 1
                                      )
                                    }
                                    sensors={sensors}
                                    onReorderSubItems={(activeId, overId) =>
                                      reorderSubItemsInItem(
                                        section.id,
                                        item.id,
                                        activeId,
                                        overId
                                      )
                                    }
                                    onSubItemTextChange={(subId, t) =>
                                      updateSubItemText(section.id, item.id, subId, t)
                                    }
                                    onSubItemContentChange={(subId, patch) =>
                                      updateSubItemContent(section.id, item.id, subId, patch)
                                    }
                                    onSubItemDelete={(subId) =>
                                      removeSubItem(section.id, item.id, subId)
                                    }
                                    onSubItemOutdent={(subId) =>
                                      outdentSubItem(section.id, item.id, subId)
                                    }
                                    onSubItemIndent={(subId) =>
                                      indentSubItem(section.id, item.id, subId)
                                    }
                                    onAddSubSubItem={(subId) =>
                                      addSubSubItem(section.id, item.id, subId)
                                    }
                                    onSubSubItemTextChange={(subId, ssubId, t) =>
                                      updateSubSubItemText(section.id, item.id, subId, ssubId, t)
                                    }
                                    onSubSubItemContentChange={(subId, ssubId, patch) =>
                                      updateSubSubItemContent(section.id, item.id, subId, ssubId, patch)
                                    }
                                    onSubSubItemDelete={(subId, ssubId) =>
                                      removeSubSubItem(section.id, item.id, subId, ssubId)
                                    }
                                    onSubSubItemOutdent={(subId, ssubId) =>
                                      outdentSubSubItem(
                                        section.id,
                                        item.id,
                                        subId,
                                        ssubId
                                      )
                                    }
                                    onReorderSubSubItems={(
                                      subId,
                                      activeId,
                                      overId,
                                    ) =>
                                      reorderSubSubItemsInSubItem(
                                        section.id,
                                        item.id,
                                        subId,
                                        activeId,
                                        overId,
                                      )
                                    }
                                  />
                                )}
                              </SortableItem>
                            ))}
                            </SortableContext>
                          </DndContext>

                          {sectionItemErrors[section.id] && (
                            <p className="px-2 text-caption text-destructive">
                              {sectionItemErrors[section.id]}
                            </p>
                          )}
                          {/* Add item — subtle ghost row */}
                          <button
                            type="button"
                            onClick={() => addItem(section.id)}
                            className="mt-1 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-caption font-medium text-muted-foreground transition-smooth hover:bg-muted/50 hover:text-foreground active:scale-[0.99]"
                            aria-label="Add item"
                          >
                            <Plus className="h-4 w-4" />
                            Add item
                          </button>
                        </CardContent>
                      </div>
                    )}
                  </Card>
                    )}
                  </SortableSection>
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {sectionsError && (
            <p className="mt-2 text-caption text-destructive">{sectionsError}</p>
          )}
          {/* Add section — subtle ghost button, centered */}
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={addSection}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-body font-medium text-muted-foreground transition-smooth hover:bg-muted hover:text-foreground active:scale-[0.98]"
              aria-label="Add section"
            >
              <Plus className="h-4 w-4" />
              Add section
            </button>
          </div>
        </div>
        )}

        {/* ==================== EXAMINER QUESTIONS ==================== */}
        <div>
          <h2 className="mb-4 text-h2 text-foreground">Examiner questions</h2>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(e: DragEndEvent) => {
              // Vertical-only reorder; questions have no hierarchy.
              if (!e.over || e.active.id === e.over.id) return;
              reorderQuestions(String(e.active.id), String(e.over.id));
            }}
          >
            <SortableContext
              items={questions.map((q) => q.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-3">
                {questions.map((q, qi) => {
                  const qType = q.questionType ?? "free_text";
                  const correctCount = (q.options ?? []).filter((o) => o.isCorrect).length;
                  const checklistItems = q.keyPoints ?? [];
                  return (
                    <SortableItem key={q.id} id={q.id}>
                      {(dragHandle) => (
                        <Card className="group overflow-hidden rounded-2xl border border-border/40 bg-card p-0 shadow-none">
                          <CardContent className="space-y-3 p-4">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  className="flex h-7 w-5 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground/30 opacity-0 transition-opacity hover:text-muted-foreground group-hover:opacity-100 group-focus-within:opacity-100 active:cursor-grabbing"
                                  aria-label="Drag question"
                                  {...dragHandle}
                                >
                                  <DotsHandle />
                                </button>
                                <Label className="text-label text-muted-foreground">
                                  Q{qi + 1}
                                </Label>
                              </div>
                              <div className="flex items-center gap-2">
                                <Select
                                  value={qType}
                                  onValueChange={(v) =>
                                    changeQuestionType(q.id, v as QuestionType)
                                  }
                                >
                                  <SelectTrigger
                                    className="h-9 w-auto min-w-[150px] rounded-lg border border-border/40 bg-card px-2 text-caption"
                                    aria-label="Question type"
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent className="rounded-xl">
                                    <SelectItem value="free_text">
                                      <div className="flex items-center gap-2">
                                        <TextIcon className="h-3.5 w-3.5 text-muted-foreground" />
                                        <div className="flex flex-col">
                                          <span className="text-caption font-medium">Free text</span>
                                          <span className="text-[11px] text-muted-foreground">Compared to an ideal answer.</span>
                                        </div>
                                      </div>
                                    </SelectItem>
                                    <SelectItem value="multiple_choice">
                                      <div className="flex items-center gap-2">
                                        <CircleDot className="h-3.5 w-3.5 text-muted-foreground" />
                                        <div className="flex flex-col">
                                          <span className="text-caption font-medium">Multiple choice</span>
                                          <span className="text-[11px] text-muted-foreground">Pick exactly one correct option.</span>
                                        </div>
                                      </div>
                                    </SelectItem>
                                    <SelectItem value="multi_select">
                                      <div className="flex items-center gap-2">
                                        <CheckSquare className="h-3.5 w-3.5 text-muted-foreground" />
                                        <div className="flex flex-col">
                                          <span className="text-caption font-medium">Multi-select</span>
                                          <span className="text-[11px] text-muted-foreground">Pick all that apply, with a threshold.</span>
                                        </div>
                                      </div>
                                    </SelectItem>
                                    <SelectItem value="checklist">
                                      <div className="flex items-center gap-2">
                                        <ListChecks className="h-3.5 w-3.5 text-muted-foreground" />
                                        <div className="flex flex-col">
                                          <span className="text-caption font-medium">Checklist (per-item points)</span>
                                          <span className="text-[11px] text-muted-foreground">
                                            Expects a list of items; each one is worth 1 point. Used for things like "list the triggers of...".
                                          </span>
                                        </div>
                                      </div>
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                                <button
                                  onClick={() => removeQuestion(q.id)}
                                  aria-label="Remove question"
                                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-destructive"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>

                            <Input
                              placeholder="Question..."
                              value={q.question}
                              onChange={(e) =>
                                updateQuestion(q.id, "question", e.target.value)
                              }
                              className="h-12 rounded-xl border-0 bg-muted/30 px-4 text-[17px]"
                            />

                            {qType === "free_text" && (
                              <Textarea
                                placeholder="Ideal answer..."
                                value={q.idealAnswer ?? ""}
                                onChange={(e) =>
                                  updateQuestion(q.id, "idealAnswer", e.target.value)
                                }
                                className="min-h-[72px] resize-y rounded-xl border-0 bg-muted/30 px-4 py-3 text-[17px]"
                              />
                            )}

                            {qType === "checklist" && (
                              <div className="space-y-2">
                                <div>
                                  <p className="text-caption font-medium text-foreground">
                                    Expected items
                                  </p>
                                  <p className="text-[12px] text-muted-foreground">
                                    Each item is worth 1 point. Add as many as the answer requires.
                                  </p>
                                </div>
                                <DndContext
                                  sensors={sensors}
                                  collisionDetection={closestCenter}
                                  onDragEnd={(e: DragEndEvent) => {
                                    if (!e.over || e.active.id === e.over.id) return;
                                    reorderChecklistKeyPoints(
                                      q.id,
                                      String(e.active.id),
                                      String(e.over.id),
                                    );
                                  }}
                                >
                                  <SortableContext
                                    items={checklistItems.map((p) => p.id)}
                                    strategy={verticalListSortingStrategy}
                                  >
                                    <div className="space-y-1.5">
                                      {checklistItems.map((kp, kpi) => (
                                        <SortableItem key={kp.id} id={kp.id}>
                                          {(kpHandle) => (
                                            <div className="group/kp flex items-center gap-1.5">
                                              <button
                                                type="button"
                                                className="flex h-9 w-5 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground/30 opacity-0 transition-opacity hover:text-muted-foreground group-hover/kp:opacity-100 group-focus-within/kp:opacity-100 active:cursor-grabbing"
                                                aria-label="Drag item"
                                                {...kpHandle}
                                              >
                                                <DotsHandle />
                                              </button>
                                              <Input
                                                placeholder={`Expected item ${kpi + 1}`}
                                                value={kp.text}
                                                onChange={(e) =>
                                                  updateChecklistKeyPoint(
                                                    q.id,
                                                    kp.id,
                                                    e.target.value,
                                                  )
                                                }
                                                className="h-11 flex-1 rounded-xl border-0 bg-muted/30 px-4 text-body"
                                              />
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  removeChecklistKeyPoint(q.id, kp.id)
                                                }
                                                aria-label={`Remove item ${kpi + 1}`}
                                                className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-destructive"
                                              >
                                                <Trash2 className="h-3.5 w-3.5" />
                                              </button>
                                            </div>
                                          )}
                                        </SortableItem>
                                      ))}
                                    </div>
                                  </SortableContext>
                                </DndContext>
                                <button
                                  type="button"
                                  onClick={() => addChecklistKeyPoint(q.id)}
                                  className="inline-flex h-9 items-center justify-center gap-2 rounded-full px-3 text-caption font-medium text-muted-foreground transition-smooth hover:bg-muted hover:text-foreground"
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                  Add item
                                </button>
                                {checklistItems.filter((p) => p.text.trim()).length === 0 && (
                                  <p className="text-[12px] text-amber-600">
                                    A checklist question with no items can't be scored — add at least one expected item before publishing.
                                  </p>
                                )}
                              </div>
                            )}

                            {(qType === "multiple_choice" || qType === "multi_select") && (
                              <div className="space-y-2">
                                <p className="text-caption text-muted-foreground">
                                  {qType === "multiple_choice"
                                    ? "Mark the one correct option."
                                    : "Mark every correct option."}
                                </p>
                                {(q.options ?? []).map((opt, oi) => (
                                  <div key={oi} className="flex items-center gap-2">
                                    <input
                                      type={qType === "multiple_choice" ? "radio" : "checkbox"}
                                      name={`q-${q.id}-correct`}
                                      checked={opt.isCorrect}
                                      onChange={(e) =>
                                        updateOption(q.id, oi, { isCorrect: e.target.checked })
                                      }
                                      aria-label={`Option ${oi + 1} is correct`}
                                      className="h-5 w-5 accent-primary"
                                    />
                                    <Input
                                      placeholder={`Option ${oi + 1}`}
                                      value={opt.text}
                                      onChange={(e) =>
                                        updateOption(q.id, oi, { text: e.target.value })
                                      }
                                      className="h-11 flex-1 rounded-xl border-0 bg-muted/30 px-4 text-body"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => removeOption(q.id, oi)}
                                      aria-label={`Remove option ${oi + 1}`}
                                      disabled={(q.options ?? []).length <= 2}
                                      className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                ))}
                                <button
                                  type="button"
                                  onClick={() => addOption(q.id)}
                                  disabled={(q.options ?? []).length >= 10}
                                  className="inline-flex h-9 items-center justify-center gap-2 rounded-full px-3 text-caption font-medium text-muted-foreground transition-smooth hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                  Add option
                                </button>

                                {qType === "multi_select" && correctCount > 0 && (
                                  <div className="flex items-center gap-2 pt-1">
                                    <Label className="text-caption text-muted-foreground">
                                      Minimum correct to pass
                                    </Label>
                                    <Input
                                      type="number"
                                      min={1}
                                      max={correctCount}
                                      value={q.threshold ?? correctCount}
                                      onChange={(e) =>
                                        updateThreshold(q.id, Math.max(1, parseInt(e.target.value, 10) || 1))
                                      }
                                      className="h-9 w-16 rounded-lg border border-border/40 bg-card px-2 text-body"
                                    />
                                    <span className="text-caption text-muted-foreground">
                                      of {correctCount} correct
                                    </span>
                                  </div>
                                )}
                              </div>
                            )}

                            {questionErrors[q.id] && (
                              <p className="text-caption text-destructive">{questionErrors[q.id]}</p>
                            )}
                          </CardContent>
                        </Card>
                      )}
                    </SortableItem>
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={addQuestion}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-body font-medium text-muted-foreground transition-smooth hover:bg-muted hover:text-foreground active:scale-[0.98]"
              aria-label="Add question"
            >
              <Plus className="h-4 w-4" />
              Add question
            </button>
          </div>
        </div>
        </div>{/* /right panel */}
      </div>{/* /lg:grid */}

      {/* Keyboard shortcut hint footer — mobile only (desktop has scrollable panels) */}
      <div className="fixed bottom-0 left-1/2 z-20 w-full max-w-[440px] -translate-x-1/2 backdrop-blur-xl bg-background/70 border-t border-border/40 safe-bottom lg:hidden">
        <div className="mx-auto max-w-2xl px-5 py-2 text-center text-caption text-muted-foreground">
          Tab: indent · Shift+Tab: outdent · Enter: new item
        </div>
      </div>

      <AlertDialog open={confirmLeaveOpen} onOpenChange={setConfirmLeaveOpen}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Leave with unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Your unsaved edits will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => {
                setConfirmLeaveOpen(false);
                navigate(savedStationId ? `/station/${savedStationId}` : "/my-stations");
              }}
            >
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!sectionPendingDelete}
        onOpenChange={(o) => !o && setSectionPendingDelete(null)}
      >
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this section?</AlertDialogTitle>
            <AlertDialogDescription>
              All items in it will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => {
                if (sectionPendingDelete) removeSection(sectionPendingDelete);
                setSectionPendingDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// 6-dot drag handle (premium iOS-style visual)
function DotsHandle() {
  return (
    <svg
      width="10"
      height="16"
      viewBox="0 0 10 16"
      fill="currentColor"
      aria-hidden
      className="pointer-events-none"
    >
      <circle cx="2" cy="3" r="1.2" />
      <circle cx="8" cy="3" r="1.2" />
      <circle cx="2" cy="8" r="1.2" />
      <circle cx="8" cy="8" r="1.2" />
      <circle cx="2" cy="13" r="1.2" />
      <circle cx="8" cy="13" r="1.2" />
    </svg>
  );
}

// ===================== SORTABLE WRAPPERS =====================

function SortableSection({
  id,
  children,
}: {
  id: string;
  children: (handle: { [key: string]: any }) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  } as React.CSSProperties;
  return (
    <div ref={setNodeRef} style={style}>
      {children({ ...attributes, ...listeners })}
    </div>
  );
}

function SortableItem({
  id,
  children,
}: {
  id: string;
  children: (handle: { [key: string]: any }) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  } as React.CSSProperties;
  return (
    <div ref={setNodeRef} style={style}>
      {children({ ...attributes, ...listeners })}
    </div>
  );
}

// ===================== ITEM ROW =====================

type DrawerKind = "explanation" | "image" | null;

function PillToolbar({
  content,
  active,
  onToggle,
}: {
  content: LearningContent;
  active: DrawerKind;
  onToggle: (kind: Exclude<DrawerKind, null>) => void;
}) {
  const hasMedia = (content.media ?? []).length > 0 || !!content.imageUrl || !!content.videoUrl;
  const pills: Array<{
    kind: Exclude<DrawerKind, null>;
    Icon: typeof BookOpen;
    label: string;
    populated: boolean;
  }> = [
    { kind: "explanation", Icon: BookOpen, label: "Explanation", populated: !!content.explanation?.trim() },
    { kind: "image", Icon: ImageIcon, label: "Media", populated: hasMedia },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {pills.map(({ kind, Icon, label, populated }) => {
        const isActive = active === kind;
        return (
          <button
            key={kind}
            type="button"
            onClick={() => onToggle(kind)}
            aria-pressed={isActive}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-caption font-medium transition-smooth",
              populated
                ? "bg-brand-accent/10 text-brand-accent"
                : "bg-muted/60 text-muted-foreground hover:bg-muted",
              isActive && "ring-2 ring-primary/30"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            {populated && <span className="h-1.5 w-1.5 rounded-full bg-brand-accent" />}
          </button>
        );
      })}
    </div>
  );
}

function ExplanationEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [preview, setPreview] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const wrap = (before: string, after = before) => {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const sel = value.substring(start, end) || "";
    const next = value.substring(0, start) + before + sel + after + value.substring(end);
    const newStart = start + before.length;
    const newEnd = newStart + sel.length;
    onChange(next);
    requestAnimationFrame(() => {
      const node = ref.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(newStart, newEnd);
    });
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => wrap("**")}
          aria-label="Bold"
        >
          <Bold className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => wrap("_")}
          aria-label="Italic"
        >
          <Italic className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => wrap("\n- ", "")}
          aria-label="List"
        >
          <ListIcon className="h-3.5 w-3.5" />
        </Button>
        <div className="ml-auto">
          <button
            type="button"
            onClick={() => setPreview((p) => !p)}
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {preview ? "Edit" : "Preview"}
          </button>
        </div>
      </div>
      {preview ? (
        <div className="prose prose-sm max-w-none rounded-md border border-border/60 bg-muted/20 p-3 text-sm">
          {value || <span className="text-muted-foreground">Nothing to preview.</span>}
        </div>
      ) : (
        <Textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. Look for scapular winging, muscle wasting, deformity."
          className="min-h-[100px] resize-y text-sm"
        />
      )}
    </div>
  );
}

function ImageEditor({
  imageUrl,
  imageCaption,
  onChange,
}: {
  imageUrl: string | null | undefined;
  imageCaption: string | null | undefined;
  onChange: (patch: Partial<LearningContent>) => void;
}) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/uploads/image", { method: "POST", body: fd });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (data?.url) onChange({ imageUrl: data.url });
      else throw new Error("no url");
    } catch {
      toast({
        title: "Upload coming online",
        description: "The image upload service isn't ready yet — try again shortly.",
      });
    }
  };

  if (imageUrl) {
    return (
      <div className="space-y-2">
        <div className="relative aspect-video overflow-hidden rounded-xl border border-border/60 bg-muted/30">
          <img src={imageUrl} alt={imageCaption || ""} className="h-full w-full object-cover" />
        </div>
        <Input
          placeholder="Caption (optional) — e.g. Right shoulder AP view"
          value={imageCaption || ""}
          onChange={(e) => onChange({ imageCaption: e.target.value })}
          className="h-9 text-sm"
        />
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
          >
            Replace
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() => onChange({ imageUrl: null, imageCaption: null })}
          >
            Remove
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
          }}
        />
      </div>
    );
  }

  return (
    <div
      tabIndex={0}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (f) upload(f);
      }}
      onPaste={(e) => {
        const clipItems = Array.from(e.clipboardData?.items || []);
        const imageItem = clipItems.find((i) => i.type.startsWith("image/"));
        if (imageItem) {
          e.preventDefault();
          const file = imageItem.getAsFile();
          if (file) upload(file);
        }
      }}
      onClick={() => inputRef.current?.click()}
      className="flex aspect-video cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-muted/20 text-center text-sm text-muted-foreground transition-smooth hover:border-primary/40 hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary/30"
    >
      <Upload className="mb-2 h-5 w-5" />
      <div>Drop image or tap to upload</div>
      <div className="text-xs">JPG / PNG / WebP, up to 5MB</div>
      <div className="text-xs text-muted-foreground/60 mt-1">or paste from clipboard</div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
        }}
      />
    </div>
  );
}

function getYouTubeId(url: string): string | null {
  const m = url.match(
    /(?:youtu\.be\/|(?:www\.|m\.)?youtube\.com\/(?:watch\?(?:[^&]*&)*v=|embed\/|shorts\/|v\/|live\/))([\w-]{11})/
  );
  return m ? m[1] : null;
}

function getVimeoId(url: string): string | null {
  const m = url.match(/vimeo\.com\/(?:video\/|channels\/[^/]+\/|groups\/[^/]+\/videos\/)?(\d+)/);
  return m ? m[1] : null;
}

function VideoEditor({
  videoUrl,
  onChange,
}: {
  videoUrl: string | null | undefined;
  onChange: (patch: Partial<LearningContent>) => void;
}) {
  const [draft, setDraft] = useState(videoUrl || "");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(videoUrl || ""), [videoUrl]);

  const commit = (val: string) => {
    if (!val.trim()) {
      onChange({ videoUrl: null });
      setError(null);
      return;
    }
    const isYT = !!getYouTubeId(val);
    const isVimeo = !!getVimeoId(val);
    if (!isYT && !isVimeo) {
      setError("Paste a YouTube or Vimeo URL.");
      return;
    }
    setError(null);
    onChange({ videoUrl: val });
  };

  const ytId = videoUrl ? getYouTubeId(videoUrl) : null;
  const isVimeo = videoUrl ? !!getVimeoId(videoUrl) : false;

  return (
    <div className="space-y-2">
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        placeholder="YouTube or Vimeo URL"
        className="h-9 text-sm"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      {videoUrl && (ytId || isVimeo) && (
        <div className="relative aspect-video overflow-hidden rounded-xl border border-border/60 bg-muted/30">
          {ytId ? (
            <img
              src={`https://img.youtube.com/vi/${ytId}/hqdefault.jpg`}
              alt="Video thumbnail"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
              Vimeo video linked
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
            <PlayCircle className="h-10 w-10 text-white/90" />
          </div>
        </div>
      )}
    </div>
  );
}

function SectionToolbar({
  section,
  onUpdate,
}: {
  section: EditorSection;
  onUpdate: (patch: Partial<EditorSection>) => void;
}) {
  const [drawer, setDrawer] = useState<SectionDrawerKind>(null);
  const toggle = (kind: Exclude<SectionDrawerKind, null>) =>
    setDrawer((cur) => (cur === kind ? null : kind));

  const hasImage = !!section.imageUrl;
  const hasDesc = !!section.description?.trim();

  return (
    <div className="px-4 pb-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => toggle("image")}
          aria-pressed={drawer === "image"}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-caption font-medium transition-smooth",
            hasImage
              ? "bg-brand-accent/10 text-brand-accent"
              : "bg-muted/60 text-muted-foreground hover:bg-muted",
            drawer === "image" && "ring-2 ring-primary/30"
          )}
        >
          <ImageIcon className="h-3.5 w-3.5" />
          Image
          {hasImage && <span className="h-1.5 w-1.5 rounded-full bg-brand-accent" />}
        </button>
        <button
          type="button"
          onClick={() => toggle("description")}
          aria-pressed={drawer === "description"}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-caption font-medium transition-smooth",
            hasDesc
              ? "bg-brand-accent/10 text-brand-accent"
              : "bg-muted/60 text-muted-foreground hover:bg-muted",
            drawer === "description" && "ring-2 ring-primary/30"
          )}
        >
          <BookOpen className="h-3.5 w-3.5" />
          Description
          {hasDesc && <span className="h-1.5 w-1.5 rounded-full bg-brand-accent" />}
        </button>
      </div>
      <AnimatePresence initial={false}>
        {drawer === "image" && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-3 rounded-xl bg-muted/30 p-3">
              <ImageEditor
                imageUrl={section.imageUrl}
                imageCaption={section.imageCaption}
                onChange={(patch) => {
                  onUpdate({
                    imageUrl: patch.imageUrl !== undefined ? (patch.imageUrl as string | null) : section.imageUrl,
                    imageCaption: patch.imageCaption !== undefined ? (patch.imageCaption as string | null) : section.imageCaption,
                  });
                }}
              />
            </div>
          </motion.div>
        )}
        {drawer === "description" && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-3">
              <Textarea
                autoFocus
                placeholder="Section description (optional) — e.g. key anatomy references"
                className="min-h-[72px] resize-y rounded-xl border-0 bg-muted/30 px-4 py-3 text-[17px]"
                value={section.description || ""}
                onChange={(e) => onUpdate({ description: e.target.value })}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MultiMediaEditor({
  media,
  onChange,
}: {
  media: MediaEntry[];
  onChange: (media: MediaEntry[]) => void;
}) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadImage = async (file: File) => {
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/uploads/image", { method: "POST", body: fd });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (data?.url) {
        const next = [...media, { type: "image" as const, url: data.url, caption: null, order: media.length }];
        onChange(next);
      } else throw new Error("no url");
    } catch {
      toast({
        title: "Upload coming online",
        description: "The image upload service isn't ready yet — try again shortly.",
      });
    }
  };

  const images = media.filter((m) => m.type === "image");
  const videos = media.filter((m) => m.type === "video");

  const removeMedia = (url: string) => {
    onChange(media.filter((m) => m.url !== url).map((m, i) => ({ ...m, order: i })));
  };

  const updateCaption = (url: string, caption: string) => {
    onChange(media.map((m) => m.url === url ? { ...m, caption } : m));
  };

  return (
    <div className="space-y-3">
      {/* Images grid */}
      {images.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {images.map((img) => (
            <div key={img.url} className="group relative">
              <div className="aspect-video overflow-hidden rounded-lg border border-border/60 bg-muted/30">
                <img src={img.url} alt={img.caption || ""} className="h-full w-full object-cover" />
              </div>
              <button
                type="button"
                onClick={() => removeMedia(img.url)}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-white opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Remove image"
              >
                <X className="h-3 w-3" />
              </button>
              <Input
                placeholder="Caption"
                value={img.caption || ""}
                onChange={(e) => updateCaption(img.url, e.target.value)}
                className="mt-1 h-7 text-xs"
              />
            </div>
          ))}
        </div>
      )}

      {/* Add image */}
      <div
        tabIndex={0}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) uploadImage(f);
        }}
        onPaste={(e) => {
          const clipItems = Array.from(e.clipboardData?.items || []);
          const imageItem = clipItems.find((i) => i.type.startsWith("image/"));
          if (imageItem) {
            e.preventDefault();
            const file = imageItem.getAsFile();
            if (file) uploadImage(file);
          }
        }}
        onClick={() => inputRef.current?.click()}
        className="flex h-20 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-muted/20 text-center text-xs text-muted-foreground transition-smooth hover:border-primary/40 hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary/30"
      >
        <Plus className="mb-1 h-4 w-4" />
        <div>Add image</div>
        <div className="text-[10px] text-muted-foreground/60">or paste from clipboard</div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadImage(f);
          }}
        />
      </div>

      {/* Videos */}
      {videos.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {videos.map((vid) => {
            const parsed = parseVideoUrl(vid.url);
            const platformLabel =
              parsed.platform === "youtube"
                ? "YouTube"
                : parsed.platform === "vimeo"
                  ? "Vimeo"
                  : "Video";
            return (
              <div key={vid.url} className="group relative">
                <div className="relative aspect-video overflow-hidden rounded-lg border border-border/60 bg-muted/30">
                  {parsed.thumbnailUrl ? (
                    <img
                      src={parsed.thumbnailUrl}
                      alt={vid.caption || `${platformLabel} video`}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center">
                      <PlayCircle className="h-7 w-7 text-muted-foreground" />
                      <div className="text-[10px] font-medium text-muted-foreground">
                        {platformLabel}
                      </div>
                      <div className="line-clamp-2 w-full break-all text-[9px] text-muted-foreground/70">
                        {vid.url}
                      </div>
                    </div>
                  )}
                  {parsed.thumbnailUrl && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
                      <PlayCircle className="h-9 w-9 text-white/90 drop-shadow" />
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removeMedia(vid.url)}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Remove video"
                >
                  <X className="h-3 w-3" />
                </button>
                <Input
                  placeholder="Caption"
                  value={vid.caption || ""}
                  onChange={(e) => updateCaption(vid.url, e.target.value)}
                  className="mt-1 h-7 text-xs"
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Add video URL */}
      <AddVideoInput
        onAdd={(url) => {
          const next = [...media, { type: "video" as const, url, caption: null, order: media.length }];
          onChange(next);
        }}
      />
    </div>
  );
}

function AddVideoInput({ onAdd }: { onAdd: (url: string) => void }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const commit = () => {
    if (!draft.trim()) return;
    const ytMatch = draft.match(
      /(?:youtu\.be\/|(?:www\.|m\.)?youtube\.com\/(?:watch\?(?:[^&]*&)*v=|embed\/|shorts\/|v\/|live\/))([\w-]{11})/
    );
    const vimeoMatch = draft.match(/vimeo\.com\/(?:video\/|channels\/[^/]+\/|groups\/[^/]+\/videos\/)?(\d+)/);
    if (!ytMatch && !vimeoMatch) {
      setError("Paste a YouTube or Vimeo URL.");
      return;
    }
    setError(null);
    onAdd(draft.trim());
    setDraft("");
  };

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
          placeholder="Add video URL (YouTube/Vimeo)"
          className="h-8 text-xs flex-1"
        />
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={commit}>
          Add
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function DrawerPanel({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
          className="overflow-hidden"
        >
          <div className="mt-2 rounded-xl bg-muted/30 p-3">
            {children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ItemRow({
  item,
  itemIndex,
  dragHandle,
  onTextChange,
  onContentChange,
  onDelete,
  onIndent,
  onAddSubItem,
  onKeyDown,
  sensors,
  onReorderSubItems,
  onSubItemTextChange,
  onSubItemContentChange,
  onSubItemDelete,
  onSubItemOutdent,
  onSubItemIndent,
  onAddSubSubItem,
  onSubSubItemTextChange,
  onSubSubItemContentChange,
  onSubSubItemDelete,
  onSubSubItemOutdent,
  onReorderSubSubItems,
}: {
  item: EditorItem;
  itemIndex: number;
  isLast: boolean;
  dragHandle: { [key: string]: any };
  onTextChange: (t: string) => void;
  onContentChange: (patch: Partial<LearningContent>) => void;
  onDelete: () => void;
  onIndent: () => void;
  onAddSubItem: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  sensors: ReturnType<typeof useSensors>;
  onReorderSubItems: (activeId: string, overId: string) => void;
  onSubItemTextChange: (subId: string, t: string) => void;
  onSubItemContentChange: (subId: string, patch: Partial<LearningContent>) => void;
  onSubItemDelete: (subId: string) => void;
  onSubItemOutdent: (subId: string) => void;
  onSubItemIndent: (subId: string) => void;
  onAddSubSubItem: (subId: string) => void;
  onSubSubItemTextChange: (subId: string, ssubId: string, t: string) => void;
  onSubSubItemContentChange: (subId: string, ssubId: string, patch: Partial<LearningContent>) => void;
  onSubSubItemDelete: (subId: string, ssubId: string) => void;
  onSubSubItemOutdent: (subId: string, ssubId: string) => void;
  onReorderSubSubItems: (
    subId: string,
    activeId: string,
    overId: string,
  ) => void;
}) {
  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const toggle = (kind: Exclude<DrawerKind, null>) =>
    setDrawer((cur) => (cur === kind ? null : kind));

  return (
    <div data-item className="group relative rounded-xl bg-transparent px-2 py-1 transition-colors hover:bg-muted/30">
      <div className="flex min-h-[44px] items-start gap-2">
        <button
          type="button"
          className="mt-2 flex h-7 w-6 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground/40 opacity-0 transition-opacity hover:text-muted-foreground group-hover:opacity-100 group-focus-within:opacity-100 active:cursor-grabbing"
          aria-label="Drag item"
          {...dragHandle}
        >
          <DotsHandle />
        </button>
        <div className="flex-1 space-y-2 py-1">
          <Input
            placeholder="Checklist item..."
            value={item.text}
            onChange={(e) => onTextChange(e.target.value)}
            onKeyDown={onKeyDown}
            className="h-9 border-0 bg-transparent px-0 text-body font-medium text-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0"
          />
          <PillToolbar content={item} active={drawer} onToggle={toggle} />
          <DrawerPanel open={drawer === "explanation"}>
            <ExplanationEditor
              value={item.explanation || ""}
              onChange={(v) => onContentChange({ explanation: v })}
            />
          </DrawerPanel>
          <DrawerPanel open={drawer === "image"}>
            <MultiMediaEditor
              media={item.media ?? []}
              onChange={(nextMedia) => onContentChange({ media: nextMedia })}
            />
          </DrawerPanel>

          {/* Sub-items — 20px left padding + vertical guide line */}
          {item.subItems.length > 0 && (
            <div className="mt-1 space-y-1 border-l border-border/60 pl-5">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(e: DragEndEvent) => {
                  const dx = e.delta?.x ?? 0;
                  const dy = e.delta?.y ?? 0;
                  const activeId = String(e.active.id);
                  // Re-level only when the drag was primarily horizontal;
                  // otherwise treat as a vertical reorder. Avoids the
                  // "I tried to drag down and it outdented" footgun.
                  const isRelevel =
                    Math.abs(dx) > Math.abs(dy) &&
                    Math.abs(dx) >= INDENT_THRESHOLD_PX;
                  if (isRelevel) {
                    if (dx >= INDENT_THRESHOLD_PX) {
                      setTimeout(() => onSubItemIndent(activeId), 0);
                    } else if (dx <= -INDENT_THRESHOLD_PX) {
                      setTimeout(() => onSubItemOutdent(activeId), 0);
                    }
                    return;
                  }
                  if (e.over && e.active.id !== e.over.id) {
                    onReorderSubItems(activeId, String(e.over.id));
                  }
                }}
              >
                <SortableContext
                  items={item.subItems.map((s) => s.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {item.subItems.map((sub) => (
                    <SortableItem key={sub.id} id={sub.id}>
                      {(handle) => (
                        <SubItemRow
                          sub={sub}
                          dragHandle={handle}
                          sensors={sensors}
                          onTextChange={(t) => onSubItemTextChange(sub.id, t)}
                          onContentChange={(patch) => onSubItemContentChange(sub.id, patch)}
                          onDelete={() => onSubItemDelete(sub.id)}
                          onOutdent={() => onSubItemOutdent(sub.id)}
                          onAddSubSubItem={() => onAddSubSubItem(sub.id)}
                          onSubSubItemTextChange={(ssubId, t) => onSubSubItemTextChange(sub.id, ssubId, t)}
                          onSubSubItemContentChange={(ssubId, patch) => onSubSubItemContentChange(sub.id, ssubId, patch)}
                          onSubSubItemDelete={(ssubId) => onSubSubItemDelete(sub.id, ssubId)}
                          onSubSubItemOutdent={(ssubId) => onSubSubItemOutdent(sub.id, ssubId)}
                          onReorderSubSubItems={(activeId, overId) =>
                            onReorderSubSubItems(sub.id, activeId, overId)
                          }
                        />
                      )}
                    </SortableItem>
                  ))}
                </SortableContext>
              </DndContext>
            </div>
          )}

          {/* Add sub-item ghost */}
          <button
            type="button"
            onClick={onAddSubItem}
            className={cn(
              "flex h-9 w-full items-center justify-start gap-2 rounded-lg px-1 text-caption font-medium text-muted-foreground/70 transition-smooth hover:text-foreground",
              item.subItems.length > 0 && "ml-5 w-[calc(100%-1.25rem)]"
            )}
            aria-label="Add sub-item"
          >
            <Plus className="h-3.5 w-3.5" />
            Add sub-item
          </button>

          {/* Delete inside drawer footer when any drawer is open */}
          {drawer && (
            <div className="mt-2 flex justify-end border-t border-border/40 pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDelete(true)}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Delete item
              </Button>
            </div>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="mt-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Item options"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="rounded-2xl shadow-lg">
            {itemIndex > 0 && (
              <DropdownMenuItem className="h-9" onSelect={onIndent}>
                Make sub-item
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className="h-9" onSelect={onAddSubItem}>
              Add sub-item
            </DropdownMenuItem>
            <DropdownMenuItem
              className="h-9 text-destructive focus:text-destructive"
              onSelect={() => setConfirmDelete(true)}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this item?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the item and any sub-items, explanations, images and videos attached.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={onDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SubItemRow({
  sub,
  dragHandle,
  sensors,
  onTextChange,
  onContentChange,
  onDelete,
  onOutdent,
  onAddSubSubItem,
  onSubSubItemTextChange,
  onSubSubItemContentChange,
  onSubSubItemDelete,
  onSubSubItemOutdent,
  onReorderSubSubItems,
}: {
  sub: EditorSubItem;
  dragHandle: { [key: string]: any };
  sensors: ReturnType<typeof useSensors>;
  onTextChange: (t: string) => void;
  onContentChange: (patch: Partial<LearningContent>) => void;
  onDelete: () => void;
  onOutdent: () => void;
  onAddSubSubItem: () => void;
  onSubSubItemTextChange: (ssubId: string, t: string) => void;
  onSubSubItemContentChange: (ssubId: string, patch: Partial<LearningContent>) => void;
  onSubSubItemDelete: (ssubId: string) => void;
  onSubSubItemOutdent: (ssubId: string) => void;
  onReorderSubSubItems: (activeId: string, overId: string) => void;
}) {
  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const toggle = (kind: Exclude<DrawerKind, null>) =>
    setDrawer((cur) => (cur === kind ? null : kind));

  const handleSubItemKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      onOutdent();
    }
  };

  return (
    <div className="group rounded-lg px-2 py-1 transition-colors hover:bg-muted/30">
      <div className="flex min-h-[44px] items-start gap-2">
        <button
          type="button"
          className="mt-1.5 flex h-7 w-6 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground/40 opacity-0 transition-opacity hover:text-muted-foreground group-hover:opacity-100 group-focus-within:opacity-100 active:cursor-grabbing"
          aria-label="Drag sub-item"
          {...dragHandle}
        >
          <DotsHandle />
        </button>
        <div className="flex-1 space-y-2 py-1">
          <div className="flex items-center gap-1">
            <Input
              placeholder="Sub-item..."
              value={sub.text}
              onChange={(e) => onTextChange(e.target.value)}
              onKeyDown={handleSubItemKeyDown}
              className="h-8 border-0 bg-transparent px-0 text-body text-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0"
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Sub-item options"
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="rounded-2xl shadow-lg">
                <DropdownMenuItem className="h-9" onSelect={onAddSubSubItem}>
                  Add sub-sub-item
                </DropdownMenuItem>
                <DropdownMenuItem className="h-9" onSelect={onOutdent}>
                  Make item
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="h-9 text-destructive focus:text-destructive"
                  onSelect={onDelete}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <PillToolbar content={sub} active={drawer} onToggle={toggle} />
          <DrawerPanel open={drawer === "explanation"}>
            <ExplanationEditor
              value={sub.explanation || ""}
              onChange={(v) => onContentChange({ explanation: v })}
            />
          </DrawerPanel>
          <DrawerPanel open={drawer === "image"}>
            <MultiMediaEditor
              media={sub.media ?? []}
              onChange={(nextMedia) => onContentChange({ media: nextMedia })}
            />
          </DrawerPanel>

          {/* Sub-sub-items — 20px indent + vertical guide line */}
          {sub.subItems && sub.subItems.length > 0 && (
            <div className="mt-1 space-y-1 border-l border-border/60 pl-5">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(e: DragEndEvent) => {
                  const dx = e.delta?.x ?? 0;
                  const dy = e.delta?.y ?? 0;
                  const activeId = String(e.active.id);
                  // Re-level only when drag was primarily horizontal AND
                  // beyond the threshold; otherwise reorder within the
                  // sub-item's children. There is no further depth, so
                  // dx >= +threshold is a no-op (can't go deeper).
                  const isOutdent =
                    Math.abs(dx) > Math.abs(dy) &&
                    dx <= -INDENT_THRESHOLD_PX;
                  if (isOutdent) {
                    setTimeout(() => onSubSubItemOutdent(activeId), 0);
                    return;
                  }
                  if (e.over && e.active.id !== e.over.id) {
                    onReorderSubSubItems(activeId, String(e.over.id));
                  }
                }}
              >
                <SortableContext
                  items={sub.subItems.map((s) => s.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {sub.subItems.map((ssub) => (
                    <SortableItem key={ssub.id} id={ssub.id}>
                      {(ssHandle) => (
                        <SubSubItemRow
                          subSubItem={ssub}
                          dragHandle={ssHandle}
                          onTextChange={(t) => onSubSubItemTextChange(ssub.id, t)}
                          onContentChange={(patch) => onSubSubItemContentChange(ssub.id, patch)}
                          onDelete={() => onSubSubItemDelete(ssub.id)}
                          onOutdent={() => onSubSubItemOutdent(ssub.id)}
                        />
                      )}
                    </SortableItem>
                  ))}
                </SortableContext>
              </DndContext>
            </div>
          )}

          {/* Add sub-sub-item button */}
          <button
            type="button"
            onClick={onAddSubSubItem}
            className={cn(
              "flex h-8 w-full items-center justify-start gap-1.5 rounded-lg px-1 text-caption font-medium text-muted-foreground/70 transition-smooth hover:text-foreground",
              sub.subItems && sub.subItems.length > 0 && "ml-5 w-[calc(100%-1.25rem)]"
            )}
            aria-label="Add sub-sub-item"
          >
            <Plus className="h-3 w-3" />
            Add sub-sub-item
          </button>

          {drawer && (
            <div className="flex justify-end border-t border-border/40 pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onDelete}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Delete sub-item
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SubSubItemRow({
  subSubItem,
  dragHandle,
  onTextChange,
  onContentChange,
  onDelete,
  onOutdent,
}: {
  subSubItem: EditorSubSubItem;
  dragHandle?: { [key: string]: any };
  onTextChange: (t: string) => void;
  onContentChange: (patch: Partial<LearningContent>) => void;
  onDelete: () => void;
  onOutdent?: () => void;
}) {
  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const toggle = (kind: Exclude<DrawerKind, null>) =>
    setDrawer((cur) => (cur === kind ? null : kind));
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Tab" && e.shiftKey && onOutdent) {
      e.preventDefault();
      onOutdent();
    }
  };
  return (
    <div className="group rounded-lg px-1.5 py-1 transition-colors hover:bg-muted/30">
      <div className="flex min-h-[40px] items-start gap-1.5">
        {dragHandle && (
          <button
            type="button"
            className="mt-1.5 flex h-6 w-6 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground/30 opacity-0 transition-opacity hover:text-muted-foreground group-hover:opacity-100 group-focus-within:opacity-100 active:cursor-grabbing"
            aria-label="Drag sub-sub-item (drag left to outdent)"
            {...dragHandle}
          >
            <DotsHandle />
          </button>
        )}
        <div className="flex-1 space-y-1.5 py-1">
          <div className="flex items-center gap-1">
            <Input
              placeholder="Sub-sub-item..."
              value={subSubItem.text}
              onChange={(e) => onTextChange(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-7 border-0 bg-transparent px-0 text-caption text-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0"
            />
            <button
              type="button"
              onClick={onDelete}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/40 transition-colors hover:bg-muted hover:text-destructive"
              aria-label="Delete sub-sub-item"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <PillToolbar content={subSubItem} active={drawer} onToggle={toggle} />
          <DrawerPanel open={drawer === "explanation"}>
            <ExplanationEditor
              value={subSubItem.explanation || ""}
              onChange={(v) => onContentChange({ explanation: v })}
            />
          </DrawerPanel>
          <DrawerPanel open={drawer === "image"}>
            <MultiMediaEditor
              media={(subSubItem as any).media ?? []}
              onChange={(nextMedia) => onContentChange({ media: nextMedia })}
            />
          </DrawerPanel>
        </div>
      </div>
    </div>
  );
}

function SaveStatusChip({
  dirty,
  saving,
  lastSavedAt,
  onClick,
}: {
  dirty: boolean;
  saving: boolean;
  lastSavedAt: number | null;
  onClick?: () => void;
}) {
  // Show the "Saved ✓" confirmation for ~2s after lastSavedAt changes,
  // then fade back to the idle "Save" button.
  const [showSaved, setShowSaved] = useState(false);
  useEffect(() => {
    if (!lastSavedAt) return;
    setShowSaved(true);
    const t = setTimeout(() => setShowSaved(false), 2000);
    return () => clearTimeout(t);
  }, [lastSavedAt]);

  // Three visible states (saving is a transient flight state):
  //   1) saving  → spinner + "Saving…", disabled, muted
  //   2) saved   → Check + "Saved", success surface (only when not dirty)
  //   3) default → Save icon + "Save", primary tint (amber dot when dirty)
  const state: "saving" | "saved" | "default" = saving
    ? "saving"
    : !dirty && showSaved
      ? "saved"
      : "default";

  const label = state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Save";
  const ariaLabel = dirty ? "Save station" : label;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={saving}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-caption font-semibold transition-smooth active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        state === "saving"
          ? "bg-muted text-muted-foreground cursor-default"
          : state === "saved"
            ? "bg-success-surface text-success"
            : "bg-primary text-primary-foreground hover:bg-primary/90"
      )}
    >
      {state === "saving" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      ) : state === "saved" ? (
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <>
          {dirty && (
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full bg-brand-accent"
            />
          )}
          <Save className="h-3.5 w-3.5" aria-hidden="true" />
        </>
      )}
      <span>{label}</span>
    </button>
  );
}
