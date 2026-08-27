/**
 * Reopen a technical source-analysis capture named by a thermal method sheet.
 *
 * The fingerprint is the analysis-capture digest. Source bytes are never
 * returned. A non-Modelica analysis is refused rather than recast.
 */

import type { ThermalMethodSheetSourceCaptureReader } from "../../../application/ports/out/modelica/thermal-method-sheet-source-capture-reader.ts";
import type { ThermalMethodSheetSourceIdentity } from "../../../domain/modelica/thermal-method-sheet-recross.ts";
import {
  fingerprintSourceAnalysisBundle,
  validateSourceAnalysisBundle,
} from "../../../domain/compile/source/source-analysis.ts";
import {
  deterministicJson,
  fingerprintsEqual,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type { FileByteStore } from "../../shared/cas/file-byte-store.ts";

export class FileThermalMethodSheetSourceCaptureReader
  implements ThermalMethodSheetSourceCaptureReader {
  readonly #analyses: Pick<FileByteStore<"technical-source-analysis">, "read">;

  constructor(
    analyses: Pick<FileByteStore<"technical-source-analysis">, "read">,
  ) {
    this.#analyses = analyses;
  }

  async read(
    fingerprint: ContentFingerprint,
  ): Promise<ThermalMethodSheetSourceIdentity | undefined> {
    const stored = await this.#analyses.read(fingerprint);
    if (stored === undefined) return undefined;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(stored.copy());
    const bundle = validateSourceAnalysisBundle(JSON.parse(text));
    if (deterministicJson(bundle) !== text) {
      throw new TypeError(
        "Reopened source analysis is not canonical deterministic JSON.",
      );
    }
    const observed = await fingerprintSourceAnalysisBundle(bundle);
    if (!fingerprintsEqual(observed, fingerprint)) {
      throw new TypeError(
        "Reopened source analysis fingerprint does not match the requested digest.",
      );
    }
    if (
      bundle.source.role !== "modelica-model" ||
      bundle.source.language !== "modelica"
    ) {
      throw new TypeError(
        "The named source capture is not an exact modelica-model capture.",
      );
    }
    return {
      fingerprint,
      role: "modelica-model",
      language: "modelica",
      symbols: bundle.symbols.map((symbol) => ({
        id: symbol.id,
        kind: symbol.kind,
        name: symbol.name,
      })),
    };
  }
}
