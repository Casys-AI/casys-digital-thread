/**
 * Server-owned X11 mechanical preservation recross.
 *
 * The command has no agent-selected causal input. It starts from the exact
 * queued Thread basis after X09, reopens the unique impact-decision capture
 * and its X08 evaluation, recrosses Brief V2 and the reviewed independence
 * assertion, then selects the unique accepted closeout that names that
 * asserted mechanical execution evidence. FEA identities come from that
 * closeout. Missing or inexact FEA facts stay impact-unresolved.
 */

import type {
  EvaluateMechanicalPreservationCommand,
  EvaluateMechanicalPreservationDiagnostic,
  EvaluateMechanicalPreservationResult,
  EvaluateMechanicalPreservationUseCase,
} from "../../ports/in/impact/evaluate-mechanical-preservation.ts";
import type { EngineeringProjectRevisionStore } from "../../ports/out/engineering-project-revision-store.ts";
import type { CrossDomainImpactBriefGateReader } from "../../ports/out/impact/cross-domain-impact-brief-gate-reader.ts";
import type {
  CrossDomainImpactDecisionCaptureStore,
  CrossDomainImpactEvaluationCaptureStore,
} from "../../ports/out/impact/cross-domain-impact-capture-store.ts";
import type { CrossDomainImpactManifestReader } from "../../ports/out/impact/cross-domain-impact-manifest-reader.ts";
import type {
  MechanicalPreservationCloseoutFacts,
  MechanicalPreservationCloseoutReader,
} from "../../ports/out/impact/mechanical-preservation-closeout-reader.ts";
import {
  DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION,
} from "../../../domain/impact/cross-domain-impact-decision-proposal.ts";
import {
  ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION,
} from "../../../domain/impact/cross-domain-impact-evaluation-proposal.ts";
import {
  type CrossDomainImpactEvaluationCapture,
  crossDomainImpactEvaluationCaptureUri,
} from "../../../domain/impact/cross-domain-impact-evaluation-capture.ts";
import {
  ANALYZE_EVALUATE_MECHANICAL_PRESERVATION_OPERATION,
  MECHANICAL_PRESERVATION_LIMITS,
} from "../../../domain/impact/cross-domain-impact-mechanical-preservation-proposal.ts";
import {
  evaluateMechanicalPreservation,
  type MechanicalPreservationCloseoutEvidence,
  type MechanicalPreservationFeaEvidence,
} from "../../../domain/impact/cross-domain-impact-mechanical-preservation.ts";
import {
  recrossAcceptedCloseoutEvidence,
  recrossAttachedProducerRun,
  recrossFeaFromCloseout,
  recrossX08EvaluationArtifact,
  recrossX09DecisionArtifact,
  selectAssertedMechanicalExecutionEvidence,
  selectUniqueAcceptCloseoutArtifact,
  uniqueArtifact,
} from "./recross-mechanical-preservation.ts";
import {
  validateMechanicalPreservationCapture,
} from "../../../domain/impact/cross-domain-impact-mechanical-preservation-capture.ts";
import {
  type CrossDomainImpactManifestSealBriefGate,
} from "../../../domain/impact/cross-domain-impact-manifest-proposal.ts";
import {
  type CrossDomainImpactManifest,
  type CrossDomainImpactReference,
  validateCrossDomainImpactManifest,
} from "../../../domain/impact/cross-domain-impact-manifest.ts";
import { positiveInteger, safeId } from "../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
} from "../../../domain/project/engineering-project.ts";
import {
  archivedRefKeys,
  type ThreadArtifact,
  type ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";

export interface PrepareMechanicalPreservationDependencies {
  readonly projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly snapshots: Pick<ThreadSnapshotStore, "get">;
  readonly manifests: CrossDomainImpactManifestReader;
  readonly evaluationCaptures: CrossDomainImpactEvaluationCaptureStore;
  readonly decisionCaptures: CrossDomainImpactDecisionCaptureStore;
  readonly briefGates: CrossDomainImpactBriefGateReader;
  readonly closeouts: MechanicalPreservationCloseoutReader;
}

type ReviewCode =
  | "invalid_request"
  | "project_unavailable"
  | "basis_unavailable"
  | "decision_capture_unavailable"
  | "decision_capture_mismatch"
  | "decision_capture_archived"
  | "evaluation_capture_unavailable"
  | "evaluation_capture_mismatch"
  | "manifest_unavailable"
  | "manifest_mismatch"
  | "brief_unavailable"
  | "brief_mismatch"
  | "brief_not_v2";

export class PrepareMechanicalPreservation
  implements EvaluateMechanicalPreservationUseCase {
  constructor(
    private readonly dependencies: PrepareMechanicalPreservationDependencies,
  ) {}

  async execute(
    command: EvaluateMechanicalPreservationCommand,
  ): Promise<EvaluateMechanicalPreservationResult> {
    let normalized: EvaluateMechanicalPreservationCommand;
    try {
      normalized = normalizeCommand(command);
    } catch {
      return unresolved(
        "invalid_request",
        "The mechanical-preservation command is not an exact server-run basis.",
      );
    }

    let project: EngineeringProjectSnapshot | undefined;
    try {
      project = await this.dependencies.projects.get(normalized.projectId);
    } catch {
      return unavailable(
        "project_unavailable",
        "The mechanical-preservation project is unavailable.",
      );
    }
    if (!project || project.project.id !== normalized.projectId) {
      return unavailable(
        "project_unavailable",
        "The mechanical-preservation project is unavailable.",
      );
    }
    if (!isCurrentProjectBasis(project, normalized.basis)) {
      return unavailable(
        "basis_unavailable",
        "The queued mechanical-preservation basis is not the unique current project Thread head.",
      );
    }

    let head: ThreadSnapshot | undefined;
    try {
      head = await this.dependencies.snapshots.get(normalized.basis.snapshotId);
      if (head) head = validateThreadSnapshot(head);
    } catch {
      return unavailable(
        "basis_unavailable",
        "The exact queued mechanical-preservation Thread basis is unavailable.",
      );
    }
    if (!head || !sameBasisSnapshot(head, normalized.basis)) {
      return unavailable(
        "basis_unavailable",
        "The exact queued mechanical-preservation Thread basis is unavailable.",
      );
    }

    const decisionArtifact = selectUniqueDecisionArtifact(
      project,
      head,
      normalized.basis,
    );
    if (!decisionArtifact) {
      return unavailable(
        "decision_capture_unavailable",
        "The current Thread basis has no unique exact cross-domain impact-decision capture.",
      );
    }
    if (archivedRefKeys(head).has(`artifact:${decisionArtifact.id}`)) {
      return unresolved(
        "decision_capture_archived",
        "The exact impact-decision capture is archived.",
      );
    }
    if (decisionArtifact.freshness.status !== "fresh") {
      return unresolved(
        "decision_capture_mismatch",
        "The exact impact-decision capture is not fresh.",
      );
    }

    let decisionCapture;
    try {
      decisionCapture = await this.dependencies.decisionCaptures.read(
        decisionArtifact.fingerprint,
      );
    } catch {
      return unavailable(
        "decision_capture_unavailable",
        "The exact impact-decision capture is unavailable.",
      );
    }
    if (!decisionCapture) {
      return unavailable(
        "decision_capture_unavailable",
        "The exact impact-decision capture is unavailable.",
      );
    }
    const decisionFingerprint = await sha256Fingerprint(decisionCapture);
    if (
      decisionCapture.trustedRunId !== decisionArtifact.producer.runId ||
      decisionCapture.evaluationCapture.id !==
        decisionCapture.admission.evaluation.capture.id ||
      !fingerprintsEqual(
        decisionCapture.evaluationCapture.fingerprint,
        decisionCapture.admission.evaluation.capture.fingerprint,
      ) ||
      !fingerprintsEqual(decisionFingerprint, decisionArtifact.fingerprint) ||
      !recrossX09DecisionArtifact(
        decisionArtifact,
        decisionCapture,
        decisionFingerprint,
      )
    ) {
      return unresolved(
        "decision_capture_mismatch",
        "The impact-decision capture does not recross its exact X09 trusted run.",
      );
    }

    const evaluationArtifact = uniqueArtifact(
      head,
      decisionCapture.evaluationCapture.id,
    );
    if (
      !evaluationArtifact ||
      !fingerprintsEqual(
        evaluationArtifact.fingerprint,
        decisionCapture.evaluationCapture.fingerprint,
      ) ||
      evaluationArtifact.producer.tool !==
        `${ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.id}@${ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.version}` ||
      archivedRefKeys(head).has(`artifact:${evaluationArtifact.id}`) ||
      evaluationArtifact.freshness.status !== "fresh"
    ) {
      return unresolved(
        "evaluation_capture_mismatch",
        "The exact impact-evaluation capture is not the current X08 document.",
      );
    }

    let evaluationCapture: CrossDomainImpactEvaluationCapture | undefined;
    try {
      evaluationCapture = await this.dependencies.evaluationCaptures.read(
        evaluationArtifact.fingerprint,
      );
    } catch {
      return unavailable(
        "evaluation_capture_unavailable",
        "The exact impact-evaluation capture is unavailable.",
      );
    }
    if (!evaluationCapture) {
      return unavailable(
        "evaluation_capture_unavailable",
        "The exact impact-evaluation capture is unavailable.",
      );
    }
    const evaluationFingerprint = await sha256Fingerprint(evaluationCapture);
    if (
      !fingerprintsEqual(evaluationFingerprint, evaluationArtifact.fingerprint) ||
      evaluationCapture.trustedRunId !==
        decisionCapture.admission.evaluation.trustedRunId ||
      evaluationArtifact.uri !==
        crossDomainImpactEvaluationCaptureUri(evaluationFingerprint.digest) ||
      !recrossX08EvaluationArtifact(
        evaluationArtifact,
        evaluationCapture,
        evaluationFingerprint,
      ) ||
      !recrossAttachedProducerRun(
        project,
        head,
        evaluationArtifact,
        ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION,
      )
    ) {
      return unresolved(
        "evaluation_capture_mismatch",
        "The impact-evaluation capture does not recross its exact X08 trusted run.",
      );
    }

    let reopenedManifest;
    try {
      reopenedManifest = await this.dependencies.manifests.read({
        fingerprint: evaluationCapture.manifest.reference,
      });
    } catch {
      return unavailable(
        "manifest_unavailable",
        "The exact closed cross-domain impact manifest is unavailable.",
      );
    }
    if (!reopenedManifest) {
      return unavailable(
        "manifest_unavailable",
        "The exact closed cross-domain impact manifest is unavailable.",
      );
    }
    let manifest: CrossDomainImpactManifest;
    try {
      manifest = await validateCrossDomainImpactManifest(reopenedManifest.manifest);
    } catch {
      return unresolved(
        "manifest_mismatch",
        "The reopened cross-domain impact manifest is not a closed exact document.",
      );
    }
    if (
      manifest.id !== evaluationCapture.manifest.id ||
      !fingerprintsEqual(
        manifest.fingerprint,
        evaluationCapture.manifest.fingerprint,
      ) ||
      !fingerprintsEqual(
        reopenedManifest.reference.fingerprint,
        evaluationCapture.manifest.reference,
      )
    ) {
      return unresolved(
        "manifest_mismatch",
        "The reopened manifest does not match the exact evaluation-capture manifest.",
      );
    }

    let approvedBrief;
    try {
      approvedBrief = await this.dependencies.briefGates.read(normalized.projectId);
    } catch {
      return unavailable(
        "brief_unavailable",
        "The current approved Brief V2 is unavailable.",
      );
    }
    if (!approvedBrief) {
      return unavailable(
        "brief_unavailable",
        "The current approved Brief V2 is unavailable.",
      );
    }
    if (
      approvedBrief.contractVersion !== "2.0" ||
      approvedBrief.projectId !== normalized.projectId
    ) {
      return unresolved(
        "brief_not_v2",
        "Mechanical preservation requires the current approved Brief V2 with explicit gate dependencies.",
      );
    }
    if (
      approvedBrief.brief.id !== evaluationCapture.brief.id ||
      approvedBrief.brief.revision !== evaluationCapture.brief.revision ||
      !fingerprintsEqual(
        approvedBrief.brief.fingerprint,
        evaluationCapture.brief.fingerprint,
      )
    ) {
      return unresolved(
        "brief_mismatch",
        "The current approved Brief V2 is not the exact impact-evaluation brief gate.",
      );
    }
    let briefGates: readonly CrossDomainImpactManifestSealBriefGate[];
    try {
      briefGates = recrossCurrentBriefGates(evaluationCapture, approvedBrief);
    } catch {
      return unresolved(
        "brief_mismatch",
        "The current approved Brief V2 does not recross every exact impact-evaluation gate.",
      );
    }

    const recrossedCloseout = await this.#selectCloseout(
      project,
      head,
      selectAssertedMechanicalExecutionEvidence(manifest, evaluationCapture)?.id,
    );
    const closeout = recrossedCloseout?.evidence ?? null;
    const feaEvidence = recrossedCloseout
      ? recrossFeaFromCloseout(
        project,
        head,
        manifest,
        evaluationCapture,
        recrossedCloseout.facts,
      ) ?? null
      : null;
    const preservation = await evaluateMechanicalPreservation({
      manifest,
      evaluation: evaluationCapture.evaluation,
      project: manifest.project,
      subject: manifest.subject,
      basis: manifest.basis,
      reviewTrigger: evaluationCapture.evaluation.reviewTrigger,
      evaluatedAt: normalized.evaluatedAt,
      feaEvidence,
      closeout,
    });

    let artifactInputs: readonly CrossDomainImpactReference[];
    try {
      artifactInputs = recrossArtifactInputs(
        head,
        decisionArtifact,
        evaluationArtifact,
        evaluationCapture.manifestSeal.artifact,
        feaEvidence,
        closeout,
      );
    } catch {
      return unresolved(
        "evaluation_capture_mismatch",
        "The server-reread preservation facts do not identify one exact present artifact input set.",
      );
    }

    try {
      const capture = await validateMechanicalPreservationCapture({
        schemaVersion: "cross-domain-impact-mechanical-preservation-capture/1.0",
        kind: "cross-domain-impact-mechanical-preservation",
        operation: ANALYZE_EVALUATE_MECHANICAL_PRESERVATION_OPERATION,
        trustedRunId: normalized.trustedRunId,
        evaluatedAt: normalized.evaluatedAt,
        decision: {
          artifact: {
            id: decisionArtifact.id,
            fingerprint: decisionArtifact.fingerprint,
          },
          trustedRunId: decisionCapture.trustedRunId,
        },
        evaluation: {
          artifact: {
            id: evaluationArtifact.id,
            fingerprint: evaluationArtifact.fingerprint,
          },
          trustedRunId: evaluationCapture.trustedRunId,
        },
        manifestSeal: evaluationCapture.manifestSeal,
        artifactInputs,
        manifest: evaluationCapture.manifest,
        brief: {
          id: approvedBrief.brief.id,
          revision: approvedBrief.brief.revision,
          fingerprint: approvedBrief.brief.fingerprint,
          gates: briefGates,
        },
        preservation,
        limits: MECHANICAL_PRESERVATION_LIMITS,
      });
      return {
        status: "resolved",
        capture,
        artifactInputs: capture.artifactInputs,
        decisionArtifactId: decisionArtifact.id,
        diagnostics: [],
      };
    } catch {
      return unresolved(
        "evaluation_capture_mismatch",
        "The recrossed preservation facts cannot form one closed canonical capture.",
      );
    }
  }

  async #selectCloseout(
    project: EngineeringProjectSnapshot,
    snapshot: ThreadSnapshot,
    assertedExecutionEvidenceId: string | undefined,
  ): Promise<
    | {
      readonly evidence: MechanicalPreservationCloseoutEvidence;
      readonly facts: MechanicalPreservationCloseoutFacts;
    }
    | null
  > {
    if (!assertedExecutionEvidenceId) return null;
    const artifact = selectUniqueAcceptCloseoutArtifact(
      snapshot,
      assertedExecutionEvidenceId,
    );
    if (!artifact) return null;
    let facts;
    try {
      facts = await this.dependencies.closeouts.read(artifact.fingerprint);
    } catch {
      return null;
    }
    if (!facts) return null;
    if (facts.inputs.executionEvidence.id !== assertedExecutionEvidenceId) {
      return null;
    }
    const evidence = recrossAcceptedCloseoutEvidence(
      project,
      snapshot,
      artifact,
      facts,
    );
    if (!evidence) return null;
    return { evidence, facts };
  }
}

