/** Closed-argv Docker Compose adapter for immutable launch groups. */

import type {
  CapabilityRuntimeAdministrativeRemovalObservation,
  CapabilityRuntimeAdministrativeRemovalPlan,
  CapabilityRuntimeJournalEntry,
  CapabilityRuntimeJournalOutcome,
  CapabilityRuntimeObservedState,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import type {
  CapabilityRuntimeMaterialIdentity,
  CapabilityRuntimePlatform,
} from "../../domain/capability/runtime/capability-runtime-material.ts";
import {
  validateCapabilityRuntimeAdministrativeRemovalPlan,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import {
  type CapabilityRuntimeLaunchGroup,
  capabilityRuntimeLaunchGroupPublishedLoopbackHostPorts,
  type CapabilityRuntimeLaunchGroupReference,
  capabilityRuntimeLaunchGroupReference,
  fingerprintCapabilityRuntimeComposeContent,
  sameCapabilityRuntimeLaunchGroupReference,
} from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import type {
  AuthorizedCapabilityRuntimeHostMutation,
  CapabilityRuntimeAdministrativeRemovalInspector,
  CapabilityRuntimeHostMutator,
  CapabilityRuntimeHostPlatformObserver,
  CapabilityRuntimeJournal,
  CapabilityRuntimeLaunchGroupRegistry,
  CapabilityRuntimeLaunchSecretInjector,
  CapabilityRuntimeSecretSlotObserver,
  CapabilityRuntimeSecretSnapshot,
  CapabilityRuntimeStateObserver,
} from "../../application/ports/out/capability/capability-runtime-supervisor.ts";
import {
  consumeAuthorizedAdministrativeMaterialRemoval,
  consumeAuthorizedMaterialAcquire,
  consumeAuthorizedNormalRuntimeStart,
  consumeAuthorizedQualificationRuntimeStart,
  consumeAuthorizedRuntimeStop,
} from "../../application/control-plane/capability-runtime-host-authorization.ts";
import {
  type CommandResult,
  type CommandRunner,
  DenoCommandRunner,
  parseComposePs,
} from "../shared/docker-observer.ts";
import {
  dockerInspectReportsImageAbsent,
  samePinnedRepositoryDigest,
} from "../shared/docker-pinned-repository-digest.ts";
import {
  StatelessMcpHttpTransport,
} from "../shared/mcp/stateless-mcp-http-transport.ts";

export interface CapabilityRuntimeHostAdapterOptions {
  readonly registry: CapabilityRuntimeLaunchGroupRegistry;
  readonly journal: CapabilityRuntimeJournal;
  readonly secrets: CapabilityRuntimeSecretSlotObserver;
  /** Closed, in-memory overlay for an exact server-minted secret snapshot. */
  readonly secretInjector?: CapabilityRuntimeLaunchSecretInjector;
  readonly runner?: CommandRunner;
  readonly dockerEnvironment?: Readonly<Record<string, string>>;
  readonly composeRoot?: string;
  readonly paths?: { realPath(path: string): Promise<string> };
  readonly clock?: () => string;
  /**
   * Concrete host-local readiness probe for sealed MCP publications. It is
   * intentionally adapter-owned: application bindings and fleet manifests do
   * not name a provider endpoint or readiness implementation.
   */
  readonly readinessProbe?: CapabilityRuntimeLaunchReadinessProbe;
  /** Testable transport seam for the concrete read-only MCP readiness probe. */
  readonly readinessFetch?: typeof fetch;
  /** Injectable monotonic clock and delay keep bounded readiness testable. */
  readonly monotonicNow?: () => number;
  readonly wait?: (milliseconds: number) => Promise<void>;
}

/** A readiness probe may only perform the sealed group’s read-only MCP check. */
export interface CapabilityRuntimeLaunchReadinessProbe {
  probe(input: {
    readonly mcpUrl: string;
    readonly timeoutMs: number;
  }): Promise<void>;
}

export type CapabilityRuntimeHostAdapter =
  & CapabilityRuntimeHostMutator
  & CapabilityRuntimeStateObserver
  & CapabilityRuntimeAdministrativeRemovalInspector
  & CapabilityRuntimeHostPlatformObserver;

/**
 * Read-only facade for consumers such as the native Workbench. It deliberately
 * exposes no host-mutation method even though both facades share the same
 * sealed Compose inspection implementation.
 */
export function createCapabilityRuntimeHostObserver(
  options: CapabilityRuntimeHostAdapterOptions,
): CapabilityRuntimeStateObserver & CapabilityRuntimeHostPlatformObserver {
  const host = new ComposeCapabilityRuntimeHost(options);
  return {
    observe: (materials) => host.observe(materials),
    observePlatform: () => host.observePlatform(),
  };
}

export function createCapabilityRuntimeHostAdapter(
  options: CapabilityRuntimeHostAdapterOptions,
): CapabilityRuntimeHostAdapter {
  return new ComposeCapabilityRuntimeHost(options);
}

class ComposeCapabilityRuntimeHost
  implements
    CapabilityRuntimeHostMutator,
    CapabilityRuntimeStateObserver,
    CapabilityRuntimeAdministrativeRemovalInspector,
    CapabilityRuntimeHostPlatformObserver {
  readonly #runner: CommandRunner;
  readonly #root: string;
  readonly #paths: { realPath(path: string): Promise<string> };
  readonly #environment: Readonly<Record<string, string>>;
  readonly #clock: () => string;
  readonly #readinessProbe: CapabilityRuntimeLaunchReadinessProbe;
  readonly #monotonicNow: () => number;
  readonly #wait: (milliseconds: number) => Promise<void>;

  constructor(private readonly options: CapabilityRuntimeHostAdapterOptions) {
    // Compose itself waits up to 300 seconds for a sealed service topology.
    // Leave margin for the process boundary and the mandatory fresh inspect.
    this.#runner = options.runner ?? new DenoCommandRunner(360_000);
    // Production `start`/`start:yolo` grants `--allow-read=config,state,...`,
    // not the worktree absolute path. A relative compose root must stay
    // lexical (`.`) so observe/proposal never `realPath`s `/Volumes/...`.
    this.#root = nonBlank(options.composeRoot ?? ".");
    this.#paths = options.paths ?? { realPath: (path) => Deno.realPath(path) };
    this.#environment = dockerEnvironment(options.dockerEnvironment);
    this.#clock = options.clock ?? (() => new Date().toISOString());
    this.#readinessProbe = options.readinessProbe ?? {
      probe: (input) => probeReadOnlyMcpTools(input, options.readinessFetch),
    };
    this.#monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.#wait = options.wait ?? delay;
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

  async inspectAdministrativeRemoval(input: {
    readonly launchGroup: CapabilityRuntimeLaunchGroupReference;
  }): Promise<CapabilityRuntimeAdministrativeRemovalObservation> {
    const group = await this.options.registry.require(input.launchGroup);
    if (
      !sameCapabilityRuntimeLaunchGroupReference(
        capabilityRuntimeLaunchGroupReference(group),
        input.launchGroup,
      )
    ) {
      throw new TypeError("Capability runtime removal group identity drifted.");
    }
    const launch = await this.#launch(group);
    return await this.#inspectRemoval(group, launch);
  }

  /**
   * Docker itself is the runtime authority. The controller process architecture
   * must never be used as a substitute for this observation.
   */
  async observePlatform(): Promise<CapabilityRuntimePlatform> {
    const result = await this.#docker(this.#root, [
      "version",
      "--format",
      "{{.Server.Os}}/{{.Server.Arch}}",
    ]);
    if (!result.success) {
      throw new Error(
        "Capability runtime host platform is unavailable from the Docker daemon.",
      );
    }
    return parseDockerDaemonPlatform(result.stdout);
  }

  async mutate(input: {
    readonly authorization: AuthorizedCapabilityRuntimeHostMutation;
    readonly removalPlan?: CapabilityRuntimeAdministrativeRemovalPlan;
    readonly secretSnapshot?: CapabilityRuntimeSecretSnapshot;
  }): Promise<CapabilityRuntimeJournalOutcome> {
    const entry = input.authorization.entry.action === "material-acquire"
      ? consumeAuthorizedMaterialAcquire(input.authorization)
      : input.authorization.entry.action === "runtime-start"
      ? consumeAuthorizedNormalRuntimeStart(input.authorization)
      : input.authorization.entry.action === "runtime-qualification-start"
      ? consumeAuthorizedQualificationRuntimeStart(input.authorization)
      : input.authorization.entry.action === "runtime-stop"
      ? consumeAuthorizedRuntimeStop(input.authorization)
      : input.authorization.entry.action === "material-remove"
      ? consumeAuthorizedAdministrativeMaterialRemoval(input.authorization)
      : undefined;
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
    if (entry.action === "material-remove") {
      return await this.#remove(entry, input.removalPlan);
    }
    // A stop is deliberately a recovery action.  Once a group is owned, later
    // policy, qualification, or secret degradation must not strand it running.
    if (entry.action !== "runtime-stop" && group.security !== "reviewed") {
      return this.#outcome(
        entry,
        "failed",
        [],
        "Launch group topology is not reviewed.",
      );
    }
    if (
      isRuntimeStartAction(entry.action) &&
      await this.#missingStartSecret(group, input.secretSnapshot)
    ) {
      return this.#outcome(
        entry,
        "failed",
        [],
        "Launch group requires its exact server-minted secret snapshot.",
      );
    }
    const launch = await this.#launch(group);
    const before = await this.#inspect(group, launch, {
      ignorePendingReadiness: true,
    });
    if (before.ownership === "mismatch") {
      return this.#outcome(
        entry,
        "failed",
        before.values,
        "A group container is foreign or has a mismatched image, ownership label, or sealed mount topology.",
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
      : await this.#compose(
        launch,
        command,
        isRuntimeStartAction(entry.action) ? input.secretSnapshot : undefined,
      );
    const readinessReady = !isRuntimeStartAction(entry.action) ||
      (execution.success && await this.#awaitReadiness(launch));
    const after = await this.#inspect(group, launch, {
      ignorePendingReadiness: true,
    });
    const satisfied = readinessReady && satisfies(entry.action, after);
    const readinessTimedOut = isRuntimeStartAction(entry.action) &&
      execution.success && !readinessReady;
    const status = execution.success && satisfied
      ? "succeeded"
      : after.ownership === "mismatch" || after.states.size !== group.materials.length
      ? "failed"
      : readinessTimedOut
      ? "failed"
      : "uncertain";
    return this.#outcome(
      entry,
      status,
      after.values,
      status === "succeeded"
        ? null
        // Docker may echo parts of a dynamic Compose input in an error. A
        // secret-bearing `up` therefore records only a fixed diagnosis, never
        // provider stderr, argv or an overlay fragment.
        : readinessTimedOut
        ? "Sealed launch-group MCP readiness did not complete before its declared deadline."
        : isRuntimeStartAction(entry.action) && group.secretSlots.length > 0
        ? "Sealed secret-bearing launch group did not reach its required active state."
        : compactFailure(execution),
    );
  }

  async #remove(
    entry: CapabilityRuntimeJournalEntry,
    planValue: CapabilityRuntimeAdministrativeRemovalPlan | undefined,
  ): Promise<CapabilityRuntimeJournalOutcome> {
    if (!planValue || entry.administrativeRemovalPlanFingerprint === null) {
      return this.#outcome(
        entry,
        "failed",
        [],
        "Administrative material removal requires one exact reviewed plan.",
      );
    }
    let plan: CapabilityRuntimeAdministrativeRemovalPlan;
    try {
      plan = await validateCapabilityRuntimeAdministrativeRemovalPlan(planValue);
    } catch (error) {
      return this.#outcome(entry, "failed", [], compact(error));
    }
    if (
      plan.fingerprint.algorithm !==
        entry.administrativeRemovalPlanFingerprint.algorithm ||
      plan.fingerprint.digest !== entry.administrativeRemovalPlanFingerprint.digest ||
      !sameCapabilityRuntimeLaunchGroupReference(plan.launchGroup, entry.launchGroup)
    ) {
      return this.#outcome(
        entry,
        "failed",
        [],
        "Administrative removal plan does not attest this exact journal intent.",
      );
    }
    const group = await this.options.registry.require(entry.launchGroup);
    if (!sameGroupMaterials(group, plan.ownedMaterials)) {
      return this.#outcome(
        entry,
        "failed",
        [],
        "Administrative removal plan does not cover the complete exact launch group.",
      );
    }
    if (await this.#sharedDigestOutsideGroup(group)) {
      return this.#outcome(
        entry,
        "failed",
        [],
        "An exact removal image digest is retained by another catalogue launch group.",
      );
    }
    const launch = await this.#launch(group);
    const before = await this.#inspectRemoval(group, launch);
    if (before.safety !== "exact") {
      return this.#outcome(
        entry,
        before.safety === "unknown" ? "uncertain" : "failed",
        removalObservationValues(before),
        before.safety === "unknown"
          ? "Administrative removal ownership cannot be observed exactly."
          : "Administrative removal found a foreign container or image reference.",
      );
    }
    if (!matchesRemovalPlan(plan, before)) {
      return this.#outcome(
        entry,
        "failed",
        removalObservationValues(before),
        "Administrative removal review drifted before host mutation.",
      );
    }
    const stop = await this.#stopOwnedRemovalContainers(launch, before);
    if (!stop.success) {
      const afterStop = await this.#inspectRemoval(group, launch);
      return this.#outcome(
        entry,
        afterStop.safety === "foreign" ? "failed" : "uncertain",
        removalObservationValues(afterStop),
        compactFailure(stop),
      );
    }
    const removeContainers = await this.#removeOwnedContainers(launch, before);
    if (!removeContainers.success) {
      const afterContainers = await this.#inspectRemoval(group, launch);
      return this.#outcome(
        entry,
        afterContainers.safety === "foreign" ? "failed" : "uncertain",
        removalObservationValues(afterContainers),
        compactFailure(removeContainers),
      );
    }
    const beforeImages = await this.#inspectRemoval(group, launch);
    if (
      beforeImages.safety !== "exact" || beforeImages.ownedContainerIds.length !== 0
    ) {
      return this.#outcome(
        entry,
        beforeImages.safety === "foreign" ? "failed" : "uncertain",
        removalObservationValues(beforeImages),
        "Administrative removal cannot prove that exact owned containers are gone.",
      );
    }
    const removeImages = await this.#removeExactImages(launch, group, beforeImages);
    if (!removeImages.success) {
      const afterImages = await this.#inspectRemoval(group, launch);
      return this.#outcome(
        entry,
        afterImages.safety === "foreign" ? "failed" : "uncertain",
        removalObservationValues(afterImages),
        compactFailure(removeImages),
      );
    }
    const after = await this.#inspectRemoval(group, launch);
    const absent = after.safety === "exact" && after.ownedContainerIds.length === 0 &&
      after.materials.every((material) => material.state === "absent");
    return this.#outcome(
      entry,
      absent ? "succeeded" : after.safety === "foreign" ? "failed" : "uncertain",
      removalObservationValues(after),
      absent ? null : "Administrative removal did not yield an exact absent group.",
    );
  }

  async #missingStartSecret(
    group: CapabilityRuntimeLaunchGroup,
    snapshot: CapabilityRuntimeSecretSnapshot | undefined,
  ): Promise<boolean> {
    const availability = await this.options.secrets.observe(group.secretSlots);
    return group.secretSlots.some((slot) => availability.get(slot) !== "available") ||
      (group.secretSlots.length > 0 &&
        (snapshot === undefined || this.options.secretInjector === undefined));
  }

  async #inspectRemoval(
    group: CapabilityRuntimeLaunchGroup,
    launch: Launch,
  ): Promise<CapabilityRuntimeAdministrativeRemovalObservation> {
    const ps = await this.#compose(launch, ["ps", "--all", "--format", "json"]);
    if (!ps.success) return unknownRemovalObservation(group);
    let listed: ReturnType<typeof parseComposePs>;
    try {
      listed = parseComposePs(ps.stdout);
    } catch {
      return unknownRemovalObservation(group);
    }
    const materials: {
      material: CapabilityRuntimeMaterialIdentity;
      state: "owned" | "absent";
    }[] = [];
    const ownedContainerIds: {
      material: CapabilityRuntimeMaterialIdentity;
      containerId: string;
    }[] = [];
    let safety: CapabilityRuntimeAdministrativeRemovalObservation["safety"] = "exact";
    for (const member of group.materials) {
      const image = await this.#docker(launch.root, [
        "image",
        "inspect",
        member.imageReference,
      ]);
      const imageState = exactImageState(image, member.imageReference);
      if (imageState === "unknown") safety = preferRemovalSafety(safety, "unknown");
      if (imageState === "foreign") safety = "foreign";
      const containers = listed.filter((container) =>
        container.service === member.serviceName
      );
      if (containers.length > 1 || (containers.length === 1 && !containers[0]!.id)) {
        safety = "foreign";
      }
      let ownedId: string | undefined;
      if (containers.length === 1 && containers[0]!.id) {
        const inspected = await this.#docker(launch.root, [
          "inspect",
          containers[0]!.id!,
        ]);
        const actual = inspected.success ? parseContainer(inspected.stdout) : undefined;
        if (!actual) {
          safety = preferRemovalSafety(safety, "unknown");
        } else if (
          !hasOwnership(member, actual.labels) ||
          !hasExactNamedVolumeMounts(
            actual.mounts,
            launch.expectedMounts.get(member.serviceName)!,
          )
        ) {
          safety = "foreign";
        } else {
          const actualImage = await this.#docker(launch.root, [
            "image",
            "inspect",
            actual.image,
          ]);
          if (exactImageState(actualImage, member.imageReference) !== "exact") {
            safety = actualImage.success
              ? "foreign"
              : preferRemovalSafety(safety, "unknown");
          } else {
            ownedId = actual.id;
          }
        }
      }
      const ancestry = await this.#docker(launch.root, [
        "container",
        "ls",
        "--all",
        "--no-trunc",
        "--filter",
        `ancestor=${member.imageReference}`,
        "--format",
        "{{json .}}",
      ]);
      const ancestors = ancestry.success ? containerIds(ancestry.stdout) : undefined;
      if (!ancestors) {
        safety = preferRemovalSafety(safety, "unknown");
      } else if (
        (ownedId === undefined && ancestors.length !== 0) ||
        (ownedId !== undefined &&
          (ancestors.length !== 1 || ancestors[0] !== ownedId))
      ) {
        safety = "foreign";
      }
      if (imageState === "absent" && ownedId !== undefined) {
        safety = preferRemovalSafety(safety, "unknown");
      }
      materials.push({
        material: { ...member.material },
        state: imageState === "exact" ? "owned" : "absent",
      });
      if (ownedId !== undefined) {
        ownedContainerIds.push({
          material: { ...member.material },
          containerId: ownedId,
        });
      }
    }
    return {
      schemaVersion: "capability-runtime-removal-observation/1.0",
      launchGroup: capabilityRuntimeLaunchGroupReference(group),
      materials,
      ownedContainerIds,
      safety,
    };
  }

  async #stopOwnedRemovalContainers(
    launch: Launch,
    observation: CapabilityRuntimeAdministrativeRemovalObservation,
  ): Promise<CommandResult> {
    const ids = new Map(
      observation.ownedContainerIds.map((container) => [
        materialKey(container.material),
        container.containerId,
      ]),
    );
    for (const member of [...launch.group.materials].reverse()) {
      const id = ids.get(materialKey(member.material));
      if (!id) continue;
      const result = await this.#docker(launch.root, ["container", "stop", id]);
      if (!result.success) return result;
    }
    return successfulCommand();
  }

  async #removeOwnedContainers(
    launch: Launch,
    observation: CapabilityRuntimeAdministrativeRemovalObservation,
  ): Promise<CommandResult> {
    const ids = new Map(
      observation.ownedContainerIds.map((container) => [
        materialKey(container.material),
        container.containerId,
      ]),
    );
    for (const member of [...launch.group.materials].reverse()) {
      const id = ids.get(materialKey(member.material));
      if (!id) continue;
      // Deliberately no `--volumes`/`-v`: retained runtime volumes are never
      // deletion targets of administrative material removal.
      const result = await this.#docker(launch.root, ["container", "rm", id]);
      if (!result.success) return result;
    }
    return successfulCommand();
  }

  async #removeExactImages(
    launch: Launch,
    group: CapabilityRuntimeLaunchGroup,
    observation: CapabilityRuntimeAdministrativeRemovalObservation,
  ): Promise<CommandResult> {
    const states = new Map(
      observation.materials.map((material) => [
        materialKey(material.material),
        material.state,
      ]),
    );
    const references = new Map<string, string>();
    for (const member of group.materials) {
      if (states.get(materialKey(member.material)) !== "owned") continue;
      references.set(member.material.imageDigest, member.imageReference);
    }
    for (const reference of references.values()) {
      // This is the immutable repository digest from the sealed group, not a
      // mutable tag/alias. There is intentionally no force, prune or rmi argv.
      const result = await this.#docker(launch.root, ["image", "rm", reference]);
      if (!result.success) return result;
    }
    return successfulCommand();
  }

  async #sharedDigestOutsideGroup(
    group: CapabilityRuntimeLaunchGroup,
  ): Promise<boolean> {
    const selected = new Set(
      group.materials.map((member) =>
        `${member.material.unitId}\u0000${member.material.materialId}`
      ),
    );
    const selectedDigests = new Set(
      group.materials.map((member) => member.material.imageDigest),
    );
    return (await this.options.registry.list()).some((candidate) =>
      candidate.materials.some((member) =>
        selectedDigests.has(member.material.imageDigest) &&
        !selected.has(`${member.material.unitId}\u0000${member.material.materialId}`)
      )
    );
  }

  async #launch(group: CapabilityRuntimeLaunchGroup): Promise<Launch> {
    const root = this.#root.startsWith("/")
      ? await this.#paths.realPath(this.#root)
      : this.#root;
    const fingerprint = await fingerprintCapabilityRuntimeComposeContent(
      group.compose.content,
    );
    if (fingerprint.digest !== group.compose.fingerprint.digest) {
      throw new TypeError(
        "Capability runtime sealed group Compose descriptor fingerprint mismatch.",
      );
    }
    return {
      group,
      root,
      stdin: new TextEncoder().encode(group.compose.content),
      expectedMounts: expectedNamedVolumeMounts(group),
    };
  }

  async #inspect(
    group: CapabilityRuntimeLaunchGroup,
    supplied?: Launch,
    options: { readonly ignorePendingReadiness?: boolean } = {},
  ): Promise<GroupInspection> {
    const launch = supplied ?? await this.#launch(group);
    const readinessDisposition = options.ignorePendingReadiness
      ? undefined
      : await this.#readinessDisposition(group);
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
        } else if (
          !hasExactNamedVolumeMounts(
            actual.mounts,
            launch.expectedMounts.get(member.serviceName)!,
          )
        ) {
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
              // A sealed group without a Docker healthcheck proves only that
              // its owned process is running. A declared launch-group
              // readiness contract keeps that process `starting` until the
              // adapter has completed its bounded read-only MCP handshake;
              // it remains operational state, never qualification or an
              // engineering verdict. A service that declares a Docker
              // healthcheck must also report it healthy.
              runtime: actual.status === "running" &&
                  readinessDisposition === "starting"
                ? "starting"
                : actual.status === "running" && readinessDisposition === "degraded"
                ? "degraded"
                : actual.status === "running" &&
                    (actual.health === "healthy" ||
                      (actual.health === null &&
                        !serviceDeclaresHealthcheck(group, member.serviceName)))
                ? "active"
                : actual.status === "running"
                ? "degraded"
                : "inactive",
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

  /**
   * A pending readiness-bearing start is physically running but not active.
   * A terminal failed/uncertain start remains degraded rather than becoming
   * silently usable when a late process eventually opens its port.
   */
  async #readinessDisposition(
    group: CapabilityRuntimeLaunchGroup,
  ): Promise<"starting" | "degraded" | undefined> {
    if (group.readiness === undefined) return undefined;
    const reference = capabilityRuntimeLaunchGroupReference(group);
    const latest = (await this.options.journal.list()).filter((entry) =>
      isRuntimeStartAction(entry.action) &&
      sameCapabilityRuntimeLaunchGroupReference(entry.launchGroup, reference)
    ).toSorted((left, right) =>
      left.plannedAt.localeCompare(right.plannedAt) || left.id.localeCompare(right.id)
    ).at(-1);
    // A readiness-bearing group observed outside a succeeded H1 start has no
    // durable proof that its MCP endpoint accepted the read-only handshake.
    // It therefore remains `starting` until H1 reconciles the sealed group.
    if (!latest) return "starting";
    const outcome = (await this.options.journal.listOutcomes()).find((candidate) =>
      candidate.journalEntryId === latest.id
    );
    if (!outcome) return "starting";
    return outcome.status === "succeeded" ? undefined : "degraded";
  }

  /**
   * Bounded lifecycle readiness only. The probe is `tools/list`, never an
   * engineering `tools/call`; retries apply exclusively to that idempotent
   * transport handshake and are declared by the immutable launch group.
   */
  async #awaitReadiness(launch: Launch): Promise<boolean> {
    const readiness = launch.group.readiness;
    if (!readiness) return true;
    const ports = capabilityRuntimeLaunchGroupPublishedLoopbackHostPorts(launch.group);
    if (ports.length !== 1) return false;
    const startedAt = this.#monotonicNow();
    let remaining = readiness.timeoutMs;
    while (remaining > 0) {
      try {
        await this.#readinessProbe.probe({
          mcpUrl: `http://127.0.0.1:${ports[0]}/mcp`,
          timeoutMs: Math.min(readiness.attemptTimeoutMs, remaining),
        });
        return true;
      } catch {
        remaining = readiness.timeoutMs - (this.#monotonicNow() - startedAt);
        if (remaining <= 0) break;
        await this.#wait(Math.min(readiness.retryIntervalMs, remaining));
        remaining = readiness.timeoutMs - (this.#monotonicNow() - startedAt);
      }
    }
    return false;
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

  async #compose(
    launch: Launch,
    operation: readonly string[],
    secretSnapshot?: CapabilityRuntimeSecretSnapshot,
  ): Promise<CommandResult> {
    // The sealed descriptor is used for every observation/acquisition/stop.
    // Only the one `up` carries an in-memory overlay, built from the exact
    // opaque generation that the fixed Chrono client also receives.
    const stdin = secretSnapshot === undefined
      ? launch.stdin
      : await this.options.secretInjector!.composeOverlay({
        group: launch.group,
        snapshot: secretSnapshot,
      });
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
      { stdin, clearEnv: true, env: this.#environment },
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
  /** Derived only from the sealed canonical Compose descriptor. */
  readonly expectedMounts: ReadonlyMap<
    string,
    readonly ExpectedNamedVolumeMount[]
  >;
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
    case "runtime-qualification-start":
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
    case "runtime-qualification-start":
      return inspection.ownership === "owned" && states.length > 0 &&
        states.every((state) =>
          state.material === "installed" && state.runtime === "active"
        );
    case "runtime-stop":
      return inspection.ownership !== "mismatch" && states.length > 0 &&
        states.every((state) => state.runtime === "inactive");
    case "material-remove":
      return false;
  }
}

