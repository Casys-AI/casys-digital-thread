import { assertEquals, assertRejects } from "@std/assert";
import type { EngineeringProjectCommandOrigin } from "../../../application/ports/in/engineering-project-command-origin.ts";
import type { CapabilityRuntimeExecutionEligibility } from "../../../application/ports/out/capability/capability-runtime-supervisor.ts";
import type { Build123dExecutionProfile } from "../../../application/ports/out/cad/isolated/build123d-execution-profile-catalog.ts";
import type { Build123dExecutionProfileCatalog } from "../../../application/ports/out/cad/isolated/build123d-execution-profile-catalog.ts";
import type { ResolvedCapabilityRuntimeOperation } from "../../../domain/capability/runtime/capability-runtime-supervision.ts";
import { GEOMETRY_EXECUTE_ADMITTED_SOURCE_CAPABILITY } from "../../../domain/capability/engineering-capability.ts";
import {
  type RecordingCapabilityRuntimeSession,
  recordingCapabilityRuntimeSession,
  testResolvedCapabilityRuntimeOperation,
} from "../../../testing/capability-runtime-execution-session-test-support.ts";
import {
  BUILD123D_ISOLATED_WORKER_MATERIAL_ID,
  BUILD123D_ISOLATED_WORKER_UNIT_ID,
} from "./worker-contract.ts";
import {
  type Build123dExecutionAttempt,
  type Build123dExecutionAttemptStore,
  fingerprintBuild123dExecutionAttemptIdentity,
} from "../../../application/ports/out/cad/isolated/build123d-execution-attempt-store.ts";
import type {
  Build123dExecutionCaptureStore,
  Build123dExecutionDraftStore,
} from "../../../application/ports/out/cad/isolated/build123d-execution-evidence-store.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import {
  IsolatedCodeOutputValidationRejectedError,
  type IsolatedCodeRunner,
  type IsolatedCodeRunRecovery,
  type IsolatedOutputPublicationReader,
} from "../../../application/ports/out/compile/isolation/isolated-code-runner.ts";
import type { TechnicalCompilationAdmissionReader } from "../../../application/ports/out/compile/admission/technical-compilation-admission-reader.ts";
import type {
  CompleteRunCommand,
  FailRunCommand,
  RunCommand,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  type Build123dExecutionDraftReference,
  createBuild123dExecutionCapture,
  createBuild123dExecutionDraft,
  deriveBuild123dExecutionRunId,
} from "../../../domain/cad/isolated/build123d-execution-evidence.ts";
import {
  BUILD123D_EXECUTION_PROFILE_SCHEMA,
} from "../../../application/ports/out/cad/isolated/build123d-execution-profile-catalog.ts";
import {
  BUILD123D_EXECUTION_OUTPUT,
  BUILD123D_EXECUTION_PROFILE,
  DESIGN_EXECUTE_BUILD123D_OPERATION,
  encodeBuild123dExecutionAdmissionParameters,
} from "../../../domain/cad/isolated/build123d-execution-proposal.ts";
import {
  MICROSANDBOX_LOCAL_ISOLATION_CLASS,
  MICROSANDBOX_LOCAL_RUNTIME_REF,
} from "../../../domain/compile/isolation/local-isolation-runtime.ts";
import {
  createIsolatedCodeExecutionReceipt,
  createIsolatedOutputProducerGenerationAdvance,
  createIsolatedOutputPublicationRef,
  fingerprintIsolatedOutputPublicationManifest,
  ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
  type IsolatedCodeExecutionReceipt,
  isolatedCodeExecutionReceiptRecord,
  type IsolatedCodeExecutionRequest,
  type IsolatedCodeOutputReceiptRecord,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  fingerprintSourceAnalysisBundle,
  type SourceAnalysisBundle,
} from "../../../domain/compile/source/source-analysis.ts";
import {
  compileTechnicalSources,
  fingerprintTechnicalCompilationBasis,
  fingerprintTechnicalSourceText,
  fingerprintTechnicalSysmlAnchor,
  TECHNICAL_COMPILATION_INPUT_SCHEMA,
  TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
} from "../../../domain/compile/admission/technical-compilation.ts";
import {
  COMPILE_SEAL_ADMISSION_OPERATION,
  TECHNICAL_COMPILATION_ADMISSION_SCHEMA,
} from "../../../domain/compile/admission/technical-compilation-proposal.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  EngineeringProjectCommandReceipt,
  EngineeringProjectSnapshot,
} from "../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import { sampleAdmissionSourceWorkspaceFields } from "../../../testing/technical-source-capture-test-support.ts";
import {
  DesignExecuteBuild123dRunExecutor,
  type DesignExecuteBuild123dRunExecutorDependencies,
} from "./design-execute-build123d-run-executor.ts";

const AT = "2026-08-13T10:00:00.000Z";
const AGENT = { kind: "agent" as const, actorId: "agent.executor" };
const COMMAND = {
  commandId: "execute.build123d",
  projectId: "project.box",
  expectedRevision: 1,
  issuedAt: AT,
  runId: "run.execute.box",
};

Deno.test("Build123d executor publishes one documentary artifact and never a STEP Thread artifact", async () => {
  const fixture = await createFixture();
  const completed = await fixture.executor.execute(AGENT, COMMAND);
  assertEquals(completed.agentRuns[0]!.status, "completed");
  assertEquals(fixture.runner.calls, 1);
  assertEquals(fixture.session.events, ["begin"]);
  assertEquals(fixture.session.releases, 1);
  assertEquals(fixture.session.retains, 0);
  assertEquals(fixture.session.microsandboxExecutionProfiles?.length, 1);
  assertEquals(
    fixture.session.microsandboxExecutionProfiles?.[0]?.material.unitId,
    BUILD123D_ISOLATED_WORKER_UNIT_ID,
  );
  assertEquals(
    fixture.session.microsandboxExecutionProfiles?.[0]?.material.materialId,
    BUILD123D_ISOLATED_WORKER_MATERIAL_ID,
  );
  assertEquals(
    fixture.session.microsandboxExecutionProfiles?.[0]?.executionProfileFingerprint,
    fixture.profile.profileFingerprint,
  );
  const result = completed.agentRuns[0]!.resultSnapshot!;
  const snapshot = await fixture.snapshots.getFresh(result.snapshotId);
  if (!snapshot) throw new Error("missing result snapshot");
  const added = snapshot.artifacts.filter((artifact) =>
    artifact.producer.runId === COMMAND.runId
  );
  assertEquals(added.length, 1);
  assertEquals(added[0]!.kind, "document");
  assertEquals(added[0]!.mediaType, "application/json");
  assertEquals(
    snapshot.artifacts.some((artifact) => artifact.mediaType === "model/step"),
    false,
  );
  assertEquals(
    snapshot.artifacts.some((artifact) => artifact.uri?.endsWith(".step")),
    false,
  );
  assertEquals(fixture.attempts.current?.phase, "completed");
});

Deno.test("completed Build123d replay reopens all evidence without a second isolated run or successor", async () => {
  const fixture = await createFixture();
  const first = await fixture.executor.execute(AGENT, COMMAND);
  const saved = fixture.snapshots.saveCalls;
  const second = await fixture.executor.execute(AGENT, COMMAND);
  assertEquals(second, first);
  assertEquals(fixture.runner.calls, 1);
  assertEquals(fixture.snapshots.saveCalls, saved);
  assertEquals(new Set(fixture.snapshots.successorIds).size, 1);
  assertEquals(fixture.session.events, ["begin", "releaseRecorded"]);
  assertEquals(fixture.session.releases, 1);
  assertEquals(fixture.session.recordedReleases, 1);
});

Deno.test("completed generation-one replay rejects WAL drift from its captured receipt and draft", async () => {
  const fixture = await createFixture({ resume: "not-published" });
  await fixture.executor.execute(AGENT, COMMAND);
  const current = fixture.attempts.current;
  if (current?.phase !== "completed") throw new Error("missing completed attempt");
  assertEquals(current.dispatch.producerGeneration, 1);
  const foreignFingerprint = await sha256Fingerprint({ foreignDraft: true });
  fixture.attempts.current = {
    ...current,
    draftReference: {
      schemaVersion: "build123d-execution-draft-reference/1.0",
      draftId: `build123d-execution-draft-${foreignFingerprint.digest}`,
      fingerprint: foreignFingerprint,
    },
  };
  await assertRejects(
    () => fixture.executor.execute(AGENT, COMMAND),
    Error,
    "no longer matches its exact captured receipt and non-canonical draft",
  );

  fixture.attempts.current = {
    ...current,
    receiptRecord: {
      ...current.receiptRecord,
      producerGeneration: 0,
      publication: {
        ...current.receiptRecord.publication,
        ref: {
          ...current.receiptRecord.publication.ref,
          producerGeneration: 0,
        },
      },
    },
  };
  await assertRejects(
    () => fixture.executor.execute(AGENT, COMMAND),
    Error,
    "no longer matches its exact captured receipt and non-canonical draft",
  );
  assertEquals(fixture.runner.calls, 1);
  assertEquals(fixture.runner.producerGenerations, [1]);
});

Deno.test("dispatching recovery adopts a published receipt and never reruns", async () => {
  const fixture = await createFixture({ resume: "published" });
  const completed = await fixture.executor.execute(AGENT, COMMAND);
  assertEquals(completed.agentRuns[0]!.status, "completed");
  assertEquals(fixture.runner.calls, 0);
  assertEquals(fixture.publications.resolveCalls, 1);
});

