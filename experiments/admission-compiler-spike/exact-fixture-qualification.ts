/**
 * Closed, spike-only conformance receipt for the one native build123d fixture.
 *
 * This is deliberately not an admission decision. It proves only that the
 * source bytes and conservative Python analysis are the exact code-owned
 * fixture reviewed by this experiment. In particular, the receipt does not
 * erase the analyzer's unresolved constructs and cannot change a compilation
 * from `unresolved` to `resolved`.
 */

import {
  fingerprintSourceAnalysisBundle,
  type SourceAnalysisBundle,
  validateSourceAnalysisBundle,
} from "../../src/domain/compile/source/source-analysis.ts";
import { deepFreeze } from "../../src/domain/kernel/case-validation.ts";
import { deterministicJson } from "../../src/domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../src/domain/kernel/primitives.ts";
import { NATIVE_MECHANICAL_BUILD123D_SCRIPT } from "./native-smoke.ts";

export const EXACT_BUILD123D_FIXTURE_QUALIFICATION_SCHEMA =
  "spike-only/exact-build123d-fixture-qualification/0.1" as const;

export const NATIVE_MECHANICAL_BUILD123D_SOURCE_ID =
  "cad:native-support-block-fixture" as const;

const EXPECTED_SOURCE_SHA256 =
  "615c55d56e0331f699c837d2763d8d5629ffb0cd48881437845b3359e81b5c87";
const EXPECTED_ANALYSIS_SHA256 =
  "fc8a4bde189daff6446e769cd2a0d5d45680af74cd9b71b356e5c68fe326f6f1";

const EXPECTED_ANALYSIS: SourceAnalysisBundle = deepFreeze({
  schemaVersion: "source-analysis/1.0",
  source: {
    id: NATIVE_MECHANICAL_BUILD123D_SOURCE_ID,
    role: "cad-script",
    language: "python",
    fingerprint: { algorithm: "sha256", digest: EXPECTED_SOURCE_SHA256 },
  },
  analyzer: { id: "python-cad-lezer", version: "1.0.0" },
  policy: {
    profile: "python-cad-conservative-v1",
    status: "passed",
    findings: [],
  },
  symbols: [{
    id: "artifact:result",
    kind: "artifact",
    name: "result",
    span: {
      start: { line: 2, column: 0 },
      end: { line: 2, column: 6 },
    },
  }],
  dependencies: [],
  unresolvedConstructs: [
    {
      id: "unresolved:python-attribute:65:74",
      kind: "python-attribute",
      message: "Attribute and subscript expressions are not interpreted in v1.",
      span: {
        start: { line: 2, column: 32 },
        end: { line: 2, column: 41 },
      },
    },
    {
      id: "unresolved:python-attribute:76:85",
      kind: "python-attribute",
      message: "Attribute and subscript expressions are not interpreted in v1.",
      span: {
        start: { line: 2, column: 43 },
        end: { line: 2, column: 52 },
      },
    },
    {
      id: "unresolved:python-attribute:87:96",
      kind: "python-attribute",
      message: "Attribute and subscript expressions are not interpreted in v1.",
      span: {
        start: { line: 2, column: 54 },
        end: { line: 2, column: 63 },
      },
    },
    {
      id: "unresolved:python-call-expression:42:98",
      kind: "python-call-expression",
      message: "Calls are not semantically evaluated in v1.",
      span: {
        start: { line: 2, column: 9 },
        end: { line: 2, column: 65 },
      },
    },
    {
      id: "unresolved:python-import:0:32",
      kind: "python-import",
      message:
        "Imports are execution validation facts, not semantic source relations in v1.",
      span: {
        start: { line: 1, column: 0 },
        end: { line: 1, column: 32 },
      },
    },
  ],
});

export interface ExactBuild123dFixtureQualification {
  readonly schemaVersion: typeof EXACT_BUILD123D_FIXTURE_QUALIFICATION_SCHEMA;
  readonly authority: "spike-only-code-owned-fixture-conformance";
  readonly fixtureOnly: true;
  readonly admitted: false;
  readonly compilationStatusEffect: "none";
  readonly sourceId: typeof NATIVE_MECHANICAL_BUILD123D_SOURCE_ID;
  readonly sourceFingerprint: ContentFingerprint;
  readonly analysisFingerprint: ContentFingerprint;
  readonly unresolvedDiagnosticIds: readonly string[];
}

/**
 * Re-attest an observed frontend result against a complete closed expectation.
 * Any source, analyzer, policy, symbol, span, message or diagnostic drift is a
 * hard rejection rather than a broader implicit qualification.
 */
export async function qualifyExactNativeBuild123dFixture(
  sourceText: string,
  analysis: unknown,
): Promise<ExactBuild123dFixtureQualification> {
  if (sourceText !== NATIVE_MECHANICAL_BUILD123D_SCRIPT) {
    throw new TypeError(
      "The build123d qualification accepts only the exact code-owned fixture bytes.",
    );
  }
  const observed = validateSourceAnalysisBundle(analysis);
  if (deterministicJson(observed) !== deterministicJson(EXPECTED_ANALYSIS)) {
    throw new TypeError(
      "The build123d qualification analysis or unresolved diagnostics drifted from the closed fixture.",
    );
  }
  const analysisFingerprint = await fingerprintSourceAnalysisBundle(observed);
  if (analysisFingerprint.digest !== EXPECTED_ANALYSIS_SHA256) {
    throw new TypeError(
      "The build123d qualification analysis fingerprint drifted from the closed fixture.",
    );
  }
  return deepFreeze({
    schemaVersion: EXACT_BUILD123D_FIXTURE_QUALIFICATION_SCHEMA,
    authority: "spike-only-code-owned-fixture-conformance",
    fixtureOnly: true,
    admitted: false,
    compilationStatusEffect: "none",
    sourceId: NATIVE_MECHANICAL_BUILD123D_SOURCE_ID,
    sourceFingerprint: observed.source.fingerprint,
    analysisFingerprint,
    unresolvedDiagnosticIds: observed.unresolvedConstructs.map((item) => item.id),
  });
}
