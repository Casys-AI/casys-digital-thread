/**
 * Desktop tool-runtime host boundary (#56).
 *
 * The single privileged surface for engine and provider-container control:
 * detection, preparation, explicit engine start, and owned-only stop /
 * remove / image removal / update. All observation is read-only; all
 * mutation is serialized per tool through exclusive gates. MCP App viewers
 * never receive this module — renderer code only sees the safe projection.
 */
import {
  type CommandRunner,
  DenoCommandRunner,
} from "../../../src/adapters/shared/docker-observer.ts";
import type { DesktopToolRuntimeProjection } from "../contracts/diagnostics.ts";
import { DockerResolvingRunner } from "./docker.ts";
import {
  detectToolRuntimeEngine,
  type ToolRuntimeEngineObservation,
} from "./engine.ts";
import {
  intentFileName,
  loadToolRuntimeIntent,
  type ToolRuntimeIntent,
} from "./intent.ts";
import { build123dHostPlan } from "./plans.ts";
import {
  type PreparationOutcome,
  prepareToolRuntime,
  TOOL_RUNTIME_OWNER_LABEL,
  TOOL_RUNTIME_TOOL_LABEL,
  type ToolRuntimePlan,
  type ToolRuntimeRecoveryCode,
} from "./preparation.ts";

export type ToolRuntimeToolState =
  | "ready"
  | "stopped"
  | "needs-action"
  | "interrupted"
  | "never-prepared";

export interface ToolRuntimeToolStatus {
  readonly toolId: string;
  readonly displayName: string;
  readonly state: ToolRuntimeToolState;
  readonly detail: string;
  readonly version?: string;
  readonly imageBytes?: number;
  readonly ownedContainers: number;
  readonly ownedVolumes: readonly string[];
  readonly recoveryCode?: ToolRuntimeRecoveryCode;
  readonly recovery?: string;
}

export interface ToolRuntimeStatus {
  readonly engine: ToolRuntimeEngineObservation;
  readonly tools: readonly ToolRuntimeToolStatus[];
}

export interface ToolRuntimeHostOptions {
  readonly dataDirectory: string;
  readonly probeRunner?: CommandRunner;
  readonly execRunner?: CommandRunner;
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => string;
  readonly platform?: () => { os: string; arch: string };
  readonly confirmInstall?: () => Promise<boolean>;
  readonly onEvent?: (
    toolId: string,
    event: { step: string; status: string; detail: string },
  ) => void;
}

export type ToolRuntimeMutationOutcome =
  | { readonly status: "done"; readonly detail: string }
  | {
    readonly status: "needs-action";
    readonly code: ToolRuntimeRecoveryCode | "engine-unavailable" | "foreign-use";
    readonly detail: string;
    readonly recovery: string;
  };

type NeedsActionOutcome = Extract<
  ToolRuntimeMutationOutcome,
  { status: "needs-action" }
>;

type OwnedClearResult =
  | { readonly removed: number }
  | { readonly failure: NeedsActionOutcome };

const ENGINE_START_WAIT_MS = 180_000;
const ENGINE_START_POLL_MS = 3_000;

/**
 * Projects host status to the renderer-safe contract. States, counts,
 * bytes, and recovery sentences only: paths, ports, container ids,
 * endpoints, and digests never cross this boundary.
 */
export function projectToolRuntimeStatus(
  status: ToolRuntimeStatus,
): DesktopToolRuntimeProjection {
  return {
    engine: status.engine.status,
    engineDetail: scrubRendererText(status.engine.detail),
    ...(status.engine.status === "ready"
      ? {}
      : { engineRecovery: engineRecovery(status.engine.status) }),
    tools: status.tools.map((tool) => ({
      toolId: tool.toolId,
      displayName: tool.displayName,
      state: tool.state,
      detail: scrubRendererText(tool.detail),
      ...(tool.version === undefined ? {} : { version: tool.version }),
      ...(tool.imageBytes === undefined ? {} : { imageBytes: tool.imageBytes }),
      ownedContainers: tool.ownedContainers,
      ownedVolumes: [...tool.ownedVolumes],
      ...(tool.recovery === undefined
        ? {}
        : { recovery: scrubRendererText(tool.recovery) }),
    })),
  };
}

/**
 * Last line of the renderer contract: journaled and CLI-derived strings can
 * echo a pinned digest, which must never cross to the renderer. Ports and
 * paths are removed at the source because they cannot be scrubbed safely.
 * Shared with the catalogue boundary, the second renderer surface.
 */
