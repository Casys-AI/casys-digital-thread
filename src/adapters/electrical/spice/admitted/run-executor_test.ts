import { assert, assertEquals, assertRejects } from "@std/assert";
import type { EngineeringProjectCommandOrigin } from "../../../../application/ports/in/engineering-project-command-origin.ts";
import type { EngineeringProjectRevisionStore } from "../../../../application/ports/out/engineering-project-revision-store.ts";
import type { AdmittedSpiceExecutionAttemptStore } from "../../../../application/ports/out/electrical/spice/admitted-execution-attempt-store.ts";
import {
  IsolatedCodeExecutionRejectedError,
  IsolatedCodeOutputValidationRejectedError,
} from "../../../../application/ports/out/compile/isolation/isolated-code-runner.ts";
import type {
  CompleteRunCommand,
  FailRunCommand,
  RunCommand,
} from "../../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  ADMITTED_SPICE_ISOLATED_EXECUTION_REJECTED,
  ADMITTED_SPICE_ISOLATED_OUTPUT_VALIDATION_FAILED,
  ADMITTED_SPICE_RETRY_GENERATION_CLOSED,
} from "../../../../application/use-cases/electrical/spice/admitted/completed-replay-verification.ts";
import type {
  EngineeringProjectCommandReceipt,
  EngineeringProjectSnapshot,
} from "../../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../../domain/thread/thread-snapshot-validation.ts";
import { applyThreadSnapshotExtensionIfNew } from "../../../../domain/thread/thread-snapshot-extension.ts";
import { SpiceCircuitSourceAnalyzer } from "../circuit-source-analyzer.ts";
import { PrepareProjectAdmittedSpiceRunReview } from "../../../../application/use-cases/electrical/spice/admitted/prepare-run-review.ts";
import {
  ADMITTED_SPICE_EXECUTION_PROFILE_SCHEMA,
  type AdmittedSpiceExecutionProfile,
  type AdmittedSpiceExecutionProfileCatalog,
  type AdmittedSpiceExecutionProfileFingerprintBody,
} from "../../../../application/ports/out/electrical/spice/admitted-execution-profile-catalog.ts";
import type {
  ReopenedTechnicalCompilationAdmission,
  TechnicalCompilationAdmissionReader,
} from "../../../../application/ports/out/compile/admission/technical-compilation-admission-reader.ts";
import { TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA } from "../../../../application/ports/out/compile/admission/technical-compilation-draft-store.ts";
import {
  encodeSpiceAdmittedRunAdmissionParameters,
  SIMULATE_RUN_ADMITTED_SPICE_OPERATION,
  SPICE_ADMITTED_COMPILED_ADMISSION_SCHEMA,
  SPICE_ADMITTED_EXECUTION_PROFILE,
  SPICE_ADMITTED_OUTPUT_MANIFEST,
  type SpiceAdmittedRunAdmission,
} from "../../../../domain/electrical/spice/admitted/run-proposal.ts";
import {
  SPICE_ADMITTED_MAX_DURATION_MS,
  SPICE_ADMITTED_MAX_EVIDENCE_BYTES,
  SPICE_ADMITTED_MAX_OBSERVABLES,
  SPICE_ADMITTED_MAX_RESULT_BYTES,
  SPICE_ADMITTED_MAX_SOURCE_BYTES,
  SPICE_ADMITTED_MAX_VECTOR_BYTES,
  SPICE_CIRCUIT_CLOSED_SUBSET_EXECUTION_PROFILE,
  SPICE_ISOLATED_EVIDENCE_LIMITATIONS,
  SPICE_ISOLATED_EVIDENCE_SCHEMA,
  SPICE_OPERATING_POINT_EXPORT,
  SPICE_OPERATING_POINT_RESULT_SCHEMA,
  SPICE_OPERATING_POINT_SIGN_CONVENTION,
  SPICE_OPERATING_POINT_WRAPPER,
} from "../../../../domain/electrical/spice/admitted/contract.ts";
import {
  MICROSANDBOX_LOCAL_ISOLATION_CLASS,
  MICROSANDBOX_LOCAL_RUNTIME_REF,
} from "../../../../domain/compile/isolation/local-isolation-runtime.ts";
import { fingerprintSourceAnalysisBundle } from "../../../../domain/compile/source/source-analysis.ts";
import {
  compileTechnicalSources,
  fingerprintTechnicalCompilationBasis,
  fingerprintTechnicalSourceText,
  fingerprintTechnicalSysmlAnchor,
  TECHNICAL_COMPILATION_INPUT_SCHEMA,
  TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
  type TechnicalCompilationBasis,
  type TechnicalCompilationProfile,
} from "../../../../domain/compile/admission/technical-compilation.ts";
import {
  COMPILE_SEAL_ADMISSION_OPERATION,
  encodeTechnicalCompilationAdmissionParameters,
  parseTechnicalCompilationAdmissionParameters,
  TECHNICAL_COMPILATION_ADMISSION_SCHEMA,
} from "../../../../domain/compile/admission/technical-compilation-proposal.ts";
import {
  sampleAdmissionSourceWorkspaceFields,
  technicalSourceCaptureInput,
} from "../../../../testing/technical-source-capture-test-support.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import {
  createIsolatedCodeExecutionReceipt,
  createIsolatedCodeExecutionRejectionDiagnostic,
  createIsolatedOutputProducerGenerationAdvance,
  createIsolatedOutputPublicationRef,
  fingerprintIsolatedOutputPublicationManifest,
  type IsolatedCodeExecutionReceipt,
  isolatedCodeExecutionReceiptRecord,
  type IsolatedCodeExecutionRequest,
  type IsolatedOutputProducerGenerationAdvance,
  validateIsolatedCodeExecutionRequest,
} from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import { fingerprintResourceBytes } from "../../../../domain/compile/source/provider-resource-reader.ts";
import { FileAdmittedSpiceExecutionAttemptStore } from "./file-execution-attempt-store.ts";
import { FileEngineeringProjectRunLease } from "../../../shared/stores/file-engineering-project-run-lease.ts";
import {
  reopenAdmittedExecutionRequest,
  SimulateRunAdmittedSpiceRunExecutor,
  type SimulateRunAdmittedSpiceRunExecutorDependencies,
} from "./run-executor.ts";

const SPICE_DIVIDER_SOURCE = "Vin in 0 DC 5\nR1 in out 1k\nR2 out 0 1k\n";

const DIVIDER_OBSERVABLES = [
  {
    nativeName: "@r1[i]",
    kind: "branch-current",
    sourceSymbol: "R1",
    value: 0.0025,
    unit: "A",
  },
  {
    nativeName: "@r2[i]",
    kind: "branch-current",
    sourceSymbol: "R2",
    value: 0.0025,
    unit: "A",
  },
  {
    nativeName: "i(vin)",
    kind: "branch-current",
    sourceSymbol: "Vin",
    value: -0.0025,
    unit: "A",
  },
  {
    nativeName: "v(in)",
    kind: "node-voltage",
    sourceSymbol: "in",
    value: 5,
    unit: "V",
  },
  {
    nativeName: "v(out)",
    kind: "node-voltage",
    sourceSymbol: "out",
    value: 2.5,
    unit: "V",
  },
] as const;

Deno.test("admitted SPICE execute reopens sealed bytes and never takes caller text, image, or args", async () => {
  const fixture = await harness();
  const context = await reopenAdmittedExecutionRequest({
    admissions: fixture.reader,
    profiles: fixture.profiles,
    project: { project: { id: "project.ramp" } } as never,
    run: { id: "run.admitted", basis: fixture.command.basis } as never,
    admission: (await fixture.review.execute(fixture.command)).admission,
  });
  const sourceSha = (await fingerprintTechnicalSourceText(SPICE_DIVIDER_SOURCE))
    .digest;
  assertEquals(context.request.source.sha256, sourceSha);
  assertEquals(
    new TextDecoder().decode(context.request.source.bytes),
    SPICE_DIVIDER_SOURCE,
  );
  assertEquals(context.request.outputs, [...SPICE_ADMITTED_OUTPUT_MANIFEST]);
  assertEquals(context.request.profile.id, "spice-circuit-closed-subset-v1");
  assertEquals(
    Object.keys(context.request).sort(),
    [
      "outputs",
      "policy",
      "producerGeneration",
      "profile",
      "runId",
      "schemaVersion",
      "source",
    ].sort(),
  );
  assertEquals("args" in context.request, false);
  assertEquals("image" in context.request, false);
  assertEquals("path" in context.request, false);
  assertEquals("observations" in context.request, false);
  assertEquals("sourceText" in context.request, false);
});

