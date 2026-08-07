/**
 * Executor for the CM-01 part-definitions documentary capture operation.
 *
 * Reads the CoffeeMachine and DripTray PartDef elements from the SysON
 * architecture package, persists each as its own content-addressed capture
 * record, and publishes the successor ThreadSnapshot carrying two new
 * sysml-model artifacts.
 *
 * WHY THIS EXECUTOR PERFORMS NO SysON WRITE — this is a read-only documentary
 * capture. The PartDef elements already exist in the model (placed by the
 * architecture run). No SysML text is inserted, no WAL is needed, and no
 * provider acknowledgement flag is tracked. The only non-idempotent side effect
 * is the ThreadSnapshot revision, protected by the CAS readback.
 */

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
} from "../../../domain/project/engineering-project.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
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
import type { FileCaptureStore } from "../../captures/file-capture-store.ts";
import type { EngineeringProjectRunLease } from "../../stores/file-engineering-project-run-lease.ts";
import type { McpToolClient } from "../../mcp/http-mcp-tool-client.ts";
import {
  extractPartDefinitions,
  type PartDefinitionRecord,
  PartStructureExtractionError,
} from "../../extractors/syson-part-structure-extractor.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "../executor-run-helpers.ts";

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

export const PART_DEFINITIONS_URI_PREFIX = "casys://part-definitions-capture/" as const;

export const PART_DEFINITIONS_CAPTURE_SCHEMA = "cm01-part-definitions/1.0" as const;

export const COFFEE_MACHINE_CM01_V3_PART_DEFINITIONS_OPERATION =
  COFFEE_MACHINE_CM01_V3_OPERATION_REFS.partDefinitions;

/** URI prefix used to find the architecture artifact in the basis snapshot. */
const ARCHITECTURE_URI_PREFIX = "casys://coffee-machine-cm01-v3-architecture/" as const;

// ---------------------------------------------------------------------------
// Exported error types — monotony ratchet
// ---------------------------------------------------------------------------

/**
 * Raised when a snapshot's ancestor had part-definition artifacts but the
 * current basis does not.
 *
 * MONOTONY RATCHET: once a revision of a subject's thread carries part-definition
 * artifacts, every subsequent revision MUST also carry them.
 */
export class PartDefinitionsArtifactRemovedError extends Error {
  constructor(subjectId: string) {
    super(
      `Snapshot lineage for subject "${subjectId}" previously carried part-definition ` +
        `artifacts (URI prefix "${PART_DEFINITIONS_URI_PREFIX}") ` +
        `but the current basis does not. The artifacts cannot be silently dropped — ` +
        `stop for review before allowing downstream runs.`,
    );
    this.name = "PartDefinitionsArtifactRemovedError";
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CoffeeMachineCm01V3PartDefinitionsRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface CoffeeMachineCm01V3PartDefinitionsRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore;
  readonly architectureCaptures: FileCaptureStore<
    "coffee-machine-cm01-v3-architecture"
  >;
  readonly seedCaptures: {
    read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  };
  readonly partDefinitionsCaptures: FileCaptureStore<"cm01-part-definitions">;
  readonly syson: McpToolClient;
  readonly lease: EngineeringProjectRunLease;
  readonly now?: () => string;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface PartDefinitionsInputs {
  readonly base: ThreadSnapshot;
  readonly editingContextId: string;
  readonly architecturePackageId: string;
  readonly architectureArtifactId: string;
  readonly anchorTargets: Cm01AnchorLinkTargets;
}

/**
 * One existing evidence artifact selected for attachment under a part
 * definition, with the factual sentence that justifies the recorded link.
 */
export interface Cm01AnchorLinkTarget {
  readonly artifactId: string;
  readonly rationale: string;
}

/** The closed US-2 attachment list, resolved structurally on the basis. */
export interface Cm01AnchorLinkTargets {
  readonly dripTray: readonly Cm01AnchorLinkTarget[];
  readonly coffeeMachine: readonly Cm01AnchorLinkTarget[];
}

interface PartDefinitionsMaterialization {
  readonly snapshot: ThreadSnapshot;
}

// ---------------------------------------------------------------------------
// Public: closed US-2 attachment list
// ---------------------------------------------------------------------------

/**
 * Resolve the CLOSED list of existing evidence artifacts that attach under the
 * two part definitions (operator-validated scope, 2026-08-08).
 *
 * Every finder is structural (URI-independent id prefixes fixed at artifact
 * creation) and FAIL-CLOSED: an empty match is an `invalid_input` error, never
 * a silent omission — the list is a commitment, not a best effort. The links
 * themselves are recorded by `materializePartDefinitions`; keeping resolution
 * here lets the run fail before any capture write.
 */
export function collectCm01AnchorLinkTargets(
  base: ThreadSnapshot,
): Cm01AnchorLinkTargets {
  const find = (
    label: string,
    predicate: (artifact: ThreadArtifact) => boolean,
    rationale: string,
  ): Cm01AnchorLinkTarget[] => {
    const matches = base.artifacts.filter(predicate);
    if (matches.length === 0) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `The basis ThreadSnapshot has no artifact for the closed attachment ` +
          `entry "${label}". The part-definitions run must follow the CM-01 ` +
          `evidence it anchors.`,
      );
    }
    return matches.map((artifact) => ({ artifactId: artifact.id, rationale }));
  };

