# Testing

End-to-end tests are the only tests the project ships. The philosophy: unit-test what is hard
to get right (scoring, transaction invariants), end-to-end-test what the user actually does.
Playwright owns the "what the user does" half; the "hard to get right" half is a small set of
pure-function unit tests under `shared/`.

## Stack

- **Playwright** (`@playwright/test`) for browser-driven E2E. Config at
  `playwright.config.ts`.
- **TypeScript + tsx** at runtime — no separate build step for tests.
- **PostgreSQL** in a local Docker container, or any reachable Postgres for CI (the Railway dev branch DB works for ad-hoc remote runs).

## Layout

```
tests/
└── e2e/
    ├── library.spec.ts            # publish, fork, star, report — happy paths
    ├── library-edges.spec.ts      # fork-your-own, unauth library read, admin removal
    ├── responsive.spec.ts         # 440 phone vs 960 wide-route rendering
    ├── screenshots.spec.ts        # visual-regression / marketing screenshot capture
    └── screenshots/               # output directory for screenshots.spec.ts
playwright.config.ts
```

## Running the suite

The server and Playwright run in two terminals. Playwright does not launch the server — the
test runs against a long-lived dev server so database state accumulates realistically.

### Terminal 1 — start the server

```bash
RATE_LIMIT_DISABLED=1 npm run dev
```

The flag disables the `authLimiter`, `generalLimiter`, and `reportLimiter` so the test suite
can register dozens of users and submit many reports without tripping the 5/15min cap. AI and
spend-cap limiters always apply.

The flag only takes effect when `NODE_ENV !== "production"` — `server/middleware/rate-limit.ts`
hard-codes the production check.

### Terminal 2 — run tests

```bash
npx playwright test                      # full suite
npx playwright test library.spec.ts      # one spec
npx playwright test -g "fork"            # pattern match
npx playwright test --headed             # watch the browser
npx playwright test --debug              # Playwright Inspector
```

Traces are retained on failure (`trace: "retain-on-failure"` in config) so a CI failure can be
replayed in `playwright show-trace`.

## Configuration

From `playwright.config.ts`:

| Setting | Value | Rationale |
| --- | --- | --- |
| `testDir` | `./tests/e2e` | All specs colocated. |
| `timeout` | 45 s | Flake-tolerant but not unbounded. |
| `expect.timeout` | 10 s | Default wait for `expect(locator).toBeVisible()` etc. |
| `fullyParallel` | `false` | Library tests share a DB; races would cause spurious failures. |
| `workers` | 1 | Same reason. |
| `retries` | 0 | Flaky-on-retry is a test bug, not a signal to paper over. |
| `viewport` | 440 x 900 | Matches the production phone-frame. Individual tests override. |
| `baseURL` | `http://localhost:4000` | Matches the dev server's default `PORT`. |
| `actionTimeout` | 10 s | Keeps UI waits bounded when an assertion does not fire. |

Only one project is defined — Desktop Chrome at 440x900. Mobile Safari and Firefox are not
wired up because the app targets mobile via native port, not via browser vendors.

## Fixtures and helpers

The suite is deliberately low on fixtures. Tests create their own users and stations inline
so failures are self-contained and readable.

- `registerUser(page, email?)` — walks through `/auth` and signs up.
- `createStation(page, { title, sections })` — navigates to `/station/new` and submits.
- `publishStation(page, stationId)` — opens publish dialog, checks the three attestations,
  submits.

Utilities live at the top of each spec file. Shared fixtures were considered and rejected —
Playwright fixtures have enough implicit behavior that one extra click in a fixture can
silently change every test's initial state.

## What is tested

Community library flows drive the bulk of coverage because they are the most reachable
high-risk surface.

| Spec | Flow |
| --- | --- |
| `library.spec.ts` | Register two users → user A publishes a station → user B browses the library, opens the detail, stars, forks → user A sees bumped counters. |
| `library.spec.ts` | Unpublish removes the station from library listings but preserves the forked copy. |
| `library.spec.ts` | Report a station → admin sees it in `/admin/reports` → admin resolves as "removed" → station flips to private. |
| `library-edges.spec.ts` | Fork-your-own returns 422 with `code:"self_fork"` and renders an error toast. |
| `library-edges.spec.ts` | Publish without content returns 422 `min_content` and the UI keeps the Publish button in an actionable state. |
| `library-edges.spec.ts` | Last-owner demotion of a collection returns 422 `last_owner`. |
| `responsive.spec.ts` | Wide routes (`/library`, `/u/:id`, `/admin/*`) render in a 960 px column; all others stay in the 440 px phone-frame. |
| `screenshots.spec.ts` | Captures marketing-quality screenshots at consistent states (home, station detail, library, results). |

## What is not tested

- **AI model responses.** Mocking a streaming LLM is fiddly and fragile. Narration and Gemini
  Live are exercised manually.
- **Whisper transcription accuracy.** The call-site rule (force `language:"en"`) is exercised
  in code review and verified by the server logs.
- **Payment / billing.** No billing in v1.
- **Email delivery.** Resend returns a receipt; actual inbox delivery is out of scope.

## Unit tests

A handful of pure-function tests live alongside the shared modules:

| Module | Coverage |
| --- | --- |
| `shared/scoring.ts` | `computeCompositeScore` — leaf rollup, critical-miss weighting, weighted averages. |
| `shared/ai-models.ts` | `estimateCostUsd` — token math to the cent across every model in `MODEL_PRICING`. |
| `server/services/session-scoring.ts` | `countLeafItems` / `collectLeafItemIds` — recursion correctness on 2-level trees. |

Run with:

```bash
npm run check    # tsc --noEmit — type-check
# Dedicated unit test runner is not yet wired; see roadmap below.
```

## Roadmap

- Add `vitest` for the unit tests above — currently they are executed ad-hoc.
- Visual-regression baseline for `screenshots.spec.ts` once the design stabilises.
- Contract tests against the OpenAI + Gemini clients using recorded fixtures (keeps CI cheap).
- CI wiring in GitHub Actions with a Postgres service container.

## Tips

- Playwright's `page.pause()` drops into the Inspector mid-test — extremely useful when
  chasing a flake.
- `page.on("console", (m) => console.log(m.text()))` surfaces the client console in the test
  terminal. Wire it at the top of a spec when debugging a silent failure.
- If a test hangs on `networkidle`, remove the `networkidle` wait and use `expect(locator)`
  assertions. The app has enough long-poll and WS connections that `networkidle` is almost
  never a reliable signal here.
- If `RATE_LIMIT_DISABLED=1` is forgotten, the first few registrations work and then the
  suite 429s silently. Always check the server terminal when the first auth failure appears.

## Where to go next

- Env var checklist and dev bootstrap: `Documentation/DEPLOYMENT.md`.
- Route behavior the tests assert: `Documentation/API_REFERENCE.md`.
