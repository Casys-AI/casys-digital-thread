import { assertEquals, assertThrows } from "@std/assert";
import { deterministicJson } from "../../../kernel/deterministic-json.ts";
import {
  parseSpiceIsolatedEvidence,
  parseSpiceOperatingPointResult,
  validateAdmittedSpiceIsolatedOutput,
} from "./isolated-output.ts";
import {
  SPICE_ADMITTED_EVIDENCE_OUTPUT,
  SPICE_ADMITTED_MAX_DURATION_MS,
  SPICE_ADMITTED_MAX_EVIDENCE_BYTES,
  SPICE_ADMITTED_MAX_OBSERVABLES,
  SPICE_ADMITTED_MAX_RESULT_BYTES,
  SPICE_ADMITTED_MAX_SOURCE_BYTES,
  SPICE_ADMITTED_MAX_VECTOR_BYTES,
  SPICE_ADMITTED_RESULT_OUTPUT,
  SPICE_CIRCUIT_CLOSED_SUBSET_EXECUTION_PROFILE,
  SPICE_ISOLATED_EVIDENCE_LIMITATIONS,
  SPICE_ISOLATED_EVIDENCE_SCHEMA,
  SPICE_OPERATING_POINT_EXPORT,
  SPICE_OPERATING_POINT_RESULT_SCHEMA,
  SPICE_OPERATING_POINT_SIGN_CONVENTION,
  SPICE_OPERATING_POINT_WRAPPER,
} from "./contract.ts";

const DIVIDER_OBSERVABLES = [
  {
    nativeName: "@r1[i]",
    kind: "branch-current",
    sourceSymbol: "R1",
    value: 0.0025,
    unit: "A",
  },
  {
    nativeName: "@r2[i]",
    kind: "branch-current",
    sourceSymbol: "R2",
    value: 0.0025,
    unit: "A",
  },
  {
    nativeName: "i(vin)",
    kind: "branch-current",
    sourceSymbol: "Vin",
    value: -0.0025,
    unit: "A",
  },
  {
    nativeName: "v(in)",
    kind: "node-voltage",
    sourceSymbol: "in",
    value: 5,
    unit: "V",
  },
  {
    nativeName: "v(out)",
    kind: "node-voltage",
    sourceSymbol: "out",
    value: 2.5,
    unit: "V",
  },
] as const;

const DIODE_OBSERVABLES = [
  {
    nativeName: "@d1[id]",
    kind: "branch-current",
    sourceSymbol: "D1",
    value: 0.003759254,
    unit: "A",
  },
  {
    nativeName: "@r1[i]",
    kind: "branch-current",
    sourceSymbol: "R1",
    value: 0.003759136,
    unit: "A",
  },
  {
    nativeName: "i(vin)",
    kind: "branch-current",
    sourceSymbol: "Vin",
    value: -0.00375914,
    unit: "A",
  },
  {
    nativeName: "v(in)",
    kind: "node-voltage",
    sourceSymbol: "in",
    value: 5,
    unit: "V",
  },
  {
    nativeName: "v(n1)",
    kind: "node-voltage",
    sourceSymbol: "n1",
    value: 1.240864,
    unit: "V",
  },
] as const;

Deno.test("generic resistor-divider operating-point result preserves ngspice signs and units", () => {
  const parsed = parseSpiceOperatingPointResult(resultBytes(DIVIDER_OBSERVABLES));
  assertEquals(parsed.schemaVersion, SPICE_OPERATING_POINT_RESULT_SCHEMA);
  assertEquals(parsed.signConvention, SPICE_OPERATING_POINT_SIGN_CONVENTION);
  assertEquals(parsed.observables, DIVIDER_OBSERVABLES);
  assertEquals(
    parsed.observables.find((item) => item.nativeName === "i(vin)")?.value,
    -0.0025,
  );
  assertEquals(
    parsed.observables.find((item) => item.nativeName === "@r1[i]")?.value,
    0.0025,
  );
});

Deno.test("generic diode operating-point result keeps native device current names", () => {
  const parsed = parseSpiceOperatingPointResult(resultBytes(DIODE_OBSERVABLES));
  assertEquals(
    parsed.observables.map((item) => item.nativeName),
    ["@d1[id]", "@r1[i]", "i(vin)", "v(in)", "v(n1)"],
  );
  assertEquals(parsed.observables[0]?.unit, "A");
  assertEquals(parsed.observables.at(-1)?.unit, "V");
});

Deno.test("admitted SPICE evidence is documentary and does not claim L4, pass, or safety", () => {
  const parsed = parseSpiceIsolatedEvidence(evidenceBytes(DIVIDER_OBSERVABLES));
  assertEquals(parsed.schemaVersion, SPICE_ISOLATED_EVIDENCE_SCHEMA);
  assertEquals(parsed.status, "succeeded");
  assertEquals(parsed.limitations, SPICE_ISOLATED_EVIDENCE_LIMITATIONS);
  assertEquals(
    [...parsed.limitations],
    [
      "documentary-operating-point-only",
      "not-a-requirement-verdict",
      "not-l4",
      "not-safety-claim",
    ],
  );
  assertEquals(parsed.warnings, []);
  assertEquals(parsed.wrapper, SPICE_OPERATING_POINT_WRAPPER);
  assertEquals(parsed.profile, SPICE_CIRCUIT_CLOSED_SUBSET_EXECUTION_PROFILE);
  assertEquals(parsed.method.export, SPICE_OPERATING_POINT_EXPORT);
});

