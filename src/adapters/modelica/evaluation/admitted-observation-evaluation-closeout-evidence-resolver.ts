/**
 * Exact, provider-free reopening of the unique current L4 admitted Modelica
 * evaluation for an L5 closeout. Review and execution share this recross.
 *
 * It never calls OMC or SysON, never infers accept/reject from an L4 status,
 * and never chooses an L4 document by array order.
 */

import type { AdmittedObservationEvaluationCaptureStore } from "../../../application/ports/out/modelica/evaluation/admitted-observation-evaluation-capture-store.ts";
import type { ThermalMethodSheetStore } from "../../../application/ports/out/modelica/thermal-method-sheet-store.ts";
import {
  type AdmittedObservationEvaluationCloseoutAdmission,
  type AdmittedObservationEvaluationCloseoutConsequence,
  MODELICA_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_SCHEMA,
  validateAdmittedObservationEvaluationCloseoutAdmission,
} from "../../../domain/modelica/evaluation/admitted-observation-evaluation-closeout-proposal.ts";
import { VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION } from "../../../domain/modelica/evaluation/admitted-observation-evaluation-proposal.ts";
import {
  fingerprintModelicaThermalMethodSheet,
  type ModelicaThermalMethodSheet,
} from "../../../domain/modelica/thermal-method-sheet.ts";
import {
  selectUniqueThreadRequirementByPair,
  threadRequirementMatchesSheetPair,
} from "../../../domain/modelica/evaluation/admitted-observation-evaluation.ts";
import { VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION } from "../../../domain/modelica/thermal-method-sheet-proposal.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type { OracleRequirement } from "../../../domain/kernel/proof-case.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
} from "../../../domain/project/engineering-project.ts";
import { requirementEvaluationIdentity } from "../../../domain/thread/requirement-evaluation-identity.ts";
import {
  archivedRefKeys,
  type RequirementEvaluation,
  type RequirementEvaluationStatus,
  type ThreadArtifact,
  type ThreadSnapshot,
  type TracedRequirement,
} from "../../../domain/thread/thread-snapshot.ts";
import {
  type ParsedOracleResult,
  parseOracleOutcome,
  parseOracleStatusIdentities,
} from "../../shared/syson-constraint-oracle-outcome.ts";
import {
  ADMITTED_OBSERVATION_EVALUATION_CAPTURE_URI_PREFIX,
  type AdmittedObservationEvaluationCapture,
  canonicalAdmittedObservationEvaluationCaptureText,
  validateAdmittedObservationEvaluationCapture,
} from "./admitted-observation-evaluation-capture.ts";
import { ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_LIMITS } from "./admitted-observation-evaluation-closeout-capture.ts";
import {
  MODELICA_THERMAL_METHOD_SHEET_SEAL_CAPTURE_URI_PREFIX,
  validateModelicaThermalMethodSheetSealCapture,
} from "../thermal-method-sheet/thermal-method-sheet-seal-capture.ts";

const L4_TOOL =
  `${VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION.id}@${VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION.version}` as const;
const METHOD_SHEET_SEAL_TOOL =
  `${VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION.id}@${VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION.version}` as const;
const L4_ARTIFACT_ID_PREFIX = "modelica-admitted-observation-evaluation-" as const;
const METHOD_SHEET_ARTIFACT_ID_PREFIX = "modelica-thermal-method-sheet-seal-" as const;

export type AdmittedModelicaEvaluationCloseoutResolutionCode =
  | "not-found"
  | "ambiguous"
  | "stale"
  | "integrity";

export class AdmittedModelicaEvaluationCloseoutResolutionError extends Error {
  constructor(
    readonly code: AdmittedModelicaEvaluationCloseoutResolutionCode,
    message: string,
  ) {
    super(message);
    this.name = "AdmittedModelicaEvaluationCloseoutResolutionError";
  }
}

