/** Read-only, exact successor capture for the V4 inspection-drone architecture. */
import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  type EngineeringProjectCommandOrigin,
} from "../../../application/ports/in/engineering-project-command-origin.ts";
import {
  type EngineeringProjectRevisionStore,
} from "../../../application/ports/out/engineering-project-revision-store.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
} from "../../../domain/project/engineering-project.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import { applyThreadSnapshotExtensionIfNew } from "../../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import {
  INSPECTION_DRONE_V4_PART_DEFINITION_CONTRACT,
  INSPECTION_DRONE_V4_PART_USAGE_CONTRACT,
} from "../../../domain/inspection-drone/author/inspection-drone-v4-architecture.ts";
import {
  INSPECTION_DRONE_V4_PART_DEFINITIONS_OPERATION,
  INSPECTION_DRONE_V4_PART_DEFINITIONS_STATEMENT,
} from "../../../domain/inspection-drone/part-definitions/inspection-drone-v4-part-definitions.ts";
import {
  INSPECTION_DRONE_V4_ARCHITECTURE_URI_PREFIX,
  type InspectionDroneV4ArchitectureCapture,
  type InspectionDroneV4Element,
  parseInspectionDroneV4ArchitectureCapture,
} from "../author/inspection-drone-v4-architecture-capture.ts";
import {
  INSPECTION_DRONE_V4_PART_DEFINITIONS_CAPTURE_SCHEMA,
  INSPECTION_DRONE_V4_PART_DEFINITIONS_URI_PREFIX,
} from "./inspection-drone-v4-part-definitions-capture.ts";
import { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";
import type { McpToolClient } from "../../../application/ports/out/mcp-tool-client.ts";
import type { EngineeringProjectRunLease } from "../../shared/stores/file-engineering-project-run-lease.ts";
import type { FileInspectionDroneV4PartDefinitionsPublicationStore } from "./file-inspection-drone-v4-part-definitions-publication-store.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "../../shared/executor-run-helpers.ts";
import {
  assertThreadWriteBasisAvailable,
  threadWriteBasisLeaseScope,
} from "../../shared/thread-write-basis-guard.ts";

type Element = InspectionDroneV4Element;
type Structure = Readonly<
  { root: Element; tree: readonly Usage[]; partCount: number; maxDepthReached: boolean }
>;
type Usage = Readonly<
  {
    id: string;
    kind: string;
    label: string;
    quantity: number | string;
    quantitySource: string;
    children: readonly Usage[];
  }
>;
type Architecture = InspectionDroneV4ArchitectureCapture;
type PartDefinitionsInputs = Readonly<
  { base: ThreadSnapshot; artifact: ThreadArtifact; architecture: Architecture }
>;

export interface InspectionDroneV4PartDefinitionsRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}
export interface InspectionDroneV4PartDefinitionsRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore;
  readonly architectureCaptures: FileCaptureStore<"inspection-drone-v4-architecture">;
  readonly captures: FileCaptureStore<"inspection-drone-v4-part-definitions">;
  readonly syson: McpToolClient;
  readonly lease: EngineeringProjectRunLease;
  readonly publications: FileInspectionDroneV4PartDefinitionsPublicationStore;
}

/**
 * SysON is read-only, but a durable publication record bridges the local
 * snapshot-save to project-attachment boundary. It is append-only and lets a
 * crash resume without a second provider read.
 */
