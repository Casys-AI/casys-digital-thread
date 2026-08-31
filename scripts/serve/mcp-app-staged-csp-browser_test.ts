import { assertEquals } from "@std/assert";
import {
  materializeMcpAppDocument,
  planMcpAppDocument,
} from "../../src/ui/src/thread/mcp-app-document-loader.ts";

const CHROME = chromeExecutable();

Deno.test({
  name:
    "Chrome runs the exact App module and resource port while staged CSP blocks nonce reuse and navigation",
  ignore: CHROME === undefined,
  async fn() {
    const nonce = "A".repeat(43);
    const leakHits: string[] = [];
    let parentHtml = "";
    const server = Deno.serve({ hostname: "127.0.0.1", port: 0 }, (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/leak") {
        leakHits.push(`${url.pathname}${url.search}`);
        return new Response("leaked", {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "text/javascript",
          },
        });
      }
      if (url.pathname !== "/") return new Response("Not found", { status: 404 });
      return new Response(parentHtml, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": parentCsp(nonce),
        },
      });
    });
    const origin = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`;
    const appHtml = exactAppHtml(origin);
    const childHtml = materializeMcpAppDocument(
      planMcpAppDocument(appHtml),
      nonce,
    );
    parentHtml = parentDocument(nonce, btoa(childHtml));
    const profile = await Deno.makeTempDir({ prefix: "casys-mcp-app-chrome-" });
    let chrome: Deno.ChildProcess | undefined;
    let chromeStatus: Promise<Deno.CommandStatus> | undefined;
    let devTools: DevToolsClient | undefined;

    try {
      chrome = new Deno.Command(CHROME!, {
        args: [
          "--headless=new",
          "--disable-background-networking",
          "--disable-component-update",
          "--disable-default-apps",
          "--disable-extensions",
          "--disable-gpu",
          "--no-default-browser-check",
          "--no-first-run",
          "--no-sandbox",
          "--remote-allow-origins=*",
          "--remote-debugging-port=0",
          `--user-data-dir=${profile}`,
          "about:blank",
        ],
        stdout: "null",
        stderr: "null",
      }).spawn();
      chromeStatus = chrome.status;

      const debuggerAddress = await waitForDebuggerAddress(profile);
      const target = await createDebuggerTarget(debuggerAddress, origin);
      devTools = await connectDevTools(target.webSocketDebuggerUrl);
      await devTools.send("Runtime.enable");
      const proof = await waitForBrowserProof(devTools);

      assertEquals(proof, {
        status: "ready",
        session: "true",
        resource: "true",
      });
      // The App starts each attempted exfiltration before publishing the proof.
      // Allow any already-dispatched network request to reach the local server.
      await delay(200);
      assertEquals(leakHits, []);
    } finally {
      try {
        devTools?.close();
        if (chrome && chromeStatus) await stopChrome(chrome, chromeStatus);
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

function exactAppHtml(origin: string): string {
  const script = `
const channel = new MessageChannel();
channel.port1.start();
parent.postMessage({schemaVersion:"io.casys.mcp-app-host.resource-read/1.0",type:"mcp-app-host.resource.port.offer"},"*",[channel.port2]);
let sessionDelivered = false;
addEventListener("message", (event) => {
  const message = event.data;
  if (message?.jsonrpc === "2.0" && message?.id === 1 && message?.result) {
    parent.postMessage({jsonrpc:"2.0",method:"ui/notifications/initialized"},"*");
    return;
  }
  if (message?.jsonrpc === "2.0" && message?.method === "ui/compose/event" && message?.params?.action === "viewer.session.apply") {
    sessionDelivered = message.params.data?.schemaVersion === "io.casys.test.session/1.0";
    channel.port1.postMessage({schemaVersion:"io.casys.mcp-app-host.resource-read/1.0",type:"mcp-app-host.resource.read",requestId:"browser-probe",fingerprint:"sha256:${
    "b".repeat(64)
  }"});
  }
});
channel.port1.addEventListener("message", (event) => {
  const message = event.data;
  if (message?.type !== "mcp-app-host.resource.read.result" || message?.status !== "available") return;
  const stolenNonce = document.querySelector("script")?.nonce ?? "";
  const external = document.createElement("script");
  external.src = ${JSON.stringify(`${origin}/leak?via=reused-nonce`)};
  external.nonce = stolenNonce;
  document.head.append(external);
  void fetch(${JSON.stringify(`${origin}/leak?via=fetch`)}).catch(() => {});
  parent.postMessage({type:"probe.ready",sessionDelivered,resourceDelivered:message.resource?.data === "AQID",nonceLength:stolenNonce.length},"*");
  location.href = ${JSON.stringify(`${origin}/leak?via=navigation`)};
});
parent.postMessage({jsonrpc:"2.0",id:1,method:"ui/initialize",params:{protocolVersion:"2026-01-26",appInfo:{name:"io.casys.test.app",version:"1.0.0"},appCapabilities:{}}},"*");
`;
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module">${script}</script></body></html>`;
}

