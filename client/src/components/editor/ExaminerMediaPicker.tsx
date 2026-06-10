import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import type { ExaminerMediaEntry, ExaminerMediaVisibility } from "@/pages/StationEditorPage";

interface Props {
  media: ExaminerMediaEntry[];
  onChange: (media: ExaminerMediaEntry[]) => void;
  /**
   * Default visibility applied to newly-uploaded images. Question-phase
   * pickers default to "exam"; explanation-phase pickers default to
   * "study". The author can flip per-image after upload.
   */
  defaultVisibility: ExaminerMediaVisibility;
  /** Compact label rendered above the picker (e.g. "Question images"). */
  label?: string;
  /** Empty-state copy (e.g. "Add an X-ray learners should see"). */
  emptyHint?: string;
}

const VISIBILITY_OPTIONS: {
  value: ExaminerMediaVisibility;
  label: string;
  description: string;
}[] = [
  {
    value: "exam",
    label: "Exam",
    description: "Shown to the learner during the examination phase.",
  },
  {
    value: "study",
    label: "Study only",
    description: "Hidden during the exam; only shown in study / review.",
  },
  {
    value: "both",
    label: "Both",
    description: "Always shown.",
  },
];

/**
 * Multi-image picker for examiner questions. Reads exactly like the
 * checklist-item MediaPicker, but each image carries an extra per-entry
 * visibility selector so the author can decide whether the image is
 * shown during the examination, in study/review only, or both.
 *
 * Defends against the stale-closure race that affected the original
 * item MediaPicker: async uploads read from a ref so back-to-back
 * uploads don't overwrite each other.
 */
