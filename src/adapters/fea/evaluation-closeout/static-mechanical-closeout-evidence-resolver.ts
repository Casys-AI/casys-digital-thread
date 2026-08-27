/**
 * Exact, provider-free reopening of the current static FEA @3 branch for an
 * L5 closeout.  This is deliberately an adapter: it reads local immutable
 * evidence but has no solver client, SysON client, tool selection, or caller
 * controlled lookup surface.
 */

import type { CanonicalAssetReader } from "../../../application/ports/out/canonical-asset-reader.ts";
import type { CalculixIsolatedExecutionEvidenceStore } from "../../../application/ports/out/fea/isolated-v3/calculix-isolated-execution-evidence-store.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../domain/project/engineering-project.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
} from "../../../domain/project/engineering-project.ts";
import { requirementEvaluationIdentity } from "../../../domain/thread/requirement-evaluation-identity.ts";
import type {
  RequirementEvaluation,
  ThreadArtifact,
  ThreadOperationRef,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  STATIC_MECHANICAL_CLOSEOUT_LIMITS,
  STATIC_MECHANICAL_EVALUATION_FAMILY,
  type StaticMechanicalCloseoutConsequence,
  type StaticMechanicalCloseoutCriterion,
  type StaticMechanicalEvaluationCloseoutAdmission,
  type StaticMechanicalProofLimitations,
  validateStaticMechanicalEvaluationCloseoutAdmission,
} from "../../../domain/fea/evaluation-closeout/static-mechanical-evaluation-closeout-proposal.ts";
import {
  parseSealedStaticProofCapture,
  type SealedStaticProofCapture,
} from "../../../domain/fea/isolated-v3/sealed-static-proof-capture.ts";
import {
  assertExactCompletedStaticProofProjectBinding,
  assertExactStaticProofLocalArtifacts,
  exactStaticProofEvidenceRefs,
  uniqueStaticProofRequirementTraces,
} from "../../../domain/fea/isolated-v3/static-proof-thread-evidence.ts";
import { evaluationsFromStaticProofOracle } from "../../../domain/fea/isolated-v3/static-proof-oracle-input.ts";
import {
  buildOracleValues,
  parseCapturedFeaConstraintOracleOutcome,
  prepareFeaConstraintOracleCall,
} from "../isolated-v3/fea-oracle-adapter.ts";
import {
  canonicalFeaSysonEvaluationCaptureText,
  validateFeaSysonEvaluationCapture,
} from "../isolated-v3/fea-syson-evaluation-capture.ts";
import type { RecordedAnalysisCasReader } from "../../compile/plans/recorded-analysis-cas-reader.ts";
import type { FileByteStore } from "../../shared/cas/file-byte-store.ts";
import { VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION } from "../../../orchestration/operations/fea-isolated-static-proof.ts";

const LOCAL_FEA_TOOL =
  `${VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION.id}@${VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION.version}`;
const PROOF_SEAL_TOOL = "verify.seal-proof-case@1";

export type StaticMechanicalCloseoutResolutionCode =
  | "not-found"
  | "ambiguous"
  | "stale"
  | "integrity";

export class StaticMechanicalCloseoutResolutionError extends Error {
  constructor(
    readonly code: StaticMechanicalCloseoutResolutionCode,
    message: string,
  ) {
    super(message);
    this.name = "StaticMechanicalCloseoutResolutionError";
  }
}

export interface StaticMechanicalCloseoutEvidenceResolverDependencies {
  readonly artifacts: Pick<RecordedAnalysisCasReader, "readArtifact">;
  readonly canonicalAssets: CanonicalAssetReader;
  readonly executionEvidence: Pick<
    CalculixIsolatedExecutionEvidenceStore,
    "read" | "uriFor"
  >;
  readonly evaluationCaptures: Pick<
    FileByteStore<"calculix-isolated-syson-evaluation">,
    "read" | "uriFor"
  >;
}

export interface StaticMechanicalCloseoutResolvedEvidence {
  readonly family: typeof STATIC_MECHANICAL_EVALUATION_FAMILY;
  readonly projectId: string;
  readonly subjectId: string;
  readonly basis: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly fingerprint: Awaited<ReturnType<typeof sha256Fingerprint>>;
  };
  readonly feaRun: EngineeringAgentRun;
  readonly canonicalStep: ThreadArtifact;
  readonly sealedProof: ThreadArtifact;
  readonly executionEvidence: ThreadArtifact;
  readonly evaluationCapture: ThreadArtifact;
  readonly criteria: readonly StaticMechanicalCloseoutCriterion[];
  readonly proofLimitations: StaticMechanicalProofLimitations;
  readonly acceptanceEligible: boolean;
  readonly rejectionDisposition: "none" | "mechanical-review-required";
}

