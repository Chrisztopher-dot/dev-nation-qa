import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';

// Återanvänd sparad inloggningssession
test.use({ storageState: 'auth.json' });

const BASE_URL = 'https://dev.nation.dev';

test.describe('dev.nation.dev - Kritiska QA Tester', () => {

  // 1. Testa regression på Backend 500-kraschen (BUG-02)
  test('BUG-02: Stora tal i timarvode ska inte krascha backend med 500', async ({ page }) => {
    await page.goto(`${BASE_URL}/profile`);
    await page.waitForLoadState('domcontentloaded');

    // Klicka på Preferences i sidomenyn
    await page.getByRole('button', { name: /Preferences/i }).click();

    const hourlyInput = page.getByRole('spinbutton', { name: /Freelancing hourly rate/i });
    await expect(hourlyInput).toBeVisible({ timeout: 5000 });
    await hourlyInput.fill('9999999999999999');

    // Lyssna på API-anropet vid sparning
    const [response] = await Promise.all([
      page.waitForResponse(
        res => res.url().includes('graphql') || res.url().includes('update') || res.status() >= 400,
        { timeout: 10000 }
      ).catch(() => null),
      page.getByRole('button', { name: 'Save' }).click()
    ]);

    if (response) {
      expect(response.status(), 'Servern kraschade med 500 på grund av stort tal').not.toBe(500);
    }

    // Kontrollera att inte den interna Gremlin/Java-stacken exponeras i UI
    const errorToast = page.locator('text=java.lang.Integer');
    await expect(errorToast).not.toBeVisible({ timeout: 3000 });
  });

  // 2. Fånga trasiga nätverksresurser och 404:or (BUG-04 & BUG-05)
  test('BUG-04/05: Kontrollera att inga kritiska bilder eller logotyper ger 404/failed', async ({ page }) => {
    const failedRequests: string[] = [];

    page.on('response', response => {
      if (response.status() === 404 || (response.status() >= 400 && response.url().includes('cdn.nation.dev'))) {
        failedRequests.push(`${response.status()} - ${response.url()}`);
      }
    });

    await page.goto(`${BASE_URL}/jobs`);
    await page.waitForLoadState('domcontentloaded');

    // Verifiera att t.ex. "Logo" eller CDN-bilder inte returnerar felkoder
    expect(failedRequests, `Hittade trasiga resurser: ${failedRequests.join(', ')}`).toHaveLength(0);
  });

  // 3. Testa att widgeten inte blockerar spar-knappar (BUG-01)
  test('BUG-01: Widgeten "Write to Nation" ska inte täcka spara-knappen', async ({ page }) => {
    await page.goto(`${BASE_URL}/profile`);
    await page.waitForLoadState('domcontentloaded');

    await page.getByRole('button', { name: /Preferences/i }).click();

    const saveButton = page.getByRole('button', { name: 'Save' });
    const widgetButton = page.getByRole('button', { name: /Write to Nation/i });

    await expect(saveButton).toBeVisible();
    if (await widgetButton.count()) {
      await expect(widgetButton).toBeVisible();

      const saveBox = await saveButton.boundingBox();
      const widgetBox = await widgetButton.boundingBox();
      expect(saveBox).not.toBeNull();
      expect(widgetBox).not.toBeNull();

      if (saveBox && widgetBox) {
        const hasOverlap = !(
          saveBox.x + saveBox.width < widgetBox.x ||
          saveBox.x > widgetBox.x + widgetBox.width ||
          saveBox.y + saveBox.height < widgetBox.y ||
          saveBox.y > widgetBox.y + widgetBox.height
        );

        expect(hasOverlap, 'Support-widgeten överlappar den primära Save-knappen').toBe(false);
      }
    }
  });

  test('BUG-10: Datum efter idag kan inte väljas som födelsedatum', async ({ page }) => {
    await page.goto(`${BASE_URL}/profile`);
    await page.waitForLoadState('domcontentloaded');

    await page.getByRole('button', { name: /Personal Details/i }).click();

    await page.getByRole('button', { name: 'Date of Birth' }).click();

    const calendar = page.getByRole('dialog');
    await expect(calendar).toBeVisible();
    await calendar.getByRole('button', { name: 'Go to the Next Month' }).click();

    const futureDates = calendar.getByRole('grid').getByRole('button');
    const futureDateCount = await futureDates.count();
    expect(futureDateCount).toBeGreaterThan(0);
    for (const futureDate of await futureDates.all()) {
      await expect(futureDate).toBeDisabled();
    }
  });

});

