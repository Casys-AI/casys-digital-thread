/**
 * Executor for the CM-01 sensitivity-edge anchoring operation (@2).
 *
 * Generic successor to the @1 sensitivity-relations executor. Key differences
 * from @1:
 *
 *   1. METRIC_TO_ATTR_NAME is eliminated. Each metric maps to a full
 *      SensitivityEdge template (driver.sysmlAttrName, response.sysmlAttrName,
 *      constraint names). The mapping IS the SensitivityEdge domain contract —
 *      the correspondence between metric id and attribute name is now a data
 *      field of the reviewed edge shape, not a private static string Map.
 *
 *   2. Inserts a distinct PartDef named DripTraySensitivityEdges (not
 *      DripTraySensitivityRelations from @1). The two elements coexist in the
 *      same architecture package once migration is executed.
 *
 *   3. Uses renderSensitivityEdgeSetSysml / extractAndVerifySensitivityEdges
 *      from the generic domain/extractor modules, not their CM-01-specific @1
 *      counterparts.
 *
 * REGISTRATION ONLY — this operation has execution: "planning-only" in the
 * kit descriptor (cm01.drip-tray-sensitivity-edges, kitVersion "2"). The
 * executor code is complete and ready; migration of the existing @1 element
 * requires explicit operator consent before any live execution can proceed.
 *
 * WHY THIS EXECUTOR IS CLOSED — the agent never supplies SysML text, attribute
 * names, metric mappings, or bound values. Everything comes from the reviewed
 * sensitivity-study capture and the server-fixed SERVER_FIXED_EDGE_TEMPLATES
 * below. Invariant 6: the server owns the SysML shape.
 */

import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandOrigin,
  type EngineeringProjectCommandService,
  type EngineeringProjectRevisionStore,
} from "../../domain/engineering-project-command-service.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
} from "../../domain/engineering-project.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/deterministic-json.ts";
import {
  fingerprintSensitivityEdgeSet,
  renderSensitivityEdgeSetSysml,
  SENSITIVITY_EDGE_SCHEMA,
  type SensitivityEdge,
  validateSensitivityEdgeSet,
} from "../../domain/sensitivity-edge.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadFreshness,
  ThreadOperationRef,
  ThreadSnapshot,
} from "../../domain/thread-snapshot.ts";
import { applyThreadSnapshotExtensionIfNew } from "../../domain/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../domain/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../domain/thread-snapshot-validation.ts";
import { COFFEE_MACHINE_CM01_V3_OPERATION_REFS } from "../../orchestration/operations/coffee-machine-cm01-v3-engineering-kits.ts";
import type { FileCaptureStore } from "../file-capture-store.ts";
import type { EngineeringProjectRunLease } from "../file-engineering-project-run-lease.ts";
import {
  FileSensitivityRelationsAttemptStore,
  SensitivityRelationsWriteOutcomeUnknownError,
} from "../file-sensitivity-relations-attempt-store.ts";
import type { McpToolClient } from "../http-mcp-tool-client.ts";
import {
  extractAndVerifySensitivityEdges,
  SensitivityEdgeExtractionError,
} from "../extractors/syson-sensitivity-edge-extractor.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "./executor-run-helpers.ts";

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

export const SENSITIVITY_EDGES_URI_PREFIX =
  "casys://sensitivity-edges-seed-capture/" as const;

export const SENSITIVITY_EDGES_CAPTURE_SCHEMA =
  "sensitivity-edges-capture/1.0" as const;

export const COFFEE_MACHINE_CM01_V3_SENSITIVITY_EDGES_OPERATION =
  COFFEE_MACHINE_CM01_V3_OPERATION_REFS.sensitivityRelationsV2;

/**
 * Server-fixed PartDef name for the @2 DripTray sensitivity-edge set element.
 * Distinct from the @1 element "DripTraySensitivityRelations". Invariant 6:
 * agents never name or rename the SysML element.
 */
const SENSITIVITY_EDGES_PART_DEF_NAME = "DripTraySensitivityEdges" as const;

const ARCHITECTURE_URI_PREFIX = "casys://coffee-machine-cm01-v3-architecture/" as const;
const SENSITIVITY_STUDY_URI_PREFIX = "casys://sensitivity-study-capture/" as const;

