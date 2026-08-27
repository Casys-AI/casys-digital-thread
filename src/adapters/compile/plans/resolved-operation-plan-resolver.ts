/**
 * Read-only, code-owned resolver for the two recorded-operation-plan/2.0
 * verticals.  It consumes only exact immutable Thread artifacts and canonical
 * CAS bytes; it has no provider capability and performs no mutation.
 */

import {
  CALCULIX_ISOLATED_STATIC_RESOURCE_PROFILE,
  CALCULIX_RECORDED_STATIC_RESOURCE_PROFILE,
  RESOLVED_OPERATION_PLAN_V2_SCHEMA,
  resolvedOperationPlanIdForRun,
  type ResolvedOperationPlanSource,
  type ResolvedOperationPlanV2,
} from "../../../domain/compile/rop/resolved-operation-plan-v2.ts";
import type { CalculixIsolatedExecutionProfile } from "../../../application/ports/out/fea/isolated-v3/calculix-isolated-execution-profile.ts";
import { canonicalCalculixStepAssetCasUri } from "../../../domain/fea/isolated-v3/calculix-step-asset-uri.ts";
import {
  fingerprintResourceBytes,
} from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  type FeaProofCaseCapture,
  parseFeaProofCaseCapture,
} from "../../../domain/fea/seal-case/fea-proof-case-capture.ts";
import {
  type FeaProofDecisionParameters,
  feaProofDecisionParametersToMap,
  parseFeaProofDecisionParameters,
  VERIFY_SEAL_PROOF_CASE_OPERATION,
  verifyFeaProofParametersMatchCase,
} from "../../../domain/fea/seal-case/fea-proof-proposal.ts";
import { isolatedCalculixBindingRejectionMessage } from "../../../domain/fea/isolated-v3/isolated-calculix-bindings.ts";
import type { MechanicalProofCase } from "../../../domain/fea/seal-case/mechanical-proof-case.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  EngineeringAgentRun,
  EngineeringApproval,
  EngineeringDecision,
  EngineeringOperationInputBinding,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
  EngineeringWorkItem,
} from "../../../domain/project/engineering-project.ts";
import type { RegisteredRunPlanSealInput } from "../../../domain/project/resolved-run-plan-sealer.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import { archivedRefKeys } from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import { parseSensitivityCatalogOfferCapture } from "../../../domain/sensitivity/study/sensitivity-catalog-offer-capture.ts";
import type { CanonicalAssetReader } from "../../../application/ports/out/canonical-asset-reader.ts";
import type { TechnicalCompilationAdmissionReader } from "../../../application/ports/out/compile/admission/technical-compilation-admission-reader.ts";
import type {
  FeaIsolatedRunAdmissionReview,
  FeaIsolatedRunAdmissionReviewer,
} from "../../../application/ports/out/fea/isolated-v3/fea-isolated-run-admission-reviewer.ts";
import {
  VERIFY_RUN_FEA_STATIC_PROOF_V2_OPERATION,
  VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION,
} from "../../../orchestration/operations/fea-isolated-static-proof.ts";
import type { ExactThreadSnapshotReader } from "../../shared/stores/engineering-thread-snapshot-resolver.ts";
import { threadSnapshotDescendsFrom } from "../../shared/stores/thread-snapshot-lineage.ts";

const CALCULIX_OPERATION = VERIFY_RUN_FEA_STATIC_PROOF_V2_OPERATION;
const CALCULIX_LOCAL_OPERATION = VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION;
const SHA256 = /^[a-f0-9]{64}$/;
const CANONICAL_CAS_URI =
  /^casys:\/\/[a-z0-9][a-z0-9.-]{0,62}\/sha256\/([a-f0-9]{64})$/;

/**
 * The reader receives the complete immutable Thread artifact identity.  An
 * implementation may route by URI, but cannot be asked for an unbound digest
 * or a caller-selected filesystem path.
 */
export interface RecordedPlanArtifactReader {
  read(artifact: Readonly<ThreadArtifact>): Promise<Uint8Array | undefined>;
}

export interface ResolvedOperationPlanResolverOptions {
  readonly snapshots: ExactThreadSnapshotReader;
  readonly artifacts: RecordedPlanArtifactReader;
  readonly stepAssets: CanonicalAssetReader;
  /** Canonical reopen of an admission named by a signed sensitivity opt-in. */
  readonly admissions?: Pick<TechnicalCompilationAdmissionReader, "read">;
  readonly calculix?: {
    readonly elementOrder?: 1 | 2;
    readonly timeoutMs?: number;
    /** Exact server-composed profile required to seal the provider-free @3 plan. */
    readonly localProfile?: CalculixIsolatedExecutionProfile;
  };
}

export class ResolvedOperationPlanResolver implements FeaIsolatedRunAdmissionReviewer {
  readonly #elementOrder: 1 | 2;
  readonly #calculixTimeoutMs: number;