  return {
    dripTray: [
      ...find(
        "mechanical-r3",
        (a) => a.id.startsWith("coffee-machine-cm01-v3-mechanical-r3-"),
        "The R3 mechanical proof was computed on the DripTray geometry.",
      ),
      ...find(
        "printability",
        (a) => a.id.startsWith("drip-tray-printability-"),
        "The FDM printability capture measured the DripTray export.",
      ),
      ...find(
        "sensitivity",
        (a) => a.id.startsWith("drip-tray-sensitivity-"),
        "The size-z sensitivity study measured the DripTray design driver.",
      ),
      ...find(
        "mesh-drip-tray",
        (a) => a.id.endsWith("-mesh-drip-tray"),
        "The attested presentation mesh renders the DripTray part.",
      ),
    ],
    coffeeMachine: [
      ...find(
        "cad-r3",
        (a) =>
          a.id.startsWith("coffee-machine-cm01-v3-cad-r3-") &&
          (a.id.endsWith("-plan") || a.id.endsWith("-script") ||
            a.id.endsWith("-step") || a.id.endsWith("-mesh-assembly")),
        "The R3 CAD export set materializes the CoffeeMachine assembly.",
      ),
      ...find(
        "erpnext-bom",
        (a) => a.id.startsWith("erpnext-bom-"),
        "The ERPNext BOM describes the complete CoffeeMachine assembly.",
      ),
      ...find(
        "modelica-evidence",
        (a) => /^modelica-run-.+-evidence-/.test(a.id),
        "The nominal heat-up scenario measures machine-level water temperature; " +
          "the run consumed an approved Modelica kit, not the SysON geometry.",
      ),
    ],
  };
}

// ---------------------------------------------------------------------------
// Public: monotony ratchet helpers
// ---------------------------------------------------------------------------

/** Find all part-definition artifacts in a snapshot by URI prefix. */
export function findPartDefinitionsArtifacts(
  snapshot: ThreadSnapshot,
): ThreadArtifact[] {
  return snapshot.artifacts.filter(
    (a) =>
      a.kind === "sysml-model" &&
      typeof a.uri === "string" &&
      a.uri.startsWith(PART_DEFINITIONS_URI_PREFIX),
  );
}

/**
 * Verify that no ancestor of `basis` had part-definition artifacts that the
 * current revision silently dropped.
 */
export async function assertPartDefinitionsNotRemoved(
  basis: ThreadSnapshot,
  snapshots: ThreadSnapshotStore,
): Promise<void> {
  if (findPartDefinitionsArtifacts(basis).length > 0) return;
  let cursor = basis.previous;
  const visited = new Set<string>();
  while (cursor) {
    const key = `${cursor.snapshotId}:${cursor.revision}`;
    if (visited.has(key)) break;
    visited.add(key);
    let ancestor: ThreadSnapshot | undefined;
    try {
      ancestor = await snapshots.get(cursor.snapshotId);
    } catch {
      break; // fail-open on resolution error (documented limit)
    }
    if (
      !ancestor || ancestor.id !== cursor.snapshotId ||
      ancestor.revision !== cursor.revision
    ) {
      break;
    }
    if (findPartDefinitionsArtifacts(ancestor).length > 0) {
      throw new PartDefinitionsArtifactRemovedError(basis.subject.id);
    }
    cursor = ancestor.previous;
  }
}

