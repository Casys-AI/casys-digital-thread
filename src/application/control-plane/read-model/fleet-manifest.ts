export interface FleetManifest {
  schemaVersion?: "1.0";
  version: 1;
  servers: DesiredServer[];
}

export interface DesiredServer {
  /** Stable identifier used by tools and UI routes. */
  id: string;
  displayName: string;
  role: string;
  serviceName: string;
  transport: "streamable-http";
  mcpUrl: string;
  /**
   * Optional only for providers whose published contract has no health route.
   * The read-only fleet probe reports that literal absence as unavailable; it
   * never substitutes MCP discovery, a container state, or a guessed route.
   */
  healthUrl?: string;
  image: string;
  required: boolean;
  expectedTools: string[];
  expectedViews?: string[];
  network?: {
    exposure: "loopback" | "loopback-only" | "private" | "public";
    composeNetwork?: string;
    sharedVolumes?: string[];
    upstreams?: string[];
  };
  trust?: {
    level:
      | "first-party-local"
      | "first-party-local-privileged"
      | "first-party-remote"
      | "third-party";
    executesArbitraryCode: boolean;
    notes?: string[];
  };
}
