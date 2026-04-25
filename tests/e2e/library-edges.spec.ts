import {
  test,
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { Client } from "pg";

// Edge-case coverage for the P0/P1 fixes applied in the Community Library
// v2 pass. These tests pair with `library.spec.ts` and intentionally reuse
// the same helpers / env assumptions (workers: 1, unique emails per run).

const BASE = "http://localhost:4000";
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://localhost:5432/socrates_ai";

const STRONG_PW = "TestPassword123!";

// ─── helpers (mirrors library.spec.ts) ────────────────────────────

function uniqEmail(tag: string) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `pw-${tag}-${Date.now()}-${rand}@test.local`;
}

async function registerUser(
  request: APIRequestContext,
  email: string,
  displayName: string,
): Promise<{ id: number; email: string; displayName: string }> {
  const resp = await request.post(`${BASE}/api/auth/register`, {
    data: { email, password: STRONG_PW, displayName },
  });
  expect(resp.status(), `register ${email}`).toBe(201);
  return resp.json();
}

async function loginUser(
  request: APIRequestContext,
  email: string,
): Promise<void> {
  const resp = await request.post(`${BASE}/api/auth/login`, {
    data: { email, password: STRONG_PW },
  });
  expect(resp.status(), `login ${email}`).toBe(200);
}

async function uiRegister(page: Page, email: string, displayName: string) {
  await page.goto(`${BASE}/auth`);
  await page.getByRole("tab", { name: "Register" }).click();
  await page.getByLabel(/Name/i).fill(displayName);
  await page.getByLabel(/Email/i).fill(email);
  await page.getByLabel(/Password/i).fill(STRONG_PW);
  await page.getByRole("button", { name: /Create account|Register/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), {
    timeout: 15_000,
  });
}

async function apiCreateStation(
  request: APIRequestContext,
  title: string,
): Promise<{ id: number; title: string }> {
  const body = {
    title,
    type: "history_taking",
    defaultTimeMinutes: 7,
    readingTimeMinutes: 1,
    tags: [],
    sections: [
      {
        title: "Inspection",
        order: 0,
        items: [
          {
            text: "Observe for obvious deformities",
            order: 0,
            isCritical: false,
            points: 1,
          },
        ],
      },
    ],
    examinerQuestions: [],
  };
  const resp = await request.post(`${BASE}/api/stations`, { data: body });
  expect(resp.status(), `create station '${title}'`).toBe(201);
  return resp.json();
}

async function apiCreateCollection(
  request: APIRequestContext,
  title: string,
): Promise<{ id: number; title: string }> {
  const resp = await request.post(`${BASE}/api/collections`, {
    data: { title, description: `E2E-edges ${title}` },
  });
  expect(resp.status(), `create collection '${title}'`).toBe(201);
  return resp.json();
}

async function apiPublishStation(
  request: APIRequestContext,
  stationId: number,
): Promise<void> {
  const resp = await request.post(`${BASE}/api/stations/${stationId}/publish`);
  expect(resp.status(), `publish station ${stationId}`).toBe(200);
}

async function withPg<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: DATABASE_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function promoteToAdminByEmail(email: string) {
  await withPg(async (c) => {
    await c.query("UPDATE users SET is_admin=true WHERE email=$1", [email]);
  });
}

async function newContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: BASE,
    viewport: { width: 440, height: 900 },
  });
}

// ─── Tests ────────────────────────────────────────────────────────

