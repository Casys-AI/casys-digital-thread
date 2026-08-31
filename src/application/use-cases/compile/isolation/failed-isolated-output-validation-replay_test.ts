import { assertRejects } from "@std/assert";
import { sha256Fingerprint } from "../../../../domain/kernel/deterministic-json.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
} from "../../../../domain/project/engineering-project.ts";
import type { EngineeringProjectCommandOrigin } from "../../../ports/in/engineering-project-command-origin.ts";
import type {
  FailRunCommand,
  RunCommand,
} from "../../project/engineering-project-command-service.ts";
import {
  assertFailedIsolatedOutputValidationReplay,
  ISOLATED_OUTPUT_VALIDATION_FAILED_CODE,
  isolatedOutputValidationFailedMessage,
} from "./failed-isolated-output-validation-replay.ts";

const AT = "2026-08-26T00:00:00.000Z";
const ORIGIN: EngineeringProjectCommandOrigin = {
  kind: "agent",
  actorId: "agent:test",
};
const FAILURE = {
  summary: "Isolated output validation was rejected before Thread publication.",
  code: ISOLATED_OUTPUT_VALIDATION_FAILED_CODE,
  message: isolatedOutputValidationFailedMessage({
    role: "geometry",
    byteCount: 32,
    sha256: "7".repeat(64),
  }),
};

Deno.test("failed isolated output-validation replay accepts the exact evidence-free binding", async () => {
  const fixture = await replayFixture();
  await assertFailedIsolatedOutputValidationReplay(fixture.input);
});

Deno.test("failed isolated output-validation replay refuses a divergent fail code", async () => {
  const fixture = await replayFixture();
  fixture.run.failure = {
    code: "analyze-run-fea-sensitivity-terminal-error",
    message: FAILURE.message,
  };
  await assertRejects(
    () => assertFailedIsolatedOutputValidationReplay(fixture.input),
    Error,
    "evidence-free terminal failure",
  );
});

Deno.test("failed isolated output-validation replay refuses a divergent fail receipt", async () => {
  const fixture = await replayFixture();
  fixture.receipts[1] = {
    ...fixture.receipts[1]!,
    requestFingerprint: { algorithm: "sha256", digest: "0".repeat(64) },
  };
  await assertRejects(
    () => assertFailedIsolatedOutputValidationReplay(fixture.input),
    Error,
    "agent-run.fail receipt",
  );
});

Deno.test("failed isolated output-validation replay refuses Thread evidence", async () => {
  const fixture = await replayFixture();
  fixture.run.evidenceRefs = [{
    snapshotId: "snap",
    snapshotRevision: 1,
    kind: "artifact",
    id: "artifact",
  }];
  await assertRejects(
    () => assertFailedIsolatedOutputValidationReplay(fixture.input),
    Error,
    "evidence-free terminal failure",
  );
});

async function replayFixture() {
  const claimCommand: RunCommand = {
    commandId: "command:claim",
    projectId: "project",
    runId: "run",
    expectedRevision: 1,
    issuedAt: AT,
    summary: "Started the exact reviewed run.",
  };
  const failCommand: FailRunCommand = {
    ...claimCommand,
    commandId: "command:fail",
    expectedRevision: 2,
    summary: FAILURE.summary,
    code: FAILURE.code,
    message: FAILURE.message,
  };
  const claimReceipt = {
    commandId: claimCommand.commandId,
    type: "agent-run.claim" as const,
    actor: { id: ORIGIN.actorId, origin: ORIGIN.kind },
    issuedAt: AT,
    appliedAt: AT,
    requestFingerprint: await sha256Fingerprint({
      type: "agent-run.claim",
      origin: ORIGIN,
      command: claimCommand,
    }),
    resultingSnapshot: { snapshotId: "project:r2", revision: 2 },
  };
  const failReceipt = {
    commandId: failCommand.commandId,
    type: "agent-run.fail" as const,
    actor: { id: ORIGIN.actorId, origin: ORIGIN.kind },
    issuedAt: AT,
    appliedAt: AT,
    requestFingerprint: await sha256Fingerprint({
      type: "agent-run.fail",
      origin: ORIGIN,
      command: failCommand,
    }),
    resultingSnapshot: { snapshotId: "project:r3", revision: 3 },
  };
  const run: EngineeringAgentRun = {
    id: "run",
    workItemId: "work",
    status: "failed",
    summary: FAILURE.summary,
    queuedAt: AT,
    startedAt: AT,
    claimedAt: AT,
    completedAt: AT,
    claimedBy: { id: ORIGIN.actorId, origin: ORIGIN.kind },
    evidenceRefs: [],
    failure: { code: FAILURE.code, message: FAILURE.message },
    statusHistory: [
      {
        commandId: claimCommand.commandId,
        status: "running",
        at: AT,
        actor: { id: ORIGIN.actorId, origin: ORIGIN.kind },
        summary: claimCommand.summary,
      },
      {
        commandId: failCommand.commandId,
        status: "failed",
        at: AT,
        actor: { id: ORIGIN.actorId, origin: ORIGIN.kind },
        summary: failCommand.summary,
      },
    ],
  };
  const receipts = [claimReceipt, failReceipt];
  const project = {
    workItems: [{ id: "work", evidenceRefs: [] }],
    commandReceipts: receipts,
    agentRuns: [run],
  } as unknown as EngineeringProjectSnapshot;
  const mutableRun = run as EngineeringAgentRun & {
    evidenceRefs: EngineeringAgentRun["evidenceRefs"];
    failure?: EngineeringAgentRun["failure"];
  };
  return {
    run: mutableRun,
    receipts,
    project,
    input: {
      project,
      run,
      origin: ORIGIN,
      originalStartedAt: AT,
      failure: FAILURE,
      claimCommandId: claimCommand.commandId,
      failCommandId: failCommand.commandId,
      buildClaimCommand: () => claimCommand,
      buildFailCommand: () => failCommand,
    },
  };
}
