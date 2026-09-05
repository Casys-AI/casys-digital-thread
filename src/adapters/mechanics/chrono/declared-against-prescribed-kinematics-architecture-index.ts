/** Exact architecture-capture/4.0 recross for a mechanism-source attachment. */

import type {
  PrescribedKinematicsArchitectureFacts,
  PrescribedKinematicsArchitectureIndex,
} from "../../../application/ports/out/mechanics/prescribed-kinematics-architecture-index.ts";
import { fingerprintsEqual } from "../../../domain/kernel/deterministic-json.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import {
  PROJECT_SOURCE_ATTACHMENT_CAPTURE_SCHEMA,
  type ProjectSourceAttachmentDeclaredAgainst,
} from "../../../domain/project-source-workspace/types.ts";
import { architectureCaptureNavigationIndex } from "../../architecture/renderer/architecture-capture-navigation-index.ts";
import { architectureCaptureIsNavigable } from "../../architecture/renderer/architecture-capture-structure.ts";
import {
  type GenericArchitectureCaptureReader,
  reopenVerifiedArchitectureCapture,
} from "../../architecture/renderer/product-structure-catalog.ts";
import type { SysmlSourceAnalysisReader } from "../../architecture/renderer/sysml-source-analysis-capture.ts";

export class DeclaredAgainstPrescribedKinematicsArchitectureIndex
  implements PrescribedKinematicsArchitectureIndex {
  readonly #snapshots: Pick<ThreadSnapshotStore, "get">;
  readonly #captures: GenericArchitectureCaptureReader;
  readonly #sourceAnalysis: SysmlSourceAnalysisReader;

  constructor(
    snapshots: Pick<ThreadSnapshotStore, "get">,
    captures: GenericArchitectureCaptureReader,
    sourceAnalysis: SysmlSourceAnalysisReader,
  ) {
    this.#snapshots = snapshots;
    this.#captures = captures;
    this.#sourceAnalysis = sourceAnalysis;
  }

  async open(
    declaredAgainst: ProjectSourceAttachmentDeclaredAgainst,
  ): Promise<PrescribedKinematicsArchitectureFacts | undefined> {
    const { thread, architecture } = declaredAgainst;
    if (
      alias(thread.snapshotId) || alias(thread.subjectId) ||
      alias(architecture.artifactId) ||
      architecture.captureSchema !== PROJECT_SOURCE_ATTACHMENT_CAPTURE_SCHEMA
    ) return undefined;
    const snapshot = await this.#snapshots.get(thread.snapshotId);
    if (
      !snapshot || snapshot.id !== thread.snapshotId ||
      snapshot.revision !== thread.revision ||
      snapshot.subject.id !== thread.subjectId
    ) return undefined;
    const verified = await reopenVerifiedArchitectureCapture(
      snapshot,
      this.#captures,
      this.#sourceAnalysis,
    );
    if (
      verified.kind !== "one" ||
      verified.artifact.id !== architecture.artifactId ||
      !fingerprintsEqual(verified.artifact.fingerprint, architecture.fingerprint) ||
      !architectureCaptureIsNavigable(verified.capture)
    ) return undefined;
    const index = architectureCaptureNavigationIndex(verified.capture);
    return {
      typedDefinitionId: (usageElementId) =>
        index.typedDefinition(usageElementId)?.element.elementId,
      immediateUsageIds: (definitionElementId) =>
        index.immediateUsageIds(definitionElementId),
    };
  }
}

function alias(value: string): boolean {
  return value.length === 0 || value.toLowerCase() === "latest";
}
