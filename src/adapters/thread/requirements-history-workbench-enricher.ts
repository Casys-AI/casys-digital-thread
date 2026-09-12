/**
 * BFF/MCP reopen of archived predecessor evaluations after recapture.
 *
 * Current requirement status, observationIds, violations and graph evaluates
 * edges stay the live projection. The enricher never writes evaluation edges,
 * promotes a verdict, or calls a solver. Lineage is the sealed supersedes
 * chain plus capture.predecessor identity/digest/run. Native join is
 * RequirementUsage + ConstraintUsage + criterion; sourceElementId alone is
 * not enough.
 */

import type { ThreadWorkbenchSnapshot } from "../../presentation/workbench/thread/snapshot.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import { isStudyBaseEvaluation } from "../../domain/sensitivity/base-evaluation/sensitivity-base-evaluation.ts";
import {
  HISTORICAL_UNJOINED_RELATION,
  sortHistoricalEvaluations,
  type ThreadRequirementHistoricalArchitectureBase,
  type ThreadRequirementHistoricalChain,
  type ThreadRequirementHistoricalChainReason,
  type ThreadRequirementHistoricalEvaluation,
  type ThreadRequirementHistoricalNativeIdentities,
  type ThreadRequirementHistoricalObservationRef,
  type ThreadRequirementHistoricalRef,
} from "../../domain/thread/requirement-historical-evaluation.ts";
import { archivedRefKeys } from "../../domain/thread/thread-snapshot.ts";
import type {
  RequirementEvaluation,
  ThreadArtifact,
  ThreadObservation,
  ThreadSnapshot,
  TracedRequirement,
} from "../../domain/thread/thread-snapshot.ts";
import { ARCHITECTURE_CAPTURE_URI_PREFIX } from "../shared/cas/file-capture-store.ts";
import {
  assertRequirementsRecaptureProvenanceContinuity,
  type ExactRequirementsCapture,
  isRecaptureRequirementsCapture,
  parseExactRequirementsCapture,
  recapturePredecessorArtifactMatches,
  requirementsCaptureArchitectureMatches,
  requirementsCaptureProducerTool,
} from "../architecture/requirements/requirements-capture.ts";
import {
  requirementsArtifactId,
  requirementsUriFor,
} from "../architecture/requirements/requirements-identities.ts";
import { REQUIREMENTS_CAPTURE_URI_PREFIX } from "../../domain/thread/requirements-tip.ts";
import type { RequirementsCaptureReader } from "./requirements-target-workbench-enricher.ts";
import { recrossHistoricalSensitivity } from "./requirements-history-sensitivity.ts";

export function composeHistoryCaptureReaders(
  ...readers: Array<RequirementsCaptureReader | undefined>
): RequirementsCaptureReader {
  const present = readers.filter(
    (reader): reader is RequirementsCaptureReader => reader !== undefined,
  );
  if (present.length === 1) return present[0]!;
  return {
    read: async (fingerprint: ContentFingerprint) => {
      for (const reader of present) {
        const text = await reader.read(fingerprint);
        if (text !== undefined) return text;
      }
      return undefined;
    },
  };
}

export async function enrichThreadWorkbenchWithRequirementsHistory(
  snapshot: ThreadWorkbenchSnapshot,
  captures: RequirementsCaptureReader,
  thread: ThreadSnapshot,
): Promise<ThreadWorkbenchSnapshot> {
  if (
    snapshot.subject.id !== thread.subject.id ||
    snapshot.requirements.length === 0
  ) {
    return snapshot;
  }
  const facts = await collectHistoricalEvaluations(snapshot, captures, thread);
  if (facts.size === 0) return snapshot;
  return {
    ...snapshot,
    requirements: snapshot.requirements.map((requirement) => {
      const fact = facts.get(requirement.id);
      return fact
        ? {
          ...requirement,
          historicalEvaluations: fact.historicalEvaluations,
          ...(fact.historicalChain ? { historicalChain: fact.historicalChain } : {}),
        }
        : requirement;
    }),
  };
}

interface HistoricalRequirementFact {
  readonly historicalEvaluations: readonly ThreadRequirementHistoricalEvaluation[];
  readonly historicalChain: ThreadRequirementHistoricalChain;
}

