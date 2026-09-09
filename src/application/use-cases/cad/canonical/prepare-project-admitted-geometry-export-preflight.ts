/** Provider-free admission preflight. It never selects or starts a CAD runtime. */

import type {
  ProjectAdmittedGeometryExportChildRoot,
  ProjectAdmittedGeometryExportPreflightCommand,
  ProjectAdmittedGeometryExportPreflightResult,
  ProjectAdmittedGeometryExportPreflightUseCase,
} from "../../../ports/in/cad/canonical/project-admitted-geometry-export-preflight.ts";
import type {
  ReopenedTechnicalCompilationAdmission,
  TechnicalCompilationAdmissionReader,
} from "../../../ports/out/compile/admission/technical-compilation-admission-reader.ts";
import type { EngineeringProjectRevisionStore } from "../../../ports/out/engineering-project-revision-store.ts";
import {
  encodeTechnicalCompilationAdmissionParameters,
  parseTechnicalCompilationAdmissionParameters,
} from "../../../../domain/compile/admission/technical-compilation-proposal.ts";
import { validateTechnicalCompilationDocument } from "../../../../domain/compile/admission/technical-compilation.ts";
import { exactRecord, safeId } from "../../../../domain/kernel/case-validation.ts";
import { fingerprintsEqual } from "../../../../domain/kernel/deterministic-json.ts";
import { validateContentFingerprint } from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  parseExactThreadSnapshotBasis,
  selectCurrentThreadTip,
} from "../../../../domain/project/thread-tip.ts";

const SCHEMA = "project-admitted-geometry-export-preflight/1.0" as const;

export class ProjectAdmittedGeometryExportPreflightError extends Error {
  constructor(
    readonly code:
      | "invalid_request"
      | "project_unavailable"
      | "basis_mismatch"
      | "admission_not_found"
      | "admission_resolution_failed"
      | "admission_integrity_failed",
    message: string,
  ) {
    super(message);
    this.name = "ProjectAdmittedGeometryExportPreflightError";
  }
}

export class PrepareProjectAdmittedGeometryExportPreflight
  implements ProjectAdmittedGeometryExportPreflightUseCase {
  constructor(
    private readonly dependencies: {
      readonly admissions: TechnicalCompilationAdmissionReader;
      readonly projects?: Pick<EngineeringProjectRevisionStore, "get">;
    },
  ) {}

  async execute(value: unknown): Promise<ProjectAdmittedGeometryExportPreflightResult> {
    const command = parseCommand(value);
    await this.assertCurrentBasis(command);
    let reopened: ReopenedTechnicalCompilationAdmission | undefined;
    try {
      reopened = await this.dependencies.admissions.read(command);
    } catch {
      throw error(
        "admission_resolution_failed",
        "The exact technical-compilation admission could not be reopened.",
      );
    }
    if (!reopened) {
      throw error(
        "admission_not_found",
        "The exact technical-compilation admission is unavailable.",
      );
    }
    const facts = await reopenFacts(reopened, command);
    if (isSingular(facts)) {
      return {
        schemaVersion: SCHEMA,
        status: "singular-export-ready",
        nextTool: "project_admitted_geometry_export",
      };
    }
    const childRoots = deriveChildRoots(facts);
    if (!childRoots) {
      return {
        schemaVersion: SCHEMA,
        status: "unresolved",
        recovery:
          "Read the sealed source attachments and current workspace heads. Independent child-root admission is available only when every Build123d source has one distinct PartDefinition representation and exact closure root.",
      };
    }
    return {
      schemaVersion: SCHEMA,
      status: "child-root-admission-required",
      childRoots,
      recovery:
        "For each child, reread the current workspace head, recross a different-basis attachment when required, capture and admit that root independently, then use project_admitted_geometry_export. Each admission advances the Thread, so reread and recross later child heads before their own admission.",
    };
  }

  private async assertCurrentBasis(
    command: ProjectAdmittedGeometryExportPreflightCommand,
  ): Promise<void> {
    if (!this.dependencies.projects) return;
    let project;
    try {
      project = await this.dependencies.projects.get(command.projectId);
    } catch {
      throw error("project_unavailable", "The named project is unavailable.");
    }
    if (!project || project.project.id !== command.projectId) {
      throw error("project_unavailable", "The named project is unavailable.");
    }
    const tip = selectCurrentThreadTip(project.threadSnapshots);
    if (
      tip.status !== "ok" || tip.basis.snapshotId !== command.basis.snapshotId ||
      tip.basis.revision !== command.basis.revision ||
      tip.basis.subjectId !== command.basis.subjectId
    ) {
      throw error(
        "basis_mismatch",
        "The current project Thread basis is not the named command basis.",
      );
    }
  }
}