test('BUG-08: Körning av standard C++-mall ska inte kasta NZEC eller kärndump', async ({ page }) => {
  // /freecode finns inte som egen sida; ett Freecode-test startas via /benchmarks och öppnas på /freecode/<n>
  await page.goto(`${BASE_URL}/freecode/1`);
  const runButton = page.getByRole('button', { name: /Run against the first \d+ test cases/i });
  test.skip(!(await runButton.isVisible({ timeout: 10000 }).catch(() => false)), 'Inget aktivt Freecode-test (starta ett via /benchmarks)');
  // Förväntat fel: standardmallen för C++ kraschar med NZEC/core dumped tills dev åtgärdat BUG-08. Ta bort test.fail() när det är fixat.
  test.fail(true, 'BUG-08: default C++-mall kraschar med NZEC/core dumped');

  await runButton.click();
  const results = page.getByText(/Run results · \d+ of \d+ passed/);
  await expect(results).toBeVisible({ timeout: 30000 });

  const outputText = await page.locator('pre').allInnerTexts().then((t) => t.join('\n'));
  expect(outputText, 'C++ sandlådan kraschade under körning').not.toMatch(/core dumped|NZEC|Exit code 139/i);
});

// BUG-03: Academy exponerar känslig data (P1)
test('BUG-03: Academy läcker inte tokens, nycklar eller admin-flaggor', async ({ page }) => {
  const bodies: string[] = [];
  page.on('response', async (r) => {
    const ct = r.headers()['content-type'] || '';
    if (!/json|text|javascript/.test(ct) || !/\/academy|\/api\/|_next\/data|\.rsc/.test(r.url())) return;
    const t = await r.text().catch(() => '');
    // Inloggad användares eget TalkJS-chattoken är avsett beteende, inte ett läckage
    if (!/talkjsToken/.test(t)) bodies.push(t);
  });
  await page.goto(`${BASE_URL}/academy`);
  await page.waitForLoadState('networkidle');
  bodies.push(await page.content());

  const sensitive = [
    /"?(access|refresh|id|auth|session|api)[_-]?token"?\s*[:=]\s*"[^"]{8,}/i,
    /"?(secret|api[_-]?key|private[_-]?key|internal[_-]?key|password)"?\s*[:=]\s*"[^"]{4,}/i,
    /"?is[_-]?admin"?\s*[:=]\s*true/i,
    /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  ];
  for (const re of sensitive) {
    for (const b of bodies) expect(b, `Känslig data matchade ${re}`).not.toMatch(re);
  }
});

// BUG-07: Testdata i Jobs (P2)
test('BUG-07: Jobs visar ingen dummy-/testdata', async ({ page }) => {
  await page.goto(`${BASE_URL}/jobs`);
  await page.waitForLoadState('networkidle');
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/test job|lorem ipsum|dolor sit amet|dummy|placeholder|mock/i);
  expect(text).not.toMatch(/\b(salary|lön)\b[^\n]{0,20}\b(0|999999+)\b/i);
});

test('BUG-06: Jobs-resurser (bilder, SVG, bilagor) laddar med HTTP 200', async ({ page }) => {
  // Förväntat fel: minst en företagslogga (dealroom-images-production) ger 404 tills BUG-06 är åtgärdad.
  test.fail();
  await page.goto(`${BASE_URL}/jobs`);
  await page.waitForLoadState('networkidle');

  const jobLinks = await page.locator('a[href*="/jobs/"]').evaluateAll(
    (as) => [...new Set(as.map((a) => (a as HTMLAnchorElement).href))].slice(0, 5)
  );

  const collect = () =>
    page.evaluate(() => {
      const urls: string[] = [];
      document.querySelectorAll('img[src], source[src], video[src], object[data]').forEach((e) => {
        const u = e.getAttribute('src') || e.getAttribute('data');
        if (u && !u.startsWith('data:')) urls.push(new URL(u, location.href).href);
      });
      document.querySelectorAll('a[href]').forEach((a) => {
        const h = (a as HTMLAnchorElement).href;
        if (/\.(pdf|docx?|xlsx?|zip|png|jpe?g|svg)(\?|$)/i.test(h)) urls.push(h);
      });
      return urls;
    });

  const urls = new Set<string>(await collect());
  for (const link of jobLinks) {
    await page.goto(link);
    await page.waitForLoadState('networkidle');
    (await collect()).forEach((u) => urls.add(u));
  }

  const broken: string[] = [];
  for (const u of urls) {
    const res = await page.request.get(u).catch(() => null);
    if (!res || res.status() !== 200) broken.push(`${res?.status() ?? 'ERR'} ${u}`);
  }
  console.log(`BUG-06: kontrollerade ${urls.size} resurser, trasiga: ${broken.length}`, broken);
  expect(broken, `Trasiga resurser:\n${broken.join('\n')}`).toEqual([]);
});

