/** Closed-argv Docker Compose adapter for immutable launch groups. */

import type {
  CapabilityRuntimeJournalEntry,
  CapabilityRuntimeJournalOutcome,
  CapabilityRuntimeMaterialIdentity,
  CapabilityRuntimeObservedState,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import {
  type CapabilityRuntimeLaunchGroup,
  capabilityRuntimeLaunchGroupReference,
  fingerprintCapabilityRuntimeComposeContent,
  sameCapabilityRuntimeLaunchGroupReference,
} from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import type {
  AuthorizedCapabilityRuntimeHostMutation,
  CapabilityRuntimeHostMutator,
  CapabilityRuntimeJournal,
  CapabilityRuntimeLaunchGroupRegistry,
  CapabilityRuntimeSecretSlotObserver,
  CapabilityRuntimeStateObserver,
} from "../../application/ports/out/capability/capability-runtime-supervisor.ts";
import {
  consumeAuthorizedCapabilityRuntimeHostMutation,
} from "../../application/control-plane/capability-runtime-host-authorization.ts";
import {
  type CommandResult,
  type CommandRunner,
  DenoCommandRunner,
  parseComposePs,
} from "../shared/docker-observer.ts";

export interface CapabilityRuntimeHostAdapterOptions {
  readonly registry: CapabilityRuntimeLaunchGroupRegistry;
  readonly journal: CapabilityRuntimeJournal;
  readonly secrets: CapabilityRuntimeSecretSlotObserver;
  readonly runner?: CommandRunner;
  readonly dockerEnvironment?: Readonly<Record<string, string>>;
  readonly composeRoot?: string;
  readonly paths?: { realPath(path: string): Promise<string> };
  readonly clock?: () => string;
}

export type CapabilityRuntimeHostAdapter =
  & CapabilityRuntimeHostMutator
  & CapabilityRuntimeStateObserver;

/**
 * Read-only facade for consumers such as the native Workbench. It deliberately
 * exposes no host-mutation method even though both facades share the same
 * sealed Compose inspection implementation.
 */
export function createCapabilityRuntimeHostObserver(
  options: CapabilityRuntimeHostAdapterOptions,
): CapabilityRuntimeStateObserver {
  const host = new ComposeCapabilityRuntimeHost(options);
  return {
    observe: (materials) => host.observe(materials),
  };
}

export function createCapabilityRuntimeHostAdapter(
  options: CapabilityRuntimeHostAdapterOptions,
): CapabilityRuntimeHostAdapter {
  return new ComposeCapabilityRuntimeHost(options);
}

class ComposeCapabilityRuntimeHost
  implements CapabilityRuntimeHostMutator, CapabilityRuntimeStateObserver {
  readonly #runner: CommandRunner;
  readonly #root: string;
  readonly #paths: { realPath(path: string): Promise<string> };
  readonly #environment: Readonly<Record<string, string>>;
  readonly #clock: () => string;

  constructor(private readonly options: CapabilityRuntimeHostAdapterOptions) {
    // Compose itself waits up to 300 seconds for a sealed service topology.
    // Leave margin for the process boundary and the mandatory fresh inspect.
    this.#runner = options.runner ?? new DenoCommandRunner(360_000);
    this.#root = nonBlank(options.composeRoot ?? Deno.cwd());
    this.#paths = options.paths ?? { realPath: (path) => Deno.realPath(path) };
    this.#environment = dockerEnvironment(options.dockerEnvironment);
    this.#clock = options.clock ?? (() => new Date().toISOString());
  }

  async observe(
    materials: readonly CapabilityRuntimeMaterialIdentity[],
  ): Promise<ReadonlyMap<string, CapabilityRuntimeObservedState>> {
    const groups = await this.options.registry.list();
    const result = new Map<string, CapabilityRuntimeObservedState>();
    for (const group of groups) {
      const requested = group.materials.some((candidate) =>
        materials.some((material) => sameMaterial(material, candidate.material))
      );
      if (!requested) continue;
      const inspection = await this.#inspect(group);
      for (const member of group.materials) {
        if (materials.some((material) => sameMaterial(material, member.material))) {
          result.set(
            materialKey(member.material),
            inspection.states.get(materialKey(member.material))!,
          );
        }
      }
    }
    return result;
  }

  async mutate(input: {
    readonly authorization: AuthorizedCapabilityRuntimeHostMutation;
  }): Promise<CapabilityRuntimeJournalOutcome> {
    const entry = consumeAuthorizedCapabilityRuntimeHostMutation(input.authorization);
    if (!entry) {
      throw new Error(
        "Capability runtime host mutation authorization is absent or consumed.",
      );
    }
    if (!await this.#isUniquePending(entry)) {
      return this.#outcome(
        entry,
        "failed",
        [],
        "Host mutation requires its exact durable group intent.",
      );
    }
    const group = await this.options.registry.require(entry.launchGroup);
    if (
      !sameCapabilityRuntimeLaunchGroupReference(
        capabilityRuntimeLaunchGroupReference(group),
        entry.launchGroup,
      ) || !sameGroupMaterials(group, entry.materials)
    ) {
      return this.#outcome(
        entry,
        "failed",
        [],
        "Launch group identity or exact material membership drifted.",
      );
    }
    if (group.security !== "reviewed" || group.qualification === "revoked") {
      return this.#outcome(
        entry,
        "failed",
        [],
        "Launch group is not operationally admissible.",
      );
    }
    const availability = await this.options.secrets.observe(group.secretSlots);
    if (group.secretSlots.some((slot) => availability.get(slot) !== "available")) {
      return this.#outcome(
        entry,
        "failed",
        [],
        "Launch group secret availability is unknown or unavailable.",
      );
    }
    if (entry.action === "material-remove") {
      return this.#outcome(
        entry,
        "failed",
        [],
        "Launch-group retention forbids material removal.",
      );
    }
    const launch = await this.#launch(group);
    const before = await this.#inspect(group, launch);
    if (before.ownership === "mismatch") {
      return this.#outcome(
        entry,
        "failed",
        before.values,
        "A group container is foreign or has a mismatched image/ownership label.",
      );
    }
    if (before.ownership === "unknown") {
      return this.#outcome(
        entry,
        "uncertain",
        before.values,
        "Group ownership or health could not be observed.",
      );
    }
    const command = commandFor(entry.action, before);
    if (command === null) {
      return this.#outcome(
        entry,
        "failed",
        before.values,
        "Unsupported launch-group action.",
      );
    }
    const execution = entry.action === "runtime-stop"
      ? await this.#stopOwnedReverse(launch, before)
      : await this.#compose(launch, command);
    const after = await this.#inspect(group, launch);
    const satisfied = satisfies(entry.action, after);
    const status = execution.success && satisfied
      ? "succeeded"
      : after.ownership === "mismatch" || after.states.size !== group.materials.length
      ? "failed"
      : "uncertain";
    return this.#outcome(
      entry,
      status,
      after.values,
      status === "succeeded" ? null : compactFailure(execution),
    );
  }

  async #launch(group: CapabilityRuntimeLaunchGroup): Promise<Launch> {
    const root = await this.#paths.realPath(this.#root);
    const fingerprint = await fingerprintCapabilityRuntimeComposeContent(
      group.compose.content,
    );
    if (fingerprint.digest !== group.compose.fingerprint.digest) {
      throw new TypeError(
        "Capability runtime sealed group Compose descriptor fingerprint mismatch.",
      );
    }
    return { group, root, stdin: new TextEncoder().encode(group.compose.content) };
  }

  async #inspect(
    group: CapabilityRuntimeLaunchGroup,
    supplied?: Launch,
  ): Promise<GroupInspection> {
    const launch = supplied ?? await this.#launch(group);
    const [ps, ...images] = await Promise.all([
      this.#compose(launch, ["ps", "--all", "--format", "json"]),
      ...group.materials.map((member) =>
        this.#docker(launch.root, ["image", "inspect", member.imageReference])
      ),
    ]);
    if (!ps.success) return unknownInspection(group);
    let listed: ReturnType<typeof parseComposePs>;
    try {
      listed = parseComposePs(ps.stdout);
    } catch {
      return unknownInspection(group);
    }
    const states = new Map<string, CapabilityRuntimeObservedState>();
    const values: {
      material: CapabilityRuntimeMaterialIdentity;
      state: CapabilityRuntimeObservedState | null;
    }[] = [];
    let ownership: Ownership = "absent";
    const owned: Record<string, string> = {};
    for (const [index, member] of group.materials.entries()) {
      const image = images[index]!;
      const installed =
        image.success && hasExactImage(image.stdout, member.imageReference)
          ? "installed" as const
          : image.success
          ? "failed" as const
          : "absent" as const;
      const containers = listed.filter((container) =>
        container.service === member.serviceName
      );
      let state: CapabilityRuntimeObservedState = {
        material: installed,
        runtime: "inactive",
        qualification: group.qualification,
      };
      if (containers.length === 1 && containers[0]!.id) {
        const inspected = await this.#docker(launch.root, [
          "inspect",
          containers[0]!.id!,
        ]);
        const actual = parseContainer(inspected.stdout);
        if (!inspected.success || !actual) {
          ownership = preferOwnership(ownership, "unknown");
          state = { ...state, runtime: "degraded" };
        } else if (!hasOwnership(member, actual.labels)) {
          ownership = "mismatch";
          state = { ...state, runtime: "degraded" };
        } else {
          const actualImage = await this.#docker(launch.root, [
            "image",
            "inspect",
            actual.image,
          ]);
          if (
            !actualImage.success ||
            !hasExactImage(actualImage.stdout, member.imageReference)
          ) {
            ownership = "mismatch";
            state = { ...state, runtime: "degraded" };
          } else {
            ownership = preferOwnership(ownership, "owned");
            owned[member.serviceName] = actual.id;
            state = {
              material: installed,
              runtime: actual.status === "running" &&
                  (actual.health === "healthy" ||
                    (actual.health === null &&
                      !serviceDeclaresHealthcheck(group, member.serviceName)))
                ? "active"
                : actual.status === "running"
                ? "degraded"
                : "inactive",
              qualification: group.qualification,
            };
          }
        }
      } else if (containers.length > 1) {
        ownership = "mismatch";
        state = { ...state, runtime: "degraded" };
      }
      states.set(materialKey(member.material), state);
      values.push({ material: member.material, state });
    }
    return { ownership, states, values, owned };
  }

  async #stopOwnedReverse(
    launch: Launch,
    inspection: GroupInspection,
  ): Promise<CommandResult> {
    for (const member of [...launch.group.materials].reverse()) {
      const id = inspection.owned[member.serviceName];
      if (!id) continue;
      const result = await this.#docker(launch.root, ["container", "stop", id]);
      if (!result.success) return result;
    }
    return { success: true, code: 0, stdout: "", stderr: "" };
  }

  async #compose(launch: Launch, operation: readonly string[]): Promise<CommandResult> {
    return await this.#runner.run(
      "docker",
      [
        "compose",
        "--env-file",
        "/dev/null",
        "--project-name",
        launch.group.acquisition.projectName,
        "--project-directory",
        launch.root,
        "--file",
        "-",
        ...operation,
      ],
      launch.root,
      { stdin: launch.stdin, clearEnv: true, env: this.#environment },
    );
  }

  async #docker(root: string, args: string[]): Promise<CommandResult> {
    return await this.#runner.run("docker", args, root, {
      clearEnv: true,
      env: this.#environment,
    });
  }

  async #isUniquePending(entry: CapabilityRuntimeJournalEntry): Promise<boolean> {
    const matches = (await this.options.journal.list()).filter((candidate) =>
      candidate.id === entry.id
    );
    return matches.length === 1 &&
      deterministicJson(matches[0]) === deterministicJson(entry) &&
      !(await this.options.journal.listOutcomes()).some((outcome) =>
        outcome.journalEntryId === entry.id
      );
  }

  #outcome(
    entry: CapabilityRuntimeJournalEntry,
    status: CapabilityRuntimeJournalOutcome["status"],
    observations: readonly {
      material: CapabilityRuntimeMaterialIdentity;
      state: CapabilityRuntimeObservedState | null;
    }[],
    detail: string | null,
  ): CapabilityRuntimeJournalOutcome {
    const byMaterial = new Map(
      observations.map((
        observation,
      ) => [materialKey(observation.material), observation]),
    );
    const exactObservations = entry.materials.map((material) =>
      byMaterial.get(materialKey(material)) ?? { material, state: null }
    );
    return {
      schemaVersion: "capability-runtime-host-mutation-outcome/1.0",
      journalEntryId: entry.id,
      recordedAt: this.#clock(),
      status,
      observations: exactObservations,
      detail,
    };
  }
}