async function collectHistoricalEvaluations(
  snapshot: ThreadWorkbenchSnapshot,
  captures: RequirementsCaptureReader,
  thread: ThreadSnapshot,
): Promise<Map<string, HistoricalRequirementFact>> {
  const archived = archivedRefKeys(thread);
  const artifacts = new Map(
    thread.artifacts.map((artifact) => [artifact.id, artifact]),
  );
  const requirements = new Map(
    thread.requirements.map((requirement) => [requirement.id, requirement]),
  );
  const facts = new Map<string, HistoricalRequirementFact>();
  for (const projected of snapshot.requirements) {
    const current = requirements.get(projected.id);
    if (!current || archived.has(`requirement:${current.id}`)) continue;
    const historical = await recrossHistoricalChain(
      current,
      thread,
      artifacts,
      requirements,
      archived,
      captures,
    );
    if (historical) facts.set(current.id, historical);
  }
  return facts;
}

async function recrossHistoricalChain(
  current: TracedRequirement,
  thread: ThreadSnapshot,
  artifacts: ReadonlyMap<string, ThreadArtifact>,
  requirements: ReadonlyMap<string, TracedRequirement>,
  archived: ReadonlySet<string>,
  captures: RequirementsCaptureReader,
): Promise<HistoricalRequirementFact | undefined> {
  const currentArtifact = artifacts.get(current.trace.sourceArtifactId);
  if (!currentArtifact) return undefined;
  const currentCapture = await reopenRequirementsCapture(currentArtifact, captures);
  if (!currentCapture || !isRecaptureRequirementsCapture(currentCapture)) {
    return undefined;
  }
  const liveArchitectureArtifact = artifacts.get(
    currentCapture.architecture.artifactId,
  );
  if (
    !liveArchitectureArtifact ||
    !requirementsCaptureArchitectureMatches(
      currentCapture,
      liveArchitectureArtifact,
    ) ||
    !isArchitectureCaptureArtifact(liveArchitectureArtifact)
  ) {
    return undefined;
  }
  const currentArchitecture = architectureBase(liveArchitectureArtifact);
  const evaluations: ThreadRequirementHistoricalEvaluation[] = [];
  const seenEvaluationIds = new Set<string>();
  const visited = new Set<string>([current.id]);
  let cursor = current;
  let cursorArtifact = currentArtifact;
  let cursorCapture: ExactRequirementsCapture = currentCapture;
  let hopIndex = 0;
  let chain: ThreadRequirementHistoricalChain = { status: "complete", hops: 0 };

  while (isRecaptureRequirementsCapture(cursorCapture)) {
    hopIndex += 1;
    const hop = await recrossPredecessorHop({
      current,
      currentArchitecture,
      cursor,
      cursorArtifact,
      cursorCapture,
      hopIndex,
      thread,
      artifacts,
      requirements,
      archived,
      captures,
      visited,
      seenEvaluationIds,
    });
    if (hop.kind === "fail") {
      chain = {
        status: "partial",
        hops: hopIndex - 1,
        reason: hop.reason,
        stoppedAtRequirementId: cursor.id,
      };
      break;
    }
    visited.add(hop.predecessor.id);
    for (const evaluation of hop.evaluations) {
      seenEvaluationIds.add(evaluation.evaluationId);
      evaluations.push(evaluation);
    }
    cursor = hop.predecessor;
    cursorArtifact = hop.predecessorArtifact;
    cursorCapture = hop.predecessorCapture;
    chain = { status: "complete", hops: hopIndex };
  }

  if (evaluations.length === 0 && chain.status !== "partial") return undefined;
  return {
    historicalEvaluations: sortHistoricalEvaluations(evaluations),
    historicalChain: chain,
  };
}

type PredecessorHop =
  | {
    readonly kind: "fail";
    readonly reason: ThreadRequirementHistoricalChainReason;
  }
  | {
    readonly kind: "ok";
    readonly predecessor: TracedRequirement;
    readonly predecessorArtifact: ThreadArtifact;
    readonly predecessorCapture: ExactRequirementsCapture;
    readonly evaluations: readonly ThreadRequirementHistoricalEvaluation[];
  };

