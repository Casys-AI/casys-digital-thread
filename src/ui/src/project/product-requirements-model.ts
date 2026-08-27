import type {
  ThreadComponent,
  ThreadEvidenceFamily,
  ThreadGraphRef,
  ThreadObservation,
  ThreadRequirement,
  ThreadViolation,
  ThreadWorkbenchSnapshot,
} from "../thread/types.ts";
import { currentRequirements } from "../thread/versioned-provenance-model.ts";

export type RequirementMatrixFilter = "all" | "pass" | "fail" | "unresolved";

export interface RequirementVerdictTrailStep {
  readonly id: string;
  readonly status: ThreadRequirement["status"];
  readonly label: string;
  readonly current: boolean;
}

export interface RequirementMatrixRow {
  readonly id: string;
  readonly label: string;
  readonly expression: string;
  readonly anchor: string;
  readonly status: ThreadRequirement["status"];
  readonly lastVerdict: string;
  readonly observationId?: string;
  readonly violationId?: string;
  /** Recorded observation display value, or "—". */
  readonly computed: string;
  /** Recorded violation margin string, or "—". Never calculated. */
  readonly marginLabel: string;
  /** Compact label built from the source artifact, or "—". */
  readonly evidenceLabel: string;
  /** Source artifact ref for the evidence chain; absent when not recorded. */
  readonly artifactRef?: {
    readonly id: string;
    readonly kind: string;
    readonly label: string;
    readonly fingerprint?: string;
  };
  /** Declared family members only. Empty when no requirement family exists. */
  readonly verdictTrail: readonly RequirementVerdictTrailStep[];
}

/**
 * The mark a row carries when the project has recorded nothing for a field.
 * It is a *display* value; deciding whether something was recorded is the
 * model's job, so views ask the predicates below instead of comparing it.
 */
export const UNRECORDED_FIELD = "—";

export function hasRecordedObservation(row: RequirementMatrixRow): boolean {
  return row.observationId !== undefined && row.computed !== UNRECORDED_FIELD;
}

export function hasRecordedMargin(row: RequirementMatrixRow): boolean {
  return row.marginLabel !== UNRECORDED_FIELD;
}

export function hasRecordedEvidence(row: RequirementMatrixRow): boolean {
  return row.evidenceLabel !== UNRECORDED_FIELD;
}

export interface RequirementMatrixView {
  readonly rows: readonly RequirementMatrixRow[];
  readonly counts: {
    readonly all: number;
    readonly pass: number;
    readonly fail: number;
    readonly unresolved: number;
  };
  /** Recorded violation margin only — never a computed percentage. */
  readonly worstMargin?: string;
}

export interface ProductSourcingCoverage {
  readonly boundCount: number;
  readonly componentCount: number;
  readonly badge: "GAP" | `${number}/${number}`;
}

/**
 * Requirement-first table for Product › Requirements (mockup 4a / 5a).
 * Joins only on structured identities. Last verdict is observation display
 * plus a recorded violation margin — never an invented RUN or percentage.
 */
export function buildRequirementMatrix(
  thread: ThreadWorkbenchSnapshot,
): RequirementMatrixView {
  const requirements = currentRequirements(
    thread.requirements,
    thread.evidenceFamilyGraph,
  );
  const rows = requirements.map((requirement) => toRow(requirement, thread));
  const pass = rows.filter((row) => row.status === "pass").length;
  const fail = rows.filter((row) => row.status === "fail").length;
  const unresolved = rows.length - pass - fail;
  const failMargins = rows.flatMap((row) => {
    if (row.status !== "fail") return [];
    const violation = thread.violations.find((item) =>
      item.id === row.violationId
    );
    return violation?.margin ? [violation.margin] : [];
  });
  return {
    rows,
    counts: { all: rows.length, pass, fail, unresolved },
    worstMargin: failMargins[0],
  };
}

export function filterRequirementRows(
  matrix: RequirementMatrixView,
  filter: RequirementMatrixFilter,
): readonly RequirementMatrixRow[] {
  if (filter === "all") return matrix.rows;
  return matrix.rows.filter((row) => row.status === filter);
}

export function productSourcingCoverage(
  thread: ThreadWorkbenchSnapshot,
): ProductSourcingCoverage {
  const components = thread.components.components;
  const boundCount =
    components.filter((component) =>
      component.bindings.some((binding) => binding.provider === "erpnext")
    ).length;
  return {
    boundCount,
    componentCount: components.length,
    badge: boundCount === 0 ? "GAP" : `${boundCount}/${components.length}`,
  };
}

function toRow(
  requirement: ThreadRequirement,
  thread: ThreadWorkbenchSnapshot,
): RequirementMatrixRow {
  const observation = latestObservation(
    requirement,
    thread.observations,
  );
  const violation = matchingViolation(requirement, thread.violations);
  const artifact = observation
    ? thread.artifacts.find(
      (item) => item.id === observation.sourceArtifactId,
    )
    : undefined;
  return {
    id: requirement.id,
    label: requirement.label,
    expression: requirement.expression,
    anchor: anchorLabel(requirement, thread.components.components),
    status: requirement.status,
    lastVerdict: lastVerdictLabel(requirement, observation, violation),
    observationId: observation?.id,
    violationId: violation?.id,
    computed: observation?.display ?? UNRECORDED_FIELD,
    marginLabel: violation?.margin ?? UNRECORDED_FIELD,
    evidenceLabel: artifact
      ? `${artifact.label} · ${artifact.system}`
      : UNRECORDED_FIELD,
    artifactRef: artifact
      ? {
        id: artifact.id,
        kind: artifact.kind,
        label: artifact.label,
        fingerprint: artifact.fingerprint,
      }
      : undefined,
    verdictTrail: requirementVerdictTrail(requirement, thread),
  };
}