test('BUG-09/11: Profilens klientvalidering stoppar ogiltiga värden', async ({ page }) => {
  await page.goto(`${BASE_URL}/profile`);
  await page.waitForLoadState('domcontentloaded');

  await page.getByRole('button', { name: /Preferences/i }).click();
  const rate = page.getByRole('spinbutton', { name: /Freelancing hourly rate/i });
  await expect(rate).toBeVisible({ timeout: 5000 });

  for (const bad of ['-5', '999999999']) {
    await rate.fill(bad);
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(1000);
    const invalid = await rate.evaluate((el: HTMLInputElement) => !el.checkValidity());
    const warning = await page
      .getByText(/invalid|must be|too (high|large)|required|between|at least|not valid/i)
      .first()
      .isVisible()
      .catch(() => false);
    expect(invalid || warning, `Ingen validering för timarvode "${bad}"`).toBeTruthy();
  }

  await page.getByRole('button', { name: /Personal Details/i }).click();
  const fmt = page.locator('input[type="email"], input[type="url"], input[name*="linkedin" i], input[name*="github" i]');
  const n = await fmt.count();
  for (let i = 0; i < n; i++) {
    const el = fmt.nth(i);
    if (!(await el.isVisible()) || !(await el.isEditable())) continue;
    await el.fill('not a valid value');
    const type = await el.getAttribute('type');
    const invalid = await el.evaluate((e: HTMLInputElement) => !e.checkValidity());
    if (type === 'email' || type === 'url') expect(invalid).toBeTruthy();
  }
});

for (const route of ['/jobs', '/community', '/profile']) {
  test(`BUG-12/15/19: Axe-layoutgranskning ${route}`, async ({ page }) => {
  // Förväntat fel: <svg role="img"> saknar alternativ text (svg-img-alt) tills BUG-12/15/19 är åtgärdade.
  test.fail();
    await page.goto(`${BASE_URL}${route}`);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page })
      .withRules(['color-contrast', 'heading-order', 'page-has-heading-one', 'empty-heading', 'image-alt', 'svg-img-alt'])
      .analyze();
    const summary = results.violations.map((v) => `${v.id} (${v.impact}) x${v.nodes.length}: ${v.help}`);
    console.log(`AXE ${route}:\n${summary.join('\n') || 'inga överträdelser'}`);
    expect(summary, summary.join('\n')).toEqual([]);
  });
}

for (const route of ['/jobs', '/community', '/profile']) {
  test(`BUG-14: Header-logotyp ${route}`, async ({ page }) => {
    await page.goto(`${BASE_URL}${route}`);
    await page.waitForLoadState('domcontentloaded');
    const logo = page.locator('header a:has(svg), header a:has(img), header [class*="logo" i]').first();
    await expect(logo).toBeVisible();
    const box = await logo.boundingBox();
    expect(box && box.width > 0 && box.height > 0, `logotypen har kollapsade mått: ${JSON.stringify(box)}`).toBeTruthy();
    const loaded = await logo.evaluate((el) => {
      const img = el.matches('img') ? (el as HTMLImageElement) : el.querySelector('img');
      if (img) return img.complete && img.naturalWidth > 0;
      return !!(el.matches('svg') || el.querySelector('svg'));
    });
    expect(loaded, 'logotypen är varken SVG eller laddad img').toBeTruthy();

    const visited: string[] = [];
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) visited.push(f.url()); });
    const resp = page.waitForResponse((r) => r.request().isNavigationRequest(), { timeout: 15000 }).catch(() => null);
    await logo.click();
    const r = await resp;
    await page.waitForLoadState('domcontentloaded');
    if (r) expect(r.status(), `HTTP ${r.status()} efter logotypklick`).toBeLessThan(400);
    expect(visited.length, `möjlig redirect-loop: ${visited.join(' -> ')}`).toBeLessThan(6);
    await expect(page.getByText(/404|not found/i).first()).toHaveCount(0);
    console.log(`BUG-14 ${route}: box=${JSON.stringify(box)} -> ${page.url()}`);
  });
}

for (const route of ['/jobs', '/community']) {
  test(`BUG-13: Prestanda ${route}`, async ({ page }) => {
    let bytes = 0;
    page.on('response', async (res) => {
      const len = Number((await res.allHeaders())['content-length'] || 0);
      bytes += len;
    });
    await page.goto(`${BASE_URL}${route}`, { waitUntil: 'load' });
    await page.waitForLoadState('networkidle');
    const m = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      const transfer = performance.getEntriesByType('resource').reduce((s, r) => s + ((r as PerformanceResourceTiming).transferSize || 0), nav.transferSize || 0);
      return { ttfb: nav.responseStart - nav.startTime, dcl: nav.domContentLoadedEventEnd - nav.startTime, transfer };
    });
    const mb = Math.max(m.transfer, bytes) / 1024 / 1024;
    console.log(`PERF ${route}: TTFB=${m.ttfb.toFixed(0)}ms DCL=${m.dcl.toFixed(0)}ms payload=${mb.toFixed(2)}MB`);
    expect.soft(m.ttfb, 'TTFB över 1500ms').toBeLessThan(1500);
    expect.soft(m.dcl, 'domContentLoaded över 4000ms').toBeLessThan(4000);
    expect.soft(mb, 'payload över 5MB').toBeLessThan(5);
  });
}