export function ExaminerMediaPicker({
  media,
  onChange,
  defaultVisibility,
  label,
  emptyHint,
}: Props) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  // Latest media ref so async uploads see prior uploads even if the
  // parent re-render hasn't propagated yet.
  const mediaRef = useRef(media);
  mediaRef.current = media;

  const uploadImage = async (file: File) => {
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/uploads/image", { method: "POST", body: fd });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (!data?.url) throw new Error("no url");
      const current = mediaRef.current;
      const next: ExaminerMediaEntry[] = [
        ...current,
        {
          type: "image",
          url: data.url,
          caption: null,
          order: current.length,
          visibility: defaultVisibility,
        },
      ];
      mediaRef.current = next;
      onChange(next);
    } catch {
      toast({
        title: "Upload coming online",
        description: "The image upload service isn't ready yet — try again shortly.",
      });
    }
  };

  const removeAt = (idx: number) => {
    onChange(
      media
        .filter((_, i) => i !== idx)
        .map((m, i) => ({ ...m, order: i })),
    );
  };

  const updateCaption = (idx: number, caption: string) => {
    onChange(media.map((m, i) => (i === idx ? { ...m, caption } : m)));
  };

  const updateVisibility = (idx: number, visibility: ExaminerMediaVisibility) => {
    onChange(media.map((m, i) => (i === idx ? { ...m, visibility } : m)));
  };

  // Video URL input. Same YouTube / Vimeo accept set as the checklist
  // MediaPicker.AddVideoInput — kept synchronous so it can't race the
  // image upload's ref pattern.
  const [videoDraft, setVideoDraft] = useState("");
  const [videoError, setVideoError] = useState<string | null>(null);
  const commitVideo = () => {
    const url = videoDraft.trim();
    if (!url) return;
    const yt = url.match(
      /(?:youtu\.be\/|(?:www\.|m\.)?youtube\.com\/(?:watch\?(?:[^&]*&)*v=|embed\/|shorts\/|v\/|live\/))([\w-]{11})/,
    );
    const vimeo = url.match(
      /vimeo\.com\/(?:video\/|channels\/[^/]+\/|groups\/[^/]+\/videos\/)?(\d+)/,
    );
    if (!yt && !vimeo) {
      setVideoError("Paste a YouTube or Vimeo URL.");
      return;
    }
    setVideoError(null);
    const current = mediaRef.current;
    const next: ExaminerMediaEntry[] = [
      ...current,
      {
        type: "video",
        url,
        caption: null,
        order: current.length,
        visibility: defaultVisibility,
      },
    ];
    mediaRef.current = next;
    onChange(next);
    setVideoDraft("");
  };

  const images = media
    .map((m, i) => ({ ...m, _i: i }))
    .filter((m) => m.type === "image");
  const videos = media
    .map((m, i) => ({ ...m, _i: i }))
    .filter((m) => m.type === "video");

  return (
    <div className="space-y-2">
      {label && (
        <p className="text-caption font-medium text-foreground">{label}</p>
      )}

      {images.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {images.map((m) => {
            const i = m._i;
            return (
            <div key={`${m.url}-${i}`} className="group relative">
              <div className="aspect-video overflow-hidden rounded-lg border border-border/60 bg-muted/30">
                <img
                  src={m.url}
                  alt={m.caption ?? ""}
                  className="h-full w-full object-cover"
                />
              </div>
              <button
                type="button"
                onClick={() => removeAt(i)}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-white opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Remove image"
              >
                <X className="h-3 w-3" />
              </button>
              <Input
                placeholder="Caption"
                value={m.caption ?? ""}
                onChange={(e) => updateCaption(i, e.target.value)}
                className="mt-1 h-7 text-xs"
              />
              {/* Visibility selector — segmented pill so the author can
                  see all three options at a glance. */}
              <div className="mt-1.5 flex overflow-hidden rounded-md border border-border/60 text-[10px]">
                {VISIBILITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => updateVisibility(i, opt.value)}
                    title={opt.description}
                    className={cn(
                      "flex-1 px-1.5 py-1 transition-colors",
                      m.visibility === opt.value
                        ? "bg-primary text-primary-foreground"
                        : "bg-card text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            );
          })}
        </div>
      )}

      {videos.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {videos.map((m) => {
            const i = m._i;
            return (
              <div key={`${m.url}-${i}`} className="group relative">
                <div className="flex aspect-video items-center justify-center rounded-lg border border-border/60 bg-muted/30 px-2 text-center text-[10px] text-muted-foreground">
                  <span className="line-clamp-3 break-words">{m.url}</span>
                </div>
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Remove video"
                >
                  <X className="h-3 w-3" />
                </button>
                <Input
                  placeholder="Caption"
                  value={m.caption ?? ""}
                  onChange={(e) => updateCaption(i, e.target.value)}
                  className="mt-1 h-7 text-xs"
                />
                <div className="mt-1.5 flex overflow-hidden rounded-md border border-border/60 text-[10px]">
                  {VISIBILITY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => updateVisibility(i, opt.value)}
                      title={opt.description}
                      className={cn(
                        "flex-1 px-1.5 py-1 transition-colors",
                        m.visibility === opt.value
                          ? "bg-primary text-primary-foreground"
                          : "bg-card text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div
        tabIndex={0}
        onDragOver={(e) => e.preventDefault()}
        onDrop={async (e) => {
          e.preventDefault();
          const files = Array.from(e.dataTransfer.files ?? []);
          for (const f of files) await uploadImage(f);
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
        className="flex h-16 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-muted/20 text-center text-xs text-muted-foreground transition-smooth hover:border-primary/40 hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary/30"
      >
        <Plus className="mb-0.5 h-4 w-4" />
        <div>{media.length === 0 ? (emptyHint ?? "Add image") : "Add another"}</div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []);
            for (const f of files) await uploadImage(f);
            e.target.value = "";
          }}
        />
      </div>

      {/* Video URL input — YouTube / Vimeo. Same default visibility flag
          is applied to the new row as for uploaded images. */}
      <div className="space-y-1">
        <div className="flex gap-2">
          <Input
            value={videoDraft}
            onChange={(e) => {
              setVideoDraft(e.target.value);
              setVideoError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitVideo();
              }
            }}
            placeholder="Add video URL (YouTube/Vimeo)"
            className="h-8 flex-1 text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={commitVideo}
          >
            Add
          </Button>
        </div>
        {videoError && <p className="text-xs text-destructive">{videoError}</p>}
      </div>
    </div>
  );
}
