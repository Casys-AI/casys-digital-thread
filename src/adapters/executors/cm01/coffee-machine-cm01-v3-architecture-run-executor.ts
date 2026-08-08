import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandOrigin,
  type EngineeringProjectCommandService,
  type EngineeringProjectRevisionStore,
} from "../../../domain/project/engineering-project-command-service.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
  EngineeringWorkItem,
} from "../../../domain/project/engineering-project.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import {
  COFFEE_MACHINE_CM01_SEMANTIC_RECIPE_KEY,
  type CoffeeMachineCm01SemanticRecipe,
  fingerprintCoffeeMachineCm01Sysml,
  parseCoffeeMachineCm01SemanticRecipe,
  renderCoffeeMachineCm01Sysml,
} from "../../../domain/cm01/coffee-machine-cm01-semantic-recipe.ts";
import {
  parseSysonModelSeedCapture,
  requireExactSysonModelSeed,
  type SysonModelSeedCapture,
} from "../../../domain/platform/syson-model-seed.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadFreshness,
  ThreadOperationRef,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import { applyThreadSnapshotExtensionIfNew } from "../../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import { COFFEE_MACHINE_CM01_V3_OPERATION_REFS } from "../../../orchestration/operations/coffee-machine-cm01-v3-engineering-kits.ts";
import {
  CoffeeMachineCm01V3ArchitectureWriteOutcomeUnknownError,
  FileCoffeeMachineCm01V3ArchitectureAttemptStore,
} from "../../wal/file-coffee-machine-cm01-v3-architecture-attempt-store.ts";
import { FileCaptureStore } from "../../captures/file-capture-store.ts";
import type { EngineeringProjectRunLease } from "../../stores/file-engineering-project-run-lease.ts";
import type { McpToolClient } from "../../mcp/http-mcp-tool-client.ts";
import type { LiveThreadUpdateMilestoneJournal } from "../../stores/live-thread-update-store.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "../executor-run-helpers.ts";

export const COFFEE_MACHINE_CM01_V3_ARCHITECTURE_CAPTURE_SCHEMA =
  "coffee-machine-cm01-v3-architecture-capture/1.1" as const;
export const COFFEE_MACHINE_CM01_V3_ARCHITECTURE_OPERATION =
  COFFEE_MACHINE_CM01_V3_OPERATION_REFS.architecture;
export const COFFEE_MACHINE_CM01_V3_ARCHITECTURE_ARTIFACT_ROLE =
  "architecture-model" as const;

export interface CoffeeMachineCm01V3ArchitectureRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface CoffeeMachineCm01V3ArchitectureRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore;
  readonly seedCaptures: {
    read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  };
  readonly captures: FileCaptureStore<"coffee-machine-cm01-v3-architecture">;
  readonly attempts: FileCoffeeMachineCm01V3ArchitectureAttemptStore;
  /** Parsed once by the server from the reviewed static recipe. */
  readonly recipe: CoffeeMachineCm01SemanticRecipe;
  /** Fixed server-owned MCP client. No agent value reaches this boundary. */
  readonly syson: McpToolClient;
  readonly lease: EngineeringProjectRunLease;
  readonly liveUpdates?: LiveThreadUpdateMilestoneJournal;
  readonly now?: () => string;
}

interface Cm01SeedInputs {
  readonly base: ThreadSnapshot;
  readonly seedCapture: unknown;
  readonly seed: Awaited<ReturnType<typeof requireExactSysonModelSeed>>;
}

interface Cm01Insertion {
  readonly parentId: string;
  readonly textSha256: ContentFingerprint;
}

interface Cm01Element {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
}

interface Cm01Materialization {
  readonly text: string;
  readonly sha256: ContentFingerprint;
  readonly snapshot: ThreadSnapshot;
  readonly artifact: ThreadArtifact;
}

/**
 * Trusted V3 CM-01 authoring operation.
 *
 * The operation can perform one insert only, into the exact empty r2 SysON
 * root created for this project. It has no generic SysML input surface and it
 * stores only normalized acknowledgement/read-back evidence.
 */
