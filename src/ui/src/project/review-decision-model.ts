import type {
  EngineeringDecision,
  EngineeringDecisionProposalParameter,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringWorkItem,
} from "../../../domain/project/engineering-project.ts";
import type { ProjectBriefRevision } from "../../../domain/project/project-brief.ts";
import {
  type ArchitectureProposal,
  parseArchitectureProposalParameters,
} from "../../../domain/architecture/renderer/architecture-proposal.ts";
import {
  parseRequirementsProposalParameters,
  type RequirementsProposal,
} from "../../../domain/architecture/requirements/requirements-proposal.ts";
import type { ThreadWorkbenchSnapshot } from "../thread/types.ts";
import {
  type GeometryDecisionValid,
  parseGeometryDecisionView,
} from "../cad/geometry-decision-model.ts";

export type ProjectReviewKind =
  | "brief"
  | "architecture"
  | "requirements"
  | "geometry";

export type ProjectReviewState =
  | "needs-review"
  | "published"
  | "approved-awaiting-result"
  | "revision-requested"
  | "unavailable";

export type ProjectReviewPreview =
  | { readonly kind: "brief"; readonly brief: ProjectBriefRevision }
  | { readonly kind: "architecture"; readonly value: ArchitectureProposal }
  | { readonly kind: "requirements"; readonly value: RequirementsProposal }
  | {
    readonly kind: "geometry";
    readonly value: GeometryDecisionValid;
    /** Draft/proposal bytes or immutable thread bytes, named explicitly below. */
    readonly assetPath?: string;
    readonly assetAuthority: "proposal" | "sealed";
    readonly partAssets: readonly GeometryReviewPartAsset[];
  }
  | { readonly kind: "unavailable"; readonly reason: string };

export interface ProjectReviewRecord {
  readonly id: ProjectReviewKind;
  readonly anchorId: string;
  readonly href: string;
  readonly title: string;
  readonly question: string;
  readonly summary: string;
  readonly state: ProjectReviewState;
  readonly representation: "proposal" | "published-result" | "record";
  readonly recordedAt?: string;
  readonly preview: ProjectReviewPreview;
  readonly decision?: EngineeringDecision;
  /** Current pending approval attempt bound to this exact proposal. */
  readonly approvalId?: string;
  readonly workItem?: EngineeringWorkItem;
  readonly resultEvidence?: EngineeringThreadEntityRef;
  /** Canonical human outcome fields, shown only after the project records one. */
  readonly outcome?: ProjectReviewOutcome;
  /** Exact later geometry review whose signed predecessor names this result. */
  readonly supersededBy?: ProjectReviewSuccessor;
}

export interface ProjectReviewOutcome {
  readonly rationale?: string;
  readonly decidedBy?: string;
  readonly decidedAt?: string;
}

export interface GeometryReviewPartAsset {
  readonly partDefinitionElementId: string;
  readonly label: string;
  readonly format: "step" | "gltf" | "stl";
  readonly name: string;
  readonly digest: string;
  readonly path?: string;
  readonly authority: "proposal" | "sealed";
}

export interface ProjectReviewSuccessor {
  readonly decisionId: string;
  readonly title: string;
  readonly href: string;
}

export interface ProjectProofSummary {
  readonly status: "resolved" | "unresolved" | "not-declared";
  readonly requirementCount: number;
  readonly unresolvedCount: number;
  readonly failedCount: number;
  readonly observationCount: number;
  readonly detail: string;
}

export type ActivityReviewStatus =
  | "to-review"
  | "validated"
  | "revision-requested";
export type ProjectReviewOwner = "project" | "product";

const OPERATION_BY_KIND: Readonly<
  Record<Exclude<ProjectReviewKind, "brief">, string>
> = {
  architecture: "model.write-architecture",
  requirements: "model.write-requirements",
  geometry: "design.write-geometry",
};

/**
 * Projects durable review records only. It deliberately has no request token,
 * expiry or browser command shape: approval remains in the paired MCP chat.
 */
export function buildProjectReviewRecords(
  project: EngineeringProjectSnapshot,
  thread?: ThreadWorkbenchSnapshot,
): readonly ProjectReviewRecord[] {
  return [
    buildBriefRecord(project, thread),
    buildLatestDecisionRecord(project, thread, "architecture"),
    buildLatestDecisionRecord(project, thread, "requirements"),
    buildLatestDecisionRecord(project, thread, "geometry"),
  ];
}