function parseCommand(value: unknown): ProjectAdmittedGeometryExportPreflightCommand {
  try {
    const root = exactRecord(value, [
      "projectId",
      "basis",
      "artifactId",
      "artifactFingerprint",
    ], "$admittedGeometryExportPreflight");
    const projectId = safeId(
      root.projectId,
      "$admittedGeometryExportPreflight.projectId",
    );
    const artifactId = safeId(
      root.artifactId,
      "$admittedGeometryExportPreflight.artifactId",
    );
    const artifactFingerprint = validateContentFingerprint(
      root.artifactFingerprint,
      "$admittedGeometryExportPreflight.artifactFingerprint",
    );
    if (
      artifactId !== `technical-compilation-admission-${artifactFingerprint.digest}`
    ) throw new TypeError();
    return {
      projectId,
      basis: parseExactThreadSnapshotBasis(
        root.basis,
        "$admittedGeometryExportPreflight.basis",
      ),
      artifactId,
      artifactFingerprint,
    };
  } catch {
    throw error(
      "invalid_request",
      "The admitted-geometry export preflight request failed exact validation.",
    );
  }
}

async function reopenFacts(
  value: unknown,
  command: ProjectAdmittedGeometryExportPreflightCommand,
) {
  try {
    const capture = exactRecord(value, [
      "schemaVersion",
      "operation",
      "trustedRunId",
      "decisionId",
      "sealedAt",
      "draftReference",
      "admission",
      "document",
    ], "$reopenedAdmission");
    const admission = parseTechnicalCompilationAdmissionParameters(
      encodeTechnicalCompilationAdmissionParameters(capture.admission),
    );
    const document = await validateTechnicalCompilationDocument(capture.document);
    if (
      capture.schemaVersion !== "technical-compilation-admission-capture/4.0" ||
      command.projectId !== admission.draft.projectId ||
      command.projectId !== admission.basis.thread.projectId ||
      command.basis.subjectId !== admission.basis.thread.subjectId ||
      command.basis.snapshotId === admission.basis.thread.snapshotId ||
      command.basis.revision <= admission.basis.thread.revision ||
      document.status !== "ready-for-review" ||
      !fingerprintsEqual(document.basisFingerprint, admission.basis.fingerprint)
    ) throw new TypeError();
    if (
      document.inputManifest.sources.length !== admission.sources.length ||
      document.inputManifest.bindings.length !== admission.bindings.length
    ) throw new TypeError();
    return { admission, document };
  } catch {
    throw error(
      "admission_integrity_failed",
      "The reopened technical-compilation admission is not exact and ready for preflight.",
    );
  }
}

function isSingular(facts: Awaited<ReturnType<typeof reopenFacts>>): boolean {
  const { admission, document } = facts;
  return document.projections.length === 1 &&
    document.inputManifest.sources.length === 1 && admission.sources.length === 1 &&
    admission.compilationProfileRequests.length === 1 &&
    document.projections[0]?.target === "build123d-source" &&
    document.projections[0]?.status === "ready-for-review" &&
    document.projections[0]?.sources.length === 1 &&
    admission.compilationProfileRequests[0]?.sourceIds.length === 1;
}

function deriveChildRoots(
  facts: Awaited<ReturnType<typeof reopenFacts>>,
): readonly ProjectAdmittedGeometryExportChildRoot[] | undefined {
  const { admission, document } = facts;
  if (
    admission.sources.length < 2 || document.projections.length !== 1 ||
    document.projections[0]?.target !== "build123d-source" ||
    document.projections[0]?.status !== "ready-for-review" ||
    document.projections[0]?.sources.length !== admission.sources.length
  ) return undefined;
  const ids = new Set<string>();
  const targets = new Set<string>();
  const roots: Array<ProjectAdmittedGeometryExportChildRoot | undefined> = admission
    .sources.map((source) => {
      const represents = admission.bindings.filter((binding) =>
        binding.sourceId === source.id && binding.relation === "represents"
      );
      if (
        source.role !== "cad-script" || source.language !== "python" ||
        represents.length !== 1 ||
        represents[0]?.sysmlElementKind !== "PartDefinition" ||
        source.attachment.target.elementKind !== "PartDefinition" ||
        source.attachment.fileId !== source.sourceClosure.root.fileId ||
        ids.has(source.id) || targets.has(represents[0].sysmlElementId)
      ) return undefined;
      ids.add(source.id);
      targets.add(represents[0].sysmlElementId);
      return {
        sourceId: source.id,
        attachment: {
          attachmentId: source.attachment.attachmentId,
          attachmentRevision: source.attachment.attachmentRevision,
          fileId: source.attachment.fileId,
          target: {
            elementKind: "PartDefinition" as const,
            elementId: source.attachment.target.elementId,
          },
        },
        sourceClosure: {
          fingerprint: source.sourceClosure.fingerprint,
          workspaceRevision: source.sourceClosure.workspaceRevision,
          workspaceEventFingerprint: source.sourceClosure.workspaceEventFingerprint,
          root: {
            fileId: source.sourceClosure.root.fileId,
            fileRevision: source.sourceClosure.root.fileRevision,
            fileFingerprint: source.sourceClosure.root.fileFingerprint,
          },
        },
      };
    });
  if (roots.some((root) => root === undefined)) return undefined;
  return (roots as ProjectAdmittedGeometryExportChildRoot[]).sort((left, right) =>
    left.sourceId.localeCompare(right.sourceId)
  );
}

function error(
  code: ProjectAdmittedGeometryExportPreflightError["code"],
  message: string,
): ProjectAdmittedGeometryExportPreflightError {
  return new ProjectAdmittedGeometryExportPreflightError(code, message);
}