Deno.test("published dispatch replay completes cold when JIT cache or current capability is unavailable", async () => {
  const cacheUnavailable = await createFixture({
    resume: "published",
    beginFailure: new Error("exact Build123d Microsandbox cache is absent"),
  });
  const cacheRecovered = await cacheUnavailable.executor.execute(AGENT, COMMAND);
  assertEquals(cacheRecovered.agentRuns[0]!.status, "completed");
  assertEquals(cacheUnavailable.session.events, ["releaseRecorded"]);
  assertEquals(cacheUnavailable.runner.calls, 0);
  assertEquals(cacheUnavailable.publications.resolveCalls, 1);

  const capabilityUnavailable = await createFixture({
    resume: "published",
    omitCapabilityRuntime: true,
  });
  const capabilityRecovered = await capabilityUnavailable.executor.execute(
    AGENT,
    COMMAND,
  );
  assertEquals(capabilityRecovered.agentRuns[0]!.status, "completed");
  assertEquals(capabilityUnavailable.session.events, []);
  assertEquals(capabilityUnavailable.runner.calls, 0);
  assertEquals(capabilityUnavailable.publications.resolveCalls, 1);
});

Deno.test("cold published replay releases recorded runtime after a completion-WAL ACK loss", async () => {
  const fixture = await createFixture({
    resume: "published",
    walCompletionFailsOnce: true,
    beginFailure: new Error("exact Build123d Microsandbox cache is absent"),
  });
  const completed = await fixture.executor.execute(AGENT, COMMAND);
  assertEquals(completed.agentRuns[0]!.status, "completed");
  assertEquals(fixture.session.events, ["releaseRecorded"]);
  assertEquals(fixture.runner.calls, 0);
  assertEquals(fixture.attempts.completionCalls, 2);
});

Deno.test("unknown publication outcome leaves the run active and never reruns", async () => {
  const fixture = await createFixture({ resume: "outcome-unknown" });
  await assertRejects(
    () => fixture.executor.execute(AGENT, COMMAND),
    Error,
    "durable or uncertain effect",
  );
  assertEquals(fixture.runner.calls, 0);
  assertEquals(fixture.recovery.calls, 0);
  assertEquals(fixture.project.agentRuns[0]!.status, "running");
  assertEquals(fixture.session.events, []);
  assertEquals(fixture.session.releases, 0);
  assertEquals(fixture.session.retains, 0);
});

Deno.test("not-published recovery records cleanup before the single permitted redispatch", async () => {
  const fixture = await createFixture({ resume: "not-published" });
  const completed = await fixture.executor.execute(AGENT, COMMAND);
  assertEquals(completed.agentRuns[0]!.status, "completed");
  assertEquals(fixture.recovery.calls, 1);
  assertEquals(fixture.recovery.advanceCalls, 1);
  assertEquals(fixture.runner.calls, 1);
  assertEquals(fixture.runner.producerGenerations, [1]);
  assertEquals(fixture.attempts.redispatchAuthorizations, 1);
  assertEquals(fixture.attempts.current?.phase, "completed");
  assertEquals(
    fixture.attempts.current && "receiptRecord" in fixture.attempts.current
      ? fixture.attempts.current.receiptRecord.producerGeneration
      : undefined,
    1,
  );

  const replayed = await fixture.executor.execute(AGENT, COMMAND);
  assertEquals(replayed, completed);
  assertEquals(fixture.runner.calls, 1);
  assertEquals(fixture.runner.producerGenerations, [1]);
  assertEquals(fixture.recovery.advanceCalls, 1);
  assertEquals(fixture.attempts.redispatchAuthorizations, 1);
});

Deno.test("producer-generation advance ACK loss resumes exact generation one and never opens generation two", async () => {
  const fixture = await createFixture({
    resume: "not-published",
    generationAdvanceAckLostOnce: true,
  });
  await assertRejects(
    () => fixture.executor.execute(AGENT, COMMAND),
    Error,
    "durable or uncertain effect",
  );
  assertEquals(fixture.runner.calls, 0);
  assertEquals(fixture.recovery.advanceCalls, 1);
  assertEquals(
    fixture.attempts.current?.phase === "dispatching"
      ? fixture.attempts.current.dispatch.producerGeneration
      : undefined,
    0,
  );

  const completed = await fixture.executor.execute(AGENT, COMMAND);
  assertEquals(completed.agentRuns[0]!.status, "completed");
  assertEquals(fixture.recovery.advanceCalls, 2);
  assertEquals(fixture.attempts.redispatchAuthorizations, 1);
  assertEquals(fixture.runner.calls, 1);
  assertEquals(fixture.runner.producerGenerations, [1]);
  assertEquals(
    fixture.attempts.current && "receiptRecord" in fixture.attempts.current
      ? fixture.attempts.current.receiptRecord.producerGeneration
      : undefined,
    1,
  );
});

Deno.test("unattested cleanup never advances producer generation zero", async () => {
  const fixture = await createFixture({
    resume: "not-published",
    recoveryUnproven: true,
  });
  await assertRejects(
    () => fixture.executor.execute(AGENT, COMMAND),
    Error,
    "durable or uncertain effect",
  );
  assertEquals(fixture.recovery.calls, 1);
  assertEquals(fixture.recovery.advanceCalls, 0);
  assertEquals(fixture.runner.calls, 0);
  assertEquals(
    fixture.attempts.current?.phase === "dispatching"
      ? fixture.attempts.current.dispatch.producerGeneration
      : undefined,
    0,
  );
});

Deno.test("redispatch authorization ACK loss resumes through one durable consumption", async () => {
  const fixture = await createFixture({
    resume: "not-published",
    redispatchAuthorizationAckLostOnce: true,
  });
  await assertRejects(
    () => fixture.executor.execute(AGENT, COMMAND),
    Error,
    "durable or uncertain effect",
  );
  assertEquals(fixture.runner.calls, 0);
  assertEquals(fixture.attempts.current?.phase, "dispatching");
  const authorized = fixture.attempts.current;
  assertEquals(
    authorized?.phase === "dispatching" ? authorized.dispatch.dispatchCount : undefined,
    2,
  );

  const completed = await fixture.executor.execute(AGENT, COMMAND);
  assertEquals(completed.agentRuns[0]!.status, "completed");
  assertEquals(fixture.runner.calls, 1);
  assertEquals(fixture.recovery.calls, 1);
  assertEquals(fixture.attempts.redispatchAuthorizations, 1);
});

Deno.test("redispatch consumption ACK loss is fail-closed before runner on every retry", async () => {
  const fixture = await createFixture({
    resume: "not-published",
    redispatchConsumptionAckLostOnce: true,
  });
  await assertRejects(
    () => fixture.executor.execute(AGENT, COMMAND),
    Error,
    "durable or uncertain effect",
  );
  assertEquals(fixture.runner.calls, 0);

  await assertRejects(
    () => fixture.executor.execute(AGENT, COMMAND),
    Error,
    "durable or uncertain effect",
  );
  assertEquals(fixture.runner.calls, 0);
  assertEquals(fixture.attempts.redispatchConsumptions, 2);
  assertEquals(fixture.recovery.destroyedGenerations, [0, 1]);
  assertEquals(fixture.recovery.advanceCalls, 1);
  assertEquals(fixture.project.agentRuns[0]!.status, "running");
});

Deno.test("a crashed second dispatch is durably consumed and can never become a third call", async () => {
  const fixture = await createFixture({
    resume: "not-published",
    runnerFailsOnce: true,
  });
  await assertRejects(
    () => fixture.executor.execute(AGENT, COMMAND),
    Error,
    "durable or uncertain effect",
  );
  assertEquals(fixture.runner.calls, 1);
  assertEquals(fixture.runner.producerGenerations, [1]);
  assertEquals(fixture.recovery.advanceCalls, 1);

  await assertRejects(
    () => fixture.executor.execute(AGENT, COMMAND),
    Error,
    "durable or uncertain effect",
  );
  assertEquals(fixture.runner.calls, 1);
  assertEquals(fixture.runner.producerGenerations, [1]);
  assertEquals(fixture.recovery.advanceCalls, 1);
  assertEquals(fixture.recovery.destroyedGenerations, [0, 1]);

  await assertRejects(
    () => fixture.executor.execute(AGENT, COMMAND),
    Error,
    "durable or uncertain effect",
  );
  assertEquals(fixture.runner.calls, 1);
  assertEquals(fixture.runner.producerGenerations, [1]);
  assertEquals(fixture.recovery.advanceCalls, 1);
  assertEquals(fixture.recovery.destroyedGenerations, [0, 1, 1]);
  assertEquals(fixture.attempts.redispatchAuthorizations, 1);
  assertEquals(fixture.project.agentRuns[0]!.status, "running");
});

Deno.test("publication ACK loss replays the exact receipt without another isolated run or successor", async () => {
  const fixture = await createFixture({ publishAckLostOnce: true });
  await assertRejects(
    () => fixture.executor.execute(AGENT, COMMAND),
    Error,
    "durable or uncertain effect",
  );
  assertEquals(fixture.project.agentRuns[0]!.status, "publishing");
  assertEquals(fixture.runner.calls, 1);
  assertEquals(fixture.session.retains, 1);

  const completed = await fixture.executor.execute(AGENT, COMMAND);
  assertEquals(completed.agentRuns[0]!.status, "completed");
  assertEquals(fixture.runner.calls, 1);
  assertEquals(new Set(fixture.snapshots.successorIds).size, 1);
  assertEquals(fixture.commands.publishCalls, 2);
});

Deno.test("completed project repairs the thread-persisted WAL window after project completion", async () => {
  const fixture = await createFixture({ walCompletionFailsOnce: true });
  const completed = await fixture.executor.execute(AGENT, COMMAND);
  assertEquals(completed.agentRuns[0]!.status, "completed");
  assertEquals(fixture.runner.calls, 1);
  assertEquals(fixture.attempts.current?.phase, "completed");
  assertEquals(fixture.attempts.completionCalls, 2);
  assertEquals(new Set(fixture.snapshots.successorIds).size, 1);
});