const EXECUTION_AT = "2026-08-23T05:00:00.000Z";
const EXECUTION_AGENT = { kind: "agent" as const, actorId: "agent.spice" };
const EXECUTION_COMMAND = {
  commandId: "execute.spice.admitted",
  projectId: "project.ramp",
  expectedRevision: 1,
  issuedAt: EXECUTION_AT,
  runId: "run.admitted",
};

Deno.test("admitted SPICE executor publishes documentary evidence with CAS objects and proven destruction", async () => {
  const fixture = await executorHarness();
  try {
    const completed = await fixture.executor.execute(
      EXECUTION_AGENT,
      EXECUTION_COMMAND,
    );
    assertEquals(runStatus(completed), "completed");
    assertEquals(fixture.runtime.runs, [0]);
    const request = fixture.runtime.requests[0]!;
    assertEquals(request.outputs, [...SPICE_ADMITTED_OUTPUT_MANIFEST]);
    assertEquals("args" in request, false);
    const attempt = await fixture.attempts.read(
      EXECUTION_COMMAND.projectId,
      EXECUTION_COMMAND.runId,
    );
    assertEquals(attempt?.phase, "completed");
    if (attempt?.phase !== "completed") throw new Error("unreachable");
    assertEquals(attempt.receiptRecord.destruction.status, "proven");
    assertEquals(
      attempt.receiptRecord.outputs.map((output) => output.casUri).every((uri) =>
        uri.startsWith("casys://isolated-output/sha256/")
      ),
      true,
    );
    assertEquals(fixture.snapshots.saveCalls, 1);
    assertEquals(fixture.captures.saveCalls, 1);
    assertEquals(completed.agentRuns[0]?.evidenceRefs.length, 3);
  } finally {
    await fixture.dispose();
  }
});

Deno.test("first-dispatch isolated rejection fails the exact claimed run without Thread evidence", async () => {
  const fixture = await executorHarness({ rejectExecution: true });
  try {
    const beforeSnapshots = [...fixture.project.threadSnapshots];
    const failed = await fixture.executor.execute(
      EXECUTION_AGENT,
      EXECUTION_COMMAND,
    );
    const run = failed.agentRuns.find((item) => item.id === EXECUTION_COMMAND.runId);
    assertEquals(run?.status, "failed");
    assertEquals(run?.failure?.code, ADMITTED_SPICE_ISOLATED_EXECUTION_REJECTED.code);
    assertEquals(run?.failure?.message.includes("circuit failed"), true);
    assertEquals(run?.evidenceRefs ?? [], []);
    assertEquals(run?.resultSnapshot, undefined);
    assertEquals(failed.threadSnapshots, beforeSnapshots);
    assertEquals(
      (await fixture.attempts.read(
        EXECUTION_COMMAND.projectId,
        EXECUTION_COMMAND.runId,
      ))?.phase,
      "execution-rejected",
    );
    assertEquals(fixture.runtime.runs, [0]);
    assertEquals("args" in fixture.runtime.requests[0]!, false);
    assertEquals("image" in fixture.runtime.requests[0]!, false);
    assertEquals(fixture.captures.saveCalls, 0);
    assertEquals(fixture.snapshots.saveCalls, 0);
  } finally {
    await fixture.dispose();
  }
});

Deno.test("first-dispatch output-validation rejection fails the exact claimed run without Thread evidence", async () => {
  const fixture = await executorHarness({ rejectOutputValidation: true });
  try {
    const beforeSnapshots = [...fixture.project.threadSnapshots];
    const failed = await fixture.executor.execute(
      EXECUTION_AGENT,
      EXECUTION_COMMAND,
    );
    const run = failed.agentRuns.find((item) => item.id === EXECUTION_COMMAND.runId);
    assertEquals(run?.status, "failed");
    assertEquals(
      run?.failure?.code,
      ADMITTED_SPICE_ISOLATED_OUTPUT_VALIDATION_FAILED.code,
    );
    assertEquals(run?.failure?.message.includes("evidence"), true);
    assertEquals(run?.failure?.message.includes("/tmp/"), false);
    assertEquals(run?.evidenceRefs ?? [], []);
    assertEquals(failed.threadSnapshots, beforeSnapshots);
    assertEquals(
      (await fixture.attempts.read(
        EXECUTION_COMMAND.projectId,
        EXECUTION_COMMAND.runId,
      ))?.phase,
      "output-validation-rejected",
    );
    assertEquals(fixture.runtime.runs, [0]);
    assertEquals(fixture.captures.saveCalls, 0);
    assertEquals(fixture.snapshots.saveCalls, 0);

    const replayed = await fixture.executor.execute(EXECUTION_AGENT, {
      ...EXECUTION_COMMAND,
      expectedRevision: failed.revision,
    });
    assertEquals(replayed.revision, failed.revision);
    assertEquals(runStatus(replayed), "failed");
    assertEquals(fixture.runtime.runs, [0]);
  } finally {
    await fixture.dispose();
  }
});

Deno.test("retrying an already-failed admitted SPICE rejection is idempotent", async () => {
  const fixture = await executorHarness({ rejectExecution: true });
  try {
    const failed = await fixture.executor.execute(
      EXECUTION_AGENT,
      EXECUTION_COMMAND,
    );
    const revision = failed.revision;
    const receipts = failed.commandReceipts?.length;
    const replayed = await fixture.executor.execute(EXECUTION_AGENT, {
      ...EXECUTION_COMMAND,
      expectedRevision: failed.revision,
    });
    assertEquals(replayed.revision, revision);
    assertEquals(runStatus(replayed), "failed");
    assertEquals(
      replayed.agentRuns.find((item) => item.id === EXECUTION_COMMAND.runId)
        ?.failure?.code,
      ADMITTED_SPICE_ISOLATED_EXECUTION_REJECTED.code,
    );
    assertEquals(receipts, 2);
    assertEquals(replayed.commandReceipts?.length, receipts);
    assertEquals(fixture.runtime.runs, [0]);
    assertEquals(fixture.snapshots.saveCalls, 0);
    assertEquals(fixture.captures.saveCalls, 0);

    const unrelated = await executorHarness();
    try {
      const run = unrelated.project.agentRuns[0] as MutableRun;
      run.status = "failed";
      run.startedAt = EXECUTION_AT;
      run.claimedAt = EXECUTION_AT;
      run.completedAt = EXECUTION_AT;
      run.claimedBy = { id: EXECUTION_AGENT.actorId, origin: EXECUTION_AGENT.kind };
      run.failure = { code: "other-failure", message: "unrelated terminal" };
      await assertRejects(
        () =>
          unrelated.executor.execute(EXECUTION_AGENT, {
            ...EXECUTION_COMMAND,
            expectedRevision: unrelated.project.revision,
          }),
        Error,
      );
      assertEquals(unrelated.runtime.runs, []);
      assertEquals(unrelated.snapshots.saveCalls, 0);
    } finally {
      await unrelated.dispose();
    }
  } finally {
    await fixture.dispose();
  }
});

Deno.test("generation-one closed without publication fails the exact claimed run", async () => {
  const fixture = await executorHarness({
    failGenerationZero: true,
    failGenerationOne: true,
  });
  try {
    const beforeSnapshots = [...fixture.project.threadSnapshots];
    const failed = await fixture.executor.execute(
      EXECUTION_AGENT,
      EXECUTION_COMMAND,
    );
    const run = failed.agentRuns.find((item) => item.id === EXECUTION_COMMAND.runId);
    assertEquals(run?.status, "failed");
    assertEquals(run?.failure?.code, ADMITTED_SPICE_RETRY_GENERATION_CLOSED.code);
    assertEquals(
      run?.failure?.message,
      ADMITTED_SPICE_RETRY_GENERATION_CLOSED.message,
    );
    assertEquals(run?.evidenceRefs ?? [], []);
    assertEquals(failed.threadSnapshots, beforeSnapshots);
    assertEquals(fixture.runtime.runs, [0, 1]);
    assertEquals(fixture.runtime.recoveries, [0, 1]);
    assertEquals(fixture.runtime.resolves, [0, 1]);
    assertEquals(fixture.runtime.advances, 1);
    assertEquals(fixture.snapshots.saveCalls, 0);
    assertEquals(fixture.captures.saveCalls, 0);
    const attempt = await fixture.attempts.read(
      EXECUTION_COMMAND.projectId,
      EXECUTION_COMMAND.runId,
    );
    assertEquals(attempt?.phase, "retry-generation-closed");
    if (attempt?.phase !== "retry-generation-closed") {
      throw new Error("unreachable");
    }
    assertEquals(attempt.dispatch.producerGeneration, 1);
    assertEquals(attempt.dispatch.dispatchCount, 2);
    assertEquals(attempt.closedGeneration.producerGeneration, 1);
    assertEquals(attempt.closedGeneration.destruction.status, "proven");
    assertEquals(attempt.closedGeneration.destruction.runId, attempt.executionRunId);
    const receipts = failed.commandReceipts?.length;

    const replayed = await fixture.executor.execute(EXECUTION_AGENT, {
      ...EXECUTION_COMMAND,
      expectedRevision: failed.revision,
    });
    assertEquals(replayed.revision, failed.revision);
    assertEquals(runStatus(replayed), "failed");
    assertEquals(receipts, 2);
    assertEquals(replayed.commandReceipts?.length, receipts);
    assertEquals(fixture.runtime.runs, [0, 1]);
    assertEquals(fixture.runtime.recoveries, [0, 1]);
    assertEquals(fixture.runtime.resolves, [0, 1]);
    assertEquals(fixture.snapshots.saveCalls, 0);
  } finally {
    await fixture.dispose();
  }
});

