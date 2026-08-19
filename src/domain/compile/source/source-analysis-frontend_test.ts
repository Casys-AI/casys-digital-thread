import { assert, assertEquals } from "@std/assert";
import type {
  SourceAnalysisFrontend,
  SourceAnalysisFrontendInput,
} from "./source-analysis-frontend.ts";
import {
  SOURCE_ANALYSIS_SCHEMA,
  validateSourceAnalysisBundle,
} from "./source-analysis.ts";

Deno.test("SourceAnalysisFrontend input contains exact text but no caller fingerprint", async () => {
  let received: SourceAnalysisFrontendInput | undefined;
  const frontend: SourceAnalysisFrontend = {
    analyze: (input) => {
      received = input;
      return Promise.resolve(validateSourceAnalysisBundle({
        schemaVersion: SOURCE_ANALYSIS_SCHEMA,
        source: {
          id: input.sourceId,
          role: input.role,
          language: input.language,
          fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
        },
        analyzer: { id: "test-frontend", version: "1.0.0" },
        policy: { profile: "test", status: "passed", findings: [] },
        symbols: [],
        dependencies: [],
        unresolvedConstructs: [],
      }));
    },
  };

  const sourceText = "from build123d import Box\nresult = Box(1, 1, 1)\n";
  await frontend.analyze({
    sourceId: "cad:test",
    role: "cad-script",
    language: "python",
    sourceText,
  });

  assert(received);
  assertEquals(received.sourceText, sourceText);
  assertEquals("fingerprint" in received, false);
});
