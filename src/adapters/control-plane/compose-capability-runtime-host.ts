/**
 * Closed-argv Docker Compose host adapter for registered launch profiles.
 *
 * The executed Compose descriptor is the exact sealed UTF-8 content from the
 * immutable profile and is passed through stdin as `--file -`: no mutable
 * source YAML is opened between observation and launch.  Only the factory is
 * exported.  Its mutator refuses a non-durable journal intent or unavailable
 * secret slot before it can invoke Docker.
 */

import type {
  CapabilityRuntimeJournalEntry,
  CapabilityRuntimeJournalOutcome,
  CapabilityRuntimeMaterialIdentity,
  CapabilityRuntimeObservedState,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import {
  type CapabilityRuntimeLaunchProfile,
  capabilityRuntimeLaunchProfileMaterialMatches,
  fingerprintCapabilityRuntimeComposeContent,
  validateCapabilityRuntimeLaunchProfile,
} from "../../domain/capability/runtime/capability-runtime-host.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import type {
  AuthorizedCapabilityRuntimeHostMutation,
  CapabilityRuntimeHostMutationLock,
  CapabilityRuntimeHostMutator,
  CapabilityRuntimeJournal,
  CapabilityRuntimeLaunchProfileRegistry,
  CapabilityRuntimeSecretSlotObserver,
  CapabilityRuntimeStateObserver,
} from "../../application/ports/out/capability/capability-runtime-supervisor.ts";
import { consumeAuthorizedCapabilityRuntimeHostMutation } from "../../application/control-plane/capability-runtime-host-authorization.ts";
import {
  type CommandResult,
  type CommandRunner,
  DenoCommandRunner,
  parseComposePs,
} from "../shared/docker-observer.ts";

export interface CapabilityRuntimeHostAdapterOptions {
  readonly registry: CapabilityRuntimeLaunchProfileRegistry;
  readonly journal: CapabilityRuntimeJournal;
  readonly secrets: CapabilityRuntimeSecretSlotObserver;
  /** Serializes the final inspect-to-command interval across host processes. */
  readonly mutationLock: CapabilityRuntimeHostMutationLock;
  readonly runner?: CommandRunner;
  /** Trusted Docker connection settings; no Compose interpolation value is accepted. */
  readonly dockerEnvironment?: Readonly<Record<string, string>>;
  /** Canonical process root; no profile-owned YAML path is ever read from it. */
  readonly composeRoot?: string;
  /** Testable root canonicalization boundary. */
  readonly paths?: CapabilityRuntimeHostPathResolver;
  /** Used only to timestamp an outcome after an observation/command completes. */
  readonly clock?: () => string;
}

export interface CapabilityRuntimeHostPathResolver {
  realPath(path: string): Promise<string>;
}

export type CapabilityRuntimeHostAdapter =
  & CapabilityRuntimeHostMutator
  & CapabilityRuntimeStateObserver;

/**
 * The raw Docker implementation is intentionally not exported.  The returned
 * mutation surface validates a durable intent and secret availability itself;
 * callers cannot obtain a Docker-capable host with only a profile and runner.
 */
export function createCapabilityRuntimeHostAdapter(
  options: CapabilityRuntimeHostAdapterOptions,
): CapabilityRuntimeHostAdapter {
  return new ComposeCapabilityRuntimeHost(options);
}

