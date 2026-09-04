import type { CSSProperties, JSX } from "react";
import { useLayoutEffect, useRef } from "react";
import type { ThreadViewerSession } from "./viewer-sessions-client.ts";
import { createMcpAppReadOnlyHost } from "./mcp-app-read-only-host.ts";
import {
  advanceMcpAppFrameLoad,
  type McpAppFrameDocumentPhase,
} from "./mcp-app-frame-lifecycle.ts";
import {
  type LoadedMcpAppDocument,
  loadVerifiedMcpAppDocument,
  readMcpAppHostScriptNonce,
} from "./mcp-app-document-loader.ts";
import { resolveMcpAppTheme } from "./mcp-app-frame-theme.ts";

export interface McpAppFrameProps {
  readonly session: ThreadViewerSession;
  readonly className?: string;
}

/**
 * Neutral opaque-origin window for one exact whole MCP App.
 *
 * It implements only the Apps window lifecycle needed to initialize the App
 * without MCP authority and deliver one exact registered read session. It
 * never calls a tool, lists/reads an MCP resource or contacts a provider.
 */
export function McpAppFrame({
  session,
  className,
}: McpAppFrameProps): JSX.Element {
  const mount = useRef<HTMLSpanElement>(null);

  // Create the iframe imperatively so its native load handler is attached
  // before insertion. Chrome may dispatch the initial about:blank load while
  // append() is still running; remembering that observation avoids both a
  // deadlock and counting the registered App as a replacement document.
  useLayoutEffect(() => {
    const mountNode = mount.current;
    if (!mountNode) return;

    const frameNode = document.createElement("iframe");
    frameNode.className = className ?? "";
    frameNode.title = `${session.app.id} ${session.app.version}`;
    frameNode.setAttribute("sandbox", "allow-scripts");
    frameNode.referrerPolicy = "no-referrer";
    frameNode.loading = "lazy";

    let phase: McpAppFrameDocumentPhase = "waiting-controller";
    let blankLoadObserved = false;
    let controller: ReturnType<typeof createMcpAppReadOnlyHost> | undefined;
    let loadedDocument: LoadedMcpAppDocument | undefined;
    let active = true;
    const abort = new AbortController();

    const revokeLoadedDocument = (): void => {
      loadedDocument?.revoke();
      loadedDocument = undefined;
    };

    const invalidate = (): void => {
      if (!active) return;
      active = false;
      abort.abort();
      revokeLoadedDocument();
      controller?.invalidate();
      controller = undefined;
      phase = "invalid";
    };

    const launchVerifiedDocument = (): void => {
      let hostScriptNonce: string;
      try {
        hostScriptNonce = readMcpAppHostScriptNonce();
      } catch {
        invalidate();
        return;
      }
      void loadVerifiedMcpAppDocument(session, hostScriptNonce, {
        signal: abort.signal,
      }).then((document) => {
        if (!active || phase !== "loading-app") {
          document.revoke();
          return;
        }
        loadedDocument = document;
        frameNode.src = document.url;
      }).catch(() => invalidate());
    };

    const advanceLoad = (): void => {
      if (phase === "waiting-controller") {
        blankLoadObserved = true;
        return;
      }
      const [nextPhase, action] = advanceMcpAppFrameLoad(phase);
      phase = nextPhase;
      if (action === "launch") {
        launchVerifiedDocument();
        return;
      }
      if (action !== "invalidate") return;
      // A WindowProxy and opaque origin survive a child navigation. Do not let
      // a replacement document inherit the registered session or byte port.
      invalidate();
    };
    frameNode.addEventListener("load", advanceLoad);
    frameNode.addEventListener("error", invalidate);
    mountNode.append(frameNode);

    const target = frameNode.contentWindow;
    if (!target) {
      frameNode.removeEventListener("load", advanceLoad);
      frameNode.removeEventListener("error", invalidate);
      frameNode.remove();
      return;
    }
    controller = createMcpAppReadOnlyHost({
      target,
      session,
      hostContext: {
        theme: resolvedTheme(),
        displayMode: "inline",
        availableDisplayModes: ["inline"],
      },
    });
    const onMessage = (event: MessageEvent<unknown>): void => {
      controller?.handleMessage(event);
    };
    globalThis.addEventListener("message", onMessage);
    phase = "waiting-blank-load";
    if (blankLoadObserved) advanceLoad();

    return () => {
      globalThis.removeEventListener("message", onMessage);
      frameNode.removeEventListener("load", advanceLoad);
      frameNode.removeEventListener("error", invalidate);
      invalidate();
      frameNode.remove();
    };
  }, [
    className,
    session.id,
    session.launchUri,
    session.resource.bytes,
    session.resource.fingerprint,
    session.resource.mimeType,
  ]);

  return (
    <span
      ref={mount}
      data-mcp-app-frame-mount={session.id}
      style={{ display: "contents" } as CSSProperties}
    />
  );
}

function resolvedTheme(): "light" | "dark" {
  const root = document.documentElement;
  return resolveMcpAppTheme({
    dataTheme: root.dataset.theme,
    darkClass: root.classList.contains("dark"),
    lightClass: root.classList.contains("light"),
    colorScheme: globalThis.getComputedStyle?.(root).colorScheme,
    prefersDark: globalThis.matchMedia?.("(prefers-color-scheme: dark)")
      .matches ?? false,
  });
}
