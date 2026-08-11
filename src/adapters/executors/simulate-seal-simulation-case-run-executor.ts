/**
 * Trusted executor for `simulate.seal-simulation-case@1`.
 *
 * WHY NO PROVIDER CALL — this operation seals the human-reviewed simulation case
 * declaration into the thread without executing any simulation.  The resulting
 * "document" artifact becomes the execution mandate that
 * `simulate.run-modelica-scenario@1` (Op 2) will consume as its signed authority.
 * All effects are idempotent CAS writes to the local filesystem; no WAL is needed
 * because no uncertain provider state can arise from a read + hash + persist
 * sequence.
 *
 * WHY riskClass consequential — the seal creates the authority that authorises a
 * simulation run.  A forged or replayed seal would allow an unapproved case to
 * drive provider dispatch.  Requiring a human MRTR at this gate, not only at the
 * run gate, ensures the human reviews the full case identity before any bytes
 * reach the provider.
 *
 * WHY inputArtifactIds [] — the Modelica kit (model + scenario) lives outside the
 * thread in the provider's own store.  Claiming thread artifact consumption for
 * bytes we cannot verify by content-address would be a false attestation.  The
 * honest boundary is {modelSha256, scenarioSha256} sealed inside canonicalCaseText,
 * verified by the provider at run time.
 *
 * Sequence:
 *  1. Agent-only origin gate.
 *  2. requireShape: operation id / version check.
 *  3. requireMrtrApproval: find the sole human-approved decision for this run.
 *  4. Parse sim.case.* from the proposal parameters.
 *  5. Look up the case path in SIMULATION_CASE_SOURCES; read + validateSimulationCase;
 *     compute canonicalCaseText + caseDigest; assert the MRTR-signed caseDigest
 *     matches the computed one (fail-fast, before the lease).
 *  6. verifySimulationCaseParametersMatchCase: cross-check every MRTR field.
 *  7. Guards: case.project.id === command.projectId,
 *     case.project.subjectId === basis.subjectId.
 *  8. Lease threadWriteBasisLeaseScope.
 *  9. Inside lease — pre-claim checks (in order):
 *     assertThreadWriteBasisAvailable; load basisSnapshot;
 *     assertThreadSnapshotLineageIntact; assertSimulationCaseArtifactNotRemoved
 *     (ancestors, by subjectId + caseDigest); assertReviewBasisDescendantOrEqual.
 * 10. claimRun.
 * 11. Re-read project; re-check shape + claimed status.
 * 12. Build capture record {schemaVersion, operation, trustedRunId, caseDigest,
 *     canonicalCaseText, sealedAt = requiredStart(run)} — no auto-referential field;
 *     sha256Fingerprint; deterministicJson → CAS save.
 * 13. CAS readback (byte-level integrity assertion).
 * 14. Build thread extension: one "document" artifact {id simulation-case-<captureFp>,
 *     version = caseDigest (cliquet key), uri casys://simulation-case-capture/sha256/…,
 *     inputArtifactIds []}; applyThreadSnapshotExtensionIfNew; validateThreadSnapshot.
 * 15. ThreadSnapshot save + CAS readback.
 * 16. publishRun + completeRun + assertCompleted.
 * 17. Idempotent replay: a completed run returns the project directly.
 */

