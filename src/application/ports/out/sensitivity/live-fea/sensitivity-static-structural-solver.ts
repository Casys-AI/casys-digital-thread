import type { SensitivityStaticStructuralMethod } from "../../../../../domain/sensitivity/study/sensitivity-study.ts";
import type {
  StaticStructuralSolveResult,
} from "../../../../../domain/sensitivity/live-fea/static-structural-solver.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";
import type { JsonValue } from "../../../../../domain/compile/rop/resolved-operation-plan.ts";

/**
 * Server-owned static solve from a sealed sensitivity physical method.
 *
 * This is not StaticStructuralSolver: that port requires a MechanicalProofCase.
 * The adapter lowers the physical method; its concrete provider tool stays a
 * server-owned binding detail and cannot be supplied by an agent.
 */
export interface SensitivitySolveInput {
  readonly method: SensitivityStaticStructuralMethod;
  readonly inputArtifact: {
    readonly fingerprint: ContentFingerprint;
    readonly byteCount: number;
    readonly stagedAsset: { readonly location: string };
  };
  /**
   * These are assigned by the trusted executor. They bind one durable
   * provider request to the exact project run and sealed plan; no caller or
   * provider chooses the identity.
   */
  readonly execution: {
    readonly projectId: string;
    readonly runId: string;
    readonly phase: "base" | "stepped";
    readonly planDigest: string;
  };
}

/** Exact, server-derived request that has not yet touched a provider. */
export interface SensitivityRecordedSolvePlan {
  readonly requestId: string;
  readonly phase: "base" | "stepped";
  readonly inputArtifact: {
    readonly fingerprint: ContentFingerprint;
    readonly byteCount: number;
  };
  /** Provider-specific JSON is an adapter-owned lowering detail. */
  readonly exactRequest: Readonly<Record<string, JsonValue>>;
}

/** ACK identity only. It is never treated as an engineering observation. */
export interface SensitivityRecordedDispatch {
  readonly requestId: string;
  readonly runId: string;
  readonly requestSha256: string;
}

/** Ordered provider ledger reconstructed from `calculix_run_get`. */
export interface SensitivityRecordedProviderResource {
  readonly role: string;
  readonly uri: string;
  readonly mediaType: string;
  readonly byteCount: number;
  readonly sha256: string;
}

/**
 * A readback records identity and ordered resource metadata before generic CAS
 * capture sorts roles. It deliberately does not carry a verdict or provider
 * health assertion.
 */
export interface SensitivityRecordedSolveReadback extends SensitivityRecordedDispatch {
  readonly phase: "base" | "stepped";
  readonly stepSha256: string;
  readonly stepBytes: number;
  readonly resources: readonly SensitivityRecordedProviderResource[];
  readonly canonicalText: string;
  readonly fingerprint: ContentFingerprint;
}

/** CAS receipts for the exact provider bundle after independent re-read. */
export interface SensitivityRecordedSolveCapture {
  readonly result: StaticStructuralSolveResult;
  readonly readback: SensitivityRecordedSolveReadback;
  readonly providerCapture: {
    readonly manifestFingerprint: ContentFingerprint;
    readonly manifestUri: string;
    readonly artifactSequenceFingerprint: ContentFingerprint;
    /**
     * The provider's `request.json` resource independently rehashed into CAS.
     * It must equal the recorded-run ledger requestSha256.
     */
    readonly requestBinding: {
      readonly requestResourceFingerprint: ContentFingerprint;
      /** Exact server-lowered request before provider-observed engine identity. */
      readonly loweredRequestFingerprint: ContentFingerprint;
      /** Parsed provider-observed engine/lowering identity from sealed request.json. */
      readonly executionIdentityFingerprint: ContentFingerprint;
    };
  };
  readonly canonicalText: string;
  readonly fingerprint: ContentFingerprint;
}

/** A definite rejection is terminal for this request identity, never retryable. */
export class SensitivityRecordedSolveRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SensitivityRecordedSolveRejectedError";
  }
}

/**
 * The transport/provider acknowledgement is ambiguous. The same stable
 * request id may only be recovered through `calculix_run_get`; it must never
 * cause a second solve dispatch.
 */
export class SensitivityRecordedSolveOutcomeUnknownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SensitivityRecordedSolveOutcomeUnknownError";
  }
}

export interface SensitivityStaticStructuralSolver {
  resolve(input: SensitivitySolveInput): Promise<SensitivityRecordedSolvePlan>;
  /** Exactly one normal-path recorded-tool invocation, after WAL prepare. */
  dispatch(plan: SensitivityRecordedSolvePlan): Promise<SensitivityRecordedDispatch>;
  /** Read-only recovery by the same request id; it never dispatches work. */
  readback(
    plan: SensitivityRecordedSolvePlan,
    expected?: SensitivityRecordedDispatch,
  ): Promise<SensitivityRecordedSolveReadback>;
  /** Reopens a durable WAL readback without contacting the provider. */
  reopenReadback(text: string): Promise<SensitivityRecordedSolveReadback>;
  /** Re-reads all exact provider resources into CAS and parses result.json. */
  capture(
    readback: SensitivityRecordedSolveReadback,
    method: SensitivityStaticStructuralMethod,
  ): Promise<SensitivityRecordedSolveCapture>;
  /** Reopens a fully captured WAL entry without provider I/O. */
  reopenCapture(text: string): Promise<SensitivityRecordedSolveCapture>;
}
