import { assert, assertEquals } from "@std/assert";
import {
  WHITEBOARD_ALPHA_PROJECT_ID,
  WHITEBOARD_BETA_PROJECT_ID,
  WHITEBOARD_CAD_CONTEXT_TARGET,
  WHITEBOARD_CAD_NODE_KEY,
  WHITEBOARD_CAD_VIEWER_ID,
  WHITEBOARD_SYSML_NODE_KEY,
  whiteboardPresentationStorageKey,
} from "./testing/whiteboard-fixture.ts";

const CHROME = chromeExecutable();
const PLAYWRIGHT = Deno.env.get("CASYS_PLAYWRIGHT_MODULE") ??
  new URL("./node_modules/playwright/index.mjs", import.meta.url).pathname;
const VITE = new URL("./node_modules/vite/dist/node/index.js", import.meta.url)
  .pathname;
const PLAYWRIGHT_SCENARIO = new URL(
  "./testing/whiteboard-browser-playwright.mjs",
  import.meta.url,
).pathname;
const NATIVE_CONFIG = new URL("./vite.native.config.ts", import.meta.url)
  .pathname;
const UI_ROOT = new URL(".", import.meta.url).pathname;
const OVERVIEW_WHITEBOARD_SAVE_DELAY_MS = 240;

interface WhiteboardNodeProof {
  readonly target: string | null;
  readonly pressed: string | null;
  readonly state: string | null;
  readonly raw: boolean;
  readonly structured: boolean;
}

interface WhiteboardViewerProof {
  readonly id: string | null;
  readonly kind: string | null;
  readonly anchor: string | null;
  readonly left: number;
  readonly top: number;
}

interface WhiteboardGroupProof {
  readonly groupKey: string | null;
  readonly lane: string | null;
  readonly x: number;
  readonly y: number;
}

