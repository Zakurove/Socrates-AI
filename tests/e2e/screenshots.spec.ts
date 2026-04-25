/**
 * Screenshot harness for visual review.
 * Run with: npx playwright test tests/e2e/screenshots.spec.ts
 * Outputs to tests/e2e/screenshots/<viewport>/<name>.png
 */
import { test, type Browser, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE = "http://localhost:4000";
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://localhost:5432/socrates_ai";
const STRONG_PW = "TestPassword123!";

function uniqEmail(tag: string) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `sh-${tag}-${Date.now()}-${rand}@test.local`;
}

async function registerUser(request: APIRequestContext, email: string, displayName: string) {
  const resp = await request.post(`${BASE}/api/auth/register`, {
    data: { email, password: STRONG_PW, displayName },
  });
  if (resp.status() !== 201) {
    throw new Error(`register ${email} failed ${resp.status()}`);
  }
  return resp.json();
}

async function loginUser(request: APIRequestContext, email: string) {
  const resp = await request.post(`${BASE}/api/auth/login`, {
    data: { email, password: STRONG_PW },
  });
  if (resp.status() !== 200) throw new Error(`login ${email} ${resp.status()}`);
}

async function createStation(request: APIRequestContext, title: string) {
  const resp = await request.post(`${BASE}/api/stations`, {
    data: {
      title,
      type: "history_taking",
      defaultTimeMinutes: 7,
      readingTimeMinutes: 1,
      tags: [],
      scenario: "A patient presents with back pain after a fall.",
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
    },
  });
  if (resp.status() !== 201) throw new Error(`create station ${resp.status()}`);
  return resp.json();
}

async function createCollection(request: APIRequestContext, title: string) {
  const resp = await request.post(`${BASE}/api/collections`, {
    data: { title, description: `${title} — demo collection` },
  });
  return resp.json();
}

async function publishStation(request: APIRequestContext, id: number) {
  return request.post(`${BASE}/api/stations/${id}/publish`);
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

async function snap(
  browser: Browser,
  name: string,
  width: number,
  setup: (ctx: Awaited<ReturnType<Browser["newContext"]>>) => Promise<string>,
) {
  const ctx = await browser.newContext({
    baseURL: BASE,
    viewport: { width, height: 900 },
  });
  const url = await setup(ctx);
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(500); // let transitions settle
  const out = path.join(
    __dirname,
    "screenshots",
    process.env.SCREENSHOT_SUBDIR ?? "",
    `${width}`,
    `${name}.png`,
  );
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out, fullPage: true });
  await ctx.close();
}

// Test users are seeded inside the test so each run has fresh data.
// Screenshots are considered artifacts — no assertions run.
test.describe.configure({ mode: "serial" });

test.setTimeout(180_000);

