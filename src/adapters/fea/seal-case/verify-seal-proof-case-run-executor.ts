/**
 * Trusted executor for `verify.seal-proof-case@1`.
 *
 * WHY NO PROVIDER CALL — this operation seals the human-reviewed mechanical
 * proof case declaration into the thread without executing any FEA simulation.
 * The resulting "document" artifact becomes the execution mandate that
 * `verify.run-fea-static-proof@1` (Op 2) will consume as its signed authority.
 * All effects are idempotent CAS writes to the local filesystem; no WAL is
 * needed because no uncertain provider state can arise from a read + hash +
 * persist sequence.
 *
 * WHY riskClass consequential — the seal creates the authority that authorises
 * an FEA dispatch. A forged or replayed seal would allow an unapproved case to
 * drive provider dispatch. Requiring a human MRTR at this gate, not only at the
 * run gate, ensures the human reviews the full case identity before any bytes
 * reach the solver.
 *
 * Sequence:
 *  1. Agent-only origin gate.
 *  2. requireShape: operation id / version check.
 *  3. requireMrtrApproval: find the sole human-approved decision for this run.
 *  4. Parse fea.proof.* from the proposal parameters; reopen the exact signed
 *     source capture; recross the unique current tip; compute
 *     canonicalProofText + proofDigest; assert MRTR-signed proofDigest matches
 *     the computed one; cross-check every field. Never catalog.read or caseId.
 *  5. Project / subject / authorization guards.
 *  6. Lease threadWriteBasisLeaseScope.
 *  7. Inside lease — pre-claim checks (in order):
 *     assertThreadWriteBasisAvailable; load basisSnapshot;
 *     assertThreadSnapshotLineageIntact;
 *     assertProofCaseArtifactNotRemoved (ancestors, by subjectId + proofDigest);
 *     assertReviewBasisDescendantOrEqual.
 *  8. claimRun.
 *  9. Re-read project; re-check shape + claimed status.
 * 10. Geometry: verify artifact identity in basis; re-read signed capture; check
 *     target.modelElementId ∈ partDefinitions[].elementId (PartDefinition only);
 *     verify STEP fingerprint; resolve STEP artifact + read via CanonicalAssetReader;
 *     verify hash AND bytes.
 * 11. Requirements: requireRequirementsTip (signed capture → containerComponent →
 *     active tip == MRTR-signed requirementsArtifact); follow seed chain;
 *     verify editingContextId; check proof/capture requirement consistency.
 * 12. Build capture record {schemaVersion, operation, trustedRunId, proofDigest,
 *     canonicalProofText, geometryArtifact, stepArtifact, requirementsArtifact,
 *     requirementsElementId, seedIdentity, sealedAt = requiredStart(run)};
 *     sha256Fingerprint; CAS save + readback.
 * 13. Build thread extension: one "document" artifact (id fea-proof-<captureFp>,
 *     version = proofDigest — cliquet key, uri casys://fea-proof-case-capture/…),
 *     plus three full triplets (consumption verified + derived_from + uses) for
 *     each of {geometry, requirements, STEP};
 *     applyThreadSnapshotExtensionIfNew; validateThreadSnapshot.
 * 14. ThreadSnapshot save + CAS readback.
 * 15. publishRun + completeRun + assertCompleted.
 * 16. Idempotent replay: a completed run returns the project directly.
 */

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
import type { TechnicalCompilationAdmissionReader } from "../../../application/ports/out/compile/admission/technical-compilation-admission-reader.ts";
import { COMPILE_SEAL_ADMISSION_PRODUCER_TOOL } from "../../../domain/compile/admission/technical-compilation-proposal.ts";
import type { FeaProofCaseSourceCaptureReader } from "../../../application/ports/out/fea/seal-case/fea-proof-case-source-capture-reader.ts";
import type {
  EngineeringAgentRun,
  EngineeringApproval,
  EngineeringDecision,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotBasis,
} from "../../../domain/project/engineering-project.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import { parseSysonModelSeedCapture } from "../../../domain/architecture/seed/syson-model-seed.ts";
import { FEA_PROOF_CASE_CAPTURE_SCHEMA } from "../../../domain/fea/seal-case/fea-proof-case-capture.ts";
import {
  canonicalProofText,
  type FeaProofDecisionParameters,
  feaProofDecisionParametersToMap,
  parseFeaProofDecisionParameters,
  VERIFY_SEAL_PROOF_CASE_OPERATION,
  verifyFeaProofParametersMatchCase,
} from "../../../domain/fea/seal-case/fea-proof-proposal.ts";
import type { MechanicalProofCase } from "../../../domain/fea/seal-case/mechanical-proof-case.ts";
import { recrossMechanicalProofCaseFromSource } from "../../../application/use-cases/fea/seal-case/compile-fea-proof-from-source.ts";
import { selectCurrentThreadTip } from "../../../domain/project/thread-tip.ts";
import { buildMechanicalProofCaseAnalysisGraph } from "../../../domain/fea/seal-case/mechanical-proof-case-analysis-graph.ts";
import {
  compileSensitivityCatalogOfferFromAdmission,
  SENSITIVITY_CATALOG_OFFER_CAPTURE_SCHEMA,
} from "../../../domain/sensitivity/study/sensitivity-catalog-from-proof.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadEntityKind,
  ThreadProvenanceLink,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import {
  applyThreadSnapshotExtensionIfNew,
  type ThreadSnapshotExtension,
} from "../../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import type { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";
import {
  assertThreadSnapshotLineageIntact,
  threadSnapshotDescendsFrom,
} from "../../shared/stores/thread-snapshot-lineage.ts";
import type { EngineeringProjectRunLease } from "../../shared/stores/file-engineering-project-run-lease.ts";
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
import type { CanonicalAssetReader } from "../../../application/ports/out/canonical-asset-reader.ts";
import { admitFeaProofSealSource } from "../../../application/use-cases/fea/seal-case/fea-proof-seal-source-admission.ts";
import {
  REQUIREMENTS_CAPTURE_SCHEMA,
  requireRequirementsTip,
} from "../../architecture/requirements/model-write-requirements-run-executor.ts";

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Re-exported so server.ts and the registry import from one canonical location. */
export { VERIFY_SEAL_PROOF_CASE_OPERATION };

