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
import type { Cm01DripTrayMechanicalProof } from "../../domain/cm01-drip-tray-mechanical-proof.ts";
import {
  fingerprintOracleRequirements,
  type OracleRequirement,
  renderOracleRequirementsSysml,
} from "../../domain/proof-case.ts";
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
import {
  FileOracleRequirementsSeedAttemptStore,
  OracleRequirementsSeedWriteOutcomeUnknownError,
} from "../file-oracle-requirements-seed-attempt-store.ts";
import type { FileCaptureStore } from "../file-capture-store.ts";
import type { EngineeringProjectRunLease } from "../stores/file-engineering-project-run-lease.ts";
import type { McpToolClient } from "../http-mcp-tool-client.ts";
import {
  extractAndVerifyOracleRequirements,
  RequirementExtractionError,
} from "../extractors/syson-requirements-extractor.ts";
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

/**
 * URI prefix that identifies oracle-requirements artifacts in a ThreadSnapshot.
 * Downstream consumers (e.g. mechanical executors) use this prefix — not kind
 * alone — because the snapshot already contains other sysml-model artifacts.
 */
export const ORACLE_REQUIREMENTS_URI_PREFIX =
  "casys://oracle-requirements-seed-capture/" as const;

export const ORACLE_REQUIREMENTS_CAPTURE_SCHEMA =
  "oracle-requirements-seed-capture/1.0" as const;

export const COFFEE_MACHINE_CM01_V3_ORACLE_REQUIREMENTS_OPERATION =
  COFFEE_MACHINE_CM01_V3_OPERATION_REFS.oracleRequirements;

/**
 * Server-fixed partDef name for the DripTray mechanical requirement element.
 *
 * WHY THIS IS A CONSTANT, NOT AN ARGUMENT: the agent must never be able to
 * name or rename the SysML element that anchors the reviewed thresholds.
 * If the name were an argument, a malformed or adversarial call could create
 * a second, differently named element and bypass the extraction check.
 * Invariant 6 is enforced here: the server owns the SysML shape, not the agent.
 */
const PART_DEF_NAME = "DripTrayMechanicalRequirements" as const;

/**
 * URI prefix used to find the architecture artifact in the basis snapshot.
 * The oracle-requirements element is inserted into the architecturePackage,
 * whose id comes from reading the architecture capture.
 */
const ARCHITECTURE_URI_PREFIX = "casys://coffee-machine-cm01-v3-architecture/" as const;

// ---------------------------------------------------------------------------
// Exported error types
// ---------------------------------------------------------------------------

/**
 * Raised when a snapshot's ancestor had an oracle-requirements artifact but
 * the given basis does not.
 *
 * MONOTONY RATCHET: once a revision of a subject's thread carries the
 * oracle-requirements artifact, every subsequent revision MUST also carry it.
 * Silently dropping the artifact would disable the fidelity-extraction check
 * that mechanical executors rely on — a silent weakening of the verification
 * chain.
 *
 * WIRING NOTE: this error must be checked by every executor whose basis
 * snapshot may follow an oracle-requirements run (DripTray mechanical
 * executors). The check is exported as `assertOracleRequirementsNotRemoved`
 * below. Wiring into the mechanical executors is a separate step tracked in
 * the CLIQUET DE MONOTONIE section of the project architecture record.
 */
