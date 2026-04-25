# Frontend

React 18 + Vite + TypeScript. Styling with Tailwind + shadcn/ui (Radix primitives). Routing via
`wouter`. Server state via TanStack React Query v5. No Redux, no Zustand, no context for server
state — React Query owns the cache.

All source lives under `client/src/`. The server serves the Vite dev middleware in development
and the built bundle from `dist/public` in production. The React app never holds an API key —
every AI call proxies through the Express backend.

## Entry points

- `client/index.html` — static shell, loads `src/main.tsx`.
- `client/src/main.tsx` — mounts `<App />` and registers the service worker (PWA).
- `client/src/App.tsx` — top-level provider stack, route table, layout chrome.
- `client/public/manifest.webmanifest` — PWA manifest. Theme color `#5A2E9A`, background
  `#FAFAF9`, 512x512 icon at `/brand/icon.png`.

## Provider stack

From outermost to innermost:

```
<ErrorBoundary>
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      {layoutChrome}                 // phone-frame or wide-route wrapper
      <Toaster />
    </TooltipProvider>
  </QueryClientProvider>
</ErrorBoundary>
```

- `ErrorBoundary` (`client/src/components/ErrorBoundary.tsx`) catches render errors and shows a
  recovery card without blowing away the whole tab.
- `QueryClientProvider` provides the singleton from `client/src/lib/queryClient.ts`.
- `TooltipProvider` is Radix's tooltip root; required once near the top of the tree.
- `<Toaster />` is the shadcn toast viewport.

## Routing

`App.tsx` uses `wouter`'s `<Switch>` + `<Route>`. Every route except `/auth*` and
`/invites/:token` is wrapped in `<ProtectedRoute>`, which reads `useAuth().user` and redirects
to `/auth?from=<path>` when unauthenticated.

Route table (see `client/src/App.tsx`):

| Path | Page | Protected |
| --- | --- | --- |
| `/auth` | `AuthPage` | no |
| `/auth/forgot` | `ForgotPasswordPage` | no |
| `/auth/reset/:token` | `ResetPasswordPage` | no |
| `/home` | `HomePage` | yes |
| `/my-stations` | `MyStationsPage` | yes |
| `/collections` | `CollectionsPage` | yes |
| `/collections/:id` | `CollectionDetailPage` | yes |
| `/invites/:token` | `InviteAcceptPage` | public preview |
| `/library` | `LibraryPage` | yes |
| `/library/stations/:id` | `PublicStationPage` | yes |
| `/library/collections/:id` | `PublicCollectionPage` | yes |
| `/u/:userId` | `AuthorProfilePage` | yes |
| `/admin/reports` | `AdminReportsPage` | yes + admin-in-page guard |
| `/station/new` | `StationEditorPage` | yes |
| `/station/:id/edit` | `StationEditorPage` | yes |
| `/station/:id/practice` | `PracticeModePage` | yes |
| `/station/:id/ai-practice` | `AIPracticeModePage` | yes |
| `/station/:id` | `StationDetailPage` | yes |
| `/session/:id/results` | `ResultsPage` | yes |
| `/progress` | `ProgressPage` | yes |
| `/mock-exam` | `MockExamsPage` | yes |
| `/mock-exam/new` | `MockExamNewPage` | yes |
| `/mock-exam/:id/results` | `MockExamResultsPage` | yes |
| `/mock-exams/:id` | `MockExamDetailPage` | yes |
| `/mock-exam/:id` | `MockExamRunnerPage` | yes |
| `/settings` | `SettingsPage` | yes |
| `/` | redirect → `/home` | — |
| `*` | 404 fallback | — |

Every page is `React.lazy`-imported with a `<Suspense fallback={<PageLoader />}>` at the route
boundary. First paint of `/home` ships the minimum necessary bundle.

## Layout chrome — 440 px phone-frame

The app is designed mobile-first and intentionally clamped to a 440 px column on desktop. From
`App.tsx`:

- `fullBleed` (auth pages) render without any frame.
- Wide routes — `/library*`, `/u/*`, `/admin/*` — render inside a 960 px column so tables and
  grids can breathe on desktop.
