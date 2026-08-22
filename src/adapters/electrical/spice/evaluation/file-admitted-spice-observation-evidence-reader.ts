/**
 * Reopen admitted SPICE isolated result.json for observation evaluation.
 * Source bytes stay behind this port. No HTTP or SysON.
 */

import type {
  AdmittedSpiceObservationEvidence,
  AdmittedSpiceObservationEvidenceReader,
} from "../../../../application/ports/out/electrical/spice/evaluation/admitted-spice-observation-evidence-reader.ts";
import { parseSpiceOperatingPointResult } from "../../../../domain/electrical/spice/admitted/isolated-output.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type { FileByteStore } from "../../../shared/cas/file-byte-store.ts";

export class FileAdmittedSpiceObservationEvidenceReader
  implements AdmittedSpiceObservationEvidenceReader {
  constructor(
    private readonly store: Pick<FileByteStore<string>, "read">,
  ) {}

  async read(
    fingerprint: ContentFingerprint,
  ): Promise<AdmittedSpiceObservationEvidence | undefined> {
    const stored = await this.store.read(fingerprint);
    if (stored === undefined) return undefined;
    const result = parseSpiceOperatingPointResult(stored.copy());
    return {
      observables: result.observables.map((item) => ({
        name: item.nativeName,
        value: item.value,
        unit: item.unit,
      })),
    };
  }
}