/**
 * Compact recorded history for the expanded Product › Requirements row.
 * Membership and order come from the BFF family graph; missing members are
 * skipped rather than replaced with a fabricated revision.
 */
function requirementVerdictTrail(
  requirement: ThreadRequirement,
  thread: ThreadWorkbenchSnapshot,
): readonly RequirementVerdictTrailStep[] {
  const family = requirementFamilyContaining(
    requirement.id,
    thread.evidenceFamilyGraph.families,
  );
  if (!family) return [];
  const currentId = family.status === "current" &&
      family.currentRefs.length === 1
    ? family.currentRefs[0]!.id
    : undefined;
  return orderedFamilyRefs(family).flatMap((reference) => {
    const member = thread.requirements.find((item) => item.id === reference.id);
    if (!member) return [];
    const observation = latestObservation(member, thread.observations);
    const violation = matchingViolation(member, thread.violations);
    return [{
      id: member.id,
      status: member.status,
      label: trailStepLabel(member, observation, violation),
      current: member.id === currentId,
    }];
  });
}

function requirementFamilyContaining(
  requirementId: string,
  families: readonly ThreadEvidenceFamily[],
): ThreadEvidenceFamily | undefined {
  const matches = families.filter((family) =>
    family.entityKind === "requirement" &&
    familyRefs(family).some((reference) =>
      reference.kind === "requirement" && reference.id === requirementId
    )
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function matchingViolation(
  requirement: ThreadRequirement,
  violations: readonly ThreadViolation[],
): ThreadViolation | undefined {
  return requirement.violationIds
    .map((id) => violations.find((item) => item.id === id))
    .find((item) => item !== undefined);
}

function latestObservation(
  requirement: ThreadRequirement,
  observations: readonly ThreadObservation[],
): ThreadObservation | undefined {
  const matched = requirement.observationIds.flatMap((id) => {
    const observation = observations.find((item) => item.id === id);
    return observation ? [observation] : [];
  });
  return matched.toSorted((left, right) =>
    (right.measuredAt ?? "").localeCompare(left.measuredAt ?? "")
  )[0];
}

function lastVerdictLabel(
  requirement: ThreadRequirement,
  observation: ThreadObservation | undefined,
  violation: ThreadViolation | undefined,
): string {
  const parts: string[] = [];
  if (observation) parts.push(observation.display);
  if (violation?.margin) parts.push(violation.margin);
  if (parts.length > 0) return parts.join(" · ");
  return requirement.status === "unresolved"
    ? "No current observation"
    : requirement.status;
}

function trailStepLabel(
  requirement: ThreadRequirement,
  observation: ThreadObservation | undefined,
  violation: ThreadViolation | undefined,
): string {
  const recorded = lastVerdictLabel(requirement, observation, violation);
  if (recorded === requirement.status) return requirement.status;
  return `${requirement.status} · ${recorded}`;
}

function familyRefs(family: ThreadEvidenceFamily): ThreadGraphRef[] {
  return [...family.historicalRefs, ...family.currentRefs];
}

/**
 * Same declared-order walk as `orderedFamilyRefs` in the versioned provenance
 * model. Convergent predecessors stay in graph declaration order; a linear
 * supersession chain is followed rather than inventing R1 → R3 → R2.
 */
function orderedFamilyRefs(family: ThreadEvidenceFamily): ThreadGraphRef[] {
  const successorCounts = new Map<string, number>();
  for (const transition of family.transitions) {
    const key = refKey(transition.successor);
    successorCounts.set(key, (successorCounts.get(key) ?? 0) + 1);
  }
  if ([...successorCounts.values()].some((count) => count > 1)) {
    return [...family.historicalRefs, ...family.currentRefs];
  }

  const remaining = new Map(
    familyRefs(family).map((reference) =>
      [refKey(reference), reference] as const
    ),
  );
  const successorKeys = new Set(
    family.transitions.map((transition) => refKey(transition.successor)),
  );
  const successorByHistorical = new Map(
    family.transitions.map((transition) =>
      [refKey(transition.historical), transition.successor] as const
    ),
  );
  const ordered: ThreadGraphRef[] = [];
  for (const reference of family.historicalRefs) {
    if (successorKeys.has(refKey(reference))) continue;
    let current: ThreadGraphRef | undefined = reference;
    while (current && remaining.delete(refKey(current))) {
      ordered.push(current);
      current = successorByHistorical.get(refKey(current));
    }
  }
  for (const reference of familyRefs(family)) {
    if (remaining.delete(refKey(reference))) ordered.push(reference);
  }
  return ordered;
}

function refKey(reference: ThreadGraphRef): string {
  return `${reference.kind}:${reference.id}`;
}

function anchorLabel(
  requirement: ThreadRequirement,
  components: readonly ThreadComponent[],
): string {
  if (requirement.targetElementId) {
    const component = components.find((item) =>
      item.bindings.some((binding) =>
        binding.provider === "syson" &&
        binding.kind === "part-definition" &&
        binding.id === requirement.targetElementId
      )
    );
    return component?.label ?? requirement.targetElementId;
  }
  return requirement.sourceElementId;
}