/** Schema version written into every fea-proof-case capture envelope. */
export { FEA_PROOF_CASE_CAPTURE_SCHEMA };

/**
 * Shared URI prefix for all FEA proof case capture artifacts.
 *
 * Used by the executor (to build the artifact URI) and by the cliquet
 * (to identify FEA proof case artifacts in ancestor snapshots). Must remain
 * stable — changing it would invalidate URIs already written in immutable
 * proof files.
 */
export const FEA_PROOF_CASE_CAPTURE_URI_PREFIX =
  "casys://fea-proof-case-capture/" as const;

/**
 * The descriptor lives in file-capture-store.ts (the canonical home for every
 * capture family — a second definition would drift). Re-exported here so the
 * executor's callers keep a single import site.
 */
export { FEA_PROOF_CASE_CAPTURE_DESCRIPTOR } from "../../shared/cas/file-capture-store.ts";

// ---------------------------------------------------------------------------
// Public error classes
// ---------------------------------------------------------------------------

/**
 * Raised when a successor basis has lost a proof case artifact that appeared
 * in an ancestor.
 *
 * MONOTONY RATCHET — once a thread carries a sealed proof case artifact for a
 * given (subjectId, proofDigest) pair, every later revision must also carry it.
 * Silently dropping it would make Op 2 (verify.run-fea-static-proof@1) unable
 * to verify the signed mandate.
 */
export class ProofCaseArtifactRemovedError extends Error {
  constructor(subjectId: string, proofDigest: string) {
    super(
      `proof_case_artifact_removed: The thread for "${subjectId}" previously ` +
        `carried a sealed proof-case artifact (proofDigest: ${
          proofDigest.slice(0, 16)
        }…) ` +
        "that is absent from the current basis. This is a monotony-ratchet " +
        "violation; the artifact must not be removed once published.",
    );
    this.name = "ProofCaseArtifactRemovedError";
  }
}

/**
 * Raised when the ancestor traversal cannot be completed cleanly, requiring
 * human review before a seal can proceed.
 */
export class ProofCaseLineageReviewRequiredError extends Error {
  constructor(detail: string) {
    super(`proof_case_lineage_review_required: ${detail}`);
    this.name = "ProofCaseLineageReviewRequiredError";
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface VerifySealProofCaseRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface VerifySealProofCaseRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore;
  readonly proofCaseCaptures: FileCaptureStore<"fea-proof-case">;
  readonly sensitivityCatalogOffers?: FileCaptureStore<"sensitivity-catalog-offer">;
  readonly admissions?: TechnicalCompilationAdmissionReader;
  readonly geometryCaptures: FileCaptureStore<"geometry-capture">;
  readonly requirementsCaptures: FileCaptureStore<"requirements-capture">;
  readonly seedCaptures: FileCaptureStore<"syson-model-seed">;
  readonly canonicalAssetReader: CanonicalAssetReader;
  readonly lease: EngineeringProjectRunLease;
  /** Exact captured source CAS; never a catalog id or filesystem path. */
  readonly proofCaseSources: FeaProofCaseSourceCaptureReader;
}

// ---------------------------------------------------------------------------
// Public: executor
// ---------------------------------------------------------------------------

export class VerifySealProofCaseRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: EngineeringProjectCommandService;
  readonly #snapshots: ThreadSnapshotStore;
  readonly #proofCaseCaptures: FileCaptureStore<"fea-proof-case">;
  readonly #sensitivityCatalogOffers:
    | FileCaptureStore<"sensitivity-catalog-offer">
    | undefined;
  readonly #admissions: TechnicalCompilationAdmissionReader | undefined;
  readonly #geometryCaptures: FileCaptureStore<"geometry-capture">;
  readonly #requirementsCaptures: FileCaptureStore<"requirements-capture">;
  readonly #seedCaptures: FileCaptureStore<"syson-model-seed">;
  readonly #canonicalAssetReader: CanonicalAssetReader;
  readonly #lease: EngineeringProjectRunLease;
  readonly #proofCaseSources: FeaProofCaseSourceCaptureReader;

