import { assertEquals } from "@std/assert";
import { recrossBuyCandidateSealAuthority } from "./buy-candidate-seal-authority.ts";
import { buyConfigurationFixture } from "./buy-fixtures.ts";
import { BUY_CAPTURE_CONFIGURATION_COST_OPERATION } from "./buy-operations.ts";

const SUBJECT_ID = "project:reviewed-project-v1";
const CAPTURE_BASIS = {
  snapshotId: "snapshot.buy.r1",
  revision: 1,
  subjectId: SUBJECT_ID,
};
const SEAL_BASIS = {
  snapshotId: "snapshot.buy.r2",
  revision: 2,
  subjectId: SUBJECT_ID,
};

Deno.test(
  "exact capture→seal successor keeps the immutable configuration basis",
  () => {
    const result = recrossBuyCandidateSealAuthority({
      projectId: "reviewed-project-v1",
      sealBasis: SEAL_BASIS,
      configuration: buyConfigurationFixture(),
      trustedRunId: "run.buy-capture",
      producerRunId: "run.buy-capture",
      captureRun: captureRun(),
    });
    assertEquals(result.status, "current");
    assertEquals(buyConfigurationFixture().basis, CAPTURE_BASIS);
    assertEquals(CAPTURE_BASIS.revision + 1, SEAL_BASIS.revision);
  },
);

Deno.test("foreign project candidate authority is refused", () => {
  const result = recrossBuyCandidateSealAuthority({
    projectId: "other-project-v1",
    sealBasis: SEAL_BASIS,
    configuration: buyConfigurationFixture(),
    trustedRunId: "run.buy-capture",
    producerRunId: "run.buy-capture",
    captureRun: captureRun(),
  });
  assertEquals(result.status, "refused");
  if (result.status !== "refused") return;
  assertEquals(result.reason.includes("projectId"), true);
});

Deno.test("foreign subject candidate authority is refused", () => {
  const result = recrossBuyCandidateSealAuthority({
    projectId: "reviewed-project-v1",
    sealBasis: { ...SEAL_BASIS, subjectId: "project:foreign-subject" },
    configuration: buyConfigurationFixture(),
    trustedRunId: "run.buy-capture",
    producerRunId: "run.buy-capture",
    captureRun: captureRun(),
  });
  assertEquals(result.status, "refused");
  if (result.status !== "refused") return;
  assertEquals(result.reason.includes("subject"), true);
});

Deno.test("stale capture result is refused for a later seal basis", () => {
  const result = recrossBuyCandidateSealAuthority({
    projectId: "reviewed-project-v1",
    sealBasis: {
      snapshotId: "snapshot.buy.r3",
      revision: 3,
      subjectId: SUBJECT_ID,
    },
    configuration: buyConfigurationFixture(),
    trustedRunId: "run.buy-capture",
    producerRunId: "run.buy-capture",
    captureRun: captureRun(),
  });
  assertEquals(result.status, "refused");
  if (result.status !== "refused") return;
  assertEquals(result.reason.includes("capture run"), true);
});

Deno.test("missing or forged capture producer run is refused", () => {
  const missing = recrossBuyCandidateSealAuthority({
    projectId: "reviewed-project-v1",
    sealBasis: SEAL_BASIS,
    configuration: buyConfigurationFixture(),
    trustedRunId: "run.buy-capture",
    producerRunId: "run.buy-capture",
  });
  assertEquals(missing.status, "refused");

  const mismatchedProducer = recrossBuyCandidateSealAuthority({
    projectId: "reviewed-project-v1",
    sealBasis: SEAL_BASIS,
    configuration: buyConfigurationFixture(),
    trustedRunId: "run.buy-capture",
    producerRunId: "run.forged",
    captureRun: captureRun(),
  });
  assertEquals(mismatchedProducer.status, "refused");
});

function captureRun() {
  return {
    id: "run.buy-capture",
    status: "completed",
    operationId: BUY_CAPTURE_CONFIGURATION_COST_OPERATION.id,
    operationVersion: BUY_CAPTURE_CONFIGURATION_COST_OPERATION.version,
    basis: CAPTURE_BASIS,
    resultSnapshot: SEAL_BASIS,
  };
}

Deno.test("capture authority rejects another or missing operation version", () => {
  for (const operationVersion of ["", "2"]) {
    const result = recrossBuyCandidateSealAuthority({
      projectId: "reviewed-project-v1",
      sealBasis: SEAL_BASIS,
      configuration: buyConfigurationFixture(),
      trustedRunId: "run.buy-capture",
      producerRunId: "run.buy-capture",
      captureRun: { ...captureRun(), operationVersion },
    });
    assertEquals(result.status, "refused");
  }
});
