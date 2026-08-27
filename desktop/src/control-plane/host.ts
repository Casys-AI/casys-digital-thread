import { fail, type HostResult, ok } from "../host/result.ts";
import { classifyOwnership, type ListenerObservation } from "./classify.ts";
import { constructHelperCommand } from "./command.ts";
import {
  type ConfigurationMaterialization,
  type ControlPlaneHostResult,
  type ControlPlaneInspectDocument,
  type ControlPlaneLifecycleIdentity,
  type ControlPlaneOwnership,
  type ControlPlaneRendererObservation,
  HANDSHAKE_RECOVERY,
  HANDSHAKE_TIMEOUT_MS,
  type OwnedSidecarHandle,
  OWNERSHIP_RECOVERY,
  PROBE_TIMEOUT_MS,
  type ProviderSnapshotObservation,
} from "./contracts.ts";
import {
  buildRendererObservation,
  toDesktopControlPlaneProjection,
} from "./observations.ts";
import {
  parseHandshakeText,
  parseInspectText,
  readBoundedHandshakeText,
} from "./parse.ts";
import type { ControlPlaneHostOptions } from "./ports.ts";
import {
  isListenerAbsent,
  probeConsoleSnapshot,
  probeControlPlaneLifecycle,
} from "./probes.ts";

const STOP_TIMEOUT_MS = 2_000;
const RACE_RECOVERY_POLL_MS = 25;

interface CollectedControlPlane {
  readonly configuration: ConfigurationMaterialization;
  readonly ownership: ControlPlaneOwnership;
  readonly providers?: ProviderSnapshotObservation;
}

export class ControlPlaneHost {
  #owned: OwnedSidecarHandle | undefined;
  #mintedLaunchId: string | undefined;
  #startGate: Promise<ControlPlaneHostResult> | undefined;

  constructor(readonly options: ControlPlaneHostOptions) {}

  async observeResult(): Promise<ControlPlaneHostResult> {
    if (this.#owned !== undefined && await hasExited(this.#owned)) {
      this.#owned = undefined;
      this.#mintedLaunchId = undefined;
    }
    return this.#result(await this.#collect(this.#owned !== undefined));
  }

  async observe(): Promise<ControlPlaneRendererObservation> {
    return (await this.observeResult()).renderer;
  }

  async startResult(): Promise<ControlPlaneHostResult> {
    if (this.#startGate !== undefined) return await this.#startGate;
    const gate = this.#startExclusive();
    this.#startGate = gate;
    try {
      return await gate;
    } finally {
      if (this.#startGate === gate) this.#startGate = undefined;
    }
  }

  async start(): Promise<ControlPlaneRendererObservation> {
    return (await this.startResult()).renderer;
  }

  async reconnectResult(): Promise<ControlPlaneHostResult> {
    const handle = this.#owned;
    if (handle === undefined) return await this.observeResult();
    if (await hasExited(handle)) {
      this.#owned = undefined;
      this.#mintedLaunchId = undefined;
      return await this.observeResult();
    }
    const collected = await this.#collect(true);
    if (collected.ownership.kind !== "owned") {
      this.#owned = undefined;
      this.#mintedLaunchId = undefined;
      await this.#stopHandle(handle);
    }
    return this.#result(collected);
  }

  async reconnect(): Promise<ControlPlaneRendererObservation> {
    return (await this.reconnectResult()).renderer;
  }

  async stop(): Promise<void> {
    const handle = this.#owned;
    if (handle === undefined) return;
    this.#owned = undefined;
    this.#mintedLaunchId = undefined;
    await this.#stopHandle(handle);
  }

  async #startExclusive(): Promise<ControlPlaneHostResult> {
    if (this.#owned !== undefined) return await this.reconnectResult();

    const before = await this.#collect(false);
    if (before.ownership.kind !== "absent") return this.#result(before);
    if (
      before.configuration.state !== "verified" &&
      before.configuration.state !== "missing"
    ) {
      return this.#result(before);
    }

    const launchId = this.options.ports.createLaunchId();
    const command = constructHelperCommand({
      helperPath: this.options.helperPath,
      cwd: this.options.cwd,
      platform: this.options.platform,
      layoutProfile: this.options.layoutProfile,
      relativeWorkspace: this.options.relativeWorkspace,
      mode: "start",
      launchId,
    });
    if (!command.ok) {
      return this.#result(withOwnership(before, {
        kind: "ambiguous",
        reason: command.error.message,
        recovery: command.error.recovery,
        recoveryCode: "helper-unavailable",
      }));
    }