async function recrossPredecessorHop(input: {
  readonly current: TracedRequirement;
  readonly currentArchitecture: ThreadRequirementHistoricalArchitectureBase;
  readonly cursor: TracedRequirement;
  readonly cursorArtifact: ThreadArtifact;
  readonly cursorCapture: ExactRequirementsCapture;
  readonly hopIndex: number;
  readonly thread: ThreadSnapshot;
  readonly artifacts: ReadonlyMap<string, ThreadArtifact>;
  readonly requirements: ReadonlyMap<string, TracedRequirement>;
  readonly archived: ReadonlySet<string>;
  readonly captures: RequirementsCaptureReader;
  readonly visited: ReadonlySet<string>;
  readonly seenEvaluationIds: ReadonlySet<string>;
}): Promise<PredecessorHop> {
  const outbound = input.thread.provenance.filter((link) =>
    link.relation === "supersedes" &&
    link.from.kind === "requirement" &&
    link.from.id === input.cursor.id &&
    link.to.kind === "requirement"
  );
  if (outbound.length === 0) return { kind: "fail", reason: "gap" };
  if (outbound.length !== 1) {
    return { kind: "fail", reason: "ambiguous-supersedes" };
  }
  const predecessorId = outbound[0]!.to.id;
  const inbound = input.thread.provenance.filter((link) =>
    link.relation === "supersedes" &&
    link.to.kind === "requirement" &&
    link.to.id === predecessorId &&
    link.from.kind === "requirement"
  );
  if (inbound.length !== 1) {
    return { kind: "fail", reason: "ambiguous-supersedes" };
  }
  if (input.visited.has(predecessorId)) {
    return { kind: "fail", reason: "cyclic-supersedes" };
  }
  const predecessorOutbound = input.thread.provenance.filter((link) =>
    link.relation === "supersedes" &&
    link.from.kind === "requirement" &&
    link.from.id === predecessorId &&
    link.to.kind === "requirement"
  );
  if (predecessorOutbound.some((link) => input.visited.has(link.to.id))) {
    return { kind: "fail", reason: "cyclic-supersedes" };
  }
  if (!input.archived.has(`requirement:${predecessorId}`)) {
    return { kind: "fail", reason: "missing-predecessor" };
  }
  const predecessor = input.requirements.get(predecessorId);
  if (!predecessor) return { kind: "fail", reason: "missing-predecessor" };
  const predecessorArtifact = input.artifacts.get(
    predecessor.trace.sourceArtifactId,
  );
  if (
    !predecessorArtifact ||
    input.cursorArtifact.id === predecessorArtifact.id ||
    !input.cursorArtifact.inputArtifactIds.includes(predecessorArtifact.id)
  ) {
    return { kind: "fail", reason: "gap" };
  }
  if (
    !isRecaptureRequirementsCapture(input.cursorCapture) ||
    !recapturePredecessorArtifactMatches(input.cursorCapture, predecessorArtifact)
  ) {
    return { kind: "fail", reason: "gap" };
  }
  const predecessorCapture = await reopenRequirementsCapture(
    predecessorArtifact,
    input.captures,
  );
  if (predecessorCapture === undefined) {
    return {
      kind: "fail",
      reason: await captureFault(predecessorArtifact, input.captures),
    };
  }
  if (
    input.cursorCapture.containerComponent !==
      predecessorCapture.containerComponent
  ) {
    return { kind: "fail", reason: "gap" };
  }
  try {
    assertRequirementsRecaptureProvenanceContinuity(
      input.cursorCapture,
      predecessorCapture,
    );
  } catch {
    return { kind: "fail", reason: "wrong-producer-run" };
  }
  const native = correspondingNativeIdentities(
    input.cursor,
    predecessor,
    input.cursorCapture,
    predecessorCapture,
    input.cursorArtifact.fingerprint.digest,
    predecessorArtifact.fingerprint.digest,
  );
  if (!native) return { kind: "fail", reason: "native-identity-mismatch" };
  const predecessorArchitectureArtifact = input.artifacts.get(
    predecessorCapture.architecture.artifactId,
  );
  if (
    !predecessorArchitectureArtifact ||
    !requirementsCaptureArchitectureMatches(
      predecessorCapture,
      predecessorArchitectureArtifact,
    ) ||
    !isArchitectureCaptureArtifact(predecessorArchitectureArtifact)
  ) {
    return { kind: "fail", reason: "disconnected-architecture" };
  }
  const predecessorArchitecture = architectureBase(
    predecessorArchitectureArtifact,
  );
  const hopEvaluations = input.thread.evaluations.filter((item) =>
    item.requirementId === predecessor.id &&
    input.archived.has(`evaluation:${item.id}`) &&
    (item.status === "pass" || item.status === "fail" ||
      item.status === "unresolved")
  );
  const evaluationIds = hopEvaluations.map((item) => item.id);
  if (new Set(evaluationIds).size !== evaluationIds.length) {
    return { kind: "fail", reason: "duplicate-evaluation-id" };
  }
  if (evaluationIds.some((id) => input.seenEvaluationIds.has(id))) {
    return { kind: "fail", reason: "duplicate-evaluation-id" };
  }
  const evaluations: ThreadRequirementHistoricalEvaluation[] = [];
  for (const evaluation of hopEvaluations) {
    const projected = await projectHistoricalEvaluation({
      evaluation,
      predecessor,
      predecessorArtifact,
      predecessorArchitecture,
      native,
      currentRequirementId: input.current.id,
      currentArchitecture: input.currentArchitecture,
      hopIndex: input.hopIndex,
      thread: input.thread,
      artifacts: input.artifacts,
      captures: input.captures,
    });
    if (!projected) return { kind: "fail", reason: "conflicting-provenance" };
    evaluations.push(projected);
  }
  return {
    kind: "ok",
    predecessor,
    predecessorArtifact,
    predecessorCapture,
    evaluations,
  };
}

