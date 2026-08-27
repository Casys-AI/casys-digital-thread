import type { CockpitFleetProjection, CockpitFleetServer } from "./projection.ts";

function isCockpitFleetServer(value: unknown): value is CockpitFleetServer {
  if (typeof value !== "object" || value === null) return false;
  const server = value as Partial<CockpitFleetServer>;
  return typeof server.id === "string" && server.id.length > 0 &&
    typeof server.displayName === "string" && server.displayName.length > 0 &&
    typeof server.role === "string" && typeof server.required === "boolean";
}

export function isCockpitFleetProjection(
  value: unknown,
): value is CockpitFleetProjection {
  if (typeof value !== "object" || value === null) return false;
  const projection = value as Partial<CockpitFleetProjection>;
  return Array.isArray(projection.servers) &&
    projection.servers.every(isCockpitFleetServer);
}
