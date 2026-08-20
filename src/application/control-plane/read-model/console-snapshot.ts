import type { IsoDateTime } from "../../../domain/kernel/primitives.ts";
import type { FleetSnapshot } from "./fleet-snapshot.ts";
import type { RunsSnapshot } from "./engineering-run.ts";

export type ConsoleMode = "live" | "mixed" | "demo";

export interface ConsoleSnapshot {
  schemaVersion: "2.0";
  generatedAt: IsoDateTime;
  mode: ConsoleMode;
  fleet: FleetSnapshot;
  runs: RunsSnapshot;
}