/**
 * Activity is history, not a current-state summary. Keep every durable
 * decision attached to its exact work item so a later geometry generation or
 * requested revision cannot erase the earlier human review event.
 */
export function buildActivityReviewRecords(
  project: EngineeringProjectSnapshot,
  thread?: ThreadWorkbenchSnapshot,
): readonly ProjectReviewRecord[] {
  const decisionsById = new Map(
    project.decisions.map((decision) => [decision.id, decision]),
  );
  const records: ProjectReviewRecord[] = [
    ...buildActivityBriefRecords(project, thread),
  ];
  for (const workItem of project.workItems) {
    const kind = reviewKindForOperation(workItem.operation?.id);
    if (!kind) continue;
    const approvedDecisionId = [...workItem.decisionIds].reverse().find((id) =>
      decisionsById.get(id)?.status === "approved"
    );
    for (const decisionId of workItem.decisionIds) {
      const decision = decisionsById.get(decisionId);
      if (!decision) continue;
      records.push(
        buildDecisionRecord(
          project,
          thread,
          kind,
          workItem,
          decision,
          decision.id === approvedDecisionId,
        ),
      );
    }
  }
  const visible = records.filter((record) =>
    activityReviewStatus(record) !== undefined
  );
  const latestByKind = new Map<ProjectReviewKind, ProjectReviewRecord>();
  for (const record of visible) {
    const current = latestByKind.get(record.id);
    if (
      !current ||
      (record.recordedAt ?? "").localeCompare(current.recordedAt ?? "") >= 0
    ) {
      latestByKind.set(record.id, record);
    }
  }
  const anchored = visible.map((record) =>
    latestByKind.get(record.id) === record ? record : {
      ...record,
      anchorId: `review-${record.id}-history-${activityRecordIdentity(record)}`,
    }
  );
  return annotateExactGeometrySupersession(anchored);
}

function buildActivityBriefRecords(
  project: EngineeringProjectSnapshot,
  thread: ThreadWorkbenchSnapshot | undefined,
): readonly ProjectReviewRecord[] {
  const current = buildBriefRecord(project, thread);
  const framing = project.framing;
  if (
    !framing?.currentBrief || !framing.proposedBrief ||
    framing.currentBrief.id === framing.proposedBrief.id
  ) {
    return [current];
  }
  const {
    proposedBrief: _proposedBrief,
    proposalReview: _proposalReview,
    ...approvedFraming
  } = framing;
  return [
    buildBriefRecord({ ...project, framing: approvedFraming }, thread),
    current,
  ];
}

export function currentProjectReview(
  records: readonly ProjectReviewRecord[],
): ProjectReviewRecord | undefined {
  return records.find((record) => record.state === "needs-review");
}

export function buildProjectProofSummary(
  thread: ThreadWorkbenchSnapshot | undefined,
): ProjectProofSummary {
  if (!thread || thread.requirements.length === 0) {
    return {
      status: "not-declared",
      requirementCount: 0,
      unresolvedCount: 0,
      failedCount: 0,
      observationCount: thread?.observations.length ?? 0,
      detail: "No evaluated requirement set is present in the current thread.",
    };
  }
  const unresolvedCount =
    thread.requirements.filter((requirement) =>
      requirement.status === "unresolved"
    )
      .length;
  const failedCount =
    thread.requirements.filter((requirement) => requirement.status === "fail")
      .length;
  if (unresolvedCount > 0 || failedCount > 0) {
    const failureDetail = failedCount > 0
      ? `${failedCount} requirement${
        failedCount === 1 ? "" : "s"
      } currently fail${failedCount === 1 ? "s" : ""}.`
      : undefined;
    const unresolvedDetail = unresolvedCount > 0
      ? `${unresolvedCount} requirement${
        unresolvedCount === 1 ? "" : "s"
      } still ${
        unresolvedCount === 1 ? "awaits" : "await"
      } measured evaluation.`
      : undefined;
    return {
      status: "unresolved",
      requirementCount: thread.requirements.length,
      unresolvedCount,
      failedCount,
      observationCount: thread.observations.length,
      detail: [failureDetail, unresolvedDetail].filter((detail) => detail)
        .join(" "),
    };
  }
  return {
    status: "resolved",
    requirementCount: thread.requirements.length,
    unresolvedCount: 0,
    failedCount: 0,
    observationCount: thread.observations.length,
    detail: "Every published requirement has a current passing evaluation.",
  };
}

