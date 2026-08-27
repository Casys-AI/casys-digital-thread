import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type {
  EngineeringApprovedBriefBasis,
  EngineeringOperationRef,
  EngineeringProjectIdentity,
  EngineeringProjectPlan,
  EngineeringProjectSnapshot,
  EngineeringWorkItemKind,
  EngineeringWorkOwner,
} from "../../domain/project/engineering-project.ts";
import { validateEngineeringProjectSnapshot } from "../../domain/project/engineering-project-validation.ts";
import type { ProjectBriefRevision } from "../../domain/project/project-brief.ts";
import {
  fingerprintSourceAnalysisBundle,
  type SourceAnalysisBundle,
  validateSourceAnalysisBundle,
} from "../../domain/compile/source/source-analysis.ts";
import { buildBriefAnalysisGraph } from "../../domain/compile/brief/brief-analysis-graph.ts";
import {
  type BriefSourceAnalysisReference,
  briefSourceIdFor,
  validateBriefSourceAnalysisReference,
} from "../../domain/compile/brief/brief-source-analysis-reference.ts";
import { APPROVED_BRIEF_BASELINE_OPERATION } from "../../domain/compile/brief/approved-brief-baseline.ts";
import type {
  ContentFingerprint,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import { validateRegisteredEngineeringOperationInput } from "./registry.ts";

export const APPROVED_BRIEF_BASELINE_CAPTURE_SCHEMA =
  "approved-brief-baseline-capture/1.1" as const;

export interface MaterializeApprovedBriefBaselineInput {
  /** Current project revision carrying the reviewed plan and claimed run. */
  readonly project: EngineeringProjectSnapshot;
  /** Exact immutable project revision named by the approved-brief basis. */
  readonly approvedProject: EngineeringProjectSnapshot;
  readonly runId: string;
  readonly capturedAt: string;
  readonly captureUri?: string;
  /**
   * Persisted local facts about the exact approved brief. The source bytes and
   * bundle are intentionally not embedded in the documentary capture.
   */
  readonly briefSourceAnalysis: {
    readonly reference: BriefSourceAnalysisReference;
    readonly bundle: SourceAnalysisBundle;
  };
}

export type PrepareApprovedBriefBaselineEligibilityInput = Omit<
  MaterializeApprovedBriefBaselineInput,
  "briefSourceAnalysis" | "captureUri"
>;

export interface ApprovedBriefBaselineProjectDefinition {
  readonly identity: EngineeringProjectIdentity;
  readonly basis: EngineeringApprovedBriefBasis;
  readonly plan: EngineeringProjectPlan;
  readonly workItem: {
    readonly id: string;
    readonly phaseId: string;
    readonly title: string;
    readonly description: string;
    readonly kind: EngineeringWorkItemKind;
    readonly owner: EngineeringWorkOwner;
    readonly dependsOnWorkItemIds: readonly string[];
    readonly operation: EngineeringOperationRef;
  };
}

export interface ApprovedBriefBaselineCapture {
  readonly schemaVersion: typeof APPROVED_BRIEF_BASELINE_CAPTURE_SCHEMA;
  readonly kind: "approved-brief-documentary-baseline";
  readonly scope: "pre-technical-documentation";
  readonly statement: string;
  readonly runId: string;
  readonly capturedAt: string;
  readonly operation: typeof APPROVED_BRIEF_BASELINE_OPERATION;
  readonly workItemId: string;
  readonly projectDefinition: ApprovedBriefBaselineProjectDefinition;
  readonly approvedBrief: ProjectBriefRevision;
  readonly briefSourceAnalysis: BriefSourceAnalysisReference;
}

export interface ApprovedBriefBaselineMaterialization {
  readonly capture: ApprovedBriefBaselineCapture;
  readonly text: string;
  readonly bytes: Uint8Array;
  readonly sha256: ContentFingerprint;
  readonly snapshot: ThreadSnapshot;
}

export class ApprovedBriefBaselineMaterializationError extends Error {
  constructor(
    readonly code:
      | "invalid_input"
      | "invalid_brief"
      | "invalid_plan"
      | "baseline_already_exists",
    message: string,
  ) {
    super(message);
    this.name = "ApprovedBriefBaselineMaterializationError";
  }
}

/**
 * Pure fail-closed eligibility check used before the executor writes source
 * CAS records. It does not construct a capture.
 */
export function prepareApprovedBriefBaselineEligibility(
  input: PrepareApprovedBriefBaselineEligibilityInput,
): {
  readonly project: EngineeringProjectSnapshot;
  readonly approvedProject: EngineeringProjectSnapshot;
  readonly runId: string;
  readonly capturedAt: string;
  readonly workItem: ApprovedBriefBaselineProjectDefinition["workItem"];
  readonly basis: EngineeringApprovedBriefBasis;
  readonly brief: ProjectBriefRevision;
} {
  const project = validatedProject(input.project, "project");
  const approvedProject = validatedProject(input.approvedProject, "approvedProject");
  const runId = requiredIdentifier(input.runId, "runId");
  const capturedAt = canonicalUtcInstant(input.capturedAt, "capturedAt");
  const workItem = verifyExactApprovedBriefPlan(project, approvedProject);
  return {
    project,
    approvedProject,
    runId,
    capturedAt,
    workItem,
    basis: project.plan!.basis as EngineeringApprovedBriefBasis,
    brief: approvedProject.framing!.currentBrief!,
  };
}

/** Pure materialization of the exact canonical in-project brief. */
export async function materializeApprovedBriefBaseline(
  input: MaterializeApprovedBriefBaselineInput,
): Promise<ApprovedBriefBaselineMaterialization> {
  const { project, runId, capturedAt, workItem, basis, brief } =
    prepareApprovedBriefBaselineEligibility(input);
  const briefSourceAnalysis = await validateBriefSourceAnalysisInput(
    input.briefSourceAnalysis,
    brief,
  );
  const capture: ApprovedBriefBaselineCapture = {
    schemaVersion: APPROVED_BRIEF_BASELINE_CAPTURE_SCHEMA,
    kind: "approved-brief-documentary-baseline",
    scope: "pre-technical-documentation",
    statement:
      "Immutable documentary capture of the exact human-approved project brief and its reviewed plan. It is not a technical model, calculation, test result, certification or verification verdict.",
    runId,
    capturedAt,
    operation: APPROVED_BRIEF_BASELINE_OPERATION,
    workItemId: workItem.id,
    projectDefinition: {
      identity: structuredClone(project.project),
      basis: structuredClone(basis),
      plan: structuredClone(project.plan!),
      workItem,
    },
    approvedBrief: structuredClone(brief),
    briefSourceAnalysis: structuredClone(briefSourceAnalysis.reference),
  };
  const text = deterministicJson(capture);
  const bytes = new TextEncoder().encode(text);
  const sha256 = await sha256Fingerprint(capture);
  const artifactId = `approved-brief-document-${sha256.digest}`;
  const analysisGraph = buildBriefAnalysisGraph({
    bundle: briefSourceAnalysis.bundle,
    evidence: { id: artifactId, fingerprint: sha256 },
  });
  const snapshot = documentaryThreadSnapshot({
    project,
    runId,
    capturedAt,
    sha256,
    captureUri: optionalCaptureUri(input.captureUri),
    analysisGraph,
  });
  return {
    capture: structuredClone(capture),
    text,
    bytes: bytes.slice(),
    sha256: structuredClone(sha256),
    snapshot: structuredClone(snapshot),
  };
}

function verifyExactApprovedBriefPlan(
  project: EngineeringProjectSnapshot,
  approvedProject: EngineeringProjectSnapshot,
): ApprovedBriefBaselineProjectDefinition["workItem"] {
  if (approvedProject.schemaVersion !== "4.0") {
    invalid("invalid_input", "Approved-brief baseline requires a V3 project.");
  }
  if (project.threadSnapshots.length > 0) {
    invalid(
      "baseline_already_exists",
      "Approved-brief baseline is valid only before the first ThreadSnapshot.",
    );
  }
  const plan = project.plan;
  if (
    !plan || plan.startingPoint !== "idea-or-spec" ||
    plan.basis.kind !== "approved-brief"
  ) {
    invalid("invalid_plan", "Project has no approved-brief idea/spec plan.");
  }
  const basis = plan.basis;
  if (
    approvedProject.project.id !== basis.projectId ||
    approvedProject.id !== basis.projectSnapshotId ||
    approvedProject.revision !== basis.projectRevision
  ) {
    invalid(
      "invalid_brief",
      "Supplied approvedProject is not the exact project revision named by the plan basis.",
    );
  }
  const brief = approvedProject.framing?.currentBrief;
  const approval = approvedProject.framing?.currentBriefApproval;
  if (
    !brief || !approval || approval.status !== "approved" ||
    approval.decidedBy?.origin !== "human" ||
    brief.briefId !== basis.briefId || brief.id !== basis.briefSnapshotId ||
    brief.revision !== basis.briefRevision ||
    !fingerprintsEqual(
      approval.inputFingerprint,
      basis.approvedBriefFingerprint,
    )
  ) {
    invalid(
      "invalid_brief",
      "Plan basis does not resolve to the exact human-approved in-project brief.",
    );
  }
  const candidates = project.workItems.filter((item) =>
    item.operation?.id === APPROVED_BRIEF_BASELINE_OPERATION.id &&
    item.operation.version === APPROVED_BRIEF_BASELINE_OPERATION.version
  );
  if (candidates.length !== 1 || !candidates[0].operation) {
    invalid(
      "invalid_plan",
      "Reviewed plan must contain exactly one approved-brief baseline operation.",
    );
  }
  const workItem = candidates[0];
  const operation = workItem.operation!;
  try {
    validateRegisteredEngineeringOperationInput({
      operation,
      stage: "queue",
      basisKind: "approved-brief",
    });
  } catch (error) {
    invalid(
      "invalid_plan",
      `Baseline work item violates the reviewed operation contract: ${
        errorMessage(error)
      }`,
    );
  }
  return {
    id: workItem.id,
    phaseId: workItem.phaseId,
    title: workItem.title,
    description: workItem.description,
    kind: workItem.kind,
    owner: workItem.owner,
    dependsOnWorkItemIds: [...workItem.dependsOnWorkItemIds],
    operation: structuredClone(operation),
  };
}

function documentaryThreadSnapshot(input: {
  project: EngineeringProjectSnapshot;
  runId: string;
  capturedAt: string;
  sha256: ContentFingerprint;
  captureUri?: string;
  analysisGraph?: ThreadSnapshot["analysisGraph"];
}): ThreadSnapshot {
  const artifactId = `approved-brief-document-${input.sha256.digest}`;
  const changeSetId = `approved-brief-baseline-${input.sha256.digest}`;
  const changeId = `${changeSetId}:record-document`;
  return validateThreadSnapshot({
    schemaVersion: input.analysisGraph ? "1.1" : "1.0",
    id: `${input.project.project.subjectId}:r1:${changeSetId}`,
    revision: 1,
    generatedAt: input.capturedAt,
    subject: {
      id: input.project.project.subjectId,
      name: input.project.project.name,
      kind: "system",
      version: input.sha256.digest,
      modelArtifactId: artifactId,
    },
    freshness: {
      status: "fresh",
      changedAt: input.capturedAt,
      invalidatedByChangeIds: [],
    },
    changeSet: {
      id: changeSetId,
      name: "Record approved project brief documentary baseline",
      status: "applied",
      createdAt: input.capturedAt,
      appliedAt: input.capturedAt,
      changes: [{
        id: changeId,
        kind: "created",
        target: { kind: "artifact", id: artifactId },
        summary:
          "Recorded the canonical project brief as documentary provenance; no technical evidence was created.",
        afterFingerprint: input.sha256,
      }],
    },
    artifacts: [{
      id: artifactId,
      name: "Approved project brief documentary baseline (pre-technical)",
      kind: "document",
      version: input.sha256.digest,
      fingerprint: input.sha256,
      ...(input.captureUri ? { uri: input.captureUri } : {}),
      mediaType: "application/json",
      producer: {
        serverId: "casys-digital-thread",
        tool: "baseline_from_approved_brief",
        runId: input.runId,
      },
      inputArtifactIds: [],
      freshness: {
        status: "fresh",
        changedAt: input.capturedAt,
        invalidatedByChangeIds: [],
      },
    }],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: `${changeSetId}:changes:${artifactId}`,
      relation: "changes",
      from: { kind: "change", id: changeId },
      to: { kind: "artifact", id: artifactId },
      rationale:
        "The immutable document records only canonical project intent and reviewed planning provenance.",
    }],
    proposedActions: [],
    ...(input.analysisGraph ? { analysisGraph: input.analysisGraph } : {}),
  });
}

