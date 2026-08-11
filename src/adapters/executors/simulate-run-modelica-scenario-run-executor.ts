/**
 * Trusted executor for `simulate.run-modelica-scenario@1`.
 *
 * WHY OBSERVATIONAL — this operation captures the exact numerical output of a
 * provider Modelica simulation as thread evidence.  It produces observations
 * and attestation artifacts but never a requirement verdict.  The structural
 * triple-lock (verdictStatus not_evaluated, requirements [], passed/failed/
 * unresolved 0) is maintained verbatim through createObservedModelicaRunExtension
 * and validated by validateThreadSnapshot before any snapshot is persisted.
 *
 * WHY TWO CAS OBJECTS — the provider run record (producer "modelica") seals the
 * raw normalized provider envelopes so an auditor can verify double attestation
 * without a live provider.  The execution receipt (producer "digital-thread")
 * asserts the lineage between the human-signed simulation case artifact and the
 * concrete provider run record.  Confusing them would corrupt inputArtifactIds
 * lineage on the receipt.
 *
 * Sequence:
 *  1. Agent-only origin gate.
 *  2. requireShape: operation id / version / "simulationCase" thread-entity binding.
 *  3. requireMrtrApproval: find the sole human-approved decision for this run.
 *  4. Parse sim.case.* parameters; load case capture by captureFp from the bound
 *     artifact; re-hash canonicalCaseText → caseDigest; re-validate; cross-check
 *     every MRTR field. Extract caseArtifact {id, fingerprint, producerRunId}.
 *  5. Project and subjectId identity guards.
 *  6. Lease: threadWriteBasisLeaseScope (serialises concurrent thread writes).
 *  7. assertThreadWriteBasisAvailable; load basisSnapshot;
 *     assertThreadSnapshotLineageIntact; verify bound caseArtifact present in
 *     basis with correct caseDigest.
 *  8. claimRun (stamps startedAt).
 *  9. Re-read; re-check shape + claimed; completed idempotent return.
 * 10. assertCaseWithinPolicy (timeout cap — fail-fast before WAL).
 *     Qualified-method catalogue: kit present, each parameter in bounds (unit, finite
 *     min/max, value within range), each expectedMetric present with unit.
 * 11. planDigest = sha256({caseDigest, exactSimulateRequest, policyVersion}).
 *     WAL.begin.
 * 12. Three WAL paths (drive by WAL.begin action):
 *     completed → re-materialize ParsedModelicaRun from stored envelope;
 *                 repair absent CAS objects; skip provider calls entirely.
 *     provider-run-known → readback only; double attestation.
 *     dispatch → simulate; WAL recordProviderRun; readback;
 *                double attestation.
 * 13. buildProviderRunRecordEnvelope → CAS save (recordCaptures) → readback.
 *     buildExecutionReceiptEnvelope → CAS save (receiptCaptures) → readback.
 *     WAL.complete.
 * 14. createObservedModelicaRunExtension VERBATIM; append receipt artifact (and
 *     provider record artifact) with their consumption/provenance triplets;
 *     applyThreadSnapshotExtensionIfNew; validateThreadSnapshot.
 * 15. ThreadSnapshot save; CAS readback; publishRun; completeRun; assertCompleted.
 * 16. Catch windows:
 *     ModelicaScenarioOutcomeUnknownError → preserve running/publishing for review.
 *     Error after providerAcknowledged, snapshot not durable → quarantine WAL,
 *     preserve running/publishing and rethrow the original error.
 *     Existing quarantine → preserve running/publishing; never mutate project state.
 *     Snapshot durable, publish incomplete → idempotent re-attach or retry hint.
 *     Only a failure proven to be pre-acknowledgement may fail the claimed run.
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
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
  EngineeringWorkItem,
} from "../../domain/project/engineering-project.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadEntityKind,
  ThreadFreshness,
  ThreadOperationRef,
  ThreadProvenanceLink,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import {
  applyThreadSnapshotExtensionIfNew,
  type ThreadSnapshotExtension,
} from "../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import type { EvidenceArtifact, RunDetail } from "../../domain/kernel/types.ts";
import {
  parseSimulationCaseDecisionParameters,
  SIMULATE_RUN_MODELICA_SCENARIO_OPERATION,
  simulationCaseDecisionParametersToMap,
  verifySimulationCaseParametersMatchCase,
} from "../../domain/analysis/simulation-case-proposal.ts";
import {
  type SimulationCase,
  validateSimulationCase,
} from "../../domain/analysis/simulation-case.ts";
import {
  assertCaseWithinPolicy,
  type SimulationExecutionPolicy,
} from "../../domain/analysis/simulation-execution-policy.ts";
import type {
  DynamicSystemDispatchRecord,
  DynamicSystemRun,
  DynamicSystemSimulationPlan,
  DynamicSystemSimulator,
  SimulationCaseIdentity,
  SimulationMethodCatalog,
  SimulationPlanResolver,
  SimulationRunReader,
} from "../../domain/analysis/simulation-capabilities.ts";
import { DynamicSystemResponseError } from "../../domain/analysis/simulation-capabilities.ts";
import {
  type FileCaptureStore,
  MODELICA_SCENARIO_RECEIPT_CAPTURE_DESCRIPTOR,
  MODELICA_SCENARIO_RUN_CAPTURE_DESCRIPTOR,
} from "../captures/file-capture-store.ts";
import {
  buildExecutionReceiptEnvelope,
  buildProviderRunRecordEnvelope,
} from "../captures/modelica-scenario-run-capture.ts";
import {
  FileModelicaScenarioAttemptStore,
  type ModelicaScenarioAttempt,
  ModelicaScenarioOutcomeUnknownError,
  ModelicaScenarioRunQuarantinedError,
} from "../wal/file-modelica-scenario-attempt-store.ts";
import type {
  EngineeringProjectRunLease,
} from "../stores/file-engineering-project-run-lease.ts";
import {
  assertThreadSnapshotLineageIntact,
} from "../stores/thread-snapshot-lineage.ts";
import type {
  LiveThreadUpdateMilestoneJournal,
} from "../stores/live-thread-update-store.ts";
import { SIMULATION_CASE_CAPTURE_URI_PREFIX } from "../captures/file-capture-store.ts";
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
import {
  createObservedModelicaRunExtension,
} from "../observed-modelica-thread-branch.ts";

// ── Public re-export ─────────────────────────────────────────────────────────

/** Re-exported from domain so registry.ts can import from one location. */
export { SIMULATE_RUN_MODELICA_SCENARIO_OPERATION };