  constructor(private readonly options: ResolvedOperationPlanResolverOptions) {
    this.#elementOrder = options.calculix?.elementOrder ?? 1;
    this.#calculixTimeoutMs = options.calculix?.timeoutMs ?? 120_000;
    if (!Number.isSafeInteger(this.#calculixTimeoutMs) || this.#calculixTimeoutMs < 1) {
      throw new TypeError("CalculiX recorded-plan timeout must be a positive integer.");
    }
  }

  async resolve(input: RegisteredRunPlanSealInput): Promise<ResolvedOperationPlanV2> {
    await assertQueuedCandidate(input);
    const operation = input.workItem.operation;
    if (!operation) {
      throw new TypeError("Recorded plan requires a registered operation.");
    }
    const basis = input.run.basis;
    if (!basis || basis.kind !== "thread-snapshot") {
      throw new TypeError("Recorded plan requires an exact ThreadSnapshot run basis.");
    }
    const resolved = await this.options.snapshots.get(basis.snapshotId);
    if (
      !resolved || resolved.id !== basis.snapshotId ||
      resolved.revision !== basis.revision ||
      resolved.subject.id !== basis.subjectId
    ) {
      throw new Error(
        "Recorded plan basis is absent or does not exactly match the queued run.",
      );
    }
    const snapshot = validateThreadSnapshot(resolved);
    const authorization = await authorizationFor(input);
    const common: PlanCommon = {
      schemaVersion: RESOLVED_OPERATION_PLAN_V2_SCHEMA,
      id: resolvedOperationPlanIdForRun(input.run.id),
      run: {
        projectId: input.project.project.id,
        runId: input.run.id,
        workItemId: input.workItem.id,
        inputFingerprint: requiredFingerprint(
          input.run.inputFingerprint,
          "run.inputFingerprint",
        ),
        queueBasisProject: {
          snapshotId: input.queueBasisProject.snapshotId,
          revision: input.queueBasisProject.revision,
          fingerprint: input.queueBasisProject.fingerprint,
        },
      },
      workItem: {
        id: input.workItem.id,
        operation: { id: operation.id, version: operation.version },
        operationFingerprint: await sha256Fingerprint(operation),
      },
      authorization,
      basis: {
        kind: "thread-snapshot",
        snapshotId: snapshot.id,
        revision: snapshot.revision,
        subjectId: snapshot.subject.id,
        fingerprint: await sha256Fingerprint(snapshot),
      },
    };
    if (
      sameOperation(operation.id, operation.version, CALCULIX_OPERATION) ||
      sameOperation(operation.id, operation.version, CALCULIX_LOCAL_OPERATION)
    ) {
      return await this.#calculixPlan(input, snapshot, common);
    }
    throw new TypeError(
      "resolved-operation-plan/2.0 is not defined for this operation.",
    );
  }

  async #calculixPlan(
    input: RegisteredRunPlanSealInput,
    snapshot: ThreadSnapshot,
    common: PlanCommon,
  ): Promise<ResolvedOperationPlanV2> {
    const local = sameOperation(
      input.workItem.operation!.id,
      input.workItem.operation!.version,
      CALCULIX_LOCAL_OPERATION,
    );
    const localProfile = this.options.calculix?.localProfile;
    if (local && localProfile === undefined) {
      throw new TypeError(
        "The local CalculiX operation requires an exact server-composed isolated profile.",
      );
    }
    const bindings = exactBindings(input.workItem.operation!.bindings, [
      "proofCase",
      "geometry",
    ], snapshot);
    const proofArtifact = bindings.proofCase;
    const geometry = bindings.geometry;
    if (
      proofArtifact.kind !== "document" ||
      proofArtifact.mediaType !== "application/json" ||
      geometry.kind !== "step" || geometry.mediaType !== "model/step"
    ) {
      throw new TypeError(
        isolatedCalculixBindingRejectionMessage({
          proofKind: proofArtifact.kind,
          proofMediaType: proofArtifact.mediaType,
          geometryKind: geometry.kind,
          geometryMediaType: geometry.mediaType,
        }),
      );
    }
    const admission = await this.reviewIsolatedCalculixAdmission({
      project: input.project,
      snapshot,
      proofArtifact,
      geometryArtifact: geometry,
    });
    const proof = proofCaptureView(admission.capture);
    const geometryCasUri = canonicalCalculixStepAssetCasUri(geometry);
    const stepBytes = admission.stepBytes;
    const requestId = await requestIdFor(input.run.id, "calculix");
    const commonPlan = {
      ...common,
      authorization: {
        ...common.authorization,
        methodQualification: local
          ? {
            id: "qualified-calculix-isolated-static-proof",
            version: "1.0",
            fingerprint: localProfile!.profileFingerprint,
          }
          : {
            id: "qualified-static-structural-proof-case",
            version: "1.0",
            fingerprint: proofArtifact.fingerprint,
          },
      },
      sources: [
        await this.#artifactSource(snapshot, "proofCase", "proof-case", proofArtifact),
        sourceFromBytes(
          snapshot,
          "geometry",
          "geometry-source",
          geometry,
          stepBytes,
          geometryCasUri,
        ),
      ],
    };
    const actionInput = {
      proofCase: {
        id: proof.case.id,
        fingerprint: proofArtifact.fingerprint,
        sourceBinding: "proofCase",
      },
      geometrySourceBinding: "geometry",
      effectiveElementOrder: this.#elementOrder,
      effectiveTimeoutMs: this.#calculixTimeoutMs,
    } as const;
    if (local) {
      return {
        ...commonPlan,
        action: {
          kind: "isolated-static-structural-analysis",
          executor: {
            id: "casys-local-microsandbox",
            contract: { id: "calculix-static-proof-v1", version: "1.0.0" },
            profileFingerprint: localProfile!.profileFingerprint,
          },
          lowering: { id: "calculix.static.abaqus-deck", version: "1.0" },
          requestId,
          input: actionInput,
        },
        expectedProviderResources: {
          receiptSchema: "isolated-code-execution-receipt-record/1.0",
          evidenceSchema: "calculix-isolated-static-evidence/1.0",
          resourceProfile: {
            id: CALCULIX_ISOLATED_STATIC_RESOURCE_PROFILE.id,
            version: CALCULIX_ISOLATED_STATIC_RESOURCE_PROFILE.version,
          },
        },
        recovery: {
          policy: "calculix-isolated-generation-recovery@1.0",
          requestId,
          mode: "same-request-readback-no-blind-redispatch",
          ambiguousOutcome: "quarantine-for-human-review",
          capturedOutcome: "cas-only-recovery",
        },
      };
    }
    return {
      ...commonPlan,
      action: {
        kind: "static-structural-analysis",
        provider: {
          id: "mcp-calculix",
          contract: { id: "calculix_solve_static_recorded", version: "1.0" },
          executionIdentitySchema: "1.0",
          runSchema: "2.0",
          resultSchema: "2.0",
        },
        lowering: { id: "calculix.static.abaqus-deck", version: "1.0" },
        requestId,
        input: actionInput,
      },
      expectedProviderResources: {
        ledgerSchema: "provider-resource-acquisition-ledger/1.0",
        captureManifestSchema: "provider-artifact-capture-manifest/1.0",
        resourceProfile: {
          id: CALCULIX_RECORDED_STATIC_RESOURCE_PROFILE.id,
          version: CALCULIX_RECORDED_STATIC_RESOURCE_PROFILE.version,
        },
      },
      recovery: {
        policy: "mcp-calculix.recorded-static-recovery@1.0",
        requestId,
        mode: "same-request-readback-no-blind-redispatch",
        ambiguousOutcome: "quarantine-for-human-review",
        capturedOutcome: "cas-only-recovery",
      },
    };
  }

