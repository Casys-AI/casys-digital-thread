/**
 * Capability-first boundary for the private mcp-calculix recorded-static
 * contract.  MCP tool names, transport envelopes and resource registration
 * remain adapter details; the domain sees only a sealed proof, a code-owned
 * staged STEP identity, durable recovery states and exact resource tuples.
 */

import type { ContentFingerprint } from "../../src/domain/kernel/primitives.ts";
import type { MechanicalProofCase } from "../../src/domain/fea/seal-case/mechanical-proof-case.ts";
import type { ExpectedProviderResource } from "../../src/domain/compile/source/provider-resource-reader.ts";

export const CALCULIX_RECORDED_STATIC_CONTRACT_VERSION = "1.0" as const;

export interface CalculixRecordedStaticInput {
  readonly requestId: string;
  readonly proof: MechanicalProofCase;
  readonly inputArtifact: {
    readonly fingerprint: ContentFingerprint;
    readonly byteCount: number;
    /**
     * Opaque code-owned provider location supplied by the staging adapter.
     * It is never proposed by an agent or reconstructed from a proof case.
     */
    readonly stagedAsset: { readonly location: string };
  };
  /** Effective values are sealed in the resolved operation plan. */
  readonly elementOrder: 1 | 2;
  readonly timeoutMs: number;
}

/** Exact wire request retained for the run receipt, never agent-authored. */
export interface CalculixRecordedStaticPlan {
  readonly requestId: string;
  readonly exactDispatchRecord: Readonly<Record<string, unknown>>;
  readonly expectedInput: {
    readonly fingerprint: ContentFingerprint;
    readonly byteCount: number;
  };
}

export interface CalculixRecordedStaticMetric {
  readonly maximumDisplacement: {
    readonly value: number;
    readonly unit: "mm";
    readonly nodeId: number;
    readonly vectorMm: readonly [number, number, number];
  };
  readonly maximumVonMises: {
    readonly value: number;
    readonly unit: "MPa";
    readonly elementId: number;
  };
}

export interface CalculixRecordedStaticResult {
  readonly inputArtifact: ExpectedProviderResource;
  readonly mesh: {
    readonly nodes: number;
    readonly elements: number;
    readonly nodesPerSelection: Readonly<Record<string, number>>;
  };
  readonly constraints: {
    readonly fixedSelections: readonly string[];
    readonly loads: readonly {
      readonly selection: string;
      readonly forceN: readonly [number, number, number];
    }[];
  };
  readonly metrics: CalculixRecordedStaticMetric;
}

export interface CalculixRecordedStaticCompleted {
  readonly status: "completed";
  readonly requestId: string;
  readonly requestSha256: string;
  readonly runId: string;
  /** Present only when the solve ACK itself contained the normalized result. */
  readonly result?: CalculixRecordedStaticResult;
  /** Exactly the nine closed artifact tuples, ordered by provider profile. */
  readonly resources: readonly (ExpectedProviderResource & {
    readonly role: string;
  })[];
}

export type CalculixRecordedStaticRecovery =
  | CalculixRecordedStaticCompleted
  | {
    readonly status: "dispatched" | "quarantined" | "evicted";
    readonly requestId: string;
    readonly runId: string;
    readonly reason: string | null;
  }
  | {
    readonly status: "outcome_unknown";
    readonly requestId: string;
    readonly reason: string;
  }
  | { readonly status: "not_found" };

/**
 * Recorded request identity recovered only by the same request id.  No state
 * in this union authorizes a second solve; an executor decides quarantine.
 */
export interface CalculixRecordedStaticReader {
  getByRequestId(requestId: string): Promise<CalculixRecordedStaticRecovery>;
}

/** A non-idempotent recorded solve. Same-request recovery is read-only. */
export interface CalculixRecordedStaticSolver {
  resolve(input: CalculixRecordedStaticInput): CalculixRecordedStaticPlan;
  solve(plan: CalculixRecordedStaticPlan): Promise<CalculixRecordedStaticCompleted>;
}

export interface CalculixRecordedStaticExecutionIdentity {
  readonly schemaVersion: "1.0";
  readonly server: {
    readonly package: "@casys/mcp-calculix";
    readonly version: string;
  };
  readonly method: {
    readonly id: "calculix_solve_static_recorded";
    readonly version: "1.0";
  };
  readonly lowering: {
    readonly id: "calculix.static.abaqus-deck";
    readonly version: "1.0";
  };
  readonly engines: {
    readonly gmsh: { readonly command: "gmsh"; readonly version: string };
    readonly ccx: { readonly command: "ccx"; readonly version: string };
  };
  readonly image: { readonly status: "unattested" };
}

export interface CalculixRecordedStaticCapturedEvidence {
  readonly executionIdentity: CalculixRecordedStaticExecutionIdentity;
  readonly result: CalculixRecordedStaticResult;
}

/** Exact bytes selected by the already-attested provider resource ledger. */
export interface CalculixRecordedStaticCapturedResource {
  readonly role: string;
  readonly bytes: Uint8Array;
}

/**
 * Second attestation after resources/read: request.json seals execution
 * identity and request bytes; result.json must reproduce the acknowledged
 * normalized result.  This port never discovers resources or filesystem paths.
 */
export interface CalculixRecordedStaticEvidenceVerifier {
  verifyCapturedEvidence(
    plan: CalculixRecordedStaticPlan,
    completed: CalculixRecordedStaticCompleted,
    resources: readonly CalculixRecordedStaticCapturedResource[],
  ): Promise<CalculixRecordedStaticCapturedEvidence>;
}
