import { assertEquals, assertInstanceOf, assertThrows } from "@std/assert";
import {
  QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
  QualifiedBuild123dSourceAnalyzer,
} from "../../cad/source/qualified-build123d-source-analyzer.ts";
import {
  QUALIFIED_MODELICA_SOURCE_ANALYSIS_PROFILE,
  QualifiedModelicaSourceAnalyzer,
} from "../../modelica/source/qualified-source-analyzer.ts";
import {
  TechnicalSourceAnalysisProfileNotRegisteredError,
} from "./technical-source-analysis-capture.ts";
import {
  technicalSourceAnalysisCaptureStores,
  technicalSourceCaptureInput,
} from "../../../testing/technical-source-capture-test-support.ts";
import {
  INITIAL_TECHNICAL_COMPILATION_PROFILE_CATALOG,
} from "../admission/fixed-technical-compilation-profile-catalog-provider.ts";
import {
  createInitialTechnicalSourceAnalysisCaptureService,
  createInitialTechnicalSourceAnalysisProfileRegistry,
  INITIAL_QUALIFIED_BUILD123D_MAX_SOURCE_BYTES,
  INITIAL_QUALIFIED_BUILD123D_TECHNICAL_SOURCE_PROFILE,
} from "./initial-technical-source-analysis-composition.ts";
import {
  QUALIFIED_MODELICA_MAX_SOURCE_BYTES,
  QUALIFIED_MODELICA_TECHNICAL_SOURCE_PROFILE,
} from "../../modelica/source/source-analysis-composition.ts";
import {
  SPICE_CIRCUIT_MAX_SOURCE_BYTES,
  SPICE_CIRCUIT_TECHNICAL_SOURCE_PROFILE,
} from "../../electrical/spice/source-analysis-composition.ts";
import { SpiceCircuitSourceAnalyzer } from "../../electrical/spice/circuit-source-analyzer.ts";

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
  const compilation = requiredCompilationProfile(
    QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
  );
  const modelicaCompilation = requiredCompilationProfile(
    QUALIFIED_MODELICA_SOURCE_ANALYSIS_PROFILE,
  );
  const modelica = registry.requireExact({
    id: QUALIFIED_MODELICA_TECHNICAL_SOURCE_PROFILE.id,
    version: QUALIFIED_MODELICA_TECHNICAL_SOURCE_PROFILE.version,
  });
  const spiceCompilation = requiredCompilationProfile(
    SPICE_CIRCUIT_TECHNICAL_SOURCE_PROFILE.id,
  );
  const spice = registry.requireExact({
    id: SPICE_CIRCUIT_TECHNICAL_SOURCE_PROFILE.id,
    version: SPICE_CIRCUIT_TECHNICAL_SOURCE_PROFILE.version,
  });

  assertEquals(INITIAL_TECHNICAL_COMPILATION_PROFILE_CATALOG.profiles.length, 3);
  assertEquals(registration.profile, {
    id: compilation.id,
    version: compilation.version,
    role: compilation.sourceRole,
    language: compilation.language,
    analyzer: compilation.analyzer,
    maxSourceBytes: INITIAL_QUALIFIED_BUILD123D_MAX_SOURCE_BYTES,
    workspaceClosureLowering:
      INITIAL_QUALIFIED_BUILD123D_TECHNICAL_SOURCE_PROFILE.workspaceClosureLowering,
  });
  assertEquals(compilation.analysisPolicyProfile, registration.profile.id);
  assertInstanceOf(registration.frontend, QualifiedBuild123dSourceAnalyzer);
  assertEquals(Object.isFrozen(registration.profile), true);
  assertEquals(modelica.profile, {
    id: modelicaCompilation.id,
    version: modelicaCompilation.version,
    role: modelicaCompilation.sourceRole,
    language: modelicaCompilation.language,
    analyzer: modelicaCompilation.analyzer,
    maxSourceBytes: QUALIFIED_MODELICA_MAX_SOURCE_BYTES,
  });
  assertInstanceOf(modelica.frontend, QualifiedModelicaSourceAnalyzer);
  assertEquals(spice.profile, {
    id: spiceCompilation.id,
    version: spiceCompilation.version,
    role: spiceCompilation.sourceRole,
    language: spiceCompilation.language,
    analyzer: spiceCompilation.analyzer,
    maxSourceBytes: SPICE_CIRCUIT_MAX_SOURCE_BYTES,
  });
  assertInstanceOf(spice.frontend, SpiceCircuitSourceAnalyzer);

  assertThrows(
    () => registry.requireForCapture("modelica-unqualified"),
    TechnicalSourceAnalysisProfileNotRegisteredError,
  );
});

function requiredCompilationProfile(id: string) {
  const profile = INITIAL_TECHNICAL_COMPILATION_PROFILE_CATALOG.profiles.find(
    (candidate) => candidate.id === id,
  );
  if (profile === undefined) {
    throw new Error(`Missing registered compilation profile ${id}.`);
  }
  return profile;
}

Deno.test("initial capture service persists and replays the exact qualified frontend", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "initial-technical-source-analysis-",
  });
  try {
    const service = createInitialTechnicalSourceAnalysisCaptureService(
      technicalSourceAnalysisCaptureStores(directory),
    );
    const persisted = await service.persist(technicalSourceCaptureInput({
      profileId: QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
      sourceId: "source.support",
      sourceText: SOURCE_TEXT,
    }));
    const reopened = await service.reopenLocator(persisted.locator);

    assertEquals(reopened.sourceText, SOURCE_TEXT);
    assertEquals(
      persisted.document.profile.id,
      QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
    );
    assertEquals(
      persisted.document.profile.version,
      INITIAL_QUALIFIED_BUILD123D_TECHNICAL_SOURCE_PROFILE.version,
    );
    assertEquals(persisted.document.analysis.analyzer, {
      id: INITIAL_QUALIFIED_BUILD123D_TECHNICAL_SOURCE_PROFILE.analyzer.id,
      version: INITIAL_QUALIFIED_BUILD123D_TECHNICAL_SOURCE_PROFILE.analyzer.version,
    });
    assertEquals(persisted.document.analysis.policy, {
      profile: QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
      status: "passed",
    });
    assertEquals(reopened.analysis.unresolvedConstructs, []);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
