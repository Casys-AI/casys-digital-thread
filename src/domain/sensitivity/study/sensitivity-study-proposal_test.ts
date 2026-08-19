import { assertEquals, assertThrows } from "@std/assert";
import { sha256Fingerprint } from "../../kernel/deterministic-json.ts";
import {
  canonicalSensitivityStudyCaseText,
  encodeSensitivityStudyDecisionParameters,
  parseSensitivityStudyDecisionParameters,
  SensitivityStudyProposalError,
  verifySensitivityStudyParametersMatchCase,
} from "./sensitivity-study-proposal.ts";
import { validateSensitivityStudyCaseV2 } from "./sensitivity-study-v2.ts";

const CASE_JSON = {
  schemaVersion: "sensitivity-study-case/2.0",
  id: "dl04-size-z-sensitivity",
  revision: 1,
  scope: "mechanical-structural",
  evidenceBoundary: "fea-static",
  project: { id: "desk-lamp-dl04", subjectId: "lamp-arm" },
  target: { componentKey: "arm", semanticKey: "size_z" },
  cadSource: {
    artifactUri: "thread-artifact://desk-lamp-dl04/compile-admission-abc123",
    sha256: "a".repeat(64),
  },
  baseValue: { value: 50.0, unit: "mm" },
  step: { value: 1.0, unit: "mm" },
  metrics: [
    { id: "assembly_max_displacement", unit: "mm" },
    { id: "assembly_max_von_mises", unit: "MPa" },
  ],
  solver: {
    provider: "calculix",
    tool: "calculix_solve_static",
    resultSchemaVersion: "2.0",
    mesh: { kind: "tetrahedral-volume", targetSizeMm: 3.0 },
    material: {
      model: "isotropic-linear-elastic",
      eMpa: 70000,
      nu: 0.33,
      basis: "dl04-aluminium-reviewed",
    },
    supports: [
      {
        id: "wall-mount",
        kind: "fixed",
        selection: {
          name: "Wall",
          box: { min: [0, 0, 0], max: [5, 5, 5], unit: "mm" },
        },
      },
    ],
    loads: [
      {
        id: "tip-load",
        kind: "force",
        selection: {
          name: "Tip",
          box: { min: [10, 10, 10], max: [15, 15, 15], unit: "mm" },
        },
        force: { value: [0, 0, -10], unit: "N" },
      },
    ],
  },
  domain: {
    approximationOrder: "first-order-forward",
    remeshingVariationIncluded: true,
    localValidityNote: "Valid for size_z in [50, 51] mm.",
    limitations: ["Remeshing variation is included."],
  },
};

Deno.test(
  "sensitivity MRTR grammar round-trips a sealed 2.0 case without unexpected keys",
  async () => {
    const studyCase = validateSensitivityStudyCaseV2(CASE_JSON);
    const digest = (await sha256Fingerprint(studyCase)).digest;
    const encoded = encodeSensitivityStudyDecisionParameters(digest, studyCase);
    const parsed = parseSensitivityStudyDecisionParameters(encoded);
    assertEquals(parsed.caseDigest, digest);
    verifySensitivityStudyParametersMatchCase(parsed, studyCase);
    assertEquals(
      canonicalSensitivityStudyCaseText(studyCase).includes("recipeSource"),
      false,
    );
  },
);

Deno.test("sensitivity MRTR grammar rejects a duplicate signed parameter", () => {
  const studyCase = validateSensitivityStudyCaseV2(CASE_JSON);
  const encoded = encodeSensitivityStudyDecisionParameters("b".repeat(64), studyCase);
  assertThrows(
    () =>
      parseSensitivityStudyDecisionParameters([
        ...encoded,
        encoded[0]!,
      ]),
    SensitivityStudyProposalError,
    "Duplicate",
  );
});

Deno.test("sensitivity MRTR grammar rejects a parameter mismatch against the case", () => {
  const studyCase = validateSensitivityStudyCaseV2(CASE_JSON);
  const parsed = parseSensitivityStudyDecisionParameters(
    encodeSensitivityStudyDecisionParameters("c".repeat(64), studyCase),
  );
  assertThrows(
    () =>
      verifySensitivityStudyParametersMatchCase(
        { ...parsed, step: { value: 2, unit: "mm" } },
        studyCase,
      ),
    SensitivityStudyProposalError,
    "step.value",
  );
});
