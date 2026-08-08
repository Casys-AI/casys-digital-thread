import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandOrigin,
  type EngineeringProjectCommandService,
  type EngineeringProjectRevisionStore,
} from "../../domain/project/engineering-project-command-service.ts";
import type {
  EngineeringAgentRun,
  EngineeringApprovedBriefBasis,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringWorkItem,
} from "../../domain/project/engineering-project.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import {
  parseSysonModelSeedCapture,
  requireExactSysonModelSeed,
} from "../../domain/platform/syson-model-seed.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import { applyThreadSnapshotExtensionIfNew } from "../../domain/thread/thread-snapshot-extension.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import { INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION } from "../../orchestration/operations/inspection-drone-v4.ts";
import { FileCaptureStore } from "../captures/file-capture-store.ts";
import type { McpToolClient } from "../mcp/http-mcp-tool-client.ts";
import type { EngineeringProjectRunLease } from "../stores/file-engineering-project-run-lease.ts";
import {
  FileInspectionDroneV4ArchitectureAttemptStore,
  InspectionDroneV4ArchitectureWriteOutcomeUnknownError,
} from "../wal/file-inspection-drone-v4-architecture-attempt-store.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "./executor-run-helpers.ts";

export const INSPECTION_DRONE_V4_ARCHITECTURE_CAPTURE_SCHEMA =
  "inspection-drone-v4-architecture-capture/1.0" as const;

/** Fixed server-owned SysML; it intentionally has no numeric technical claim. */
export const INSPECTION_DRONE_V4_ARCHITECTURE_SYSML = [
  "package InspectionDroneArchitecture {",
  "  part def InspectionDrone {",
  "    part airframe: Airframe;",
  "    part energySystem: EnergySystem;",
  "    part propulsionSystem: PropulsionSystem;",
  "    part avionicsAndFlightControl: AvionicsAndFlightControl;",
  "    part inspectionCameraPayload: InspectionCameraPayload;",
  "  }",
  "  part def Airframe;",
  "  part def EnergySystem;",
  "  part def PropulsionSystem;",
  "  part def AvionicsAndFlightControl;",
  "  part def InspectionCameraPayload;",
  "  requirement def ControlledOutdoorInspection {",
  "    doc /* Qualitative scope only: a first visual inspection mission is considered on a controlled outdoor site with a lightweight camera. TBD before any test: site scenario, route, altitude, obstacles, weather limits and separation from people. */",
  "  }",
  "  requirement def CameraPayloadIntegration {",
  "    doc /* The initial payload is a lightweight camera. TBD before any mass budget, energy sizing or structural verification: camera mass, power, dimensions, fixation and integration constraints. */",
  "  }",
  "  requirement def ExplicitOperationalTbd {",
  "    doc /* TBD: autonomy, admissible wind and battery reserve are not fixed; derive and review them from the mission scenario, site, characterised payload and an explicit reserve policy. */",
  "  }",
  "  requirement def TraceableEngineeringEvidence {",
  "    doc /* Maintain traceable links between the approved brief, SysML model, CAD, physical calculations, named requirements and manufacturing dossier through exact artifacts and consumptions, with visible assumptions and gaps. This is not a certification or authorization verdict. */",
  "  }",
  "}",
].join("\n");

/**
 * Server-fixed read-only AQL expressions. They exist solely to attest the
 * result of the fixed insertion; no caller can provide or change either one.
 */
export const INSPECTION_DRONE_V4_PART_USAGE_FEATURE_TYPING_EXPRESSION =
  "aql:self.ownedRelationship->select(r | r.oclIsKindOf(sysml::FeatureTyping)).type" as const;
export const INSPECTION_DRONE_V4_REQUIREMENT_DOCUMENTATION_EXPRESSION =
  "aql:self.eAllContents()->select(e | e.oclIsKindOf(sysml::Documentation))->first().body" as const;

export const INSPECTION_DRONE_V4_PART_USAGE_CONTRACT = [
  { label: "airframe", type: "Airframe" },
  { label: "energySystem", type: "EnergySystem" },
  { label: "propulsionSystem", type: "PropulsionSystem" },
  {
    label: "avionicsAndFlightControl",
    type: "AvionicsAndFlightControl",
  },
  {
    label: "inspectionCameraPayload",
    type: "InspectionCameraPayload",
  },
] as const;

