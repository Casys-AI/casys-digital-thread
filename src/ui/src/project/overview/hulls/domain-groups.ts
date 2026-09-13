/**
 * Display-only Overview hull identities.
 *
 * Provider names stay on recorded provenance; they are not peer hulls.
 * Classification uses exact operations and typed artifact kinds only.
 * Labels, server ids, and system copy never authorize a domain.
 */
import type { EngineeringPathLaneId } from "../../../../../domain/project/engineering-path-lane.ts";
import type {
  ThreadArtifact,
  ThreadGraphNode,
  ThreadObservation,
} from "../../../thread/types.ts";

export const OVERVIEW_DOMAIN_GROUP_KEYS = {
  brief: "brief",
  sysmlModel: "domain:sysml-model",
  geometry: "domain:geometry",
  fea: "domain:fea",
  dfm: "family:dfm",
  simulation: "domain:simulation",
  assemblyIntegrity: "family:assembly-integrity",
  prescribedKinematics: "family:prescribed-kinematics",
  unassigned: "unassigned",
  projectActivity: "project-activity",
} as const;

const DFM_SEAL_OPERATION = "industrialize.seal-dfm-case@1";
const DFM_RUN_OPERATION = "industrialize.run-dfm-checks@1";
const DFM_CHECK_CASE_KEY = /^verification-case:dfm-check:[a-f0-9]{64}$/;

export type OverviewDomainGroupKey =
  typeof OVERVIEW_DOMAIN_GROUP_KEYS[keyof typeof OVERVIEW_DOMAIN_GROUP_KEYS];

/** Compatibility aliases for the previous producer-family table. */
export const OVERVIEW_SEMANTIC_GROUP_KEYS = {
  canonicalGeometry: OVERVIEW_DOMAIN_GROUP_KEYS.geometry,
  assemblyIntegrity: OVERVIEW_DOMAIN_GROUP_KEYS.assemblyIntegrity,
  prescribedKinematics: OVERVIEW_DOMAIN_GROUP_KEYS.prescribedKinematics,
} as const;

const FAMILY_BY_EXACT_OPERATION = new Map<string, OverviewDomainGroupKey>([
  [
    "verify.observe-assembly-integrity@1",
    OVERVIEW_DOMAIN_GROUP_KEYS.assemblyIntegrity,
  ],
  [
    "verify.evaluate-assembly-integrity@1",
    OVERVIEW_DOMAIN_GROUP_KEYS.assemblyIntegrity,
  ],
  [
    "decide.accept-assembly-integrity-evaluation@1",
    OVERVIEW_DOMAIN_GROUP_KEYS.assemblyIntegrity,
  ],
  [
    "decide.reject-assembly-integrity-evaluation@1",
    OVERVIEW_DOMAIN_GROUP_KEYS.assemblyIntegrity,
  ],
  [
    "verify.seal-prescribed-kinematics-case@1",
    OVERVIEW_DOMAIN_GROUP_KEYS.prescribedKinematics,
  ],
  [
    "verify.run-prescribed-kinematics@1",
    OVERVIEW_DOMAIN_GROUP_KEYS.prescribedKinematics,
  ],
  [
    "verify.seal-prescribed-kinematics-method@1",
    OVERVIEW_DOMAIN_GROUP_KEYS.prescribedKinematics,
  ],
  [
    "verify.evaluate-prescribed-kinematics@1",
    OVERVIEW_DOMAIN_GROUP_KEYS.prescribedKinematics,
  ],
  [
    DFM_SEAL_OPERATION,
    OVERVIEW_DOMAIN_GROUP_KEYS.dfm,
  ],
  [
    DFM_RUN_OPERATION,
    OVERVIEW_DOMAIN_GROUP_KEYS.dfm,
  ],
]);

