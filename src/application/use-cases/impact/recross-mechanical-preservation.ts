/**
 * Exact recross helpers for X11 mechanical preservation.
 *
 * The unique accepted closeout naming the asserted mechanical execution
 * drives FEA resolution. Thread consumptions are reread, never invented from
 * JSON. Canonical STEP is the cad-asset sibling owned by the cad-model
 * attached to a completed design.write-geometry@1 run. Producer runs are
 * recrossed against the EngineeringProject ledger.
 */

import type { MechanicalPreservationCloseoutFacts } from "../../ports/out/impact/mechanical-preservation-closeout-reader.ts";
import type { CrossDomainImpactEvaluationCapture } from "../../../domain/impact/cross-domain-impact-evaluation-capture.ts";
import {
  type CrossDomainImpactDecisionCapture,
  crossDomainImpactDecisionCaptureUri,
} from "../../../domain/impact/cross-domain-impact-decision-capture.ts";
import { DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION } from "../../../domain/impact/cross-domain-impact-decision-proposal.ts";
import { recrossExactMechanicalProducerConsumptions } from "../../../domain/impact/cross-domain-impact-mechanical-evidence-consumptions.ts";
import {
  MECHANICAL_PRESERVATION_CLOSEOUT_ACCEPT_TOOL,
  MECHANICAL_PRESERVATION_FEA_PROOF_TOOL,
  MECHANICAL_PRESERVATION_PROOF_SEAL_TOOL,
  type MechanicalPreservationCloseoutEvidence,
  type MechanicalPreservationConsumption,
  type MechanicalPreservationFeaEvidence,
} from "../../../domain/impact/cross-domain-impact-mechanical-preservation.ts";
import type {
  CrossDomainImpactManifest,
  CrossDomainImpactReference,
} from "../../../domain/impact/cross-domain-impact-manifest.ts";
import {
  GEOMETRY_BINARY_CAPTURE_USE_RATIONALE,
  GEOMETRY_BINARY_TRACE_RATIONALE,
} from "../../../domain/cad/canonical/geometry-bundle.ts";
import { DESIGN_WRITE_GEOMETRY_OPERATION } from "../../../domain/cad/canonical/geometry-proposal.ts";
import { VERIFY_SEAL_PROOF_CASE_OPERATION } from "../../../domain/fea/seal-case/fea-proof-proposal.ts";
import { resolveGeometryForStep } from "../../../domain/fea/seal-case/fea-proof-seal-bindings.ts";
import { DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION } from "../../../domain/fea/evaluation-closeout/static-mechanical-evaluation-closeout-proposal.ts";
import {
  deterministicJson,
  fingerprintsEqual,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  EngineeringOperationRef,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
} from "../../../domain/project/engineering-project.ts";
import {
  archivedRefKeys,
  type ThreadArtifact,
  type ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import {
  expectedX08EvaluationArtifact,
  x08EvaluationArtifactIdentity,
} from "./recross-cross-domain-impact-decision.ts";

const CLOSEOUT_CAPTURE_URI_PREFIX =
  "casys://evaluation-closeout-capture/sha256/" as const;

export function expectedX09DecisionArtifact(
  capture: CrossDomainImpactDecisionCapture,
  captureFingerprint: ContentFingerprint,
) {
  return {
    id: `cross-domain-impact-decision-${captureFingerprint.digest}`,
    name: "Cross-domain impact decision",
    kind: "document" as const,
    version: captureFingerprint.digest,
    fingerprint: captureFingerprint,
    uri: crossDomainImpactDecisionCaptureUri(captureFingerprint.digest),
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool:
        `${DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.id}@${DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.version}`,
      runId: capture.trustedRunId,
    },
    inputArtifactIds: [capture.evaluationCapture.id],
    freshness: {
      status: "fresh" as const,
      changedAt: capture.sealedAt,
      invalidatedByChangeIds: [] as const,
    },
  };
}

