import { assertEquals } from "@std/assert";
import { ADMITTED_SPICE_RETRY_GENERATION_CLOSED } from "./completed-replay-verification.ts";
import {
  decideAdmittedSpiceAttemptResume,
  decideAdmittedSpiceTerminalJournalRecovery,
  isAdmittedSpiceTerminalJournalRecoveryEligible,
} from "./attempt-resume-policy.ts";

const RUN = "admitted-spice-run";

Deno.test("prepared transitions generation zero; rejected WAL never redispatches", () => {
  assertEquals(
    decideAdmittedSpiceAttemptResume({
      phase: "prepared",
      executionRunId: RUN,
    }),
    { action: "transition-g0" },
  );
  assertEquals(
    decideAdmittedSpiceAttemptResume({
      phase: "execution-rejected",
      executionRunId: RUN,
      producerGeneration: 0,
    }),
    { action: "already-rejected" },
  );
  assertEquals(
    decideAdmittedSpiceAttemptResume({
      phase: "retry-generation-closed",
      executionRunId: RUN,
      producerGeneration: 1,
    }),
    {
      action: "already-closed",
      message: ADMITTED_SPICE_RETRY_GENERATION_CLOSED.message,
    },
  );
  assertEquals(
    decideAdmittedSpiceAttemptResume({
      phase: "output-validation-rejected",
      executionRunId: RUN,
      producerGeneration: 0,
    }),
    { action: "already-output-validation-rejected" },
  );
});

Deno.test("one g0 cleanup plus one g1 advance is the only retry; generation two does not exist", () => {
  assertEquals(
    decideAdmittedSpiceAttemptResume({
      phase: "dispatching",
      executionRunId: RUN,
      producerGeneration: 0,
      resolution: { status: "not-published", runId: RUN, producerGeneration: 0 },
    }).action,
    "cleanup-g0",
  );
  assertEquals(
    decideAdmittedSpiceAttemptResume({
      phase: "generation-zero-cleaned",
      executionRunId: RUN,
      producerGeneration: 0,
    }),
    { action: "advance-g1" },
  );
  assertEquals(
    decideAdmittedSpiceAttemptResume({
      phase: "dispatching",
      executionRunId: RUN,
      producerGeneration: 1,
      resolution: { status: "not-published", runId: RUN, producerGeneration: 1 },
    }),
    {
      action: "close-g1",
      message: ADMITTED_SPICE_RETRY_GENERATION_CLOSED.message,
    },
  );
});

Deno.test("terminal journal recovery is only rejected, closed, or dispatching generation one", () => {
  assertEquals(
    isAdmittedSpiceTerminalJournalRecoveryEligible({
      runStatus: "running",
      phase: "dispatching",
      producerGeneration: 1,
    }),
    true,
  );
  assertEquals(
    isAdmittedSpiceTerminalJournalRecoveryEligible({
      runStatus: "failed",
      phase: "execution-rejected",
    }),
    true,
  );
  assertEquals(
    isAdmittedSpiceTerminalJournalRecoveryEligible({
      runStatus: "failed",
      phase: "output-validation-rejected",
    }),
    true,
  );
  assertEquals(
    isAdmittedSpiceTerminalJournalRecoveryEligible({
      runStatus: "failed",
      phase: "retry-generation-closed",
      producerGeneration: 1,
    }),
    true,
  );
  assertEquals(
    isAdmittedSpiceTerminalJournalRecoveryEligible({
      runStatus: "running",
      phase: "dispatching",
      producerGeneration: 0,
    }),
    false,
  );
  assertEquals(
    isAdmittedSpiceTerminalJournalRecoveryEligible({
      runStatus: "running",
      phase: "prepared",
    }),
    false,
  );
  assertEquals(
    isAdmittedSpiceTerminalJournalRecoveryEligible({
      runStatus: "running",
      phase: "generation-zero-cleaned",
      producerGeneration: 0,
    }),
    false,
  );
  assertEquals(
    isAdmittedSpiceTerminalJournalRecoveryEligible({
      runStatus: "running",
      phase: "output-published",
      producerGeneration: 1,
    }),
    false,
  );
  assertEquals(
    isAdmittedSpiceTerminalJournalRecoveryEligible({
      runStatus: "completed",
      phase: "retry-generation-closed",
      producerGeneration: 1,
    }),
    false,
  );
});

Deno.test("terminal journal recovery closes unpublished g1 and quarantines publication or ambiguity", () => {
  assertEquals(
    decideAdmittedSpiceTerminalJournalRecovery({
      phase: "dispatching",
      executionRunId: RUN,
      producerGeneration: 1,
      resolution: {
        status: "not-published",
        runId: RUN,
        producerGeneration: 1,
      },
    }),
    {
      action: "close-g1",
      message: ADMITTED_SPICE_RETRY_GENERATION_CLOSED.message,
    },
  );
  const published = decideAdmittedSpiceTerminalJournalRecovery({
    phase: "dispatching",
    executionRunId: RUN,
    producerGeneration: 1,
    resolution: {
      status: "published",
      runId: RUN,
      producerGeneration: 1,
      ref: {} as never,
      receipt: {} as never,
    },
  });
  assertEquals(published.action, "quarantine");
  const unknown = decideAdmittedSpiceTerminalJournalRecovery({
    phase: "dispatching",
    executionRunId: RUN,
    producerGeneration: 1,
    resolution: {
      status: "outcome-unknown",
      runId: RUN,
      producerGeneration: 1,
    },
  });
  assertEquals(unknown.action, "quarantine");
  const mismatched = decideAdmittedSpiceTerminalJournalRecovery({
    phase: "dispatching",
    executionRunId: RUN,
    producerGeneration: 1,
    resolution: {
      status: "not-published",
      runId: "other-run",
      producerGeneration: 1,
    },
  });
  assertEquals(mismatched.action, "quarantine");
  assertEquals(
    decideAdmittedSpiceTerminalJournalRecovery({
      phase: "dispatching",
      executionRunId: RUN,
      producerGeneration: 0,
      resolution: {
        status: "not-published",
        runId: RUN,
        producerGeneration: 0,
      },
    }).action,
    "not-eligible",
  );
  assertEquals(
    decideAdmittedSpiceTerminalJournalRecovery({
      phase: "prepared",
      executionRunId: RUN,
    }).action,
    "not-eligible",
  );
});

Deno.test("unknown started outcomes stay quarantined without redispatch", () => {
  const unknown = decideAdmittedSpiceAttemptResume({
    phase: "dispatching",
    executionRunId: RUN,
    producerGeneration: 0,
    resolution: { status: "outcome-unknown", runId: RUN, producerGeneration: 0 },
  });
  assertEquals(unknown.action, "quarantine");
  if (unknown.action === "quarantine") {
    assertEquals(unknown.message.includes("unknown"), true);
  }
});