const DOMAIN_BY_EXACT_OPERATION = new Map<string, OverviewDomainGroupKey>([
  ["design.write-geometry@1", OVERVIEW_DOMAIN_GROUP_KEYS.geometry],
  [
    "geometry.module.immediate-compound@1.0",
    OVERVIEW_DOMAIN_GROUP_KEYS.geometry,
  ],
  [
    "verify.run-fea-static-proof@3",
    OVERVIEW_DOMAIN_GROUP_KEYS.fea,
  ],
  [
    "verify.seal-proof-case@1",
    OVERVIEW_DOMAIN_GROUP_KEYS.fea,
  ],
  [
    "analyze.seal-sensitivity-study@1",
    OVERVIEW_DOMAIN_GROUP_KEYS.fea,
  ],
  [
    "analyze.run-fea-sensitivity@1",
    OVERVIEW_DOMAIN_GROUP_KEYS.fea,
  ],
  [
    "verify.evaluate-sensitivity-base@1",
    OVERVIEW_DOMAIN_GROUP_KEYS.fea,
  ],
  [
    "decide.accept-evaluation-closeout@1",
    OVERVIEW_DOMAIN_GROUP_KEYS.fea,
  ],
  [
    "simulate.run-admitted-modelica@1",
    OVERVIEW_DOMAIN_GROUP_KEYS.simulation,
  ],
]);

const SYSML_ENTITY_KINDS = new Set<ThreadGraphNode["entityKind"]>([
  "part-definition",
  "part-usage",
  "attribute-usage",
  "requirement",
]);

export interface OverviewDomainGroupInput {
  readonly node: ThreadGraphNode;
  readonly artifact?: ThreadArtifact;
  readonly observation?: ThreadObservation;
  /**
   * Observation `sourceArtifactId` or the unique incoming `evidences`
   * artifact for an evaluation/violation. Ambiguous sources stay unset.
   */
  readonly sourceArtifact?: ThreadArtifact;
}

export function isApprovedBriefDocument(
  node: ThreadGraphNode,
  artifact?: ThreadArtifact,
): boolean {
  return node.ref.kind === "artifact" && artifact?.id === node.ref.id &&
    artifact.kind === "document" &&
    artifact.producer?.serverId === "casys-digital-thread" &&
    artifact.producer.tool === "baseline_from_approved_brief";
}

export function isBriefAnalysisNode(node: ThreadGraphNode): boolean {
  return node.entityKind === "analysis-node" && node.system === "brief" &&
    node.analysis?.semanticRef.domain === "brief" &&
    node.analysis.semanticRef.kind === "brief-item";
}

export function isOverviewBriefRecord(
  node: ThreadGraphNode,
  artifact?: ThreadArtifact,
): boolean {
  return isApprovedBriefDocument(node, artifact) || isBriefAnalysisNode(node);
}

const REQUIREMENTS_CAPTURE_TOOLS = new Set([
  "syson_element_insert_sysml",
  "syson_constraint_extract",
  "model.write-requirements@2",
  "model.recapture-requirements@2",
]);

/** Exact recorded capture contract, never a title or provider-name heuristic. */
export function isOverviewRequirementsCapture(
  node: ThreadGraphNode,
  artifact?: ThreadArtifact,
): boolean {
  return node.ref.kind === "artifact" && artifact?.id === node.ref.id &&
    artifact.kind === "sysml-model" &&
    artifact.producer?.serverId === "syson" &&
    REQUIREMENTS_CAPTURE_TOOLS.has(artifact.producer.tool) &&
    /^casys:\/\/requirements-capture\/[^/]+\/sha256\/[a-f0-9]{64}$/.test(
      artifact.uri ?? "",
    );
}

/** Display color follows the lane. SYSML already owns requirements. */
export function overviewDomainGroupColor(
  _groupKey: string,
  laneColor: string,
): string {
  return laneColor;
}

/**
 * Recorded domain or family identity for one Overview card.
 * Unknown, missing, or conflicting observation sources stay generic.
 */
