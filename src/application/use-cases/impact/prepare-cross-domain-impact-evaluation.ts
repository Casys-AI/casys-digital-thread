/**
 * Server-owned X07 impact recross.
 *
 * The command has no agent-selected causal input.  It starts from the exact
 * queued Thread basis, reopens the X06 seal named by the current work
 * revision's required dependsOn leaf, and evaluates every declared source
 * anchor.  A later attempt may reuse that named seal while the current tip
 * still descends from its completed result.  Archived seals stay history.
 * The resulting capture is documentary only: no claim, work item, freshness
 * record, MRTR, or provider run is changed here.
 */

import type {
  EvaluateCrossDomainImpactCommand,
  EvaluateCrossDomainImpactDiagnostic,
  EvaluateCrossDomainImpactResult,
  EvaluateCrossDomainImpactUseCase,
} from "../../ports/in/impact/evaluate-cross-domain-impact.ts";
import type { EngineeringProjectRevisionStore } from "../../ports/out/engineering-project-revision-store.ts";
import type {
  CrossDomainImpactBriefGateReader,
} from "../../ports/out/impact/cross-domain-impact-brief-gate-reader.ts";
import type {
  CrossDomainImpactManifestSealCaptureStore,
} from "../../ports/out/impact/cross-domain-impact-capture-store.ts";
import type { CrossDomainImpactManifestReader } from "../../ports/out/impact/cross-domain-impact-manifest-reader.ts";
import {
  type CrossDomainImpactThreadLineage,
  type CrossDomainImpactThreadLineageReader,
  CrossDomainImpactThreadLineageReadError,
} from "../../ports/out/impact/cross-domain-impact-thread-lineage-reader.ts";
import { recrossCrossDomainImpactManifestGateMap } from "../../../domain/impact/cross-domain-impact-decision.ts";
import {
  type CrossDomainImpactBranchReadiness,
  type CrossDomainImpactMechanicalEvidence,
  evaluateCrossDomainImpact,
} from "../../../domain/impact/cross-domain-impact-evaluation.ts";
import {
  CROSS_DOMAIN_IMPACT_EVALUATION_CAPTURE_SCHEMA,
  type CrossDomainImpactAvailability,
  type CrossDomainImpactEvaluationBranchFact,
  type CrossDomainImpactEvaluationMechanicalFact,
  validateCrossDomainImpactEvaluationCapture,
} from "../../../domain/impact/cross-domain-impact-evaluation-capture.ts";
import {
  crossDomainImpactManifestSealCaptureUri,
} from "../../../domain/impact/cross-domain-impact-manifest-seal-capture.ts";
import {
  crossDomainImpactBranchOrder,
  type CrossDomainImpactManifest,
  type CrossDomainImpactReference,
  validateCrossDomainImpactManifest,
} from "../../../domain/impact/cross-domain-impact-manifest.ts";
import {
  ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION,
} from "../../../domain/impact/cross-domain-impact-evaluation-proposal.ts";
import {
  type CrossDomainImpactManifestSealBriefGate,
  sealCrossDomainImpactManifestWorkItemOperation,
  VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION,
} from "../../../domain/impact/cross-domain-impact-manifest-proposal.ts";
import {
  resolveExactCompletedDependencyArtifact,
} from "../project/resolve-exact-completed-dependency-artifact.ts";
import { positiveInteger, safeId } from "../../../domain/kernel/case-validation.ts";
import {
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type {
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotBasis,
} from "../../../domain/project/engineering-project.ts";
import { canonicalizeBriefGateDependsOnItemIds } from "../../../domain/project/project-brief.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";

export interface PrepareCrossDomainImpactEvaluationDependencies {
  readonly projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly snapshots: Pick<ThreadSnapshotStore, "get">;
  readonly manifests: CrossDomainImpactManifestReader;
  readonly manifestSeals: CrossDomainImpactManifestSealCaptureStore;
  readonly lineage: CrossDomainImpactThreadLineageReader;
  readonly briefGates: CrossDomainImpactBriefGateReader;
}

type ReviewCode =
  | "invalid_request"
  | "project_unavailable"
  | "basis_unavailable"
  | "manifest_seal_unavailable"
  | "manifest_seal_mismatch"
  | "manifest_unavailable"
  | "manifest_mismatch"
  | "lineage_unavailable"
  | "lineage_mismatch"
  | "brief_unavailable"
  | "brief_not_v2"
  | "brief_gate_unresolved"
  | "work_item_claim_unresolved";

export class PrepareCrossDomainImpactEvaluation
  implements EvaluateCrossDomainImpactUseCase {
  readonly #projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly #snapshots: Pick<ThreadSnapshotStore, "get">;
  readonly #manifests: CrossDomainImpactManifestReader;
  readonly #manifestSeals: CrossDomainImpactManifestSealCaptureStore;
  readonly #lineage: CrossDomainImpactThreadLineageReader;
  readonly #briefGates: CrossDomainImpactBriefGateReader;

  constructor(dependencies: PrepareCrossDomainImpactEvaluationDependencies) {
    this.#projects = dependencies.projects;
    this.#snapshots = dependencies.snapshots;
    this.#manifests = dependencies.manifests;
    this.#manifestSeals = dependencies.manifestSeals;
    this.#lineage = dependencies.lineage;
    this.#briefGates = dependencies.briefGates;
  }

  async execute(
    command: EvaluateCrossDomainImpactCommand,
  ): Promise<EvaluateCrossDomainImpactResult> {
    let normalized: EvaluateCrossDomainImpactCommand;
    try {
      normalized = normalizeCommand(command);
    } catch {
      return unresolved(
        "invalid_request",
        "The impact-evaluation command is not an exact server-run basis.",
      );
    }

    let project: EngineeringProjectSnapshot | undefined;
    try {
      project = await this.#projects.get(normalized.projectId);
    } catch {
      return unavailable(
        "project_unavailable",
        "The impact-evaluation project is unavailable.",
      );
    }
    if (!project || project.project.id !== normalized.projectId) {
      return unavailable(
        "project_unavailable",
        "The impact-evaluation project is unavailable.",
      );
    }
    if (!isCurrentProjectBasis(project, normalized.basis)) {
      return unavailable(
        "basis_unavailable",
        "The queued impact-evaluation basis is not the unique current project Thread head.",
      );
    }

    let head: ThreadSnapshot | undefined;
    try {
      head = await this.#snapshots.get(normalized.basis.snapshotId);
      if (head) head = validateThreadSnapshot(head);
    } catch {
      return unavailable(
        "basis_unavailable",
        "The exact queued impact-evaluation Thread basis is unavailable.",
      );
    }
    if (!head || !sameBasisSnapshot(head, normalized.basis)) {
      return unavailable(
        "basis_unavailable",
        "The exact queued impact-evaluation Thread basis is unavailable.",
      );
    }

    const selected = await resolveExactCompletedDependencyArtifact({
      project,
      trustedRunId: normalized.trustedRunId,
      head,
      basis: normalized.basis,
      currentOperation: {
        id: ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.id,
        version: ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.version,
        requiresDependsOnOperation: {
          id: VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION.id,
          version: VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION.version,
        },
      },
      expectedDependencyOperation: sealCrossDomainImpactManifestWorkItemOperation(),
      expectedProducer: {
        serverId: "digital-thread",
        tool:
          `${VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION.id}@${VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION.version}`,
      },
      snapshots: this.#snapshots,
    });
    if (selected.status !== "resolved") {
      return unavailable(
        "manifest_seal_unavailable",
        "The current work revision does not name one exact completed cross-domain impact-manifest seal document.",
      );
    }
    const sealArtifact = selected.artifact;
    let seal;
    try {
      seal = await this.#manifestSeals.read(sealArtifact.fingerprint);
    } catch {
      return unavailable(
        "manifest_seal_unavailable",
        "The exact cross-domain impact-manifest seal capture is unavailable.",
      );
    }
    if (!seal) {
      return unavailable(
        "manifest_seal_unavailable",
        "The exact cross-domain impact-manifest seal capture is unavailable.",
      );
    }
    if (
      seal.trustedRunId !== sealArtifact.producer.runId ||
      seal.sealedAt !== sealArtifact.freshness.changedAt ||
      sealArtifact.uri !==
        crossDomainImpactManifestSealCaptureUri(sealArtifact.fingerprint.digest)
    ) {
      return unresolved(
        "manifest_seal_mismatch",
        "The named manifest-seal document does not exactly identify its stored capture.",
      );
    }
    if (
      selected.producerRun.basis?.kind !== "thread-snapshot" ||
      seal.admission.basis.snapshotId !== selected.producerRun.basis.snapshotId ||
      seal.admission.basis.revision !== selected.producerRun.basis.revision
    ) {
      return unresolved(
        "manifest_seal_mismatch",
        "The stored manifest-seal admission is not the exact completed X06 run basis.",
      );
    }
    if (
      !selected.resultSnapshot.previous ||
      selected.resultSnapshot.previous.snapshotId !== seal.admission.basis.snapshotId ||
      selected.resultSnapshot.previous.revision !== seal.admission.basis.revision
    ) {
      return unresolved(
        "manifest_seal_mismatch",
        "The exact X06 result snapshot is not the direct successor of the sealed manifest basis.",
      );
    }

    let sourceSnapshot: ThreadSnapshot | undefined;
    try {
      sourceSnapshot = await this.#snapshots.get(seal.admission.basis.snapshotId);
      if (sourceSnapshot) sourceSnapshot = validateThreadSnapshot(sourceSnapshot);
    } catch {
      return unavailable(
        "basis_unavailable",
        "The exact Thread basis named by the manifest seal is unavailable.",
      );
    }
    if (
      !sourceSnapshot ||
      sourceSnapshot.id !== seal.admission.basis.snapshotId ||
      sourceSnapshot.revision !== seal.admission.basis.revision ||
      sourceSnapshot.subject.id !== normalized.basis.subjectId
    ) {
      return unavailable(
        "basis_unavailable",
        "The exact Thread basis named by the manifest seal is unavailable.",
      );
    }
    const sourceFingerprint = await sha256Fingerprint(sourceSnapshot);
    if (!fingerprintsEqual(sourceFingerprint, seal.admission.basis.fingerprint)) {
      return unresolved(
        "manifest_seal_mismatch",
        "The manifest-seal basis fingerprint no longer matches its exact Thread snapshot.",
      );
    }

    let reopenedManifest;
    try {
      reopenedManifest = await this.#manifests.read({
        fingerprint: seal.admission.manifest.reference,
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
      !sameManifestSealAdmission(
        manifest,
        reopenedManifest.reference.fingerprint,
        seal.admission,
      )
    ) {
      return unresolved(
        "manifest_mismatch",
        "The reopened manifest does not match the exact human-sealed manifest admission.",
      );
    }
    try {
      recrossCrossDomainImpactManifestGateMap(project.workItems, manifest.gateMap);
    } catch (error) {
      return unresolved(
        "work_item_claim_unresolved",
        error instanceof Error
          ? error.message
          : "The exact manifest gateMap does not recross current work-item gate claims.",
      );
    }

    const sourceIssue = await recrossSourceAnchors(project, sourceSnapshot, manifest);
    if (sourceIssue) return unresolved("lineage_mismatch", sourceIssue);

    let lineage: CrossDomainImpactThreadLineage | undefined;
    try {
      lineage = await this.#lineage.read({ projectId: normalized.projectId, manifest });
    } catch (error) {
      // A source anchor was independently recrossed above.  The remaining
      // known reason for this strict X04 reread to fail is evidence ambiguity;
      // X07 records it as mechanical `impact-unresolved`, never as preservation.
      if (
        error instanceof CrossDomainImpactThreadLineageReadError &&
        error.status === "unavailable"
      ) {
        return unavailable(
          "lineage_unavailable",
          "The exact manifest Thread lineage is unavailable.",
        );
      }
      lineage = undefined;
    }
    if (lineage && !sameLineageContext(lineage, manifest)) {
      return unresolved(
        "lineage_mismatch",
        "The manifest lineage reread does not match its project, subject, or Thread basis.",
      );
    }

    let approvedBrief;
    try {
      approvedBrief = await this.#briefGates.read(normalized.projectId);
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
        "Impact evaluation requires the current approved Brief V2 with explicit gate dependencies.",
      );
    }
    let briefGates: readonly CrossDomainImpactManifestSealBriefGate[];
    try {
      briefGates = recrossCurrentBriefGates(manifest, approvedBrief);
    } catch {
      return unresolved(
        "brief_gate_unresolved",
        "The current approved Brief V2 does not provide every exact manifest gate mapping and dependency declaration.",
      );
    }

    // Recross branch artifacts on the queued X07 basis. The named X06 seal
    // may be an ancestor of this basis after a later descendant retry.
    const branchFacts = recrossBranchFacts(head, manifest);
    const mechanicalFact = selectMechanicalFact(manifest, lineage, sealArtifact);
    let artifactInputs: readonly CrossDomainImpactReference[];
    try {
      artifactInputs = recrossArtifactInputs(
        head,
        manifest,
        branchFacts,
        mechanicalFact,
        sealArtifact,
      );
    } catch {
      return unresolved(
        "lineage_mismatch",
        "The server-reread impact facts do not identify one exact present artifact input set.",
      );
    }
    const evaluation = await evaluateCrossDomainImpact({
      manifest,
      project: manifest.project,
      subject: manifest.subject,
      basis: manifest.basis,
      changedSources: manifest.sourceAnchors.map((anchor) => ({
        sourceAnchorId: anchor.id,
        changeKind: anchor.changeKind,
        threadChange: anchor.threadChange,
        source: anchor.source,
      })),
      reviewTrigger: mechanicalFact.reviewTrigger,
      branchReadiness: branchFactsToReadiness(branchFacts),
      mechanicalEvidence: mechanicalFactToEvidence(mechanicalFact),
      evaluatedAt: normalized.evaluatedAt,
    });
    try {
      const capture = await validateCrossDomainImpactEvaluationCapture({
        schemaVersion: CROSS_DOMAIN_IMPACT_EVALUATION_CAPTURE_SCHEMA,
        kind: "cross-domain-impact-evaluation",
        operation: ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION,
        trustedRunId: normalized.trustedRunId,
        evaluatedAt: normalized.evaluatedAt,
        manifestSeal: {
          artifact: { id: sealArtifact.id, fingerprint: sealArtifact.fingerprint },
          trustedRunId: seal.trustedRunId,
        },
        artifactInputs,
        manifest: {
          id: manifest.id,
          fingerprint: manifest.fingerprint,
          reference: reopenedManifest.reference.fingerprint,
        },
        brief: {
          id: approvedBrief.brief.id,
          revision: approvedBrief.brief.revision,
          fingerprint: approvedBrief.brief.fingerprint,
          gates: briefGates,
        },
        branchFacts,
        mechanicalFact,
        evaluation,
        limits: {
          providerCalls: "none",
          solverCalls: "none",
          gateClaimTransitions: "none",
          workItemInvalidations: "none",
          rerunProposals: "none",
        },
      });
      return {
        status: "resolved",
        capture,
        artifactInputs: capture.artifactInputs,
        manifestSealArtifactId: sealArtifact.id,
        diagnostics: [],
      };
    } catch {
      return unresolved(
        "lineage_mismatch",
        "The recrossed impact facts cannot form one closed canonical evaluation capture.",
      );
    }
  }
}

