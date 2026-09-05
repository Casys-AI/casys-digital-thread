/**
 * Server-computed uncertain-writer lifecycle eligibility.
 *
 * Dedicated terminal-uncertain failure codes remain in
 * TERMINAL_UNCERTAIN_WRITE_FAILURE_CODES. This result is only the extra
 * recross that can qualify a historical generic failure. It is not an
 * approved reconciliation, a basis-release, L3 evidence, or a verdict.
 */

export type UncertainWriterLifecycleEligibility =
  | { readonly status: "not-qualified" }
  | { readonly status: "qualified-uncertain-write" };

export const UNCERTAIN_WRITER_LIFECYCLE_NOT_QUALIFIED:
  UncertainWriterLifecycleEligibility = Object.freeze({
    status: "not-qualified",
  });

export const UNCERTAIN_WRITER_LIFECYCLE_QUALIFIED: UncertainWriterLifecycleEligibility =
  Object.freeze({
    status: "qualified-uncertain-write",
  });