Deno.test(
  "retry converts a live dispatching generation-one WAL into retry-generation-closed",
  async () => {
    const fixture = await executorHarness({
      failGenerationZero: true,
      failGenerationOne: true,
      failGenerationOneDestroyOnce: true,
    });
    try {
      await assertRejects(
        () => fixture.executor.execute(EXECUTION_AGENT, EXECUTION_COMMAND),
        Error,
        "Retry this exact command",
      );
      assertEquals(runStatus(fixture.project), "running");
      const live = await fixture.attempts.read(
        EXECUTION_COMMAND.projectId,
        EXECUTION_COMMAND.runId,
      );
      assertEquals(live?.phase, "dispatching");
      if (live?.phase !== "dispatching") throw new Error("unreachable");
      assertEquals(live.dispatch.producerGeneration, 1);
      assertEquals(live.dispatch.dispatchCount, 2);
      assertEquals(fixture.runtime.runs, [0, 1]);
      assertEquals(fixture.runtime.recoveries, [0]);
      assertEquals(fixture.runtime.resolves, [0, 1]);
      assertEquals(fixture.snapshots.saveCalls, 0);

      const failed = await fixture.executor.execute(EXECUTION_AGENT, {
        ...EXECUTION_COMMAND,
        expectedRevision: fixture.project.revision,
      });
      assertEquals(runStatus(failed), "failed");
      assertEquals(
        failed.agentRuns.find((item) => item.id === EXECUTION_COMMAND.runId)
          ?.failure,
        {
          code: ADMITTED_SPICE_RETRY_GENERATION_CLOSED.code,
          message: ADMITTED_SPICE_RETRY_GENERATION_CLOSED.message,
        },
      );
      const closed = await fixture.attempts.read(
        EXECUTION_COMMAND.projectId,
        EXECUTION_COMMAND.runId,
      );
      assertEquals(closed?.phase, "retry-generation-closed");
      if (closed?.phase !== "retry-generation-closed") {
        throw new Error("unreachable");
      }
      assertEquals(closed.closedGeneration.producerGeneration, 1);
      assertEquals(closed.closedGeneration.destruction.status, "proven");
      assertEquals(closed.closedGeneration.destruction.runId, closed.executionRunId);
      assertEquals(fixture.runtime.runs, [0, 1]);
      assertEquals(fixture.runtime.recoveries, [0, 1]);
      assertEquals(fixture.runtime.advances, 1);
      assertEquals(fixture.snapshots.saveCalls, 0);
    } finally {
      await fixture.dispose();
    }
  },
);

Deno.test(
  "retry-generation-closed on a still-running project fails without CAS resolve or destroy",
  async () => {
    const fixture = await executorHarness({
      failGenerationZero: true,
      failGenerationOne: true,
      failFailOnce: true,
    });
    try {
      await assertRejects(
        () => fixture.executor.execute(EXECUTION_AGENT, EXECUTION_COMMAND),
        Error,
        "fail acknowledgement lost",
      );
      assertEquals(runStatus(fixture.project), "running");
      const closed = await fixture.attempts.read(
        EXECUTION_COMMAND.projectId,
        EXECUTION_COMMAND.runId,
      );
      assertEquals(closed?.phase, "retry-generation-closed");
      assertEquals(fixture.runtime.runs, [0, 1]);
      assertEquals(fixture.runtime.recoveries, [0, 1]);
      assertEquals(fixture.runtime.resolves, [0, 1]);

      const failed = await fixture.executor.execute(EXECUTION_AGENT, {
        ...EXECUTION_COMMAND,
        expectedRevision: fixture.project.revision,
      });
      assertEquals(runStatus(failed), "failed");
      assertEquals(
        failed.agentRuns.find((item) => item.id === EXECUTION_COMMAND.runId)
          ?.failure?.message,
        ADMITTED_SPICE_RETRY_GENERATION_CLOSED.message,
      );
      assertEquals(fixture.runtime.runs, [0, 1]);
      assertEquals(fixture.runtime.recoveries, [0, 1]);
      assertEquals(fixture.runtime.resolves, [0, 1]);
      assertEquals(fixture.snapshots.saveCalls, 0);
      assertEquals(failed.commandReceipts?.length, 2);
    } finally {
      await fixture.dispose();
    }
  },
);

Deno.test(
  "retired profile plus legacy dispatching generation-one WAL converts and fails without current-profile reopen",
  async () => {
    const fixture = await executorHarness({
      failGenerationZero: true,
      failGenerationOne: true,
      failGenerationOneDestroyOnce: true,
    });
    try {
      await assertRejects(
        () => fixture.executor.execute(EXECUTION_AGENT, EXECUTION_COMMAND),
        Error,
        "Retry this exact command",
      );
      assertEquals(runStatus(fixture.project), "running");
      const live = await fixture.attempts.read(
        EXECUTION_COMMAND.projectId,
        EXECUTION_COMMAND.runId,
      );
      assertEquals(live?.phase, "dispatching");
      if (live?.phase !== "dispatching") throw new Error("unreachable");
      assertEquals(live.dispatch.producerGeneration, 1);
      await retireHarnessProfile(fixture.profiles);
      const profileCalls = fixture.profiles.initialCalls;
      const resolveCalls = fixture.profiles.resolveCalls;
      const admissionReads = fixture.admissions.reads;
      const runs = [...fixture.runtime.runs];

      const failed = await fixture.executor.execute(EXECUTION_AGENT, {
        ...EXECUTION_COMMAND,
        expectedRevision: fixture.project.revision,
      });
      assertEquals(runStatus(failed), "failed");
      assertEquals(
        failed.agentRuns.find((item) => item.id === EXECUTION_COMMAND.runId)
          ?.failure,
        {
          code: ADMITTED_SPICE_RETRY_GENERATION_CLOSED.code,
          message: ADMITTED_SPICE_RETRY_GENERATION_CLOSED.message,
        },
      );
      const closed = await fixture.attempts.read(
        EXECUTION_COMMAND.projectId,
        EXECUTION_COMMAND.runId,
      );
      assertEquals(closed?.phase, "retry-generation-closed");
      assertEquals(fixture.profiles.initialCalls, profileCalls);
      assertEquals(fixture.profiles.resolveCalls, resolveCalls);
      assertEquals(fixture.admissions.reads, admissionReads);
      assertEquals(fixture.runtime.runs, runs);
      assertEquals(fixture.runtime.recoveries, [0, 1]);
      assertEquals(fixture.snapshots.saveCalls, 0);
      assertEquals(fixture.captures.saveCalls, 0);
    } finally {
      await fixture.dispose();
    }
  },
);

