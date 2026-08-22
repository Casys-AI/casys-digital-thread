import { assertEquals } from "@std/assert";
import {
  SPICE_CIRCUIT_SOURCE_ANALYSIS_PROFILE,
  SPICE_CIRCUIT_SOURCE_ANALYZER_ID,
  SPICE_CIRCUIT_SOURCE_ANALYZER_VERSION,
} from "./circuit-source-analyzer.ts";
import {
  SPICE_CIRCUIT_MAX_SOURCE_BYTES,
  SPICE_CIRCUIT_TECHNICAL_SOURCE_PROFILE,
  spiceCircuitSourceAnalysisRegistration,
} from "./source-analysis-composition.ts";

Deno.test("SPICE source-analysis composition registers only circuit-closed-subset-v1", () => {
  assertEquals(SPICE_CIRCUIT_TECHNICAL_SOURCE_PROFILE, {
    id: SPICE_CIRCUIT_SOURCE_ANALYSIS_PROFILE,
    version: "1.0.0",
    role: "spice-circuit",
    language: "spice",
    analyzer: {
      id: SPICE_CIRCUIT_SOURCE_ANALYZER_ID,
      version: SPICE_CIRCUIT_SOURCE_ANALYZER_VERSION,
    },
    maxSourceBytes: SPICE_CIRCUIT_MAX_SOURCE_BYTES,
  });
  assertEquals(
    spiceCircuitSourceAnalysisRegistration().profile,
    SPICE_CIRCUIT_TECHNICAL_SOURCE_PROFILE,
  );
});