// ---------------------------------------------------------------------------
// Public: executor
// ---------------------------------------------------------------------------

export class CoffeeMachineCm01V3PartDefinitionsRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: EngineeringProjectCommandService;
  readonly #snapshots: ThreadSnapshotStore;
  readonly #architectureCaptures:
    CoffeeMachineCm01V3PartDefinitionsRunExecutorDependencies["architectureCaptures"];
  readonly #seedCaptures:
    CoffeeMachineCm01V3PartDefinitionsRunExecutorDependencies["seedCaptures"];
  readonly #partDefinitionsCaptures:
    CoffeeMachineCm01V3PartDefinitionsRunExecutorDependencies[
      "partDefinitionsCaptures"
    ];
  readonly #syson: McpToolClient;
  readonly #lease: EngineeringProjectRunLease;
  readonly #now: () => string;

  constructor(
    dependencies: CoffeeMachineCm01V3PartDefinitionsRunExecutorDependencies,
  ) {
    this.#projects = dependencies.projects;
    this.#commands = dependencies.commands;
    this.#snapshots = dependencies.snapshots;
    this.#architectureCaptures = dependencies.architectureCaptures;
    this.#seedCaptures = dependencies.seedCaptures;
    this.#partDefinitionsCaptures = dependencies.partDefinitionsCaptures;
    this.#syson = dependencies.syson;
    this.#lease = dependencies.lease;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3PartDefinitionsRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute the CM-01 part-definitions capture run.",
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
    command: CoffeeMachineCm01V3PartDefinitionsRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let snapshotPersisted = false;
    let materialized: PartDefinitionsMaterialization | undefined;
    try {
      const preClaim = await this.requiredProject(command.projectId);
      const preClaimRun = requireRun(preClaim, command.runId);
      requireShape(preClaim, preClaimRun);

      // Idempotent replay: if a prior execution already completed this run,
      // return the committed result without re-claiming or re-running anything.
      if (preClaimRun.status === "completed") {
        assertCompleted(preClaim, command);
        return preClaim;
      }

      await this.#commands.claimRun(origin, {
        ...command,
        commandId: commandStep(command.commandId, "claim"),
        summary: "Started the CM-01 part-definitions documentary capture run.",
      });
      claimed = true;

      let project = await this.requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireClaimedShape(project, run, origin);

      if (run.status === "completed") {
        assertCompleted(project, command);
        return project;
      }
      if (run.status !== "running" && run.status !== "publishing") {
        throw unexpectedStatus(run, "running");
      }

      const capturedAt = requiredStart(run);
      const basis = requireBasis(run);
      const inputs = await this.loadInputs(basis);

      // Extract part definitions from SysON (read-only).
      let extracted: {
        coffeeMachine: PartDefinitionRecord;
        dripTray: PartDefinitionRecord;
      };
      try {
        extracted = await extractPartDefinitions(
          this.#syson,
          inputs.editingContextId,
          inputs.architecturePackageId,
        );
      } catch (error) {
        if (error instanceof PartStructureExtractionError) {
          throw new EngineeringProjectCommandError(
            "invalid_transition",
            `Part-structure extraction failed (${error.code}): ${error.message} ` +
              `Recovery hint: ${error.recovery}`,
          );
        }
        throw error;
      }

      // Build and persist the CoffeeMachine capture record (CAS).
      const cmCaptureRecord = {
        schemaVersion: PART_DEFINITIONS_CAPTURE_SCHEMA,
        elementId: extracted.coffeeMachine.elementId,
        label: extracted.coffeeMachine.label,
        structure: extracted.coffeeMachine.structure,
        editingContextId: inputs.editingContextId,
        architecturePackageId: inputs.architecturePackageId,
        capturedAt,
      };
      const cmCaptureText = deterministicJson(cmCaptureRecord);
      const cmCaptureFingerprint = await sha256Fingerprint(cmCaptureRecord);
      await this.#partDefinitionsCaptures.save(cmCaptureFingerprint, cmCaptureText);
      const cmPersistedCapture = await this.#partDefinitionsCaptures.read(
        cmCaptureFingerprint,
      );
      if (cmPersistedCapture !== cmCaptureText) {
        throw new Error(
          "CM-01 CoffeeMachine part-definitions capture was not durably readable after save.",
        );
      }

      // Build and persist the DripTray capture record (CAS).
      const dtCaptureRecord = {
        schemaVersion: PART_DEFINITIONS_CAPTURE_SCHEMA,
        elementId: extracted.dripTray.elementId,
        label: extracted.dripTray.label,
        structure: extracted.dripTray.structure,
        editingContextId: inputs.editingContextId,
        architecturePackageId: inputs.architecturePackageId,
        capturedAt,
      };
      const dtCaptureText = deterministicJson(dtCaptureRecord);
      const dtCaptureFingerprint = await sha256Fingerprint(dtCaptureRecord);
      await this.#partDefinitionsCaptures.save(dtCaptureFingerprint, dtCaptureText);
      const dtPersistedCapture = await this.#partDefinitionsCaptures.read(
        dtCaptureFingerprint,
      );
      if (dtPersistedCapture !== dtCaptureText) {
        throw new Error(
          "CM-01 DripTray part-definitions capture was not durably readable after save.",
        );
      }

      // Materialize ThreadSnapshot extension.
      const cmCaptureUri = this.#partDefinitionsCaptures.uriFor(cmCaptureFingerprint);
      const dtCaptureUri = this.#partDefinitionsCaptures.uriFor(dtCaptureFingerprint);
      materialized = materializePartDefinitions({
        base: inputs.base,
        runId: command.runId,
        capturedAt,
        cmCaptureFingerprint,
        cmCaptureUri,
        cmElementId: extracted.coffeeMachine.elementId,
        dtCaptureFingerprint,
        dtCaptureUri,
        dtElementId: extracted.dripTray.elementId,
        architecturePackageId: inputs.architecturePackageId,
        architectureArtifactId: inputs.architectureArtifactId,
        anchorTargets: inputs.anchorTargets,
      });

      // Persist snapshot (CAS readback).
      await this.#snapshots.save(materialized.snapshot);
      const savedSnapshot = await this.#snapshots.get(materialized.snapshot.id);
      if (
        !savedSnapshot ||
        deterministicJson(savedSnapshot) !== deterministicJson(materialized.snapshot)
      ) {
        throw new Error(
          "CM-01 part-definitions snapshot was not durably readable after save.",
        );
      }
      snapshotPersisted = true;

      // Publish run.
      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary:
            "Publishing the CM-01 CoffeeMachine and DripTray part-definition captures.",
        });
      } else if (run.status !== "publishing" && run.status !== "completed") {
        throw unexpectedStatus(run, "publishing");
      }

      // Complete run.
      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.#commands.completeRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "complete"),
          expectedRevision: project.revision,
          summary:
            "Recorded the CM-01 CoffeeMachine and DripTray part-definition captures.",
          resultSnapshot: snapshotRef(materialized.snapshot),
          evidenceRefs: artifactEntityRefs(materialized.snapshot),
        });
      } else if (run.status !== "completed") {
        throw unexpectedStatus(run, "completed");
      }

      const complete = await this.requiredProject(command.projectId);
      assertCompleted(complete, command);
      return complete;
    } catch (error) {
      if (snapshotPersisted) {
        const complete = await this.completedFor(command);
        if (complete) return complete;
        const cause = error instanceof Error ? ` Cause: ${error.message}` : "";
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "CM-01 part-definitions evidence is durable but project attachment did not finish. " +
            `Retry this exact command; it will re-use the persisted captures.${cause}`,
        );
      }
      if (claimed) await this.recordFailure(origin, command);
      throw error;
    }
  }

  // ── Private: input loading ────────────────────────────────────────────────

  private async loadInputs(
    basis: EngineeringThreadSnapshotBasis,
  ): Promise<PartDefinitionsInputs> {
    const base = await exactSnapshot(this.#snapshots, basis);
    if (base.subject.id !== "project:coffee-machine-cm01-v3") {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The basis ThreadSnapshot subject does not match the CM-01 project subject.",
      );
    }

    // Guard: no duplicate capture.
    if (findPartDefinitionsArtifacts(base).length > 0) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "The basis ThreadSnapshot already carries part-definition artifacts. " +
          "A second capture is not allowed.",
      );
    }

    // Monotony ratchet.
    await assertPartDefinitionsNotRemoved(base, this.#snapshots);

    // Find the architecture artifact by URI prefix.
    const archArtifact = base.artifacts.find(
      (a) =>
        a.kind === "sysml-model" &&
        typeof a.uri === "string" &&
        a.uri.startsWith(ARCHITECTURE_URI_PREFIX),
    );
    if (!archArtifact) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `The basis ThreadSnapshot has no architecture artifact (URI prefix "${ARCHITECTURE_URI_PREFIX}"). ` +
          "The part-definitions run must follow a completed architecture run.",
      );
    }

    // Read the architecture capture to get architecturePackageId and seedFingerprint.
    const archCaptureText = await this.#architectureCaptures.read(
      archArtifact.fingerprint,
    );
    if (!archCaptureText) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The architecture capture is not readable from the content-addressed store.",
      );
    }
    const archCapture = parseArchitectureCapture(archCaptureText);

    // Read the seed capture to get editingContextId.
    const seedCaptureText = await this.#seedCaptures.read(archCapture.seedFingerprint);
    if (!seedCaptureText) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The SysON model-seed capture is not readable from the content-addressed store.",
      );
    }
    const editingContextId = extractEditingContextId(seedCaptureText);

    // Resolve the closed US-2 attachment list up front so a missing target
    // fails the run before any provider call or capture write.
    const anchorTargets = collectCm01AnchorLinkTargets(base);

    return {
      base,
      editingContextId,
      architecturePackageId: archCapture.architecturePackageId,
      architectureArtifactId: archArtifact.id,
      anchorTargets,
    };
  }

  // ── Private: project lifecycle helpers ───────────────────────────────────

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

  private async completedFor(
    command: CoffeeMachineCm01V3PartDefinitionsRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    try {
      const project = await this.requiredProject(command.projectId);
      assertCompleted(project, command);
      return project;
    } catch {
      return undefined;
    }
  }

  private async recordFailure(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3PartDefinitionsRunExecutorCommand,
  ): Promise<void> {
    try {
      const project = await this.requiredProject(command.projectId);
      const run = requireRun(project, command.runId);
      if (
        run.status !== "running" ||
        run.claimedBy?.origin !== origin.kind ||
        run.claimedBy.id !== origin.actorId
      ) return;
      await this.#commands.failRun(origin, {
        ...command,
        commandId: commandStep(command.commandId, "fail"),
        expectedRevision: project.revision,
        summary: "CM-01 part-definitions stopped before evidence was saved.",
        code: "coffee-machine-cm01-v3-part-definitions-not-published",
        message:
          "The bounded CM-01 part-definitions run stopped before evidence was published.",
      });
    } catch {
      // Preserve the original cause.
    }
  }
}