// ---------------------------------------------------------------------------
// Server-fixed edge templates — replaces METRIC_TO_ATTR_NAME
//
// WHY THIS IS NOT A STRING MAP — @1's METRIC_TO_ATTR_NAME mapped metric id to
// exactly ONE attribute name. @2 maps metric id to a complete SensitivityEdge
// template: driver.sysmlAttrName (the parameter axis), response.sysmlAttrName
// (the derivative metric attribute), and the two constraint names for the
// validity neighborhood. The correspondence metric→attribute is now data of the
// SensitivityEdge domain contract (src/domain/sensitivity-edge.ts).
//
// The derivative value, base point, and provenance are filled from the
// sensitivity-study capture at runtime; the structural shape is server-owned.
// ---------------------------------------------------------------------------

interface SensitivityEdgeTemplate {
  /** SysML attribute name for the driver parameter axis. */
  readonly driverSysmlAttrName: string;
  /** SysML attribute name for the derivative response. */
  readonly responseSysmlAttrName: string;
  /** SysML constraint name for the lower validity bound. */
  readonly lowerConstraintName: string;
  /** SysML constraint name for the upper validity bound. */
  readonly upperConstraintName: string;
}

/**
 * Server-fixed template per sensitivity metric. The agent never supplies these
 * names; they are code-owned and reviewed alongside the kit descriptor.
 *
 * Live-probe evidence (2026-08-05, project probe-sensitivity-edge-2026-08-05,
 * deleted after probe): the flat PartDef form with LengthValue driver attrs and
 * DimensionOneValue/PressureValue response attrs was confirmed to round-trip
 * through syson_constraint_extract with the correct featurePath[0] values.
 */
const SERVER_FIXED_EDGE_TEMPLATES: ReadonlyMap<string, SensitivityEdgeTemplate> =
  new Map([
    [
      "assembly_max_displacement",
      {
        driverSysmlAttrName: "sizeZ_for_assembly_max_displacement",
        responseSysmlAttrName: "d_assembly_max_displacement_mm_per_mm",
        lowerConstraintName: "assembly_max_displacement_validity_lower",
        upperConstraintName: "assembly_max_displacement_validity_upper",
      },
    ],
    [
      "assembly_max_von_mises",
      {
        driverSysmlAttrName: "sizeZ_for_assembly_max_von_mises",
        responseSysmlAttrName: "d_assembly_max_von_mises_MPa_per_mm",
        lowerConstraintName: "assembly_max_von_mises_validity_lower",
        upperConstraintName: "assembly_max_von_mises_validity_upper",
      },
    ],
  ]);

// ---------------------------------------------------------------------------
// Exported error types — monotony ratchet
// ---------------------------------------------------------------------------

/**
 * Raised when the basis snapshot drops the @2 sensitivity-edges artifact that
 * a previous ancestor had already established.
 *
 * MONOTONY RATCHET: once a revision carries the DripTraySensitivityEdges
 * artifact, every subsequent revision MUST also carry it.
 */
export class SensitivityEdgesArtifactRemovedError extends Error {
  constructor(subjectId: string) {
    super(
      `Snapshot lineage for subject "${subjectId}" previously carried a sensitivity-edges ` +
        `artifact (URI prefix "${SENSITIVITY_EDGES_URI_PREFIX}") ` +
        `but the current basis does not. The artifact cannot be silently dropped — ` +
        `stop for review before allowing downstream runs.`,
    );
    this.name = "SensitivityEdgesArtifactRemovedError";
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CoffeeMachineCm01V3SensitivityEdgesRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface CoffeeMachineCm01V3SensitivityEdgesRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore;
  readonly architectureCaptures: FileCaptureStore<
    "coffee-machine-cm01-v3-architecture"
  >;
  readonly seedCaptures: {
    read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  };
  readonly sensitivityCaptures: FileCaptureStore<"sensitivity-study">;
  readonly sensitivityEdgesCaptures: FileCaptureStore<"sensitivity-edges-seed">;
  readonly attempts: FileSensitivityRelationsAttemptStore;
  readonly syson: McpToolClient;
  readonly lease: EngineeringProjectRunLease;
  readonly now?: () => string;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface SensitivityEdgesInputs {
  readonly base: ThreadSnapshot;
  readonly editingContextId: string;
  readonly architecturePackageId: string;
  readonly architectureArtifactId: string;
  readonly sensitivityArtifactId: string;
  readonly edges: readonly SensitivityEdge[];
}

interface SensitivityEdgesMaterialization {
  readonly snapshot: ThreadSnapshot;
}

interface SysmlElement {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
}

// ---------------------------------------------------------------------------
// Public: monotony ratchet
// ---------------------------------------------------------------------------

export function findSensitivityEdgesArtifact(
  snapshot: ThreadSnapshot,
): ThreadArtifact | undefined {
  return snapshot.artifacts.find(
    (a) =>
      a.kind === "sysml-model" &&
      typeof a.uri === "string" &&
      a.uri.startsWith(SENSITIVITY_EDGES_URI_PREFIX),
  );
}

export async function assertSensitivityEdgesNotRemoved(
  basis: ThreadSnapshot,
  snapshots: ThreadSnapshotStore,
): Promise<void> {
  if (findSensitivityEdgesArtifact(basis)) return;
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
      break;
    }
    if (
      !ancestor || ancestor.id !== cursor.snapshotId ||
      ancestor.revision !== cursor.revision
    ) {
      break;
    }
    if (findSensitivityEdgesArtifact(ancestor)) {
      throw new SensitivityEdgesArtifactRemovedError(basis.subject.id);
    }
    cursor = ancestor.previous;
  }
}