export class OracleRequirementsArtifactRemovedError extends Error {
  constructor(subjectId: string) {
    super(
      `Snapshot lineage for subject "${subjectId}" previously carried an oracle ` +
        `requirements artifact (URI prefix "${ORACLE_REQUIREMENTS_URI_PREFIX}") ` +
        `but the current basis does not. The artifact cannot be silently dropped — ` +
        `stop for review before allowing downstream mechanical runs.`,
    );
    this.name = "OracleRequirementsArtifactRemovedError";
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CoffeeMachineCm01V3OracleRequirementsRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface CoffeeMachineCm01V3OracleRequirementsRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore;
  /** Reads the content-addressed architecture capture by its fingerprint. */
  readonly architectureCaptures: FileCaptureStore<
    "coffee-machine-cm01-v3-architecture"
  >;
  /** Reads the content-addressed SysON model-seed capture by its fingerprint. */
  readonly seedCaptures: {
    read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  };
  /** Writes and reads the content-addressed oracle requirements seed captures. */
  readonly requirementsCaptures: FileCaptureStore<"oracle-requirements-seed">;
  /** Durable WAL that prevents a second insert for the same (project, run). */
  readonly attempts: FileOracleRequirementsSeedAttemptStore;
  /**
   * Reviewed proof parsed from config/mechanical-proof-cases/*.json.
   * The executor reads only proof.limits; thresholds never come from an agent.
   * The narrow Pick type enforces that the executor cannot accidentally read
   * non-limit fields (geometry, material, mesh) — those belong to the mechanical
   * executors, not to oracle requirements authoring.
   */
  readonly proof: Pick<Cm01DripTrayMechanicalProof, "limits">;
  /** Fixed server-owned SysON MCP client. No agent value reaches this boundary. */
  readonly syson: McpToolClient;
  readonly lease: EngineeringProjectRunLease;
  readonly now?: () => string;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface OracleRequirementsInputs {
  readonly base: ThreadSnapshot;
  readonly editingContextId: string;
  readonly architecturePackageId: string;
  readonly declarationIds: readonly string[];
  readonly architectureArtifactId: string;
}

interface OracleRequirementsMaterialization {
  readonly snapshot: ThreadSnapshot;
}

interface SysmlElement {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
}

// ---------------------------------------------------------------------------
// Exported function: canonical requirements from proof
// ---------------------------------------------------------------------------

/**
 * Map the reviewed proof limits to a canonical OracleRequirement list in SI
 * base units.
 *
 * Von Mises: the proof records MPa for human readability; SysON and the oracle
 * operate in Pa.  Conversion is exactly × 1_000_000 — no floating-point
 * division.  The metric name "maximumVonMisesPa" reflects the normalized unit
 * so the round-trip check (SysML attribute → extraction → comparison) operates
 * on the same unit without a secondary conversion step.
 *
 * Displacement stays in mm because SysON rounds-trips LengthValue[mm] and the
 * oracle reports mm.
 *
 * The requirement IDs are SysML identifiers: letters, digits, underscores only.
 * They are stable constants of this executor, not caller arguments.
 */
export function canonicalRequirementsInPa(
  proof: Pick<Cm01DripTrayMechanicalProof, "limits">,
): readonly OracleRequirement[] {
  return Object.freeze([
    {
      id: "drip_tray_max_displacement",
      name: "Maximum displacement",
      metric: "maximumDisplacementMm",
      operator: "<=" as const,
      limit: { value: proof.limits.maximumDisplacementMm, unit: "mm" },
    },
    {
      id: "drip_tray_max_von_mises",
      name: "Maximum von Mises stress",
      metric: "maximumVonMisesPa",
      operator: "<=" as const,
      limit: {
        /** MPa → Pa: multiply by exactly 1_000_000 (integer, no rounding). */
        value: proof.limits.maximumVonMisesMpa * 1_000_000,
        unit: "Pa",
      },
    },
  ]);
}

// ---------------------------------------------------------------------------
// Exported function: monotony ratchet
// ---------------------------------------------------------------------------

/**
 * Verify that no ancestor of `basis` had an oracle-requirements artifact that
 * the current revision silently dropped.
 *
 * MONOTONY RATCHET — call this in every downstream executor whose basis may
 * follow an oracle-requirements run.  Currently: all DripTray mechanical
 * executors.  Wiring is a separate tracked step; this utility is exported here
 * to avoid a circular dependency when the mechanical executors import it.
 *
 * LINEAGE LIMIT — the walk follows `snapshot.previous` as far as the store can
 * resolve.  If any intermediate snapshot is unresolvable, the walk stops
 * without raising (fail-open for that gap).  This is a documented limit:
 * a stronger guarantee would require every snapshot in the lineage to be
 * durably readable, which the store contract does not enforce today.  A future
 * revision could make the walk fail-closed on resolution errors; the limit is
 * documented here so it is not accidentally removed.
 */
export async function assertOracleRequirementsNotRemoved(
  basis: ThreadSnapshot,
  snapshots: ThreadSnapshotStore,
): Promise<void> {
  if (findOracleRequirementsArtifact(basis)) return;
  let cursor = basis.previous;
  const visited = new Set<string>();
  while (cursor) {
    const key = `${cursor.snapshotId}\u0000${cursor.revision}`;
    if (visited.has(key)) break;
    visited.add(key);
    let ancestor: ThreadSnapshot | undefined;
    try {
      ancestor = await snapshots.get(cursor.snapshotId);
    } catch {
      break; // fail-open on resolution error (documented limit above)
    }
    if (
      !ancestor || ancestor.id !== cursor.snapshotId ||
      ancestor.revision !== cursor.revision
    ) {
      break;
    }
    if (findOracleRequirementsArtifact(ancestor)) {
      throw new OracleRequirementsArtifactRemovedError(basis.subject.id);
    }
    cursor = ancestor.previous;
  }
}

// ---------------------------------------------------------------------------
// Exported function: fidelity check before mechanical provider dispatch
// ---------------------------------------------------------------------------

/**
 * Verify oracle-requirements fidelity before any mechanical provider dispatch.
 *
 * ARTIFACT PRESENT — reads the capture addressed by the artifact URI, rebuilds
 * the canonical requirement set from the committed proof limits, then calls
 * `extractAndVerifyOracleRequirements` against SysON to detect any divergence
 * between what the model carries and what the proof prescribes.  Any mismatch
 * (altered threshold, wrong unit, wrong operator) throws
 * EngineeringProjectCommandError BEFORE the first provider call.
 *
 * If `requirementsCaptures` is not configured when the artifact is present,
 * that is a server-side configuration error: the executor cannot verify fidelity
 * without the capture store and must stop.
 *
 * ARTIFACT ABSENT + virgin lineage — no ancestor carried the artifact.  This is
 * the compatibility path for the historical chain (R1–R12 and the local runner).
 * No provider call is blocked; the check returns normally.
 *
 * ARTIFACT ABSENT + ancestor had artifact — the monotony ratchet fires.  A
 * prior revision of this subject carried the oracle-requirements artifact; it
 * cannot be silently removed.  Throws EngineeringProjectCommandError with a
 * message prefixed by "requirements_artifact_removed" (machine-readable tag).
 *
 * Only `syson` is called when the artifact is present; when absent the function
 * makes no external calls.
 */
export async function checkOracleRequirementsFidelityBeforeDispatch(
  base: ThreadSnapshot,
  snapshots: ThreadSnapshotStore,
  proof: Pick<Cm01DripTrayMechanicalProof, "limits">,
  syson: McpToolClient,
  requirementsCaptures: FileCaptureStore<"oracle-requirements-seed"> | undefined,
): Promise<void> {
  const reqsArtifact = findOracleRequirementsArtifact(base);

  if (reqsArtifact) {
    // Artifact present: verify that SysON still reflects the committed proof.
    if (!requirementsCaptures) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "The basis snapshot carries an oracle-requirements artifact but the mechanical " +
          "executor was not configured with a requirementsCaptures store. Add " +
          "requirementsCaptures to the executor's dependencies before enabling the fidelity check.",
      );
    }
    // reqsArtifact.uri is guaranteed non-empty by findOracleRequirementsArtifact;
    // the TypeScript type does not narrow through find(), so we assert here.
    const artifactUri = reqsArtifact.uri ?? "";
    const captureDigest = captureDigestFromUri(artifactUri);
    if (!captureDigest) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `The oracle-requirements artifact URI "${artifactUri}" does not contain ` +
          "a valid sha256 digest. The artifact may be corrupted; stop for review.",
      );
    }
    const captureFingerprint: ContentFingerprint = {
      algorithm: "sha256",
      digest: captureDigest,
    };
    const captureText = await requirementsCaptures.read(captureFingerprint);
    if (!captureText) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "The oracle-requirements capture referenced by the basis snapshot is not " +
          "readable from the content-addressed store. Stop for review before any " +
          "mechanical provider dispatch.",
      );
    }
    let parsed: { readonly elementId: string; readonly editingContextId: string };
    try {
      parsed = parseOracleRequirementsCapture(captureText);
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `The oracle-requirements capture is malformed: ${errorMessage(error)}`,
      );
    }
    const canonical = canonicalRequirementsInPa(proof);
    try {
      await extractAndVerifyOracleRequirements(
        syson,
        parsed.editingContextId,
        parsed.elementId,
        canonical,
      );
    } catch (error) {
      if (error instanceof RequirementExtractionError) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          `Oracle requirements fidelity check failed before mechanical provider dispatch ` +
            `(${error.code}): ${error.message} Recovery: ${error.recovery}`,
        );
      }
      throw error;
    }
    return;
  }

  // Artifact absent: run the monotony ratchet.
  try {
    await assertOracleRequirementsNotRemoved(base, snapshots);
  } catch (error) {
    if (error instanceof OracleRequirementsArtifactRemovedError) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `requirements_artifact_removed: ${error.message}`,
      );
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