class ComposeCapabilityRuntimeHost
  implements CapabilityRuntimeHostMutator, CapabilityRuntimeStateObserver {
  readonly #registry: CapabilityRuntimeLaunchProfileRegistry;
  readonly #journal: CapabilityRuntimeJournal;
  readonly #secrets: CapabilityRuntimeSecretSlotObserver;
  readonly #mutationLock: CapabilityRuntimeHostMutationLock;
  readonly #runner: CommandRunner;
  readonly #composeRoot: string;
  readonly #paths: CapabilityRuntimeHostPathResolver;
  readonly #clock: () => string;
  readonly #dockerEnvironment: Readonly<Record<string, string>>;

  constructor(options: CapabilityRuntimeHostAdapterOptions) {
    this.#registry = options.registry;
    this.#journal = options.journal;
    this.#secrets = options.secrets;
    this.#mutationLock = options.mutationLock;
    this.#runner = options.runner ?? new DenoCommandRunner();
    this.#composeRoot = nonBlank(options.composeRoot ?? Deno.cwd());
    this.#paths = options.paths ?? { realPath: (path) => Deno.realPath(path) };
    this.#clock = options.clock ?? (() => new Date().toISOString());
    this.#dockerEnvironment = dockerEnvironment(options.dockerEnvironment);
  }

  async observe(
    materials: readonly CapabilityRuntimeMaterialIdentity[],
  ): Promise<ReadonlyMap<string, CapabilityRuntimeObservedState>> {
    const profiles = await Promise.all(
      (await this.#registry.list()).map((profile) =>
        validateCapabilityRuntimeLaunchProfile(profile)
      ),
    );
    const states = new Map<string, CapabilityRuntimeObservedState>();
    for (const material of materials) {
      const matches = profiles.filter((profile) =>
        capabilityRuntimeLaunchProfileMaterialMatches(profile, material)
      );
      if (matches.length !== 1) continue;
      const launch = await this.#resolveLaunch(matches[0]!);
      states.set(materialKey(material), (await this.#inspect(launch)).state);
    }
    return states;
  }

  async mutate(input: {
    readonly authorization: AuthorizedCapabilityRuntimeHostMutation;
  }): Promise<CapabilityRuntimeJournalOutcome> {
    return await this.#mutationLock.withLock(async () => {
      const entry = consumeAuthorizedCapabilityRuntimeHostMutation(input.authorization);
      if (!entry) {
        throw new Error(
          "Capability runtime host mutation authorization is absent or consumed.",
        );
      }
      return await this.#mutate(entry);
    });
  }

  async #mutate(
    entry: CapabilityRuntimeJournalEntry,
  ): Promise<CapabilityRuntimeJournalOutcome> {
    if (!await this.#hasUniquePendingIntent(entry)) {
      return this.#outcome(
        entry,
        "failed",
        null,
        "Host mutation requires its exact durable journal intent.",
      );
    }
    const profile = await validateCapabilityRuntimeLaunchProfile(
      await this.#registry.require(entry.launchProfile),
    );
    if (!capabilityRuntimeLaunchProfileMaterialMatches(profile, entry.material)) {
      return this.#outcome(
        entry,
        "failed",
        null,
        "Profile material identity mismatch.",
      );
    }
    if (profile.security !== "reviewed") {
      return this.#outcome(entry, "failed", null, "Profile security is unknown.");
    }
    if (profile.qualification === "revoked") {
      return this.#outcome(entry, "failed", null, "Profile qualification is revoked.");
    }
    if (!await this.#hasAvailableSecrets(profile)) {
      return this.#outcome(
        entry,
        "failed",
        null,
        "Profile secret availability is unknown or unavailable.",
      );
    }
    if (profile.activationPolicy === "cache-only" && entry.action === "runtime-start") {
      return this.#outcome(
        entry,
        "failed",
        null,
        "A cache-only profile must never be activated.",
      );
    }
    if (entry.action === "material-remove") {
      return this.#outcome(
        entry,
        "failed",
        null,
        "Host profile retention forbids material removal.",
      );
    }

    const launch = await this.#resolveLaunch(profile);
    // This observation and any following command share mutationLock. A
    // service replacement cannot change the ID which `container stop` targets.
    const before = await this.#inspect(launch);
    if (entry.action === "runtime-start") {
      if (before.ownership === "owned" && before.state.runtime === "active") {
        return this.#outcomeForInspection(entry, before, "succeeded", null);
      }
      if (
        before.ownership !== "absent" &&
        !(before.ownership === "owned" && before.state.runtime === "inactive")
      ) {
        return this.#outcomeForInspection(
          entry,
          before,
          before.ownership === "mismatch" ? "failed" : "uncertain",
          "Container ownership was not proved for a JIT start.",
        );
      }
    }
    if (entry.action === "runtime-stop") {
      if (before.ownership === "absent") {
        return this.#outcomeForInspection(entry, before, "succeeded", null);
      }
      if (before.ownership !== "owned" || !before.containerId) {
        return this.#outcomeForInspection(
          entry,
          before,
          before.ownership === "mismatch" ? "failed" : "uncertain",
          "Container ownership and exact identifier were not proved before stop.",
        );
      }
    }

    const result = entry.action === "runtime-stop"
      ? await this.#runDocker(launch.root, ["container", "stop", before.containerId!])
      : await this.#runCompose(launch, commandFor(launch, entry.action));
    const after = await this.#inspect(launch);
    if (result.success && satisfiesIntent(entry.action, after)) {
      return this.#outcomeForInspection(entry, after, "succeeded", null);
    }
    if (result.success) {
      const status = after.ownership === "mismatch" || after.state.material === "failed"
        ? "failed"
        : "uncertain";
      return this.#outcomeForInspection(
        entry,
        after,
        status,
        "Docker exited successfully but fresh host observation did not satisfy the intended state.",
      );
    }
    const status = entry.action === "material-acquire" ? "failed" : "uncertain";
    return this.#outcomeForInspection(entry, after, status, compactFailure(result));
  }

  async #inspect(launch: ResolvedComposeLaunch): Promise<Inspection> {
    const { profile } = launch;
    const [image, ps] = await Promise.all([
      this.#runDocker(launch.root, [
        "image",
        "inspect",
        profile.acquisition.imageReference,
      ]),
      this.#runCompose(launch, [
        "ps",
        "--all",
        "--format",
        "json",
        profile.acquisition.serviceName,
      ]),
    ]);
    const material = image.success && hasExactImageReference(image.stdout, profile)
      ? "installed" as const
      : image.success
      ? "failed" as const
      : "absent" as const;
    if (!ps.success) return inspection("unknown", material, "degraded", profile);
    let containers: ReturnType<typeof parseComposePs>;
    try {
      containers = parseComposePs(ps.stdout).filter((container) =>
        container.service === profile.acquisition.serviceName
      );
    } catch {
      return inspection("unknown", material, "degraded", profile);
    }
    if (containers.length === 0) {
      return inspection("absent", material, "inactive", profile);
    }
    if (containers.length !== 1 || !containers[0]!.id) {
      return inspection("mismatch", material, "degraded", profile);
    }
    const inspected = await this.#runDocker(launch.root, [
      "inspect",
      containers[0]!.id!,
    ]);
    if (!inspected.success) return inspection("unknown", material, "degraded", profile);
    const container = parseDockerInspect(inspected.stdout);
    if (
      !container || container.id !== containers[0]!.id ||
      !hasExactOwnership(profile, container.labels)
    ) {
      return inspection("mismatch", material, "degraded", profile);
    }
    const actualImage = await this.#runDocker(launch.root, [
      "image",
      "inspect",
      container.image,
    ]);
    if (!actualImage.success || !hasExactImageReference(actualImage.stdout, profile)) {
      return inspection("mismatch", material, "degraded", profile);
    }
    return inspection(
      "owned",
      material,
      container.status === "running" ? "active" : "inactive",
      profile,
      container.id,
    );
  }

  async #resolveLaunch(
    profile: CapabilityRuntimeLaunchProfile,
  ): Promise<ResolvedComposeLaunch> {
    const root = await this.#paths.realPath(this.#composeRoot);
    const expected = await fingerprintCapabilityRuntimeComposeContent(
      profile.compose.content,
    );
    if (
      expected.algorithm !== profile.compose.fingerprint.algorithm ||
      expected.digest !== profile.compose.fingerprint.digest
    ) {
      throw new TypeError(
        "Capability runtime sealed Compose descriptor fingerprint mismatch.",
      );
    }
    return {
      profile,
      root,
      stdin: new TextEncoder().encode(profile.compose.content),
    };
  }

  async #runCompose(
    launch: ResolvedComposeLaunch,
    operation: readonly string[],
  ): Promise<CommandResult> {
    return await this.#runner.run(
      "docker",
      composeArgs(launch, operation),
      launch.root,
      {
        stdin: launch.stdin,
        clearEnv: true,
        env: this.#dockerEnvironment,
      },
    );
  }

  async #runDocker(root: string, args: string[]): Promise<CommandResult> {
    return await this.#runner.run("docker", args, root, {
      clearEnv: true,
      env: this.#dockerEnvironment,
    });
  }

  async #hasUniquePendingIntent(
    entry: CapabilityRuntimeJournalEntry,
  ): Promise<boolean> {
    const matches = (await this.#journal.list()).filter((candidate) =>
      candidate.id === entry.id
    );
    return matches.length === 1 &&
      deterministicJson(matches[0]) === deterministicJson(entry) &&
      !(await this.#journal.listOutcomes()).some((outcome) =>
        outcome.journalEntryId === entry.id
      );
  }

  async #hasAvailableSecrets(
    profile: CapabilityRuntimeLaunchProfile,
  ): Promise<boolean> {
    const availability = await this.#secrets.observe(profile.secretSlots);
    return profile.secretSlots.every((slot) => availability.get(slot) === "available");
  }

  #outcome(
    entry: CapabilityRuntimeJournalEntry,
    status: CapabilityRuntimeJournalOutcome["status"],
    observation: CapabilityRuntimeObservedState | null,
    detail: string | null,
  ): CapabilityRuntimeJournalOutcome {
    return {
      schemaVersion: "capability-runtime-host-mutation-outcome/1.0",
      journalEntryId: entry.id,
      recordedAt: this.#clock(),
      status,
      observation,
      detail,
    };
  }

  #outcomeForInspection(
    entry: CapabilityRuntimeJournalEntry,
    observed: Inspection,
    status: CapabilityRuntimeJournalOutcome["status"],
    detail: string | null,
  ): CapabilityRuntimeJournalOutcome {
    return this.#outcome(entry, status, observed.state, detail);
  }
}