Deno.test("human permission and profile drift stop before runner and WAL", async () => {
  const denied = await createFixture();
  await assertRejects(
    () =>
      denied.executor.execute(
        { kind: "human", actorId: "human.reviewer" },
        COMMAND,
      ),
    Error,
    "Only an authenticated agent",
  );
  assertEquals(denied.runner.calls, 0);
  assertEquals(denied.attempts.prepareCalls, 0);

  const drift = await createFixture({ profileDrift: true });
  await assertRejects(
    () => drift.executor.execute(AGENT, COMMAND),
    Error,
    "server-owned",
  );
  assertEquals(drift.runner.calls, 0);
  assertEquals(drift.attempts.prepareCalls, 0);
  assertEquals(drift.commands.claimCalls, 0);
  assertEquals(drift.session.events, []);
  assertEquals(drift.project.agentRuns[0]!.status, "queued");
});

Deno.test("Build123d executor fails the claimed run on output-validation rejection without Thread write", async () => {
  const fixture = await createFixture({ rejectOutputValidation: true });
  const beforeSnapshots = [...fixture.project.threadSnapshots];
  const failed = await fixture.executor.execute(AGENT, COMMAND);
  assertEquals(failed.agentRuns[0]?.status, "failed");
  assertEquals(failed.agentRuns[0]?.failure?.code, "isolated_output_validation_failed");
  assertEquals(failed.agentRuns[0]?.failure?.message.includes("geometry"), true);
  assertEquals(failed.agentRuns[0]?.failure?.message.includes("/tmp/"), false);
  assertEquals(failed.threadSnapshots, beforeSnapshots);
  assertEquals(fixture.attempts.current?.phase, "output-validation-rejected");
  assertEquals(fixture.runner.calls, 1);
  assertEquals(fixture.recovery.calls, 0);

  const replayed = await fixture.executor.execute(AGENT, COMMAND);
  assertEquals(replayed.agentRuns[0]?.status, "failed");
  assertEquals(fixture.runner.calls, 1);
  assertEquals(fixture.recovery.calls, 0);
  assertEquals(replayed.threadSnapshots, beforeSnapshots);
  assertEquals(fixture.session.events, ["begin", "releaseRecorded"]);
  assertEquals(fixture.session.releases, 1);
  assertEquals(fixture.session.recordedReleases, 1);
});

Deno.test("Build123d refuses a divergent fail code on output-validation replay without redispatch", async () => {
  const fixture = await createFixture({ rejectOutputValidation: true });
  await fixture.executor.execute(AGENT, COMMAND);
  const run = fixture.project.agentRuns[0] as MutableRun;
  run.failure = {
    code: "design-execute-build123d-not-dispatched",
    message: run.failure!.message,
  };
  await assertRejects(
    () => fixture.executor.execute(AGENT, COMMAND),
    Error,
    "evidence-free terminal failure",
  );
  assertEquals(fixture.runner.calls, 1);
  assertEquals(fixture.recovery.calls, 0);
});

Deno.test("Build123d refuses a divergent fail receipt on output-validation replay without redispatch", async () => {
  const fixture = await createFixture({ rejectOutputValidation: true });
  await fixture.executor.execute(AGENT, COMMAND);
  const receipts = fixture.project.commandReceipts;
  const index = receipts.findIndex((item) => item.type === "agent-run.fail");
  assertEquals(index >= 0, true);
  receipts[index] = {
    ...receipts[index]!,
    requestFingerprint: { algorithm: "sha256", digest: "0".repeat(64) },
  };
  await assertRejects(
    () => fixture.executor.execute(AGENT, COMMAND),
    Error,
    "agent-run.fail receipt",
  );
  assertEquals(fixture.runner.calls, 1);
  assertEquals(fixture.recovery.calls, 0);
});

Deno.test("Build123d exact H1 order is session begin, claim, attempt/WAL, then runner", async () => {
  const events: string[] = [];
  const fixture = await createFixture({
    onBegin: () => {
      events.push("begin");
    },
  });
  const originalClaim = fixture.commands.claimRun.bind(fixture.commands);
  fixture.commands.claimRun = (origin, command) => {
    events.push("claim");
    return originalClaim(origin, command);
  };
  const originalPrepare = fixture.attempts.prepare.bind(fixture.attempts);
  fixture.attempts.prepare = (input) => {
    events.push("attempt");
    return originalPrepare(input);
  };
  const originalDispatch = fixture.attempts.markDispatching.bind(
    fixture.attempts,
  );
  fixture.attempts.markDispatching = (input) => {
    events.push("dispatch");
    return originalDispatch(input);
  };
  const originalRun = fixture.runner.run.bind(fixture.runner);
  fixture.runner.run = (request) => {
    events.push("runner");
    return originalRun(request);
  };
  await fixture.executor.execute(AGENT, COMMAND);
  assertEquals(events[0], "begin");
  assertEquals(events.indexOf("begin") < events.indexOf("claim"), true);
  assertEquals(events.indexOf("claim") < events.indexOf("attempt"), true);
  assertEquals(events.indexOf("attempt") < events.indexOf("dispatch"), true);
  assertEquals(events.indexOf("dispatch") < events.indexOf("runner"), true);
  assertEquals(fixture.session.microsandboxExecutionProfiles?.length, 1);
});

Deno.test("missing extra or foreign Microsandbox lifecycle and digest drift stay cold", async () => {
  const cases: readonly {
    readonly label: string;
    readonly operationalCapability: (
      profile: Build123dExecutionProfile,
    ) => ResolvedCapabilityRuntimeOperation;
    readonly message: string;
  }[] = [
    {
      label: "missing",
      operationalCapability: (profile) =>
        testResolvedCapabilityRuntimeOperation({
          projectId: COMMAND.projectId,
          operation: DESIGN_EXECUTE_BUILD123D_OPERATION,
          capabilityId: GEOMETRY_EXECUTE_ADMITTED_SOURCE_CAPABILITY.id,
          unitId: BUILD123D_ISOLATED_WORKER_UNIT_ID,
          materialId: BUILD123D_ISOLATED_WORKER_MATERIAL_ID,
          imageDigest: profile.runtimeBackend.imageDigest.digest,
        }),
      message: "exactly one sealed Microsandbox",
    },
    {
      label: "foreign",
      operationalCapability: (profile) =>
        testResolvedCapabilityRuntimeOperation({
          projectId: COMMAND.projectId,
          operation: DESIGN_EXECUTE_BUILD123D_OPERATION,
          capabilityId: GEOMETRY_EXECUTE_ADMITTED_SOURCE_CAPABILITY.id,
          unitId: "casys.calculix-worker",
          materialId: "calculix-worker-image",
          imageDigest: profile.runtimeBackend.imageDigest.digest,
          hostLifecycleKind: "ephemeral-microsandbox",
        }),
      message: "exact code-owned",
    },
    {
      label: "digest",
      operationalCapability: () => build123dOperationalCapability("9".repeat(64)),
      message: "digest does not match",
    },
    {
      label: "extra",
      operationalCapability: (profile) => extraMicrosandboxCapability(profile),
      message: "exactly one sealed Microsandbox",
    },
  ];
  for (const testCase of cases) {
    const fixture = await createFixture({
      operationalCapability: testCase.operationalCapability,
    });
    await assertRejects(
      () => fixture.executor.execute(AGENT, COMMAND),
      Error,
      testCase.message,
    );
    assertEquals(fixture.session.events, [], testCase.label);
    assertEquals(fixture.commands.claimCalls, 0, testCase.label);
    assertEquals(fixture.attempts.prepareCalls, 0, testCase.label);
    assertEquals(fixture.runner.calls, 0, testCase.label);
    assertEquals(fixture.project.agentRuns[0]!.status, "queued", testCase.label);
  }
});

Deno.test("absent JIT session leaves the queued Build123d run untouched", async () => {
  const fixture = await createFixture({ omitCapabilityRuntime: true });
  await assertRejects(
    () => fixture.executor.execute(AGENT, COMMAND),
    Error,
    "configured JIT capability runtime session",
  );
  assertEquals(fixture.session.events, []);
  assertEquals(fixture.commands.claimCalls, 0);
  assertEquals(fixture.attempts.prepareCalls, 0);
  assertEquals(fixture.runner.calls, 0);
  assertEquals(fixture.project.agentRuns[0]!.status, "queued");
});

Deno.test("cache profile mismatch leaves the queued Build123d run untouched", async () => {
  const fixture = await createFixture({
    beginFailure: new Error(
      "Microsandbox cache execution profile does not attest casys.build123d-isolated-worker/build123d-isolated-worker-image.",
    ),
  });
  await assertRejects(
    () => fixture.executor.execute(AGENT, COMMAND),
    Error,
    "does not attest",
  );
  assertEquals(fixture.session.events, ["begin"]);
  assertEquals(fixture.commands.claimCalls, 0);
  assertEquals(fixture.attempts.prepareCalls, 0);
  assertEquals(fixture.runner.calls, 0);
  assertEquals(fixture.project.agentRuns[0]!.status, "queued");
});

interface FixtureOptions {
  readonly resume?: "published" | "not-published" | "outcome-unknown";
  readonly profileDrift?: boolean;
  readonly publishAckLostOnce?: boolean;
  readonly redispatchAuthorizationAckLostOnce?: boolean;
  readonly generationAdvanceAckLostOnce?: boolean;
  readonly recoveryUnproven?: boolean;
  readonly redispatchConsumptionAckLostOnce?: boolean;
  readonly walCompletionFailsOnce?: boolean;
  readonly runnerFailsOnce?: boolean;
  readonly rejectOutputValidation?: boolean;
  readonly omitCapabilityRuntime?: boolean;
  readonly operationalCapability?: (
    profile: Build123dExecutionProfile,
  ) => ResolvedCapabilityRuntimeOperation;
  readonly beginFailure?: Error;
  readonly onBegin?: () => void;
}

interface Fixture {
  readonly executor: DesignExecuteBuild123dRunExecutor;
  readonly project: MutableProject;
  readonly runner: FakeRunner;
  readonly recovery: FakeRecovery;
  readonly publications: FakePublications;
  readonly attempts: FakeAttempts;
  readonly snapshots: FakeSnapshots;
  readonly commands: FakeCommands;
  readonly session: RecordingCapabilityRuntimeSession;
  readonly profile: Build123dExecutionProfile;
  readonly capabilityRuntime: CapabilityRuntimeExecutionEligibility;
}