/** Materialize one of the two server-derived, closed MRTR admissions. */
export function staticMechanicalCloseoutAdmission(
  resolved: StaticMechanicalCloseoutResolvedEvidence,
  consequence: StaticMechanicalCloseoutConsequence,
): StaticMechanicalEvaluationCloseoutAdmission {
  if (consequence === "accept" && !resolved.acceptanceEligible) {
    throw new StaticMechanicalCloseoutResolutionError(
      "integrity",
      "An accept closeout cannot be prepared while any static-mechanical L4 criterion is non-pass.",
    );
  }
  return validateStaticMechanicalEvaluationCloseoutAdmission({
    schemaVersion: "evaluation-closeout-admission/1.0",
    family: STATIC_MECHANICAL_EVALUATION_FAMILY,
    consequence,
    rejectionDisposition: consequence === "accept"
      ? "none"
      : resolved.rejectionDisposition,
    projectId: resolved.projectId,
    subjectId: resolved.subjectId,
    basis: resolved.basis,
    canonicalStep: artifactIdentity(resolved.canonicalStep),
    sealedProof: artifactIdentity(resolved.sealedProof),
    executionEvidence: artifactIdentity(resolved.executionEvidence),
    evaluationCapture: artifactIdentity(resolved.evaluationCapture),
    criteria: resolved.criteria,
    proofLimitations: resolved.proofLimitations,
    limits: STATIC_MECHANICAL_CLOSEOUT_LIMITS,
  });
}

/**
 * Reopen one exact completed FEA @3 result whose result snapshot is the
 * provided basis. A later successor never falls back to this historic run.
 */
