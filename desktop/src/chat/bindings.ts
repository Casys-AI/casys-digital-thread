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

export function registerDesktopChatBindings(
  window: BrowserWindowBindingPort,
  host?: DesktopChatBindingHost,
  externalUrl?: ExternalUrlOpener,
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
    return await host.command(input);
  });
}
