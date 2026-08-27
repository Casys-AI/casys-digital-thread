/** Exact current project/Thread head authority for qualified Modelica review. */

import type {
  EngineeringProjectRevisionStore,
} from "../../../application/ports/out/engineering-project-revision-store.ts";
import type {
  ModelicaQualifiedKitReviewBasisAuthority,
  ModelicaQualifiedKitReviewBasisRequest,
} from "../../../application/ports/out/modelica/qualified-kit-review-basis-authority.ts";
import { deepFreeze } from "../../../domain/kernel/case-validation.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import { assertThreadSnapshotLineageIntact } from "../../shared/stores/thread-snapshot-lineage.ts";

export interface ProjectThreadModelicaQualifiedKitReviewBasisAuthorityDependencies {
  readonly projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly snapshots: Pick<ThreadSnapshotStore, "get">;
}

export class ProjectThreadModelicaQualifiedKitReviewBasisAuthority
  implements ModelicaQualifiedKitReviewBasisAuthority {
  constructor(
    private readonly dependencies:
      ProjectThreadModelicaQualifiedKitReviewBasisAuthorityDependencies,
  ) {}

  async reopenExact(
    request: ModelicaQualifiedKitReviewBasisRequest,
  ): Promise<ModelicaQualifiedKitReviewBasisRequest | undefined> {
    const project = await this.dependencies.projects.get(request.projectId);
    if (!project) return undefined;
    if (
      project.id !== request.projectId ||
      project.project.subjectId !== request.basis.subjectId
    ) {
      throw new TypeError("The qualified Modelica project identity is foreign.");
    }
    const subjectReferences = project.threadSnapshots.filter((reference) =>
      reference.subjectId === request.basis.subjectId
    );
    if (subjectReferences.length === 0) return undefined;
    const highestRevision = Math.max(
      ...subjectReferences.map((reference) => reference.revision),
    );
    const heads = subjectReferences.filter((reference) =>
      reference.revision === highestRevision
    );
    if (
      heads.length !== 1 || heads[0]!.snapshotId !== request.basis.snapshotId ||
      heads[0]!.revision !== request.basis.revision
    ) return undefined;

    const rawSnapshot = await this.dependencies.snapshots.get(
      request.basis.snapshotId,
    );
    if (!rawSnapshot) return undefined;
    const snapshot = validateThreadSnapshot(rawSnapshot);
    if (
      snapshot.id !== request.basis.snapshotId ||
      snapshot.revision !== request.basis.revision ||
      snapshot.subject.id !== request.basis.subjectId
    ) {
      throw new TypeError("The qualified Modelica Thread basis is foreign.");
    }
    await assertThreadSnapshotLineageIntact(snapshot, this.dependencies.snapshots);
    return deepFreeze({
      projectId: request.projectId,
      basis: { ...request.basis },
    });
  }
}
