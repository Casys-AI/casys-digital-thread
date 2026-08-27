import { assertEquals } from "@std/assert";
import {
  QUALIFIED_MODELICA_SOURCE_ANALYSIS_PROFILE,
  QUALIFIED_MODELICA_SOURCE_ANALYZER_ID,
  QUALIFIED_MODELICA_SOURCE_ANALYZER_VERSION,
} from "./qualified-source-analyzer.ts";
import {
  createModelicaTechnicalSourceAnalysisProfileRegistry,
  QUALIFIED_MODELICA_MAX_SOURCE_BYTES,
  QUALIFIED_MODELICA_TECHNICAL_SOURCE_PROFILE,
} from "./source-analysis-composition.ts";

Deno.test("Modelica source-analysis composition registers only closed-subset-v2", () => {
  assertEquals(QUALIFIED_MODELICA_TECHNICAL_SOURCE_PROFILE, {
    id: QUALIFIED_MODELICA_SOURCE_ANALYSIS_PROFILE,
    version: "2.0.0",
    role: "modelica-model",
    language: "modelica",
    analyzer: {
      id: QUALIFIED_MODELICA_SOURCE_ANALYZER_ID,
      version: QUALIFIED_MODELICA_SOURCE_ANALYZER_VERSION,
    },
    maxSourceBytes: QUALIFIED_MODELICA_MAX_SOURCE_BYTES,
  });

  const registry = createModelicaTechnicalSourceAnalysisProfileRegistry();
  assertEquals(
    registry.requireExact({
      id: "modelica-closed-subset-v2",
      version: "2.0.0",
    }).profile,
    QUALIFIED_MODELICA_TECHNICAL_SOURCE_PROFILE,
  );
});
