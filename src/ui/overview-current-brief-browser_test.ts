import { assertEquals } from "@std/assert";

const CHROME = chromeExecutable();
const PLAYWRIGHT = Deno.env.get("CASYS_PLAYWRIGHT_MODULE") ??
  new URL("./node_modules/playwright/index.mjs", import.meta.url).pathname;
const VITE = new URL("./node_modules/vite/dist/node/index.js", import.meta.url)
  .pathname;
const PLAYWRIGHT_SCENARIO = new URL(
  "./testing/current-brief-playwright.mjs",
  import.meta.url,
).pathname;
const NATIVE_CONFIG = new URL("./vite.native.config.ts", import.meta.url)
  .pathname;
const UI_ROOT = new URL(".", import.meta.url).pathname;

interface CurrentBriefBoardProof {
  readonly nativeActionRows: number;
  readonly viewers: readonly {
    readonly id: string | null;
    readonly kind: string | null;
    readonly title: string | null;
    readonly anchor: string | null;
  }[];
  readonly documentarySessionViewers: number;
}

interface CurrentBriefScenarioProof {
  readonly before: CurrentBriefBoardProof;
  readonly afterClick: CurrentBriefBoardProof;
}

Deno.test({
  name:
    "clicking the current Brief root opens the native current-brief viewer, not a documentary session",
  ignore: CHROME === undefined || !(await playwrightAvailable()),
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const profile = await Deno.makeTempDir({
      prefix: "casys-current-brief-chrome-",
    });
    try {
      const proof = await runPlaywright(profile);
      assertEquals(proof.before.nativeActionRows, 1);
      assertEquals(
        proof.before.viewers.some((viewer) => viewer.kind === "current-brief"),
        false,
      );
      const native = proof.afterClick.viewers.filter((viewer) =>
        viewer.kind === "current-brief"
      );
      assertEquals(native.length, 1);
      assertEquals(native[0]?.title, "Current approved Brief · r4");
      assertEquals(native[0]?.kind, "current-brief");
      assertEquals(
        proof.afterClick.viewers.some((viewer) =>
          viewer.kind === "session" &&
          viewer.anchor === "artifact:approved-brief-document-r4"
        ),
        false,
      );
    } finally {
      await Deno.remove(profile, { recursive: true });
    }
  },
});

async function runPlaywright(
  profile: string,
): Promise<CurrentBriefScenarioProof> {
  const script = `${profile}/playwright-run.mjs`;
  await Deno.writeTextFile(
    script,
    `
import { createServer } from ${JSON.stringify(VITE)};
import { chromium } from ${JSON.stringify(PLAYWRIGHT)};
import { runCurrentBriefScenario } from ${JSON.stringify(PLAYWRIGHT_SCENARIO)};

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
  throw new Error("Vite did not bind a loopback port for the current Brief fixture.");
}
const origin = "http://127.0.0.1:" + port + "/testing/current-brief-browser.html";
const browser = await chromium.launch({
  headless: true,
  executablePath: ${JSON.stringify(CHROME)},
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(20000);
try {
  const proof = await runCurrentBriefScenario(page, { origin });
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
      `Playwright current Brief test failed: ${
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

async function playwrightAvailable(): Promise<boolean> {
  try {
    return (await Deno.stat(PLAYWRIGHT)).isFile;
  } catch {
    return false;
  }
}
