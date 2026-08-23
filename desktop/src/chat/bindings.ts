import {
  type ChatCommandResponse,
  type ChatSnapshotDto,
  DESKTOP_CHAT_PROTOCOL,
  parseChatCommandRequest,
  parseChatSnapshotRequest,
  parseDesktopChatBindingCommandRequest,
} from "./contracts.ts";
import type { ExternalUrlOpener } from "./external-url.ts";

export const CHAT_SNAPSHOT_BINDING = "casysChatSnapshot" as const;
export const CHAT_COMMAND_BINDING = "casysChatCommand" as const;

export interface DesktopChatBindingHost {
  snapshot(
    input: ReturnType<typeof parseChatSnapshotRequest>,
  ): Promise<ChatSnapshotDto>;
  command(
    input: ReturnType<typeof parseChatCommandRequest>,
  ): Promise<ChatCommandResponse>;
}

export interface BrowserWindowBindingPort {
  bind(name: string, handler: (input: unknown) => unknown): void;
}

export interface DesktopChatProjectFocusAuthority {
  /** Current durable Workbench project, or undefined on any unavailable state. */
  currentProjectId(): Promise<string | undefined>;
}

export function registerDesktopChatBindings(
  window: BrowserWindowBindingPort,
  host?: DesktopChatBindingHost,
  externalUrl?: ExternalUrlOpener,
  projectFocus?: DesktopChatProjectFocusAuthority,
): void {
  window.bind(CHAT_SNAPSHOT_BINDING, async (value: unknown) => {
    const input = parseChatSnapshotRequest(value);
    if (host === undefined) {
      return Object.freeze({
        protocol: DESKTOP_CHAT_PROTOCOL,
        host: "unavailable",
        conversations: Object.freeze([]),
        error: "The packaged Chat Host is unavailable.",
      }) satisfies ChatSnapshotDto;
    }
    return await host.snapshot(input);
  });
  window.bind(CHAT_COMMAND_BINDING, async (value: unknown) => {
    const input = parseDesktopChatBindingCommandRequest(value);
    if (input.command === "external.open") {
      if (externalUrl === undefined) {
        return Object.freeze({
          protocol: DESKTOP_CHAT_PROTOCOL,
          requestId: input.requestId,
          ok: false,
          error: "The external browser capability is unavailable for this target.",
        }) satisfies ChatCommandResponse;
      }
      await externalUrl.open(input.url);
      return Object.freeze({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: input.requestId,
        ok: true,
      }) satisfies ChatCommandResponse;
    }
    if (host === undefined) {
      return Object.freeze({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: input.requestId,
        ok: false,
        error: "The packaged Chat Host is unavailable.",
      }) satisfies ChatCommandResponse;
    }
    const authorizationError = await authorizeProjectCommand(
      input,
      host,
      projectFocus,
    );
    if (authorizationError !== undefined) {
      return Object.freeze({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: input.requestId,
        ok: false,
        error: authorizationError,
      }) satisfies ChatCommandResponse;
    }
    return await host.command(input);
  });
}

async function authorizeProjectCommand(
  input: ReturnType<typeof parseChatCommandRequest>,
  host: DesktopChatBindingHost,
  projectFocus?: DesktopChatProjectFocusAuthority,
): Promise<string | undefined> {
  if (projectFocus === undefined) return unavailableFocus();
  let focusedProjectId: string | undefined;
  try {
    focusedProjectId = await projectFocus.currentProjectId();
  } catch {
    return unavailableFocus();
  }
  if (focusedProjectId === undefined) return unavailableFocus();

  let commandProjectId: string;
  if (input.command === "conversation.create") {
    commandProjectId = input.projectId;
  } else {
    let snapshot: ChatSnapshotDto;
    try {
      snapshot = await host.snapshot({
        protocol: DESKTOP_CHAT_PROTOCOL,
        conversationId: input.conversationId,
      });
    } catch {
      return unavailableFocus();
    }
    const conversation = snapshot.conversations.find((candidate) =>
      candidate.id === input.conversationId
    );
    if (conversation === undefined) return focusMismatch();
    commandProjectId = conversation.projectId;
  }

  if (commandProjectId !== focusedProjectId) return focusMismatch();
  try {
    if (await projectFocus.currentProjectId() !== commandProjectId) {
      return focusMismatch();
    }
  } catch {
    return unavailableFocus();
  }
  return undefined;
}

function unavailableFocus(): string {
  return "Chat commands require an available Workbench project focus.";
}

function focusMismatch(): string {
  return "Chat command project does not match the current Workbench project focus.";
}