export interface CloseoutSheetCaptureStore {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export interface AdmittedModelicaEvaluationCloseoutEvidenceResolverDependencies {
  readonly sheets: Pick<ThermalMethodSheetStore, "read">;
  readonly evaluationCaptures: Pick<
    AdmittedObservationEvaluationCaptureStore,
    "read"
  >;
  readonly sheetCaptures: CloseoutSheetCaptureStore;
}

export interface AdmittedModelicaEvaluationCloseoutResolvedEvidence {
  readonly projectId: string;
  readonly subjectId: string;
  readonly basis: AdmittedObservationEvaluationCloseoutAdmission["basis"];
  readonly l4Run: EngineeringAgentRun;
  readonly captureArtifact: ThreadArtifact;
  readonly capture: AdmittedObservationEvaluationCapture;
  readonly sheet: AdmittedObservationEvaluationCloseoutAdmission["sheet"];
  readonly sheetArtifact: ThreadArtifact;
  readonly methodSheet: ModelicaThermalMethodSheet;
  readonly evaluations: readonly {
    readonly id: string;
    readonly requirementId: string;
    readonly status: RequirementEvaluation["status"];
    readonly evidenceArtifactId: string;
    readonly observationIds: readonly string[];
    readonly message: string;
    readonly comparison?: RequirementEvaluation["comparison"];
    readonly output: {
      readonly modelSymbolId: string;
      readonly role: "final" | "max_abs";
      readonly declaredUnit: string;
      readonly limitation: string;
    };
  }[];
  readonly limitations: {
    readonly engineCalls: "none";
    readonly l4PassIsNotL5: true;
    readonly sheetScope: string;
    readonly sheetLimitations: string;
  };
}

export function admittedModelicaEvaluationCloseoutAdmission(
  resolved: AdmittedModelicaEvaluationCloseoutResolvedEvidence,
  consequence: AdmittedObservationEvaluationCloseoutConsequence,
): AdmittedObservationEvaluationCloseoutAdmission {
  return validateAdmittedObservationEvaluationCloseoutAdmission({
    schemaVersion: MODELICA_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_SCHEMA,
    consequence,
    projectId: resolved.projectId,
    subjectId: resolved.subjectId,
    basis: resolved.basis,
    sheet: resolved.sheet,
    capture: {
      id: resolved.captureArtifact.id,
      fingerprint: resolved.captureArtifact.fingerprint,
    },
  });
}

export async function resolveAdmittedModelicaEvaluationCloseoutEvidence(
  dependencies: AdmittedModelicaEvaluationCloseoutEvidenceResolverDependencies,
  input: {
    readonly project: EngineeringProjectSnapshot;
    readonly basis: EngineeringThreadSnapshotBasis;
    readonly snapshot: ThreadSnapshot;
  },
): Promise<AdmittedModelicaEvaluationCloseoutResolvedEvidence> {
  const { project, basis, snapshot } = input;
  if (
    snapshot.id !== basis.snapshotId || snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId ||
    project.project.subjectId !== basis.subjectId
  ) {
    throw integrity(
      "The requested admitted Modelica closeout basis is not the exact project Thread snapshot.",
    );
  }
  const captureArtifact = selectUniqueL4Document(snapshot);
  const l4Run = selectAttachedProducerRun(project, basis, snapshot, captureArtifact);
  const capture = await reopenL4Capture(dependencies, captureArtifact);
  const sheetArtifact = await recrossNamedMethodSheet(
    dependencies,
    snapshot,
    captureArtifact,
  );
  const methodSheet = await recrossSheetIdentity(
    dependencies,
    project,
    basis,
    sheetArtifact,
  );
  const evaluations = exactEvaluations(
    snapshot,
    captureArtifact,
    capture,
    methodSheet.sheet,
  );
  const basisFingerprint = await sha256Fingerprint(snapshot);
  return Object.freeze({
    projectId: project.project.id,
    subjectId: basis.subjectId,
    basis: {
      snapshotId: basis.snapshotId,
      revision: basis.revision,
      fingerprint: basisFingerprint,
    },
    l4Run,
    captureArtifact,
    capture,
    sheet: {
      id: methodSheet.sheet.id,
      fingerprint: methodSheet.fingerprint,
    },
    sheetArtifact,
    methodSheet: methodSheet.sheet,
    evaluations: Object.freeze(evaluations),
    limitations: Object.freeze({
      ...ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_LIMITS,
      sheetScope: methodSheet.sheet.scope,
      sheetLimitations: methodSheet.sheet.limitations,
    }),
  });
}

function selectUniqueL4Document(snapshot: ThreadSnapshot): ThreadArtifact {
  const archived = archivedRefKeys(snapshot);
  const shaped = snapshot.artifacts.filter(isShapedL4Document);
  const wrongProducer = shaped.filter((artifact) => !isExactL4Producer(artifact));
  if (
    wrongProducer.length > 0 && shaped.every((artifact) => !isExactL4Producer(artifact))
  ) {
    throw integrity(
      "The named Thread artifact is not the exact L4 admitted observation evaluation producer.",
    );
  }
  const exact = shaped.filter(isExactL4Producer);
  const fresh = exact.filter((artifact) =>
    artifact.freshness.status === "fresh" &&
    !archived.has(`artifact:${artifact.id}`)
  );
  if (fresh.length === 1) return fresh[0]!;
  if (fresh.length > 1) {
    throw ambiguous(
      `The current Thread tip has ${fresh.length} fresh digital-thread ${L4_TOOL} documents and is therefore ambiguous; the server will not choose one.`,
    );
  }
  if (exact.length > 0) {
    throw stale("The L4 admitted observation evaluation is stale, not fresh.");
  }
  throw notFound(
    "The current Thread tip has no fresh digital-thread verify.evaluate-admitted-modelica-observations@1 document; the exact L4 evaluation is unavailable.",
  );
}

function isShapedL4Document(artifact: ThreadArtifact): boolean {
  const digest = artifact.fingerprint.digest;
  return artifact.kind === "document" &&
    artifact.fingerprint.algorithm === "sha256" &&
    artifact.id === `${L4_ARTIFACT_ID_PREFIX}${digest}` &&
    artifact.version === digest;
}

function isExactL4Producer(artifact: ThreadArtifact): boolean {
  return artifact.producer.serverId === "digital-thread" &&
    artifact.producer.tool === L4_TOOL;
}

function selectAttachedProducerRun(
  project: EngineeringProjectSnapshot,
  basis: EngineeringThreadSnapshotBasis,
  snapshot: ThreadSnapshot,
  artifact: ThreadArtifact,
): EngineeringAgentRun {
  const expectedSnapshot = {
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    subjectId: snapshot.subject.id,
  };
  const declared = project.threadSnapshots.filter((reference) =>
    reference.snapshotId === expectedSnapshot.snapshotId &&
    reference.revision === expectedSnapshot.revision &&
    reference.subjectId === expectedSnapshot.subjectId
  );
  if (declared.length === 0) {
    throw integrity(
      "The L4 evaluation result snapshot is not declared on the exact engineering project Thread.",
    );
  }
  if (declared.length !== 1) {
    throw ambiguous(
      "The L4 evaluation result snapshot is ambiguously declared on the engineering project Thread.",
    );
  }
  const expectedEvidenceRef = uniquePrimaryL4EvidenceRef(snapshot, artifact);
  const named = project.agentRuns.filter((run) => run.id === artifact.producer.runId);
  if (named.length === 0) {
    throw integrity(
      "The L4 evaluation producer run is unattached to the exact engineering project.",
    );
  }
  if (named.length !== 1) {
    throw ambiguous(
      "The L4 evaluation producer run id is attached more than once.",
    );
  }
  const run = named[0]!;
  const work = project.workItems.find((item) => item.id === run.workItemId);
  if (
    run.status !== "completed" ||
    deterministicJson(run.resultSnapshot) !== deterministicJson(expectedSnapshot)
  ) {
    throw integrity(
      "The L4 evaluation producer run is foreign to the exact current Thread tip.",
    );
  }
  if (
    work?.operation?.id !==
      VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION.id ||
    work.operation.version !==
      VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION.version
  ) {
    throw integrity(
      "The L4 evaluation producer run is foreign to verify.evaluate-admitted-modelica-observations@1.",
    );
  }
  if (work.status !== "completed") {
    throw integrity(
      "The L4 evaluation work item is not completed; the artifact is not a finished attachment.",
    );
  }
  assertExactPrimaryEvidenceRefs(run.evidenceRefs, expectedEvidenceRef, "run");
  assertExactPrimaryEvidenceRefs(work.evidenceRefs, expectedEvidenceRef, "work item");
  if (
    run.basis?.kind !== "thread-snapshot" ||
    run.basis.subjectId !== basis.subjectId ||
    run.basis.snapshotId === "latest"
  ) {
    throw integrity("The completed L4 run does not retain an exact Thread basis.");
  }
  return run;
}

function uniquePrimaryL4EvidenceRef(
  snapshot: ThreadSnapshot,
  artifact: ThreadArtifact,
): EngineeringThreadEntityRef {
  return {
    snapshotId: snapshot.id,
    snapshotRevision: snapshot.revision,
    kind: "artifact",
    id: artifact.id,
  };
}

function assertExactPrimaryEvidenceRefs(
  refs: readonly EngineeringThreadEntityRef[] | undefined,
  expected: EngineeringThreadEntityRef,
  label: "run" | "work item",
): void {
  const actual = refs ?? [];
  if (actual.length === 0) {
    throw integrity(
      `The completed L4 ${label} is missing its exact primary evaluation artifact evidence ref.`,
    );
  }
  if (actual.length !== 1) {
    throw ambiguous(
      `The completed L4 ${label} has an ambiguous ${actual.length} evidence refs; the L4 topology attaches exactly one primary artifact.`,
    );
  }
  if (deterministicJson(actual[0]) !== deterministicJson(expected)) {
    throw integrity(
      `The completed L4 ${label} evidence ref is foreign to the exact L4 evaluation artifact and current Thread tip.`,
    );
  }
}

async function reopenL4Capture(
  dependencies: AdmittedModelicaEvaluationCloseoutEvidenceResolverDependencies,
  artifact: ThreadArtifact,
): Promise<AdmittedObservationEvaluationCapture> {
  const expectedUri =
    `${ADMITTED_OBSERVATION_EVALUATION_CAPTURE_URI_PREFIX}sha256/${artifact.fingerprint.digest}`;
  if (artifact.uri !== expectedUri) {
    throw integrity(
      "The L4 evaluation capture URI is not the canonical content-addressed capture URI.",
    );
  }
  const stored = await dependencies.evaluationCaptures.read(artifact.fingerprint);
  if (stored === undefined) {
    throw notFound(
      "The exact L4 admitted observation evaluation capture is unavailable.",
    );
  }
  let capture: AdmittedObservationEvaluationCapture;
  try {
    capture = validateAdmittedObservationEvaluationCapture(JSON.parse(stored));
  } catch {
    throw integrity(
      "The named capture is not an L4 admitted observation evaluation capture.",
    );
  }
  const fingerprint = await sha256Fingerprint(capture);
  if (
    stored !== canonicalAdmittedObservationEvaluationCaptureText(capture) ||
    !fingerprintsEqual(fingerprint, artifact.fingerprint)
  ) {
    throw integrity(
      "The reopened L4 evaluation capture fingerprint does not match the Thread artifact.",
    );
  }
  return capture;
}

async function recrossNamedMethodSheet(
  dependencies: AdmittedModelicaEvaluationCloseoutEvidenceResolverDependencies,
  snapshot: ThreadSnapshot,
  l4Artifact: ThreadArtifact,
): Promise<ThreadArtifact> {
  const archived = archivedRefKeys(snapshot);
  const named = l4Artifact.inputArtifactIds.map((id) =>
    snapshot.artifacts.find((artifact) => artifact.id === id)
  ).filter((artifact): artifact is ThreadArtifact => artifact !== undefined);
  const matches = named.filter((artifact) =>
    isCanonicalMethodSheet(artifact) && !archived.has(`artifact:${artifact.id}`)
  );
  if (matches.length === 0) {
    throw notFound(
      "The exact sealed thermal method sheet named by the L4 lineage is unavailable.",
    );
  }
  if (matches.length !== 1) {
    throw ambiguous(
      "The L4 lineage names more than one thermal method-sheet seal; the server will not choose one.",
    );
  }
  const artifact = matches[0]!;
  recrossMethodSheetConsumption(snapshot, l4Artifact, artifact);
  const stored = await dependencies.sheetCaptures.read(artifact.fingerprint);
  if (stored === undefined) {
    throw notFound("The sealed thermal method-sheet capture is unavailable.");
  }
  let capture;
  try {
    capture = validateModelicaThermalMethodSheetSealCapture(JSON.parse(stored));
  } catch (error) {
    throw integrity(
      `The sealed thermal method-sheet capture is not exact: ${describe(error)}`,
    );
  }
  const fingerprint = await sha256Fingerprint(capture);
  if (
    stored !== deterministicJson(capture) ||
    !fingerprintsEqual(fingerprint, artifact.fingerprint) ||
    artifact.uri !==
      `${MODELICA_THERMAL_METHOD_SHEET_SEAL_CAPTURE_URI_PREFIX}${artifact.fingerprint.digest}`
  ) {
    throw integrity(
      "The sealed thermal method-sheet capture does not rehash to its Thread artifact.",
    );
  }
  return artifact;
}

function isCanonicalMethodSheet(artifact: ThreadArtifact): boolean {
  const digest = artifact.fingerprint.digest;
  return artifact.kind === "document" &&
    artifact.freshness.status === "fresh" &&
    artifact.fingerprint.algorithm === "sha256" &&
    artifact.id === `${METHOD_SHEET_ARTIFACT_ID_PREFIX}${digest}` &&
    artifact.version === digest &&
    artifact.producer.serverId === "digital-thread" &&
    artifact.producer.tool === METHOD_SHEET_SEAL_TOOL;
}

function recrossMethodSheetConsumption(
  snapshot: ThreadSnapshot,
  l4Artifact: ThreadArtifact,
  sheetArtifact: ThreadArtifact,
): void {
  uniqueProvenance(
    snapshot,
    "derived_from",
    { kind: "artifact", id: l4Artifact.id },
    { kind: "artifact", id: sheetArtifact.id },
    `derived-from-${sheetArtifact.id}-by-${l4Artifact.id}`,
  );
  const expectedId = `consume-${sheetArtifact.id}-by-${l4Artifact.id}`;
  const matches = snapshot.consumptions.filter((consumption) =>
    consumption.artifactId === sheetArtifact.id &&
    consumption.consumer.serverId === l4Artifact.producer.serverId &&
    consumption.consumer.tool === l4Artifact.producer.tool &&
    consumption.consumer.runId === l4Artifact.producer.runId
  );
  if (matches.length === 0) {
    throw integrity(
      "The L4 evaluation is missing its verified consumption of the sealed thermal method sheet.",
    );
  }
  if (matches.length !== 1) {
    throw ambiguous(
      "The L4 evaluation has an ambiguous sealed thermal method-sheet consumption; the server will not choose one.",
    );
  }
  const consumption = matches[0]!;
  if (
    consumption.id !== expectedId ||
    consumption.status !== "verified" ||
    !fingerprintsEqual(consumption.observedFingerprint, sheetArtifact.fingerprint) ||
    consumption.verifiedAt !== l4Artifact.freshness.changedAt
  ) {
    throw integrity(
      "The L4 method-sheet consumption does not recross the exact consumer, fingerprint, time, and topology.",
    );
  }
  const uses = snapshot.provenance.filter((link) =>
    link.relation === "uses" &&
    link.from.kind === "consumption" &&
    link.from.id === consumption.id &&
    link.to.kind === "artifact" &&
    link.to.id === sheetArtifact.id
  );
  if (uses.length === 0) {
    throw integrity(
      "The L4 method-sheet consumption is missing its uses provenance link.",
    );
  }
  if (uses.length !== 1) {
    throw ambiguous(
      "The L4 method-sheet consumption has ambiguous uses provenance.",
    );
  }
}

async function recrossSheetIdentity(
  dependencies: AdmittedModelicaEvaluationCloseoutEvidenceResolverDependencies,
  project: EngineeringProjectSnapshot,
  basis: EngineeringThreadSnapshotBasis,
  sheetArtifact: ThreadArtifact,
): Promise<{
  readonly sheet: ModelicaThermalMethodSheet;
  readonly fingerprint: ContentFingerprint;
}> {
  const stored = await dependencies.sheetCaptures.read(sheetArtifact.fingerprint);
  if (stored === undefined) {
    throw notFound("The sealed thermal method-sheet capture is unavailable.");
  }
  const capture = validateModelicaThermalMethodSheetSealCapture(JSON.parse(stored));
  const sheet = await dependencies.sheets.read(capture.sheet.fingerprint);
  if (!sheet) {
    throw notFound("The exact thermal method sheet is unavailable.");
  }
  const sheetFingerprint = await fingerprintModelicaThermalMethodSheet(sheet);
  if (
    sheet.id !== capture.sheet.id ||
    !fingerprintsEqual(sheetFingerprint, capture.sheet.fingerprint)
  ) {
    throw integrity(
      "The reopened thermal method sheet does not match the sealed L4 lineage.",
    );
  }
  if (
    sheet.project.id !== project.project.id ||
    sheet.subject.id !== basis.subjectId ||
    sheet.project.subjectId !== basis.subjectId
  ) {
    throw integrity(
      "The sealed thermal method sheet is foreign to the requested project or subject.",
    );
  }
  return { sheet, fingerprint: sheetFingerprint };
}

function exactEvaluations(
  snapshot: ThreadSnapshot,
  captureArtifact: ThreadArtifact,
  capture: AdmittedObservationEvaluationCapture,
  sheet: ModelicaThermalMethodSheet,
): AdmittedModelicaEvaluationCloseoutResolvedEvidence["evaluations"] {
  const outcomes = captureOutcomes(capture, snapshot, sheet);
  const evidencing = snapshot.evaluations.filter((evaluation) =>
    evaluation.evidenceArtifactIds.length === 1 &&
    evaluation.evidenceArtifactIds[0] === captureArtifact.id
  );
  const byRequirement = new Map<string, RequirementEvaluation>();
  for (const evaluation of evidencing) {
    if (byRequirement.has(evaluation.requirementId)) {
      throw ambiguous(
        `The L4 capture is evidenced by duplicate Thread evaluations of ${evaluation.requirementId}.`,
      );
    }
    byRequirement.set(evaluation.requirementId, evaluation);
  }
  if (evidencing.length !== outcomes.size) {
    throw integrity(
      evidencing.length > outcomes.size
        ? "The Thread has extra L4 evaluations that are not in the exact capture outcomes."
        : "The Thread is missing L4 evaluations required by the exact capture outcomes.",
    );
  }
  const constraintIds = [...outcomes.keys()].sort();
  return constraintIds.map((constraintId) => {
    const outcome = outcomes.get(constraintId)!;
    const evaluation = byRequirement.get(outcome.requirement.id);
    if (!evaluation) {
      throw integrity(
        `The Thread is missing the L4 evaluation for capture outcome ${constraintId}.`,
      );
    }
    recrossEvaluationTopology(
      snapshot,
      captureArtifact,
      evaluation,
      outcome.requirement,
      outcome.result,
    );
    const output = uniqueSheetOutput(sheet, outcome.requirement);
    return {
      id: evaluation.id,
      requirementId: evaluation.requirementId,
      status: evaluation.status,
      evidenceArtifactId: captureArtifact.id,
      observationIds: evaluation.observationIds,
      message: evaluation.message,
      ...(evaluation.comparison === undefined
        ? {}
        : { comparison: evaluation.comparison }),
      output: {
        modelSymbolId: output.modelSymbolId,
        role: output.role,
        declaredUnit: output.declaredUnit,
        limitation: output.limitation,
      },
    };
  });
}

function captureOutcomes(
  capture: AdmittedObservationEvaluationCapture,
  snapshot: ThreadSnapshot,
  sheet: ModelicaThermalMethodSheet,
): ReadonlyMap<string, {
  readonly requirement: TracedRequirement;
  readonly result: ParsedOracleResult;
}> {
  let resultIdentities: ReadonlyMap<string, RequirementEvaluationStatus>;
  try {
    resultIdentities = parseOracleStatusIdentities(
      capture.response.structuredContent,
    );
  } catch (error) {
    throw integrity(
      `The L4 capture result identities are not exact: ${describe(error)}`,
    );
  }
  const unresolvedIds = new Set<string>();
  for (const item of capture.unresolved) {
    if (unresolvedIds.has(item.requirementElementId)) {
      throw integrity(
        "The L4 capture has duplicate unresolved requirement identities.",
      );
    }
    unresolvedIds.add(item.requirementElementId);
    if (resultIdentities.has(item.requirementElementId)) {
      throw integrity(
        "The L4 capture unresolved set overlaps a structuredContent result constraintId.",
      );
    }
  }
  const oracleRequirements: OracleRequirement[] = [];
  const threadByConstraint = new Map<string, TracedRequirement>();
  for (const constraintId of resultIdentities.keys()) {
    const requirement = uniqueThreadRequirement(snapshot, sheet, constraintId);
    threadByConstraint.set(constraintId, requirement);
    oracleRequirements.push(oracleRequirementFromThread(requirement, constraintId));
  }
  let parsed: ReadonlyMap<string, ParsedOracleResult>;
  try {
    parsed = parseOracleOutcome(
      capture.response.structuredContent,
      oracleRequirements,
    );
  } catch (error) {
    throw integrity(
      `The L4 capture oracle rows are not exact: ${describe(error)}`,
    );
  }
  const outcomes = new Map<string, {
    readonly requirement: TracedRequirement;
    readonly result: ParsedOracleResult;
  }>();
  for (const [constraintId, result] of parsed) {
    if (result.status !== resultIdentities.get(constraintId)) {
      throw integrity(
        `The L4 capture oracle status for ${constraintId} diverges from its identity row.`,
      );
    }
    outcomes.set(constraintId, {
      requirement: threadByConstraint.get(constraintId)!,
      result,
    });
  }
  for (const item of capture.unresolved) {
    outcomes.set(item.requirementElementId, {
      requirement: uniqueThreadRequirement(
        snapshot,
        sheet,
        item.requirementElementId,
      ),
      result: { status: "unresolved" },
    });
  }
  if (outcomes.size === 0) {
    throw integrity("The L4 capture has no evaluation status identities.");
  }
  return outcomes;
}

function uniqueThreadRequirement(
  snapshot: ThreadSnapshot,
  sheet: ModelicaThermalMethodSheet,
  identity: string,
): TracedRequirement {
  const outputs = sheet.outputs.filter((output) =>
    output.requirementElementId === identity
  );
  if (outputs.length === 0) {
    throw integrity(
      `The reopened thermal method sheet has no output mapped to capture identity ${identity}.`,
    );
  }
  if (outputs.length !== 1) {
    throw ambiguous(
      `The reopened thermal method sheet has an ambiguous output mapping for capture identity ${identity}.`,
    );
  }
  try {
    return selectUniqueThreadRequirementByPair(
      snapshot.requirements,
      outputs[0]!,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("will not choose one")) {
      throw ambiguous(message);
    }
    throw integrity(message);
  }
}

function oracleRequirementFromThread(
  requirement: TracedRequirement,
  constraintId: string,
): OracleRequirement {
  const operator = requirement.criterion.operator;
  if (operator !== "<=" && operator !== ">=") {
    throw integrity(
      `Thread requirement ${requirement.id} operator is not an oracle comparison.`,
    );
  }
  return {
    id: constraintId,
    name: requirement.name,
    metric: requirement.criterion.metric,
    operator,
    limit: requirement.criterion.limit,
  };
}

function recrossEvaluationTopology(
  snapshot: ThreadSnapshot,
  captureArtifact: ThreadArtifact,
  evaluation: RequirementEvaluation,
  requirement: TracedRequirement,
  oracleResult: ParsedOracleResult,
): void {
  const requirementId = evaluation.requirementId;
  if (
    evaluation.id !==
      requirementEvaluationIdentity({
        requirementId,
        evidenceFingerprint: captureArtifact.fingerprint,
      }).id
  ) {
    throw integrity(
      `The L4 evaluation identity ${evaluation.id} is not the exact capture outcome topology.`,
    );
  }
  if (evaluation.freshness.status !== "fresh") {
    throw stale(`The L4 evaluation ${evaluation.id} is stale, not fresh.`);
  }
  if (evaluation.status !== oracleResult.status) {
    throw integrity(
      `The L4 evaluation ${evaluation.id} status ${evaluation.status} does not equal the exact capture outcome ${oracleResult.status}.`,
    );
  }
  if (
    evaluation.evaluator.serverId !== "syson" ||
    evaluation.evaluator.tool !== "syson_constraint_evaluate" ||
    evaluation.evaluator.runId !== captureArtifact.producer.runId
  ) {
    throw integrity(
      `The L4 evaluation ${evaluation.id} evaluator is foreign to the exact capture producer run.`,
    );
  }
  recrossThreadComparison(evaluation, requirement, oracleResult);
  uniqueProvenance(
    snapshot,
    "evaluates",
    { kind: "evaluation", id: evaluation.id },
    { kind: "requirement", id: requirementId },
    `evaluates-${evaluation.id}`,
  );
  uniqueProvenance(
    snapshot,
    "evidences",
    { kind: "evaluation", id: evaluation.id },
    { kind: "artifact", id: captureArtifact.id },
    `evidences-${evaluation.id}`,
  );
  for (const observationId of evaluation.observationIds) {
    uniqueProvenance(
      snapshot,
      "uses",
      { kind: "evaluation", id: evaluation.id },
      { kind: "observation", id: observationId },
      `${evaluation.id}-uses-${observationId}`,
    );
  }
}

function recrossThreadComparison(
  evaluation: RequirementEvaluation,
  requirement: TracedRequirement,
  oracleResult: ParsedOracleResult,
): void {
  if (oracleResult.status === "pass" || oracleResult.status === "fail") {
    const comparison = evaluation.comparison;
    if (
      comparison === undefined || evaluation.observationIds.length === 0 ||
      comparison.margin === undefined
    ) {
      throw integrity(
        `The L4 evaluation ${evaluation.id} is missing the Thread comparison/observation topology required for ${oracleResult.status}.`,
      );
    }
    if (comparison.actual.value !== oracleResult.computedValue) {
      throw integrity(
        `The L4 evaluation ${evaluation.id} comparison actual does not equal the capture computedValue.`,
      );
    }
    if (comparison.limit.value !== oracleResult.threshold) {
      throw integrity(
        `The L4 evaluation ${evaluation.id} comparison limit does not equal the capture threshold.`,
      );
    }
    if (comparison.margin.value !== oracleResult.margin) {
      throw integrity(
        `The L4 evaluation ${evaluation.id} comparison margin does not equal the capture margin.`,
      );
    }
    if (
      comparison.actual.unit !== oracleResult.unit ||
      comparison.limit.unit !== oracleResult.unit ||
      comparison.margin.unit !== oracleResult.unit ||
      comparison.normalizedUnit !== oracleResult.unit
    ) {
      throw integrity(
        `The L4 evaluation ${evaluation.id} comparison units do not equal the validated capture unit.`,
      );
    }
    if (comparison.operator !== requirement.criterion.operator) {
      throw integrity(
        `The L4 evaluation ${evaluation.id} comparison operator is not the exact Thread requirement operator.`,
      );
    }
    return;
  }
  if (evaluation.comparison !== undefined) {
    throw integrity(
      `The L4 evaluation ${evaluation.id} must not carry a comparison for ${oracleResult.status}.`,
    );
  }
}

function uniqueSheetOutput(
  sheet: ModelicaThermalMethodSheet,
  requirement: TracedRequirement,
): ModelicaThermalMethodSheet["outputs"][number] {
  const matches = sheet.outputs.filter((output) =>
    threadRequirementMatchesSheetPair(requirement, output)
  );
  if (matches.length === 0) {
    throw integrity(
      `The reopened thermal method sheet has no output mapped to Thread requirement ${requirement.id}.`,
    );
  }
  if (matches.length !== 1) {
    throw ambiguous(
      `The reopened thermal method sheet has an ambiguous output mapping for Thread requirement ${requirement.id}.`,
    );
  }
  return matches[0]!;
}

function uniqueProvenance(
  snapshot: ThreadSnapshot,
  relation: "derived_from" | "evaluates" | "evidences" | "uses",
  from: { readonly kind: "artifact" | "evaluation"; readonly id: string },
  to: {
    readonly kind: "artifact" | "requirement" | "observation";
    readonly id: string;
  },
  expectedId: string,
): void {
  const matches = snapshot.provenance.filter((link) =>
    link.relation === relation &&
    link.from.kind === from.kind &&
    link.from.id === from.id &&
    link.to.kind === to.kind &&
    link.to.id === to.id
  );
  if (matches.length === 0) {
    throw integrity(
      `The L4 evaluation is missing exact ${relation} provenance ${expectedId}.`,
    );
  }
  if (matches.length !== 1) {
    throw ambiguous(
      `The L4 evaluation has duplicate ${relation} provenance; expected unique ${expectedId}.`,
    );
  }
  if (matches[0]!.id !== expectedId) {
    throw integrity(
      `The L4 ${relation} provenance id is not the exact emitted ${expectedId}.`,
    );
  }
}

function notFound(message: string): AdmittedModelicaEvaluationCloseoutResolutionError {
  return new AdmittedModelicaEvaluationCloseoutResolutionError("not-found", message);
}

function ambiguous(
  message: string,
): AdmittedModelicaEvaluationCloseoutResolutionError {
  return new AdmittedModelicaEvaluationCloseoutResolutionError("ambiguous", message);
}

function stale(message: string): AdmittedModelicaEvaluationCloseoutResolutionError {
  return new AdmittedModelicaEvaluationCloseoutResolutionError("stale", message);
}

function integrity(
  message: string,
): AdmittedModelicaEvaluationCloseoutResolutionError {
  return new AdmittedModelicaEvaluationCloseoutResolutionError("integrity", message);
}

function describe(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}
