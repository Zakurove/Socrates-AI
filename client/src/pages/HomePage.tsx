import { useMemo } from "react";
import { useLocation } from "wouter";
import { motion, useReducedMotion } from "framer-motion";
import {
  ChevronRight,
  Play,
  Loader2,
  Plus,
  Timer,
  Lock,
  Globe2,
  Star,
  BookOpen,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useSessions, type SessionListItem } from "@/hooks/use-sessions";
import { useStations } from "@/hooks/use-stations";
import { useFeaturedLibrary } from "@/hooks/use-library";
import { usePrefs } from "@/hooks/use-prefs";
import { DraftsList } from "@/components/DraftsList";
import { hasScore, scoreRampClasses, stationTypeLabel, cn } from "@/lib/utils";

interface StatsData {
  sessionsThisWeek: number;
  sessionsThisMonth: number;
  totalSessions: number;
  totalPracticeMinutes: number;
  stationsPracticed: number;
  totalStations: number;
  currentStreak: number;
  bestImprovement: {
    stationTitle: string;
    from: number;
    to: number;
    delta: number;
  } | null;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function getGreeting(date = new Date()): string {
  const h = date.getHours();
  if (h >= 23 || h < 2) return "Still up,";
  if (h < 12) return "Good morning,";
  if (h < 17) return "Good afternoon,";
  return "Good evening,";
}

function firstName(displayName?: string | null): string {
  if (!displayName) return "there";
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  // Skip common honorifics so "Dr. Test User" -> "Test"
  const honorifics = /^(dr|mr|mrs|ms|miss|prof|sir|dame)\.?$/i;
  const first = parts.find((p) => !honorifics.test(p)) ?? parts[0] ?? "there";
  // Strip trailing punctuation so we don't render "Dr.."
  return first.replace(/[.,;:!?]+$/, "");
}

function relativeTime(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// ─── Home ───────────────────────────────────────────────────────────────────

export default function HomePage() {
  const { user } = useAuth();
  const { data: sessions, isLoading } = useSessions();
  const { data: stations } = useStations();
  const [, navigate] = useLocation();
  const { resolvedTheme } = usePrefs();
  const shouldReduce = useReducedMotion();

  const completedSessions = useMemo<SessionListItem[]>(
    () => (sessions ?? []).filter((s) => s.endedAt),
    [sessions]
  );

  const sortedByRecent = useMemo(
    () =>
      [...completedSessions].sort(
        (a, b) =>
          new Date(b.endedAt ?? b.startedAt).getTime() -
          new Date(a.endedAt ?? a.startedAt).getTime()
      ),
    [completedSessions]
  );

  const lastSession = sortedByRecent[0];

  // Worth revisiting: most recent session per station, lowest <70% (up to 3)
  const worthRevisiting = useMemo(() => {
    const byStation = new Map<number, SessionListItem>();
    for (const s of sortedByRecent) {
      if (!byStation.has(s.stationId)) byStation.set(s.stationId, s);
    }
    const candidates = Array.from(byStation.values()).filter(
      (s) => hasScore(s) && (s.totalScore ?? 100) < 70
    );
    candidates.sort((a, b) => (a.totalScore ?? 0) - (b.totalScore ?? 0));
    return candidates.slice(0, 3);
  }, [sortedByRecent]);

  // Fetch stats
  const { data: stats } = useQuery<StatsData>({
    queryKey: ["/api/stats"],
  });

  // "Your stations" preview — up to 3 stations the user owns. Sorted by
  // most-recent practice if the user has practiced lately, otherwise by
  // most-recently updated (so a freshly-authored station shows up at
  // the top even with no practice yet). One row per station.
  const yourStations = useMemo(() => {
    const list = stations ?? [];
    if (list.length === 0) return [] as Array<{
      id: number;
      title: string;
      type: string;
      lastPracticedAt: string | null;
      lastScore: number | null;
    }>;
    // Build last-practiced lookup from sessions.
    const lastByStation = new Map<
      number,
      { at: string; score: number | null }
    >();
    for (const s of completedSessions) {
      const sid = s.stationId;
      const prev = lastByStation.get(sid);
      const raw = s.endedAt ?? s.startedAt;
      const at = typeof raw === "string" ? raw : new Date(raw).toISOString();
      if (!prev || new Date(at).getTime() > new Date(prev.at).getTime()) {
        lastByStation.set(sid, {
          at,
          score: s.totalScore ?? null,
        });
      }
    }
    return [...list]
      .map((st) => ({
        id: st.id,
        title: st.title,
        type: st.type,
        lastPracticedAt: lastByStation.get(st.id)?.at ?? null,
        lastScore: lastByStation.get(st.id)?.score ?? null,
        // Sort key — prefer last-practiced timestamp, fall back to
        // updatedAt. Cast through Date so missing values sort low.
        _sortKey: Math.max(
          lastByStation.get(st.id)?.at
            ? new Date(lastByStation.get(st.id)!.at).getTime()
            : 0,
          st.updatedAt ? new Date(st.updatedAt as any).getTime() : 0,
        ),
      }))
      .sort((a, b) => b._sortKey - a._sortKey)
      .slice(0, 3);
  }, [stations, completedSessions]);

  // Featured community stations — mini preview for HomePage card.
  const { data: featuredLib } = useFeaturedLibrary();
  const featuredPreview = (featuredLib?.items ?? []).slice(0, 3);

  // Mock Exam is a first-class feature — always surfaced. If the user
  // doesn't have enough stations yet we still show the card (educates on
  // the feature) with a lock hint instead of linking to the page.
  const stationCount = stations?.length ?? 0;
  const mockExamUnlocked = stationCount >= 2;

  const logoSrc =
    resolvedTheme === "dark" ? "/brand/logo-dark.png" : "/brand/logo.png";

  const container = {
    hidden: {},
    show: {
      transition: {
        staggerChildren: shouldReduce ? 0 : 0.04,
        delayChildren: 0,
      },
    },
  };
  const item = {
    hidden: shouldReduce ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.35, ease: [0.2, 0.8, 0.2, 1] as const },
    },
  };

