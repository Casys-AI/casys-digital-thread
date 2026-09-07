import { assertEquals } from "@std/assert";
import type { ThreadViewerSession } from "../presentation/workbench/thread/viewer-sessions.ts";
import {
  createMcpAppReadOnlyHost,
  MCP_APP_READ_ONLY_HOST_PROTOCOL_VERSION,
  type McpAppHostPostTarget,
} from "./src/thread/mcp-app-read-only-host.ts";
import {
  MCP_APP_HOST_RESOURCE_PORT_OFFER,
  MCP_APP_HOST_RESOURCE_READ_REQUEST,
  MCP_APP_HOST_RESOURCE_READ_SCHEMA,
} from "./src/thread/mcp-app-resource-bridge.ts";
import {
  advanceMcpAppFrameLoad,
  assignMcpAppFrameDocument,
  beginMcpAppFrameLaunch,
  bindMcpAppFrameGeneration,
  type McpAppFrameNode,
  startMcpAppFrame,
} from "./src/thread/mcp-app-frame-lifecycle.ts";
import type { LoadedMcpAppDocument } from "./src/thread/mcp-app-document-loader.ts";
import type { McpAppFrameStatus } from "./src/thread/mcp-app-frame-status.ts";
import { resolveMcpAppTheme } from "./src/thread/mcp-app-frame-theme.ts";

const RESOURCE_BYTES = new TextEncoder().encode("registered bytes");
const RESOURCE_FINGERPRINT = await sha256Fingerprint(RESOURCE_BYTES);
const SESSION = sessionFixture();

Deno.test("MCP App theme follows the rendered Workbench before the OS preference", () => {
  assertEquals(
    resolveMcpAppTheme({ colorScheme: "light", prefersDark: true }),
    "light",
  );
  assertEquals(
    resolveMcpAppTheme({ colorScheme: "dark", prefersDark: false }),
    "dark",
  );
  assertEquals(
    resolveMcpAppTheme({ dataTheme: "light", darkClass: true }),
    "light",
  );
  assertEquals(
    resolveMcpAppTheme({ colorScheme: "normal", prefersDark: true }),
    "dark",
  );
});

Deno.test("read-only App host sends the session once and only after initialized", () => {
  const target = new FakeTarget();
  const host = createHost(target);
  const resources = new MessageChannel();
  assertEquals(host.handleMessage(portOffer(target, resources.port2)), true);

  assertEquals(host.handleMessage(event(target, initialized())), false);
  assertEquals(target.posts, []);

  assertEquals(host.handleMessage(event(target, initialize("init-1"))), true);
  assertEquals(target.posts.length, 1);
  assertEquals(target.posts[0]?.targetOrigin, "*");
  assertEquals(target.posts[0]?.message, {
    jsonrpc: "2.0",
    id: "init-1",
    result: {
      protocolVersion: MCP_APP_READ_ONLY_HOST_PROTOCOL_VERSION,
      hostInfo: {
        name: "casys-digital-thread-read-only-app-host",
        version: "1.0.0",
      },
      hostCapabilities: {},
      hostContext: {
        theme: "dark",
        displayMode: "inline",
        availableDisplayModes: ["inline"],
      },
    },
  });

  host.handleMessage(event(target, initialized()));
  host.handleMessage(event(target, initialized()));
  assertEquals(
    target.posts.filter((post) => methodOf(post.message) === "ui/compose/event"),
    [{
      targetOrigin: "*",
      message: {
        jsonrpc: "2.0",
        method: "ui/compose/event",
        params: {
          action: "viewer.session.apply",
          data: SESSION.session.payload,
        },
      },
    }],
  );
  assertEquals(
    target.posts.some((post) =>
      (post.message as { type?: unknown }).type ===
        MCP_APP_HOST_RESOURCE_PORT_OFFER
    ),
    false,
  );
  host.invalidate();
  resources.port1.close();
});

