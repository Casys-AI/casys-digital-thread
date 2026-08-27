import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";
import type {
  SensitivityExperienceAdmission,
  SensitivityExperienceInvalidation,
} from "../../../../../domain/sensitivity/experience/sensitivity-experience.ts";

export interface SensitivityExperienceIndexRecord {
  readonly recordFingerprint: ContentFingerprint;
  readonly originBindingFingerprints: readonly ContentFingerprint[];
}

export interface SensitivityExperienceIndexEntry {
  readonly scientificKey: ContentFingerprint;
  readonly records: readonly SensitivityExperienceIndexRecord[];
}

/**
 * Explicit installation-private read-model boundary.
 *
 * Implementations rebuild from their admission/invalidation journals. They do
 * not discover authority by globbing raw record CAS namespaces or by selecting
 * a latest project/Thread revision.
 */
export interface SensitivityExperienceIndex {
  admit(admission: SensitivityExperienceAdmission): Promise<void>;
  invalidate(invalidation: SensitivityExperienceInvalidation): Promise<void>;
  rebuild(): Promise<readonly SensitivityExperienceIndexEntry[]>;
  lookup(
    scientificKey: ContentFingerprint,
  ): Promise<SensitivityExperienceIndexEntry | undefined>;
}
