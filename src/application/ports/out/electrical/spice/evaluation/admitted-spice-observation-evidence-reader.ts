/**
 * Reopen documentary admitted SPICE L3 result/evidence for observation
 * evaluation. No HTTP, SysON or ngspice dispatch.
 */

import type { ContentFingerprint } from "../../../../../../domain/kernel/primitives.ts";
import type { ElectricalObservationNativeBinding } from "../../../../../../domain/electrical/spice/evaluation/expression.ts";

export interface AdmittedSpiceObservationEvidence {
  readonly observables: readonly ElectricalObservationNativeBinding[];
}

export interface AdmittedSpiceObservationEvidenceReader {
  read(
    fingerprint: ContentFingerprint,
  ): Promise<AdmittedSpiceObservationEvidence | undefined>;
}