async function projectHistoricalEvaluation(input: {
  readonly evaluation: RequirementEvaluation;
  readonly predecessor: TracedRequirement;
  readonly predecessorArtifact: ThreadArtifact;
  readonly predecessorArchitecture: ThreadRequirementHistoricalArchitectureBase;
  readonly native: ThreadRequirementHistoricalNativeIdentities;
  readonly currentRequirementId: string;
  readonly currentArchitecture: ThreadRequirementHistoricalArchitectureBase;
  readonly hopIndex: number;
  readonly thread: ThreadSnapshot;
  readonly artifacts: ReadonlyMap<string, ThreadArtifact>;
  readonly captures: RequirementsCaptureReader;
}): Promise<ThreadRequirementHistoricalEvaluation | undefined> {
  const observations = recrossObservationRefs(
    input.evaluation,
    input.thread.observations,
    input.artifacts,
  );
  const evidence = recrossEvidenceRefs(input.evaluation, input.artifacts);
  if (!observations || !evidence) return undefined;
  if (observations.length === 0 && evidence.length === 0) return undefined;
  const sensitivity = await recrossHistoricalSensitivity(
    input.evaluation,
    input.predecessor,
    input.predecessorArchitecture,
    input.thread,
    input.artifacts,
    input.captures,
  );
  const family = isStudyBaseEvaluation(input.evaluation)
    ? "study-base" as const
    : undefined;
  return {
    relation: HISTORICAL_UNJOINED_RELATION,
    hopIndex: input.hopIndex,
    currentRequirementId: input.currentRequirementId,
    predecessorRequirementId: input.predecessor.id,
    evaluationId: input.evaluation.id,
    status: input.evaluation.status === "fail"
      ? "fail"
      : input.evaluation.status === "unresolved"
      ? "unresolved"
      : "pass",
    evaluatedAt: input.evaluation.evaluatedAt,
    ...(family ? { evaluationFamily: family } : {}),
    observations,
    evidence,
    predecessorCapture: {
      id: input.predecessorArtifact.id,
      fingerprint: projectedFingerprint(input.predecessorArtifact.fingerprint),
      producerRunId: input.predecessorArtifact.producer.runId,
    },
    currentArchitecture: input.currentArchitecture,
    predecessorArchitecture: input.predecessorArchitecture,
    native: input.native,
    ...(sensitivity ? { sensitivity } : {}),
  };
}