    let spawned: OwnedSidecarHandle;
    try {
      spawned = this.options.ports.spawn(command.value);
    } catch (error) {
      const raced = await this.#recoverReconnect(
        before.configuration.expectedDigest,
      );
      if (raced?.ownership.kind === "reconnected") return this.#result(raced);
      return this.#result(withOwnership(raced ?? before, {
        kind: "ambiguous",
        reason: "The packaged control-plane helper could not be spawned.",
        recovery: OWNERSHIP_RECOVERY,
        recoveryCode: isPermissionDenied(error)
          ? "permission-denied"
          : "helper-unavailable",
      }));
    }

    const handshake = await this.#readHandshake(
      spawned,
      launchId,
      before.configuration.expectedDigest,
    );
    if (!handshake.ok) {
      await this.#stopHandle(spawned);
      const raced = await this.#recoverReconnect(
        before.configuration.expectedDigest,
      );
      if (raced?.ownership.kind === "reconnected") return this.#result(raced);
      return this.#result(withOwnership(raced ?? before, {
        kind: "ambiguous",
        reason: "The spawned helper failed its exact readiness handshake.",
        recovery: handshake.error.recovery,
        recoveryCode: "startup-failed",
      }));
    }

    if (await hasExited(spawned)) {
      await this.#stopHandle(spawned);
      const raced = await this.#recoverReconnect(
        before.configuration.expectedDigest,
      );
      if (raced?.ownership.kind === "reconnected") return this.#result(raced);
      return this.#result(withOwnership(raced ?? before, {
        kind: "ambiguous",
        reason: "The helper exited after handshake before ownership was established.",
        recovery: OWNERSHIP_RECOVERY,
        recoveryCode: "startup-failed",
      }));
    }

    this.#mintedLaunchId = launchId;
    const after = await this.#collect(
      true,
      before.configuration.expectedDigest,
    );
    if (after.ownership.kind === "owned") {
      this.#owned = spawned;
      return this.#result(after);
    }

    this.#mintedLaunchId = undefined;
    await this.#stopHandle(spawned);
    if (after.ownership.kind === "reconnected") return this.#result(after);

    const raced = await this.#recoverReconnect(
      before.configuration.expectedDigest,
    );
    if (raced?.ownership.kind === "reconnected") return this.#result(raced);
    return this.#result(raced ?? after);
  }

  async #collect(
    hasOwnedHandle: boolean,
    pinnedConfigDigest?: string,
  ): Promise<CollectedControlPlane> {
    const inspect = await this.#inspect();
    if (!inspect.ok) {
      return {
        configuration: { state: "error", expectedDigest: "unavailable" },
        ownership: {
          kind: "ambiguous",
          reason: "The signed helper inspect document is unavailable or invalid.",
          recovery: inspect.error.recovery,
          recoveryCode: inspectRecoveryCode(inspect.error.code),
        },
      };
    }
    const configuration = configurationFromInspect(
      inspect.value,
      pinnedConfigDigest,
    );
    const expected = {
      ...this.options.expected,
      configDigest: pinnedConfigDigest ?? inspect.value.expectedConfigDigest,
    };
    const lifecycleProbe = await probeControlPlaneLifecycle(
      this.options.ports.fetch,
      expected,
      { timeoutMs: this.options.probeTimeoutMs ?? PROBE_TIMEOUT_MS },
    );
    const listener: ListenerObservation = lifecycleProbe.ok
      ? "exact"
      : isListenerAbsent(lifecycleProbe)
      ? "absent"
      : "ambiguous";
    const lifecycle: HostResult<ControlPlaneLifecycleIdentity> | null =
      lifecycleProbe.ok
        ? ok(lifecycleProbe.value.lifecycle)
        : listener === "absent"
        ? null
        : fail(
          lifecycleProbe.error.code,
          lifecycleProbe.error.message,
          lifecycleProbe.error.recovery,
        );

    const ownership = classifyOwnership({
      listener,
      inspect,
      lifecycle,
      expected,
      mintedLaunchId: this.#mintedLaunchId,
      hasOwnedHandle,
    });

    if (ownership.kind !== "owned" && ownership.kind !== "reconnected") {
      return { configuration, ownership };
    }

    const snapshot = await probeConsoleSnapshot(this.options.ports.fetch, {
      timeoutMs: this.options.probeTimeoutMs ?? PROBE_TIMEOUT_MS,
    });
    return {
      configuration,
      ownership,
      ...(snapshot.ok ? { providers: snapshot.value } : {}),
    };
  }

  async #inspect(): Promise<HostResult<ControlPlaneInspectDocument>> {
    const command = constructHelperCommand({
      helperPath: this.options.helperPath,
      cwd: this.options.cwd,
      platform: this.options.platform,
      layoutProfile: this.options.layoutProfile,
      relativeWorkspace: this.options.relativeWorkspace,
      mode: "inspect",
    });
    if (!command.ok) return command;
    try {
      const text = await this.options.ports.runInspect(command.value);
      return parseInspectText(text);
    } catch (error) {
      return fail(
        isPermissionDenied(error) ? "inspect.permission-denied" : "inspect.unavailable",
        "The packaged helper inspect command failed.",
        "Run the packaged helper in inspect mode only.",
      );
    }
  }

  async #readHandshake(
    handle: OwnedSidecarHandle,
    launchId: string,
    configDigest: string,
  ): Promise<HostResult<true>> {
    if (handle.stdout === null) {
      return fail(
        "handshake.empty",
        "spawned helper has no stdout handshake stream",
        "The packaged helper must write one bounded JSON handshake to stdout.",
      );
    }
    try {
      const exited = () =>
        fail(
          "handshake.empty",
          "the packaged helper exited before writing a handshake",
          HANDSHAKE_RECOVERY,
        ) as HostResult<string>;
      const text = await Promise.race([
        readBoundedHandshakeText(handle.stdout, {
          timeoutMs: this.options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS,
        }),
        handle.status.then(exited, exited),
      ]);
      if (!text.ok) return text;
      const parsed = parseHandshakeText(text.value, {
        productVersion: this.options.expected.productVersion,
        serverVersion: this.options.expected.serverVersion,
        launchId,
        configDigest,
      });
      if (!parsed.ok) return parsed;
      return ok(true);
    } catch {
      return fail(
        "handshake.unavailable",
        "the helper handshake stream failed before exact readiness",
        HANDSHAKE_RECOVERY,
      );
    }
  }

  async #recoverReconnect(
    pinnedConfigDigest: string,
  ): Promise<CollectedControlPlane | undefined> {
    const timeoutMs = this.options.raceRecoveryTimeoutMs ??
      this.options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    let latest: CollectedControlPlane | undefined;
    do {
      latest = await this.#collect(false, pinnedConfigDigest);
      if (latest.ownership.kind === "reconnected") return latest;
      if (latest.ownership.kind === "mismatch") return latest;
      if (Date.now() >= deadline) return latest;
      await sleep(Math.min(RACE_RECOVERY_POLL_MS, timeoutMs));
    } while (true);
  }

  async #stopHandle(handle: OwnedSidecarHandle): Promise<void> {
    handle.closeStdin();
    const timeoutMs = this.options.stopTimeoutMs ?? STOP_TIMEOUT_MS;
    if (await waitForExit(handle, timeoutMs)) return;

    handle.kill("SIGTERM");
    if (await waitForExit(handle, timeoutMs)) return;

    handle.kill("SIGKILL");
    await waitForExit(handle, timeoutMs);
  }

  #result(collected: CollectedControlPlane): ControlPlaneHostResult {
    const input = {
      configuration: collected.configuration,
      ownership: collected.ownership,
      providers: collected.providers,
    };
    return Object.freeze({
      renderer: buildRendererObservation(input),
      projection: toDesktopControlPlaneProjection({
        ...input,
        expected: this.options.expected,
      }),
    });
  }
}

