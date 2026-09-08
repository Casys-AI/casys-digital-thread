/**
 * Playwright scenario for the OverviewThreadHero whiteboard harness.
 * Selectors and identities are passed by the Deno test so this file stays
 * free of production imports.
 */
import {
  clearPresentationStorage,
  clickFlowItem,
  configure,
  snapshot,
  waitForBoard,
  waitForHarness,
  waitForPendingBoard,
} from "./whiteboard-playwright-board.mjs";

export async function runWhiteboardScenario(page, spec) {
  await page.goto(spec.origin);
  await waitForHarness(page);
  await clearPresentationStorage(page);

  await configure(page, { viewerHierarchyPending: true });
  await waitForPendingBoard(page);
  const whileHierarchyPending = await snapshot(page);

  await configure(page, { viewerHierarchyPending: false });
  await waitForBoard(page);
  const afterHierarchyReady = await snapshot(page);
  const idleCable = await readCableProof(page);

  await page.locator(spec.cadNode).click();
  await page.locator(".overview-thread-selection-note").waitFor();
  const afterSelect = await snapshot(page);
  if (afterSelect.openViewerControl) {
    throw new Error(
      "Open viewer appeared before exact sessions were ready.",
    );
  }

  await configure(page, { viewerSessionsReady: true });
  if (!await page.locator(spec.openViewer).isVisible().catch(() => false)) {
    await clickFlowItem(page, spec.cadNode);
  }
  await page.locator(spec.openViewer).waitFor();
  const afterLateSessions = await snapshot(page);
  const selectedCable = await readCableProof(page);

  // This two-hull fixture auto-fits above 300%; use the real toolbar to
  // leave room for the floating viewer before opening it.
  for (let step = 0; step < 12; step += 1) {
    const scale = Number.parseInt(
      await page.locator(".overview-thread-layout-scale").innerText(),
      10,
    );
    if (scale <= 100) break;
    await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  }
  await clickFlowItem(page, spec.sysmlStructuredRow);
  await page.waitForFunction(() =>
    Boolean(document.querySelector(
      '.overview-thread-flow-segment[data-state="outgoing"]',
    ))
  );
  const outgoingCable = await readCableProof(page);
  await clickFlowItem(page, spec.cadStructuredRow);
  await page.locator(".overview-thread-selection-note").waitFor();
  await page.evaluate(() => {
    for (
      const close of document.querySelectorAll(
        ".overview-thread-viewer button[aria-label^='Close ']",
      )
    ) {
      close.click();
    }
  });
  const beforeHullX = geometryGroupX(afterLateSessions);
  await pointerDragRight(page, spec.geometryGroup, 96, { waitFlowIdle: true });
  await page.waitForFunction(
    (x) => {
      const rect = document.querySelector(
        '.overview-thread-flow-groups rect[data-group-key="domain:geometry"]',
      );
      return Number(rect?.getAttribute("x") ?? "NaN") > x;
    },
    beforeHullX,
    { timeout: 5000 },
  );
  const afterGroupMove = await snapshot(page);

  await page.locator(spec.openViewer).click();
  await page.locator(spec.cadViewer).waitFor();

  const afterOpenViewer = await snapshot(page);
  const beforeViewerLeft =
    afterOpenViewer.viewers.find((viewer) => viewer.id === spec.cadViewerId)
      ?.left ?? 0;
  await pointerDragRight(page, spec.viewerHandle, 72);
  await page.waitForFunction(
    (before) => {
      const viewer = document.querySelector(
        `.overview-thread-viewer[data-viewer-id="${before.id}"]`,
      );
      if (!viewer) return false;
      return Number.parseFloat(viewer.style.left || "0") > before.left;
    },
    { id: spec.cadViewerId, left: beforeViewerLeft },
    { timeout: 5000 },
  );

  await page.waitForFunction(
    (key) => localStorage.getItem(key) !== null,
    spec.alphaStorageKey,
    { timeout: Math.max(8000, spec.saveDelayMs + 4000) },
  );
  const afterSessionsReady = await snapshot(page);

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForHarness(page);
  await waitForBoard(page);
  const afterReloadBeforeSessions = await snapshot(page);
  await configure(page, { viewerSessionsReady: true });
  await page.waitForFunction(
    (selector) => Boolean(document.querySelector(selector)),
    spec.cadViewer,
    { timeout: 8000 },
  );
  await waitForRestoredPlacement(page, afterSessionsReady, spec);
  const afterReload = await snapshot(page);

  await configure(page, { projectId: spec.betaProjectId });
  await page.waitForFunction(
    (id) =>
      document.querySelector("[data-whiteboard-harness]")
        ?.getAttribute("data-project-id") === id,
    spec.betaProjectId,
  );
  await waitForBoard(page);
  const afterProjectSwitch = await snapshot(page);

  await configure(page, { projectId: spec.alphaProjectId });
  await page.waitForFunction(
    (id) =>
      document.querySelector("[data-whiteboard-harness]")
        ?.getAttribute("data-project-id") === id,
    spec.alphaProjectId,
  );
  await page.waitForFunction(
    (selector) => Boolean(document.querySelector(selector)),
    spec.cadViewer,
    { timeout: 8000 },
  );
  await waitForRestoredPlacement(page, afterSessionsReady, spec);
  const afterReturn = await snapshot(page);

  return {
    whileHierarchyPending,
    afterHierarchyReady,
    afterSelect,
    afterLateSessions,
    idleCable,
    selectedCable,
    outgoingCable,
    afterGroupMove,
    afterOpenViewer,
    afterSessionsReady,
    afterReloadBeforeSessions,
    afterReload,
    afterProjectSwitch,
    afterReturn,
  };
}

