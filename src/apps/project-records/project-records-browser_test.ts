import { assertEquals } from "@std/assert";
import {
  materializeMcpAppDocument,
  planMcpAppDocument,
} from "../../ui/src/thread/mcp-app-document-loader.ts";
import {
  PROJECT_RECORDS_APP_ID,
  PROJECT_RECORDS_APP_VERSION,
  PROJECT_RECORDS_SESSION_KIND,
  PROJECT_RECORDS_SESSION_SCHEMA,
} from "./identity.ts";
import { buildProjectRecordsAppHtml } from "./project-records-app.ts";

const CHROME = chromeExecutable();
const PLAYWRIGHT = Deno.env.get("CASYS_PLAYWRIGHT_MODULE") ??
  new URL("../../ui/node_modules/playwright/index.mjs", import.meta.url).pathname;

Deno.test({
  name:
    "project-records App completes the generic host handshake in a sandboxed browser frame",
  ignore: CHROME === undefined,
  async fn() {
    const nonce = "A".repeat(43);
    const html = buildProjectRecordsAppHtml();
    const capture = JSON.stringify({
      schemaVersion: "approved-brief-baseline-capture/1.1",
      kind: "approved-brief-documentary-baseline",
      scope: "pre-technical-documentation",
      statement: "Immutable documentary capture of the approved brief.",
      runId: "run:baseline",
      capturedAt: "2026-08-03T09:00:01.000Z",
      operation: { id: "baseline.from-approved-brief", version: "1" },
      workItemId: "record-brief",
      projectDefinition: {
        identity: {
          id: "generic-product-v1",
          name: "Generic Industrial Product",
          subjectId: "generic-product-v1",
        },
      },
      approvedBrief: {
        briefId: "generic-product-v1:brief",
        id: "generic-product-v1:brief:r1",
        revision: 1,
        proposedAt: "2026-08-03T09:00:00.000Z",
        proposedBy: { id: "agent:test", origin: "agent" },
        items: [{
          id: "objective",
          kind: "objective",
          statement: "Prepare a reviewable industrial product design.",
          sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
        }, {
          id: "mission",
          kind: "mission-scenario",
          statement: "Operate safely under the intended operating conditions.",
          sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
        }, {
          id: "success",
          kind: "success-criterion",
          statement: "Demonstrate the approved baseline.",
          sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
        }],
      },
      briefSourceAnalysis: { briefId: "generic-product-v1:brief" },
    });
    const bytes = new TextEncoder().encode(capture);
    const fingerprint = await sha256Of(bytes);
    const data = bytesToBase64(bytes);
    const childHtml = materializeMcpAppDocument(
      planMcpAppDocument(html),
      nonce,
    );
    let parentHtml = "";
    const server = Deno.serve({ hostname: "127.0.0.1", port: 0 }, (request) => {
      const url = new URL(request.url);
      if (url.pathname !== "/") {
        return new Response("Not found", { status: 404 });
      }
      return new Response(parentHtml, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    });
    const origin = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`;
    parentHtml = parentDocument({
      nonce,
      childHtml,
      fingerprint,
      data,
      bytes: bytes.byteLength,
    });
    const profile = await Deno.makeTempDir({
      prefix: "casys-project-records-chrome-",
    });
    let chrome: Deno.ChildProcess | undefined;
    let chromeStatus: Promise<Deno.CommandStatus> | undefined;
    try {
      if (await playwrightAvailable()) {
        await runPlaywright(origin, profile);
      } else {
        chrome = new Deno.Command(CHROME!, {
          args: [
            "--headless=new",
            "--disable-background-networking",
            "--disable-component-update",
            "--disable-default-apps",
            "--disable-extensions",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--no-default-browser-check",
            "--no-first-run",
            "--no-sandbox",
            "--remote-debugging-port=0",
            `--user-data-dir=${profile}`,
            "about:blank",
          ],
          stdout: "null",
          stderr: "inherit",
        }).spawn();
        chromeStatus = chrome.status;
        const debuggerAddress = await waitForDebuggerAddress(profile);
        const target = await createDebuggerTarget(debuggerAddress, origin);
        const devTools = await connectDevTools(target.webSocketDebuggerUrl);
        try {
          const proof = await waitForProof(devTools);
          assertEquals(proof, {
            status: "ready",
            app: PROJECT_RECORDS_APP_ID,
            version: PROJECT_RECORDS_APP_VERSION,
            fingerprint,
          });
        } finally {
          devTools.close();
        }
      }
    } finally {
      try {
        if (chrome && chromeStatus) {
          chrome.kill("SIGTERM");
          await chromeStatus;
        }
      } finally {
        try {
          await server.shutdown();
        } finally {
          await Deno.remove(profile, { recursive: true });
        }
      }
    }
  },
});

async function playwrightAvailable(): Promise<boolean> {
  try {
    return (await Deno.stat(PLAYWRIGHT)).isFile;
  } catch {
    return false;
  }
}

async function runPlaywright(origin: string, profile: string): Promise<void> {
  const script = `${profile}/playwright-run.mjs`;
  await Deno.writeTextFile(
    script,
    `
import { chromium } from ${JSON.stringify(PLAYWRIGHT)};
const browser = await chromium.launch({ headless: true, executablePath: ${
      JSON.stringify(CHROME)
    } });
const page = await browser.newPage();
await page.goto(${JSON.stringify(origin)});
await page.waitForFunction(() => {
  const status = document.querySelector("#result")?.dataset.status;
  return status === "ready" || status === "failed";
}, null, { timeout: 15000 });
const proof = await page.evaluate(() => {
  const result = document.querySelector("#result");
  return {
    status: result?.dataset.status ?? "missing",
    app: result?.dataset.app ?? "",
    version: result?.dataset.version ?? "",
    fingerprint: result?.dataset.fingerprint ?? "",
  };
});
await browser.close();
if (proof.status !== "ready") {
  throw new Error("project-records Playwright handshake failed: " + JSON.stringify(proof));
}
console.log(JSON.stringify(proof));
`,
  );
  const output = await new Deno.Command("node", {
    args: [script],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(
      `Playwright handshake failed: ${new TextDecoder().decode(output.stderr)}`,
    );
  }
  const proof = JSON.parse(new TextDecoder().decode(output.stdout));
  assertEquals(proof.status, "ready");
  assertEquals(proof.app, PROJECT_RECORDS_APP_ID);
  assertEquals(proof.version, PROJECT_RECORDS_APP_VERSION);
}

function parentDocument(input: {
  readonly nonce: string;
  readonly childHtml: string;
  readonly fingerprint: string;
  readonly data: string;
  readonly bytes: number;
}): string {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"></head>
<body>
<div id="result" data-status="pending"></div>
<iframe sandbox="allow-scripts"></iframe>
<script nonce="${input.nonce}">
const result = document.querySelector("#result");
const frame = document.querySelector("iframe");
const childHtml = ${JSON.stringify(input.childHtml).replaceAll("<", "\\u003c")};
let resourcePort;
let appName = "";
let appVersion = "";
addEventListener("message", (event) => {
  if (event.source !== frame.contentWindow || event.origin !== "null") return;
  const message = event.data;
  if (message && message.type === "mcp-app-host.resource.port.offer" && event.ports.length === 1 && !resourcePort) {
    resourcePort = event.ports[0];
    resourcePort.start();
    resourcePort.addEventListener("message", (portEvent) => {
      const request = portEvent.data;
      if (!request || request.type !== "mcp-app-host.resource.read") return;
      if (request.fingerprint !== ${JSON.stringify(input.fingerprint)}) {
        result.dataset.status = "failed";
        result.dataset.reason = "unexpected-fingerprint";
        return;
      }
      resourcePort.postMessage({
        schemaVersion: "io.casys.mcp-app-host.resource-read/1.0",
        type: "mcp-app-host.resource.read.result",
        requestId: request.requestId,
        fingerprint: request.fingerprint,
        status: "available",
        resource: {
          uri: "/api/thread/viewer-apps/resources/${input.fingerprint.slice(7)}",
          mimeType: "application/json",
          bytes: ${input.bytes},
          fingerprint: request.fingerprint,
          encoding: "base64",
          data: ${JSON.stringify(input.data)}
        }
      });
      result.dataset.status = "ready";
      result.dataset.app = appName;
      result.dataset.version = appVersion;
      result.dataset.fingerprint = request.fingerprint;
    });
    return;
  }
  if (message && message.method === "ui/initialize") {
    appName = message.params && message.params.appInfo && message.params.appInfo.name || "";
    appVersion = message.params && message.params.appInfo && message.params.appInfo.version || "";
    if (appName !== ${JSON.stringify(PROJECT_RECORDS_APP_ID)} || appVersion !== ${
    JSON.stringify(PROJECT_RECORDS_APP_VERSION)
  } || message.params.protocolVersion !== "2026-01-26") {
      result.dataset.status = "failed";
      result.dataset.reason = "wrong-app";
      return;
    }
    frame.contentWindow.postMessage({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2026-01-26",
        hostInfo: { name: "casys-digital-thread-read-only-app-host", version: "1.0.0" },
        hostCapabilities: {},
        hostContext: { theme: "light", displayMode: "inline", availableDisplayModes: ["inline"] }
      }
    }, "*");
    return;
  }
  if (message && message.method === "ui/notifications/initialized") {
    frame.contentWindow.postMessage({
      jsonrpc: "2.0",
      method: "ui/compose/event",
      params: {
        action: "viewer.session.apply",
        data: {
          schemaVersion: ${JSON.stringify(PROJECT_RECORDS_SESSION_SCHEMA)},
          kind: ${JSON.stringify(PROJECT_RECORDS_SESSION_KIND)},
          fingerprint: ${JSON.stringify(input.fingerprint)},
          artifactId: "approved-brief-document-${input.fingerprint.slice(7)}",
          runId: "run:baseline",
          workItemId: "record-brief",
          projectId: "generic-product-v1",
          subjectId: "generic-product-v1",
          briefId: "generic-product-v1:brief",
          briefSnapshotId: "generic-product-v1:brief:r1",
          briefRevision: 1
        }
      }
    }, "*");
  }
});
frame.src = URL.createObjectURL(new Blob([childHtml], { type: "text/html" }));
</script>
</body>
</html>`;
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

async function sha256Of(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return `sha256:${
    [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
  }`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function waitForDebuggerAddress(profile: string): Promise<string> {
  const devToolsPath = `${profile}/DevToolsActivePort`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const [port] = (await Deno.readTextFile(devToolsPath)).trim().split("\n");
      if (port && /^(?:[1-9][0-9]{0,4})$/.test(port)) {
        return `127.0.0.1:${port}`;
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    await delay(100);
  }
  throw new Error("Chrome DevTools port was not published.");
}

async function createDebuggerTarget(
  debuggerAddress: string,
  url: string,
): Promise<{ webSocketDebuggerUrl: string }> {
  const response = await fetch(
    `http://${debuggerAddress}/json/new?${encodeURIComponent(url)}`,
    { method: "PUT" },
  );
  if (!response.ok) {
    throw new Error(`Chrome target creation failed: ${response.status}`);
  }
  return await response.json();
}

async function connectDevTools(webSocketDebuggerUrl: string) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error("DevTools socket failed."));
  });
  let nextId = 1;
  const pending = new Map<number, (value: Record<string, unknown>) => void>();
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data));
    if (typeof message.id === "number" && pending.has(message.id)) {
      pending.get(message.id)!(message.result ?? {});
      pending.delete(message.id);
    }
  };
  return {
    send(method: string, params?: Record<string, unknown>) {
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise<Record<string, unknown>>((resolve) => {
        pending.set(id, resolve);
      });
    },
    close() {
      socket.close();
    },
  };
}

async function waitForProof(
  devTools: {
    send(
      method: string,
      params?: Record<string, unknown>,
    ): Promise<Record<string, unknown>>;
  },
): Promise<{
  status: string;
  app: string;
  version: string;
  fingerprint: string;
}> {
  await devTools.send("Runtime.enable");
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const current = await devTools.send("Runtime.evaluate", {
      expression:
        `(() => { const result = document.querySelector("#result"); return result ? { status: result.dataset.status || "pending", app: result.dataset.app || "", version: result.dataset.version || "", fingerprint: result.dataset.fingerprint || "" } : { status: "missing", app: "", version: "", fingerprint: "" }; })()`,
      returnByValue: true,
    }) as {
      result?: {
        value?: {
          status: string;
          app: string;
          version: string;
          fingerprint: string;
        };
      };
    };
    const value = current.result?.value;
    if (value && (value.status === "ready" || value.status === "failed")) {
      return value;
    }
    await delay(100);
  }
  throw new Error("Browser handshake did not publish a proof.");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