  async reviewIsolatedCalculixAdmission(input: {
    readonly project: EngineeringProjectSnapshot;
    readonly snapshot: ThreadSnapshot;
    readonly proofArtifact: ThreadArtifact;
    readonly geometryArtifact?: ThreadArtifact;
  }): Promise<FeaIsolatedRunAdmissionReview> {
    const snapshot = validateThreadSnapshot(input.snapshot);
    const proofArtifact = artifactById(snapshot, input.proofArtifact.id);
    if (!sameExactArtifactIdentity(proofArtifact, input.proofArtifact)) {
      throw new TypeError(
        "FEA proof binding is not the exact artifact identity on the reviewed basis.",
      );
    }
    if (
      proofArtifact.kind !== "document" ||
      proofArtifact.mediaType !== "application/json"
    ) {
      throw new TypeError(
        isolatedCalculixBindingRejectionMessage({
          proofKind: proofArtifact.kind,
          proofMediaType: proofArtifact.mediaType,
          geometryKind: "step",
          geometryMediaType: "model/step",
        }),
      );
    }
    const capture = await this.#proofCase(proofArtifact);
    const proof = proofCaptureView(capture);
    const capturedGeometry = exactProofInputArtifact(
      snapshot,
      proof.geometry,
      "geometry capture",
    );
    const capturedRequirements = exactProofInputArtifact(
      snapshot,
      proof.requirements,
      "requirements",
    );
    const stepArtifact = exactProofInputArtifact(
      snapshot,
      proof.step,
      "STEP",
    );
    assertExactArtifactInputs(
      proofArtifact,
      [capturedGeometry.id, capturedRequirements.id, stepArtifact.id],
      "FEA proof capture",
    );
    if (
      proof.case.project.id !== input.project.project.id ||
      proof.case.project.subjectId !== snapshot.subject.id
    ) {
      throw new TypeError(
        "FEA proof case does not bind the recorded-plan project subject.",
      );
    }
    await this.#assertCaseBasisIsAncestor(
      snapshot,
      proof.case.project.baseThreadSnapshot,
      "FEA proof case",
    );
    await assertFeaProofSealProjectHistory(
      input.project,
      snapshot,
      proof,
      proofArtifact,
      this.options.snapshots,
      this.options.admissions,
      (artifact) => this.#artifactBytes(artifact),
    );
    if (
      stepArtifact.kind !== "step" ||
      stepArtifact.mediaType !== "model/step" ||
      proof.step.bytes !== proof.case.expectedCadArtifact.bytes ||
      proof.case.expectedCadArtifact.sha256 !== stepArtifact.fingerprint.digest ||
      proof.trustedRunId !== proofArtifact.producer.runId ||
      proofArtifact.producer.serverId !== "digital-thread" ||
      proofArtifact.producer.tool !== "verify.seal-proof-case@1"
    ) {
      throw new TypeError(
        "FEA proof capture, producer and canonical STEP identity are not exact.",
      );
    }
    if (
      input.geometryArtifact &&
      !sameBoundStepArtifact(stepArtifact, input.geometryArtifact)
    ) {
      throw new TypeError(
        "FEA proof capture and geometry binding are not the same exact STEP artifact.",
      );
    }
    canonicalCalculixStepAssetCasUri(stepArtifact);
    const stepBytes = await this.options.stepAssets.read(
      stepArtifact.fingerprint.digest,
    );
    if (
      await fingerprintResourceBytes(stepBytes) !== stepArtifact.fingerprint.digest ||
      stepBytes.byteLength !== proof.step.bytes
    ) {
      throw new Error(
        "Canonical STEP asset does not match the proof capture byte identity.",
      );
    }
    return { capture, stepArtifact, stepBytes };
  }

  async #assertCaseBasisIsAncestor(
    basis: ThreadSnapshot,
    declared: {
      readonly id: string;
      readonly revision: number;
      readonly subjectId: string;
    },
    label: string,
  ): Promise<void> {
    if (
      basis.id === declared.id && basis.revision === declared.revision &&
      basis.subject.id === declared.subjectId
    ) return;
    const rawAncestor = await this.options.snapshots.get(declared.id);
    if (
      !rawAncestor || rawAncestor.id !== declared.id ||
      rawAncestor.revision !== declared.revision ||
      rawAncestor.subject.id !== declared.subjectId
    ) {
      throw new TypeError(`${label} declared base is not exactly available.`);
    }
    const ancestor = validateThreadSnapshot(rawAncestor);
    if (!await threadSnapshotDescendsFrom(basis, ancestor, this.options.snapshots)) {
      throw new TypeError(
        `${label} declared base is not an ancestor of the run basis.`,
      );
    }
  }

  async #artifactSource(
    snapshot: ThreadSnapshot,
    bindingName: string,
    role: string,
    artifact: ThreadArtifact,
  ): Promise<ResolvedOperationPlanSource> {
    return sourceFromBytes(
      snapshot,
      bindingName,
      role,
      artifact,
      await this.#artifactBytes(artifact),
    );
  }

  async #artifactBytes(artifact: ThreadArtifact): Promise<Uint8Array> {
    canonicalArtifactUri(artifact);
    const bytes = await this.options.artifacts.read(Object.freeze({ ...artifact }));
    if (!bytes) {
      throw new Error(
        `Thread artifact ${artifact.id} is absent from its exact CAS URI.`,
      );
    }
    const copy = Uint8Array.from(bytes);
    const actual = await fingerprintResourceBytes(copy);
    if (actual !== artifact.fingerprint.digest) {
      throw new Error(
        `Thread artifact ${artifact.id} raw CAS bytes do not match its fingerprint.`,
      );
    }
    return copy;
  }

  async #proofCase(artifact: ThreadArtifact): Promise<FeaProofCaseCapture> {
    const bytes = await this.#artifactBytes(artifact);
    const fullText = decodeUtf8(bytes, "FEA proof capture");
    return await parseFeaProofCaseCapture(fullText);
  }
}

