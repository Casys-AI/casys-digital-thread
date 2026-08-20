import type { ServerRecord } from "./fleet-drift.ts";
import type { Availability } from "./status.ts";

export interface FleetCounts {
  total: number;
  healthy: number;
  degraded: number;
  unavailable: number;
  unknown: number;
  drift: number;
}

export interface FleetSnapshot {
  status: Availability;
  counts: FleetCounts;
  servers: ServerRecord[];
}
