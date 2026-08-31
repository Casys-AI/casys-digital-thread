import type {
  CapabilityRuntimeBindingQualificationAttestation,
} from "../../../../domain/capability/runtime/capability-runtime-binding-qualification-attestation.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";

export type CapabilityRuntimeQualifiedAttestationAppendResult =
  | { readonly status: "appended" }
  | { readonly status: "existing" }
  | { readonly status: "revoked" };

/**
 * Host-local, append-only runtime qualification records.  This is separate
 * from project capability authorization and from engineering evidence.
 */
export interface CapabilityRuntimeQualificationAttestationStore {
  append(
    attestation: CapabilityRuntimeBindingQualificationAttestation,
  ): Promise<void>;
  /**
   * Append a qualified event only if no exact-scope revocation already won
   * the durable lock order. The same File.lock serializes this with `append`.
   */
  appendQualifiedUnlessRevoked(
    attestation: CapabilityRuntimeBindingQualificationAttestation,
  ): Promise<CapabilityRuntimeQualifiedAttestationAppendResult>;
  read(
    fingerprint: ContentFingerprint,
  ): Promise<CapabilityRuntimeBindingQualificationAttestation | undefined>;
  list(): Promise<readonly CapabilityRuntimeBindingQualificationAttestation[]>;
}
