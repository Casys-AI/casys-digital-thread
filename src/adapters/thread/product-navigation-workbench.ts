/**
 * Shared Thread projection for product-navigation evidence attachments.
 *
 * MCP context and source-closure recross the canonical Thread evidence from
 * the exact snapshot already selected by the application port. Product
 * structure stays owned by the standalone navigation traversal; this adapter
 * does not rebuild it from a component catalog. Admission sources are attached
 * only to this agent read model and never to the browser Workbench snapshot.
 */

import type { ThreadSnapshot } from "../../domain/thread/thread-snapshot.ts";
import type { ThreadWorkbenchSnapshot } from "../../presentation/workbench/thread/snapshot.ts";
import type {
  ProductNavigationEvidenceAttachmentFacts,
  ProductNavigationEvidenceAttachmentReader,
} from "../../application/ports/out/product-navigation/product-navigation-evidence-attachment-reader.ts";
import { projectThreadWorkbenchSnapshot } from "./thread-workbench-projector.ts";
import {
  type ProductNavigationTechnicalAdmissionReader,
  type ProductNavigationTechnicalAdmissionSourceDependencies,
  readProductNavigationTechnicalAdmissionSources,
} from "./product-navigation-technical-admission-source-reader.ts";
import type { TechnicalAdmissionSourceFileRecord } from "./technical-admission-source-files.ts";
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
  readonly admissions?: ProductNavigationTechnicalAdmissionReader;
  readonly workspace?:
    ProductNavigationTechnicalAdmissionSourceDependencies["workspace"];
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
    const sourceFiles = this.#dependencies.admissions && this.#dependencies.workspace
      ? await readProductNavigationTechnicalAdmissionSources(
        projected,
        {
          admissions: this.#dependencies.admissions,
          workspace: this.#dependencies.workspace,
        },
        { projectId: context.projectId },
      )
      : undefined;
    const sourceGraph = technicalSourceAttachmentGraph(sourceFiles ?? []);
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
      nodes: [
        ...projected.graph.nodes.map((node) => ({
          ref: node.ref,
          label: node.label,
        })),
        ...sourceGraph.nodes,
      ],
      edges: [
        ...projected.graph.edges.map((edge) => ({
          relation: edge.relation,
          from: edge.from,
          to: edge.to,
        })),
        ...sourceGraph.edges,
      ],
      sourceFileIds: sourceFiles?.map((file) => `${file.fileId}@${file.fileRevision}`),
      sourceFiles: sourceFiles?.map((file) => ({
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
  let projected = projectThreadWorkbenchSnapshot(snapshot);
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

function technicalSourceAttachmentGraph(
  files: readonly TechnicalAdmissionSourceFileRecord[],
): {
  readonly nodes: readonly {
    readonly ref: { readonly kind: "source-file"; readonly id: string };
    readonly label: string;
  }[];
  readonly edges: readonly {
    readonly relation: "represented_by";
    readonly from: { readonly kind: "part-definition"; readonly id: string };
    readonly to: { readonly kind: "source-file"; readonly id: string };
  }[];
} {
  const nodes = files.map((file) => ({
    ref: {
      kind: "source-file" as const,
      id: `${file.fileId}@${file.fileRevision}`,
    },
    label: file.resourceName,
  }));
  const edges = files.flatMap((file) => {
    const represented = [
      ...new Set(
        file.bindings
          .filter((binding) =>
            binding.relation === "represents" &&
            binding.sysmlElementKind === "PartDefinition"
          )
          .map((binding) => binding.sysmlElementId),
      ),
    ];
    if (represented.length !== 1) return [];
    return [{
      relation: "represented_by" as const,
      from: { kind: "part-definition" as const, id: represented[0]! },
      to: {
        kind: "source-file" as const,
        id: `${file.fileId}@${file.fileRevision}`,
      },
    }];
  });
  return { nodes, edges };
}