import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandOrigin,
  type EngineeringProjectCommandService,
  type EngineeringProjectRevisionStore,
} from "../../domain/project/engineering-project-command-service.ts";
import type {
  EngineeringAgentRun,
  EngineeringApproval,
  EngineeringDecision,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotBasis,
} from "../../domain/project/engineering-project.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import {
  canonicalSimulationCaseText,
  type SimulationCase,
  type SimulationCaseThreadSnapshot,
  validateSimulationCase,
} from "../../domain/analysis/simulation-case.ts";
import { buildSimulationCaseAnalysisGraph } from "../../domain/analysis/simulation-case-analysis-graph.ts";
import {
  parseSimulationCaseDecisionParameters,
  SIMULATE_SEAL_SIMULATION_CASE_OPERATION,
  type SimulationCaseDecisionParameters,
  simulationCaseDecisionParametersToMap,
  verifySimulationCaseParametersMatchCase,
} from "../../domain/analysis/simulation-case-proposal.ts";
import type {
  ThreadEntityKind,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import {
  applyThreadSnapshotExtensionIfNew,
  type ThreadSnapshotExtension,
} from "../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import type { FileCaptureStore } from "../captures/file-capture-store.ts";
import { SIMULATION_CASE_CAPTURE_URI_PREFIX } from "../captures/file-capture-store.ts";
import {
  assertThreadSnapshotLineageIntact,
  threadSnapshotDescendsFrom,
} from "../stores/thread-snapshot-lineage.ts";
import type { EngineeringProjectRunLease } from "../stores/file-engineering-project-run-lease.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "./executor-run-helpers.ts";
import {
  assertThreadWriteBasisAvailable,
  threadWriteBasisLeaseScope,
} from "./thread-write-basis-guard.ts";

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/**
 * Re-exported from domain so server.ts and the registry can import the
 * operation identity from one canonical location.
 */
export { SIMULATE_SEAL_SIMULATION_CASE_OPERATION };

/** Schema version written into every canonical simulation-case capture. */
export const SIMULATION_CASE_CAPTURE_SCHEMA = "simulation-case-capture/1.0" as const;

/**
 * Re-exported from file-capture-store.ts (canonical home for every URI prefix)
 * so callers keep a single import site at the seal executor.
 */
export { SIMULATION_CASE_CAPTURE_URI_PREFIX };

/**
 * Server-side catalog that maps each known simulation case id to its source
 * file path relative to the repository root.
 *
 * WHY EXPORTED — the catalog is the authoritative source for case file paths.
 * Exporting it allows tests to assert on its contents and operator tooling to
 * enumerate known cases without re-parsing executor code.
 *
 * WHY A MAP — an array of pairs would allow duplicate keys; a Map refuses them
 * at construction time and provides O(1) lookup, matching AX principle
 * «Fast Fail Early» at the boundary.
 *
 * EXTENSION RULE — a new simulation case adds exactly one entry to this Map
 * and one JSON file at the declared path.  The executor never falls back to a
 * derived path, directory scan, or pattern match.
 */
export const SIMULATION_CASE_SOURCES: ReadonlyMap<string, string> = new Map([
  [
    "coffee-machine-cm01-thermal-nominal-v1",
    "config/simulation-cases/coffee-machine-cm01-thermal-nominal-v1.json",
  ],
]);

/**
 * The descriptor lives in file-capture-store.ts (the canonical home for every
 * capture family — a second definition would drift). Re-exported here so the
 * executor's callers keep a single import site.
 */
export { SIMULATION_CASE_CAPTURE_DESCRIPTOR } from "../captures/file-capture-store.ts";

// ---------------------------------------------------------------------------
// Public error classes
// ---------------------------------------------------------------------------

/**
 * Raised when a successor basis has lost a simulation-case artifact that
 * appeared in an ancestor.
 *
 * MONOTONY RATCHET — once a thread carries a sealed simulation-case artifact
 * for a given (subjectId, caseDigest) pair, every later revision must also
 * carry it.  Silently dropping it would make the downstream run executor
 * unable to verify the signed mandate.
 */
export class SimulationCaseArtifactRemovedError extends Error {
  constructor(subjectId: string, caseDigest: string) {
    super(
      `simulation_case_artifact_removed: The thread for "${subjectId}" previously ` +
        `carried a sealed simulation-case artifact (caseDigest: ${
          caseDigest.slice(0, 16)
        }…) ` +
        "that is absent from the current basis. This is a monotony-ratchet violation; " +
        "the artifact must not be removed once published.",
    );
    this.name = "SimulationCaseArtifactRemovedError";
  }
}

/**
 * Raised when the ancestor traversal cannot be completed cleanly, requiring
 * human review before a seal can proceed.
 */
export class SimulationCaseLineageReviewRequiredError extends Error {
  constructor(detail: string) {
    super(`simulation_case_lineage_review_required: ${detail}`);
    this.name = "SimulationCaseLineageReviewRequiredError";
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SimulateSealSimulationCaseRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface SimulateSealSimulationCaseRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore;
  readonly simulationCaseCaptures: FileCaptureStore<"simulation-case">;
  readonly lease: EngineeringProjectRunLease;
  /**
   * Injected file reader — defaults to Deno.readTextFile.  Tests stub this to
   * avoid real filesystem access; production code passes undefined to use the
   * default.  The executor never derives the path from environment variables or
   * runtime state; the path is always looked up in SIMULATION_CASE_SOURCES.
   */
  readonly readTextFile?: (path: string) => Promise<string>;
  readonly now?: () => string;
}

// ---------------------------------------------------------------------------
// Public: executor
// ---------------------------------------------------------------------------

export class SimulateSealSimulationCaseRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: EngineeringProjectCommandService;
  readonly #snapshots: ThreadSnapshotStore;
  readonly #simulationCaseCaptures: FileCaptureStore<"simulation-case">;
  readonly #lease: EngineeringProjectRunLease;
  readonly #readTextFile: (path: string) => Promise<string>;
  readonly #now: () => string;

  constructor(deps: SimulateSealSimulationCaseRunExecutorDependencies) {
    this.#projects = deps.projects;
    this.#commands = deps.commands;
    this.#snapshots = deps.snapshots;
    this.#simulationCaseCaptures = deps.simulationCaseCaptures;
    this.#lease = deps.lease;
    this.#readTextFile = deps.readTextFile ?? Deno.readTextFile.bind(Deno);
    this.#now = deps.now ?? (() => new Date().toISOString());
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: SimulateSealSimulationCaseRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    // Step 1 — agent-only origin gate.
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute the simulate-seal-simulation-case run.",
      );
    }

    // Step 2 — requireShape (validates operation id + version before any I/O).
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    requireShape(project, run);

    // Step 3 — MRTR approval gate.
    const { decision, proposal } = await requireMrtrApproval(project, run);

    // Step 4 — parse the flat sim.case.* grammar from the signed proposal.
    let decisionParams: SimulationCaseDecisionParameters;
    try {
      decisionParams = parseSimulationCaseDecisionParameters(
        simulationCaseDecisionParametersToMap(proposal.parameters),
      );
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Simulation case decision parameters are invalid: ${errorMessage(error)}`,
      );
    }

    // Steps 5–6 — read the case from the server-side catalog, validate, and
    // cross-check every MRTR field against the live SimulationCase object.
    const { validatedCase, canonicalCaseText, caseDigest } = await this
      .#loadAndVerifyCase(decisionParams);

    // Step 7 — project / subject identity guards.
    const basis = requireBasis(run);
    if (validatedCase.project.id !== command.projectId) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Simulation case project.id "${validatedCase.project.id}" does not match ` +
          `command projectId "${command.projectId}".`,
      );
    }
    if (validatedCase.project.subjectId !== basis.subjectId) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Simulation case project.subjectId "${validatedCase.project.subjectId}" ` +
          `does not match run basis subjectId "${basis.subjectId}".`,
      );
    }

    // Step 8 — serialise concurrent seals for the same basis via the thread-write
    // basis lease.  This is the primary serialization gate; assertThreadWriteBasisAvailable
    // adds a secondary sibling-run check for operations declared in the guard's
    // THREAD_WRITE_OPERATIONS set.
    return await this.#lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () =>
        this.#executeLeased(
          origin,
          command,
          decision,
          decisionParams,
          validatedCase,
          canonicalCaseText,
          caseDigest,
        ),
    );
  }

  // ── Private: leased execution ──────────────────────────────────────────────

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: SimulateSealSimulationCaseRunExecutorCommand,
    _decision: EngineeringDecision,
    _decisionParams: SimulationCaseDecisionParameters,
    validatedCase: SimulationCase,
    canonicalCaseText: string,
    caseDigest: string,
  ): Promise<EngineeringProjectSnapshot> {
    let snapshotPersisted = false;
    let claimed = false;

    try {
      // Post-lease shape re-check and idempotent replay short-circuit.
      const preClaim = await this.#requiredProject(command.projectId);
      requireShape(preClaim, requireRun(preClaim, command.runId));

      const alreadyCompleted = await this.#completedFor(command);
      if (alreadyCompleted) return alreadyCompleted;

      // Step 9 — pre-claim guards inside the lease.
      await assertThreadWriteBasisAvailable(
        preClaim,
        requireRun(preClaim, command.runId),
      );
      const preClaimRun = requireRun(preClaim, command.runId);
      const basis = requireBasis(preClaimRun);
      const basisSnapshot = await exactBasisSnapshot(this.#snapshots, basis);

      await assertThreadSnapshotLineageIntact(basisSnapshot, this.#snapshots);
      await assertSimulationCaseArtifactNotRemoved(
        basisSnapshot,
        basis.subjectId,
        caseDigest,
        this.#snapshots,
      );
      await assertReviewBasisDescendantOrEqual(
        basisSnapshot,
        validatedCase.project.baseThreadSnapshot,
        this.#snapshots,
      );

      // Step 10 — claimRun (durable start timestamp is stamped here).
      await this.#commands.claimRun(origin, {
        ...command,
        commandId: commandStep(command.commandId, "claim"),
        summary: "Started the simulate-seal-simulation-case run.",
      });
      claimed = true;

      // Step 11 — re-read; re-check shape + claimed status.
      let project = await this.#requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireClaimedShape(project, run, origin);

      if (run.status === "completed") {
        assertCompleted(project, command);
        return project;
      }
      if (run.status !== "running" && run.status !== "publishing") {
        throw unexpectedStatus(run, "running");
      }

      // capturedAt is the durable start timestamp for the seal.
      const capturedAt = requiredStart(run);
      const currentBasis = requireBasis(run);

      // Step 12 — build capture record (no auto-referential field per the
      // modelica-scenario-run-capture convention); sha256Fingerprint; CAS save.
      const captureRecord = {
        schemaVersion: SIMULATION_CASE_CAPTURE_SCHEMA,
        operation: SIMULATE_SEAL_SIMULATION_CASE_OPERATION,
        trustedRunId: run.id,
        caseDigest,
        canonicalCaseText,
        sealedAt: capturedAt,
      };
      const captureFp = await sha256Fingerprint(captureRecord);
      const captureText = deterministicJson(captureRecord);

      await this.#simulationCaseCaptures.save(captureFp, captureText);

      // Step 13 — CAS readback.
      const readBack = await this.#simulationCaseCaptures.read(captureFp);
      if (readBack !== captureText) {
        throw new Error(
          "Simulation-case capture was not durably readable after save.",
        );
      }

      // Step 14 — thread extension: one "document" artifact that carries
      // caseDigest as its version (the cliquet key) and inputArtifactIds []
      // (honest boundary — the kit lives outside the thread).
      const captureUri = this.#simulationCaseCaptures.uriFor(captureFp);
      const artifact = {
        id: `simulation-case-${captureFp.digest}`,
        name: `Simulation case seal: ${validatedCase.id} r${validatedCase.revision}`,
        kind: "document" as const,
        version: caseDigest,
        fingerprint: captureFp,
        uri: captureUri,
        mediaType: "application/json",
        producer: {
          serverId: "digital-thread",
          tool:
            `${SIMULATE_SEAL_SIMULATION_CASE_OPERATION.id}@${SIMULATE_SEAL_SIMULATION_CASE_OPERATION.version}`,
          runId: run.id,
        },
        inputArtifactIds: [],
        freshness: {
          status: "fresh" as const,
          changedAt: capturedAt,
          invalidatedByChangeIds: [],
        },
      };

      const extensionId = `simulate-seal-${run.id}`;
      const extension: ThreadSnapshotExtension = {
        id: extensionId,
        name: `Sealed simulation case: ${validatedCase.id} r${validatedCase.revision}`,
        subjectId: currentBasis.subjectId,
        capturedAt,
        artifacts: [artifact],
        consumptions: [],
        observations: [],
        requirements: [],
        evaluations: [],
        violations: [],
        provenance: [],
        proposedActions: [],
        analysisGraph: buildSimulationCaseAnalysisGraph({
          simulationCase: validatedCase,
          caseFingerprint: { algorithm: "sha256", digest: caseDigest },
          evidence: { id: artifact.id, fingerprint: artifact.fingerprint },
        }),
      };

      const applied = applyThreadSnapshotExtensionIfNew(
        await exactBasisSnapshot(this.#snapshots, currentBasis),
        extension,
        { appliedAt: capturedAt },
      );
      if (!applied.applied) {
        throw new Error(
          "Simulation-case snapshot extension was already present — " +
            "this exact evidence was published in a prior revision.",
        );
      }
      const snapshot = applied.snapshot;
      validateThreadSnapshot(snapshot);

      // Step 15 — ThreadSnapshot save + CAS readback.
      await this.#snapshots.save(snapshot);
      const savedSnapshot = await this.#snapshots.get(snapshot.id);
      if (
        !savedSnapshot ||
        deterministicJson(savedSnapshot) !== deterministicJson(snapshot)
      ) {
        throw new Error(
          "Simulation-case snapshot was not durably readable after save.",
        );
      }
      snapshotPersisted = true;

      // Step 16 — publishRun + completeRun.
      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary: "Publishing the sealed simulation-case evidence.",
        });
      } else if (run.status !== "publishing" && run.status !== "completed") {
        throw unexpectedStatus(run, "publishing");
      }

      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.#commands.completeRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "complete"),
          expectedRevision: project.revision,
          summary:
            `Sealed simulation case ${validatedCase.id} r${validatedCase.revision} into the evidence thread.`,
          resultSnapshot: snapshotRef(snapshot),
          evidenceRefs: [
            {
              snapshotId: snapshot.id,
              snapshotRevision: snapshot.revision,
              kind: "artifact" as ThreadEntityKind,
              id: artifact.id,
            },
          ],
        });
      } else if (run.status !== "completed") {
        throw unexpectedStatus(run, "completed");
      }

      const complete = await this.#requiredProject(command.projectId);
      assertCompleted(complete, command);
      return complete;
    } catch (error) {
      // If the snapshot is persisted but project attachment failed, a retry with
      // the same commandId will find and re-use the already-persisted snapshot.
      if (snapshotPersisted) {
        const complete = await this.#completedFor(command);
        if (complete) return complete;
        const cause = error instanceof Error ? ` Cause: ${error.message}` : "";
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "Simulation-case evidence is durable but project attachment did not finish. " +
            `Retry this exact command; it will re-use the persisted snapshot.${cause}`,
        );
      }
      if (claimed) await this.#recordFailure(origin, command);
      throw error;
    }
  }

  // ── Private: case loading + verification ───────────────────────────────────

  async #loadAndVerifyCase(decisionParams: SimulationCaseDecisionParameters): Promise<{
    validatedCase: SimulationCase;
    canonicalCaseText: string;
    caseDigest: string;
  }> {
    // Step 5a — catalog lookup (fail-fast before any snapshot or lease access).
    const caseId = decisionParams.id;
    const casePath = SIMULATION_CASE_SOURCES.get(caseId);
    if (!casePath) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Simulation case "${caseId}" is not in the server-side catalog. ` +
          "Add an entry to SIMULATION_CASE_SOURCES and the corresponding JSON file.",
      );
    }

    // Step 5b — read + validate the case file.
    let raw: string;
    try {
      raw = await this.#readTextFile(casePath);
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Simulation case file "${casePath}" is not readable: ${errorMessage(error)}`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Simulation case file "${casePath}" is not valid JSON.`,
      );
    }

    let validatedCase: SimulationCase;
    try {
      validatedCase = validateSimulationCase(parsed);
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Simulation case "${casePath}" failed validation: ${errorMessage(error)}`,
      );
    }

    // Step 5c — canonical text + digest.
    const canonicalCaseTextValue = canonicalSimulationCaseText(validatedCase);
    const caseFp = await sha256Fingerprint(validatedCase);
    const caseDigest = caseFp.digest;

    // Step 5d — assert MRTR-signed caseDigest matches computed digest.
    if (decisionParams.caseDigest !== caseDigest) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Simulation case digest divergence: the MRTR signed caseDigest ` +
          `"${decisionParams.caseDigest.slice(0, 16)}…" does not match the ` +
          `computed digest "${caseDigest.slice(0, 16)}…" of the case at "${casePath}".`,
      );
    }

    // Step 6 — cross-check every MRTR field against the live SimulationCase.
    try {
      verifySimulationCaseParametersMatchCase(decisionParams, validatedCase);
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Simulation case MRTR parameters diverge from the live case: ${
          errorMessage(error)
        }`,
      );
    }

    return { validatedCase, canonicalCaseText: canonicalCaseTextValue, caseDigest };
  }

  // ── Private: project lifecycle helpers ────────────────────────────────────

  async #requiredProject(
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

  async #completedFor(
    command: SimulateSealSimulationCaseRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    try {
      const project = await this.#requiredProject(command.projectId);
      const run = requireRun(project, command.runId);
      if (run.status !== "completed") return undefined;
      assertCompleted(project, command);
      return project;
    } catch {
      return undefined;
    }
  }

  async #recordFailure(
    origin: EngineeringProjectCommandOrigin,
    command: SimulateSealSimulationCaseRunExecutorCommand,
  ): Promise<void> {
    try {
      const project = await this.#requiredProject(command.projectId);
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
        summary: "Simulate-seal-simulation-case stopped before the snapshot was saved.",
        code: "simulate-seal-simulation-case-not-published",
        message:
          "The simulate-seal-simulation-case run stopped before the sealed snapshot was published.",
      });
    } catch {
      // Preserve the original cause.
    }
  }
}

// ---------------------------------------------------------------------------
// Private: shape + MRTR helpers
// ---------------------------------------------------------------------------

const SEAL_OP = SIMULATE_SEAL_SIMULATION_CASE_OPERATION;

function requireShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): void {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const operation = workItem?.operation;
  // The executor holds the registry contract on its own: exactly the declared
  // approvedBrief binding, nothing else — a work item published outside the
  // registry path must not reach a trusted seal.
  const approvedBriefBinding = operation?.bindings.find(
    (b) => b.name === "approvedBrief" && b.source.kind === "approved-brief",
  );
  if (
    project.schemaVersion !== "3.0" ||
    run.basis?.kind !== "thread-snapshot" ||
    !workItem ||
    operation?.id !== SEAL_OP.id ||
    operation.version !== SEAL_OP.version ||
    !approvedBriefBinding ||
    operation.bindings.length !== 1
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Run ${run.id} is not bound to ${SEAL_OP.id}@${SEAL_OP.version} with a ` +
        "thread-snapshot basis, schema-3.0 project, and the sole approvedBrief binding.",
    );
  }
}

function requireClaimedShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
): void {
  requireShape(project, run);
  if (
    run.claimedBy?.origin !== origin.kind ||
    run.claimedBy.id !== origin.actorId
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the exact simulation-seal run it claimed.",
    );
  }
}

/**
 * Find the sole human-approved MRTR decision bound to this run's basis.
 *
 * Follows the same filter logic as requireMrtrApproval in the geometry and
 * architecture executors: status === "approved", exactly one human approval
 * with matching basis + fingerprints, decision fingerprint re-sealed.
 */
async function requireMrtrApproval(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): Promise<{
  decision: EngineeringDecision;
  proposal: NonNullable<EngineeringDecision["proposal"]>;
}> {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  if (!workItem) {
    throw new EngineeringProjectCommandError(
      "entity_not_found",
      `Work item for run ${run.id} not found.`,
    );
  }

  const basis = requireBasis(run);
  const candidates: Array<{
    decision: EngineeringDecision;
    proposal: NonNullable<EngineeringDecision["proposal"]>;
  }> = [];

  for (const decisionId of workItem.decisionIds) {
    const decision = project.decisions.find(
      (d) => d.id === decisionId && d.status === "approved",
    );
    if (!decision?.proposal || decision.proposal.parameters.length === 0) continue;

    const exactHumanApprovals = project.approvals.filter(
      (a: EngineeringApproval) =>
        a.decisionId === decision.id &&
        a.status === "approved" &&
        a.decidedByOrigin === "human" &&
        sameSnapshotBasis(a.baseSnapshot, basis) &&
        sameEvidenceRefs(a.inputEvidenceRefs, decision.inputEvidenceRefs) &&
        fingerprintsEqual(a.inputFingerprint, decision.inputFingerprint),
    );
    if (
      exactHumanApprovals.length === 1 &&
      sameSnapshotBasis(decision.baseSnapshot, basis) &&
      decision.inputFingerprint
    ) {
      candidates.push({ decision, proposal: decision.proposal });
    }
  }

  if (candidates.length !== 1) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      candidates.length === 0
        ? "No exact human-approved simulation-case MRTR decision is bound to this run basis."
        : "Ambiguous simulation-case MRTR: exactly one human-approved decision must be bound to this run basis.",
    );
  }

  const selected = candidates[0]!;

  // Re-seal the decision fingerprint to catch any post-proposal tampering.
  const expectedDecisionFingerprint = await sha256Fingerprint({
    baseSnapshot: selected.decision.baseSnapshot,
    inputEvidenceRefs: selected.decision.inputEvidenceRefs,
    proposal: {
      summary: selected.proposal.summary,
      parameters: selected.proposal.parameters,
    },
  });
  if (
    !fingerprintsEqual(
      expectedDecisionFingerprint,
      selected.decision.inputFingerprint,
    )
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "Simulation-case decision input fingerprint no longer seals its exact base " +
        "snapshot, evidence references, summary, and parameters.",
    );
  }

  // Verify the run's input fingerprint against the approved decision set.
  const approvedDecisions = workItem.decisionIds.map((id) => {
    const d = project.decisions.find((candidate) => candidate.id === id);
    if (!d?.inputFingerprint) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Simulation-case work-item decision ${id} is not exactly approved.`,
      );
    }
    return { id, inputFingerprint: d.inputFingerprint };
  });
  const expectedRunFingerprint = await sha256Fingerprint({
    workItemId: workItem.id,
    basis,
    operation: {
      id: workItem.operation!.id,
      version: workItem.operation!.version,
      bindings: workItem.operation!.bindings,
    },
    approvedDecisions,
  });
  if (!fingerprintsEqual(run.inputFingerprint, expectedRunFingerprint)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "Simulation-case run input fingerprint no longer seals its exact MRTR decision and basis.",
    );
  }

  return selected;
}

// ---------------------------------------------------------------------------
// Private: basis snapshot helpers
// ---------------------------------------------------------------------------

async function exactBasisSnapshot(
  snapshots: ThreadSnapshotStore,
  basis: EngineeringThreadSnapshotBasis,
): Promise<ThreadSnapshot> {
  const snapshot = await snapshots.get(basis.snapshotId);
  if (
    !snapshot ||
    snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Basis snapshot ${basis.snapshotId} r${basis.revision} for subject ` +
        `${basis.subjectId} is not exactly available.`,
    );
  }
  try {
    return validateThreadSnapshot(snapshot);
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Basis snapshot ${basis.snapshotId} is invalid: ${errorMessage(error)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Private: cliquet
// ---------------------------------------------------------------------------

/**
 * Assert that the current basis has not silently removed a simulation-case
 * artifact that carried the given (subjectId, caseDigest) pair in an ancestor.
 *
 * WHY WALK ANCESTORS — the ratchet only fires when a *prior* revision carried
 * the artifact but the current basis does not.  If no ancestor has ever sealed
 * this caseDigest, the check is a no-op.  Cap at 50 ancestors to bound the
 * traversal cost; larger lineages require operator review.
 */
async function assertSimulationCaseArtifactNotRemoved(
  basis: ThreadSnapshot,
  subjectId: string,
  caseDigest: string,
  snapshots: ThreadSnapshotStore,
): Promise<void> {
  if (hasSimulationCaseArtifact(basis, caseDigest)) return;

  const MAX_ANCESTORS = 50;
  let cursor = basis.previous;
  for (let i = 0; i < MAX_ANCESTORS; i++) {
    if (!cursor) return; // Root reached without finding the artifact.
    const ancestor = await snapshots.get(cursor.snapshotId);
    if (
      !ancestor ||
      ancestor.id !== cursor.snapshotId ||
      ancestor.revision !== cursor.revision ||
      ancestor.subject.id !== subjectId
    ) {
      throw new SimulationCaseLineageReviewRequiredError(
        `ancestor ${cursor.snapshotId}@${cursor.revision} is not resolvable or ` +
          "belongs to a different subject.",
      );
    }
    if (hasSimulationCaseArtifact(ancestor, caseDigest)) {
      throw new SimulationCaseArtifactRemovedError(subjectId, caseDigest);
    }
    cursor = ancestor.previous;
  }
  if (cursor) {
    throw new SimulationCaseLineageReviewRequiredError(
      `ancestor traversal exceeded the explicit ${MAX_ANCESTORS}-revision review bound.`,
    );
  }
}

/**
 * Return true when the snapshot carries a simulation-case artifact for the
 * given caseDigest.  The caseDigest is stored in the artifact's version field
 * so the cliquet can match by (URI prefix, version) without reading capture files.
 */
function hasSimulationCaseArtifact(
  snapshot: ThreadSnapshot,
  caseDigest: string,
): boolean {
  return snapshot.artifacts.some(
    (a) =>
      a.kind === "document" &&
      a.uri?.startsWith(SIMULATION_CASE_CAPTURE_URI_PREFIX) &&
      a.version === caseDigest,
  );
}

// ---------------------------------------------------------------------------
// Private: reviewBasis descendant-or-equal
// ---------------------------------------------------------------------------

/**
 * Assert that the run's basis snapshot is a descendant of (or equal to) the
 * reviewBasis declared inside the simulation case.
 *
 * WHY DESCENDANT-OR-EQUAL — the simulation case was authored against a specific
 * thread state (reviewBasis).  Running it on a basis that diverged from or
 * predates that state would mean executing a case designed for different
 * evidence.  A descendant basis is safe: evidence was only added, never removed.
 */
async function assertReviewBasisDescendantOrEqual(
  basisSnapshot: ThreadSnapshot,
  caseBase: SimulationCaseThreadSnapshot,
  snapshots: ThreadSnapshotStore,
): Promise<void> {
  // Equal case (fast path — most common in first-seal scenarios).
  if (
    basisSnapshot.id === caseBase.id &&
    basisSnapshot.revision === caseBase.revision &&
    basisSnapshot.subject.id === caseBase.subjectId
  ) return;

  // Descendant case: load the case's declared base snapshot and traverse.
  const caseBaseSnapshot = await snapshots.get(caseBase.id);
  if (
    !caseBaseSnapshot ||
    caseBaseSnapshot.id !== caseBase.id ||
    caseBaseSnapshot.revision !== caseBase.revision ||
    caseBaseSnapshot.subject.id !== caseBase.subjectId
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Simulation case reviewBasis snapshot ${caseBase.id}@${caseBase.revision} ` +
        "is not available in the thread snapshot store.",
    );
  }

  const isDescendant = await threadSnapshotDescendsFrom(
    basisSnapshot,
    caseBaseSnapshot,
    snapshots,
  );
  if (!isDescendant) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Run basis ${basisSnapshot.id}@${basisSnapshot.revision} is not a descendant ` +
        `of the simulation case reviewBasis ${caseBase.id}@${caseBase.revision}. ` +
        "Requeue the run against the current thread head after verifying the case is still valid.",
    );
  }
}

// ---------------------------------------------------------------------------
// Private: miscellaneous helpers
// ---------------------------------------------------------------------------

function commandStep(commandId: string, step: string): string {
  return `${commandId}:simulate-seal-simulation-case:${step}`;
}

function assertCompleted(
  project: EngineeringProjectSnapshot,
  command: SimulateSealSimulationCaseRunExecutorCommand,
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
      `Simulation-seal run ${command.runId} did not complete through this exact execution command.`,
    );
  }
}

function sameSnapshotBasis(
  value:
    | EngineeringDecision["baseSnapshot"]
    | EngineeringApproval["baseSnapshot"]
    | EngineeringAgentRun["basis"],
  basis: EngineeringThreadSnapshotBasis,
): boolean {
  if (!value || !("snapshotId" in value)) return false;
  return (
    value.snapshotId === basis.snapshotId &&
    value.revision === basis.revision &&
    value.subjectId === basis.subjectId
  );
}

function sameEvidenceRefs(
  left: readonly {
    snapshotId: string;
    snapshotRevision: number;
    kind: string;
    id: string;
  }[],
  right: readonly {
    snapshotId: string;
    snapshotRevision: number;
    kind: string;
    id: string;
  }[],
): boolean {
  const key = (ref: typeof left[number]) =>
    `${ref.snapshotId}\u0000${ref.snapshotRevision}\u0000${ref.kind}\u0000${ref.id}`;
  return (
    left.length === right.length &&
    left.map(key).sort().every((item, index) => item === right.map(key).sort()[index])
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
