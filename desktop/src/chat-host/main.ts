import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import pins from "../../chat-runtime/pins.json" with { type: "json" };
import { ChatCoordinator } from "../chat/coordinator.ts";
import {
  CHAT_HOST_COMPONENT_VERSION,
  parseChatCommandRequest,
  parseChatSnapshotRequest,
} from "../../../src/presentation/desktop/chat/contracts.ts";
import { NodeChatConversationStore } from "./node-store.ts";
import { CHAT_HOST_IPC_PROTOCOL } from "./protocol.ts";
import { createPinnedRuntimeAdapter } from "./runtime-adapter.ts";
import { parseImplementedTarget, resolveTargetArtifacts } from "./target.ts";

interface IpcRequest {
  readonly protocol: typeof CHAT_HOST_IPC_PROTOCOL;
  readonly requestId: string;
  readonly method: "snapshot" | "command" | "shutdown";
  readonly payload?: unknown;
}

const dataRoot = readDataRoot(process.argv.slice(2));
const runtimeRoot = dirname(fileURLToPath(import.meta.url));
const bundleManifest = JSON.parse(
  readFileSync(join(runtimeRoot, "bundle-manifest.json"), "utf8"),
) as Record<string, unknown>;
const runtimeTarget = parseImplementedTarget(bundleManifest.target);
const targetArtifacts = resolveTargetArtifacts(runtimeTarget);
const adapterEntry = realpathSync(
  join(
    runtimeRoot,
    "adapter",
    "node_modules",
    "@agentclientprotocol",
    "codex-acp",
    "dist",
    "index.js",
  ),
);
const acpxPackage = realpathSync(join(runtimeRoot, "acpx"));
assertRuntimePins(acpxPackage, adapterEntry);
await mkdir(join(dataRoot, "workspace"), { recursive: true, mode: 0o700 });

const runtimeAdapter = await createPinnedRuntimeAdapter({
  dataRoot,
  workspaceRoot: join(dataRoot, "workspace"),
  acpxRuntimeUrl: new URL("./acpx/dist/runtime.js", import.meta.url).href,
  adapterEntry,
  nodeExecutable: process.execPath,
});
const coordinator = await ChatCoordinator.create({
  runtimeAdapter,
  store: new NodeChatConversationStore(join(dataRoot, "chat")),
  workspaceRoot: join(dataRoot, "workspace"),
});

write({
  protocol: CHAT_HOST_IPC_PROTOCOL,
  type: "ready",
  pid: process.pid,
  chatHostVersion: CHAT_HOST_COMPONENT_VERSION,
  acpxCommit: pins.acpx.commit,
  adapterVersion: pins.adapter.version,
  nodeVersion: process.versions.node,
  target: runtimeTarget,
});

let stopping = false;
process.once("SIGINT", () => void stop().finally(() => process.exit(0)));
process.once("SIGTERM", () => void stop().finally(() => process.exit(0)));
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  if (line.length > 1_000_000) {
    writeError("oversize", "IPC request is too large");
    continue;
  }
  let request: IpcRequest;
  try {
    request = parseIpcRequest(JSON.parse(line));
  } catch (error) {
    writeError("invalid", safeError(error));
    continue;
  }
  try {
    if (request.method === "snapshot") {
      const input = parseChatSnapshotRequest(request.payload);
      writeResponse(request.requestId, coordinator.snapshot(input.conversationId));
    } else if (request.method === "command") {
      const input = parseChatCommandRequest(request.payload);
      writeResponse(request.requestId, await coordinator.command(input));
    } else {
      writeResponse(request.requestId, { stopped: true });
      await stop();
      break;
    }
  } catch (error) {
    writeError(request.requestId, safeError(error));
  }
}
await stop();

async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await coordinator.stop();
}

function parseIpcRequest(value: unknown): IpcRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("IPC request must be an object");
  }
  const record = value as Record<string, unknown>;
  if (record.protocol !== CHAT_HOST_IPC_PROTOCOL) {
    throw new TypeError("IPC protocol mismatch");
  }
  if (
    typeof record.requestId !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(record.requestId)
  ) {
    throw new TypeError("IPC requestId is invalid");
  }
  if (
    record.method !== "snapshot" && record.method !== "command" &&
    record.method !== "shutdown"
  ) {
    throw new TypeError("IPC method is invalid");
  }
  return {
    protocol: CHAT_HOST_IPC_PROTOCOL,
    requestId: record.requestId,
    method: record.method,
    payload: record.payload,
  };
}

function readDataRoot(args: readonly string[]): string {
  if (args.length !== 1 || !args[0].startsWith("--data-root=")) {
    throw new TypeError("Chat Host requires one --data-root argument");
  }
  const path = args[0].slice("--data-root=".length);
  if (!isExactAbsolutePath(path, process.platform)) {
    throw new TypeError("Chat Host data root must be an exact absolute path");
  }
  return path;
}

function isExactAbsolutePath(
  path: string,
  platform: NodeJS.Platform,
): boolean {
  if (path === "" || path.includes("\0")) return false;
  if (platform === "win32") {
    const drive = /^[A-Za-z]:\\(?:[^\\]+\\)*[^\\]*$/.test(path);
    const unc = /^\\\\[^\\]+\\[^\\]+(?:\\[^\\]+)*$/.test(path);
    const root = /^[A-Za-z]:\\$/.test(path) || /^\\\\[^\\]+\\[^\\]+\\?$/.test(path);
    return !root && path.trim() === path && (drive || unc) &&
      !path.split("\\").some((part) => part === ".." || part === ".");
  }
  return path.trim() === path && path.startsWith("/") && path !== "/" &&
    !path.endsWith("/") && !path.includes("//") &&
    !path.split("/").some((part) => part === ".." || part === ".");
}

function assertRuntimePins(acpxPackage: string, adapter: string): void {
  if (process.versions.node !== pins.nodeVersion) {
    throw new Error("packaged Node runtime version mismatch");
  }
  if (fileSha256(process.execPath) !== targetArtifacts.nodeBinarySha256) {
    throw new Error("packaged Node executable digest mismatch");
  }
  const runtimeDigest = fileSha256(join(acpxPackage, "dist", "runtime.js"));
  if (runtimeDigest !== pins.acpx.runtimeSha256) {
    throw new Error("packaged acpx runtime digest mismatch");
  }
  const lifelineDigest = fileSha256(join(acpxPackage, "dist", "native", "lifeline"));
  if (lifelineDigest !== targetArtifacts.acpxLifelineSha256) {
    throw new Error("packaged acpx lifeline digest mismatch");
  }
  if (fileSha256(adapter) !== pins.adapter.entrySha256) {
    throw new Error("packaged ACP adapter digest mismatch");
  }
  const codexBinary = join(
    runtimeRoot,
    "adapter",
    "node_modules",
    ...targetArtifacts.codexPackage.split("/"),
    ...targetArtifacts.codexBinaryPath.split("/"),
  );
  if (fileSha256(codexBinary) !== targetArtifacts.codexBinarySha256) {
    throw new Error("packaged Codex executable digest mismatch");
  }
}

function fileSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function writeResponse(requestId: string, payload: unknown): void {
  write({ protocol: CHAT_HOST_IPC_PROTOCOL, requestId, ok: true, payload });
}

function writeError(requestId: string, error: string): void {
  write({ protocol: CHAT_HOST_IPC_PROTOCOL, requestId, ok: false, error });
}

function write(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Chat Host request failed";
  return [...message].map((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? " " : character;
  }).join("").slice(0, 1_000);
}
