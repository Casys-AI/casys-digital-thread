import pins from "../../chat-runtime/pins.json" with { type: "json" };
import {
  CHAT_HOST_COMPONENT_VERSION,
  type ChatCommandRequest,
  type ChatCommandResponse,
  type ChatSnapshotDto,
  type ChatSnapshotRequest,
  parseChatCommandResponse,
  parseChatSnapshotDto,
} from "../../../src/presentation/desktop/chat/contracts.ts";
import {
  CHAT_HOST_IPC_PROTOCOL,
  type ChatHostIpcResponse,
  type ChatHostReady,
} from "./protocol.ts";
import type { DesktopPlatform } from "../host/mod.ts";
import type { ChatHostImplementedTarget } from "./target.ts";

const READY_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 10_000;
const STOP_TIMEOUT_MS = 3_000;
const MAX_LINE_BYTES = 1_000_000;

export interface ChatHostBundlePaths {
  readonly executable: string;
  readonly target: ChatHostImplementedTarget;
}

export interface ChatHostStopResult {
  readonly status: "stopped" | "unresolved";
  readonly reason?: string;
}

export interface ChatHostClientTimeouts {
  readonly readyMs: number;
  readonly requestMs: number;
  readonly stopMs: number;
  readonly terminateMs: number;
  readonly killMs: number;
  readonly readerMs: number;
}

export interface ChatHostClientOptions {
  readonly paths: ChatHostBundlePaths;
  readonly dataRoot: string;
  readonly launchCwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly platform: DesktopPlatform;
  readonly timeouts?: Partial<ChatHostClientTimeouts>;
  readonly spawn?: (options: ChatHostSpawnOptions) => ChatHostChild;
}

export interface ChatHostSpawnOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

export interface ChatHostChild {
  readonly stdin: WritableStream<Uint8Array>;
  readonly stdout: ReadableStream<Uint8Array>;
  readonly status: Promise<Deno.CommandStatus>;
  kill(signal: Deno.Signal): void;
}

interface PendingResponse {
  readonly promise: Promise<unknown>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason?: unknown) => void;
}

export class ChatHostClient {
  readonly #child: ChatHostChild;
  readonly #writer: WritableStreamDefaultWriter<Uint8Array>;
  readonly #ready = Promise.withResolvers<ChatHostReady>();
  readonly #pending = new Map<string, PendingResponse>();
  readonly #encoder = new TextEncoder();
  #writeTail: Promise<void> = Promise.resolve();
  #didReady = false;
  #stopping?: Promise<ChatHostStopResult>;
  #readerDone: Promise<void>;
  readonly #timeouts: ChatHostClientTimeouts;
  readonly #bundleTarget: ChatHostImplementedTarget;

