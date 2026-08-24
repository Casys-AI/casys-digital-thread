import {
  type ChatCommandResponse,
  type ChatSnapshotDto,
  DESKTOP_CHAT_PROTOCOL,
  parseChatCommandRequest,
  parseChatSnapshotRequest,
  parseDesktopChatBindingCommandRequest,
} from "../../../src/presentation/desktop/chat/contracts.ts";
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
  const conversationProjects = new Map<string, string>();
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
    return await focusedSnapshot(
      input,
      host,
      projectFocus,
      conversationProjects,
    );
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
    const response = await host.command(input);
    if (
      input.command === "conversation.create" && response.ok &&
      response.conversationId !== undefined
    ) {
      conversationProjects.set(response.conversationId, input.projectId);
    }
    return response;
  });
}

async function focusedSnapshot(
  input: ReturnType<typeof parseChatSnapshotRequest>,
  host: DesktopChatBindingHost,
  projectFocus: DesktopChatProjectFocusAuthority | undefined,
  conversationProjects: Map<string, string>,
): Promise<ChatSnapshotDto> {
  const focusedProjectId = await readCurrentProjectFocus(projectFocus);
  if (focusedProjectId === undefined) {
    return emptyFocusedSnapshot(
      "ready",
      "Chat transcripts require an available Workbench project focus.",
    );
  }
  if (
    input.conversationId !== undefined &&
    conversationProjects.get(input.conversationId) !== focusedProjectId
  ) {
    return emptyFocusedSnapshot(
      "ready",
      "The requested conversation is unavailable for the current Workbench project focus.",
    );
  }

  let snapshot: ChatSnapshotDto;
  try {
    snapshot = await host.snapshot(input);
  } catch {
    return emptyFocusedSnapshot(
      "unavailable",
      "The packaged Chat Host snapshot is unavailable.",
    );
  }
  if (await readCurrentProjectFocus(projectFocus) !== focusedProjectId) {
    return emptyFocusedSnapshot(
      snapshot.host,
      "Workbench project focus changed while the Chat snapshot was loading.",
    );
  }

  if (input.conversationId === undefined) {
    conversationProjects.clear();
    for (const conversation of snapshot.conversations) {
      conversationProjects.set(conversation.id, conversation.projectId);
    }
  }
  const conversations = Object.freeze(
    snapshot.conversations.filter((conversation) =>
      conversation.projectId === focusedProjectId &&
      (input.conversationId === undefined || conversation.id === input.conversationId)
    ),
  );
  const selectedConversationId = snapshot.selectedConversationId !== undefined &&
      conversations.some((conversation) =>
        conversation.id === snapshot.selectedConversationId
      )
    ? snapshot.selectedConversationId
    : undefined;
  return Object.freeze({
    protocol: DESKTOP_CHAT_PROTOCOL,
    host: snapshot.host,
    conversations,
    ...(selectedConversationId === undefined ? {} : { selectedConversationId }),
    ...(snapshot.error === undefined ? {} : { error: snapshot.error }),
  });
}

async function readCurrentProjectFocus(
  projectFocus?: DesktopChatProjectFocusAuthority,
): Promise<string | undefined> {
  if (projectFocus === undefined) return undefined;
  try {
    return await projectFocus.currentProjectId();
  } catch {
    return undefined;
  }
}

function emptyFocusedSnapshot(
  host: ChatSnapshotDto["host"],
  error: string,
): ChatSnapshotDto {
  return Object.freeze({
    protocol: DESKTOP_CHAT_PROTOCOL,
    host,
    conversations: Object.freeze([]),
    error,
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