function serviceDeclaresHealthcheck(
  group: CapabilityRuntimeLaunchGroup,
  serviceName: string,
): boolean {
  try {
    const descriptor = JSON.parse(group.compose.content) as {
      services?: Record<string, { healthcheck?: unknown }>;
    };
    return descriptor.services?.[serviceName]?.healthcheck !== undefined;
  } catch {
    // The launch-group registry already validates this body before the host
    // can reach it. A defensive true keeps an unexpected malformed body from
    // relaxing the health observation requirement.
    return true;
  }
}

interface Launch {
  readonly group: CapabilityRuntimeLaunchGroup;
  readonly root: string;
  readonly stdin: Uint8Array;
}
type Ownership = "owned" | "absent" | "mismatch" | "unknown";
interface GroupInspection {
  readonly ownership: Ownership;
  readonly states: ReadonlyMap<string, CapabilityRuntimeObservedState>;
  readonly values: readonly {
    readonly material: CapabilityRuntimeMaterialIdentity;
    readonly state: CapabilityRuntimeObservedState | null;
  }[];
  readonly owned: Readonly<Record<string, string>>;
}

function commandFor(
  action: CapabilityRuntimeJournalEntry["action"],
  inspection: GroupInspection,
): readonly string[] | null {
  switch (action) {
    case "material-acquire":
      return ["pull"];
    case "runtime-start":
      if (inspection.ownership !== "absent" && inspection.ownership !== "owned") {
        return null;
      }
      // No --no-deps/remove-orphans and no implicit pull after the durable
      // acquisition intent. Compose may reconcile/recreate an owned container
      // so its exact sealed config, not a stale runtime configuration, wins.
      // `--wait` makes health a real prerequisite.
      return [
        "up",
        "--detach",
        "--wait",
        "--wait-timeout",
        "300",
        "--pull",
        "never",
        "--no-build",
      ];
    case "runtime-stop":
      return [];
    case "material-remove":
      return null;
  }
}