export const INSPECTION_DRONE_V4_REQUIREMENT_CONTRACT = [
  {
    label: "ControlledOutdoorInspection",
    documentation:
      "Qualitative scope only: a first visual inspection mission is considered on a controlled outdoor site with a lightweight camera. TBD before any test: site scenario, route, altitude, obstacles, weather limits and separation from people.",
  },
  {
    label: "CameraPayloadIntegration",
    documentation:
      "The initial payload is a lightweight camera. TBD before any mass budget, energy sizing or structural verification: camera mass, power, dimensions, fixation and integration constraints.",
  },
  {
    label: "ExplicitOperationalTbd",
    documentation:
      "TBD: autonomy, admissible wind and battery reserve are not fixed; derive and review them from the mission scenario, site, characterised payload and an explicit reserve policy.",
  },
  {
    label: "TraceableEngineeringEvidence",
    documentation:
      "Maintain traceable links between the approved brief, SysML model, CAD, physical calculations, named requirements and manufacturing dossier through exact artifacts and consumptions, with visible assumptions and gaps. This is not a certification or authorization verdict.",
  },
] as const;

const EXPECTED_PART_DEFINITIONS = [
  "InspectionDrone",
  "Airframe",
  "EnergySystem",
  "PropulsionSystem",
  "AvionicsAndFlightControl",
  "InspectionCameraPayload",
] as const;

const EXPECTED_DECLARATIONS = [
  ...EXPECTED_PART_DEFINITIONS,
  ...INSPECTION_DRONE_V4_REQUIREMENT_CONTRACT.map((requirement) => requirement.label),
] as const;

export interface InspectionDroneV4ArchitectureRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface InspectionDroneV4ArchitectureRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore;
  readonly seedCaptures: Pick<FileCaptureStore<"syson-model-seed">, "read">;
  readonly captures: FileCaptureStore<"inspection-drone-v4-architecture">;
  readonly attempts: FileInspectionDroneV4ArchitectureAttemptStore;
  readonly syson: McpToolClient;
  readonly lease: EngineeringProjectRunLease;
  readonly now?: () => string;
}

type Element = Readonly<{ id: string; kind: string; label: string }>;
type PartUsage = Readonly<{
  id: string;
  kind: string;
  label: string;
  quantity: number | string;
  quantitySource: string;
  children: readonly PartUsage[];
}>;
type ArchitectureReadback = Readonly<{
  inspectionDrone: Element;
  partUsages: readonly Readonly<{ usage: Element; type: Element }>[];
  requirements: readonly Readonly<{
    requirement: Element;
    documentation: string;
  }>[];
}>;
type Seed = Awaited<ReturnType<typeof requireExactSysonModelSeed>>;
type Inputs = Readonly<
  { base: ThreadSnapshot; seed: Seed; briefBasis: EngineeringApprovedBriefBasis }
>;

/**
 * Bounded one-insert executor for the exact human-approved inspection-drone
 * V4 project. Inputs, provider/tool names and SysML are server-owned.
 */