export class InspectionDroneV4PartDefinitionsRunExecutor {
  constructor(
    private readonly d: InspectionDroneV4PartDefinitionsRunExecutorDependencies,
  ) {}

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: InspectionDroneV4PartDefinitionsRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw denied(
        "Only an authenticated agent can capture inspection-drone PartDefinitions.",
      );
    }
    const initial = await this.project(command.projectId);
    const initialRun = requireRun(initial, command.runId);
    shape(initial, initialRun);
    return await this.d.lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(initialRun),
      async () => {
        let claimed = false;
        // Once save(r4) returned, failure to read it back is an outcome-unknown
        // durability boundary: leave the run active for exact recovery rather
        // than falsely recording a failed run beside an unattached r4.
        let persisted = false;
        let publicationPersisted = false;
        let publicationAttempted = false;
        try {
          let project = await this.project(command.projectId);
          let run = requireRun(project, command.runId);
          if (run.status === "completed") {
            const durable = await this.d.publications.read(project.project.id, run.id);
            if (!durable) {
              throw denied(
                "A completed inspection-drone PartDefinitions run has no durable publication record to verify or repair.",
              );
            }
            return await this.resumePublication(origin, command, project, run);
          }
          await assertThreadWriteBasisAvailable(project, run);
          if (run.status === "publishing" || run.status === "running") {
            const durable = await this.d.publications.read(project.project.id, run.id);
            if (durable) {
              return await this.resumePublication(origin, command, project, run);
            }
          }
          if (run.status === "publishing") {
            return await this.resumePublication(origin, command, project, run);
          }
          await this.inputs(project, run);
          await this.d.commands.claimRun(origin, {
            ...command,
            commandId: step(command.commandId, "claim"),
            summary: "Started the read-only inspection-drone PartDefinitions capture.",
          });
          claimed = true;
          project = await this.project(command.projectId);
          run = requireRun(project, command.runId);
          claim(project, run, origin);
          const input = await this.inputs(project, run);
          const structures: Array<{ definition: Element; structure: Structure }> = [];
          for (const label of INSPECTION_DRONE_V4_PART_DEFINITION_CONTRACT) {
            const definition = input.architecture.declarationByLabel.get(label)!;
            structures.push({
              definition,
              structure: await this.structure(
                input.architecture.editingContextId,
                definition,
              ),
            });
          }
          verifyStructures(structures, input.architecture);
          const capturedAt = requiredStart(run);
          const record = {
            schemaVersion: INSPECTION_DRONE_V4_PART_DEFINITIONS_CAPTURE_SCHEMA,
            kind: "inspection-drone-v4-part-definitions",
            scope: "read-only-product-structure",
            statement: INSPECTION_DRONE_V4_PART_DEFINITIONS_STATEMENT,
            capturedAt,
            trustedRunId: run.id,
            operation: INSPECTION_DRONE_V4_PART_DEFINITIONS_OPERATION,
            architecture: {
              artifactId: input.artifact.id,
              fingerprint: input.artifact.fingerprint,
              uri: input.artifact.uri,
              editingContextId: input.architecture.editingContextId,
              architecturePackage: input.architecture.package,
              recipe: { textSha256: input.architecture.recipeDigest },
              rootUsageTypes: input.architecture.rootUsages,
            },
            definitions: structures,
          } as const;
          const text = deterministicJson(record);
          const fingerprint = await sha256Fingerprint(record);
          await this.d.captures.save(fingerprint, text);
          if (await this.d.captures.read(fingerprint) !== text) {
            throw new Error(
              "The persisted inspection-drone PartDefinitions capture did not read back exactly.",
            );
          }
          const artifact = partDefinitionArtifact(
            fingerprint,
            run.id,
            capturedAt,
            input.artifact.id,
            this.d.captures.uriFor(fingerprint),
          );
          const snapshot = materialize(
            input.base,
            artifact,
            input.artifact,
            capturedAt,
            input.architecture.package.id,
          );
          publicationAttempted = true;
          await this.d.publications.save({
            schemaVersion: "inspection-drone-v4-part-definitions-publication/1.0",
            projectId: command.projectId,
            runId: run.id,
            fingerprint,
            snapshot,
          });
          publicationPersisted = true;
          // The WAL must exist before r4 can become durable: a crash after the
          // snapshot write is then recoverable without re-reading SysON.
          await this.d.snapshots.save(snapshot);
          persisted = true;
          const readback = await freshSnapshot(this.d.snapshots, snapshot.id);
          if (
            !readback || deterministicJson(readback) !== deterministicJson(snapshot)
          ) {
            throw new Error(
              "The persisted inspection-drone PartDefinitions snapshot did not read back exactly.",
            );
          }
          project = await this.project(command.projectId);
          run = requireRun(project, command.runId);
          if (run.status === "running") {
            await this.d.commands.publishRun(origin, {
              ...command,
              commandId: step(command.commandId, "publish"),
              expectedRevision: project.revision,
              summary:
                "Publishing the verified inspection-drone PartDefinitions capture.",
            });
          }
          project = await this.project(command.projectId);
          run = requireRun(project, command.runId);
          if (run.status === "publishing") {
            await this.d.commands.completeRun(origin, {
              ...command,
              commandId: step(command.commandId, "complete"),
              expectedRevision: project.revision,
              summary:
                "Recorded the exact inspection-drone PartDefinitions product-structure capture.",
              resultSnapshot: snapshotRef(snapshot),
              evidenceRefs: [artifactRef(snapshot)],
            });
          }
          return complete(await this.project(command.projectId), command);
        } catch (error) {
          const recoveredPublication = publicationAttempted && !publicationPersisted
            ? await this.d.publications.read(command.projectId, command.runId).catch(
              () => undefined,
            )
            : undefined;
          if (claimed && !persisted && !publicationPersisted && !recoveredPublication) {
            await this.fail(origin, command);
          }
          throw error;
        }
      },
    );
  }

  private async resumePublication(
    origin: EngineeringProjectCommandOrigin,
    command: InspectionDroneV4PartDefinitionsRunExecutorCommand,
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
  ): Promise<EngineeringProjectSnapshot> {
    shape(project, run);
    const publication = await this.d.publications.read(project.project.id, run.id);
    if (!publication) {
      throw denied(
        "The publishing PartDefinitions run has no durable exact publication record; it will not re-query SysON.",
      );
    }
    // Reuse the same read-only exact basis, work-item binding, r3 artifact,
    // architecture capture and seed-provenance checks as a fresh run.
    const input = await this.inputs(project, run);
    const basis = requireBasis(run);
    if (
      basis.kind !== "thread-snapshot" ||
      basis.subjectId !== "project:inspection-drone-v4" ||
      basis.revision !== 3 || publication.snapshot.subject.id !== basis.subjectId ||
      publication.snapshot.revision !== 4 ||
      publication.snapshot.previous?.snapshotId !== basis.snapshotId ||
      publication.snapshot.previous.revision !== basis.revision
    ) {
      throw denied(
        "The durable PartDefinitions publication does not advance the exact r3 run basis.",
      );
    }
    const capture = await this.d.captures.read(publication.fingerprint);
    if (!capture) {
      throw denied(
        "The publishing PartDefinitions run has no exact durable capture; it will not re-query SysON.",
      );
    }
    const expected = await reconstructPublication(input, run, capture);
    if (
      deterministicJson(expected.fingerprint) !==
        deterministicJson(publication.fingerprint) ||
      deterministicJson(expected.snapshot) !== deterministicJson(publication.snapshot)
    ) {
      throw denied(
        "The durable PartDefinitions publication does not reconstruct from the exact r3 capture and run.",
      );
    }
    let persisted = await freshSnapshot(this.d.snapshots, publication.snapshot.id);
    if (!persisted) {
      // A filesystem snapshot store may lose a just-written directory entry
      // across a crash.  The durable publication record is the source of the
      // exact bytes and restores it before any project attachment.
      await this.d.snapshots.save(publication.snapshot);
      persisted = await freshSnapshot(this.d.snapshots, publication.snapshot.id);
    }
    if (
      !persisted ||
      deterministicJson(persisted) !== deterministicJson(publication.snapshot)
    ) {
      throw denied(
        "The publishing PartDefinitions run has no exact durable capture and snapshot pair; it will not re-query SysON.",
      );
    }
    const artifact = partDefinitionArtifact(
      publication.fingerprint,
      run.id,
      requiredStart(run),
      input.artifact.id,
      this.d.captures.uriFor(publication.fingerprint),
    );
    if (run.status === "completed") {
      const expectedResult = snapshotRef(publication.snapshot);
      const expectedEvidence = [{
        snapshotId: publication.snapshot.id,
        snapshotRevision: publication.snapshot.revision,
        kind: "artifact" as const,
        id: artifact.id,
      }];
      if (
        deterministicJson(run.resultSnapshot) !== deterministicJson(expectedResult) ||
        deterministicJson(run.evidenceRefs) !== deterministicJson(expectedEvidence)
      ) {
        throw denied(
          "The completed PartDefinitions run does not attach the exact durable publication evidence.",
        );
      }
      return complete(project, command);
    }
    if (run.status === "running") {
      await this.d.commands.publishRun(origin, {
        ...command,
        commandId: step(command.commandId, "publish"),
        expectedRevision: project.revision,
        summary: "Publishing the verified inspection-drone PartDefinitions capture.",
      });
      project = await this.project(command.projectId);
      run = requireRun(project, command.runId);
    }
    if (run.status !== "publishing") throw unexpectedStatus(run, "publishing");
    await this.d.commands.completeRun(origin, {
      ...command,
      commandId: step(command.commandId, "complete"),
      expectedRevision: project.revision,
      summary:
        "Recorded the exact inspection-drone PartDefinitions product-structure capture.",
      resultSnapshot: snapshotRef(publication.snapshot),
      evidenceRefs: [{
        snapshotId: publication.snapshot.id,
        snapshotRevision: publication.snapshot.revision,
        kind: "artifact",
        id: artifact.id,
      }],
    });
    return complete(await this.project(command.projectId), command);
  }

  private async inputs(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
  ): Promise<PartDefinitionsInputs> {
    const basis = requireBasis(run);
    if (
      basis.kind !== "thread-snapshot" || basis.revision !== 3 ||
      basis.subjectId !== "project:inspection-drone-v4"
    ) {
      throw denied(
        "Inspection-drone PartDefinitions require the exact r3 architecture snapshot.",
      );
    }
    const base = await this.d.snapshots.get(basis.snapshotId);
    if (
      !base || base.id !== basis.snapshotId || base.revision !== 3 ||
      base.subject.id !== basis.subjectId
    ) {
      throw denied(
        "The exact r3 inspection-drone architecture snapshot is not readable.",
      );
    }
    validateThreadSnapshot(base);
    const artifact = one(
      base.artifacts.filter((a) =>
        a.kind === "sysml-model" &&
        a.id.startsWith("inspection-drone-v4-architecture-") &&
        a.uri?.startsWith(INSPECTION_DRONE_V4_ARCHITECTURE_URI_PREFIX)
      ),
      "architecture artifact",
    );
    const item = project.workItems.find((candidate) =>
      candidate.id === run.workItemId
    )!;
    const binding = item.operation!.bindings[0];
    if (
      binding?.source.kind !== "thread-entity" ||
      deterministicJson(binding.source.reference) !==
        deterministicJson({
          snapshotId: base.id,
          snapshotRevision: base.revision,
          kind: "artifact",
          id: artifact.id,
        })
    ) throw denied("The run does not bind the exact r3 architecture artifact.");
    const text = await this.d.architectureCaptures.read(artifact.fingerprint);
    if (!text) {
      throw denied("The exact content-addressed architecture capture is not readable.");
    }
    validateArchitectureArtifact(base, artifact);
    const architecture = parseInspectionDroneV4ArchitectureCapture(text, artifact);
    const seed = one(
      base.artifacts.filter((candidate) =>
        candidate.id === architecture.seed.artifactId
      ),
      "architecture capture seed artifact",
    );
    if (
      artifact.inputArtifactIds[0] !== seed.id ||
      deterministicJson(seed.fingerprint) !==
        deterministicJson(architecture.seed.fingerprint)
    ) {
      throw denied(
        "The architecture capture seed does not match the exact r3 artifact input.",
      );
    }
    return {
      base,
      artifact,
      architecture,
    };
  }

  private async structure(
    editingContextId: string,
    definition: Element,
  ): Promise<Structure> {
    const result = await this.d.syson.callTool({
      name: "syson_part_structure",
      arguments: {
        editing_context_id: editingContextId,
        root_element_id: definition.id,
        max_depth: 1,
        include_attributes: false,
        flatten: false,
      },
    });
    return parseStructure(result.structuredContent, definition);
  }

  private async project(id: string): Promise<EngineeringProjectSnapshot> {
    const project = await this.d.projects.get(id);
    if (!project) {
      throw new EngineeringProjectCommandError(
        "project_not_found",
        `Engineering project ${id} does not exist.`,
      );
    }
    return project;
  }
  private async fail(
    origin: EngineeringProjectCommandOrigin,
    command: InspectionDroneV4PartDefinitionsRunExecutorCommand,
  ): Promise<void> {
    try {
      const p = await this.project(command.projectId);
      const r = requireRun(p, command.runId);
      if (
        r.status === "running" && r.claimedBy?.origin === origin.kind &&
        r.claimedBy.id === origin.actorId
      ) {
        await this.d.commands.failRun(origin, {
          ...command,
          commandId: step(command.commandId, "fail"),
          expectedRevision: p.revision,
          summary:
            "Inspection-drone PartDefinitions capture stopped before publication.",
          code: "inspection-drone-v4-part-definitions-not-published",
          message:
            "The read-only PartDefinitions capture did not publish technical evidence.",
        });
      }
    } catch { /* original refusal wins */ }
  }
}

