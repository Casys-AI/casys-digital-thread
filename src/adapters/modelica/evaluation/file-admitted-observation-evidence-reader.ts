/**
 * Reopen admitted Modelica isolated evidence.json for observation evaluation.
 * Source bytes stay behind this port. No HTTP or SysON.
 */

import type {
  AdmittedObservationEvidence,
  AdmittedObservationEvidenceReader,
} from "../../../application/ports/out/modelica/evaluation/admitted-observation-evidence-reader.ts";
import { parseAdmittedModelicaIsolatedEvidence } from "../../../domain/modelica/admitted/isolated-output.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type { FileByteStore } from "../../shared/cas/file-byte-store.ts";

export class FileAdmittedObservationEvidenceReader
  implements AdmittedObservationEvidenceReader {
  constructor(
    private readonly store: Pick<FileByteStore<string>, "read">,
  ) {}

  async read(
    fingerprint: ContentFingerprint,
  ): Promise<AdmittedObservationEvidence | undefined> {
    const stored = await this.store.read(fingerprint);
    if (stored === undefined) return undefined;
    const evidence = parseAdmittedModelicaIsolatedEvidence(stored.copy());
    const outputs = uniqueOutputs(evidence.metrics);
    return {
      modelName: evidence.modelName,
      outputs,
      metrics: evidence.metrics.map((metric) => ({
        outputName: metric.outputName,
        statistic: metric.statistic,
        unit: metric.unit,
        value: metric.value,
      })),
    };
  }
}

function uniqueOutputs(
  metrics: readonly { readonly outputName: string; readonly unit: string }[],
): AdmittedObservationEvidence["outputs"] {
  const seen = new Map<string, string>();
  for (const metric of metrics) {
    const existing = seen.get(metric.outputName);
    if (existing !== undefined && existing !== metric.unit) {
      throw new TypeError(
        `Admitted evidence output "${metric.outputName}" has conflicting units.`,
      );
    }
    seen.set(metric.outputName, metric.unit);
  }
  return [...seen.entries()].map(([name, unit]) => ({ name, unit }));
}