function configurationFromInspect(
  inspect: ControlPlaneInspectDocument,
  pinnedConfigDigest?: string,
): ConfigurationMaterialization {
  if (
    pinnedConfigDigest !== undefined &&
    inspect.expectedConfigDigest !== pinnedConfigDigest
  ) {
    return { state: "mismatch", expectedDigest: pinnedConfigDigest };
  }
  return {
    state: inspect.configuration,
    expectedDigest: pinnedConfigDigest ?? inspect.expectedConfigDigest,
  };
}

function withOwnership(
  collected: CollectedControlPlane,
  ownership: ControlPlaneOwnership,
): CollectedControlPlane {
  return { configuration: collected.configuration, ownership };
}

async function hasExited(handle: OwnedSidecarHandle): Promise<boolean> {
  return await Promise.race([
    handle.status.then(() => true, () => true),
    Promise.resolve(false),
  ]);
}

async function waitForExit(
  handle: OwnedSidecarHandle,
  timeoutMs: number,
): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      handle.status.then(() => true, () => true),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function isPermissionDenied(error: unknown): boolean {
  return error instanceof Deno.errors.PermissionDenied ||
    (error instanceof Error && /permission denied|notcapable/i.test(error.message));
}

function inspectRecoveryCode(
  code: string,
): NonNullable<ControlPlaneOwnership["recoveryCode"]> {
  if (code === "inspect.permission-denied") return "permission-denied";
  if (code === "inspect.unavailable" || code.startsWith("command.")) {
    return "helper-unavailable";
  }
  return "marker-invalid";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
