import { assertEquals } from "@std/assert";
import {
  fingerprintElectricalObservationMethodSheet,
  validateElectricalObservationMethodSheet,
} from "../../domain/electrical/observation-method-sheet.ts";
import { validElectricalObservationMethodSheet } from "../../testing/electrical-observation-method-sheet-fixtures.ts";
import {
  ELECTRICAL_OBSERVATION_METHOD_SHEET_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
} from "../shared/cas/file-capture-store.ts";
import { FileElectricalObservationMethodSheetStore } from "./observation-method-sheet/file-electrical-observation-method-sheet-store.ts";

Deno.test(
  "electrical method-sheet composition discovers exact-fingerprint nested workspace JSON and refuses a wrong fingerprint",
  async () => {
    const source = await Deno.readTextFile(
      new URL("./server-composition.ts", import.meta.url),
    );
    assertEquals(
      source.includes("config/electrical-observation-method-sheets"),
      true,
    );

    const root = await Deno.makeTempDir({
      prefix: "casys-electrical-method-sheet-workspace-",
    });
    try {
      const nested = `${root}/workspace/nested/deeper`;
      await Deno.mkdir(nested, { recursive: true });
      const payload = validElectricalObservationMethodSheet();
      const sheet = validateElectricalObservationMethodSheet(payload);
      await Deno.writeTextFile(
        `${nested}/sheet.json`,
        `${JSON.stringify(payload, null, 2)}\n`,
      );
      await Deno.writeTextFile(`${root}/workspace/noise.txt`, "ignore");
      await Deno.writeTextFile(
        `${root}/workspace/other.json`,
        `${JSON.stringify({ schemaVersion: "not-a-method-sheet/1.0" }, null, 2)}\n`,
      );
      const store = new FileElectricalObservationMethodSheetStore(
        new FileCaptureStore({
          ...ELECTRICAL_OBSERVATION_METHOD_SHEET_CAPTURE_DESCRIPTOR,
          directory: `${root}/captures`,
        }),
        [`${root}/workspace`],
      );
      const fingerprint = await fingerprintElectricalObservationMethodSheet(
        sheet,
      );
      assertEquals(await store.read(fingerprint), sheet);
      assertEquals(
        await store.read({ algorithm: "sha256", digest: "f".repeat(64) }),
        undefined,
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
);
