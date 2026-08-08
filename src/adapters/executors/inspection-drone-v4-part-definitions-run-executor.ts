/** Read-only, exact successor capture for the V4 inspection-drone architecture. */
import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandOrigin,
  type EngineeringProjectCommandService,
  type EngineeringProjectRevisionStore,
} from "../../domain/project/engineering-project-command-service.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
} from "../../domain/project/engineering-project.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import { applyThreadSnapshotExtensionIfNew } from "../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import {
  INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION,
  INSPECTION_DRONE_V4_PART_DEFINITIONS_OPERATION,
} from "../../orchestration/operations/inspection-drone-v4.ts";
import {
  INSPECTION_DRONE_V4_PART_USAGE_CONTRACT,
  INSPECTION_DRONE_V4_REQUIREMENT_CONTRACT,
} from "./inspection-drone-v4-architecture-run-executor.ts";
import { FileCaptureStore } from "../captures/file-capture-store.ts";
import type { McpToolClient } from "../mcp/http-mcp-tool-client.ts";
import type { EngineeringProjectRunLease } from "../stores/file-engineering-project-run-lease.ts";
import type { FileInspectionDroneV4PartDefinitionsPublicationStore } from "../wal/file-inspection-drone-v4-part-definitions-publication-store.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "./executor-run-helpers.ts";

export const INSPECTION_DRONE_V4_PART_DEFINITIONS_CAPTURE_SCHEMA =
  "inspection-drone-v4-part-definitions/1.0" as const;
export const INSPECTION_DRONE_V4_ARCHITECTURE_URI_PREFIX =
  "casys://inspection-drone-v4-architecture-capture/sha256/" as const;
export const INSPECTION_DRONE_V4_PART_DEFINITIONS_URI_PREFIX =
  "casys://inspection-drone-v4-part-definitions-capture/sha256/" as const;

export const INSPECTION_DRONE_V4_PART_DEFINITION_CONTRACT = [
  "InspectionDrone",
  "Airframe",
  "EnergySystem",
  "PropulsionSystem",
  "AvionicsAndFlightControl",
  "InspectionCameraPayload",
] as const;

type Element = Readonly<{ id: string; kind: string; label: string }>;
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
type Architecture = Readonly<
  {
    editingContextId: string;
    package: Element;
    recipeDigest: string;
    seed: Readonly<{
      artifactId: string;
      fingerprint: ContentFingerprint;
      rootPackageId: string;
    }>;
    declarationByLabel: ReadonlyMap<string, Element>;
    rootUsages: readonly Readonly<{ usage: Element; type: Element }>[];
  }
>;

const FIXED_ARCHITECTURE_RECIPE_DIGEST =
  "eba0ccf48143a0f3ef8f8f0b985b373a97ead0ed57e7cbd6dff717c56693a530" as const;
