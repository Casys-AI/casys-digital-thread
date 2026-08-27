import { fail, type HostResult, ok } from "../host/result.ts";
import { constructHelperCommand } from "./command.ts";
import {
  COMMAND_RECOVERY,
  CONTROL_PLANE_LAYOUTS,
  type ControlPlaneLayoutProfile,
  type DesktopPlatform,
  type HelperMode,
  type OwnedSidecarHandle,
  type PackagedHelperCommand,
} from "./contracts.ts";
import type { ControlPlaneHostPorts } from "./ports.ts";

const INSPECT_MAX_BYTES = 16_384;
const INSPECT_TIMEOUT_MS = 2_000;

export interface SpawnableChild {
  readonly stdin: WritableStream<Uint8Array> | null;
  readonly stdout: ReadableStream<Uint8Array> | null;
  readonly status: Promise<Deno.CommandStatus>;
  kill(signo?: Deno.Signal): void;
}

export type PackagedHelperSpawnImpl = (
  command: PackagedHelperCommand,
) => SpawnableChild;

/**
 * Wraps a live child this host spawned. The returned handle has no pid field.
 * Stop must call `closeStdin` / `kill` on this object, never `Deno.kill(pid)`.
 */
export function wrapOwnedSidecarHandle(child: SpawnableChild): OwnedSidecarHandle {
  return {
    stdout: child.stdout,
    status: child.status,
    closeStdin() {
      const stdin = child.stdin;
      if (stdin === null) return;
      try {
        void stdin.getWriter().close();
      } catch {
        try {
          void stdin.abort();
        } catch {
          // Already closed.
        }
      }
    },
    kill(signo: Deno.Signal) {
      try {
        child.kill(signo);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
    },
  };
}

export function spawnPackagedHelper(
  command: PackagedHelperCommand,
  platform: DesktopPlatform,
  spawnImpl: PackagedHelperSpawnImpl = defaultDenoSpawn,
): HostResult<OwnedSidecarHandle> {
  const validated = revalidatePackagedHelperCommand(command, platform);
  if (!validated.ok) return validated;
  if (validated.value.args[0] !== "start") {
    return fail(
      "command.mode-invalid",
      "the persistent spawn port accepts start only",
      COMMAND_RECOVERY,
    );
  }
  const child = spawnImpl(validated.value);
  return ok(wrapOwnedSidecarHandle(child));
}

export function revalidatePackagedHelperCommand(
  command: PackagedHelperCommand,
  platform: DesktopPlatform,
): HostResult<PackagedHelperCommand> {
  if (
    command.stdin !== "piped" || command.stdout !== "piped" ||
    command.stderr !== "null" || command.clearEnv !== true
  ) {
    return fail(
      "command.stdio-invalid",
      "the helper requires piped stdin/stdout, discarded stderr, and a cleared env",
      COMMAND_RECOVERY,
    );
  }
  if (Object.keys(command.env).length !== 0) {
    return fail(
      "command.env-invalid",
      "the helper command must carry no environment variables",
      COMMAND_RECOVERY,
    );
  }

  const parsed = parseCommandArgs(command.args);
  if (!parsed.ok) return parsed;
  const layout = CONTROL_PLANE_LAYOUTS[parsed.value.layoutProfile];
  const rebuilt = constructHelperCommand({
    helperPath: command.program,
    cwd: command.cwd,
    platform,
    layoutProfile: parsed.value.layoutProfile,
    relativeWorkspace: layout.relativeWorkspace,
    mode: parsed.value.mode,
    ...(parsed.value.launchId === undefined ? {} : { launchId: parsed.value.launchId }),
  });
  if (!rebuilt.ok) return rebuilt;
  if (
    rebuilt.value.program !== command.program ||
    rebuilt.value.cwd !== command.cwd ||
    JSON.stringify(rebuilt.value.args) !== JSON.stringify(command.args)
  ) {
    return fail(
      "command.mismatch",
      "spawn command does not match the reconstructed packaged helper command",
      COMMAND_RECOVERY,
    );
  }
  return rebuilt;
}

/** Complete production adapter; application/main supplies no subprocess policy. */
export function createDenoControlPlanePorts(
  platform: DesktopPlatform,
  options: { readonly inspectTimeoutMs?: number } = {},
): ControlPlaneHostPorts {
  return Object.freeze({
    fetch: globalThis.fetch.bind(globalThis),
    spawn(command: PackagedHelperCommand): OwnedSidecarHandle {
      const spawned = spawnPackagedHelper(command, platform);
      if (!spawned.ok) throw new Error(spawned.error.message);
      return spawned.value;
    },
    async runInspect(command: PackagedHelperCommand): Promise<string> {
      const validated = revalidatePackagedHelperCommand(command, platform);
      if (!validated.ok) throw new Error(validated.error.message);
      if (validated.value.args[0] !== "inspect") {
        throw new Error("inspect port accepts inspect mode only");
      }
      const child = defaultDenoSpawn(validated.value);
      const textPromise = readBoundedText(child.stdout, INSPECT_MAX_BYTES);
      closeWritable(child.stdin);
      const timeoutMs = options.inspectTimeoutMs ?? INSPECT_TIMEOUT_MS;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<"timeout">((resolve) => {
          timer = setTimeout(() => resolve("timeout"), timeoutMs);
        });
        const outcome = await Promise.race([
          Promise.all([textPromise, child.status]).then(([text, status]) => ({
            text,
            status,
          })),
          timeout,
        ]);
        if (outcome === "timeout") {
          stopSpawnedChild(child);
          await child.status.catch(() => undefined);
          throw new Error("packaged helper inspect timed out");
        }
        if (!outcome.status.success) {
          throw new Error("packaged helper inspect exited unsuccessfully");
        }
        return outcome.text;
      } catch (error) {
        stopSpawnedChild(child);
        await child.status.catch(() => undefined);
        throw error;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
    createLaunchId: () => crypto.randomUUID(),
  });
}

function defaultDenoSpawn(command: PackagedHelperCommand): SpawnableChild {
  return new Deno.Command(command.program, {
    args: [...command.args],
    cwd: command.cwd,
    env: {},
    clearEnv: true,
    stdin: "piped",
    stdout: "piped",
    stderr: "null",
  }).spawn();
}

function parseCommandArgs(args: readonly string[]): HostResult<{
  readonly mode: HelperMode;
  readonly layoutProfile: ControlPlaneLayoutProfile;
  readonly launchId?: string;
}> {
  const mode = args[0];
  const profileArgument = args[1];
  if (
    (mode !== "start" && mode !== "inspect") ||
    typeof profileArgument !== "string" ||
    !profileArgument.startsWith("--layout-profile=")
  ) {
    return fail(
      "command.args-invalid",
      "helper arguments do not match the closed start/inspect grammar",
      COMMAND_RECOVERY,
    );
  }
  const profile = profileArgument.slice("--layout-profile=".length);
  if (!Object.hasOwn(CONTROL_PLANE_LAYOUTS, profile)) {
    return fail(
      "command.layout-profile-invalid",
      "helper layout profile is not registered",
      COMMAND_RECOVERY,
    );
  }
  const layoutProfile = profile as ControlPlaneLayoutProfile;
  if (mode === "inspect" && args.length === 2) {
    return ok({ mode, layoutProfile });
  }
  const launchArgument = args[2];
  if (
    mode === "start" && args.length === 3 &&
    typeof launchArgument === "string" &&
    launchArgument.startsWith("--launch-id=")
  ) {
    return ok({
      mode,
      layoutProfile,
      launchId: launchArgument.slice("--launch-id=".length),
    });
  }
  return fail(
    "command.args-invalid",
    "helper arguments do not match the closed start/inspect grammar",
    COMMAND_RECOVERY,
  );
}

async function readBoundedText(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<string> {
  if (stream === null) throw new Error("helper stdout is unavailable");
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) throw new Error("helper inspect output is oversized");
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(merged);
}

function closeWritable(stream: WritableStream<Uint8Array> | null): void {
  if (stream === null) return;
  try {
    void stream.getWriter().close();
  } catch {
    try {
      void stream.abort();
    } catch {
      // Already closed.
    }
  }
}

function stopSpawnedChild(child: SpawnableChild): void {
  try {
    child.kill();
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}
