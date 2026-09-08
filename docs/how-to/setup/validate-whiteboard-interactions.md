# How-to: validate whiteboard interactions

Audience: contributor · Diátaxis: how-to · Kind: how-to

Use this after changing Overview whiteboard presentation behaviour, or when you
need browser-level evidence that selection, exact viewers, local placement, and
project isolation still hold. It mounts the real `OverviewThreadHero` against a
local fixture projection. It does **not** start providers, open a live project,
or write engineering truth.

This coverage lives beside
[Validate a source checkout](validate-a-source-checkout.md). It is optional
browser evidence, not a substitute for `deno task check` / `deno task test`.

## Prerequisites

- Deno and Node.js as for a source checkout.
- UI dependencies already present (`src/ui/node_modules`, including Vite).
- Google Chrome or Chromium.
- Playwright already on disk: `src/ui/node_modules/playwright` or
  `CASYS_PLAYWRIGHT_MODULE` pointing at an existing `playwright/index.mjs`.
- Do not install Playwright, Chrome, or other packages for this check.

Run from the repository root.

## 1. Run the browser coverage

```bash
deno test --allow-read --allow-write --allow-net=127.0.0.1,localhost \
  --allow-env --allow-run \
  src/ui/overview-whiteboard-browser_test.ts
```

When Playwright lives outside `src/ui/node_modules`:

```bash
CASYS_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
  deno test --allow-read --allow-write --allow-net=127.0.0.1,localhost \
  --allow-env --allow-run \
  src/ui/overview-whiteboard-browser_test.ts
```

The test skips explicitly when Chrome/Chromium **or** Playwright is absent.
`deno task test` includes this file with the rest of `src/`.

## 2. What a green result proves

The harness renders `OverviewThreadHero` with a two-hull fixture, served by Vite
using `src/ui/vite.native.config.ts` (the same Preact aliases as the Workbench).
Playwright clicks the toolbar **Zoom out** control until the zoom is at most
100% before opening the viewer. This keeps the drag handles on screen despite
the tight auto-fit of the small fixture. It then drives `page.mouse`
move/down/move/up. A same-origin `page.reload()` keeps `localStorage`. Project
switch updates `projectId` on the **same** component instance. Timeouts fail the
test.

The scenario checks:

- while hierarchy is pending, whiteboard groups and hull controls remain,
  candidate hulls show internal skeleton rows, and there is no full-canvas
  skeleton or raw real item flash inside those hulls
- after the fetch flag clears without a hierarchy, candidate hulls fall back
  through structured rows (`data-whiteboard-flow-item`), never raw FlowNodes
- after exact hierarchy arrives, those same hulls stay structured; candidate raw
  nodes never appear between pending and the tree
- after settle, real items are counted by `data-whiteboard-flow-item`
- a node click selects the record and does not open a viewer
- exact sessions arriving late expose `Open viewer`; that action opens the
  registered session card
- group and viewer moves are persisted once sessions are ready
- the same positions survive a browser reload, after layout animation settles
- switching `projectId` isolates local presentation; returning restores it
- a selected structured row paints incoming cables `#6d28d9` and outgoing
  `#0f766e`; hierarchy parent guides stay a neutral idle-token orthogonal tree,
  never graph purple/teal

Launch URIs are served as local 404s. The spatial viewer card is the assertion
surface; App handshake success is out of scope.

## 3. What this does not prove

- A live Workbench SSE/GET session against a real project.
- Provider App bytes, MCP authority, or engineering operations.
- Keyboard context menus (`Shift+F10`).

The harness reads `data-whiteboard-flow-item`, `data-overview-context-target`,
`aria-pressed`, `data-viewer-id`, and `localStorage` keys.

A skipped test because Chrome or Playwright is absent is not a product failure.
Record that the browser gate did not run.