export async function resolveStaticMechanicalCloseoutEvidence(
  dependencies: StaticMechanicalCloseoutEvidenceResolverDependencies,
  input: {
    readonly project: EngineeringProjectSnapshot;
    readonly basis: EngineeringThreadSnapshotBasis;
    readonly snapshot: ThreadSnapshot;
  },
): Promise<StaticMechanicalCloseoutResolvedEvidence> {
  const { project, basis, snapshot } = input;
  if (
    snapshot.id !== basis.snapshotId || snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId ||
    project.project.subjectId !== basis.subjectId
  ) {
    throw integrity(
      "The requested static-mechanical closeout basis is not the exact project Thread snapshot.",
    );
  }
  const run = selectExactCompletedFeaRun(project, basis, snapshot);
  const localOperation: ThreadOperationRef = {
    serverId: "digital-thread",
    tool: LOCAL_FEA_TOOL,
    runId: run.id,
  };
  const localArtifacts = assertArtifacts(snapshot, localOperation);
  const executionArtifact = uniqueArtifact(
    localArtifacts,
    (artifact) => artifact.name === "Isolated local CalculiX execution evidence",
    "execution evidence",
  );
  const evaluationArtifact = uniqueArtifact(
    localArtifacts,
    (artifact) => artifact.name === "SysON evaluation of isolated CalculiX evidence",
    "L4 evaluation capture",
  );
  const resultArtifact = uniqueArtifact(
    localArtifacts,
    (artifact) => artifact.id.startsWith("calculix-isolated-result-json-"),
    "CalculiX result",
  );
  assertFresh(executionArtifact, "execution evidence");
  assertFresh(evaluationArtifact, "L4 evaluation capture");
  if (
    executionArtifact.id !==
      `calculix-isolated-evidence-${executionArtifact.fingerprint.digest}` ||
    evaluationArtifact.id !==
      `calculix-isolated-syson-evaluation-${evaluationArtifact.fingerprint.digest}` ||
    executionArtifact.uri !==
      dependencies.executionEvidence.uriFor(executionArtifact.fingerprint) ||
    evaluationArtifact.uri !==
      dependencies.evaluationCaptures.uriFor(evaluationArtifact.fingerprint)
  ) {
    throw integrity(
      "The exact FEA execution or L4 capture URI/identity is not canonical.",
    );
  }
  const proofArtifact = selectProofArtifact(snapshot, evaluationArtifact);
  assertFresh(proofArtifact, "sealed proof");
  const proof = await readSealedProof(dependencies.artifacts, proofArtifact);
  assertProofIdentity(project, basis, proofArtifact, proof);
  const stepArtifact = exactArtifact(
    snapshot,
    proof.step.id,
    proof.step.fingerprint.digest,
    proof.step.producerRunId,
    "canonical STEP",
  );
  assertFresh(stepArtifact, "canonical STEP");
  if (stepArtifact.kind !== "step" || stepArtifact.mediaType !== "model/step") {
    throw integrity("The closeout branch does not name a canonical STEP artifact.");
  }
  const requirementsArtifact = exactArtifact(
    snapshot,
    proof.requirements.id,
    proof.requirements.fingerprint.digest,
    proof.requirements.producerRunId,
    "proof requirements",
  );
  const geometryArtifact = exactArtifact(
    snapshot,
    proof.geometry.id,
    proof.geometry.fingerprint.digest,
    proof.geometry.producerRunId,
    "proof geometry",
  );
  assertFresh(requirementsArtifact, "proof requirements");
  assertFresh(geometryArtifact, "proof geometry");
  assertProofInputs(
    proofArtifact,
    proof,
    stepArtifact,
    geometryArtifact,
    requirementsArtifact,
  );
  const stepBytes = await readCanonicalStep(
    dependencies.canonicalAssets,
    stepArtifact,
    proof,
  );
  const execution = await dependencies.executionEvidence.read(
    executionArtifact.fingerprint,
  );
  if (
    !execution || execution.projectId !== project.project.id ||
    execution.agentRunId !== run.id ||
    !fingerprintsEqual(execution.fingerprint, executionArtifact.fingerprint) ||
    !fingerprintsEqual(execution.proofFingerprint, await sha256Fingerprint(proof.case))
  ) {
    throw integrity(
      "The isolated execution evidence does not bind the exact project, run, proof, and artifact.",
    );
  }
  if (
    execution.result.metrics.maximumDisplacement.value === undefined ||
    execution.result.metrics.maximumVonMises.value === undefined ||
    stepBytes.byteLength !== proof.step.bytes ||
    proof.case.expectedCadArtifact.sha256 !== stepArtifact.fingerprint.digest ||
    proof.case.expectedCadArtifact.bytes !== stepBytes.byteLength
  ) {
    throw integrity(
      "The reopened canonical STEP does not match the sealed mechanical proof.",
    );
  }
  const capture = await readEvaluationCapture(
    dependencies,
    evaluationArtifact,
    proof,
    execution,
  );
  const requirementIds = uniqueRequirementTraces(proof, snapshot);
  const expected = evaluationsFromStaticProofOracle(
    capture.outcomes,
    proof.case.requirements,
    {
      verdictCaptureFp: evaluationArtifact.fingerprint.digest,
      evaluatedAt: evaluationArtifact.freshness.changedAt,
      evidenceArtifactId: evaluationArtifact.id,
      observationIds: proof.case.requirements.map((requirement) =>
        `calculix-isolated-observation-${resultArtifact.fingerprint.digest}-${requirement.id}`
      ),
      threadRequirementIds: requirementIds,
      evaluator: {
        serverId: "syson",
        tool: "syson_constraint_evaluate",
        runId: `capture:${evaluationArtifact.fingerprint.digest}`,
      },
    },
  );
  const criteria = exactCriteria(
    snapshot,
    proof,
    expected,
    evaluationArtifact,
    requirementIds,
  );
  const basisFingerprint = await sha256Fingerprint(snapshot);
  const acceptanceEligible = criteria.every((criterion) => criterion.status === "pass");
  return Object.freeze({
    family: STATIC_MECHANICAL_EVALUATION_FAMILY,
    projectId: project.project.id,
    subjectId: basis.subjectId,
    basis: {
      snapshotId: basis.snapshotId,
      revision: basis.revision,
      fingerprint: basisFingerprint,
    },
    feaRun: run,
    canonicalStep: stepArtifact,
    sealedProof: proofArtifact,
    executionEvidence: executionArtifact,
    evaluationCapture: evaluationArtifact,
    criteria: Object.freeze(criteria),
    proofLimitations: Object.freeze({
      proofScope: proof.case.scope,
      evidenceBoundary: proof.case.evidenceBoundary,
      cadEngineeringBoundary: proof.case.cadSource.engineeringBoundary,
    }),
    acceptanceEligible,
    rejectionDisposition: acceptanceEligible ? "none" : "mechanical-review-required",
  });
}