  private constructor(options: ChatHostClientOptions) {
    validateAbsolutePath(
      options.paths.executable,
      "Chat Host executable",
      options.platform,
    );
    validateAbsolutePath(options.dataRoot, "Chat Host data root", options.platform);
    validateAbsolutePath(options.launchCwd, "Chat Host launch cwd", options.platform);
    this.#timeouts = {
      readyMs: READY_TIMEOUT_MS,
      requestMs: REQUEST_TIMEOUT_MS,
      stopMs: STOP_TIMEOUT_MS,
      terminateMs: 1_000,
      killMs: 1_000,
      readerMs: 1_000,
      ...options.timeouts,
    };
    this.#bundleTarget = options.paths.target;
    const spawn = options.spawn ?? spawnDenoChild;
    this.#child = spawn({
      command: options.paths.executable,
      args: [`--data-root=${options.dataRoot}`],
      cwd: options.launchCwd,
      env: options.env,
    });
    this.#writer = this.#child.stdin.getWriter();
    this.#readerDone = this.#readLoop();
  }

  static async start(options: ChatHostClientOptions): Promise<ChatHostClient> {
    const client = new ChatHostClient(options);
    try {
      await withTimeout(
        client.#ready.promise,
        client.#timeouts.readyMs,
        "Chat Host readiness",
      );
      return client;
    } catch (error) {
      await client.stop().catch(() => undefined);
      throw error;
    }
  }

  async snapshot(request: ChatSnapshotRequest): Promise<ChatSnapshotDto> {
    return parseChatSnapshotDto(await this.#call("snapshot", request));
  }

  async command(request: ChatCommandRequest): Promise<ChatCommandResponse> {
    return parseChatCommandResponse(await this.#call("command", request));
  }

  stop(): Promise<ChatHostStopResult> {
    if (this.#stopping !== undefined) return this.#stopping;
    const attempt = this.#stop();
    this.#stopping = attempt;
    void attempt.then((result) => {
      if (result.status === "unresolved" && this.#stopping === attempt) {
        this.#stopping = undefined;
      }
    }, () => {
      if (this.#stopping === attempt) this.#stopping = undefined;
    });
    return attempt;
  }

  async #call(method: "snapshot" | "command", payload: unknown): Promise<unknown> {
    const requestId = `host:${crypto.randomUUID()}`;
    const deferred = Promise.withResolvers<unknown>();
    this.#pending.set(requestId, deferred);
    try {
      await this.#write({
        protocol: CHAT_HOST_IPC_PROTOCOL,
        requestId,
        method,
        payload,
      });
      return await withTimeout(
        deferred.promise,
        this.#timeouts.requestMs,
        "Chat Host request",
      );
    } finally {
      this.#pending.delete(requestId);
    }
  }

  async #stop(): Promise<ChatHostStopResult> {
    const requestId = `shutdown:${crypto.randomUUID()}`;
    const deferred = Promise.withResolvers<unknown>();
    this.#pending.set(requestId, deferred);
    try {
      await withTimeout(
        this.#write({
          protocol: CHAT_HOST_IPC_PROTOCOL,
          requestId,
          method: "shutdown",
        }),
        this.#timeouts.stopMs,
        "Chat Host shutdown write",
      ).catch(() => undefined);
      await withTimeout(
        deferred.promise,
        this.#timeouts.stopMs,
        "Chat Host shutdown",
      ).catch(() => undefined);
    } finally {
      this.#pending.delete(requestId);
      await withTimeout(
        this.#writer.close(),
        this.#timeouts.stopMs,
        "Chat Host stdin close",
      ).catch(() => undefined);
    }
    const graceful = await statusWithin(this.#child.status, this.#timeouts.stopMs);
    if (!graceful) {
      killIgnoringNotFound(this.#child, "SIGTERM");
      if (!await statusWithin(this.#child.status, this.#timeouts.terminateMs)) {
        killIgnoringNotFound(this.#child, "SIGKILL");
        if (!await statusWithin(this.#child.status, this.#timeouts.killMs)) {
          this.#rejectPending(
            new Error("Chat Host process exit is unresolved after SIGKILL"),
          );
          return {
            status: "unresolved",
            reason: "process status did not settle after SIGKILL",
          };
        }
      }
    }
    if (!await settlesWithin(this.#readerDone, this.#timeouts.readerMs)) {
      return {
        status: "unresolved",
        reason: "stdout reader did not settle after exit",
      };
    }
    return { status: "stopped" };
  }

  #write(value: unknown): Promise<void> {
    const bytes = this.#encoder.encode(`${JSON.stringify(value)}\n`);
    if (bytes.length > MAX_LINE_BYTES) {
      return Promise.reject(new Error("Chat Host IPC request is too large"));
    }
    this.#writeTail = this.#writeTail.then(() => this.#writer.write(bytes));
    return this.#writeTail;
  }

  #rejectPending(error: Error): void {
    this.#ready.reject(error);
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }

  async #readLoop(): Promise<void> {
    const reader = this.#child.stdout.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        if (buffered.length > MAX_LINE_BYTES) {
          throw new Error("Chat Host IPC line is too large");
        }
        while (true) {
          const newline = buffered.indexOf("\n");
          if (newline < 0) break;
          const line = buffered.slice(0, newline);
          buffered = buffered.slice(newline + 1);
          if (line !== "") this.#receive(JSON.parse(line));
        }
      }
      buffered += decoder.decode();
      if (buffered.trim() !== "") this.#receive(JSON.parse(buffered));
      throw new Error("Chat Host IPC closed");
    } catch (error) {
      this.#rejectPending(
        error instanceof Error ? error : new Error("Chat Host IPC failed"),
      );
    } finally {
      reader.releaseLock();
    }
  }

  #receive(value: unknown): void {
    if (!this.#didReady) {
      this.#ready.resolve(parseReady(value, this.#bundleTarget));
      this.#didReady = true;
      return;
    }
    const response = parseResponse(value);
    const pending = this.#pending.get(response.requestId);
    if (pending === undefined) return;
    this.#pending.delete(response.requestId);
    if (response.ok) pending.resolve(response.payload);
    else pending.reject(new Error(response.error ?? "Chat Host request failed"));
  }
}

