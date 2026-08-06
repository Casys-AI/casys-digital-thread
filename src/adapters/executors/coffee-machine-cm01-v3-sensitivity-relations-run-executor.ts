/**
 * Executor for the CM-01 sensitivity-relations anchoring operation.
 *
 * Reads the completed sensitivity-study capture from the basis snapshot,
 * builds a server-fixed SensitivityRelationsDeclaration (no agent values),
 * inserts a DripTraySensitivityRelations PartDef into the SysON architecture
 * package, verifies re-extraction, and publishes the successor ThreadSnapshot.
 *
 * WHY THIS EXECUTOR IS CLOSED — the agent never supplies SysML text, attribute
 * names, metric mappings, or bound values. Everything comes from the reviewed
 * sensitivity-study capture and the server-fixed metric-to-attribute mapping
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
} from "../../domain/kernel/deterministic-json.ts";
import {
  fingerprintSensitivityRelations,
  renderSensitivityRelationsSysml,
  SENSITIVITY_RELATIONS_SCHEMA,
  type SensitivityRelationsDeclaration,
  validateSensitivityRelationsDeclaration,
} from "../../domain/analysis/sensitivity-relations.ts";
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
import type { FileCaptureStore } from "../captures/file-capture-store.ts";
import type { EngineeringProjectRunLease } from "../stores/file-engineering-project-run-lease.ts";
import type { McpToolClient } from "../mcp/http-mcp-tool-client.ts";
import {
  extractAndVerifySensitivityRelations,
  SensitivityRelationsExtractionError,
} from "../extractors/syson-sensitivity-relations-extractor.ts";
import {
  FileSensitivityRelationsAttemptStore,
  SensitivityRelationsWriteOutcomeUnknownError,
} from "../wal/file-sensitivity-relations-attempt-store.ts";
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

export const SENSITIVITY_RELATIONS_URI_PREFIX =
  "casys://sensitivity-relations-seed-capture/" as const;

export const SENSITIVITY_RELATIONS_CAPTURE_SCHEMA =
  "sensitivity-relations-seed-capture/1.0" as const;

export const COFFEE_MACHINE_CM01_V3_SENSITIVITY_RELATIONS_OPERATION =
  COFFEE_MACHINE_CM01_V3_OPERATION_REFS.sensitivityRelations;

/**
 * Server-fixed PartDef name for the DripTray sensitivity relations element.
 * Invariant 6: an agent never names or renames the SysML element.
 */
const SENSITIVITY_RELATIONS_PART_DEF_NAME = "DripTraySensitivityRelations" as const;

/**
 * URI prefix used to find the architecture artifact in the basis snapshot.
 */
const ARCHITECTURE_URI_PREFIX = "casys://coffee-machine-cm01-v3-architecture/" as const;

/**
 * URI prefix used to find the sensitivity-study capture artifact.
 */
const SENSITIVITY_STUDY_URI_PREFIX = "casys://sensitivity-study-capture/" as const;

/**
 * Server-fixed mapping from sensitivity-case metric id to SysML attribute name.
 * The agent never supplies this mapping; it is code-owned.
 */
const METRIC_TO_ATTR_NAME: ReadonlyMap<string, string> = new Map([
  ["assembly_max_displacement", "dDisplacementDSizeZ_mm_per_mm"],
  ["assembly_max_von_mises", "dVonMisesDSizeZ_MPa_per_mm"],
]);

const BASE_ATTR_NAME = "sizeZ_base_mm" as const;
const STEP_ATTR_NAME = "sizeZ_step_mm" as const;
const VALIDITY_LOWER_NAME = "sizeZ_validity_lower" as const;
const VALIDITY_UPPER_NAME = "sizeZ_validity_upper" as const;

// ---------------------------------------------------------------------------
// Exported error types — monotony ratchet
// ---------------------------------------------------------------------------

/**
 * Raised when a snapshot's ancestor had a sensitivity-relations artifact but
 * the given basis does not.
 *
 * MONOTONY RATCHET: once a revision of a subject's thread carries the
 * sensitivity-relations artifact, every subsequent revision MUST also carry it.
 */