// ---------------------------------------------------------------------------
// Public: executor
// ---------------------------------------------------------------------------

export class CoffeeMachineCm01V3SensitivityEdgesRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: EngineeringProjectCommandService;
  readonly #snapshots: ThreadSnapshotStore;
  readonly #architectureCaptures:
    CoffeeMachineCm01V3SensitivityEdgesRunExecutorDependencies["architectureCaptures"];
  readonly #seedCaptures:
    CoffeeMachineCm01V3SensitivityEdgesRunExecutorDependencies["seedCaptures"];
  readonly #sensitivityCaptures:
    CoffeeMachineCm01V3SensitivityEdgesRunExecutorDependencies["sensitivityCaptures"];
  readonly #sensitivityEdgesCaptures:
    CoffeeMachineCm01V3SensitivityEdgesRunExecutorDependencies[
      "sensitivityEdgesCaptures"
    ];
  readonly #attempts: FileSensitivityRelationsAttemptStore;
  readonly #syson: McpToolClient;
  readonly #lease: EngineeringProjectRunLease;
  readonly #now: () => string;

  constructor(
    deps: CoffeeMachineCm01V3SensitivityEdgesRunExecutorDependencies,
  ) {
    this.#projects = deps.projects;
    this.#commands = deps.commands;
    this.#snapshots = deps.snapshots;
    this.#architectureCaptures = deps.architectureCaptures;
    this.#seedCaptures = deps.seedCaptures;
    this.#sensitivityCaptures = deps.sensitivityCaptures;
    this.#sensitivityEdgesCaptures = deps.sensitivityEdgesCaptures;
    this.#attempts = deps.attempts;
    this.#syson = deps.syson;
    this.#lease = deps.lease;
    this.#now = deps.now ?? (() => new Date().toISOString());
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3SensitivityEdgesRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute the CM-01 sensitivity-edges anchoring run.",
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
    command: CoffeeMachineCm01V3SensitivityEdgesRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let providerAcknowledged = false;
    let snapshotPersisted = false;
    let materialized: SensitivityEdgesMaterialization | undefined;
    try {
      const preClaim = await this.requiredProject(command.projectId);
      const preClaimRun = requireRun(preClaim, command.runId);
      requireShape(preClaim, preClaimRun);

      if (preClaimRun.status === "completed") {
        assertCompleted(preClaim, command);
        return preClaim;
      }

      await this.#commands.claimRun(origin, {
        ...command,
        commandId: commandStep(command.commandId, "claim"),
        summary: "Started the CM-01 sensitivity-edges SysML anchoring run.",
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

      const edgesFingerprint = await fingerprintSensitivityEdgeSet(inputs.edges);

      let elementId: string;
      const walResult = await this.walBeginOrFail(
        command.projectId,
        command.runId,
        edgesFingerprint.digest,
        capturedAt,
      );
      if (walResult.action === "completed") {
        elementId = walResult.result.elementId;
        providerAcknowledged = true;
      } else {
        const sysmlText = renderSensitivityEdgeSetSysml(
          SENSITIVITY_EDGES_PART_DEF_NAME,
          inputs.edges,
        );
        elementId = await this.insertAndIdentify(
          command.projectId,
          command.runId,
          edgesFingerprint.digest,
          capturedAt,
          sysmlText,
          inputs,
        );
        providerAcknowledged = true;
      }

      // Verify re-extraction (fail-closed on any divergence).
      try {
        await extractAndVerifySensitivityEdges(
          this.#syson,
          inputs.editingContextId,
          elementId,
          inputs.edges,
        );
      } catch (error) {
        if (error instanceof SensitivityEdgeExtractionError) {
          throw new EngineeringProjectCommandError(
            "invalid_transition",
            `Sensitivity-edges extraction failed after insertion (${error.code}): ${error.message} ` +
              `Recovery hint: ${error.recovery}`,
          );
        }
        throw error;
      }

      // Save capture (CAS + readback).
      const captureRecord = {
        schemaVersion: SENSITIVITY_EDGES_CAPTURE_SCHEMA,
        elementId,
        editingContextId: inputs.editingContextId,
        architecturePackageId: inputs.architecturePackageId,
        partDefName: SENSITIVITY_EDGES_PART_DEF_NAME,
        edges: inputs.edges,
        insertedAt: capturedAt,
      };
      const captureText = deterministicJson(captureRecord);
      const captureFingerprint = await sha256Fingerprint(captureRecord);
      await this.#sensitivityEdgesCaptures.save(captureFingerprint, captureText);
      const persistedCapture = await this.#sensitivityEdgesCaptures.read(
        captureFingerprint,
      );
      if (persistedCapture !== captureText) {
        throw new Error(
          "CM-01 sensitivity-edges capture was not durably readable after save.",
        );
      }

      // Materialize ThreadSnapshot extension.
      const captureUri = this.#sensitivityEdgesCaptures.uriFor(captureFingerprint);
      materialized = materializeSensitivityEdges({
        base: inputs.base,
        runId: command.runId,
        capturedAt,
        edgesFingerprint,
        captureFingerprint,
        captureUri,
        elementId,
        architecturePackageId: inputs.architecturePackageId,
        architectureArtifactId: inputs.architectureArtifactId,
        sensitivityArtifactId: inputs.sensitivityArtifactId,
      });

      // Persist snapshot (CAS readback).
      await this.#snapshots.save(materialized.snapshot);
      const savedSnapshot = await this.#snapshots.get(materialized.snapshot.id);
      if (
        !savedSnapshot ||
        deterministicJson(savedSnapshot) !== deterministicJson(materialized.snapshot)
      ) {
        throw new Error(
          "CM-01 sensitivity-edges snapshot was not durably readable after save.",
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
            "Publishing the CM-01 sensitivity-edges SysML element and verification.",
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
            "Recorded the CM-01 sensitivity-edges SysML element and its verification read-back.",
          resultSnapshot: snapshotRef(materialized.snapshot),
          evidenceRefs: [artifactEntityRef(materialized.snapshot)],
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
          "CM-01 sensitivity-edges evidence is durable but project attachment did not finish. " +
            `Retry this exact command; it will not insert a second element.${cause}`,
        );
      }
      if (error instanceof SensitivityRelationsWriteOutcomeUnknownError) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The CM-01 sensitivity-edges SysON insertion outcome is unknown. " +
            "An operator must inspect via syson_element_children on the architecturePackage " +
            "before any separately reviewed recovery path.",
        );
      }
      if (providerAcknowledged) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The CM-01 sensitivity-edges SysON insertion was acknowledged but evidence " +
            "was not published. Retry this exact command to resume verification without " +
            "another insertion.",
        );
      }
      if (claimed) await this.recordFailure(origin, command);
      throw error;
    }
  }

  // ── Private: input loading ────────────────────────────────────────────────

  private async loadInputs(
    basis: EngineeringThreadSnapshotBasis,
  ): Promise<SensitivityEdgesInputs> {
    const base = await exactSnapshot(this.#snapshots, basis);
    if (base.subject.id !== "project:coffee-machine-cm01-v3") {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The basis ThreadSnapshot subject does not match the CM-01 project subject.",
      );
    }

    if (findSensitivityEdgesArtifact(base)) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "The basis ThreadSnapshot already carries a sensitivity-edges artifact. " +
          "A second insertion is not allowed.",
      );
    }

    await assertSensitivityEdgesNotRemoved(base, this.#snapshots);

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
          "The sensitivity-edges run must follow a completed architecture run.",
      );
    }

    const sensitivityArtifact = base.artifacts.find(
      (a) =>
        a.kind === "document" &&
        typeof a.uri === "string" &&
        a.uri.startsWith(SENSITIVITY_STUDY_URI_PREFIX),
    );
    if (!sensitivityArtifact) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `The basis ThreadSnapshot has no sensitivity-study artifact (URI prefix "${SENSITIVITY_STUDY_URI_PREFIX}"). ` +
          "The sensitivity-edges run must follow a completed sensitivity run.",
      );
    }

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

    const seedCaptureText = await this.#seedCaptures.read(archCapture.seedFingerprint);
    if (!seedCaptureText) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The SysON model-seed capture is not readable from the content-addressed store.",
      );
    }
    const editingContextId = extractEditingContextId(seedCaptureText);

    const sensitivityCaptureText = await this.#sensitivityCaptures.read(
      sensitivityArtifact.fingerprint,
    );
    if (!sensitivityCaptureText) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The sensitivity-study capture is not readable from the content-addressed store.",
      );
    }
    const edges = parseSensitivityCaptureIntoEdges(
      sensitivityCaptureText,
      sensitivityArtifact.id,
    );

    return {
      base,
      editingContextId,
      architecturePackageId: archCapture.architecturePackageId,
      architectureArtifactId: archArtifact.id,
      sensitivityArtifactId: sensitivityArtifact.id,
      edges,
    };
  }

  // ── Private: WAL begin ────────────────────────────────────────────────────

  private async walBeginOrFail(
    projectId: string,
    runId: string,
    edgesDigest: string,
    dispatchedAt: string,
  ): Promise<
    | { readonly action: "dispatch" }
    | { readonly action: "completed"; readonly result: { readonly elementId: string } }
  > {
    try {
      return await this.#attempts.begin({
        projectId,
        runId,
        relationsDigest: edgesDigest,
        dispatchedAt,
      });
    } catch (error) {
      if (error instanceof SensitivityRelationsWriteOutcomeUnknownError) throw error;
      throw new SensitivityRelationsWriteOutcomeUnknownError();
    }
  }

  // ── Private: insertion + element identification ───────────────────────────

  private async insertAndIdentify(
    projectId: string,
    runId: string,
    edgesDigest: string,
    capturedAt: string,
    sysmlText: string,
    inputs: SensitivityEdgesInputs,
  ): Promise<string> {
    // Idempotent recovery: adopt an element that already landed under the
    // server-fixed name without a durably recorded outcome.
    try {
      const preChildren = await this.#syson.callTool({
        name: "syson_element_children",
        arguments: {
          editing_context_id: inputs.editingContextId,
          element_id: inputs.architecturePackageId,
        },
      });
      const existing = identifyEdgesElements(
        preChildren.structuredContent,
        inputs.architecturePackageId,
      );
      if (existing.length > 1) {
        throw new SensitivityRelationsWriteOutcomeUnknownError();
      }
      if (existing.length === 1) return existing[0]!.id;
    } catch (error) {
      if (error instanceof SensitivityRelationsWriteOutcomeUnknownError) throw error;
      throw new SensitivityRelationsWriteOutcomeUnknownError();
    }

    try {
      const insertResult = await this.#syson.callTool({
        name: "syson_element_insert_sysml",
        arguments: {
          editing_context_id: inputs.editingContextId,
          parent_id: inputs.architecturePackageId,
          sysml_text: sysmlText,
        },
      });
      verifyInsertionAck(insertResult.structuredContent, inputs.architecturePackageId);
    } catch (error) {
      if (error instanceof SensitivityRelationsWriteOutcomeUnknownError) throw error;
      throw new SensitivityRelationsWriteOutcomeUnknownError();
    }

    let elementId: string;
    try {
      const childrenResult = await this.#syson.callTool({
        name: "syson_element_children",
        arguments: {
          editing_context_id: inputs.editingContextId,
          element_id: inputs.architecturePackageId,
        },
      });
      const matches = identifyEdgesElements(
        childrenResult.structuredContent,
        inputs.architecturePackageId,
      );
      if (matches.length !== 1) {
        throw new SensitivityRelationsWriteOutcomeUnknownError();
      }
      elementId = matches[0]!.id;
    } catch (error) {
      if (error instanceof SensitivityRelationsWriteOutcomeUnknownError) throw error;
      throw new SensitivityRelationsWriteOutcomeUnknownError();
    }

    const textSha256 = await sha256HexOf(sysmlText);
    await this.#attempts.complete({
      projectId,
      runId,
      relationsDigest: edgesDigest,
      dispatchedAt: capturedAt,
      completedAt: this.#now(),
      result: {
        elementId,
        parentId: inputs.architecturePackageId,
        textSha256,
        editingContextId: inputs.editingContextId,
      },
    });

    return elementId;
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
    command: CoffeeMachineCm01V3SensitivityEdgesRunExecutorCommand,
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
    command: CoffeeMachineCm01V3SensitivityEdgesRunExecutorCommand,
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
        summary:
          "CM-01 sensitivity-edges stopped before SysON insertion was acknowledged.",
        code: "coffee-machine-cm01-v3-sensitivity-edges-not-published",
        message:
          "The bounded CM-01 sensitivity-edges run stopped before evidence was published.",
      });
    } catch {
      // Preserve the original cause.
    }
  }
}

