/**
 * Canonical "parent of" mapping for in-app back buttons. Never use
 * `navigate(-1)` from a page entry point — a deep link has no history and
 * the user would fall out of the SPA. This function gives every route a
 * deterministic parent.
 *
 * Callers may also pass an optional `from` — typically read from a
 * `?from=` query param that the originating page threaded through. When
 * `from` is a safe in-app path, prefer it over the default parent so
 * lateral navigation (library → public station → back) lands where the
 * user expects.
 */
export const ROOT_ROUTES = [
  "/home",
  "/my-stations",
  "/collections",
  "/library",
  "/mock-exam",
  "/settings",
  "/progress",
] as const;

export function parentOf(pathname: string): string {
  // Editor
  if (pathname === "/station/new") return "/my-stations";
  const editMatch = pathname.match(/^\/station\/(\d+)\/edit$/);
  if (editMatch) return `/station/${editMatch[1]}`;

  // Practice runners
  const practiceMatch = pathname.match(/^\/station\/(\d+)\/(?:ai-)?practice$/);
  if (practiceMatch) return `/station/${practiceMatch[1]}`;

  // Station detail
  if (/^\/station\/\d+$/.test(pathname)) return "/my-stations";

  // Session results — parent is the station, not the just-ended practice.
  // ResultsPage passes its own stationId; this is a fallback.
  if (/^\/session\/\d+\/results$/.test(pathname)) return "/home";

  // Collections
  if (/^\/collections\/\d+$/.test(pathname)) return "/collections";

  // Library
  if (/^\/library\/stations\/\d+$/.test(pathname)) return "/library";
  if (/^\/library\/collections\/\d+$/.test(pathname)) return "/library";
  if (/^\/u\/[^/]+$/.test(pathname)) return "/library";

  // Mock exams
  if (pathname === "/mock-exam/new") return "/mock-exam";
  const mockResultsMatch = pathname.match(/^\/mock-exam\/(\d+)\/results$/);
  if (mockResultsMatch) return `/mock-exams/${mockResultsMatch[1]}`;
  const mockRunnerMatch = pathname.match(/^\/mock-exam\/(\d+)$/);
  if (mockRunnerMatch) return `/mock-exams/${mockRunnerMatch[1]}`;
  if (/^\/mock-exams\/\d+$/.test(pathname)) return "/mock-exam";

  // Admin is only reachable from Settings.
  if (pathname === "/admin/reports") return "/settings";

  // Invites (auth-less landing).
  if (pathname.startsWith("/invites/")) return "/home";

  // Auth sub-pages.
  if (pathname.startsWith("/auth/")) return "/auth";

  return "/home";
}

/**
 * Returns `from` if it's a safe in-app path; otherwise falls back.
 * Mirrors the guard used by AuthPage for the `from` query param.
 */
export function safeFrom(from: string | null | undefined, fallback: string): string {
  if (!from) return fallback;
  if (!from.startsWith("/") || from.startsWith("//")) return fallback;
  if (from.startsWith("/auth")) return fallback;
  return from;
}

/**
 * Routes where `BottomNav` must not render. Immersive practice flows,
 * editors, auth, and the invite-accept landing should own the whole
 * viewport.
 */
// Truly-immersive routes: full viewport, no nav. These are practice runners,
// editors, and the auth shell. Detail / browse pages (station detail, mock
// exam detail, public station/collection, results) are NOT immersive — they
// keep the SideNav at lg+ so users can navigate while reading. They still
// hide the BottomNav at <lg because they own their own bottom CTA, but the
// desktop sidebar is always visible.
const HIDE_BOTTOM_NAV_PATTERNS: RegExp[] = [
  /^\/auth(\/.*)?$/,
  /^\/invites\/.+$/,
  /^\/station\/new$/,
  /^\/station\/\d+\/edit$/,
  /^\/station\/\d+\/practice$/,
  /^\/station\/\d+\/ai-practice$/,
  /^\/mock-exam\/new$/,
  /^\/mock-exam\/\d+$/, // runner (singular path = active session)
];

// Routes that keep the SideNav at lg+ but still hide the BottomNav at <lg
// (because they own their own bottom CTA on mobile). At desktop they look
// like regular content pages.
const HIDE_BOTTOM_NAV_KEEP_SIDENAV_PATTERNS: RegExp[] = [
  /^\/station\/\d+$/,
  /^\/mock-exams\/\d+$/,
  /^\/library\/stations\/\d+$/,
  /^\/library\/collections\/\d+$/,
];

export function shouldHideBottomNav(pathname: string): boolean {
  return (
    HIDE_BOTTOM_NAV_PATTERNS.some((r) => r.test(pathname)) ||
    HIDE_BOTTOM_NAV_KEEP_SIDENAV_PATTERNS.some((r) => r.test(pathname))
  );
}

/**
 * Is this an immersive runner / editor / auth route — i.e. the SideNav must
 * also be hidden at lg+? Subset of `shouldHideBottomNav`.
 */
export function shouldHideSideNav(pathname: string): boolean {
  return HIDE_BOTTOM_NAV_PATTERNS.some((r) => r.test(pathname));
}
