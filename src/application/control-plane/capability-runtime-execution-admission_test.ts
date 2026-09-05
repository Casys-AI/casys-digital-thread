import { assertEquals } from "@std/assert";
import {
  isDurableTerminalAgentRunStatus,
  settleCapabilityRuntimeSession,
} from "./capability-runtime-execution-admission.ts";
import type { CapabilityRuntimeExecutionSession } from "./capability-runtime-execution-session.ts";
import type { EngineeringAgentRun } from "../../domain/project/engineering-project.ts";

Deno.test("only completed, failed, and cancelled are durable terminal run statuses", () => {
  assertEquals(isDurableTerminalAgentRunStatus("completed"), true);
  assertEquals(isDurableTerminalAgentRunStatus("failed"), true);
  assertEquals(isDurableTerminalAgentRunStatus("cancelled"), true);
  assertEquals(isDurableTerminalAgentRunStatus("queued"), false);
  assertEquals(isDurableTerminalAgentRunStatus("running"), false);
  assertEquals(isDurableTerminalAgentRunStatus("publishing"), false);
});

Deno.test("settle releases only a proven terminal run and otherwise retains", async () => {
  const session = recording();
  await settleCapabilityRuntimeSession({
    session,
    policy: { kind: "release-if-terminal", run: run("running") },
  });
  assertEquals(session.releases, 0);
  assertEquals(session.retains, 1);

  const terminal = recording();
  await settleCapabilityRuntimeSession({
    session: terminal,
    policy: { kind: "release-if-terminal", run: run("failed") },
  });
  assertEquals(terminal.releases, 1);
  assertEquals(terminal.retains, 0);
});

function run(status: EngineeringAgentRun["status"]): EngineeringAgentRun {
  return { id: "run:test", status } as EngineeringAgentRun;
}

function recording(): CapabilityRuntimeExecutionSession & {
  releases: number;
  retains: number;
} {
  const state = { releases: 0, retains: 0 };
  return {
    lease: { id: "lease" } as CapabilityRuntimeExecutionSession["lease"],
    get releases() {
      return state.releases;
    },
    get retains() {
      return state.retains;
    },
    releaseTerminal: () => {
      state.releases++;
      return Promise.resolve();
    },
    retainForRecovery: () => {
      state.retains++;
    },
  };
}
