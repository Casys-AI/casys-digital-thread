/**
 * Recross one declaredAgainst Thread snapshot and its current-at-that-snapshot
 * architecture-capture/4.0. Owner/usage/typed_by facts come only from the
 * verified capture navigation index.
 */

import type { CadPlacementArchitectureIndex } from "../../../application/ports/out/cad/placement/cad-placement-architecture-index.ts";
import type { CadPlacementArchitectureFacts } from "../../../domain/cad/placement/cad-placement-coverage.ts";
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

export class DeclaredAgainstCadPlacementArchitectureIndex
  implements CadPlacementArchitectureIndex {
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
  ): Promise<CadPlacementArchitectureFacts | undefined> {
    const thread = declaredAgainst.thread;
    const architecture = declaredAgainst.architecture;
    if (
      isLatestAlias(thread.snapshotId) ||
      isLatestAlias(thread.subjectId) ||
      isLatestAlias(architecture.artifactId) ||
      architecture.captureSchema !== PROJECT_SOURCE_ATTACHMENT_CAPTURE_SCHEMA
    ) {
      return undefined;
    }
    const snapshot = await this.#snapshots.get(thread.snapshotId);
    if (
      snapshot === undefined ||
      snapshot.id !== thread.snapshotId ||
      snapshot.revision !== thread.revision ||
      snapshot.subject.id !== thread.subjectId
    ) {
      return undefined;
    }
    const verified = await reopenVerifiedArchitectureCapture(
      snapshot,
      this.#captures,
      this.#sourceAnalysis,
    );
    if (verified.kind !== "one") return undefined;
    if (
      verified.artifact.id !== architecture.artifactId ||
      !fingerprintsEqual(verified.artifact.fingerprint, architecture.fingerprint)
    ) {
      return undefined;
    }
    if (!architectureCaptureIsNavigable(verified.capture)) return undefined;
    const index = architectureCaptureNavigationIndex(verified.capture);
    return {
      ownerDefinitionId: (usageId) => index.ownerDefinitionId(usageId),
      immediateUsageIds: (definitionId) => index.immediateUsageIds(definitionId),
      typedDefinitionId: (usageId) => index.typedDefinition(usageId)?.element.elementId,
    };
  }
}

function isLatestAlias(value: string): boolean {
  return value.length === 0 || value.toLowerCase() === "latest";
}