function normalizeCommand(
  value: EvaluateCrossDomainImpactCommand,
): EvaluateCrossDomainImpactCommand {
  const projectId = safeId(value.projectId, "$impactEvaluation.projectId");
  const trustedRunId = safeId(value.trustedRunId, "$impactEvaluation.trustedRunId");
  if (value.basis.kind !== "thread-snapshot") {
    throw new TypeError("Impact evaluation requires a Thread basis.");
  }
  const basis = {
    kind: "thread-snapshot" as const,
    snapshotId: safeId(value.basis.snapshotId, "$impactEvaluation.basis.snapshotId"),
    revision: positiveInteger(value.basis.revision, "$impactEvaluation.basis.revision"),
    subjectId: safeId(value.basis.subjectId, "$impactEvaluation.basis.subjectId"),
  };
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.evaluatedAt) ||
    Number.isNaN(Date.parse(value.evaluatedAt))
  ) {
    throw new TypeError("Impact evaluation time is not exact UTC ISO-8601.");
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
    heads[0]!.snapshotId === basis.snapshotId && heads[0]!.revision === basis.revision;
}

function sameBasisSnapshot(
  snapshot: ThreadSnapshot,
  basis: EngineeringThreadSnapshotBasis,
): boolean {
  return snapshot.id === basis.snapshotId && snapshot.revision === basis.revision &&
    snapshot.subject.id === basis.subjectId;
}

