import type {
  CapabilityRuntimeBindingQualificationAttestation,
} from "../../../../domain/capability/runtime/capability-runtime-binding-qualification-attestation.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";

/**
 * Host-local, append-only runtime qualification records.  This is separate
 * from project capability authorization and from engineering evidence.
 */
export interface CapabilityRuntimeQualificationAttestationStore {
  append(
    attestation: CapabilityRuntimeBindingQualificationAttestation,
  ): Promise<void>;
  read(
    fingerprint: ContentFingerprint,
  ): Promise<CapabilityRuntimeBindingQualificationAttestation | undefined>;
  list(): Promise<readonly CapabilityRuntimeBindingQualificationAttestation[]>;
}
