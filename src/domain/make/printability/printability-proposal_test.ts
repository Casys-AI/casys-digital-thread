import { assertEquals, assertThrows } from "@std/assert";
import { sha256Fingerprint } from "../../kernel/deterministic-json.ts";
import { validatePrintabilityCheckCase } from "./printability-case.ts";
import {
  canonicalPrintabilityCaseText,
  encodePrintabilityDecisionParameters,
  parsePrintabilityDecisionParameters,
  PrintabilityProposalError,
  verifyPrintabilityParametersMatchCase,
} from "./printability-proposal.ts";

const CASE_JSON = {
  schemaVersion: "printability-check-case/1.0",
  id: "reviewed-printability-v1",
  revision: 1,
  scope: "FDM printability check for the isolated component.",
  evidenceBoundary: "Observations only; not a verdict or certification.",
  project: { id: "reviewed-project-v1", subjectId: "project:reviewed-project-v1" },
  target: { componentKey: "support-bracket" },
  thresholds: {
    minWallThicknessMm: { value: 1.2, unit: "mm" },
    maxOverhangAngleDeg: { value: 45.0, unit: "deg" },
    maxUnsupportedAreaMm2: { value: 600.0, unit: "mm2" },
  },
  meshSizeMm: { value: 2.0, unit: "mm" },
  buildDirection: [0, 0, 1],
  provider: {
    build123dTool: "build123d_export",
    thicknessTool: "dfm_check_min_thickness",
    overhangTool: "dfm_check_overhangs",
  },
  limitations: [
    "Thresholds are provisional FDM candidate values.",
    "This check covers only min wall thickness and max overhang angle.",
  ],
  provenance: {
    status: "provisional",
    note: "Thresholds sourced from typical FDM desktop-printer guidelines.",
  },
};

Deno.test(
  "printability MRTR grammar round-trips a sealed case without unexpected keys",
  async () => {
    const printabilityCase = validatePrintabilityCheckCase(CASE_JSON);
    const digest = (await sha256Fingerprint(printabilityCase)).digest;
    const encoded = encodePrintabilityDecisionParameters(digest, printabilityCase);
    const parsed = parsePrintabilityDecisionParameters(encoded);
    assertEquals(parsed.caseDigest, digest);
    verifyPrintabilityParametersMatchCase(parsed, printabilityCase);
    assertEquals(
      canonicalPrintabilityCaseText(printabilityCase).includes("coffee-machine"),
      false,
    );
  },
);

Deno.test("printability MRTR grammar rejects a missing signed parameter", () => {
  const printabilityCase = validatePrintabilityCheckCase(CASE_JSON);
  const encoded = [
    ...encodePrintabilityDecisionParameters("b".repeat(64), printabilityCase),
  ];
  encoded.pop();
  assertThrows(
    () => parsePrintabilityDecisionParameters(encoded),
    PrintabilityProposalError,
    "Missing",
  );
});

Deno.test("printability MRTR grammar rejects an extra signed parameter", () => {
  const printabilityCase = validatePrintabilityCheckCase(CASE_JSON);
  const encoded = encodePrintabilityDecisionParameters(
    "c".repeat(64),
    printabilityCase,
  );
  assertThrows(
    () =>
      parsePrintabilityDecisionParameters([
        ...encoded,
        { key: "printability.case.extra", label: "Extra", value: "no" },
      ]),
    PrintabilityProposalError,
    "Unexpected",
  );
});

Deno.test("printability MRTR grammar rejects a digest that is not sha256 hex", () => {
  const printabilityCase = validatePrintabilityCheckCase(CASE_JSON);
  const encoded = encodePrintabilityDecisionParameters("d".repeat(64), printabilityCase)
    .map((param) =>
      param.key === "printability.case.digest"
        ? { ...param, value: "not-a-digest" }
        : param
    );
  assertThrows(
    () => parsePrintabilityDecisionParameters(encoded),
    PrintabilityProposalError,
    "lowercase 64-character",
  );
});

Deno.test("printability MRTR grammar rejects a parameter mismatch against the case", () => {
  const printabilityCase = validatePrintabilityCheckCase(CASE_JSON);
  const parsed = parsePrintabilityDecisionParameters(
    encodePrintabilityDecisionParameters("e".repeat(64), printabilityCase),
  );
  assertThrows(
    () =>
      verifyPrintabilityParametersMatchCase(
        {
          ...parsed,
          meshSizeMm: { value: 3, unit: "mm" },
        },
        printabilityCase,
      ),
    PrintabilityProposalError,
    "meshSizeMm.value",
  );
});