function sameManifestSealAdmission(
  manifest: CrossDomainImpactManifest,
  manifestReference: CrossDomainImpactReference["fingerprint"],
  admission: {
    readonly manifest: {
      readonly id: string;
      readonly revision: number;
      readonly fingerprint: CrossDomainImpactReference["fingerprint"];
      readonly reference: CrossDomainImpactReference["fingerprint"];
    };
    readonly project: CrossDomainImpactReference;
    readonly subject: CrossDomainImpactReference;
    readonly basis: {
      readonly snapshotId: string;
      readonly revision: number;
      readonly fingerprint: CrossDomainImpactReference["fingerprint"];
    };
  },
): boolean {
  return manifest.id === admission.manifest.id &&
    manifest.revision === admission.manifest.revision &&
    fingerprintsEqual(manifest.fingerprint, admission.manifest.fingerprint) &&
    fingerprintsEqual(manifestReference, admission.manifest.reference) &&
    sameReference(manifest.project, admission.project) &&
    sameReference(manifest.subject, admission.subject) &&
    manifest.basis.snapshotId === admission.basis.snapshotId &&
    manifest.basis.revision === admission.basis.revision &&
    fingerprintsEqual(manifest.basis.fingerprint, admission.basis.fingerprint);
}

async function recrossSourceAnchors(
  project: EngineeringProjectSnapshot,
  snapshot: ThreadSnapshot,
  manifest: CrossDomainImpactManifest,
): Promise<string | undefined> {
  if (
    project.project.id !== manifest.project.id ||
    project.project.subjectId !== manifest.subject.id ||
    snapshot.subject.id !== manifest.subject.id
  ) {
    return "The manifest project or subject does not match its exact Thread basis.";
  }
  const projectFingerprint = await sha256Fingerprint(project.project);
  const subjectFingerprint = await sha256Fingerprint(snapshot.subject);
  const snapshotFingerprint = await sha256Fingerprint(snapshot);
  if (
    !fingerprintsEqual(projectFingerprint, manifest.project.fingerprint) ||
    !fingerprintsEqual(subjectFingerprint, manifest.subject.fingerprint) ||
    !fingerprintsEqual(snapshotFingerprint, manifest.basis.fingerprint)
  ) {
    return "The manifest project, subject, or Thread basis fingerprint is no longer exact.";
  }
  for (const expected of manifest.sourceAnchors) {
    const changes = snapshot.changeSet.changes.filter((change) =>
      change.id === expected.threadChange.id
    );
    if (changes.length !== 1) {
      return "A declared Thread source change is unavailable or ambiguous.";
    }
    const change = changes[0]!;
    const changeFingerprint = await sha256Fingerprint(change);
    if (
      change.kind !== expected.threadChange.kind ||
      change.target.id !== expected.source.id ||
      !fingerprintsEqual(changeFingerprint, expected.threadChange.fingerprint) ||
      !change.afterFingerprint ||
      !fingerprintsEqual(change.afterFingerprint, expected.source.fingerprint)
    ) {
      return "A declared Thread source change is not the exact manifest change.";
    }
    if (expected.source.kind === "sysml-element") {
      return "A declared SysML element source has no generic exact Thread reader.";
    }
    if (change.target.kind !== expected.source.kind) {
      return "A declared source kind is not the exact Thread change target.";
    }
    if (expected.source.kind === "artifact") {
      const artifacts = snapshot.artifacts.filter((item) =>
        item.id === expected.source.id
      );
      if (
        artifacts.length !== 1 ||
        !fingerprintsEqual(artifacts[0]!.fingerprint, expected.source.fingerprint)
      ) {
        return "A declared source artifact is unavailable or inexact.";
      }
    } else {
      const requirements = snapshot.requirements.filter((item) =>
        item.id === expected.source.id
      );
      if (
        requirements.length !== 1 ||
        !fingerprintsEqual(
          await sha256Fingerprint(requirements[0]),
          expected.source.fingerprint,
        )
      ) {
        return "A declared source requirement is unavailable or inexact.";
      }
    }
  }
  return undefined;
}