export class SensitivityRelationsArtifactRemovedError extends Error {
  constructor(subjectId: string) {
    super(
      `Snapshot lineage for subject "${subjectId}" previously carried a sensitivity-relations ` +
        `artifact (URI prefix "${SENSITIVITY_RELATIONS_URI_PREFIX}") ` +
        `but the current basis does not. The artifact cannot be silently dropped — ` +
        `stop for review before allowing downstream runs.`,
    );
    this.name = "SensitivityRelationsArtifactRemovedError";
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CoffeeMachineCm01V3SensitivityRelationsRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface CoffeeMachineCm01V3SensitivityRelationsRunExecutorDependencies {
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
  readonly sensitivityRelationsCaptures: FileCaptureStore<
    "sensitivity-relations-seed"
  >;
  readonly attempts: FileSensitivityRelationsAttemptStore;
  readonly syson: McpToolClient;
  readonly lease: EngineeringProjectRunLease;
  readonly now?: () => string;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface SensitivityRelationsInputs {
  readonly base: ThreadSnapshot;
  readonly editingContextId: string;
  readonly architecturePackageId: string;
  readonly declarationIds: readonly string[];
  readonly architectureArtifactId: string;
  readonly sensitivityArtifactId: string;
  readonly declaration: SensitivityRelationsDeclaration;
}

interface SensitivityRelationsMaterialization {
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

/**
 * Verify that no ancestor of `basis` had a sensitivity-relations artifact that
 * the current revision silently dropped.
 */
export async function assertSensitivityRelationsNotRemoved(
  basis: ThreadSnapshot,
  snapshots: ThreadSnapshotStore,
): Promise<void> {
  if (findSensitivityRelationsArtifact(basis)) return;
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
    if (findSensitivityRelationsArtifact(ancestor)) {
      throw new SensitivityRelationsArtifactRemovedError(basis.subject.id);
    }
    cursor = ancestor.previous;
  }
}

// ---------------------------------------------------------------------------
// Public: find artifact helper
// ---------------------------------------------------------------------------

export function findSensitivityRelationsArtifact(
  snapshot: ThreadSnapshot,
): ThreadArtifact | undefined {
  return snapshot.artifacts.find(
    (a) =>
      a.kind === "sysml-model" &&
      typeof a.uri === "string" &&
      a.uri.startsWith(SENSITIVITY_RELATIONS_URI_PREFIX),
  );
}

// ---------------------------------------------------------------------------
// Public: executor
// ---------------------------------------------------------------------------

export class CoffeeMachineCm01V3SensitivityRelationsRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: EngineeringProjectCommandService;
  readonly #snapshots: ThreadSnapshotStore;
  readonly #architectureCaptures:
    CoffeeMachineCm01V3SensitivityRelationsRunExecutorDependencies[
      "architectureCaptures"
    ];
  readonly #seedCaptures:
    CoffeeMachineCm01V3SensitivityRelationsRunExecutorDependencies["seedCaptures"];
  readonly #sensitivityCaptures:
    CoffeeMachineCm01V3SensitivityRelationsRunExecutorDependencies[
      "sensitivityCaptures"
    ];
  readonly #sensitivityRelationsCaptures:
    CoffeeMachineCm01V3SensitivityRelationsRunExecutorDependencies[
      "sensitivityRelationsCaptures"
    ];
  readonly #attempts: FileSensitivityRelationsAttemptStore;
  readonly #syson: McpToolClient;
  readonly #lease: EngineeringProjectRunLease;
  readonly #now: () => string;

  constructor(
    dependencies: CoffeeMachineCm01V3SensitivityRelationsRunExecutorDependencies,
  ) {
    this.#projects = dependencies.projects;
    this.#commands = dependencies.commands;
    this.#snapshots = dependencies.snapshots;
    this.#architectureCaptures = dependencies.architectureCaptures;
    this.#seedCaptures = dependencies.seedCaptures;
    this.#sensitivityCaptures = dependencies.sensitivityCaptures;
    this.#sensitivityRelationsCaptures = dependencies.sensitivityRelationsCaptures;
    this.#attempts = dependencies.attempts;
    this.#syson = dependencies.syson;
    this.#lease = dependencies.lease;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3SensitivityRelationsRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute the CM-01 sensitivity-relations anchoring run.",
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
    command: CoffeeMachineCm01V3SensitivityRelationsRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let providerAcknowledged = false;
    let snapshotPersisted = false;
    let materialized: SensitivityRelationsMaterialization | undefined;
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
        summary: "Started the CM-01 sensitivity-relations SysML anchoring run.",
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

      const relationsFingerprint = await fingerprintSensitivityRelations(
        inputs.declaration,
      );

      let elementId: string;
      const walResult = await this.walBeginOrFail(
        command.projectId,
        command.runId,
        relationsFingerprint.digest,
        capturedAt,
      );
      if (walResult.action === "completed") {
        elementId = walResult.result.elementId;
        providerAcknowledged = true;
      } else {
        const sysmlText = renderSensitivityRelationsSysml(
          SENSITIVITY_RELATIONS_PART_DEF_NAME,
          inputs.declaration,
        );
        elementId = await this.insertAndIdentify(
          command.projectId,
          command.runId,
          relationsFingerprint.digest,
          capturedAt,
          sysmlText,
          inputs,
        );
        providerAcknowledged = true;
      }

      // Step 11: verify re-extraction (fail-closed on any divergence).
      try {
        await extractAndVerifySensitivityRelations(
          this.#syson,
          inputs.editingContextId,
          elementId,
          inputs.declaration,
        );
      } catch (error) {
        if (error instanceof SensitivityRelationsExtractionError) {
          throw new EngineeringProjectCommandError(
            "invalid_transition",
            `Sensitivity-relations extraction failed after insertion (${error.code}): ${error.message} ` +
              `Recovery hint: ${error.recovery}`,
          );
        }
        throw error;
      }

      // Step 12: save capture (CAS, then readback).
      const captureRecord = {
        schemaVersion: SENSITIVITY_RELATIONS_CAPTURE_SCHEMA,
        elementId,
        editingContextId: inputs.editingContextId,
        architecturePackageId: inputs.architecturePackageId,
        partDefName: SENSITIVITY_RELATIONS_PART_DEF_NAME,
        declaration: inputs.declaration,
        insertedAt: capturedAt,
      };
      const captureText = deterministicJson(captureRecord);
      const captureFingerprint = await sha256Fingerprint(captureRecord);
      await this.#sensitivityRelationsCaptures.save(captureFingerprint, captureText);
      const persistedCapture = await this.#sensitivityRelationsCaptures.read(
        captureFingerprint,
      );
      if (persistedCapture !== captureText) {
        throw new Error(
          "CM-01 sensitivity-relations capture was not durably readable after save.",
        );
      }

      // Step 13: materialize ThreadSnapshot extension.
      const captureUri = this.#sensitivityRelationsCaptures.uriFor(captureFingerprint);
      materialized = materializeSensitivityRelations({
        base: inputs.base,
        runId: command.runId,
        capturedAt,
        relationsFingerprint,
        captureFingerprint,
        captureUri,
        elementId,
        architecturePackageId: inputs.architecturePackageId,
        architectureArtifactId: inputs.architectureArtifactId,
        sensitivityArtifactId: inputs.sensitivityArtifactId,
      });

      // Step 14a: persist snapshot (CAS readback).
      await this.#snapshots.save(materialized.snapshot);
      const savedSnapshot = await this.#snapshots.get(materialized.snapshot.id);
      if (
        !savedSnapshot ||
        deterministicJson(savedSnapshot) !== deterministicJson(materialized.snapshot)
      ) {
        throw new Error(
          "CM-01 sensitivity-relations snapshot was not durably readable after save.",
        );
      }
      snapshotPersisted = true;

      // Step 14b: publish run.
      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary:
            "Publishing the CM-01 sensitivity-relations SysML element and verification.",
        });
      } else if (run.status !== "publishing" && run.status !== "completed") {
        throw unexpectedStatus(run, "publishing");
      }

      // Step 14c: complete run.
      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.#commands.completeRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "complete"),
          expectedRevision: project.revision,
          summary:
            "Recorded the CM-01 sensitivity-relations SysML element and its verification read-back.",
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
          "CM-01 sensitivity-relations evidence is durable but project attachment did not finish. " +
            `Retry this exact command; it will not insert a second element.${cause}`,
        );
      }
      if (error instanceof SensitivityRelationsWriteOutcomeUnknownError) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The CM-01 sensitivity-relations SysON insertion outcome is unknown. " +
            "An operator must inspect via syson_element_children on the architecturePackage " +
            "before any separately reviewed recovery path.",
        );
      }
      if (providerAcknowledged) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The CM-01 sensitivity-relations SysON insertion was acknowledged but evidence " +
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
  ): Promise<SensitivityRelationsInputs> {
    const base = await exactSnapshot(this.#snapshots, basis);
    if (base.subject.id !== "project:coffee-machine-cm01-v3") {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The basis ThreadSnapshot subject does not match the CM-01 project subject.",
      );
    }

    // Guard: no duplicate insertion.
    if (findSensitivityRelationsArtifact(base)) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "The basis ThreadSnapshot already carries a sensitivity-relations artifact. " +
          "A second insertion is not allowed.",
      );
    }

    // Monotony ratchet: if any ancestor carried the artifact, the current basis
    // must also carry it. An absent artifact after a present one is a hard stop.
    await assertSensitivityRelationsNotRemoved(base, this.#snapshots);

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
          "The sensitivity-relations run must follow a completed architecture run.",
      );
    }

    // Find the sensitivity-study artifact by URI prefix.
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
          "The sensitivity-relations run must follow a completed sensitivity run.",
      );
    }

    // Read the architecture capture to get architecturePackageId, declarationIds, seed.
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

    // Read the sensitivity capture to build the declaration.
    const sensitivityCaptureText = await this.#sensitivityCaptures.read(
      sensitivityArtifact.fingerprint,
    );
    if (!sensitivityCaptureText) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The sensitivity-study capture is not readable from the content-addressed store.",
      );
    }
    const declaration = parseSensitivityCaptureIntoDeclaration(
      sensitivityCaptureText,
      sensitivityArtifact.id,
    );

    return {
      base,
      editingContextId,
      architecturePackageId: archCapture.architecturePackageId,
      declarationIds: archCapture.declarationIds,
      architectureArtifactId: archArtifact.id,
      sensitivityArtifactId: sensitivityArtifact.id,
      declaration,
    };
  }

  // ── Private: WAL begin ────────────────────────────────────────────────────

  private async walBeginOrFail(
    projectId: string,
    runId: string,
    relationsDigest: string,
    dispatchedAt: string,
  ): Promise<
    | { readonly action: "dispatch" }
    | { readonly action: "completed"; readonly result: { readonly elementId: string } }
  > {
    try {
      return await this.#attempts.begin({
        projectId,
        runId,
        relationsDigest,
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
    relationsDigest: string,
    capturedAt: string,
    sysmlText: string,
    inputs: SensitivityRelationsInputs,
  ): Promise<string> {
    // Idempotent recovery first: a prior attempt may have landed without an
    // acknowledged outcome. If the exact server-fixed element name already
    // exists, adopt it instead of inserting a duplicate — the downstream
    // re-extraction verifies its fidelity before anything is published.
    // Two same-named elements are a state only an operator may resolve.
    try {
      const preChildren = await this.#syson.callTool({
        name: "syson_element_children",
        arguments: {
          editing_context_id: inputs.editingContextId,
          element_id: inputs.architecturePackageId,
        },
      });
      const existing = identifyRelationsElements(
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
      const matches = identifyRelationsElements(
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
      relationsDigest,
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
    command: CoffeeMachineCm01V3SensitivityRelationsRunExecutorCommand,
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
    command: CoffeeMachineCm01V3SensitivityRelationsRunExecutorCommand,
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
          "CM-01 sensitivity-relations stopped before SysON insertion was acknowledged.",
        code: "coffee-machine-cm01-v3-sensitivity-relations-not-published",
        message:
          "The bounded CM-01 sensitivity-relations run stopped before evidence was published.",
      });
    } catch {
      // Preserve the original cause.
    }
  }
}