Deno.test("read-only App host source-locks the exact opaque App identity", () => {
  const target = new FakeTarget();
  const host = createHost(target);
  const stranger = new FakeTarget();

  assertEquals(host.handleMessage(event(stranger, initialize(1))), false);
  assertEquals(
    host.handleMessage({
      ...event(target, initialize(2)),
      origin: "https://workbench.invalid",
    }),
    false,
  );
  assertEquals(target.posts, []);

  host.handleMessage(event(target, {
    ...initialize("wrong-app"),
    params: {
      ...initialize("ignored").params,
      appInfo: { name: "io.casys.lookalike", version: "1.2.3" },
    },
  }));
  assertEquals(target.posts[0]?.message, {
    jsonrpc: "2.0",
    id: "wrong-app",
    error: {
      code: -32602,
      message: "App identity does not match the registered whole-App descriptor.",
    },
  });
  assertEquals(
    target.posts.some((post) => methodOf(post.message) === "ui/compose/event"),
    false,
  );
});

Deno.test("host presentation keeps the latest handshake state and sends only live deltas", () => {
  const target = new FakeTarget();
  const host = createHost(target);
  host.updateHostContext({ theme: "light", locale: "en" });
  assertEquals(target.posts, []);

  host.handleMessage(event(target, initialize("init")));
  assertEquals(
    (target.posts[0]?.message as {
      result: { hostContext: unknown };
    }).result.hostContext,
    {
      theme: "light",
      locale: "en",
      displayMode: "inline",
      availableDisplayModes: ["inline"],
    },
  );

  host.updateHostContext({ theme: "dark", locale: "fr" });
  assertEquals(target.posts.length, 1);
  host.handleMessage(event(target, initialized()));
  assertEquals(target.posts[1]?.message, {
    jsonrpc: "2.0",
    method: "ui/notifications/host-context-changed",
    params: { theme: "dark", locale: "fr" },
  });
  assertEquals(methodOf(target.posts[2]?.message), "ui/compose/event");

  host.updateHostContext({ theme: "dark", locale: "fr" });
  assertEquals(target.posts.length, 3);
  host.updateHostContext({ theme: "light" });
  assertEquals(target.posts[3]?.message, {
    jsonrpc: "2.0",
    method: "ui/notifications/host-context-changed",
    params: { theme: "light" },
  });
  host.updateHostContext({ locale: "en" });
  assertEquals(target.posts[4]?.message, {
    jsonrpc: "2.0",
    method: "ui/notifications/host-context-changed",
    params: { locale: "en" },
  });
  host.handleMessage(event(target, initialized()));
  assertEquals(target.posts.length, 5);
  host.invalidate();
  host.updateHostContext({ theme: "dark", locale: "fr" });
  assertEquals(target.posts.length, 5);
});

Deno.test("host presentation updates cannot carry authority or replace the recorded session", () => {
  const target = new FakeTarget();
  const host = createHost(target);
  host.handleMessage(event(target, initialize("init")));
  host.handleMessage(event(target, initialized()));
  target.posts.length = 0;

  const extraFields = {
    theme: "light" as const,
    locale: "fr",
    displayMode: "fullscreen",
    hostCapabilities: { serverTools: {} },
    session: { action: "replace-session" },
    styles: { css: { fonts: "untrusted CSS" } },
  };
  host.updateHostContext(extraFields);
  assertEquals(target.posts.map((post) => post.message), [{
    jsonrpc: "2.0",
    method: "ui/notifications/host-context-changed",
    params: { theme: "light", locale: "fr" },
  }]);

  assertEquals(
    host.handleMessage(event(target, {
      jsonrpc: "2.0",
      method: "ui/notifications/host-context-changed",
      params: { theme: "dark", hostCapabilities: { serverTools: {} } },
    })),
    false,
  );
  host.updateHostContext({ theme: "light", locale: "fr" });
  assertEquals(target.posts.length, 1);
  host.invalidate();
});