/** Re-exported so server.ts can wire the correct store without a sub-import. */
export {
  MODELICA_SCENARIO_RECEIPT_CAPTURE_DESCRIPTOR,
  MODELICA_SCENARIO_RUN_CAPTURE_DESCRIPTOR,
};

// ── Command / dependency types ───────────────────────────────────────────────

export interface SimulateRunModelicaScenarioRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface SimulateRunModelicaScenarioRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore;
  /** Content-addressed store for simulation-case seal captures (read-only here). */
  readonly caseCaptures: FileCaptureStore<"simulation-case">;
  /** Content-addressed store for provider run record envelopes (written here). */
  readonly recordCaptures: FileCaptureStore<"modelica-scenario-run">;
  /** Content-addressed store for execution receipt envelopes (written here). */
  readonly receiptCaptures: FileCaptureStore<"modelica-scenario-receipt">;
  /** Durable intent/state boundary around the non-idempotent provider call. */
  readonly attempts: FileModelicaScenarioAttemptStore;
  /** Read-only authority over the server-owned qualified method catalogue. */
  readonly methodCatalog: SimulationMethodCatalog;
  /** Pure provider-owned lowering used to derive the exact plan digest. */
  readonly planResolver: SimulationPlanResolver;
  /** Non-idempotent dynamic-system execution capability. */
  readonly simulator: DynamicSystemSimulator;
  /** Durable provider-run normalization and readback capability. */
  readonly runReader: SimulationRunReader;
  readonly policy: SimulationExecutionPolicy;
  readonly lease: EngineeringProjectRunLease;
  /** Presentation only; a journal failure cannot repeat the provider dispatch. */
  readonly liveUpdates?: LiveThreadUpdateMilestoneJournal;
  readonly now?: () => string;
}

// ── Case capture record shape (internal parse target) ────────────────────────

interface CaseCaptureRecord {
  readonly schemaVersion: string;
  readonly caseDigest: string;
  readonly canonicalCaseText: string;
  readonly trustedRunId: string;
}

// ── Executor ─────────────────────────────────────────────────────────────────

export class SimulateRunModelicaScenarioRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: EngineeringProjectCommandService;
  readonly #snapshots: ThreadSnapshotStore;
  readonly #caseCaptures: FileCaptureStore<"simulation-case">;
  readonly #recordCaptures: FileCaptureStore<"modelica-scenario-run">;
  readonly #receiptCaptures: FileCaptureStore<"modelica-scenario-receipt">;
  readonly #attempts: FileModelicaScenarioAttemptStore;
  readonly #methodCatalog: SimulationMethodCatalog;
  readonly #planResolver: SimulationPlanResolver;
  readonly #simulator: DynamicSystemSimulator;
  readonly #runReader: SimulationRunReader;
  readonly #policy: SimulationExecutionPolicy;
  readonly #lease: EngineeringProjectRunLease;
  readonly #liveUpdates: LiveThreadUpdateMilestoneJournal | undefined;
  readonly #now: () => string;

  constructor(deps: SimulateRunModelicaScenarioRunExecutorDependencies) {
    this.#projects = deps.projects;
    this.#commands = deps.commands;
    this.#snapshots = deps.snapshots;
    this.#caseCaptures = deps.caseCaptures;
    this.#recordCaptures = deps.recordCaptures;
    this.#receiptCaptures = deps.receiptCaptures;
    this.#attempts = deps.attempts;
    this.#methodCatalog = deps.methodCatalog;
    this.#planResolver = deps.planResolver;
    this.#simulator = deps.simulator;
    this.#runReader = deps.runReader;
    this.#policy = deps.policy;
    this.#lease = deps.lease;
    this.#liveUpdates = deps.liveUpdates;
    this.#now = deps.now ?? (() => new Date().toISOString());
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: SimulateRunModelicaScenarioRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    // Step 1 — agent-only origin gate.
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute the simulate-run-modelica-scenario run.",
      );
    }

    // Step 2 — shape check (operation id/version/binding) before any I/O.
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    const workItem = requireShape(project, run);

    // Step 3 — MRTR approval gate.
    const { decision, proposal } = await requireMrtrApproval(project, run);

    // Step 4 — parse the flat sim.case.* grammar from the signed proposal.
    let decisionParams;
    try {
      decisionParams = parseSimulationCaseDecisionParameters(
        simulationCaseDecisionParametersToMap(proposal.parameters),
      );
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Simulation case decision parameters are invalid: ${errorMsg(error)}`,
      );
    }

    // Step 4b — extract the thread-entity binding reference for the case artifact.
    const caseBinding = workItem.operation!.bindings.find(
      (b) => b.name === "simulationCase" && b.source.kind === "thread-entity",
    );
    if (!caseBinding || caseBinding.source.kind !== "thread-entity") {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Run ${run.id} is missing a thread-entity "simulationCase" binding.`,
      );
    }
    const caseRef = caseBinding.source.reference;

    // Step 4c — load the case capture from CAS using the bound artifact fingerprint.
    const basis = requireBasis(run);
    const basisSnapshot = await exactBasisSnapshot(this.#snapshots, basis);
    const boundArtifact = basisSnapshot.artifacts.find(
      (a) => a.id === caseRef.id,
    );
    if (!boundArtifact) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Simulation case artifact "${caseRef.id}" referenced by the binding is absent ` +
          "from the basis snapshot.",
      );
    }
    const captureText = await this.#caseCaptures.read(boundArtifact.fingerprint);
    if (!captureText) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Simulation case capture ${boundArtifact.fingerprint.digest.slice(0, 16)}… ` +
          "is absent from the CAS store; the seal must be re-run.",
      );
    }
    const caseCapture = parseCaseCaptureRecord(captureText);

    // Re-validate the case from the canonical text stored inside the capture.
    let validatedCase: SimulationCase;
    try {
      validatedCase = validateSimulationCase(
        JSON.parse(caseCapture.canonicalCaseText),
      );
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Sealed simulation case failed re-validation: ${errorMsg(error)}`,
      );
    }

    // Re-hash the canonical text to confirm the caseDigest is still intact.
    const recomputedFp = await sha256Fingerprint(validatedCase);
    if (recomputedFp.digest !== caseCapture.caseDigest) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "Sealed simulation case digest diverges from its stored canonical text.",
      );
    }

    // Step 4d — cross-check every MRTR field against the live SimulationCase.
    try {
      verifySimulationCaseParametersMatchCase(decisionParams, validatedCase);
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Simulation case MRTR parameters diverge from the live case: ${
          errorMsg(error)
        }`,
      );
    }

    // MRTR-signed caseDigest must match the capture's stored caseDigest.
    if (decisionParams.caseDigest !== caseCapture.caseDigest) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "MRTR-signed caseDigest does not match the sealed capture caseDigest.",
      );
    }

    const caseDigest = caseCapture.caseDigest;
    const caseArtifactIdentity = {
      id: boundArtifact.id,
      fingerprint: boundArtifact.fingerprint,
      producerRunId: caseCapture.trustedRunId,
    };

    // Step 5 — project / subjectId identity guards.
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

    // Step 6 — acquire the thread-write basis lease.
    return await this.#lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () =>
        this.#executeLeased(
          origin,
          command,
          decision,
          validatedCase,
          caseDigest,
          caseArtifactIdentity,
        ),
    );
  }

  // ── Private: leased execution ──────────────────────────────────────────────

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: SimulateRunModelicaScenarioRunExecutorCommand,
    _decision: EngineeringDecision,
    simulationCase: SimulationCase,
    caseDigest: string,
    caseArtifactIdentity: {
      id: string;
      fingerprint: ContentFingerprint;
      producerRunId: string;
    },
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let providerAcknowledged = false;
    let snapshotPersisted = false;
    let materializationSnapshot: ThreadSnapshot | undefined;

    try {
      // Post-lease idempotent replay short-circuit.
      const preClaim = await this.#requiredProject(command.projectId);
      requireShape(preClaim, requireRun(preClaim, command.runId));
      const alreadyCompleted = await this.#completedFor(command);
      if (alreadyCompleted) return alreadyCompleted;

      // Step 7 — pre-claim guards inside the lease.
      await assertThreadWriteBasisAvailable(
        preClaim,
        requireRun(preClaim, command.runId),
      );
      const preClaimRun = requireRun(preClaim, command.runId);
      const basis = requireBasis(preClaimRun);
      const basisSnapshot = await exactBasisSnapshot(this.#snapshots, basis);

      await assertThreadSnapshotLineageIntact(basisSnapshot, this.#snapshots);

      // The bound simulation-case artifact must exist in the basis and carry
      // the matching caseDigest — this is the "executionBasis descendant of seal"
      // invariant: the seal's document artifact was never removed from the lineage.
      assertBasisContainsCaseArtifact(
        basisSnapshot,
        caseArtifactIdentity.id,
        caseDigest,
      );

      // Step 8 — claimRun (stamps startedAt).
      await this.#commands.claimRun(origin, {
        ...command,
        commandId: stepId(command.commandId, "claim"),
        summary: "Started the simulate-run-modelica-scenario run.",
      });
      claimed = true;

      // Step 9 — re-read; re-check shape + claimed; idempotent completed return.
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

      const startedAt = requiredStart(run);
      const currentBasis = requireBasis(run);
      const currentBasisSnapshot = await exactBasisSnapshot(
        this.#snapshots,
        currentBasis,
      );

      // Step 10 — policy cap (fail-fast before WAL; no uncertain provider state).
      assertCaseWithinPolicy(simulationCase, this.#policy);

      // Step 11 — resolve the provider lowering through the private capability
      // adapter, then bind its exact dispatch evidence into the plan digest.
      const simulationPlan = this.#planResolver.resolve(simulationCase);
      const exactSimulateRequest = simulationPlan.exactDispatchRecord;
      const planFp = await sha256Fingerprint({
        caseDigest,
        exactSimulateRequest,
        policyVersion: this.#policy.policyVersion,
      });
      const planDigest = planFp.digest;

      // A completed WAL contains all evidence needed for re-materialization.
      // Inspect local state before method discovery so completed recovery has
      // no provider dependency at all. A new dispatch still performs the live
      // kit gate before it reserves its sole simulate call.
      await preflightModelicaKitForAttempt({
        attempts: this.#attempts,
        methodCatalog: this.#methodCatalog,
        projectId: command.projectId,
        runId: run.id,
        simulationCase,
      });

      const walResult = await this.#attempts.begin({
        projectId: command.projectId,
        runId: run.id,
        planDigest,
        dispatchedAt: startedAt,
      });

      // Step 12 — resolve ParsedModelicaRun from the appropriate WAL path.
      const caseIdentity: SimulationCaseIdentity = {
        kit: {
          modelId: simulationCase.kit.modelId,
          modelVersion: simulationCase.kit.modelVersion,
          modelSha256: simulationCase.kit.modelSha256,
        },
        scenario: simulationCase.scenario,
        parameters: simulationCase.parameters,
        expectedMetrics: simulationCase.expectedMetrics,
      };

      let parsedRun: DynamicSystemRun;
      let canonicalSimulateEnvelopeText: string;
      let providerRunId: string;

      if (walResult.action === "completed") {
        // Re-materialize from stored WAL envelope; skip all provider calls.
        providerAcknowledged = true;
        canonicalSimulateEnvelopeText = deterministicJson(
          walResult.canonicalSimulateEnvelope,
        );
        parsedRun = this.#runReader.normalizeRecordedRun(
          walResult.canonicalSimulateEnvelope,
          caseIdentity,
        );
        providerRunId = walResult.providerRunId;
      } else if (walResult.action === "provider-run-known") {
        // Resume from run_get only — never re-simulate on this path.
        canonicalSimulateEnvelopeText = deterministicJson(
          walResult.canonicalSimulateEnvelope,
        );
        providerRunId = walResult.providerRunId;
        providerAcknowledged = true;
        parsedRun = await this.#runReader.readRun(providerRunId, caseIdentity);
        this.#runReader.assertDispatchMatchesReadback(
          canonicalSimulateEnvelopeText,
          parsedRun,
        );
      } else {
        // Dispatch path — the private capability adapter owns the sole provider call.
        const dispatch = await simulateAfterModelicaWalReservation(
          this.#simulator,
          simulationPlan,
        );
        providerAcknowledged = true;
        if (dispatch.status !== "succeeded") {
          throw new EngineeringProjectCommandError(
            "invalid_transition",
            `Modelica simulation ended with status "${dispatch.status}" — not "succeeded".`,
          );
        }
        providerRunId = dispatch.providerRunId;
        canonicalSimulateEnvelopeText = dispatch.canonicalProviderRecordText;

        // Durable WAL transition to provider-run-known before run_get.
        await this.#attempts.recordProviderRun({
          projectId: command.projectId,
          runId: run.id,
          planDigest,
          providerRunId,
          canonicalSimulateEnvelope: dispatch.exactProviderRecord,
        });

        parsedRun = await this.#runReader.readRun(providerRunId, caseIdentity);
        this.#runReader.assertDispatchMatchesReadback(
          canonicalSimulateEnvelopeText,
          parsedRun,
        );
      }

      // Step 13 — build and persist both CAS objects; WAL.complete.
      const capturedAt = startedAt;
      const operationRef =
        `${SIMULATE_RUN_MODELICA_SCENARIO_OPERATION.id}@${SIMULATE_RUN_MODELICA_SCENARIO_OPERATION.version}`;

      const recordEnvelope = await buildProviderRunRecordEnvelope(parsedRun, {
        trustedRunId: run.id,
        operation: operationRef,
        capturedAt,
        canonicalSimulateEnvelopeText,
      });

      let savedRecordText = walResult.action === "completed"
        ? await this.#recordCaptures.read({
          algorithm: "sha256",
          digest: walResult.providerRunRecordFp,
        })
        : undefined;

      if (!savedRecordText) {
        await this.#recordCaptures.save(
          { algorithm: "sha256", digest: recordEnvelope.fingerprintDigest },
          recordEnvelope.canonicalText,
        );
        savedRecordText = await this.#recordCaptures.read({
          algorithm: "sha256",
          digest: recordEnvelope.fingerprintDigest,
        });
      } else if (walResult.action === "completed") {
        // Completed path: verify the persisted record matches the WAL fingerprint.
        if (
          deterministicJson(recordEnvelope.fingerprintDigest) !==
            deterministicJson(walResult.providerRunRecordFp)
        ) {
          throw new Error(
            "Re-materialized provider run record fingerprint diverges from WAL.",
          );
        }
      }

      if (!savedRecordText || savedRecordText !== recordEnvelope.canonicalText) {
        throw new Error(
          "Provider run record capture was not durably readable after save.",
        );
      }

      const receiptEnvelope = await buildExecutionReceiptEnvelope({
        caseArtifact: caseArtifactIdentity,
        caseDigest,
        providerRunId,
        exactSimulateRequest,
        policyVersion: this.#policy.policyVersion,
        capturedAt,
      });

      let savedReceiptText = walResult.action === "completed"
        ? await this.#receiptCaptures.read({
          algorithm: "sha256",
          digest: walResult.receiptFp,
        })
        : undefined;

      if (!savedReceiptText) {
        await this.#receiptCaptures.save(
          { algorithm: "sha256", digest: receiptEnvelope.fingerprintDigest },
          receiptEnvelope.canonicalText,
        );
        savedReceiptText = await this.#receiptCaptures.read({
          algorithm: "sha256",
          digest: receiptEnvelope.fingerprintDigest,
        });
      } else if (walResult.action === "completed") {
        if (
          deterministicJson(receiptEnvelope.fingerprintDigest) !==
            deterministicJson(walResult.receiptFp)
        ) {
          throw new Error(
            "Re-materialized execution receipt fingerprint diverges from WAL.",
          );
        }
      }

      if (
        !savedReceiptText || savedReceiptText !== receiptEnvelope.canonicalText
      ) {
        throw new Error(
          "Execution receipt capture was not durably readable after save.",
        );
      }

      // WAL complete — both CAS fingerprints are durably readable.
      if (walResult.action !== "completed") {
        await this.#attempts.complete({
          projectId: command.projectId,
          runId: run.id,
          planDigest,
          providerRunRecordFp: recordEnvelope.fingerprintDigest,
          receiptFp: receiptEnvelope.fingerprintDigest,
        });
      }

      // Step 14 — build the thread extension from provider evidence + receipt.
      const runDetail = parsedRunAsRunDetail(parsedRun);
      const baseExtension = createObservedModelicaRunExtension(
        currentBasis.subjectId,
        runDetail,
        { sourceLabel: "generic Modelica scenario run" },
      );

      const branchFreshness: ThreadFreshness = {
        status: "fresh",
        changedAt: parsedRun.completedAt,
        invalidatedByChangeIds: [],
      };

      // Stable id/prefix for CAS artifact ids within this extension.
      const runSlug = slug(run.id);
      const prrArtifactId = `modelica-run-record-${runSlug}-${
        recordEnvelope.fingerprintDigest.slice(0, 12)
      }`;
      const receiptArtifactId = `modelica-receipt-${runSlug}-${
        receiptEnvelope.fingerprintDigest.slice(0, 12)
      }`;

      const recordArtifactProducer: ThreadOperationRef = {
        serverId: simulationPlan.readbackOperation.serverId,
        tool: simulationPlan.readbackOperation.operationId,
        runId: providerRunId,
      };
      const receiptArtifactProducer: ThreadOperationRef = {
        serverId: "digital-thread",
        tool: operationRef,
        runId: run.id,
      };

      const providerRunRecordArtifact: ThreadArtifact = {
        id: prrArtifactId,
        name: `Modelica run record: ${providerRunId}`,
        kind: "evidence",
        version: recordEnvelope.fingerprintDigest.slice(0, 12),
        fingerprint: { algorithm: "sha256", digest: recordEnvelope.fingerprintDigest },
        uri: this.#recordCaptures.uriFor({
          algorithm: "sha256",
          digest: recordEnvelope.fingerprintDigest,
        }),
        mediaType: "application/json",
        producer: recordArtifactProducer,
        inputArtifactIds: [],
        freshness: branchFreshness,
      };

      // Receipt inputArtifactIds reference both the case and the record.
      const receiptArtifact: ThreadArtifact = {
        id: receiptArtifactId,
        name: `Modelica scenario execution receipt: ${parsedRun.runId}`,
        kind: "evidence",
        version: receiptEnvelope.fingerprintDigest.slice(0, 12),
        fingerprint: {
          algorithm: "sha256",
          digest: receiptEnvelope.fingerprintDigest,
        },
        uri: this.#receiptCaptures.uriFor({
          algorithm: "sha256",
          digest: receiptEnvelope.fingerprintDigest,
        }),
        mediaType: "application/json",
        producer: receiptArtifactProducer,
        inputArtifactIds: [caseArtifactIdentity.id, prrArtifactId],
        freshness: branchFreshness,
      };

      // Consumption triplets for the receipt's two inputs.
      const consumeCaseId = `consume-case-${
        slug(caseArtifactIdentity.id)
      }-by-${runSlug}`;
      const consumeRecordId = `consume-record-${prrArtifactId}-by-${runSlug}`;

      const consumeCase: ThreadArtifactConsumption = {
        id: consumeCaseId,
        artifactId: caseArtifactIdentity.id,
        consumer: receiptArtifactProducer,
        observedFingerprint: caseArtifactIdentity.fingerprint,
        verifiedAt: capturedAt,
        status: "verified",
      };
      const consumeRecord: ThreadArtifactConsumption = {
        id: consumeRecordId,
        artifactId: prrArtifactId,
        consumer: receiptArtifactProducer,
        observedFingerprint: {
          algorithm: "sha256",
          digest: recordEnvelope.fingerprintDigest,
        },
        verifiedAt: capturedAt,
        status: "verified",
      };

      const provenanceLinks: ThreadProvenanceLink[] = [
        {
          id: `link-${receiptArtifactId}-from-case-${slug(caseArtifactIdentity.id)}`,
          relation: "derived_from",
          from: { kind: "artifact", id: receiptArtifactId },
          to: { kind: "artifact", id: caseArtifactIdentity.id },
          rationale:
            "The execution receipt attests the lineage from the sealed simulation case.",
        },
        {
          id: `link-${receiptArtifactId}-from-record-${prrArtifactId}`,
          relation: "derived_from",
          from: { kind: "artifact", id: receiptArtifactId },
          to: { kind: "artifact", id: prrArtifactId },
          rationale: "The receipt is sealed over the provider run record it attestees.",
        },
        {
          id: `link-${consumeCaseId}-uses-${slug(caseArtifactIdentity.id)}`,
          relation: "uses",
          from: { kind: "consumption", id: consumeCaseId },
          to: { kind: "artifact", id: caseArtifactIdentity.id },
          rationale:
            "The receipt executor read and verified the exact simulation case bytes.",
        },
        {
          id: `link-${consumeRecordId}-uses-${prrArtifactId}`,
          relation: "uses",
          from: { kind: "consumption", id: consumeRecordId },
          to: { kind: "artifact", id: prrArtifactId },
          rationale:
            "The receipt executor read and verified the exact provider run record bytes.",
        },
      ];

      // Merge the receipt/record artifacts and their triplets into the base extension.
      const fullExtension: ThreadSnapshotExtension & typeof baseExtension = {
        ...baseExtension,
        artifacts: [
          ...baseExtension.artifacts,
          providerRunRecordArtifact,
          receiptArtifact,
        ],
        consumptions: [
          ...baseExtension.consumptions,
          consumeCase,
          consumeRecord,
        ],
        provenance: [
          ...baseExtension.provenance,
          ...provenanceLinks,
        ],
      };

      const applied = applyThreadSnapshotExtensionIfNew(
        currentBasisSnapshot,
        fullExtension,
        { appliedAt: capturedAt },
      );
      const snapshot = validateThreadSnapshot(applied.snapshot);

      // Step 15 — persist snapshot; CAS readback; publish; complete.
      await this.#snapshots.save(snapshot);
      const readBack = await this.#snapshots.get(snapshot.id);
      if (
        !readBack ||
        deterministicJson(readBack) !== deterministicJson(snapshot)
      ) {
        throw new Error(
          "Simulation evidence snapshot was not durably readable after save.",
        );
      }
      snapshotPersisted = true;
      materializationSnapshot = snapshot;

      // Find the receipt artifact reference for completeRun evidenceRefs.
      const receiptRef: EngineeringThreadEntityRef = {
        snapshotId: snapshot.id,
        snapshotRevision: snapshot.revision,
        kind: "artifact" as ThreadEntityKind,
        id: receiptArtifactId,
      };

      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: stepId(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary: "Publishing the Modelica scenario simulation evidence.",
        });
      } else if (run.status !== "publishing" && run.status !== "completed") {
        throw unexpectedStatus(run, "publishing");
      }

      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.#commands.completeRun(origin, {
          ...command,
          commandId: stepId(command.commandId, "complete"),
          expectedRevision: project.revision,
          summary: `Recorded Modelica scenario evidence for run ${parsedRun.runId}.`,
          resultSnapshot: snapshotRef(snapshot),
          evidenceRefs: [receiptRef],
        });
      } else if (run.status !== "completed") {
        throw unexpectedStatus(run, "completed");
      }

      const completed = await this.#requiredProject(command.projectId);
      assertCompleted(completed, command);
      return completed;
    } catch (error) {
      // Determine snapshot persistence state for window routing.
      if (materializationSnapshot) {
        try {
          const readBack = await this.#snapshots.get(materializationSnapshot.id);
          snapshotPersisted ||= !!readBack &&
            deterministicJson(readBack) ===
              deterministicJson(materializationSnapshot);
        } catch {
          // Fall through with snapshotPersisted as previously set.
        }
      }

      const failureWindow = classifyModelicaFailureWindow(error, {
        providerAcknowledged,
        snapshotPersisted,
      });

      if (failureWindow === "outcome-unknown") {
        // A request may have reached the provider. Preserve the active run so
        // an operator can reconcile the exact command and WAL without losing
        // its ownership/status context.
        throw error;
      }

      if (failureWindow === "quarantined") {
        // Quarantine is already durable. An exact retry is a read-only refusal:
        // do not fail the still-reconcilable project run or rewrite the sentinel.
        throw error;
      }

      if (failureWindow === "snapshot-persisted") {
        // Window 3: snapshot is durable but publish/complete didn't finish.
        const completed = await this.#completedFor(command);
        if (completed) return completed;
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "Modelica scenario evidence is durable but project attachment did not finish. " +
            "Retry this exact command; it will resume without re-running Modelica.",
        );
      }

      if (failureWindow === "post-acknowledgement") {
        // Provider acknowledged but structural verification failed before a
        // durable snapshot. Quarantine the exact run and leave project state
        // running/publishing for operator reconciliation.
        try {
          await this.#attempts.quarantine({
            projectId: command.projectId,
            runId: command.runId,
            quarantinedAt: safeNow(this.#now),
          });
        } catch {
          // Preserve original error; the quarantine write is best-effort.
        }
      } else if (claimed) {
        // This is the sole failure window in which the provider is known not
        // to have acknowledged or possibly accepted a dispatch.
        await this.#recordFailureIfOwned(
          origin,
          command,
          "simulate-modelica-scenario-not-published",
          "Modelica scenario run stopped before durable evidence was published.",
        );
      }

      throw error;
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

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
    command: SimulateRunModelicaScenarioRunExecutorCommand,
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

  async #recordFailureIfOwned(
    origin: EngineeringProjectCommandOrigin,
    command: SimulateRunModelicaScenarioRunExecutorCommand,
    code: string,
    message: string,
  ): Promise<void> {
    try {
      const project = await this.#requiredProject(command.projectId);
      const run = project.agentRuns.find((r) => r.id === command.runId);
      if (
        !run ||
        !["running", "publishing"].includes(run.status) ||
        run.claimedBy?.origin !== origin.kind ||
        run.claimedBy.id !== origin.actorId
      ) return;
      await this.#commands.failRun(origin, {
        ...command,
        commandId: stepId(command.commandId, "fail"),
        expectedRevision: project.revision,
        summary: message,
        code,
        message,
      });
    } catch {
      // Preserve the original execution error; this is only audit.
    }
  }
}

