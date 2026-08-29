/**
 * Private, host-local recovery journal for one runtime qualification attempt.
 * It is not project evidence and it never carries a provider route or secret.
 */

import type {
  CapabilityRuntimeObservedHost,
} from "../../../../domain/capability/runtime/capability-runtime-binding-qualification-attestation.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";

export interface CapabilityRuntimeQualificationAttemptIdentity {
  readonly candidate: { readonly id: string; readonly fingerprint: ContentFingerprint };
  readonly observedHost: CapabilityRuntimeObservedHost;
  /** One exact private run identity; recovery must retain it verbatim. */
  readonly requestId: string;
  /** Exact candidate fixture source and fixed lowerer mapping. */
  readonly sourceFingerprint: ContentFingerprint;
  readonly loweringFingerprint: ContentFingerprint;
  /** SHA-256 of the exact lowered case bytes submitted to the fixed client. */
  readonly caseFingerprint: ContentFingerprint;
  /** SHA-256 of the exact code-owned run request intent. */
  readonly requestFingerprint: ContentFingerprint;
  readonly preparedAt: string;
}

export interface CapabilityRuntimeQualificationAttemptKey {
  readonly candidateId: string;
  readonly candidateFingerprint: ContentFingerprint;
  readonly observedHostFingerprint: ContentFingerprint;
}

type AttemptBase = CapabilityRuntimeQualificationAttemptIdentity & {
  readonly schemaVersion: "capability-runtime-qualification-attempt/1.0";
};

export type CapabilityRuntimeQualificationAttempt =
  | (AttemptBase & { readonly phase: "prepared" })
  | (AttemptBase & {
    readonly phase: "active";
    readonly runtimeStartFingerprint: ContentFingerprint;
  })
  | (AttemptBase & {
    readonly phase: "case-submitted";
    readonly runtimeStartFingerprint: ContentFingerprint;
    readonly caseSha256: string;
    readonly caseUri: string;
  })
  | (AttemptBase & {
    readonly phase: "dispatching";
    readonly runtimeStartFingerprint: ContentFingerprint;
    readonly caseSha256: string;
    readonly caseUri: string;
  })
  | (AttemptBase & {
    readonly phase: "recorded";
    readonly runtimeStartFingerprint: ContentFingerprint;
    readonly caseSha256: string;
    readonly caseUri: string;
    readonly receiptFingerprint: ContentFingerprint;
  })
  | (AttemptBase & {
    readonly phase: "quarantined";
    readonly runtimeStartFingerprint: ContentFingerprint;
    readonly caseSha256: string;
    readonly caseUri: string;
    readonly quarantineReason: "uncertain" | "absent" | "malformed";
  })
  | (AttemptBase & {
    readonly phase: "outcome";
    readonly runtimeStartFingerprint: ContentFingerprint;
    readonly caseSha256: string;
    readonly caseUri: string;
    readonly outcome: CapabilityRuntimeQualificationAttemptOutcome;
  })
  | (AttemptBase & {
    readonly phase: "stopped";
    readonly runtimeStartFingerprint: ContentFingerprint;
    readonly caseSha256: string;
    readonly caseUri: string;
    readonly outcome: CapabilityRuntimeQualificationAttemptOutcome;
    readonly runtimeStopFingerprint: ContentFingerprint;
  })
  | (AttemptBase & {
    readonly phase: "attested";
    readonly runtimeStartFingerprint: ContentFingerprint;
    readonly caseSha256: string;
    readonly caseUri: string;
    readonly outcome: CapabilityRuntimeQualificationAttemptOutcome;
    readonly runtimeStopFingerprint: ContentFingerprint;
    readonly attestationFingerprint: ContentFingerprint;
  });

export interface CapabilityRuntimeQualificationAttemptOutcome {
  /** `qualified` may follow only a full recorded readback, never a healthcheck. */
  readonly status: "qualified" | "failed" | "unavailable";
  readonly basis: "recorded" | "quarantined";
  readonly fingerprint: ContentFingerprint;
}

export type CapabilityRuntimeQualificationDispatchingAttempt = Extract<
  CapabilityRuntimeQualificationAttempt,
  { readonly phase: "dispatching" }
>;

/**
 * All mutation methods are idempotent for the same exact input and reject a
 * divergent identity. `claimDispatching` is the sole grant to call `run`.
 */
export interface CapabilityRuntimeQualificationAttemptStore {
  read(
    key: CapabilityRuntimeQualificationAttemptKey,
  ): Promise<CapabilityRuntimeQualificationAttempt | undefined>;
  prepare(
    identity: CapabilityRuntimeQualificationAttemptIdentity,
  ): Promise<CapabilityRuntimeQualificationAttempt>;
  markActive(
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    input: { readonly runtimeStartFingerprint: ContentFingerprint },
  ): Promise<CapabilityRuntimeQualificationAttempt>;
  markCaseSubmitted(
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    input: { readonly caseSha256: string; readonly caseUri: string },
  ): Promise<CapabilityRuntimeQualificationAttempt>;
  claimDispatching(
    identity: CapabilityRuntimeQualificationAttemptIdentity,
  ): Promise<
    | {
      readonly attempt: CapabilityRuntimeQualificationDispatchingAttempt;
      readonly dispatchNow: true;
    }
    | {
      readonly attempt: CapabilityRuntimeQualificationAttempt;
      readonly dispatchNow: false;
    }
  >;
  markRecorded(
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    input: { readonly receiptFingerprint: ContentFingerprint },
  ): Promise<CapabilityRuntimeQualificationAttempt>;
  markQuarantined(
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    input: { readonly reason: "uncertain" | "absent" | "malformed" },
  ): Promise<CapabilityRuntimeQualificationAttempt>;
  markOutcome(
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    outcome: CapabilityRuntimeQualificationAttemptOutcome,
  ): Promise<CapabilityRuntimeQualificationAttempt>;
  markStopped(
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    input: { readonly runtimeStopFingerprint: ContentFingerprint },
  ): Promise<CapabilityRuntimeQualificationAttempt>;
  markAttested(
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    input: { readonly attestationFingerprint: ContentFingerprint },
  ): Promise<CapabilityRuntimeQualificationAttempt>;
}
