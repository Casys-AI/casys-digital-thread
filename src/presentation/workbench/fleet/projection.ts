/** Declared engineering-fleet topology projected for the read-only cockpit. */
export interface CockpitFleetServer {
  readonly id: string;
  readonly displayName: string;
  readonly role: string;
  readonly required: boolean;
}

export interface CockpitFleetProjection {
  readonly servers: readonly CockpitFleetServer[];
}
