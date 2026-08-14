import { assertEquals, assertInstanceOf, assertThrows } from "@std/assert";
import {
  QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
  QualifiedBuild123dSourceAnalyzer,
} from "../analyzers/qualified-build123d-source-analyzer.ts";
import {
  TechnicalSourceAnalysisProfileNotRegisteredError,
} from "../captures/technical-source-analysis-capture.ts";
import { FileByteStore } from "../captures/file-byte-store.ts";
import {
  INITIAL_TECHNICAL_COMPILATION_PROFILE_CATALOG,
} from "./fixed-technical-compilation-profile-catalog-provider.ts";
import {
  createInitialTechnicalSourceAnalysisCaptureService,
  createInitialTechnicalSourceAnalysisProfileRegistry,
  INITIAL_QUALIFIED_BUILD123D_MAX_SOURCE_BYTES,
  INITIAL_QUALIFIED_BUILD123D_TECHNICAL_SOURCE_PROFILE,
} from "./initial-technical-source-analysis-composition.ts";

const SOURCE_TEXT = [
  "from build123d import Box",
  "length = 20",
  "width = 10",
  "height = 2",
  "result = Box(length, width, height)",
  "",
].join("\n");

Deno.test("initial source-analysis registration exactly matches compilation qualification", () => {
  const registry = createInitialTechnicalSourceAnalysisProfileRegistry();
  const registration = registry.requireExact({
    id: INITIAL_QUALIFIED_BUILD123D_TECHNICAL_SOURCE_PROFILE.id,
    version: INITIAL_QUALIFIED_BUILD123D_TECHNICAL_SOURCE_PROFILE.version,
  });
  const compilation = INITIAL_TECHNICAL_COMPILATION_PROFILE_CATALOG.profiles[0];

  assertEquals(INITIAL_TECHNICAL_COMPILATION_PROFILE_CATALOG.profiles.length, 1);
  assertEquals(registration.profile, {
    id: compilation.id,
    version: compilation.version,
    role: compilation.sourceRole,
    language: compilation.language,
    analyzer: compilation.analyzer,
    maxSourceBytes: INITIAL_QUALIFIED_BUILD123D_MAX_SOURCE_BYTES,
  });
  assertEquals(compilation.analysisPolicyProfile, registration.profile.id);
  assertInstanceOf(registration.frontend, QualifiedBuild123dSourceAnalyzer);
  assertEquals(Object.isFrozen(registration.profile), true);

  assertThrows(
    () => registry.requireForCapture("modelica-unqualified"),
    TechnicalSourceAnalysisProfileNotRegisteredError,
  );
});

Deno.test("initial capture service persists and replays the exact qualified frontend", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "initial-technical-source-analysis-",
  });
  try {
    const service = createInitialTechnicalSourceAnalysisCaptureService({
      sourceCaptures: new FileByteStore({
        kind: "technical-source",
        directory: `${directory}/source`,
        uriNamespace: "initial-technical-source-test",
        label: "initial technical source",
      }),
      analysisCaptures: new FileByteStore({
        kind: "technical-source-analysis",
        directory: `${directory}/analysis`,
        uriNamespace: "initial-technical-analysis-test",
        label: "initial technical source analysis",
      }),
    });
    const reference = await service.capture({
      profileId: QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
      sourceId: "source.support",
      sourceText: SOURCE_TEXT,
    });
    const reopened = await service.reopen(reference);

    assertEquals(reopened.sourceText, SOURCE_TEXT);
    assertEquals(reference.profile.id, QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE);
    assertEquals(reference.profile.version, "1.0.0");
    assertEquals(reference.analysis.analyzer, {
      id: INITIAL_QUALIFIED_BUILD123D_TECHNICAL_SOURCE_PROFILE.analyzer.id,
      version: INITIAL_QUALIFIED_BUILD123D_TECHNICAL_SOURCE_PROFILE.analyzer.version,
    });
    assertEquals(reference.analysis.policy, {
      profile: QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
      status: "passed",
    });
    assertEquals(reopened.analysis.unresolvedConstructs, []);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
