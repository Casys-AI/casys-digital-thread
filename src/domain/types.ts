/**
 * Stable data contract shared by the control-plane tools and the MCP App.
 *
 * Keep protocol-specific types out of this module: the domain can be tested
 * without starting an MCP server or having Docker installed.
 */

export type IsoDateTime = string;

export type ConsoleMode = "live" | "mixed" | "demo";

export type Availability =
  | "healthy"
  | "degraded"
  | "unavailable"
  | "unknown";

export type DriftStatus = "in_sync" | "drift" | "unknown";

export interface FleetManifest {
  schemaVersion?: "1.0";
  version: 1;
  servers: DesiredServer[];
  workbench?: WorkbenchPanelConfig[];
}

export interface DesiredServer {
  /** Stable identifier used by tools and UI routes. */
  id: string;
  displayName: string;
  role: string;
  serviceName: string;
  transport: "streamable-http";
  mcpUrl: string;
  healthUrl: string;
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

export interface WorkbenchPanelConfig {
  id: string;
  title: string;
  kind: "mcp-app" | "external" | "evidence";
  sourceServerId?: string;
  resourceUri?: string;
  endpoint?: string;
}

export interface ObservedTool {
  name: string;
  description?: string;
  resourceUri?: string;
}

export interface ObservedMcp {
  reachable: boolean;
  protocolVersion?: string;
  serverName?: string;
  serverVersion?: string;
  tools: ObservedTool[];
  resourceUris: string[];
  viewerUris: string[];
  error?: string;
}

export interface ObservedContainer {
  runtimeAvailable: boolean;
  present: boolean;
  name?: string;
  id?: string;
  state?: string;
  health?: string;
  image?: string;
  imageId?: string;
  repoDigests?: string[];
  error?: string;
}

export interface ObservedServer {
  checkedAt: IsoDateTime;
  status: Availability;
  latencyMs?: number;
  httpStatus?: number;
  mcp: ObservedMcp;
  container: ObservedContainer;
  error?: string;
}

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

export type RunStatus = "passed" | "failed" | "running" | "unavailable";
export type RunSource = "observed" | "demo";
export type StageStatus = "passed" | "failed" | "running" | "unavailable";

export interface EngineeringValue {
  value: number;
  unit: string;
  display: string;
}

export interface RunStage {
  id: string;
  title: string;
  serverId: string;
  tool: string;
  status: StageStatus;
  startedAt?: IsoDateTime;
  completedAt?: IsoDateTime;
  summary: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
}

export interface RequirementVerdict {
  id: string;
  title: string;
  status: "pass" | "fail" | "unresolved" | "error";
  computed: EngineeringValue;
  limit: EngineeringValue;
  operator: "<=" | ">=" | "<" | ">" | "=";
  margin: EngineeringValue;
  marginPercent: number;
}

export interface EvidenceArtifact {
  id: string;
  kind: "model" | "script" | "cad" | "solve-case" | "result" | "verdict";
  label: string;
  path?: string;
  sha256?: string;
  producedBy?: string;
}

export interface RunSummary {
  id: string;
  name: string;
  subject: string;
  status: RunStatus;
  source: RunSource;
  startedAt: IsoDateTime;
  completedAt?: IsoDateTime;
  passedRequirements: number;
  failedRequirements: number;
  unresolvedRequirements: number;
}

export interface RunDetail extends RunSummary {
  description: string;
  stages: RunStage[];
  requirements: RequirementVerdict[];
  evidence: EvidenceArtifact[];
}

export interface RunsSnapshot {
  items: RunSummary[];
}

export interface WorkbenchPanel {
  id: string;
  title: string;
  kind: "mcp-app" | "external" | "evidence";
  sourceServerId?: string;
  resourceUri?: string;
  endpoint?: string;
  availability: Availability;
  demo: boolean;
}

export interface WorkbenchSnapshot {
  status: Availability;
  panels: WorkbenchPanel[];
  synchronization: {
    enabled: boolean;
    events: string[];
    note: string;
  };
}

export interface ConsoleSnapshot {
  schemaVersion: "1.0";
  generatedAt: IsoDateTime;
  mode: ConsoleMode;
  fleet: FleetSnapshot;
  runs: RunsSnapshot;
  workbench: WorkbenchSnapshot;
}

export interface SnapshotOptions {
  /** Ignore the short-lived in-memory snapshot cache. */
  refresh?: boolean;
}