/**
 * Trusted CM-01 V3 oracle-requirements authoring operation.
 *
 * WHY THIS EXECUTOR IS CLOSED: the agent triggers a registered operation;
 * it never supplies SysML text, a threshold value, a unit, or a partDef name.
 * The thresholds come from the reviewed committed proof JSON read at startup.
 * The SysML is rendered by `renderOracleRequirementsSysml` — a pure function
 * with a deterministic test-verified output.  Fidelity is confirmed after
 * insertion by `extractAndVerifyOracleRequirements`.
 */
export class CoffeeMachineCm01V3OracleRequirementsRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: EngineeringProjectCommandService;
  readonly #snapshots: ThreadSnapshotStore;
  readonly #architectureCaptures:
    CoffeeMachineCm01V3OracleRequirementsRunExecutorDependencies[
      "architectureCaptures"
    ];
  readonly #seedCaptures:
    CoffeeMachineCm01V3OracleRequirementsRunExecutorDependencies["seedCaptures"];
  readonly #requirementsCaptures:
    CoffeeMachineCm01V3OracleRequirementsRunExecutorDependencies[
      "requirementsCaptures"
    ];
  readonly #attempts: FileOracleRequirementsSeedAttemptStore;
  readonly #proof: Pick<Cm01DripTrayMechanicalProof, "limits">;
  readonly #syson: McpToolClient;
  readonly #lease: EngineeringProjectRunLease;
  readonly #now: () => string;

  constructor(
    dependencies: CoffeeMachineCm01V3OracleRequirementsRunExecutorDependencies,
  ) {
    this.#projects = dependencies.projects;
    this.#commands = dependencies.commands;
    this.#snapshots = dependencies.snapshots;
    this.#architectureCaptures = dependencies.architectureCaptures;
    this.#seedCaptures = dependencies.seedCaptures;
    this.#requirementsCaptures = dependencies.requirementsCaptures;
    this.#attempts = dependencies.attempts;
    this.#proof = dependencies.proof;
    this.#syson = dependencies.syson;
    this.#lease = dependencies.lease;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3OracleRequirementsRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute the CM-01 oracle-requirements run.",
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
    command: CoffeeMachineCm01V3OracleRequirementsRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let providerAcknowledged = false;
    let snapshotPersisted = false;
    let materialized: OracleRequirementsMaterialization | undefined;
    try {
      // --- pre-claim shape check ---
      const preClaim = await this.requiredProject(command.projectId);
      requireShape(preClaim, requireRun(preClaim, command.runId));

      // --- Step 2: claim the run ---
      await this.#commands.claimRun(origin, {
        ...command,
        commandId: commandStep(command.commandId, "claim"),
        summary: "Started the bounded CM-01 SysON oracle-requirements authoring run.",
      });
      claimed = true;

      let project = await this.requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireClaimedShape(project, run, origin);

      if (run.status === "completed") {
        assertCompleted(project, command);
        return project;
      }
      // A "publishing" run is a legitimate resume point: publishRun succeeded
      // but completeRun did not. Every step between here and 14c is idempotent
      // (the WAL skips the insertion, capture and snapshot saves are CAS
      // re-reads), and 14b already skips publishRun for this status — so the
      // retry the error message promises must be allowed through this gate.
      if (run.status !== "running" && run.status !== "publishing") {
        throw unexpectedStatus(run, "running");
      }

      // --- Step 3: load inputs ---
      const capturedAt = requiredStart(run);
      const basis = requireBasis(run);
      const inputs = await this.loadInputs(basis);

      // --- Step 4 & 5: canonical requirements + fingerprint ---
      const canonicalInPa = canonicalRequirementsInPa(this.#proof);
      const requirementsFingerprint = await fingerprintOracleRequirements(
        canonicalInPa,
      );

      // --- Step 6: WAL begin ---
      let elementId: string;
      const walResult = await this.walBeginOrFail(
        command.projectId,
        command.runId,
        requirementsFingerprint.digest,
        capturedAt,
      );
      if (walResult.action === "completed") {
        elementId = walResult.result.elementId;
        providerAcknowledged = true;
      } else {
        // walResult.action === "dispatch" — perform the insertion
        const sysmlText = renderOracleRequirementsSysml(PART_DEF_NAME, canonicalInPa);
        elementId = await this.insertAndIdentify(
          command.projectId,
          command.runId,
          requirementsFingerprint.digest,
          capturedAt,
          sysmlText,
          inputs,
        );
        providerAcknowledged = true;
      }

      // --- Step 11: verify re-extraction (fail-closed on any divergence) ---
      try {
        await extractAndVerifyOracleRequirements(
          this.#syson,
          inputs.editingContextId,
          elementId,
          canonicalInPa,
        );
      } catch (error) {
        if (error instanceof RequirementExtractionError) {
          throw new EngineeringProjectCommandError(
            "invalid_transition",
            `Oracle requirements extraction failed after insertion (${error.code}): ${error.message} ` +
              `Recovery hint: ${error.recovery}`,
          );
        }
        throw error;
      }

      // --- Step 12: save capture (CAS, then readback) ---
      const captureRecord = {
        schemaVersion: ORACLE_REQUIREMENTS_CAPTURE_SCHEMA,
        elementId,
        editingContextId: inputs.editingContextId,
        architecturePackageId: inputs.architecturePackageId,
        partDefName: PART_DEF_NAME,
        requirements: canonicalInPa,
        insertedAt: capturedAt,
      };
      const captureText = deterministicJson(captureRecord);
      const captureFingerprint = await sha256Fingerprint(captureRecord);
      await this.#requirementsCaptures.save(captureFingerprint, captureText);
      const persistedCapture = await this.#requirementsCaptures.read(
        captureFingerprint,
      );
      if (persistedCapture !== captureText) {
        throw new Error(
          "CM-01 oracle requirements capture was not durably readable after save.",
        );
      }

      // --- Step 13: materialize ThreadSnapshot extension ---
      const captureUri = this.#requirementsCaptures.uriFor(captureFingerprint);
      materialized = materializeOracleRequirements({
        base: inputs.base,
        runId: command.runId,
        capturedAt,
        requirementsFingerprint,
        captureFingerprint,
        captureUri,
        elementId,
        architecturePackageId: inputs.architecturePackageId,
        architectureArtifactId: inputs.architectureArtifactId,
      });

      // --- Step 14a: persist snapshot (CAS readback) ---
      await this.#snapshots.save(materialized.snapshot);
      const savedSnapshot = await this.#snapshots.get(materialized.snapshot.id);
      if (
        !savedSnapshot ||
        deterministicJson(savedSnapshot) !== deterministicJson(materialized.snapshot)
      ) {
        throw new Error(
          "CM-01 oracle requirements snapshot was not durably readable after save.",
        );
      }
      snapshotPersisted = true;

      // --- Step 14b: publish run ---
      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary:
            "Publishing the CM-01 oracle-requirements SysML element insertion and verification.",
        });
      } else if (run.status !== "publishing" && run.status !== "completed") {
        throw unexpectedStatus(run, "publishing");
      }

      // --- Step 14c: complete run ---
      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.#commands.completeRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "complete"),
          expectedRevision: project.revision,
          summary:
            "Recorded the CM-01 oracle-requirements SysML element and its verification read-back.",
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
        // Keep the underlying reason visible: swallowing it here has already
        // cost a live debugging session. The message stays machine-actionable,
        // the cause rides along for the operator.
        const cause = error instanceof Error ? ` Cause: ${error.message}` : "";
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "CM-01 oracle-requirements evidence is durable but project attachment did not finish. " +
            `Retry this exact command; it will not insert a second element.${cause}`,
        );
      }
      if (error instanceof OracleRequirementsSeedWriteOutcomeUnknownError) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The CM-01 oracle-requirements SysON insertion outcome is unknown. " +
            "An operator must inspect via syson_element_children on the architecturePackage " +
            "before any separately reviewed recovery path.",
        );
      }
      if (providerAcknowledged) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The CM-01 oracle-requirements SysON insertion was acknowledged but evidence " +
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
  ): Promise<OracleRequirementsInputs> {
    // Load and validate the basis ThreadSnapshot.
    const base = await exactSnapshot(this.#snapshots, basis);
    if (base.subject.id !== "project:coffee-machine-cm01-v3") {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The basis ThreadSnapshot subject does not match the CM-01 project subject.",
      );
    }

    // Guard: the basis must not already have a requirements artifact.
    // A second oracle-requirements run on a snapshot that already carries the
    // artifact would attempt a duplicate insertion. The WAL guards within the
    // same runId; this guard covers a different runId on the same snapshot.
    if (findOracleRequirementsArtifact(base)) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "The basis ThreadSnapshot already carries an oracle-requirements artifact. " +
          "A second oracle-requirements insertion is not allowed. The existing " +
          `element is identified by URI prefix "${ORACLE_REQUIREMENTS_URI_PREFIX}".`,
      );
    }

    // Find the architecture artifact by URI prefix — D5: not by kind alone,
    // because the snapshot may contain other sysml-model artifacts.
    const archArtifact = base.artifacts.find(
      (a) =>
        a.kind === "sysml-model" &&
        typeof a.uri === "string" &&
        a.uri.startsWith(ARCHITECTURE_URI_PREFIX),
    );
    if (!archArtifact) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The basis ThreadSnapshot has no architecture artifact " +
          `(sysml-model with URI prefix "${ARCHITECTURE_URI_PREFIX}"). ` +
          "The oracle-requirements run must follow a completed architecture run.",
      );
    }

    // Read the architecture capture to extract architecturePackage.id and
    // declarations[].id, and the seed.fingerprint for further chaining.
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
        "The SysON model-seed capture (referenced by the architecture capture) " +
          "is not readable from the content-addressed store.",
      );
    }
    const editingContextId = extractEditingContextId(seedCaptureText);

    return {
      base,
      editingContextId,
      architecturePackageId: archCapture.architecturePackageId,
      declarationIds: archCapture.declarationIds,
      architectureArtifactId: archArtifact.id,
    };
  }

  // ── Private: WAL begin (fail-closed on dispatched) ───────────────────────

  private async walBeginOrFail(
    projectId: string,
    runId: string,
    requirementsDigest: string,
    dispatchedAt: string,
  ): Promise<
    | { readonly action: "dispatch" }
    | { readonly action: "completed"; readonly result: { readonly elementId: string } }
  > {
    try {
      return await this.#attempts.begin({
        projectId,
        runId,
        requirementsDigest,
        dispatchedAt,
      });
    } catch (error) {
      if (error instanceof OracleRequirementsSeedWriteOutcomeUnknownError) throw error;
      throw new OracleRequirementsSeedWriteOutcomeUnknownError();
    }
  }

  // ── Private: insertion + element identification ───────────────────────────

  private async insertAndIdentify(
    projectId: string,
    runId: string,
    requirementsDigest: string,
    capturedAt: string,
    sysmlText: string,
    inputs: OracleRequirementsInputs,
  ): Promise<string> {
    // Step 8: insert the requirements element.
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
      // Any error — provider or verification — is treated as "dispatched but
      // unknown". Do NOT retry automatically; an operator must inspect SysON.
      if (error instanceof OracleRequirementsSeedWriteOutcomeUnknownError) throw error;
      throw new OracleRequirementsSeedWriteOutcomeUnknownError();
    }

    // Step 9: identify the newly inserted element by exclusion.
    let elementId: string;
    try {
      const childrenResult = await this.#syson.callTool({
        name: "syson_element_children",
        arguments: {
          editing_context_id: inputs.editingContextId,
          element_id: inputs.architecturePackageId,
        },
      });
      elementId = identifyNewElement(
        childrenResult.structuredContent,
        inputs.architecturePackageId,
        inputs.declarationIds,
      );
    } catch (error) {
      if (error instanceof OracleRequirementsSeedWriteOutcomeUnknownError) throw error;
      throw new OracleRequirementsSeedWriteOutcomeUnknownError();
    }

    // Step 10: record the successful insertion in the WAL.
    const textSha256 = await sha256HexOf(sysmlText);
    await this.#attempts.complete({
      projectId,
      runId,
      requirementsDigest,
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
    command: CoffeeMachineCm01V3OracleRequirementsRunExecutorCommand,
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
    command: CoffeeMachineCm01V3OracleRequirementsRunExecutorCommand,
  ): Promise<void> {
    try {
      const project = await this.requiredProject(command.projectId);
      const run = requireRun(project, command.runId);
      if (
        run.status !== "running" ||
        run.claimedBy?.origin !== origin.kind ||
        run.claimedBy.id !== origin.actorId
      ) {
        return;
      }
      await this.#commands.failRun(origin, {
        ...command,
        commandId: commandStep(command.commandId, "fail"),
        expectedRevision: project.revision,
        summary:
          "CM-01 oracle-requirements stopped before SysON insertion was acknowledged.",
        code: "coffee-machine-cm01-v3-oracle-requirements-not-published",
        message:
          "The bounded CM-01 oracle-requirements run stopped before evidence was published.",
      });
    } catch {
      // Preserve the original cause.
    }
  }
}

