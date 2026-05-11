import { useMemo, useState } from "react";
import { useParams, useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  Edit,
  Play,
  Trash2,
  AlertTriangle,
  MoreVertical,
  ChevronDown,
  Maximize2,
  Globe2,
  Copy,
  Flag,
  Eye,
  EyeOff,
  Check,
  ListChecks,
  CircleDot,
  CheckSquare,
  Type as TypeIcon,
} from "lucide-react";

import { useStation, useDeleteStation } from "@/hooks/use-stations";
import { useAuth } from "@/hooks/use-auth";
import { useUnpublishStation } from "@/hooks/use-publish";
import { stationTypeLabel, cn } from "@/lib/utils";
import { safeFrom } from "@/lib/navigation";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useToast } from "@/components/ui/use-toast";

import { PracticeModeSheet } from "@/components/practice/PracticeModeSheet";
import { VideoEmbed } from "@/components/VideoEmbed";
import { MediaLightbox } from "@/components/MediaLightbox";
import { PublishDialog } from "@/components/library/PublishDialog";
import { ReportDialog } from "@/components/library/ReportDialog";
import { StarButton } from "@/components/library/StarButton";
import { ForkButton } from "@/components/library/ForkButton";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Lightbox {
  src: string;
  alt?: string;
  caption?: string | null;
}

// Pull all images and videos out of an item, merging its legacy single
// imageUrl / videoUrl fields with the newer `media` relation.
function collectItemMedia(item: any): {
  images: Array<{ url: string; caption?: string | null }>;
  videos: Array<{ url: string; caption?: string | null }>;
} {
  const images: Array<{ url: string; caption?: string | null }> = [];
  const videos: Array<{ url: string; caption?: string | null }> = [];
  const media = Array.isArray(item?.media) ? [...item.media] : [];
  media.sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));

  for (const m of media) {
    if (!m?.url) continue;
    if (m.type === "image") images.push({ url: m.url, caption: m.caption });
    else if (m.type === "video") videos.push({ url: m.url, caption: m.caption });
  }

  // Legacy fields — only include if not already present in media array.
  if (item?.imageUrl && !images.some((i) => i.url === item.imageUrl)) {
    images.unshift({ url: item.imageUrl, caption: item.imageCaption ?? null });
  }
  if (item?.videoUrl && !videos.some((v) => v.url === item.videoUrl)) {
    videos.push({ url: item.videoUrl, caption: null });
  }
  return { images, videos };
}

// ---------------------------------------------------------------------------
// Zoomable image thumb
// ---------------------------------------------------------------------------

