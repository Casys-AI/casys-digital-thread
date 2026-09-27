import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { Button } from "../ui/button.tsx";
import type {
  ChatToolViewerDto,
  ChatViewerAppBytesDto,
  ChatViewerJson,
  ChatViewerResourceDto,
  ChatViewerSessionDto,
} from "../../../presentation/desktop/chat/contracts.ts";
import { ChatMcpAppViewer } from "./chat-mcp-app-viewer.tsx";
import {
  liveHostReadResources,
  type McpAppLiveHostSession,
} from "./mcp-app-live-host.ts";

/** Quiet owning-session dispatch; failures throw instead of touching chat UI state. */
export interface ChatViewerDispatch {
  readonly openViewer: (
    conversationId: string,
    toolCallId: string,
  ) => Promise<ChatViewerSessionDto>;
  readonly callViewerTool: (
    conversationId: string,
    toolCallId: string,
    name: string,
    args: unknown,
  ) => Promise<ChatViewerJson>;
  readonly readViewerResource: (
    conversationId: string,
    toolCallId: string,
    uri: string,
  ) => Promise<ChatViewerResourceDto>;
  readonly fetchApp: (
    server: string,
    uri: string,
    fingerprint: string,
  ) => Promise<ChatViewerAppBytesDto>;
}

export interface ChatViewerPanelProps {
  readonly conversationId: string;
  readonly viewers: readonly ChatToolViewerDto[];
  readonly messageId: string;
  readonly dispatch: ChatViewerDispatch;
}

type ViewerState =
  | { readonly phase: "idle" }
  | { readonly phase: "opening" }
  | {
    readonly phase: "live";
    readonly app: ChatViewerAppBytesDto;
    readonly session: McpAppLiveHostSession;
    readonly generation: number;
  }
  | { readonly phase: "error"; readonly error: string };

/**
 * Per-message live viewer affordance for one standalone conversation.
 *
 * Each captured tool result opens its expected App with the exact result;
 * the opened generation is bound to this conversation and tool call, so
 * switching conversations (which remounts the parent) can never show
 * another session's data.
 */
export function ChatViewerPanel({
  conversationId,
  viewers,
  messageId,
  dispatch,
}: ChatViewerPanelProps): JSX.Element | null {
  const entries = viewers.filter((viewer) => viewer.messageId === messageId);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [state, setState] = useState<ViewerState>({ phase: "idle" });
  // Monotonic open token: only the latest open() may publish its session.
  // Buttons disable while opening, but only after re-render; two rapid
  // invocations can interleave and a stale finish must never mount session
  // A with delegates pinned to tool call B.
  const openToken = useRef(0);
  const live = selected !== undefined
    ? entries.find((entry) => entry.toolCallId === selected)
    : undefined;

  const open = useCallback(async (toolCallId: string) => {
    openToken.current += 1;
    const token = openToken.current;
    setSelected(toolCallId);
    setState({ phase: "opening" });
    try {
      const opened = await dispatch.openViewer(conversationId, toolCallId);
      // Never mount session data under a different tool-call identity than
      // the delegates and frame key bind: fail the open instead of mixing.
      if (opened.toolCallId !== toolCallId) {
        throw new Error("Viewer session identity changed during open.");
      }
      const app = await dispatch.fetchApp(
        opened.server,
        opened.app.uri,
        opened.app.fingerprint,
      );
      if (openToken.current !== token) return;
      setState({
        phase: "live",
        app,
        session: {
          conversationId,
          toolCallId: opened.toolCallId,
          server: opened.server,
          tool: opened.tool,
          toolInput: opened.toolInput,
          toolResult: opened.toolResult,
          serverTools: opened.serverTools,
          readResources: liveHostReadResources(opened.toolResult),
        },
        generation: 0,
      });
    } catch (cause) {
      if (openToken.current !== token) return;
      setState({
        phase: "error",
        error: cause instanceof Error ? cause.message : "Viewer failed to open.",
      });
    }
  }, [conversationId, dispatch]);

  useEffect(() => {
    // Invalidate any open() still in flight from the previous conversation.
    openToken.current += 1;
    setSelected(undefined);
    setState({ phase: "idle" });
  }, [conversationId]);

  if (entries.length === 0) return null;
  return (
    <div className="desktop-chat-viewers">
      {entries.map((entry) => (
        <Button
          key={entry.toolCallId}
          type="button"
          variant="outline"
          size="sm"
          disabled={state.phase === "opening"}
          onClick={() => void open(entry.toolCallId)}
        >
          {state.phase !== "idle" && selected === entry.toolCallId
            ? "Reload result viewer"
            : `View ${entry.tool} result`}
        </Button>
      ))}
      {state.phase === "opening" && (
        <p className="desktop-chat-viewer-status" role="status">
          Opening the provider viewer with the exact result…
        </p>
      )}
      {state.phase === "error" && (
        <p className="desktop-chat-error" role="alert">
          {state.error} {live && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void open(live.toolCallId)}
            >
              Retry
            </Button>
          )}
        </p>
      )}
      {state.phase === "live" && live && (
        <ChatMcpAppViewer
          key={`${conversationId}:${live.toolCallId}:${state.generation}`}
          app={state.app}
          session={state.session}
          callTool={(name, args) =>
            dispatch.callViewerTool(
              conversationId,
              live.toolCallId,
              name,
              args,
            )}
          readResource={(uri) =>
            dispatch.readViewerResource(conversationId, live.toolCallId, uri)}
          title={`${live.tool} result viewer`}
          onClose={() => {
            setSelected(undefined);
            setState({ phase: "idle" });
          }}
          onRetry={() =>
            setState((current) =>
              current.phase === "live"
                ? { ...current, generation: current.generation + 1 }
                : current
            )}
        />
      )}
    </div>
  );
}
