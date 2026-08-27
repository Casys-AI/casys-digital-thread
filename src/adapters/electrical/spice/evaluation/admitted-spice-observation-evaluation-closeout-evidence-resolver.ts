/**
 * Exact, provider-free reopening of the unique current L4 admitted SPICE
 * evaluation for an L5 closeout. Review and execution share this recross.
 *
 * It never calls ngspice or SysON, never infers accept/reject from an L4
 * status, and never chooses an L4 document by array order. Unresolved L4
 * observations stay literal.
 */

import type { ElectricalObservationMethodSheetStore } from "../../../../application/ports/out/electrical/observation-method-sheet-store.ts";
import type { AdmittedSpiceObservationEvaluationCaptureStore } from "../../../../application/ports/out/electrical/spice/evaluation/admitted-spice-observation-evaluation-capture-store.ts";
import type { AdmittedSpiceObservationEvidenceReader } from "../../../../application/ports/out/electrical/spice/evaluation/admitted-spice-observation-evidence-reader.ts";
import {
  SPICE_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_SCHEMA,
  type SpiceAdmittedObservationEvaluationCloseoutAdmission,
  type SpiceAdmittedObservationEvaluationCloseoutConsequence,
  validateSpiceAdmittedObservationEvaluationCloseoutAdmission,
} from "../../../../domain/electrical/spice/evaluation/admitted-observation-evaluation-closeout-proposal.ts";
import {
  spiceDocumentaryRequirementBindings,
} from "../../../../domain/electrical/spice/evaluation/spice-documentary-requirement-binding.ts";
import { VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION } from "../../../../domain/electrical/spice/evaluation/admitted-observation-evaluation-proposal.ts";
import {
  type ElectricalObservationMethodSheet,
  fingerprintElectricalObservationMethodSheet,
} from "../../../../domain/electrical/observation-method-sheet.ts";
import { VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION } from "../../../../domain/electrical/observation-method-sheet-proposal.ts";
import { SIMULATE_RUN_ADMITTED_SPICE_OPERATION } from "../../../../domain/electrical/spice/admitted/run-proposal.ts";
import {
  METHOD_SHEET_ARTIFACT_ID_PREFIX,
  resolveAdmittedSpiceEvaluationLineage,
  SPICE_CAPTURE_ARTIFACT_ID_PREFIX,
  SPICE_EVIDENCE_ARTIFACT_ID_PREFIX,
  SPICE_RESULT_ARTIFACT_ID_PREFIX,
} from "../../../../domain/electrical/spice/evaluation/lineage.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
} from "../../../../domain/project/engineering-project.ts";
import { requirementEvaluationIdentity } from "../../../../domain/thread/requirement-evaluation-identity.ts";
import {
  archivedRefKeys,
  type RequirementEvaluation,
  type ThreadArtifact,
  type ThreadSnapshot,
} from "../../../../domain/thread/thread-snapshot.ts";
import {
  ELECTRICAL_OBSERVATION_METHOD_SHEET_SEAL_CAPTURE_URI_PREFIX,
  validateElectricalObservationMethodSheetSealCapture,
} from "../../../../domain/electrical/observation-method-sheet-seal-capture.ts";
import {
  canonicalSpiceAdmittedObservationEvaluationCaptureText,
  SPICE_ADMITTED_OBSERVATION_EVALUATION_CAPTURE_URI_PREFIX,
  type SpiceAdmittedObservationEvaluationCapture,
  validateSpiceAdmittedObservationEvaluationCapture,
} from "./admitted-spice-observation-evaluation-capture.ts";
import { SPICE_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_LIMITS } from "./admitted-spice-observation-evaluation-closeout-capture.ts";

const L4_TOOL =
  `${VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION.id}@${VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION.version}` as const;
const METHOD_SHEET_SEAL_TOOL =
  `${VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION.id}@${VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION.version}` as const;
const L3_TOOL =
  `${SIMULATE_RUN_ADMITTED_SPICE_OPERATION.id}@${SIMULATE_RUN_ADMITTED_SPICE_OPERATION.version}` as const;
const L4_ARTIFACT_ID_PREFIX = "spice-admitted-observation-evaluation-" as const;

