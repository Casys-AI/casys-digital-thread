import { assertEquals } from "@std/assert";
import {
  duplicateSourceThermalMethodSheet,
  missingBindingThermalMethodSheet,
  missingSourceThermalMethodSheet,
  modelicaTextThermalMethodSheet,
  validThermalMethodSheetPlaceholder,
} from "./modelica-thermal-method-sheet-fixtures.ts";

const PHYSICAL_QUANTITY = /\b\d+(?:\.\d+)?\s*(?:mm|MPa|Pa|kN|N|W|V|A|K|degC|°C|s)\b/i;
const MODELICA_SOURCE = /\.mo\b|modelicaText/i;

function statements(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(statements);
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, child]) => [key, ...statements(child)],
    );
  }
  return [];
}

Deno.test(
  "thermal method-sheet fixtures hold explicit placeholders without physical quantities or Modelica source",
  () => {
    const valid = validThermalMethodSheetPlaceholder();
    for (const text of statements(valid)) {
      assertEquals(PHYSICAL_QUANTITY.test(text), false, text);
      assertEquals(MODELICA_SOURCE.test(text), false, text);
    }
    assertEquals(valid.modelicaText, undefined);
    const model = valid.model as { moduleName: string };
    assertEquals(model.moduleName.includes("."), false);
  },
);

Deno.test(
  "thermal method-sheet fixture keeps its planning source opaque to the public tree",
  () => {
    const sources = validThermalMethodSheetPlaceholder().sources as Array<{
      reference: string;
    }>;
    assertEquals(sources[0].reference.includes("/rfcs/"), false);
    assertEquals(
      sources[0].reference.startsWith("private-history:"),
      true,
    );
  },
);

Deno.test(
  "thermal method-sheet fixtures cover duplicate, missing-source, missing-binding and forbidden source text",
  () => {
    const duplicate = duplicateSourceThermalMethodSheet();
    assertEquals((duplicate.sources as unknown[]).length, 2);
    assertEquals(missingSourceThermalMethodSheet().sources, []);
    const missing = missingBindingThermalMethodSheet();
    const bindings = missing.bindings as { parameterizes: unknown[] };
    assertEquals(bindings.parameterizes, []);
    assertEquals(
      Object.hasOwn(modelicaTextThermalMethodSheet(), "modelicaText"),
      true,
    );
  },
);