async function createFixture(options: FixtureOptions = {}): Promise<Fixture> {
  const sourceText = [
    "from build123d import Box",
    "thickness = 2",
    "result = Box(20, 10, thickness)",
    "",
  ].join("\n");
  const sourceFingerprint = await fingerprintTechnicalSourceText(sourceText);
  const sourceWorkspace = sampleAdmissionSourceWorkspaceFields("source.cad.box", {
    projectId: COMMAND.projectId,
  });
  const sourceId = `technical-unit:${sourceWorkspace.sourceClosure.fingerprint.digest}`;
  const effectiveUnit = {
    kind: "authored-root" as const,
    closureKind: "root-only" as const,
    unitId: sourceId,
    closureFingerprint: sourceWorkspace.sourceClosure.fingerprint,
    scriptFingerprint: sourceFingerprint,
  };
  const analysis: SourceAnalysisBundle = {
    schemaVersion: "source-analysis/1.0",
    source: {
      id: sourceId,
      role: "cad-script",
      language: "python",
      fingerprint: sourceFingerprint,
    },
    analyzer: { id: "build123d-qualified-lezer", version: "1.1.0" },
    policy: {
      profile: "build123d-closed-subset-v1",
      status: "passed",
      findings: [],
    },
    symbols: [
      { id: "artifact:box", kind: "artifact", name: "result" },
      {
        id: "parameter:thickness",
        kind: "parameter",
        name: "thickness",
        span: {
          start: { line: 2, column: 0 },
          end: { line: 2, column: 9 },
        },
      },
    ],
    dependencies: [{
      id: "dependency:thickness:result",
      kind: "structural-incidence",
      fromSymbolId: "parameter:thickness",
      toSymbolId: "artifact:box",
    }],
    unresolvedConstructs: [],
  };
  const analysisFingerprint = await fingerprintSourceAnalysisBundle(analysis);
  const sysmlFingerprint = await sha256Fingerprint({ sysml: "box" });
  const sysmlArtifact = {
    id: "artifact.sysml",
    name: "SysML model",
    kind: "sysml-model" as const,
    version: sysmlFingerprint.digest,
    fingerprint: sysmlFingerprint,
    uri: `casys://sysml/sha256/${sysmlFingerprint.digest}`,
    mediaType: "application/json",
    producer: { serverId: "syson", tool: "capture", runId: "run.syson" },
    inputArtifactIds: [],
    freshness: fresh(AT),
  };
  const reviewedBasis = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "snapshot.1",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: "subject.box",
      name: "Box",
      kind: "system",
      version: "1",
      modelArtifactId: sysmlArtifact.id,
    },
    freshness: fresh(AT),
    changeSet: {
      id: "changes.1",
      name: "SysML",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [{
        id: "change.sysml",
        kind: "created",
        target: { kind: "artifact", id: sysmlArtifact.id },
        summary: "Captured SysML.",
        afterFingerprint: sysmlFingerprint,
      }],
    },
    artifacts: [sysmlArtifact],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "provenance.sysml",
      relation: "changes",
      from: { kind: "change", id: "change.sysml" },
      to: { kind: "artifact", id: sysmlArtifact.id },
      rationale: "Created exact SysML.",
    }],
    proposedActions: [],
  });
  const sysmlProvenance = {
    artifactId: sysmlArtifact.id,
    artifactFingerprint: sysmlArtifact.fingerprint,
    captureId: "capture.syson",
  };
  const anchor = {
    artifactId: sysmlArtifact.id,
    artifactFingerprint: sysmlArtifact.fingerprint,
    captureId: "capture.syson",
    editingContextId: "editing-context.box",
    rootElementId: "sysml.package.box",
    rootElementKind: "Package" as const,
    elements: [{
      id: "sysml.package.box",
      kind: "Package",
      provenance: sysmlProvenance,
    }, {
      id: "sysml.part.box",
      kind: "PartUsage",
      provenance: sysmlProvenance,
    }, {
      id: "sysml.attribute.thickness",
      kind: "AttributeUsage",
      provenance: sysmlProvenance,
    }],
  };
  const compilationBasis = {
    thread: {
      projectId: COMMAND.projectId,
      subjectId: "subject.box",
      snapshotId: reviewedBasis.id,
      revision: reviewedBasis.revision,
      snapshotFingerprint: await sha256Fingerprint(reviewedBasis),
    },
    sysmlAnchor: anchor,
    sysmlAnchorFingerprint: await fingerprintTechnicalSysmlAnchor(anchor),
  };
  const compilationProfile = {
    id: "build123d-closed-subset-v1",
    version: "1.0.0",
    target: "build123d-source" as const,
    sourceRole: "cad-script" as const,
    language: "python" as const,
    analyzer: analysis.analyzer,
    analysisPolicyProfile: "build123d-closed-subset-v1",
    requiredBindingSymbolKinds: ["artifact", "parameter"] as const,
  };
  const compiled = await compileTechnicalSources({
    schemaVersion: TECHNICAL_COMPILATION_INPUT_SCHEMA,
    basis: compilationBasis,
    basisFingerprint: await fingerprintTechnicalCompilationBasis(compilationBasis),
    sources: [{
      sourceText,
      analysis,
      analysisFingerprint,
      effectiveUnit,
    }],
    bindings: [
      {
        id: "binding.result",
        sourceId: analysis.source.id,
        sourceSymbolId: analysis.symbols[0]!.id,
        sysmlElementId: "sysml.part.box",
        sysmlElementKind: "PartUsage",
        relation: "represents",
      },
      {
        id: "binding.thickness",
        sourceId: analysis.source.id,
        sourceSymbolId: "parameter:thickness",
        sysmlElementId: "sysml.attribute.thickness",
        sysmlElementKind: "AttributeUsage",
        relation: "parameterizes",
      },
    ],
    profileRequests: [{
      profileId: compilationProfile.id,
      profileVersion: compilationProfile.version,
      sourceIds: [analysis.source.id],
    }],
  }, {
    schemaVersion: TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
    profiles: [compilationProfile],
  });
  if (compiled.document.status !== "ready-for-review") {
    throw new Error("fixture compilation unresolved");
  }
  const projection = compiled.document.projections[0]!;
  const sealedAdmission = {
    schemaVersion: TECHNICAL_COMPILATION_ADMISSION_SCHEMA,
    draft: {
      draftId:
        `technical-compilation:${COMMAND.projectId}:${compiled.fingerprint.digest}`,
      projectId: COMMAND.projectId,
      documentFingerprint: compiled.fingerprint,
      envelopeFingerprint: await sha256Fingerprint({ draft: "box" }),
    },
    basis: {
      fingerprint: compiled.document.basisFingerprint,
      thread: {
        projectId: COMMAND.projectId,
        subjectId: "subject.box",
        snapshotId: reviewedBasis.id,
        revision: reviewedBasis.revision,
        fingerprint: await sha256Fingerprint(reviewedBasis),
      },
      sysml: {
        artifactId: anchor.artifactId,
        artifactFingerprint: anchor.artifactFingerprint,
        captureId: anchor.captureId,
        editingContextId: anchor.editingContextId,
        rootElementId: anchor.rootElementId,
        rootElementKind: anchor.rootElementKind,
        anchorFingerprint: compilationBasis.sysmlAnchorFingerprint,
      },
    },
    sources: [{
      id: analysis.source.id,
      role: "cad-script" as const,
      language: "python" as const,
      profileId: compilationProfile.id,
      profileVersion: compilationProfile.version,
      profileFingerprint: await sha256Fingerprint({
        id: compilationProfile.id,
        version: compilationProfile.version,
        role: "cad-script",
        language: "python",
        analyzer: compilationProfile.analyzer,
        maximumSourceBytes: 262_144,
      }),
      analyzer: analysis.analyzer,
      sourceFingerprint,
      captureFingerprint: await sha256Fingerprint({ capture: "source" }),
      analysisFingerprint,
      effectiveUnit,
      ...sourceWorkspace,
    }],
    bindings: compiled.document.inputManifest.bindings,
    compilationProfileRequests: [{
      profileId: compilationProfile.id,
      profileVersion: compilationProfile.version,
      target: "build123d-source" as const,
      sourceIds: [analysis.source.id],
      profileFingerprint: projection.profileFingerprint,
    }],
    compilation: {
      fingerprint: compiled.fingerprint,
      status: "ready-for-review" as const,
    },
  };
  const profileBody = {
    schemaVersion: BUILD123D_EXECUTION_PROFILE_SCHEMA,
    executionProfile: BUILD123D_EXECUTION_PROFILE,
    compilationTarget: "build123d-source" as const,
    compilationProfile: projection.profile,
    compilationProfileFingerprint: projection.profileFingerprint,
    isolationPolicy: {
      id: "isolation.build123d-v1",
      version: "1.0.0",
      fingerprint: await sha256Fingerprint({ policy: "deny-all" }),
    },
    runtimeBackend: {
      ...MICROSANDBOX_LOCAL_RUNTIME_REF,
      imageReference: `ghcr.io/casys-ai/build123d-runtime@sha256:${"5".repeat(64)}`,
      imageDigest: { algorithm: "sha256" as const, digest: "5".repeat(64) },
    },
    runtime: {
      isolationClass: MICROSANDBOX_LOCAL_ISOLATION_CLASS,
      imageDigest: { algorithm: "sha256" as const, digest: "5".repeat(64) },
      requestedLimits: {
        maxWallTimeMs: 30_000,
        maxCpuTimeMs: 20_000,
        maxMemoryBytes: 1_073_741_824,
        maxProcesses: 32,
        maxStdoutBytes: 65_536,
        maxStderrBytes: 65_536,
        maxOutputFileBytes: 33_554_432,
        maxOutputTotalBytes: 33_554_432,
      },
      limitAssurance: {
        maxWallTimeMs: "backend-attested" as const,
        maxCpuTimeMs: "unattested" as const,
        maxMemoryBytes: "backend-attested" as const,
        maxProcesses: "unattested" as const,
        maxStdoutBytes: "broker-observed-cap" as const,
        maxStderrBytes: "broker-observed-cap" as const,
        maxOutputFileBytes: "broker-observed-cap" as const,
        maxOutputTotalBytes: "broker-observed-cap" as const,
      },
    },
    outputManifest: [BUILD123D_EXECUTION_OUTPUT],
    outputValidator: { id: "occt-step-ap214", version: "1.0.0" },
    maximumSourceBytes: 262_144,
    minimumDestructionAssurance: "proven" as const,
  };
  const profile = {
    ...profileBody,
    profileFingerprint: await sha256Fingerprint(profileBody),
  };
  const admissionArtifactFingerprint = await sha256Fingerprint({
    capture: "technical-compilation-admission",
  });
  const admissionArtifact = {
    id: `technical-compilation-admission-${admissionArtifactFingerprint.digest}`,
    name: "Technical admission",
    kind: "document" as const,
    version: admissionArtifactFingerprint.digest,
    fingerprint: admissionArtifactFingerprint,
    uri:
      `casys://technical-compilation-admission-capture/sha256/${admissionArtifactFingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "compile.seal-admission@3",
      runId: "run.compile.seal",
    },
    inputArtifactIds: [sysmlArtifact.id],
    freshness: fresh(AT),
  };
  const executionBasis = validateThreadSnapshot({
    ...reviewedBasis,
    id: "snapshot.2",
    revision: 2,
    previous: { snapshotId: reviewedBasis.id, revision: reviewedBasis.revision },
    generatedAt: AT,
    changeSet: {
      id: "changes.8",
      name: "Admission",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [{
        id: "change.sysml",
        kind: "created",
        target: { kind: "artifact", id: sysmlArtifact.id },
        summary: "Captured SysML.",
        afterFingerprint: sysmlFingerprint,
      }, {
        id: "change.admission",
        kind: "created",
        target: { kind: "artifact", id: admissionArtifact.id },
        summary: "Sealed admission.",
        afterFingerprint: admissionArtifact.fingerprint,
      }],
    },
    artifacts: [...reviewedBasis.artifacts, admissionArtifact],
    consumptions: [{
      id: `consume-${sysmlArtifact.id}-by-${admissionArtifact.id}`,
      artifactId: sysmlArtifact.id,
      consumer: admissionArtifact.producer,
      observedFingerprint: sysmlArtifact.fingerprint,
      verifiedAt: AT,
      status: "verified",
    }],
    provenance: [...reviewedBasis.provenance, {
      id: "provenance.admission",
      relation: "changes",
      from: { kind: "change", id: "change.admission" },
      to: { kind: "artifact", id: admissionArtifact.id },
      rationale: "Created admission document.",
    }, {
      id: "derived.admission.sysml",
      relation: "derived_from",
      from: { kind: "artifact", id: admissionArtifact.id },
      to: { kind: "artifact", id: sysmlArtifact.id },
      rationale: "Admission derives from exact SysML.",
    }, {
      id: `uses-consume-${sysmlArtifact.id}-by-${admissionArtifact.id}`,
      relation: "uses",
      from: {
        kind: "consumption",
        id: `consume-${sysmlArtifact.id}-by-${admissionArtifact.id}`,
      },
      to: { kind: "artifact", id: sysmlArtifact.id },
      rationale: "Admission consumed exact SysML.",
    }],
  });
  const reviewUseCase = new (await import(
    "../../../application/use-cases/cad/isolated/prepare-project-build123d-execution-review.ts"
  )).PrepareProjectBuild123dExecutionReview({
    admissions: {
      read: () =>
        Promise.resolve({
          schemaVersion: "technical-compilation-admission-capture/4.0",
          operation: COMPILE_SEAL_ADMISSION_OPERATION,
          trustedRunId: "run.compile.seal",
          decisionId: "decision.compile.seal",
          sealedAt: AT,
          draftReference: {
            schemaVersion: "technical-compilation-draft-reference/1.0",
            draftId: sealedAdmission.draft.draftId,
            projectId: sealedAdmission.draft.projectId,
            documentFingerprint: sealedAdmission.draft.documentFingerprint,
            envelopeFingerprint: sealedAdmission.draft.envelopeFingerprint,
          },
          admission: sealedAdmission,
          document: compiled.document,
        }),
    },
    profiles: {
      initial: () => Promise.resolve(profile),
      resolve: () => Promise.resolve(profile),
    },
  });
  const review = await reviewUseCase.execute({
    projectId: COMMAND.projectId,
    basis: {
      kind: "thread-snapshot",
      snapshotId: executionBasis.id,
      revision: executionBasis.revision,
      subjectId: executionBasis.subject.id,
    },
    artifactId: admissionArtifact.id,
    artifactFingerprint: admissionArtifact.fingerprint,
  });
  const evidenceRef = {
    snapshotId: executionBasis.id,
    snapshotRevision: executionBasis.revision,
    kind: "artifact" as const,
    id: admissionArtifact.id,
  };
  const basisRef = {
    snapshotId: executionBasis.id,
    revision: executionBasis.revision,
    subjectId: executionBasis.subject.id,
  };
  const runBasis = { kind: "thread-snapshot" as const, ...basisRef };
  const operation = {
    ...DESIGN_EXECUTE_BUILD123D_OPERATION,
    bindings: [{
      name: "compilationAdmission",
      source: { kind: "thread-entity" as const, reference: evidenceRef },
    }],
  };
  const summary = "Execute exact reviewed Build123d source.";
  const decisionFingerprint = await sha256Fingerprint({
    baseSnapshot: basisRef,
    inputEvidenceRefs: [evidenceRef],
    proposal: { summary, parameters: review.decisionParameters },
  });
  const runFingerprint = await sha256Fingerprint({
    workItemId: "work.execute.box",
    basis: runBasis,
    operation,
    approvedDecisions: [{
      id: "decision.execute.box",
      inputFingerprint: decisionFingerprint,
    }],
  });
  const project = {
    schemaVersion: "4.0",
    id: "project.box:r1",
    revision: 1,
    generatedAt: AT,
    project: {
      id: COMMAND.projectId,
      name: "Box",
      subjectId: executionBasis.subject.id,
      objective: { title: "Box", statement: "Execute exact CAD." },
    },
    threadSnapshots: [basisRef],
    phases: [{
      id: "phase.execute",
      name: "Execute",
      order: 1,
      description: "Execute Build123d.",
      workItemIds: ["work.execute.box"],
      requiredDecisionIds: ["decision.execute.box"],
      evidenceRefs: [],
    }],
    workItems: [{
      id: "work.execute.box",
      activityId: "activity:work.execute.box",
      phaseId: "phase.execute",
      title: "Execute Build123d",
      description: "Execute reviewed source.",
      kind: "execution",
      operation,
      status: "in-progress",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: ["decision.execute.box"],
      blockerIds: [],
    }],
    agentRuns: [{
      id: COMMAND.runId,
      workItemId: "work.execute.box",
      status: options.resume ? "running" : "queued",
      summary: "Execute Build123d.",
      queuedAt: AT,
      ...(options.resume
        ? {
          startedAt: AT,
          claimedAt: AT,
          claimedBy: { id: AGENT.actorId, origin: AGENT.kind },
        }
        : {}),
      basis: runBasis,
      inputFingerprint: runFingerprint,
      evidenceRefs: [],
    }],
    decisions: [{
      id: "decision.execute.box",
      phaseId: "phase.execute",
      title: "Execute",
      question: "Execute exact source?",
      status: "approved",
      requestedAt: AT,
      baseSnapshot: basisRef,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [evidenceRef],
      approvalIds: ["approval.execute.box"],
      proposal: {
        summary,
        parameters: encodeBuild123dExecutionAdmissionParameters(review.admission),
        proposedAt: AT,
        proposedBy: { id: AGENT.actorId, origin: AGENT.kind },
      },
    }],
    approvals: [{
      id: "approval.execute.box",
      decisionId: "decision.execute.box",
      status: "approved",
      requestedAt: AT,
      decidedAt: AT,
      decidedBy: "human.reviewer",
      decidedByOrigin: "human",
      baseSnapshot: basisRef,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [evidenceRef],
    }],
    blockers: [],
    commandReceipts: [],
  } as unknown as MutableProject;
  const snapshots = new FakeSnapshots(reviewedBasis, executionBasis);
  const profiles: Build123dExecutionProfileCatalog = {
    initial: () => Promise.resolve(profile),
    resolve: () =>
      Promise.resolve(
        options.profileDrift
          ? {
            ...profile,
            outputValidator: { id: "foreign", version: "1.0.0" },
          }
          : profile,
      ),
  };
  const admissions: TechnicalCompilationAdmissionReader = {
    read: () =>
      Promise.resolve({
        schemaVersion: "technical-compilation-admission-capture/4.0",
        operation: COMPILE_SEAL_ADMISSION_OPERATION,
        trustedRunId: "run.compile.seal",
        decisionId: "decision.compile.seal",
        sealedAt: AT,
        draftReference: {
          schemaVersion: "technical-compilation-draft-reference/1.0",
          draftId: sealedAdmission.draft.draftId,
          projectId: sealedAdmission.draft.projectId,
          documentFingerprint: sealedAdmission.draft.documentFingerprint,
          envelopeFingerprint: sealedAdmission.draft.envelopeFingerprint,
        },
        admission: sealedAdmission,
        document: compiled.document,
      }),
  };
  const commands = new FakeCommands(project, {
    publishAckLostOnce: options.publishAckLostOnce,
  });
  const publications = new FakePublications();
  const runner = new FakeRunner(
    profile.runtime,
    (receipt) => publications.receipt = receipt,
    {
      failsOnce: options.runnerFailsOnce,
      rejectOutputValidation: options.rejectOutputValidation,
    },
  );
  const recovery = new FakeRecovery({
    generationAdvanceAckLostOnce: options.generationAdvanceAckLostOnce,
    recoveryUnproven: options.recoveryUnproven,
  });
  const attempts = new FakeAttempts({
    redispatchAuthorizationAckLostOnce: options.redispatchAuthorizationAckLostOnce,
    redispatchConsumptionAckLostOnce: options.redispatchConsumptionAckLostOnce,
    completionFailsOnce: options.walCompletionFailsOnce,
  });
  const drafts = new FakeDrafts();
  const captures = new FakeCaptures();
  if (options.resume) {
    const executionRunId = await deriveBuild123dExecutionRunId(
      COMMAND.projectId,
      COMMAND.runId,
    );
    const receipt = await runner.buildReceipt({
      schemaVersion: ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
      runId: executionRunId,
      producerGeneration: 0,
      profile: profile.executionProfile,
      source: {
        bytes: new TextEncoder().encode(sourceText),
        sha256: sourceFingerprint.digest,
      },
      policy: profile.isolationPolicy,
      outputs: profile.outputManifest,
    });
    const attemptIdentity = {
      projectId: COMMAND.projectId,
      agentRunId: COMMAND.runId,
      executionRunId,
      basis: {
        kind: "thread-snapshot" as const,
        snapshotId: executionBasis.id,
        revision: executionBasis.revision,
        subjectId: executionBasis.subject.id,
        fingerprint: await sha256Fingerprint(executionBasis),
      },
      run: {
        workItemId: project.agentRuns[0]!.workItemId,
        inputFingerprint: project.agentRuns[0]!.inputFingerprint!,
        startedAt: AT,
      },
      decision: {
        id: project.decisions[0]!.id,
        inputFingerprint: project.decisions[0]!.inputFingerprint!,
      },
      approval: {
        id: project.approvals[0]!.id,
        inputFingerprint: project.approvals[0]!.inputFingerprint!,
        fingerprint: await sha256Fingerprint(project.approvals[0]!),
      },
      admission: review.admission,
      technicalAdmission: {
        trustedRunId: "run.compile.seal",
        decisionId: "decision.compile.seal",
        sealedAt: AT,
        draftReference: {
          schemaVersion: "technical-compilation-draft-reference/1.0" as const,
          draftId: sealedAdmission.draft.draftId,
          projectId: sealedAdmission.draft.projectId,
          documentFingerprint: sealedAdmission.draft.documentFingerprint,
          envelopeFingerprint: sealedAdmission.draft.envelopeFingerprint,
        },
        documentFingerprint: review.admission.compilation.document.fingerprint,
        projectionFingerprint: review.admission.compilation.projection.fingerprint,
        sourceFingerprint,
      },
      executionProfile: profile,
      isolatedRequest: {
        schemaVersion: ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
        runId: executionRunId,
        producerGeneration: 0 as const,
        profile: profile.executionProfile,
        sourceSha256: sourceFingerprint.digest,
        policy: profile.isolationPolicy,
        outputs: profile.outputManifest,
      },
      document: review.admission.compilation.document,
      projection: review.admission.compilation.projection,
      source: review.admission.compilation.source,
      profile: review.admission.execution.profile,
      output: review.admission.execution.output,
    };
    attempts.current = {
      schemaVersion: "build123d-execution-attempt/1.0",
      projectId: COMMAND.projectId,
      agentRunId: COMMAND.runId,
      executionRunId,
      attemptFingerprint: await fingerprintBuild123dExecutionAttemptIdentity(
        attemptIdentity,
      ),
      identity: attemptIdentity,
      preparedAt: AT,
      phase: "dispatching",
      dispatch: {
        dispatchCount: 1,
        producerGeneration: 0,
        dispatchedAt: AT,
      },
    };
    publications.resolution = options.resume === "published"
      ? {
        status: "published",
        runId: executionRunId,
        producerGeneration: 0,
        ref: receipt.publication.ref,
        receipt: isolatedCodeExecutionReceiptRecord(receipt),
      }
      : {
        status: options.resume,
        runId: executionRunId,
        producerGeneration: 0,
      };
    publications.receipt = receipt;
  }
  const projects: EngineeringProjectRevisionStore = {
    get: () => Promise.resolve(project),
    getRevision: () => Promise.resolve(project),
    createInitial: () => Promise.reject(new Error("unused")),
    commit: () => Promise.reject(new Error("unused")),
  };
  const operationalCapability = options.operationalCapability?.(profile) ??
    build123dOperationalCapability(profile.runtimeBackend.imageDigest.digest);
  const capabilityRuntime: CapabilityRuntimeExecutionEligibility = {
    requireExecution: () => Promise.resolve(operationalCapability),
  };
  const session = recordingCapabilityRuntimeSession(
    options.onBegin || options.beginFailure
      ? async (input) => {
        options.onBegin?.();
        await input.recheck();
        if (options.beginFailure) throw options.beginFailure;
        return {
          lease: { id: "capability-jit-build123d" } as Awaited<
            ReturnType<RecordingCapabilityRuntimeSession["begin"]>
          >["lease"],
          releaseTerminal: () => Promise.resolve(),
          retainForRecovery: () => undefined,
        };
      }
      : undefined,
  );
  const dependencies: DesignExecuteBuild123dRunExecutorDependencies = {
    projects,
    commands,
    snapshots,
    admissions,
    profiles,
    runner,
    recovery,
    publications,
    attempts,
    drafts,
    captures,
    lease: { withLease: (_projectId, _scope, operation) => operation() },
    ...(options.omitCapabilityRuntime ? {} : {
      capabilityRuntime,
      capabilityRuntimeSession: session,
    }),
  };
  return {
    executor: new DesignExecuteBuild123dRunExecutor(dependencies),
    project,
    runner,
    recovery,
    publications,
    attempts,
    snapshots,
    commands,
    session,
    profile,
    capabilityRuntime,
  };
}

function build123dOperationalCapability(
  imageDigest: string,
): ResolvedCapabilityRuntimeOperation {
  return testResolvedCapabilityRuntimeOperation({
    projectId: COMMAND.projectId,
    operation: DESIGN_EXECUTE_BUILD123D_OPERATION,
    capabilityId: GEOMETRY_EXECUTE_ADMITTED_SOURCE_CAPABILITY.id,
    binding: { id: "build123d-execute-admitted-source", version: "1" },
    unitId: BUILD123D_ISOLATED_WORKER_UNIT_ID,
    materialId: BUILD123D_ISOLATED_WORKER_MATERIAL_ID,
    imageDigest,
    hostLifecycleKind: "ephemeral-microsandbox",
  });
}

function extraMicrosandboxCapability(
  profile: Build123dExecutionProfile,
): ResolvedCapabilityRuntimeOperation {
  const exact = build123dOperationalCapability(
    profile.runtimeBackend.imageDigest.digest,
  );
  const extraMaterial = {
    unitId: "casys.calculix-worker",
    materialId: "calculix-worker-image",
    imageDigest: profile.runtimeBackend.imageDigest.digest,
  };
  const binding = exact.bindings[0]!;
  return {
    ...exact,
    bindings: [{
      ...binding,
      materials: [...binding.materials, extraMaterial],
      runtimeModes: [...binding.runtimeModes, {
        material: extraMaterial,
        targetPlatform: "linux/arm64",
        mode: "native",
        qualificationAttestationFingerprint: null,
      }],
      hostLifecycles: [...binding.hostLifecycles, {
        material: extraMaterial,
        kind: "ephemeral-microsandbox",
        launchGroup: null,
      }],
    }],
  };
}

class FakeRunner implements IsolatedCodeRunner {
  calls = 0;
  readonly producerGenerations: Array<0 | 1> = [];
  #failsOnce: boolean;
  constructor(
    private readonly runtime: Parameters<
      typeof createIsolatedCodeExecutionReceipt
    >[0]["runtime"],
    private readonly onReceipt: (receipt: IsolatedCodeExecutionReceipt) => void =
      () => {},
    options: {
      readonly failsOnce?: boolean;
      readonly rejectOutputValidation?: boolean;
    } = {},
  ) {
    this.#failsOnce = options.failsOnce ?? false;
    this.#rejectOutputValidation = options.rejectOutputValidation ?? false;
  }
  #rejectOutputValidation: boolean;
  async run(
    request: IsolatedCodeExecutionRequest,
  ): Promise<IsolatedCodeExecutionReceipt> {
    this.calls += 1;
    this.producerGenerations.push(request.producerGeneration);
    if (this.#rejectOutputValidation) {
      throw new IsolatedCodeOutputValidationRejectedError(
        { role: "geometry", byteCount: 32, sha256: "7".repeat(64) },
        {
          status: "proven",
          runId: request.runId,
          proofFingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
        },
      );
    }
    if (this.#failsOnce) {
      this.#failsOnce = false;
      throw new Error("runner crashed after accepting the second dispatch");
    }
    const receipt = await this.buildReceipt(request);
    this.onReceipt(receipt);
    return receipt;
  }
  async buildReceipt(
    request: IsolatedCodeExecutionRequest,
  ): Promise<IsolatedCodeExecutionReceipt> {
    const step = new TextEncoder().encode("ISO-10303-21;\nEND-ISO-10303-21;\n");
    const digest = await crypto.subtle.digest("SHA-256", step);
    const sha = [...new Uint8Array(digest)].map((byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
    const output = {
      ...BUILD123D_EXECUTION_OUTPUT,
      byteCount: step.byteLength,
      sha256: sha,
      casUri: `casys://isolated-output/sha256/${sha}`,
      validation: "accepted" as const,
      persistence: "staged-reread-atomic-commit" as const,
    };
    const publication = await createIsolatedOutputPublicationRef(
      request.runId,
      request.producerGeneration,
      await fingerprintIsolatedOutputPublicationManifest(
        request.runId,
        request.producerGeneration,
        [{
          role: output.role,
          basename: output.basename,
          mediaType: output.mediaType,
          format: output.format,
          byteCount: output.byteCount,
          sha256: output.sha256,
          casUri: output.casUri,
        }],
      ),
    );
    return await createIsolatedCodeExecutionReceipt({
      request: await (await import(
        "../../../domain/compile/isolation/isolated-code-execution.ts"
      ))
        .validateIsolatedCodeExecutionRequest(request),
      runtime: this.runtime,
      termination: { kind: "exited", exitCode: 0, signal: null },
      logs: {
        stdout: { bytes: new Uint8Array(), truncated: false },
        stderr: { bytes: new Uint8Array(), truncated: false },
      },
      outputs: [{
        ...output,
        bytes: step,
      }],
      destruction: {
        status: "proven",
        runId: request.runId,
        proofFingerprint: await sha256Fingerprint({
          destroyed: request.runId,
        }),
      },
      publication,
    });
  }
}