type PlanCommon =
  & Omit<
    ResolvedOperationPlanV2,
    | "authorization"
    | "sources"
    | "action"
    | "expectedProviderResources"
    | "recovery"
  >
  & {
    readonly authorization: Omit<
      ResolvedOperationPlanV2["authorization"],
      "methodQualification"
    >;
  };
interface ProofCapture {
  readonly case: MechanicalProofCase;
  readonly trustedRunId: string;
  readonly sealedAt: string;
  readonly geometry: ProofArtifactRef;
  readonly requirements: ProofArtifactRef;
  readonly step: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
    readonly producerRunId: string;
    readonly bytes: number;
  };
}

function proofCaptureView(capture: FeaProofCaseCapture): ProofCapture {
  return {
    case: capture.proofCase,
    trustedRunId: capture.trustedRunId,
    sealedAt: capture.sealedAt,
    geometry: capture.geometryArtifact,
    requirements: capture.requirementsArtifact,
    step: capture.stepArtifact,
  };
}
interface ProofArtifactRef {
  readonly id: string;
  readonly fingerprint: ContentFingerprint;
  readonly producerRunId: string;
}
function exactProofInputArtifact(
  snapshot: ThreadSnapshot,
  reference: ProofArtifactRef,
  label: string,
): ThreadArtifact {
  const artifact = artifactById(snapshot, reference.id);
  if (
    !fingerprintsEqual(artifact.fingerprint, reference.fingerprint) ||
    artifact.producer.runId !== reference.producerRunId
  ) {
    throw new TypeError(
      `FEA proof capture ${label} does not name its exact Thread artifact.`,
    );
  }
  return artifact;
}

function assertExactArtifactInputs(
  artifact: ThreadArtifact,
  expectedIds: readonly string[],
  label: string,
): void {
  const actual = artifact.inputArtifactIds;
  if (
    new Set(actual).size !== actual.length ||
    new Set(expectedIds).size !== expectedIds.length ||
    actual.length !== expectedIds.length ||
    expectedIds.some((id) => !actual.includes(id))
  ) {
    throw new TypeError(`${label} inputArtifactIds are not exact.`);
  }
}

function sameProducer(left: ThreadArtifact, right: ThreadArtifact): boolean {
  return left.producer.serverId === right.producer.serverId &&
    left.producer.tool === right.producer.tool &&
    left.producer.runId === right.producer.runId;
}