function parentDocument(nonce: string, childBase64: string): string {
  const parentScript = `
const result = document.querySelector("#result");
const frame = document.querySelector("iframe");
const childHtml = atob(${JSON.stringify(childBase64)});
let resourcePort;
let proof;
addEventListener("message", (event) => {
  if (event.source !== frame.contentWindow || event.origin !== "null") return;
  const message = event.data;
  if (message?.type === "mcp-app-host.resource.port.offer" && event.ports.length === 1 && !resourcePort) {
    resourcePort = event.ports[0];
    resourcePort.start();
    resourcePort.addEventListener("message", (portEvent) => {
      if (portEvent.data?.type !== "mcp-app-host.resource.read") return;
      resourcePort.postMessage({schemaVersion:"io.casys.mcp-app-host.resource-read/1.0",type:"mcp-app-host.resource.read.result",requestId:"browser-probe",fingerprint:"sha256:${
    "b".repeat(64)
  }",status:"available",resource:{uri:"/api/thread/viewer-apps/resources/${
    "b".repeat(64)
  }",mimeType:"application/octet-stream",bytes:3,fingerprint:"sha256:${
    "b".repeat(64)
  }",encoding:"base64",data:"AQID"}});
    });
    return;
  }
  if (message?.method === "ui/initialize" && message?.id === 1) {
    frame.contentWindow.postMessage({jsonrpc:"2.0",id:1,result:{protocolVersion:"2026-01-26",hostInfo:{name:"casys-digital-thread",version:"1.0.0"},hostCapabilities:{},hostContext:{theme:"light",displayMode:"inline",availableDisplayModes:["inline"]}}},"*");
    return;
  }
  if (message?.method === "ui/notifications/initialized") {
    frame.contentWindow.postMessage({jsonrpc:"2.0",method:"ui/compose/event",params:{action:"viewer.session.apply",data:{schemaVersion:"io.casys.test.session/1.0"}}},"*");
    return;
  }
  if (message?.type === "probe.ready") {
    proof = message;
    result.dataset.status = proof.sessionDelivered && proof.resourceDelivered && proof.nonceLength === 43 ? "ready" : "failed";
    result.dataset.session = String(proof.sessionDelivered);
    result.dataset.resource = String(proof.resourceDelivered);
  }
});
frame.src = URL.createObjectURL(new Blob([childHtml], {type:"text/html"}));
`;
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="result" data-status="pending"></div><iframe sandbox="allow-scripts"></iframe><script nonce="${nonce}">${parentScript}</script></body></html>`;
}

function parentCsp(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "script-src-attr 'none'",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "connect-src 'self'",
    "frame-src blob:",
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "media-src 'none'",
    "worker-src 'none'",
  ].join("; ");
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

interface DebuggerTarget {
  readonly webSocketDebuggerUrl: string;
}

interface BrowserProof {
  readonly status: string;
  readonly session: string;
  readonly resource: string;
}

interface PendingDevToolsCommand {
  readonly resolve: (result: Record<string, unknown>) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

class DevToolsClient {
  readonly #socket: WebSocket;
  readonly #pending = new Map<number, PendingDevToolsCommand>();
  #nextId = 1;

  constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      const message = JSON.parse(event.data) as {
        readonly id?: number;
        readonly result?: Record<string, unknown>;
        readonly error?: { readonly message?: string };
      };
      if (message.id === undefined) return;
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) {
        pending.reject(
          new Error(
            `Chrome DevTools command failed: ${
              message.error.message ?? "unknown error"
            }`,
          ),
        );
        return;
      }
      pending.resolve(message.result ?? {});
    });
    socket.addEventListener("close", () => {
      for (const pending of this.#pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("Chrome DevTools connection closed."));
      }
      this.#pending.clear();
    });
  }

  send(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Chrome DevTools command timed out: ${method}`));
      }, 3_000);
      this.#pending.set(id, { resolve, reject, timeout });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.#socket.close();
  }
}

