/**
 * Closed codec: `electrical-observation-method-sheet/1.0` → existing typed store.
 *
 * Typed only after a present exact reread. Does not invent a generic typed CAS.
 */

import type { ResourceInterpretationCodec } from "../../../application/ports/out/resource/resource-interpretation-gateway.ts";
import type { ElectricalObservationMethodSheetStore } from "../../../application/ports/out/electrical/observation-method-sheet-store.ts";
import {
  ELECTRICAL_OBSERVATION_METHOD_SHEET_SCHEMA,
  fingerprintElectricalObservationMethodSheet,
  validateElectricalObservationMethodSheet,
} from "../../../domain/electrical/observation-method-sheet.ts";
import { unresolvedAgentResourceInterpretation } from "../../../domain/resource/agent-resource-capture.ts";
import { typedInterpretationAfterDurableStore } from "./typed-sheet-durable-interpretation.ts";

export class ElectricalObservationMethodSheetResourceCodec
  implements ResourceInterpretationCodec {
  readonly schemaVersion = ELECTRICAL_OBSERVATION_METHOD_SHEET_SCHEMA;
  readonly #sheets: ElectricalObservationMethodSheetStore;

  constructor(sheets: ElectricalObservationMethodSheetStore) {
    this.#sheets = sheets;
  }

  async interpret(bytes: Uint8Array) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch (error) {
      return unresolvedAgentResourceInterpretation(this.schemaVersion, {
        code: "known-schema-invalid",
        message: `Declared ${this.schemaVersion} is not valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
    let sheet;
    try {
      sheet = validateElectricalObservationMethodSheet(parsed);
    } catch (error) {
      return unresolvedAgentResourceInterpretation(this.schemaVersion, {
        code: "known-schema-invalid",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return await typedInterpretationAfterDurableStore(
      this.schemaVersion,
      sheet,
      this.#sheets,
      fingerprintElectricalObservationMethodSheet,
    );
  }
}