function sameLineageContext(
  lineage: CrossDomainImpactThreadLineage,
  manifest: CrossDomainImpactManifest,
): boolean {
  return sameReference(lineage.project, manifest.project) &&
    sameReference(lineage.subject, manifest.subject) &&
    lineage.basis.projectId === manifest.basis.projectId &&
    lineage.basis.subjectId === manifest.basis.subjectId &&
    lineage.basis.snapshotId === manifest.basis.snapshotId &&
    lineage.basis.revision === manifest.basis.revision &&
    fingerprintsEqual(lineage.basis.fingerprint, manifest.basis.fingerprint);
}

function recrossCurrentBriefGates(
  manifest: CrossDomainImpactManifest,
  brief: NonNullable<Awaited<ReturnType<CrossDomainImpactBriefGateReader["read"]>>>,
): readonly CrossDomainImpactManifestSealBriefGate[] {
  const gates = manifest.gateMap.map((mapping) => {
    const gate = brief.gates.find((candidate) => candidate.id === mapping.gateItemId);
    if (!gate || gate.dependsOnItemIds === undefined) {
      throw new TypeError("A declared impact gate is absent from current Brief V2.");
    }
    const dependencies = canonicalizeBriefGateDependsOnItemIds(gate.dependsOnItemIds);
    return {
      gateItemId: mapping.gateItemId,
      kind: gate.kind,
      branchId: mapping.branchId,
      role: mapping.role,
      fingerprint: gate.fingerprint,
      dependsOnItemIds: dependencies,
    };
  });
  if (new Set(gates.map((item) => item.gateItemId)).size !== gates.length) {
    throw new TypeError("Impact gate mappings are not exact.");
  }
  return [...gates].sort((left, right) =>
    left.gateItemId.localeCompare(right.gateItemId)
  );
}