type Ownership = "owned" | "absent" | "mismatch" | "unknown";

interface Inspection {
  readonly ownership: Ownership;
  readonly containerId: string | null;
  readonly state: CapabilityRuntimeObservedState;
}

interface ResolvedComposeLaunch {
  readonly profile: CapabilityRuntimeLaunchProfile;
  readonly root: string;
  readonly stdin: Uint8Array;
}

function inspection(
  ownership: Ownership,
  material: CapabilityRuntimeObservedState["material"],
  runtime: CapabilityRuntimeObservedState["runtime"],
  profile: CapabilityRuntimeLaunchProfile,
  containerId: string | null = null,
): Inspection {
  return {
    ownership,
    containerId,
    state: { material, runtime, qualification: profile.qualification },
  };
}

function commandFor(
  launch: ResolvedComposeLaunch,
  action: Exclude<
    CapabilityRuntimeJournalEntry["action"],
    "runtime-stop" | "material-remove"
  >,
): string[] {
  switch (action) {
    case "material-acquire":
      return ["pull", launch.profile.acquisition.serviceName];
    case "runtime-start":
      return [
        "up",
        "--detach",
        "--no-deps",
        "--no-build",
        "--no-recreate",
        launch.profile.acquisition.serviceName,
      ];
  }
}

