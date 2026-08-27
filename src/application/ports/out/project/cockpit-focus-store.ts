import type { CockpitFocusSnapshot } from "../../../../domain/project/cockpit-focus.ts";

/** Outbound port for the durable project selected by the read-only cockpit. */
export interface CockpitFocusStore {
  get(workspaceId: string): Promise<CockpitFocusSnapshot | undefined>;
  select(
    snapshot: CockpitFocusSnapshot,
    expectedRevision: number,
  ): Promise<CockpitFocusSnapshot>;
}