// ---------------------------------------------------------------------------
// Private: snapshot materialization
// ---------------------------------------------------------------------------

function materializeSensitivityRelations(input: {
  readonly base: ThreadSnapshot;
  readonly runId: string;
  readonly capturedAt: string;
  readonly relationsFingerprint: ContentFingerprint;
  readonly captureFingerprint: ContentFingerprint;
  readonly captureUri: string;
  readonly elementId: string;
  readonly architecturePackageId: string;
  readonly architectureArtifactId: string;
  readonly sensitivityArtifactId: string;
}): SensitivityRelationsMaterialization {
  const artifactId = `sensitivity-relations-${input.relationsFingerprint.digest}`;
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
    name: "CM-01 DripTray sensitivity-relations declaration",
    kind: "sysml-model",
    version: input.relationsFingerprint.digest,
    fingerprint: input.relationsFingerprint,
    uri: input.captureUri,
    mediaType: "application/json",
    producer: operation,
    inputArtifactIds: [input.architectureArtifactId, input.sensitivityArtifactId],
    freshness,
  };

  // WHY observedFingerprint = architectureArtifact.fingerprint:
  // The consumed artifact is the architecture artifact (we inserted into its package).
  // Using captureFingerprint would produce a permanent fingerprint_mismatch error.
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
    name: "Anchor the CM-01 sensitivity-relations declaration in the SysML model",
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
          "The sensitivity-relations element was inserted into the architecture package.",
      },
      {
        id: `link-${artifactId}-derived-from-${input.sensitivityArtifactId}`,
        relation: "derived_from" as const,
        from: { kind: "artifact" as const, id: artifactId },
        to: { kind: "artifact" as const, id: input.sensitivityArtifactId },
        rationale:
          "The sensitivity-relations declaration was built from the sensitivity-study capture.",
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
          "The executor re-read the sensitivity capture to build the server-fixed declaration.",
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
      "CM-01 sensitivity-relations evidence did not produce exactly one descendant snapshot.",
    );
  }

  return { snapshot: applied.snapshot };
}