export type AdmittedSpiceEvaluationCloseoutResolutionCode =
  | "not-found"
  | "ambiguous"
  | "stale"
  | "integrity";

export class AdmittedSpiceEvaluationCloseoutResolutionError extends Error {
  constructor(
    readonly code: AdmittedSpiceEvaluationCloseoutResolutionCode,
    message: string,
  ) {
    super(message);
    this.name = "AdmittedSpiceEvaluationCloseoutResolutionError";
  }
}

export interface CloseoutSheetCaptureStore {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export interface CloseoutSpiceCaptureStore {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export interface AdmittedSpiceEvaluationCloseoutEvidenceResolverDependencies {
  readonly sheets: Pick<ElectricalObservationMethodSheetStore, "read">;
  readonly evaluationCaptures: Pick<
    AdmittedSpiceObservationEvaluationCaptureStore,
    "read"
  >;
  readonly sheetCaptures: CloseoutSheetCaptureStore;
  readonly spiceCaptures?: CloseoutSpiceCaptureStore;
  readonly evidence: Pick<AdmittedSpiceObservationEvidenceReader, "read">;
}

export interface AdmittedSpiceEvaluationCloseoutResolvedEvidence {
  readonly projectId: string;
  readonly subjectId: string;
  readonly basis: SpiceAdmittedObservationEvaluationCloseoutAdmission["basis"];
  readonly l4Run: EngineeringAgentRun;
  readonly l3Run: EngineeringAgentRun;
  readonly captureArtifact: ThreadArtifact;
  readonly capture: SpiceAdmittedObservationEvaluationCapture;
  readonly sheet: SpiceAdmittedObservationEvaluationCloseoutAdmission["sheet"];
  readonly sheetArtifact: ThreadArtifact;
  readonly methodSheet: ElectricalObservationMethodSheet;
  readonly spiceCapture: ThreadArtifact;
  readonly evidence: ThreadArtifact;
  readonly result: ThreadArtifact;
  readonly evaluations: readonly {
    readonly id: string;
    readonly requirementId: string;
    readonly status: RequirementEvaluation["status"];
    readonly evidenceArtifactId: string;
    readonly observationIds: readonly string[];
    readonly message: string;
    readonly comparison?: RequirementEvaluation["comparison"];
    readonly criterionId: string;
  }[];
  readonly limitations: {
    readonly engineCalls: "none";
    readonly l4PassIsNotL5: true;
    readonly sheetScope: string;
    readonly sheetLimitations: string;
  };
}

export function admittedSpiceEvaluationCloseoutAdmission(
  resolved: AdmittedSpiceEvaluationCloseoutResolvedEvidence,
  consequence: SpiceAdmittedObservationEvaluationCloseoutConsequence,
): SpiceAdmittedObservationEvaluationCloseoutAdmission {
  return validateSpiceAdmittedObservationEvaluationCloseoutAdmission({
    schemaVersion: SPICE_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_SCHEMA,
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

export async function resolveAdmittedSpiceEvaluationCloseoutEvidence(
  dependencies: AdmittedSpiceEvaluationCloseoutEvidenceResolverDependencies,
  input: {
    readonly project: EngineeringProjectSnapshot;
    readonly basis: EngineeringThreadSnapshotBasis;
    readonly snapshot: ThreadSnapshot;
  },
): Promise<AdmittedSpiceEvaluationCloseoutResolvedEvidence> {
  const { project, basis, snapshot } = input;
  if (
    snapshot.id !== basis.snapshotId || snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId ||
    project.project.subjectId !== basis.subjectId
  ) {
    throw integrity(
      "The requested admitted SPICE closeout basis is not the exact project Thread snapshot.",
    );
  }
  const captureArtifact = selectUniqueL4Document(snapshot);
  const l4Run = selectAttachedProducerRun(
    project,
    basis,
    snapshot,
    captureArtifact,
    VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION,
    "L4 evaluation",
  );
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
  let lineage;
  try {
    lineage = resolveAdmittedSpiceEvaluationLineage(snapshot, methodSheet.sheet, {
      sheetFingerprint: sheetArtifact.fingerprint,
    });
  } catch (error) {
    throw integrity(error instanceof Error ? error.message : String(error));
  }
  recrossNamedL3Artifacts(captureArtifact, lineage);
  await reopenL3CaptureBytes(dependencies, lineage.spiceCapture);
  try {
    const result = await dependencies.evidence.read(lineage.result.fingerprint);
    if (!result) {
      throw notFound("The exact admitted SPICE result is unavailable.");
    }
  } catch (error) {
    if (error instanceof AdmittedSpiceEvaluationCloseoutResolutionError) {
      throw error;
    }
    throw integrity(
      `The reopened admitted SPICE result is not an exact observation identity: ${
        describe(error)
      }`,
    );
  }
  const l3Run = selectAttachedProducerRun(
    project,
    basis,
    snapshot,
    lineage.result,
    SIMULATE_RUN_ADMITTED_SPICE_OPERATION,
    "L3 admitted SPICE",
    { allowHistoricalResult: true },
  );
  if (l3Run.id !== methodSheet.sheet.spice.producer.runId) {
    throw integrity(
      "The L3 producer run is not the method-sheet selected admitted SPICE run.",
    );
  }
  const evaluations = exactEvaluations(
    snapshot,
    captureArtifact,
    capture,
    methodSheet.sheet,
    methodSheet.fingerprint,
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
    l3Run,
    captureArtifact,
    capture,
    sheet: {
      id: methodSheet.sheet.id,
      fingerprint: methodSheet.fingerprint,
    },
    sheetArtifact,
    methodSheet: methodSheet.sheet,
    spiceCapture: lineage.spiceCapture,
    evidence: lineage.evidence,
    result: lineage.result,
    evaluations: Object.freeze(evaluations),
    limitations: Object.freeze({
      ...SPICE_ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_LIMITS,
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
      "The named Thread artifact is not the exact L4 admitted SPICE observation evaluation producer.",
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
    throw stale("The L4 admitted SPICE observation evaluation is stale, not fresh.");
  }
  throw notFound(
    "The current Thread tip has no fresh digital-thread verify.evaluate-admitted-spice-observations@1 document; the exact L4 evaluation is unavailable.",
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
  operation: { readonly id: string; readonly version: string },
  label: string,
  options: { readonly allowHistoricalResult?: boolean } = {},
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
      `The ${label} result snapshot is not declared on the exact engineering project Thread.`,
    );
  }
  if (declared.length !== 1) {
    throw ambiguous(
      `The ${label} result snapshot is ambiguously declared on the engineering project Thread.`,
    );
  }
  const named = project.agentRuns.filter((run) => run.id === artifact.producer.runId);
  if (named.length === 0) {
    throw integrity(
      `The ${label} producer run is unattached to the exact engineering project.`,
    );
  }
  if (named.length !== 1) {
    throw ambiguous(`The ${label} producer run id is attached more than once.`);
  }
  const run = named[0]!;
  const work = project.workItems.find((item) => item.id === run.workItemId);
  if (run.status !== "completed") {
    throw integrity(
      `The ${label} producer run is foreign to the exact current Thread tip.`,
    );
  }
  if (options.allowHistoricalResult !== true) {
    if (deterministicJson(run.resultSnapshot) !== deterministicJson(expectedSnapshot)) {
      throw integrity(
        `The ${label} producer run is foreign to the exact current Thread tip.`,
      );
    }
  } else if (
    !run.resultSnapshot ||
    run.resultSnapshot.subjectId !== basis.subjectId ||
    !project.threadSnapshots.some((reference) =>
      reference.snapshotId === run.resultSnapshot!.snapshotId &&
      reference.revision === run.resultSnapshot!.revision &&
      reference.subjectId === run.resultSnapshot!.subjectId
    )
  ) {
    throw integrity(
      `The ${label} producer run does not retain a declared Thread result snapshot.`,
    );
  }
  if (
    work?.operation?.id !== operation.id ||
    work.operation.version !== operation.version
  ) {
    throw integrity(
      `The ${label} producer run is foreign to ${operation.id}@${operation.version}.`,
    );
  }
  if (work.status !== "completed") {
    throw integrity(
      `The ${label} work item is not completed; the artifact is not a finished attachment.`,
    );
  }
  if (options.allowHistoricalResult !== true) {
    const expectedEvidenceRef = uniquePrimaryEvidenceRef(snapshot, artifact);
    assertExactPrimaryEvidenceRefs(
      run.evidenceRefs,
      expectedEvidenceRef,
      `${label} run`,
    );
    assertExactPrimaryEvidenceRefs(
      work.evidenceRefs,
      expectedEvidenceRef,
      `${label} work item`,
    );
  }
  if (
    run.basis?.kind !== "thread-snapshot" ||
    run.basis.subjectId !== basis.subjectId ||
    run.basis.snapshotId === "latest"
  ) {
    throw integrity(
      `The completed ${label} run does not retain an exact Thread basis.`,
    );
  }
  return run;
}

function uniquePrimaryEvidenceRef(
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
  label: string,
): void {
  const actual = refs ?? [];
  if (actual.length === 0) {
    throw integrity(
      `The completed ${label} is missing its exact primary evaluation artifact evidence ref.`,
    );
  }
  if (actual.length !== 1) {
    throw ambiguous(
      `The completed ${label} has an ambiguous ${actual.length} evidence refs; the L4 topology attaches exactly one primary artifact.`,
    );
  }
  if (deterministicJson(actual[0]) !== deterministicJson(expected)) {
    throw integrity(
      `The completed ${label} evidence ref is foreign to the exact L4 evaluation artifact and current Thread tip.`,
    );
  }
}

async function reopenL4Capture(
  dependencies: AdmittedSpiceEvaluationCloseoutEvidenceResolverDependencies,
  artifact: ThreadArtifact,
): Promise<SpiceAdmittedObservationEvaluationCapture> {
  const expectedUri =
    `${SPICE_ADMITTED_OBSERVATION_EVALUATION_CAPTURE_URI_PREFIX}sha256/${artifact.fingerprint.digest}`;
  if (artifact.uri !== expectedUri) {
    throw integrity(
      "The L4 evaluation capture URI is not the canonical content-addressed capture URI.",
    );
  }
  const stored = await dependencies.evaluationCaptures.read(artifact.fingerprint);
  if (stored === undefined) {
    throw notFound(
      "The exact L4 admitted SPICE observation evaluation capture is unavailable.",
    );
  }
  let capture: SpiceAdmittedObservationEvaluationCapture;
  try {
    capture = validateSpiceAdmittedObservationEvaluationCapture(JSON.parse(stored));
  } catch {
    throw integrity(
      "The named capture is not an L4 admitted SPICE observation evaluation capture.",
    );
  }
  const fingerprint = await sha256Fingerprint(capture);
  if (
    stored !== canonicalSpiceAdmittedObservationEvaluationCaptureText(capture) ||
    !fingerprintsEqual(fingerprint, artifact.fingerprint)
  ) {
    throw integrity(
      "The reopened L4 evaluation capture fingerprint does not match the Thread artifact.",
    );
  }
  return capture;
}

async function recrossNamedMethodSheet(
  dependencies: AdmittedSpiceEvaluationCloseoutEvidenceResolverDependencies,
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
      "The exact sealed electrical observation method sheet named by the L4 lineage is unavailable.",
    );
  }
  if (matches.length !== 1) {
    throw ambiguous(
      "The L4 lineage names more than one electrical observation method-sheet seal; the server will not choose one.",
    );
  }
  const artifact = matches[0]!;
  recrossMethodSheetConsumption(snapshot, l4Artifact, artifact);
  const stored = await dependencies.sheetCaptures.read(artifact.fingerprint);
  if (stored === undefined) {
    throw notFound(
      "The sealed electrical observation method-sheet capture is unavailable.",
    );
  }
  let capture;
  try {
    capture = validateElectricalObservationMethodSheetSealCapture(JSON.parse(stored));
  } catch (error) {
    throw integrity(
      `The sealed electrical observation method-sheet capture is not exact: ${
        describe(error)
      }`,
    );
  }
  const fingerprint = await sha256Fingerprint(capture);
  if (
    stored !== deterministicJson(capture) ||
    !fingerprintsEqual(fingerprint, artifact.fingerprint) ||
    artifact.uri !==
      `${ELECTRICAL_OBSERVATION_METHOD_SHEET_SEAL_CAPTURE_URI_PREFIX}${artifact.fingerprint.digest}`
  ) {
    throw integrity(
      "The sealed electrical observation method-sheet capture does not rehash to its Thread artifact.",
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
      "The L4 evaluation is missing its verified consumption of the sealed electrical observation method sheet.",
    );
  }
  if (matches.length !== 1) {
    throw ambiguous(
      "The L4 evaluation has an ambiguous sealed electrical observation method-sheet consumption; the server will not choose one.",
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
  dependencies: AdmittedSpiceEvaluationCloseoutEvidenceResolverDependencies,
  project: EngineeringProjectSnapshot,
  basis: EngineeringThreadSnapshotBasis,
  sheetArtifact: ThreadArtifact,
): Promise<{
  readonly sheet: ElectricalObservationMethodSheet;
  readonly fingerprint: ContentFingerprint;
}> {
  const stored = await dependencies.sheetCaptures.read(sheetArtifact.fingerprint);
  if (stored === undefined) {
    throw notFound(
      "The sealed electrical observation method-sheet capture is unavailable.",
    );
  }
  const capture = validateElectricalObservationMethodSheetSealCapture(
    JSON.parse(stored),
  );
  const sheet = await dependencies.sheets.read(capture.sheet.fingerprint);
  if (!sheet) {
    throw notFound("The exact electrical observation method sheet is unavailable.");
  }
  const sheetFingerprint = await fingerprintElectricalObservationMethodSheet(sheet);
  if (
    sheet.id !== capture.sheet.id ||
    !fingerprintsEqual(sheetFingerprint, capture.sheet.fingerprint)
  ) {
    throw integrity(
      "The reopened electrical observation method sheet does not match the sealed L4 lineage.",
    );
  }
  if (
    sheet.project.id !== project.project.id ||
    sheet.subject.id !== basis.subjectId ||
    sheet.project.subjectId !== basis.subjectId
  ) {
    throw integrity(
      "The sealed electrical observation method sheet is foreign to the requested project or subject.",
    );
  }
  return { sheet, fingerprint: sheetFingerprint };
}

function recrossNamedL3Artifacts(
  l4Artifact: ThreadArtifact,
  lineage: ReturnType<typeof resolveAdmittedSpiceEvaluationLineage>,
): void {
  const expected = [
    lineage.methodSheet.id,
    lineage.spiceCapture.id,
    lineage.evidence.id,
    lineage.result.id,
  ];
  if (deterministicJson(l4Artifact.inputArtifactIds) !== deterministicJson(expected)) {
    throw integrity(
      "The L4 evaluation does not name the exact method sheet and selected L3 capture/evidence/result.",
    );
  }
  for (const artifact of [lineage.spiceCapture, lineage.evidence, lineage.result]) {
    if (artifact.producer.tool !== L3_TOOL) {
      throw integrity(
        "The selected L3 SPICE artifact is foreign to simulate.run-admitted-spice@1.",
      );
    }
  }
  if (
    !lineage.spiceCapture.id.startsWith(SPICE_CAPTURE_ARTIFACT_ID_PREFIX) ||
    !lineage.evidence.id.startsWith(SPICE_EVIDENCE_ARTIFACT_ID_PREFIX) ||
    !lineage.result.id.startsWith(SPICE_RESULT_ARTIFACT_ID_PREFIX)
  ) {
    throw integrity(
      "The selected L3 SPICE identities are not the canonical capture/evidence/result prefixes.",
    );
  }
}

async function reopenL3CaptureBytes(
  dependencies: AdmittedSpiceEvaluationCloseoutEvidenceResolverDependencies,
  artifact: ThreadArtifact,
): Promise<void> {
  if (!dependencies.spiceCaptures) return;
  const stored = await dependencies.spiceCaptures.read(artifact.fingerprint);
  if (stored === undefined) {
    throw notFound("The exact admitted SPICE capture is unavailable.");
  }
  const fingerprint = await sha256Fingerprint(JSON.parse(stored));
  if (
    stored !== deterministicJson(JSON.parse(stored)) ||
    !fingerprintsEqual(fingerprint, artifact.fingerprint)
  ) {
    throw integrity(
      "The reopened admitted SPICE capture fingerprint does not match the Thread artifact.",
    );
  }
}

function exactEvaluations(
  snapshot: ThreadSnapshot,
  captureArtifact: ThreadArtifact,
  capture: SpiceAdmittedObservationEvaluationCapture,
  sheet: ElectricalObservationMethodSheet,
  methodSheetFingerprint: ContentFingerprint,
): AdmittedSpiceEvaluationCloseoutResolvedEvidence["evaluations"] {
  const byCriterion = new Map(
    capture.evaluations.map((item) => [item.criterionId, item]),
  );
  if (byCriterion.size !== capture.evaluations.length) {
    throw integrity("The L4 capture has duplicate criterion evaluations.");
  }
  if (
    deterministicJson(sheet.criteria.map((item) => item.id)) !==
      deterministicJson(capture.evaluations.map((item) => item.criterionId))
  ) {
    throw integrity(
      "The L4 capture criteria are not the exact sealed electrical observation method sheet.",
    );
  }
  const evidencing = snapshot.evaluations.filter((evaluation) =>
    evaluation.evidenceArtifactIds.length === 1 &&
    evaluation.evidenceArtifactIds[0] === captureArtifact.id
  );
  const bindings = sheet.criteria.flatMap((criterion) =>
    spiceDocumentaryRequirementBindings({
      criterion,
      methodSheetFingerprint,
    })
  );
  if (evidencing.length !== bindings.length) {
    throw integrity(
      evidencing.length > bindings.length
        ? "The Thread has extra L4 evaluations that are not in the exact capture outcomes."
        : "The Thread is missing L4 evaluations required by the exact capture outcomes.",
    );
  }
  return bindings.map((binding) => {
    const outcome = byCriterion.get(binding.criterionId);
    if (!outcome) {
      throw integrity(
        `The L4 capture is missing the criterion evaluation for ${binding.requirementId}.`,
      );
    }
    const evaluation = evidencing.find((item) =>
      item.requirementId === binding.requirementId
    );
    if (!evaluation) {
      throw integrity(
        `The Thread is missing the L4 evaluation for ${binding.requirementId}.`,
      );
    }
    recrossEvaluationTopology(
      snapshot,
      captureArtifact,
      evaluation,
      outcome.status,
    );
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
      criterionId: binding.criterionId,
    };
  });
}

function recrossEvaluationTopology(
  snapshot: ThreadSnapshot,
  captureArtifact: ThreadArtifact,
  evaluation: RequirementEvaluation,
  captureStatus: RequirementEvaluation["status"],
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
  if (
    captureStatus === "unresolved" || captureStatus === "error"
  ) {
    if (evaluation.status !== captureStatus) {
      throw integrity(
        `The L4 evaluation ${evaluation.id} status ${evaluation.status} does not equal the exact capture outcome ${captureStatus}.`,
      );
    }
    if (evaluation.comparison !== undefined) {
      throw integrity(
        `The L4 evaluation ${evaluation.id} must not carry a comparison for ${captureStatus}.`,
      );
    }
  } else if (
    evaluation.status !== captureStatus &&
    evaluation.status !== "pass" && evaluation.status !== "fail"
  ) {
    throw integrity(
      `The L4 evaluation ${evaluation.id} status ${evaluation.status} is foreign to the exact capture outcome ${captureStatus}.`,
    );
  }
  if (
    evaluation.evaluator.serverId !== "digital-thread" ||
    evaluation.evaluator.tool !== L4_TOOL ||
    evaluation.evaluator.runId !== captureArtifact.producer.runId
  ) {
    throw integrity(
      `The L4 evaluation ${evaluation.id} evaluator is foreign to the exact capture producer run.`,
    );
  }
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

function notFound(message: string): AdmittedSpiceEvaluationCloseoutResolutionError {
  return new AdmittedSpiceEvaluationCloseoutResolutionError("not-found", message);
}

function ambiguous(
  message: string,
): AdmittedSpiceEvaluationCloseoutResolutionError {
  return new AdmittedSpiceEvaluationCloseoutResolutionError("ambiguous", message);
}

function stale(message: string): AdmittedSpiceEvaluationCloseoutResolutionError {
  return new AdmittedSpiceEvaluationCloseoutResolutionError("stale", message);
}

function integrity(
  message: string,
): AdmittedSpiceEvaluationCloseoutResolutionError {
  return new AdmittedSpiceEvaluationCloseoutResolutionError("integrity", message);
}

function describe(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}