class FakeRecovery implements IsolatedCodeRunRecovery {
  calls = 0;
  advanceCalls = 0;
  readonly destroyedGenerations: Array<0 | 1> = [];
  #generationAdvanceAckLostOnce: boolean;
  #recoveryUnproven: boolean;
  constructor(options: {
    readonly generationAdvanceAckLostOnce?: boolean;
    readonly recoveryUnproven?: boolean;
  } = {}) {
    this.#generationAdvanceAckLostOnce = options.generationAdvanceAckLostOnce ?? false;
    this.#recoveryUnproven = options.recoveryUnproven ?? false;
  }
  async destroyByRunId(runId: string, producerGeneration: 0 | 1) {
    this.calls += 1;
    this.destroyedGenerations.push(producerGeneration);
    if (this.#recoveryUnproven) {
      return {
        status: "acknowledged-unattested" as const,
        runId,
        acknowledgementFingerprint: await sha256Fingerprint({
          recovery: runId,
          producerGeneration,
        }),
      };
    }
    return {
      status: "proven" as const,
      runId,
      proofFingerprint: await sha256Fingerprint({
        recovery: runId,
        producerGeneration,
      }),
    };
  }
  async advanceProducerGeneration(
    input: Parameters<IsolatedCodeRunRecovery["advanceProducerGeneration"]>[0],
  ) {
    this.advanceCalls += 1;
    const proof = await createIsolatedOutputProducerGenerationAdvance(input);
    if (this.#generationAdvanceAckLostOnce) {
      this.#generationAdvanceAckLostOnce = false;
      throw new Error("producer generation advance ACK lost after durable commit");
    }
    return proof;
  }
}

