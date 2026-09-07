import type { ThreadViewerSession } from "./viewer-sessions-client.ts";
import {
  createMcpAppReadOnlyHost,
  type McpAppHostPostTarget,
  type McpAppHostPresentationContext,
  type McpAppReadOnlyHost,
  type McpAppReadOnlyHostOptions,
} from "./mcp-app-read-only-host.ts";
import type { McpAppHostResourceFetch } from "./mcp-app-resource-bridge.ts";
import {
  type LoadedMcpAppDocument,
  loadVerifiedMcpAppDocument,
  type McpAppDocumentFetch,
  type McpAppDocumentLoaderOptions,
  readMcpAppHostScriptNonce,
} from "./mcp-app-document-loader.ts";
import {
  advanceMcpAppFrameStatus,
  type McpAppFrameStatus,
  mcpAppFrameUnavailableFromLoaderError,
} from "./mcp-app-frame-status.ts";

export type McpAppFrameDocumentPhase =
  | "waiting-controller"
  | "starting"
  | "loading-app"
  | "app-loaded"
  | "invalid";

export type McpAppFrameLoadAction = "ignore" | "accept" | "invalidate";

/**
 * Advance one iframe load. Blank and in-flight-fetch loads are ignored until
 * the verified Blob URL is assigned, so a late or absent about:blank cannot
 * be counted as the registered App or skip its fetch.
 */
export function advanceMcpAppFrameLoad(
  phase: McpAppFrameDocumentPhase,
): readonly [McpAppFrameDocumentPhase, McpAppFrameLoadAction] {
  if (phase === "loading-app") return ["app-loaded", "accept"];
  if (phase === "app-loaded") return ["invalid", "invalidate"];
  return [phase, "ignore"];
}

export function beginMcpAppFrameLaunch(
  phase: McpAppFrameDocumentPhase,
): readonly [McpAppFrameDocumentPhase, "launch" | "ignore"] {
  if (phase === "waiting-controller") return ["starting", "launch"];
  return [phase, "ignore"];
}

export function assignMcpAppFrameDocument(
  phase: McpAppFrameDocumentPhase,
): readonly [McpAppFrameDocumentPhase, "arm" | "ignore"] {
  if (phase === "starting") return ["loading-app", "arm"];
  return [phase, "ignore"];
}

export interface McpAppFrameNode {
  src: string;
  loading: string;
  className: string;
  title: string;
  referrerPolicy: string;
  contentWindow: McpAppHostPostTarget | null;
  setAttribute(name: string, value: string): void;
  addEventListener(
    type: "load" | "error",
    listener: () => void,
  ): void;
  removeEventListener(
    type: "load" | "error",
    listener: () => void,
  ): void;
  remove(): void;
}

export interface McpAppFrameHandle {
  retry(): void;
  dispose(): void;
  updateHostContext(context: McpAppHostPresentationContext): void;
}

export interface McpAppFrameDocumentLoader {
  (
    session: ThreadViewerSession,
    hostScriptNonce: string,
    options?: McpAppDocumentLoaderOptions,
  ): Promise<LoadedMcpAppDocument>;
}

export interface McpAppFrameGenerationOptions {
  readonly frame: McpAppFrameNode;
  readonly session: ThreadViewerSession;
  readonly hostContext: McpAppHostPresentationContext;
  readonly onStatus: (status: McpAppFrameStatus) => void;
  readonly loadDocument?: McpAppFrameDocumentLoader;
  readonly applyLoadedDocument?: (
    frame: McpAppFrameNode,
    document: LoadedMcpAppDocument,
  ) => void;
  readonly readNonce?: () => string;
  readonly documentFetcher?: McpAppDocumentFetch;
  readonly resourceFetcher?: McpAppHostResourceFetch;
  readonly createHost?: (
    options: McpAppReadOnlyHostOptions,
  ) => McpAppReadOnlyHost;
  readonly subscribeMessages?: (
    listener: (event: MessageEvent<unknown>) => void,
  ) => () => void;
}

export interface McpAppFrameControllerOptions
  extends Omit<McpAppFrameGenerationOptions, "frame" | "hostContext"> {
  readonly createFrame: () => McpAppFrameNode;
  readonly disposeFrame: (frame: McpAppFrameNode) => void;
  readonly hostContext: () => McpAppHostPresentationContext;
}

/**
 * One document generation: fetch the exact registered App without waiting for
 * about:blank, ignore loads until the Blob URL is assigned, then quarantine a
 * later child navigation.
 */
