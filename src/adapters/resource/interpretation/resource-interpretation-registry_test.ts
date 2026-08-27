import { assertEquals } from "@std/assert";
import { ClosedResourceInterpretationRegistry } from "../../../application/use-cases/resource/closed-resource-interpretation-registry.ts";
import { FileThermalMethodSheetStore } from "../../modelica/thermal-method-sheet/file-thermal-method-sheet-store.ts";
import { FileElectricalObservationMethodSheetStore } from "../../electrical/observation-method-sheet/file-electrical-observation-method-sheet-store.ts";
import { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";
import {
  ELECTRICAL_OBSERVATION_METHOD_SHEET_CAPTURE_DESCRIPTOR,
  THERMAL_METHOD_SHEET_CAPTURE_DESCRIPTOR,
} from "../../shared/cas/file-capture-store.ts";
import { ThermalMethodSheetResourceCodec } from "./thermal-method-sheet-codec.ts";
import { ElectricalObservationMethodSheetResourceCodec } from "./electrical-observation-method-sheet-codec.ts";
import { validThermalMethodSheetPlaceholder } from "../../../testing/modelica-thermal-method-sheet-fixtures.ts";
import { validElectricalObservationMethodSheet } from "../../../testing/electrical-observation-method-sheet-fixtures.ts";
import { validateModelicaThermalMethodSheet } from "../../../domain/modelica/thermal-method-sheet.ts";
import { validateElectricalObservationMethodSheet } from "../../../domain/electrical/observation-method-sheet.ts";

function utf8(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

Deno.test("resource interpretation dispatches valid thermal and electrical sheets to typed stores", async () => {
  const root = await Deno.makeTempDir({ prefix: "resource-interpret-" });
  try {
    const thermal = new FileThermalMethodSheetStore(
      new FileCaptureStore({
        ...THERMAL_METHOD_SHEET_CAPTURE_DESCRIPTOR,
        directory: `${root}/thermal`,
      }),
    );
    const electrical = new FileElectricalObservationMethodSheetStore(
      new FileCaptureStore({
        ...ELECTRICAL_OBSERVATION_METHOD_SHEET_CAPTURE_DESCRIPTOR,
        directory: `${root}/electrical`,
      }),
    );
    const registry = new ClosedResourceInterpretationRegistry([
      new ThermalMethodSheetResourceCodec(thermal),
      new ElectricalObservationMethodSheetResourceCodec(electrical),
    ]);
    const thermalSheet = validateModelicaThermalMethodSheet(
      validThermalMethodSheetPlaceholder(),
    );
    const thermalResult = await registry.interpret(utf8(thermalSheet));
    assertEquals(thermalResult.status, "typed");
    assertEquals(thermalResult.schemaVersion, "modelica-thermal-method-sheet/1.0");
    const rereadThermal = await thermal.read(thermalResult.typed!.fingerprint);
    assertEquals(rereadThermal?.id, thermalSheet.id);

    const electricalSheet = validateElectricalObservationMethodSheet(
      validElectricalObservationMethodSheet(),
    );
    const electricalResult = await registry.interpret(utf8(electricalSheet));
    assertEquals(electricalResult.status, "typed");
    assertEquals(
      electricalResult.schemaVersion,
      "electrical-observation-method-sheet/1.0",
    );
    const rereadElectrical = await electrical.read(electricalResult.typed!.fingerprint);
    assertEquals(rereadElectrical?.id, electricalSheet.id);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("resource interpretation keeps invalid known schemas unresolved without a typed reference", async () => {
  const registry = new ClosedResourceInterpretationRegistry([
    new ThermalMethodSheetResourceCodec({
      save: () => Promise.reject(new Error("must not save")),
      read: () => Promise.resolve(undefined),
    }),
  ]);
  const result = await registry.interpret(utf8({
    schemaVersion: "modelica-thermal-method-sheet/1.0",
    id: "broken",
  }));
  assertEquals(result.status, "unresolved");
  assertEquals(result.typed, undefined);
  assertEquals(result.diagnostics?.[0]?.code, "known-schema-invalid");
});

Deno.test("resource interpretation leaves unknown schemas raw-only", async () => {
  const registry = new ClosedResourceInterpretationRegistry([]);
  const result = await registry.interpret(utf8({
    schemaVersion: "unknown-sheet/1.0",
    body: "notes",
  }));
  assertEquals(result.status, "raw");
  assertEquals(result.schemaVersion, "unknown-sheet/1.0");
  assertEquals(result.typed, undefined);
});

Deno.test("thermal codec refuses a typed reference when save succeeds but read is absent or mismatched", async () => {
  const canonical = validateModelicaThermalMethodSheet(
    validThermalMethodSheetPlaceholder(),
  );
  const other = validateModelicaThermalMethodSheet({
    ...validThermalMethodSheetPlaceholder(),
    id: "other-thermal-method-sheet",
  });
  const bytes = utf8(canonical);
  const receipt = {
    fingerprint: { algorithm: "sha256" as const, digest: "0".repeat(64) },
    uri: "casys://modelica-thermal-method-sheet/sha256/" + "0".repeat(64),
  };

  const absent = await new ThermalMethodSheetResourceCodec({
    save: () => Promise.resolve(receipt),
    read: () => Promise.resolve(undefined),
  }).interpret(bytes);
  assertEquals(absent.status, "unresolved");
  assertEquals(absent.typed, undefined);
  assertEquals(absent.diagnostics?.[0]?.code, "interpretation-failed");

  const mismatched = await new ThermalMethodSheetResourceCodec({
    save: () => Promise.resolve(receipt),
    read: () => Promise.resolve(other),
  }).interpret(bytes);
  assertEquals(mismatched.status, "unresolved");
  assertEquals(mismatched.typed, undefined);
  assertEquals(mismatched.diagnostics?.[0]?.code, "interpretation-failed");

  const corruptFingerprint = await new ThermalMethodSheetResourceCodec({
    save: () => Promise.resolve(receipt),
    read: () => Promise.resolve(canonical),
  }).interpret(bytes);
  assertEquals(corruptFingerprint.status, "unresolved");
  assertEquals(corruptFingerprint.typed, undefined);
  assertEquals(corruptFingerprint.diagnostics?.[0]?.code, "interpretation-failed");
});

Deno.test("electrical codec refuses a typed reference when save succeeds but read is absent or mismatched", async () => {
  const canonical = validateElectricalObservationMethodSheet(
    validElectricalObservationMethodSheet(),
  );
  const other = validateElectricalObservationMethodSheet({
    ...validElectricalObservationMethodSheet(),
    id: "other-electrical-observation-method-sheet",
  });
  const bytes = utf8(canonical);
  const receipt = {
    fingerprint: { algorithm: "sha256" as const, digest: "0".repeat(64) },
    uri: "casys://electrical-observation-method-sheet/sha256/" + "0".repeat(64),
  };

  const absent = await new ElectricalObservationMethodSheetResourceCodec({
    save: () => Promise.resolve(receipt),
    read: () => Promise.resolve(undefined),
  }).interpret(bytes);
  assertEquals(absent.status, "unresolved");
  assertEquals(absent.typed, undefined);
  assertEquals(absent.diagnostics?.[0]?.code, "interpretation-failed");

  const mismatched = await new ElectricalObservationMethodSheetResourceCodec({
    save: () => Promise.resolve(receipt),
    read: () => Promise.resolve(other),
  }).interpret(bytes);
  assertEquals(mismatched.status, "unresolved");
  assertEquals(mismatched.typed, undefined);
  assertEquals(mismatched.diagnostics?.[0]?.code, "interpretation-failed");

  const corruptFingerprint = await new ElectricalObservationMethodSheetResourceCodec({
    save: () => Promise.resolve(receipt),
    read: () => Promise.resolve(canonical),
  }).interpret(bytes);
  assertEquals(corruptFingerprint.status, "unresolved");
  assertEquals(corruptFingerprint.typed, undefined);
  assertEquals(
    corruptFingerprint.diagnostics?.[0]?.code,
    "interpretation-failed",
  );
});

Deno.test("resource interpretation labels typed-store I/O as interpretation-failed, not known-schema-invalid", async () => {
  const registry = new ClosedResourceInterpretationRegistry([
    new ThermalMethodSheetResourceCodec({
      save: () => Promise.reject(new Error("typed store write failed")),
      read: () => Promise.resolve(undefined),
    }),
  ]);
  const result = await registry.interpret(
    utf8(validateModelicaThermalMethodSheet(validThermalMethodSheetPlaceholder())),
  );
  assertEquals(result.status, "unresolved");
  assertEquals(result.typed, undefined);
  assertEquals(result.diagnostics?.[0]?.code, "interpretation-failed");
});