Deno.test("read-only App host rejects every non-pinned protocol version", async () => {
  let fetches = 0;
  const target = new FakeTarget();
  const host = createMcpAppReadOnlyHost({
    target,
    session: SESSION,
    hostContext: {
      displayMode: "inline",
      availableDisplayModes: ["inline"],
    },
    fetcher: () => {
      fetches += 1;
      return Promise.resolve(new Response(RESOURCE_BYTES));
    },
  });
  const resources = new MessageChannel();
  host.handleMessage(portOffer(target, resources.port2));
  const wrong = initialize("wrong-version");
  host.handleMessage(event(target, {
    ...wrong,
    params: { ...wrong.params, protocolVersion: "2099-01-01" },
  }));
  host.handleMessage(event(target, initialized()));
  resources.port1.postMessage({
    schemaVersion: MCP_APP_HOST_RESOURCE_READ_SCHEMA,
    type: MCP_APP_HOST_RESOURCE_READ_REQUEST,
    requestId: "wrong-protocol-read",
    fingerprint: RESOURCE_FINGERPRINT,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEquals(target.posts.length, 1);
  assertEquals(
    (target.posts[0]?.message as { error?: { code?: number } }).error?.code,
    -32602,
  );
  assertEquals(fetches, 0);
  host.invalidate();
  resources.port1.close();
});

Deno.test("read-only App host advertises no MCP authority and rejects authority requests", () => {
  const target = new FakeTarget();
  const host = createHost(target);
  host.handleMessage(event(target, initialize("init")));
  target.posts.length = 0;

  for (
    const method of [
      "tools/call",
      "tools/list",
      "resources/read",
      "resources/list",
      "sampling/createMessage",
      "ui/message",
      "ui/open-link",
      "ui/update-model-context",
      "ui/compose/event",
    ]
  ) {
    host.handleMessage(event(target, {
      jsonrpc: "2.0",
      id: method,
      method,
      params: {},
    }));
  }
  assertEquals(target.posts.length, 9);
  for (const post of target.posts) {
    const response = post.message as {
      result?: unknown;
      error?: { code: number };
    };
    assertEquals(response.result, undefined);
    assertEquals(response.error?.code, -32601);
  }

  target.posts.length = 0;
  host.handleMessage(event(target, {
    jsonrpc: "2.0",
    id: "display-mode",
    method: "ui/request-display-mode",
    params: { mode: "fullscreen" },
  }));
  assertEquals(target.posts[0]?.message, {
    jsonrpc: "2.0",
    id: "display-mode",
    result: { mode: "inline" },
  });
});

Deno.test("read-only App host invalidation drops navigation messages and pending reads", async () => {
  const target = new FakeTarget();
  let resolveFetch: ((response: Response) => void) | undefined;
  let markFetchStarted: (() => void) | undefined;
  const fetchStarted = new Promise<void>((resolve) => {
    markFetchStarted = resolve;
  });
  const fetchPromise = new Promise<Response>((resolve) => {
    resolveFetch = resolve;
  });
  const host = createMcpAppReadOnlyHost({
    target,
    session: SESSION,
    hostContext: {
      displayMode: "inline",
      availableDisplayModes: ["inline"],
    },
    fetcher: () => {
      markFetchStarted?.();
      return fetchPromise;
    },
  });
  const resources = new MessageChannel();
  host.handleMessage(portOffer(target, resources.port2));
  host.handleMessage(event(target, initialize("init")));
  host.handleMessage(event(target, initialized()));
  const resourcePort = resources.port1;
  target.posts.length = 0;
  const resourceResponses: unknown[] = [];
  resourcePort.onmessage = (event) => resourceResponses.push(event.data);
  resourcePort.start();
  resourcePort.postMessage({
    schemaVersion: MCP_APP_HOST_RESOURCE_READ_SCHEMA,
    type: MCP_APP_HOST_RESOURCE_READ_REQUEST,
    requestId: "resource-1",
    fingerprint: RESOURCE_FINGERPRINT,
  });
  await fetchStarted;
  host.invalidate();
  resolveFetch?.(
    new Response(RESOURCE_BYTES, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(RESOURCE_BYTES.byteLength),
      },
    }),
  );
  await fetchPromise;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEquals(target.posts, []);
  assertEquals(resourceResponses, []);
  assertEquals(
    host.handleMessage(event(target, {
      schemaVersion: MCP_APP_HOST_RESOURCE_READ_SCHEMA,
      type: MCP_APP_HOST_RESOURCE_READ_REQUEST,
      requestId: "window-resource",
      fingerprint: RESOURCE_FINGERPRINT,
    })),
    false,
  );
  assertEquals(
    host.handleMessage(event(target, initialize("new-document"))),
    false,
  );
  resourcePort.close();

  const teardownTarget = new FakeTarget();
  const teardownHost = createHost(teardownTarget);
  teardownHost.handleMessage(event(teardownTarget, initialize("init")));
  teardownTarget.posts.length = 0;
  teardownHost.invalidate();
  teardownHost.invalidate();
  assertEquals(teardownTarget.posts, []);
});