- Everything else renders inside `.phone-frame`, a 440 px column with a subtle backdrop
  (`.app-backdrop`).

```tsx
{fullBleed ? (
  <AppRoutes />
) : isWideRoute ? (
  <div className="app-backdrop">
    <div className="max-w-[960px] mx-auto bg-background">
      <AppRoutes />
    </div>
  </div>
) : (
  <div className="app-backdrop">
    <div className="phone-frame max-w-[440px] mx-auto bg-background">
      <AppRoutes />
    </div>
  </div>
)}
```

This is deliberate — the product target is a mobile app. Keeping the visual language fixed to a
phone-sized column during the web R&D phase means the eventual port to React Native / Swift
will not require redesign. `BottomNav` clamps itself to 440 px independently so it aligns with
the frame when present.

## React Query setup

`client/src/lib/queryClient.ts` holds the singleton `QueryClient`.

- `defaultQueryFn` reads the first element of `queryKey` as a URL and calls `fetch` with
  `credentials: "include"`. Every hook just writes `useQuery({ queryKey: ["/api/stations"] })`
  and inherits the default.
- `apiRequest(method, url, data?)` is a thin `fetch` wrapper used inside mutations. Sends
  credentials, sets `Content-Type: application/json` when a body is present, throws on
  non-2xx with `${status}: ${message}`.
- `staleTime: 5 minutes` — navigation back and forth does not spam the server.
- `refetchOnWindowFocus: false` — the app is practice-session-oriented; a refetch mid-question
  would be disruptive.
- `retry: false` on queries and mutations — failures surface immediately, so the UI can decide
  whether to show a toast, an inline error, or a dialog.

### 401 handling

Both `queryCache` and `mutationCache` register an `onError` hook that calls `handle401`:

```ts
if (!error.message.startsWith("401")) return;
// Auth-page 401s are normal (bad password). Leave state alone.
if (window.location.pathname.startsWith("/auth")) return;
queryClient.setQueryData(["/api/auth/me"], null);
window.dispatchEvent(new CustomEvent("socrates:session-expired", {
  detail: { from: window.location.pathname + window.location.search },
}));
```

`App.tsx` listens for the event, shows a "Session expired" toast, and navigates to
`/auth?from=<safe path>`. `ProtectedRoute` sees `user === null` and emits `<Redirect>` so
wouter keeps the SPA state instead of doing a hard reload (no flash, no lost form state).

## Hook layer

Domain-specific hooks in `client/src/hooks/` wrap React Query so pages stay thin.

| Hook | Responsibility |
| --- | --- |
| `use-auth.ts` | `useAuth()` — fetches `/api/auth/me`, exposes `login`, `register`, `logout`, `refresh`. |
| `use-stations.ts` | Station list + detail queries, create/update/delete/publish/unpublish mutations. |
| `use-collections.ts` | Owned + shared-with-me lists, detail, CRUD. |
| `use-collection-members.ts` | Member list + role mutations + invites list. |
| `use-invites.ts` | Invite preview + accept. |
| `use-sessions.ts` | Session list, detail, create, finalize, result writes. |
| `use-mock-exams.ts` | Templates, attempts, advance / abort, results. |
| `use-library.ts` | Public listing + detail with star decoration. |
| `use-publish.ts` | Publish / unpublish with invalidation of `/api/stations` and `/api/library/*`. |
| `use-fork.ts` | Fork mutations + success routing to the new row. |
| `use-stars.ts` | Idempotent POST/DELETE star mutations with optimistic updates. |
| `use-reports.ts` | Submit a report. |
| `use-author-profile.ts` | `/api/users/:id` public profile. |
| `use-admin.ts` | Report queue + triage actions. |
| `use-prefs.ts` | Local UI prefs (theme, TTS toggle, etc.) in localStorage. |
| `useMediaRecorder.ts` | MediaRecorder wrapper used by narration + free-form transcribe. |
| `useChecklistMatcher.ts` | Rolling-transcript → `/api/practice/:id/check` debounced client. |
| `useNarrationMode.ts` | Coordinates MediaRecorder + transcription + matcher into one state machine. |
| `useGeminiLive.ts` | WS client for real-time voice. Handles persona switch, mic mute, playback. |