class FakePublications implements IsolatedOutputPublicationReader {
  resolveCalls = 0;
  resolution: Awaited<
    ReturnType<IsolatedOutputPublicationReader["resolvePublicationByRunId"]>
  > = {
    status: "not-published",
    runId: "unset",
    producerGeneration: 0,
  };
  receipt?: IsolatedCodeExecutionReceipt;
  resolvePublicationByRunId(runId: string, producerGeneration: 0 | 1) {
    this.resolveCalls += 1;
    if (this.resolution.status === "published") {
      return Promise.resolve(this.resolution);
    }
    return Promise.resolve({
      ...this.resolution,
      runId,
      producerGeneration,
    });
  }
  readReceipt() {
    return Promise.resolve(this.receipt);
  }
  readPublishedObject(_ref: unknown, member: IsolatedCodeOutputReceiptRecord) {
    const bytes = this.receipt?.outputs.find((output) => output.role === member.role)
      ?.bytes.copy();
    return Promise.resolve(bytes);
  }
}

class FakeAttempts implements Build123dExecutionAttemptStore {
  current?: Build123dExecutionAttempt;
  prepareCalls = 0;
  redispatchAuthorizations = 0;
  redispatchConsumptions = 0;
  completionCalls = 0;
  #redispatchAuthorizationAckLostOnce: boolean;
  #redispatchConsumptionAckLostOnce: boolean;
  #completionFailsOnce: boolean;
  constructor(options: {
    readonly redispatchAuthorizationAckLostOnce?: boolean;
    readonly redispatchConsumptionAckLostOnce?: boolean;
    readonly completionFailsOnce?: boolean;
  } = {}) {
    this.#redispatchAuthorizationAckLostOnce =
      options.redispatchAuthorizationAckLostOnce ?? false;
    this.#redispatchConsumptionAckLostOnce = options.redispatchConsumptionAckLostOnce ??
      false;
    this.#completionFailsOnce = options.completionFailsOnce ?? false;
  }
  read() {
    return Promise.resolve(this.current && structuredClone(this.current));
  }
  prepare(input: Parameters<Build123dExecutionAttemptStore["prepare"]>[0]) {
    this.prepareCalls += 1;
    return fingerprintBuild123dExecutionAttemptIdentity(input).then(
      (attemptFingerprint) => {
        this.current = {
          schemaVersion: "build123d-execution-attempt/1.0",
          projectId: input.projectId,
          agentRunId: input.agentRunId,
          executionRunId: input.executionRunId,
          attemptFingerprint,
          identity: input,
          preparedAt: input.run.startedAt,
          phase: "prepared",
        };
        return this.current;
      },
    );
  }
  markDispatching(
    input: Parameters<Build123dExecutionAttemptStore["markDispatching"]>[0],
  ) {
    this.current = {
      ...this.current!,
      phase: "dispatching",
      dispatch: {
        dispatchCount: 1,
        producerGeneration: 0,
        dispatchedAt: input.dispatchedAt,
      },
    };
    return Promise.resolve(this.current);
  }
  authorizeRedispatch(
    input: Parameters<
      NonNullable<Build123dExecutionAttemptStore["authorizeRedispatch"]>
    >[0],
  ) {
    this.redispatchAuthorizations += 1;
    if (this.current!.phase !== "dispatching") throw new Error("not dispatching");
    this.current = {
      ...this.current!,
      phase: "dispatching",
      dispatch: {
        dispatchCount: 2,
        producerGeneration: 1,
        dispatchedAt: this.current!.dispatch.dispatchedAt,
        redispatch: {
          status: "authorized",
          previousProducerGeneration: 0,
          generationAdvance: input.generationAdvance,
          recoveryDestruction: input.recoveryDestruction,
        },
      },
    };
    if (this.#redispatchAuthorizationAckLostOnce) {
      this.#redispatchAuthorizationAckLostOnce = false;
      return Promise.reject(
        new Error("redispatch authorization ACK lost after durable commit"),
      );
    }
    return Promise.resolve(this.current);
  }
  consumeRedispatch(
    _input: Parameters<Build123dExecutionAttemptStore["consumeRedispatch"]>[0],
  ) {
    this.redispatchConsumptions += 1;
    if (
      this.current!.phase !== "dispatching" ||
      this.current!.dispatch.dispatchCount !== 2
    ) throw new Error("not authorized");
    if (this.current!.dispatch.redispatch.status === "consumed") {
      return Promise.resolve({
        outcome: "already-consumed" as const,
        attempt: this.current!,
      });
    }
    this.current = {
      ...this.current!,
      phase: "dispatching",
      dispatch: {
        ...this.current!.dispatch,
        redispatch: {
          ...this.current!.dispatch.redispatch,
          status: "consumed",
        },
      },
    };
    if (this.#redispatchConsumptionAckLostOnce) {
      this.#redispatchConsumptionAckLostOnce = false;
      return Promise.reject(
        new Error("redispatch consumption ACK lost after durable commit"),
      );
    }
    return Promise.resolve({
      outcome: "consumed-now" as const,
      attempt: this.current,
    });
  }
  markOutputPublished(
    input: Parameters<Build123dExecutionAttemptStore["markOutputPublished"]>[0],
  ) {
    if (this.current!.phase !== "dispatching") {
      if (
        "receiptRecord" in this.current! &&
        deterministicJson(this.current!.receiptRecord) ===
          deterministicJson(input.receiptRecord)
      ) return Promise.resolve(this.current!);
      throw new Error("not dispatching");
    }
    this.current = {
      ...this.current!,
      phase: "output-published",
      receiptRecord: input.receiptRecord,
    };
    return Promise.resolve(this.current);
  }
  markDraftPersisted(
    input: Parameters<Build123dExecutionAttemptStore["markDraftPersisted"]>[0],
  ) {
    if (this.current!.phase !== "output-published") {
      if (
        "draftReference" in this.current! &&
        deterministicJson(this.current!.draftReference) ===
          deterministicJson(input.draftReference)
      ) return Promise.resolve(this.current!);
      throw new Error("not output");
    }
    this.current = {
      ...this.current!,
      phase: "draft-persisted",
      draftReference: input.draftReference,
    };
    return Promise.resolve(this.current);
  }
  markThreadPersisted(
    input: Parameters<Build123dExecutionAttemptStore["markThreadPersisted"]>[0],
  ) {
    if (this.current!.phase !== "draft-persisted") {
      if (
        "threadEvidence" in this.current! &&
        deterministicJson(this.current!.threadEvidence) ===
          deterministicJson(input.threadEvidence)
      ) return Promise.resolve(this.current!);
      throw new Error("not draft");
    }
    this.current = {
      ...this.current!,
      phase: "thread-persisted",
      threadEvidence: input.threadEvidence,
    };
    return Promise.resolve(this.current);
  }
  markCompleted(
    _input: Parameters<Build123dExecutionAttemptStore["markCompleted"]>[0],
  ) {
    this.completionCalls += 1;
    if (this.current!.phase === "completed") return Promise.resolve(this.current!);
    if (this.current!.phase !== "thread-persisted") throw new Error("not thread");
    if (this.#completionFailsOnce) {
      this.#completionFailsOnce = false;
      return Promise.reject(new Error("WAL completion failed before commit"));
    }
    this.current = { ...this.current!, phase: "completed" };
    return Promise.resolve(this.current);
  }
  markOutputValidationRejected(
    input: Parameters<
      Build123dExecutionAttemptStore["markOutputValidationRejected"]
    >[0],
  ) {
    if (this.current!.phase === "output-validation-rejected") {
      return Promise.resolve(this.current!);
    }
    if (this.current!.phase !== "dispatching") throw new Error("not dispatching");
    this.current = {
      ...this.current!,
      phase: "output-validation-rejected",
      outputValidationRejection: {
        observation: input.observation,
        destruction: input.destruction,
      },
    };
    return Promise.resolve(this.current);
  }
}

