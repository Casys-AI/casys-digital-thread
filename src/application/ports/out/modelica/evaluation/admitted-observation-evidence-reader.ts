/**
 * Reopen documentary admitted Modelica evidence for observation evaluation.
 *
 * No HTTP, SysON or Thread snapshot shape. Source bytes stay behind this port.
 */

import type {
  AdmittedObservationPublishedMetric,
  AdmittedObservationSourceOutput,
} from "../../../../../domain/modelica/evaluation/admitted-observation-evaluation.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";

export interface AdmittedObservationEvidence {
  readonly modelName: string;
  readonly outputs: readonly AdmittedObservationSourceOutput[];
  readonly metrics: readonly AdmittedObservationPublishedMetric[];
}

export interface AdmittedObservationEvidenceReader {
  read(
    fingerprint: ContentFingerprint,
  ): Promise<AdmittedObservationEvidence | undefined>;
}
