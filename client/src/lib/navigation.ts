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
const HIDE_BOTTOM_NAV_PATTERNS: RegExp[] = [
  /^\/auth(\/.*)?$/,
  /^\/invites\/.+$/,
  /^\/station\/new$/,
  /^\/station\/\d+$/, // station detail — has its own Practice CTA at bottom
  /^\/station\/\d+\/edit$/,
  /^\/station\/\d+\/practice$/,
  /^\/station\/\d+\/ai-practice$/,
  /^\/mock-exam\/new$/,
  /^\/mock-exam\/\d+$/, // runner (not /mock-exams/:id — note singular)
  /^\/mock-exams\/\d+$/, // mock exam detail — has its own Start CTA at bottom
  /^\/library\/stations\/\d+$/, // public station — has its own Fork CTA
  /^\/library\/collections\/\d+$/, // public collection — has its own Fork CTA
];

export function shouldHideBottomNav(pathname: string): boolean {
  return HIDE_BOTTOM_NAV_PATTERNS.some((r) => r.test(pathname));
}
