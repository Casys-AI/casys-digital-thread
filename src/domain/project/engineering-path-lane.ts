/** The five canonical columns shared by the Overview thread and project path. */
export const ENGINEERING_PATH_LANE_IDS = [
  "requirements",
  "system-model",
  "geometry",
  "physics",
  "verdicts",
] as const;

export type EngineeringPathLaneId = typeof ENGINEERING_PATH_LANE_IDS[number];
