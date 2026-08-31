/** Port for the private host-local qualification attempt ledger. */

import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type { CapabilityRuntimeQualificationStopProof } from "../../../../domain/capability/runtime/capability-runtime-qualification-stop-proof.ts";
import type {
  CapabilityRuntimeQualificationAttempt,
  CapabilityRuntimeQualificationAttemptIdentity,
  CapabilityRuntimeQualificationAttemptKey,
  CapabilityRuntimeQualificationAttemptOutcome,
  CapabilityRuntimeQualificationDispatchingAttempt,
} from "../../../../domain/capability/runtime/capability-runtime-qualification-attempt.ts";

/** The only persisted-private state API exposed to a future qualification service. */
export interface CapabilityRuntimeQualificationAttemptStore {
  read(
    key: CapabilityRuntimeQualificationAttemptKey,
  ): Promise<CapabilityRuntimeQualificationAttempt | undefined>;
  prepare(
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    clock: { readonly preparedAt: string },
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
    clock: { readonly claimedAt: string; readonly deadlineAt: string },
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
    input: {
      readonly receiptSha256: string;
      readonly receiptFingerprint: ContentFingerprint;
    },
  ): Promise<CapabilityRuntimeQualificationAttempt>;
  sealDispatchDeadline(
    identity: CapabilityRuntimeQualificationAttemptIdentity,
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
    input: { readonly runtimeStopProof: CapabilityRuntimeQualificationStopProof },
  ): Promise<CapabilityRuntimeQualificationAttempt>;
  markAttested(
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    input: { readonly attestationFingerprint: ContentFingerprint },
  ): Promise<CapabilityRuntimeQualificationAttempt>;
}