// ── Module-private helpers ───────────────────────────────────────────────────

const RUN_OP = SIMULATE_RUN_MODELICA_SCENARIO_OPERATION;

/** Returns the work item after verifying the operation identity and binding. */
function requireShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): EngineeringWorkItem {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const operation = workItem?.operation;
  const simulationCaseBinding = operation?.bindings.find(
    (b) =>
      b.name === "simulationCase" &&
      b.source.kind === "thread-entity" &&
      b.source.reference.kind === "artifact",
  );
  if (
    project.schemaVersion !== "3.0" ||
    run.basis?.kind !== "thread-snapshot" ||
    !workItem ||
    operation?.id !== RUN_OP.id ||
    operation.version !== RUN_OP.version ||
    !simulationCaseBinding ||
    operation.bindings.length !== 1
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Run ${run.id} is not bound to ${RUN_OP.id}@${RUN_OP.version} with a ` +
        "thread-snapshot basis, schema-3.0 project, and simulationCase binding.",
    );
  }
  return workItem;
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
      "This executor may run only the exact simulate-run-modelica-scenario run it claimed.",
    );
  }
}

/**
 * Find the sole human-approved MRTR decision bound to this run's basis.
 *
 * WHY SEPARATE — the approval chain must be found before any provider call or
 * WAL write so that a missing or ambiguous MRTR is a clean, reversible failure.
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
        ? "No exact human-approved simulation-run MRTR decision is bound to this run basis."
        : "Ambiguous simulation-run MRTR: exactly one human-approved decision must be bound.",
    );
  }

  const selected = candidates[0]!;

  // Re-seal the decision fingerprint to detect post-proposal tampering.
  const expectedDecisionFp = await sha256Fingerprint({
    baseSnapshot: selected.decision.baseSnapshot,
    inputEvidenceRefs: selected.decision.inputEvidenceRefs,
    proposal: {
      summary: selected.proposal.summary,
      parameters: selected.proposal.parameters,
    },
  });
  if (!fingerprintsEqual(expectedDecisionFp, selected.decision.inputFingerprint)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "Simulation-run decision input fingerprint no longer seals its exact " +
        "base snapshot, evidence references, summary, and parameters.",
    );
  }

  // Verify the run's inputFingerprint against the full approved decision set.
  const approvedDecisions = workItem.decisionIds.map((id) => {
    const d = project.decisions.find((c) => c.id === id);
    if (!d?.inputFingerprint) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Simulation-run work-item decision ${id} is not exactly approved.`,
      );
    }
    return { id, inputFingerprint: d.inputFingerprint };
  });

  const expectedRunFp = await sha256Fingerprint({
    workItemId: workItem.id,
    basis,
    operation: {
      id: workItem.operation!.id,
      version: workItem.operation!.version,
      bindings: workItem.operation!.bindings,
    },
    approvedDecisions,
  });
  if (!fingerprintsEqual(run.inputFingerprint, expectedRunFp)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "Simulation-run input fingerprint no longer seals its exact MRTR decision and basis.",
    );
  }

  return selected;
}