class FakeDrafts implements Build123dExecutionDraftStore {
  items = new Map<string, Awaited<ReturnType<typeof createBuild123dExecutionDraft>>>();
  async save(value: unknown) {
    const draft = await (await import(
      "../../../domain/cad/isolated/build123d-execution-evidence.ts"
    ))
      .validateBuild123dExecutionDraft(value);
    const reference = await (await import(
      "../../../domain/cad/isolated/build123d-execution-evidence.ts"
    ))
      .buildBuild123dExecutionDraftReference(draft);
    this.items.set(reference.fingerprint.digest, draft);
    return { draft, reference };
  }
  read(reference: Build123dExecutionDraftReference) {
    return Promise.resolve(this.items.get(reference.fingerprint.digest));
  }
}

class FakeCaptures implements Build123dExecutionCaptureStore {
  items = new Map<
    string,
    Awaited<ReturnType<typeof createBuild123dExecutionCapture>>
  >();
  async save(value: unknown) {
    const capture = await (await import(
      "../../../domain/cad/isolated/build123d-execution-evidence.ts"
    ))
      .validateBuild123dExecutionCapture(value);
    const fingerprint = await sha256Fingerprint(capture);
    this.items.set(fingerprint.digest, capture);
    return { capture, fingerprint, uri: this.uriFor(fingerprint) };
  }
  read(fingerprint: ContentFingerprint) {
    return Promise.resolve(this.items.get(fingerprint.digest));
  }
  uriFor(fingerprint: ContentFingerprint) {
    return `casys://build123d-execution-capture/sha256/${fingerprint.digest}`;
  }
}