/**
 * Count only the exact typed requirements preview carried by a published
 * record. The current thread may contain a different number of evaluations.
 */
export function publishedRequirementTargetCount(
  record: ProjectReviewRecord,
): number | undefined {
  return record.id === "requirements" &&
      record.representation === "published-result" &&
      record.preview.kind === "requirements"
    ? record.preview.value.requirements.length
    : undefined;
}

/**
 * Review outcomes use the small vocabulary shown to the person. "To review"
 * is the absence of a human outcome; once decided, the only outcomes are
 * validated or revision requested. Publication is a separate feed fact.
 */
export function activityReviewStatus(
  record: ProjectReviewRecord,
): ActivityReviewStatus | undefined {
  if (record.state === "needs-review") return "to-review";
  if (record.state === "revision-requested") return "revision-requested";
  if (
    record.state === "published" ||
    record.state === "approved-awaiting-result"
  ) {
    return "validated";
  }
  return undefined;
}

export function activityReviewStatusLabel(
  status: ActivityReviewStatus,
): string {
  if (status === "to-review") return "To review";
  if (status === "validated") return "Validated";
  return "Revision requested";
}

/** Project owns intent/specification; Product owns structure/CAD. */
export function projectReviewOwner(
  kind: ProjectReviewKind,
): ProjectReviewOwner {
  return kind === "architecture" || kind === "geometry" ? "product" : "project";
}

/**
 * Keep signed targets separate from current evaluation evidence. In
 * particular, an absent requirement projection is unavailable evidence, not
 * a proven zero-unresolved state.
 */
export function publishedRequirementEvaluationDetail(
  record: ProjectReviewRecord,
  proof: ProjectProofSummary,
): string | undefined {
  const signedTargetCount = publishedRequirementTargetCount(record);
  if (signedTargetCount === undefined) return undefined;
  const targetLabel = `${signedTargetCount} signed target${
    signedTargetCount === 1 ? "" : "s"
  }`;
  if (proof.status === "not-declared") {
    return `${targetLabel} · evaluation unavailable in current thread · target count does not imply measurement`;
  }
  const passingCount = proof.requirementCount - proof.failedCount -
    proof.unresolvedCount;
  if (passingCount < 0 || proof.requirementCount === 0) {
    return `${targetLabel} · evaluation unavailable in current thread · target count does not imply measurement`;
  }
  const evaluations = [
    passingCount > 0 ? `${passingCount} passing` : undefined,
    proof.failedCount > 0 ? `${proof.failedCount} failing` : undefined,
    proof.unresolvedCount > 0
      ? `${proof.unresolvedCount} awaiting measurement`
      : undefined,
  ].filter((detail): detail is string => detail !== undefined);
  if (evaluations.length === 0) {
    return `${targetLabel} · evaluation unavailable in current thread · target count does not imply measurement`;
  }
  return `${targetLabel} · current-thread evaluations: ${
    evaluations.join(", ")
  } · target count does not imply coverage`;
}

function buildBriefRecord(
  project: EngineeringProjectSnapshot,
  thread: ThreadWorkbenchSnapshot | undefined,
): ProjectReviewRecord {
  const framing = project.framing;
  const pendingProposal = framing?.proposalReview?.status === "pending"
    ? framing.proposedBrief
    : undefined;
  const published = framing?.currentBrief;
  const revisionRequested = framing?.proposalReview?.status === "rejected";
  const rejectedProposal = revisionRequested && !published
    ? framing?.proposedBrief
    : undefined;
  const brief = pendingProposal ?? published ?? rejectedProposal;
  const baseline = project.workItems.find((item) =>
    item.operation?.id === "baseline.from-approved-brief"
  );
  const declaredResultEvidence = baseline?.evidenceRefs[0];
  const resultEvidence = firstPresentEvidence(thread, baseline?.evidenceRefs);
  const state: ProjectReviewState = pendingProposal
    ? "needs-review"
    : revisionRequested
    ? "revision-requested"
    : published && declaredResultEvidence
    ? "published"
    : "unavailable";
  const settledReview = revisionRequested
    ? framing?.proposalReview
    : pendingProposal
    ? undefined
    : framing?.currentBriefApproval;
  return {
    id: "brief",
    anchorId: "review-brief",
    href: "#work/review/brief",
    title: pendingProposal
      ? "Proposed engineering brief"
      : revisionRequested
      ? published
        ? "Approved engineering brief · revision requested"
        : "Engineering brief proposal · revision requested"
      : "Approved engineering brief",
    question: pendingProposal
      ? "Does this exact brief capture the intent and explicit boundaries?"
      : revisionRequested
      ? published
        ? "A proposed revision was rejected; the approved brief remains in force."
        : "The initial proposal was rejected; no approved brief is in force."
      : "The approved brief remains the immutable planning basis.",
    summary: pendingProposal
      ? "The approved brief stays in force until this separate proposal is reviewed in the paired conversation."
      : revisionRequested
      ? published
        ? "A correction was requested. This record does not prove that an agent run is active."
        : "A correction was requested. No approved brief or active agent work is implied."
      : "Canonical intent record; formal requirements remain a separate published specification.",
    state,
    representation: pendingProposal
      ? "proposal"
      : revisionRequested
      ? "record"
      : declaredResultEvidence
      ? "published-result"
      : "record",
    recordedAt: pendingProposal?.proposedAt ??
      (revisionRequested ? framing?.proposalReview?.decidedAt : undefined) ??
      framing?.currentBriefApproval?.decidedAt ?? published?.proposedAt ??
      rejectedProposal?.proposedAt,
    preview: brief
      ? { kind: "brief", brief }
      : { kind: "unavailable", reason: "No brief revision is recorded." },
    workItem: baseline,
    resultEvidence,
    outcome: settledReview
      ? reviewOutcome(
        settledReview.rationale,
        settledReview.decidedBy?.id,
        settledReview.decidedAt,
      )
      : undefined,
  };
}