export class InspectionDroneV4ArchitectureRunExecutor {
  readonly #now: () => string;
  constructor(
    private readonly dependencies: InspectionDroneV4ArchitectureRunExecutorDependencies,
  ) {
    this.#now = dependencies.now ?? (() => new Date().toISOString());
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: InspectionDroneV4ArchitectureRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute the queued inspection-drone architecture run.",
      );
    }
    const project = await this.requiredProject(command.projectId);
    requireShape(project, requireRun(project, command.runId));
    return await this.dependencies.lease.withLease(
      command.projectId,
      command.runId,
      () => this.executeLeased(origin, command),
    );
  }

  private async executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: InspectionDroneV4ArchitectureRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let providerAcknowledged = false;
    let persisted = false;
    try {
      const before = await this.requiredProject(command.projectId);
      const beforeRun = requireRun(before, command.runId);
      requireShape(before, beforeRun);
      await this.inputs(before, beforeRun);
      await this.dependencies.commands.claimRun(origin, {
        ...command,
        commandId: step(command.commandId, "claim"),
        summary:
          "Started the bounded qualitative inspection-drone SysON architecture authoring run.",
      });
      claimed = true;
      let project = await this.requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireClaim(project, run, origin);
      if (run.status === "completed") return this.completed(project, command);
      if (run.status !== "running") throw unexpectedStatus(run, "running");

      const inputs = await this.inputs(project, run);
      const rootId = inputs.seed.normalizedResults.rootPackage.id;
      const existing = await this.dependencies.attempts.read(
        project.project.id,
        run.id,
      );
      let acknowledgement: { parentId: string; textSha256: string };
      if (existing?.status === "completed" && existing.result) {
        acknowledgement = existing.result;
        requireAcknowledgement(acknowledgement, rootId);
        providerAcknowledged = true;
      } else {
        if (existing?.status === "dispatched") {
          throw new InspectionDroneV4ArchitectureWriteOutcomeUnknownError();
        }
        const rootBefore = await this.children(
          inputs.seed.normalizedResults.project.editingContextId,
          rootId,
        );
        if (rootBefore.length !== 0) {
          throw new Error(
            "The exact SysON seed root must be empty before the bounded architecture insertion.",
          );
        }
        const began = await this.dependencies.attempts.begin({
          projectId: project.project.id,
          runId: run.id,
          dispatchedAt: requiredStart(run),
        });
        if (began.action === "completed") {
          acknowledgement = began.result;
        } else {
          const response = await this.dependencies.syson.callTool({
            name: "syson_element_insert_sysml",
            arguments: {
              editing_context_id:
                inputs.seed.normalizedResults.project.editingContextId,
              parent_id: rootId,
              sysml_text: INSPECTION_DRONE_V4_ARCHITECTURE_SYSML,
            },
          });
          acknowledgement = await normalizeInsertion(
            response.structuredContent,
            rootId,
          );
          await this.dependencies.attempts.complete({
            projectId: project.project.id,
            runId: run.id,
            result: acknowledgement,
          });
        }
        requireAcknowledgement(acknowledgement, rootId);
        providerAcknowledged = true;
      }

      const rootAfter = await this.children(
        inputs.seed.normalizedResults.project.editingContextId,
        rootId,
      );
      const architecturePackage = onlyPackage(rootAfter, rootId);
      const declarations = await this.children(
        inputs.seed.normalizedResults.project.editingContextId,
        architecturePackage.id,
      );
      requireDeclarations(declarations, architecturePackage.id);
      const readback = await this.readContractualReadback(
        inputs.seed.normalizedResults.project.editingContextId,
        declarations,
      );
      const capturedAt = requiredStart(run);
      const materialized = await materialize({
        base: inputs.base,
        seed: inputs.seed,
        briefBasis: inputs.briefBasis,
        runId: run.id,
        capturedAt,
        acknowledgement,
        architecturePackage,
        declarations,
        readback,
      });
      await this.dependencies.captures.save(materialized.sha256, materialized.text);
      const captureReadback = await this.dependencies.captures.read(
        materialized.sha256,
      );
      if (captureReadback !== materialized.text) {
        throw new Error(
          "The persisted inspection-drone architecture capture did not read back exactly.",
        );
      }
      await this.dependencies.snapshots.save(materialized.snapshot);
      // A successful save is the durability boundary.  If its following
      // readback is unavailable, preserve the running journal for recovery;
      // do not manufacture a failed result next to an unattached r3/r4.
      persisted = true;
      const snapshotReadback = await this.dependencies.snapshots.get(
        materialized.snapshot.id,
      );
      if (
        !snapshotReadback ||
        deterministicJson(snapshotReadback) !== deterministicJson(materialized.snapshot)
      ) {
        throw new Error(
          "The persisted inspection-drone architecture snapshot did not read back exactly.",
        );
      }

      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.dependencies.commands.publishRun(origin, {
          ...command,
          commandId: step(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary:
            "Publishing the verified qualitative inspection-drone SysON architecture.",
        });
      } else if (run.status !== "publishing" && run.status !== "completed") {
        throw unexpectedStatus(run, "publishing");
      }
      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.dependencies.commands.completeRun(origin, {
          ...command,
          commandId: step(command.commandId, "complete"),
          expectedRevision: project.revision,
          summary: "Recorded the bounded qualitative inspection-drone architecture.",
          resultSnapshot: snapshotRef(materialized.snapshot),
          evidenceRefs: [artifactRef(materialized.snapshot)],
        });
      } else if (run.status !== "completed") throw unexpectedStatus(run, "completed");
      return this.completed(await this.requiredProject(command.projectId), command);
    } catch (error) {
      if (claimed && !providerAcknowledged && !persisted) {
        await this.recordFailure(origin, command);
      }
      throw error;
    }
  }

  private async inputs(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
  ): Promise<Inputs> {
    const basis = requireBasis(run);
    if (
      basis.kind !== "thread-snapshot" || basis.revision !== 2 ||
      basis.subjectId !== "project:inspection-drone-v4"
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "Inspection-drone architecture requires the exact r2 inspection-drone-v4 SysON seed snapshot.",
      );
    }
    const base = await this.dependencies.snapshots.get(basis.snapshotId);
    if (
      !base || base.id !== basis.snapshotId || base.revision !== basis.revision ||
      base.subject.id !== basis.subjectId
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The exact r2 SysON seed snapshot is not readable.",
      );
    }
    validateThreadSnapshot(base);
    const seedArtifact = base.artifacts.filter((artifact) =>
      artifact.kind === "sysml-model" && artifact.id.startsWith("syson-model-seed-")
    );
    if (seedArtifact.length !== 1) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The exact r2 snapshot must contain exactly one SysON model-seed artifact.",
      );
    }
    const workItem = requireShape(project, run);
    const seedBinding = workItem.operation!.bindings.find((binding) =>
      binding.name === "sysonModelSeed"
    );
    if (
      seedBinding?.source.kind !== "thread-entity" ||
      deterministicJson(seedBinding.source.reference) !==
        deterministicJson({
          snapshotId: base.id,
          snapshotRevision: base.revision,
          kind: "artifact",
          id: seedArtifact[0]!.id,
        })
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The architecture run does not bind the exact r2 SysON seed artifact.",
      );
    }
    const text = await this.dependencies.seedCaptures.read(
      seedArtifact[0]!.fingerprint,
    );
    if (text === undefined) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The exact SysON model-seed capture is not readable.",
      );
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The exact SysON model-seed capture is not JSON.",
      );
    }
    const seedCapture = parseSysonModelSeedCapture(raw);
    const seed = await requireExactSysonModelSeed(base, seedCapture);
    const brief = project.framing?.currentBriefApproval;
    const approved = project.framing?.currentBrief;
    if (
      !brief || brief.status !== "approved" || !approved ||
      project.project.id !== "inspection-drone-v4" ||
      project.project.subjectId !== "project:inspection-drone-v4"
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "This operation is reserved for the exact approved inspection-drone-v4 brief.",
      );
    }
    const briefBasis = seedCapture.lineage.approvedBriefBasis;
    if (
      briefBasis.projectId !== project.project.id ||
      briefBasis.briefId !== approved.briefId ||
      briefBasis.briefSnapshotId !== approved.id ||
      briefBasis.briefRevision !== approved.revision ||
      !fingerprintsEqual(briefBasis.approvedBriefFingerprint, brief.inputFingerprint) ||
      !seed.normalizedResults.project.editingContextId ||
      !sameBriefBasis(seedArtifact[0]!, project, run, briefBasis)
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The architecture run is not linked to the exact approved brief lineage preserved by its SysON seed.",
      );
    }
    return { base, seed, briefBasis };
  }

  private async children(
    editingContextId: string,
    elementId: string,
  ): Promise<readonly Element[]> {
    const result = await this.dependencies.syson.callTool({
      name: "syson_element_children",
      arguments: { editing_context_id: editingContextId, element_id: elementId },
    });
    return parseChildren(result.structuredContent, elementId);
  }

  /**
   * A top-level declaration list is not evidence of the intended architecture.
   * Re-read the root part structure, then ask the provider for each usage's
   * type and each requirement's documentation. Every response is closed and
   * exact: a SysON release that cannot attest one fact stops before r3 rather
   * than letting this executor infer it from the SysML text it sent.
   */
  private async readContractualReadback(
    editingContextId: string,
    declarations: readonly Element[],
  ): Promise<ArchitectureReadback> {
    const inspectionDrone = declaration(
      declarations,
      "InspectionDrone",
      "inspection-drone architecture package",
    );
    const structure = await this.dependencies.syson.callTool({
      name: "syson_part_structure",
      arguments: {
        editing_context_id: editingContextId,
        root_element_id: inspectionDrone.id,
        max_depth: 1,
        include_attributes: false,
        flatten: false,
      },
    });
    const usages = requirePartUsages(
      structure.structuredContent,
      inspectionDrone,
    );
    const partUsages: Array<{ usage: Element; type: Element }> = [];
    for (const expected of INSPECTION_DRONE_V4_PART_USAGE_CONTRACT) {
      const usage = usages.get(expected.label);
      if (!usage) {
        throw new Error(
          `SysON part-structure readback is missing the required ${expected.label} PartUsage.`,
        );
      }
      const expectedType = declaration(
        declarations,
        expected.type,
        "inspection-drone architecture package",
      );
      const typed = await this.dependencies.syson.callTool({
        name: "syson_query_aql",
        arguments: {
          editing_context_id: editingContextId,
          object_id: usage.id,
          expression: INSPECTION_DRONE_V4_PART_USAGE_FEATURE_TYPING_EXPRESSION,
        },
      });
      partUsages.push({
        usage: partUsageElement(usage),
        type: requirePartUsageType(
          typed.structuredContent,
          usage,
          expectedType,
        ),
      });
    }

    const requirements: Array<{ requirement: Element; documentation: string }> = [];
    for (const expected of INSPECTION_DRONE_V4_REQUIREMENT_CONTRACT) {
      const requirement = declaration(
        declarations,
        expected.label,
        "inspection-drone architecture package",
      );
      const documented = await this.dependencies.syson.callTool({
        name: "syson_query_aql",
        arguments: {
          editing_context_id: editingContextId,
          object_id: requirement.id,
          expression: INSPECTION_DRONE_V4_REQUIREMENT_DOCUMENTATION_EXPRESSION,
        },
      });
      requirements.push({
        requirement,
        documentation: requireRequirementDocumentation(
          documented.structuredContent,
          requirement,
          expected.documentation,
        ),
      });
    }
    return { inspectionDrone, partUsages, requirements };
  }

  private async recordFailure(
    origin: EngineeringProjectCommandOrigin,
    command: InspectionDroneV4ArchitectureRunExecutorCommand,
  ): Promise<void> {
    try {
      const project = await this.requiredProject(command.projectId);
      const run = requireRun(project, command.runId);
      if (
        run.status === "running" && run.claimedBy?.origin === origin.kind &&
        run.claimedBy.id === origin.actorId
      ) {
        await this.dependencies.commands.failRun(origin, {
          ...command,
          commandId: step(command.commandId, "fail"),
          expectedRevision: project.revision,
          summary:
            "Inspection-drone architecture stopped before a SysON insertion was acknowledged.",
          code: "inspection-drone-v4-architecture-not-published",
          message:
            "The bounded inspection-drone architecture did not publish technical evidence.",
        });
      }
    } catch { /* preserve original failure */ }
  }

  private completed(
    project: EngineeringProjectSnapshot,
    command: InspectionDroneV4ArchitectureRunExecutorCommand,
  ): EngineeringProjectSnapshot {
    const run = requireRun(project, command.runId);
    if (
      run.status !== "completed" || !run.resultSnapshot ||
      !project.commandReceipts?.some((receipt) =>
        receipt.commandId === step(command.commandId, "complete")
      )
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "The inspection-drone architecture did not complete through this exact execution command.",
      );
    }
    return project;
  }

  private async requiredProject(
    projectId: string,
  ): Promise<EngineeringProjectSnapshot> {
    const project = await this.dependencies.projects.get(projectId);
    if (!project) {
      throw new EngineeringProjectCommandError(
        "project_not_found",
        `Engineering project ${projectId} does not exist.`,
      );
    }
    return project;
  }
}

function requireShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): EngineeringWorkItem {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const operation = workItem?.operation;
  if (
    project.schemaVersion !== "3.0" || project.project.id !== "inspection-drone-v4" ||
    project.project.subjectId !== "project:inspection-drone-v4" || !workItem ||
    operation?.id !== INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION.id ||
    operation.version !== INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION.version ||
    operation.bindings.length !== 2 ||
    operation.bindings.filter((binding) =>
        binding.name === "approvedBrief" && binding.source.kind === "approved-brief"
      ).length !== 1 ||
    operation.bindings.filter((binding) =>
        binding.name === "sysonModelSeed" && binding.source.kind === "thread-entity"
      ).length !== 1
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the canonical inspection-drone-v4 architecture @3 operation.",
    );
  }
  return workItem;
}

function requireClaim(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
): void {
  requireShape(project, run);
  if (run.claimedBy?.origin !== origin.kind || run.claimedBy.id !== origin.actorId) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the exact architecture run it claimed.",
    );
  }
}

function sameBriefBasis(
  seedArtifact: ThreadArtifact,
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  briefBasis: EngineeringApprovedBriefBasis,
): boolean {
  const change = (project.planChanges ?? []).filter((item) =>
    item.workItemIds.includes(run.workItemId)
  );
  const basis = run.basis;
  if (basis?.kind !== "thread-snapshot") return false;
  return change.length === 1 && !!change[0]!.approvedBriefBasis &&
    deterministicJson(change[0]!.approvedBriefBasis) ===
      deterministicJson(briefBasis) &&
    deterministicJson(change[0]!.baseSnapshot) === deterministicJson({
        snapshotId: basis.snapshotId,
        revision: basis.revision,
        subjectId: basis.subjectId,
      }) &&
    project.threadSnapshots.some((snapshot) =>
      snapshot.snapshotId === basis.snapshotId
    ) && !!seedArtifact.id;
}