function composeArgs(
  launch: ResolvedComposeLaunch,
  operation: readonly string[],
): string[] {
  return [
    "compose",
    "--env-file",
    "/dev/null",
    "--project-name",
    launch.profile.acquisition.projectName,
    "--project-directory",
    launch.root,
    "--file",
    "-",
    ...operation,
  ];
}

function parseDockerInspect(
  value: string,
):
  | {
    readonly id: string;
    readonly labels: Readonly<Record<string, string>>;
    readonly status: string;
    readonly image: string;
  }
  | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!first || typeof first !== "object" || Array.isArray(first)) return undefined;
    const record = first as Record<string, unknown>;
    const config = record.Config;
    const state = record.State;
    const id = record.Id;
    const image = record.Image;
    if (
      !config || typeof config !== "object" || Array.isArray(config) ||
      !state || typeof state !== "object" || Array.isArray(state) ||
      typeof id !== "string" || id.length === 0 ||
      typeof image !== "string" || image.length === 0
    ) return undefined;
    const labelsValue = (config as Record<string, unknown>).Labels;
    const status = (state as Record<string, unknown>).Status;
    if (
      !labelsValue || typeof labelsValue !== "object" || Array.isArray(labelsValue) ||
      typeof status !== "string"
    ) return undefined;
    const labels = Object.fromEntries(
      Object.entries(labelsValue as Record<string, unknown>).flatMap((
        [key, candidate],
      ) => typeof candidate === "string" ? [[key, candidate]] : []),
    );
    return { id, labels, status, image };
  } catch {
    return undefined;
  }
}