function recrossBranchFacts(
  snapshot: ThreadSnapshot,
  manifest: CrossDomainImpactManifest,
): readonly CrossDomainImpactEvaluationBranchFact[] {
  return manifest.branches.map((branch) => ({
    branchId: branch.id,
    method: {
      reference: branch.method,
      availability: referenceAvailability(snapshot, branch.method),
    },
    joins: branch.joins.map((join) => ({
      reference: join,
      currentness: referenceCurrentness(snapshot, join),
    })),
  })).sort((left, right) => branchOrder(left.branchId, right.branchId));
}

/**
 * The only artifacts which X08 may attest as inputs.  The selection is a
 * deterministic consequence of the sealed manifest and the X07 facts: no
 * caller can add, omit, or choose these references.
 */
function recrossArtifactInputs(
  snapshot: ThreadSnapshot,
  manifest: CrossDomainImpactManifest,
  branchFacts: readonly CrossDomainImpactEvaluationBranchFact[],
  mechanicalFact: CrossDomainImpactEvaluationMechanicalFact,
  sealArtifact: ThreadArtifact,
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
      throw new TypeError(
        "A server-reread artifact input is unavailable, ambiguous, or inexact on the queued basis.",
      );
    }
    const previous = inputs.get(reference.id);
    if (previous && !sameReference(previous, reference)) {
      throw new TypeError(
        "One server-reread artifact id has incompatible exact fingerprints.",
      );
    }
    inputs.set(reference.id, { id: reference.id, fingerprint: reference.fingerprint });
  };

  add({ id: sealArtifact.id, fingerprint: sealArtifact.fingerprint });
  for (const anchor of manifest.sourceAnchors) {
    if (anchor.source.kind === "artifact") add(anchor.source);
  }
  for (const branch of branchFacts) {
    if (branch.method.availability === "available") add(branch.method.reference);
    for (const join of branch.joins) {
      if (join.currentness === "current") add(join.reference);
    }
  }
  if (mechanicalFact.status === "current") {
    if (!mechanicalFact.evidence) {
      throw new TypeError("Current mechanical evidence is not exact.");
    }
    add(mechanicalFact.evidence);
    for (const consumption of mechanicalFact.consumptions) add(consumption.input);
  }
  return [...inputs.values()].sort((left, right) =>
    `${left.id}:${left.fingerprint.digest}`.localeCompare(
      `${right.id}:${right.fingerprint.digest}`,
    )
  );
}