// ---------------------------------------------------------------------------
// Private: snapshot materialization
// ---------------------------------------------------------------------------

function materializePartDefinitions(input: {
  readonly base: ThreadSnapshot;
  readonly runId: string;
  readonly capturedAt: string;
  readonly cmCaptureFingerprint: ContentFingerprint;
  readonly cmCaptureUri: string;
  readonly cmElementId: string;
  readonly dtCaptureFingerprint: ContentFingerprint;
  readonly dtCaptureUri: string;
  readonly dtElementId: string;
  readonly architecturePackageId: string;
  readonly architectureArtifactId: string;
  readonly anchorTargets: Cm01AnchorLinkTargets;
}): PartDefinitionsMaterialization {
  const cmArtifactId =
    `part-definition-coffee-machine-${input.cmCaptureFingerprint.digest}`;
  const dtArtifactId = `part-definition-drip-tray-${input.dtCaptureFingerprint.digest}`;

  const operation: ThreadOperationRef = {
    serverId: "syson",
    tool: "syson_part_structure",
    runId: input.runId,
  };
  const freshness: ThreadFreshness = {
    status: "fresh",
    changedAt: input.capturedAt,
    invalidatedByChangeIds: [],
  };

  const cmArtifact: ThreadArtifact = {
    id: cmArtifactId,
    name: "CM-01 CoffeeMachine part definition",
    kind: "sysml-model",
    version: input.cmCaptureFingerprint.digest,
    fingerprint: input.cmCaptureFingerprint,
    uri: input.cmCaptureUri,
    mediaType: "application/json",
    producer: operation,
    inputArtifactIds: [input.architectureArtifactId],
    freshness,
  };

  // The DripTray part definition also declares the CoffeeMachine part
  // definition as an input: DripTray is a part usage of the assembly, and the
  // structural input edge is what renders the root → sub-root hierarchy.
  const dtArtifact: ThreadArtifact = {
    id: dtArtifactId,
    name: "CM-01 DripTray part definition",
    kind: "sysml-model",
    version: input.dtCaptureFingerprint.digest,
    fingerprint: input.dtCaptureFingerprint,
    uri: input.dtCaptureUri,
    mediaType: "application/json",
    producer: operation,
    inputArtifactIds: [input.architectureArtifactId, cmArtifactId],
    freshness,
  };

  // WHY observedFingerprint = architectureArtifact.fingerprint:
  // The consumed artifact is the architecture artifact (the SysON model state
  // from which we read the part definitions). Using a capture fingerprint here
  // would produce a permanent fingerprint_mismatch error on every downstream
  // check. The architecture artifact is consumed exactly once to produce two
  // derived artifacts.
  const architectureArtifact = input.base.artifacts.find(
    (a) => a.id === input.architectureArtifactId,
  );
  if (!architectureArtifact) {
    throw new Error(
      `Architecture artifact "${input.architectureArtifactId}" is absent from the base snapshot.`,
    );
  }

  const archConsumption: ThreadArtifactConsumption = {
    id: `consume-${input.architectureArtifactId}-by-${cmArtifactId}`,
    artifactId: input.architectureArtifactId,
    consumer: operation,
    observedFingerprint: architectureArtifact.fingerprint,
    verifiedAt: input.capturedAt,
    status: "verified",
  };

  // The DripTray artifact declares the CoffeeMachine artifact as an input
  // (hierarchy); the derivation regime demands a verified consumption of that
  // input by the same producer run.
  const cmConsumption: ThreadArtifactConsumption = {
    id: `consume-${cmArtifactId}-by-${dtArtifactId}`,
    artifactId: cmArtifactId,
    consumer: operation,
    observedFingerprint: input.cmCaptureFingerprint,
    verifiedAt: input.capturedAt,
    status: "verified",
  };

  const extension = {
    id: `capture-${cmArtifactId}-${dtArtifactId}`,
    name:
      "Capture the CM-01 CoffeeMachine and DripTray part definitions from the SysML model",
    subjectId: input.base.subject.id,
    capturedAt: input.capturedAt,
    artifacts: [cmArtifact, dtArtifact],
    consumptions: [archConsumption, cmConsumption],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    proposedActions: [],
    provenance: [
      {
        id: `link-${cmArtifactId}-derived-from-${input.architectureArtifactId}`,
        relation: "derived_from" as const,
        from: { kind: "artifact" as const, id: cmArtifactId },
        to: { kind: "artifact" as const, id: input.architectureArtifactId },
        rationale:
          "The CoffeeMachine part-definition record was read from the architecture package.",
      },
      {
        id: `link-${dtArtifactId}-derived-from-${input.architectureArtifactId}`,
        relation: "derived_from" as const,
        from: { kind: "artifact" as const, id: dtArtifactId },
        to: { kind: "artifact" as const, id: input.architectureArtifactId },
        rationale:
          "The DripTray part-definition record was read from the architecture package.",
      },
      {
        id: `link-${archConsumption.id}-uses-${input.architectureArtifactId}`,
        relation: "uses" as const,
        from: { kind: "consumption" as const, id: archConsumption.id },
        to: { kind: "artifact" as const, id: input.architectureArtifactId },
        rationale:
          "The executor read the architecture package to locate and capture the PartDef elements.",
      },
      {
        id: `link-${cmConsumption.id}-uses-${cmArtifactId}`,
        relation: "uses" as const,
        from: { kind: "consumption" as const, id: cmConsumption.id },
        to: { kind: "artifact" as const, id: cmArtifactId },
        rationale:
          "The DripTray record was captured against the CoffeeMachine record produced by the same run.",
      },
      // Hierarchy: stored derived_from is from=derived, to=source; the graph
      // projector reverses it, so the assembly renders upstream of the part.
      {
        id: `link-${dtArtifactId}-derived-from-${cmArtifactId}`,
        relation: "derived_from" as const,
        from: { kind: "artifact" as const, id: dtArtifactId },
        to: { kind: "artifact" as const, id: cmArtifactId },
        rationale: "DripTray is a part usage of the CoffeeMachine assembly.",
      },
      // Closed US-2 attachment list: each existing proof records that it
      // traces to the part it measured. `traces_to` (not `derived_from`):
      // the validator reserves artifact derivation for the full input +
      // verified-consumption regime, which an immutable existing proof can
      // never satisfy retroactively. Stored from=proof, to=part; the
      // projector reverses, so the part renders upstream of its evidence.
      ...input.anchorTargets.dripTray.map((target) => ({
        id: `link-${target.artifactId}-traces-to-${dtArtifactId}`,
        relation: "traces_to" as const,
        from: { kind: "artifact" as const, id: target.artifactId },
        to: { kind: "artifact" as const, id: dtArtifactId },
        rationale: target.rationale,
      })),
      ...input.anchorTargets.coffeeMachine.map((target) => ({
        id: `link-${target.artifactId}-traces-to-${cmArtifactId}`,
        relation: "traces_to" as const,
        from: { kind: "artifact" as const, id: target.artifactId },
        to: { kind: "artifact" as const, id: cmArtifactId },
        rationale: target.rationale,
      })),
    ],
    bindingProofs: [{
      provider: "syson",
      kind: "package",
      id: input.architecturePackageId,
    }],
  };

  const applied = applyThreadSnapshotExtensionIfNew(input.base, extension, {
    appliedAt: input.capturedAt,
  });

  if (!applied.applied || applied.snapshot.revision !== input.base.revision + 1) {
    throw new Error(
      "CM-01 part-definitions evidence did not produce exactly one descendant snapshot.",
    );
  }

  return { snapshot: applied.snapshot };
}

