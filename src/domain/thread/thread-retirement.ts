/**
 * Domain-pure cascade computation for append-only entity retirement.
 *
 * WHY THIS MODULE EXISTS — "archiving" in this system is a RETRAIT, not a
 * deletion. A new revision records the retired status; every prior revision
 * stays intact and immutable. This module answers the question "if I retire
 * entity X, what else downstream must also be retired?" without ever touching
 * the store, the database, or a provider.
 *
 * Cascade direction: DOWNWARD along the production lineage.
 *   - artifact → artifacts that consume it as input (inputArtifactIds, or
 *     via derived_from provenance where to=cascaded artifact)
 *   - artifact → observations whose source.artifactIds includes it
 *   - observation → evaluations that cite it in observationIds
 *   - artifact → evaluations that cite it in evidenceArtifactIds
 *   - evaluation → violations that reference it via evaluationId
 *   - observation → violations that reference it via observationIds
 *
 * NEVER follows traces_to — a fact that *concerns* a part is not invalidated
 * by the retirement of one old version of that part's evidence. traces_to is
 * an anchoring relation, not a derivation chain.
 *
 * Already-archived entities (per the snapshot's changeSet.changes) are
 * excluded from the result so the output is idempotent and safe to re-apply.
 */

import type { ThreadEntityRef, ThreadSnapshot } from "./thread-snapshot.ts";
import { archivedRefKeys } from "./thread-snapshot.ts";

/** One entry in the cascade: the retired entity and the immediate cause. */
export interface ArchiveCascadeEntry {
  readonly ref: ThreadEntityRef;
  /**
   * Id of the element directly upstream that triggered the inclusion.
   * For the initial targets this equals ref.id itself.
   */
  readonly because: string;
}

/**
 * Typed error raised when a requested target is absent from the snapshot.
 *
 * code: "unknown_target" — machine-readable for error-routing by callers.
 * targetRef carries the exact entity reference that failed.
 */
export class UnknownArchiveTargetError extends Error {
  readonly code = "unknown_target";
  readonly targetRef: ThreadEntityRef;

  constructor(targetRef: ThreadEntityRef) {
    super(
      `Archive target ${targetRef.kind}:${targetRef.id} does not exist in the snapshot.`,
    );
    this.name = "UnknownArchiveTargetError";
    this.targetRef = targetRef;
  }
}

/**
 * Options for computeArchiveCascade.
 *
 * filterAlreadyArchived (default true): exclude entities already present in
 * archivedRefKeys(snapshot) from the result. Set to false when writing a new
 * revision that must include the full production closure even for entities
 * archived in a prior revision — this guarantees non-empty evidenceRefs on
 * idempotent executor replays, satisfying the domain invariant.
 */
export interface ArchiveCascadeOptions {
  readonly filterAlreadyArchived?: boolean;
}

/**
 * Compute the transitive downward closure for a set of retirement targets.
 *
 * Throws UnknownArchiveTargetError (fail-closed) if any target is not present
 * in the snapshot. By default, already-archived entities are excluded from the
 * result so the operation is idempotent with respect to prior revisions. Pass
 * { filterAlreadyArchived: false } to receive the full closure regardless of
 * prior archival status.
 *
 * Result order is deterministic: sorted by kind then id within each tier.
 */