function isRuntimeStartAction(
  action: CapabilityRuntimeJournalEntry["action"],
): action is "runtime-start" | "runtime-qualification-start" {
  return action === "runtime-start" || action === "runtime-qualification-start";
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

function unknownRemovalObservation(
  group: CapabilityRuntimeLaunchGroup,
): CapabilityRuntimeAdministrativeRemovalObservation {
  return {
    schemaVersion: "capability-runtime-removal-observation/1.0",
    launchGroup: capabilityRuntimeLaunchGroupReference(group),
    materials: group.materials.map((member) => ({
      material: { ...member.material },
      state: "absent" as const,
    })),
    ownedContainerIds: [],
    safety: "unknown",
  };
}

function repoTagsAreExactPinnedIdentity(
  tags: unknown,
  reference: string,
): boolean {
  if (tags === undefined || tags === null) return true;
  return Array.isArray(tags) &&
    tags.every((tag) =>
      typeof tag === "string" && samePinnedRepositoryDigest(tag, reference)
    );
}

function exactImageState(
  result: CommandResult,
  reference: string,
): "exact" | "absent" | "foreign" | "unknown" {
  if (!result.success) {
    return dockerInspectReportsImageAbsent(result.stderr) ? "absent" : "unknown";
  }
  try {
    const root = Array.isArray(JSON.parse(result.stdout))
      ? JSON.parse(result.stdout)[0]
      : JSON.parse(result.stdout);
    const record = root as Record<string, unknown>;
    const digests = record.RepoDigests;
    const tags = record.RepoTags;
    if (
      !Array.isArray(digests) || !digests.every((digest) => typeof digest === "string")
    ) {
      return "unknown";
    }
    if (
      digests.length === 0 ||
      digests.some((digest) => !samePinnedRepositoryDigest(digest, reference))
    ) {
      return "foreign";
    }
    // Docker Desktop may echo the sealed repository@sha256:digest in RepoTags.
    if (!repoTagsAreExactPinnedIdentity(tags, reference)) {
      return "foreign";
    }
    return "exact";
  } catch {
    return "unknown";
  }
}

function containerIds(value: string): readonly string[] | undefined {
  if (!value.trim()) return [];
  try {
    const parsed = value.trim().startsWith("[")
      ? JSON.parse(value)
      : value.trim().split("\n").map((line) => JSON.parse(line));
    if (!Array.isArray(parsed)) return undefined;
    const ids = parsed.map((entry) => {
      const record = entry as Record<string, unknown>;
      const id = record.ID ?? record.Id;
      return typeof id === "string" && id ? id : undefined;
    });
    return ids.some((id) => id === undefined) ? undefined : ids as string[];
  } catch {
    return undefined;
  }
}

function preferRemovalSafety(
  current: CapabilityRuntimeAdministrativeRemovalObservation["safety"],
  next: CapabilityRuntimeAdministrativeRemovalObservation["safety"],
): CapabilityRuntimeAdministrativeRemovalObservation["safety"] {
  const rank: Record<
    CapabilityRuntimeAdministrativeRemovalObservation["safety"],
    number
  > = {
    exact: 0,
    unknown: 1,
    foreign: 2,
  };
  return rank[next] > rank[current] ? next : current;
}

function matchesRemovalPlan(
  plan: CapabilityRuntimeAdministrativeRemovalPlan,
  observation: CapabilityRuntimeAdministrativeRemovalObservation,
): boolean {
  return plan.observedMaterials.length === observation.materials.length &&
    plan.observedMaterials.every((material, index) =>
      sameMaterial(material.material, observation.materials[index]!.material) &&
      material.state === observation.materials[index]!.state
    ) && plan.ownedContainerIds.length === observation.ownedContainerIds.length &&
    plan.ownedContainerIds.every((container, index) =>
      sameMaterial(
        container.material,
        observation.ownedContainerIds[index]!.material,
      ) &&
      container.containerId === observation.ownedContainerIds[index]!.containerId
    );
}

function removalObservationValues(
  observation: CapabilityRuntimeAdministrativeRemovalObservation,
): readonly {
  material: CapabilityRuntimeMaterialIdentity;
  state: CapabilityRuntimeObservedState | null;
}[] {
  return observation.materials.map((entry) => ({
    material: entry.material,
    state: entry.state === "owned"
      ? { material: "installed", runtime: "inactive" }
      : { material: "absent", runtime: "inactive" },
  }));
}

function successfulCommand(): CommandResult {
  return { success: true, code: 0, stdout: "", stderr: "" };
}

function parseContainer(
  value: string,
): {
  id: string;
  labels: Readonly<Record<string, string>>;
  status: string;
  health: string | null;
  image: string;
  mounts: readonly InspectedContainerMount[];
} | undefined {
  try {
    const root = Array.isArray(JSON.parse(value))
      ? JSON.parse(value)[0]
      : JSON.parse(value);
    const record = root as Record<string, unknown>;
    const config = record.Config as Record<string, unknown> | undefined;
    const state = record.State as Record<string, unknown> | undefined;
    const labels = config?.Labels;
    const mounts = parseContainerMounts(record.Mounts);
    if (
      !config || !state || !labels || typeof labels !== "object" ||
      Array.isArray(labels) || typeof record.Id !== "string" ||
      typeof record.Image !== "string" || typeof state.Status !== "string" || !mounts
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
      mounts,
    };
  } catch {
    return undefined;
  }
}

interface ExpectedNamedVolumeMount {
  readonly name: string;
  readonly destination: string;
  readonly readWrite: boolean;
}

interface InspectedContainerMount {
  readonly type: string;
  readonly name: string;
  readonly destination: string;
  readonly readWrite: boolean;
}

/**
 * Docker's Compose labels prove a service identity, not its mounted topology.
 * Build the required named-volume set from the immutable Compose descriptor
 * already fingerprinted by #launch. The descriptor admits named volumes only;
 * external names, bind mounts, interpolation and arbitrary configs are
 * rejected while the launch group is constructed.
 */
function expectedNamedVolumeMounts(
  group: CapabilityRuntimeLaunchGroup,
): ReadonlyMap<string, readonly ExpectedNamedVolumeMount[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(group.compose.content);
  } catch {
    throw new TypeError("Sealed capability runtime Compose content is not JSON.");
  }
  const document = plainRecord(parsed);
  const services = document && plainRecord(document.services);
  if (!services) {
    throw new TypeError(
      "Sealed capability runtime Compose content has no services map.",
    );
  }
  const result = new Map<string, readonly ExpectedNamedVolumeMount[]>();
  for (const member of group.materials) {
    const service = plainRecord(services[member.serviceName]);
    if (!service) {
      throw new TypeError(
        "Sealed capability runtime Compose content lacks a group service.",
      );
    }
    const mounts = service.volumes === undefined ? [] : sealedNamedVolumeMounts(
      service.volumes,
      group.acquisition.projectName,
    );
    result.set(member.serviceName, mounts);
  }
  return result;
}