/** Rebuild the only r4 this exact r3/run/capture can authorize. */
async function reconstructPublication(
  input: PartDefinitionsInputs,
  run: EngineeringAgentRun,
  text: string,
): Promise<Readonly<{ fingerprint: ContentFingerprint; snapshot: ThreadSnapshot }>> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw denied("The durable PartDefinitions capture is not JSON.");
  }
  const record = closed(raw, [
    "architecture",
    "capturedAt",
    "definitions",
    "kind",
    "operation",
    "schemaVersion",
    "scope",
    "statement",
    "trustedRunId",
  ]);
  if (
    record.schemaVersion !== INSPECTION_DRONE_V4_PART_DEFINITIONS_CAPTURE_SCHEMA ||
    record.kind !== "inspection-drone-v4-part-definitions" ||
    record.scope !== "read-only-product-structure" ||
    record.statement !== INSPECTION_DRONE_V4_PART_DEFINITIONS_STATEMENT ||
    record.trustedRunId !== run.id || record.capturedAt !== requiredStart(run) ||
    !same(record.operation, INSPECTION_DRONE_V4_PART_DEFINITIONS_OPERATION) ||
    !Array.isArray(record.definitions)
  ) {
    throw denied(
      "The durable PartDefinitions capture does not attest this exact operation and run.",
    );
  }
  const architecture = closed(record.architecture, [
    "architecturePackage",
    "artifactId",
    "editingContextId",
    "fingerprint",
    "recipe",
    "rootUsageTypes",
    "uri",
  ]);
  const recipe = closed(architecture.recipe, ["textSha256"]);
  if (
    architecture.artifactId !== input.artifact.id ||
    deterministicJson(architecture.fingerprint) !==
      deterministicJson(input.artifact.fingerprint) ||
    architecture.uri !== input.artifact.uri ||
    architecture.editingContextId !== input.architecture.editingContextId ||
    deterministicJson(architecture.architecturePackage) !==
      deterministicJson(input.architecture.package) ||
    recipe.textSha256 !== input.architecture.recipeDigest ||
    !Array.isArray(architecture.rootUsageTypes) ||
    deterministicJson(architecture.rootUsageTypes) !==
      deterministicJson(input.architecture.rootUsages)
  ) {
    throw denied(
      "The durable PartDefinitions capture is not bound to the exact r3 architecture readback.",
    );
  }
  const structures = record.definitions.map((item, index) => {
    const candidate = closed(item, ["definition", "structure"]);
    const definition = element(
      candidate.definition,
      `definitions[${index}].definition`,
    );
    const expected = input.architecture.declarationByLabel.get(
      INSPECTION_DRONE_V4_PART_DEFINITION_CONTRACT[index] ?? "",
    );
    if (!expected || deterministicJson(definition) !== deterministicJson(expected)) {
      throw denied(
        "The durable PartDefinitions capture substitutes a reviewed PartDefinition.",
      );
    }
    return { definition, structure: parseStructure(candidate.structure, definition) };
  });
  verifyStructures(structures, input.architecture);
  const fingerprint = await sha256Fingerprint(raw);
  const artifact = partDefinitionArtifact(
    fingerprint,
    run.id,
    requiredStart(run),
    input.artifact.id,
    `${INSPECTION_DRONE_V4_PART_DEFINITIONS_URI_PREFIX}${fingerprint.digest}`,
  );
  return {
    fingerprint,
    snapshot: materialize(
      input.base,
      artifact,
      input.artifact,
      requiredStart(run),
      input.architecture.package.id,
    ),
  };
}