async function assertFeaProofSealProjectHistory(
  project: EngineeringProjectSnapshot,
  currentBasis: ThreadSnapshot,
  proof: ProofCapture,
  proofArtifact: ThreadArtifact,
  snapshots: ExactThreadSnapshotReader,
  admissions: Pick<TechnicalCompilationAdmissionReader, "read"> | undefined,
  readArtifactBytes: (artifact: ThreadArtifact) => Promise<Uint8Array>,
): Promise<void> {
  const workItem = project.workItems.find((item) =>
    item.id === proof.case.authorization.workItemId
  );
  const run = project.agentRuns.find((item) => item.id === proof.trustedRunId);
  const decision = project.decisions.find((item) =>
    item.id === proof.case.authorization.decisionId
  );
  if (
    !workItem ||
    workItem.operation?.id !== VERIFY_SEAL_PROOF_CASE_OPERATION.id ||
    workItem.operation.version !== VERIFY_SEAL_PROOF_CASE_OPERATION.version ||
    deterministicJson(workItem.operation.bindings) !== deterministicJson([{
        name: "approvedBrief",
        source: { kind: "approved-brief" },
      }]) ||
    !workItem.decisionIds.includes(proof.case.authorization.decisionId) ||
    !run ||
    run.workItemId !== workItem.id ||
    run.status !== "completed" ||
    !run.resultSnapshot ||
    run.evidenceRefs.length === 0 ||
    run.basis?.kind !== "thread-snapshot" ||
    run.startedAt !== proof.sealedAt ||
    !decision ||
    decision.status !== "approved" ||
    !decision.proposal ||
    !decision.inputFingerprint ||
    !sameDeclaredBasis(decision.baseSnapshot, run.basis)
  ) {
    throw new TypeError(
      "FEA proof authority is not backed by its completed registered verify.seal-proof-case@1 run.",
    );
  }
  const approval = await exactHumanApproval(project, decision, run.basis);
  if (!approval) {
    throw new TypeError(
      "FEA proof authority does not retain one exact human MRTR approval.",
    );
  }
  await assertFeaSealRunInputFingerprint(project, run, workItem);
  const decisionParameters = await assertFeaSealDecisionMatchesProof(
    decision,
    proof,
  );

  const resultReference = run.resultSnapshot;
  const rawResult = await snapshots.get(resultReference.snapshotId);
  const rawBasis = await snapshots.get(run.basis.snapshotId);
  if (
    !rawResult ||
    rawResult.id !== resultReference.snapshotId ||
    rawResult.revision !== resultReference.revision ||
    rawResult.subject.id !== resultReference.subjectId ||
    !rawBasis ||
    rawBasis.id !== run.basis.snapshotId ||
    rawBasis.revision !== run.basis.revision ||
    rawBasis.subject.id !== run.basis.subjectId
  ) {
    throw new TypeError(
      "FEA proof authority completed seal result or exact seal basis is absent.",
    );
  }
  const sealResult = validateThreadSnapshot(rawResult);
  const sealBasis = validateThreadSnapshot(rawBasis);
  if (
    sealResult.revision !== sealBasis.revision + 1 ||
    sealResult.previous?.snapshotId !== sealBasis.id ||
    sealResult.previous.revision !== sealBasis.revision ||
    !await threadSnapshotDescendsFrom(sealResult, sealBasis, snapshots)
  ) {
    throw new TypeError(
      "FEA proof authority completed seal result is not the direct immutable child of its exact seal basis.",
    );
  }
  const sealedArtifact = artifactById(sealResult, proofArtifact.id);
  if (
    !sameExactArtifactIdentity(sealedArtifact, proofArtifact) ||
    !isExactFeaSealArtifact(
      sealedArtifact,
      sealResult,
      run.id,
      proof.sealedAt,
      decisionParameters.proofDigest,
    ) ||
    !await exactFeaSealEvidence(
      run.evidenceRefs,
      resultReference,
      project.project.id,
      sealBasis,
      sealResult,
      proofArtifact,
      run.id,
      proof.sealedAt,
      decisionParameters,
      admissions,
      readArtifactBytes,
    ) ||
    !await threadSnapshotDescendsFrom(currentBasis, sealResult, snapshots)
  ) {
    throw new TypeError(
      "FEA proof authority result, evidence, producer, or preserved seal lineage is not exact.",
    );
  }
}

async function exactHumanApproval(
  project: EngineeringProjectSnapshot,
  decision: EngineeringDecision,
  basis: EngineeringThreadSnapshotBasis,
): Promise<EngineeringApproval | undefined> {
  const candidates = project.approvals.filter((approval) =>
    approval.decisionId === decision.id &&
    approval.status === "approved" &&
    approval.decidedByOrigin === "human" &&
    sameDeclaredBasis(approval.baseSnapshot, basis) &&
    sameEvidence(decision, approval.inputEvidenceRefs) &&
    fingerprintsEqual(approval.inputFingerprint, decision.inputFingerprint)
  );
  const approval = candidates.length === 1 ? candidates[0] : undefined;
  if (!approval || !decision.approvalIds.includes(approval.id)) return undefined;
  const expectedDecisionFingerprint = await sha256Fingerprint({
    baseSnapshot: decision.baseSnapshot,
    inputEvidenceRefs: decision.inputEvidenceRefs,
    proposal: {
      summary: decision.proposal!.summary,
      parameters: decision.proposal!.parameters,
    },
  });
  return fingerprintsEqual(expectedDecisionFingerprint, decision.inputFingerprint)
    ? approval
    : undefined;
}

async function assertFeaSealRunInputFingerprint(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  workItem: EngineeringWorkItem,
): Promise<void> {
  if (!run.inputFingerprint || run.basis?.kind !== "thread-snapshot") {
    throw new TypeError(
      "FEA proof authority completed seal run has no exact queue fingerprint and basis.",
    );
  }
  const approvedDecisions = workItem.decisionIds.map((decisionId) => {
    const decision = project.decisions.find((candidate) => candidate.id === decisionId);
    if (!decision?.inputFingerprint || decision.status !== "approved") {
      throw new TypeError(
        "FEA proof authority seal work item has a decision that is not exactly approved.",
      );
    }
    return { id: decision.id, inputFingerprint: decision.inputFingerprint };
  });
  const expected = await sha256Fingerprint({
    workItemId: workItem.id,
    basis: run.basis,
    operation: {
      id: workItem.operation!.id,
      version: workItem.operation!.version,
      bindings: workItem.operation!.bindings,
    },
    approvedDecisions,
  });
  if (!fingerprintsEqual(run.inputFingerprint, expected)) {
    throw new TypeError(
      "FEA proof authority completed seal run input fingerprint is not exact.",
    );
  }
}

async function assertFeaSealDecisionMatchesProof(
  decision: EngineeringDecision,
  proof: ProofCapture,
): Promise<FeaProofDecisionParameters> {
  try {
    const parameters = parseFeaProofDecisionParameters(
      feaProofDecisionParametersToMap(decision.proposal!.parameters),
    );
    verifyFeaProofParametersMatchCase(parameters, proof.case);
    const digest = (await sha256Fingerprint(proof.case)).digest;
    if (
      parameters.proofDigest !== digest ||
      parameters.geometryArtifact.id !== proof.geometry.id ||
      !fingerprintsEqual(
        parameters.geometryArtifact.fingerprint,
        proof.geometry.fingerprint,
      ) ||
      parameters.requirementsArtifact.id !== proof.requirements.id ||
      !fingerprintsEqual(
        parameters.requirementsArtifact.fingerprint,
        proof.requirements.fingerprint,
      )
    ) {
      throw new Error("sealed declaration or source artifact identity diverges");
    }
    return parameters;
  } catch (cause) {
    throw new TypeError(
      `FEA proof authority MRTR does not match the sealed proof: ${
        cause instanceof Error ? cause.message : String(cause)
      }.`,
    );
  }
}