// ---------------------------------------------------------------------------
// Private: sensitivity capture parsing into declaration
// ---------------------------------------------------------------------------

/**
 * Parse the minimum fields from a sensitivity-study capture JSON and build the
 * server-fixed SensitivityRelationsDeclaration.
 *
 * The mapping from metric id to attribute name is server-fixed via
 * METRIC_TO_ATTR_NAME. A metric absent from that map is a hard failure.
 *
 * @throws EngineeringProjectCommandError on any structural divergence.
 */
function parseSensitivityCaptureIntoDeclaration(
  text: string,
  sensitivityArtifactId: string,
): SensitivityRelationsDeclaration {
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

  const derivativeAttrs = derivativesRaw.map((d: unknown, index: number) => {
    if (!d || typeof d !== "object" || Array.isArray(d)) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `The sensitivity-study capture derivatives[${index}] is not an object.`,
      );
    }
    const deriv = d as Record<string, unknown>;
    if (
      typeof deriv.metric !== "string" || !deriv.metric.trim() ||
      typeof deriv.unit !== "string" || !deriv.unit.trim()
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `The sensitivity-study capture derivatives[${index}] is missing metric or unit.`,
      );
    }
    const attrName = METRIC_TO_ATTR_NAME.get(deriv.metric);
    if (attrName === undefined) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `The sensitivity-study capture derivatives[${index}].metric "${deriv.metric}" ` +
          "has no server-fixed attribute name mapping. Only metrics " +
          [...METRIC_TO_ATTR_NAME.keys()].join(", ") + " are supported.",
      );
    }
    return { attrName, unit: deriv.unit };
  });

  const declarationValue: unknown = {
    schemaVersion: SENSITIVITY_RELATIONS_SCHEMA,
    paramAttrs: [
      { attrName: BASE_ATTR_NAME, unit: String(parameterUnit) },
      { attrName: STEP_ATTR_NAME, unit: String(parameterUnit) },
    ],
    derivativeAttrs,
    validityBounds: [
      {
        constraintName: VALIDITY_LOWER_NAME,
        paramAttrName: BASE_ATTR_NAME,
        operator: ">=",
        boundValue: (base as number) - (step as number),
        boundUnit: String(parameterUnit),
      },
      {
        constraintName: VALIDITY_UPPER_NAME,
        paramAttrName: BASE_ATTR_NAME,
        operator: "<=",
        boundValue: (base as number) + (step as number),
        boundUnit: String(parameterUnit),
      },
    ],
    runId: sensitivityArtifactId,
    capturedAt: String(capturedAt),
  };

  try {
    return validateSensitivityRelationsDeclaration(declarationValue);
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `The sensitivity-study capture produced an invalid declaration: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

// ---------------------------------------------------------------------------
// Private: shape validation helpers
// ---------------------------------------------------------------------------

const SENSITIVITY_RELATIONS_OP =
  COFFEE_MACHINE_CM01_V3_OPERATION_REFS.sensitivityRelations;

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
    operation?.id !== SENSITIVITY_RELATIONS_OP.id ||
    operation.version !== SENSITIVITY_RELATIONS_OP.version ||
    operation.bindings.length !== 2 ||
    operation.bindings[0]?.name !== "approvedBrief" ||
    operation.bindings[0].source.kind !== "approved-brief" ||
    operation.bindings[1]?.name !== "sensitivityArtifact" ||
    operation.bindings[1].source.kind !== "thread-entity"
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the canonical CM-01 V3 sensitivity-relations @1 operation.",
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
      "This executor may run only the exact sensitivity-relations run it claimed.",
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
  const record = value as Record<string, unknown>;
  if (record.inserted !== true) {
    throw new Error(
      `SysON insert did not acknowledge success (inserted: ${
        String(record.inserted)
      }).`,
    );
  }
  if (record.parentId !== expectedParentId) {
    throw new Error(
      `SysON insert parentId mismatch: expected "${expectedParentId}", got "${
        String(record.parentId)
      }".`,
    );
  }
}

