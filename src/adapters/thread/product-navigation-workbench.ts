/**
 * Shared Thread projection for product-navigation evidence attachments.
 *
 * MCP context and source-closure recross catalog, sealed admissions,
 * requirements targets and engineering cases from the exact Thread snapshot
 * already selected by the application port. Not authoring attachments and
 * not a command surface.
 */

import type { ThreadSnapshot } from "../../domain/thread/thread-snapshot.ts";
import type { ThreadWorkbenchSnapshot } from "../../presentation/workbench/thread/snapshot.ts";
import type {
  ProductNavigationEvidenceAttachmentFacts,
  ProductNavigationEvidenceAttachmentReader,
} from "../../application/ports/out/product-navigation/product-navigation-evidence-attachment-reader.ts";
import {
  type GenericArchitectureCaptureReader,
  resolveGenericProductStructureCatalog,
} from "../architecture/renderer/product-structure-catalog.ts";
import type { SysmlSourceAnalysisReader } from "../architecture/renderer/sysml-source-analysis-capture.ts";
import type { GenericGeometryCaptureReader } from "../cad/canonical/geometry-bundle-product-catalog.ts";
import { projectThreadWorkbenchSnapshot } from "./thread-workbench-projector.ts";
import {
  enrichThreadWorkbenchWithTechnicalAdmissions,
  type SealedCadLeverAdmissionReader,
  type TechnicalAdmissionWorkbenchEnricherDependencies,
} from "./technical-admission-workbench-enricher.ts";
import { readRecrossedRequirementsCaptureScopes } from "./requirements-definition-scope-reader.ts";
import {
  enrichThreadWorkbenchWithRequirementsTargets,
  type RequirementsCaptureReader,
} from "./requirements-target-workbench-enricher.ts";
import {
  type EngineeringCaseWorkbenchEnricherDependencies,
  enrichThreadWorkbenchWithEngineeringCases,
} from "./verification-case-workbench-enricher.ts";

export interface ProductNavigationWorkbenchDependencies {
  readonly architectureCaptures: GenericArchitectureCaptureReader;
  readonly geometryCaptures?: GenericGeometryCaptureReader;
  readonly sysmlSourceAnalysis?: SysmlSourceAnalysisReader;
  readonly admissions?: SealedCadLeverAdmissionReader;
  readonly workspace?: TechnicalAdmissionWorkbenchEnricherDependencies["workspace"];
  readonly requirementsCaptures?: RequirementsCaptureReader;
  readonly engineeringCases?: EngineeringCaseWorkbenchEnricherDependencies;
}

export class WorkbenchProductNavigationEvidenceAttachmentReader
  implements ProductNavigationEvidenceAttachmentReader {
  readonly #dependencies: ProductNavigationWorkbenchDependencies;

  constructor(dependencies: ProductNavigationWorkbenchDependencies) {
    this.#dependencies = dependencies;
  }

  async read(
    snapshot: ThreadSnapshot,
    context: {
      readonly projectId: string;
      readonly architectureArtifactId?: string;
      readonly architectureFingerprint?: string;
    },
  ): Promise<ProductNavigationEvidenceAttachmentFacts | undefined> {
    const projected = await projectProductNavigationWorkbench(
      snapshot,
      context.projectId,
      this.#dependencies,
    );
    const requirementScopes = this.#dependencies.requirementsCaptures &&
        context.architectureArtifactId &&
        context.architectureFingerprint
      ? await readRecrossedRequirementsCaptureScopes(
        snapshot,
        this.#dependencies.requirementsCaptures,
        {
          artifactId: context.architectureArtifactId,
          fingerprint: context.architectureFingerprint,
        },
      )
      : undefined;
    return {
      nodes: projected.graph.nodes.map((node) => ({
        ref: node.ref,
        label: node.label,
      })),
      edges: projected.graph.edges.map((edge) => ({
        relation: edge.relation,
        from: edge.from,
        to: edge.to,
      })),
      sourceFileIds: projected.sourceFiles
        ? projected.sourceFiles.files.map((file) =>
          `${file.fileId}@${file.fileRevision}`
        )
        : undefined,
      sourceFiles: projected.sourceFiles?.files.map((file) => ({
        fileId: file.fileId,
        fileRevision: file.fileRevision,
        workspaceRevision: file.workspaceRevision,
      })),
      ...(requirementScopes ? { requirementScopes } : {}),
    };
  }
}

export async function projectProductNavigationWorkbench(
  snapshot: ThreadSnapshot,
  projectId: string,
  dependencies: ProductNavigationWorkbenchDependencies,
): Promise<ThreadWorkbenchSnapshot> {
  const catalog = await resolveGenericProductStructureCatalog(
    snapshot,
    dependencies.architectureCaptures,
    dependencies.geometryCaptures,
    dependencies.sysmlSourceAnalysis,
  );
  let projected = projectThreadWorkbenchSnapshot(snapshot, catalog);
  if (dependencies.admissions) {
    projected = await enrichThreadWorkbenchWithTechnicalAdmissions(
      projected,
      {
        admissions: dependencies.admissions,
        workspace: dependencies.workspace,
      },
      { projectId },
    );
  }
  if (dependencies.requirementsCaptures) {
    projected = await enrichThreadWorkbenchWithRequirementsTargets(
      projected,
      dependencies.requirementsCaptures,
      snapshot,
    );
  }
  if (dependencies.engineeringCases) {
    projected = await enrichThreadWorkbenchWithEngineeringCases(
      projected,
      dependencies.engineeringCases,
      { projectId },
    );
  }
  return projected;
}
