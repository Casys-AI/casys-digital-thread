import { assertEquals, assertThrows } from "@std/assert";
import type { SourceAnalysisBundle } from "../source/source-analysis.ts";
import { sampleTechnicalSourceAnalysisCaptureLocator } from "../../../testing/technical-source-capture-test-support.ts";
import {
  assembleTechnicalSourceCaptureReview,
  captureReviewContent,
  TECHNICAL_SOURCE_CAPTURE_REVIEW_SCHEMA,
} from "./technical-source-capture-review.ts";

const REFERENCE = sampleTechnicalSourceAnalysisCaptureLocator();

Deno.test(
  "photo CAD capture review keeps parser passed apart from unresolved levers",
  () => {
    const photo = "from build123d import Box\nresult = Box(20, 10, 5)\n";
    const review = assembleTechnicalSourceCaptureReview(
      REFERENCE,
      photo,
      analysis([artifactSymbol()], []),
    );
    assertEquals(review.schemaVersion, TECHNICAL_SOURCE_CAPTURE_REVIEW_SCHEMA);
    assertEquals(review.reference, REFERENCE);
    assertEquals(review.parser, {
      status: "passed",
      profile: "build123d-closed-subset-v1",
    });
    assertEquals(review.levers.status, "unresolved");
    if (review.levers.status !== "unresolved") return;
    assertEquals(review.levers.code, "source.no-named-numeric-lever");
    const text = captureReviewContent(review);
    assertEquals(text.includes("parser status passed"), true);
    assertEquals(text.includes("CAD levers: unresolved"), true);
    assertEquals(text.includes("constructor photo"), true);
    assertEquals(text.includes("result.reference"), true);
    assertEquals(text.includes("not admission"), true);
    assertEquals(text.includes("not a SysML bind"), true);
  },
);

Deno.test(
  "reachable CAD capture review is lever-ok without claiming a SysML bind",
  () => {
    const source = "thickness = 2.0\nresult = Box(20, 10, thickness)\n";
    const review = assembleTechnicalSourceCaptureReview(
      REFERENCE,
      source,
      analysis(
        [parameterSymbol("parameter.thickness", "thickness"), artifactSymbol()],
        [dependency("parameter.thickness", "artifact.result")],
      ),
    );
    assertEquals(review.parser.status, "passed");
    assertEquals(review.levers, {
      status: "ok",
      levers: [{ semanticKey: "thickness", value: 2 }],
    });
    const text = captureReviewContent(review);
    assertEquals(text.includes("CAD levers: ok (1 reachable named literal(s))"), true);
    assertEquals(text.includes("parameterizes is compile"), true);
  },
);

Deno.test(
  "circuit-only SPICE capture review does not invent a CAD lever diagnosis",
  () => {
    const bundle = analysis([artifactSymbol()], []);
    const spice = {
      ...bundle,
      source: {
        ...bundle.source,
        role: "spice-circuit" as const,
        language: "spice" as const,
      },
    };
    const review = assembleTechnicalSourceCaptureReview(
      REFERENCE,
      "Vin in 0 5\nRload in 0 1k\n",
      spice,
    );
    assertEquals(review.levers, { status: "not-applicable" });
    assertEquals(
      captureReviewContent(review).includes("not-applicable for this source role"),
      true,
    );
  },
);

Deno.test(
  "Modelica capture review does not invent a CAD lever diagnosis",
  () => {
    const bundle = analysis([artifactSymbol()], []);
    const modelica = {
      ...bundle,
      source: {
        ...bundle.source,
        role: "modelica-model" as const,
        language: "modelica" as const,
      },
    };
    const review = assembleTechnicalSourceCaptureReview(
      REFERENCE,
      "model X end X;",
      modelica,
    );
    assertEquals(review.levers, { status: "not-applicable" });
    assertEquals(
      captureReviewContent(review).includes("not-applicable for this source role"),
      true,
    );
  },
);

Deno.test(
  "capture review refuses a review envelope as the opaque reference",
  () => {
    assertThrows(
      () =>
        assembleTechnicalSourceCaptureReview(
          {
            schemaVersion: TECHNICAL_SOURCE_CAPTURE_REVIEW_SCHEMA,
            reference: REFERENCE,
            parser: { status: "passed", profile: "profile.build123d" },
            levers: { status: "not-applicable" },
          },
          "from build123d import Box\nresult = Box(1, 2, 3)\n",
          analysis([artifactSymbol()], []),
        ),
      TypeError,
      "unsupported field",
    );
  },
);

Deno.test("capture review refuses a V1 capture document as the opaque locator", () => {
  assertThrows(
    () =>
      assembleTechnicalSourceCaptureReview(
        {
          schemaVersion: "technical-source-analysis-capture/1.0",
          kind: "technical-source-analysis",
          fingerprint: REFERENCE.fingerprint,
          byteCount: REFERENCE.byteCount,
          casUri: REFERENCE.casUri,
        },
        "from build123d import Box\nresult = Box(1, 2, 3)\n",
        analysis([artifactSymbol()], []),
      ),
    TypeError,
  );
});

function analysis(
  symbols: SourceAnalysisBundle["symbols"],
  dependencies: SourceAnalysisBundle["dependencies"],
): SourceAnalysisBundle {
  return {
    schemaVersion: "source-analysis/1.0",
    source: {
      id: "source.cad",
      role: "cad-script",
      language: "python",
      fingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
    },
    analyzer: { id: "build123d-qualified-lezer", version: "1.6.0" },
    policy: {
      profile: "build123d-closed-subset-v1",
      status: "passed",
      findings: [],
    },
    symbols,
    dependencies,
    unresolvedConstructs: [],
  };
}

function parameterSymbol(id: string, name: string) {
  return {
    id,
    kind: "parameter" as const,
    name,
    span: {
      start: { line: 1, column: 0 },
      end: { line: 1, column: name.length },
    },
  };
}

function artifactSymbol() {
  return {
    id: "artifact.result",
    kind: "artifact" as const,
    name: "result",
  };
}

function dependency(fromSymbolId: string, toSymbolId: string) {
  return {
    id: `dependency.${fromSymbolId}.${toSymbolId}`,
    kind: "structural-incidence" as const,
    fromSymbolId,
    toSymbolId,
  };
}