/** Assert that the basis snapshot contains the bound case artifact with the expected caseDigest. */
function assertBasisContainsCaseArtifact(
  basis: ThreadSnapshot,
  artifactId: string,
  caseDigest: string,
): void {
  const artifact = basis.artifacts.find((a) => a.id === artifactId);
  if (!artifact) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Simulation case artifact "${artifactId}" from the binding is absent from the ` +
        "basis snapshot — the seal result was not incorporated in this lineage.",
    );
  }
  if (
    !artifact.uri?.startsWith(SIMULATION_CASE_CAPTURE_URI_PREFIX) ||
    artifact.version !== caseDigest
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Bound artifact "${artifactId}" is not a simulation-case document ` +
        `carrying caseDigest ${caseDigest.slice(0, 16)}….`,
    );
  }
}

/** Load and validate the exact basis snapshot, rejecting any mismatch. */
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
  return snapshot;
}

/**
 * Parse the minimal fields needed from a simulation-case capture record.
 *
 * WHY NOT EXACT RECORD — the seal executor owns the full schema and might add
 * fields in future revisions.  The run executor only needs caseDigest,
 * canonicalCaseText, and trustedRunId.  A strict exactRecord check here would
 * couple the run executor to the seal executor's internal schema version.
 */
function parseCaseCaptureRecord(text: string): CaseCaptureRecord {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Simulation case capture record is not valid JSON.");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Simulation case capture record is not an object.");
  }
  const record = value as Record<string, unknown>;
  const { schemaVersion, caseDigest, canonicalCaseText, trustedRunId } = record;
  if (
    typeof schemaVersion !== "string" || !schemaVersion.startsWith("simulation-case") ||
    typeof caseDigest !== "string" || !/^[a-f0-9]{64}$/.test(caseDigest) ||
    typeof canonicalCaseText !== "string" || !canonicalCaseText.trim() ||
    typeof trustedRunId !== "string" || !trustedRunId.trim()
  ) {
    throw new Error(
      "Simulation case capture record is missing or has invalid required fields.",
    );
  }
  return { schemaVersion, caseDigest, canonicalCaseText, trustedRunId };
}

