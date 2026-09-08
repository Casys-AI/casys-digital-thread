import { assert, assertEquals } from "@std/assert";
import { WHITEBOARD_CAD_CONTEXT_TARGET } from "./testing/whiteboard-fixture.ts";

const CHROME = chromeExecutable();
const PLAYWRIGHT = playwrightModule();
const VITE = new URL("./node_modules/vite/dist/node/index.js", import.meta.url)
  .pathname;
const PLAYWRIGHT_SCENARIO = new URL(
  "./testing/whiteboard-selection-playwright.mjs",
  import.meta.url,
).pathname;
const NATIVE_CONFIG = new URL("./vite.native.config.ts", import.meta.url)
  .pathname;
const UI_ROOT = new URL(".", import.meta.url).pathname;

interface WhiteboardBoxProof {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

interface WhiteboardSelectionBoardProof {
  readonly selectionNote: string | null;
  readonly selectionPinned: boolean;
  readonly selectionNoteRect: WhiteboardBoxProof | null;
  readonly selectedNodeRect: WhiteboardBoxProof | null;
}

interface WhiteboardSelectionScenarioProof {
  readonly afterSelect: WhiteboardSelectionBoardProof;
  readonly afterCancelledPress: WhiteboardSelectionBoardProof;
  readonly afterUnpin: WhiteboardSelectionBoardProof;
  readonly afterUnpinnedBackgroundClick: WhiteboardSelectionBoardProof;
  readonly afterPan: WhiteboardSelectionBoardProof;
  readonly afterBackgroundClick: WhiteboardSelectionBoardProof;
  readonly afterPin: WhiteboardSelectionBoardProof;
  readonly afterPinnedBackgroundClick: WhiteboardSelectionBoardProof;
  readonly afterClose: WhiteboardSelectionBoardProof;
}

Deno.test({
  name:
    "rendered selection note opens near the clicked row, survives pan, and pins independently of background click",
  ignore: CHROME === undefined || PLAYWRIGHT === undefined,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const profile = await Deno.makeTempDir({
      prefix: "casys-whiteboard-selection-chrome-",
    });
    try {
      const proof = await runPlaywright(profile);
      assertNearbyNote(proof.afterSelect);
      assertEquals(proof.afterSelect.selectionPinned, false);
      assert(
        proof.afterCancelledPress.selectionNote,
        "A cancelled press must not dismiss selection.",
      );
      assert(
        proof.afterUnpin.selectionNote,
        "Unpin keeps the selection until dismissed.",
      );
      assertEquals(proof.afterUnpin.selectionPinned, false);
      assertEquals(proof.afterUnpinnedBackgroundClick.selectionNote, null);
      assert(proof.afterPan.selectionNote, "Pan must keep the selection note.");
      assertEquals(proof.afterPan.selectionPinned, false);
      assertEquals(proof.afterBackgroundClick.selectionNote, null);
      assertEquals(proof.afterPin.selectionPinned, true);
      assert(
        proof.afterPinnedBackgroundClick.selectionNote,
        "Pinned selection must survive a background click.",
      );
      assertEquals(proof.afterPinnedBackgroundClick.selectionPinned, true);
      assertEquals(proof.afterClose.selectionNote, null);
    } finally {
      await Deno.remove(profile, { recursive: true });
    }
  },
});

function assertNearbyNote(board: WhiteboardSelectionBoardProof): void {
  assert(board.selectionNote, "Selection note did not open.");
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
    gapX <= 24,
    `Selection note should sit beside the clicked row (gapX=${gapX}).`,
  );
  assert(
    gapY <= Math.max(48, node.height),
    `Selection note should stay vertically near the clicked row (gapY=${gapY}).`,
  );
  assert(
    note.top >= 40,
    `Selection note must remain below the toolbar (top=${note.top}).`,
  );
}

async function runPlaywright(
  profile: string,
): Promise<WhiteboardSelectionScenarioProof> {
  const script = `${profile}/playwright-run.mjs`;
  const spec = {
    cadNode:
      `[data-whiteboard-flow-item="true"][data-overview-context-target="${WHITEBOARD_CAD_CONTEXT_TARGET}"]`,
  };
  await Deno.writeTextFile(
    script,
    `
import { createServer } from ${JSON.stringify(VITE)};
import { chromium } from ${JSON.stringify(PLAYWRIGHT)};
import { runWhiteboardSelectionScenario } from ${
      JSON.stringify(PLAYWRIGHT_SCENARIO)
    };

const vite = await createServer({
  configFile: ${JSON.stringify(NATIVE_CONFIG)},
  logLevel: "silent",
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
  throw new Error("Vite did not bind a loopback port for the selection fixture.");
}
const origin = "http://127.0.0.1:" + port + "/testing/whiteboard-browser.html";
const browser = await chromium.launch({
  headless: true,
  executablePath: ${JSON.stringify(CHROME)},
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(20000);
try {
  const proof = await runWhiteboardSelectionScenario(page, {
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
      `Playwright selection test failed: ${
        new TextDecoder().decode(output.stderr)
      }\n${new TextDecoder().decode(output.stdout)}`,
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

function playwrightModule(): string | undefined {
  const candidates = [
    Deno.env.get("CASYS_PLAYWRIGHT_MODULE"),
    new URL("./node_modules/playwright/index.mjs", import.meta.url).pathname,
  ];
  return candidates.find((path) => {
    if (!path) return false;
    try {
      return Deno.statSync(path).isFile;
    } catch {
      return false;
    }
  });
}
