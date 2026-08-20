import type { EngineeringDocumentaryWorkbenchSnapshot } from "./documentary.ts";
import type { EngineeringEvidenceWorkbenchSnapshot } from "./evidence.ts";
import type { EngineeringPlanningWorkbenchSnapshot } from "./planning.ts";

export type EngineeringWorkbenchSnapshot =
  | EngineeringEvidenceWorkbenchSnapshot
  | EngineeringDocumentaryWorkbenchSnapshot
  | EngineeringPlanningWorkbenchSnapshot;