export function expectedAcceptCloseoutArtifact(
  facts: MechanicalPreservationCloseoutFacts,
  fingerprint: ContentFingerprint,
) {
  return {
    id: `evaluation-closeout-${fingerprint.digest}`,
    name: "Accepted static-mechanical evaluation closeout",
    kind: "document" as const,
    version: fingerprint.digest,
    fingerprint,
    uri: `${CLOSEOUT_CAPTURE_URI_PREFIX}${fingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: MECHANICAL_PRESERVATION_CLOSEOUT_ACCEPT_TOOL,
      runId: facts.trustedRunId,
    },
    inputArtifactIds: [
      facts.inputs.canonicalStep.id,
      facts.inputs.sealedProof.id,
      facts.inputs.executionEvidence.id,
      facts.inputs.evaluationCapture.id,
    ],
    freshness: {
      status: "fresh" as const,
      changedAt: facts.sealedAt,
      invalidatedByChangeIds: [] as const,
    },
  };
}

export function samePublishedArtifactIdentity(
  artifact: ThreadArtifact,
  expected: ReturnType<typeof expectedX09DecisionArtifact>,
): boolean {
  return deterministicJson(x08EvaluationArtifactIdentity(artifact)) ===
    deterministicJson(expected);
}

export function recrossX08EvaluationArtifact(
  artifact: ThreadArtifact,
  capture: CrossDomainImpactEvaluationCapture,
  captureFingerprint: ContentFingerprint,
): boolean {
  return samePublishedArtifactIdentity(
    artifact,
    expectedX08EvaluationArtifact(capture, captureFingerprint),
  );
}

export function recrossX09DecisionArtifact(
  artifact: ThreadArtifact,
  capture: CrossDomainImpactDecisionCapture,
  captureFingerprint: ContentFingerprint,
): boolean {
  return samePublishedArtifactIdentity(
    artifact,
    expectedX09DecisionArtifact(capture, captureFingerprint),
  );
}

export function uniqueArtifact(
  snapshot: ThreadSnapshot,
  id: string,
): ThreadArtifact | undefined {
  const matches = snapshot.artifacts.filter((artifact) => artifact.id === id);
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Canonical STEP is the sandbox-exported cad-asset sibling of the unique
 * cad-model attached to a completed design.write-geometry@1 run. The STEP
 * producer is never that write-geometry run, and the STEP id is never the
 * geometry-run evidence.
 */
export function recrossCanonicalGeometryStep(
  project: EngineeringProjectSnapshot,
  snapshot: ThreadSnapshot,
  step: ThreadArtifact,
  expectedProducerRunId: string,
): boolean {
  const archived = archivedRefKeys(snapshot);
  const present = uniqueArtifact(snapshot, step.id);
  if (
    !present ||
    !fingerprintsEqual(present.fingerprint, step.fingerprint) ||
    archived.has(`artifact:${step.id}`) ||
    step.freshness.status !== "fresh" ||
    step.kind !== "step" ||
    step.mediaType !== "model/step" ||
    step.version !== step.fingerprint.digest ||
    step.producer.runId !== expectedProducerRunId ||
    step.producer.serverId !== "build123d-sandbox" ||
    step.producer.tool !== "build123d_export" ||
    step.inputArtifactIds.length !== 0
  ) {
    return false;
  }
  const geometry = resolveGeometryForStep(snapshot, step);
  if (geometry.status !== "one") return false;
  const capture = geometry.artifact;
  if (
    archived.has(`artifact:${capture.id}`) ||
    capture.id !== `geometry-${capture.fingerprint.digest}` ||
    capture.kind !== "cad-model" ||
    capture.mediaType !== "application/json" ||
    !recrossUniqueAttachedProducerRun(
      project,
      snapshot,
      capture,
      DESIGN_WRITE_GEOMETRY_OPERATION,
    )
  ) {
    return false;
  }
  return recrossCanonicalStepSiblingOwnership(snapshot, step, capture);
}

export function recrossAttachedProducerRun(
  project: EngineeringProjectSnapshot,
  current: ThreadSnapshot,
  artifact: ThreadArtifact,
  operation: Pick<EngineeringOperationRef, "id" | "version">,
): boolean {
  if (archivedRefKeys(current).has(`artifact:${artifact.id}`)) return false;
  if (artifact.freshness.status !== "fresh") return false;
  if (
    artifact.producer.serverId !== "digital-thread" ||
    artifact.producer.tool !== `${operation.id}@${operation.version}`
  ) {
    return false;
  }
  const present = uniqueArtifact(current, artifact.id);
  if (
    !present ||
    !fingerprintsEqual(present.fingerprint, artifact.fingerprint)
  ) {
    return false;
  }
  const runs = project.agentRuns.filter((run) => run.id === artifact.producer.runId);
  if (runs.length !== 1) return false;
  const run = runs[0]!;
  const workItems = project.workItems.filter((item) => item.id === run.workItemId);
  if (workItems.length !== 1) return false;
  const workItem = workItems[0]!;
  const declaredOperation = workItem.operation;
  if (
    run.status !== "completed" ||
    workItem.status !== "completed" ||
    !run.resultSnapshot ||
    run.resultSnapshot.subjectId !== current.subject.id ||
    declaredOperation?.id !== operation.id ||
    declaredOperation.version !== operation.version
  ) {
    return false;
  }
  const declared = project.threadSnapshots.filter((reference) =>
    reference.snapshotId === run.resultSnapshot!.snapshotId &&
    reference.revision === run.resultSnapshot!.revision &&
    reference.subjectId === run.resultSnapshot!.subjectId
  );
  if (declared.length !== 1) return false;
  const attached: EngineeringThreadEntityRef = {
    snapshotId: run.resultSnapshot.snapshotId,
    snapshotRevision: run.resultSnapshot.revision,
    kind: "artifact",
    id: artifact.id,
  };
  return hasEvidenceRef(run.evidenceRefs, attached) &&
    hasEvidenceRef(workItem.evidenceRefs, attached);
}

export function recrossCloseoutThreadConsumptions(
  snapshot: ThreadSnapshot,
  artifact: ThreadArtifact,
  inputs: MechanicalPreservationCloseoutFacts["inputs"],
): readonly MechanicalPreservationConsumption[] | undefined {
  const expectedInputs = [
    inputs.canonicalStep,
    inputs.sealedProof,
    inputs.executionEvidence,
    inputs.evaluationCapture,
  ];
  const producerConsumptions = snapshot.consumptions.filter((consumption) =>
    deterministicJson(consumption.consumer) === deterministicJson(artifact.producer)
  );
  if (producerConsumptions.length !== expectedInputs.length) return undefined;
  const recrossed: MechanicalPreservationConsumption[] = [];
  for (const input of expectedInputs) {
    const expectedId = `consume-${input.id}-by-${artifact.id}`;
    const matches = snapshot.consumptions.filter((item) => item.id === expectedId);
    if (matches.length !== 1) return undefined;
    const consumption = matches[0]!;
    if (
      consumption.status !== "verified" ||
      consumption.artifactId !== input.id ||
      !fingerprintsEqual(consumption.observedFingerprint, input.fingerprint) ||
      deterministicJson(consumption.consumer) !==
        deterministicJson(artifact.producer)
    ) {
      return undefined;
    }
    const uses = snapshot.provenance.some((link) =>
      link.relation === "uses" &&
      link.from.kind === "consumption" &&
      link.from.id === expectedId &&
      link.to.kind === "artifact" &&
      link.to.id === input.id
    );
    if (!uses) return undefined;
    recrossed.push({
      id: expectedId,
      input: { id: input.id, fingerprint: input.fingerprint },
      status: "verified",
    });
  }
  return recrossed.sort((left, right) => left.id.localeCompare(right.id));
}

export function selectAssertedMechanicalExecutionEvidence(
  manifest: CrossDomainImpactManifest,
  capture: CrossDomainImpactEvaluationCapture,
): CrossDomainImpactReference | undefined {
  return selectAssertedMechanicalIndependence(manifest, capture)?.evidence;
}

/**
 * Unique accepted mechanical closeout that names the asserted FEA execution
 * in `inputArtifactIds`. Unrelated closeouts for other executions are ignored.
 * Zero or multiple matches for the same asserted evidence stay unresolved.
 */
export function selectUniqueAcceptCloseoutArtifact(
  snapshot: ThreadSnapshot,
  assertedExecutionEvidenceId: string,
): ThreadArtifact | undefined {
  const archived = archivedRefKeys(snapshot);
  const candidates = snapshot.artifacts.filter((artifact) =>
    artifact.kind === "document" &&
    artifact.producer.serverId === "digital-thread" &&
    artifact.producer.tool === MECHANICAL_PRESERVATION_CLOSEOUT_ACCEPT_TOOL &&
    artifact.freshness.status === "fresh" &&
    !archived.has(`artifact:${artifact.id}`) &&
    artifact.inputArtifactIds.includes(assertedExecutionEvidenceId)
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function recrossAcceptedCloseoutEvidence(
  project: EngineeringProjectSnapshot,
  snapshot: ThreadSnapshot,
  artifact: ThreadArtifact,
  facts: MechanicalPreservationCloseoutFacts,
): MechanicalPreservationCloseoutEvidence | undefined {
  if (facts.consequence !== "accept") return undefined;
  if (facts.trustedRunId !== artifact.producer.runId) return undefined;
  if (
    facts.operation.id !== DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION.id ||
    facts.operation.version !== DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION.version
  ) {
    return undefined;
  }
  if (
    !recrossAttachedProducerRun(
      project,
      snapshot,
      artifact,
      DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION,
    )
  ) {
    return undefined;
  }
  const expected = expectedAcceptCloseoutArtifact(facts, artifact.fingerprint);
  if (!samePublishedArtifactIdentity(artifact, expected)) return undefined;
  const consumptions = recrossCloseoutThreadConsumptions(
    snapshot,
    artifact,
    facts.inputs,
  );
  if (!consumptions) return undefined;
  return {
    artifact: { id: artifact.id, fingerprint: artifact.fingerprint },
    producerTool: artifact.producer.tool,
    consequence: facts.consequence,
    inputs: {
      canonicalStep: {
        id: facts.inputs.canonicalStep.id,
        fingerprint: facts.inputs.canonicalStep.fingerprint,
      },
      sealedProof: {
        id: facts.inputs.sealedProof.id,
        fingerprint: facts.inputs.sealedProof.fingerprint,
      },
      executionEvidence: {
        id: facts.inputs.executionEvidence.id,
        fingerprint: facts.inputs.executionEvidence.fingerprint,
      },
      evaluationCapture: {
        id: facts.inputs.evaluationCapture.id,
        fingerprint: facts.inputs.evaluationCapture.fingerprint,
      },
    },
    consumptions,
  };
}

export function recrossFeaFromCloseout(
  project: EngineeringProjectSnapshot,
  snapshot: ThreadSnapshot,
  manifest: CrossDomainImpactManifest,
  capture: CrossDomainImpactEvaluationCapture,
  facts: MechanicalPreservationCloseoutFacts,
): MechanicalPreservationFeaEvidence | undefined {
  const archived = archivedRefKeys(snapshot);
  const execution = recrossNamedArtifact(
    snapshot,
    facts.inputs.executionEvidence,
    archived,
  );
  const sealedProof = recrossNamedArtifact(
    snapshot,
    facts.inputs.sealedProof,
    archived,
  );
  const canonicalStep = recrossNamedArtifact(
    snapshot,
    facts.inputs.canonicalStep,
    archived,
  );
  const l4Evaluation = recrossNamedArtifact(
    snapshot,
    facts.inputs.evaluationCapture,
    archived,
  );
  if (!execution || !sealedProof || !canonicalStep || !l4Evaluation) {
    return undefined;
  }
  if (
    execution.kind !== "evidence" ||
    execution.producer.tool !== MECHANICAL_PRESERVATION_FEA_PROOF_TOOL ||
    execution.producer.runId !== facts.inputs.executionEvidence.producerRunId
  ) {
    return undefined;
  }
  if (
    l4Evaluation.producer.tool !== MECHANICAL_PRESERVATION_FEA_PROOF_TOOL ||
    l4Evaluation.producer.runId !== facts.inputs.evaluationCapture.producerRunId
  ) {
    return undefined;
  }
  if (
    sealedProof.kind !== "document" ||
    sealedProof.producer.tool !== MECHANICAL_PRESERVATION_PROOF_SEAL_TOOL ||
    sealedProof.producer.runId !== facts.inputs.sealedProof.producerRunId
  ) {
    return undefined;
  }
  if (
    !recrossCanonicalGeometryStep(
      project,
      snapshot,
      canonicalStep,
      facts.inputs.canonicalStep.producerRunId,
    )
  ) {
    return undefined;
  }
  if (
    !recrossAttachedProducerRun(
      project,
      snapshot,
      execution,
      requiredOperation(MECHANICAL_PRESERVATION_FEA_PROOF_TOOL),
    ) ||
    !recrossAttachedProducerRun(
      project,
      snapshot,
      l4Evaluation,
      requiredOperation(MECHANICAL_PRESERVATION_FEA_PROOF_TOOL),
    ) ||
    !recrossAttachedProducerRun(
      project,
      snapshot,
      sealedProof,
      VERIFY_SEAL_PROOF_CASE_OPERATION,
    )
  ) {
    return undefined;
  }
  const consumptions = recrossFeaProducerConsumptions(
    snapshot,
    manifest,
    capture,
    execution,
  );
  if (!consumptions) return undefined;
  return {
    execution: {
      id: execution.id,
      fingerprint: execution.fingerprint,
      producer: execution.producer,
      kind: execution.kind,
      freshness: execution.freshness.status,
    },
    sealedProof: {
      id: sealedProof.id,
      fingerprint: sealedProof.fingerprint,
      producerTool: sealedProof.producer.tool,
    },
    canonicalStep: {
      id: canonicalStep.id,
      fingerprint: canonicalStep.fingerprint,
      kind: canonicalStep.kind,
      mediaType: canonicalStep.mediaType ?? "",
    },
    l4Evaluation: {
      id: l4Evaluation.id,
      fingerprint: l4Evaluation.fingerprint,
      producerTool: l4Evaluation.producer.tool,
    },
    consumptions,
  };
}

function selectAssertedMechanicalIndependence(
  manifest: CrossDomainImpactManifest,
  capture: CrossDomainImpactEvaluationCapture,
): {
  readonly assertion: CrossDomainImpactManifest["independenceAssertions"][number];
  readonly evidence: CrossDomainImpactReference;
} | undefined {
  const expectedAnchors = new Set(
    capture.evaluation.changedSources.map((changed) => {
      const anchor = manifest.sourceAnchors.find((item) =>
        item.id === changed.sourceAnchorId
      );
      return anchor
        ? `${anchor.id}:${anchor.threadChange.fingerprint.digest}:${anchor.source.fingerprint.digest}`
        : "";
    }),
  );
  expectedAnchors.delete("");
  const assertions = manifest.independenceAssertions.filter((assertion) =>
    assertion.branchId === "mechanical" &&
    sameInspectedAnchorSet(assertion.inspectedSourceAnchors, expectedAnchors)
  );
  if (assertions.length !== 1) return undefined;
  const assertion = assertions[0]!;
  if (
    capture.mechanicalFact.status !== "current" ||
    !capture.mechanicalFact.evidence ||
    capture.mechanicalFact.evidence.id !== assertion.evidence.id ||
    !fingerprintsEqual(
      capture.mechanicalFact.evidence.fingerprint,
      assertion.evidence.fingerprint,
    )
  ) {
    return undefined;
  }
  return { assertion, evidence: assertion.evidence };
}

function recrossFeaProducerConsumptions(
  snapshot: ThreadSnapshot,
  manifest: CrossDomainImpactManifest,
  capture: CrossDomainImpactEvaluationCapture,
  execution: ThreadArtifact,
): MechanicalPreservationConsumption[] | undefined {
  const asserted = selectAssertedMechanicalIndependence(manifest, capture);
  if (!asserted) return undefined;
  const { assertion } = asserted;
  if (
    assertion.evidence.id !== execution.id ||
    !fingerprintsEqual(assertion.evidence.fingerprint, execution.fingerprint)
  ) {
    return undefined;
  }
  const recrossedCore = recrossExactMechanicalProducerConsumptions({
    producer: execution.producer,
    evidence: { id: execution.id, fingerprint: execution.fingerprint },
    inspected: assertion.inspectedConsumptions,
    consumptions: snapshot.consumptions,
    artifacts: snapshot.artifacts,
    archived: archivedRefKeys(snapshot),
  });
  if (!recrossedCore) return undefined;
  const recrossed: MechanicalPreservationConsumption[] = recrossedCore.map(
    (item) => ({ ...item, status: "verified" as const }),
  );
  if (
    recrossed.length === 0 ||
    recrossed.length !== assertion.inspectedConsumptions.length ||
    recrossed.length !== capture.mechanicalFact.consumptions.length
  ) {
    return undefined;
  }
  const expected = new Set(
    assertion.inspectedConsumptions.map((item) =>
      `${item.id}:${item.input.id}:${item.input.fingerprint.digest}`
    ),
  );
  const recorded = new Set(
    capture.mechanicalFact.consumptions.map((item) =>
      `${item.id}:${item.input.id}:${item.input.fingerprint.digest}`
    ),
  );
  if (
    expected.size !== recorded.size ||
    [...expected].some((item) => !recorded.has(item))
  ) {
    return undefined;
  }
  return recrossed;
}

function recrossUniqueAttachedProducerRun(
  project: EngineeringProjectSnapshot,
  current: ThreadSnapshot,
  artifact: ThreadArtifact,
  operation: Pick<EngineeringOperationRef, "id" | "version">,
): boolean {
  if (!recrossAttachedProducerRun(project, current, artifact, operation)) {
    return false;
  }
  const run = project.agentRuns.find((item) => item.id === artifact.producer.runId);
  const workItem = run
    ? project.workItems.find((item) => item.id === run.workItemId)
    : undefined;
  return !!run && !!workItem &&
    run.evidenceRefs.length === 1 &&
    workItem.evidenceRefs.length === 1;
}

function recrossCanonicalStepSiblingOwnership(
  snapshot: ThreadSnapshot,
  step: ThreadArtifact,
  geometry: ThreadArtifact,
): boolean {
  const traces = snapshot.provenance.filter((link) =>
    link.relation === "traces_to" &&
    link.from.kind === "artifact" &&
    link.from.id === step.id &&
    link.to.kind === "artifact"
  );
  if (
    traces.length !== 1 ||
    traces[0]!.id !== `traces-${step.id}-from-${geometry.id}` ||
    traces[0]!.to.id !== geometry.id ||
    traces[0]!.rationale !== GEOMETRY_BINARY_TRACE_RATIONALE
  ) {
    return false;
  }
  const consumptionId = `consume-${geometry.id}-by-${step.id}`;
  const consumptions = snapshot.consumptions.filter((item) =>
    item.id === consumptionId
  );
  if (consumptions.length !== 1) return false;
  const consumption = consumptions[0]!;
  if (
    consumption.artifactId !== geometry.id ||
    consumption.status !== "verified" ||
    consumption.verifiedAt !== geometry.freshness.changedAt ||
    !fingerprintsEqual(consumption.observedFingerprint, geometry.fingerprint) ||
    deterministicJson(consumption.consumer) !==
      deterministicJson(geometry.producer)
  ) {
    return false;
  }
  const uses = snapshot.provenance.filter((link) =>
    link.relation === "uses" &&
    link.from.kind === "consumption" &&
    link.from.id === consumptionId &&
    link.to.kind === "artifact" &&
    link.to.id === geometry.id
  );
  return uses.length === 1 &&
    uses[0]!.id === `uses-${consumptionId}` &&
    uses[0]!.rationale === GEOMETRY_BINARY_CAPTURE_USE_RATIONALE;
}

function recrossNamedArtifact(
  snapshot: ThreadSnapshot,
  expected: { readonly id: string; readonly fingerprint: ContentFingerprint },
  archived: ReadonlySet<string>,
): ThreadArtifact | undefined {
  const artifact = uniqueArtifact(snapshot, expected.id);
  if (
    !artifact ||
    !fingerprintsEqual(artifact.fingerprint, expected.fingerprint) ||
    artifact.freshness.status !== "fresh" ||
    archived.has(`artifact:${artifact.id}`)
  ) {
    return undefined;
  }
  return artifact;
}

function operationFromTool(
  tool: string,
): Pick<EngineeringOperationRef, "id" | "version"> | undefined {
  const at = tool.lastIndexOf("@");
  if (at <= 0 || at === tool.length - 1) return undefined;
  return { id: tool.slice(0, at), version: tool.slice(at + 1) };
}

function requiredOperation(
  tool: string,
): Pick<EngineeringOperationRef, "id" | "version"> {
  const operation = operationFromTool(tool);
  if (!operation) {
    throw new TypeError(
      `Mechanical preservation tool ${tool} is not an operation identity.`,
    );
  }
  return operation;
}

function hasEvidenceRef(
  refs: readonly EngineeringThreadEntityRef[],
  expected: EngineeringThreadEntityRef,
): boolean {
  return refs.some((reference) =>
    reference.snapshotId === expected.snapshotId &&
    reference.snapshotRevision === expected.snapshotRevision &&
    reference.kind === expected.kind &&
    reference.id === expected.id
  );
}

function sameInspectedAnchorSet(
  inspected: CrossDomainImpactManifest["independenceAssertions"][number][
    "inspectedSourceAnchors"
  ],
  expected: ReadonlySet<string>,
): boolean {
  const actual = new Set(
    inspected.map((item) =>
      `${item.sourceAnchorId}:${item.threadChangeFingerprint.digest}:${item.sourceFingerprint.digest}`
    ),
  );
  return actual.size === expected.size &&
    [...actual].every((item) => expected.has(item));
}

export { expectedX08EvaluationArtifact };
