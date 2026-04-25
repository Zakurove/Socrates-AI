/**
 * Quick responsive sweep — renders a few key pages at 375 and 768 and
 * verifies there's no horizontal scroll (document.scrollWidth <= viewport).
 */
import { test, expect, type Browser } from "@playwright/test";

const BASE = "http://localhost:4000";
const STRONG_PW = "TestPassword123!";

function uniqEmail(tag: string) {
  return `r-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
}

async function seed(browser: Browser) {
  const ctx = await browser.newContext({ baseURL: BASE });
  const email = uniqEmail("resp");
  const reg = await ctx.request.post(`${BASE}/api/auth/register`, {
    data: { email, password: STRONG_PW, displayName: "Resp Tester" },
  });
  expect(reg.status()).toBe(201);
  const user = await reg.json();
  // publish a station so /library has content
  const s = await ctx.request.post(`${BASE}/api/stations`, {
    data: {
      title: "Resp sweep station",
      type: "history_taking",
      defaultTimeMinutes: 7,
      readingTimeMinutes: 1,
      tags: [],
      sections: [
        {
          title: "S1",
          order: 0,
          items: [
            { text: "item", order: 0, isCritical: false, points: 1 },
          ],
        },
      ],
      examinerQuestions: [],
    },
  });
  const stationBody = await s.json();
  await ctx.request.post(`${BASE}/api/stations/${stationBody.id}/publish`);

  const state = await ctx.storageState();
  await ctx.close();
  return { email, state, stationId: stationBody.id, userId: user.id };
}

for (const width of [375, 768]) {
  test(`no horizontal scroll on public pages @ ${width}px`, async ({
    browser,
  }) => {
    const { state, stationId, userId } = await seed(browser);
    const ctx = await browser.newContext({
      baseURL: BASE,
      viewport: { width, height: 900 },
      storageState: state,
    });
    const page = await ctx.newPage();

    const pages = [
      "/home",
      "/my-stations",
      "/collections",
      "/library",
      `/library/stations/${stationId}`,
      `/u/${userId}`,
      "/settings",
    ];

    for (const p of pages) {
      await page.goto(`${BASE}${p}`);
      await page
        .waitForLoadState("networkidle", { timeout: 10_000 })
        .catch(() => undefined);
      const { sw, cw } = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
      }));
      // scrollWidth may be a hair larger due to subpixel rounding — allow 1px slop.
      expect(sw, `horizontal overflow on ${p}`).toBeLessThanOrEqual(cw + 1);
    }
    await ctx.close();
  });
}