// ---------------------------------------------------------------------------
// Private: snapshot materialization
// ---------------------------------------------------------------------------

function materializeSensitivityEdges(input: {
  readonly base: ThreadSnapshot;
  readonly runId: string;
  readonly capturedAt: string;
  readonly edgesFingerprint: ContentFingerprint;
  readonly captureFingerprint: ContentFingerprint;
  readonly captureUri: string;
  readonly elementId: string;
  readonly architecturePackageId: string;
  readonly architectureArtifactId: string;
  readonly sensitivityArtifactId: string;
}): SensitivityEdgesMaterialization {
  const artifactId = `sensitivity-edges-${input.edgesFingerprint.digest}`;
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
    name: "CM-01 DripTray sensitivity-edge set declaration",
    kind: "sysml-model",
    version: input.edgesFingerprint.digest,
    fingerprint: input.edgesFingerprint,
    uri: input.captureUri,
    mediaType: "application/json",
    producer: operation,
    inputArtifactIds: [input.architectureArtifactId, input.sensitivityArtifactId],
    freshness,
  };

  const architectureArtifact = input.base.artifacts.find(
    (a) => a.id === input.architectureArtifactId,
  );
  if (!architectureArtifact) {
    throw new Error(
      `Architecture artifact "${input.architectureArtifactId}" is absent from the base snapshot.`,
    );
  }
  const sensitivityArtifact = input.base.artifacts.find(
    (a) => a.id === input.sensitivityArtifactId,
  );
  if (!sensitivityArtifact) {
    throw new Error(
      `Sensitivity artifact "${input.sensitivityArtifactId}" is absent from the base snapshot.`,
    );
  }

  const archConsumption: ThreadArtifactConsumption = {
    id: `consume-${input.architectureArtifactId}-by-${artifactId}`,
    artifactId: input.architectureArtifactId,
    consumer: operation,
    observedFingerprint: architectureArtifact.fingerprint,
    verifiedAt: input.capturedAt,
    status: "verified",
  };
  const sensitivityConsumption: ThreadArtifactConsumption = {
    id: `consume-${input.sensitivityArtifactId}-by-${artifactId}`,
    artifactId: input.sensitivityArtifactId,
    consumer: operation,
    observedFingerprint: sensitivityArtifact.fingerprint,
    verifiedAt: input.capturedAt,
    status: "verified",
  };

  const extension = {
    id: `capture-${artifactId}`,
    name: "Anchor the CM-01 sensitivity-edge set in the SysML model",
    subjectId: input.base.subject.id,
    capturedAt: input.capturedAt,
    artifacts: [artifact],
    consumptions: [archConsumption, sensitivityConsumption],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    proposedActions: [],
    provenance: [
      {
        id: `link-${artifactId}-derived-from-${input.architectureArtifactId}`,
        relation: "derived_from" as const,
        from: { kind: "artifact" as const, id: artifactId },
        to: { kind: "artifact" as const, id: input.architectureArtifactId },
        rationale:
          "The sensitivity-edges element was inserted into the architecture package.",
      },
      {
        id: `link-${artifactId}-derived-from-${input.sensitivityArtifactId}`,
        relation: "derived_from" as const,
        from: { kind: "artifact" as const, id: artifactId },
        to: { kind: "artifact" as const, id: input.sensitivityArtifactId },
        rationale:
          "The sensitivity-edges set was built from the sensitivity-study capture.",
      },
      {
        id: `link-${archConsumption.id}-uses-${input.architectureArtifactId}`,
        relation: "uses" as const,
        from: { kind: "consumption" as const, id: archConsumption.id },
        to: { kind: "artifact" as const, id: input.architectureArtifactId },
        rationale:
          "The executor re-read the architecture capture before inserting into the package.",
      },
      {
        id: `link-${sensitivityConsumption.id}-uses-${input.sensitivityArtifactId}`,
        relation: "uses" as const,
        from: { kind: "consumption" as const, id: sensitivityConsumption.id },
        to: { kind: "artifact" as const, id: input.sensitivityArtifactId },
        rationale:
          "The executor re-read the sensitivity capture to build the server-fixed edge set.",
      },
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
      "CM-01 sensitivity-edges evidence did not produce exactly one descendant snapshot.",
    );
  }

  return { snapshot: applied.snapshot };
}

