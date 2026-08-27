/** Server adapter exposing approved Brief gate facts for method-sheet recross. */

import type {
  ElectricalObservationMethodSheetApprovedBriefGates,
  ElectricalObservationMethodSheetBriefGateReader,
} from "../../../application/ports/out/electrical/observation-method-sheet-brief-gate-reader.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import { approvedBriefBasisForProject } from "../../../application/use-cases/project/engineering-project-command-service.ts";
import { isProjectBriefGateKind } from "../../../domain/project/project-brief.ts";

export class ProjectElectricalObservationMethodSheetBriefGateReader
  implements ElectricalObservationMethodSheetBriefGateReader {
  readonly #projects: Pick<EngineeringProjectRevisionStore, "get">;

  constructor(projects: Pick<EngineeringProjectRevisionStore, "get">) {
    this.#projects = projects;
  }

  async read(
    projectId: string,
  ): Promise<ElectricalObservationMethodSheetApprovedBriefGates | undefined> {
    const project = await this.#projects.get(projectId);
    if (!project || project.project.id !== projectId) return undefined;
    const brief = project.framing?.currentBrief;
    if (!brief) return undefined;
    try {
      approvedBriefBasisForProject(project);
    } catch {
      return undefined;
    }
    const gates = brief.items
      .filter((item) => isProjectBriefGateKind(item.kind))
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((item) => ({
        id: item.id,
        kind: item.kind as "success-criterion" | "verification-activity",
      }));
    return { projectId, gates };
  }
}
