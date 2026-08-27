import type { DesiredServer } from "./fleet-manifest.ts";
import type { ObservedServer } from "./fleet-observation.ts";
import type { DriftStatus } from "./status.ts";

export interface DriftField {
  field:
    | "endpoint"
    | "health"
    | "image"
    | "container"
    | "tools"
    | "resources";
  status: DriftStatus;
  desired?: unknown;
  observed?: unknown;
  message: string;
}

export interface ServerRecord {
  id: string;
  desired: DesiredServer;
  observed: ObservedServer;
  drift: {
    status: DriftStatus;
    fields: DriftField[];
  };
  /** True only when this record itself came from an explicit demo fixture. */
  demo: boolean;
}
