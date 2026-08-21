import { assertEquals } from "@std/assert";
import { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";
import { THERMAL_METHOD_SHEET_CAPTURE_DESCRIPTOR } from "../../shared/cas/file-capture-store.ts";
import { validateModelicaThermalMethodSheet } from "../../../domain/modelica/thermal-method-sheet.ts";
import { validThermalMethodSheetPlaceholder } from "../../../testing/modelica-thermal-method-sheet-fixtures.ts";
import { FileThermalMethodSheetStore } from "./file-thermal-method-sheet-store.ts";

Deno.test(
  "thermal method sheet store save/read/reopen recomputes the same fingerprint and hides the path",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "thermal-method-sheet-" });
    try {
      const store = new FileThermalMethodSheetStore(
        new FileCaptureStore({
          ...THERMAL_METHOD_SHEET_CAPTURE_DESCRIPTOR,
          directory,
          syncBoundary: directory,
        }),
      );
      const sheet = validateModelicaThermalMethodSheet(
        validThermalMethodSheetPlaceholder(),
      );
      const saved = await store.save(sheet);
      assertEquals(
        saved.uri.startsWith("casys://modelica-thermal-method-sheet-capture/"),
        true,
      );
      assertEquals(Object.hasOwn(saved, "path"), false);

      const reopened = await store.read(saved.fingerprint);
      assertEquals(reopened, sheet);
      const again = await store.save(sheet);
      assertEquals(again.fingerprint.digest, saved.fingerprint.digest);
      assertEquals(again.uri, saved.uri);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);