function selectExactCompletedFeaRun(
  project: EngineeringProjectSnapshot,
  basis: EngineeringThreadSnapshotBasis,
  snapshot: ThreadSnapshot,
): EngineeringAgentRun {
  const expectedSnapshot = {
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    subjectId: snapshot.subject.id,
  };
  const candidates = project.agentRuns.filter((run) => {
    const work = project.workItems.find((item) => item.id === run.workItemId);
    return run.status === "completed" &&
      work?.operation?.id === VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION.id &&
      work.operation.version === VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION.version &&
      deterministicJson(run.resultSnapshot) === deterministicJson(expectedSnapshot);
  });
  if (candidates.length === 0) {
    throw notFound(
      "No completed verify.run-fea-static-proof@3 result is the exact current Thread tip.",
    );
  }
  if (candidates.length !== 1) {
    throw ambiguous(
      "More than one completed static FEA run claims the exact current Thread tip.",
    );
  }
  const run = candidates[0]!;
  const work = project.workItems.find((item) => item.id === run.workItemId);
  const localOperation = {
    serverId: "digital-thread",
    tool: LOCAL_FEA_TOOL,
    runId: run.id,
  };
  try {
    assertExactCompletedStaticProofProjectBinding({
      runStatus: run.status,
      resultSnapshot: run.resultSnapshot,
      evidenceRefs: run.evidenceRefs,
      workItemStatus: work?.status,
      workItemEvidenceRefs: work?.evidenceRefs,
      expectedSnapshot,
      expectedEvidenceRefs: exactStaticProofEvidenceRefs(snapshot, localOperation),
    });
  } catch (error) {
    throw integrity(describe(error));
  }
  if (
    run.basis?.kind !== "thread-snapshot" ||
    run.basis.subjectId !== basis.subjectId ||
    run.basis.snapshotId === "latest"
  ) {
    throw integrity(
      "The completed static FEA run does not retain an exact Thread basis.",
    );
  }
  return run;
}

function assertArtifacts(
  snapshot: ThreadSnapshot,
  localOperation: ThreadOperationRef,
): readonly ThreadArtifact[] {
  try {
    return assertExactStaticProofLocalArtifacts(snapshot, localOperation);
  } catch (error) {
    throw integrity(describe(error));
  }
}

function selectProofArtifact(
  snapshot: ThreadSnapshot,
  evaluationArtifact: ThreadArtifact,
): ThreadArtifact {
  const candidates = evaluationArtifact.inputArtifactIds.map((id) =>
    snapshot.artifacts.find((artifact) => artifact.id === id)
  ).filter((artifact): artifact is ThreadArtifact =>
    !!artifact && artifact.producer.tool === PROOF_SEAL_TOOL &&
    artifact.kind === "document"
  );
  return uniqueArtifact(
    candidates,
    () => true,
    "sealed proof referenced by L4 capture",
  );
}

async function readSealedProof(
  artifacts: Pick<RecordedAnalysisCasReader, "readArtifact">,
  artifact: ThreadArtifact,
): Promise<SealedStaticProofCapture> {
  let opened;
  try {
    opened = await artifacts.readArtifact(artifact);
  } catch (error) {
    throw integrity(`The sealed proof CAS read failed: ${describe(error)}`);
  }
  if (
    !opened || opened.uri !== artifact.uri || opened.mediaType !== artifact.mediaType ||
    opened.sha256 !== artifact.fingerprint.digest ||
    opened.byteCount !== opened.bytes.byteLength ||
    await fingerprintResourceBytes(opened.bytes) !== artifact.fingerprint.digest
  ) {
    throw integrity(
      "The sealed proof CAS bytes do not match the exact Thread artifact.",
    );
  }
  try {
    return await parseSealedStaticProofCapture(opened.bytes);
  } catch (error) {
    throw integrity(
      `The sealed proof is not a canonical mechanical proof capture: ${
        describe(error)
      }`,
    );
  }
}