export class CoffeeMachineCm01V3ArchitectureRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: EngineeringProjectCommandService;
  readonly #snapshots: ThreadSnapshotStore;
  readonly #seedCaptures:
    CoffeeMachineCm01V3ArchitectureRunExecutorDependencies["seedCaptures"];
  readonly #captures: FileCaptureStore<"coffee-machine-cm01-v3-architecture">;
  readonly #attempts: FileCoffeeMachineCm01V3ArchitectureAttemptStore;
  readonly #recipe: CoffeeMachineCm01SemanticRecipe;
  readonly #syson: McpToolClient;
  readonly #lease: EngineeringProjectRunLease;
  readonly #liveUpdates: LiveThreadUpdateMilestoneJournal | undefined;
  readonly #now: () => string;

  constructor(dependencies: CoffeeMachineCm01V3ArchitectureRunExecutorDependencies) {
    this.#projects = dependencies.projects;
    this.#commands = dependencies.commands;
    this.#snapshots = dependencies.snapshots;
    this.#seedCaptures = dependencies.seedCaptures;
    this.#captures = dependencies.captures;
    this.#attempts = dependencies.attempts;
    // Re-parse defensively: even a local server dependency cannot inject a
    // modified product definition after construction.
    this.#recipe = parseCoffeeMachineCm01SemanticRecipe(dependencies.recipe);
    this.#syson = dependencies.syson;
    this.#lease = dependencies.lease;
    this.#liveUpdates = dependencies.liveUpdates;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3ArchitectureRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute the human-queued CM-01 architecture run.",
      );
    }
    const project = await this.requiredProject(command.projectId);
    requireShape(project, requireRun(project, command.runId));
    return await this.#lease.withLease(
      command.projectId,
      command.runId,
      () => this.executeLeased(origin, command),
    );
  }

  private async executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3ArchitectureRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let providerAcknowledged = false;
    let snapshotPersisted = false;
    let materialized: Cm01Materialization | undefined;
    try {
      const preClaim = await this.requiredProject(command.projectId);
      const preClaimRun = requireRun(preClaim, command.runId);
      requireShape(preClaim, preClaimRun);
      await this.requiredInputs(preClaim, preClaimRun);
      await this.#commands.claimRun(origin, {
        ...command,
        commandId: commandStep(command.commandId, "claim"),
        summary: "Started the bounded CM-01 SysON architecture authoring run.",
      });
      claimed = true;

      let project = await this.requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireClaimedShape(project, run, origin);
      if (run.status === "completed") {
        assertCompleted(project, command);
        await this.reconcileLive(project.project.subjectId, run.id);
        return project;
      }
      if (run.status !== "running") throw unexpectedStatus(run, "running");

      const inputs = await this.requiredInputs(project, run);
      const basis = requireBasis(run);
      const capturedAt = requiredStart(run);
      const rootId = inputs.seed.normalizedResults.rootPackage.id;
      const existing = await this.existingAttempt(project.project.id, run.id);
      const live = (step: Cm01LiveStep, phase: "started" | "completed" | "failed") =>
        this.recordLive(project, run, basis, step, phase);
      let insertion: Cm01Insertion;
      if (existing?.status === "completed") {
        insertion = await insertionFromAttempt(existing.result, rootId, this.#recipe);
        providerAcknowledged = true;
      } else {
        if (existing?.status === "dispatched") {
          throw new CoffeeMachineCm01V3ArchitectureWriteOutcomeUnknownError();
        }
        const preflight = await this.children(
          inputs.seed.normalizedResults.project.editingContextId,
          rootId,
          "root-preflight",
          live,
        );
        requireEmptyChildren(preflight, rootId);
        insertion = await this.fixedInsert(
          project.project.id,
          run.id,
          capturedAt,
          inputs,
          live,
        );
        providerAcknowledged = true;
      }

      const rootReadback = await this.children(
        inputs.seed.normalizedResults.project.editingContextId,
        rootId,
        "root-readback",
        live,
      );
      const architecturePackage = requireArchitecturePackage(rootReadback, rootId);
      const packageReadback = await this.children(
        inputs.seed.normalizedResults.project.editingContextId,
        architecturePackage.id,
        "package-readback",
        live,
      );
      const declarations = requireDeclarations(
        packageReadback,
        architecturePackage.id,
        this.#recipe,
      );
      materialized = await materializeArchitecture({
        base: inputs.base,
        seed: inputs.seed,
        runId: run.id,
        capturedAt,
        recipe: this.#recipe,
        insertion,
        architecturePackage,
        declarations,
        captureUri: undefined,
      });
      await this.#captures.save(materialized.sha256, materialized.text);
      const persisted = await this.#captures.read(materialized.sha256);
      if (persisted !== materialized.text) {
        throw new Error(
          "CM-01 architecture capture was not durably readable after save.",
        );
      }
      const withUri = await materializeArchitecture({
        base: inputs.base,
        seed: inputs.seed,
        runId: run.id,
        capturedAt,
        recipe: this.#recipe,
        insertion,
        architecturePackage,
        declarations,
        captureUri: this.#captures.uriFor(materialized.sha256),
      });
      if (withUri.sha256.digest !== materialized.sha256.digest) {
        throw new Error("CM-01 architecture capture URI altered evidence bytes.");
      }
      materialized = withUri;
      await this.#snapshots.save(materialized.snapshot);
      const saved = await this.#snapshots.get(materialized.snapshot.id);
      if (
        !saved || deterministicJson(saved) !== deterministicJson(materialized.snapshot)
      ) {
        throw new Error(
          "CM-01 architecture snapshot was not durably readable after save.",
        );
      }
      snapshotPersisted = true;

      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary: "Publishing the normalized CM-01 SysON architecture read-back.",
        });
      } else if (run.status !== "publishing" && run.status !== "completed") {
        throw unexpectedStatus(run, "publishing");
      }
      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.#commands.completeRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "complete"),
          expectedRevision: project.revision,
          summary:
            "Recorded the bounded CM-01 system-model architecture and its SysON read-back.",
          resultSnapshot: snapshotRef(materialized.snapshot),
          evidenceRefs: [artifactReference(materialized.snapshot)],
        });
      } else if (run.status !== "completed") {
        throw unexpectedStatus(run, "completed");
      }
      const complete = await this.requiredProject(command.projectId);
      assertCompleted(complete, command);
      await this.reconcileLive(complete.project.subjectId, command.runId);
      return complete;
    } catch (error) {
      if (snapshotPersisted) {
        const complete = await this.completedFor(command);
        if (complete) return complete;
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "CM-01 architecture evidence is durable but project attachment did not finish. Retry this exact command; it will not insert a second package.",
        );
      }
      if (error instanceof CoffeeMachineCm01V3ArchitectureWriteOutcomeUnknownError) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The CM-01 SysON insertion outcome is unknown. An operator must inspect SysON before any separately reviewed recovery path.",
        );
      }
      if (providerAcknowledged) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The CM-01 SysON insertion was acknowledged but evidence was not published. Retry this exact command to resume read-back without another insertion.",
        );
      }
      if (claimed) await this.recordFailure(origin, command);
      throw error;
    }
  }

  private async requiredInputs(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
  ): Promise<Cm01SeedInputs> {
    const basis = requireBasis(run);
    const base = await exactSnapshot(this.#snapshots, basis);
    if (base.subject.id !== project.project.subjectId) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The exact r2 ThreadSnapshot subject does not match the CM-01 project subject.",
      );
    }
    const seedArtifact = base.artifacts.find((artifact) =>
      artifact.kind === "sysml-model"
    );
    if (!seedArtifact) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The exact r2 basis has no SysON model-container artifact.",
      );
    }
    const text = await this.#seedCaptures.read(seedArtifact.fingerprint);
    if (!text) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The exact r2 SysON model-seed capture is not readable.",
      );
    }
    let seedCapture: unknown;
    try {
      seedCapture = JSON.parse(text);
    } catch {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The exact r2 SysON model-seed capture is not valid JSON.",
      );
    }
    const seed = await requireExactSysonModelSeed(base, seedCapture);
    requireExactV3BriefLineage(project, run, parseSysonModelSeedCapture(seedCapture));
    return { base, seedCapture, seed };
  }

  private async existingAttempt(projectId: string, runId: string) {
    try {
      return await this.#attempts.read(projectId, runId);
    } catch {
      throw new CoffeeMachineCm01V3ArchitectureWriteOutcomeUnknownError();
    }
  }

  private async fixedInsert(
    projectId: string,
    runId: string,
    capturedAt: string,
    inputs: Cm01SeedInputs,
    live: LiveRecorder,
  ): Promise<Cm01Insertion> {
    const begin = await this.#attempts.begin({
      projectId,
      runId,
      dispatchedAt: capturedAt,
    });
    if (begin.action === "completed") {
      return await insertionFromAttempt(
        begin.result,
        inputs.seed.normalizedResults.rootPackage.id,
        this.#recipe,
      );
    }
    const sysml = renderCoffeeMachineCm01Sysml(this.#recipe);
    try {
      await live("architecture-insert", "started");
      const result = await this.#syson.callTool({
        name: "syson_element_insert_sysml",
        arguments: {
          editing_context_id: inputs.seed.normalizedResults.project.editingContextId,
          parent_id: inputs.seed.normalizedResults.rootPackage.id,
          sysml_text: sysml,
        },
      });
      const insertion = await normalizeInsertion(
        result.structuredContent,
        inputs.seed.normalizedResults.rootPackage.id,
        this.#recipe,
      );
      await this.#attempts.complete({
        projectId,
        runId,
        result: {
          inserted: "true",
          parentId: insertion.parentId,
          textSha256: insertion.textSha256.digest,
        },
      });
      await live("architecture-insert", "completed");
      return insertion;
    } catch {
      await live("architecture-insert", "failed");
      throw new CoffeeMachineCm01V3ArchitectureWriteOutcomeUnknownError();
    }
  }

  private async children(
    editingContextId: string,
    elementId: string,
    step: Cm01LiveStep,
    live: LiveRecorder,
  ) {
    await live(step, "started");
    try {
      const result = await this.#syson.callTool({
        name: "syson_element_children",
        arguments: { editing_context_id: editingContextId, element_id: elementId },
      });
      await live(step, "completed");
      return result.structuredContent;
    } catch (error) {
      await live(step, "failed");
      throw error;
    }
  }

  private async recordLive(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    basis: EngineeringThreadSnapshotBasis,
    step: Cm01LiveStep,
    phase: "started" | "completed" | "failed",
  ): Promise<void> {
    if (!this.#liveUpdates) return;
    const recordedAt = safeNow(this.#now);
    try {
      await this.#liveUpdates.appendOnce({
        subjectId: project.project.subjectId,
        runId: run.id,
        operationId: `${COFFEE_MACHINE_CM01_V3_OPERATION_REFS.architecture.id}:${step}`,
        baseRevision: basis.revision,
        state: phase === "started"
          ? "running"
          : phase === "completed"
          ? "fresh"
          : "failed",
        recordedAt,
        graph: {
          nodes: [{
            id: `${run.id}:${step}`,
            ref: { kind: "artifact", id: `${run.id}:${step}` },
            entityKind: "artifact",
            artifactKind: "other",
            activityRole: "milestone",
            label: liveLabel(step),
            system: "SysON",
            freshness: phase === "started"
              ? "running"
              : phase === "completed"
              ? "fresh"
              : "failed",
            summary: liveSummary(step, phase),
            recordedAt,
          }],
          edges: [],
        },
      });
    } catch {
      // The browser projection has no authority over the canonical run.
    }
  }

  private async reconcileLive(subjectId: string, runId: string): Promise<void> {
    try {
      await this.#liveUpdates?.reconcileRunOnce(subjectId, runId, safeNow(this.#now));
    } catch {
      // Optional presentation journal.
    }
  }

  private async recordFailure(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3ArchitectureRunExecutorCommand,
  ): Promise<void> {
    try {
      const project = await this.requiredProject(command.projectId);
      const run = requireRun(project, command.runId);
      if (
        run.status !== "running" || run.claimedBy?.origin !== origin.kind ||
        run.claimedBy.id !== origin.actorId
      ) return;
      await this.#commands.failRun(origin, {
        ...command,
        commandId: commandStep(command.commandId, "fail"),
        expectedRevision: project.revision,
        summary:
          "CM-01 architecture stopped before a SysON insertion was acknowledged.",
        code: "coffee-machine-cm01-v3-architecture-not-published",
        message:
          "The bounded CM-01 SysON architecture run stopped before technical evidence was published.",
      });
    } catch {
      // Preserve the original cause.
    }
  }

  private async completedFor(
    command: CoffeeMachineCm01V3ArchitectureRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    try {
      const project = await this.requiredProject(command.projectId);
      assertCompleted(project, command);
      return project;
    } catch {
      return undefined;
    }
  }

  private async requiredProject(
    projectId: string,
  ): Promise<EngineeringProjectSnapshot> {
    const project = await this.#projects.get(projectId);
    if (!project) {
      throw new EngineeringProjectCommandError(
        "project_not_found",
        `Engineering project ${projectId} does not exist.`,
      );
    }
    return project;
  }
}