Deno.test(
  "retired profile plus retry-generation-closed fails and replays with zero runner or profile reopen",
  async () => {
    const fixture = await executorHarness({
      failGenerationZero: true,
      failGenerationOne: true,
    });
    try {
      const failed = await fixture.executor.execute(
        EXECUTION_AGENT,
        EXECUTION_COMMAND,
      );
      assertEquals(runStatus(failed), "failed");
      assertEquals(
        (await fixture.attempts.read(
          EXECUTION_COMMAND.projectId,
          EXECUTION_COMMAND.runId,
        ))?.phase,
        "retry-generation-closed",
      );
      await retireHarnessProfile(fixture.profiles);
      const profileCalls = fixture.profiles.initialCalls;
      const resolveCalls = fixture.profiles.resolveCalls;
      const admissionReads = fixture.admissions.reads;
      const runs = [...fixture.runtime.runs];
      const recoveries = [...fixture.runtime.recoveries];
      const resolves = [...fixture.runtime.resolves];
      const receipts = failed.commandReceipts?.length;

      const replayed = await fixture.executor.execute(EXECUTION_AGENT, {
        ...EXECUTION_COMMAND,
        expectedRevision: failed.revision,
      });
      assertEquals(runStatus(replayed), "failed");
      assertEquals(replayed.revision, failed.revision);
      assertEquals(replayed.commandReceipts?.length, receipts);
      assertEquals(
        replayed.agentRuns.find((item) => item.id === EXECUTION_COMMAND.runId)
          ?.failure?.code,
        ADMITTED_SPICE_RETRY_GENERATION_CLOSED.code,
      );
      assertEquals(fixture.profiles.initialCalls, profileCalls);
      assertEquals(fixture.profiles.resolveCalls, resolveCalls);
      assertEquals(fixture.admissions.reads, admissionReads);
      assertEquals(fixture.runtime.runs, runs);
      assertEquals(fixture.runtime.recoveries, recoveries);
      assertEquals(fixture.runtime.resolves, resolves);
      assertEquals(fixture.snapshots.saveCalls, 0);
      assertEquals(fixture.captures.saveCalls, 0);
    } finally {
      await fixture.dispose();
    }
  },
);

Deno.test(
  "retired profile plus nonterminal or ambiguous WAL refuses without failing the run",
  async () => {
    const nonterminal = await executorHarness({
      failGenerationZero: true,
      outcomeUnknownGeneration: 0,
    });
    try {
      await assertRejects(
        () => nonterminal.executor.execute(EXECUTION_AGENT, EXECUTION_COMMAND),
        Error,
        "unknown",
      );
      assertEquals(runStatus(nonterminal.project), "running");
      await retireHarnessProfile(nonterminal.profiles);
      const profileCalls = nonterminal.profiles.initialCalls;
      await assertRejects(
        () =>
          nonterminal.executor.execute(EXECUTION_AGENT, {
            ...EXECUTION_COMMAND,
            expectedRevision: nonterminal.project.revision,
          }),
        Error,
        "The reopened admitted SPICE review differs from the signed MRTR.",
      );
      assertEquals(runStatus(nonterminal.project), "running");
      assertEquals(nonterminal.profiles.initialCalls > profileCalls, true);
      assertEquals(nonterminal.runtime.runs, [0]);
      assertEquals(nonterminal.snapshots.saveCalls, 0);
    } finally {
      await nonterminal.dispose();
    }

    const ambiguous = await executorHarness({
      failGenerationZero: true,
      failGenerationOne: true,
      outcomeUnknownGeneration: 1,
    });
    try {
      await assertRejects(
        () => ambiguous.executor.execute(EXECUTION_AGENT, EXECUTION_COMMAND),
        Error,
        "unknown",
      );
      const live = await ambiguous.attempts.read(
        EXECUTION_COMMAND.projectId,
        EXECUTION_COMMAND.runId,
      );
      assertEquals(live?.phase, "dispatching");
      if (live?.phase !== "dispatching") throw new Error("unreachable");
      assertEquals(live.dispatch.producerGeneration, 1);
      await retireHarnessProfile(ambiguous.profiles);
      const profileCalls = ambiguous.profiles.initialCalls;
      const runs = [...ambiguous.runtime.runs];
      const error = await assertRejects(
        () =>
          ambiguous.executor.execute(EXECUTION_AGENT, {
            ...EXECUTION_COMMAND,
            expectedRevision: ambiguous.project.revision,
          }),
        Error,
      );
      assertEquals(
        error.message.includes("The reopened admitted SPICE review differs"),
        false,
      );
      assertEquals(error.message.includes("unknown"), true);
      assertEquals(runStatus(ambiguous.project), "running");
      assertEquals(ambiguous.profiles.initialCalls, profileCalls);
      assertEquals(ambiguous.runtime.runs, runs);
      assertEquals(ambiguous.snapshots.saveCalls, 0);
    } finally {
      await ambiguous.dispose();
    }
  },
);

Deno.test("ambiguous CAS publication keeps the claimed run running and instructs exact retry", async () => {
  const fixture = await executorHarness({
    failGenerationZero: true,
    outcomeUnknownGeneration: 0,
  });
  try {
    await assertRejects(
      () => fixture.executor.execute(EXECUTION_AGENT, EXECUTION_COMMAND),
      Error,
      "Retry this exact command",
    );
    assertEquals(runStatus(fixture.project), "running");
    assertEquals(
      fixture.project.agentRuns.find((item) => item.id === EXECUTION_COMMAND.runId)
        ?.failure,
      undefined,
    );
    assertEquals(fixture.runtime.runs, [0]);
    assertEquals(fixture.runtime.recoveries, []);
    assertEquals(fixture.runtime.advances, 0);
    assertEquals(fixture.snapshots.saveCalls, 0);
    await assertRejects(
      () =>
        fixture.executor.execute(EXECUTION_AGENT, {
          ...EXECUTION_COMMAND,
          expectedRevision: fixture.project.revision,
        }),
      Error,
      "unknown",
    );
    assertEquals(runStatus(fixture.project), "running");
    assertEquals(fixture.runtime.runs, [0]);
    assertEquals(fixture.runtime.recoveries, []);
    assertEquals(fixture.runtime.advances, 0);
  } finally {
    await fixture.dispose();
  }
});

Deno.test(
  "generation-zero not-published recovery advances once and dispatches one generation one",
  async () => {
    const fixture = await executorHarness({ failGenerationZero: true });
    try {
      const completed = await fixture.executor.execute(
        EXECUTION_AGENT,
        EXECUTION_COMMAND,
      );
      assertEquals(runStatus(completed), "completed");
      assertEquals(fixture.runtime.runs, [0, 1]);
      assertEquals(fixture.runtime.recoveries, [0]);
      assertEquals(fixture.runtime.advances, 1);
    } finally {
      await fixture.dispose();
    }
  },
);

Deno.test("outcome-unknown CAS recovery never cleans, advances, or redispatches", async () => {
  const fixture = await executorHarness({
    failGenerationZero: true,
    outcomeUnknownGeneration: 0,
  });
  try {
    await assertRejects(
      () => fixture.executor.execute(EXECUTION_AGENT, EXECUTION_COMMAND),
      Error,
      "unknown",
    );
    assertEquals(fixture.runtime.runs, [0]);
    assertEquals(fixture.runtime.recoveries, []);
    assertEquals(fixture.runtime.advances, 0);
    await assertRejects(
      () =>
        fixture.executor.execute(EXECUTION_AGENT, {
          ...EXECUTION_COMMAND,
          expectedRevision: fixture.project.revision,
        }),
      Error,
      "unknown",
    );
    assertEquals(fixture.runtime.runs, [0]);
    assertEquals(fixture.runtime.recoveries, []);
    assertEquals(fixture.runtime.advances, 0);
  } finally {
    await fixture.dispose();
  }
});

class FakeAdmissionReader implements TechnicalCompilationAdmissionReader {
  reads = 0;
  constructor(public result: ReopenedTechnicalCompilationAdmission) {}
  read(): Promise<ReopenedTechnicalCompilationAdmission | undefined> {
    this.reads += 1;
    return Promise.resolve(structuredClone(this.result));
  }
}

class FakeProfiles implements AdmittedSpiceExecutionProfileCatalog {
  initialCalls = 0;
  resolveCalls = 0;
  constructor(public profile: AdmittedSpiceExecutionProfile) {}
  initial(): Promise<AdmittedSpiceExecutionProfile> {
    this.initialCalls += 1;
    return Promise.resolve(structuredClone(this.profile));
  }
  resolve(): Promise<AdmittedSpiceExecutionProfile> {
    this.resolveCalls += 1;
    return Promise.resolve(structuredClone(this.profile));
  }
}