interface WhiteboardBoxProof {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

interface WhiteboardBoardProof {
  readonly projectId: string;
  readonly viewerSessionsReady: boolean;
  readonly hierarchySkeletonVisible: boolean;
  readonly pendingHulls: number;
  readonly pendingRows: number;
  readonly pendingMarkerBackground: string | null;
  readonly flowCanvasVisible: boolean;
  readonly flowItems: number;
  readonly rawNodes: number;
  readonly controlsVisible: boolean;
  readonly nodes: readonly WhiteboardNodeProof[];
  readonly viewers: readonly WhiteboardViewerProof[];
  readonly groups: readonly WhiteboardGroupProof[];
  readonly selectionNote: string | null;
  readonly selectionNoteRect: WhiteboardBoxProof | null;
  readonly selectedNodeRect: WhiteboardBoxProof | null;
  readonly openViewerControl: boolean;
  readonly evidenceOpens: number;
  readonly activityOpens: number;
  readonly storageKeys: readonly string[];
}

interface WhiteboardCableProof {
  readonly incomingStroke: string | null;
  readonly outgoingStroke: string | null;
  readonly idleOpacity: number | null;
  readonly mutedOpacity: number | null;
  readonly markerBoxShadow: string | null;
  readonly hierarchyStroke: string | null;
  readonly hierarchyState: string | null;
}

interface WhiteboardScenarioProof {
  readonly whileHierarchyPending: WhiteboardBoardProof;
  readonly afterHierarchyReady: WhiteboardBoardProof;
  readonly afterSelect: WhiteboardBoardProof;
  readonly afterLateSessions: WhiteboardBoardProof;
  readonly idleCable: WhiteboardCableProof;
  readonly selectedCable: WhiteboardCableProof;
  readonly outgoingCable: WhiteboardCableProof;
  readonly afterGroupMove: WhiteboardBoardProof;
  readonly afterOpenViewer: WhiteboardBoardProof;
  readonly afterSessionsReady: WhiteboardBoardProof;
  readonly afterReloadBeforeSessions: WhiteboardBoardProof;
  readonly afterReload: WhiteboardBoardProof;
  readonly afterProjectSwitch: WhiteboardBoardProof;
  readonly afterReturn: WhiteboardBoardProof;
}

Deno.test({
  name:
    "rendered OverviewThreadHero keeps selection distinct from exact viewers, persists moved positions, isolates projects, and waits for sessions",
  ignore: CHROME === undefined || !(await playwrightAvailable()),
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const profile = await Deno.makeTempDir({
      prefix: "casys-whiteboard-chrome-",
    });

    try {
      const proof = await runPlaywright(profile);
      const failures: string[] = [];
      const check = (label: string, run: () => void) => {
        try {
          run();
        } catch (error) {
          failures.push(
            `${label}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      };

      check("selection vs viewer", () => {
        assertSelectionDoesNotOpenViewer(proof.afterSelect);
        assertEquals(proof.afterLateSessions.openViewerControl, true);
        assertEquals(proof.afterSelect.viewers.length, 0);
        assertExactViewerOpened(proof.afterOpenViewer);
      });
      check("hierarchy loading gate", () => {
        assertEquals(
          proof.whileHierarchyPending.hierarchySkeletonVisible,
          false,
        );
        assert(proof.whileHierarchyPending.groups.length >= 2);
        assertEquals(proof.whileHierarchyPending.controlsVisible, true);
        assertEquals(proof.whileHierarchyPending.flowCanvasVisible, true);
        assert(proof.whileHierarchyPending.pendingHulls >= 1);
        assert(proof.whileHierarchyPending.pendingRows >= 1);
        assertEquals(proof.whileHierarchyPending.flowItems, 0);
        assertEquals(proof.whileHierarchyPending.rawNodes, 0);
        assertPendingMarkerNeutral(proof.whileHierarchyPending);
        assertEquals(proof.afterHierarchyReady.hierarchySkeletonVisible, false);
        assertEquals(proof.afterHierarchyReady.pendingRows, 0);
        assertEquals(proof.afterHierarchyReady.rawNodes, 0);
        assert(proof.afterHierarchyReady.flowItems >= 2);
        assert(proof.afterHierarchyReady.groups.length >= 2);
        assert(
          proof.afterHierarchyReady.nodes.every((node) => node.structured && !node.raw),
          "Unavailable hierarchy must fall back through structured hull rows.",
        );
        assertEquals(proof.afterLateSessions.rawNodes, 0);
        assert(
          proof.afterLateSessions.nodes.every((node) => node.structured && !node.raw),
          "Exact hierarchy must not render candidate raw FlowNodes.",
        );
      });
      check("selection survives pending-to-hierarchy without raw nodes", () => {
        assertSelectionDoesNotOpenViewer(proof.afterSelect);
        assertCadSurface(proof.afterSelect, { raw: false, structured: true });
        assertCadSurface(proof.afterLateSessions, {
          raw: false,
          structured: true,
        });
        assert(proof.afterLateSessions.selectionNote !== null);
        assert(
          proof.afterLateSessions.nodes.some((node) =>
            node.target === WHITEBOARD_CAD_CONTEXT_TARGET &&
            node.state === "selected" &&
            node.pressed === "true"
          ),
          "Selected real item must remain after hierarchy replacement.",
        );
        assertPopInAnchored(proof.afterLateSessions);
      });
      check("selected structured row paints directional cables", () => {
        assertEquals(proof.selectedCable.incomingStroke, "rgb(109, 40, 217)");
        assertEquals(proof.outgoingCable.outgoingStroke, "rgb(15, 118, 110)");
        assert(
          (proof.idleCable.idleOpacity ?? 0) >= 0.12,
          `Idle cable should stay readable, got ${proof.idleCable.idleOpacity}.`,
        );
        if (proof.selectedCable.mutedOpacity !== null) {
          assert(
            proof.selectedCable.mutedOpacity <= 0.1,
            `Muted cable should be reduced, got ${proof.selectedCable.mutedOpacity}.`,
          );
        }
        assert(
          proof.selectedCable.markerBoxShadow?.includes("rgb") === true,
          "Selected marker must keep a halo.",
        );
        assert(
          proof.selectedCable.hierarchyStroke !== "rgb(109, 40, 217)" &&
            proof.selectedCable.hierarchyStroke !== "rgb(15, 118, 110)",
          `Hierarchy connector must not imitate a graph cable, got ${proof.selectedCable.hierarchyStroke}.`,
        );
      });

      const alphaKey = whiteboardPresentationStorageKey(
        WHITEBOARD_ALPHA_PROJECT_ID,
      );
      const persistedGroup = geometryGroup(proof.afterSessionsReady);
      const persistedViewer = proof.afterSessionsReady.viewers.find(
        (viewer) => viewer.id === WHITEBOARD_CAD_VIEWER_ID,
      );

      check("localStorage after sessions ready", () => {
        assertEquals(
          proof.afterSessionsReady.storageKeys.includes(alphaKey),
          true,
        );
      });
      check("reload keeps exact viewer and hull", () => {
        assert(
          persistedViewer,
          "Exact CAD viewer missing after sessions ready.",
        );
        assertEquals(proof.afterReload.storageKeys.includes(alphaKey), true);
        assertEquals(proof.afterReload.viewers.length, 1);
        assertEquals(geometryGroup(proof.afterReload).x, persistedGroup.x);
        assertEquals(geometryGroup(proof.afterReload).y, persistedGroup.y);
        assertEquals(cadViewer(proof.afterReload).left, persistedViewer.left);
        assertEquals(cadViewer(proof.afterReload).top, persistedViewer.top);
      });
      check("project switch isolation", () => {
        assert(
          persistedViewer,
          "Exact CAD viewer missing after sessions ready.",
        );
        assertEquals(
          proof.afterProjectSwitch.projectId,
          WHITEBOARD_BETA_PROJECT_ID,
        );
        const projectBViewer = proof.afterProjectSwitch.viewers.find(
          (viewer) => viewer.id === WHITEBOARD_CAD_VIEWER_ID,
        );
        if (projectBViewer) {
          assert(
            projectBViewer.left !== persistedViewer.left ||
              projectBViewer.top !== persistedViewer.top,
            "Project B must not inherit project A viewer placement.",
          );
        }
        const hullMoved = geometryGroup(proof.afterGroupMove).x !==
          geometryGroup(proof.afterLateSessions).x;
        if (hullMoved) {
          assert(
            geometryGroup(proof.afterProjectSwitch).x !== persistedGroup.x,
            "Project B must not inherit project A hull placement.",
          );
        }
        assertEquals(
          proof.afterProjectSwitch.storageKeys.includes(alphaKey),
          true,
        );
        assertEquals(proof.afterReturn.projectId, WHITEBOARD_ALPHA_PROJECT_ID);
        assertEquals(cadViewer(proof.afterReturn).left, persistedViewer.left);
        assertEquals(geometryGroup(proof.afterReturn).x, persistedGroup.x);
      });
      check("moved hull and viewer before persistence", () => {
        assert(
          persistedViewer,
          "Exact CAD viewer missing after sessions ready.",
        );
        assert(
          geometryGroup(proof.afterGroupMove).x >
            geometryGroup(proof.afterLateSessions).x,
          `Geometry hull should have moved right before persistence (before=${
            geometryGroup(proof.afterLateSessions).x
          } after=${geometryGroup(proof.afterGroupMove).x}).`,
        );
        assert(
          persistedViewer.left > cadViewer(proof.afterOpenViewer).left,
          `Exact CAD viewer should have moved right before persistence (before=${
            cadViewer(proof.afterOpenViewer).left
          } after=${persistedViewer.left}).`,
        );
      });

      if (failures.length > 0) {
        throw new Error(failures.join("\n"));
      }
    } finally {
      await Deno.remove(profile, { recursive: true });
    }
  },
});

function assertCadSurface(
  board: WhiteboardBoardProof,
  expected: { readonly raw: boolean; readonly structured: boolean },
): void {
  const cad = board.nodes.filter((node) =>
    node.target === WHITEBOARD_CAD_CONTEXT_TARGET
  );
  assertEquals(cad.length, 1, "CAD must render as exactly one visual surface.");
  assertEquals(cad[0]?.raw, expected.raw);
  assertEquals(cad[0]?.structured, expected.structured);
  assertEquals(
    cad[0]?.raw === true && cad[0]?.structured === true,
    false,
    "Hierarchy must not show both a point and a tree glyph.",
  );
}

function assertPopInAnchored(board: WhiteboardBoardProof): void {
  assert(board.selectionNote, "Selection note missing after hierarchy.");
  assert(board.selectionNoteRect, "Selection note box missing.");
  assert(board.selectedNodeRect, "Selected row box missing.");
  const note = board.selectionNoteRect;
  const node = board.selectedNodeRect;
  const gapX = Math.max(
    0,
    note.left - (node.left + node.width),
    node.left - (note.left + note.width),
  );
  const gapY = Math.max(
    0,
    note.top - (node.top + node.height),
    node.top - (note.top + note.height),
  );
  assert(
    gapX <= 48,
    `Pop-in should stay anchored beside the selected occurrence (gapX=${gapX}).`,
  );
  assert(
    gapY <= Math.max(72, node.height),
    `Pop-in should stay vertically near the selected occurrence (gapY=${gapY}).`,
  );
}

function assertPendingMarkerNeutral(board: WhiteboardBoardProof): void {
  const background = board.pendingMarkerBackground;
  assert(background, "Pending hulls must render placeholder markers.");
  assertEquals(
    background === "rgb(14, 116, 144)" || background === "rgb(14,116,144)",
    false,
    `Pending marker must not reuse the geometry lane fill, got ${background}.`,
  );
  assertEquals(
    background?.includes("14, 116, 144"),
    false,
    `Pending marker must stay neutral, got ${background}.`,
  );
}

function assertSelectionDoesNotOpenViewer(board: WhiteboardBoardProof): void {
  const selected = board.nodes.find((node) =>
    node.target === WHITEBOARD_CAD_CONTEXT_TARGET
  );
  assert(selected, "CAD flow node was not rendered.");
  assertEquals(selected.pressed, "true");
  assertEquals(board.viewers.length, 0);
  assertEquals(board.openViewerControl, false);
  assert(board.selectionNote !== null);
  assertEquals(board.evidenceOpens, 0);
  assertEquals(board.activityOpens, 0);
}

function assertExactViewerOpened(board: WhiteboardBoardProof): void {
  assertEquals(board.viewers.length, 1);
  assertEquals(board.viewers[0]?.id, WHITEBOARD_CAD_VIEWER_ID);
  assertEquals(board.viewers[0]?.kind, "session");
  assertEquals(board.viewers[0]?.anchor, WHITEBOARD_CAD_NODE_KEY);
  assertEquals(board.evidenceOpens, 0);
  assertEquals(board.activityOpens, 0);
}

function geometryGroup(board: WhiteboardBoardProof): WhiteboardGroupProof {
  const group = board.groups.find((candidate) =>
    candidate.groupKey === "domain:geometry"
  );
  assert(group, "Geometry hull was not rendered.");
  return group;
}

function cadViewer(board: WhiteboardBoardProof): WhiteboardViewerProof {
  const viewer = board.viewers.find((candidate) =>
    candidate.id === WHITEBOARD_CAD_VIEWER_ID
  );
  assert(viewer, "Exact CAD viewer was not rendered.");
  return viewer;
}

async function runPlaywright(
  profile: string,
): Promise<WhiteboardScenarioProof> {
  const script = `${profile}/playwright-run.mjs`;
  const spec = {
    cadNode:
      `[data-whiteboard-flow-item="true"][data-overview-context-target="${WHITEBOARD_CAD_CONTEXT_TARGET}"]`,
    cadStructuredRow:
      `[data-whiteboard-flow-item="true"][data-overview-context-target="${WHITEBOARD_CAD_CONTEXT_TARGET}"]`,
    sysmlStructuredRow:
      `[data-whiteboard-flow-item="true"][data-overview-context-target="node:${WHITEBOARD_SYSML_NODE_KEY}"]`,
    openViewer: ".overview-thread-selection-note button[data-app]",
    geometryGroup:
      'button.overview-thread-flow-group-label[aria-label^="Move Geometry group"]',
    geometryGroupRect:
      '.overview-thread-flow-groups rect[data-group-key="domain:geometry"]',
    cadViewer: `.overview-thread-viewer[data-viewer-id="${WHITEBOARD_CAD_VIEWER_ID}"]`,
    viewerHandle:
      `.overview-thread-viewer[data-viewer-id="${WHITEBOARD_CAD_VIEWER_ID}"] .overview-thread-viewer-title`,
    cadViewerId: WHITEBOARD_CAD_VIEWER_ID,
    alphaProjectId: WHITEBOARD_ALPHA_PROJECT_ID,
    betaProjectId: WHITEBOARD_BETA_PROJECT_ID,
    alphaStorageKey: whiteboardPresentationStorageKey(
      WHITEBOARD_ALPHA_PROJECT_ID,
    ),
    saveDelayMs: OVERVIEW_WHITEBOARD_SAVE_DELAY_MS,
  };
  await Deno.writeTextFile(
    script,
    `
import { createServer } from ${JSON.stringify(VITE)};
import { chromium } from ${JSON.stringify(PLAYWRIGHT)};
import { runWhiteboardScenario } from ${JSON.stringify(PLAYWRIGHT_SCENARIO)};

const vite = await createServer({
  configFile: ${JSON.stringify(NATIVE_CONFIG)},
  logLevel: "silent",
  plugins: [{
    name: "whiteboard-fixture-viewer-404",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.startsWith("/fixture/viewer-apps/")) {
          response.statusCode = 404;
          response.end("unavailable");
          return;
        }
        next();
      });
    },
  }],
  server: {
    host: "127.0.0.1",
    port: 0,
    strictPort: false,
    open: false,
    hmr: false,
  },
});
await vite.listen();
const address = vite.httpServer?.address();
const port = typeof address === "object" && address ? address.port : 0;
if (!port) {
  await vite.close();
  throw new Error("Vite did not bind a loopback port for the whiteboard fixture.");
}
const origin = "http://127.0.0.1:" + port + "/testing/whiteboard-browser.html";
const browser = await chromium.launch({
  headless: true,
  executablePath: ${JSON.stringify(CHROME)},
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(20000);
try {
  const proof = await runWhiteboardScenario(page, {
    ...${JSON.stringify(spec)},
    origin,
  });
  console.log(JSON.stringify(proof));
} finally {
  await browser.close();
  await vite.close();
}
`,
  );
  const output = await new Deno.Command("node", {
    args: [script],
    stdout: "piped",
    stderr: "piped",
    cwd: UI_ROOT,
  }).output();
  if (!output.success) {
    throw new Error(
      `Playwright whiteboard test failed: ${new TextDecoder().decode(output.stderr)}\n${
        new TextDecoder().decode(output.stdout)
      }`,
    );
  }
  return JSON.parse(new TextDecoder().decode(output.stdout));
}

function chromeExecutable(): string | undefined {
  const candidates = Deno.build.os === "darwin"
    ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
    : ["/usr/bin/google-chrome", "/usr/bin/chromium"];
  return candidates.find((path) => {
    try {
      return Deno.statSync(path).isFile;
    } catch {
      return false;
    }
  });
}

async function playwrightAvailable(): Promise<boolean> {
  try {
    return (await Deno.stat(PLAYWRIGHT)).isFile;
  } catch {
    return false;
  }
}
