/**
 * Declared engineering-fleet topology projected for the read-only cockpit.
 *
 * The source of truth is the operator-owned fleet manifest
 * (`config/mcp-fleet.json`). The BFF serves this envelope on GET `/api/fleet`:
 * no live health, no latency, no probe results — fleet liveness stays with
 * `console_snapshot` on the paired MCP host (`src/contracts/console.ts`).
 * The cockpit joins these declared servers with evidence already recorded on
 * the thread snapshot; a declared server without recorded evidence must render
 * as declared, never as healthy.
 */
export interface CockpitFleetServer {
  readonly id: string;
  readonly displayName: string;
  readonly role: string;
  readonly required: boolean;
}

export interface CockpitFleetProjection {
  readonly servers: readonly CockpitFleetServer[];
}

function isCockpitFleetServer(value: unknown): value is CockpitFleetServer {
  if (typeof value !== "object" || value === null) return false;
  const server = value as Partial<CockpitFleetServer>;
  return typeof server.id === "string" && server.id.length > 0 &&
    typeof server.displayName === "string" && server.displayName.length > 0 &&
    typeof server.role === "string" &&
    typeof server.required === "boolean";
}

export function isCockpitFleetProjection(
  value: unknown,
): value is CockpitFleetProjection {
  if (typeof value !== "object" || value === null) return false;
  const projection = value as Partial<CockpitFleetProjection>;
  return Array.isArray(projection.servers) &&
    projection.servers.every(isCockpitFleetServer);
}