function normalizeCommand(
  value: EvaluateMechanicalPreservationCommand,
): EvaluateMechanicalPreservationCommand {
  const projectId = safeId(value.projectId, "$mechanicalPreservation.projectId");
  const trustedRunId = safeId(
    value.trustedRunId,
    "$mechanicalPreservation.trustedRunId",
  );
  if (value.basis.kind !== "thread-snapshot") {
    throw new TypeError("Mechanical preservation requires a Thread basis.");
  }
  const basis = {
    kind: "thread-snapshot" as const,
    snapshotId: safeId(
      value.basis.snapshotId,
      "$mechanicalPreservation.basis.snapshotId",
    ),
    revision: positiveInteger(
      value.basis.revision,
      "$mechanicalPreservation.basis.revision",
    ),
    subjectId: safeId(
      value.basis.subjectId,
      "$mechanicalPreservation.basis.subjectId",
    ),
  };
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.evaluatedAt) ||
    Number.isNaN(Date.parse(value.evaluatedAt))
  ) {
    throw new TypeError("Mechanical preservation time is not exact UTC ISO-8601.");
  }
  return { projectId, trustedRunId, basis, evaluatedAt: value.evaluatedAt };
}

function isCurrentProjectBasis(
  project: EngineeringProjectSnapshot,
  basis: EngineeringThreadSnapshotBasis,
): boolean {
  const subjectReferences = project.threadSnapshots.filter((reference) =>
    reference.subjectId === basis.subjectId
  );
  const highestRevision = subjectReferences.reduce(
    (highest, reference) => Math.max(highest, reference.revision),
    -1,
  );
  const heads = subjectReferences.filter((reference) =>
    reference.revision === highestRevision
  );
  return project.project.subjectId === basis.subjectId && heads.length === 1 &&
    heads[0]!.snapshotId === basis.snapshotId &&
    heads[0]!.revision === basis.revision;
}