async function readCableProof(page) {
  return await page.evaluate(() => {
    const selected = document.querySelector(
      '[data-whiteboard-flow-item="true"][data-state="selected"]',
    );
    const marker = selected?.querySelector(".overview-thread-flow-node-dot");
    const incoming = document.querySelector(
      '.overview-thread-flow-segment[data-state="incoming"]',
    );
    const outgoing = document.querySelector(
      '.overview-thread-flow-segment[data-state="outgoing"]',
    );
    const muted = document.querySelector(
      '.overview-thread-flow-segment[data-state="muted"]',
    );
    const idle = document.querySelector(
      '.overview-thread-flow-segment[data-state="default"]',
    );
    const hierarchy = document.querySelector(
      ".overview-thread-flow-hierarchy-links path",
    );
    const styleOf = (element) => element ? getComputedStyle(element) : null;
    const incomingStyle = styleOf(incoming);
    const outgoingStyle = styleOf(outgoing);
    const idleStyle = styleOf(idle);
    const mutedStyle = styleOf(muted);
    const markerStyle = styleOf(marker);
    const hierarchyStyle = styleOf(hierarchy);
    return {
      incomingStroke: incomingStyle?.stroke ?? null,
      outgoingStroke: outgoingStyle?.stroke ?? null,
      idleOpacity: idleStyle ? Number(idleStyle.opacity) : null,
      mutedOpacity: mutedStyle ? Number(mutedStyle.opacity) : null,
      markerBoxShadow: markerStyle?.boxShadow ?? null,
      hierarchyStroke: hierarchyStyle?.stroke ?? null,
      hierarchyState: hierarchy?.getAttribute("data-state") ?? null,
    };
  });
}

async function pointerDragRight(page, selector, pixels, options = {}) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: "visible" });
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  if (!box || box.width <= 0 || box.height <= 0) {
    throw new Error(`No visible box for ${selector}: ${JSON.stringify(box)}`);
  }
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  if (
    !viewport ||
    startX < 0 || startY < 0 ||
    startX >= viewport.width || startY >= viewport.height
  ) {
    throw new Error(
      `Drag start for ${selector} is outside the viewport: ${
        JSON.stringify({ box, viewport })
      }`,
    );
  }
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + pixels, startY, { steps: 8 });
  await page.mouse.up();
  if (options.waitFlowIdle) {
    await page.waitForFunction(
      () =>
        document.querySelector(".overview-thread-flow")?.getAttribute(
          "data-dragging",
        ) !== "true",
      undefined,
      { timeout: 5000 },
    );
  }
}

function geometryGroupX(board) {
  return board.groups.find((group) => group.groupKey === "domain:geometry")
    ?.x ?? Number.NaN;
}

async function waitForRestoredPlacement(page, expected, spec) {
  const group = expected.groups.find((group) =>
    group.groupKey === "domain:geometry"
  );
  const viewer = expected.viewers.find((viewer) =>
    viewer.id === spec.cadViewerId
  );
  // Hull coordinates animate from their initial layout to the restored position.
  // A visible viewer alone does not mean that animation has settled.
  await page.waitForFunction(
    ({ group, viewer, groupSelector, viewerSelector }) => {
      const hull = document.querySelector(groupSelector);
      const card = document.querySelector(viewerSelector);
      return Number(hull?.getAttribute("x")) === group.x &&
        Number(hull?.getAttribute("y")) === group.y &&
        Number.parseFloat(card?.style.left) === viewer.left &&
        Number.parseFloat(card?.style.top) === viewer.top;
    },
    {
      group,
      viewer,
      groupSelector: spec.geometryGroupRect,
      viewerSelector: spec.cadViewer,
    },
    { timeout: 8000 },
  );
}