function assertProofIdentity(
  project: EngineeringProjectSnapshot,
  basis: EngineeringThreadSnapshotBasis,
  artifact: ThreadArtifact,
  proof: SealedStaticProofCapture,
): void {
  if (
    proof.case.project.id !== project.project.id ||
    proof.case.project.subjectId !== basis.subjectId ||
    proof.trustedRunId !== artifact.producer.runId ||
    artifact.producer.tool !== PROOF_SEAL_TOOL ||
    artifact.producer.serverId !== "digital-thread"
  ) {
    throw integrity(
      "The sealed proof is foreign to the exact project, subject, or producer run.",
    );
  }
}

function exactArtifact(
  snapshot: ThreadSnapshot,
  id: string,
  digest: string,
  producerRunId: string,
  label: string,
): ThreadArtifact {
  const candidates = snapshot.artifacts.filter((artifact) => artifact.id === id);
  if (candidates.length === 0) {
    throw notFound(`The ${label} named by the sealed proof is absent.`);
  }
  if (candidates.length !== 1) {
    throw ambiguous(`The ${label} named by the sealed proof is ambiguous.`);
  }
  const artifact = candidates[0]!;
  if (
    artifact.fingerprint.algorithm !== "sha256" ||
    artifact.fingerprint.digest !== digest ||
    artifact.producer.runId !== producerRunId
  ) {
    throw integrity(`The ${label} identity does not match the sealed proof.`);
  }
  return artifact;
}

function assertProofInputs(
  proofArtifact: ThreadArtifact,
  proof: SealedStaticProofCapture,
  step: ThreadArtifact,
  geometry: ThreadArtifact,
  requirements: ThreadArtifact,
): void {
  const expected = [proof.geometry.id, proof.requirements.id, proof.step.id].sort();
  if (
    deterministicJson([...proofArtifact.inputArtifactIds].sort()) !==
      deterministicJson(expected) ||
    proof.case.expectedCadArtifact.sha256 !== step.fingerprint.digest ||
    proof.case.expectedCadArtifact.bytes !== proof.step.bytes ||
    geometry.id !== proof.geometry.id || requirements.id !== proof.requirements.id
  ) {
    throw integrity(
      "The sealed proof, canonical STEP, geometry, and requirements do not cross-attest.",
    );
  }
}

async function readCanonicalStep(
  assets: CanonicalAssetReader,
  step: ThreadArtifact,
  proof: SealedStaticProofCapture,
): Promise<Uint8Array> {
  let bytes: Uint8Array;
  try {
    bytes = await assets.read(step.fingerprint.digest);
  } catch (error) {
    throw notFound(`The canonical STEP cannot be reopened: ${describe(error)}`);
  }
  if (
    bytes.byteLength !== proof.step.bytes ||
    await fingerprintResourceBytes(bytes) !== step.fingerprint.digest
  ) {
    throw integrity("The reopened canonical STEP bytes diverge from the sealed proof.");
  }
  return Uint8Array.from(bytes);
}

async function readEvaluationCapture(
  dependencies: StaticMechanicalCloseoutEvidenceResolverDependencies,
  artifact: ThreadArtifact,
  proof: SealedStaticProofCapture,
  execution: NonNullable<
    Awaited<ReturnType<CalculixIsolatedExecutionEvidenceStore["read"]>>
  >,
): Promise<{
  readonly outcomes: ReturnType<typeof parseCapturedFeaConstraintOracleOutcome>;
}> {
  let opened;
  try {
    opened = await dependencies.evaluationCaptures.read(artifact.fingerprint);
  } catch (error) {
    throw integrity(`The L4 evaluation capture read failed: ${describe(error)}`);
  }
  if (!opened) throw notFound("The exact L4 evaluation capture is unavailable.");
  const bytes = opened.copy();
  if (await fingerprintResourceBytes(bytes) !== artifact.fingerprint.digest) {
    throw integrity("The L4 evaluation capture bytes fail their exact fingerprint.");
  }
  let text: string;
  let capture: ReturnType<typeof validateFeaSysonEvaluationCapture>;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    capture = validateFeaSysonEvaluationCapture(JSON.parse(text));
  } catch (error) {
    throw integrity(`The L4 evaluation capture is invalid JSON: ${describe(error)}`);
  }
  const expectedRequest = prepareFeaConstraintOracleCall(
    proof.case.requirements,
    buildOracleValues({
      maxDisplacement: execution.result.metrics.maximumDisplacement,
      maxVonMises: execution.result.metrics.maximumVonMises,
    }, proof.case.requirements),
  );
  if (
    canonicalFeaSysonEvaluationCaptureText(capture) !== text ||
    deterministicJson(capture.request) !== deterministicJson(expectedRequest)
  ) {
    throw integrity("The L4 evaluation capture is not canonical.");
  }
  return {
    outcomes: parseCapturedFeaConstraintOracleOutcome(
      capture.response.structuredContent,
      proof.case.requirements,
    ),
  };
}

