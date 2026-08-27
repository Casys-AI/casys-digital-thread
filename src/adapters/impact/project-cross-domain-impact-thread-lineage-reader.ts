/**
 * Exact project/Thread recross adapter for a closed impact manifest.
 *
 * It reads only the manifest-named snapshot and objects. A `sysml-element`
 * source is deliberately unresolved here: Thread snapshots do not expose a
 * generic live SysML element reader, and deriving one from a label or a
 * provider would violate the sealed manifest boundary.
 */

import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import {
  type CrossDomainImpactThreadLineage,
  type CrossDomainImpactThreadLineageReader,
  CrossDomainImpactThreadLineageReadError,
} from "../../application/ports/out/impact/cross-domain-impact-thread-lineage-reader.ts";
import { recrossExactMechanicalProducerConsumptions } from "../../domain/impact/cross-domain-impact-mechanical-evidence-consumptions.ts";
import type { CrossDomainImpactManifest } from "../../domain/impact/cross-domain-impact-manifest.ts";
import {
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import {
  archivedRefKeys,
  type ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";

export class ProjectCrossDomainImpactThreadLineageReader
  implements CrossDomainImpactThreadLineageReader {
  readonly #projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly #snapshots: Pick<ThreadSnapshotStore, "get">;

  constructor(input: {
    readonly projects: Pick<EngineeringProjectRevisionStore, "get">;
    readonly snapshots: Pick<ThreadSnapshotStore, "get">;
  }) {
    this.#projects = input.projects;
    this.#snapshots = input.snapshots;
  }

  async read(input: {
    readonly projectId: string;
    readonly manifest: CrossDomainImpactManifest;
  }): Promise<CrossDomainImpactThreadLineage | undefined> {
    const project = await this.#projects.get(input.projectId);
    if (!project || project.project.id !== input.projectId) return undefined;
    const rawSnapshot = await this.#snapshots.get(input.manifest.basis.snapshotId);
    if (!rawSnapshot) return undefined;
    const snapshot = validateThreadSnapshot(rawSnapshot);
    if (
      snapshot.id !== input.manifest.basis.snapshotId ||
      snapshot.revision !== input.manifest.basis.revision ||
      snapshot.subject.id !== input.manifest.basis.subjectId
    ) {
      throw unresolved("The named Thread snapshot is not the exact manifest basis.");
    }
    if (project.project.subjectId !== snapshot.subject.id) {
      throw unresolved("The named Thread subject does not belong to the project.");
    }
    const projectFingerprint = await sha256Fingerprint(project.project);
    const subjectFingerprint = await sha256Fingerprint(snapshot.subject);
    const basisFingerprint = await sha256Fingerprint(snapshot);
    const sourceAnchors = await Promise.all(
      input.manifest.sourceAnchors.map((anchor) =>
        recrossSourceAnchor(snapshot, anchor)
      ),
    );
    const mechanicalEvidence = input.manifest.independenceAssertions.map(
      (assertion) => recrossMechanicalEvidence(snapshot, assertion),
    );
    return {
      project: { id: project.project.id, fingerprint: projectFingerprint },
      subject: { id: snapshot.subject.id, fingerprint: subjectFingerprint },
      basis: {
        projectId: project.project.id,
        subjectId: snapshot.subject.id,
        snapshotId: snapshot.id,
        revision: snapshot.revision,
        fingerprint: basisFingerprint,
      },
      sourceAnchors,
      mechanicalEvidence,
    };
  }
}

async function recrossSourceAnchor(
  snapshot: ThreadSnapshot,
  expected: CrossDomainImpactManifest["sourceAnchors"][number],
): Promise<CrossDomainImpactManifest["sourceAnchors"][number]> {
  const changes = snapshot.changeSet.changes.filter((change) =>
    change.id === expected.threadChange.id
  );
  if (changes.length !== 1) {
    throw unresolved("A declared Thread source change is unavailable or ambiguous.");
  }
  const change = changes[0]!;
  const changeFingerprint = await sha256Fingerprint(change);
  if (
    change.kind !== expected.threadChange.kind ||
    !fingerprintsEqual(changeFingerprint, expected.threadChange.fingerprint) ||
    change.target.id !== expected.source.id
  ) {
    throw unresolved(
      "A declared Thread source change is not the exact manifest change.",
    );
  }
  if (expected.source.kind === "sysml-element") {
    throw unresolved(
      "A declared SysML element source has no generic exact Thread reader.",
    );
  }
  if (change.target.kind !== expected.source.kind) {
    throw unresolved("A declared source kind is not the exact Thread change target.");
  }
  const sourceFingerprint = expected.source.kind === "artifact"
    ? await recrossArtifact(snapshot, expected.source.id)
    : await recrossRequirement(snapshot, expected.source.id);
  if (
    !fingerprintsEqual(sourceFingerprint, expected.source.fingerprint) ||
    !fingerprintsEqual(change.afterFingerprint, expected.source.fingerprint)
  ) {
    throw unresolved(
      "A declared source fingerprint is not the exact current Thread identity.",
    );
  }
  return expected;
}

function recrossMechanicalEvidence(
  snapshot: ThreadSnapshot,
  assertion: CrossDomainImpactManifest["independenceAssertions"][number],
): CrossDomainImpactThreadLineage["mechanicalEvidence"][number] {
  const evidence = snapshot.artifacts.filter((artifact) =>
    artifact.id === assertion.evidence.id
  );
  if (evidence.length !== 1) {
    throw unresolved("Declared mechanical evidence is unavailable or ambiguous.");
  }
  const artifact = evidence[0]!;
  if (!fingerprintsEqual(artifact.fingerprint, assertion.evidence.fingerprint)) {
    throw unresolved(
      "Declared mechanical evidence fingerprint does not match the manifest.",
    );
  }
  const consumptions = recrossExactMechanicalProducerConsumptions({
    producer: artifact.producer,
    evidence: { id: artifact.id, fingerprint: artifact.fingerprint },
    inspected: assertion.inspectedConsumptions,
    consumptions: snapshot.consumptions,
    artifacts: snapshot.artifacts,
    archived: archivedRefKeys(snapshot),
  });
  if (!consumptions) {
    throw unresolved(
      "Declared mechanical evidence consumption star is omitted, ambiguous, or not an exact verified reread.",
    );
  }
  return {
    assertionId: assertion.id,
    evidence: { id: artifact.id, fingerprint: artifact.fingerprint },
    evidenceFreshness: artifact.freshness.status,
    consumptions,
  };
}

function recrossArtifact(snapshot: ThreadSnapshot, id: string) {
  const items = snapshot.artifacts.filter((artifact) => artifact.id === id);
  if (items.length !== 1) {
    throw unresolved("A declared source artifact is unavailable or ambiguous.");
  }
  return items[0]!.fingerprint;
}

async function recrossRequirement(snapshot: ThreadSnapshot, id: string) {
  const items = snapshot.requirements.filter((requirement) => requirement.id === id);
  if (items.length !== 1) {
    throw unresolved("A declared source requirement is unavailable or ambiguous.");
  }
  return await sha256Fingerprint(items[0]);
}

function unresolved(message: string): CrossDomainImpactThreadLineageReadError {
  return new CrossDomainImpactThreadLineageReadError("unresolved", message);
}
