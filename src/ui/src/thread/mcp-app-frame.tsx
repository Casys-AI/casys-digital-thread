import type { CSSProperties, JSX } from "react";
import { useLayoutEffect, useRef } from "react";
import type { ThreadViewerSession } from "./viewer-sessions-client.ts";
import type { McpAppHostPresentationContext } from "./mcp-app-read-only-host.ts";
import { startMcpAppFrame } from "./mcp-app-frame-lifecycle.ts";
import { loadVerifiedMcpAppDocument } from "./mcp-app-document-loader.ts";
import { resolveMcpAppTheme } from "./mcp-app-frame-theme.ts";
import {
  type McpAppFrameStatus,
  mcpAppFrameStatusAllowsRetry,
  mcpAppFrameStatusCoversFrame,
  mcpAppFrameStatusLabel,
} from "./mcp-app-frame-status.ts";

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
  const mount = useRef<HTMLDivElement>(null);

  // Create the iframe imperatively so its native load handler is attached
  // before insertion. Fetch starts once the source-locked controller exists;
  // about:blank is not a launch gate. Theme, language and SSE object identity
  // updates reuse this document generation.
  useLayoutEffect(() => {
    const mountNode = mount.current;
    if (!mountNode) return;

    const overlay = createStatusOverlay();
    mountNode.append(overlay);
    let status: McpAppFrameStatus = { kind: "loading", stage: "starting" };
    const render = (next: McpAppFrameStatus): void => {
      status = next;
      writeMountStatus(mountNode, status);
      renderStatusOverlay(overlay, status, () => handle.retry());
    };
    render(status);

    const handle = startMcpAppFrame({
      session,
      hostContext: resolvedPresentationContext,
      onStatus: render,
      loadDocument: loadVerifiedMcpAppDocument,
      createFrame() {
        const frameNode = document.createElement("iframe");
        frameNode.className = className ?? "";
        frameNode.title = `${session.app.id} ${session.app.version}`;
        frameNode.setAttribute("sandbox", "allow-scripts");
        frameNode.referrerPolicy = "no-referrer";
        frameNode.loading = "eager";
        mountNode.insertBefore(frameNode, overlay);
        return frameNode;
      },
      disposeFrame(frameNode) {
        frameNode.remove();
      },
      applyLoadedDocument(frameNode, document) {
        frameNode.src = document.url;
      },
    });

    const updatePresentation = (): void => {
      handle.updateHostContext(resolvedPresentationContext());
    };
    const presentationObserver = new MutationObserver(updatePresentation);
    presentationObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class", "style", "lang"],
    });
    const themePreference = globalThis.matchMedia?.(
      "(prefers-color-scheme: dark)",
    );
    themePreference?.addEventListener("change", updatePresentation);
    globalThis.addEventListener("languagechange", updatePresentation);

    return () => {
      presentationObserver.disconnect();
      themePreference?.removeEventListener("change", updatePresentation);
      globalThis.removeEventListener("languagechange", updatePresentation);
      handle.dispose();
      overlay.remove();
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
    <div
      ref={mount}
      data-mcp-app-frame-mount={session.id}
      style={{
        position: "relative",
        display: "grid",
        width: "100%",
        height: "100%",
        minHeight: 0,
      } as CSSProperties}
    />
  );
}

function resolvedPresentationContext(): McpAppHostPresentationContext {
  const locale = document.documentElement.lang.trim() ||
    globalThis.navigator?.language;
  return {
    theme: resolvedTheme(),
    ...(locale ? { locale } : {}),
  };
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

function createStatusOverlay(): HTMLDivElement {
  const overlay = document.createElement("div");
  overlay.setAttribute("role", "status");
  overlay.style.position = "absolute";
  overlay.style.inset = "0";
  overlay.style.display = "grid";
  overlay.style.alignContent = "center";
  overlay.style.justifyItems = "center";
  overlay.style.gap = "0.5rem";
  overlay.style.padding = "0.75rem";
  overlay.style.zIndex = "1";
  overlay.style.fontSize = "0.75rem";
  overlay.style.lineHeight = "1.35";
  overlay.style.textAlign = "center";
  overlay.style.pointerEvents = "auto";
  return overlay;
}

function renderStatusOverlay(
  overlay: HTMLDivElement,
  status: McpAppFrameStatus,
  onRetry: () => void,
): void {
  overlay.dataset.mcpAppFrameOverlay = status.kind;
  if ("reason" in status && status.reason) {
    overlay.dataset.mcpAppFrameReason = status.reason;
  } else {
    delete overlay.dataset.mcpAppFrameReason;
  }
  if (!mcpAppFrameStatusCoversFrame(status)) {
    overlay.style.display = "none";
    overlay.replaceChildren();
    overlay.style.pointerEvents = "none";
    return;
  }
  overlay.style.display = "grid";
  overlay.style.pointerEvents = "auto";
  const message = document.createElement("p");
  message.style.margin = "0";
  message.textContent = mcpAppFrameStatusLabel(status);
  if (!mcpAppFrameStatusAllowsRetry(status)) {
    overlay.replaceChildren(message);
    return;
  }
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "Retry registered App";
  retry.dataset.mcpAppFrameRetry = "";
  retry.addEventListener("click", onRetry);
  overlay.replaceChildren(message, retry);
}

function writeMountStatus(
  mount: HTMLElement,
  status: McpAppFrameStatus,
): void {
  mount.setAttribute("data-mcp-app-frame-status", status.kind);
  if (status.kind === "loading") {
    mount.setAttribute("data-mcp-app-frame-stage", status.stage);
    mount.setAttribute("aria-busy", "true");
  } else {
    mount.removeAttribute("data-mcp-app-frame-stage");
    mount.removeAttribute("aria-busy");
  }
  if ("reason" in status && status.reason) {
    mount.setAttribute("data-mcp-app-frame-reason", status.reason);
  } else {
    mount.removeAttribute("data-mcp-app-frame-reason");
  }
}
