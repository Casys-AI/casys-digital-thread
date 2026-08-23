import { assertEquals } from "@std/assert";
import { validateElectricalObservationMethodSheet } from "../../domain/electrical/observation-method-sheet.ts";
import { validElectricalObservationMethodSheet } from "../../testing/electrical-observation-method-sheet-fixtures.ts";
import {
  ELECTRICAL_OBSERVATION_METHOD_SHEET_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
} from "../shared/cas/file-capture-store.ts";
import { FileElectricalObservationMethodSheetStore } from "./observation-method-sheet/file-electrical-observation-method-sheet-store.ts";

Deno.test(
  "electrical method-sheet composition is CAS-only: saved sheet round-trips and absent fingerprint is unresolved",
  async () => {
    const source = await Deno.readTextFile(
      new URL("./server-composition.ts", import.meta.url),
    );
    assertEquals(
      source.includes("config/electrical-observation-method-sheets"),
      false,
    );

    const root = await Deno.makeTempDir({
      prefix: "casys-electrical-method-sheet-cas-",
    });
    try {
      const store = new FileElectricalObservationMethodSheetStore(
        new FileCaptureStore({
          ...ELECTRICAL_OBSERVATION_METHOD_SHEET_CAPTURE_DESCRIPTOR,
          directory: `${root}/captures`,
        }),
      );
      const sheet = validateElectricalObservationMethodSheet(
        validElectricalObservationMethodSheet(),
      );
      const saved = await store.save(sheet);
      assertEquals(await store.read(saved.fingerprint), sheet);
      assertEquals(
        await store.read({ algorithm: "sha256", digest: "f".repeat(64) }),
        undefined,
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
);