// ---------------------------------------------------------------------------
// Private: snapshot materialization
// ---------------------------------------------------------------------------

function materializeOracleRequirements(input: {
  readonly base: ThreadSnapshot;
  readonly runId: string;
  readonly capturedAt: string;
  readonly requirementsFingerprint: ContentFingerprint;
  readonly captureFingerprint: ContentFingerprint;
  readonly captureUri: string;
  readonly elementId: string;
  readonly architecturePackageId: string;
  readonly architectureArtifactId: string;
}): OracleRequirementsMaterialization {
  const artifactId = `oracle-requirements-${input.requirementsFingerprint.digest}`;
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

  /**
   * WHY fingerprint = requirementsFingerprint, NOT captureFingerprint:
   * the artifact fingerprint is the stable identity of the reviewed declaration
   * (sha256 of the requirements array).  The captureUri already encodes the
   * full-capture address so the element can be re-read; a second sha256 in the
   * fingerprint field would be redundant and would make downstream comparisons
   * harder (two fingerprints for one logical artifact).
   */
  const artifact: ThreadArtifact = {
    id: artifactId,
    name: "CM-01 oracle requirements declaration",
    kind: "sysml-model",
    version: input.requirementsFingerprint.digest,
    fingerprint: input.requirementsFingerprint,
    uri: input.captureUri,
    mediaType: "application/json",
    producer: operation,
    inputArtifactIds: [input.architectureArtifactId],
    freshness,
  };

  /**
   * WHY observedFingerprint = architectureArtifact.fingerprint, NOT captureFingerprint:
   *
   * ThreadSnapshot validation requires that a "verified" consumption's
   * observedFingerprint matches the fingerprint of the CONSUMED artifact
   * (validateThreadSnapshot: fingerprint_mismatch check).
   *
   * The consumed artifact is the architecture artifact from the basis snapshot.
   * Its fingerprint is the sha256 of the architecture capture.
   * The captureFingerprint here is the sha256 of the oracle-requirements capture —
   * a different document.  Using captureFingerprint would produce a permanent
   * fingerprint_mismatch validation error on every snapshot built from this executor.
   *
   * The oracle-requirements capture is already addressed by captureUri on the artifact;
   * it does not need to appear again in the consumption's observedFingerprint.
   */
  const architectureArtifact = input.base.artifacts.find(
    (a) => a.id === input.architectureArtifactId,
  );
  if (!architectureArtifact) {
    throw new Error(
      `Architecture artifact "${input.architectureArtifactId}" is absent from the base snapshot. ` +
        "The oracle-requirements executor requires the architecture artifact to be present.",
    );
  }

  const consumption: ThreadArtifactConsumption = {
    id: `consume-${input.architectureArtifactId}-by-${artifactId}`,
    artifactId: input.architectureArtifactId,
    consumer: operation,
    observedFingerprint: architectureArtifact.fingerprint,
    verifiedAt: input.capturedAt,
    status: "verified",
  };

  const extensionId = `capture-${artifactId}`;
  const extension = {
    id: extensionId,
    name: "Anchor the CM-01 oracle requirements declaration in the SysML model",
    subjectId: input.base.subject.id,
    capturedAt: input.capturedAt,
    artifacts: [artifact],
    consumptions: [consumption],
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
          "The oracle-requirements element was inserted into the architecture package " +
          "identified by the reviewed architecture capture.",
      },
      {
        id: `link-${consumption.id}-uses-${input.architectureArtifactId}`,
        relation: "uses" as const,
        from: { kind: "consumption" as const, id: consumption.id },
        to: { kind: "artifact" as const, id: input.architectureArtifactId },
        rationale:
          "The executor re-read the architecture capture before inserting the " +
          "requirements element into the correct architecturePackage.",
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

  /**
   * If the extension was not applied (applied: false), the artifact was already
   * in the base snapshot.  This should not happen because loadInputs guards
   * against a basis that already has the requirements artifact, but we preserve
   * fail-closed behavior by raising rather than silently returning the base.
   */
  if (!applied.applied || applied.snapshot.revision !== input.base.revision + 1) {
    throw new Error(
      "CM-01 oracle-requirements evidence did not produce exactly one descendant snapshot.",
    );
  }

  return { snapshot: applied.snapshot };
}

// ---------------------------------------------------------------------------
// Private: shape validation helpers
// ---------------------------------------------------------------------------

const ORACLE_REQUIREMENTS_OP = COFFEE_MACHINE_CM01_V3_OPERATION_REFS.oracleRequirements;

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
    operation?.id !== ORACLE_REQUIREMENTS_OP.id ||
    operation.version !== ORACLE_REQUIREMENTS_OP.version ||
    operation.bindings.length !== 2 ||
    operation.bindings[0]?.name !== "approvedBrief" ||
    operation.bindings[0].source.kind !== "approved-brief" ||
    operation.bindings[1]?.name !== "architectureArtifact" ||
    operation.bindings[1].source.kind !== "thread-entity"
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the canonical CM-01 V3 oracle-requirements @1 operation.",
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
      "This executor may run only the exact oracle-requirements run it claimed.",
    );
  }
}