// ---------------------------------------------------------------------------
// Private: shape validation helpers
// ---------------------------------------------------------------------------

const PART_DEFINITIONS_OP = COFFEE_MACHINE_CM01_V3_OPERATION_REFS.partDefinitions;

function requireShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): void {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const operation = workItem?.operation;
  if (
    project.schemaVersion !== "3.0" ||
    project.project.id !== "coffee-machine-cm01-v3" ||
    project.project.subjectId !== "project:coffee-machine-cm01-v3" ||
    run.basis?.kind !== "thread-snapshot" ||
    !workItem ||
    operation?.id !== PART_DEFINITIONS_OP.id ||
    operation.version !== PART_DEFINITIONS_OP.version ||
    operation.bindings.length !== 1 ||
    operation.bindings[0]?.name !== "approvedBrief" ||
    operation.bindings[0].source.kind !== "approved-brief"
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the canonical CM-01 V3 part-definitions @1 operation.",
    );
  }
}

function requireClaimedShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
): void {
  requireShape(project, run);
  if (run.claimedBy?.origin !== origin.kind || run.claimedBy.id !== origin.actorId) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the exact part-definitions run it claimed.",
    );
  }
}

// ---------------------------------------------------------------------------
// Private: architecture capture parsing
// ---------------------------------------------------------------------------