function buildLatestDecisionRecord(
  project: EngineeringProjectSnapshot,
  thread: ThreadWorkbenchSnapshot | undefined,
  kind: Exclude<ProjectReviewKind, "brief">,
): ProjectReviewRecord {
  const operationId = OPERATION_BY_KIND[kind];
  const workItem = [...project.workItems].reverse().find((item) =>
    item.operation?.id === operationId
  );
  const decision = latestDecision(project, workItem);
  return buildDecisionRecord(
    project,
    thread,
    kind,
    workItem,
    decision,
    decision?.status === "approved",
  );
}

function buildDecisionRecord(
  project: EngineeringProjectSnapshot,
  thread: ThreadWorkbenchSnapshot | undefined,
  kind: Exclude<ProjectReviewKind, "brief">,
  workItem: EngineeringWorkItem | undefined,
  decision: EngineeringDecision | undefined,
  canOwnPublishedResult: boolean,
): ProjectReviewRecord {
  const approval = latestDecisionApproval(project, decision);
  const approvalId = pendingProposalApprovalId(project, decision);
  const declaredResultEvidence = workItem?.evidenceRefs[0];
  const resultEvidence = firstPresentEvidence(thread, workItem?.evidenceRefs);
  const hasPublishedResult = canOwnPublishedResult &&
    decision?.status === "approved" &&
    workItem?.status === "completed" &&
    declaredResultEvidence !== undefined;
  const state: ProjectReviewState = decision?.status === "proposed"
    ? "needs-review"
    : decision?.status === "rejected"
    ? "revision-requested"
    : hasPublishedResult
    ? "published"
    : decision?.status === "approved"
    ? "approved-awaiting-result"
    : "unavailable";
  return {
    id: kind,
    anchorId: `review-${kind}`,
    href: `#work/review/${kind}`,
    title: decision?.title ?? workItem?.title ?? reviewKindLabel(kind),
    question: decision?.question ?? "No durable review proposal is recorded.",
    summary: decision?.proposal?.summary ?? workItem?.description ??
      "The operation has not published a reviewable record.",
    state,
    representation: decision?.status === "proposed"
      ? "proposal"
      : hasPublishedResult
      ? "published-result"
      : "record",
    recordedAt: decision?.status === "proposed"
      ? decision.proposal?.proposedAt ?? decision.requestedAt
      : approval?.decidedAt ?? decision?.proposal?.proposedAt ??
        decision?.requestedAt,
    preview: parsePreview(
      kind,
      decision,
      thread,
      hasPublishedResult,
      resultEvidence !== undefined,
    ),
    decision,
    approvalId,
    workItem,
    resultEvidence,
    outcome: decision?.status !== "proposed" && approval
      ? reviewOutcome(
        approval.rationale,
        approval.decidedBy,
        approval.decidedAt,
      )
      : undefined,
  };
}