async function normalizeInsertion(
  value: unknown,
  rootId: string,
): Promise<{ parentId: string; textSha256: string }> {
  const record = closed(
    value,
    ["inserted", "parentId", "text"],
    "SysON insertion response",
  );
  if (
    record.inserted !== true || record.parentId !== rootId ||
    typeof record.text !== "string"
  ) {
    throw new Error(
      "SysON insertion response does not acknowledge the exact root and recipe.",
    );
  }
  const expected = await sha256Fingerprint(INSPECTION_DRONE_V4_ARCHITECTURE_SYSML);
  const received = await sha256Fingerprint(record.text);
  if (!fingerprintsEqual(expected, received)) {
    throw new Error(
      "SysON insertion response text differs from the fixed inspection-drone recipe.",
    );
  }
  return { parentId: rootId, textSha256: expected.digest };
}

function requireAcknowledgement(
  value: { parentId: string; textSha256: string },
  rootId: string,
): void {
  if (value.parentId !== rootId) {
    throw new InspectionDroneV4ArchitectureWriteOutcomeUnknownError();
  }
}

function parseChildren(value: unknown, parentId: string): readonly Element[] {
  const record = closed(
    value,
    ["parentId", "children", "count"],
    "SysON children response",
  );
  if (
    record.parentId !== parentId || !Array.isArray(record.children) ||
    record.count !== record.children.length
  ) throw new Error("SysON children response does not match its requested parent.");
  return record.children.map((value, index) => {
    const child = closed(value, ["id", "kind", "label"], `SysON child ${index}`);
    return {
      id: string(child.id, `SysON child ${index}.id`),
      kind: string(child.kind, `SysON child ${index}.kind`),
      label: string(child.label, `SysON child ${index}.label`),
    };
  });
}

