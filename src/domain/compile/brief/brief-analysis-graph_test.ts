import { assertEquals, assertThrows } from "@std/assert";
import { deterministicJson } from "../../kernel/deterministic-json.ts";
import {
  type BriefAnalysisGraphInput,
  buildBriefAnalysisGraph,
} from "./brief-analysis-graph.ts";
import {
  SOURCE_ANALYSIS_SCHEMA,
  type SourceAnalysisBundle,
  validateSourceAnalysisBundle,
} from "../source/source-analysis.ts";

const SOURCE_FINGERPRINT = {
  algorithm: "sha256" as const,
  digest: "a".repeat(64),
};
const DOCUMENT_FINGERPRINT = {
  algorithm: "sha256" as const,
  digest: "b".repeat(64),
};

Deno.test("brief analysis graph deterministically promotes only referenced brief items", () => {
  const input = graphInput();
  const reversed = {
    ...graphInput(),
    bundle: validateSourceAnalysisBundle({
      ...input.bundle,
      symbols: [...input.bundle.symbols].reverse(),
      dependencies: [...input.bundle.dependencies].reverse(),
    }),
  };

  const first = buildBriefAnalysisGraph(input)!;
  const second = buildBriefAnalysisGraph(reversed)!;

  assertEquals(deterministicJson(first), deterministicJson(second));
  assertEquals(first.nodes.map((node) => node.semanticRef.id), [
    "gate-thermal",
    "objective",
  ]);
  assertEquals(first.relations[0].assertion.evidence, [{
    id: "approved-brief-baseline",
    fingerprint: DOCUMENT_FINGERPRINT,
  }]);
  assertEquals(first.relations[0].assertion.assertedBy, {
    kind: "analyzer",
    id: "project-brief-json",
    version: "1.0.0",
  });
  assertEquals(first.relations[0].assertion.scope, {
    kind: "basis",
    basisFingerprint: SOURCE_FINGERPRINT,
  });
});

Deno.test("brief analysis graph is absent when the brief has no explicit dependencies", () => {
  const input = graphInput();
  assertEquals(
    buildBriefAnalysisGraph({
      ...input,
      bundle: validateSourceAnalysisBundle({
        ...input.bundle,
        dependencies: [],
      }),
    }),
    undefined,
  );
});

Deno.test("brief analysis graph rejects wrong source role, rejected policy, and non-declared dependencies", () => {
  const wrongRole = graphInput();
  assertThrows(
    () =>
      buildBriefAnalysisGraph({
        ...wrongRole,
        bundle: validateSourceAnalysisBundle({
          ...wrongRole.bundle,
          source: { ...wrongRole.bundle.source, role: "sysml-model" },
        }),
      }),
    TypeError,
    "source role brief and language plain-text",
  );

  const rejected = graphInput();
  assertThrows(
    () =>
      buildBriefAnalysisGraph({
        ...rejected,
        bundle: validateSourceAnalysisBundle({
          ...rejected.bundle,
          policy: {
            ...rejected.bundle.policy,
            status: "rejected",
            findings: [{
              id: "policy-error",
              code: "rejected",
              severity: "error",
              message: "Not promotable.",
            }],
          },
        }),
      }),
    TypeError,
    "passed source-analysis policy",
  );

  const wrongKind = graphInput();
  assertThrows(
    () =>
      buildBriefAnalysisGraph({
        ...wrongKind,
        bundle: unsafeBundle({
          ...wrongKind.bundle,
          dependencies: [{
            ...wrongKind.bundle.dependencies[0],
            kind: "structural-incidence",
          }],
        }),
      }),
    TypeError,
    "must be declared-dependency",
  );
});

Deno.test("brief analysis graph rejects a dependency endpoint that is not a brief item", () => {
  const input = graphInput();
  assertThrows(
    () =>
      buildBriefAnalysisGraph({
        ...input,
        bundle: unsafeBundle({
          ...input.bundle,
          symbols: [
            ...input.bundle.symbols.filter((symbol) =>
              symbol.id !== "brief-item:objective"
            ),
            { id: "brief-item:objective", kind: "parameter", name: "objective" },
          ],
        }),
      }),
    TypeError,
    "must be brief-item",
  );
});

function graphInput(): BriefAnalysisGraphInput {
  return {
    bundle: bundle(),
    evidence: {
      id: "approved-brief-baseline",
      fingerprint: DOCUMENT_FINGERPRINT,
    },
  };
}

function bundle(): SourceAnalysisBundle {
  return validateSourceAnalysisBundle({
    schemaVersion: SOURCE_ANALYSIS_SCHEMA,
    source: {
      id: "brief:project-a:snapshot:revision:2",
      role: "brief",
      language: "plain-text",
      fingerprint: SOURCE_FINGERPRINT,
    },
    analyzer: { id: "project-brief-json", version: "1.0.0" },
    policy: { profile: "project-brief-explicit-v1", status: "passed", findings: [] },
    symbols: [
      { id: "brief-item:objective", kind: "brief-item", name: "objective" },
      { id: "brief-item:gate-thermal", kind: "brief-item", name: "gate-thermal" },
      { id: "brief-item:unrelated", kind: "brief-item", name: "unrelated" },
    ],
    dependencies: [{
      id: "dependency:objective:gate-thermal",
      kind: "declared-dependency",
      fromSymbolId: "brief-item:objective",
      toSymbolId: "brief-item:gate-thermal",
    }],
    unresolvedConstructs: [],
  });
}

/** Deliberately bypass source validation to prove the builder's own boundary. */
function unsafeBundle(value: unknown): SourceAnalysisBundle {
  return value as SourceAnalysisBundle;
}
