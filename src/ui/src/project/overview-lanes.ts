import type { EngineeringPathLaneId } from "../../../domain/project/engineering-path-lane.ts";

export interface OverviewLane {
  readonly id: EngineeringPathLaneId;
  readonly title: string;
  readonly color: string;
}

/** One visual vocabulary shared by the thread columns. */
export const OVERVIEW_LANES: readonly OverviewLane[] = [
  { id: "requirements", title: "Requirements", color: "#7c3aed" },
  { id: "system-model", title: "System model", color: "#2563eb" },
  { id: "geometry", title: "Geometry", color: "#0e7490" },
  { id: "physics", title: "Physics", color: "#a16207" },
  { id: "verdicts", title: "Verdicts", color: "#15803d" },
];

/**
 * First-level Overview path-band labels. Distinct from graph column titles:
 * `requirements` stays FRAME here and Requirements on OverviewThreadHero.
 */
export const PROJECT_PATH_STAGE_LABELS: {
  readonly [K in EngineeringPathLaneId]: string;
} = {
  requirements: "FRAME",
  "system-model": "SYSTEM MODEL",
  geometry: "GEOMETRY",
  physics: "PHYSICS",
  verdicts: "VERIFICATION",
};

export function overviewLaneDefinition(
  lane: EngineeringPathLaneId,
): OverviewLane {
  return OVERVIEW_LANES.find((candidate) => candidate.id === lane)!;
}

export function overviewLaneTitle(lane: EngineeringPathLaneId): string {
  return overviewLaneDefinition(lane).title;
}
