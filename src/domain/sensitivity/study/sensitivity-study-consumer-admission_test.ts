import { assertEquals, assertThrows } from "@std/assert";
import { sha256Fingerprint } from "../../kernel/deterministic-json.ts";
import { VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION } from "../base-evaluation/sensitivity-base-evaluation.ts";
import {
  encodeSensitivityStudyConsumerDecisionParameters,
  parseSensitivityStudyConsumerDecisionParameters,
  sensitivityStudyConsumerAdmission,
} from "./sensitivity-study-consumer-admission.ts";
import {
  SENSITIVITY_STUDY_CAPTURE_SCHEMA,
  validateSensitivityStudyCapture,
} from "./sensitivity-study-capture.ts";
import { MODEL_WRITE_SENSITIVITY_EDGES_OPERATION } from "./sensitivity-study-proposal.ts";
import {
  assembleSensitivityStudyCaseV3,
  validateSensitivityStudyCaseTemplate,
} from "./sensitivity-study-template.ts";
import { computeSensitivities } from "./sensitivity-study.ts";

const AT = "2026-09-09T00:00:00.000Z";
const BASIS = {
  kind: "thread-snapshot" as const,
  snapshotId: "project:inspection-drone-id01:r95:study",
  revision: 95,
  subjectId: "project:inspection-drone-id01",
};

Deno.test("sensitivity-study consumer MRTR round-trips exact server-derived identity", async () => {
  const fixture = await admissionFixture(VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION);
  const parameters = encodeSensitivityStudyConsumerDecisionParameters(
    fixture.admission,
  );
  assertEquals(
    parseSensitivityStudyConsumerDecisionParameters(
      parameters,
      VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION,
    ),
    fixture.admission,
  );
  assertEquals(
    parameters.some((item) => item.key.endsWith("metrics.0.id")),
    true,
  );
});

Deno.test("sensitivity-study consumer MRTR refuses a different registered consumer", async () => {
  const fixture = await admissionFixture(MODEL_WRITE_SENSITIVITY_EDGES_OPERATION);
  const parameters = encodeSensitivityStudyConsumerDecisionParameters(
    fixture.admission,
  );
  assertThrows(
    () =>
      parseSensitivityStudyConsumerDecisionParameters(
        parameters,
        VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION,
      ),
    TypeError,
    "not verify.evaluate-sensitivity-base@1",
  );
});

Deno.test("sensitivity-study consumer MRTR refuses aliases, extras and units", async () => {
  const fixture = await admissionFixture(VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION);
  const parameters = encodeSensitivityStudyConsumerDecisionParameters(
    fixture.admission,
  );
  const aliased = parameters.map((item, index) =>
    index === 8 ? { ...item, key: "studyCapture" } : item
  );
  assertThrows(
    () => parseSensitivityStudyConsumerDecisionParameters(aliased),
    TypeError,
    ".key",
  );
  assertThrows(
    () =>
      parseSensitivityStudyConsumerDecisionParameters([...parameters, parameters[0]!]),
    TypeError,
    "exactly",
  );
  const unit = parameters.map((item, index) =>
    index === 8 ? { ...item, unit: "none" } : item
  );
  assertThrows(
    () => parseSensitivityStudyConsumerDecisionParameters(unit),
    TypeError,
    "unsupported field unit",
  );
});

async function admissionFixture(
  operation:
    | typeof VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION
    | typeof MODEL_WRITE_SENSITIVITY_EDGES_OPERATION,
) {
  const template = validateSensitivityStudyCaseTemplate(
    JSON.parse(
      await Deno.readTextFile(
        "config/sensitivity-study-cases/id01-radial-arm-height-isolated.json",
      ),
    ),
  );
  const studyCase = assembleSensitivityStudyCaseV3(template, {
    artifactUri: "thread-artifact://inspection-drone-id01/admission",
    sha256: "a".repeat(64),
  });
  const base = studyCase.metrics.map((metric) => ({
    metric: metric.id,
    value: 0.15,
    unit: metric.unit,
  }));
  const stepped = studyCase.metrics.map((metric) => ({
    metric: metric.id,
    value: 0.09,
    unit: metric.unit,
  }));
  const capture = await validateSensitivityStudyCapture({
    schemaVersion: SENSITIVITY_STUDY_CAPTURE_SCHEMA,
    operation: { id: "analyze.run-fea-sensitivity", version: "1" },
    trustedRunId: "run:id01-sensitivity",
    caseDigest: (await sha256Fingerprint(studyCase)).digest,
    studyCase,
    cad: {
      base: {
        executionRunId: "run:cad-base",
        sourceSha256: "1".repeat(64),
        stepSha256: "2".repeat(64),
        stepBytes: 4,
      },
      stepped: {
        executionRunId: "run:cad-stepped",
        sourceSha256: "3".repeat(64),
        stepSha256: "4".repeat(64),
        stepBytes: 4,
      },
    },
    measurements: { base, stepped },
    derivatives: computeSensitivities(
      studyCase,
      new Map(base.map((item) => [item.metric, item])),
      new Map(stepped.map((item) => [item.metric, item])),
    ),
    capturedAt: AT,
  });
  const fingerprint = await sha256Fingerprint(capture);
  return {
    admission: sensitivityStudyConsumerAdmission({
      operation,
      projectId: "inspection-drone-id01",
      basis: BASIS,
      artifactId: `sensitivity-study-${fingerprint.digest}`,
      artifactFingerprint: fingerprint,
      capture,
    }),
  };
}