function onlyPackage(children: readonly Element[], rootId: string): Element {
  if (
    children.length !== 1 || children[0]!.label !== "InspectionDroneArchitecture" ||
    !kind(children[0]!.kind, "Package")
  ) {
    throw new Error(
      `SysON root ${rootId} must contain exactly the InspectionDroneArchitecture package after insertion.`,
    );
  }
  return children[0]!;
}

function requireDeclarations(children: readonly Element[], parentId: string): void {
  if (
    children.length !== EXPECTED_DECLARATIONS.length ||
    new Set(children.map((item) => item.label)).size !== children.length ||
    EXPECTED_DECLARATIONS.some((label) =>
      !children.some((item) => item.label === label)
    ) || children.some((item) =>
      !kind(
        item.kind,
        INSPECTION_DRONE_V4_REQUIREMENT_CONTRACT.some((requirement) =>
            requirement.label === item.label
          )
          ? "RequirementDefinition"
          : "PartDefinition",
      )
    )
  ) {
    throw new Error(
      `SysON package ${parentId} does not contain exactly the reviewed drone declarations and named requirements.`,
    );
  }
}

function declaration(
  declarations: readonly Element[],
  label: string,
  parent: string,
): Element {
  const matches = declarations.filter((item) => item.label === label);
  if (matches.length !== 1) {
    throw new Error(
      `SysON ${parent} does not expose exactly one declaration named ${label}.`,
    );
  }
  return matches[0]!;
}

function requirePartUsages(
  value: unknown,
  inspectionDrone: Element,
): ReadonlyMap<string, PartUsage> {
  const record = closed(
    value,
    ["root", "tree", "partCount", "maxDepthReached"],
    "SysON inspection-drone part-structure response",
  );
  const root = element(record.root, "SysON inspection-drone part-structure.root");
  if (
    root.id !== inspectionDrone.id || root.label !== "InspectionDrone" ||
    !kind(root.kind, "PartDefinition")
  ) {
    throw new Error(
      "SysON part-structure readback does not attest the InspectionDrone PartDefinition root.",
    );
  }
  if (!Array.isArray(record.tree)) {
    throw new Error("SysON inspection-drone part-structure.tree must be an array.");
  }
  const partCount = record.partCount;
  if (
    typeof partCount !== "number" || !Number.isSafeInteger(partCount) ||
    partCount < 0 ||
    typeof record.maxDepthReached !== "boolean"
  ) {
    throw new Error(
      "SysON inspection-drone part-structure has an unsupported count or truncation flag.",
    );
  }
  const tree = record.tree.map((node, index) =>
    partUsage(node, `SysON inspection-drone part-structure.tree[${index}]`)
  );
  const recursiveCount = countPartUsages(tree);
  if (
    partCount !== recursiveCount || record.maxDepthReached ||
    recursiveCount !== INSPECTION_DRONE_V4_PART_USAGE_CONTRACT.length ||
    tree.length !== INSPECTION_DRONE_V4_PART_USAGE_CONTRACT.length ||
    tree.some((usage) => usage.children.length !== 0)
  ) {
    throw new Error(
      "SysON part-structure readback must contain exactly the five direct InspectionDrone PartUsages without truncation.",
    );
  }
  const byLabel = new Map<string, PartUsage>();
  for (const usage of tree) {
    if (!kind(usage.kind, "PartUsage") || byLabel.has(usage.label)) {
      throw new Error(
        "SysON part-structure readback has a duplicate or non-PartUsage InspectionDrone child.",
      );
    }
    byLabel.set(usage.label, usage);
  }
  if (
    byLabel.size !== INSPECTION_DRONE_V4_PART_USAGE_CONTRACT.length ||
    INSPECTION_DRONE_V4_PART_USAGE_CONTRACT.some((expected) =>
      !byLabel.has(expected.label)
    )
  ) {
    throw new Error(
      "SysON part-structure readback does not contain the exact reviewed InspectionDrone PartUsages.",
    );
  }
  return byLabel;
}