function sealedNamedVolumeMounts(
  value: unknown,
  projectName: string,
): readonly ExpectedNamedVolumeMount[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Sealed capability runtime service volumes must be an array.");
  }
  const seen = new Set<string>();
  return value.map((mount) => {
    if (typeof mount !== "string") {
      throw new TypeError("Sealed capability runtime volume mount must be literal.");
    }
    const match = /^([a-z0-9][a-z0-9_-]{0,62}):(\/[^:\0]+)(?::(ro))?$/.exec(
      mount,
    );
    if (!match || seen.has(match[2]!)) {
      throw new TypeError(
        "Sealed capability runtime volume mount is invalid or ambiguous.",
      );
    }
    seen.add(match[2]!);
    return {
      name: `${projectName}_${match[1]!}`,
      destination: match[2]!,
      readWrite: match[3] !== "ro",
    };
  });
}

function parseContainerMounts(
  value: unknown,
): readonly InspectedContainerMount[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: InspectedContainerMount[] = [];
  for (const mount of value) {
    const record = plainRecord(mount);
    if (
      !record || typeof record.Type !== "string" ||
      typeof record.Name !== "string" || typeof record.Destination !== "string" ||
      typeof record.RW !== "boolean"
    ) {
      return undefined;
    }
    result.push({
      type: record.Type,
      name: record.Name,
      destination: record.Destination,
      readWrite: record.RW,
    });
  }
  return result;
}

