/**
 * Provider-neutral capabilities required by a reviewed dynamic-system run.
 *
 * These ports deliberately speak in simulation cases and normalized evidence.
 * Provider tool names and wire-envelope field names belong to adapters. The
 * opaque exact records are retained only so the trusted lifecycle can hash and
 * journal what actually crossed the provider boundary.
 */

import type { ContentFingerprint } from "../../kernel/primitives.ts";
import type { SimulationCase } from "./simulation-case.ts";

/** Exact identity against which a provider run is validated. */
export interface SimulationCaseIdentity {
  readonly kit: {
    readonly modelId: string;
    readonly modelVersion: string;
    readonly modelSha256: string;
  };
  readonly scenario: {
    readonly id: string;
    readonly sha256: string;
  };
  readonly parameters: readonly {
    readonly id: string;
    readonly value: number;
    readonly unit: string;
  }[];
  readonly expectedMetrics: readonly {
    readonly id: string;
    readonly unit: string;
  }[];
}

/** Exact lowering selected by the provider adapter for one sealed case. */
export interface DynamicSystemSimulationPlan {
  /** Opaque provider arguments retained for plan hashing and the execution receipt. */
  readonly exactDispatchRecord: Readonly<Record<string, unknown>>;
  /** Provider evidence identity supplied by the adapter, never named by the executor. */
  readonly readbackOperation: {
    readonly serverId: string;
    readonly operationId: string;
  };
}

/** Provider acknowledgement normalized before the WAL transition. */
export interface DynamicSystemDispatchRecord {
  readonly providerRunId: string;
  readonly status: string;
  /** Opaque exact provider record retained by the WAL. */
  readonly exactProviderRecord: Readonly<Record<string, unknown>>;
  readonly canonicalProviderRecordText: string;
}

export interface DynamicSystemRunArtifact {
  readonly kind:
    | "evidence"
    | "model"
    | "result"
    | "diagnostics"
    | "request"
    | "resolved_parameters"
    | "script";
  readonly uri: string;
  readonly fingerprint: ContentFingerprint;
  readonly bytes: number;
}

export interface DynamicSystemQuantity {
  readonly id: string;
  readonly value: number;
  readonly unit: string;
}

/** Fully validated provider run, independent of its MCP wire vocabulary. */
export interface DynamicSystemRun {
  readonly runId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly fingerprint: ContentFingerprint;
  readonly model: {
    readonly id: string;
    readonly version: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly scenario: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly engine: {
    readonly name: string;
    readonly version: string;
    readonly mslVersion: string;
  };
  readonly resolvedParameters: readonly DynamicSystemQuantity[];
  readonly metrics: readonly DynamicSystemQuantity[];
  readonly artifacts: readonly DynamicSystemRunArtifact[];
  readonly warnings: readonly string[];
  /** Canonical exact provider record retained for double attestation. */
  readonly canonicalEnvelopeText: string;
}

/** Read-only catalogue of qualified simulation methods. */
export interface SimulationMethodCatalog {
  assertMethodAvailable(simulationCase: SimulationCase): Promise<void>;
}

/** Pure, deterministic lowering of one sealed case into an execution plan. */
export interface SimulationPlanResolver {
  resolve(simulationCase: SimulationCase): DynamicSystemSimulationPlan;
}

/** Non-idempotent dynamic-system execution capability. */
export interface DynamicSystemSimulator {
  simulate(plan: DynamicSystemSimulationPlan): Promise<DynamicSystemDispatchRecord>;
}

/** Read-only normalization and readback capability for durable simulation runs. */
export interface SimulationRunReader {
  normalizeRecordedRun(
    exactProviderRecord: unknown,
    expected: SimulationCaseIdentity,
  ): DynamicSystemRun;
  readRun(
    providerRunId: string,
    expected: SimulationCaseIdentity,
  ): Promise<DynamicSystemRun>;
  assertDispatchMatchesReadback(
    canonicalDispatchRecordText: string,
    run: DynamicSystemRun,
  ): void;
}

/** Provider acknowledged a simulation request, but its response was malformed. */
export class DynamicSystemResponseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DynamicSystemResponseError";
  }
}