function correspondingNativeIdentities(
  current: TracedRequirement,
  predecessor: TracedRequirement,
  currentCapture: ExactRequirementsCapture,
  predecessorCapture: ExactRequirementsCapture,
  currentDigest: string,
  predecessorDigest: string,
): ThreadRequirementHistoricalNativeIdentities | undefined {
  if (
    current.trace.elementId !== currentCapture.requirementUsage.id ||
    predecessor.trace.elementId !== predecessorCapture.requirementUsage.id ||
    currentCapture.requirementUsage.id !==
      predecessorCapture.requirementUsage.id ||
    currentCapture.target.elementId !== predecessorCapture.target.elementId
  ) {
    return undefined;
  }
  const currentOracle = uniqueMatching(
    currentCapture.requirements,
    (item) => item.metric === current.criterion.metric,
  );
  const predecessorOracle = uniqueMatching(
    predecessorCapture.requirements,
    (item) => item.metric === predecessor.criterion.metric,
  );
  if (
    !currentOracle || !predecessorOracle ||
    currentOracle.id !== predecessorOracle.id ||
    currentOracle.metric !== predecessorOracle.metric ||
    currentOracle.operator !== predecessorOracle.operator ||
    deterministicJson(currentOracle.limit) !==
      deterministicJson(predecessorOracle.limit) ||
    current.id !== `requirement-${currentDigest}-${currentOracle.id}` ||
    predecessor.id !==
      `requirement-${predecessorDigest}-${predecessorOracle.id}` ||
    !sameCriterion(current, currentOracle) ||
    !sameCriterion(predecessor, predecessorOracle)
  ) {
    return undefined;
  }
  const currentConstraint = uniqueMatching(
    currentCapture.constraintUsages,
    (item) => item.requirementId === currentOracle.id,
  );
  const predecessorConstraint = uniqueMatching(
    predecessorCapture.constraintUsages,
    (item) => item.requirementId === predecessorOracle.id,
  );
  if (
    !currentConstraint || !predecessorConstraint ||
    currentConstraint.id !== predecessorConstraint.id
  ) {
    return undefined;
  }
  return {
    targetElementId: currentCapture.target.elementId,
    requirementUsageId: currentCapture.requirementUsage.id,
    constraintUsageId: currentConstraint.id,
    criterion: {
      metric: currentOracle.metric,
      operator: currentOracle.operator,
      limit: {
        value: currentOracle.limit.value,
        unit: currentOracle.limit.unit,
      },
    },
  };
}

function sameCriterion(
  requirement: TracedRequirement,
  oracle: {
    readonly metric: string;
    readonly operator: TracedRequirement["criterion"]["operator"];
    readonly limit: TracedRequirement["criterion"]["limit"];
  },
): boolean {
  return requirement.criterion.metric === oracle.metric &&
    requirement.criterion.operator === oracle.operator &&
    requirement.criterion.limit.value === oracle.limit.value &&
    requirement.criterion.limit.unit === oracle.limit.unit;
}

async function reopenRequirementsCapture(
  artifact: ThreadArtifact,
  captures: RequirementsCaptureReader,
): Promise<ExactRequirementsCapture | undefined> {
  if (
    artifact.kind !== "sysml-model" ||
    artifact.fingerprint.algorithm !== "sha256" ||
    artifact.uri !== requirementsUriFor(
        containerFromUri(artifact.uri ?? ""),
        artifact.fingerprint,
      ) ||
    artifact.id !== requirementsArtifactId(
        containerFromUri(artifact.uri ?? ""),
        artifact.fingerprint.digest,
      )
  ) {
    return undefined;
  }
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
    if (
      !fingerprintsEqual(
        await sha256Fingerprint(capture),
        artifact.fingerprint,
      )
    ) {
      return undefined;
    }
    if (
      artifact.producer.tool !== requirementsCaptureProducerTool(capture) ||
      capture.trustedRunId !== artifact.producer.runId ||
      capture.containerComponent !== containerFromUri(artifact.uri ?? "")
    ) {
      return undefined;
    }
    return capture;
  } catch {
    return undefined;
  }
}