function reviewOutcome(
  rationale: string | undefined,
  decidedBy: string | undefined,
  decidedAt: string | undefined,
): ProjectReviewOutcome | undefined {
  return rationale || decidedBy || decidedAt
    ? { rationale, decidedBy, decidedAt }
    : undefined;
}

function activityRecordIdentity(record: ProjectReviewRecord): string {
  const identity = record.decision?.id ??
    (record.preview.kind === "brief" ? record.preview.brief.id : record.id);
  return identity.replaceAll(/[^a-zA-Z0-9_-]/g, "-");
}

function reviewKindForOperation(
  operationId: string | undefined,
): Exclude<ProjectReviewKind, "brief"> | undefined {
  if (!operationId) return undefined;
  return (Object.entries(OPERATION_BY_KIND).find(([, candidate]) =>
    candidate === operationId
  )?.[0] ?? undefined) as
    | Exclude<ProjectReviewKind, "brief">
    | undefined;
}

/**
 * A durable project reference does not prove that the current browser snapshot
 * actually contains that capture. Keep the published state, but expose a
 * navigable result only when the exact entity is present in the current graph.
 */
function firstPresentEvidence(
  thread: ThreadWorkbenchSnapshot | undefined,
  references: readonly EngineeringThreadEntityRef[] | undefined,
): EngineeringThreadEntityRef | undefined {
  if (!thread?.graph?.nodes || !references) return undefined;
  return references.find((reference) =>
    thread.graph.nodes.some((node) =>
      node.ref.kind === reference.kind && node.ref.id === reference.id
    )
  );
}

function latestDecision(
  project: EngineeringProjectSnapshot,
  workItem: EngineeringWorkItem | undefined,
): EngineeringDecision | undefined {
  const ids = new Set(workItem?.decisionIds ?? []);
  return [...project.decisions].reverse().find((decision) =>
    ids.has(decision.id)
  );
}

function latestDecisionApproval(
  project: EngineeringProjectSnapshot,
  decision: EngineeringDecision | undefined,
) {
  if (!decision) return undefined;
  const ids = new Set(decision.approvalIds);
  return [...project.approvals].reverse().find((approval) =>
    ids.has(approval.id) && approval.decisionId === decision.id
  );
}

function pendingProposalApprovalId(
  project: EngineeringProjectSnapshot,
  decision: EngineeringDecision | undefined,
): string | undefined {
  if (
    decision?.status !== "proposed" || !decision.inputFingerprint ||
    decision.approvalIds.length === 0
  ) return undefined;
  const approvalId = decision.approvalIds.at(-1)!;
  const approval = project.approvals.find((candidate) =>
    candidate.id === approvalId && candidate.decisionId === decision.id
  );
  return approval?.status === "pending" && approval.inputFingerprint &&
      fingerprintsEqual(approval.inputFingerprint, decision.inputFingerprint)
    ? approval.id
    : undefined;
}

function fingerprintsEqual(
  left: NonNullable<EngineeringDecision["inputFingerprint"]>,
  right: NonNullable<EngineeringDecision["inputFingerprint"]>,
): boolean {
  return left.algorithm === right.algorithm &&
    left.digest.toLowerCase() === right.digest.toLowerCase();
}