/** Normalized projection used by the golden comparator; it never returns IDs. */
export function coffeeMachineCm01V3ArchitectureGoldenArtifact(
  snapshot: ThreadSnapshot,
): {
  readonly role: typeof COFFEE_MACHINE_CM01_V3_ARCHITECTURE_ARTIFACT_ROLE;
  readonly kind: "sysml-model";
  readonly producer: {
    readonly serverId: "syson";
    readonly tool: "syson_element_insert_sysml";
  };
} {
  const artifact = snapshot.artifacts.find((candidate) =>
    candidate.id.startsWith("coffee-machine-cm01-v3-architecture-")
  );
  if (
    !artifact || artifact.kind !== "sysml-model" ||
    artifact.producer.serverId !== "syson" ||
    artifact.producer.tool !== "syson_element_insert_sysml"
  ) {
    throw new Error("CM-01 V3 snapshot has no valid architecture-model artifact.");
  }
  return {
    role: COFFEE_MACHINE_CM01_V3_ARCHITECTURE_ARTIFACT_ROLE,
    kind: "sysml-model",
    producer: { serverId: "syson", tool: "syson_element_insert_sysml" },
  };
}

async function materializeArchitecture(input: {
  readonly base: ThreadSnapshot;
  readonly seed: Cm01SeedInputs["seed"];
  readonly runId: string;
  readonly capturedAt: string;
  readonly recipe: CoffeeMachineCm01SemanticRecipe;
  readonly insertion: Cm01Insertion;
  readonly architecturePackage: Cm01Element;
  readonly declarations: readonly Cm01Element[];
  readonly captureUri: string | undefined;
}): Promise<Cm01Materialization> {
  const recipeFingerprint = await fingerprintCoffeeMachineCm01Sysml(input.recipe);
  if (recipeFingerprint.digest !== input.insertion.textSha256.digest) {
    throw new Error(
      "The SysON insertion acknowledgement does not match the reviewed CM-01 recipe.",
    );
  }
  const capture = {
    schemaVersion: COFFEE_MACHINE_CM01_V3_ARCHITECTURE_CAPTURE_SCHEMA,
    kind: "cm01-sysml-architecture",
    scope: "bounded-system-model",
    statement:
      "Normalized acknowledgement and read-back of the reviewed CM-01 system-model architecture. It is not CAD, simulation, verification, manufacturing, cost, certification, or physical proof.",
    capturedAt: timestamp(input.capturedAt),
    trustedRunId: nonEmpty(input.runId, "runId"),
    operation: COFFEE_MACHINE_CM01_V3_OPERATION_REFS.architecture,
    semanticArtifactRole: COFFEE_MACHINE_CM01_V3_ARCHITECTURE_ARTIFACT_ROLE,
    recipe: {
      key: COFFEE_MACHINE_CM01_SEMANTIC_RECIPE_KEY,
      sysmlSha256: recipeFingerprint,
    },
    seed: {
      artifactId: input.seed.artifactId,
      fingerprint: input.seed.fingerprint,
      editingContextId: input.seed.normalizedResults.project.editingContextId,
      projectId: input.seed.normalizedResults.project.id,
      rootPackageId: input.seed.normalizedResults.rootPackage.id,
    },
    insertion: input.insertion,
    architecturePackage: input.architecturePackage,
    declarations: input.declarations,
  } as const;
  const text = deterministicJson(capture);
  const sha256 = await sha256Fingerprint(capture);
  const artifactId = `coffee-machine-cm01-v3-architecture-${sha256.digest}`;
  const operation: ThreadOperationRef = {
    serverId: "syson",
    tool: "syson_element_insert_sysml",
    runId: input.runId,
  };
  const freshness: ThreadFreshness = {
    status: "fresh",
    changedAt: input.capturedAt,
    invalidatedByChangeIds: [],
  };
  const artifact: ThreadArtifact = {
    id: artifactId,
    name: "CM-01 architecture model",
    kind: "sysml-model",
    version: sha256.digest,
    fingerprint: sha256,
    ...(input.captureUri ? { uri: input.captureUri } : {}),
    mediaType: "application/json",
    producer: operation,
    inputArtifactIds: [input.seed.artifactId],
    freshness,
  };
  const consumption: ThreadArtifactConsumption = {
    id: `consume-${input.seed.artifactId}-by-${artifactId}`,
    artifactId: input.seed.artifactId,
    consumer: operation,
    observedFingerprint: input.seed.fingerprint,
    verifiedAt: input.capturedAt,
    status: "verified",
  };
  const extension = {
    id: `capture-${artifactId}`,
    name: "Capture the bounded CM-01 SysON architecture",
    subjectId: input.base.subject.id,
    capturedAt: input.capturedAt,
    artifacts: [artifact],
    consumptions: [consumption],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    proposedActions: [],
    provenance: [{
      id: `link-${artifactId}-derived-from-${input.seed.artifactId}`,
      relation: "derived_from" as const,
      from: { kind: "artifact" as const, id: artifactId },
      to: { kind: "artifact" as const, id: input.seed.artifactId },
      rationale:
        "The CM-01 architecture was authored only in the exact SysON model container captured by r2.",
    }, {
      id: `link-${consumption.id}-uses-${input.seed.artifactId}`,
      relation: "uses" as const,
      from: { kind: "consumption" as const, id: consumption.id },
      to: { kind: "artifact" as const, id: input.seed.artifactId },
      rationale:
        "The executor re-read the exact r2 model-container capture before authoring CM-01.",
    }],
    bindingProofs: [{
      provider: "syson",
      kind: "project",
      id: input.seed.normalizedResults.project.id,
    }],
  };
  const applied = applyThreadSnapshotExtensionIfNew(input.base, extension, {
    appliedAt: input.capturedAt,
  });
  if (!applied.applied || applied.snapshot.revision !== input.base.revision + 1) {
    throw new Error(
      "CM-01 architecture evidence did not produce exactly one descendant snapshot.",
    );
  }
  return { text, sha256, snapshot: applied.snapshot, artifact };
}

function requireShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): EngineeringWorkItem {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const operation = workItem?.operation;
  if (
    project.schemaVersion !== "3.0" ||
    project.project.id !== "coffee-machine-cm01-v3" ||
    project.project.subjectId !== "project:coffee-machine-cm01-v3" ||
    run.basis?.kind !== "thread-snapshot" || !workItem ||
    operation?.id !== COFFEE_MACHINE_CM01_V3_OPERATION_REFS.architecture.id ||
    operation.version !== COFFEE_MACHINE_CM01_V3_OPERATION_REFS.architecture.version ||
    operation.bindings.length !== 1 ||
    operation.bindings[0]?.name !== "approvedBrief" ||
    operation.bindings[0].source.kind !== "approved-brief"
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the canonical CM-01 V3 architecture @1 operation.",
    );
  }
  return workItem;
}

function requireClaimedShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
): EngineeringWorkItem {
  const workItem = requireShape(project, run);
  if (run.claimedBy?.origin !== origin.kind || run.claimedBy.id !== origin.actorId) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the exact CM-01 architecture it claimed.",
    );
  }
  return workItem;
}

function requireExactV3BriefLineage(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  seed: SysonModelSeedCapture,
): void {
  const matching = (project.planChanges ?? []).filter((change) =>
    change.workItemIds.includes(run.workItemId)
  );
  const change = matching.length === 1 ? matching[0] : undefined;
  if (
    !change?.approvedBriefBasis ||
    deterministicJson(change.approvedBriefBasis) !==
      deterministicJson(seed.lineage.approvedBriefBasis) ||
    change.approvedBriefBasis.projectId !== project.project.id
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The CM-01 architecture run is not linked to the exact approved brief preserved by its r2 SysON seed.",
    );
  }
}

