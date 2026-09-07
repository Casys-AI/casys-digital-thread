/**
 * Read-only brief-clause projection for sealed requirements captures.
 *
 * This is deliberately separate from the Thread graph and requirements target
 * enricher: it publishes no entity, edge, verdict, or provider payload.  A
 * browser receives a trace only after this adapter has reopened the exact
 * capture, its visible Thread requirements, the sealed historical Project
 * revision, and (when present) the current human-approved brief.
 */

import {
  assertTracedRequirementsRecaptureThreadContinuity,
  type ExactRequirementsCapture,
  isTracedRequirementsCapture,
  parseExactRequirementsCapture,
  requirementsCaptureObservedAt,
  requirementsCaptureProducerTool,
} from "../architecture/requirements/requirements-capture.ts";
import {
  requirementsArtifactId,
  requirementsUriFor,
} from "../architecture/requirements/requirements-identities.ts";
import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import { approvedBriefBasisForProject } from "../../application/use-cases/project/engineering-project-command-service.ts";
import {
  compareRequirementsBriefImpact,
  type RequirementsBriefImpactAvailable,
} from "../../domain/architecture/requirements/requirements-brief-impact.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import type { ProjectBriefRevision } from "../../domain/project/project-brief.ts";
import { REQUIREMENTS_CAPTURE_URI_PREFIX } from "../../domain/thread/requirements-tip.ts";
import { selectRequirementsTip } from "../../domain/thread/requirements-tip.ts";
import { parseRequirementsBriefTraceParameters } from "../../domain/record/requirements-brief-trace.ts";
import {
  readRequirementsBriefTraceHistory,
  type RequirementsBriefTraceHistoryDependencies,
  selectRequirementsBriefClaimHead,
} from "../record/requirements-brief-trace-history.ts";
import {
  archivedRefKeys,
  type ThreadArtifact,
  type ThreadSnapshot,
  type TracedRequirement,
} from "../../domain/thread/thread-snapshot.ts";
import type {
  EngineeringEvidenceWorkbenchSnapshot,
  EngineeringWorkbenchRequirementsBriefTrace,
  EngineeringWorkbenchRequirementsBriefTraceAvailable,
} from "../../presentation/workbench/engineering/evidence.ts";

/** Existing bounded capture-reader capability; no provider is contacted here. */
export interface RequirementsBriefTraceCaptureReader {
  read(fingerprint: {
    readonly algorithm: "sha256";
    readonly digest: string;
  }): Promise<string | undefined>;
}

/** Read capability only; the projection cannot mutate the Project ledger. */
export type RequirementsBriefTraceProjectHistory = Pick<
  EngineeringProjectRevisionStore,
  "getRevision"
>;

/**
 * Reopen visible requirements-capture artifacts and project their source
 * clauses.  A malformed, retired, non-canonical, or historically unprovable
 * traced capture is omitted; only an exact v3/v4 capture receives TRACE GAP.
 */