class FakeSnapshots {
  readonly items = new Map<string, ThreadSnapshot>();
  saveCalls = 0;
  successorIds: string[] = [];
  constructor(...snapshots: ThreadSnapshot[]) {
    for (const snapshot of snapshots) {
      this.items.set(snapshot.id, structuredClone(snapshot));
    }
  }
  get(id: string) {
    const value = this.items.get(id);
    return Promise.resolve(value && structuredClone(value));
  }
  getFresh(id: string) {
    return this.get(id);
  }
  latest(subjectId: string) {
    const value =
      [...this.items.values()].filter((item) => item.subject.id === subjectId).sort((
        a,
        b,
      ) => b.revision - a.revision)[0];
    return Promise.resolve(value && structuredClone(value));
  }
  save(snapshot: ThreadSnapshot) {
    this.saveCalls += 1;
    this.successorIds.push(snapshot.id);
    const existing = this.items.get(snapshot.id);
    if (existing && deterministicJson(existing) !== deterministicJson(snapshot)) {
      return Promise.reject(new Error("immutable snapshot rewrite"));
    }
    this.items.set(snapshot.id, structuredClone(snapshot));
    return Promise.resolve();
  }
}

class FakeCommands {
  claimIdentity?: string;
  claimCalls = 0;
  publishCalls = 0;
  #publishAckLostOnce: boolean;
  #publishIdentity?: string;
  constructor(
    readonly project: MutableProject,
    options: { readonly publishAckLostOnce?: boolean } = {},
  ) {
    this.#publishAckLostOnce = options.publishAckLostOnce ?? false;
  }
  async claimRun(origin: EngineeringProjectCommandOrigin, command: RunCommand) {
    this.claimCalls += 1;
    const run = this.project.agentRuns[0] as MutableRun;
    const identity = deterministicJson({ origin, command });
    if (run.status === "queued") {
      this.claimIdentity = identity;
      run.status = "running";
      run.startedAt = AT;
      run.claimedAt = AT;
      run.claimedBy = { id: origin.actorId, origin: origin.kind };
      run.summary = command.summary;
      this.project.revision += 1;
      this.project.commandReceipts.push({
        commandId: command.commandId,
        type: "agent-run.claim",
        actor: { id: origin.actorId, origin: origin.kind },
        issuedAt: command.issuedAt,
        appliedAt: AT,
        requestFingerprint: await sha256Fingerprint({
          type: "agent-run.claim",
          origin,
          command,
        }),
        resultingSnapshot: {
          snapshotId: `project.claim.${this.project.revision}`,
          revision: this.project.revision,
        },
      });
      run.statusHistory = [...(run.statusHistory ?? []), {
        commandId: command.commandId,
        status: "running",
        at: AT,
        actor: { id: origin.actorId, origin: origin.kind },
        summary: command.summary,
      }];
    } else if (identity !== this.claimIdentity && !this.claimIdentity) {
      this.claimIdentity = identity;
    } else if (identity !== this.claimIdentity) {
      return Promise.reject(new Error("claim identity drift"));
    }
    return this.project;
  }
  async publishRun(origin: EngineeringProjectCommandOrigin, command: RunCommand) {
    this.publishCalls += 1;
    const identity = deterministicJson({ origin, command });
    const requestFingerprint = await sha256Fingerprint({
      type: "agent-run.publish",
      origin,
      command,
    });
    const run = this.project.agentRuns[0] as MutableRun;
    if (run.status === "running") {
      this.#publishIdentity = identity;
      run.status = "publishing";
      this.project.revision += 1;
      this.project.commandReceipts.push({
        commandId: command.commandId,
        type: "agent-run.publish",
        actor: { id: origin.actorId, origin: origin.kind },
        issuedAt: command.issuedAt,
        appliedAt: AT,
        requestFingerprint,
        resultingSnapshot: {
          snapshotId: `project.publish.${this.project.revision}`,
          revision: this.project.revision,
        },
      });
      if (this.#publishAckLostOnce) {
        this.#publishAckLostOnce = false;
        throw new Error("publish ACK lost after durable commit");
      }
      return this.project;
    }
    const receipts = this.project.commandReceipts.filter((receipt) =>
      receipt.commandId === command.commandId
    );
    const receipt = receipts[0];
    if (
      receipts.length !== 1 || !receipt || identity !== this.#publishIdentity ||
      deterministicJson(receipt.requestFingerprint) !==
        deterministicJson(requestFingerprint)
    ) throw new Error("publish identity drift");
    return Promise.resolve(this.project);
  }
  async completeRun(
    origin: EngineeringProjectCommandOrigin,
    command: CompleteRunCommand,
  ) {
    const run = this.project.agentRuns[0] as MutableRun;
    if (run.status !== "completed") {
      run.status = "completed";
      run.completedAt = AT;
      run.resultSnapshot = command.resultSnapshot;
      run.evidenceRefs = [...command.evidenceRefs];
      const work = this.project.workItems[0] as MutableWork;
      work.status = "completed";
      work.evidenceRefs = [...command.evidenceRefs];
      (this.project.phases[0] as MutablePhase).evidenceRefs = [...command.evidenceRefs];
      this.project.threadSnapshots.push(command.resultSnapshot);
      this.project.revision += 1;
      this.project.commandReceipts.push({
        commandId: command.commandId,
        type: "agent-run.complete",
        actor: { id: origin.actorId, origin: origin.kind },
        issuedAt: command.issuedAt,
        appliedAt: AT,
        requestFingerprint: await sha256Fingerprint({
          type: "agent-run.complete",
          origin,
          command,
        }),
        resultingSnapshot: {
          snapshotId: `project.receipt.${this.project.revision}`,
          revision: this.project.revision,
        },
      });
    }
    return this.project;
  }
  async failRun(origin: EngineeringProjectCommandOrigin, command: FailRunCommand) {
    const run = this.project.agentRuns[0] as MutableRun;
    if (run.status === "failed") return this.project;
    run.status = "failed";
    run.completedAt = AT;
    run.failure = { code: command.code, message: command.message };
    run.summary = command.summary;
    this.project.revision += 1;
    this.project.commandReceipts.push({
      commandId: command.commandId,
      type: "agent-run.fail",
      actor: { id: origin.actorId, origin: origin.kind },
      issuedAt: command.issuedAt,
      appliedAt: AT,
      requestFingerprint: await sha256Fingerprint({
        type: "agent-run.fail",
        origin,
        command,
      }),
      resultingSnapshot: {
        snapshotId: `project.fail.${this.project.revision}`,
        revision: this.project.revision,
      },
    });
    run.statusHistory = [...(run.statusHistory ?? []), {
      commandId: command.commandId,
      status: "failed",
      at: AT,
      actor: { id: origin.actorId, origin: origin.kind },
      summary: command.summary,
    }];
    return this.project;
  }
}

type MutableProject = EngineeringProjectSnapshot & {
  revision: number;
  threadSnapshots: Array<EngineeringProjectSnapshot["threadSnapshots"][number]>;
  phases: Array<EngineeringProjectSnapshot["phases"][number]>;
  workItems: Array<EngineeringProjectSnapshot["workItems"][number]>;
  agentRuns: Array<EngineeringProjectSnapshot["agentRuns"][number]>;
  commandReceipts: EngineeringProjectCommandReceipt[];
};
type MutableRun = {
  -readonly [K in keyof MutableProject["agentRuns"][number]]:
    MutableProject["agentRuns"][number][K];
};
type MutableWork = {
  -readonly [K in keyof MutableProject["workItems"][number]]:
    MutableProject["workItems"][number][K];
};
type MutablePhase = {
  -readonly [K in keyof MutableProject["phases"][number]]:
    MutableProject["phases"][number][K];
};

function fresh(changedAt: string) {
  return { status: "fresh" as const, changedAt, invalidatedByChangeIds: [] };
}