function partUsage(value: unknown, path: string): PartUsage {
  const record = closed(
    value,
    ["id", "kind", "label", "quantity", "quantitySource", "children"],
    path,
  );
  const quantity = record.quantity;
  if (
    (typeof quantity !== "number" && typeof quantity !== "string") ||
    typeof record.quantitySource !== "string" || !record.quantitySource.trim() ||
    !Array.isArray(record.children)
  ) {
    throw new Error(`${path} has an unsupported quantity or children shape.`);
  }
  return {
    id: string(record.id, `${path}.id`),
    kind: string(record.kind, `${path}.kind`),
    label: string(record.label, `${path}.label`),
    quantity,
    quantitySource: record.quantitySource,
    children: record.children.map((child, index) =>
      partUsage(child, `${path}.children[${index}]`)
    ),
  };
}

function countPartUsages(usages: readonly PartUsage[]): number {
  return usages.reduce(
    (total, usage) => total + 1 + countPartUsages(usage.children),
    0,
  );
}

function partUsageElement(usage: PartUsage): Element {
  return { id: usage.id, kind: usage.kind, label: usage.label };
}

function requirePartUsageType(
  value: unknown,
  usage: PartUsage,
  expectedType: Element,
): Element {
  const record = closed(
    value,
    ["objectId", "expression", "type", "results", "count"],
    `SysON FeatureTyping query for ${usage.label}`,
  );
  if (
    record.objectId !== usage.id ||
    record.expression !== INSPECTION_DRONE_V4_PART_USAGE_FEATURE_TYPING_EXPRESSION ||
    record.type !== "objects" || !Array.isArray(record.results) ||
    record.count !== 1 || record.results.length !== 1
  ) {
    throw new Error(
      `SysON cannot attest one FeatureTyping PartDefinition for ${usage.label}; refusing to infer it from the inserted SysML text.`,
    );
  }
  const type = element(
    record.results[0],
    `SysON FeatureTyping result for ${usage.label}`,
  );
  if (
    type.id !== expectedType.id || type.label !== expectedType.label ||
    !kind(type.kind, "PartDefinition")
  ) {
    throw new Error(
      `SysON FeatureTyping result for ${usage.label} is not the exact reviewed ${expectedType.label} PartDefinition.`,
    );
  }
  return type;
}

function requireRequirementDocumentation(
  value: unknown,
  requirement: Element,
  expectedDocumentation: string,
): string {
  const record = closed(
    value,
    ["objectId", "expression", "type", "result"],
    `SysON documentation query for ${requirement.label}`,
  );
  if (
    record.objectId !== requirement.id ||
    record.expression !== INSPECTION_DRONE_V4_REQUIREMENT_DOCUMENTATION_EXPRESSION ||
    record.type !== "string"
  ) {
    throw new Error(
      `SysON cannot attest the qualitative documentation for ${requirement.label}; refusing to infer it from the inserted SysML text.`,
    );
  }
  const documentation = string(
    record.result,
    `SysON documentation result for ${requirement.label}`,
  );
  if (documentation !== expectedDocumentation) {
    throw new Error(
      `SysON documentation for ${requirement.label} differs from the reviewed qualitative/TBD requirement text.`,
    );
  }
  return documentation;
}

function element(value: unknown, path: string): Element {
  const record = closed(value, ["id", "kind", "label"], path);
  return {
    id: string(record.id, `${path}.id`),
    kind: string(record.kind, `${path}.kind`),
    label: string(record.label, `${path}.label`),
  };
}