function spawnDenoChild(options: ChatHostSpawnOptions): ChatHostChild {
  const child = new Deno.Command(options.command, {
    args: [...options.args],
    cwd: options.cwd,
    env: { ...options.env },
    clearEnv: true,
    stdin: "piped",
    stdout: "piped",
    stderr: "null",
  }).spawn();
  if (child.stdin === null || child.stdout === null) {
    throw new Error("Chat Host pipes are unavailable");
  }
  return child as ChatHostChild;
}

function parseReady(
  value: unknown,
  expectedTarget: ChatHostImplementedTarget,
): ChatHostReady {
  const record = object(value, "Chat Host readiness");
  if (
    record.protocol !== CHAT_HOST_IPC_PROTOCOL || record.type !== "ready" ||
    record.chatHostVersion !== CHAT_HOST_COMPONENT_VERSION ||
    record.acpxCommit !== pins.acpx.commit ||
    record.adapterVersion !== pins.adapter.version ||
    record.nodeVersion !== pins.nodeVersion ||
    record.target !== expectedTarget ||
    typeof record.pid !== "number" || !Number.isSafeInteger(record.pid) ||
    record.pid < 1
  ) throw new TypeError("Chat Host readiness pins do not match");
  return {
    protocol: CHAT_HOST_IPC_PROTOCOL,
    type: "ready",
    pid: record.pid,
    chatHostVersion: CHAT_HOST_COMPONENT_VERSION,
    acpxCommit: pins.acpx.commit,
    adapterVersion: pins.adapter.version,
    nodeVersion: pins.nodeVersion,
    target: expectedTarget,
  };
}

function parseResponse(value: unknown): ChatHostIpcResponse {
  const record = object(value, "Chat Host response");
  if (
    record.protocol !== CHAT_HOST_IPC_PROTOCOL ||
    typeof record.requestId !== "string" ||
    typeof record.ok !== "boolean"
  ) {
    throw new TypeError("Chat Host response is invalid");
  }
  return {
    protocol: CHAT_HOST_IPC_PROTOCOL,
    requestId: record.requestId,
    ok: record.ok,
    payload: record.payload,
    ...(typeof record.error === "string"
      ? { error: record.error.slice(0, 1_000) }
      : {}),
  };
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function validateAbsolutePath(
  path: string,
  name: string,
  platform: DesktopPlatform,
): void {
  const invalidSegment = (separator: "/" | "\\") =>
    path.split(separator).some((part) => part === "." || part === "..");
  const isAbsolute = platform === "Windows"
    ? /^[A-Za-z]:\\(?:[^\\]+\\)*[^\\]*$/.test(path) ||
      /^\\\\[^\\]+\\[^\\]+(?:\\[^\\]+)*$/.test(path)
    : path.startsWith("/");
  if (
    path.trim() !== path || !isAbsolute || path.includes("\0") ||
    (platform === "Windows"
      ? /^[A-Za-z]:\\$/.test(path) || /^\\\\[^\\]+\\[^\\]+\\?$/.test(path)
      : path === "/" || path.endsWith("/") || path.includes("//")) ||
    invalidSegment(platform === "Windows" ? "\\" : "/")
  ) {
    throw new TypeError(`${name} must be an exact absolute path`);
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function statusWithin(
  status: Promise<Deno.CommandStatus>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      status.then(() => true, () => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function settlesWithin(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<boolean> {
  return await statusWithin(
    promise.then(
      () => ({ success: true, code: 0, signal: null } as Deno.CommandStatus),
      () => ({ success: false, code: 1, signal: null } as Deno.CommandStatus),
    ),
    timeoutMs,
  );
}

function killIgnoringNotFound(child: ChatHostChild, signal: Deno.Signal): void {
  try {
    child.kill(signal);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}