function sameBasisSnapshot(
  snapshot: ThreadSnapshot,
  basis: EngineeringThreadSnapshotBasis,
): boolean {
  return snapshot.id === basis.snapshotId &&
    snapshot.revision === basis.revision &&
    snapshot.subject.id === basis.subjectId;
}

function selectUniqueDecisionArtifact(
  project: EngineeringProjectSnapshot,
  head: ThreadSnapshot,
  basis: EngineeringThreadSnapshotBasis,
): ThreadArtifact | undefined {
  const candidates = head.artifacts.filter((artifact) => {
    if (
      artifact.kind !== "document" ||
      artifact.producer.serverId !== "digital-thread" ||
      artifact.producer.tool !==
        `${DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.id}@${DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.version}`
    ) return false;
    const runs = project.agentRuns.filter((candidate) =>
      candidate.id === artifact.producer.runId
    );
    return runs.length === 1 &&
      isExactDecisionCompletion(project, runs[0]!, artifact, head, basis);
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

function isExactDecisionCompletion(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  artifact: ThreadArtifact,
  head: ThreadSnapshot,
  basis: EngineeringThreadSnapshotBasis,
): boolean {
  const workItems = project.workItems.filter((item) => item.id === run.workItemId);
  const workItem = workItems[0];
  const operation = workItem?.operation;
  if (
    run.status !== "completed" || !run.resultSnapshot || workItems.length !== 1 ||
    workItem.status !== "completed" || artifact.freshness.status !== "fresh" ||
    run.resultSnapshot.snapshotId !== basis.snapshotId ||
    run.resultSnapshot.revision !== basis.revision ||
    run.resultSnapshot.subjectId !== basis.subjectId ||
    run.basis?.kind !== "thread-snapshot" || !head.previous ||
    run.basis.snapshotId !== head.previous.snapshotId ||
    run.basis.revision !== head.previous.revision ||
    run.basis.subjectId !== basis.subjectId ||
    operation?.id !== DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.id ||
    operation.version !== DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.version ||
    operation.bindings.length !== 1 ||
    operation.bindings[0]?.name !== "approvedBrief" ||
    operation.bindings[0].source.kind !== "approved-brief"
  ) {
    return false;
  }
  const declared = project.threadSnapshots.filter((reference) =>
    reference.snapshotId === basis.snapshotId &&
    reference.revision === basis.revision &&
    reference.subjectId === basis.subjectId
  );
  const evidence = run.evidenceRefs[0];
  return declared.length === 1 && run.evidenceRefs.length === 1 &&
    workItem.evidenceRefs.length === 1 &&
    sameEvidenceRefs(run.evidenceRefs, workItem.evidenceRefs) &&
    evidence?.snapshotId === basis.snapshotId &&
    evidence.snapshotRevision === basis.revision &&
    evidence.kind === "artifact" && evidence.id === artifact.id;
}

function recrossCurrentBriefGates(
  capture: CrossDomainImpactEvaluationCapture,
  brief: NonNullable<Awaited<ReturnType<CrossDomainImpactBriefGateReader["read"]>>>,
): readonly CrossDomainImpactManifestSealBriefGate[] {
  return capture.brief.gates.map((gate) => {
    const matches = brief.gates.filter((item) => item.id === gate.gateItemId);
    if (matches.length !== 1 || matches[0]!.dependsOnItemIds === undefined) {
      throw new TypeError("A declared impact gate is absent from current Brief V2.");
    }
    const current = matches[0]!;
    if (
      current.kind !== gate.kind ||
      !fingerprintsEqual(current.fingerprint, gate.fingerprint) ||
      deterministicJson(current.dependsOnItemIds) !==
        deterministicJson(gate.dependsOnItemIds)
    ) {
      throw new TypeError("Current Brief V2 does not recross every exact impact gate.");
    }
    return gate;
  });
}

function recrossArtifactInputs(
  snapshot: ThreadSnapshot,
  decision: ThreadArtifact,
  evaluation: ThreadArtifact,
  manifestSeal: CrossDomainImpactReference,
  feaEvidence: MechanicalPreservationFeaEvidence | null,
  closeout: MechanicalPreservationCloseoutEvidence | null,
): readonly CrossDomainImpactReference[] {
  const inputs = new Map<string, CrossDomainImpactReference>();
  const add = (reference: CrossDomainImpactReference) => {
    const matches = snapshot.artifacts.filter((artifact) =>
      artifact.id === reference.id
    );
    if (
      matches.length !== 1 ||
      !fingerprintsEqual(matches[0]!.fingerprint, reference.fingerprint)
    ) {
      throw new TypeError("A server-reread artifact input is unavailable or inexact.");
    }
    const previous = inputs.get(reference.id);
    if (previous && !sameReference(previous, reference)) {
      throw new TypeError(
        "One server-reread artifact id has incompatible exact fingerprints.",
      );
    }
    inputs.set(reference.id, { id: reference.id, fingerprint: reference.fingerprint });
  };
  add({ id: decision.id, fingerprint: decision.fingerprint });
  add({ id: evaluation.id, fingerprint: evaluation.fingerprint });
  add(manifestSeal);
  if (feaEvidence) {
    add({
      id: feaEvidence.execution.id,
      fingerprint: feaEvidence.execution.fingerprint,
    });
    add({
      id: feaEvidence.sealedProof.id,
      fingerprint: feaEvidence.sealedProof.fingerprint,
    });
    add({
      id: feaEvidence.canonicalStep.id,
      fingerprint: feaEvidence.canonicalStep.fingerprint,
    });
    add({
      id: feaEvidence.l4Evaluation.id,
      fingerprint: feaEvidence.l4Evaluation.fingerprint,
    });
    for (const consumption of feaEvidence.consumptions) add(consumption.input);
  }
  if (closeout) add(closeout.artifact);
  return [...inputs.values()].sort((left, right) =>
    `${left.id}:${left.fingerprint.digest}`.localeCompare(
      `${right.id}:${right.fingerprint.digest}`,
    )
  );
}

function sameEvidenceRefs(
  left: readonly EngineeringThreadEntityRef[],
  right: readonly EngineeringThreadEntityRef[],
): boolean {
  const key = (reference: EngineeringThreadEntityRef) =>
    `${reference.snapshotId}:${reference.snapshotRevision}:${reference.kind}:${reference.id}`;
  const leftKeys = [...left.map(key)].sort();
  const rightKeys = [...right.map(key)].sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((item, index) => item === rightKeys[index]);
}

function sameReference(
  left: CrossDomainImpactReference,
  right: CrossDomainImpactReference,
): boolean {
  return left.id === right.id && fingerprintsEqual(left.fingerprint, right.fingerprint);
}

function unavailable(
  code: ReviewCode,
  message: string,
): EvaluateMechanicalPreservationResult {
  return { status: "unavailable", diagnostics: [diagnostic(code, message)] };
}

function unresolved(
  code: ReviewCode,
  message: string,
): EvaluateMechanicalPreservationResult {
  return { status: "unresolved", diagnostics: [diagnostic(code, message)] };
}

function diagnostic(
  code: ReviewCode,
  message: string,
): EvaluateMechanicalPreservationDiagnostic {
  return { code, message };
}