/**
 * Translate the sealed case's ordered parameter list to the pinned provider's
 * dynamic-object input schema. Sorting here makes the dispatched envelope,
 * plan digest, and receipt independent of an incidental in-memory array order.
 */
/**
 * Pure dispatch decision shared by the executor and its no-provider recovery
 * tests. A durable run state never needs the mutable live kit catalogue.
 */
export function needsModelicaKitListPreflight(
  knownAttempt: ModelicaScenarioAttempt | undefined,
): boolean {
  return knownAttempt === undefined;
}

/**
 * Resolve the sole live kit-list preflight site. Quarantine wins before both
 * WAL inspection and provider discovery. Completed recovery is fully offline;
 * provider-run-known recovery skips the mutable catalogue and later performs
 * only its required run readback.
 */
export async function preflightModelicaKitForAttempt(input: {
  readonly attempts: Pick<
    FileModelicaScenarioAttemptStore,
    "isQuarantined" | "readRun"
  >;
  readonly methodCatalog: SimulationMethodCatalog;
  readonly projectId: string;
  readonly runId: string;
  readonly simulationCase: SimulationCase;
}): Promise<void> {
  if (await input.attempts.isQuarantined(input.projectId, input.runId)) {
    throw new ModelicaScenarioRunQuarantinedError();
  }

  let knownAttempt: ModelicaScenarioAttempt | undefined;
  try {
    knownAttempt = await input.attempts.readRun(input.projectId, input.runId);
  } catch {
    throw new ModelicaScenarioOutcomeUnknownError();
  }
  if (!needsModelicaKitListPreflight(knownAttempt)) return;

  await input.methodCatalog.assertMethodAvailable(input.simulationCase);
}