async function captureFault(
  artifact: ThreadArtifact,
  captures: RequirementsCaptureReader,
): Promise<ThreadRequirementHistoricalChainReason> {
  let text: string | undefined;
  try {
    text = await captures.read(artifact.fingerprint);
  } catch {
    return "corrupt-cas";
  }
  return text === undefined ? "missing-cas" : "corrupt-cas";
}

function recrossObservationRefs(
  evaluation: RequirementEvaluation,
  observations: readonly ThreadObservation[],
  artifacts: ReadonlyMap<string, ThreadArtifact>,
): readonly ThreadRequirementHistoricalObservationRef[] | undefined {
  const refs: ThreadRequirementHistoricalObservationRef[] = [];
  const seen = new Set<string>();
  for (const observationId of evaluation.observationIds) {
    if (seen.has(observationId)) return undefined;
    seen.add(observationId);
    const observation = observations.find((item) => item.id === observationId);
    if (!observation) return undefined;
    const sources = recrossObservationSourceRefs(
      observation.source.artifactIds,
      artifacts,
    );
    if (!sources) return undefined;
    refs.push({
      id: observation.id,
      sourceArtifacts: sources,
    });
  }
  return refs;
}

function recrossObservationSourceRefs(
  artifactIds: readonly string[],
  artifacts: ReadonlyMap<string, ThreadArtifact>,
): readonly ThreadRequirementHistoricalRef[] | undefined {
  if (artifactIds.length === 0) return undefined;
  const refs: ThreadRequirementHistoricalRef[] = [];
  const seen = new Set<string>();
  for (const artifactId of artifactIds) {
    if (artifactId.length === 0 || seen.has(artifactId)) return undefined;
    seen.add(artifactId);
    const source = artifacts.get(artifactId);
    if (!source) return undefined;
    refs.push({
      id: source.id,
      fingerprint: projectedFingerprint(source.fingerprint),
    });
  }
  return refs;
}

function recrossEvidenceRefs(
  evaluation: RequirementEvaluation,
  artifacts: ReadonlyMap<string, ThreadArtifact>,
): readonly ThreadRequirementHistoricalRef[] | undefined {
  const refs: ThreadRequirementHistoricalRef[] = [];
  const seen = new Set<string>();
  for (const artifactId of evaluation.evidenceArtifactIds) {
    if (seen.has(artifactId)) return undefined;
    seen.add(artifactId);
    const artifact = artifacts.get(artifactId);
    if (!artifact) return undefined;
    refs.push({
      id: artifact.id,
      fingerprint: projectedFingerprint(artifact.fingerprint),
    });
  }
  return refs;
}

function uniqueMatching<T>(
  items: readonly T[],
  match: (item: T) => boolean,
): T | undefined {
  const matched = items.filter(match);
  return matched.length === 1 ? matched[0] : undefined;
}

function architectureBase(artifact: ThreadArtifact) {
  return {
    artifactId: artifact.id,
    fingerprint: projectedFingerprint(artifact.fingerprint),
    producerRunId: artifact.producer.runId,
  };
}

function isArchitectureCaptureArtifact(artifact: ThreadArtifact): boolean {
  return artifact.kind === "sysml-model" &&
    artifact.id === `architecture-${artifact.fingerprint.digest}` &&
    artifact.uri ===
      `${ARCHITECTURE_CAPTURE_URI_PREFIX}sha256/${artifact.fingerprint.digest}` &&
    artifact.fingerprint.algorithm === "sha256";
}

function projectedFingerprint(fingerprint: ContentFingerprint): string {
  return `${fingerprint.algorithm}:${fingerprint.digest}`;
}

function containerFromUri(uri: string): string {
  if (!uri.startsWith(REQUIREMENTS_CAPTURE_URI_PREFIX)) return "";
  const rest = uri.slice(REQUIREMENTS_CAPTURE_URI_PREFIX.length);
  const slash = rest.indexOf("/");
  return slash === -1 ? rest : rest.slice(0, slash);
}