// ---------------------------------------------------------------------------
// Private: sensitivity capture parsing into SensitivityEdge[]
//
// WHY SERVER_FIXED_EDGE_TEMPLATES REPLACES METRIC_TO_ATTR_NAME:
//   @1 mapped each derivative's metric id to a single SysML attribute name
//   string. @2 maps it to a complete SensitivityEdge template (driver attr,
//   response attr, constraint names). The domain contract (sensitivity-edge.ts)
//   carries the full shape, not just a name fragment — the metric→attribute
//   correspondence is data of the SensitivityEdge type, not a plain string.
// ---------------------------------------------------------------------------

function parseSensitivityCaptureIntoEdges(
  text: string,
  sensitivityArtifactId: string,
): readonly SensitivityEdge[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The sensitivity-study capture is not valid JSON.",
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The sensitivity-study capture must be an object.",
    );
  }
  const rec = value as Record<string, unknown>;

  const derivativesRaw = rec.derivatives;
  if (!Array.isArray(derivativesRaw) || derivativesRaw.length === 0) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The sensitivity-study capture has no derivatives array.",
    );
  }

  const domainRaw = rec.domain;
  if (!domainRaw || typeof domainRaw !== "object" || Array.isArray(domainRaw)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The sensitivity-study capture has no domain object.",
    );
  }
  const domain = domainRaw as Record<string, unknown>;

  const base = domain.base;
  const step = domain.step;
  const parameterUnit = domain.parameterUnit;
  if (
    typeof base !== "number" || !Number.isFinite(base) ||
    typeof step !== "number" || !Number.isFinite(step) || step <= 0 ||
    typeof parameterUnit !== "string" || !parameterUnit.trim()
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The sensitivity-study capture domain is missing base, step, or parameterUnit.",
    );
  }

  const capturedAt = rec.capturedAt;
  if (typeof capturedAt !== "string" || !capturedAt.trim()) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The sensitivity-study capture has no capturedAt.",
    );
  }

  const edgesRaw = derivativesRaw.map((d: unknown, index: number) => {
    if (!d || typeof d !== "object" || Array.isArray(d)) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `The sensitivity-study capture derivatives[${index}] is not an object.`,
      );
    }
    const deriv = d as Record<string, unknown>;
    if (
      typeof deriv.metric !== "string" || !deriv.metric.trim() ||
      typeof deriv.value !== "number" || !Number.isFinite(deriv.value) ||
      typeof deriv.unit !== "string" || !deriv.unit.trim()
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `The sensitivity-study capture derivatives[${index}] is missing metric, value, or unit.`,
      );
    }

    const template = SERVER_FIXED_EDGE_TEMPLATES.get(deriv.metric);
    if (template === undefined) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `The sensitivity-study capture derivatives[${index}].metric "${deriv.metric}" ` +
          "has no server-fixed attribute name mapping. Only metrics " +
          [...SERVER_FIXED_EDGE_TEMPLATES.keys()].join(", ") + " are supported.",
      );
    }

    // Build the SensitivityEdge from the server-fixed template and capture values.
    // The SensitivityEdge domain contract carries the full structural shape;
    // only the derivative value and provenance timestamps are dynamic.
    return {
      schemaVersion: SENSITIVITY_EDGE_SCHEMA,
      driver: {
        sysmlAttrName: template.driverSysmlAttrName,
        unit: String(parameterUnit),
        basePoint: { value: base as number, unit: String(parameterUnit) },
        validityNeighborhood: {
          lower: {
            value: (base as number) - (step as number),
            unit: String(parameterUnit),
          },
          upper: {
            value: (base as number) + (step as number),
            unit: String(parameterUnit),
          },
          lowerConstraintName: template.lowerConstraintName,
          upperConstraintName: template.upperConstraintName,
        },
      },
      response: {
        metric: String(deriv.metric),
        sysmlAttrName: template.responseSysmlAttrName,
        unit: String(deriv.unit),
      },
      derivative: {
        value: deriv.value as number,
        unit: String(deriv.unit),
      },
      provenance: {
        runId: sensitivityArtifactId,
        capturedAt: String(capturedAt),
      },
    };
  });

  try {
    return validateSensitivityEdgeSet(edgesRaw);
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `The sensitivity-study capture produced an invalid edge set: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

// ---------------------------------------------------------------------------
// Private: shape validation helpers
// ---------------------------------------------------------------------------

const SENSITIVITY_EDGES_OP =
  COFFEE_MACHINE_CM01_V3_OPERATION_REFS.sensitivityRelationsV2;

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
    operation?.id !== SENSITIVITY_EDGES_OP.id ||
    operation.version !== SENSITIVITY_EDGES_OP.version ||
    operation.bindings.length !== 2 ||
    operation.bindings[0]?.name !== "approvedBrief" ||
    operation.bindings[0].source.kind !== "approved-brief" ||
    operation.bindings[1]?.name !== "sensitivityArtifact" ||
    operation.bindings[1].source.kind !== "thread-entity"
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the canonical CM-01 V3 sensitivity-edges @2 operation.",
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
      "This executor may run only the exact sensitivity-edges run it claimed.",
    );
  }
}

// ---------------------------------------------------------------------------
// Private: insertion response validation
// ---------------------------------------------------------------------------

function verifyInsertionAck(value: unknown, expectedParentId: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SysON insert response must be an object.");
  }
  const rec = value as Record<string, unknown>;
  if (rec.inserted !== true) {
    throw new Error(
      `SysON insert did not acknowledge success (inserted: ${String(rec.inserted)}).`,
    );
  }
  if (rec.parentId !== expectedParentId) {
    throw new Error(
      `SysON insert parentId mismatch: expected "${expectedParentId}", got "${
        String(rec.parentId)
      }".`,
    );
  }
}