function parsePreview(
  kind: Exclude<ProjectReviewKind, "brief">,
  decision: EngineeringDecision | undefined,
  thread: ThreadWorkbenchSnapshot | undefined,
  published: boolean,
  exactPublishedEvidence: boolean,
): ProjectReviewPreview {
  const parameters = decision?.proposal?.parameters;
  if (!parameters) {
    return {
      kind: "unavailable",
      reason: "No exact proposal parameters are recorded for this operation.",
    };
  }
  const duplicate = duplicateParameter(parameters);
  if (duplicate) {
    return {
      kind: "unavailable",
      reason: `Duplicate proposal parameter: ${duplicate}`,
    };
  }
  try {
    if (kind === "architecture") {
      return {
        kind,
        value: parseArchitectureProposalParameters(parameters),
      };
    }
    if (kind === "requirements") {
      return {
        kind,
        value: parseRequirementsProposalParameters(parameters),
      };
    }
    const geometry = parseGeometryDecisionView(parameters);
    if (geometry.kind === "invalid") {
      return { kind: "unavailable", reason: geometry.reason };
    }
    return {
      kind,
      value: geometry,
      assetPath: published
        ? exactPublishedEvidence
          ? sealedGeometryAssetPath(thread, geometry)
          : geometry.primaryAssetPreviewPath
        : geometry.primaryAssetPreviewPath,
      assetAuthority: published && exactPublishedEvidence
        ? "sealed"
        : "proposal",
      partAssets: geometryReviewPartAssets(
        thread,
        geometry,
        published && exactPublishedEvidence,
      ),
    };
  } catch (error) {
    return {
      kind: "unavailable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function geometryReviewPartAssets(
  thread: ThreadWorkbenchSnapshot | undefined,
  view: GeometryDecisionValid,
  sealed: boolean,
): readonly GeometryReviewPartAsset[] {
  const definitions = view.targetPart
    ? [{
      elementId: view.targetPart.partDefinitionElementId,
      label: view.targetPart.label,
      files: view.targetPart.files,
    }]
    : view.partDefinitions;
  return definitions.flatMap((definition) =>
    definition.files.map((file) => ({
      partDefinitionElementId: definition.elementId,
      label: definition.label,
      format: file.format,
      name: file.name,
      digest: file.digest,
      path: sealed
        ? sealedGeometryFilePath(thread, file)
        : `/api/draft-assets/${file.digest}`,
      authority: sealed ? "sealed" as const : "proposal" as const,
    }))
  );
}

function duplicateParameter(
  parameters: readonly EngineeringDecisionProposalParameter[],
): string | undefined {
  const seen = new Set<string>();
  for (const parameter of parameters) {
    if (seen.has(parameter.key)) return parameter.key;
    seen.add(parameter.key);
  }
  return undefined;
}

function sealedGeometryAssetPath(
  thread: ThreadWorkbenchSnapshot | undefined,
  view: GeometryDecisionValid,
): string | undefined {
  const files = view.targetPart?.files ?? view.assemblyFiles;
  const primary = files.find((file) => file.format === "gltf") ??
    files.find((file) => file.format === "stl") ??
    files[0];
  if (!primary || !thread) return undefined;
  return sealedGeometryFilePath(thread, primary);
}

function sealedGeometryFilePath(
  thread: ThreadWorkbenchSnapshot | undefined,
  file: GeometryDecisionValid["assemblyFiles"][number],
): string | undefined {
  if (!thread) return undefined;
  const fingerprint = `sha256:${file.digest}`;
  const extension = file.format === "gltf" ? "glb" : file.format;
  const uri = `/api/thread/assets/${file.digest}.${extension}`;
  return thread.artifacts.find((artifact) =>
    artifact.fingerprint === fingerprint &&
    artifact.uri === uri &&
    (file.format === "step"
      ? artifact.kind === "step"
      : file.format === "gltf"
      ? artifact.kind === "cad-model"
      : artifact.kind === "cad-model" || artifact.kind === "mesh")
  )?.uri;
}

/**
 * A historical result is superseded only when a later signed geometry
 * manifest names its exact primary artifact as predecessor. Ordering and
 * timestamps are presentation concerns and never establish this relation.
 */
function annotateExactGeometrySupersession(
  records: readonly ProjectReviewRecord[],
): readonly ProjectReviewRecord[] {
  const byPublishedArtifact = new Map<string, ProjectReviewRecord>();
  for (const record of records) {
    if (record.id !== "geometry" || record.state !== "published") continue;
    for (const reference of record.workItem?.evidenceRefs ?? []) {
      if (reference.kind === "artifact") {
        byPublishedArtifact.set(reference.id, record);
      }
    }
  }
  const superseded = new Map<string, ProjectReviewSuccessor>();
  for (const successor of records) {
    if (
      successor.id !== "geometry" ||
      successor.state !== "published" ||
      successor.preview.kind !== "geometry" ||
      !successor.preview.value.predecessor ||
      !successor.decision
    ) continue;
    const predecessor = byPublishedArtifact.get(
      successor.preview.value.predecessor.artifactId,
    );
    if (
      !predecessor ||
      successor.preview.value.predecessor.artifactId !==
        `geometry-${successor.preview.value.predecessor.digest}`
    ) continue;
    superseded.set(activityRecordIdentity(predecessor), {
      decisionId: successor.decision.id,
      title: successor.title,
      href: successor.href,
    });
  }
  return records.map((record) => {
    const successor = superseded.get(activityRecordIdentity(record));
    return successor ? { ...record, supersededBy: successor } : record;
  });
}

function reviewKindLabel(kind: Exclude<ProjectReviewKind, "brief">): string {
  if (kind === "architecture") return "System architecture";
  if (kind === "requirements") return "Published requirements";
  return "Geometry";
}