async function harness() {
  const sourceText = SPICE_DIVIDER_SOURCE;
  const sourceWorkspace = sampleAdmissionSourceWorkspaceFields(
    "source.spice.divider",
    { projectId: "project.ramp" },
  );
  const sourceCapture = technicalSourceCaptureInput({
    profileId: "spice-circuit-closed-subset-v1",
    sourceId: "source.spice.divider",
    sourceText,
    projectId: "project.ramp",
    attachment: sourceWorkspace.attachment,
    sourceClosure: sourceWorkspace.sourceClosure,
  });
  const analysis = await new SpiceCircuitSourceAnalyzer().analyze({
    sourceId: sourceCapture.sourceId,
    role: "spice-circuit",
    language: "spice",
    sourceText,
  });
  const sourceFingerprint = await fingerprintTechnicalSourceText(sourceText);
  const analysisFingerprint = await fingerprintSourceAnalysisBundle(analysis);
  const sysmlFingerprint = { algorithm: "sha256" as const, digest: "2".repeat(64) };
  const provenance = {
    artifactId: "artifact.sysml",
    artifactFingerprint: sysmlFingerprint,
    captureId: "capture.syson",
  };
  const sysmlAnchor = {
    artifactId: "artifact.sysml",
    artifactFingerprint: sysmlFingerprint,
    captureId: "capture.syson",
    editingContextId: "editing-context.main",
    rootElementId: "sysml.package.main",
    rootElementKind: "Package" as const,
    elements: [
      { id: "sysml.package.main", kind: "Package", provenance },
      { id: "sysml.part.divider", kind: "PartUsage", provenance },
    ],
  };
  const basis: TechnicalCompilationBasis = {
    thread: {
      projectId: "project.ramp",
      subjectId: "subject.ramp",
      snapshotId: "snapshot.7",
      revision: 7,
      snapshotFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
    },
    sysmlAnchor,
    sysmlAnchorFingerprint: await fingerprintTechnicalSysmlAnchor(sysmlAnchor),
  };
  const compilationProfile: TechnicalCompilationProfile = {
    id: "spice-circuit-closed-subset-v1",
    version: "1.0.0",
    target: "spice-circuit-source",
    sourceRole: "spice-circuit",
    language: "spice",
    analyzer: analysis.analyzer,
    analysisPolicyProfile: "spice-circuit-closed-subset-v1",
    requiredBindingSymbolKinds: ["parameter"],
  };
  const compiled = await compileTechnicalSources({
    schemaVersion: TECHNICAL_COMPILATION_INPUT_SCHEMA,
    basis,
    basisFingerprint: await fingerprintTechnicalCompilationBasis(basis),
    sources: [{
      sourceText,
      analysis,
      analysisFingerprint,
      effectiveUnit: sourceCapture.effectiveUnit,
    }],
    bindings: [],
    profileRequests: [{
      profileId: compilationProfile.id,
      profileVersion: compilationProfile.version,
      sourceIds: [analysis.source.id],
    }],
  }, {
    schemaVersion: TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
    profiles: [compilationProfile],
  });
  const projection = compiled.document.projections[0]!;
  const admission = parseTechnicalCompilationAdmissionParameters(
    encodeTechnicalCompilationAdmissionParameters({
      schemaVersion: TECHNICAL_COMPILATION_ADMISSION_SCHEMA,
      draft: {
        draftId: `technical-compilation:project.ramp:${compiled.fingerprint.digest}`,
        projectId: "project.ramp",
        documentFingerprint: compiled.fingerprint,
        envelopeFingerprint: { algorithm: "sha256", digest: "3".repeat(64) },
      },
      basis: {
        fingerprint: compiled.document.basisFingerprint,
        thread: {
          projectId: basis.thread.projectId,
          subjectId: basis.thread.subjectId,
          snapshotId: basis.thread.snapshotId,
          revision: basis.thread.revision,
          fingerprint: basis.thread.snapshotFingerprint,
        },
        sysml: {
          artifactId: basis.sysmlAnchor.artifactId,
          artifactFingerprint: basis.sysmlAnchor.artifactFingerprint,
          captureId: basis.sysmlAnchor.captureId,
          editingContextId: basis.sysmlAnchor.editingContextId,
          rootElementId: basis.sysmlAnchor.rootElementId,
          rootElementKind: basis.sysmlAnchor.rootElementKind,
          anchorFingerprint: basis.sysmlAnchorFingerprint,
        },
      },
      sources: [{
        id: analysis.source.id,
        role: analysis.source.role,
        language: analysis.source.language,
        profileId: compilationProfile.id,
        profileVersion: compilationProfile.version,
        profileFingerprint: await sha256Fingerprint({
          id: compilationProfile.id,
          version: compilationProfile.version,
          role: "spice-circuit",
          language: "spice",
          analyzer: compilationProfile.analyzer,
          maximumSourceBytes: 262_144,
        }),
        analyzer: analysis.analyzer,
        sourceFingerprint,
        captureFingerprint: { algorithm: "sha256", digest: "4".repeat(64) },
        analysisFingerprint,
        effectiveUnit: sourceCapture.effectiveUnit,
        attachment: sourceCapture.attachment,
        sourceClosure: sourceCapture.sourceClosure,
        locator: sourceWorkspace.locator,
      }],
      bindings: compiled.document.inputManifest.bindings,
      compilationProfileRequests: [{
        profileId: compilationProfile.id,
        profileVersion: compilationProfile.version,
        target: "spice-circuit-source",
        sourceIds: [analysis.source.id],
        profileFingerprint: projection.profileFingerprint,
      }],
      compilation: {
        fingerprint: compiled.fingerprint,
        status: "ready-for-review",
      },
    }),
  );
  const artifactFingerprint = await sha256Fingerprint({
    schemaVersion: SPICE_ADMITTED_COMPILED_ADMISSION_SCHEMA,
    projectId: "project.ramp",
    compilation: compiled.fingerprint,
  });
  const command = {
    projectId: "project.ramp",
    basis: {
      kind: "thread-snapshot" as const,
      snapshotId: "snapshot.8",
      revision: 8,
      subjectId: "subject.ramp",
    },
    artifactId: `technical-compilation-admission-${artifactFingerprint.digest}`,
    artifactFingerprint,
  };
  const reopened: ReopenedTechnicalCompilationAdmission = {
    schemaVersion: "technical-compilation-admission-capture/4.0",
    operation: COMPILE_SEAL_ADMISSION_OPERATION,
    trustedRunId: "run.compile.seal",
    decisionId: "decision.compile.seal",
    sealedAt: "2026-08-13T08:00:00.000Z",
    draftReference: {
      schemaVersion: TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA,
      draftId: admission.draft.draftId,
      projectId: admission.draft.projectId,
      documentFingerprint: admission.draft.documentFingerprint,
      envelopeFingerprint: admission.draft.envelopeFingerprint,
    },
    admission,
    document: compiled.document,
  };
  const profileBody: AdmittedSpiceExecutionProfileFingerprintBody = {
    schemaVersion: ADMITTED_SPICE_EXECUTION_PROFILE_SCHEMA,
    executionProfile: SPICE_ADMITTED_EXECUTION_PROFILE,
    compilationTarget: "spice-circuit-source",
    compilationProfile: projection.profile,
    compilationProfileFingerprint: projection.profileFingerprint,
    isolationPolicy: {
      id: "isolation.spice-closed-v1",
      version: "1.0.0",
      fingerprint: await sha256Fingerprint({
        id: "isolation.spice-closed-v1",
        version: "1.0.0",
        network: "deny-all",
      }),
    },
    runtimeBackend: {
      ...MICROSANDBOX_LOCAL_RUNTIME_REF,
      imageReference: `casys/ngspice-microsandbox-worker@sha256:${"5".repeat(64)}`,
      imageDigest: { algorithm: "sha256", digest: "5".repeat(64) },
    },
    runtime: {
      isolationClass: MICROSANDBOX_LOCAL_ISOLATION_CLASS,
      imageDigest: { algorithm: "sha256", digest: "5".repeat(64) },
      requestedLimits: {
        maxWallTimeMs: 30_000,
        maxCpuTimeMs: 25_000,
        maxMemoryBytes: 512 * 1_048_576,
        maxProcesses: 16,
        maxStdoutBytes: 65_536,
        maxStderrBytes: 65_536,
        maxOutputFileBytes: 262_144,
        maxOutputTotalBytes: 524_288,
      },
      limitAssurance: {
        maxWallTimeMs: "backend-attested",
        maxCpuTimeMs: "unattested",
        maxMemoryBytes: "backend-attested",
        maxProcesses: "unattested",
        maxStdoutBytes: "broker-observed-cap",
        maxStderrBytes: "broker-observed-cap",
        maxOutputFileBytes: "broker-observed-cap",
        maxOutputTotalBytes: "broker-observed-cap",
      },
    },
    outputManifest: [...SPICE_ADMITTED_OUTPUT_MANIFEST],
    outputValidator: {
      id: "spice-operating-point-print-vectors",
      version: "1.0.0",
    },
    maximumSourceBytes: 262_144,
    minimumDestructionAssurance: "proven",
  };
  const profile: AdmittedSpiceExecutionProfile = {
    ...profileBody,
    profileFingerprint: await sha256Fingerprint(profileBody),
  };
  const reader = new FakeAdmissionReader(reopened);
  const profiles = new FakeProfiles(profile);
  return {
    command,
    reopened,
    reader,
    profiles,
    review: new PrepareProjectAdmittedSpiceRunReview({
      admissions: reader,
      profiles,
    }),
  };
}