function hasExactNamedVolumeMounts(
  actual: readonly InspectedContainerMount[],
  expected: readonly ExpectedNamedVolumeMount[],
): boolean {
  if (actual.length !== expected.length) return false;
  const expectedByDestination = new Map(
    expected.map((mount) => [mount.destination, mount]),
  );
  const seen = new Set<string>();
  for (const mount of actual) {
    const expectedMount = expectedByDestination.get(mount.destination);
    if (
      !expectedMount || seen.has(mount.destination) || mount.type !== "volume" ||
      mount.name !== expectedMount.name ||
      mount.readWrite !== expectedMount.readWrite
    ) return false;
    seen.add(mount.destination);
  }
  return seen.size === expectedByDestination.size;
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function hasExactImage(value: string, reference: string): boolean {
  try {
    const root = Array.isArray(JSON.parse(value))
      ? JSON.parse(value)[0]
      : JSON.parse(value);
    const digests = (root as Record<string, unknown>).RepoDigests;
    return Array.isArray(digests) && digests.length > 0 &&
      digests.some((digest) =>
        typeof digest === "string" && samePinnedRepositoryDigest(digest, reference)
      );
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
function compact(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 512 ? `${text.slice(0, 509)}...` : text || "unknown error";
}

/** Docker reports `aarch64` on some ARM daemon releases; normalize only it. */
function parseDockerDaemonPlatform(value: string): CapabilityRuntimePlatform {
  const observed = value.trim();
  if (observed === "linux/amd64") return observed;
  if (observed === "linux/arm64" || observed === "linux/aarch64") {
    return "linux/arm64";
  }
  throw new Error(
    `Capability runtime host platform is unsupported or malformed: ${
      JSON.stringify(observed)
    }.`,
  );
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

/**
 * Reuses the shared stateless MCP transport but sends only `tools/list`.
 * Unlike a fleet health probe, a launch group derives this short-lived
 * loopback publication from its own sealed Compose descriptor and never reads
 * or changes the provider manifest.
 */
async function probeReadOnlyMcpTools(input: {
  readonly mcpUrl: string;
  readonly timeoutMs: number;
}, fetchImplementation?: typeof fetch): Promise<void> {
  const result = await new StatelessMcpHttpTransport({
    mcpUrl: input.mcpUrl,
    timeoutMs: input.timeoutMs,
    ...(fetchImplementation === undefined ? {} : { fetch: fetchImplementation }),
  }).request({
    method: "tools/list",
    label: "launch-group readiness",
    params: {},
  });
  if (result.resultType !== "complete" || !Array.isArray(result.tools)) {
    throw new Error(
      "launch-group readiness did not return a complete tools/list result",
    );
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