export function bindMcpAppFrameGeneration(
  options: McpAppFrameGenerationOptions,
): McpAppFrameHandle {
  let phase: McpAppFrameDocumentPhase = "waiting-controller";
  let active = true;
  let loadedDocument: LoadedMcpAppDocument | undefined;
  let host: McpAppReadOnlyHost | undefined;
  const abort = new AbortController();

  const revokeLoadedDocument = (): void => {
    loadedDocument?.revoke();
    loadedDocument = undefined;
  };

  const emit = (status: McpAppFrameStatus): void => {
    if (!active && status.kind === "loading") return;
    options.onStatus(status);
  };

  const invalidate = (status?: McpAppFrameStatus): void => {
    if (!active) return;
    active = false;
    abort.abort();
    revokeLoadedDocument();
    host?.invalidate();
    host = undefined;
    phase = "invalid";
    if (status) options.onStatus(status);
  };

  const advanceLoad = (): void => {
    if (!active) return;
    const [nextPhase, action] = advanceMcpAppFrameLoad(phase);
    phase = nextPhase;
    if (action === "accept") {
      emit({ kind: "loading", stage: "awaiting-session" });
      return;
    }
    if (action !== "invalidate") return;
    // A WindowProxy and opaque origin survive a child navigation. Do not let
    // a replacement document inherit the registered session or byte port.
    invalidate({ kind: "error", reason: "document-replaced" });
  };

  const onFrameError = (): void => {
    invalidate({ kind: "error", reason: "frame-error" });
  };

  options.frame.addEventListener("load", advanceLoad);
  options.frame.addEventListener("error", onFrameError);

  const target = options.frame.contentWindow;
  if (!target) {
    options.frame.removeEventListener("load", advanceLoad);
    options.frame.removeEventListener("error", onFrameError);
    options.onStatus({
      kind: "unavailable",
      reason: "document-unavailable",
    });
    active = false;
    return {
      retry() {},
      dispose() {},
      updateHostContext() {},
    };
  }

  const createHost = options.createHost ?? createMcpAppReadOnlyHost;
  host = createHost({
    target,
    session: options.session,
    hostContext: {
      ...options.hostContext,
      displayMode: "inline",
      availableDisplayModes: ["inline"],
    },
    fetcher: options.resourceFetcher,
    onPresentationReadiness(event) {
      if (!active) return;
      if (event.kind === "session-delivered") {
        emit({ kind: "session-accepted" });
        return;
      }
      emit({
        kind: "resource-delivered",
        status: event.status,
        ...(event.status === "unavailable" ? { reason: event.reason } : {}),
      });
    },
  });

  const onMessage = (event: MessageEvent<unknown>): void => {
    host?.handleMessage(event);
  };
  const unsubscribeMessages = options.subscribeMessages
    ? options.subscribeMessages(onMessage)
    : subscribeWindowMessages(onMessage);

  const launchVerifiedDocument = (): void => {
    emit({ kind: "loading", stage: "fetching-document" });
    let hostScriptNonce: string;
    try {
      hostScriptNonce = (options.readNonce ?? readMcpAppHostScriptNonce)();
    } catch {
      invalidate({
        kind: "unavailable",
        reason: "host-nonce-unavailable",
      });
      return;
    }
    const loadDocument = options.loadDocument ?? loadVerifiedMcpAppDocument;
    void loadDocument(options.session, hostScriptNonce, {
      signal: abort.signal,
      fetcher: options.documentFetcher,
    }).then((document) => {
      if (!active || phase !== "starting") {
        document.revoke();
        return;
      }
      loadedDocument = document;
      const [nextPhase, action] = assignMcpAppFrameDocument(phase);
      if (action !== "arm") {
        document.revoke();
        loadedDocument = undefined;
        return;
      }
      phase = nextPhase;
      emit({ kind: "loading", stage: "loading-document" });
      if (options.applyLoadedDocument) {
        options.applyLoadedDocument(options.frame, document);
      } else {
        options.frame.src = document.url;
      }
    }).catch((error) => {
      if (!active || abort.signal.aborted) return;
      invalidate(mcpAppFrameUnavailableFromLoaderError(error));
    });
  };

  const [nextPhase, action] = beginMcpAppFrameLaunch(phase);
  phase = nextPhase;
  if (action === "launch") launchVerifiedDocument();

  let closed = false;
  const dispose = (): void => {
    if (closed) return;
    closed = true;
    options.frame.removeEventListener("load", advanceLoad);
    options.frame.removeEventListener("error", onFrameError);
    unsubscribeMessages();
    invalidate();
  };

  return {
    retry() {},
    dispose,
    updateHostContext(context) {
      if (!active) return;
      host?.updateHostContext(context);
    },
  };
}

/** Retryable controller: each retry is one new exact document generation. */
export function startMcpAppFrame(
  options: McpAppFrameControllerOptions,
): McpAppFrameHandle {
  let disposed = false;
  let status: McpAppFrameStatus = { kind: "loading", stage: "starting" };
  let current:
    | { frame: McpAppFrameNode; generation: McpAppFrameHandle }
    | undefined;

  const emit = (incoming: McpAppFrameStatus): void => {
    status = advanceMcpAppFrameStatus(status, incoming);
    options.onStatus(status);
  };

  const stopGeneration = (): void => {
    const live = current;
    current = undefined;
    live?.generation.dispose();
    if (live) options.disposeFrame(live.frame);
  };

  const startGeneration = (): void => {
    const frame = options.createFrame();
    const generation = bindMcpAppFrameGeneration({
      frame,
      session: options.session,
      hostContext: options.hostContext(),
      onStatus: emit,
      loadDocument: options.loadDocument,
      applyLoadedDocument: options.applyLoadedDocument,
      readNonce: options.readNonce,
      documentFetcher: options.documentFetcher,
      resourceFetcher: options.resourceFetcher,
      createHost: options.createHost,
      subscribeMessages: options.subscribeMessages,
    });
    current = { frame, generation };
  };

  const handle: McpAppFrameHandle = {
    retry() {
      if (disposed) return;
      stopGeneration();
      emit({ kind: "loading", stage: "starting" });
      startGeneration();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopGeneration();
    },
    updateHostContext(context) {
      current?.generation.updateHostContext(context);
    },
  };

  startGeneration();
  return handle;
}

function subscribeWindowMessages(
  listener: (event: MessageEvent<unknown>) => void,
): () => void {
  const runtime = globalThis as unknown as {
    addEventListener(
      type: string,
      next: (event: MessageEvent<unknown>) => void,
    ): void;
    removeEventListener(
      type: string,
      next: (event: MessageEvent<unknown>) => void,
    ): void;
  };
  runtime.addEventListener("message", listener);
  return () => runtime.removeEventListener("message", listener);
}