function isExactFeaSealArtifact(
  artifact: ThreadArtifact,
  snapshot: ThreadSnapshot,
  runId: string,
  sealedAt: string,
  proofDigest: string,
): boolean {
  const captureDigest = artifact.fingerprint.digest;
  return artifact.kind === "document" &&
    artifact.mediaType === "application/json" &&
    artifact.fingerprint.algorithm === "sha256" &&
    artifact.id === `fea-proof-${captureDigest}` &&
    artifact.version === proofDigest &&
    artifact.uri === `casys://fea-proof-case-capture/sha256/${captureDigest}` &&
    artifact.freshness.status === "fresh" &&
    artifact.freshness.changedAt === sealedAt &&
    !archivedRefKeys(snapshot).has(`artifact:${artifact.id}`) &&
    artifact.producer.serverId === "digital-thread" &&
    artifact.producer.tool === "verify.seal-proof-case@1" &&
    artifact.producer.runId === runId;
}

async function exactFeaSealEvidence(
  evidenceRefs: readonly EngineeringThreadEntityRef[],
  result: { readonly snapshotId: string; readonly revision: number },
  projectId: string,
  sealBasis: ThreadSnapshot,
  sealResult: ThreadSnapshot,
  proofArtifact: ThreadArtifact,
  runId: string,
  sealedAt: string,
  decisionParameters: FeaProofDecisionParameters,
  admissions: Pick<TechnicalCompilationAdmissionReader, "read"> | undefined,
  readArtifactBytes: (artifact: ThreadArtifact) => Promise<Uint8Array>,
): Promise<boolean> {
  const signedCatalog = decisionParameters.sensitivityCatalog;
  const expectedEvidenceCount = signedCatalog === undefined ? 1 : 2;
  if (evidenceRefs.length !== expectedEvidenceCount) return false;
  const onResult = (ref: EngineeringThreadEntityRef) =>
    ref.snapshotId === result.snapshotId &&
    ref.snapshotRevision === result.revision &&
    ref.kind === "artifact";
  if (!evidenceRefs.every(onResult)) return false;
  const ids = evidenceRefs.map((ref) => ref.id);
  if (new Set(ids).size !== ids.length) return false;
  if (ids[0] !== proofArtifact.id) return false;
  const basisArtifactIds = new Set(sealBasis.artifacts.map((artifact) => artifact.id));
  const artifactsPublishedBySealRun = sealResult.artifacts.filter((artifact) =>
    !basisArtifactIds.has(artifact.id) &&
    artifact.producer.serverId === "digital-thread" &&
    artifact.producer.tool === "verify.seal-proof-case@1" &&
    artifact.producer.runId === runId
  );
  if (
    artifactsPublishedBySealRun.length !== ids.length ||
    artifactsPublishedBySealRun.some((artifact) => !ids.includes(artifact.id))
  ) {
    return false;
  }
  if (signedCatalog === undefined) return true;

  const offerId = ids[1];
  if (!offerId) return false;
  const offerMatches = sealResult.artifacts.filter((artifact) =>
    artifact.id === offerId
  );
  return offerMatches.length === 1 &&
    await isExactFeaSensitivityCatalogOffer(
      offerMatches[0],
      projectId,
      sealBasis,
      sealResult,
      proofArtifact,
      runId,
      sealedAt,
      decisionParameters,
      admissions,
      readArtifactBytes,
    );
}

async function isExactFeaSensitivityCatalogOffer(
  artifact: ThreadArtifact,
  projectId: string,
  sealBasis: ThreadSnapshot,
  sealResult: ThreadSnapshot,
  proofArtifact: ThreadArtifact,
  runId: string,
  sealedAt: string,
  decisionParameters: FeaProofDecisionParameters,
  admissions: Pick<TechnicalCompilationAdmissionReader, "read"> | undefined,
  readArtifactBytes: (artifact: ThreadArtifact) => Promise<Uint8Array>,
): Promise<boolean> {
  const signedCatalog = decisionParameters.sensitivityCatalog;
  if (signedCatalog === undefined) return false;
  const digest = artifact.fingerprint.digest;
  if (
    artifact.kind !== "document" ||
    artifact.mediaType !== "application/json" ||
    artifact.freshness.status !== "fresh" ||
    artifact.fingerprint.algorithm !== "sha256" ||
    artifact.id !== `sensitivity-catalog-offer-${digest}` ||
    artifact.uri !==
      `casys://sensitivity-catalog-offer-capture/sha256/${digest}` ||
    artifact.producer.serverId !== "digital-thread" ||
    artifact.producer.tool !== "verify.seal-proof-case@1" ||
    artifact.producer.runId !== runId ||
    artifact.freshness.changedAt !== sealedAt ||
    archivedRefKeys(sealResult).has(`artifact:${artifact.id}`) ||
    artifact.inputArtifactIds.length !== 2 ||
    artifact.inputArtifactIds[0] !== proofArtifact.id
  ) {
    return false;
  }
  const admissionId = artifact.inputArtifactIds[1];
  if (!admissionId || admissionId !== signedCatalog.admissionArtifact.id) {
    return false;
  }
  const admissionMatches = sealBasis.artifacts.filter((candidate) =>
    candidate.id === admissionId
  );
  if (admissionMatches.length !== 1 || admissions === undefined) {
    return false;
  }
  const admission = admissionMatches[0];

  try {
    const reopenedAdmission = await admissions.read({
      projectId,
      basis: {
        kind: "thread-snapshot",
        snapshotId: sealBasis.id,
        revision: sealBasis.revision,
        subjectId: sealBasis.subject.id,
      },
      artifactId: admission.id,
      artifactFingerprint: signedCatalog.admissionArtifact.fingerprint,
    });
    if (reopenedAdmission === undefined) return false;
    const capture = await parseSensitivityCatalogOfferCapture(
      decodeUtf8(
        await readArtifactBytes(artifact),
        "sensitivity catalog offer capture",
      ),
    );
    return artifact.version === signedCatalog.digest &&
      capture.trustedRunId === runId &&
      capture.sealedAt === sealedAt &&
      capture.offerDigest === signedCatalog.digest &&
      capture.offer.authority.proofDigest === decisionParameters.proofDigest &&
      capture.offer.authority.admissionArtifact.id === admission.id &&
      fingerprintsEqual(
        capture.offer.authority.admissionArtifact.fingerprint,
        admission.fingerprint,
      ) && reopenedAdmission.trustedRunId === admission.producer.runId;
  } catch {
    return false;
  }
}