Deno.test("read-only App host binds only the first App-created resource port", async () => {
  const target = new FakeTarget();
  let fetches = 0;
  const host = createMcpAppReadOnlyHost({
    target,
    session: SESSION,
    hostContext: { displayMode: "inline", availableDisplayModes: ["inline"] },
    fetcher: () => {
      fetches += 1;
      return Promise.resolve(
        new Response(RESOURCE_BYTES, {
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": String(RESOURCE_BYTES.byteLength),
          },
        }),
      );
    },
  });
  const first = new MessageChannel();
  const replacement = new MessageChannel();
  host.handleMessage(portOffer(target, first.port2));
  host.handleMessage(portOffer(target, replacement.port2));
  host.handleMessage(event(target, initialize("init")));
  host.handleMessage(event(target, initialized()));

  host.updateHostContext({ theme: "light", locale: "fr" });
  const request = {
    schemaVersion: MCP_APP_HOST_RESOURCE_READ_SCHEMA,
    type: MCP_APP_HOST_RESOURCE_READ_REQUEST,
    requestId: "resource-first-port",
    fingerprint: RESOURCE_FINGERPRINT,
  } as const;
  replacement.port1.postMessage(request);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEquals(fetches, 0);
  first.port1.postMessage(request);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEquals(fetches, 1);
  assertEquals(
    target.posts.filter((post) => methodOf(post.message) === "ui/compose/event")
      .length,
    1,
  );

  host.invalidate();
  first.port1.close();
  replacement.port1.close();
});

