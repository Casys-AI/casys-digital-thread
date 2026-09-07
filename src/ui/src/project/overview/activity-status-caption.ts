import type { EngineeringPhaseStatus } from "../../../../domain/project/engineering-project.ts";

/** Neutral board caption for an activity status. Planned stays Planned. */
export function overviewActivityStatusCaption(
  status: EngineeringPhaseStatus,
): string {
  if (status === "blocked") return "BLOCKED";
  if (status === "active") return "IN PROGRESS";
  if (status === "planned") return "Planned";
  return "COMPLETED";
}
