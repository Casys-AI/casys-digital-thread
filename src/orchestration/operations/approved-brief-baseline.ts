import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/deterministic-json.ts";
import type {
  EngineeringApprovedBriefBasis,
  EngineeringOperationRef,
  EngineeringProjectIdentity,
  EngineeringProjectPlan,
  EngineeringProjectSnapshot,
  EngineeringWorkItemKind,
  EngineeringWorkOwner,
} from "../../domain/engineering-project.ts";
import { validateEngineeringProjectSnapshot } from "../../domain/engineering-project-validation.ts";
import type { ProjectBriefRevision } from "../../domain/project-brief.ts";
import type {
  ContentFingerprint,
  ThreadSnapshot,
} from "../../domain/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../domain/thread-snapshot-validation.ts";
import { validateRegisteredEngineeringOperationInput } from "./registry.ts";

export const APPROVED_BRIEF_BASELINE_CAPTURE_SCHEMA =
  "approved-brief-baseline-capture/1.0" as const;

export const APPROVED_BRIEF_BASELINE_OPERATION = {
  id: "baseline.from-approved-brief",
  version: "1",
} as const;

export interface MaterializeApprovedBriefBaselineInput {
  /** Current project revision carrying the reviewed plan and claimed run. */
  readonly project: EngineeringProjectSnapshot;
  /** Exact immutable project revision named by the approved-brief basis. */
  readonly approvedProject: EngineeringProjectSnapshot;
  readonly runId: string;
  readonly capturedAt: string;
  readonly captureUri?: string;
}

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

/** Pure materialization of the exact canonical in-project brief. */
export async function materializeApprovedBriefBaseline(
  input: MaterializeApprovedBriefBaselineInput,
): Promise<ApprovedBriefBaselineMaterialization> {
  const project = validatedProject(input.project, "project");
  const approvedProject = validatedProject(
    input.approvedProject,
    "approvedProject",
  );
  const runId = requiredIdentifier(input.runId, "runId");
  const capturedAt = canonicalUtcInstant(input.capturedAt, "capturedAt");
  const workItem = verifyExactApprovedBriefPlan(project, approvedProject);
  const basis = project.plan!.basis as EngineeringApprovedBriefBasis;
  const brief = approvedProject.framing!.currentBrief!;
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
  };
  const text = deterministicJson(capture);
  const bytes = new TextEncoder().encode(text);
  const sha256 = await sha256Fingerprint(capture);
  const snapshot = documentaryThreadSnapshot({
    project,
    runId,
    capturedAt,
    sha256,
    captureUri: optionalCaptureUri(input.captureUri),
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
  if (project.schemaVersion !== "3.0" || approvedProject.schemaVersion !== "3.0") {
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
}): ThreadSnapshot {
  const artifactId = `approved-brief-document-${input.sha256.digest}`;
  const changeSetId = `approved-brief-baseline-${input.sha256.digest}`;
  const changeId = `${changeSetId}:record-document`;
  return validateThreadSnapshot({
    schemaVersion: "1.0",
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
  });
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