function hasExactImageReference(
  value: string,
  profile: CapabilityRuntimeLaunchProfile,
): boolean {
  try {
    const parsed: unknown = JSON.parse(value);
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!first || typeof first !== "object" || Array.isArray(first)) return false;
    const repoDigests = (first as Record<string, unknown>).RepoDigests;
    return Array.isArray(repoDigests) &&
      repoDigests.some((candidate) => candidate === profile.acquisition.imageReference);
  } catch {
    return false;
  }
}

function satisfiesIntent(
  action: CapabilityRuntimeJournalEntry["action"],
  observed: Inspection,
): boolean {
  switch (action) {
    case "material-acquire":
      return observed.state.material === "installed";
    case "runtime-start":
      return observed.ownership === "owned" &&
        observed.state.material === "installed" &&
        observed.state.runtime === "active";
    case "runtime-stop":
      return observed.ownership === "absent" ||
        (observed.ownership === "owned" && observed.state.runtime === "inactive");
    case "material-remove":
      return false;
  }
}

function hasExactOwnership(
  profile: CapabilityRuntimeLaunchProfile,
  labels: Readonly<Record<string, string>>,
): boolean {
  return profile.ownership.labels.every((label) => labels[label.key] === label.value);
}

function compactFailure(result: CommandResult): string {
  const detail =
    result.stderr.trim().split(/\r?\n/).find((line) => line.trim() !== "") ??
      `docker command exited ${result.code}`;
  return detail.length > 512 ? `${detail.slice(0, 509)}...` : detail;
}

function materialKey(material: CapabilityRuntimeMaterialIdentity): string {
  return `${material.unitId}\u0000${material.materialId}`;
}

function nonBlank(value: string): string {
  if (value.trim().length === 0) {
    throw new TypeError("Capability runtime Compose root must not be blank.");
  }
  return value;
}

function dockerEnvironment(
  supplied: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  const allowed = new Set([
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "DOCKER_TLS_VERIFY",
    "DOCKER_CERT_PATH",
    "DOCKER_CONFIG",
  ]);
  const result: Record<string, string> = { COMPOSE_DISABLE_ENV_FILE: "1" };
  for (const [key, value] of Object.entries(supplied ?? {})) {
    if (!allowed.has(key) || typeof value !== "string" || value.length === 0) {
      throw new TypeError("Capability runtime Docker environment is not allowlisted.");
    }
    result[key] = value;
  }
  return Object.freeze(result);
}