interface ExecutorHarnessOptions {
  readonly rejectExecution?: boolean;
  readonly rejectOutputValidation?: boolean;
  readonly failGenerationZero?: boolean;
  readonly failGenerationOne?: boolean;
  readonly failGenerationOneDestroyOnce?: boolean;
  readonly failFailOnce?: boolean;
  readonly outcomeUnknownGeneration?: 0 | 1;
}

interface ExecutorHarness {
  readonly executor: SimulateRunAdmittedSpiceRunExecutor;
  readonly project: MutableProject;
  readonly attempts: AdmittedSpiceExecutionAttemptStore;
  readonly runtime: FakeAdmittedRuntime;
  readonly captures: FakeAdmittedCaptures;
  readonly snapshots: FakeAdmittedSnapshots;
  readonly profiles: FakeProfiles;
  readonly admissions: FakeAdmissionReader;
  readonly dispose: () => Promise<void>;
}

async function executorHarness(
  options: ExecutorHarnessOptions = {},
): Promise<ExecutorHarness> {
  const source = await harness();
  const admission = (await source.review.execute(source.command)).admission;
  const { basis, lineage } = await admittedThreadLineage(admission);
  const basisRef = {
    snapshotId: basis.id,
    revision: basis.revision,
    subjectId: basis.subject.id,
  };
  const runBasis = { kind: "thread-snapshot" as const, ...basisRef };
  const evidenceRef = {
    snapshotId: basis.id,
    snapshotRevision: basis.revision,
    kind: "artifact" as const,
    id: admission.admissionArtifact.id,
  };
  const proposal = {
    summary: "Execute the exact admitted SPICE source.",
    parameters: encodeSpiceAdmittedRunAdmissionParameters(admission),
  };
  const decisionFingerprint = await sha256Fingerprint({
    baseSnapshot: basisRef,
    inputEvidenceRefs: [evidenceRef],
    proposal,
  });
  const operation = {
    ...SIMULATE_RUN_ADMITTED_SPICE_OPERATION,
    bindings: [{
      name: "compilationAdmission",
      source: { kind: "thread-entity" as const, reference: evidenceRef },
    }],
  };
  const runFingerprint = await sha256Fingerprint({
    workItemId: "work.spice.admitted",
    basis: runBasis,
    operation,
    approvedDecisions: [{
      id: "decision.spice.admitted",
      inputFingerprint: decisionFingerprint,
    }],
  });
  const project = {
    schemaVersion: "4.0",
    id: "project.ramp:r1",
    revision: 1,
    generatedAt: EXECUTION_AT,
    project: {
      id: EXECUTION_COMMAND.projectId,
      name: "Ramp",
      subjectId: basis.subject.id,
      objective: { title: "Ramp", statement: "Execute admitted SPICE." },
    },
    threadSnapshots: [basisRef],
    phases: [{
      id: "phase.simulate",
      name: "Simulate",
      order: 1,
      description: "Run admitted SPICE.",
      workItemIds: ["work.spice.admitted"],
      requiredDecisionIds: ["decision.spice.admitted"],
      evidenceRefs: [],
    }],
    workItems: [{
      id: "work.spice.admitted",
      activityId: "activity:work.spice.admitted",
      phaseId: "phase.simulate",
      title: "Run admitted SPICE",
      description: "Run the sealed source.",
      kind: "simulate",
      operation,
      status: "in-progress",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: ["decision.spice.admitted"],
      blockerIds: [],
    }],
    agentRuns: [{
      id: EXECUTION_COMMAND.runId,
      workItemId: "work.spice.admitted",
      status: "queued",
      summary: "Run admitted SPICE.",
      queuedAt: EXECUTION_AT,
      basis: runBasis,
      inputFingerprint: runFingerprint,
      evidenceRefs: [],
      statusHistory: [],
    }],
    decisions: [{
      id: "decision.spice.admitted",
      phaseId: "phase.simulate",
      title: "Admitted SPICE run",
      question: "Execute this admission?",
      status: "approved",
      requestedAt: EXECUTION_AT,
      baseSnapshot: basisRef,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [evidenceRef],
      approvalIds: ["approval.spice.admitted"],
      proposal: {
        ...proposal,
        proposedAt: EXECUTION_AT,
        proposedBy: { id: EXECUTION_AGENT.actorId, origin: EXECUTION_AGENT.kind },
      },
    }],
    approvals: [{
      id: "approval.spice.admitted",
      decisionId: "decision.spice.admitted",
      status: "approved",
      requestedAt: EXECUTION_AT,
      decidedAt: EXECUTION_AT,
      decidedBy: "human.reviewer",
      decidedByOrigin: "human",
      baseSnapshot: basisRef,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [evidenceRef],
    }],
    blockers: [],
    commandReceipts: [],
  } as unknown as MutableProject;
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-admitted-spice-executor-" }),
  );
  const attempts = new FileAdmittedSpiceExecutionAttemptStore(
    `${directory}/attempts`,
  );
  const runtime = new FakeAdmittedRuntime(source.profiles.profile, options);
  const captures = new FakeAdmittedCaptures();
  const snapshots = new FakeAdmittedSnapshots(lineage);
  const commands = new FakeAdmittedCommands(project, options);
  const projects: EngineeringProjectRevisionStore = {
    get: () => Promise.resolve(project),
    getRevision: (_projectId, revision) =>
      Promise.resolve(commands.reopenRevision(revision)),
    createInitial: () => Promise.reject(new Error("unused")),
    commit: () => Promise.reject(new Error("unused")),
  };
  const executor = new SimulateRunAdmittedSpiceRunExecutor({
    projects,
    commands,
    snapshots,
    admissions: source.reader,
    profiles: source.profiles,
    runner: runtime,
    recovery: runtime,
    publications: runtime,
    attempts,
    captures,
    lease: new FileEngineeringProjectRunLease(`${directory}/leases`),
  } as unknown as SimulateRunAdmittedSpiceRunExecutorDependencies);
  return {
    executor,
    project,
    attempts,
    runtime,
    captures,
    snapshots,
    profiles: source.profiles,
    admissions: source.reader,
    dispose: () => Deno.remove(directory, { recursive: true }),
  };
}

