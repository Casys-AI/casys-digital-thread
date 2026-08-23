export const CHAT_HOST_IPC_PROTOCOL = "casys-chat-host-ipc/1.0" as const;

export interface ChatHostReady {
  readonly protocol: typeof CHAT_HOST_IPC_PROTOCOL;
  readonly type: "ready";
  readonly pid: number;
  readonly chatHostVersion: string;
  readonly acpxCommit: string;
  readonly adapterVersion: string;
  readonly nodeVersion: string;
  readonly target: string;
}

export interface ChatHostIpcResponse {
  readonly protocol: typeof CHAT_HOST_IPC_PROTOCOL;
  readonly requestId: string;
  readonly ok: boolean;
  readonly payload?: unknown;
  readonly error?: string;
}