async function exactSnapshot(
  store: ThreadSnapshotStore,
  basis: EngineeringThreadSnapshotBasis,
): Promise<ThreadSnapshot> {
  const snapshot = await store.get(basis.snapshotId);
  if (
    !snapshot || snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision || snapshot.subject.id !== basis.subjectId
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The exact r2 ThreadSnapshot required by the CM-01 architecture run is not readable.",
    );
  }
  try {
    return validateThreadSnapshot(snapshot);
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `The exact r2 ThreadSnapshot required by the CM-01 architecture run is invalid: ${
        errorMessage(error)
      }`,
    );
  }
}

async function normalizeInsertion(
  value: unknown,
  rootPackageId: string,
  recipe: CoffeeMachineCm01SemanticRecipe,
): Promise<Cm01Insertion> {
  const record = closed(
    value,
    ["inserted", "parentId", "text"],
    "SysON insertion response",
  );
  if (
    record.inserted !== true || record.parentId !== rootPackageId ||
    typeof record.text !== "string"
  ) {
    throw new Error(
      "SysON CM-01 insertion response does not acknowledge the exact root and text.",
    );
  }
  const expected = await fingerprintCoffeeMachineCm01Sysml(recipe);
  const received = await sha256Text(record.text);
  if (received !== expected.digest) {
    throw new Error(
      "SysON CM-01 insertion response text does not match the reviewed recipe.",
    );
  }
  return { parentId: rootPackageId, textSha256: expected };
}