Mutations almost always invalidate the paired list query. Example:

```ts
const m = useMutation({
  mutationFn: (data) => apiRequest("POST", "/api/stations", data),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/stations"] }),
});
```

## State machines (practice modes)

Three practice modes, three small state machines.

### Self-check

Driven by local state inside `PracticeModePage`. Ticking an item calls
`POST /api/sessions/:id/item-results`. Timer is a simple `setInterval`; no audio.

### AI Listen (narration)

`useNarrationMode` composes three concerns:

1. `useMediaRecorder` emits rolling audio chunks.
2. Every N seconds of silence the chunk is POSTed to `/api/practice/:id/transcribe`
   (Whisper, forced English).
3. The rolling transcript is pushed into `useChecklistMatcher`, which debounces calls to
   `/api/practice/:id/check`. The matcher returns `{ hits: [itemId, ...], confidences: [...] }`
   and the UI ticks items as they light up.

State stays client-side during the session. Final writes happen when the user ends — the page
POSTs a batch of `item_results` and calls `PUT /api/sessions/:id` with `status:"completed"`.

### AI Conversation

`useGeminiLive` owns the WebSocket lifecycle.

1. `POST /api/gemini/session` returns a `sessionId` and persona config.
2. Client opens `ws://.../api/gemini/ws/:sessionId`. The server validates the session cookie on
   upgrade.
3. Mic audio is captured at 16 kHz, downsampled, and written to the WS as binary frames.
4. Gemini's streamed audio (24 kHz) is queued into an `AudioBufferSourceNode` pipeline.
   Transcription events (both input and output) append to an in-UI log.
5. Persona switch (`/api/gemini/switch-persona/:id`) and prime
   (`/api/gemini/prime/:id`) are plain HTTP calls; the WS stays open.
6. On end, `DELETE /api/gemini/session/:id` closes the Live session and flushes cost.

All three modes end the same way — results are computed server-side from `item_results` and
`examiner_question_results`, and the UI navigates to `/session/:id/results`.

## Editor architecture

`StationEditorPage` is the heaviest page in the app. Key concerns:

- Walks the user through a type selector, then scenario, then a section-by-section checklist
  editor. Items can have sub-items two levels deep; the schema in `shared/schema.ts` enforces
  the depth.
- Draft caching: `client/src/lib/editor-draft.ts` persists the form state to localStorage on
  every change (throttled). A tab crash does not destroy work. Drafts are garbage-collected
  via `gcPracticeStorage` when older than 7 days — called once per App mount.
- Media upload: JPEG/PNG/WebP, 5 MB, round-tripped through `/api/uploads/image` and attached to
  items via `itemMedia` rows.
- Patient briefing (history / communication stations) is a separate, hidden textarea. Never
  shown in practice — it is the entire reality the AI patient works from.
- Publish from editor requires title + at least one item or one examiner question; the UI
  mirrors the server's 422 check in `POST /api/stations/:id/publish` so the button stays
  disabled until the requirement is met.

## Brand tokens and visual language

See `Documentation/BRAND_GUIDELINES.md` for the full system. Key points from the code:

- `client/src/index.css` declares semantic HSL tokens — `--primary`, `--background`,
  `--brand-accent`, etc. Dark mode overrides the same tokens under `.dark`.
- `tailwind.config.ts` extends the palette with an Owl Purple ramp (50–900) and a Wisdom Amber
  ramp (100/400/500/600). Shadows and type scale are defined there too.
- Destructive color is a deep warm brown — no red in the product at all.
- The phone-frame pairs with `.app-backdrop`, a subtle radial-gradient desktop surface, so the
  clamped column never feels like a floating rectangle.

## Testing

Playwright drives the browser at 440x900. See `playwright.config.ts` and
`Documentation/TESTING.md`. Library flows (`tests/e2e/library.spec.ts`,
`tests/e2e/library-edges.spec.ts`) exercise publish, fork, report, and the admin queue.

## Where to go next

- Brand tokens and usage: `Documentation/BRAND_GUIDELINES.md`.
- How the AI hooks line up with server routes: `Documentation/AI_ARCHITECTURE.md`.
- Every route the hooks call: `Documentation/API_REFERENCE.md`.