export function overviewDomainGroupKeyFor(
  input: OverviewDomainGroupInput,
): string {
  const { node, artifact, observation, sourceArtifact } = input;
  if (isApprovedBriefDocument(node, artifact) || isBriefAnalysisNode(node)) {
    return OVERVIEW_DOMAIN_GROUP_KEYS.brief;
  }
  if (
    node.ref.kind === "observation" ||
    node.entityKind === "evaluation" ||
    node.entityKind === "violation"
  ) {
    return sourcedRecordGroup(node, observation, sourceArtifact);
  }
  const matchedArtifact = artifact?.id === node.ref.id ? artifact : undefined;
  const fromOperation = groupFromOperation(matchedArtifact);
  if (fromOperation) return fromOperation;
  const fromKind = groupFromTypedKind(
    matchedArtifact?.kind ?? node.artifactKind,
  );
  if (fromKind) return fromKind;
  if (
    node.entityKind === "requirement" &&
    hasUnambiguousDfmCheckCaseMembership(node.engineeringCaseRefs)
  ) {
    return OVERVIEW_DOMAIN_GROUP_KEYS.dfm;
  }
  const fromEntity = groupFromEntityKind(node.entityKind);
  if (fromEntity) return fromEntity;
  return node.system || OVERVIEW_DOMAIN_GROUP_KEYS.unassigned;
}

/** Exact seal or measured-check artifact; never a label or provider name. */
export function isOverviewDfmCaseOrResultArtifact(
  artifact?: ThreadArtifact,
): boolean {
  const operation = recordedOperation(artifact);
  return operation === DFM_SEAL_OPERATION ||
    operation === DFM_RUN_OPERATION;
}

/** Exact measured DFM-check capture; never a title or id-prefix heuristic. */
export function isOverviewDfmCheckCapture(
  artifact?: ThreadArtifact,
): boolean {
  return recordedOperation(artifact) === DFM_RUN_OPERATION;
}

/**
 * Validated `engineering-cases/1.1` dfm-check keys only. Mixed families stay
 * unambiguous non-DFM so ordinary SysML requirements remain SYSML.
 */
export function hasUnambiguousDfmCheckCaseMembership(
  refs: readonly string[] | undefined,
): boolean {
  if (refs === undefined || refs.length === 0) return false;
  return refs.every((key) => DFM_CHECK_CASE_KEY.test(key));
}