// ---------------------------------------------------------------------------
// Private: insertion response validation
// ---------------------------------------------------------------------------

/**
 * Verify that the SysON insertion acknowledged the exact parent and returned
 * `inserted: true`.
 *
 * WHY NOT compare text bytes: the SysON echo may normalize whitespace (e.g.
 * add a trailing newline or collapse indentation).  The text field in the echo
 * is a human-readable acknowledgement, not a canonical signature.  Fidelity is
 * proved by `extractAndVerifyOracleRequirements`, not by echo comparison.
 */
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
      `SysON insert parentId mismatch: expected "${expectedParentId}", ` +
        `got "${String(record.parentId)}".`,
    );
  }
}

// ---------------------------------------------------------------------------
// Private: element identification by exclusion
// ---------------------------------------------------------------------------

/**
 * Identify the newly inserted element by excluding the known declarationIds.
 *
 * The speciation of the `parentId` in the children response is required to
 * match `expectedParentId` so a mis-routed call cannot produce a valid element.
 *
 * 0 candidates → the element may not have been inserted; stop fail-closed.
 * >1 candidates → the architecturePackage has unexpected extra children;
 *   a prior run may have already inserted the element or the package was
 *   modified by another operator — stop fail-closed in both cases.
 */
function identifyNewElement(
  value: unknown,
  expectedParentId: string,
  declarationIds: readonly string[],
): string {
  const items = parseChildrenResponse(value, expectedParentId);
  const known = new Set(declarationIds);
  const candidates = items.filter((item) => !known.has(item.id));
  if (candidates.length === 0) {
    throw new OracleRequirementsSeedWriteOutcomeUnknownError();
  }
  if (candidates.length > 1) {
    throw new OracleRequirementsSeedWriteOutcomeUnknownError();
  }
  return candidates[0]!.id;
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
      `SysON children parentId mismatch: expected "${expectedParentId}", ` +
        `got "${String(record.parentId)}".`,
    );
  }
  if (!Array.isArray(record.children) || record.count !== record.children.length) {
    throw new Error("SysON children response has an invalid shape.");
  }
  return (record.children as unknown[]).map((candidate, index) => {
    if (
      !candidate || typeof candidate !== "object" || Array.isArray(candidate)
    ) {
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

/**
 * Extract the minimum required fields from the architecture capture JSON.
 *
 * This function parses only what the oracle-requirements executor needs:
 * architecturePackage.id, declarations[].id, and seed.fingerprint.  It does
 * not validate the full capture schema; that is the responsibility of the
 * architecture executor that produced the file.
 */
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

/**
 * Extract `normalizedResults.project.editingContextId` from the SysON model-
 * seed capture.  The rest of the seed capture is the responsibility of the
 * seed executor; this function reads only what the oracle-requirements executor
 * needs for the syson_element_insert_sysml call.
 */
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

/**
 * Return the oracle-requirements artifact from a snapshot, if present.
 *
 * Both the URI-prefix check and the kind guard are required: other
 * sysml-model artifacts (architecture, seed) must not match.  Factored as an
 * exported function so that mechanical executors call the exact same predicate
 * as the monotony ratchet and the fidelity check — no drift between four copies.
 */
export function findOracleRequirementsArtifact(
  snapshot: ThreadSnapshot,
): ThreadArtifact | undefined {
  return snapshot.artifacts.find(
    (a) =>
      a.kind === "sysml-model" &&
      typeof a.uri === "string" &&
      a.uri.startsWith(ORACLE_REQUIREMENTS_URI_PREFIX),
  );
}

async function exactSnapshot(
  store: ThreadSnapshotStore,
  basis: EngineeringThreadSnapshotBasis,
): Promise<ThreadSnapshot> {
  const snapshot = await store.get(basis.snapshotId);
  if (
    !snapshot ||
    snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The exact basis ThreadSnapshot required by the oracle-requirements run is not readable.",
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
  command: CoffeeMachineCm01V3OracleRequirementsRunExecutorCommand,
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
      `CM-01 oracle-requirements run ${command.runId} did not complete through this ` +
        "exact execution command.",
    );
  }
}

function commandStep(commandId: string, step: string): string {
  return `${commandId}:coffee-machine-cm01-v3-oracle-requirements:${step}`;
}

function artifactEntityRef(snapshot: ThreadSnapshot): EngineeringThreadEntityRef {
  const artifact = snapshot.artifacts.find(
    (a) =>
      typeof a.uri === "string" && a.uri.startsWith(ORACLE_REQUIREMENTS_URI_PREFIX),
  );
  if (!artifact) {
    throw new Error("Oracle-requirements snapshot has no requirements artifact.");
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

/**
 * Extract the sha256 hex digest from a
 * casys://oracle-requirements-seed-capture/sha256/{digest} URI.
 * Returns undefined when the URI does not match the expected format.
 */
function captureDigestFromUri(uri: string): string | undefined {
  const sha256Prefix = ORACLE_REQUIREMENTS_URI_PREFIX + "sha256/";
  if (!uri.startsWith(sha256Prefix)) return undefined;
  const digest = uri.slice(sha256Prefix.length);
  return /^[a-f0-9]{64}$/.test(digest) ? digest : undefined;
}

/**
 * Parse the minimum fields required for fidelity re-extraction from a
 * serialized oracle requirements capture JSON: elementId and editingContextId.
 *
 * Narrow parse by design: the capture was validated when produced by
 * CoffeeMachineCm01V3OracleRequirementsRunExecutor; re-validating the full
 * schema here would be fragile.  Only the two fields that anchor the SysON
 * element to the editing context are needed for extractAndVerifyOracleRequirements.
 */
function parseOracleRequirementsCapture(
  text: string,
): { readonly elementId: string; readonly editingContextId: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Oracle requirements capture is not valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Oracle requirements capture must be a JSON object.");
  }
  const record = value as Record<string, unknown>;
  const elementId = record["elementId"];
  if (typeof elementId !== "string" || !elementId.trim()) {
    throw new Error(
      'Oracle requirements capture has no valid "elementId" field.',
    );
  }
  const editingContextId = record["editingContextId"];
  if (typeof editingContextId !== "string" || !editingContextId.trim()) {
    throw new Error(
      'Oracle requirements capture has no valid "editingContextId" field.',
    );
  }
  return {
    elementId: elementId.trim(),
    editingContextId: editingContextId.trim(),
  };
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