  // examDate intentionally omitted — not on user schema.

  // Greeting without trailing comma — used as an eyebrow chip
  const greetingShort = getGreeting().replace(/,\s*$/, "");

  return (
    <div className="relative min-h-screen overflow-hidden pb-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom)+1.5rem)]">
      {/* Subtle decorative Owl glyph — desktop only, V70 brand echo */}
      <img
        src="/brand/icon.png"
        alt=""
        aria-hidden
        className="hidden lg:block absolute -bottom-20 -right-20 h-[420px] w-[420px] rotate-[-12deg] pointer-events-none opacity-[0.04]"
      />
      <div className="safe-top" />

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="relative space-y-8 px-5 pt-6 w-full lg:max-w-5xl lg:mx-auto"
      >
        {/* HomeHero */}
        <motion.header variants={item} className="space-y-3">
          <img
            src={logoSrc}
            alt="Socrates"
            className="h-10 w-auto"
            draggable={false}
          />

          {/* V70-style pulse eyebrow with the contextual greeting */}
          <div className="inline-flex items-center gap-2.5 pt-3">
            <span aria-hidden className="relative inline-flex h-2 w-2">
              <span className="absolute inset-0 rounded-full bg-[#E8A520] opacity-50 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#E8A520]" />
            </span>
            <span className="text-[11px] uppercase tracking-[0.3em] font-bold text-[#5A2E9A]">
              {greetingShort}
            </span>
          </div>

          <h1 className="text-[clamp(36px,5.5vw,52px)] font-bold tracking-[-0.025em] leading-[0.98] text-foreground">
            {firstName(user?.displayName)}.
          </h1>

          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] tracking-tight pt-1">
            <span className="font-semibold text-zinc-800 dark:text-zinc-200">Build</span>
            <span aria-hidden className="text-zinc-300 dark:text-zinc-600 font-bold">·</span>
            <span className="font-semibold text-zinc-800 dark:text-zinc-200">Practice</span>
            <span aria-hidden className="text-zinc-300 dark:text-zinc-600 font-bold">·</span>
            <span className="font-semibold text-zinc-800 dark:text-zinc-200">Learn</span>
          </p>

          {/* Quick stats row */}
          {stats && (stats.sessionsThisWeek > 0 || stats.totalPracticeMinutes > 0) && (
            <div className="pt-3 flex flex-wrap items-center gap-x-2 text-caption text-muted-foreground">
              {stats.sessionsThisWeek > 0 && (
                <span>
                  {stats.sessionsThisWeek} session{stats.sessionsThisWeek !== 1 ? "s" : ""} this week
                </span>
              )}
              {stats.sessionsThisWeek > 0 && stats.totalPracticeMinutes > 0 && (
                <span aria-hidden="true">&middot;</span>
              )}
              {stats.totalPracticeMinutes > 0 && (
                <span>{stats.totalPracticeMinutes}m practiced</span>
              )}
              {stats.currentStreak > 0 && (
                <>
                  <span aria-hidden="true">&middot;</span>
                  <span>{stats.currentStreak} day streak</span>
                </>
              )}
            </div>
          )}
        </motion.header>