test.describe("Community Library — edges v2", () => {
  test("Self-invite is rejected with a clear 400", async ({ browser }) => {
    const ctx = await newContext(browser);
    const email = uniqEmail("self-invite-owner");
    await registerUser(ctx.request, email, "Self Inviter");
    const c = await apiCreateCollection(ctx.request, "E2E Self-invite");

    const resp = await ctx.request.post(
      `${BASE}/api/collections/${c.id}/invites`,
      { data: { email, role: "editor" } },
    );
    expect(resp.status()).toBe(400);
    const body = await resp.json();
    expect(body.message).toMatch(/already the owner/i);

    await ctx.close();
  });

  test("Owner viewing their own public station hides Fork and Report", async ({
    browser,
  }) => {
    const ctx = await newContext(browser);
    const page = await ctx.newPage();

    const email = uniqEmail("owner-view");
    await uiRegister(page, email, "Owner Self-viewer");

    const s = await apiCreateStation(ctx.request, "E2E Owner-view Station");
    await apiPublishStation(ctx.request, s.id);

    await page.goto(`${BASE}/library/stations/${s.id}`);
    // Station title is always visible on the public detail page.
    await expect(page.getByText("E2E Owner-view Station").first()).toBeVisible({
      timeout: 10_000,
    });

    // Fork button should be absent for the owner. The library page renders
    // a ForkButton ("Fork to my stations"); we guard it with !isOwner.
    const forkBtn = page.getByRole("button", {
      name: /fork to my stations|^fork$/i,
    });
    await expect(forkBtn).toHaveCount(0);

    // Report menu trigger is also hidden. The trigger is labelled
    // "More actions" in our UI.
    const moreTrigger = page.getByRole("button", { name: /more actions/i });
    await expect(moreTrigger).toHaveCount(0);

    await ctx.close();
  });

  test(
    "Deleting a source station preserves the fork row (forkOf becomes null)",
    async ({ browser }) => {
      const aCtx = await newContext(browser);
      const bCtx = await newContext(browser);

      const aEmail = uniqEmail("fk-source");
      const bEmail = uniqEmail("fk-fork");

      await registerUser(aCtx.request, aEmail, "Source Author");
      await registerUser(bCtx.request, bEmail, "Fork Author");

      const source = await apiCreateStation(aCtx.request, "E2E FK Source");
      await apiPublishStation(aCtx.request, source.id);

      const forkResp = await bCtx.request.post(
        `${BASE}/api/stations/${source.id}/fork`,
      );
      expect(forkResp.status()).toBe(201);
      const fork = await forkResp.json();

      // Delete the source. Without the new FK, the fork row would keep a
      // dangling forkOf; with ON DELETE SET NULL, the fork survives and
      // forkOf becomes null.
      const del = await aCtx.request.delete(`${BASE}/api/stations/${source.id}`);
      expect(del.status()).toBe(204);

      // Fork row still reachable to its owner.
      const mine = await bCtx.request.get(`${BASE}/api/stations`);
      expect(mine.status()).toBe(200);
      const list = await mine.json();
      const stillThere = list.find((x: any) => x.id === fork.id);
      expect(stillThere, "fork row survives source deletion").toBeTruthy();

      // DB-level: forkOf should now be NULL.
      const forkOf = await withPg(async (c) => {
        const r = await c.query<{ fork_of: number | null }>(
          "SELECT fork_of FROM stations WHERE id = $1",
          [fork.id],
        );
        return r.rows[0]?.fork_of ?? null;
      });
      expect(forkOf).toBeNull();

      await aCtx.close();
      await bCtx.close();
    },
  );

  test(
    "Admin can read a station removed from the library (private detail GET bypass)",
    async ({ browser }) => {
      const authorCtx = await newContext(browser);
      const adminCtx = await newContext(browser);

      const authorEmail = uniqEmail("takedown-author");
      const adminEmail = uniqEmail("takedown-admin");

      await registerUser(authorCtx.request, authorEmail, "Takedown Author");
      await registerUser(adminCtx.request, adminEmail, "Takedown Admin");
      await promoteToAdminByEmail(adminEmail);
      await loginUser(adminCtx.request, adminEmail);

      const s = await apiCreateStation(authorCtx.request, "E2E Admin-preview");
      await apiPublishStation(authorCtx.request, s.id);

      // Simulate a takedown: unpublish flips visibility back to private so
      // only the owner (or an admin) can fetch the detail row.
      const unpub = await authorCtx.request.delete(
        `${BASE}/api/stations/${s.id}/publish`,
      );
      expect(unpub.status()).toBe(200);

      // Admin can still read the now-private detail — this verifies the
      // admin bypass added to GET /api/stations/:id for moderation previews.
      const asAdmin = await adminCtx.request.get(
        `${BASE}/api/stations/${s.id}`,
      );
      expect(asAdmin.status()).toBe(200);

      // Non-owner, non-admin is rejected.
      const strangerCtx = await newContext(browser);
      const strangerEmail = uniqEmail("takedown-stranger");
      await registerUser(strangerCtx.request, strangerEmail, "Stranger");
      const asStranger = await strangerCtx.request.get(
        `${BASE}/api/stations/${s.id}`,
      );
      expect([403, 404]).toContain(asStranger.status());

      await authorCtx.close();
      await adminCtx.close();
      await strangerCtx.close();
    },
  );

  test("Collection publish → /library listing → unpublish is reversible", async ({
    browser,
  }) => {
    const ctx = await newContext(browser);
    const email = uniqEmail("coll-publish");
    await registerUser(ctx.request, email, "Coll Publisher");

    const c = await apiCreateCollection(ctx.request, "E2E Publishable Coll");

    // Needs at least one station (server gates on this for collections).
    const s = await apiCreateStation(ctx.request, "E2E Coll Member Station");
    const addResp = await ctx.request.post(
      `${BASE}/api/collections/${c.id}/stations`,
      { data: { stationId: s.id, order: 0 } },
    );
    expect(addResp.status()).toBe(201);

    // Publish.
    const pub = await ctx.request.post(
      `${BASE}/api/collections/${c.id}/publish`,
    );
    expect(pub.status()).toBe(200);

    // Appears in /api/library/collections.
    const listResp = await ctx.request.get(
      `${BASE}/api/library/collections?sort=recent&pageSize=50`,
    );
    expect(listResp.status()).toBe(200);
    const list = await listResp.json();
    const titles: string[] = list.items.map((it: any) => it.title);
    expect(titles).toContain("E2E Publishable Coll");

    // Unpublish.
    const unpub = await ctx.request.delete(
      `${BASE}/api/collections/${c.id}/publish`,
    );
    expect(unpub.status()).toBe(200);

    const after = await ctx.request.get(
      `${BASE}/api/library/collections?pageSize=50`,
    );
    const afterList = await after.json();
    const afterTitles: string[] = afterList.items.map((it: any) => it.title);
    expect(afterTitles).not.toContain("E2E Publishable Coll");

    await ctx.close();
  });

  test("StarButton is disabled while mutation is pending (UI)", async ({
    browser,
  }) => {
    const authorCtx = await newContext(browser);
    const fanCtx = await newContext(browser);

    const authorEmail = uniqEmail("star-ui-author");
    const fanEmail = uniqEmail("star-ui-fan");

    await registerUser(authorCtx.request, authorEmail, "Star UI Author");
    const s = await apiCreateStation(authorCtx.request, "E2E Star UI Station");
    await apiPublishStation(authorCtx.request, s.id);
    await authorCtx.close();

    const fanPage = await fanCtx.newPage();
    await uiRegister(fanPage, fanEmail, "Star UI Fan");

    // Slow the star POST so we can observe the disabled state.
    await fanPage.route("**/api/stations/*/star", async (route) => {
      if (route.request().method() === "POST") {
        await new Promise((r) => setTimeout(r, 800));
      }
      await route.continue();
    });

    await fanPage.goto(`${BASE}/library/stations/${s.id}`);

    const starBtn = fanPage
      .getByRole("button", { name: /star|unstar/i })
      .first();
    await expect(starBtn).toBeVisible({ timeout: 10_000 });
    await starBtn.click();
    // While the mutation is in flight the button should be disabled.
    await expect(starBtn).toBeDisabled({ timeout: 2_000 });
    // And then re-enabled once it settles.
    await expect(starBtn).toBeEnabled({ timeout: 5_000 });

    await fanCtx.close();
  });

  test("ReportDialog surfaces a dedicated 'Slow down' toast on 429", async ({
    browser,
  }) => {
    const authorCtx = await newContext(browser);
    const reporterCtx = await newContext(browser);

    const authorEmail = uniqEmail("429-author");
    const reporterEmail = uniqEmail("429-reporter");

    await registerUser(authorCtx.request, authorEmail, "429 Author");
    const s = await apiCreateStation(authorCtx.request, "E2E 429 Target");
    await apiPublishStation(authorCtx.request, s.id);
    await authorCtx.close();

    const reporterPage = await reporterCtx.newPage();
    await uiRegister(reporterPage, reporterEmail, "429 Reporter");

    // Simulate the rate-limiter firing, regardless of the server state.
    await reporterPage.route("**/api/reports", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 429,
          contentType: "application/json",
          body: JSON.stringify({
            message: "Too many requests. Please slow down.",
          }),
        });
        return;
      }
      await route.continue();
    });

    await reporterPage.goto(`${BASE}/library/stations/${s.id}`);
    // Open the More menu.
    const moreTrigger = reporterPage
      .getByRole("button", { name: /more actions/i })
      .first();
    await moreTrigger.click();
    // Click Report.
    const reportItem = reporterPage
      .getByRole("menuitem", { name: /report/i })
      .first();
    await reportItem.click();

    // Pick a reason in the select.
    const reasonTrigger = reporterPage
      .getByRole("combobox")
      .first();
    await reasonTrigger.click();
    await reporterPage
      .getByRole("option", { name: /inappropriate/i })
      .first()
      .click();

    // Submit.
    const submit = reporterPage.getByRole("button", {
      name: /submit report/i,
    });
    await submit.click();

    // Expect the specialized 429 toast copy. ReportDialog distinguishes 429
    // with "Slow down" / "You've submitted several reports recently".
    await expect(
      reporterPage.getByText(/slow down/i).first(),
    ).toBeVisible({ timeout: 5_000 });

    await reporterCtx.close();
  });
});
