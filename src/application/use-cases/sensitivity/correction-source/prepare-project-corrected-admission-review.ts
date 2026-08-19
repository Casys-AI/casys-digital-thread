/**
 * Reopen one corrected-source document and run the existing technical
 * compilation preview. No CAD execution. No invented bindings.
 */

import type { ProjectCorrectedAdmissionReviewResult } from "../../../ports/in/sensitivity/correction-source/project-corrected-admission-review.ts";
import type { ProjectCorrectedAdmissionReviewUseCase } from "../../../ports/in/sensitivity/correction-source/project-corrected-admission-review.ts";
import type { TechnicalCompilationAdmissionReader } from "../../../ports/out/compile/admission/technical-compilation-admission-reader.ts";
import type { ProjectTechnicalCompilationPreviewUseCase } from "../../../ports/in/compile/admission/project-technical-compilation-preview.ts";
import { validateCorrectedSourceCapture } from "../../../../domain/sensitivity/correction-source/corrected-source-capture.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  positiveInteger,
  safeId,
} from "../../../../domain/kernel/case-validation.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../../domain/thread/thread-snapshot-validation.ts";
import type { ThreadSnapshotStore } from "../../../../domain/thread/thread-snapshot-store.ts";

export class ProjectCorrectedAdmissionReviewError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ProjectCorrectedAdmissionReviewError";
  }
}

export interface PrepareProjectCorrectedAdmissionReviewDependencies {
  readonly snapshots: ThreadSnapshotStore;
  readonly captures: {
    read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  };
  readonly admissions: TechnicalCompilationAdmissionReader;
  readonly preview: ProjectTechnicalCompilationPreviewUseCase;
}

export class PrepareProjectCorrectedAdmissionReview
  implements ProjectCorrectedAdmissionReviewUseCase {
  constructor(
    private readonly dependencies: PrepareProjectCorrectedAdmissionReviewDependencies,
  ) {}

  async execute(value: unknown): Promise<ProjectCorrectedAdmissionReviewResult> {
    const command = parseCommand(value);
    const snapshot = await readSnapshot(
      this.dependencies.snapshots,
      command.basis,
    );
    const artifact = snapshot.artifacts.find((item) =>
      item.id === command.correctedSourceArtifactId
    );
    if (!artifact || artifact.freshness.status !== "fresh") {
      return unresolved(
        "capture_not_found",
        "The corrected-source artifact is absent or not fresh.",
        "Bind compile.capture-corrected-source@1 from this exact basis.",
      );
    }
    const text = await this.dependencies.captures.read(artifact.fingerprint);
    if (!text) {
      return unresolved(
        "capture_not_found",
        "The corrected-source capture is not readable.",
        "Re-run compile.capture-corrected-source@1.",
      );
    }
    let capture;
    try {
      capture = validateCorrectedSourceCapture(JSON.parse(text));
    } catch {
      return unresolved(
        "capture_integrity_failed",
        "The corrected-source capture is not a valid 1.0 document.",
        "Do not repair the capture. Re-run compile.capture-corrected-source@1.",
      );
    }
    const parent = await this.dependencies.admissions.read({
      projectId: command.projectId,
      basis: command.basis,
      artifactId: capture.parentAdmission.artifactId,
      artifactFingerprint: capture.parentAdmission.fingerprint,
    });
    if (!parent) {
      return unresolved(
        "admission_not_found",
        "The parent compilation admission could not be reopened.",
        "Keep the original compile.seal-admission@1 artifact on this basis.",
      );
    }
    const preview = await this.dependencies.preview.execute({
      projectId: command.projectId,
      basis: command.basis,
      sourceRefs: [capture.sourceRef],
    });
    if (preview.status !== "ready-for-review") {
      return unresolved(
        preview.status,
        "The corrected source did not compile to a ready-for-review admission.",
        "Inspect unresolved constructs. Do not invent source text.",
      );
    }
    return deepFreeze({
      status: "ready-for-review",
      decisionParameters: preview.decisionParameters,
    });
  }
}

function unresolved(
  code: string,
  message: string,
  recovery: string,
): ProjectCorrectedAdmissionReviewResult {
  return {
    status: "unresolved",
    error: { code, context: { message }, recovery },
  };
}

function parseCommand(value: unknown) {
  const root = exactRecord(
    value,
    ["projectId", "basis", "correctedSourceArtifactId"],
    "$review",
  );
  const basis = exactRecord(
    root.basis,
    ["kind", "snapshotId", "revision", "subjectId"],
    "$review.basis",
  );
  literalValue(basis.kind, "thread-snapshot", "$review.basis.kind");
  return {
    projectId: safeId(root.projectId, "$review.projectId"),
    correctedSourceArtifactId: safeId(
      root.correctedSourceArtifactId,
      "$review.correctedSourceArtifactId",
    ),
    basis: {
      kind: "thread-snapshot" as const,
      snapshotId: safeId(basis.snapshotId, "$review.basis.snapshotId"),
      revision: positiveInteger(basis.revision, "$review.basis.revision"),
      subjectId: safeId(basis.subjectId, "$review.basis.subjectId"),
    },
  };
}

async function readSnapshot(
  snapshots: ThreadSnapshotStore,
  basis: EngineeringThreadSnapshotBasis,
): Promise<ThreadSnapshot> {
  const snapshot = await snapshots.get(basis.snapshotId);
  if (
    !snapshot || snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw new ProjectCorrectedAdmissionReviewError(
      "snapshot_not_found",
      "The exact Thread basis snapshot is not available.",
    );
  }
  return validateThreadSnapshot(snapshot);
}
