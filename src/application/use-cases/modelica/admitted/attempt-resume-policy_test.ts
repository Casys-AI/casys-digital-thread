import { assertEquals } from "@std/assert";
import type { IsolatedCodeExecutionReceiptRecord } from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  type AdmittedModelicaAttemptResumeAction,
  decideAdmittedModelicaAttemptResume,
} from "./attempt-resume-policy.ts";

const RUN = "admitted-modelica-run";
const REF = {
  runId: RUN,
  producerGeneration: 0 as const,
  fingerprint: { algorithm: "sha256" as const, digest: "a".repeat(64) },
  manifestUri: `casys://isolated-output-publication/${RUN}/0`,
};

function receipt(
  producerGeneration: 0 | 1 = 0,
): IsolatedCodeExecutionReceiptRecord {
  return {
    publication: {
      status: "atomic-batch-published",
      ref: { ...REF, producerGeneration, runId: RUN },
    },
  } as IsolatedCodeExecutionReceiptRecord;
}

function actionsOf(
  ...inputs: readonly Parameters<typeof decideAdmittedModelicaAttemptResume>[0][]
): AdmittedModelicaAttemptResumeAction["action"][] {
  return inputs.map((input) => decideAdmittedModelicaAttemptResume(input).action);
}

Deno.test("prepared transitions generation zero; dispatching without a resolution only reads publication", () => {
  assertEquals(
    decideAdmittedModelicaAttemptResume({
      phase: "prepared",
      executionRunId: RUN,
    }),
    { action: "transition-g0" },
  );
  assertEquals(
    decideAdmittedModelicaAttemptResume({
      phase: "dispatching",
      executionRunId: RUN,
      producerGeneration: 0,
    }),
    { action: "read-publication" },
  );
});

Deno.test("one g0 cleanup plus one g1 advance is the only retry; generation two does not exist", () => {
  assertEquals(
    decideAdmittedModelicaAttemptResume({
      phase: "dispatching",
      executionRunId: RUN,
      producerGeneration: 0,
      resolution: { status: "not-published", runId: RUN, producerGeneration: 0 },
    }).action,
    "cleanup-g0",
  );
  assertEquals(
    decideAdmittedModelicaAttemptResume({
      phase: "generation-zero-cleaned",
      executionRunId: RUN,
      producerGeneration: 0,
    }),
    { action: "advance-g1" },
  );
  const closed = decideAdmittedModelicaAttemptResume({
    phase: "dispatching",
    executionRunId: RUN,
    producerGeneration: 1,
    resolution: { status: "not-published", runId: RUN, producerGeneration: 1 },
  });
  assertEquals(closed.action, "close-g1");
  if (closed.action === "close-g1") {
    assertEquals(
      closed.message.includes("no third dispatch"),
      true,
    );
  }
  assertEquals(
    actionsOf(
      { phase: "prepared", executionRunId: RUN },
      {
        phase: "dispatching",
        executionRunId: RUN,
        producerGeneration: 0,
        resolution: {
          status: "not-published",
          runId: RUN,
          producerGeneration: 0,
        },
      },
      { phase: "generation-zero-cleaned", executionRunId: RUN },
      {
        phase: "dispatching",
        executionRunId: RUN,
        producerGeneration: 1,
        resolution: {
          status: "not-published",
          runId: RUN,
          producerGeneration: 1,
        },
      },
    ),
    ["transition-g0", "cleanup-g0", "advance-g1", "close-g1"],
  );
});

Deno.test("unknown isolated outcome quarantines and never cleans or advances", () => {
  const decision = decideAdmittedModelicaAttemptResume({
    phase: "dispatching",
    executionRunId: RUN,
    producerGeneration: 0,
    resolution: { status: "outcome-unknown", runId: RUN, producerGeneration: 0 },
  });
  assertEquals(decision.action, "quarantine");
  if (decision.action === "quarantine") {
    assertEquals(decision.message.includes("outcome remains unknown"), true);
  }
});

Deno.test("published resolution is adopted when the receipt reference is exact", () => {
  const published = receipt(0);
  const decision = decideAdmittedModelicaAttemptResume({
    phase: "dispatching",
    executionRunId: RUN,
    producerGeneration: 0,
    resolution: {
      status: "published",
      runId: RUN,
      producerGeneration: 0,
      ref: published.publication.ref,
      receipt: published,
    },
  });
  assertEquals(decision.action, "adopt-publication");
  if (decision.action === "adopt-publication") {
    assertEquals(decision.receipt, published);
  }
});

Deno.test("divergent publication reference and foreign generation quarantine", () => {
  const published = receipt(0);
  const drifted = decideAdmittedModelicaAttemptResume({
    phase: "dispatching",
    executionRunId: RUN,
    producerGeneration: 0,
    resolution: {
      status: "published",
      runId: RUN,
      producerGeneration: 0,
      ref: {
        ...published.publication.ref,
        fingerprint: { algorithm: "sha256", digest: "6".repeat(64) },
      },
      receipt: published,
    },
  });
  assertEquals(drifted.action, "quarantine");
  if (drifted.action === "quarantine") {
    assertEquals(drifted.message.includes("reference differs"), true);
  }
  const foreign = decideAdmittedModelicaAttemptResume({
    phase: "dispatching",
    executionRunId: RUN,
    producerGeneration: 0,
    resolution: { status: "not-published", runId: RUN, producerGeneration: 1 },
  });
  assertEquals(foreign.action, "quarantine");
  if (foreign.action === "quarantine") {
    assertEquals(foreign.message.includes("another producer generation"), true);
  }
});

Deno.test("completed journal on an active run quarantines; output-published is already done", () => {
  const completed = decideAdmittedModelicaAttemptResume({
    phase: "completed",
    executionRunId: RUN,
  });
  assertEquals(completed.action, "quarantine");
  if (completed.action === "quarantine") {
    assertEquals(completed.message.includes("already completed"), true);
  }
  assertEquals(
    decideAdmittedModelicaAttemptResume({
      phase: "output-published",
      executionRunId: RUN,
      producerGeneration: 0,
    }),
    { action: "already-published" },
  );
  assertEquals(
    decideAdmittedModelicaAttemptResume({
      phase: "output-validation-rejected",
      executionRunId: RUN,
      producerGeneration: 0,
    }),
    { action: "already-output-validation-rejected" },
  );
});

Deno.test("resume policy never names a runner, store, or generation two", async () => {
  const source = await Deno.readTextFile(
    new URL("./attempt-resume-policy.ts", import.meta.url),
  );
  assertEquals(source.includes("IsolatedCodeRunner"), false);
  assertEquals(source.includes("markDispatching"), false);
  assertEquals(source.includes("generation 2"), false);
  assertEquals(source.includes("producerGeneration: 2"), false);
});
