/**
 * Playwright scenario for selection-note placement, pan vs click, and pin.
 * Identities are passed by the Deno test so this file stays free of
 * production imports.
 */
import {
  clearPresentationStorage,
  configure,
  snapshot,
  waitForBoard,
  waitForHarness,
  waitForInteractiveFlowItem,
  waitForPendingBoard,
} from "./whiteboard-playwright-board.mjs";

export async function runWhiteboardSelectionScenario(page, spec) {
  await page.goto(spec.origin);
  await waitForHarness(page);
  await clearPresentationStorage(page);

  await configure(page, { viewerHierarchyPending: true });
  await waitForPendingBoard(page);
  await configure(page, { viewerHierarchyPending: false });
  await waitForBoard(page);
  await zoomToReadableScale(page);
  await waitForInteractiveFlowItem(page, spec.cadNode);

  await page.locator(spec.cadNode).click();
  await page.locator(".overview-thread-selection-note").waitFor();
  const afterSelect = await snapshot(page);

  const cancelPoint = await emptyViewportPoint(page);
  await page.evaluate(() => {
    const viewport = document.querySelector(".overview-thread-viewport");
    viewport.addEventListener("pointerdown", (event) => {
      viewport.dataset.testPointerId = String(event.pointerId);
    }, { once: true });
  });
  await page.mouse.move(cancelPoint.x, cancelPoint.y);
  await page.mouse.down();
  await page.evaluate(() => {
    const viewport = document.querySelector(".overview-thread-viewport");
    viewport.dispatchEvent(
      new PointerEvent("pointercancel", {
        bubbles: true,
        pointerId: Number(viewport.dataset.testPointerId),
        pointerType: "mouse",
      }),
    );
    delete viewport.dataset.testPointerId;
  });
  await page.mouse.up();
  const afterCancelledPress = await snapshot(page);

  const panPoint = await emptyViewportPoint(page);
  await page.mouse.move(panPoint.x, panPoint.y);
  await page.mouse.down();
  await page.mouse.move(panPoint.x + 48, panPoint.y + 12, { steps: 8 });
  await page.mouse.up();
  const afterPan = await snapshot(page);

  const clickPoint = await emptyViewportPoint(page);
  await page.mouse.click(clickPoint.x, clickPoint.y);
  await page.waitForFunction(() =>
    document.querySelector(".overview-thread-selection-note") === null
  );
  const afterBackgroundClick = await snapshot(page);

  await waitForInteractiveFlowItem(page, spec.cadNode);
  await page.locator(spec.cadNode).click();
  await page.locator(".overview-thread-selection-note").waitFor();
  await page.getByRole("button", { name: "Pin selection", exact: true })
    .click();
  await page.waitForFunction(() =>
    document.querySelector(".overview-thread-selection-note")
      ?.getAttribute("data-pinned") === "true"
  );
  const afterPin = await snapshot(page);

  const pinnedClick = await emptyViewportPoint(page);
  await page.mouse.click(pinnedClick.x, pinnedClick.y);
  const afterPinnedBackgroundClick = await snapshot(page);

  await page.getByRole("button", { name: "Unpin selection", exact: true })
    .click();
  await page.waitForFunction(() =>
    document.querySelector(".overview-thread-selection-note")?.getAttribute(
      "data-pinned",
    ) === "false"
  );
  const afterUnpin = await snapshot(page);
  const unpinnedClick = await emptyViewportPoint(page);
  await page.mouse.click(unpinnedClick.x, unpinnedClick.y);
  await page.waitForFunction(() =>
    document.querySelector(".overview-thread-selection-note") === null
  );
  const afterUnpinnedBackgroundClick = await snapshot(page);
  await waitForInteractiveFlowItem(page, spec.cadNode);
  await page.locator(spec.cadNode).click();
  await page.getByRole("button", { name: "Pin selection", exact: true })
    .click();

  await page.getByRole("button", { name: "Close selected record", exact: true })
    .click();
  await page.waitForFunction(() =>
    document.querySelector(".overview-thread-selection-note") === null
  );
  const afterClose = await snapshot(page);

  return {
    afterSelect,
    afterCancelledPress,
    afterUnpin,
    afterUnpinnedBackgroundClick,
    afterPan,
    afterBackgroundClick,
    afterPin,
    afterPinnedBackgroundClick,
    afterClose,
  };
}

async function zoomToReadableScale(page) {
  for (let step = 0; step < 12; step += 1) {
    const scale = Number.parseInt(
      await page.locator(".overview-thread-layout-scale").innerText(),
      10,
    );
    if (scale <= 100) break;
    await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  }
}

async function emptyViewportPoint(page) {
  return await page.evaluate(() => {
    const viewport = document.querySelector(".overview-thread-viewport");
    if (!viewport) throw new Error("Whiteboard viewport missing.");
    const area = viewport.getBoundingClientRect();
    const blockedSelector = [
      ".overview-thread-selection-note",
      '[data-whiteboard-flow-item="true"]',
      ".overview-thread-flow-group-band",
      ".overview-thread-layout-switch",
      "button",
      "[role='button']",
      ".overview-thread-viewer",
      "[data-group-key][data-draggable='true']",
    ].join(", ");
    const candidates = [
      { x: area.left + 16, y: area.bottom - 16 },
      { x: area.right - 16, y: area.bottom - 16 },
      { x: area.left + 16, y: area.top + 16 },
      { x: area.right - 16, y: area.top + 16 },
      { x: area.left + 16, y: area.top + area.height / 2 },
    ];
    const hit = (point) => {
      const element = document.elementFromPoint(point.x, point.y);
      if (!element || !viewport.contains(element)) return true;
      return Boolean(element.closest(blockedSelector));
    };
    const found = candidates.find((point) =>
      point.x >= area.left && point.x <= area.right &&
      point.y >= area.top && point.y <= area.bottom &&
      !hit(point)
    );
    if (!found) {
      throw new Error("No empty viewport point for pan/click.");
    }
    return found;
  });
}
