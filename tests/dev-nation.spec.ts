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