Deno.test("admitted SPICE output roles accept only the registered result and evidence files", () => {
  validateAdmittedSpiceIsolatedOutput(
    SPICE_ADMITTED_RESULT_OUTPUT,
    resultBytes(DIVIDER_OBSERVABLES),
  );
  validateAdmittedSpiceIsolatedOutput(
    SPICE_ADMITTED_EVIDENCE_OUTPUT,
    evidenceBytes(DIVIDER_OBSERVABLES),
  );
  assertThrows(
    () =>
      validateAdmittedSpiceIsolatedOutput(
        { ...SPICE_ADMITTED_RESULT_OUTPUT, basename: "power.json" },
        resultBytes(DIVIDER_OBSERVABLES),
      ),
    TypeError,
  );
});

Deno.test("operating-point result rejects power fields, unsorted names, and unit mismatch", () => {
  const base = JSON.parse(
    new TextDecoder().decode(resultBytes(DIVIDER_OBSERVABLES)),
  );
  assertThrows(
    () =>
      parseSpiceOperatingPointResult(
        jsonBytes({ ...base, powerW: 0.0125 }),
      ),
    TypeError,
  );
  const unsorted = structuredClone(base);
  unsorted.observables = [...unsorted.observables].reverse();
  assertThrows(() => parseSpiceOperatingPointResult(jsonBytes(unsorted)), TypeError);
  const wrongUnit = structuredClone(base);
  wrongUnit.observables[3].unit = "A";
  assertThrows(() => parseSpiceOperatingPointResult(jsonBytes(wrongUnit)), TypeError);
});

Deno.test("isolated evidence rejects pass, L4, and mutated limitation lists", () => {
  const base = JSON.parse(
    new TextDecoder().decode(evidenceBytes(DIVIDER_OBSERVABLES)),
  );
  assertThrows(
    () => parseSpiceIsolatedEvidence(jsonBytes({ ...base, status: "pass" })),
    TypeError,
  );
  assertThrows(
    () => parseSpiceIsolatedEvidence(jsonBytes({ ...base, verdict: "L4" })),
    TypeError,
  );
  const mutated = structuredClone(base);
  mutated.limitations = [...mutated.limitations, "safety"];
  assertThrows(() => parseSpiceIsolatedEvidence(jsonBytes(mutated)), TypeError);
  mutated.limitations = [
    ...SPICE_ISOLATED_EVIDENCE_LIMITATIONS,
    "unavailable-until-product-wiring",
  ];
  assertThrows(() => parseSpiceIsolatedEvidence(jsonBytes(mutated)), TypeError);
});

function resultBytes(observables: unknown): Uint8Array {
  return jsonBytes({
    schemaVersion: SPICE_OPERATING_POINT_RESULT_SCHEMA,
    analysisKind: "operating-point",
    signConvention: SPICE_OPERATING_POINT_SIGN_CONVENTION,
    observables,
  });
}

function evidenceBytes(
  observables: readonly { readonly kind: string }[],
): Uint8Array {
  const nodeVoltageCount = observables.filter((item) => item.kind === "node-voltage")
    .length;
  const branchCurrentCount =
    observables.filter((item) => item.kind === "branch-current").length;
  return jsonBytes({
    schemaVersion: SPICE_ISOLATED_EVIDENCE_SCHEMA,
    status: "succeeded",
    analysisKind: "operating-point",
    inputSourceSha256: "a".repeat(64),
    profile: SPICE_CIRCUIT_CLOSED_SUBSET_EXECUTION_PROFILE,
    wrapper: SPICE_OPERATING_POINT_WRAPPER,
    method: {
      engine: { name: "ngspice", version: "42" },
      export: SPICE_OPERATING_POINT_EXPORT,
    },
    counts: {
      sourceBytes: 48,
      observableCount: observables.length,
      nodeVoltageCount,
      branchCurrentCount,
    },
    limits: {
      maxSourceBytes: SPICE_ADMITTED_MAX_SOURCE_BYTES,
      maxObservables: SPICE_ADMITTED_MAX_OBSERVABLES,
      maxResultBytes: SPICE_ADMITTED_MAX_RESULT_BYTES,
      maxEvidenceBytes: SPICE_ADMITTED_MAX_EVIDENCE_BYTES,
      maxVectorBytes: SPICE_ADMITTED_MAX_VECTOR_BYTES,
      maxDurationMs: SPICE_ADMITTED_MAX_DURATION_MS,
    },
    limitations: SPICE_ISOLATED_EVIDENCE_LIMITATIONS,
    warnings: [],
    result: {
      role: "result",
      basename: "result.json",
      byteCount: 12,
      sha256: "b".repeat(64),
    },
  });
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(deterministicJson(value));
}