async function insertionFromAttempt(
  value: Readonly<Record<string, string>> | undefined,
  rootPackageId: string,
  recipe: CoffeeMachineCm01SemanticRecipe,
): Promise<Cm01Insertion> {
  if (!value || value.inserted !== "true" || value.parentId !== rootPackageId) {
    throw new CoffeeMachineCm01V3ArchitectureWriteOutcomeUnknownError();
  }
  const expected = await fingerprintCoffeeMachineCm01Sysml(recipe);
  if (value.textSha256 !== expected.digest) {
    throw new CoffeeMachineCm01V3ArchitectureWriteOutcomeUnknownError();
  }
  return { parentId: rootPackageId, textSha256: expected };
}

function requireEmptyChildren(value: unknown, parentId: string): void {
  if (children(value, parentId).length !== 0) {
    throw new Error(
      "The CM-01 SysON root package must be empty before the bounded insert.",
    );
  }
}

function requireArchitecturePackage(value: unknown, parentId: string): Cm01Element {
  const items = children(value, parentId);
  if (
    items.length !== 1 || items[0]!.label !== "CoffeeMachineCM01" ||
    !semanticKind(items[0]!.kind, "Package")
  ) {
    throw new Error(
      "CM-01 root read-back must contain exactly the CoffeeMachineCM01 package.",
    );
  }
  return items[0]!;
}

