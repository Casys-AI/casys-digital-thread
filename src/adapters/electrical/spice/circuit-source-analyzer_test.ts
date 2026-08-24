import { assertEquals, assertRejects } from "@std/assert";
import { TechnicalSourceAnalysisCaptureError } from "../../compile/captures/technical-source-analysis-capture.ts";
import { createInitialTechnicalSourceAnalysisCaptureService } from "../../compile/captures/initial-technical-source-analysis-composition.ts";
import {
  technicalSourceAnalysisCaptureStores,
  technicalSourceCaptureInput,
} from "../../../testing/technical-source-capture-test-support.ts";
import { SPICE_CIRCUIT_MAX_SOURCE_BYTES } from "./source-analysis-composition.ts";
import {
  SOURCE_ANALYSIS_SCHEMA,
  validateSourceAnalysisBundle,
} from "../../../domain/compile/source/source-analysis.ts";
import {
  SPICE_AST_IDENTITY_SCHEMA,
  SPICE_CIRCUIT_SOURCE_ANALYSIS_PROFILE,
  SPICE_CIRCUIT_SOURCE_ANALYZER_ID,
  SPICE_CIRCUIT_SOURCE_ANALYZER_VERSION,
  spiceAstSymbolId,
  SpiceCircuitSourceAnalyzer,
} from "./circuit-source-analyzer.ts";

const SOURCE_ID = "source.spice.generic-v1";
const GENERIC_CLAMP = [
  "* generic series clamp",
  "Vsupply vin 0 DC 5",
  "Rseries vin nmid {rseries}",
  "Cshunt nmid 0 100n",
  "Dclamp nmid 0 clamp",
  ".param rseries=330",
  ".model clamp D(Is=1e-14 N=1.8)",
  "",
].join("\n");

function analyze(sourceText: string) {
  return new SpiceCircuitSourceAnalyzer().analyze({
    sourceId: SOURCE_ID,
    role: "spice-circuit",
    language: "spice",
    sourceText,
  });
}