function sourceFromBytes(
  snapshot: ThreadSnapshot,
  bindingName: string,
  role: string,
  artifact: ThreadArtifact,
  bytes: Uint8Array,
  sealedCasUri?: string,
): ResolvedOperationPlanSource {
  const uri = sealedCasUri ?? canonicalArtifactUri(artifact);
  if (bytes.byteLength < 1) {
    throw new TypeError(`Thread artifact ${artifact.id} is empty.`);
  }
  return {
    bindingName,
    role,
    threadRef: {
      snapshotId: snapshot.id,
      snapshotRevision: snapshot.revision,
      kind: "artifact",
      id: artifact.id,
    },
    artifact: {
      fingerprint: artifact.fingerprint,
      byteCount: bytes.byteLength,
      mediaType: requiredMediaType(artifact.mediaType, artifact.id),
      casUri: uri,
    },
  };
}

function canonicalArtifactUri(artifact: ThreadArtifact): string {
  if (!artifact.uri) {
    throw new TypeError(`Thread artifact ${artifact.id} has no CAS URI.`);
  }
  const match = CANONICAL_CAS_URI.exec(artifact.uri);
  if (!match || match[1] !== artifact.fingerprint.digest) {
    throw new TypeError(
      `Thread artifact ${artifact.id} URI is not its exact canonical casys SHA-256 URI.`,
    );
  }
  return artifact.uri;
}

async function assertQueuedCandidate(
  input: RegisteredRunPlanSealInput,
): Promise<void> {
  const operation = input.workItem.operation;
  const basis = input.run.basis;
  const workItems = input.project.workItems.filter((item) =>
    item.id === input.workItem.id
  );
  if (
    !operation || workItems.length !== 1 ||
    deterministicJson(workItems[0]) !== deterministicJson(input.workItem) ||
    input.workItem.status !== "ready" || input.run.status !== "queued" ||
    input.run.workItemId !== input.workItem.id ||
    input.run.resolvedOperationPlan !== undefined ||
    input.project.agentRuns.some((run) => run.id === input.run.id) ||
    !basis || basis.kind !== "thread-snapshot"
  ) {
    throw new TypeError(
      "Recorded plan candidate is not the exact pre-commit queued run and registered work item.",
    );
  }
  if (
    input.queueBasisProject.snapshotId !== input.project.id ||
    input.queueBasisProject.revision !== input.project.revision ||
    !fingerprintsEqual(
      input.queueBasisProject.fingerprint,
      await sha256Fingerprint(input.project),
    )
  ) {
    throw new TypeError(
      "Recorded plan queue basis is not the exact immutable project revision.",
    );
  }
  const approvedDecisions = input.workItem.decisionIds.map((id) => {
    const matches = input.project.decisions.filter((decision) => decision.id === id);
    const decision = matches[0];
    if (
      matches.length !== 1 || !decision || decision.status !== "approved" ||
      !decision.inputFingerprint
    ) {
      throw new TypeError(
        "Recorded plan work-item decisions are not uniquely approved.",
      );
    }
    return { id, inputFingerprint: decision.inputFingerprint };
  });
  const expectedRunFingerprint = await sha256Fingerprint({
    workItemId: input.workItem.id,
    basis,
    operation: {
      id: operation.id,
      version: operation.version,
      bindings: operation.bindings,
    },
    approvedDecisions,
  });
  if (
    !input.run.inputFingerprint ||
    !fingerprintsEqual(input.run.inputFingerprint, expectedRunFingerprint)
  ) {
    throw new TypeError(
      "Recorded plan run input fingerprint does not seal its exact work item, operation, basis, and approved decisions.",
    );
  }
}