/** Presentation-only caption for a recorded group identity. */
export function overviewDomainGroupCaption(
  groupKey: string,
  lane?: EngineeringPathLaneId,
): string {
  const normalized = groupKey.trim();
  if (
    !normalized || normalized === "__ungrouped__" ||
    normalized === OVERVIEW_DOMAIN_GROUP_KEYS.unassigned
  ) {
    return "Recorded items";
  }
  if (normalized === OVERVIEW_DOMAIN_GROUP_KEYS.projectActivity) {
    return "Project activities";
  }
  if (normalized === OVERVIEW_DOMAIN_GROUP_KEYS.brief) return "Brief";
  if (normalized === OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel) {
    return "SYSML";
  }
  if (
    normalized === OVERVIEW_DOMAIN_GROUP_KEYS.geometry ||
    normalized === "family:canonical-geometry" ||
    normalized === "canonical-geometry"
  ) {
    return "Geometry";
  }
  if (normalized === OVERVIEW_DOMAIN_GROUP_KEYS.fea) {
    return lane === "verdicts" ? "FEA verdict" : "FEA";
  }
  if (normalized === OVERVIEW_DOMAIN_GROUP_KEYS.dfm) {
    return lane === "verdicts" ? "DFM verdict" : "DFM";
  }
  if (normalized === OVERVIEW_DOMAIN_GROUP_KEYS.simulation) {
    return "Simulation";
  }
  if (
    normalized === OVERVIEW_DOMAIN_GROUP_KEYS.assemblyIntegrity ||
    normalized === "assembly-integrity"
  ) {
    return lane === "verdicts"
      ? "Assembly integrity verdict"
      : "Assembly integrity";
  }
  if (
    normalized === OVERVIEW_DOMAIN_GROUP_KEYS.prescribedKinematics ||
    normalized === "prescribed-kinematics"
  ) {
    return lane === "verdicts"
      ? "Prescribed kinematics verdict"
      : "Prescribed kinematics";
  }
  const leaf = normalized.split(/[/:]/).filter(Boolean).at(-1) ?? normalized;
  return leaf.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

function sourcedRecordGroup(
  node: ThreadGraphNode,
  observation: ThreadObservation | undefined,
  sourceArtifact: ThreadArtifact | undefined,
): string {
  if (node.ref.kind === "observation") {
    if (!observation || observation.id !== node.ref.id) {
      return OVERVIEW_DOMAIN_GROUP_KEYS.unassigned;
    }
    if (!observation.sourceArtifactId) {
      return OVERVIEW_DOMAIN_GROUP_KEYS.unassigned;
    }
    if (
      !sourceArtifact || sourceArtifact.id !== observation.sourceArtifactId
    ) {
      return OVERVIEW_DOMAIN_GROUP_KEYS.unassigned;
    }
  } else if (
    node.entityKind === "evaluation" || node.entityKind === "violation"
  ) {
    if (!sourceArtifact) return OVERVIEW_DOMAIN_GROUP_KEYS.unassigned;
  } else {
    return OVERVIEW_DOMAIN_GROUP_KEYS.unassigned;
  }
  return groupFromOperation(sourceArtifact) ??
    groupFromTypedKind(sourceArtifact.kind) ??
    OVERVIEW_DOMAIN_GROUP_KEYS.unassigned;
}

/** Recorded run or unique case identity used only when labels collide. */
export function overviewRecordProvenanceQualifier(input: {
  readonly artifact?: ThreadArtifact;
  readonly sourceArtifact?: ThreadArtifact;
  readonly engineeringCaseRefs?: readonly string[];
}): string | undefined {
  const runId = input.artifact?.producer?.runId ??
    input.artifact?.producerRunId ??
    input.sourceArtifact?.producer?.runId ??
    input.sourceArtifact?.producerRunId;
  if (runId) return runId;
  const cases = input.engineeringCaseRefs?.filter(Boolean) ?? [];
  return cases.length === 1 ? cases[0] : undefined;
}

/**
 * Same-label independent records stay visible. A qualifier is appended only
 * when it uniquely distinguishes that collision; missing provenance stays
 * as the recorded label.
 */
export function overviewDisambiguatedRecordLabel(
  label: string,
  qualifier: string | undefined,
  collisionCount: number,
  qualifierIsUnique: boolean,
): string {
  if (collisionCount < 2 || !qualifier || !qualifierIsUnique) return label;
  return `${label} · ${qualifier}`;
}

function recordedOperation(
  artifact: ThreadArtifact | undefined,
): string | undefined {
  return artifact?.producer?.tool ?? artifact?.producedBy;
}

function groupFromOperation(
  artifact: ThreadArtifact | undefined,
): string | undefined {
  const operation = recordedOperation(artifact);
  if (!operation) return undefined;
  return FAMILY_BY_EXACT_OPERATION.get(operation) ??
    DOMAIN_BY_EXACT_OPERATION.get(operation);
}

function groupFromTypedKind(kind: string | undefined): string | undefined {
  if (kind === "sysml-model") return OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel;
  if (kind === "cad-model" || kind === "step") {
    return OVERVIEW_DOMAIN_GROUP_KEYS.geometry;
  }
  return undefined;
}

function groupFromEntityKind(
  entityKind: ThreadGraphNode["entityKind"],
): string | undefined {
  if (SYSML_ENTITY_KINDS.has(entityKind)) {
    return OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel;
  }
  return undefined;
}
