import type { IsoDateTime } from "../domain/kernel/primitives.ts";

/** Browser-safe DTOs shared by the Console BFF and its MCP App. */

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

export interface RunsSnapshot {
  items: RunSummary[];
}

export interface ConsoleSnapshot {
  schemaVersion: "2.0";
  generatedAt: IsoDateTime;
  mode: ConsoleMode;
  fleet: FleetSnapshot;
  runs: RunsSnapshot;
}