function uniqueRequirementTraces(
  proof: SealedStaticProofCapture,
  snapshot: ThreadSnapshot,
): ReadonlyMap<string, string> {
  try {
    return uniqueStaticProofRequirementTraces(
      proof.case.requirements,
      snapshot,
      proof.requirements.id,
    );
  } catch (error) {
    throw integrity(describe(error));
  }
}

function exactCriteria(
  snapshot: ThreadSnapshot,
  proof: SealedStaticProofCapture,
  expected: readonly RequirementEvaluation[],
  evaluationArtifact: ThreadArtifact,
  threadRequirementIds: ReadonlyMap<string, string>,
): StaticMechanicalCloseoutCriterion[] {
  if (expected.length !== proof.case.requirements.length) {
    throw integrity(
      "The L4 evaluation does not cover every declared mechanical criterion.",
    );
  }
  return proof.case.requirements.map((requirement, index) => {
    const evaluated = expected[index];
    const threadRequirementId = threadRequirementIds.get(requirement.id);
    if (threadRequirementId === undefined) {
      throw integrity(
        `Proof requirement ${requirement.id} has no unique Thread requirement.`,
      );
    }
    const expectedId = requirementEvaluationIdentity({
      requirementId: threadRequirementId,
      evidenceFingerprint: evaluationArtifact.fingerprint,
    }).id;
    if (!evaluated || evaluated.id !== expectedId) {
      throw integrity("The L4 evaluation criteria are not in sealed-proof order.");
    }
    const matches = snapshot.evaluations.filter((item) => item.id === evaluated.id);
    if (matches.length === 0) {
      throw notFound(`The L4 evaluation for ${requirement.id} is absent.`);
    }
    if (matches.length !== 1) {
      throw ambiguous(`The L4 evaluation for ${requirement.id} is ambiguous.`);
    }
    const actual = matches[0]!;
    if (
      actual.freshness.status !== "fresh" ||
      deterministicJson(actual) !== deterministicJson(evaluated) ||
      actual.evidenceArtifactIds.length !== 1 ||
      actual.evidenceArtifactIds[0] !== evaluationArtifact.id
    ) {
      throw integrity(
        `The L4 evaluation for ${requirement.id} does not exactly bind the current FEA evidence.`,
      );
    }
    return {
      proofCriterionId: requirement.id,
      evaluationId: actual.id,
      status: actual.status,
      evidenceArtifactId: evaluationArtifact.id,
    };
  });
}

function uniqueArtifact(
  values: readonly ThreadArtifact[],
  predicate: (artifact: ThreadArtifact) => boolean,
  label: string,
): ThreadArtifact {
  const matches = values.filter(predicate);
  if (matches.length === 0) throw notFound(`The exact ${label} is absent.`);
  if (matches.length !== 1) throw ambiguous(`The exact ${label} is ambiguous.`);
  return matches[0]!;
}

function artifactIdentity(artifact: ThreadArtifact) {
  return {
    id: artifact.id,
    fingerprint: artifact.fingerprint,
    producerRunId: artifact.producer.runId,
  };
}

function assertFresh(artifact: ThreadArtifact, label: string): void {
  if (artifact.freshness.status !== "fresh") {
    throw stale(`The ${label} is ${artifact.freshness.status}, not fresh.`);
  }
}

function notFound(message: string): StaticMechanicalCloseoutResolutionError {
  return new StaticMechanicalCloseoutResolutionError("not-found", message);
}

function ambiguous(message: string): StaticMechanicalCloseoutResolutionError {
  return new StaticMechanicalCloseoutResolutionError("ambiguous", message);
}

function stale(message: string): StaticMechanicalCloseoutResolutionError {
  return new StaticMechanicalCloseoutResolutionError("stale", message);
}

function integrity(message: string): StaticMechanicalCloseoutResolutionError {
  return new StaticMechanicalCloseoutResolutionError("integrity", message);
}

function describe(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}