  constructor(deps: VerifySealProofCaseRunExecutorDependencies) {
    this.#projects = deps.projects;
    this.#commands = deps.commands;
    this.#snapshots = deps.snapshots;
    this.#proofCaseCaptures = deps.proofCaseCaptures;
    this.#sensitivityCatalogOffers = deps.sensitivityCatalogOffers;
    this.#admissions = deps.admissions;
    this.#geometryCaptures = deps.geometryCaptures;
    this.#requirementsCaptures = deps.requirementsCaptures;
    this.#seedCaptures = deps.seedCaptures;
    this.#canonicalAssetReader = deps.canonicalAssetReader;
    this.#lease = deps.lease;
    this.#proofCaseSources = deps.proofCaseSources;
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: VerifySealProofCaseRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    // Step 1 — agent-only origin gate.
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute the verify-seal-proof-case run.",
      );
    }

    // Step 2 — requireShape (validates operation id + version before any I/O).
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    requireShape(project, run);

    // Step 3 — MRTR approval gate.
    const { decision, proposal } = await requireMrtrApproval(project, run);

    // Step 4 — parse the flat fea.proof.* grammar from the signed proposal.
    let decisionParams: FeaProofDecisionParameters;
    try {
      decisionParams = parseFeaProofDecisionParameters(
        feaProofDecisionParametersToMap(proposal.parameters),
      );
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `FEA proof decision parameters are invalid: ${errorMessage(error)}`,
      );
    }

    const alreadyCompleted = await this.#completedFor(command);
    if (alreadyCompleted) return alreadyCompleted;

    // Steps 4b–4c — reopen the exact signed source, recross the unique current
    // tip, compute digest, and cross-check every MRTR field.
    const { validatedCase, proofText, proofDigest } = await this
      .#loadAndVerifyCase(project, run, decisionParams);

    // Step 5 — project / subject / authorization guards.
    const basis = requireBasis(run);
    if (validatedCase.project.id !== command.projectId) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Proof case project.id "${validatedCase.project.id}" does not match ` +
          `command projectId "${command.projectId}".`,
      );
    }
    if (validatedCase.project.subjectId !== basis.subjectId) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Proof case project.subjectId "${validatedCase.project.subjectId}" ` +
          `does not match run basis subjectId "${basis.subjectId}".`,
      );
    }

    // Authorization: proof.authorization.decisionId must be a declared approved
    // decision in the run's work item. requireMrtrApproval already validated the
    // human approval; this guard checks the proof case commits to that decision.
    const runWorkItem = project.workItems.find(
      (w) => w.id === run.workItemId,
    );
    if (!runWorkItem) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Work item for run ${run.id} not found.`,
      );
    }
    if (validatedCase.authorization.workItemId !== run.workItemId) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Proof case authorization.workItemId "${validatedCase.authorization.workItemId}" does not match the run work item "${run.workItemId}".`,
      );
    }
    if (
      !runWorkItem.decisionIds.includes(validatedCase.authorization.decisionId)
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Proof case authorization.decisionId "${validatedCase.authorization.decisionId}" is not declared in the run's work item decision list.`,
      );
    }
    const authDecision = project.decisions.find(
      (d) =>
        d.id === validatedCase.authorization.decisionId &&
        d.status === "approved",
    );
    if (!authDecision) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Proof case authorization.decisionId "${validatedCase.authorization.decisionId}" is not an approved decision in this project.`,
      );
    }

    // Step 6 — serialise concurrent seals for the same basis via the
    // thread-write basis lease.
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
          proofText,
          proofDigest,
        ),
    );
  }

  // ── Private: leased execution ──────────────────────────────────────────────

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: VerifySealProofCaseRunExecutorCommand,
    _decision: EngineeringDecision,
    decisionParams: FeaProofDecisionParameters,
    validatedCase: MechanicalProofCase,
    proofText: string,
    proofDigest: string,
  ): Promise<EngineeringProjectSnapshot> {
    let snapshotPersisted = false;
    let claimed = false;

    try {
      // Post-lease shape re-check and idempotent replay short-circuit.
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
      await assertProofCaseArtifactNotRemoved(
        basisSnapshot,
        basis.subjectId,
        proofDigest,
        this.#snapshots,
      );
      await assertReviewBasisDescendantOrEqual(
        basisSnapshot,
        validatedCase.project.baseThreadSnapshot,
        this.#snapshots,
      );

      // Step 8 — claimRun (durable start timestamp is stamped here).
      await this.#commands.claimRun(origin, {
        ...command,
        commandId: commandStep(command.commandId, "claim"),
        summary: "Started the verify-seal-proof-case run.",
      });
      claimed = true;

      // Step 9 — re-read; re-check shape + claimed status.
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

      // sealedAt is the durable start timestamp for the seal.
      const sealedAt = requiredStart(run);
      const currentBasis = requireBasis(run);
      const currentBasisSnapshot = await exactBasisSnapshot(
        this.#snapshots,
        currentBasis,
      );

      // Step 10 — geometry verification.
      const {
        geometryArtifact,
        stepArtifact,
        stepBytes,
      } = await this.#verifyGeometry(
        currentBasisSnapshot,
        decisionParams,
      );

      // Step 11 — requirements verification.
      const {
        requirementsArtifact,
        requirementsElementId,
        seedIdentity,
      } = await this.#verifyRequirements(
        currentBasisSnapshot,
        decisionParams,
        validatedCase,
      );
      const sensitivityCatalog = await this.#sealSensitivityCatalogOffer({
        projectId: command.projectId,
        basis: currentBasis,
        snapshot: currentBasisSnapshot,
        decisionParams,
        proofCase: validatedCase,
        proofDigest,
        trustedRunId: run.id,
        sealedAt,
      });

      // Step 12 — build capture record; sha256Fingerprint; CAS save.
      const captureRecord = {
        schemaVersion: FEA_PROOF_CASE_CAPTURE_SCHEMA,
        operation: VERIFY_SEAL_PROOF_CASE_OPERATION,
        trustedRunId: run.id,
        proofDigest,
        canonicalProofText: proofText,
        geometryArtifact: {
          id: geometryArtifact.id,
          fingerprint: geometryArtifact.fingerprint,
          producerRunId: geometryArtifact.producer.runId,
        },
        stepArtifact: {
          id: stepArtifact.id,
          fingerprint: stepArtifact.fingerprint,
          producerRunId: stepArtifact.producer.runId,
          bytes: stepBytes,
        },
        requirementsArtifact: {
          id: requirementsArtifact.id,
          fingerprint: requirementsArtifact.fingerprint,
          producerRunId: requirementsArtifact.producer.runId,
        },
        requirementsElementId,
        seedIdentity,
        sealedAt,
      };
      const captureFp = await sha256Fingerprint(captureRecord);
      const captureText = deterministicJson(captureRecord);

      await this.#proofCaseCaptures.save(captureFp, captureText);

      // CAS readback.
      const readBack = await this.#proofCaseCaptures.read(captureFp);
      if (readBack !== captureText) {
        throw new Error(
          "FEA proof case capture was not durably readable after save.",
        );
      }

      // Step 13 — thread extension.
      const captureUri = this.#proofCaseCaptures.uriFor(captureFp);
      const artifactId = `fea-proof-${captureFp.digest}`;
      const operationRef = {
        serverId: "digital-thread",
        tool:
          `${VERIFY_SEAL_PROOF_CASE_OPERATION.id}@${VERIFY_SEAL_PROOF_CASE_OPERATION.version}`,
        runId: run.id,
      };

      const artifact: ThreadArtifact = {
        id: artifactId,
        name: `FEA proof case seal: ${validatedCase.id} r${validatedCase.revision}`,
        kind: "document" as const,
        // proofDigest is the stable cliquet key (same proof == same proofDigest,
        // regardless of which seal attempt produced the capture).
        version: proofDigest,
        fingerprint: captureFp,
        uri: captureUri,
        mediaType: "application/json",
        producer: operationRef,
        inputArtifactIds: [
          geometryArtifact.id,
          requirementsArtifact.id,
          stepArtifact.id,
        ],
        freshness: {
          status: "fresh" as const,
          changedAt: sealedAt,
          invalidatedByChangeIds: [],
        },
      };
      const sensitivityCatalogArtifact: ThreadArtifact | undefined =
        sensitivityCatalog === undefined ? undefined : {
          id:
            `sensitivity-catalog-offer-${sensitivityCatalog.captureFingerprint.digest}`,
          name:
            `Sensitivity catalog opt-in: ${validatedCase.id} r${validatedCase.revision}`,
          kind: "document",
          version: sensitivityCatalog.offerDigest,
          fingerprint: sensitivityCatalog.captureFingerprint,
          uri: sensitivityCatalog.captureUri,
          mediaType: "application/json",
          producer: operationRef,
          inputArtifactIds: [
            artifact.id,
            sensitivityCatalog.admissionArtifact.id,
          ],
          freshness: {
            status: "fresh",
            changedAt: sealedAt,
            invalidatedByChangeIds: [],
          },
        };

      // Three full triplets: {consumption verified + derived_from + uses}
      // for each of {geometry, requirements, STEP}.

      const geomConsumptionId =
        `consume-geometry-${geometryArtifact.id}-by-${artifactId}`;
      const reqConsumptionId =
        `consume-requirements-${requirementsArtifact.id}-by-${artifactId}`;
      const stepConsumptionId = `consume-step-${stepArtifact.id}-by-${artifactId}`;

      const consumptions: ThreadArtifactConsumption[] = [
        {
          id: geomConsumptionId,
          artifactId: geometryArtifact.id,
          consumer: operationRef,
          observedFingerprint: geometryArtifact.fingerprint,
          verifiedAt: sealedAt,
          status: "verified",
        },
        {
          id: reqConsumptionId,
          artifactId: requirementsArtifact.id,
          consumer: operationRef,
          observedFingerprint: requirementsArtifact.fingerprint,
          verifiedAt: sealedAt,
          status: "verified",
        },
        {
          id: stepConsumptionId,
          artifactId: stepArtifact.id,
          consumer: operationRef,
          observedFingerprint: stepArtifact.fingerprint,
          verifiedAt: sealedAt,
          status: "verified",
        },
      ];
      if (sensitivityCatalogArtifact && sensitivityCatalog) {
        consumptions.push({
          id: `consume-proof-${artifact.id}-by-${sensitivityCatalogArtifact.id}`,
          artifactId: artifact.id,
          consumer: operationRef,
          observedFingerprint: artifact.fingerprint,
          verifiedAt: sealedAt,
          status: "verified",
        }, {
          id:
            `consume-admission-${sensitivityCatalog.admissionArtifact.id}-by-${sensitivityCatalogArtifact.id}`,
          artifactId: sensitivityCatalog.admissionArtifact.id,
          consumer: operationRef,
          observedFingerprint: sensitivityCatalog.admissionArtifact.fingerprint,
          verifiedAt: sealedAt,
          status: "verified",
        });
      }

      const provenance: ThreadProvenanceLink[] = [
        // Geometry: derived_from + uses
        {
          id: `derived-from-geometry-${captureFp.digest}`,
          relation: "derived_from" as const,
          from: { kind: "artifact" as const, id: artifactId },
          to: { kind: "artifact" as const, id: geometryArtifact.id },
          rationale:
            "The FEA proof case seal derives its geometry identity from the exact reviewed geometry capture.",
        },
        {
          id: `uses-${geomConsumptionId}`,
          relation: "uses" as const,
          from: { kind: "consumption" as const, id: geomConsumptionId },
          to: { kind: "artifact" as const, id: geometryArtifact.id },
          rationale:
            "The executor re-read the signed geometry capture to verify the target element and STEP fingerprint.",
        },
        // Requirements: derived_from + uses
        {
          id: `derived-from-requirements-${captureFp.digest}`,
          relation: "derived_from" as const,
          from: { kind: "artifact" as const, id: artifactId },
          to: { kind: "artifact" as const, id: requirementsArtifact.id },
          rationale:
            "The FEA proof case seal derives its oracle requirements from the exact active requirements tip.",
        },
        {
          id: `uses-${reqConsumptionId}`,
          relation: "uses" as const,
          from: { kind: "consumption" as const, id: reqConsumptionId },
          to: { kind: "artifact" as const, id: requirementsArtifact.id },
          rationale:
            "The executor re-read the signed requirements capture to verify the target element, oracle requirements consistency, and seed identity.",
        },
        // STEP: derived_from + uses
        {
          id: `derived-from-step-${captureFp.digest}`,
          relation: "derived_from" as const,
          from: { kind: "artifact" as const, id: artifactId },
          to: { kind: "artifact" as const, id: stepArtifact.id },
          rationale:
            "The FEA proof case seal derives its exact STEP identity from the authoritative STEP artifact read by content address.",
        },
        {
          id: `uses-${stepConsumptionId}`,
          relation: "uses" as const,
          from: { kind: "consumption" as const, id: stepConsumptionId },
          to: { kind: "artifact" as const, id: stepArtifact.id },
          rationale:
            "The executor read and hash-verified the STEP bytes via the canonical asset reader.",
        },
      ];
      if (sensitivityCatalogArtifact && sensitivityCatalog) {
        const proofConsumption = consumptions[consumptions.length - 2]!;
        const admissionConsumption = consumptions[consumptions.length - 1]!;
        provenance.push({
          id: `derived-from-proof-${artifact.id}-by-${sensitivityCatalogArtifact.id}`,
          relation: "derived_from",
          from: { kind: "artifact", id: sensitivityCatalogArtifact.id },
          to: { kind: "artifact", id: artifact.id },
          rationale:
            "The signed sensitivity catalog offer is compiled from this exact sealed FEA proof declaration.",
        }, {
          id:
            `derived-from-admission-${sensitivityCatalog.admissionArtifact.id}-by-${sensitivityCatalogArtifact.id}`,
          relation: "derived_from",
          from: { kind: "artifact", id: sensitivityCatalogArtifact.id },
          to: {
            kind: "artifact",
            id: sensitivityCatalog.admissionArtifact.id,
          },
          rationale:
            "The signed sensitivity catalog offer derives its unique causal lever from the exact compilation admission.",
        }, {
          id: `uses-${proofConsumption.id}`,
          relation: "uses",
          from: { kind: "consumption", id: proofConsumption.id },
          to: { kind: "artifact", id: artifact.id },
          rationale:
            "The executor sealed and consumed the exact proof declaration while compiling the catalog offer.",
        }, {
          id: `uses-${admissionConsumption.id}`,
          relation: "uses",
          from: { kind: "consumption", id: admissionConsumption.id },
          to: {
            kind: "artifact",
            id: sensitivityCatalog.admissionArtifact.id,
          },
          rationale:
            "The executor reopened the signed compilation admission and recompiled the exact catalog offer.",
        });
      }

      const extensionId = `verify-seal-proof-case-${run.id}`;
      const extension: ThreadSnapshotExtension = {
        id: extensionId,
        name: `Sealed FEA proof case: ${validatedCase.id} r${validatedCase.revision}`,
        subjectId: currentBasis.subjectId,
        capturedAt: sealedAt,
        artifacts: [
          artifact,
          ...(sensitivityCatalogArtifact ? [sensitivityCatalogArtifact] : []),
        ],
        consumptions,
        observations: [],
        requirements: [],
        evaluations: [],
        violations: [],
        provenance,
        proposedActions: [],
        analysisGraph: buildMechanicalProofCaseAnalysisGraph({
          proofCase: validatedCase,
          proofFingerprint: { algorithm: "sha256", digest: proofDigest },
          evidence: { id: artifact.id, fingerprint: artifact.fingerprint },
        }),
      };

      const applied = applyThreadSnapshotExtensionIfNew(
        currentBasisSnapshot,
        extension,
        { appliedAt: sealedAt },
      );
      if (!applied.applied) {
        throw new Error(
          "FEA proof case snapshot extension was already present — " +
            "this exact evidence was published in a prior revision.",
        );
      }
      const snapshot = applied.snapshot;
      validateThreadSnapshot(snapshot);

      // Step 14 — ThreadSnapshot save + CAS readback.
      await this.#snapshots.save(snapshot);
      const savedSnapshot = await this.#snapshots.get(snapshot.id);
      if (
        !savedSnapshot ||
        deterministicJson(savedSnapshot) !== deterministicJson(snapshot)
      ) {
        throw new Error(
          "FEA proof case snapshot was not durably readable after save.",
        );
      }
      snapshotPersisted = true;

      // Step 15 — publishRun + completeRun.
      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary: "Publishing the sealed FEA proof case mandate.",
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
            `Sealed FEA proof case ${validatedCase.id} r${validatedCase.revision} into the evidence thread.`,
          resultSnapshot: snapshotRef(snapshot),
          evidenceRefs: [
            {
              snapshotId: snapshot.id,
              snapshotRevision: snapshot.revision,
              kind: "artifact" as ThreadEntityKind,
              id: artifact.id,
            },
            ...(sensitivityCatalogArtifact
              ? [{
                snapshotId: snapshot.id,
                snapshotRevision: snapshot.revision,
                kind: "artifact" as ThreadEntityKind,
                id: sensitivityCatalogArtifact.id,
              }]
              : []),
          ],
        });
      } else if (run.status !== "completed") {
        throw unexpectedStatus(run, "completed");
      }

      const complete = await this.#requiredProject(command.projectId);
      assertCompleted(complete, command);
      return complete;
    } catch (error) {
      // If the snapshot is persisted but project attachment failed, a retry
      // with the same commandId will find and re-use the already-persisted
      // snapshot.
      if (snapshotPersisted) {
        const complete = await this.#completedFor(command);
        if (complete) return complete;
        const cause = error instanceof Error ? ` Cause: ${error.message}` : "";
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "FEA proof case evidence is durable but project attachment did not " +
            `finish. Retry this exact command; it will re-use the persisted snapshot.${cause}`,
        );
      }
      if (claimed) await this.#recordFailure(origin, command);
      throw error;
    }
  }

  // ── Private: case loading + verification ───────────────────────────────────

  async #loadAndVerifyCase(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    decisionParams: FeaProofDecisionParameters,
  ): Promise<{
    validatedCase: MechanicalProofCase;
    proofText: string;
    proofDigest: string;
  }> {
    let reopened;
    try {
      reopened = await this.#proofCaseSources.reopen({
        fingerprint: decisionParams.sourceFingerprint,
      });
    } catch (error) {
      const code = error !== null && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
      throw new EngineeringProjectCommandError(
        "invalid_input",
        code === "source_absent"
          ? "The signed proof-case source is absent from draft CAS."
          : `The signed proof-case source could not be reopened: ${
            errorMessage(error)
          }`,
      );
    }
    if (reopened.reference.fingerprint !== decisionParams.sourceFingerprint) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The signed caseRef fingerprint does not match the reopened source capture.",
      );
    }

    const current = selectCurrentThreadTip(project.threadSnapshots);
    if (current.status !== "ok") {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `The unique current Thread tip could not be selected: ${current.diagnostic.message}`,
      );
    }
    const basis = requireBasis(run);
    if (
      current.basis.snapshotId !== basis.snapshotId ||
      current.basis.revision !== basis.revision ||
      current.basis.subjectId !== basis.subjectId
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `The run basis is not the unique current Thread tip (${current.basis.snapshotId} r${current.basis.revision}). The signed proof source cannot be recrossed against a stale tip.`,
      );
    }
    const snapshot = await this.#snapshots.get(basis.snapshotId);
    if (!snapshot) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The unique current Thread tip snapshot is unavailable.",
      );
    }

    const recrossed = await recrossMechanicalProofCaseFromSource({
      source: reopened.source,
      projectId: project.project.id,
      snapshot,
      geometryCaptures: this.#geometryCaptures,
      stepAssets: this.#canonicalAssetReader,
    });
    if (recrossed.status !== "ok") {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        recrossed.diagnostics.map((item) => item.message).join(" ") ||
          "The captured proof source could not be recrossed against the current Thread tip.",
      );
    }
    const validatedCase = recrossed.proofCase;
    if (validatedCase.id !== decisionParams.id) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Recrossed proof case id "${validatedCase.id}" does not match the signed MRTR id "${decisionParams.id}".`,
      );
    }
    if (validatedCase.authorization.workItemId !== run.workItemId) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Derived workItemId "${validatedCase.authorization.workItemId}" does not match the run work item "${run.workItemId}".`,
      );
    }

    const proofText = canonicalProofText(validatedCase);
    const proofFp = await sha256Fingerprint(validatedCase);
    const proofDigest = proofFp.digest;

    if (decisionParams.proofDigest !== proofDigest) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Proof case digest divergence: the MRTR signed proofDigest ` +
          `"${decisionParams.proofDigest.slice(0, 16)}…" does not match the ` +
          `computed digest "${
            proofDigest.slice(0, 16)
          }…" of case "${validatedCase.id}".`,
      );
    }

    try {
      verifyFeaProofParametersMatchCase(decisionParams, validatedCase);
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `FEA proof MRTR parameters diverge from the recrossed case: ${
          errorMessage(error)
        }`,
      );
    }

    return { validatedCase, proofText, proofDigest };
  }

  async #sealSensitivityCatalogOffer(input: {
    readonly projectId: string;
    readonly basis: EngineeringThreadSnapshotBasis;
    readonly snapshot: ThreadSnapshot;
    readonly decisionParams: FeaProofDecisionParameters;
    readonly proofCase: MechanicalProofCase;
    readonly proofDigest: string;
    readonly trustedRunId: string;
    readonly sealedAt: string;
  }): Promise<
    | {
      readonly offerDigest: string;
      readonly captureFingerprint: ContentFingerprint;
      readonly captureUri: string;
      readonly admissionArtifact: ThreadArtifact;
    }
    | undefined
  > {
    const signed = input.decisionParams.sensitivityCatalog;
    if (signed === undefined) return undefined;
    if (!this.#admissions || !this.#sensitivityCatalogOffers) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "Sensitivity catalog opt-in is signed, but the executor has no admission reader or catalog-offer capture store.",
      );
    }
    const admissionArtifact = input.snapshot.artifacts.find((artifact) =>
      artifact.id === signed.admissionArtifact.id
    );
    if (
      !admissionArtifact ||
      admissionArtifact.kind !== "document" ||
      admissionArtifact.producer.tool !== COMPILE_SEAL_ADMISSION_PRODUCER_TOOL ||
      !fingerprintsEqual(
        admissionArtifact.fingerprint,
        signed.admissionArtifact.fingerprint,
      )
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The signed sensitivity catalog admission artifact is absent or has drifted.",
      );
    }
    let reopened;
    try {
      reopened = await this.#admissions.read({
        projectId: input.projectId,
        basis: input.basis,
        artifactId: admissionArtifact.id,
        artifactFingerprint: admissionArtifact.fingerprint,
      });
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `The signed sensitivity catalog admission could not be reopened: ${
          errorMessage(error)
        }`,
      );
    }
    if (!reopened) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The signed sensitivity catalog admission is unavailable.",
      );
    }
    const offer = compileSensitivityCatalogOfferFromAdmission({
      proofCase: input.proofCase,
      proofDigest: input.proofDigest,
      admissionArtifact: {
        id: admissionArtifact.id,
        fingerprint: admissionArtifact.fingerprint,
      },
      document: reopened.document,
    });
    if (offer.status !== "ready-for-opt-in") {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `The signed sensitivity catalog offer no longer compiles: ${offer.status}.`,
      );
    }
    const offerFingerprint = await sha256Fingerprint(offer);
    if (offerFingerprint.digest !== signed.digest) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The recompiled sensitivity catalog offer does not match the human-signed digest.",
      );
    }
    const captureRecord = {
      schemaVersion: SENSITIVITY_CATALOG_OFFER_CAPTURE_SCHEMA,
      operation: VERIFY_SEAL_PROOF_CASE_OPERATION,
      trustedRunId: input.trustedRunId,
      sealedAt: input.sealedAt,
      offerDigest: offerFingerprint.digest,
      offer,
    };
    const captureFingerprint = await sha256Fingerprint(captureRecord);
    const captureText = deterministicJson(captureRecord);
    const saved = await this.#sensitivityCatalogOffers.save(
      captureFingerprint,
      captureText,
    );
    const readBack = await this.#sensitivityCatalogOffers.read(captureFingerprint);
    if (readBack !== captureText) {
      throw new Error(
        "Sensitivity catalog offer was not durably readable after save.",
      );
    }
    return {
      offerDigest: offerFingerprint.digest,
      captureFingerprint,
      captureUri: saved.uri,
      admissionArtifact,
    };
  }

  // ── Private: geometry verification ────────────────────────────────────────

  async #verifyGeometry(
    basisSnapshot: ThreadSnapshot,
    decisionParams: FeaProofDecisionParameters,
  ): Promise<{
    geometryArtifact: ThreadArtifact;
    stepArtifact: ThreadArtifact;
    stepBytes: number;
  }> {
    const admitted = await admitFeaProofSealSource({
      snapshot: basisSnapshot,
      decisionParams,
      geometryCaptures: this.#geometryCaptures,
      stepAssets: this.#canonicalAssetReader,
    });
    if (admitted.status !== "admitted") {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        admitted.diagnostic.message,
      );
    }
    return {
      geometryArtifact: admitted.geometryArtifact,
      stepArtifact: admitted.stepArtifact,
      stepBytes: admitted.stepBytes,
    };
  }

  // ── Private: requirements verification ────────────────────────────────────

  async #verifyRequirements(
    basisSnapshot: ThreadSnapshot,
    decisionParams: FeaProofDecisionParameters,
    validatedCase: MechanicalProofCase,
  ): Promise<{
    requirementsArtifact: ThreadArtifact;
    requirementsElementId: string;
    seedIdentity: {
      editingContextId: string;
      elementId: string;
    };
  }> {
    // Find the requirements artifact in the basis by MRTR-signed identity.
    const requirementsArtifact = basisSnapshot.artifacts.find(
      (a) => a.id === decisionParams.requirementsArtifact.id,
    );
    if (!requirementsArtifact) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Requirements artifact "${decisionParams.requirementsArtifact.id}" is not ` +
          "present in the current basis snapshot.",
      );
    }
    if (
      !fingerprintsEqual(
        requirementsArtifact.fingerprint,
        decisionParams.requirementsArtifact.fingerprint,
      )
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Requirements artifact fingerprint does not match the MRTR-signed value.",
      );
    }

    // Re-read the signed requirements capture by content-address.
    const reqCaptureText = await this.#requirementsCaptures.read(
      requirementsArtifact.fingerprint,
    );
    if (!reqCaptureText) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Requirements capture ${
          requirementsArtifact.fingerprint.digest.slice(0, 16)
        }… is not readable.`,
      );
    }

    let reqCaptureRecord: unknown;
    try {
      reqCaptureRecord = JSON.parse(reqCaptureText);
    } catch {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Requirements capture is not valid JSON.",
      );
    }

    if (
      !reqCaptureRecord ||
      typeof reqCaptureRecord !== "object" ||
      Array.isArray(reqCaptureRecord) ||
      (reqCaptureRecord as Record<string, unknown>).schemaVersion !==
        REQUIREMENTS_CAPTURE_SCHEMA
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Requirements capture has unexpected schema: "${
          (reqCaptureRecord as Record<string, unknown>)?.schemaVersion
        }".`,
      );
    }

    const reqRecord = reqCaptureRecord as Record<string, unknown>;

    // Get containerComponent from the capture.
    const containerComponent = reqRecord.containerComponent;
    if (typeof containerComponent !== "string" || !containerComponent) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Requirements capture has no valid containerComponent.",
      );
    }

    // Verify the capture target matches the proof target.
    const captureTarget = reqRecord.target as Record<string, unknown> | undefined;
    if (
      !captureTarget || captureTarget.elementId !== decisionParams.target.modelElementId
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Requirements capture target element "${captureTarget?.elementId}" ` +
          `does not match proof target.modelElementId "${decisionParams.target.modelElementId}".`,
      );
    }

    // Authoritative tip selection: the active tip must match the MRTR-signed
    // requirementsArtifact.{id,fingerprint}. requireRequirementsTip throws on
    // ambiguity (EngineeringProjectCommandError), returns undefined when absent.
    const tip = requireRequirementsTip(basisSnapshot, containerComponent);
    if (!tip) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `No active requirements artifact found for component "${containerComponent}" ` +
          "in the basis snapshot. The requirements tip may be retired or absent.",
      );
    }
    if (
      tip.id !== decisionParams.requirementsArtifact.id ||
      !fingerprintsEqual(
        tip.fingerprint,
        decisionParams.requirementsArtifact.fingerprint,
      )
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Active requirements tip "${tip.id}" (${
          tip.fingerprint.digest.slice(0, 16)
        }…) does not match MRTR-signed requirementsArtifact ` +
          `"${decisionParams.requirementsArtifact.id}" (${
            decisionParams.requirementsArtifact.fingerprint.digest.slice(0, 16)
          }…).`,
      );
    }

    // Follow the chain: requirements capture → seed; verify editingContextId.
    const captureSeed = reqRecord.seed as Record<string, unknown> | undefined;
    if (
      !captureSeed ||
      typeof captureSeed.artifactId !== "string" ||
      !captureSeed.artifactId ||
      typeof captureSeed.producerRunId !== "string" ||
      !captureSeed.producerRunId
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Requirements capture seed identity is missing or incomplete.",
      );
    }
    const captureSeedFp = captureSeed.fingerprint as
      | Record<string, unknown>
      | undefined;
    if (
      !captureSeedFp ||
      captureSeedFp.algorithm !== "sha256" ||
      typeof captureSeedFp.digest !== "string"
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Requirements capture seed fingerprint is missing or invalid.",
      );
    }
    const seedFingerprint: ContentFingerprint = {
      algorithm: captureSeedFp.algorithm as "sha256",
      digest: captureSeedFp.digest,
    };

    // Read the seed capture.
    const seedCaptureText = await this.#seedCaptures.read(seedFingerprint);
    if (!seedCaptureText) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Seed capture ${seedFingerprint.digest.slice(0, 16)}… is not readable.`,
      );
    }

    let seedCaptureRaw: unknown;
    try {
      seedCaptureRaw = JSON.parse(seedCaptureText);
    } catch {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Seed capture is not valid JSON.",
      );
    }

    let seedCapture;
    try {
      seedCapture = parseSysonModelSeedCapture(seedCaptureRaw);
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Seed capture failed validation: ${errorMessage(error)}`,
      );
    }

    const editingContextId = seedCapture.normalizedResults.project.editingContextId;
    if (editingContextId !== decisionParams.requirementsSource.editingContextId) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Seed capture editingContextId "${editingContextId}" does not match ` +
          `MRTR-signed requirementsSource.editingContextId ` +
          `"${decisionParams.requirementsSource.editingContextId}".`,
      );
    }

    // Verify proof requirements consistency with the capture OracleRequirements.
    // Each proof requirement must have a matching OracleRequirement in the capture
    // (matching by feature path / operator / limit).
    const captureRequirements = reqRecord.requirements;
    if (!Array.isArray(captureRequirements)) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Requirements capture has no requirements array.",
      );
    }
    const captureReqByFeature = new Map<
      string,
      { operator: string; limitValue: number; limitUnit: string }
    >();
    for (const oracleReq of captureRequirements) {
      if (
        oracleReq && typeof oracleReq === "object" &&
        typeof oracleReq.metric === "string" &&
        typeof oracleReq.operator === "string" &&
        oracleReq.limit && typeof oracleReq.limit === "object" &&
        typeof oracleReq.limit.value === "number" &&
        typeof oracleReq.limit.unit === "string"
      ) {
        captureReqByFeature.set(oracleReq.metric, {
          operator: oracleReq.operator,
          limitValue: oracleReq.limit.value,
          limitUnit: oracleReq.limit.unit,
        });
      }
    }
    for (const proofReq of validatedCase.requirements) {
      const captureReq = captureReqByFeature.get(proofReq.feature);
      if (!captureReq) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          `Proof requirement feature path "${proofReq.feature}" is not found ` +
            "among the OracleRequirements in the requirements capture.",
        );
      }
      if (
        captureReq.operator !== proofReq.operator ||
        captureReq.limitValue !== proofReq.limit.value ||
        captureReq.limitUnit !== proofReq.limit.unit
      ) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          `Proof requirement "${proofReq.feature}" operator/limit does not match ` +
            "the corresponding OracleRequirement in the requirements capture.",
        );
      }
    }

    // Get requirementsElementId from the capture.
    const requirementsElementId = reqRecord.requirementsElementId;
    if (
      typeof requirementsElementId !== "string" || !requirementsElementId
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Requirements capture has no valid requirementsElementId.",
      );
    }

    return {
      requirementsArtifact,
      requirementsElementId,
      /**
       * The run executor consumes the SysON identity (editingContextId +
       * elementId) to re-verify oracle fidelity — not the seed's CAS identity,
       * which stays reachable through the requirements-capture chain re-read on
       * every path. Both values are MRTR-signed and verified above.
       */
      seedIdentity: {
        editingContextId,
        elementId: requirementsElementId,
      },
    };
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
    command: VerifySealProofCaseRunExecutorCommand,
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
    command: VerifySealProofCaseRunExecutorCommand,
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
        summary: "Verify-seal-proof-case stopped before the snapshot was saved.",
        code: "verify-seal-proof-case-not-published",
        message:
          "The verify-seal-proof-case run stopped before the sealed snapshot was published.",
      });
    } catch {
      // Preserve the original cause.
    }
  }
}

// ---------------------------------------------------------------------------
// Private: shape + MRTR helpers
// ---------------------------------------------------------------------------

const SEAL_OP = VERIFY_SEAL_PROOF_CASE_OPERATION;

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
    project.schemaVersion !== "4.0" ||
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
      "This executor may run only the exact proof-case seal run it claimed.",
    );
  }
}

/**
 * Find the sole human-approved MRTR decision bound to this run's basis.
 *
 * Same filter logic as requireMrtrApproval in the geometry and simulation-seal
 * executors: status === "approved", exactly one human approval with matching
 * basis + fingerprints, decision fingerprint re-sealed.
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
    if (!decision?.proposal || decision.proposal.parameters.length === 0) {
      continue;
    }

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
        ? "No exact human-approved FEA proof-case MRTR decision is bound to this run basis."
        : "Ambiguous FEA proof-case MRTR: exactly one human-approved decision must be bound to this run basis.",
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
      "FEA proof-case decision input fingerprint no longer seals its exact base " +
        "snapshot, evidence references, summary, and parameters.",
    );
  }

  // Verify the run's input fingerprint against the approved decision set.
  const approvedDecisions = workItem.decisionIds.map((id) => {
    const d = project.decisions.find((candidate) => candidate.id === id);
    if (!d?.inputFingerprint) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `FEA proof-case work-item decision ${id} is not exactly approved.`,
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
      "FEA proof-case run input fingerprint no longer seals its exact MRTR decision and basis.",
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
 * Assert that the current basis has not silently removed a proof case artifact
 * that carried the given (subjectId, proofDigest) pair in an ancestor.
 *
 * WHY WALK ANCESTORS — the ratchet only fires when a *prior* revision carried
 * the artifact but the current basis does not. If no ancestor has ever sealed
 * this proofDigest, the check is a no-op. Cap at 50 ancestors to bound the
 * traversal cost; larger lineages require operator review.
 */
async function assertProofCaseArtifactNotRemoved(
  basis: ThreadSnapshot,
  subjectId: string,
  proofDigest: string,
  snapshots: ThreadSnapshotStore,
): Promise<void> {
  if (hasProofCaseArtifact(basis, proofDigest)) return;

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
      throw new ProofCaseLineageReviewRequiredError(
        `ancestor ${cursor.snapshotId}@${cursor.revision} is not resolvable or ` +
          "belongs to a different subject.",
      );
    }
    if (hasProofCaseArtifact(ancestor, proofDigest)) {
      throw new ProofCaseArtifactRemovedError(subjectId, proofDigest);
    }
    cursor = ancestor.previous;
  }
  if (cursor) {
    throw new ProofCaseLineageReviewRequiredError(
      `ancestor traversal exceeded the explicit ${MAX_ANCESTORS}-revision review bound.`,
    );
  }
}

/**
 * Return true when the snapshot carries a proof case artifact for the given
 * proofDigest. The proofDigest is stored in the artifact's version field so
 * the cliquet can match by (URI prefix, version) without reading capture files.
 */
function hasProofCaseArtifact(
  snapshot: ThreadSnapshot,
  proofDigest: string,
): boolean {
  return snapshot.artifacts.some(
    (a) =>
      a.kind === "document" &&
      a.uri?.startsWith(FEA_PROOF_CASE_CAPTURE_URI_PREFIX) &&
      a.version === proofDigest,
  );
}

// ---------------------------------------------------------------------------
// Private: reviewBasis descendant-or-equal
// ---------------------------------------------------------------------------

/**
 * Assert that the run's basis snapshot is a descendant of (or equal to) the
 * reviewBasis declared inside the mechanical proof case.
 *
 * WHY DESCENDANT-OR-EQUAL — the proof case was authored against a specific
 * thread state (baseThreadSnapshot). Running it on a basis that diverged from
 * or predates that state would mean sealing a case designed for different
 * evidence. A descendant basis is safe: evidence was only added, never removed.
 */
async function assertReviewBasisDescendantOrEqual(
  basisSnapshot: ThreadSnapshot,
  caseBase: {
    readonly id: string;
    readonly revision: number;
    readonly subjectId: string;
  },
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
      `Proof case reviewBasis snapshot ${caseBase.id}@${caseBase.revision} ` +
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
      `Run basis ${basisSnapshot.id}@${basisSnapshot.revision} is not a ` +
        `descendant of the proof case reviewBasis ${caseBase.id}@${caseBase.revision}. ` +
        "Requeue the run against the current thread head after verifying the case is still valid.",
    );
  }
}

// ---------------------------------------------------------------------------
// Private: miscellaneous helpers
// ---------------------------------------------------------------------------

function commandStep(commandId: string, step: string): string {
  return `${commandId}:verify-seal-proof-case:${step}`;
}

function assertCompleted(
  project: EngineeringProjectSnapshot,
  command: VerifySealProofCaseRunExecutorCommand,
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
      `Verify-seal-proof-case run ${command.runId} did not complete through this exact execution command.`,
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
    `${ref.snapshotId} ${ref.snapshotRevision} ${ref.kind} ${ref.id}`;
  return (
    left.length === right.length &&
    left.map(key).sort().every(
      (item, index) => item === right.map(key).sort()[index],
    )
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