test("take all screenshots at 440 and 1024", async ({ browser }) => {
  // One-time seed: create an admin, a publisher, published station, etc.
  const adminCtx = await browser.newContext({ baseURL: BASE });
  const publisherCtx = await browser.newContext({ baseURL: BASE });
  const viewerCtx = await browser.newContext({ baseURL: BASE });

  const adminEmail = uniqEmail("admin");
  const publisherEmail = uniqEmail("pub");
  const viewerEmail = uniqEmail("view");

  const admin = await registerUser(adminCtx.request, adminEmail, "Admin Ada");
  const publisher = await registerUser(
    publisherCtx.request,
    publisherEmail,
    "Dr. Priya",
  );
  await registerUser(viewerCtx.request, viewerEmail, "Viewer Van");

  // Promote admin
  await withPg(async (c) =>
    c.query("UPDATE users SET is_admin=true WHERE email=$1", [adminEmail]),
  );
  await loginUser(adminCtx.request, adminEmail);

  // Create published + private stations
  const published = await createStation(
    publisherCtx.request,
    "Back Pain OSCE Screen",
  );
  await publishStation(publisherCtx.request, published.id);

  const privateStn = await createStation(
    publisherCtx.request,
    "Private Draft: Knee Exam",
  );

  // Collection
  const collection = await createCollection(
    publisherCtx.request,
    "Resident OSCE Pack",
  );

  // Invite for the invite-accept screenshots
  const inv = await publisherCtx.request.post(
    `${BASE}/api/collections/${collection.id}/invites`,
    { data: { email: viewerEmail, role: "viewer" } },
  );
  const invBody = await inv.json();
  const inviteToken = invBody.inviteUrl.split("/invites/")[1];

  // Report to seed the admin queue
  await viewerCtx.request.post(`${BASE}/api/reports`, {
    data: {
      targetType: "station",
      targetId: published.id,
      reason: "Needs fact-checking",
    },
  });

  // Helper to build a context and set the session cookie from a given
  // existing request context (requires saveStorageState on each context).
  // Simpler: use the context's existing request session by creating pages
  // from that context.

  for (const width of [440, 1024]) {
    // Logged-out /library
    await snap(browser, "library-logged-out", width, async (ctx) => {
      return "/library";
    });

    // Logged-out public station
    await snap(browser, "public-station-logged-out", width, async (ctx) => {
      return `/library/stations/${published.id}`;
    });

    // Logged-out invite accept page
    await snap(browser, "invite-accept-logged-out", width, async () => {
      return `/invites/${inviteToken}`;
    });

    // Logged-out author profile
    await snap(browser, "author-profile-public", width, async () => {
      return `/u/${publisher.id}`;
    });

    // Now logged-in variants. Clone the context's storage state.
    const pubState = await publisherCtx.storageState();
    const viewerState = await viewerCtx.storageState();
    const adminState = await adminCtx.storageState();

    // Publisher-logged-in /my-stations (has content)
    {
      const ctx = await browser.newContext({
        baseURL: BASE,
        viewport: { width, height: 900 },
        storageState: pubState,
      });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/my-stations`);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await page.waitForTimeout(400);
      const out = path.join(
        __dirname,
        "screenshots",
        process.env.SCREENSHOT_SUBDIR ?? "",
        `${width}`,
        `my-stations-with-content.png`,
      );
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await page.screenshot({ path: out, fullPage: true });
      await ctx.close();
    }

    // Viewer /my-stations (empty)
    {
      const ctx = await browser.newContext({
        baseURL: BASE,
        viewport: { width, height: 900 },
        storageState: viewerState,
      });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/my-stations`);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await page.waitForTimeout(400);
      const out = path.join(
        __dirname,
        "screenshots",
        process.env.SCREENSHOT_SUBDIR ?? "",
        `${width}`,
        `my-stations-empty.png`,
      );
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await page.screenshot({ path: out, fullPage: true });
      await ctx.close();
    }

    // Viewer /collections (empty - no owned)
    {
      const ctx = await browser.newContext({
        baseURL: BASE,
        viewport: { width, height: 900 },
        storageState: viewerState,
      });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/collections`);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await page.waitForTimeout(400);
      const out = path.join(
        __dirname,
        "screenshots",
        process.env.SCREENSHOT_SUBDIR ?? "",
        `${width}`,
        `collections-empty.png`,
      );
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await page.screenshot({ path: out, fullPage: true });
      await ctx.close();
    }

    // Publisher /collections (with content)
    {
      const ctx = await browser.newContext({
        baseURL: BASE,
        viewport: { width, height: 900 },
        storageState: pubState,
      });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/collections`);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await page.waitForTimeout(400);
      const out = path.join(
        __dirname,
        "screenshots",
        process.env.SCREENSHOT_SUBDIR ?? "",
        `${width}`,
        `collections-with-content.png`,
      );
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await page.screenshot({ path: out, fullPage: true });
      await ctx.close();
    }

    // Publisher collection detail (owner)
    {
      const ctx = await browser.newContext({
        baseURL: BASE,
        viewport: { width, height: 900 },
        storageState: pubState,
      });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/collections/${collection.id}`);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await page.waitForTimeout(400);
      const out = path.join(
        __dirname,
        "screenshots",
        process.env.SCREENSHOT_SUBDIR ?? "",
        `${width}`,
        `collection-detail-owner.png`,
      );
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await page.screenshot({ path: out, fullPage: true });
      await ctx.close();
    }

    // Logged-in public station (non-owner — viewer)
    {
      const ctx = await browser.newContext({
        baseURL: BASE,
        viewport: { width, height: 900 },
        storageState: viewerState,
      });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/library/stations/${published.id}`);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await page.waitForTimeout(400);
      const out = path.join(
        __dirname,
        "screenshots",
        process.env.SCREENSHOT_SUBDIR ?? "",
        `${width}`,
        `public-station-logged-in.png`,
      );
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await page.screenshot({ path: out, fullPage: true });
      await ctx.close();
    }

    // Invite accept signed-in correct email
    {
      const ctx = await browser.newContext({
        baseURL: BASE,
        viewport: { width, height: 900 },
        storageState: viewerState,
      });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/invites/${inviteToken}`);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await page.waitForTimeout(400);
      const out = path.join(
        __dirname,
        "screenshots",
        process.env.SCREENSHOT_SUBDIR ?? "",
        `${width}`,
        `invite-accept-signed-in.png`,
      );
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await page.screenshot({ path: out, fullPage: true });
      await ctx.close();
    }

    // Settings (publisher) — bio section
    {
      const ctx = await browser.newContext({
        baseURL: BASE,
        viewport: { width, height: 900 },
        storageState: pubState,
      });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/settings`);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await page.waitForTimeout(400);
      const out = path.join(
        __dirname,
        "screenshots",
        process.env.SCREENSHOT_SUBDIR ?? "",
        `${width}`,
        `settings-bio.png`,
      );
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await page.screenshot({ path: out, fullPage: true });
      await ctx.close();
    }

    // Admin reports page
    {
      const ctx = await browser.newContext({
        baseURL: BASE,
        viewport: { width, height: 900 },
        storageState: adminState,
      });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/admin/reports`);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await page.waitForTimeout(700);
      const out = path.join(
        __dirname,
        "screenshots",
        process.env.SCREENSHOT_SUBDIR ?? "",
        `${width}`,
        `admin-reports.png`,
      );
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await page.screenshot({ path: out, fullPage: true });
      await ctx.close();
    }

    // Home with community card (publisher)
    {
      const ctx = await browser.newContext({
        baseURL: BASE,
        viewport: { width, height: 900 },
        storageState: pubState,
      });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/home`);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await page.waitForTimeout(400);
      const out = path.join(
        __dirname,
        "screenshots",
        process.env.SCREENSHOT_SUBDIR ?? "",
        `${width}`,
        `home-with-community.png`,
      );
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await page.screenshot({ path: out, fullPage: true });
      await ctx.close();
    }
  }

  await adminCtx.close();
  await publisherCtx.close();
  await viewerCtx.close();
});