// ---------------------------------------------------------------------------
// Private: element identification by server-fixed name
// ---------------------------------------------------------------------------

function identifyEdgesElements(
  value: unknown,
  expectedParentId: string,
): SysmlElement[] {
  const items = parseChildrenResponse(value, expectedParentId);
  return items.filter((item) => item.label === SENSITIVITY_EDGES_PART_DEF_NAME);
}

function parseChildrenResponse(
  value: unknown,
  expectedParentId: string,
): SysmlElement[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SysON children response must be an object.");
  }
  const rec = value as Record<string, unknown>;
  if (rec.parentId !== expectedParentId) {
    throw new Error(
      `SysON children parentId mismatch: expected "${expectedParentId}", got "${
        String(rec.parentId)
      }".`,
    );
  }
  if (!Array.isArray(rec.children) || rec.count !== rec.children.length) {
    throw new Error("SysON children response has an invalid shape.");
  }
  return (rec.children as unknown[]).map((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error(`SysON child ${index} is not an object.`);
    }
    const child = candidate as Record<string, unknown>;
    if (
      typeof child.id !== "string" || !child.id.trim() ||
      typeof child.kind !== "string" || !child.kind.trim() ||
      typeof child.label !== "string"
    ) {
      throw new Error(`SysON child ${index} has an invalid shape.`);
    }
    return { id: child.id, kind: child.kind, label: child.label };
  });
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
  const rec = value as Record<string, unknown>;

  const pkg = rec.architecturePackage;
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

  const seedRaw = rec.seed;
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
  const rec = value as Record<string, unknown>;
  const results = rec.normalizedResults;
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
      "The exact basis ThreadSnapshot required by the sensitivity-edges run is not readable.",
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
  command: CoffeeMachineCm01V3SensitivityEdgesRunExecutorCommand,
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
      `CM-01 sensitivity-edges run ${command.runId} did not complete through this exact command.`,
    );
  }
}

function commandStep(commandId: string, step: string): string {
  return `${commandId}:coffee-machine-cm01-v3-sensitivity-edges:${step}`;
}

function artifactEntityRef(snapshot: ThreadSnapshot): EngineeringThreadEntityRef {
  const artifact = snapshot.artifacts.find(
    (a) => typeof a.uri === "string" && a.uri.startsWith(SENSITIVITY_EDGES_URI_PREFIX),
  );
  if (!artifact) {
    throw new Error(
      "Sensitivity-edges snapshot has no sensitivity-edges artifact.",
    );
  }
  return {
    snapshotId: snapshot.id,
    snapshotRevision: snapshot.revision,
    kind: "artifact",
    id: artifact.id,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function sha256HexOf(text: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
