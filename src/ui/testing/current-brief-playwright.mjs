/**
 * Playwright scenario: click the current Brief root and open the native viewer.
 */
export async function runCurrentBriefScenario(page, spec) {
  await page.goto(spec.origin);
  await page.waitForFunction(() =>
    Boolean(document.querySelector("[data-current-brief-harness]")) &&
    typeof globalThis.__currentBriefHarness?.snapshot === "function"
  );
  await page.waitForFunction(() => {
    const row = document.querySelector(
      '[data-native-action="open-current-brief"]',
    );
    if (!(row instanceof HTMLElement)) return false;
    const box = row.getBoundingClientRect();
    const style = getComputedStyle(row);
    return box.width > 0 && box.height > 0 &&
      style.pointerEvents !== "none" &&
      style.visibility !== "hidden";
  });
  const before = await page.evaluate(() =>
    globalThis.__currentBriefHarness.snapshot()
  );
  const root = page.locator('[data-native-action="open-current-brief"]')
    .first();
  await root.click();
  await page.locator(
    '.overview-thread-viewer[data-viewer-kind="current-brief"]',
  ).waitFor();
  const afterClick = await page.evaluate(() =>
    globalThis.__currentBriefHarness.snapshot()
  );
  return { before, afterClick };
}
