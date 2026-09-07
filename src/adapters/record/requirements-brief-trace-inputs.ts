/** Exact, read-only source reopening for retrospective documentary trace records. */
import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import { reopenRequirementsBriefProvenance } from "../../application/use-cases/architecture/requirements/reopen-requirements-brief-provenance.ts";
import { EngineeringProjectCommandError } from "../../application/use-cases/project/engineering-project-command-service.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import type {
  RequirementsBriefTraceCaptureReference,
  RequirementsBriefTraceProposal,
} from "../../domain/record/requirements-brief-trace.ts";
import { requirementsBriefTraceClaimId } from "../../domain/record/requirements-brief-trace.ts";
import { selectRequirementsTip } from "../../domain/thread/requirements-tip.ts";
import {
  archivedRefKeys,
  type ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import {
  type ExactRequirementsPredecessorReaderDependencies,
  readExactRequirementsPredecessor,
} from "../architecture/requirements/exact-requirements-predecessor.ts";
import { parseExactRequirementsCapture } from "../architecture/requirements/requirements-capture.ts";
import { assertThreadSnapshotLineageIntact } from "../shared/stores/thread-snapshot-lineage.ts";
import {
  readRequirementsBriefTraceHistory,
  type RequirementsBriefTraceHistoryDependencies,
  selectRequirementsBriefClaimHead,
} from "./requirements-brief-trace-history.ts";
import { requirementsBriefTraceMemberMatchesProposal } from "./requirements-brief-trace-member.ts";

export interface RequirementsBriefTraceInputDependencies
  extends ExactRequirementsPredecessorReaderDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly traces: RequirementsBriefTraceHistoryDependencies["traces"];
}

/** No provider inspection: the target is a sealed historical capture, not live SysON. */
export async function reopenRequirementsTraceTarget(input: {
  readonly project: EngineeringProjectSnapshot;
  readonly base: ThreadSnapshot;
  readonly containerComponent: string;
  readonly expected?: RequirementsBriefTraceCaptureReference;
  readonly dependencies: RequirementsBriefTraceInputDependencies;
}) {
  const { project, base, dependencies: d } = input;
  validateThreadSnapshot(base);
  if (base.subject.id !== project.project.subjectId) {
    reject("The trace basis belongs to another project subject.");
  }
  await assertThreadSnapshotLineageIntact(base, d.snapshots);
  const tip = selectRequirementsTip(base, input.containerComponent);
  if (tip.kind !== "one") {
    reject(`The requirements family has no unique active tip (${tip.kind}).`);
  }
  const artifact = tip.artifact;
  const text = await d.captures.read(artifact.fingerprint);
  if (text === undefined) reject("The exact requirements capture is unavailable.");
  const capture = parseExactRequirementsCapture(JSON.parse(text));
  if (
    deterministicJson(capture) !== text ||
    !fingerprintsEqual(await sha256Fingerprint(capture), artifact.fingerprint)
  ) {
    reject("The requirements capture bytes do not equal their canonical fingerprint.");
  }
  const reference: RequirementsBriefTraceCaptureReference = {
    artifactId: artifact.id,
    fingerprint: artifact.fingerprint,
    producerRunId: capture.trustedRunId,
    schemaVersion: capture.schemaVersion,
  };
  if (
    input.expected && deterministicJson(input.expected) !== deterministicJson(reference)
  ) reject("The signed requirements reference is not the unique active capture.");
  const prior = await readExactRequirementsPredecessor(base, artifact, {
    containerComponent: input.containerComponent,
    partDefName: capture.partDefName,
    target: capture.target,
  }, d);
  const archived = archivedRefKeys(base);
  const requirements = base.requirements.filter((requirement) =>
    !archived.has(`requirement:${requirement.id}`) &&
    requirement.trace.sourceArtifactId === artifact.id
  );
  if (requirements.length !== prior.requirements.length) {
    reject(
      "The capture does not have a complete visible Thread requirements projection.",
    );
  }
  return { artifact, capture, reference, requirements };
}

/** Reopen both exact immutable sources; no labels/prose determine the correspondence. */
export async function resolveRequirementsBriefTraceInputs(input: {
  readonly project: EngineeringProjectSnapshot;
  readonly base: ThreadSnapshot;
  readonly proposal: RequirementsBriefTraceProposal;
  readonly dependencies: RequirementsBriefTraceInputDependencies;
  readonly mode: "current" | "historical";
}) {
  const target = await reopenRequirementsTraceTarget({
    ...input,
    containerComponent: input.proposal.requirements.containerComponent,
    expected: input.proposal.requirementsCapture,
  });
  const proposal = input.proposal.requirements;
  if (proposal.requirements.length !== 1) {
    reject(
      "A claim names exactly one canonical requirement; other requirements retain independent claims.",
    );
  }
  const entry = proposal.requirements[0]!;
  const captured = target.capture.requirements.find((item) =>
    item.metric === entry.metric
  );
  const proposed = {
    name: entry.name,
    metric: entry.metric,
    operator: entry.operator,
    limit: entry.threshold,
  };
  if (
    proposal.partDefName !== target.capture.partDefName || !captured ||
    !requirementsBriefTraceMemberMatchesProposal(captured, proposed)
  ) {
    reject(
      "The documentary declaration must preserve the selected captured requirement name, metric, operator, threshold and unit exactly.",
    );
  }
  const briefProvenance = await reopenRequirementsBriefProvenance({
    projects: input.dependencies.projects,
    projectId: input.project.project.id,
    proposal,
    mode: input.mode,
  });
  const requirements = target.requirements.filter((item) =>
    item.criterion.metric === captured.metric
  );
  if (requirements.length !== 1) {
    reject("The selected requirement has no unique exact Thread projection.");
  }
  const claimId = await requirementsBriefTraceClaimId(
    input.project.project.id,
    target.capture.target.elementId,
    captured.metric,
  );
  const history = await readRequirementsBriefTraceHistory({
    project: input.project,
    thread: input.base,
    dependencies: input.dependencies,
  });
  const previous = selectRequirementsBriefClaimHead(history, input.base, claimId);
  if (
    deterministicJson(previous?.reference ?? null) !==
      deterministicJson(input.proposal.predecessor ?? null)
  ) reject("The proposal does not name the exact current claim predecessor.");
  if (
    previous &&
    deterministicJson(previous.capture.requirementsCapture) ===
      deterministicJson(target.reference) &&
    deterministicJson(previous.capture.briefProvenance) ===
      deterministicJson(briefProvenance)
  ) {
    reject(
      "This claim repeats the same exact requirements and approved-brief sources; no new correspondence would be recorded.",
    );
  }
  const claim = {
    id: claimId,
    revision: (previous?.capture.claim.revision ?? 0) + 1,
    targetElementId: target.capture.target.elementId,
    requirementId: captured.metric,
    ...(previous ? { predecessor: previous.reference } : {}),
  };
  return { ...target, requirements, briefProvenance, claim };
}

function reject(message: string): never {
  throw new EngineeringProjectCommandError("invalid_input", message);
}