function shape(project: EngineeringProjectSnapshot, run: EngineeringAgentRun): void {
  const operation = project.workItems.find((item) => item.id === run.workItemId)
    ?.operation;
  if (
    project.project.id !== "inspection-drone-v4" ||
    project.project.subjectId !== "project:inspection-drone-v4" ||
    operation?.id !== INSPECTION_DRONE_V4_PART_DEFINITIONS_OPERATION.id ||
    operation.version !== INSPECTION_DRONE_V4_PART_DEFINITIONS_OPERATION.version ||
    operation.bindings.length !== 1 || operation.bindings[0]?.name !== "architecture"
  ) {
    throw denied(
      "This executor may run only the canonical inspection-drone V4 PartDefinitions operation.",
    );
  }
}
function claim(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
): void {
  shape(project, run);
  if (
    run.status !== "running" || run.claimedBy?.origin !== origin.kind ||
    run.claimedBy.id !== origin.actorId
  ) throw unexpectedStatus(run, "running");
}
function complete(
  project: EngineeringProjectSnapshot,
  command: InspectionDroneV4PartDefinitionsRunExecutorCommand,
): EngineeringProjectSnapshot {
  const run = requireRun(project, command.runId);
  if (
    run.status !== "completed" || !run.resultSnapshot ||
    !project.commandReceipts?.some((r) =>
      r.commandId === step(command.commandId, "complete")
    )
  ) {
    throw denied(
      "The inspection-drone PartDefinitions run did not complete through this exact command.",
    );
  }
  return project;
}
function denied(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_input", message);
}
function step(commandId: string, action: string): string {
  return `${commandId}:inspection-drone-v4-part-definitions:${action}`;
}