// ---------------------------------------------------------------------------
// Private: element identification by exclusion
// ---------------------------------------------------------------------------

/**
 * The inserted element carries the server-fixed part-def name, which is the
 * only durable identity this executor controls. Exclusion-by-known-ids broke
 * the day the package gained the anchored requirements element (R13): after
 * insertion two children were "unknown" and the outcome went unresolvable.
 */
function identifyRelationsElements(
  value: unknown,
  expectedParentId: string,
): SysmlElement[] {
  const items = parseChildrenResponse(value, expectedParentId);
  return items.filter((item) => item.label === SENSITIVITY_RELATIONS_PART_DEF_NAME);
}

function parseChildrenResponse(
  value: unknown,
  expectedParentId: string,
): SysmlElement[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SysON children response must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (record.parentId !== expectedParentId) {
    throw new Error(
      `SysON children parentId mismatch: expected "${expectedParentId}", got "${
        String(record.parentId)
      }".`,
    );
  }
  if (!Array.isArray(record.children) || record.count !== record.children.length) {
    throw new Error("SysON children response has an invalid shape.");
  }
  return (record.children as unknown[]).map((candidate, index) => {
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
// Private: architecture capture parsing (same as oracle-requirements executor)
// ---------------------------------------------------------------------------

function parseArchitectureCapture(text: string): {
  architecturePackageId: string;
  declarationIds: readonly string[];
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

  const decls = record.declarations;
  if (!Array.isArray(decls)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The architecture capture has no declarations array.",
    );
  }
  const declarationIds = decls.map((d: unknown, i: number) => {
    if (
      !d || typeof d !== "object" || Array.isArray(d) ||
      typeof (d as Record<string, unknown>).id !== "string"
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `The architecture capture declarations[${i}].id is invalid.`,
      );
    }
    return ((d as Record<string, unknown>).id as string).trim();
  });

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
    declarationIds,
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
      "The exact basis ThreadSnapshot required by the sensitivity-relations run is not readable.",
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
  command: CoffeeMachineCm01V3SensitivityRelationsRunExecutorCommand,
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
      `CM-01 sensitivity-relations run ${command.runId} did not complete through this exact command.`,
    );
  }
}

function commandStep(commandId: string, step: string): string {
  return `${commandId}:coffee-machine-cm01-v3-sensitivity-relations:${step}`;
}

function artifactEntityRef(snapshot: ThreadSnapshot): EngineeringThreadEntityRef {
  const artifact = snapshot.artifacts.find(
    (a) =>
      typeof a.uri === "string" && a.uri.startsWith(SENSITIVITY_RELATIONS_URI_PREFIX),
  );
  if (!artifact) {
    throw new Error(
      "Sensitivity-relations snapshot has no sensitivity-relations artifact.",
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