async function materialize(
  input: {
    base: ThreadSnapshot;
    seed: Seed;
    briefBasis: EngineeringApprovedBriefBasis;
    runId: string;
    capturedAt: string;
    acknowledgement: { parentId: string; textSha256: string };
    architecturePackage: Element;
    declarations: readonly Element[];
    readback: ArchitectureReadback;
  },
): Promise<{ text: string; sha256: ContentFingerprint; snapshot: ThreadSnapshot }> {
  const recipe = await sha256Fingerprint(INSPECTION_DRONE_V4_ARCHITECTURE_SYSML);
  if (input.acknowledgement.textSha256 !== recipe.digest) {
    throw new Error(
      "The durable SysON acknowledgement does not name the fixed recipe.",
    );
  }
  const capture = {
    schemaVersion: INSPECTION_DRONE_V4_ARCHITECTURE_CAPTURE_SCHEMA,
    kind: "inspection-drone-v4-architecture",
    scope: "bounded-qualitative-system-model",
    statement:
      "Normalized acknowledgement and read-back of the qualitative inspection-drone architecture. It records no CAD, mass, power, dimensions, camera fixation, autonomy, wind, reserve, site separation, simulation, certification, or verdict.",
    capturedAt: iso(input.capturedAt),
    trustedRunId: string(input.runId, "runId"),
    operation: INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION,
    authorization: {
      projectId: input.briefBasis.projectId,
      approvedBriefBasis: input.briefBasis,
    },
    seed: {
      artifactId: input.seed.artifactId,
      fingerprint: input.seed.fingerprint,
      editingContextId: input.seed.normalizedResults.project.editingContextId,
      rootPackageId: input.seed.normalizedResults.rootPackage.id,
    },
    recipe: { textSha256: recipe },
    insertion: input.acknowledgement,
    architecturePackage: input.architecturePackage,
    declarations: input.declarations,
    readback: {
      provider: {
        partStructureTool: "syson_part_structure",
        partUsageFeatureTypingQuery:
          INSPECTION_DRONE_V4_PART_USAGE_FEATURE_TYPING_EXPRESSION,
        requirementDocumentationQuery:
          INSPECTION_DRONE_V4_REQUIREMENT_DOCUMENTATION_EXPRESSION,
      },
      inspectionDrone: input.readback.inspectionDrone,
      partUsages: input.readback.partUsages,
      requirements: input.readback.requirements,
    },
    explicitTbd: [
      "site-weather-and-separation",
      "camera-mass-power-dimensions-and-fixation",
      "autonomy-wind-and-battery-reserve",
    ],
  } as const;
  const text = deterministicJson(capture);
  const sha256 = await sha256Fingerprint(capture);
  const artifactId = `inspection-drone-v4-architecture-${sha256.digest}`;
  const artifact: ThreadArtifact = {
    id: artifactId,
    name: "Inspection-drone V4 qualitative architecture",
    kind: "sysml-model",
    version: sha256.digest,
    fingerprint: sha256,
    uri: `casys://inspection-drone-v4-architecture-capture/sha256/${sha256.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "syson",
      tool: "syson_element_insert_sysml",
      runId: input.runId,
    },
    inputArtifactIds: [input.seed.artifactId],
    freshness: {
      status: "fresh",
      changedAt: input.capturedAt,
      invalidatedByChangeIds: [],
    },
  };
  const consumption = {
    id: `consume-${input.seed.artifactId}-by-${artifactId}`,
    artifactId: input.seed.artifactId,
    consumer: artifact.producer,
    observedFingerprint: input.seed.fingerprint,
    verifiedAt: input.capturedAt,
    status: "verified",
  } as const;
  const applied = applyThreadSnapshotExtensionIfNew(input.base, {
    id: `capture-${artifactId}`,
    name: "Capture the bounded qualitative inspection-drone architecture",
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
      relation: "derived_from",
      from: { kind: "artifact", id: artifactId },
      to: { kind: "artifact", id: input.seed.artifactId },
      rationale:
        "The qualitative architecture was authored only in the exact SysON model container captured by r2.",
    }, {
      id: `link-${consumption.id}-uses-${input.seed.artifactId}`,
      relation: "uses",
      from: { kind: "consumption", id: consumption.id },
      to: { kind: "artifact", id: input.seed.artifactId },
      rationale:
        "The executor re-read the exact r2 model-container capture before authoring the qualitative inspection-drone architecture.",
    }],
    bindingProofs: [{
      provider: "syson",
      kind: "project",
      id: input.seed.normalizedResults.project.id,
    }],
  }, { appliedAt: input.capturedAt });
  if (!applied.applied || applied.snapshot.revision !== input.base.revision + 1) {
    throw new Error(
      "Inspection-drone architecture evidence did not create exactly one descendant snapshot.",
    );
  }
  return { text, sha256, snapshot: applied.snapshot };
}

function artifactRef(snapshot: ThreadSnapshot): EngineeringThreadEntityRef {
  const artifact = snapshot.artifacts.find((candidate) =>
    candidate.id.startsWith("inspection-drone-v4-architecture-")
  );
  if (!artifact) {
    throw new Error(
      "Inspection-drone architecture snapshot has no architecture artifact.",
    );
  }
  return {
    snapshotId: snapshot.id,
    snapshotRevision: snapshot.revision,
    kind: "artifact",
    id: artifact.id,
  };
}
function step(commandId: string, name: string): string {
  return `${commandId}:inspection-drone-v4-architecture:${name}`;
}
function closed(
  value: unknown,
  keys: readonly string[],
  path: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  const actual = Object.keys(value as Record<string, unknown>).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) throw new Error(`${path} has an unsupported shape.`);
  return value as Record<string, unknown>;
}
function string(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path} must be non-empty.`);
  }
  return value;
}
function kind(value: string, expected: string): boolean {
  return value === `sysml::${expected}` || value.endsWith(`entity=${expected}`);
}
function iso(value: string): string {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error("capturedAt must be an ISO timestamp.");
  }
  return value;
}