Deno.test("accepted initialize seals an absent resource-port offer", async () => {
  let fetches = 0;
  const target = new FakeTarget();
  const host = createMcpAppReadOnlyHost({
    target,
    session: SESSION,
    hostContext: {
      displayMode: "inline",
      availableDisplayModes: ["inline"],
    },
    fetcher: () => {
      fetches += 1;
      return Promise.resolve(
        new Response(RESOURCE_BYTES, {
          headers: {
            "Content-Type": "model/gltf-binary",
            "Content-Length": String(RESOURCE_BYTES.byteLength),
          },
        }),
      );
    },
  });
  host.handleMessage(event(target, initialize("init")));
  host.handleMessage(event(target, initialized()));

  const replacement = new MessageChannel();
  host.handleMessage(portOffer(target, replacement.port2));
  replacement.port1.postMessage({
    schemaVersion: MCP_APP_HOST_RESOURCE_READ_SCHEMA,
    type: MCP_APP_HOST_RESOURCE_READ_REQUEST,
    requestId: "replacement-document",
    fingerprint: RESOURCE_FINGERPRINT,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEquals(fetches, 0);
  replacement.port1.close();
  host.invalidate();
});

Deno.test("opaque App frame separates blank, App and secondary loads", async () => {
  assertEquals(advanceMcpAppFrameLoad("waiting-controller"), [
    "waiting-controller",
    "ignore",
  ]);
  assertEquals(advanceMcpAppFrameLoad("starting"), ["starting", "ignore"]);
  assertEquals(beginMcpAppFrameLaunch("waiting-controller"), [
    "starting",
    "launch",
  ]);
  assertEquals(assignMcpAppFrameDocument("starting"), [
    "loading-app",
    "arm",
  ]);
  assertEquals(advanceMcpAppFrameLoad("loading-app"), [
    "app-loaded",
    "accept",
  ]);
  assertEquals(advanceMcpAppFrameLoad("app-loaded"), [
    "invalid",
    "invalidate",
  ]);
  assertEquals(advanceMcpAppFrameLoad("invalid"), ["invalid", "ignore"]);

  const source = await Deno.readTextFile(
    new URL("./src/thread/mcp-app-frame.tsx", import.meta.url),
  );
  const lifecycle = await Deno.readTextFile(
    new URL("./src/thread/mcp-app-frame-lifecycle.ts", import.meta.url),
  );
  assertEquals(
    source.includes('setAttribute("sandbox", "allow-scripts")'),
    true,
  );
  assertEquals(source.includes("allow-same-origin"), false);
  assertEquals(lifecycle.includes("allow-same-origin"), false);
  assertEquals(source.includes("event.origin"), false);
  assertEquals(source.includes("useLayoutEffect"), true);
  assertEquals(source.includes('document.createElement("iframe")'), true);
  assertEquals(source.includes('frameNode.loading = "eager"'), true);
  assertEquals(source.includes('loading = "lazy"'), false);
  assertEquals(lifecycle.includes('loading = "lazy"'), false);
  assertEquals(source.includes("blankLoadObserved"), false);
  assertEquals(source.includes("waiting-blank-load"), false);
  assertEquals(lifecycle.includes("waiting-blank-load"), false);
  assertEquals(source.includes("loadVerifiedMcpAppDocument"), true);
  assertEquals(source.includes("frameNode.src = document.url"), true);
  assertEquals(source.includes("frameNode.src = session.launchUri"), false);
  assertEquals(source.includes("src={session.launchUri}"), false);
  assertEquals(
    lifecycle.indexOf('addEventListener("load", advanceLoad)') <
      lifecycle.indexOf("options.frame.src"),
    true,
  );
  assertEquals(lifecycle.includes("document.revoke()"), true);
  assertEquals(lifecycle.includes("revokeLoadedDocument()"), true);
  assertEquals(lifecycle.includes("host?.invalidate()"), true);
  assertEquals(source.includes("callTool("), false);
  assertEquals(source.includes("providerEndpoint"), false);
  assertEquals(source.includes("ui/resource-teardown"), false);
  assertEquals(lifecycle.includes("callTool("), false);
  assertEquals(lifecycle.includes("providerEndpoint"), false);
  assertEquals(lifecycle.includes("ui/resource-teardown"), false);
});

Deno.test("App offer delivered after its load works and a replacement document is revoked", async () => {
  let fetches = 0;
  const target = new FakeTarget();
  const host = createMcpAppReadOnlyHost({
    target,
    session: SESSION,
    hostContext: { displayMode: "inline", availableDisplayModes: ["inline"] },
    fetcher: () => {
      fetches += 1;
      return Promise.resolve(
        new Response(RESOURCE_BYTES, {
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": String(RESOURCE_BYTES.byteLength),
          },
        }),
      );
    },
  });
  let phase: Parameters<typeof advanceMcpAppFrameLoad>[0] = "waiting-controller";
  [phase] = beginMcpAppFrameLaunch(phase);
  assertEquals(phase, "starting");
  assertEquals(advanceMcpAppFrameLoad(phase), ["starting", "ignore"]);
  [phase] = assignMcpAppFrameDocument(phase);
  assertEquals(phase, "loading-app");
  [phase] = advanceMcpAppFrameLoad(phase);
  assertEquals(phase, "app-loaded");

  // Chrome dispatches the App load before delivering the offer posted by its
  // top-level script. The offer still precedes initialize in the message FIFO.
  const first = new MessageChannel();
  assertEquals(host.handleMessage(portOffer(target, first.port2)), true);
  assertEquals(host.handleMessage(event(target, initialize("init"))), true);
  assertEquals(host.handleMessage(event(target, initialized())), true);
  first.port1.postMessage({
    schemaVersion: MCP_APP_HOST_RESOURCE_READ_SCHEMA,
    type: MCP_APP_HOST_RESOURCE_READ_REQUEST,
    requestId: "first-document",
    fingerprint: RESOURCE_FINGERPRINT,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEquals(fetches, 1);

  [phase] = advanceMcpAppFrameLoad(phase);
  assertEquals(phase, "invalid");
  host.invalidate();
  const replacement = new MessageChannel();
  assertEquals(host.handleMessage(portOffer(target, replacement.port2)), false);
  assertEquals(
    host.handleMessage(event(target, initialize("replacement"))),
    false,
  );
  replacement.port1.postMessage({
    schemaVersion: MCP_APP_HOST_RESOURCE_READ_SCHEMA,
    type: MCP_APP_HOST_RESOURCE_READ_REQUEST,
    requestId: "replacement-document",
    fingerprint: RESOURCE_FINGERPRINT,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEquals(fetches, 1);
  first.port1.close();
  replacement.port1.close();
});

Deno.test("read-only App host publishes presentation readiness only after verified session delivery", async () => {
  const events: unknown[] = [];
  let resourceRead: (() => void) | undefined;
  const resourceReadSeen = new Promise<void>((resolve) => {
    resourceRead = resolve;
  });
  const target = new FakeTarget();
  let fetches = 0;
  const host = createMcpAppReadOnlyHost({
    target,
    session: SESSION,
    hostContext: {
      theme: "dark",
      displayMode: "inline",
      availableDisplayModes: ["inline"],
    },
    fetcher: () => {
      fetches += 1;
      return Promise.resolve(
        new Response(RESOURCE_BYTES, {
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": String(RESOURCE_BYTES.byteLength),
          },
        }),
      );
    },
    onPresentationReadiness: (event) => {
      events.push(event);
      if (event.kind === "resource-read") resourceRead?.();
    },
  });
  const resources = new MessageChannel();
  host.handleMessage(portOffer(target, resources.port2));
  host.handleMessage(event(target, {
    jsonrpc: "2.0",
    method: "ui/notifications/size-changed",
    params: {},
  }));
  assertEquals(events, []);
  host.handleMessage(event(target, initialize("init")));
  assertEquals(events, []);
  host.handleMessage(event(target, initialized()));
  assertEquals(events, [{ kind: "session-delivered" }]);

  const resourcePort = resources.port1;
  resourcePort.start();
  resourcePort.postMessage({
    schemaVersion: MCP_APP_HOST_RESOURCE_READ_SCHEMA,
    type: MCP_APP_HOST_RESOURCE_READ_REQUEST,
    requestId: "readiness-resource",
    fingerprint: RESOURCE_FINGERPRINT,
  });
  await resourceReadSeen;
  assertEquals(fetches, 1);
  assertEquals(events[1], { kind: "resource-read", status: "available" });
  host.invalidate();
  resourcePort.close();
});

Deno.test("frame generation launches without a blank load and ignores a late blank", async () => {
  const frame = new FakeFrame();
  const revoked: string[] = [];
  const statuses: McpAppFrameStatus[] = [];
  let release: ((document: LoadedMcpAppDocument) => void) | undefined;
  const generation = bindMcpAppFrameGeneration({
    frame,
    session: SESSION,
    hostContext: { theme: "dark" },
    onStatus: (status) => statuses.push(status),
    readNonce: () => "A".repeat(43),
    loadDocument: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  await Promise.resolve();
  assertEquals(frame.src, "");
  assertEquals(statuses[0], { kind: "loading", stage: "fetching-document" });
  frame.dispatch("load");
  assertEquals(frame.src, "");
  assertEquals(statuses.some((status) => status.kind === "error"), false);
  release?.({
    url: "blob:test/1",
    revoke: () => revoked.push("blob:test/1"),
  });
  await Promise.resolve();
  await Promise.resolve();
  assertEquals(frame.src, "blob:test/1");
  assertEquals(statuses.at(-1), {
    kind: "loading",
    stage: "loading-document",
  });
  frame.dispatch("load");
  assertEquals(statuses.at(-1), {
    kind: "loading",
    stage: "awaiting-session",
  });
  frame.dispatch("load");
  assertEquals(statuses.at(-1), {
    kind: "error",
    reason: "document-replaced",
  });
  generation.dispose();
  assertEquals(revoked, ["blob:test/1"]);
});

Deno.test("frame generation surfaces document fetch refusal and retries a new generation", async () => {
  const frames: FakeFrame[] = [];
  const removed: FakeFrame[] = [];
  const statuses: McpAppFrameStatus[] = [];
  let attempts = 0;
  const handle = startMcpAppFrame({
    session: SESSION,
    hostContext: () => ({ theme: "dark" }),
    onStatus: (status) => statuses.push(status),
    readNonce: () => "A".repeat(43),
    createFrame() {
      const frame = new FakeFrame();
      frames.push(frame);
      return frame;
    },
    disposeFrame(frame) {
      removed.push(frame as FakeFrame);
    },
    loadDocument() {
      attempts += 1;
      if (attempts === 1) {
        return Promise.reject(
          new Error("The registered MCP App document is unavailable."),
        );
      }
      return Promise.resolve({
        url: `blob:test/${attempts}`,
        revoke() {},
      });
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEquals(attempts, 1);
  assertEquals(statuses.at(-1), {
    kind: "unavailable",
    reason: "document-unavailable",
  });
  handle.retry();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEquals(attempts, 2);
  assertEquals(removed.length, 1);
  assertEquals(frames.at(-1)?.src, "blob:test/2");
  handle.dispose();
  assertEquals(removed.length, 2);
});

function createHost(target: FakeTarget) {
  return createMcpAppReadOnlyHost({
    target,
    session: SESSION,
    hostContext: {
      theme: "dark",
      displayMode: "inline",
      availableDisplayModes: ["inline"],
    },
  });
}

function event(
  source: McpAppHostPostTarget,
  data: unknown,
) {
  return { source, origin: "null", data } as const;
}

function initialize(id: string | number) {
  return {
    jsonrpc: "2.0",
    id,
    method: "ui/initialize",
    params: {
      appInfo: { name: SESSION.app.id, version: SESSION.app.version },
      protocolVersion: MCP_APP_READ_ONLY_HOST_PROTOCOL_VERSION,
      appCapabilities: {},
    },
  } as const;
}

function initialized() {
  return {
    jsonrpc: "2.0",
    method: "ui/notifications/initialized",
    params: {},
  } as const;
}

function methodOf(value: unknown): unknown {
  return typeof value === "object" && value !== null && "method" in value
    ? value.method
    : undefined;
}

class FakeFrame implements McpAppFrameNode {
  src = "";
  loading = "";
  className = "";
  title = "";
  referrerPolicy = "";
  contentWindow: FakeTarget | null = new FakeTarget();
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Set<() => void>>();

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  addEventListener(type: "load" | "error", listener: () => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: "load" | "error", listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: "load" | "error"): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  remove(): void {}
}

class FakeTarget implements McpAppHostPostTarget {
  readonly posts: Array<{
    message: unknown;
    targetOrigin: string;
    transfer?: Transferable[];
  }> = [];

  postMessage(
    message: unknown,
    targetOrigin: string,
    transfer?: Transferable[],
  ): void {
    this.posts.push(
      transfer ? { message, targetOrigin, transfer } : { message, targetOrigin },
    );
  }
}

function portOffer(
  source: McpAppHostPostTarget,
  port: MessagePort,
) {
  return {
    source,
    origin: "null",
    data: {
      schemaVersion: MCP_APP_HOST_RESOURCE_READ_SCHEMA,
      type: MCP_APP_HOST_RESOURCE_PORT_OFFER,
    },
    ports: [port],
  } as const;
}

function sessionFixture(): ThreadViewerSession {
  return {
    id: `mcp-app:${"d".repeat(64)}`,
    kind: "mcp-app",
    anchor: { kind: "artifact", id: "recorded-result" },
    app: { id: "io.casys.mcp-build123d.results", version: "1.2.3" },
    manifest: {
      uri: "ui://mcp-build123d/app-manifest",
      fingerprint: `sha256:${"a".repeat(64)}`,
    },
    resource: {
      uri: "ui://mcp-build123d/results-viewer",
      fingerprint: `sha256:${"b".repeat(64)}`,
      ownership: "whole-view",
      mimeType: "text/html;profile=mcp-app",
      bytes: 321,
    },
    launchUri: "/viewer-apps/build123d/exact-session",
    readResources: [{
      uri: `/api/thread/viewer-apps/resources/${RESOURCE_FINGERPRINT.slice(7)}`,
      mimeType: "application/octet-stream",
      bytes: RESOURCE_BYTES.byteLength,
      fingerprint: RESOURCE_FINGERPRINT,
    }],
    session: {
      action: "viewer.session.apply",
      schema: "io.casys.mcp-build123d.recorded-geometry-session/1.0",
      payload: {
        schemaVersion: "io.casys.mcp-build123d.recorded-geometry-session/1.0",
        projection: {
          status: "available",
          resourceFingerprint: RESOURCE_FINGERPRINT,
        },
      },
      fingerprint: `sha256:${"c".repeat(64)}`,
    },
  };
}

async function sha256Fingerprint(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return `sha256:${
    [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
  }`;
}