export function scrubRendererText(text: string): string {
  return text.replace(/sha256:[a-f0-9]{64}/gi, "sha256:<digest>");
}

function engineRecovery(
  status: ToolRuntimeEngineObservation["status"],
): string {
  switch (status) {
    case "absent":
      return "Approve the Docker Desktop install from the runtime panel, or install a compatible engine manually.";
    case "stopped":
      return "Start Docker Desktop explicitly, then re-run preparation.";
    case "incompatible":
      return "Resolve the incompatibility, or remove the engine so the app-managed install path applies.";
    case "ready":
      return "";
  }
}

export class ToolRuntimeHost {
  readonly #options: ToolRuntimeHostOptions;
  readonly #probeRunner: CommandRunner;
  readonly #execRunner: CommandRunner;
  readonly #gates = new Map<string, Promise<unknown>>();

  constructor(options: ToolRuntimeHostOptions) {
    this.#options = options;
    // Default runners resolve bare `docker` to its absolute install: the
    // packaged launcher controls PATH, so ambient resolution is dead in
    // production. Injected test runners pass through untouched.
    this.#probeRunner = options.probeRunner ??
      new DockerResolvingRunner(new DenoCommandRunner(10_000));
    this.#execRunner = options.execRunner ??
      new DockerResolvingRunner(new DenoCommandRunner(300_000));
  }

  /** Read-only status: engine, intents, owned containers, images, volumes. Never mutates. */
  async status(): Promise<ToolRuntimeStatus> {
    const engine = await detectToolRuntimeEngine(
      this.#probeRunner,
      this.#options.dataDirectory,
    );
    const tools: ToolRuntimeToolStatus[] = [];
    for (const toolId of ["build123d"]) {
      tools.push(await this.toolStatus(toolId));
    }
    return { engine, tools };
  }