async function authorizationFor(input: RegisteredRunPlanSealInput) {
  if (input.workItem.decisionIds.length !== 1) {
    throw new TypeError("Recorded plan requires exactly one direct MRTR decision.");
  }
  const decisions = input.project.decisions.filter((item) =>
    item.id === input.workItem.decisionIds[0]
  );
  const decision = decisions[0];
  if (
    decisions.length !== 1 || !decision || decision.status !== "approved" ||
    !decision.inputFingerprint ||
    decision.approvalIds.length === 0
  ) {
    throw new TypeError("Recorded plan requires a directly approved MRTR decision.");
  }
  const approvals = input.project.approvals.filter((item) =>
    item.id === decision.approvalIds.at(-1)
  );
  const approval = approvals[0];
  if (
    approvals.length !== 1 || !approval || approval.status !== "approved" ||
    approval.decidedByOrigin !== "human" ||
    approval.decisionId !== decision.id || !approval.inputFingerprint ||
    !fingerprintsEqual(approval.inputFingerprint, decision.inputFingerprint) ||
    !sameSnapshot(decision.baseSnapshot, input.run.basis) ||
    !sameSnapshot(approval.baseSnapshot, input.run.basis) ||
    !sameEvidence(decision, approval.inputEvidenceRefs)
  ) {
    throw new TypeError(
      "Recorded plan MRTR approval does not attest the exact decision evidence.",
    );
  }
  return {
    kind: "human-mrtr-and-qualified-method" as const,
    mrtr: {
      decisionId: decision.id,
      decisionInputFingerprint: decision.inputFingerprint,
      approvalId: approval.id,
      approvalFingerprint: await sha256Fingerprint(approval),
    },
  };
}

function exactBindings(
  bindings: readonly EngineeringOperationInputBinding[],
  names: readonly string[],
  snapshot: ThreadSnapshot,
): Record<string, ThreadArtifact> {
  if (
    bindings.length !== names.length ||
    new Set(bindings.map((binding) => binding.name)).size !== names.length
  ) {
    throw new TypeError(
      "Recorded operation must declare exactly its closed Thread artifact bindings.",
    );
  }
  const result: Record<string, ThreadArtifact> = {};
  for (const name of names) {
    const binding = bindings.find((candidate) => candidate.name === name);
    if (
      !binding || binding.source.kind !== "thread-entity" ||
      binding.source.reference.kind !== "artifact" ||
      binding.source.reference.snapshotId !== snapshot.id ||
      binding.source.reference.snapshotRevision !== snapshot.revision
    ) {
      throw new TypeError(
        `Recorded operation binding ${name} is not an exact artifact on its basis.`,
      );
    }
    result[name] = artifactById(snapshot, binding.source.reference.id);
  }
  return result;
}

function artifactById(snapshot: ThreadSnapshot, id: string): ThreadArtifact {
  const matches = snapshot.artifacts.filter((artifact) => artifact.id === id);
  if (matches.length !== 1) {
    throw new TypeError(
      `Thread artifact ${id} is not uniquely present in the exact basis.`,
    );
  }
  return matches[0];
}

async function requestIdFor(runId: string, provider: string): Promise<string> {
  const digest = (await sha256Fingerprint({
    schema: "resolved-operation-plan/2.0",
    provider,
    runId,
  })).digest;
  return `rop2-${provider}-${digest.slice(0, 32)}`;
}

function sameOperation(
  id: string,
  version: string,
  expected: { readonly id: string; readonly version: string },
): boolean {
  return id === expected.id && version === expected.version;
}

function requiredFingerprint(
  value: ContentFingerprint | undefined,
  path: string,
): ContentFingerprint {
  if (!value || value.algorithm !== "sha256" || !SHA256.test(value.digest)) {
    throw new TypeError(`${path} must be a SHA-256 fingerprint.`);
  }
  return value;
}

function sameEvidence(
  decision: EngineeringDecision,
  approvalEvidence: readonly {
    snapshotId: string;
    snapshotRevision: number;
    kind: string;
    id: string;
  }[],
): boolean {
  const key = (
    value: { snapshotId: string; snapshotRevision: number; kind: string; id: string },
  ) =>
    `${value.snapshotId}\u0000${value.snapshotRevision}\u0000${value.kind}\u0000${value.id}`;
  return decision.inputEvidenceRefs.length === approvalEvidence.length &&
    decision.inputEvidenceRefs.every((reference) =>
      approvalEvidence.some((candidate) => key(candidate) === key(reference))
    );
}

function sameSnapshot(
  value:
    | {
      readonly snapshotId: string;
      readonly revision: number;
      readonly subjectId: string;
    }
    | undefined,
  basis: unknown,
): boolean {
  if (!value || !isObject(basis) || basis.kind !== "thread-snapshot") return false;
  return value.snapshotId === basis.snapshotId && value.revision === basis.revision &&
    value.subjectId === basis.subjectId;
}

function sameDeclaredBasis(
  value:
    | {
      readonly snapshotId: string;
      readonly revision: number;
      readonly subjectId: string;
    }
    | undefined,
  expected: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly subjectId: string;
  },
): boolean {
  return !!value && value.snapshotId === expected.snapshotId &&
    value.revision === expected.revision &&
    value.subjectId === expected.subjectId;
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new TypeError(`${label} is not valid UTF-8.`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredMediaType(value: string | undefined, id: string): string {
  if (!value) throw new TypeError(`Thread artifact ${id} is missing its media type.`);
  return value;
}

function sameExactArtifactIdentity(
  left: ThreadArtifact,
  right: ThreadArtifact,
): boolean {
  try {
    return left.id === right.id &&
      fingerprintsEqual(left.fingerprint, right.fingerprint) &&
      canonicalArtifactUri(left) === canonicalArtifactUri(right) &&
      sameProducer(left, right);
  } catch {
    return false;
  }
}

/**
 * Compare a public STEP binding without interpreting its route as a CAS URI.
 *
 * STEP routes are validated separately by canonicalCalculixStepAssetCasUri.
 */
function sameBoundStepArtifact(
  left: ThreadArtifact,
  right: ThreadArtifact,
): boolean {
  return left.id === right.id &&
    left.kind === right.kind &&
    left.mediaType === right.mediaType &&
    left.uri === right.uri &&
    fingerprintsEqual(left.fingerprint, right.fingerprint) &&
    sameProducer(left, right);
}
