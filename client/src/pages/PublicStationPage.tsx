import { useEffect, useState, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  ChevronDown,
  Play,
  AlertTriangle,
  MoreVertical,
  Flag,
  Maximize2,
  Star,
  GitFork,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { safeFrom } from "@/lib/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { AuthorBadge } from "@/components/library/AuthorBadge";
import { ForkButton } from "@/components/library/ForkButton";
import { StarButton } from "@/components/library/StarButton";
import { ReportDialog } from "@/components/library/ReportDialog";
import { MediaLightbox } from "@/components/MediaLightbox";
import { VideoEmbed } from "@/components/VideoEmbed";
import { usePublicStation } from "@/hooks/use-library";
import { useAuth } from "@/hooks/use-auth";
import { stationTypeLabel, cn } from "@/lib/utils";

function setMetaTags(opts: {
  title: string;
  description?: string;
  image?: string;
}) {
  document.title = opts.title;
  const ensure = (selector: string, create: () => HTMLElement) => {
    let el = document.head.querySelector(selector) as HTMLElement | null;
    if (!el) {
      el = create();
      document.head.appendChild(el);
    }
    return el;
  };
  const setMeta = (property: string, content: string) => {
    const el = ensure(`meta[property="${property}"]`, () => {
      const m = document.createElement("meta");
      m.setAttribute("property", property);
      return m;
    });
    el.setAttribute("content", content);
  };
  const setName = (name: string, content: string) => {
    const el = ensure(`meta[name="${name}"]`, () => {
      const m = document.createElement("meta");
      m.setAttribute("name", name);
      return m;
    });
    el.setAttribute("content", content);
  };

  setMeta("og:title", opts.title);
  if (opts.description) {
    setMeta("og:description", opts.description);
    setName("description", opts.description);
  }
  if (opts.image) {
    setMeta("og:image", opts.image);
    setName("twitter:card", "summary_large_image");
    setName("twitter:image", opts.image);
  }
}

function relativeDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const day = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (day === 0) return "today";
  if (day === 1) return "yesterday";
  if (day < 30) return `${day} days ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface Lightbox {
  src: string;
  alt?: string;
  caption?: string | null;
}

function ZoomableImage({
  url,
  caption,
  alt,
  onOpen,
}: {
  url: string;
  caption?: string | null;
  alt?: string;
  onOpen: (lb: Lightbox) => void;
}) {
  return (
    <figure className="space-y-1.5">
      <button
        type="button"
        onClick={() => onOpen({ src: url, alt: alt || caption || "", caption })}
        className="group relative block w-full overflow-hidden rounded-xl border border-border/60 bg-warm-100"
      >
        <div className="aspect-[16/10]">
          <img
            src={url}
            alt={alt || caption || ""}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        </div>
        <span className="pointer-events-none absolute right-2 top-2 hidden h-7 w-7 items-center justify-center rounded-full bg-black/45 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 [@media(hover:hover)]:flex">
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

function ItemRow({
  item,
  depth,
  index,
  openLightbox,
}: {
  item: any;
  depth: number;
  index: number;
  openLightbox: (lb: Lightbox) => void;
}) {
  const images: Array<{ url: string; caption?: string | null }> = [];
  const videos: Array<{ url: string; caption?: string | null }> = [];
  const media = Array.isArray(item?.media) ? [...item.media] : [];
  media.sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));
  for (const m of media) {
    if (!m?.url) continue;
    if (m.type === "image") images.push({ url: m.url, caption: m.caption });
    else if (m.type === "video")
      videos.push({ url: m.url, caption: m.caption });
  }
  if (item?.imageUrl && !images.some((i) => i.url === item.imageUrl)) {
    images.unshift({ url: item.imageUrl, caption: item.imageCaption ?? null });
  }
  if (item?.videoUrl && !videos.some((v) => v.url === item.videoUrl)) {
    videos.push({ url: item.videoUrl, caption: null });
  }

  const children = (item.subItems ?? []) as any[];
  const sortedChildren = [...children].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );
  const hasExplanation = !!(item.explanation && item.explanation.trim());
  const hasDetail =
    hasExplanation || images.length > 0 || videos.length > 0;

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
        <span
          className={cn(
            "mt-[3px] shrink-0 select-none tabular-nums text-caption",
            depth === 0 ? "text-muted-foreground" : "text-muted-foreground/80",
          )}
        >
          {depth === 0 ? `${index + 1}.` : depth === 1 ? "–" : "·"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p
              className={cn(
                "min-w-0",
                depth === 0 ? "text-body text-foreground" : "text-body text-foreground/90",
              )}
            >
              {item.text}
            </p>
            {item.isCritical && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-accent/10 px-2 py-0.5 text-label text-brand-accent">
                <AlertTriangle className="h-3 w-3" />
                Critical
              </span>
            )}
          </div>

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
                        <figcaption className="text-caption text-muted-foreground">
                          {vid.caption}
                        </figcaption>
                      )}
                    </figure>
                  ))}
                </div>
              )}
            </div>
          )}

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

export default function PublicStationPage() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { data: station, isLoading, isError } = usePublicStation(params.id);
  const { user } = useAuth();
  const isOwner = !!(user && station && user.id === station.author.id);
  const fromParam =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("from")
      : null;
  const backTo = safeFrom(fromParam, "/library");

  const [showAnswers, setShowAnswers] = useState<Record<number, boolean>>({});
  const [showBriefing, setShowBriefing] = useState(false);
  const [lightbox, setLightbox] = useState<Lightbox | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  useEffect(() => {
    if (station) {
      const excerpt = (station.scenario ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200);
      setMetaTags({
        title: `${station.title} — Socrates AI`,
        description:
          excerpt ||
          `An OSCE station shared by ${station.author.displayName} on Socrates AI.`,
        image: "/og-default.svg",
      });
    }
  }, [station]);

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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-[960px] px-5 py-6 safe-top">
          <div className="mb-4 h-4 w-24 animate-pulse rounded bg-warm-100" />
          <div className="mb-2 h-8 w-2/3 animate-pulse rounded bg-warm-100" />
          <div className="mb-6 h-3 w-1/2 animate-pulse rounded bg-warm-100" />
          <div className="mb-6 h-12 w-full animate-pulse rounded-xl bg-warm-100" />
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-warm-100" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (isError || !station) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-body text-foreground">
          This station is no longer available.
        </p>
        <Button variant="outline" onClick={() => navigate(backTo)}>
          Back
        </Button>
      </div>
    );
  }

  const sortedSections = [...station.sections].sort(
    (a, b) => a.order - b.order,
  );
  const defaultOpenSections = sortedSections.map((_, i) => `section-${i}`);

  return (
    <div className="min-h-screen bg-background pb-32">
      <PageHeader
        backTo={backTo}
        backLabel="Back"
        wide
        actions={
          <>
            <StarButton
              target={{ type: "station", id: station.id }}
              count={station.starCount}
              isStarred={!!station.isStarred}
              size="sm"
            />
            {!isOwner && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="More actions"
                    className="h-11 w-11 rounded-full"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      setReportOpen(true);
                    }}
                  >
                    <Flag className="mr-2 h-4 w-4" />
                    Report
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />

      <main className="mx-auto max-w-[960px] px-5 pt-6">
        <motion.header
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="mb-6"
        >
          <h1 className="mb-2 font-display text-h1 text-foreground">
            {station.title}
          </h1>
          <div className="mb-3">
            <AuthorBadge author={station.author} size="md" />
          </div>
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-caption text-muted-foreground">
            <span>{stationTypeLabel(station.type)}</span>
            {station.specialty && (
              <>
                <span aria-hidden>·</span>
                <span>{station.specialty}</span>
              </>
            )}
            <span aria-hidden>·</span>
            <span className="tabular-nums">
              {station.defaultTimeMinutes} min
            </span>
            <span aria-hidden>·</span>
            <span className="tabular-nums">{totalItems} items</span>
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-3 text-caption text-muted-foreground tabular-nums">
            <span className="inline-flex items-center gap-1">
              <Star className="h-3.5 w-3.5 text-brand-accent" aria-hidden />
              {station.starCount}
            </span>
            <span className="inline-flex items-center gap-1">
              <GitFork className="h-3.5 w-3.5" aria-hidden />
              {station.forkCount}
            </span>
            <span className="inline-flex items-center gap-1">
              <Play className="h-3 w-3" aria-hidden />
              {station.practiceCount}
            </span>
            <span>Published {relativeDate(station.publishedAt)}</span>
          </div>

          {!isOwner && (
            <div className="mt-5">
              <ForkButton
                target={{ type: "station", id: station.id }}
                authorId={station.author.id}
                size="lg"
                className="w-full"
              />
            </div>
          )}
        </motion.header>

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
              <div className="mt-2 rounded-2xl bg-warm-100/60 p-5">
                <p className="whitespace-pre-wrap text-caption text-warm-800">
                  {station.patientBriefing}
                </p>
              </div>
            )}
          </section>
        )}

        {sortedSections.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-4 font-display text-h2 text-foreground">
              Checklist
            </h2>
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
                    className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-card"
                  >
                    <AccordionTrigger className="group flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:no-underline">
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
                          No items in this section.
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
        )}

        {station.examinerQuestions && station.examinerQuestions.length > 0 && (
          <section className="mb-10">
            <h2 className="mb-4 font-display text-h2 text-foreground">
              Examiner questions
            </h2>
            <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-card">
              {[...station.examinerQuestions]
                .sort((a, b) => a.order - b.order)
                .map((q, qi) => {
                  const isOpen = !!showAnswers[q.id];
                  // Library is a study surface (read-only preview before
                  // forking) — render every media row regardless of its
                  // exam/study flag.
                  const allMedia = (((q as any).media ?? []) as Array<{
                    type: "image" | "video";
                    url: string;
                    caption?: string | null;
                    phase: "question" | "explanation";
                  }>) ?? [];
                  const qMedia = allMedia.filter((m) => m.phase === "question");
                  const eMedia = allMedia.filter((m) => m.phase === "explanation");
                  const opts: Array<{ text: string; isCorrect: boolean }> =
                    ((q as any).config?.options ?? []) as any;
                  const qType: string = (q as any).questionType ?? "free_text";
                  return (
                    <div
                      key={q.id}
                      className="border-b border-border/40 px-5 py-4 last:border-b-0"
                    >
                      <div className="flex items-start gap-3">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-caption font-semibold tabular-nums text-primary">
                          {qi + 1}
                        </span>
                        <div className="min-w-0 flex-1 space-y-2">
                          <p className="text-body font-medium text-foreground">
                            {q.question}
                          </p>
                          {(q as any).description && (
                            <p className="whitespace-pre-wrap text-caption text-muted-foreground">
                              {(q as any).description}
                            </p>
                          )}
                          {qMedia.length > 0 && (
                            <div className="grid grid-cols-2 gap-2">
                              {qMedia.map((m, i) => (
                                <figure key={`${m.url}-${i}`} className="space-y-1">
                                  <img
                                    src={m.url}
                                    alt={m.caption ?? ""}
                                    className="aspect-video w-full rounded-lg border border-border/60 object-cover"
                                  />
                                  {m.caption && (
                                    <figcaption className="text-[11px] text-muted-foreground">
                                      {m.caption}
                                    </figcaption>
                                  )}
                                </figure>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() =>
                          setShowAnswers((prev) => ({
                            ...prev,
                            [q.id]: !prev[q.id],
                          }))
                        }
                        className="ml-9 mt-2 flex min-h-[44px] items-center gap-1 text-caption font-medium text-brand-accent"
                        aria-expanded={isOpen}
                      >
                        {isOpen ? "Hide answer" : "Show answer"}
                        <ChevronDown
                          className={cn(
                            "h-3 w-3 transition-transform",
                            isOpen && "rotate-180",
                          )}
                        />
                      </button>
                      {isOpen && (
                        <div className="ml-9 mt-3 space-y-3 rounded-xl bg-warm-100/60 p-4">
                          {qType === "free_text" && q.idealAnswer && (
                            <p className="whitespace-pre-wrap text-caption text-warm-800">
                              {q.idealAnswer}
                            </p>
                          )}
                          {qType === "checklist" && q.keyPoints && q.keyPoints.length > 0 && (
                            <ul className="space-y-1">
                              {q.keyPoints.map((kp, ki) => (
                                <li
                                  key={ki}
                                  className="flex gap-2 text-caption text-warm-800"
                                >
                                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-warm-600" />
                                  <span>{kp}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                          {(qType === "multiple_choice" || qType === "multi_select") && opts.length > 0 && (
                            <ul className="space-y-1">
                              {opts.map((o, oi) => (
                                <li
                                  key={oi}
                                  className={cn(
                                    "flex items-start gap-2 text-caption",
                                    o.isCorrect
                                      ? "font-semibold text-success"
                                      : "text-warm-800",
                                  )}
                                >
                                  <span
                                    className={cn(
                                      "mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px]",
                                      o.isCorrect
                                        ? "bg-success/20"
                                        : "bg-warm-200",
                                    )}
                                  >
                                    {o.isCorrect ? "✓" : ""}
                                  </span>
                                  <span>{o.text}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                          {((q as any).explanation || eMedia.length > 0) && (
                            <div className="space-y-2 border-t border-border/40 pt-3">
                              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                Explanation
                              </p>
                              {(q as any).explanation && (
                                <p className="whitespace-pre-wrap text-caption text-warm-800">
                                  {(q as any).explanation}
                                </p>
                              )}
                              {eMedia.length > 0 && (
                                <div className="grid grid-cols-2 gap-2">
                                  {eMedia.map((m, i) => (
                                    <figure key={`${m.url}-${i}`} className="space-y-1">
                                      <img
                                        src={m.url}
                                        alt={m.caption ?? ""}
                                        className="aspect-video w-full rounded-lg border border-border/60 object-cover"
                                      />
                                      {m.caption && (
                                        <figcaption className="text-[11px] text-muted-foreground">
                                          {m.caption}
                                        </figcaption>
                                      )}
                                    </figure>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </section>
        )}

        <footer className="mb-6 rounded-2xl border border-border/40 bg-card/60 px-5 py-4">
          <p className="text-caption text-muted-foreground">
            Shared by{" "}
            <span className="font-medium text-foreground">
              {station.author.displayName}
            </span>{" "}
            under CC-BY 4.0 · Credit the author if you fork and share.
          </p>
        </footer>
      </main>

      {/* Sticky fork CTA — hidden for owners (who already have the station).
          Hidden at lg+: an inline ForkButton already exists in the page
          header, and the fixed bar would overlap the variable-width SideNav. */}
      {!isOwner && (
        <div className="fixed bottom-0 left-0 right-0 z-40 lg:hidden border-t border-border/40 bg-background/80 px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] backdrop-blur-xl">
          <div className="mx-auto w-full max-w-[960px]">
            <ForkButton
              target={{ type: "station", id: station.id }}
              authorId={station.author.id}
              size="lg"
              className="w-full"
            />
          </div>
        </div>
      )}

      <ReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        target={{ targetType: "station", targetId: station.id }}
        targetLabel={station.title}
      />
      <MediaLightbox
        open={!!lightbox}
        onOpenChange={(open) => {
          if (!open) setLightbox(null);
        }}
        src={lightbox?.src ?? ""}
        alt={lightbox?.alt}
        caption={lightbox?.caption}
      />
    </div>
  );
}