function validateArchitectureArtifact(
  base: ThreadSnapshot,
  artifact: ThreadArtifact,
): void {
  if (
    artifact.id !== `inspection-drone-v4-architecture-${artifact.fingerprint.digest}` ||
    artifact.version !== artifact.fingerprint.digest ||
    artifact.uri !==
      `${INSPECTION_DRONE_V4_ARCHITECTURE_URI_PREFIX}${artifact.fingerprint.digest}` ||
    artifact.inputArtifactIds.length !== 1
  ) {
    throw denied(
      "The architecture artifact does not have the exact r3 canonical identity.",
    );
  }
  const seed = one(
    base.artifacts.filter((candidate) => candidate.id === artifact.inputArtifactIds[0]),
    "architecture seed artifact",
  );
  const consumption = one(
    base.consumptions.filter((candidate) => candidate.artifactId === seed.id),
    "architecture seed consumption",
  );
  if (
    deterministicJson(consumption.observedFingerprint) !==
      deterministicJson(seed.fingerprint) ||
    consumption.status !== "verified" ||
    artifact.producer.runId !== consumption.consumer.runId
  ) {
    throw denied(
      "The r3 architecture artifact is not backed by its exact seed consumption.",
    );
  }
}

function parseStructure(value: unknown, expected: Element): Structure {
  const record = closed(value, ["maxDepthReached", "partCount", "root", "tree"]);
  const root = element(record.root, "partStructure.root");
  if (
    root.id !== expected.id || root.label !== expected.label ||
    !kind(root.kind, "PartDefinition") || !Array.isArray(record.tree) ||
    typeof record.partCount !== "number" || !Number.isSafeInteger(record.partCount) ||
    record.partCount < 0 || record.maxDepthReached !== false
  ) {
    throw new Error(
      `SysON cannot attest an untruncated PartDefinition structure for ${expected.label}.`,
    );
  }
  const tree = record.tree.map((item, index) =>
    usage(item, `partStructure.tree[${index}]`)
  );
  if (count(tree) !== record.partCount) {
    throw new Error(
      `SysON part count disagrees with the recursive tree for ${expected.label}.`,
    );
  }
  return { root, tree, partCount: record.partCount, maxDepthReached: false };
}
function verifyStructures(
  structures: readonly { definition: Element; structure: Structure }[],
  architecture: Architecture,
): void {
  if (
    structures.length !== 6 ||
    new Set(structures.map((item) => item.definition.id)).size !== 6
  ) {
    throw new Error(
      "PartDefinition extraction has an unexpected or duplicate identity.",
    );
  }
  const root = structures[0]!;
  if (
    root.definition.label !== "InspectionDrone" || root.structure.tree.length !== 5 ||
    root.structure.partCount !== 5 ||
    root.structure.tree.some((usage) =>
      usage.children.length !== 0 || usage.quantity !== 1 ||
      !usage.quantitySource.trim() || !kind(usage.kind, "PartUsage")
    )
  ) {
    throw new Error(
      "InspectionDrone structure must expose exactly five direct qualitative usages.",
    );
  }
  const byUsage = new Map(root.structure.tree.map((usage) => [usage.id, usage]));
  if (
    new Set(root.structure.tree.map((usage) => usage.label)).size !== 5 ||
    INSPECTION_DRONE_V4_PART_USAGE_CONTRACT.some((expected, index) =>
      root.structure.tree[index]?.label !== expected.label
    )
  ) {
    throw new Error(
      "InspectionDrone direct usages do not retain the exact reviewed order and labels.",
    );
  }
  for (const attested of architecture.rootUsages) {
    const usage = byUsage.get(attested.usage.id);
    if (
      !usage || usage.label !== attested.usage.label ||
      !kind(usage.kind, "PartUsage") || attested.type.id === root.definition.id
    ) {
      throw new Error(
        "PartDefinition provider readback drifts from the exact architecture usage/type identity.",
      );
    }
  }
  for (const child of structures.slice(1)) {
    if (
      child.structure.partCount !== 0 || child.structure.tree.length !== 0 ||
      !kind(child.definition.kind, "PartDefinition")
    ) {
      throw new Error(
        "Child PartDefinitions must attest an empty, untruncated structure.",
      );
    }
  }
}
function partDefinitionArtifact(
  fingerprint: ContentFingerprint,
  runId: string,
  capturedAt: string,
  architectureId: string,
  uri: string,
): ThreadArtifact {
  return {
    id: `inspection-drone-v4-part-definitions-${fingerprint.digest}`,
    name: "Inspection-drone V4 PartDefinitions product structure",
    kind: "sysml-model",
    version: fingerprint.digest,
    fingerprint,
    uri,
    mediaType: "application/json",
    producer: { serverId: "syson", tool: "syson_part_structure", runId },
    inputArtifactIds: [architectureId],
    freshness: { status: "fresh", changedAt: capturedAt, invalidatedByChangeIds: [] },
  };
}
function materialize(
  base: ThreadSnapshot,
  artifact: ThreadArtifact,
  architecture: ThreadArtifact,
  capturedAt: string,
  packageId: string,
): ThreadSnapshot {
  const consumption = {
    id: `consume-${architecture.id}-by-${artifact.id}`,
    artifactId: architecture.id,
    consumer: artifact.producer,
    observedFingerprint: architecture.fingerprint,
    verifiedAt: capturedAt,
    status: "verified" as const,
  };
  const applied = applyThreadSnapshotExtensionIfNew(base, {
    id: `capture-${artifact.id}`,
    name: "Capture the inspection-drone PartDefinitions from the exact architecture",
    subjectId: base.subject.id,
    capturedAt,
    artifacts: [artifact],
    consumptions: [consumption],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    proposedActions: [],
    provenance: [{
      id: `link-${artifact.id}-derived-from-${architecture.id}`,
      relation: "derived_from",
      from: { kind: "artifact", id: artifact.id },
      to: { kind: "artifact", id: architecture.id },
      rationale:
        "The read-only product-structure bundle re-read the exact qualitative architecture artifact.",
    }, {
      id: `link-${consumption.id}-uses-${architecture.id}`,
      relation: "uses",
      from: { kind: "consumption", id: consumption.id },
      to: { kind: "artifact", id: architecture.id },
      rationale: "The executor used only the architecture artifact attached to r3.",
    }],
    bindingProofs: [{ provider: "syson", kind: "package", id: packageId }],
  }, { appliedAt: capturedAt });
  if (!applied.applied || applied.snapshot.revision !== base.revision + 1) {
    throw new Error(
      "PartDefinitions evidence did not create exactly one descendant snapshot.",
    );
  }
  return applied.snapshot;
}
function artifactRef(snapshot: ThreadSnapshot): EngineeringThreadEntityRef {
  const artifact = snapshot.artifacts.find((candidate) =>
    candidate.id.startsWith("inspection-drone-v4-part-definitions-")
  );
  if (!artifact) {
    throw new Error("PartDefinitions snapshot is missing its bundle artifact.");
  }
  return {
    snapshotId: snapshot.id,
    snapshotRevision: snapshot.revision,
    kind: "artifact",
    id: artifact.id,
  };
}
function usage(value: unknown, path: string): Usage {
  const record = closed(value, [
    "children",
    "id",
    "kind",
    "label",
    "quantity",
    "quantitySource",
  ]);
  if (
    (typeof record.quantity !== "number" && typeof record.quantity !== "string") ||
    typeof record.quantitySource !== "string" || !record.quantitySource ||
    !Array.isArray(record.children)
  ) throw new Error(`${path} has no provider-attested quantity.`);
  return {
    id: nonEmpty(record.id, `${path}.id`),
    kind: nonEmpty(record.kind, `${path}.kind`),
    label: nonEmpty(record.label, `${path}.label`),
    quantity: record.quantity,
    quantitySource: record.quantitySource,
    children: record.children.map((child, index) =>
      usage(child, `${path}.children[${index}]`)
    ),
  };
}
function element(value: unknown, path: string): Element {
  const record = closed(value, ["id", "kind", "label"]);
  return {
    id: nonEmpty(record.id, `${path}.id`),
    kind: nonEmpty(record.kind, `${path}.kind`),
    label: nonEmpty(record.label, `${path}.label`),
  };
}
function closed(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Capture/provider response must be an object.");
  }
  const actual = Object.keys(value as Record<string, unknown>).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) throw new Error("Capture/provider response has an unsupported shape.");
  return value as Record<string, unknown>;
}
function one<T>(values: readonly T[], name: string): T {
  if (values.length !== 1) throw denied(`Expected exactly one ${name}.`);
  return values[0]!;
}
function same(value: unknown, expected: unknown): boolean {
  return deterministicJson(value) === deterministicJson(expected);
}
function nonEmpty(value: unknown, path: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`${path} must be non-empty.`);
  }
  return value;
}
function kind(value: string, expected: string): boolean {
  return value === `sysml::${expected}` || value.endsWith(`entity=${expected}`);
}
function count(tree: readonly Usage[]): number {
  return tree.reduce((total, item) => total + 1 + count(item.children), 0);
}

async function freshSnapshot(
  store: ThreadSnapshotStore,
  snapshotId: string,
): Promise<ThreadSnapshot | undefined> {
  const fresh = store as ThreadSnapshotStore & {
    getFresh?: (id: string) => Promise<ThreadSnapshot | undefined>;
  };
  return fresh.getFresh
    ? await fresh.getFresh(snapshotId)
    : await store.get(snapshotId);
}