export async function projectRequirementsBriefTraces(input: {
  readonly project: EngineeringProjectSnapshot;
  readonly thread: ThreadSnapshot;
  readonly projects: RequirementsBriefTraceProjectHistory;
  readonly captures: RequirementsBriefTraceCaptureReader;
  readonly claimHistory?: RequirementsBriefTraceHistoryDependencies;
}): Promise<readonly EngineeringWorkbenchRequirementsBriefTrace[]> {
  const archived = archivedRefKeys(input.thread);
  const currentBrief = currentHumanApprovedBrief(input.project);
  const traces: EngineeringWorkbenchRequirementsBriefTrace[] = [];

  for (const artifact of input.thread.artifacts) {
    if (archived.has(`artifact:${artifact.id}`)) continue;
    if (
      artifact.kind !== "sysml-model" ||
      !artifact.uri?.startsWith(REQUIREMENTS_CAPTURE_URI_PREFIX)
    ) continue;
    const capture = await reopenExactCapture(artifact, input.captures);
    if (!capture || !isExactCaptureArtifact(artifact, capture)) continue;
    try {
      await assertTracedRequirementsRecaptureThreadContinuity(
        capture,
        artifact,
        input.thread.artifacts,
        input.captures,
      );
    } catch {
      continue;
    }
    const requirements = mappedVisibleRequirements(
      input.thread,
      artifact,
      capture,
      archived,
    );
    if (requirements === undefined) continue;

    const threadRequirementIds = requirements.map((requirement) => requirement.id)
      .toSorted((left, right) => left.localeCompare(right));
    if (!isTracedRequirementsCapture(capture)) {
      traces.push({
        artifactId: artifact.id,
        status: "TRACE GAP",
        threadRequirementIds,
      });
      continue;
    }

    const historicalBrief = await reopenHistoricalBrief(
      input.projects,
      input.project.project.id,
      capture,
    );
    if (!historicalBrief) continue;
    const impact = compareRequirementsBriefImpact({
      provenance: capture.briefProvenance,
      currentBrief,
    });
    if (impact.status !== "available") continue;
    const trace = availableTrace(
      artifact.id,
      requirements,
      impact,
    );
    if (trace) traces.push(trace);
  }

  if (input.claimHistory) {
    // Original native provenance is never overwritten. Documentary claims
    // have their own artifact ids, exact subjects, versions and brief basis.
    // A malformed chain is not replaced by a label-based best guess.
    try {
      const records = await readRequirementsBriefTraceHistory({
        project: input.project,
        thread: input.thread,
        dependencies: input.claimHistory,
      });
      const claimIds = new Set(records.map((record) => record.capture.claim.id));
      for (const claimId of claimIds) {
        const head = selectRequirementsBriefClaimHead(records, input.thread, claimId);
        if (!head) continue;
        const proposal = parseRequirementsBriefTraceParameters(head.capture.parameters);
        const tip = selectRequirementsTip(
          input.thread,
          proposal.requirements.containerComponent,
        );
        // A new native capture never inherits an old claim automatically.
        if (
          tip.kind !== "one" ||
          tip.artifact.id !== head.capture.requirementsCapture.artifactId
        ) continue;
        const capture = await reopenExactCapture(tip.artifact, input.captures);
        if (!capture || !isExactCaptureArtifact(tip.artifact, capture)) continue;
        const requirements = mappedVisibleRequirements(
          input.thread,
          tip.artifact,
          capture,
          archived,
        )?.filter((item) => item.criterion.metric === head.capture.claim.requirementId);
        if (!requirements || requirements.length !== 1) continue;
        const impact = compareRequirementsBriefImpact({
          provenance: head.capture.briefProvenance,
          currentBrief,
        });
        if (impact.status !== "available") continue;
        const projected = availableTrace(head.artifact.id, requirements, impact);
        if (!projected) continue;
        traces.push({
          ...projected,
          declaration: {
            kind: "retrospective-documentary",
            linkedAt: head.capture.linkedAt,
            artifactId: head.artifact.id,
            requirementsArtifactId: tip.artifact.id,
            claimId: head.capture.claim.id,
            revision: head.capture.claim.revision,
          },
        });
      }
    } catch {
      // Keep the original capture provenance/GAP, never fabricate a claim
      // when its published history cannot be established exactly.
    }
  }

  return traces.toSorted((left, right) =>
    left.artifactId.localeCompare(right.artifactId)
  );
}

/**
 * Explicit BFF hook for both preview and native Workbench composers.  The raw
 * Thread passed to the capture reader must be the same exact Thread revision
 * already projected into the browser snapshot.
 */
export async function enrichEngineeringEvidenceWorkbenchWithRequirementsBriefTraces(
  snapshot: EngineeringEvidenceWorkbenchSnapshot,
  input: {
    readonly sourceThread: ThreadSnapshot;
    readonly projects: RequirementsBriefTraceProjectHistory;
    readonly captures: RequirementsBriefTraceCaptureReader;
    readonly claimHistory?: RequirementsBriefTraceHistoryDependencies;
  },
): Promise<EngineeringEvidenceWorkbenchSnapshot> {
  if (
    input.sourceThread.id !== snapshot.thread.id ||
    input.sourceThread.revision !== snapshot.alignment.currentThreadRevision ||
    input.sourceThread.revision !== snapshot.thread.evidenceFamilyGraph.asOf.revision ||
    input.sourceThread.id !== snapshot.thread.evidenceFamilyGraph.asOf.snapshotId ||
    input.sourceThread.subject.id !== snapshot.thread.subject.id ||
    input.sourceThread.subject.id !== snapshot.project.project.subjectId
  ) {
    throw new TypeError(
      "Requirements brief trace source is not the exact projected Thread revision.",
    );
  }
  return {
    ...snapshot,
    requirementsBriefTraces: await projectRequirementsBriefTraces({
      project: snapshot.project,
      thread: input.sourceThread,
      projects: input.projects,
      captures: input.captures,
      claimHistory: input.claimHistory,
    }),
  };
}

