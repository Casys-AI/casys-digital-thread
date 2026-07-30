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

/**
 * State of the computation itself. A successful computation is evidence, not
 * a requirement verdict.
 */
export type RunStatus =
  | "succeeded"
  | "failed"
  | "timed_out"
  | "running"
  | "unavailable";

/**
 * State of the requirements evaluation, which may be intentionally absent
 * while a run is only simulation, CAD, or solver evidence.
 */
export type VerdictStatus =
  | "passed"
  | "failed"
  | "unresolved"
  | "error"
  | "not_evaluated";

export type RunSource = "observed" | "demo";
/** A lineage stage can be an execution or an explicit comparison outcome. */
export type StageStatus = RunStatus | VerdictStatus;

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
  computed?: EngineeringValue;
  limit?: EngineeringValue;
  operator?: "<=" | ">=" | "<" | ">" | "=";
  margin?: EngineeringValue;
  marginPercent?: number;
  message?: string;
}

export interface EvidenceArtifact {
  id: string;
  kind:
    | "request"
    | "resolved-parameters"
    | "model"
    | "script"
    | "cad"
    | "solve-case"
    | "diagnostics"
    | "result"
    | "evidence"
    | "verdict";
  label: string;
  path?: string;
  sha256?: string;
  bytes?: number;
  producedBy?: string;
}

/** A directly computed observation, always accompanied by its unit. */
export interface RunMeasurement {
  id: string;
  label: string;
  value: EngineeringValue;
}

/** Small, displayable provenance fact for evidence that is not a measurement. */
export interface RunProvenance {
  label: string;
  value: string;
}

/** Versioned context for the comparison attached to a run. */
export interface VerificationContext {
  kind: "requirement" | "scenario_contract";
  title: string;
  source: string;
  planId?: string;
  planSha256?: string;
}

/** Identities required to match Modelica evidence to a versioned contract. */
export interface ModelicaEvidenceIdentity {
  runId: string;
  fingerprint: string;
  model: { id: string; version: string; sha256: string };
  scenario: { id: string; sha256: string };
}

export interface RunSummary {
  id: string;
  name: string;
  subject: string;
  status: RunStatus;
  /** Never infer this from status: it comes from SysON/constraint-solver. */
  verdictStatus: VerdictStatus;
  source: RunSource;
  /** Omitted for legacy evidence records which did not persist timing. */
  startedAt?: IsoDateTime;
  completedAt?: IsoDateTime;
  passedRequirements: number;
  failedRequirements: number;
  unresolvedRequirements: number;
}

export interface RunDetail extends RunSummary {
  description: string;
  stages: RunStage[];
  measurements: RunMeasurement[];
  provenance: RunProvenance[];
  warnings: string[];
  requirements: RequirementVerdict[];
  evidence: EvidenceArtifact[];
  verification?: VerificationContext;
  modelicaEvidence?: ModelicaEvidenceIdentity;
}

/**
 * Read-only source of runs which are owned by another engineering service.
 * The console never accesses a service's Docker volume directly.
 */
export interface ObservedRunCatalog {
  list(): Promise<readonly RunSummary[]>;
  detail(id: string): Promise<RunDetail | undefined>;
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
