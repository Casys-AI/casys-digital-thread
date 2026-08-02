import type { ProjectDiscoverySnapshot } from "../../../domain/project-discovery.ts";
import { collectProjectDiscoveryIssues } from "../../../domain/project-discovery-validation.ts";

/** Browser boundary check for an immutable discovery snapshot. */
export function isProjectDiscoverySnapshot(
  value: unknown,
): value is ProjectDiscoverySnapshot {
  return collectProjectDiscoveryIssues(value).length === 0;
}