/**
 * Execute the one call reserved by the Modelica WAL. A transport failure cannot
 * establish whether the provider persisted a run, so it is terminal outcome-
 * unknown. An acknowledged malformed response remains distinguishable and is
 * quarantined by the executor without losing the original exception.
 */
export async function simulateAfterModelicaWalReservation(
  simulator: DynamicSystemSimulator,
  plan: DynamicSystemSimulationPlan,
): Promise<DynamicSystemDispatchRecord> {
  try {
    return await simulator.simulate(plan);
  } catch (error) {
    if (error instanceof DynamicSystemResponseError) throw error;
    throw new ModelicaScenarioOutcomeUnknownError({ cause: error });
  }
}

export type ModelicaFailureWindow =
  | "outcome-unknown"
  | "quarantined"
  | "snapshot-persisted"
  | "post-acknowledgement"
  | "pre-acknowledgement";

/** Deterministic failure routing used by the executor catch window. */
export function classifyModelicaFailureWindow(
  error: unknown,
  state: {
    readonly providerAcknowledged: boolean;
    readonly snapshotPersisted: boolean;
  },
): ModelicaFailureWindow {
  if (error instanceof ModelicaScenarioRunQuarantinedError) {
    return "quarantined";
  }
  if (error instanceof ModelicaScenarioOutcomeUnknownError) {
    return "outcome-unknown";
  }
  if (state.snapshotPersisted) return "snapshot-persisted";
  if (
    state.providerAcknowledged || error instanceof DynamicSystemResponseError
  ) {
    return "post-acknowledgement";
  }
  return "pre-acknowledgement";
}

