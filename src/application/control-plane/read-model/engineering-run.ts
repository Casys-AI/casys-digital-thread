import type { IsoDateTime } from "../../../domain/kernel/primitives.ts";

/**
 * State of the computation or checked-in record. A successful computation is
 * evidence, not a requirement verdict.
 */
export type RunStatus =
  | "succeeded"
  | "failed"
  | "timed_out"
  | "running"
  | "unavailable"
  /** Checked-in or documented material for which no dispatch is attested. */
  | "documentary";

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

/** Why a lineage stage is present in the read model. */
export type RunStageBasis = "execution" | "documentary" | "comparison";

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
  basis: RunStageBasis;
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
}

export interface RunsSnapshot {
  items: RunSummary[];
}