function referenceAvailability(
  snapshot: ThreadSnapshot,
  expected: CrossDomainImpactReference,
): CrossDomainImpactAvailability {
  const records = snapshot.artifacts.filter((artifact) => artifact.id === expected.id);
  if (records.length === 0) return "unavailable";
  if (
    records.length !== 1 ||
    !fingerprintsEqual(records[0]!.fingerprint, expected.fingerprint)
  ) {
    return "unresolved";
  }
  return records[0]!.freshness.status === "fresh" ? "available" : "unavailable";
}

function referenceCurrentness(
  snapshot: ThreadSnapshot,
  expected: CrossDomainImpactReference,
): "current" | "unavailable" | "unresolved" {
  const availability = referenceAvailability(snapshot, expected);
  return availability === "available" ? "current" : availability;
}

function selectMechanicalFact(
  manifest: CrossDomainImpactManifest,
  lineage: CrossDomainImpactThreadLineage | undefined,
  sealArtifact: ThreadArtifact,
): CrossDomainImpactEvaluationMechanicalFact {
  const expectedAnchors = new Set(manifest.sourceAnchors.map(inspectedAnchorKey));
  const candidates = manifest.independenceAssertions.filter((assertion) =>
    assertion.branchId === "mechanical" &&
    sameInspectedAnchorSet(assertion.inspectedSourceAnchors, expectedAnchors)
  );
  if (candidates.length !== 1) {
    // This fallback is deliberately not an assertion trigger.  X03 compares it
    // with every human assertion and therefore can only return impact-unresolved.
    return {
      status: "unresolved",
      assertionId: null,
      reviewTrigger: { id: sealArtifact.id, fingerprint: sealArtifact.fingerprint },
      evidence: null,
      evidenceFreshness: null,
      consumptions: [],
    };
  }
  const assertion = candidates[0]!;
  const evidence = lineage?.mechanicalEvidence.find((item) =>
    item.assertionId === assertion.id
  );
  if (!evidence) {
    return {
      status: lineage === undefined ? "unresolved" : "unavailable",
      assertionId: assertion.id,
      reviewTrigger: assertion.review.trigger,
      evidence: null,
      evidenceFreshness: null,
      consumptions: [],
    };
  }
  const fact: CrossDomainImpactEvaluationMechanicalFact = {
    status: evidence.evidenceFreshness === "fresh" ? "current" : "unresolved",
    assertionId: assertion.id,
    reviewTrigger: assertion.review.trigger,
    evidence: evidence.evidence,
    evidenceFreshness: evidence.evidenceFreshness,
    consumptions: evidence.consumptions,
  };
  if (fact.status !== "current") return fact;
  if (!sameMechanicalConsumptions(assertion, evidence.consumptions)) {
    return { ...fact, status: "unresolved" };
  }
  return fact;
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

function inspectedAnchorKey(
  anchor: CrossDomainImpactManifest["sourceAnchors"][number],
): string {
  return `${anchor.id}:${anchor.threadChange.fingerprint.digest}:${anchor.source.fingerprint.digest}`;
}

function sameMechanicalConsumptions(
  assertion: CrossDomainImpactManifest["independenceAssertions"][number],
  actual: readonly {
    readonly id: string;
    readonly consumerEvidence: CrossDomainImpactReference;
    readonly input: CrossDomainImpactReference;
  }[],
): boolean {
  if (
    assertion.inspectedConsumptions.length === 0 ||
    actual.length !== assertion.inspectedConsumptions.length
  ) {
    return false;
  }
  const expected = new Set(
    assertion.inspectedConsumptions.map((item) =>
      `${item.id}:${item.input.id}:${item.input.fingerprint.digest}`
    ),
  );
  const observed = new Set(
    actual.map((item) =>
      `${item.id}:${item.input.id}:${item.input.fingerprint.digest}`
    ),
  );
  return expected.size === observed.size &&
    [...expected].every((item) => observed.has(item));
}

function branchFactsToReadiness(
  facts: readonly CrossDomainImpactEvaluationBranchFact[],
): readonly CrossDomainImpactBranchReadiness[] {
  return facts.map((fact) => ({
    branchId: fact.branchId,
    method: {
      reference: fact.method.reference,
      available: fact.method.availability === "available",
    },
    joins: fact.joins.map((join) => ({
      reference: join.reference,
      current: join.currentness === "current",
    })),
  }));
}

function mechanicalFactToEvidence(
  fact: CrossDomainImpactEvaluationMechanicalFact,
): CrossDomainImpactMechanicalEvidence | null {
  if (fact.status !== "current" || !fact.evidence) return null;
  return {
    evidence: fact.evidence,
    consumptions: fact.consumptions,
  };
}

function sameReference(
  left: CrossDomainImpactReference,
  right: CrossDomainImpactReference,
): boolean {
  return left.id === right.id && fingerprintsEqual(left.fingerprint, right.fingerprint);
}

function branchOrder(
  left: CrossDomainImpactManifest["branches"][number]["id"],
  right: CrossDomainImpactManifest["branches"][number]["id"],
): number {
  return crossDomainImpactBranchOrder(left, right);
}

function unavailable(
  code: ReviewCode,
  message: string,
): EvaluateCrossDomainImpactResult {
  return { status: "unavailable", diagnostics: [diagnostic(code, message)] };
}

function unresolved(
  code: ReviewCode,
  message: string,
): EvaluateCrossDomainImpactResult {
  return { status: "unresolved", diagnostics: [diagnostic(code, message)] };
}

function diagnostic(
  code: ReviewCode,
  message: string,
): EvaluateCrossDomainImpactDiagnostic {
  return { code, message };
}