  /** Runs preparation for a tool through the per-tool exclusive gate. */
  async prepare(toolId: string): Promise<PreparationOutcome> {
    return await this.exclusive(toolId, () =>
      prepareToolRuntime(
        {
          probeRunner: this.#probeRunner,
          execRunner: this.#execRunner,
          ...(this.#options.fetch === undefined ? {} : { fetch: this.#options.fetch }),
          ...(this.#options.sleep === undefined ? {} : { sleep: this.#options.sleep }),
          ...(this.#options.now === undefined ? {} : { now: this.#options.now }),
          ...(this.#options.platform === undefined
            ? {}
            : { platform: this.#options.platform }),
          ...(this.#options.confirmInstall === undefined
            ? {}
            : { confirmInstall: this.#options.confirmInstall }),
          onEvent: (event) => this.#options.onEvent?.(toolId, event),
        },
        this.planFor(toolId),
      ));
  }

  /**
   * Explicit operator action: launches Docker Desktop (macOS) and waits for
   * the daemon. Preparation never calls this implicitly.
   */
  async startEngine(): Promise<ToolRuntimeMutationOutcome> {
    const os = (this.#options.platform?.() ?? Deno.build).os;
    const before = await detectToolRuntimeEngine(
      this.#probeRunner,
      this.#options.dataDirectory,
    );
    if (before.status === "ready") {
      return { status: "done", detail: before.detail };
    }
    if (before.status !== "stopped") {
      return {
        status: "needs-action",
        code: "engine-unavailable",
        detail: before.detail,
        recovery: "Resolve the engine state explicitly before starting it.",
      };
    }
    if (os !== "darwin") {
      return {
        status: "needs-action",
        code: "engine-unavailable",
        detail: `No engine start action exists for ${os}.`,
        recovery: "Start a compatible OCI engine manually, then re-run preparation.",
      };
    }
    const launched = await this.#execRunner.run(
      "/usr/bin/open",
      ["-a", "Docker"],
      this.#options.dataDirectory,
    );
    if (!launched.success) {
      return {
        status: "needs-action",
        code: "engine-unavailable",
        detail: `Could not launch Docker Desktop: ${launched.stderr}`,
        recovery: "Launch Docker Desktop manually, then re-run preparation.",
      };
    }
    const sleep = this.#options.sleep ??
      ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    const deadline = Date.now() + ENGINE_START_WAIT_MS;
    for (;;) {
      const observed = await detectToolRuntimeEngine(
        this.#probeRunner,
        this.#options.dataDirectory,
      );
      if (observed.status === "ready") {
        return { status: "done", detail: observed.detail };
      }
      if (Date.now() >= deadline) {
        return {
          status: "needs-action",
          code: "engine-unavailable",
          detail: "Docker Desktop did not become ready in time.",
          recovery: "Inspect Docker Desktop explicitly, then retry the start action.",
        };
      }
      await sleep(ENGINE_START_POLL_MS);
    }
  }

  /** Stops owned containers only. Volumes and images are always retained. */
  async stop(toolId: string): Promise<ToolRuntimeMutationOutcome> {
    return await this.exclusive(toolId, async () => {
      const plan = this.planFor(toolId);
      const owned = await this.ownedContainers(plan);
      if (owned === undefined) {
        return {
          status: "needs-action",
          code: "engine-unavailable",
          detail: "Owned containers could not be listed; refusing to act blindly.",
          recovery: "Inspect the engine explicitly, then retry the stop action.",
        } as const;
      }
      const running = owned.filter((entry) => entry.state === "running");
      for (const entry of running) {
        const stopped = await this.#execRunner.run(
          "docker",
          ["stop", entry.id],
          this.#options.dataDirectory,
        );
        if (!stopped.success) {
          return {
            status: "needs-action",
            code: "engine-unavailable",
            detail: `Could not stop owned container ${entry.id}: ${stopped.stderr}`,
            recovery: "Inspect the container explicitly, then retry the stop action.",
          } as const;
        }
      }
      return {
        status: "done",
        detail: running.length === 0
          ? "No owned containers were running."
          : `Stopped ${running.length} owned container(s); volumes and images retained.`,
      } as const;
    });
  }

  /**
   * Removes owned containers (after stopping them). Named volumes and images
   * are always retained: saved work is never deleted by this action.
   */
  async remove(toolId: string): Promise<ToolRuntimeMutationOutcome> {
    return await this.exclusive(toolId, async () => {
      const plan = this.planFor(toolId);
      const cleared = await this.stopAndRemoveOwned(plan, "remove");
      if ("failure" in cleared) return cleared.failure;
      return {
        status: "done",
        detail:
          `Removed ${cleared.removed} owned container(s); volumes and images retained.`,
      } as const;
    });
  }

  /**
   * Removes the exact pinned image, after verifying no container at all
   * references it. Never prunes; never touches another image.
   */
  async removeImage(toolId: string): Promise<ToolRuntimeMutationOutcome> {
    return await this.exclusive(toolId, async () => {
      const plan = this.planFor(toolId);
      const users = await this.#probeRunner.run(
        "docker",
        ["ps", "-a", "--filter", `ancestor=${plan.imageRef}`, "--format", "{{.ID}}"],
        this.#options.dataDirectory,
      );
      if (!users.success) {
        return {
          status: "needs-action",
          code: "engine-unavailable",
          detail: "Image users could not be listed; refusing to act blindly.",
          recovery: "Inspect the engine explicitly, then retry.",
        } as const;
      }
      const ids = users.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
      if (ids.length > 0) {
        return {
          status: "needs-action",
          code: "foreign-use",
          detail: `Image is still referenced by ${ids.length} container(s).`,
          recovery: "Remove the referencing containers explicitly first.",
        } as const;
      }
      const removed = await this.#execRunner.run(
        "docker",
        ["rmi", plan.imageRef],
        this.#options.dataDirectory,
      );
      if (!removed.success) {
        return {
          status: "needs-action",
          code: "engine-unavailable",
          detail: `Could not remove image: ${removed.stderr}`,
          recovery: "Inspect the image explicitly, then retry.",
        } as const;
      }
      return { status: "done", detail: `Removed image ${plan.imageRef}.` } as const;
    });
  }

  /**
   * Moves a tool to a new exact pinned image. Owned containers are stopped
   * and removed first, so the new intent never describes a new digest while
   * the old provider still runs. The prior intent is then archived beside
   * the new one, the old image is kept, and volumes are retained, so saved
   * work always survives an update.
   */
  async update(
    toolId: string,
    imageRef: string,
  ): Promise<PreparationOutcome> {
    return await this.exclusive(toolId, async () => {
      if (!/^.+@sha256:[a-f0-9]{64}$/.test(imageRef)) {
        return {
          status: "needs-action",
          code: "image-unverified",
          detail:
            `Refusing update to ${imageRef}: only repo@sha256:<hex> pins are accepted.`,
          recovery: "Supply an exact digest-pinned image reference.",
        } as const;
      }
      const plan = this.planFor(toolId);
      const cleared = await this.stopAndRemoveOwned(plan, "update");
      if ("failure" in cleared) {
        return {
          status: "needs-action",
          code: "update-blocked",
          detail:
            `Could not clear owned containers before the update: ${cleared.failure.detail}`,
          recovery: cleared.failure.recovery,
        } as const;
      }
      const current = `${plan.workdir}/${intentFileName(toolId)}`;
      try {
        await Deno.stat(current);
        const stamp = (this.#options.now?.() ?? new Date().toISOString()).replace(
          /[:.]/g,
          "-",
        );
        await Deno.rename(current, `${current}.previous.${stamp}.json`);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
      return await prepareToolRuntime(
        {
          probeRunner: this.#probeRunner,
          execRunner: this.#execRunner,
          ...(this.#options.fetch === undefined ? {} : { fetch: this.#options.fetch }),
          ...(this.#options.sleep === undefined ? {} : { sleep: this.#options.sleep }),
          ...(this.#options.now === undefined ? {} : { now: this.#options.now }),
          ...(this.#options.platform === undefined
            ? {}
            : { platform: this.#options.platform }),
          ...(this.#options.confirmInstall === undefined
            ? {}
            : { confirmInstall: this.#options.confirmInstall }),
          onEvent: (event) => this.#options.onEvent?.(toolId, event),
        },
        { ...plan, imageRef },
      );
    });
  }

  private planFor(toolId: string): ToolRuntimePlan {
    if (toolId !== "build123d") {
      throw new TypeError(`Unknown host tool "${toolId}".`);
    }
    return build123dHostPlan({ workdir: `${this.#options.dataDirectory}/build123d` });
  }

  private async toolStatus(toolId: string): Promise<ToolRuntimeToolStatus> {
    const plan = this.planFor(toolId);
    const displayName = "Build123d";
    let intent: ToolRuntimeIntent | undefined;
    try {
      intent = await loadToolRuntimeIntent(
        `${this.#options.dataDirectory}/build123d`,
        toolId,
      );
    } catch {
      return {
        toolId,
        displayName,
        state: "needs-action",
        detail: "The preparation intent is corrupt.",
        ownedContainers: 0,
        ownedVolumes: [],
        recovery: "Delete the corrupt intent file explicitly to start fresh.",
      };
    }
    if (intent === undefined) {
      return {
        toolId,
        displayName,
        state: "never-prepared",
        detail: "This tool was never prepared on this machine.",
        ownedContainers: 0,
        ownedVolumes: [],
      };
    }
    const failed = Object.values(intent.steps).find((step) =>
      step.status === "failed" || step.status === "uncertain"
    );
    if (failed !== undefined) {
      return {
        toolId,
        displayName,
        state: "needs-action",
        detail: failed.detail ?? "A preparation step needs attention.",
        ownedContainers: await this.countOwned(plan),
        ownedVolumes: await this.ownedVolumes(plan),
        ...(failed.code === undefined
          ? {}
          : { recoveryCode: failed.code as ToolRuntimeRecoveryCode }),
        ...(failed.recovery === undefined ? {} : { recovery: failed.recovery }),
      };
    }
    const interrupted = Object.values(intent.steps).some((step) =>
      step.status === "running" || step.status === "pending"
    );
    if (interrupted) {
      return {
        toolId,
        displayName,
        state: "interrupted",
        detail: "Preparation was interrupted; re-running resumes it.",
        ownedContainers: await this.countOwned(plan),
        ownedVolumes: await this.ownedVolumes(plan),
      };
    }
    const running = await this.ownedRunning(plan);
    const state = running ? "ready" as const : "stopped" as const;
    return {
      toolId,
      displayName,
      state,
      detail: running
        ? "Prepared and running."
        : "Prepared but no owned container is running.",
      version: plan.providerVersion,
      imageBytes: await this.ownedImageBytes(plan),
      ownedContainers: await this.countOwned(plan),
      ownedVolumes: await this.ownedVolumes(plan),
    };
  }

  private async ownedContainers(
    plan: ToolRuntimePlan,
  ): Promise<{ id: string; state: string }[] | undefined> {
    const listed = await this.#probeRunner.run(
      "docker",
      [
        "ps",
        "-a",
        "--filter",
        `label=${TOOL_RUNTIME_OWNER_LABEL}=${plan.projectName}`,
        "--filter",
        `label=${TOOL_RUNTIME_TOOL_LABEL}=${plan.toolId}`,
        "--format",
        "{{json .}}",
      ],
      this.#options.dataDirectory,
    );
    if (!listed.success) return undefined;
    const entries: { id: string; state: string }[] = [];
    for (const line of listed.stdout.split("\n")) {
      if (line.trim() === "") continue;
      try {
        const row = JSON.parse(line) as { ID?: unknown; State?: unknown };
        if (typeof row.ID !== "string" || typeof row.State !== "string") {
          return undefined;
        }
        entries.push({ id: row.ID, state: row.State });
      } catch {
        return undefined;
      }
    }
    return entries;
  }

  private async ownedRunning(plan: ToolRuntimePlan): Promise<boolean> {
    const owned = await this.ownedContainers(plan);
    return owned !== undefined && owned.some((entry) => entry.state === "running");
  }

  private async countOwned(plan: ToolRuntimePlan): Promise<number> {
    return (await this.ownedContainers(plan))?.length ?? 0;
  }

  private async ownedVolumes(plan: ToolRuntimePlan): Promise<string[]> {
    const listed = await this.#probeRunner.run(
      "docker",
      [
        "volume",
        "ls",
        "--filter",
        `label=com.docker.compose.project=${plan.projectName}`,
        "--format",
        "{{.Name}}",
      ],
      this.#options.dataDirectory,
    );
    if (!listed.success) return [];
    return listed.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  }

  private async ownedImageBytes(plan: ToolRuntimePlan): Promise<number | undefined> {
    const inspected = await this.#probeRunner.run(
      "docker",
      ["image", "inspect", plan.imageRef, "--format", "{{json .Size}}"],
      this.#options.dataDirectory,
    );
    if (!inspected.success) return undefined;
    try {
      const size: unknown = JSON.parse(inspected.stdout);
      return typeof size === "number" ? size : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Stops then removes owned containers, shared by remove() and update().
   * Named volumes and images are always retained. The caller names the
   * action so the recovery sentence points at the retried operation.
   */
  private async stopAndRemoveOwned(
    plan: ToolRuntimePlan,
    action: "remove" | "update",
  ): Promise<OwnedClearResult> {
    const stopped = await this.stopOwnedNow(plan);
    if (stopped !== undefined) return { failure: stopped };
    const owned = await this.ownedContainers(plan);
    if (owned === undefined) {
      return {
        failure: {
          status: "needs-action",
          code: "engine-unavailable",
          detail: "Owned containers could not be listed; refusing to act blindly.",
          recovery: `Inspect the engine explicitly, then retry the ${action} action.`,
        },
      };
    }
    for (const entry of owned) {
      const removed = await this.#execRunner.run(
        "docker",
        ["rm", entry.id],
        this.#options.dataDirectory,
      );
      if (!removed.success) {
        return {
          failure: {
            status: "needs-action",
            code: "engine-unavailable",
            detail: `Could not remove owned container ${entry.id}: ${removed.stderr}`,
            recovery:
              `Inspect the container explicitly, then retry the ${action} action.`,
          },
        };
      }
    }
    return { removed: owned.length };
  }

  private async stopOwnedNow(
    plan: ToolRuntimePlan,
  ): Promise<NeedsActionOutcome | undefined> {
    const owned = await this.ownedContainers(plan);
    if (owned === undefined) {
      return {
        status: "needs-action",
        code: "engine-unavailable",
        detail: "Owned containers could not be listed; refusing to act blindly.",
        recovery: "Inspect the engine explicitly, then retry.",
      };
    }
    for (const entry of owned.filter((item) => item.state === "running")) {
      const stopped = await this.#execRunner.run(
        "docker",
        ["stop", entry.id],
        this.#options.dataDirectory,
      );
      if (!stopped.success) {
        return {
          status: "needs-action",
          code: "engine-unavailable",
          detail: `Could not stop owned container ${entry.id}: ${stopped.stderr}`,
          recovery: "Inspect the container explicitly, then retry.",
        };
      }
    }
    return undefined;
  }

  private async exclusive<T>(toolId: string, work: () => Promise<T>): Promise<T> {
    const prior = this.#gates.get(toolId) ?? Promise.resolve();
    const pending = prior.catch(() => {}).then(() => work());
    const tracked: Promise<unknown> = pending.catch(() => {});
    this.#gates.set(toolId, tracked);
    try {
      return await pending;
    } finally {
      if (this.#gates.get(toolId) === tracked) this.#gates.delete(toolId);
    }
  }
}