async function sha256Utf8(sourceText: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(sourceText),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

Deno.test("circuit-only SPICE analyzer hashes exact UTF-8 bytes before parse", async () => {
  const bundle = await analyze(GENERIC_CLAMP);
  assertEquals(bundle.source.fingerprint, {
    algorithm: "sha256",
    digest: await sha256Utf8(GENERIC_CLAMP),
  });
  const rejected = await analyze("R1 1 0 1k\n.op\n.end\n");
  assertEquals(rejected.source.fingerprint, {
    algorithm: "sha256",
    digest: await sha256Utf8("R1 1 0 1k\n.op\n.end\n"),
  });
  assertEquals(rejected.policy.status, "rejected");
  assertEquals(rejected.symbols, []);
});

Deno.test("circuit-only SPICE analyzer emits stable symbols for later observation mapping", async () => {
  const first = await analyze(GENERIC_CLAMP);
  const second = await analyze(GENERIC_CLAMP);
  assertEquals(
    first.symbols.map((symbol) => [symbol.kind, symbol.name, symbol.id]),
    second.symbols.map((symbol) => [symbol.kind, symbol.name, symbol.id]),
  );
  assertEquals(first.analyzer, {
    id: SPICE_CIRCUIT_SOURCE_ANALYZER_ID,
    version: SPICE_CIRCUIT_SOURCE_ANALYZER_VERSION,
  });
  assertEquals(first.policy.profile, SPICE_CIRCUIT_SOURCE_ANALYSIS_PROFILE);
  assertEquals(
    first.symbols.filter((symbol) => symbol.kind === "artifact").map((symbol) =>
      symbol.name
    ),
    ["circuit"],
  );
  assertEquals(
    first.symbols.filter((symbol) => symbol.kind === "parameter").map((symbol) =>
      symbol.name
    ),
    ["rseries"],
  );
  assertEquals(
    first.symbols.filter((symbol) => symbol.kind === "component").map((symbol) =>
      symbol.name
    ).toSorted(),
    ["Cshunt", "Dclamp", "Rseries", "Vsupply", "clamp"],
  );
  assertEquals(
    first.symbols.find((symbol) => symbol.name === "clamp")?.id,
    await spiceAstSymbolId(SOURCE_ID, { kind: "model", name: "clamp" }),
  );
  assertEquals(
    first.symbols.find((symbol) => symbol.name === "Dclamp")?.id,
    await spiceAstSymbolId(SOURCE_ID, { kind: "component", name: "Dclamp" }),
  );
  assertEquals(
    first.symbols.filter((symbol) => symbol.kind === "variable").map((symbol) =>
      symbol.name
    ).toSorted(),
    ["0", "nmid", "vin"],
  );
  assertEquals(
    first.symbols.find((symbol) => symbol.kind === "parameter")?.id,
    await spiceAstSymbolId(SOURCE_ID, { kind: "parameter", name: "rseries" }),
  );
  const versioned = await spiceAstSymbolId(SOURCE_ID, {
    kind: "parameter",
    name: "rseries",
  });
  assertEquals(typeof versioned, "string");
  assertEquals(SPICE_AST_IDENTITY_SCHEMA, "spice-ast-identity/1.0");
});

Deno.test("circuit-only SPICE analyzer maps .param substitutions as static value flows", async () => {
  const bundle = await analyze(GENERIC_CLAMP);
  const parameter = bundle.symbols.find((symbol) => symbol.kind === "parameter")!;
  const resistor = bundle.symbols.find((symbol) =>
    symbol.kind === "component" && symbol.name === "Rseries"
  )!;
  const diode = bundle.symbols.find((symbol) =>
    symbol.kind === "component" && symbol.name === "Dclamp"
  )!;
  const model = bundle.symbols.find((symbol) =>
    symbol.kind === "component" && symbol.name === "clamp"
  )!;
  assertEquals(
    bundle.dependencies.some((dependency) =>
      dependency.kind === "static-value-flow" &&
      dependency.fromSymbolId === parameter.id &&
      dependency.toSymbolId === resistor.id
    ),
    true,
  );
  assertEquals(
    bundle.dependencies.some((dependency) =>
      dependency.kind === "declared-dependency" &&
      dependency.fromSymbolId === diode.id &&
      dependency.toSymbolId === model.id
    ),
    true,
  );
});

Deno.test("circuit-only SPICE analyzer rejects dangerous and analysis-owned directives", async () => {
  for (
    const source of [
      "R1 1 0 1k\n.control\n.endc\n",
      "R1 1 0 1k\n.include foo.lib\n",
      "R1 1 0 1k\n.inc foo.lib\n",
      "R1 1 0 1k\n.lib bar.lib\n",
      "R1 1 0 1k\n.shell ls\n",
      "B1 1 0 V=v(1)\n",
      "R1 1 0 1k\n.op\n.end\n",
      "R1 1 0 1k\n.tran 1n 1u\n",
      "R1 1 0 1k\n.ac lin 1 1 1\n",
      "R1 1 0 1k\n.dc Vin 0 5 0.1\n",
    ]
  ) {
    const bundle = await analyze(source);
    assertEquals(bundle.policy.status, "rejected");
    assertEquals(
      bundle.policy.findings[0]?.code,
      "spice-circuit-closed-subset-v1-rejected",
    );
  }
});

Deno.test("circuit-only SPICE analyzer refuses CAD and Modelica roles", async () => {
  await assertRejects(
    () =>
      new SpiceCircuitSourceAnalyzer().analyze({
        sourceId: SOURCE_ID,
        role: "modelica-model",
        language: "modelica",
        sourceText: GENERIC_CLAMP,
      }),
    TypeError,
    "spice-circuit/spice",
  );
});

Deno.test("capture persists and reopens exact SPICE UTF-8 bytes under the unique profile", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "spice-circuit-source-cap-",
  });
  try {
    const service = createInitialTechnicalSourceAnalysisCaptureService(
      technicalSourceAnalysisCaptureStores(directory),
    );
    const persisted = await service.persist(technicalSourceCaptureInput({
      profileId: SPICE_CIRCUIT_SOURCE_ANALYSIS_PROFILE,
      sourceId: SOURCE_ID,
      sourceText: GENERIC_CLAMP,
    }));
    const reopened = await service.reopenLocator(persisted.locator);
    assertEquals(reopened.sourceText, GENERIC_CLAMP);
    assertEquals(
      persisted.document.profile.id,
      SPICE_CIRCUIT_SOURCE_ANALYSIS_PROFILE,
    );
    assertEquals(persisted.document.source.role, "spice-circuit");
    assertEquals(persisted.document.source.language, "spice");
    assertEquals(persisted.document.analysis.analyzer, {
      id: SPICE_CIRCUIT_SOURCE_ANALYZER_ID,
      version: SPICE_CIRCUIT_SOURCE_ANALYZER_VERSION,
    });
    assertEquals(
      Object.keys(persisted.locator).some((key) =>
        ["provider", "tool", "runtime", "image"].includes(key)
      ),
      false,
    );

    const oversized = `${"x".repeat(SPICE_CIRCUIT_MAX_SOURCE_BYTES + 1)}`;
    const error = await assertRejects(
      () =>
        service.capture(technicalSourceCaptureInput({
          profileId: SPICE_CIRCUIT_SOURCE_ANALYSIS_PROFILE,
          sourceId: SOURCE_ID,
          sourceText: oversized,
        })),
      TechnicalSourceAnalysisCaptureError,
    );
    assertEquals(error.code, "source_size_limit_exceeded");

    const rejected = await assertRejects(
      () =>
        service.capture(technicalSourceCaptureInput({
          profileId: SPICE_CIRCUIT_SOURCE_ANALYSIS_PROFILE,
          sourceId: SOURCE_ID,
          sourceText: "R1 1 0 1k\n.op\n.end\n",
        })),
      TechnicalSourceAnalysisCaptureError,
    );
    assertEquals(rejected.code, "analysis_rejected");
    const rejectedReplay = await service.reopenLocator(rejected.reference, true);
    assertEquals(rejectedReplay.analysis.policy.status, "rejected");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("a passed SPICE bundle cannot carry an error finding", () => {
  const error = (() => {
    try {
      validateSourceAnalysisBundle({
        schemaVersion: SOURCE_ANALYSIS_SCHEMA,
        source: {
          id: SOURCE_ID,
          role: "spice-circuit",
          language: "spice",
          fingerprint: { algorithm: "sha256", digest: "0".repeat(64) },
        },
        analyzer: {
          id: SPICE_CIRCUIT_SOURCE_ANALYZER_ID,
          version: SPICE_CIRCUIT_SOURCE_ANALYZER_VERSION,
        },
        policy: {
          profile: SPICE_CIRCUIT_SOURCE_ANALYSIS_PROFILE,
          status: "passed",
          findings: [{
            id: "finding:error",
            code: "error",
            severity: "error",
            message: "An error cannot be admitted in a passed result.",
          }],
        },
        symbols: [],
        dependencies: [],
        unresolvedConstructs: [],
      });
      return undefined;
    } catch (caught) {
      return caught;
    }
  })();
  assertEquals(error instanceof TypeError, true);
});