function parseArchitectureCapture(text: string): {
  architecturePackageId: string;
  seedFingerprint: ContentFingerprint;
} {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The architecture capture is not valid JSON.",
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The architecture capture must be an object.",
    );
  }
  const record = value as Record<string, unknown>;

  const pkg = record.architecturePackage;
  if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The architecture capture has no architecturePackage.",
    );
  }
  const pkgId = (pkg as Record<string, unknown>).id;
  if (typeof pkgId !== "string" || !pkgId.trim()) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The architecture capture architecturePackage.id is missing or empty.",
    );
  }

  const seedRaw = record.seed;
  if (!seedRaw || typeof seedRaw !== "object" || Array.isArray(seedRaw)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The architecture capture has no seed.",
    );
  }
  const fp = (seedRaw as Record<string, unknown>).fingerprint;
  if (!fp || typeof fp !== "object" || Array.isArray(fp)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The architecture capture seed.fingerprint is missing.",
    );
  }
  const fpRecord = fp as Record<string, unknown>;
  if (
    fpRecord.algorithm !== "sha256" ||
    typeof fpRecord.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(fpRecord.digest)
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The architecture capture seed.fingerprint is not a valid sha256 fingerprint.",
    );
  }

  return {
    architecturePackageId: pkgId.trim(),
    seedFingerprint: { algorithm: "sha256", digest: fpRecord.digest },
  };
}