export function computeArchiveCascade(
  snapshot: ThreadSnapshot,
  targets: ThreadEntityRef[],
  options?: ArchiveCascadeOptions,
): ReadonlyArray<ArchiveCascadeEntry> {
  if (targets.length === 0) return [];

  const filterAlreadyArchived = options?.filterAlreadyArchived ?? true;

  // Build fast-lookup sets for each entity kind.
  const entityIds = new Map<ThreadEntityRef["kind"], ReadonlySet<string>>([
    ["artifact", new Set(snapshot.artifacts.map((item) => item.id))],
    ["requirement", new Set(snapshot.requirements.map((item) => item.id))],
    ["observation", new Set(snapshot.observations.map((item) => item.id))],
    ["evaluation", new Set(snapshot.evaluations.map((item) => item.id))],
    ["violation", new Set(snapshot.violations.map((item) => item.id))],
    ["consumption", new Set(snapshot.consumptions.map((item) => item.id))],
    ["change", new Set(snapshot.changeSet.changes.map((item) => item.id))],
    ["action", new Set(snapshot.proposedActions.map((item) => item.id))],
  ]);

  // Validate all targets up front (fail-closed).
  for (const ref of targets) {
    const exists = entityIds.get(ref.kind)?.has(ref.id) ?? false;
    if (!exists) throw new UnknownArchiveTargetError(ref);
  }

  // Already-retired keys from the snapshot's accumulated changeSet.
  // When filterAlreadyArchived is false, we treat the set as empty so the
  // full production closure is returned regardless of prior archival status.
  const retired = filterAlreadyArchived ? archivedRefKeys(snapshot) : new Set<string>();

  // -- Phase 1: expand artifact transitive closure --------------------------
  //
  // Seed from artifact targets; follow inputArtifactIds AND derived_from
  // provenance links (to=cascaded artifact → from=downstream artifact).

  // Trigger maps deliberately retain already-archived ancestors. They carry
  // causal propagation to later descendants; the final assembly alone filters
  // entities whose archival fact is already recorded.
  const triggeredArtifacts = new Map<string, string>();
  const artifactWorklist: Array<{ id: string; because: string }> = [];

  for (const ref of targets) {
    if (ref.kind === "artifact") {
      artifactWorklist.push({ id: ref.id, because: ref.id });
    }
  }

  // Build a lookup: for each artifact, list of artifacts that have it in inputArtifactIds.
  const consumers = new Map<string, string[]>(); // upstream id → list of downstream ids
  for (const artifact of snapshot.artifacts) {
    for (const inputId of artifact.inputArtifactIds) {
      let list = consumers.get(inputId);
      if (!list) {
        list = [];
        consumers.set(inputId, list);
      }
      list.push(artifact.id);
    }
  }

  // Build derived_from index: to.id → array of from.ids (for artifacts only).
  const derivedFrom = new Map<string, string[]>(); // source id → list of derived ids
  for (const link of snapshot.provenance) {
    if (
      link.relation === "derived_from" &&
      link.from.kind === "artifact" &&
      link.to.kind === "artifact"
    ) {
      let list = derivedFrom.get(link.to.id);
      if (!list) {
        list = [];
        derivedFrom.set(link.to.id, list);
      }
      list.push(link.from.id);
    }
  }

  while (artifactWorklist.length > 0) {
    const { id, because } = artifactWorklist.pop()!;
    if (triggeredArtifacts.has(id)) continue;
    triggeredArtifacts.set(id, because);

    // Downstream via inputArtifactIds.
    for (const downstreamId of consumers.get(id) ?? []) {
      if (!triggeredArtifacts.has(downstreamId)) {
        artifactWorklist.push({ id: downstreamId, because: id });
      }
    }
    // Downstream via derived_from provenance (may overlap with inputArtifactIds
    // but exclusion by cascadedArtifacts.has prevents duplicates).
    for (const downstreamId of derivedFrom.get(id) ?? []) {
      if (!triggeredArtifacts.has(downstreamId)) {
        artifactWorklist.push({ id: downstreamId, because: id });
      }
    }
  }

  // -- Phase 2: observations that cite a cascaded artifact ------------------
  const triggeredObservations = new Map<string, string>(); // obs id → because
  for (const ref of targets) {
    if (ref.kind === "observation") {
      triggeredObservations.set(ref.id, ref.id);
    }
  }
  for (const obs of snapshot.observations) {
    const cause = obs.source.artifactIds.find((aid) => triggeredArtifacts.has(aid));
    if (cause !== undefined) {
      triggeredObservations.set(obs.id, cause);
    }
  }

  // -- Phase 3: requirement targets and their evaluations -------------------
  // A requirement is a direct retirement target, but its verdicts are
  // downstream current-state claims and must retire with it.
  const triggeredRequirements = new Map<string, string>();
  for (const ref of targets) {
    if (ref.kind === "requirement") {
      triggeredRequirements.set(ref.id, ref.id);
    }
  }

  // -- Phase 4: evaluations that cite cascaded requirements, observations or artifacts
  const triggeredEvaluations = new Map<string, string>(); // eval id → because
  for (const ref of targets) {
    if (ref.kind === "evaluation") {
      triggeredEvaluations.set(ref.id, ref.id);
    }
  }
  for (const ev of snapshot.evaluations) {
    if (triggeredRequirements.has(ev.requirementId)) {
      triggeredEvaluations.set(ev.id, ev.requirementId);
      continue;
    }
    const obsCause = ev.observationIds.find((oid) => triggeredObservations.has(oid));
    if (obsCause !== undefined) {
      triggeredEvaluations.set(ev.id, obsCause);
      continue;
    }
    const artCause = ev.evidenceArtifactIds.find((aid) => triggeredArtifacts.has(aid));
    if (artCause !== undefined) {
      triggeredEvaluations.set(ev.id, artCause);
    }
  }

  // -- Phase 5: violations that cite cascaded evaluations or observations ---
  const triggeredViolations = new Map<string, string>(); // violation id → because
  for (const ref of targets) {
    if (ref.kind === "violation") {
      triggeredViolations.set(ref.id, ref.id);
    }
  }
  for (const viol of snapshot.violations) {
    if (triggeredEvaluations.has(viol.evaluationId)) {
      triggeredViolations.set(viol.id, viol.evaluationId);
      continue;
    }
    const obsCause = viol.observationIds.find((oid) => triggeredObservations.has(oid));
    if (obsCause !== undefined) {
      triggeredViolations.set(viol.id, obsCause);
    }
  }

  // -- Assemble result, sorted for determinism ------------------------------
  const entries: ArchiveCascadeEntry[] = [];

  for (const [id, because] of triggeredArtifacts) {
    if (!retired.has(`artifact:${id}`)) {
      entries.push({ ref: { kind: "artifact", id }, because });
    }
  }
  for (const [id, because] of triggeredRequirements) {
    if (!retired.has(`requirement:${id}`)) {
      entries.push({ ref: { kind: "requirement", id }, because });
    }
  }
  for (const [id, because] of triggeredObservations) {
    if (!retired.has(`observation:${id}`)) {
      entries.push({ ref: { kind: "observation", id }, because });
    }
  }
  for (const [id, because] of triggeredEvaluations) {
    if (!retired.has(`evaluation:${id}`)) {
      entries.push({ ref: { kind: "evaluation", id }, because });
    }
  }
  for (const [id, because] of triggeredViolations) {
    if (!retired.has(`violation:${id}`)) {
      entries.push({ ref: { kind: "violation", id }, because });
    }
  }

  entries.sort((a, b) => {
    const kindCmp = a.ref.kind.localeCompare(b.ref.kind);
    return kindCmp !== 0 ? kindCmp : a.ref.id.localeCompare(b.ref.id);
  });

  return entries;
}

/**
 * Render a human-readable consent-gate summary of a cascade result.
 *
 * One line per entry; format: `  <kind>:<id>  (because: <because>)`.
 * Intended to be presented to the operator before the archive executor runs.
 */
export function renderArchiveCascadeSummary(
  cascade: ReadonlyArray<ArchiveCascadeEntry>,
): string {
  if (cascade.length === 0) return "(no entities to retire)";
  return cascade
    .map((entry) => `  ${entry.ref.kind}:${entry.ref.id}  (because: ${entry.because})`)
    .join("\n");
}
/** Exact identity of the provider-free Thread lineage retirement writer. */
export const ARCHIVE_LINEAGE_OPERATION = {
  id: "record.archive-lineage",
  version: "1",
} as const;