function requireDeclarations(
  value: unknown,
  parentId: string,
  recipe: CoffeeMachineCm01SemanticRecipe,
): readonly Cm01Element[] {
  const items = children(value, parentId);
  const expected = [
    recipe.system.sysmlPartDefinitionName,
    ...recipe.components.map((component) => component.sysmlPartDefinitionName),
  ];
  if (
    items.length !== expected.length ||
    new Set(items.map((item) => item.label)).size !== items.length ||
    expected.some((label) => !items.some((item) => item.label === label)) ||
    items.some((item) => !semanticKind(item.kind, "PartDefinition"))
  ) {
    throw new Error(
      "CM-01 architecture package read-back does not contain exactly the reviewed part definitions.",
    );
  }
  return items;
}

function children(value: unknown, parentId: string): Cm01Element[] {
  const record = closed(
    value,
    ["parentId", "children", "count"],
    "SysON children response",
  );
  if (
    record.parentId !== parentId || !Array.isArray(record.children) ||
    record.count !== record.children.length
  ) {
    throw new Error("SysON children response does not match its requested parent.");
  }
  return record.children.map((candidate, index) => {
    const element = closed(candidate, ["id", "kind", "label"], `SysON child ${index}`);
    return {
      id: nonEmptyString(element.id, `SysON child ${index}.id`),
      kind: nonEmptyString(element.kind, `SysON child ${index}.kind`),
      label: nonEmptyString(element.label, `SysON child ${index}.label`),
    };
  });
}

