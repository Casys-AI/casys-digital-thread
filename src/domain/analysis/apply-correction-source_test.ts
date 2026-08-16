import { assertEquals } from "@std/assert";
import { QualifiedBuild123dSourceAnalyzer } from "../../adapters/analyzers/qualified-build123d-source-analyzer.ts";
import { applyCorrectionToAdmittedSource } from "./apply-correction-source.ts";

const SOURCE = [
  "from build123d import Box",
  "arm_thickness = 10",
  "result = Box(arm_thickness, 20, 30)",
  "",
].join("\n");

Deno.test("applyCorrectionToAdmittedSource replaces the signed current literal with z*", async () => {
  const analysis = await new QualifiedBuild123dSourceAnalyzer().analyze({
    sourceId: "arm",
    role: "cad-script",
    language: "python",
    sourceText: SOURCE,
  });
  const applied = applyCorrectionToAdmittedSource({
    sourceText: SOURCE,
    analysis,
    semanticKey: "arm_thickness",
    current: 10,
    proposed: 10.76,
  });
  assertEquals(applied.status, "applied");
  if (applied.status !== "applied") return;
  assertEquals(applied.sourceText.includes("arm_thickness = 10.76"), true);
  assertEquals(applied.sourceText.includes("arm_thickness = 10\n"), false);
});

Deno.test("applyCorrectionToAdmittedSource refuses when the admitted literal is not the signed current", async () => {
  const analysis = await new QualifiedBuild123dSourceAnalyzer().analyze({
    sourceId: "arm",
    role: "cad-script",
    language: "python",
    sourceText: SOURCE,
  });
  const applied = applyCorrectionToAdmittedSource({
    sourceText: SOURCE,
    analysis,
    semanticKey: "arm_thickness",
    current: 11,
    proposed: 10.76,
  });
  assertEquals(applied.status, "unapplied");
  if (applied.status !== "unapplied") return;
  assertEquals(applied.reason, "current-mismatch");
});
