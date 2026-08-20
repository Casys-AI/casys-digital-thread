import type { DesiredServer } from "./read-model/fleet-manifest.ts";
import type { ObservedContainer, ObservedMcp } from "./read-model/fleet-observation.ts";
import type { RunDetail, RunSummary } from "./read-model/engineering-run.ts";
import type { Availability } from "./read-model/status.ts";
import type { IsoDateTime } from "../../domain/kernel/primitives.ts";

/** Live MCP discovery result consumed by the control-plane, not a page DTO. */
export interface McpProbeResult {
  checkedAt: IsoDateTime;
  status: Availability;
  latencyMs?: number;
  httpStatus?: number;
  mcp: ObservedMcp;
  error?: string;
}

export interface McpProbe {
  probe(server: DesiredServer): Promise<McpProbeResult>;
}

export interface ContainerObserver {
  observe(servers: DesiredServer[]): Promise<Map<string, ObservedContainer>>;
}

/**
 * Read-only source of runs owned by another engineering service. The
 * control-plane never reaches through that service's Docker volume.
 */
export interface ObservedRunCatalog {
  list(): Promise<readonly RunSummary[]>;
  detail(id: string): Promise<RunDetail | undefined>;
}