        {/* JumpBackInCard */}
        <motion.div variants={item}>
          {isLoading ? (
            <div className="rounded-3xl bg-card shadow-md p-6 flex items-center justify-center h-32">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : lastSession ? (
            <ResumeCard
              session={lastSession}
              onContinue={() =>
                navigate(`/station/${lastSession.stationId}`)
              }
            />
          ) : (
            <button
              onClick={() => navigate("/station/new")}
              className="w-full rounded-3xl border-2 border-dashed border-border/80 bg-card/40 p-6 text-left transition-smooth active:scale-[0.98] hover:border-primary/40"
            >
              <div className="text-h3 text-foreground">
                Create your first station
              </div>
              <p className="mt-1 text-body text-muted-foreground">
                Build a checklist. Practice. Improve.
              </p>
              <div className="mt-4 inline-flex items-center gap-1 text-body font-medium text-primary">
                Get started <ChevronRight className="h-4 w-4" />
              </div>
            </button>
          )}
        </motion.div>

        {/* Mock exam — first-class feature card. Always visible; locked
            until the user has enough stations to form a circuit. */}
        <motion.div variants={item}>
          <button
            onClick={() => mockExamUnlocked && navigate("/mock-exam")}
            disabled={!mockExamUnlocked}
            className={cn(
              "w-full rounded-2xl bg-card border border-border/60 shadow-card p-5 flex items-center gap-4 text-left transition-smooth",
              mockExamUnlocked
                ? "active:scale-[0.98] hover:border-border"
                : "opacity-75 cursor-not-allowed"
            )}
          >
            <div
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl",
                mockExamUnlocked
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground"
              )}
            >
              <Timer className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-h3 text-foreground leading-tight">
                Mock Exam
              </div>
              <p className="mt-0.5 text-caption text-muted-foreground">
                {mockExamUnlocked
                  ? "Simulate an OSCE \u2014 timed multi-station"
                  : "Create 2+ stations to unlock"}
              </p>
            </div>
            {mockExamUnlocked ? (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <Lock className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
          </button>
        </motion.div>

        {/* Unsaved editor drafts (only renders if any exist) */}
        <motion.div variants={item}>
          <DraftsList />
        </motion.div>

        {/* Your stations — top-3 personal stations, most-recent first. The
            user shouldn't need to leave the home page to see their own work. */}
        {yourStations.length > 0 && (
          <motion.div variants={item} className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-h2 text-foreground">
                <BookOpen className="h-4 w-4 text-primary" />
                Your stations
              </h2>
              <button
                onClick={() => navigate("/my-stations")}
                className="inline-flex items-center gap-0.5 text-caption font-medium text-primary hover:underline"
              >
                See all
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
            <div className="space-y-2 lg:grid lg:grid-cols-3 lg:gap-3 lg:space-y-0">
              {yourStations.map((st) => (
                <button
                  key={st.id}
                  onClick={() => navigate(`/station/${st.id}`)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-border/60 bg-card p-4 text-left shadow-card transition-smooth active:scale-[0.98] hover:border-border"
                >
                  <div
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg tabular-nums",
                      st.lastScore != null
                        ? scoreRampClasses(st.lastScore)
                        : "bg-primary/10 text-primary",
                    )}
                  >
                    {st.lastScore != null ? (
                      <span className="text-caption font-semibold">
                        {Math.round(st.lastScore)}%
                      </span>
                    ) : (
                      <BookOpen className="h-4 w-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-h3 text-foreground">
                      {st.title}
                    </p>
                    <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
                      <span>{stationTypeLabel(st.type)}</span>
                      <span aria-hidden>·</span>
                      <span>
                        {st.lastPracticedAt
                          ? relativeTime(st.lastPracticedAt)
                          : "Not practiced yet"}
                      </span>
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {/* Worth revisiting + Community — side-by-side at lg+ */}
        <div className="space-y-8 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-6">
        {worthRevisiting.length > 0 && (
          <motion.div variants={item} className="space-y-3">
            <h2 className="text-h2 text-foreground">
              Worth revisiting
            </h2>
            <div className="space-y-2">
              {worthRevisiting.map((wr) => (
                <button
                  key={wr.id}
                  onClick={() => navigate(`/station/${wr.stationId}`)}
                  className="w-full rounded-2xl bg-card border border-border/60 shadow-card p-4 flex items-center gap-3 text-left transition-smooth active:scale-[0.98] hover:border-border"
                >
                  <div
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-caption font-semibold tabular-nums",
                      scoreRampClasses(wr.totalScore ?? 0)
                    )}
                  >
                    {Math.round(wr.totalScore ?? 0)}%
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-h3 text-foreground truncate">
                      {wr.station?.title ?? "Untitled station"}
                    </div>
                    <p className="text-caption text-muted-foreground mt-0.5">
                      {relativeTime(wr.endedAt ?? wr.startedAt)}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {/* Community library preview */}
        <motion.div
          variants={item}
          className={cn(
            "space-y-3",
            worthRevisiting.length === 0 && "lg:col-span-2"
          )}
        >
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-h2 text-foreground">
              <Globe2 className="h-4 w-4 text-primary" />
              Community
            </h2>
            <button
              onClick={() => navigate("/library")}
              className="inline-flex items-center gap-0.5 text-caption font-medium text-primary hover:underline"
            >
              Browse library
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
          {featuredPreview.length === 0 ? (
            <button
              onClick={() => navigate("/library")}
              className="block w-full rounded-2xl border border-border/60 bg-card p-4 text-left shadow-card transition-smooth active:scale-[0.98] hover:border-border"
            >
              <p className="text-body text-foreground">
                Discover stations shared by others
              </p>
              <p className="mt-0.5 text-caption text-muted-foreground">
                Practice, fork, and star community content.
              </p>
            </button>
          ) : (
            <div className="space-y-2">
              {featuredPreview.map((s) => (
                <button
                  key={s.id}
                  onClick={() => navigate(`/library/stations/${s.id}`)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-border/60 bg-card p-4 text-left shadow-card transition-smooth active:scale-[0.98] hover:border-border"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Globe2 className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-h3 text-foreground">
                      {s.title}
                    </p>
                    <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
                      <span>{stationTypeLabel(s.type)}</span>
                      {s.specialty && (
                        <>
                          <span aria-hidden>·</span>
                          <span>{s.specialty}</span>
                        </>
                      )}
                      <span aria-hidden>·</span>
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Star className="h-3 w-3 text-brand-accent" aria-hidden />
                        {s.starCount}
                      </span>
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
        </motion.div>
        </div>

        {/* New station quick action */}
        <motion.div variants={item}>
          <button
            onClick={() => navigate("/my-stations")}
            className="inline-flex items-center gap-1.5 text-body text-muted-foreground hover:text-foreground transition-smooth"
          >
            <Plus className="h-4 w-4" />
            New station
          </button>
        </motion.div>

      </motion.div>
    </div>
  );
}

// ─── subcomponents ──────────────────────────────────────────────────────────

function ResumeCard({
  session,
  onContinue,
}: {
  session: SessionListItem;
  onContinue: () => void;
}) {
  const title = session.station?.title ?? "Recent station";
  const typeLabel = session.station?.type
    ? session.station.type.replace(/_/g, " ")
    : "Station";
  const scored = hasScore(session);
  return (
    <div className="relative overflow-hidden rounded-3xl bg-card shadow-md border-l-4 border-brand-accent p-6 dark:before:absolute dark:before:inset-0 dark:before:pointer-events-none dark:before:bg-[radial-gradient(60%_50%_at_0%_50%,rgba(232,165,32,0.12),transparent_70%)]">
      <div className="relative">
        <p className="text-label text-muted-foreground uppercase mb-2">
          Jump back in
        </p>
        <h2 className="text-h2 text-foreground">
          {title}
        </h2>
        {scored ? (
          <p className="text-caption text-muted-foreground mt-1.5">
            <span className="capitalize">{typeLabel}</span>
            {" · last tried "}
            {relativeTime(session.endedAt ?? session.startedAt)}
            {" · "}
            {Math.round(session.totalScore as number)}%
          </p>
        ) : (
          <p className="text-caption text-muted-foreground mt-1.5 capitalize">
            {typeLabel}
          </p>
        )}
        <button
          onClick={onContinue}
          className="mt-5 w-full h-12 rounded-full bg-primary text-primary-foreground font-semibold text-[15px] inline-flex items-center justify-center gap-2 transition-smooth active:scale-[0.98]"
        >
          <Play className="h-4 w-4" />
          Continue
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