async function admittedThreadLineage(
  admission: SpiceAdmittedRunAdmission,
): Promise<{ readonly basis: ThreadSnapshot; readonly lineage: ThreadSnapshot[] }> {
  const modelFingerprint = await sha256Fingerprint({ model: "ramp" });
  const modelArtifact = {
    id: "artifact.model.ramp",
    name: "Ramp model",
    kind: "sysml-model" as const,
    version: modelFingerprint.digest,
    fingerprint: modelFingerprint,
    uri: `casys://sysml/sha256/${modelFingerprint.digest}`,
    mediaType: "application/json",
    producer: { serverId: "syson", tool: "capture", runId: "run.syson" },
    inputArtifactIds: [],
    freshness: freshAt(),
  };
  let current = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "snapshot.ramp.1",
    revision: 1,
    generatedAt: EXECUTION_AT,
    subject: {
      id: "subject.ramp",
      name: "Ramp",
      kind: "system",
      version: "1",
      modelArtifactId: modelArtifact.id,
    },
    freshness: freshAt(),
    changeSet: {
      id: "changes.ramp.1",
      name: "Ramp baseline",
      status: "applied",
      createdAt: EXECUTION_AT,
      appliedAt: EXECUTION_AT,
      changes: [{
        id: "change.artifact.model.ramp",
        kind: "created",
        target: { kind: "artifact", id: modelArtifact.id },
        summary: "Created the Ramp model.",
        afterFingerprint: modelArtifact.fingerprint,
      }],
    },
    artifacts: [modelArtifact],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "provenance.artifact.model.ramp",
      relation: "changes",
      from: { kind: "change", id: "change.artifact.model.ramp" },
      to: { kind: "artifact", id: modelArtifact.id },
      rationale: "Created the Ramp model.",
    }],
    proposedActions: [],
  });
  const lineage = [current];
  for (let revision = 2; revision <= 7; revision += 1) {
    const fingerprint = await sha256Fingerprint({ revision });
    const artifact = {
      id: `artifact.ramp.history.${revision}`,
      name: `Ramp history ${revision}`,
      kind: "document" as const,
      version: fingerprint.digest,
      fingerprint,
      uri: `casys://history/sha256/${fingerprint.digest}`,
      mediaType: "application/json",
      producer: {
        serverId: "digital-thread",
        tool: "history.record@1",
        runId: `run.history.${revision}`,
      },
      inputArtifactIds: [],
      freshness: freshAt(),
    };
    const applied = applyThreadSnapshotExtensionIfNew(current, {
      id: `history-${revision}`,
      name: `History ${revision}`,
      subjectId: current.subject.id,
      capturedAt: EXECUTION_AT,
      artifacts: [artifact],
      consumptions: [],
      observations: [],
      requirements: [],
      evaluations: [],
      violations: [],
      provenance: [],
      proposedActions: [],
    }, { appliedAt: EXECUTION_AT });
    assert(applied.applied);
    current = validateThreadSnapshot(applied.snapshot);
    lineage.push(current);
  }
  const admittedDigest = admission.admissionArtifact.fingerprint.digest;
  const admissionArtifact = {
    id: admission.admissionArtifact.id,
    name: "SPICE technical compilation admission",
    kind: "document" as const,
    version: admittedDigest,
    fingerprint: admission.admissionArtifact.fingerprint,
    uri: `casys://technical-compilation-admission-capture/sha256/${admittedDigest}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "compile.seal-admission@3",
      runId: "run.compile.seal",
    },
    inputArtifactIds: [],
    freshness: freshAt(),
  };
  const applied = applyThreadSnapshotExtensionIfNew(current, {
    id: "admitted-spice-basis",
    name: "Admitted SPICE basis",
    subjectId: current.subject.id,
    capturedAt: EXECUTION_AT,
    artifacts: [admissionArtifact],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  }, { appliedAt: EXECUTION_AT });
  assert(applied.applied);
  const basis = validateThreadSnapshot(applied.snapshot);
  lineage.push(basis);
  return { basis, lineage };
}

class FakeAdmittedRuntime {
  readonly runs: number[] = [];
  readonly requests: IsolatedCodeExecutionRequest[] = [];
  readonly recoveries: number[] = [];
  readonly resolves: number[] = [];
  advances = 0;
  readonly #receipts = new Map<number, IsolatedCodeExecutionReceipt>();
  readonly #bytes = new Map<string, Uint8Array>();
  #advance?: Promise<IsolatedOutputProducerGenerationAdvance>;
  #generationOneDestroyFailed = false;

  constructor(
    readonly profile: AdmittedSpiceExecutionProfile,
    readonly options: ExecutorHarnessOptions,
  ) {}

  async run(request: IsolatedCodeExecutionRequest) {
    this.runs.push(request.producerGeneration);
    this.requests.push(request);
    if (this.options.failGenerationZero && request.producerGeneration === 0) {
      throw new Error("generation-zero acknowledgement lost before publication");
    }
    if (this.options.failGenerationOne && request.producerGeneration === 1) {
      throw new Error("generation-one acknowledgement lost before publication");
    }
    if (this.options.rejectOutputValidation) {
      throw new IsolatedCodeOutputValidationRejectedError(
        { role: "evidence", byteCount: 32, sha256: "7".repeat(64) },
        {
          status: "proven",
          runId: request.runId,
          proofFingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
        },
      );
    }
    if (this.options.rejectExecution) {
      const diagnostic = await createIsolatedCodeExecutionRejectionDiagnostic({
        termination: { kind: "exited", exitCode: 1, signal: null },
        logs: {
          stdout: { bytes: new Uint8Array(), truncated: false },
          stderr: {
            bytes: new TextEncoder().encode("ngspice: circuit failed\n"),
            truncated: false,
          },
        },
        maximumLogBytes: { stdout: 1_024, stderr: 1_024 },
      });
      throw new IsolatedCodeExecutionRejectedError(diagnostic, {
        status: "proven",
        runId: request.runId,
        proofFingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
      });
    }
    const receipt = await this.#receipt(request);
    this.#receipts.set(request.producerGeneration, receipt);
    return receipt;
  }

  resolvePublicationByRunId(runId: string, producerGeneration: 0 | 1) {
    this.resolves.push(producerGeneration);
    if (this.options.outcomeUnknownGeneration === producerGeneration) {
      return Promise.resolve({
        status: "outcome-unknown" as const,
        runId,
        producerGeneration,
      });
    }
    const receipt = this.#receipts.get(producerGeneration);
    return Promise.resolve(
      receipt
        ? {
          status: "published" as const,
          runId,
          producerGeneration,
          ref: receipt.publication.ref,
          receipt: isolatedCodeExecutionReceiptRecord(receipt),
        }
        : { status: "not-published" as const, runId, producerGeneration },
    );
  }

  readReceipt(ref: { readonly producerGeneration: 0 | 1 }) {
    return Promise.resolve(this.#receipts.get(ref.producerGeneration));
  }

  readPublishedObject(
    _ref: unknown,
    member: { readonly role: string },
  ) {
    return Promise.resolve(this.#bytes.get(member.role)?.slice());
  }

  destroyByRunId(runId: string, producerGeneration: 0 | 1) {
    if (
      this.options.failGenerationOneDestroyOnce &&
      producerGeneration === 1 &&
      !this.#generationOneDestroyFailed
    ) {
      this.#generationOneDestroyFailed = true;
      throw new Error("generation-one cleanup unproven");
    }
    this.recoveries.push(producerGeneration);
    return Promise.resolve({
      status: "proven" as const,
      runId,
      proofFingerprint: {
        algorithm: "sha256" as const,
        digest: producerGeneration === 0 ? "8".repeat(64) : "9".repeat(64),
      },
    });
  }

  advanceProducerGeneration(input: {
    readonly runId: string;
    readonly closedGeneration: 0;
    readonly nextGeneration: 1;
  }) {
    if (!this.#advance) {
      this.advances += 1;
      this.#advance = createIsolatedOutputProducerGenerationAdvance(input);
    }
    return this.#advance;
  }

  async #receipt(request: IsolatedCodeExecutionRequest) {
    const resultBytes = new TextEncoder().encode(deterministicJson({
      schemaVersion: SPICE_OPERATING_POINT_RESULT_SCHEMA,
      analysisKind: "operating-point",
      signConvention: SPICE_OPERATING_POINT_SIGN_CONVENTION,
      observables: DIVIDER_OBSERVABLES,
    }));
    const resultSha256 = await fingerprintResourceBytes(resultBytes);
    const evidenceBytes = new TextEncoder().encode(deterministicJson({
      schemaVersion: SPICE_ISOLATED_EVIDENCE_SCHEMA,
      status: "succeeded",
      analysisKind: "operating-point",
      inputSourceSha256: request.source.sha256,
      profile: SPICE_CIRCUIT_CLOSED_SUBSET_EXECUTION_PROFILE,
      wrapper: SPICE_OPERATING_POINT_WRAPPER,
      method: {
        engine: { name: "ngspice", version: "42" },
        export: SPICE_OPERATING_POINT_EXPORT,
      },
      counts: {
        sourceBytes: request.source.bytes.byteLength,
        observableCount: DIVIDER_OBSERVABLES.length,
        nodeVoltageCount: 2,
        branchCurrentCount: 3,
      },
      limits: {
        maxSourceBytes: SPICE_ADMITTED_MAX_SOURCE_BYTES,
        maxObservables: SPICE_ADMITTED_MAX_OBSERVABLES,
        maxResultBytes: SPICE_ADMITTED_MAX_RESULT_BYTES,
        maxEvidenceBytes: SPICE_ADMITTED_MAX_EVIDENCE_BYTES,
        maxVectorBytes: SPICE_ADMITTED_MAX_VECTOR_BYTES,
        maxDurationMs: SPICE_ADMITTED_MAX_DURATION_MS,
      },
      limitations: SPICE_ISOLATED_EVIDENCE_LIMITATIONS,
      warnings: [],
      result: {
        role: "result",
        basename: "result.json",
        byteCount: resultBytes.byteLength,
        sha256: resultSha256,
      },
    }));
    this.#bytes.set("evidence", evidenceBytes);
    this.#bytes.set("result", resultBytes);
    const outputs = await Promise.all(
      this.profile.outputManifest.map(async (declaration) => {
        const bytes = this.#bytes.get(declaration.role)!;
        const sha256 = await fingerprintResourceBytes(bytes);
        return {
          ...declaration,
          bytes,
          byteCount: bytes.byteLength,
          sha256,
          casUri: `casys://isolated-output/sha256/${sha256}`,
        };
      }),
    );
    const publication = await createIsolatedOutputPublicationRef(
      request.runId,
      request.producerGeneration,
      await fingerprintIsolatedOutputPublicationManifest(
        request.runId,
        request.producerGeneration,
        outputs.map(({ bytes: _bytes, ...output }) => output),
      ),
    );
    return await createIsolatedCodeExecutionReceipt({
      request: await validateIsolatedCodeExecutionRequest(request),
      runtime: this.profile.runtime,
      termination: { kind: "exited", exitCode: 0, signal: null },
      logs: {
        stdout: { bytes: new Uint8Array(), truncated: false },
        stderr: { bytes: new Uint8Array(), truncated: false },
      },
      outputs,
      destruction: {
        status: "proven",
        runId: request.runId,
        proofFingerprint: { algorithm: "sha256", digest: "7".repeat(64) },
      },
      publication,
    });
  }
}