async function reopenExactCapture(
  artifact: ThreadArtifact,
  captures: RequirementsBriefTraceCaptureReader,
): Promise<ExactRequirementsCapture | undefined> {
  if (artifact.fingerprint.algorithm !== "sha256") return undefined;
  let text: string | undefined;
  try {
    text = await captures.read(artifact.fingerprint);
  } catch {
    return undefined;
  }
  if (text === undefined) return undefined;
  try {
    const capture = parseExactRequirementsCapture(JSON.parse(text));
    if (deterministicJson(capture) !== text) return undefined;
    const fingerprint = await sha256Fingerprint(capture);
    return fingerprintsEqual(fingerprint, artifact.fingerprint) ? capture : undefined;
  } catch {
    return undefined;
  }
}

function isExactCaptureArtifact(
  artifact: ThreadArtifact,
  capture: ExactRequirementsCapture,
): boolean {
  return artifact.id ===
      requirementsArtifactId(capture.containerComponent, artifact.fingerprint.digest) &&
    artifact.kind === "sysml-model" &&
    artifact.version === artifact.fingerprint.digest &&
    artifact.uri ===
      requirementsUriFor(capture.containerComponent, artifact.fingerprint) &&
    artifact.mediaType === "application/json" &&
    artifact.producer.serverId === "syson" &&
    artifact.producer.tool === requirementsCaptureProducerTool(capture) &&
    artifact.producer.runId === capture.trustedRunId &&
    artifact.freshness.changedAt === requirementsCaptureObservedAt(capture);
}

/**
 * The join is capture artifact + RequirementUsage + canonical metric.  The
 * native ConstraintUsage is the capture-side proof that each metric appears
 * exactly once; no requirement label, rendered expression, or rationale is
 * read.
 */
function mappedVisibleRequirements(
  thread: ThreadSnapshot,
  artifact: ThreadArtifact,
  capture: ExactRequirementsCapture,
  archived: ReadonlySet<string>,
): readonly TracedRequirement[] | undefined {
  const constraintsByRequirementId = new Map(
    capture.constraintUsages.map((
      constraint,
    ) => [constraint.requirementId, constraint]),
  );
  const capturedByMetric = new Map(
    capture.requirements.map((requirement) => [requirement.metric, requirement]),
  );
  if (
    constraintsByRequirementId.size !== capture.requirements.length ||
    capturedByMetric.size !== capture.requirements.length
  ) return undefined;

  const visible = thread.requirements.filter((requirement) =>
    !archived.has(`requirement:${requirement.id}`) &&
    requirement.trace.sourceArtifactId === artifact.id &&
    requirement.trace.elementId === capture.requirementUsage.id
  );
  const mapped = new Map<string, TracedRequirement>();
  for (const requirement of visible) {
    const metric = requirement.criterion.metric;
    const captured = capturedByMetric.get(metric);
    const constraint = captured && constraintsByRequirementId.get(captured.id);
    if (
      !constraint || constraint.id !== constraint.sourceId || !captured ||
      mapped.has(captured.id) || !sameCriterion(requirement, captured) ||
      requirement.id !== `requirement-${artifact.fingerprint.digest}-${captured.id}`
    ) return undefined;
    mapped.set(captured.id, requirement);
  }
  if (mapped.size !== capture.requirements.length) return undefined;
  return [...mapped.values()];
}

function sameCriterion(
  requirement: TracedRequirement,
  captured: ExactRequirementsCapture["requirements"][number],
): boolean {
  return requirement.criterion.metric === captured.metric &&
    requirement.criterion.operator === captured.operator &&
    Object.is(requirement.criterion.limit.value, captured.limit.value) &&
    requirement.criterion.limit.unit === captured.limit.unit;
}

