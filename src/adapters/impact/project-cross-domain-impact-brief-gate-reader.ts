/** Server adapter exposing only the approved Brief V2 gate facts needed by impact review. */

import type {
  CrossDomainImpactApprovedBriefGates,
  CrossDomainImpactBriefGate,
  CrossDomainImpactBriefGateReader,
} from "../../application/ports/out/impact/cross-domain-impact-brief-gate-reader.ts";
import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import { approvedBriefBasisForProject } from "../../application/use-cases/project/engineering-project-command-service.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import {
  isProjectBriefGateKind,
  projectBriefContractVersion,
} from "../../domain/project/project-brief.ts";

export class ProjectCrossDomainImpactBriefGateReader
  implements CrossDomainImpactBriefGateReader {
  readonly #projects: Pick<EngineeringProjectRevisionStore, "get">;

  constructor(projects: Pick<EngineeringProjectRevisionStore, "get">) {
    this.#projects = projects;
  }

  async read(
    projectId: string,
  ): Promise<CrossDomainImpactApprovedBriefGates | undefined> {
    const project = await this.#projects.get(projectId);
    if (!project || project.project.id !== projectId) return undefined;
    const brief = project.framing?.currentBrief;
    if (!brief) return undefined;
    let approvedBrief;
    try {
      // Reuse the project authority check: human origin, exact review scope,
      // and the persisted approval receipt must all still bind this brief.
      approvedBrief = approvedBriefBasisForProject(project);
    } catch {
      return undefined;
    }
    const gates: readonly CrossDomainImpactBriefGate[] = await Promise.all(
      brief.items
        .filter((item) => isProjectBriefGateKind(item.kind))
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(async (item) => ({
          id: item.id,
          kind: item.kind as CrossDomainImpactBriefGate["kind"],
          fingerprint: await sha256Fingerprint(item),
          ...(item.dependsOnItemIds === undefined
            ? {}
            : { dependsOnItemIds: [...item.dependsOnItemIds] }),
        })),
    );
    return {
      projectId,
      contractVersion: projectBriefContractVersion(brief),
      brief: {
        id: brief.id,
        revision: brief.revision,
        fingerprint: approvedBrief.approvedBriefFingerprint,
      },
      gates,
    };
  }
}