async function validateBriefSourceAnalysisInput(
  value: MaterializeApprovedBriefBaselineInput["briefSourceAnalysis"],
  brief: ProjectBriefRevision,
): Promise<{
  readonly reference: BriefSourceAnalysisReference;
  readonly bundle: SourceAnalysisBundle;
}> {
  let reference: BriefSourceAnalysisReference;
  let bundle: SourceAnalysisBundle;
  try {
    reference = validateBriefSourceAnalysisReference(value.reference);
    bundle = validateSourceAnalysisBundle(value.bundle);
  } catch (error) {
    invalid("invalid_brief", `briefSourceAnalysis is invalid: ${errorMessage(error)}`);
  }
  if (
    reference.briefId !== brief.briefId || reference.briefSnapshotId !== brief.id ||
    reference.briefRevision !== brief.revision ||
    reference.sourceId !== await briefSourceIdFor(
        reference.briefId,
        reference.briefSnapshotId,
        reference.briefRevision,
      ) ||
    bundle.source.id !== reference.sourceId ||
    bundle.source.role !== "brief" || bundle.source.language !== "plain-text" ||
    !fingerprintsEqual(bundle.source.fingerprint, reference.sourceFingerprint) ||
    bundle.policy.status !== "passed"
  ) {
    invalid(
      "invalid_brief",
      "briefSourceAnalysis does not name the exact approved brief and passed local analysis.",
    );
  }
  const expectedSourceFingerprint = await fingerprintUtf8(deterministicJson(brief));
  if (
    !fingerprintsEqual(reference.sourceFingerprint, expectedSourceFingerprint) ||
    !fingerprintsEqual(bundle.source.fingerprint, expectedSourceFingerprint)
  ) {
    invalid(
      "invalid_brief",
      "briefSourceAnalysis source fingerprint does not name the exact canonical approved brief bytes.",
    );
  }
  const fingerprint = await fingerprintSourceAnalysisBundle(bundle);
  if (!fingerprintsEqual(fingerprint, reference.analysisFingerprint)) {
    invalid(
      "invalid_brief",
      "briefSourceAnalysis analysisFingerprint does not name the exact canonical bundle.",
    );
  }
  return { reference, bundle };
}

function validatedProject(
  value: EngineeringProjectSnapshot,
  label: string,
): EngineeringProjectSnapshot {
  try {
    return validateEngineeringProjectSnapshot(value);
  } catch (error) {
    invalid("invalid_input", `${label} is invalid: ${errorMessage(error)}`);
  }
}

function requiredIdentifier(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    invalid("invalid_input", `${label} must be a stable identifier.`);
  }
  return value;
}

function canonicalUtcInstant(value: string, label: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) invalid("invalid_input", `${label} must be a canonical UTC instant.`);
  return value;
}

function optionalCaptureUri(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!value.trim()) invalid("invalid_input", "captureUri must not be empty.");
  return value;
}

function invalid(
  code: ApprovedBriefBaselineMaterializationError["code"],
  message: string,
): never {
  throw new ApprovedBriefBaselineMaterializationError(code, message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fingerprintUtf8(text: string): Promise<ContentFingerprint> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return {
    algorithm: "sha256",
    digest: [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(""),
  };
}
