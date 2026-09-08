/**
 * Shared Playwright waits for the generic hull/row contract.
 * Ready means HTML hull chrome plus real flow items, never FlowNode presence
 * or SVG hull-rect counts.
 */

export async function waitForHarness(page) {
  await page.waitForFunction(() =>
    Boolean(document.querySelector("[data-whiteboard-harness]")) &&
    typeof globalThis.__whiteboardHarness?.snapshot === "function"
  );
}

export async function waitForBoard(page) {
  await page.waitForFunction(() => {
    const hasBox = (element) => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    const isInteractive = (element) => {
      if (!hasBox(element)) return false;
      const style = getComputedStyle(element);
      return style.pointerEvents !== "none" && style.visibility !== "hidden";
    };
    const items = [...document.querySelectorAll(
      '[data-whiteboard-flow-item="true"]',
    )];
    const hulls = [...document.querySelectorAll(
      ".overview-thread-flow-group-band",
    )];
    const handles = [...document.querySelectorAll(
      "button.overview-thread-flow-group-label[data-draggable='true']",
    )];
    const pending = document.querySelectorAll(
      "[data-whiteboard-flow-pending='true']",
    );
    const raw = document.querySelectorAll(".overview-thread-flow-node");
    const controls = document.querySelector(".overview-thread-layout-switch");
    return items.filter(isInteractive).length >= 2 &&
      hulls.filter(isInteractive).length >= 2 &&
      handles.filter(isInteractive).length >= 2 &&
      pending.length === 0 &&
      raw.length === 0 &&
      Boolean(controls);
  });
}

export async function waitForPendingBoard(page) {
  await page.waitForFunction(() => {
    const hasBox = (element) => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    const hulls = [...document.querySelectorAll(
      ".overview-thread-flow-group-band",
    )];
    const handles = [...document.querySelectorAll(
      "button.overview-thread-flow-group-label[data-draggable='true']",
    )];
    const pendingRows = document.querySelectorAll(
      ".overview-thread-flow-structure-row-pending",
    );
    const pendingHulls = document.querySelectorAll(
      "[data-whiteboard-flow-pending='true']",
    );
    const overlay = document.querySelector(
      ".overview-thread-hierarchy-skeleton",
    );
    const controls = document.querySelector(".overview-thread-layout-switch");
    const rawInPending = document.querySelector(
      "[data-whiteboard-flow-pending='true'] .overview-thread-flow-node",
    );
    const items = document.querySelectorAll(
      '[data-whiteboard-flow-item="true"]',
    );
    return hulls.filter(hasBox).length >= 2 &&
      handles.filter(hasBox).length >= 2 &&
      pendingRows.length > 0 &&
      pendingHulls.length > 0 &&
      !overlay &&
      Boolean(controls) &&
      !rawInPending &&
      items.length === 0;
  });
}

export async function waitForInteractiveFlowItem(page, selector) {
  await page.waitForFunction((target) => {
    const element = document.querySelector(target);
    if (
      !(element instanceof HTMLElement) ||
      element.getAttribute("data-whiteboard-flow-item") !== "true"
    ) {
      return false;
    }
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 &&
      style.pointerEvents !== "none" &&
      style.visibility !== "hidden";
  }, selector);
}

export async function clickFlowItem(page, selector) {
  const locator = page.locator(selector).first();
  if (await locator.count() === 0) return;
  await locator.evaluate((node) => node.click());
}

export async function configure(page, next) {
  await page.evaluate(
    (patch) => globalThis.__whiteboardHarness.configure(patch),
    next,
  );
  if (next.projectId) {
    await page.waitForFunction(
      (id) =>
        document.querySelector("[data-whiteboard-harness]")
          ?.getAttribute("data-project-id") === id,
      next.projectId,
    );
  }
  if (next.viewerSessionsReady !== undefined) {
    await page.waitForFunction(
      (ready) =>
        document.querySelector("[data-whiteboard-harness]")
          ?.getAttribute("data-sessions-ready") === ready,
      next.viewerSessionsReady ? "true" : "false",
    );
  }
  if (next.viewerHierarchyPending !== undefined) {
    await page.waitForFunction(
      (pending) =>
        document.querySelector("[data-whiteboard-harness]")
          ?.getAttribute("data-hierarchy-pending") === pending,
      next.viewerHierarchyPending ? "true" : "false",
    );
  }
}

export async function snapshot(page) {
  return await page.evaluate(() => globalThis.__whiteboardHarness.snapshot());
}

export async function clearPresentationStorage(page) {
  await page.evaluate(() => {
    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith("casys.project-whiteboard.presentation:")) {
        keys.push(key);
      }
    }
    for (const key of keys) localStorage.removeItem(key);
  });
}
