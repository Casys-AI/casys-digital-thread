import type {
  CockpitFleetProjection,
  CockpitFleetServer,
} from "../../presentation/workbench/fleet/projection.ts";

/**
 * Narrow declared-fleet projection for the read-only cockpit BFF.
 *
 * Copies identity fields only. Health, URLs, images, tools, and trust
 * stay on the operator manifest / `console_snapshot` path and never enter
 * this envelope.
 */
export function projectCockpitFleet(
  servers: readonly CockpitFleetServer[],
): CockpitFleetProjection {
  return {
    servers: servers.map((server) => ({
      id: server.id,
      displayName: server.displayName,
      role: server.role,
      required: server.required,
    })),
  };
}

/**
 * Read identity fields from an operator fleet document. Extra console
 * fields are ignored. A missing file, invalid JSON, or a server that
 * lacks id/displayName/role/required yields `undefined` so the BFF can
 * 404 without inventing a topology.
 */
export async function readDeclaredCockpitFleet(
  path: string,
  readTextFile: (filePath: string) => Promise<string> = Deno.readTextFile,
): Promise<CockpitFleetProjection | undefined> {
  try {
    return projectCockpitFleetFromUnknown(JSON.parse(await readTextFile(path)));
  } catch {
    return undefined;
  }
}

export function projectCockpitFleetFromUnknown(
  value: unknown,
): CockpitFleetProjection | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const servers = (value as { servers?: unknown }).servers;
  if (!Array.isArray(servers) || servers.length === 0) return undefined;
  const projected: CockpitFleetServer[] = [];
  for (const server of servers) {
    const declared = declaredFleetServer(server);
    if (!declared) return undefined;
    projected.push(declared);
  }
  return projectCockpitFleet(projected);
}

function declaredFleetServer(value: unknown): CockpitFleetServer | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const server = value as Partial<CockpitFleetServer>;
  if (
    typeof server.id !== "string" || server.id.length === 0 ||
    typeof server.displayName !== "string" || server.displayName.length === 0 ||
    typeof server.role !== "string" ||
    typeof server.required !== "boolean"
  ) {
    return undefined;
  }
  return {
    id: server.id,
    displayName: server.displayName,
    role: server.role,
    required: server.required,
  };
}
