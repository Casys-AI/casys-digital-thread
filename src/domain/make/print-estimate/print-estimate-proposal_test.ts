import { assertEquals, assertThrows } from "@std/assert";
import { sha256Fingerprint } from "../../kernel/deterministic-json.ts";
import { validatePrintEstimateCase } from "./print-estimate-case.ts";
import {
  canonicalPrintEstimateCaseText,
  encodePrintEstimateDecisionParameters,
  parsePrintEstimateDecisionParameters,
  PrintEstimateProposalError,
  verifyPrintEstimateParametersMatchCase,
} from "./print-estimate-proposal.ts";

function caseJson(options?: { readonly withDensity?: boolean }) {
  const base = {
    schemaVersion: "print-estimate-case/1.0",
    id: "reviewed-fff-estimate-v1",
    revision: 1,
    scope: "FFF print-time-and-material estimate for the isolated component.",
    evidenceBoundary: "Observations only; not a cost quote or verdict.",
    project: { id: "reviewed-project-v1", subjectId: "project:reviewed-project-v1" },
    target: { componentKey: "support-bracket" },
    profile: {
      repoPath: "config/print-estimate-cases/reviewed-fff-0.2-pla.ini",
      exportName: "reviewed-fff-0.2-pla",
      sha256: "a".repeat(64),
      layerHeightMm: { value: 0.2, unit: "mm" },
      nozzleDiameterMm: { value: 0.4, unit: "mm" },
      material: "PLA",
    },
    provider: {
      build123dTool: "build123d_export",
      prusaslicerTool: "prusaslicer_estimate_fff",
    },
    limitations: [
      "Profile parameters are provisional engineering candidates.",
      "gcode_sha256 is an audit reference, not a deterministic attestation.",
    ],
    provenance: {
      status: "provisional",
      note: "Profile parameters are reviewed candidates, not supplier data.",
    },
  };
  if (options?.withDensity !== true) return base;
  return { ...base, filamentDensityGCm3: { value: 1.24, unit: "g/cm3" } };
}

Deno.test(
  "print-estimate MRTR grammar round-trips a case without density",
  async () => {
    const printEstimateCase = validatePrintEstimateCase(caseJson());
    const digest = (await sha256Fingerprint(printEstimateCase)).digest;
    const encoded = encodePrintEstimateDecisionParameters(digest, printEstimateCase);
    const parsed = parsePrintEstimateDecisionParameters(encoded);
    assertEquals(parsed.caseDigest, digest);
    assertEquals(parsed.filamentDensityGCm3, undefined);
    verifyPrintEstimateParametersMatchCase(parsed, printEstimateCase);
    assertEquals(
      canonicalPrintEstimateCaseText(printEstimateCase).includes("price"),
      false,
    );
  },
);

Deno.test(
  "print-estimate MRTR grammar round-trips a case with density",
  async () => {
    const printEstimateCase = validatePrintEstimateCase(
      caseJson({ withDensity: true }),
    );
    const digest = (await sha256Fingerprint(printEstimateCase)).digest;
    const parsed = parsePrintEstimateDecisionParameters(
      encodePrintEstimateDecisionParameters(digest, printEstimateCase),
    );
    assertEquals(parsed.filamentDensityGCm3, { value: 1.24, unit: "g/cm3" });
    verifyPrintEstimateParametersMatchCase(parsed, printEstimateCase);
  },
);

Deno.test("print-estimate MRTR grammar rejects a missing signed parameter", () => {
  const printEstimateCase = validatePrintEstimateCase(caseJson());
  const encoded = [
    ...encodePrintEstimateDecisionParameters("b".repeat(64), printEstimateCase),
  ];
  encoded.pop();
  assertThrows(
    () => parsePrintEstimateDecisionParameters(encoded),
    PrintEstimateProposalError,
    "Missing",
  );
});

Deno.test("print-estimate MRTR grammar rejects an extra signed parameter", () => {
  const printEstimateCase = validatePrintEstimateCase(caseJson());
  const encoded = encodePrintEstimateDecisionParameters(
    "c".repeat(64),
    printEstimateCase,
  );
  assertThrows(
    () =>
      parsePrintEstimateDecisionParameters([
        ...encoded,
        { key: "printEstimate.case.price", label: "Price", value: 12 },
      ]),
    PrintEstimateProposalError,
    "Unexpected",
  );
});

Deno.test("print-estimate MRTR grammar rejects a digest mismatch against the case", () => {
  const printEstimateCase = validatePrintEstimateCase(caseJson());
  const parsed = parsePrintEstimateDecisionParameters(
    encodePrintEstimateDecisionParameters("e".repeat(64), printEstimateCase),
  );
  assertThrows(
    () =>
      verifyPrintEstimateParametersMatchCase(
        {
          ...parsed,
          profile: { ...parsed.profile, material: "ABS" },
        },
        printEstimateCase,
      ),
    PrintEstimateProposalError,
    "profile.material",
  );
});
