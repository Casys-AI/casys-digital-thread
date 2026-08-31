/**
 * Provider-neutral output port for server-side uncertain-writer lifecycle
 * qualification. Callers name a project and a failed run. They cannot select
 * a provider, tool, argument, envelope, or runtime.
 *
 * The closed default never grants qualification.
 */

import type {
  EngineeringProjectSnapshot,
} from "../../../../domain/project/engineering-project.ts";
import type {
  UncertainWriterLifecycleEligibility,
} from "../../../../domain/record/uncertain-writer-lifecycle-eligibility.ts";
import {
  UNCERTAIN_WRITER_LIFECYCLE_NOT_QUALIFIED,
} from "../../../../domain/record/uncertain-writer-lifecycle-eligibility.ts";

export type {
  UncertainWriterLifecycleEligibility,
} from "../../../../domain/record/uncertain-writer-lifecycle-eligibility.ts";

export interface UncertainWriterLifecycleQualificationInput {
  readonly project: EngineeringProjectSnapshot;
  readonly failedRunId: string;
}

export interface UncertainWriterLifecycleQualifier {
  qualify(
    input: UncertainWriterLifecycleQualificationInput,
  ): Promise<UncertainWriterLifecycleEligibility>;
}

export const closedUncertainWriterLifecycleQualifier:
  UncertainWriterLifecycleQualifier = Object.freeze({
    qualify: () => Promise.resolve(UNCERTAIN_WRITER_LIFECYCLE_NOT_QUALIFIED),
  });