const REQUIRED_DECLARATIONS = [
  ...INSPECTION_DRONE_V4_PART_DEFINITION_CONTRACT.map((label) => ({
    label,
    kind: "PartDefinition",
  })),
  ...INSPECTION_DRONE_V4_REQUIREMENT_CONTRACT.map((requirement) => ({
    label: requirement.label,
    kind: "RequirementDefinition",
  })),
] as const;

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
    shape(initial, requireRun(initial, command.runId));
    return await this.d.lease.withLease(command.projectId, command.runId, async () => {
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
        if (run.status === "completed") return complete(project, command);
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
          statement:
            "Read-only PartDefinition structures from the exact qualitative architecture. No CAD, physics, quantity inference, manufacturing claim or verdict is recorded.",
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
        const readback = await this.d.snapshots.get(snapshot.id);
        if (!readback || deterministicJson(readback) !== deterministicJson(snapshot)) {
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
          ? await this.d.publications.read(command.projectId, command.runId).catch(() =>
            undefined
          )
          : undefined;
        if (claimed && !persisted && !publicationPersisted && !recoveredPublication) {
          await this.fail(origin, command);
        }
        throw error;
      }
    });
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
    let persisted = await this.d.snapshots.get(publication.snapshot.id);
    if (!persisted) {
      // A filesystem snapshot store may lose a just-written directory entry
      // across a crash.  The durable publication record is the source of the
      // exact bytes and restores it before any project attachment.
      await this.d.snapshots.save(publication.snapshot);
      persisted = await this.d.snapshots.get(publication.snapshot.id);
    }
    if (
      !capture || !persisted ||
      deterministicJson(persisted) !== deterministicJson(publication.snapshot)
    ) {
      throw denied(
        "The publishing PartDefinitions run has no exact durable capture and snapshot pair; it will not re-query SysON.",
      );
    }
    const artifact = one(
      publication.snapshot.artifacts.filter((candidate) =>
        candidate.id ===
          `inspection-drone-v4-part-definitions-${publication.fingerprint.digest}` &&
        deterministicJson(candidate.fingerprint) ===
          deterministicJson(publication.fingerprint)
      ),
      "durable PartDefinitions artifact",
    );
    if (
      artifact.uri !==
        `${INSPECTION_DRONE_V4_PART_DEFINITIONS_URI_PREFIX}${publication.fingerprint.digest}` ||
      artifact.version !== publication.fingerprint.digest ||
      artifact.producer.runId !== run.id || artifact.inputArtifactIds.length !== 1
    ) {
      throw denied(
        "The durable PartDefinitions publication artifact is not canonically bound to this run.",
      );
    }
    const base = await this.d.snapshots.get(basis.snapshotId);
    const architecture =
      base?.artifacts.filter((candidate) =>
        candidate.id === artifact.inputArtifactIds[0] &&
        candidate.id ===
          `inspection-drone-v4-architecture-${candidate.fingerprint.digest}` &&
        candidate.uri ===
          `${INSPECTION_DRONE_V4_ARCHITECTURE_URI_PREFIX}${candidate.fingerprint.digest}`
      ) ?? [];
    if (architecture.length !== 1) {
      throw denied(
        "The durable PartDefinitions publication does not name one exact r3 architecture input.",
      );
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
  ): Promise<
    { base: ThreadSnapshot; artifact: ThreadArtifact; architecture: Architecture }
  > {
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

/** Exported for fixture-backed, read-only contract tests. */
export function parseInspectionDroneV4ArchitectureCapture(
  text: string,
  artifact: ThreadArtifact,
): Architecture {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw denied("The exact architecture capture is not JSON.");
  }
  const record = closed(raw, [
    "architecturePackage",
    "authorization",
    "capturedAt",
    "declarations",
    "explicitTbd",
    "insertion",
    "kind",
    "operation",
    "readback",
    "recipe",
    "schemaVersion",
    "scope",
    "seed",
    "statement",
    "trustedRunId",
  ]);
  if (
    record.schemaVersion !== "inspection-drone-v4-architecture-capture/1.0" ||
    record.kind !== "inspection-drone-v4-architecture" ||
    !same(record.operation, INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION)
  ) {
    throw denied(
      "The architecture capture does not attest the reviewed V4 architecture operation.",
    );
  }
  if (
    !artifact.uri ||
    artifact.uri !==
      `${INSPECTION_DRONE_V4_ARCHITECTURE_URI_PREFIX}${artifact.fingerprint.digest}` ||
    !artifact.id.endsWith(artifact.fingerprint.digest)
  ) throw denied("The architecture artifact is not canonically content-addressed.");
  const seed = closed(record.seed, [
    "artifactId",
    "editingContextId",
    "fingerprint",
    "rootPackageId",
  ]);
  const pkg = element(record.architecturePackage, "architecturePackage");
  const recipe = closed(record.recipe, ["textSha256"]);
  const recipeFingerprint = fingerprint(recipe.textSha256, "recipe.textSha256");
  const insertion = closed(record.insertion, ["parentId", "textSha256"]);
  if (
    typeof seed.editingContextId !== "string" || !seed.editingContextId ||
    !kind(pkg.kind, "Package") || pkg.label !== "InspectionDroneArchitecture" ||
    recipeFingerprint.digest !== FIXED_ARCHITECTURE_RECIPE_DIGEST ||
    insertion.parentId !== seed.rootPackageId ||
    insertion.textSha256 !== recipeFingerprint.digest
  ) {
    throw denied(
      "The architecture capture has no exact SysON context, package, or recipe identity.",
    );
  }
  if (
    !Array.isArray(record.declarations) ||
    !Array.isArray(
      closed(record.readback, [
        "inspectionDrone",
        "partUsages",
        "provider",
        "requirements",
      ]).partUsages,
    )
  ) throw denied("The architecture capture has no exact declaration/readback list.");
  const seedFingerprint = fingerprint(seed.fingerprint, "seed.fingerprint");
  if (
    typeof seed.artifactId !== "string" || !seed.artifactId ||
    typeof seed.rootPackageId !== "string" || !seed.rootPackageId
  ) throw denied("The architecture capture has an invalid seed identity.");
  const declarations = record.declarations.map((item, index) =>
    element(item, `declarations[${index}]`)
  );
  const byLabel = new Map(declarations.map((item) => [item.label, item]));
  if (
    declarations.length !== REQUIRED_DECLARATIONS.length ||
    byLabel.size !== REQUIRED_DECLARATIONS.length ||
    new Set(declarations.map((item) => item.id)).size !==
      REQUIRED_DECLARATIONS.length ||
    REQUIRED_DECLARATIONS.some((expected, index) =>
      declarations[index]?.label !== expected.label ||
      !kind(declarations[index]?.kind ?? "", expected.kind)
    )
  ) {
    throw denied(
      "The architecture capture does not contain exactly the six reviewed PartDefinition identities.",
    );
  }
  const readback = closed(record.readback, [
    "inspectionDrone",
    "partUsages",
    "provider",
    "requirements",
  ]);
  const root = element(readback.inspectionDrone, "readback.inspectionDrone");
  if (
    root.id !== byLabel.get("InspectionDrone")!.id ||
    root.label !== "InspectionDrone" || !kind(root.kind, "PartDefinition")
  ) {
    throw denied(
      "The architecture readback root does not match the captured InspectionDrone identity.",
    );
  }
  const rawUsages = readback.partUsages;
  if (!Array.isArray(rawUsages)) {
    throw denied("The architecture capture has no exact PartUsage readback list.");
  }
  const rootUsages = rawUsages.map((item, index) => {
    const itemRecord = closed(item, ["type", "usage"]);
    return {
      usage: element(itemRecord.usage, `partUsages[${index}].usage`),
      type: element(itemRecord.type, `partUsages[${index}].type`),
    };
  });
  if (
    rootUsages.length !== INSPECTION_DRONE_V4_PART_USAGE_CONTRACT.length ||
    new Set(rootUsages.map((item) => item.usage.id)).size !== 5 ||
    new Set(rootUsages.map((item) => item.type.id)).size !== 5 ||
    INSPECTION_DRONE_V4_PART_USAGE_CONTRACT.some((expected) => {
      const matches = rootUsages.filter((item) =>
        item.usage.label === expected.label && kind(item.usage.kind, "PartUsage") &&
        item.type.label === expected.type && kind(item.type.kind, "PartDefinition") &&
        item.type.id === byLabel.get(expected.type)!.id
      );
      return matches.length !== 1;
    })
  ) {
    throw denied(
      "The architecture readback does not bind the five exact PartUsage type identities.",
    );
  }
  const requirements = readback.requirements;
  if (
    !Array.isArray(requirements) ||
    requirements.length !== INSPECTION_DRONE_V4_REQUIREMENT_CONTRACT.length
  ) {
    throw denied(
      "The architecture capture does not contain the four reviewed requirement attestations.",
    );
  }
  for (let index = 0; index < requirements.length; index++) {
    const item = closed(requirements[index], ["documentation", "requirement"]);
    const requirement = element(item.requirement, `requirements[${index}].requirement`);
    const expected = INSPECTION_DRONE_V4_REQUIREMENT_CONTRACT[index]!;
    if (
      requirement.label !== expected.label ||
      requirement.id !== byLabel.get(expected.label)!.id ||
      !kind(requirement.kind, "RequirementDefinition") ||
      item.documentation !== expected.documentation
    ) {
      throw denied(
        "The architecture capture requirement evidence differs from the fixed reviewed contract.",
      );
    }
  }
  return {
    editingContextId: seed.editingContextId,
    package: pkg,
    recipeDigest: recipeFingerprint.digest,
    seed: {
      artifactId: seed.artifactId,
      fingerprint: seedFingerprint,
      rootPackageId: seed.rootPackageId,
    },
    declarationByLabel: byLabel,
    rootUsages,
  };
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

function fingerprint(value: unknown, path: string): ContentFingerprint {
  const record = closed(value, ["algorithm", "digest"]);
  if (
    record.algorithm !== "sha256" || typeof record.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.digest)
  ) {
    throw denied(`${path} is not a SHA-256 content fingerprint.`);
  }
  return { algorithm: "sha256", digest: record.digest };
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
