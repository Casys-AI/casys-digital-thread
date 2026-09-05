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
import { advanceMcpAppFrameLoad } from "./src/thread/mcp-app-frame-lifecycle.ts";
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
  assertEquals(advanceMcpAppFrameLoad("waiting-blank-load"), [
    "loading-app",
    "launch",
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
  assertEquals(
    source.includes('setAttribute("sandbox", "allow-scripts")'),
    true,
  );
  assertEquals(source.includes("allow-same-origin"), false);
  assertEquals(source.includes("event.origin"), false);
  assertEquals(source.includes("useLayoutEffect"), true);
  assertEquals(source.includes('document.createElement("iframe")'), true);
  assertEquals(
    source.indexOf('addEventListener("load", advanceLoad)') <
      source.indexOf("mountNode.append(frameNode)"),
    true,
  );
  assertEquals(source.includes("blankLoadObserved"), true);
  assertEquals(source.includes('phase = "waiting-blank-load"'), true);
  assertEquals(source.includes("loadVerifiedMcpAppDocument"), true);
  assertEquals(source.includes("frameNode.src = document.url"), true);
  assertEquals(source.includes("frameNode.src = session.launchUri"), false);
  assertEquals(source.includes("src={session.launchUri}"), false);
  assertEquals(source.includes("document.revoke()"), true);
  assertEquals(source.includes("revokeLoadedDocument()"), true);
  assertEquals(source.includes("controller?.invalidate()"), true);
  assertEquals(source.includes("callTool("), false);
  assertEquals(source.includes("providerEndpoint"), false);
  assertEquals(source.includes("ui/resource-teardown"), false);
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
  let phase: Parameters<typeof advanceMcpAppFrameLoad>[0] = "waiting-blank-load";
  [phase] = advanceMcpAppFrameLoad(phase);
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