function satisfies(
  action: CapabilityRuntimeJournalEntry["action"],
  inspection: GroupInspection,
): boolean {
  const states = [...inspection.states.values()];
  switch (action) {
    case "material-acquire":
      return states.length > 0 &&
        states.every((state) => state.material === "installed");
    case "runtime-start":
      return inspection.ownership === "owned" && states.length > 0 &&
        states.every((state) =>
          state.material === "installed" && state.runtime === "active" &&
          (state.qualification === "qualified" || state.qualification === "compatible")
        );
    case "runtime-stop":
      return inspection.ownership !== "mismatch" && states.length > 0 &&
        states.every((state) => state.runtime === "inactive");
    case "material-remove":
      return false;
  }
}

function sameGroupMaterials(
  group: CapabilityRuntimeLaunchGroup,
  materials: readonly CapabilityRuntimeMaterialIdentity[],
): boolean {
  return group.materials.length === materials.length &&
    group.materials.every((member, index) =>
      sameMaterial(member.material, materials[index]!)
    );
}

function sameMaterial(
  left: CapabilityRuntimeMaterialIdentity,
  right: CapabilityRuntimeMaterialIdentity,
): boolean {
  return left.unitId === right.unitId && left.materialId === right.materialId &&
    left.imageDigest === right.imageDigest;
}

