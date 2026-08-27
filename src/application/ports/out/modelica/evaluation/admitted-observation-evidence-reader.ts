/**
 * Reopen documentary admitted Modelica evidence for observation evaluation.
 *
 * No HTTP, SysON or Thread snapshot shape. Source bytes stay behind this port.
 */

import type {
  AdmittedObservationRole,
  AdmittedObservationSourceOutput,
} from "../../../../../domain/modelica/evaluation/admitted-observation-evaluation.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";

export interface AdmittedObservationEvidenceMetric {
  readonly outputName: string;
  readonly statistic: AdmittedObservationRole;
  readonly unit: string;
  /** Reopened evidence quantity. Not a caller-supplied evaluation input. */
  readonly value: number;
}

export interface AdmittedObservationEvidence {
  readonly modelName: string;
  readonly outputs: readonly AdmittedObservationSourceOutput[];
  readonly metrics: readonly AdmittedObservationEvidenceMetric[];
}

export interface AdmittedObservationEvidenceReader {
  read(
    fingerprint: ContentFingerprint,
  ): Promise<AdmittedObservationEvidence | undefined>;
}