async function waitForDebuggerAddress(profile: string): Promise<string> {
  const activePortPath = `${profile}/DevToolsActivePort`;
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    try {
      const [port] = (await Deno.readTextFile(activePortPath)).trim().split("\n");
      if (port && /^(?:[1-9][0-9]{0,4})$/.test(port)) {
        return `http://127.0.0.1:${port}`;
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    await delay(25);
  }
  throw new Error("Chrome did not publish its DevTools endpoint.");
}

async function createDebuggerTarget(
  debuggerAddress: string,
  url: string,
): Promise<DebuggerTarget> {
  const response = await fetchWithTimeout(
    `${debuggerAddress}/json/new?${encodeURIComponent(url)}`,
    { method: "PUT" },
    3_000,
  );
  if (!response.ok) {
    throw new Error(`Chrome could not create a test target (${response.status}).`);
  }
  const target = await response.json() as Partial<DebuggerTarget>;
  if (
    typeof target.webSocketDebuggerUrl !== "string" ||
    !target.webSocketDebuggerUrl.startsWith("ws://127.0.0.1:")
  ) {
    throw new Error("Chrome returned an invalid test target.");
  }
  return target as DebuggerTarget;
}

async function connectDevTools(url: string): Promise<DevToolsClient> {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Chrome DevTools connection timed out."));
    }, 3_000);
    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("Chrome DevTools connection failed."));
    }, { once: true });
  });
  return new DevToolsClient(socket);
}

async function waitForBrowserProof(
  devTools: DevToolsClient,
): Promise<BrowserProof> {
  const deadline = Date.now() + 8_000;
  let lastValue: unknown;
  while (Date.now() < deadline) {
    try {
      const evaluation = await devTools.send("Runtime.evaluate", {
        expression:
          `(() => { const result = document.querySelector("#result"); return result ? { status: result.dataset.status ?? "", session: result.dataset.session ?? "", resource: result.dataset.resource ?? "" } : null; })()`,
        returnByValue: true,
      });
      const remote = evaluation.result as
        | { readonly value?: unknown }
        | undefined;
      lastValue = remote?.value;
      if (
        isBrowserProof(lastValue) &&
        lastValue.status !== "pending"
      ) {
        return lastValue;
      }
    } catch {
      // Navigation can briefly replace the execution context. Retry until the
      // bounded proof deadline instead of making that timing observable.
    }
    await delay(50);
  }
  throw new Error(
    `Chrome did not publish the MCP App proof: ${JSON.stringify(lastValue)}`,
  );
}

function isBrowserProof(value: unknown): value is BrowserProof {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BrowserProof>;
  return typeof candidate.status === "string" &&
    typeof candidate.session === "string" &&
    typeof candidate.resource === "string";
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function stopChrome(
  chrome: Deno.ChildProcess,
  status: Promise<Deno.CommandStatus>,
): Promise<void> {
  try {
    chrome.kill("SIGTERM");
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  if (await settlesWithin(status, 2_000)) return;
  try {
    chrome.kill("SIGKILL");
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  if (!(await settlesWithin(status, 2_000))) {
    throw new Error("The test Chrome process did not terminate.");
  }
}

async function settlesWithin<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