// ---------------------------------------------------------------------------
// Private: seed capture parsing
// ---------------------------------------------------------------------------

function extractEditingContextId(text: string): string {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The SysON model-seed capture is not valid JSON.",
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The SysON model-seed capture must be an object.",
    );
  }
  const record = value as Record<string, unknown>;
  const results = record.normalizedResults;
  if (!results || typeof results !== "object" || Array.isArray(results)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The SysON model-seed capture has no normalizedResults.",
    );
  }
  const project = (results as Record<string, unknown>).project;
  if (!project || typeof project !== "object" || Array.isArray(project)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The SysON model-seed capture has no normalizedResults.project.",
    );
  }
  const editingContextId = (project as Record<string, unknown>).editingContextId;
  if (typeof editingContextId !== "string" || !editingContextId.trim()) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The SysON model-seed capture has no editingContextId in normalizedResults.project.",
    );
  }
  return editingContextId.trim();
}

// ---------------------------------------------------------------------------
// Private: miscellaneous helpers
// ---------------------------------------------------------------------------

async function exactSnapshot(
  store: ThreadSnapshotStore,
  basis: EngineeringThreadSnapshotBasis,
): Promise<ThreadSnapshot> {
  const snapshot = await store.get(basis.snapshotId);
  if (
    !snapshot || snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The exact basis ThreadSnapshot required by the part-definitions run is not readable.",
    );
  }
  try {
    return validateThreadSnapshot(snapshot);
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `The basis ThreadSnapshot is invalid: ${errorMessage(error)}`,
    );
  }
}

function assertCompleted(
  project: EngineeringProjectSnapshot,
  command: CoffeeMachineCm01V3PartDefinitionsRunExecutorCommand,
): void {
  const run = requireRun(project, command.runId);
  if (
    run.status !== "completed" ||
    !run.resultSnapshot ||
    !project.commandReceipts?.some(
      (receipt) => receipt.commandId === commandStep(command.commandId, "complete"),
    )
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `CM-01 part-definitions run ${command.runId} did not complete through this exact command.`,
    );
  }
}

function commandStep(commandId: string, step: string): string {
  return `${commandId}:coffee-machine-cm01-v3-part-definitions:${step}`;
}

function artifactEntityRefs(snapshot: ThreadSnapshot): EngineeringThreadEntityRef[] {
  return snapshot.artifacts
    .filter(
      (a) => typeof a.uri === "string" && a.uri.startsWith(PART_DEFINITIONS_URI_PREFIX),
    )
    .map((a) => ({
      snapshotId: snapshot.id,
      snapshotRevision: snapshot.revision,
      kind: "artifact" as const,
      id: a.id,
    }));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
