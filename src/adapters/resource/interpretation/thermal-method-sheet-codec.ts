/**
 * Closed codec: `modelica-thermal-method-sheet/1.0` → existing typed store.
 *
 * Reuses validate + fingerprint + FileThermalMethodSheetStore. Does not
 * invent a generic typed CAS. Typed only after a present exact reread.
 */

import type { ResourceInterpretationCodec } from "../../../application/ports/out/resource/resource-interpretation-gateway.ts";
import type { ThermalMethodSheetStore } from "../../../application/ports/out/modelica/thermal-method-sheet-store.ts";
import {
  fingerprintModelicaThermalMethodSheet,
  MODELICA_THERMAL_METHOD_SHEET_SCHEMA,
  validateModelicaThermalMethodSheet,
} from "../../../domain/modelica/thermal-method-sheet.ts";
import { unresolvedAgentResourceInterpretation } from "../../../domain/resource/agent-resource-capture.ts";
import { typedInterpretationAfterDurableStore } from "./typed-sheet-durable-interpretation.ts";

export class ThermalMethodSheetResourceCodec implements ResourceInterpretationCodec {
  readonly schemaVersion = MODELICA_THERMAL_METHOD_SHEET_SCHEMA;
  readonly #sheets: ThermalMethodSheetStore;

  constructor(sheets: ThermalMethodSheetStore) {
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
      sheet = validateModelicaThermalMethodSheet(parsed);
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
      fingerprintModelicaThermalMethodSheet,
    );
  }
}
