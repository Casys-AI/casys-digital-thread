import { assertEquals, assertThrows } from "@std/assert";
import { sha256Fingerprint } from "../../kernel/deterministic-json.ts";
import { DFM_CHECK_CASE_SCHEMA, validateDfmCheckCase } from "./dfm-case.ts";
import {
  DfmProposalError,
  encodeDfmDecisionParameters,
  encodeDfmRunDecisionParameters,
  parseDfmDecisionParameters,
  parseDfmRunDecisionParameters,
  verifyDfmParametersMatchCase,
  verifyDfmRunParametersMatchCase,
} from "./dfm-proposal.ts";

const LIVE_STEP_SHA256 =
  "9273149a5203a13ef3b14f7e70062e76ee106eaaf5ba474e98e1cd9116cdc270";

const CASE_JSON = {
  schemaVersion: DFM_CHECK_CASE_SCHEMA,
  id: "reviewed-dfm-v1",
  revision: 1,
  scope: "Measured DFM checks for the isolated component.",
  evidenceBoundary: "Measured verdicts against the sealed case.",
  project: { id: "reviewed-project-v1", subjectId: "project:reviewed-project-v1" },
  target: {
    componentKey: "support-bracket",
    artifactUri: "thread-artifact://reviewed-project-v1/geometry-step-support-bracket",
    sha256: LIVE_STEP_SHA256,
    mediaType: "model/step",
  },
  buildVolumeMm: {
    x: { value: 250, unit: "mm" },
    y: { value: 210, unit: "mm" },
    z: { value: 200, unit: "mm" },
  },
  minThicknessMm: { value: 2, unit: "mm" },
  maxOverhangAngleDeg: { value: 45, unit: "deg" },
  meshSizeMm: { value: 2, unit: "mm" },
  buildDirection: [0, 0, 1],
  zMinFilter: {
    enabled: true,
    planeZMm: { value: -3, unit: "mm" },
    toleranceMm: { value: 0.1, unit: "mm" },
  },
  provider: {
    envelopeTool: "dfm_check_envelope",
    thicknessTool: "dfm_check_min_thickness",
    overhangTool: "dfm_check_overhangs",
  },
  limitations: ["The live mcp-dfm tools analyse STEP, not STL."],
  provenance: {
    status: "provisional",
    note: "Limits copied from the archived mcp-dfm qualification call.",
  },
};

Deno.test("DFM seal MRTR grammar round-trips a sealed case without unexpected keys", async () => {
  const dfmCase = validateDfmCheckCase(CASE_JSON);
  const digest = (await sha256Fingerprint(dfmCase)).digest;
  const encoded = encodeDfmDecisionParameters(digest, dfmCase);
  const parsed = parseDfmDecisionParameters(encoded);
  assertEquals(parsed.caseDigest, digest);
  verifyDfmParametersMatchCase(parsed, dfmCase);
});

Deno.test("DFM seal MRTR grammar rejects a missing signed parameter", () => {
  const dfmCase = validateDfmCheckCase(CASE_JSON);
  const encoded = encodeDfmDecisionParameters("b".repeat(64), dfmCase).filter(
    (param) => param.key !== "dfm.case.target.sha256",
  );
  assertThrows(
    () => parseDfmDecisionParameters(encoded),
    DfmProposalError,
    "dfm.case.target.sha256",
  );
});

Deno.test("DFM seal MRTR grammar rejects an extra signed parameter", () => {
  const dfmCase = validateDfmCheckCase(CASE_JSON);
  assertThrows(
    () =>
      parseDfmDecisionParameters([
        ...encodeDfmDecisionParameters("c".repeat(64), dfmCase),
        { key: "dfm.case.extra", label: "Extra", value: "no" },
      ]),
    DfmProposalError,
    "Unexpected DFM parameter",
  );
});

Deno.test("DFM run MRTR grammar signs the case digest and declared Z-min filter", async () => {
  const dfmCase = validateDfmCheckCase(CASE_JSON);
  const digest = (await sha256Fingerprint(dfmCase)).digest;
  const parsed = parseDfmRunDecisionParameters(
    encodeDfmRunDecisionParameters({
      caseDigest: digest,
      targetSha256: dfmCase.target.sha256,
      zMinFilter: dfmCase.zMinFilter,
    }),
  );
  verifyDfmRunParametersMatchCase(parsed, dfmCase, digest);
});

Deno.test("DFM run MRTR grammar rejects a digest that is not sha256 hex", () => {
  const dfmCase = validateDfmCheckCase(CASE_JSON);
  const encoded = [
    ...encodeDfmRunDecisionParameters({
      caseDigest: "d".repeat(64),
      targetSha256: dfmCase.target.sha256,
      zMinFilter: dfmCase.zMinFilter,
    }),
  ];
  const digest = encoded.find((param) => param.key === "dfm.run.caseDigest")!;
  (digest as { value: string }).value = "not-a-digest";
  assertThrows(
    () => parseDfmRunDecisionParameters(encoded),
    DfmProposalError,
    "lowercase 64-character hex",
  );
});