async function reopenHistoricalBrief(
  projects: RequirementsBriefTraceProjectHistory,
  projectId: string,
  capture: Extract<ExactRequirementsCapture, { readonly briefProvenance: unknown }>,
): Promise<ProjectBriefRevision | undefined> {
  const provenance = capture.briefProvenance;
  if (provenance.briefBasis.projectId !== projectId) return undefined;
  let historical: EngineeringProjectSnapshot | undefined;
  try {
    historical = await projects.getRevision(
      projectId,
      provenance.briefBasis.projectRevision,
    );
  } catch {
    return undefined;
  }
  if (
    !historical || historical.project.id !== projectId ||
    historical.id !== provenance.briefBasis.projectSnapshotId ||
    historical.revision !== provenance.briefBasis.projectRevision
  ) return undefined;
  let approvedBasis;
  try {
    approvedBasis = approvedBriefBasisForProject(historical);
  } catch {
    return undefined;
  }
  if (deterministicJson(approvedBasis) !== deterministicJson(provenance.briefBasis)) {
    return undefined;
  }
  const brief = historical.framing?.currentBrief;
  if (!brief) return undefined;
  try {
    const fingerprint = await sha256Fingerprint(brief);
    if (!fingerprintsEqual(fingerprint, provenance.briefContentFingerprint)) {
      return undefined;
    }
    return sealedSourcesMatchHistoricalBrief(capture, brief) ? brief : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A brief fingerprint establishes the revision as a whole. Recheck every
 * displayed source object too, so a forged capture cannot substitute a clause
 * while retaining a fingerprint copied from the real historical brief.
 */
function sealedSourcesMatchHistoricalBrief(
  capture: Extract<ExactRequirementsCapture, { readonly briefProvenance: unknown }>,
  brief: ProjectBriefRevision,
): boolean {
  const sources = [
    capture.briefProvenance.container.sourceItem,
    ...capture.briefProvenance.requirements.map((entry) => entry.sourceItem),
  ];
  const sourceIds = new Set<string>();
  for (const source of sources) {
    if (sourceIds.has(source.id)) return false;
    sourceIds.add(source.id);
    const matches = brief.items.filter((item) => item.id === source.id);
    if (
      matches.length !== 1 ||
      deterministicJson(matches[0]) !== deterministicJson(source)
    ) return false;
  }
  return true;
}

function currentHumanApprovedBrief(
  project: EngineeringProjectSnapshot,
): ProjectBriefRevision | undefined {
  try {
    approvedBriefBasisForProject(project);
    return project.framing?.currentBrief;
  } catch {
    return undefined;
  }
}

function availableTrace(
  artifactId: string,
  requirements: readonly TracedRequirement[],
  impact: RequirementsBriefImpactAvailable,
): EngineeringWorkbenchRequirementsBriefTraceAvailable | undefined {
  const impactByMetric = new Map(
    impact.requirements.map((requirement) => [requirement.requirementId, requirement]),
  );
  if (impactByMetric.size !== requirements.length) return undefined;
  const mapped = requirements.map((requirement) => {
    const source = impactByMetric.get(requirement.criterion.metric);
    if (!source) return undefined;
    return {
      threadRequirementId: requirement.id,
      requirementId: source.requirementId,
      sourceItemId: source.sourceItemId,
      originalSourceItem: structuredClone(source.originalSourceItem),
      ...(source.currentSourceItem === undefined
        ? {}
        : { currentSourceItem: structuredClone(source.currentSourceItem) }),
      state: source.state,
    };
  });
  if (mapped.some((entry) => entry === undefined)) return undefined;
  const exactRequirements =
    mapped as EngineeringWorkbenchRequirementsBriefTraceAvailable[
      "requirements"
    ];
  return {
    artifactId,
    status: "available",
    threadRequirementIds: requirements.map((requirement) => requirement.id)
      .toSorted((left, right) => left.localeCompare(right)),
    originalBrief: {
      briefId: impact.originalBrief.briefId,
      snapshotId: impact.originalBrief.snapshotId,
      revision: impact.originalBrief.revision,
    },
    ...(impact.currentBrief === undefined
      ? {}
      : { currentBrief: structuredClone(impact.currentBrief) }),
    container: {
      sourceItemId: impact.container.sourceItemId,
      originalSourceItem: structuredClone(impact.container.originalSourceItem),
      ...(impact.container.currentSourceItem === undefined
        ? {}
        : { currentSourceItem: structuredClone(impact.container.currentSourceItem) }),
      state: impact.container.state,
    },
    requirements: exactRequirements.toSorted((left, right) =>
      left.threadRequirementId.localeCompare(right.threadRequirementId)
    ),
  };
}