/**
 * Convert a fully validated ParsedModelicaRun into the RunDetail shape expected
 * by createObservedModelicaRunExtension.
 *
 * WHY VERBATIM MAPPING — the thermal executor uses an identical structural
 * conversion from its own capture type.  Keeping the field names and null
 * values identical ensures that parsePersistedModelicaRunEvidence inside
 * createObservedModelicaRunExtension accepts the result without modification.
 */
function parsedRunAsRunDetail(parsedRun: DynamicSystemRun): RunDetail {
  return {
    id: `modelica:${parsedRun.runId}`,
    name: `${parsedRun.model.id} / ${parsedRun.scenario.id}`,
    subject: `Modelica ${parsedRun.model.version}`,
    status: "succeeded",
    verdictStatus: "not_evaluated",
    source: "observed",
    completedAt: parsedRun.completedAt,
    passedRequirements: 0,
    failedRequirements: 0,
    unresolvedRequirements: 0,
    description: "Generic Modelica scenario simulation evidence.",
    stages: [],
    measurements: parsedRun.metrics.map((q) => ({
      id: q.id,
      label: q.id,
      value: { value: q.value, unit: q.unit, display: `${q.value} ${q.unit}` },
    })),
    provenance: [],
    warnings: [...parsedRun.warnings],
    requirements: [],
    evidence: parsedRun.artifacts.map((a, index) => ({
      id: `modelica:${parsedRun.runId}:${a.kind}:${index}`,
      kind: mapRunArtifactKind(a.kind) as EvidenceArtifact["kind"],
      label: a.uri.split("/").pop() || a.kind,
      path: a.uri,
      sha256: a.fingerprint.digest,
      bytes: a.bytes,
    })),
    modelicaEvidence: {
      runId: parsedRun.runId,
      fingerprint: parsedRun.fingerprint.digest,
      model: {
        id: parsedRun.model.id,
        version: parsedRun.model.version,
        sha256: parsedRun.model.fingerprint.digest,
      },
      scenario: {
        id: parsedRun.scenario.id,
        sha256: parsedRun.scenario.fingerprint.digest,
      },
    },
  };
}

/**
 * Map a provider artifact kind (underscore form) to the EvidenceArtifact kind
 * (hyphen form).  The sole divergence is resolved_parameters → resolved-parameters;
 * all other kinds are identity.
 */
function mapRunArtifactKind(kind: string): string {
  return kind === "resolved_parameters" ? "resolved-parameters" : kind;
}

function assertCompleted(
  project: EngineeringProjectSnapshot,
  command: SimulateRunModelicaScenarioRunExecutorCommand,
): void {
  const run = project.agentRuns.find((r) => r.id === command.runId);
  if (
    !run ||
    run.status !== "completed" ||
    !project.commandReceipts?.some(
      (receipt) => receipt.commandId === stepId(command.commandId, "complete"),
    )
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Run ${command.runId} did not complete through this exact execution command.`,
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
    (value as { subjectId?: string }).subjectId === basis.subjectId
  );
}

function sameEvidenceRefs(
  a: readonly EngineeringThreadEntityRef[],
  b: readonly EngineeringThreadEntityRef[],
): boolean {
  if (a.length !== b.length) return false;
  return deterministicJson(a) === deterministicJson(b);
}

function stepId(commandId: string, step: string): string {
  return `${commandId}:simulate-modelica-scenario:${step}`;
}

function safeNow(now: () => string): string {
  const value = now();
  return Number.isNaN(Date.parse(value)) ? new Date().toISOString() : value;
}

function slug(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function errorMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