function ZoomableImage({
  url,
  caption,
  alt,
  onOpen,
  className,
  aspectClass = "aspect-[16/10]",
}: {
  url: string;
  caption?: string | null;
  alt?: string;
  onOpen: (lb: Lightbox) => void;
  className?: string;
  aspectClass?: string;
}) {
  return (
    <figure className={cn("space-y-1.5", className)}>
      <button
        type="button"
        onClick={() => onOpen({ src: url, alt: alt || caption || "", caption })}
        className={cn(
          "group relative block w-full overflow-hidden rounded-xl border border-border/60 bg-warm-100",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2",
        )}
        aria-label={caption ? `Open image: ${caption}` : "Open image"}
      >
        <div className={aspectClass}>
          <img
            src={url}
            alt={alt || caption || ""}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        </div>
        <span
          className="pointer-events-none absolute right-2 top-2 hidden h-7 w-7 items-center justify-center rounded-full bg-black/45 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:hover)]:flex"
          aria-hidden
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </span>
      </button>
      {caption && (
        <figcaption className="text-caption text-muted-foreground">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Item row (recursive — renders item + subItems)
// ---------------------------------------------------------------------------

interface ItemRowProps {
  item: any;
  depth: number;
  index: number;
  openLightbox: (lb: Lightbox) => void;
}

function ItemRow({ item, depth, index, openLightbox }: ItemRowProps) {
  const { images, videos } = collectItemMedia(item);
  const hasExplanation = !!(item.explanation && item.explanation.trim());
  const hasDetail = hasExplanation || images.length > 0 || videos.length > 0;

  const children = (item.subItems ?? []) as any[];
  const sortedChildren = [...children].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );

  return (
    <li
      className={cn(
        "group/item",
        depth === 0 && "border-b border-border/40 last:border-b-0",
      )}
    >
      <div
        className={cn(
          "flex items-start gap-3 py-3",
          depth === 1 && "pl-5",
          depth === 2 && "pl-10",
        )}
      >
        {/* Number / bullet */}
        <span
          className={cn(
            "mt-[3px] shrink-0 select-none tabular-nums",
            depth === 0 && "text-caption text-muted-foreground",
            depth === 1 && "text-caption text-muted-foreground/80",
            depth === 2 && "text-caption text-muted-foreground/60",
          )}
          aria-hidden
        >
          {depth === 0 ? `${index + 1}.` : depth === 1 ? "–" : "·"}
        </span>

        {/* Body */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p
              className={cn(
                "min-w-0",
                depth === 0 && "text-body text-foreground",
                depth === 1 && "text-body text-foreground/90",
                depth === 2 && "text-caption text-muted-foreground",
              )}
            >
              {item.text}
            </p>

            {item.isCritical && (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-accent/10 px-2 py-0.5 text-label text-brand-accent"
                aria-label="Critical item"
              >
                <AlertTriangle className="h-3 w-3" />
                Critical
              </span>
            )}
          </div>

          {/* Detail: explanation + media, always inline (study surface). */}
          {hasDetail && (
            <div className="mt-3 space-y-3">
              {hasExplanation && (
                <div className="rounded-xl bg-warm-100/60 p-4">
                  <p className="whitespace-pre-wrap text-caption text-warm-800">
                    {item.explanation}
                  </p>
                </div>
              )}

              {images.length > 0 && (
                <div
                  className={cn(
                    "grid gap-2",
                    images.length === 1 ? "grid-cols-1" : "grid-cols-2",
                  )}
                >
                  {images.map((img, i) => (
                    <ZoomableImage
                      key={`${img.url}-${i}`}
                      url={img.url}
                      caption={img.caption}
                      alt={item.text}
                      onOpen={openLightbox}
                      aspectClass={
                        images.length === 1 ? "aspect-[16/10]" : "aspect-square"
                      }
                    />
                  ))}
                </div>
              )}

              {videos.length > 0 && (
                <div className="space-y-2">
                  {videos.map((vid, i) => (
                    <figure key={`${vid.url}-${i}`} className="space-y-1.5">
                      <VideoEmbed url={vid.url} title={item.text} />
                      {vid.caption && (
                        <figcaption className="text-xs text-muted-foreground">
                          {vid.caption}
                        </figcaption>
                      )}
                    </figure>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Sub-items */}
          {sortedChildren.length > 0 && (
            <ul className="mt-1 border-l border-border/50 pl-0">
              {sortedChildren.map((child, ci) => (
                <ItemRow
                  key={child.id}
                  item={child}
                  depth={depth + 1}
                  index={ci}
                  openLightbox={openLightbox}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function StationDetailPage() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { data: station, isLoading, error } = useStation(params.id);
  const deleteStation = useDeleteStation();
  const unpublishStation = useUnpublishStation();
  const { user } = useAuth();
  const { toast } = useToast();

  // Per-Q hide overrides. Default behavior is "answers visible by default";
  // the user can hide individual answers or use the section-wide toggle.
  // True in this map = explicitly hidden for that Q.
  const [hiddenAnswers, setHiddenAnswers] = useState<Record<number, boolean>>({});
  const [hideAllAnswers, setHideAllAnswers] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showPracticeSheet, setShowPracticeSheet] = useState(false);
  const [showBriefing, setShowBriefing] = useState(false);
  const [lightbox, setLightbox] = useState<Lightbox | null>(null);
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [showReportDialog, setShowReportDialog] = useState(false);

  const fromParam =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("from")
      : null;

  const handleDelete = async () => {
    try {
      await deleteStation.mutateAsync(Number(params.id));
      toast({ title: "Station deleted" });
      navigate("/my-stations");
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  };

  const handleCopyPublicLink = async () => {
    if (!station) return;
    const url = `${window.location.origin}/library/stations/${station.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied" });
    } catch {
      toast({ title: "Couldn't copy link", variant: "warning" });
    }
  };

  const handleUnpublish = async () => {
    if (!station) return;
    try {
      await unpublishStation.mutateAsync(station.id);
      toast({
        title: "Unpublished",
        description: "No longer visible in the community library.",
      });
    } catch (err) {
      const msg = (err as Error).message.replace(/^\d+:\s*/, "");
      toast({
        title: "Couldn't unpublish",
        description: msg,
        variant: "destructive",
      });
    }
  };

  const totalItems = useMemo(() => {
    if (!station) return 0;
    return station.sections.reduce(
      (acc, s) =>
        acc +
        s.items.filter((i: any) => !i.parentItemId).length +
        s.items.reduce(
          (a: number, i: any) => a + (i.subItems?.length || 0),
          0,
        ),
      0,
    );
  }, [station]);

  // -----------------------------------------------------------------------
  // Loading
  // -----------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-[440px] lg:max-w-3xl px-5 py-6 safe-top">
          <div className="mb-4 h-4 w-24 animate-pulse rounded bg-warm-100" />
          <div className="mb-2 h-8 w-2/3 animate-pulse rounded bg-warm-100" />
          <div className="mb-6 h-3 w-1/2 animate-pulse rounded bg-warm-100" />
          <div className="mb-6 h-12 w-full animate-pulse rounded-xl bg-warm-100" />
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-14 animate-pulse rounded-xl bg-warm-100"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !station) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-muted-foreground">Station not found.</p>
        <Button variant="outline" onClick={() => navigate("/my-stations")}>
          Back to my stations
        </Button>
      </div>
    );
  }

  const isOwner = !!user && station.userId === user.id;
  const isPublished = station.visibility === "public";
  const backTo = safeFrom(fromParam, isOwner ? "/my-stations" : "/library");

  const sortedSections = [...station.sections].sort(
    (a, b) => a.order - b.order,
  );
  const defaultOpenSections = sortedSections.map((_, i) => `section-${i}`);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-background pb-36">
      <PageHeader
        backTo={backTo}
        backLabel="Back"
        actions={
          <>
            <StarButton
              target={{ type: "station", id: station.id }}
              count={station.starCount ?? 0}
              isStarred={!!(station as any).isStarred}
              size="sm"
            />
            {isOwner && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Edit station"
                onClick={() => navigate(`/station/${station.id}/edit`)}
                className="h-11 w-11 rounded-full"
              >
                <Edit className="h-4 w-4" />
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="More station actions"
                  className="h-11 w-11 rounded-full"
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isOwner && !isPublished && (
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      setShowPublishDialog(true);
                    }}
                  >
                    <Globe2 className="mr-2 h-4 w-4" />
                    Publish to library
                  </DropdownMenuItem>
                )}
                {isOwner && isPublished && (
                  <>
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault();
                        handleCopyPublicLink();
                      }}
                    >
                      <Copy className="mr-2 h-4 w-4" />
                      Copy public link
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault();
                        handleUnpublish();
                      }}
                    >
                      <EyeOff className="mr-2 h-4 w-4" />
                      Unpublish
                    </DropdownMenuItem>
                  </>
                )}
                {!isOwner && isPublished && (
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      setShowReportDialog(true);
                    }}
                  >
                    <Flag className="mr-2 h-4 w-4" />
                    Report
                  </DropdownMenuItem>
                )}
                {isOwner && <DropdownMenuSeparator />}
                {isOwner && (
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={(e) => {
                      e.preventDefault();
                      setShowDeleteDialog(true);
                    }}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete station
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {/* Main content */}
      <main className="mx-auto max-w-[440px] lg:max-w-3xl px-5 pt-6">
        <motion.header
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="mb-8"
        >
          <h1 className="mb-2 font-display text-display text-foreground">
            {station.title}
          </h1>
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-caption text-muted-foreground">
            <span>{stationTypeLabel(station.type)}</span>
            <span aria-hidden>·</span>
            <span className="tabular-nums">
              {station.defaultTimeMinutes} min
            </span>
            <span aria-hidden>·</span>
            <span className="tabular-nums">{totalItems} items</span>
            {isPublished && (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-accent/10 px-2 py-0.5 text-label text-brand-accent">
                  <Globe2 className="h-3 w-3" />
                  Published
                </span>
              </>
            )}
          </p>
          {!isOwner && isPublished && (
            <div className="mt-5">
              <ForkButton
                target={{ type: "station", id: station.id }}
                size="md"
              />
            </div>
          )}
          {/* Desktop-only inline Practice CTA. The mobile fixed-bottom bar
              is hidden at lg+ to avoid overlapping the SideNav. */}
          <div className="mt-6 hidden lg:block">
            <Button
              onClick={() => setShowPracticeSheet(true)}
              className="h-12 gap-2 rounded-full bg-primary px-6 text-primary-foreground text-[15px] font-semibold shadow-md transition-transform active:scale-[0.98]"
            >
              <Play className="h-4 w-4" />
              Practice
            </Button>
          </div>
        </motion.header>

        {/* Reference image (for image_id stations etc.) */}
        {station.referenceImageUrl && (
          <div className="mb-6">
            <ZoomableImage
              url={station.referenceImageUrl}
              caption={station.referenceImageCaption}
              alt={station.title}
              onOpen={setLightbox}
            />
          </div>
        )}

        {/* Scenario */}
        {station.scenario && (
          <section className="mb-6">
            <h2 className="mb-2 text-label text-muted-foreground uppercase">
              Scenario
            </h2>
            <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-card">
              <p className="whitespace-pre-wrap text-body text-foreground/90">
                {station.scenario}
              </p>
            </div>
          </section>
        )}

        {/* Patient briefing (hidden by default — it's the AI prompt) */}
        {station.patientBriefing && station.hasPatientBriefing && (
          <section className="mb-6">
            <button
              type="button"
              onClick={() => setShowBriefing((v) => !v)}
              className="flex w-full items-center justify-between rounded-2xl border border-border/60 bg-card px-5 py-4 text-left shadow-card transition-colors hover:bg-warm-50"
              aria-expanded={showBriefing}
            >
              <div className="min-w-0">
                <p className="text-label text-muted-foreground uppercase">
                  Patient briefing
                </p>
                <p className="mt-1 text-caption text-muted-foreground">
                  Hidden script used by the AI patient
                </p>
              </div>
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                  showBriefing && "rotate-180",
                )}
              />
            </button>
            {showBriefing && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                transition={{ duration: 0.18 }}
                className="overflow-hidden"
              >
                <div className="mt-2 rounded-2xl bg-warm-100/60 p-5">
                  <p className="whitespace-pre-wrap text-caption text-warm-800">
                    {station.patientBriefing}
                  </p>
                </div>
              </motion.div>
            )}
          </section>
        )}

        {/* Checklist */}
        <section className="mb-8">
          <div className="mb-4">
            <h2 className="font-display text-h2 text-foreground">
              Checklist
            </h2>
          </div>

          <Accordion
            type="multiple"
            defaultValue={defaultOpenSections}
            className="space-y-3"
          >
            {sortedSections.map((section, si) => {
              const topItems = [...section.items]
                .filter((i: any) => !i.parentItemId)
                .sort((a: any, b: any) => a.order - b.order);

              return (
                <AccordionItem
                  key={section.id}
                  value={`section-${si}`}
                  className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-card data-[state=open]:shadow-card"
                >
                  <AccordionTrigger
                    className={cn(
                      "group flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:no-underline",
                      "[&[data-state=open]>svg]:rotate-180",
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 font-display text-caption font-semibold tabular-nums text-primary">
                        {si + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-display text-h3 text-foreground">
                          {section.title}
                        </p>
                        <p className="text-caption text-muted-foreground tabular-nums">
                          {topItems.length}{" "}
                          {topItems.length === 1 ? "item" : "items"}
                        </p>
                      </div>
                    </div>
                  </AccordionTrigger>

                  <AccordionContent className="px-5 pb-5 pt-0">
                    {section.description && (
                      <p className="mb-4 whitespace-pre-wrap text-caption text-muted-foreground">
                        {section.description}
                      </p>
                    )}

                    {section.imageUrl && (
                      <div className="mb-4">
                        <ZoomableImage
                          url={section.imageUrl}
                          caption={section.imageCaption}
                          alt={section.title}
                          onOpen={setLightbox}
                        />
                      </div>
                    )}

                    {topItems.length === 0 ? (
                      <p className="py-4 text-center text-xs text-muted-foreground">
                        No items in this section yet.
                      </p>
                    ) : (
                      <ul className="border-t border-border/40">
                        {topItems.map((item: any, ii: number) => (
                          <ItemRow
                            key={item.id}
                            item={item}
                            depth={0}
                            index={ii}
                            openLightbox={setLightbox}
                          />
                        ))}
                      </ul>
                    )}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </section>

        {/* Examiner Questions — designed for studying: answers shown by
            default, big readable typography, per-type rendering. */}
        <section className="mb-10">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-display text-h2 text-foreground">
              Examiner questions
            </h2>
            {station.examinerQuestions.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setHideAllAnswers((v) => !v);
                  // Also clear per-Q overrides so the global toggle wins.
                  setHiddenAnswers({});
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                aria-pressed={hideAllAnswers}
              >
                {hideAllAnswers ? (
                  <Eye className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <EyeOff className="h-3.5 w-3.5" aria-hidden />
                )}
                {hideAllAnswers ? "Show answers" : "Hide answers"}
              </button>
            )}
          </div>

          {station.examinerQuestions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/70 bg-card/40 p-6 text-center">
              <p className="mb-2 text-body text-muted-foreground">
                No examiner questions yet
              </p>
              <button
                onClick={() => navigate(`/station/${station.id}/edit`)}
                className="text-caption font-medium text-brand-accent hover:underline"
              >
                Add in editor
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {[...station.examinerQuestions]
                .sort((a, b) => a.order - b.order)
                .map((q, qi) => {
                  const explicitlyHidden = !!hiddenAnswers[q.id];
                  const isHidden = hideAllAnswers || explicitlyHidden;
                  return (
                    <ExaminerQuestionCard
                      key={q.id}
                      q={q}
                      index={qi + 1}
                      isHidden={isHidden}
                      onToggleHide={() =>
                        setHiddenAnswers((prev) => ({
                          ...prev,
                          [q.id]: !prev[q.id],
                        }))
                      }
                    />
                  );
                })}
            </div>
          )}
        </section>
      </main>

      {/* Mobile fixed bottom Practice CTA. Hidden at lg+ to avoid
          overlapping the variable-width SideNav; the desktop layout
          renders an inline Practice button in the page header instead. */}
      <div
        className={cn(
          "fixed bottom-0 left-0 right-0 z-40 lg:hidden",
          "backdrop-blur-xl bg-background/80 border-t border-border/40",
          "px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]",
        )}
      >
        <div className="mx-auto w-full max-w-[440px]">
          <Button
            onClick={() => setShowPracticeSheet(true)}
            className="h-14 w-full gap-2 rounded-full bg-primary text-primary-foreground text-[17px] font-semibold shadow-lg transition-transform active:scale-[0.98]"
          >
            <Play className="h-4 w-4" />
            Practice
          </Button>
        </div>
      </div>

      {/* Modals */}
      <PracticeModeSheet
        open={showPracticeSheet}
        onOpenChange={setShowPracticeSheet}
        stationId={station.id}
        stationType={station.type}
        hasPatientBriefing={
          !!(station.patientBriefing && station.hasPatientBriefing)
        }
        hasExaminerQuestions={station.examinerQuestions.length > 0}
      />

      <AlertDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete station?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &ldquo;{station.title}&rdquo; and
              all its practice history. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <MediaLightbox
        open={!!lightbox}
        onOpenChange={(open) => {
          if (!open) setLightbox(null);
        }}
        src={lightbox?.src ?? ""}
        alt={lightbox?.alt}
        caption={lightbox?.caption}
      />

      <PublishDialog
        open={showPublishDialog}
        onOpenChange={setShowPublishDialog}
        target={{ type: "station", id: station.id, title: station.title }}
        currentUserName={user?.displayName ?? "you"}
      />

      <ReportDialog
        open={showReportDialog}
        onOpenChange={setShowReportDialog}
        target={{ targetType: "station", targetId: station.id }}
        targetLabel={station.title}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Examiner question card — study-friendly per-type rendering.
// ────────────────────────────────────────────────────────────────────

interface ExaminerQuestionLike {
  id: number;
  question: string;
  questionType?: string;
  idealAnswer?: string | null;
  keyPoints?: string[] | null;
  config?: {
    options?: Array<{ text: string; isCorrect: boolean }>;
    threshold?: number;
  } | null;
}

const TYPE_LABELS: Record<string, { label: string; icon: any }> = {
  free_text: { label: "Free text", icon: TypeIcon },
  multiple_choice: { label: "Multiple choice", icon: CircleDot },
  multi_select: { label: "Multi-select", icon: CheckSquare },
  checklist: { label: "Checklist", icon: ListChecks },
};

function ExaminerQuestionCard({
  q,
  index,
  isHidden,
  onToggleHide,
}: {
  q: ExaminerQuestionLike;
  index: number;
  isHidden: boolean;
  onToggleHide: () => void;
}) {
  const typeKey = q.questionType ?? "free_text";
  const typeMeta = TYPE_LABELS[typeKey] ?? TYPE_LABELS.free_text;
  const TypeIconC = typeMeta.icon;

  return (
    <div className="rounded-2xl border border-border/60 bg-card shadow-card overflow-hidden">
      {/* Header strip */}
      <div className="flex items-start gap-3 px-5 pt-5 pb-5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[13px] font-semibold tabular-nums text-primary">
          {index}
        </span>
        <div className="min-w-0 flex-1 space-y-3">
          <p className="text-[17px] font-semibold leading-snug text-foreground">
            {q.question}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              <TypeIconC className="h-3 w-3" aria-hidden />
              {typeMeta.label}
            </span>
            {typeKey === "checklist" && q.keyPoints && (
              <span className="text-[11px] font-medium text-muted-foreground">
                {q.keyPoints.length} item
                {q.keyPoints.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleHide}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={isHidden ? "Show answer" : "Hide answer"}
          title={isHidden ? "Show answer" : "Hide answer"}
        >
          {isHidden ? (
            <Eye className="h-4 w-4" aria-hidden />
          ) : (
            <EyeOff className="h-4 w-4" aria-hidden />
          )}
        </button>
      </div>

      {/* Answer body — shown by default; hideable. */}
      {isHidden ? (
        <button
          type="button"
          onClick={onToggleHide}
          className="m-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-muted/30 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          aria-label="Show answer"
        >
          <Eye className="h-3.5 w-3.5" />
          Reveal answer
        </button>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.18 }}
          className="border-t border-border/40 bg-warm-50/60 px-5 py-5"
        >
          <ExaminerAnswerBody q={q} typeKey={typeKey} />
        </motion.div>
      )}
    </div>
  );
}

function ExaminerAnswerBody({
  q,
  typeKey,
}: {
  q: ExaminerQuestionLike;
  typeKey: string;
}) {
  // Checklist: every keyPoint is an expected item, render as a list.
  if (typeKey === "checklist") {
    const items = q.keyPoints ?? [];
    if (items.length === 0) {
      return (
        <p className="text-[14px] italic text-muted-foreground">
          No expected items added yet.
        </p>
      );
    }
    return (
      <>
        <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          Expected items · each worth 1 point
        </p>
        <ul className="space-y-2">
          {items.map((kp, ki) => (
            <li
              key={ki}
              className="flex items-start gap-3 text-[15px] leading-relaxed text-foreground"
            >
              <span
                aria-hidden
                className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              >
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
              <span>{kp}</span>
            </li>
          ))}
        </ul>
      </>
    );
  }

  // Multiple choice / multi-select: render the option list with the
  // correct one(s) highlighted.
  if (typeKey === "multiple_choice" || typeKey === "multi_select") {
    const opts = q.config?.options ?? [];
    if (opts.length === 0) {
      return (
        <p className="text-[14px] italic text-muted-foreground">
          No options configured yet.
        </p>
      );
    }
    const threshold =
      typeKey === "multi_select" ? q.config?.threshold : undefined;
    return (
      <>
        <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          {typeKey === "multiple_choice" ? "Options" : "Options"}
          {threshold !== undefined && (
            <span className="ml-2 font-medium normal-case tracking-normal text-muted-foreground/80">
              {threshold} required for full credit
            </span>
          )}
        </p>
        <ul className="space-y-1.5">
          {opts.map((opt, oi) => (
            <li
              key={oi}
              className={cn(
                "flex items-start gap-3 rounded-xl px-3 py-2.5 text-[15px] leading-relaxed",
                opt.isCorrect
                  ? "bg-emerald-500/10 text-foreground"
                  : "bg-transparent text-muted-foreground",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                  opt.isCorrect
                    ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400"
                    : "bg-muted text-muted-foreground/60",
                )}
              >
                {opt.isCorrect ? (
                  <Check className="h-3 w-3" strokeWidth={3} />
                ) : (
                  <span className="text-[10px] font-semibold">
                    {String.fromCharCode(65 + oi)}
                  </span>
                )}
              </span>
              <span>{opt.text}</span>
            </li>
          ))}
        </ul>
      </>
    );
  }

  // Free text: ideal answer + optional key points to look for.
  return (
    <>
      {q.idealAnswer && (
        <>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            Ideal answer
          </p>
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground">
            {q.idealAnswer}
          </p>
        </>
      )}
      {q.keyPoints && q.keyPoints.length > 0 && (
        <div className={cn(q.idealAnswer && "mt-4 border-t border-border/40 pt-4")}>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            Key points to cover
          </p>
          <ul className="space-y-1.5">
            {q.keyPoints.map((kp, ki) => (
              <li
                key={ki}
                className="flex items-start gap-2.5 text-[14px] leading-relaxed text-foreground"
              >
                <span
                  aria-hidden
                  className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60"
                />
                <span>{kp}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!q.idealAnswer && (!q.keyPoints || q.keyPoints.length === 0) && (
        <p className="text-[14px] italic text-muted-foreground">
          No answer added yet.
        </p>
      )}
    </>
  );
}