function semanticKind(value: string, expected: string): boolean {
  return value === `sysml::${expected}` || value.endsWith(`entity=${expected}`);
}

type Cm01LiveStep =
  | "root-preflight"
  | "architecture-insert"
  | "root-readback"
  | "package-readback";
type LiveRecorder = (
  step: Cm01LiveStep,
  phase: "started" | "completed" | "failed",
) => Promise<void>;

function liveLabel(step: Cm01LiveStep): string {
  return step === "root-preflight"
    ? "CM-01 root package preflight"
    : step === "architecture-insert"
    ? "CM-01 architecture insertion"
    : step === "root-readback"
    ? "CM-01 root package read-back"
    : "CM-01 architecture package read-back";
}

function liveSummary(
  step: Cm01LiveStep,
  phase: "started" | "completed" | "failed",
): string {
  if (phase === "started") return `${liveLabel(step)} is running.`;
  if (phase === "failed") {
    return `${
      liveLabel(step)
    } did not complete; the live feed does not infer provider state.`;
  }
  return `${
    liveLabel(step)
  } completed; canonical evidence validation remains server-owned.`;
}

function artifactReference(snapshot: ThreadSnapshot): EngineeringThreadEntityRef {
  const artifact = snapshot.artifacts.find((candidate) =>
    candidate.id.startsWith("coffee-machine-cm01-v3-architecture-")
  );
  if (!artifact) {
    throw new Error("CM-01 architecture snapshot has no architecture-model artifact.");
  }
  return {
    snapshotId: snapshot.id,
    snapshotRevision: snapshot.revision,
    kind: "artifact",
    id: artifact.id,
  };
}

function assertCompleted(
  project: EngineeringProjectSnapshot,
  command: CoffeeMachineCm01V3ArchitectureRunExecutorCommand,
): void {
  const run = requireRun(project, command.runId);
  if (
    run.status !== "completed" || !run.resultSnapshot ||
    !project.commandReceipts?.some((receipt) =>
      receipt.commandId === commandStep(command.commandId, "complete")
    )
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `CM-01 architecture run ${command.runId} did not complete through this exact execution command.`,
    );
  }
}

function commandStep(commandId: string, step: string): string {
  return `${commandId}:coffee-machine-cm01-v3-architecture:${step}`;
}

function closed(
  value: unknown,
  keys: readonly string[],
  path: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) throw new Error(`${path} has an unsupported shape.`);
  return record;
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path} must be non-empty.`);
  }
  return value;
}

function nonEmpty(value: string, path: string): string {
  return nonEmptyString(value, path);
}
function timestamp(value: string): string {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error("capturedAt must be an ISO timestamp.");
  }
  return value;
}
function safeNow(now: () => string): string {
  const value = now();
  return Number.isNaN(Date.parse(value)) ? new Date().toISOString() : value;
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
async function sha256Text(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((item) => item.toString(16).padStart(2, "0"))
    .join("");
}
