import {
  EngineeringProjectCommandError,
  type EngineeringProjectInitialCompletionEvidenceValidator,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import { exactRecord } from "../../domain/kernel/case-validation.ts";
import { buildBriefAnalysisGraph } from "../../domain/compile/brief/brief-analysis-graph.ts";
import type { SourceAnalysisBundle } from "../../domain/compile/source/source-analysis.ts";
import type { SourceAnalysisFrontendRegistry } from "../../domain/compile/source/source-analysis-frontend-registry.ts";
import type {
  EngineeringApprovedBriefBasis,
  EngineeringOperationRef,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotRef,
} from "../../domain/project/engineering-project.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import type { ExactThreadSnapshotReader } from "../shared/stores/engineering-thread-snapshot-resolver.ts";
import { requireBriefSourceAnalysis } from "../compile/captures/brief-source-analysis-capture.ts";
import { APPROVED_BRIEF_BASELINE_CAPTURE_SCHEMA } from "../../orchestration/operations/approved-brief-baseline.ts";

export interface ApprovedBriefBaselineCaptureReader {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export interface BriefSourceAnalysisCaptureReaders {
  readonly sourceCaptures: ApprovedBriefBaselineCaptureReader;
  readonly analysisCaptures: ApprovedBriefBaselineCaptureReader;
  readonly frontends: SourceAnalysisFrontendRegistry;
}

/**
 * Fail-closed validator for the only initial V3 result that is not a
 * descendant of an earlier technical ThreadSnapshot.
 *
 * It verifies a real persisted document capture, but deliberately does not
 * promote that document to CAD, SysML, simulation, test, or compliance
 * evidence. Later technical work keeps using the normal descendant validator.
 */
export class ExactInitialBaselineEvidenceValidator
  implements EngineeringProjectInitialCompletionEvidenceValidator {
  constructor(
    private readonly snapshots: ExactThreadSnapshotReader,
    private readonly captures: ApprovedBriefBaselineCaptureReader,
    private readonly briefSourceAnalysis: BriefSourceAnalysisCaptureReaders,
  ) {}

  async validateInitial(
    runId: string,
    basis: EngineeringApprovedBriefBasis,
    operation: EngineeringOperationRef,
    resultReference: EngineeringThreadSnapshotRef,
    evidenceRefs: readonly EngineeringThreadEntityRef[],
  ): Promise<void> {
    const snapshot = await this.exactSnapshot(resultReference);
    assertApprovedBriefBaselineOperation(operation);
    assertApprovedBriefDocumentaryRoot(
      snapshot,
      resultReference,
      evidenceRefs,
      runId,
    );
    const document = snapshot.artifacts[0]!;
    const captureText = await this.captures.read(document.fingerprint);
    if (captureText === undefined) {
      invalidEvidence(
        `Approved-brief documentary capture ${document.fingerprint.digest} is not durably readable.`,
      );
    }
    const capture = await parseCanonicalCapture(captureText, document.fingerprint);
    const sourceAnalysisReference = assertApprovedBriefCaptureMatchesRun(
      capture,
      basis,
      operation,
      snapshot,
      document,
      runId,
    );
    await this.assertExactBriefSourceAnalysis(
      sourceAnalysisReference,
      capture,
      snapshot,
      document,
    );
  }

  private async assertExactBriefSourceAnalysis(
    reference: Record<string, unknown>,
    capture: Record<string, unknown>,
    snapshot: ThreadSnapshot,
    document: ThreadArtifact,
  ): Promise<void> {
    const parsedReference = parseBriefSourceAnalysisReference(reference);
    const approvedBrief = record(capture.approvedBrief, "capture.approvedBrief");
    if (
      parsedReference.briefId !== approvedBrief.briefId ||
      parsedReference.briefSnapshotId !== approvedBrief.id ||
      parsedReference.briefRevision !== approvedBrief.revision
    ) {
      invalidEvidence(
        "Brief source-analysis reference does not name the exact approved brief.",
      );
    }
    try {
      const replay = await requireBriefSourceAnalysis(
        parsedReference,
        this.briefSourceAnalysis,
      );
      this.assertExactBriefSourceAgainstCapture(
        replay.source.sourceText,
        capture,
      );
      this.assertExpectedGraph(replay.bundle, snapshot, document);
    } catch (error) {
      invalidEvidence(`Brief source analysis is invalid: ${errorMessage(error)}`);
    }
  }

  private assertExactBriefSourceAgainstCapture(
    sourceText: string,
    capture: Record<string, unknown>,
  ): void {
    let sourceBrief: unknown;
    try {
      sourceBrief = JSON.parse(sourceText);
    } catch {
      invalidEvidence("Brief source capture sourceText is not JSON.");
    }
    if (
      deterministicJson(sourceBrief) !== sourceText ||
      deterministicJson(sourceBrief) !== deterministicJson(capture.approvedBrief)
    ) {
      invalidEvidence(
        "Brief source capture is not the exact approved brief sealed in the documentary baseline.",
      );
    }
  }

  private assertExpectedGraph(
    bundle: SourceAnalysisBundle,
    snapshot: ThreadSnapshot,
    document: ThreadArtifact,
  ): void {
    const expectedGraph = buildBriefAnalysisGraph({
      bundle,
      evidence: { id: document.id, fingerprint: document.fingerprint },
    });
    if (expectedGraph === undefined) {
      if (snapshot.schemaVersion !== "1.0" || snapshot.analysisGraph !== undefined) {
        invalidEvidence(
          "A brief with no declared dependencies must retain its sealed analysis but no ThreadSnapshot analysis graph.",
        );
      }
      return;
    }
    if (
      snapshot.schemaVersion !== "1.1" || snapshot.analysisGraph === undefined ||
      deterministicJson(snapshot.analysisGraph) !== deterministicJson(expectedGraph)
    ) {
      invalidEvidence(
        "Approved-brief analysis graph is absent or does not exactly reconstruct from the sealed source analysis.",
      );
    }
  }

  private async exactSnapshot(
    reference: EngineeringThreadSnapshotRef,
  ): Promise<ThreadSnapshot> {
    const snapshot = await this.snapshots.get(reference.snapshotId);
    if (!snapshot) {
      invalidEvidence(
        `Initial ThreadSnapshot ${reference.snapshotId}@${reference.revision} is not readable from the exact snapshot stores.`,
      );
    }
    if (
      snapshot.id !== reference.snapshotId ||
      snapshot.revision !== reference.revision ||
      snapshot.subject.id !== reference.subjectId
    ) {
      invalidEvidence(
        `Initial ThreadSnapshot ${reference.snapshotId} does not match its declared revision and subject.`,
      );
    }
    return snapshot;
  }
}

function assertApprovedBriefBaselineOperation(
  operation: EngineeringOperationRef,
): void {
  if (
    operation.id !== "baseline.from-approved-brief" || operation.version !== "1"
  ) {
    invalidEvidence(
      "Only baseline.from-approved-brief@1 may publish an approved-brief initial result.",
    );
  }
}

function assertApprovedBriefDocumentaryRoot(
  snapshot: ThreadSnapshot,
  reference: EngineeringThreadSnapshotRef,
  evidenceRefs: readonly EngineeringThreadEntityRef[],
  expectedRunId: string,
): void {
  if (reference.revision !== 1 || snapshot.previous !== undefined) {
    invalidEvidence(
      "An approved-brief initial result must be root ThreadSnapshot revision 1.",
    );
  }
  if (
    snapshot.artifacts.length !== 1 || snapshot.consumptions.length !== 0 ||
    snapshot.observations.length !== 0 || snapshot.requirements.length !== 0 ||
    snapshot.evaluations.length !== 0 || snapshot.violations.length !== 0 ||
    snapshot.proposedActions.length !== 0
  ) {
    invalidEvidence(
      "An approved-brief initial result must contain one document and no technical facts.",
    );
  }
  const document = snapshot.artifacts[0]!;
  const digest = document.fingerprint.digest;
  const artifactId = `approved-brief-document-${digest}`;
  const changeSetId = `approved-brief-baseline-${digest}`;
  const change = snapshot.changeSet.changes[0];
  const provenance = snapshot.provenance[0];
  if (
    document.id !== artifactId || document.kind !== "document" ||
    document.name !==
      "Approved project brief documentary baseline (pre-technical)" ||
    document.version !== digest ||
    document.uri !== `casys://approved-brief-capture/sha256/${digest}` ||
    document.mediaType !== "application/json" ||
    document.inputArtifactIds.length !== 0 ||
    document.producer.serverId !== "casys-digital-thread" ||
    document.producer.tool !== "baseline_from_approved_brief" ||
    document.producer.runId !== expectedRunId ||
    snapshot.subject.modelArtifactId !== artifactId ||
    snapshot.subject.version !== digest || snapshot.id !==
      `${snapshot.subject.id}:r1:${changeSetId}` ||
    snapshot.changeSet.id !== changeSetId ||
    snapshot.changeSet.name !==
      "Record approved project brief documentary baseline" ||
    snapshot.changeSet.status !== "applied" ||
    snapshot.changeSet.changes.length !== 1 || !change ||
    change.id !== `${changeSetId}:record-document` ||
    change.kind !== "created" || change.target.kind !== "artifact" ||
    change.target.id !== artifactId ||
    !fingerprintsEqual(change.afterFingerprint, document.fingerprint) ||
    snapshot.provenance.length !== 1 || !provenance ||
    provenance.id !== `${changeSetId}:changes:${artifactId}` ||
    provenance.relation !== "changes" || provenance.from.kind !== "change" ||
    provenance.from.id !== change.id || provenance.to.kind !== "artifact" ||
    provenance.to.id !== artifactId
  ) {
    invalidEvidence(
      "Approved-brief root does not preserve its exact documentary artifact and provenance shape.",
    );
  }
  if (
    evidenceRefs.length !== 1 ||
    evidenceRefs[0]?.snapshotId !== reference.snapshotId ||
    evidenceRefs[0]?.snapshotRevision !== reference.revision ||
    evidenceRefs[0]?.kind !== "artifact" ||
    evidenceRefs[0]?.id !== artifactId
  ) {
    invalidEvidence(
      "Approved-brief initial result must cite exactly its documentary artifact.",
    );
  }
}

async function parseCanonicalCapture(
  text: string,
  fingerprint: ContentFingerprint,
): Promise<Record<string, unknown>> {
  let capture: unknown;
  try {
    capture = JSON.parse(text);
  } catch {
    invalidEvidence("Approved-brief documentary capture is not valid JSON.");
  }
  if (!capture || typeof capture !== "object" || Array.isArray(capture)) {
    invalidEvidence("Approved-brief documentary capture must be an object.");
  }
  if (deterministicJson(capture) !== text) {
    invalidEvidence(
      "Approved-brief documentary capture is not stored as its canonical deterministic JSON bytes.",
    );
  }
  const computed = await sha256Fingerprint(capture);
  if (!fingerprintsEqual(computed, fingerprint)) {
    invalidEvidence(
      "Approved-brief documentary capture does not match the documentary artifact fingerprint.",
    );
  }
  return capture as Record<string, unknown>;
}

function assertApprovedBriefCaptureMatchesRun(
  capture: Record<string, unknown>,
  basis: EngineeringApprovedBriefBasis,
  operation: EngineeringOperationRef,
  snapshot: ThreadSnapshot,
  document: ThreadArtifact,
  expectedRunId: string,
): Record<string, unknown> {
  if (
    capture.schemaVersion !== APPROVED_BRIEF_BASELINE_CAPTURE_SCHEMA ||
    capture.kind !== "approved-brief-documentary-baseline" ||
    capture.scope !== "pre-technical-documentation" ||
    capture.capturedAt !== snapshot.generatedAt ||
    capture.runId !== expectedRunId || document.producer.runId !== expectedRunId
  ) {
    invalidEvidence(
      "Capture is not the exact approved-brief pre-technical record for this run.",
    );
  }
  try {
    exactRecord(
      capture,
      [
        "schemaVersion",
        "kind",
        "scope",
        "statement",
        "runId",
        "capturedAt",
        "operation",
        "workItemId",
        "projectDefinition",
        "approvedBrief",
        "briefSourceAnalysis",
      ],
      "capture",
    );
  } catch (error) {
    invalidEvidence(`Approved-brief capture shape is invalid: ${errorMessage(error)}`);
  }
  const captureOperation = record(capture.operation, "capture.operation");
  const definition = record(
    capture.projectDefinition,
    "capture.projectDefinition",
  );
  const identity = record(definition.identity, "capture.projectDefinition.identity");
  const capturedBasis = record(definition.basis, "capture.projectDefinition.basis");
  const plan = record(definition.plan, "capture.projectDefinition.plan");
  const planBasis = record(plan.basis, "capture.projectDefinition.plan.basis");
  const workItem = record(definition.workItem, "capture.projectDefinition.workItem");
  const workItemOperation = record(
    workItem.operation,
    "capture.projectDefinition.workItem.operation",
  );
  const brief = record(capture.approvedBrief, "capture.approvedBrief");
  if (
    captureOperation.id !== operation.id ||
    captureOperation.version !== operation.version ||
    identity.id !== basis.projectId || identity.subjectId !== snapshot.subject.id ||
    snapshot.subject.name !== identity.name ||
    capture.workItemId !== workItem.id ||
    workItemOperation.id !== operation.id ||
    workItemOperation.version !== operation.version ||
    brief.briefId !== basis.briefId || brief.id !== basis.briefSnapshotId ||
    brief.revision !== basis.briefRevision
  ) {
    invalidEvidence(
      "Approved-brief capture does not retain the exact project, brief, work item and operation.",
    );
  }
  assertApprovedBriefBasisRecord(
    capturedBasis,
    basis,
    "capture.projectDefinition.basis",
  );
  assertApprovedBriefBasisRecord(
    planBasis,
    basis,
    "capture.projectDefinition.plan.basis",
  );
  return record(capture.briefSourceAnalysis, "capture.briefSourceAnalysis");
}

function parseBriefSourceAnalysisReference(
  value: Record<string, unknown>,
): {
  readonly briefId: string;
  readonly briefSnapshotId: string;
  readonly briefRevision: number;
  readonly sourceId: string;
  readonly sourceFingerprint: ContentFingerprint;
  readonly sourceCaptureFingerprint: ContentFingerprint;
  readonly analysisFingerprint: ContentFingerprint;
} {
  const reference = exactRecord(
    value,
    [
      "briefId",
      "briefSnapshotId",
      "briefRevision",
      "sourceId",
      "sourceFingerprint",
      "sourceCaptureFingerprint",
      "analysisFingerprint",
    ],
    "capture.briefSourceAnalysis",
  );
  const briefRevision = reference.briefRevision;
  if (
    typeof reference.briefId !== "string" ||
    typeof reference.briefSnapshotId !== "string" ||
    !Number.isSafeInteger(briefRevision) ||
    (typeof briefRevision === "number" && briefRevision < 1) ||
    typeof reference.sourceId !== "string"
  ) {
    invalidEvidence("capture.briefSourceAnalysis has an invalid exact identity.");
  }
  return {
    briefId: reference.briefId,
    briefSnapshotId: reference.briefSnapshotId,
    briefRevision: briefRevision as number,
    sourceId: reference.sourceId,
    sourceFingerprint: requiredFingerprint(
      reference.sourceFingerprint,
      "capture.briefSourceAnalysis.sourceFingerprint",
    ),
    sourceCaptureFingerprint: requiredFingerprint(
      reference.sourceCaptureFingerprint,
      "capture.briefSourceAnalysis.sourceCaptureFingerprint",
    ),
    analysisFingerprint: requiredFingerprint(
      reference.analysisFingerprint,
      "capture.briefSourceAnalysis.analysisFingerprint",
    ),
  };
}

function assertApprovedBriefBasisRecord(
  value: Record<string, unknown>,
  basis: EngineeringApprovedBriefBasis,
  label: string,
): void {
  if (
    value.kind !== "approved-brief" || value.projectId !== basis.projectId ||
    value.projectSnapshotId !== basis.projectSnapshotId ||
    value.projectRevision !== basis.projectRevision ||
    value.briefId !== basis.briefId ||
    value.briefSnapshotId !== basis.briefSnapshotId ||
    value.briefRevision !== basis.briefRevision ||
    !fingerprintMatches(
      value.approvedBriefFingerprint,
      basis.approvedBriefFingerprint,
    )
  ) invalidEvidence(`${label} does not exactly match the approved-brief basis.`);
}

function fingerprintMatches(value: unknown, expected: ContentFingerprint): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fingerprint = value as Partial<ContentFingerprint>;
  return fingerprintsEqual(
    fingerprint.algorithm === "sha256" && typeof fingerprint.digest === "string"
      ? { algorithm: fingerprint.algorithm, digest: fingerprint.digest }
      : undefined,
    expected,
  );
}

function requiredFingerprint(value: unknown, label: string): ContentFingerprint {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalidEvidence(`${label} must be a SHA-256 fingerprint.`);
  }
  const candidate = value as Partial<ContentFingerprint>;
  if (
    candidate.algorithm !== "sha256" || typeof candidate.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(candidate.digest)
  ) invalidEvidence(`${label} must be a canonical SHA-256 fingerprint.`);
  return { algorithm: "sha256", digest: candidate.digest };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalidEvidence(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function invalidEvidence(message: string): never {
  throw new EngineeringProjectCommandError("invalid_input", message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