class FakeAdmittedCaptures {
  readonly items = new Map<string, string>();
  saveCalls = 0;

  save(
    fingerprint: { readonly algorithm: "sha256"; readonly digest: string },
    canonicalText: string,
  ) {
    this.saveCalls += 1;
    this.items.set(fingerprint.digest, canonicalText);
    return Promise.resolve({
      uri: this.uriFor(fingerprint),
      fingerprint,
    });
  }

  read(fingerprint: { readonly digest: string }) {
    return Promise.resolve(this.items.get(fingerprint.digest));
  }

  uriFor(fingerprint: { readonly digest: string }) {
    return `casys://spice-admitted-execution-capture/sha256/${fingerprint.digest}`;
  }
}

class FakeAdmittedSnapshots {
  readonly items = new Map<string, ThreadSnapshot>();
  saveCalls = 0;

  constructor(snapshots: ThreadSnapshot[]) {
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
        left,
        right,
      ) => right.revision - left.revision)[0];
    return Promise.resolve(value && structuredClone(value));
  }

  save(snapshot: ThreadSnapshot) {
    this.saveCalls += 1;
    this.items.set(snapshot.id, structuredClone(snapshot));
    return Promise.resolve();
  }
}

class FakeAdmittedCommands {
  readonly #revisions = new Map<number, MutableProject>();
  readonly #failFailOnce: boolean;
  #failedFail = false;

  constructor(
    readonly project: MutableProject,
    options: ExecutorHarnessOptions = {},
  ) {
    this.#failFailOnce = options.failFailOnce === true;
    this.#revisions.set(project.revision, structuredClone(project));
  }

  reopenRevision(revision: number): EngineeringProjectSnapshot | undefined {
    const snapshot = this.#revisions.get(revision);
    return snapshot && structuredClone(snapshot);
  }

  async claimRun(origin: EngineeringProjectCommandOrigin, command: RunCommand) {
    const run = this.project.agentRuns[0] as MutableRun;
    if (run.status === "queued") {
      run.status = "running";
      run.startedAt = EXECUTION_AT;
      run.claimedAt = EXECUTION_AT;
      run.claimedBy = { id: origin.actorId, origin: origin.kind };
      await this.#receipt("agent-run.claim", origin, command);
      return this.project;
    }
    return this.project;
  }

  async publishRun(origin: EngineeringProjectCommandOrigin, command: RunCommand) {
    const run = this.project.agentRuns[0] as MutableRun;
    if (run.status === "running") {
      run.status = "publishing";
      await this.#receipt("agent-run.publish", origin, command);
      return this.project;
    }
    return this.project;
  }

  async completeRun(
    origin: EngineeringProjectCommandOrigin,
    command: CompleteRunCommand,
  ) {
    const run = this.project.agentRuns[0] as MutableRun;
    if (run.status === "publishing") {
      run.status = "completed";
      run.completedAt = EXECUTION_AT;
      run.resultSnapshot = command.resultSnapshot;
      run.evidenceRefs = [...command.evidenceRefs];
      const work = this.project.workItems[0] as MutableWork;
      work.status = "completed";
      work.evidenceRefs = [...command.evidenceRefs];
      (this.project.phases[0] as MutablePhase).evidenceRefs = [
        ...command.evidenceRefs,
      ];
      this.project.threadSnapshots.push(command.resultSnapshot);
      await this.#receipt("agent-run.complete", origin, command);
      return this.project;
    }
    return this.project;
  }

  async failRun(origin: EngineeringProjectCommandOrigin, command: FailRunCommand) {
    if (this.#failFailOnce && !this.#failedFail) {
      this.#failedFail = true;
      throw new Error("fail acknowledgement lost");
    }
    const run = this.project.agentRuns[0] as MutableRun;
    if (run.status === "running" || run.status === "publishing") {
      run.status = "failed";
      run.completedAt = EXECUTION_AT;
      run.failure = { code: command.code, message: command.message };
      const work = this.project.workItems[0] as MutableWork;
      work.status = "ready";
      await this.#receipt("agent-run.fail", origin, command);
      return this.project;
    }
    return this.project;
  }

  async #receipt(
    type:
      | "agent-run.claim"
      | "agent-run.publish"
      | "agent-run.complete"
      | "agent-run.fail",
    origin: EngineeringProjectCommandOrigin,
    command: RunCommand | CompleteRunCommand | FailRunCommand,
  ) {
    this.project.revision += 1;
    this.project.id = `project.ramp:r${this.project.revision}`;
    this.project.generatedAt = EXECUTION_AT;
    this.project.commandReceipts.push({
      commandId: command.commandId,
      type,
      actor: { id: origin.actorId, origin: origin.kind },
      issuedAt: command.issuedAt,
      appliedAt: EXECUTION_AT,
      requestFingerprint: await sha256Fingerprint({ type, origin, command }),
      resultingSnapshot: {
        snapshotId: `project.ramp:r${this.project.revision}`,
        revision: this.project.revision,
      },
    });
    const run = this.project.agentRuns[0] as MutableRun;
    run.summary = command.summary;
    const status = type === "agent-run.claim"
      ? "running" as const
      : type === "agent-run.publish"
      ? "publishing" as const
      : type === "agent-run.fail"
      ? "failed" as const
      : "completed" as const;
    run.statusHistory = [...(run.statusHistory ?? []), {
      commandId: command.commandId,
      status,
      at: EXECUTION_AT,
      actor: { id: origin.actorId, origin: origin.kind },
      summary: command.summary,
    }];
    this.#revisions.set(this.project.revision, structuredClone(this.project));
  }
}

function freshAt() {
  return {
    status: "fresh" as const,
    changedAt: EXECUTION_AT,
    invalidatedByChangeIds: [],
  };
}

function runStatus(project: EngineeringProjectSnapshot) {
  return project.agentRuns.find((run) => run.id === EXECUTION_COMMAND.runId)?.status;
}

async function retireHarnessProfile(profiles: FakeProfiles): Promise<void> {
  const digest = "a".repeat(64);
  const { profileFingerprint: _fingerprint, ...body } = {
    ...profiles.profile,
    runtimeBackend: {
      ...profiles.profile.runtimeBackend,
      imageReference: `casys/ngspice-microsandbox-worker@sha256:${digest}`,
      imageDigest: { algorithm: "sha256" as const, digest },
    },
    runtime: {
      ...profiles.profile.runtime,
      imageDigest: { algorithm: "sha256" as const, digest },
    },
  };
  profiles.profile = {
    ...body,
    profileFingerprint: await sha256Fingerprint(body),
  };
}

type MutableProject = EngineeringProjectSnapshot & {
  id: string;
  revision: number;
  generatedAt: string;
  threadSnapshots: Array<EngineeringProjectSnapshot["threadSnapshots"][number]>;
  phases: Array<EngineeringProjectSnapshot["phases"][number]>;
  workItems: Array<EngineeringProjectSnapshot["workItems"][number]>;
  agentRuns: Array<EngineeringProjectSnapshot["agentRuns"][number]>;
  commandReceipts: EngineeringProjectCommandReceipt[];
};
type MutableRun = {
  -readonly [Key in keyof MutableProject["agentRuns"][number]]:
    MutableProject["agentRuns"][number][Key];
};
type MutableWork = {
  -readonly [Key in keyof MutableProject["workItems"][number]]:
    MutableProject["workItems"][number][Key];
};
type MutablePhase = {
  -readonly [Key in keyof MutableProject["phases"][number]]:
    MutableProject["phases"][number][Key];
};