function materialKey(material: CapabilityRuntimeMaterialIdentity): string {
  return `${material.unitId}\u0000${material.materialId}`;
}

function preferOwnership(current: Ownership, next: Ownership): Ownership {
  const rank: Record<Ownership, number> = {
    absent: 0,
    owned: 1,
    unknown: 2,
    mismatch: 3,
  };
  return rank[next] > rank[current] ? next : current;
}

function unknownInspection(group: CapabilityRuntimeLaunchGroup): GroupInspection {
  const states = new Map(
    group.materials.map((
      member,
    ) => [materialKey(member.material), {
      material: "failed" as const,
      runtime: "degraded" as const,
      qualification: group.qualification,
    }]),
  );
  return {
    ownership: "unknown",
    states,
    values: group.materials.map((member) => ({
      material: member.material,
      state: states.get(materialKey(member.material))!,
    })),
    owned: {},
  };
}

function parseContainer(
  value: string,
): {
  id: string;
  labels: Readonly<Record<string, string>>;
  status: string;
  health: string | null;
  image: string;
} | undefined {
  try {
    const root = Array.isArray(JSON.parse(value))
      ? JSON.parse(value)[0]
      : JSON.parse(value);
    const record = root as Record<string, unknown>;
    const config = record.Config as Record<string, unknown> | undefined;
    const state = record.State as Record<string, unknown> | undefined;
    const labels = config?.Labels;
    if (
      !config || !state || !labels || typeof labels !== "object" ||
      Array.isArray(labels) || typeof record.Id !== "string" ||
      typeof record.Image !== "string" || typeof state.Status !== "string"
    ) return undefined;
    return {
      id: record.Id,
      labels: Object.fromEntries(
        Object.entries(labels as Record<string, unknown>).filter((
          entry,
        ): entry is [string, string] => typeof entry[1] === "string"),
      ),
      status: state.Status,
      health: typeof (state.Health as Record<string, unknown> | undefined)?.Status ===
          "string"
        ? (state.Health as Record<string, string>).Status
        : null,
      image: record.Image,
    };
  } catch {
    return undefined;
  }
}

function hasExactImage(value: string, reference: string): boolean {
  try {
    const root = Array.isArray(JSON.parse(value))
      ? JSON.parse(value)[0]
      : JSON.parse(value);
    return Array.isArray((root as Record<string, unknown>).RepoDigests) &&
      ((root as Record<string, unknown>).RepoDigests as unknown[]).includes(reference);
  } catch {
    return false;
  }
}

function hasOwnership(
  member: CapabilityRuntimeLaunchGroup["materials"][number],
  labels: Readonly<Record<string, string>>,
): boolean {
  return member.ownership.every((label) => labels[label.key] === label.value);
}
function compactFailure(result: CommandResult): string {
  const text = result.stderr.trim() || `docker exited ${result.code}`;
  return text.length > 512 ? `${text.slice(0, 509)}...` : text;
}
function nonBlank(value: string): string {
  if (!value.trim()) {
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
    if (!allowed.has(key) || !value) {
      throw new TypeError("Capability runtime Docker environment is not allowlisted.");
    }
    result[key] = value;
  }
  return Object.freeze(result);
}
