import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  approvedBriefBasisForProject,
  EngineeringProjectCommandError,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "../../../application/use-cases/project/project-brief-command-service.ts";
import {
  type EngineeringProjectRevisionStore,
  EngineeringProjectStoreConflictError,
} from "../../../application/ports/out/engineering-project-revision-store.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type {
  EngineeringDecisionProposalParameter,
  EngineeringProjectSnapshot,
} from "../../../domain/project/engineering-project.ts";
import type { ProjectBriefItem } from "../../../domain/project/project-brief.ts";
import {
  buildRequirementsBriefProvenance,
  type RequirementsBriefProvenance,
} from "../../../domain/architecture/requirements/requirements-brief-provenance.ts";
import {
  MODEL_WRITE_TRACED_REQUIREMENTS_OPERATION,
  parseTracedRequirementsProposalParameters,
} from "../../../domain/architecture/requirements/requirements-traced-proposal.ts";
import {
  encodeTracedRequirementsRecaptureParameters,
  MODEL_RECAPTURE_TRACED_REQUIREMENTS_OPERATION,
} from "../../../domain/architecture/requirements/requirements-traced-recapture-proposal.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import {
  ARCHITECTURE_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
  REQUIREMENTS_CAPTURE_DESCRIPTOR,
  SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR,
} from "../../shared/cas/file-capture-store.ts";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "../../../application/ports/out/mcp-tool-client.ts";
import type { EngineeringProjectRunLease } from "../../shared/stores/file-engineering-project-run-lease.ts";
import { ARCHITECTURE_FEATURE_TYPING_AQL } from "../renderer/architecture-structure-extractor.ts";
import { PrepareProjectRequirementsRecaptureReview } from "./capture-backed-requirements-recapture-reviewer.ts";
import type { SysmlSourceAnalysisReader } from "../renderer/sysml-source-analysis-capture.ts";
import {
  architectureUsesRationale,
  predecessorUsesRationale,
} from "./requirements-thread-projection.ts";
import { archivedRefKeys } from "../../../domain/thread/thread-snapshot.ts";
import { encodeRequirementsRecaptureParameters } from "../../../domain/architecture/requirements/requirements-recapture-proposal.ts";
import { MODEL_RECAPTURE_REQUIREMENTS_OPERATION } from "../../../domain/architecture/requirements/requirements-recapture-proposal.ts";
import { ModelRecaptureRequirementsRunExecutor } from "./model-recapture-requirements-run-executor.ts";
import {
  ModelWriteRequirementsRunExecutor,
} from "./model-write-requirements-run-executor.ts";
import { FileRequirementsAttemptStore } from "./file-requirements-attempt-store.ts";
import { FileEngineeringProjectRunLease } from "../../shared/stores/file-engineering-project-run-lease.ts";
import { FileRequirementsRecapturePublicationStore } from "./file-requirements-recapture-publication-store.ts";
import {
  passthroughCapabilityRuntimeConnection,
  recordingCapabilityRuntimeSession,
  successfulCapabilityRuntimeFor,
} from "../../../testing/capability-runtime-execution-session-test-support.ts";
import { parseExactRequirementsCapture } from "./requirements-capture.ts";

const PROJECT_ID = "project:lamp";
const SUBJECT_ID = "subject:lamp";
const RUN_ID = "run:recapture-requirements";
const ARCH_RUN_ID = "run:architecture";
const ARCH_SUCCESSOR_RUN_ID = "run:architecture-successor";
const ARCH_SECOND_SUCCESSOR_RUN_ID = "run:architecture-second-successor";
const SEED_RUN_ID = "run:seed";
const FOREIGN_SEED_RUN_ID = "run:seed-foreign";
const REQ_RUN_ID = "run:requirements";
const TIME = "2026-08-08T12:00:00.000Z";
const SUCCESSOR_AT = "2026-08-08T13:00:00.000Z";
const SECOND_SUCCESSOR_AT = "2026-08-08T14:00:00.000Z";
const EDITING_CONTEXT_ID = "ctx-from-seed-cas";
const ROOT_PACKAGE_ID = "root-package-id";
const PACKAGE_ID = "package-lamp";
const PACKAGE_NAME = "LampPackage";
const SYSTEM_ID = "part-def-system";
const ARM_ID = "part-def-arm";
const USAGE_ID = "part-usage-arm";
const REQ_USAGE_ID = "requirement-usage-arm";
const REQ_SUBJECT_ID = "reference-usage-arm-target";
const REQ_CONSTRAINT_ID = "constraint-usage-arm-mass";
const AGENT = { kind: "agent" as const, actorId: "agent-1" };
const HUMAN = { kind: "human" as const, actorId: "operator-1" };

Deno.test("requirements recapture review resolves after a successor architecture", async () => {
  const fixture = await recaptureFixture();
  const result = await fixture.review.execute({ projectId: PROJECT_ID });
  assertEquals(result.status, "resolved");
  if (result.status !== "resolved") return;
  assertEquals(result.operation.id, "model.recapture-requirements");
  assertEquals(result.admission.target.elementId, ARM_ID);
  assertEquals(
    result.decisionParameters,
    encodeRequirementsRecaptureParameters(result.admission),
  );
});

Deno.test("requirements recapture review refuses a same-architecture no-op", async () => {
  const fixture = await recaptureFixture({ sameArchitecture: true });
  const result = await fixture.review.execute({ projectId: PROJECT_ID });
  assertEquals(result.status, "unresolved");
  if (result.status !== "unresolved") return;
  assertEquals(result.diagnostics[0]?.code, "same-architecture-noop");
});

Deno.test("requirements recapture review requires targetElementId among multiple families", async () => {
  const fixture = await recaptureFixture({ extraFamily: true });
  const missing = await fixture.review.execute({ projectId: PROJECT_ID });
  assertEquals(missing.status, "unresolved");
  if (missing.status === "unresolved") {
    assertEquals(missing.diagnostics[0]?.code, "target-required");
  }
  const selected = await fixture.review.execute({
    projectId: PROJECT_ID,
    targetElementId: ARM_ID,
  });
  assertEquals(selected.status, "resolved");
});

Deno.test("requirements recapture executor publishes v4 and archives prior requirements", async () => {
  const fixture = await recaptureFixture({ extraFamily: true });
  const completed = await fixture.executor().execute(AGENT, fixture.command());
  assertEquals(completed.agentRuns[0]!.status, "completed");
  const snapshot = await fixture.snapshots.get(
    completed.agentRuns[0]!.resultSnapshot!.snapshotId,
  );
  assert(snapshot);
  const evidenceId = completed.agentRuns[0]!.evidenceRefs[0]!.id;
  const artifact = snapshot.artifacts.find((item) => item.id === evidenceId);
  assert(artifact);
  assertEquals(artifact.producer.tool, "syson_constraint_extract");
  const text = await fixture.requirementsCaptures.read(artifact.fingerprint);
  const capture = parseExactRequirementsCapture(JSON.parse(text!));
  assertEquals(capture.schemaVersion, "requirements-capture/4.0");
  if (capture.schemaVersion === "requirements-capture/4.0") {
    assertEquals(capture.subject.id, REQ_SUBJECT_ID);
    assertEquals(capture.predecessor.artifactId, fixture.predecessor.id);
  }
  const archived = archivedRefKeys(snapshot);
  const priorRequirementId =
    `requirement-${fixture.predecessor.fingerprint.digest}-maxMass`;
  assertEquals(archived.has(`requirement:${priorRequirementId}`), true);
  assertEquals(archived.has("evaluation:eval-arm-old"), true);
  assertEquals(archived.has("evaluation:eval-arm-fail"), true);
  assertEquals(archived.has("violation:viol-arm-old"), true);
  assertEquals(
    snapshot.requirements.some((item) => item.id === priorRequirementId),
    true,
  );
  assertEquals(
    snapshot.evaluations.some((item) => item.id === "eval-arm-old"),
    true,
  );
  assertEquals(
    snapshot.violations.some((item) => item.id === "viol-arm-old"),
    true,
  );
  assertEquals(archived.has("evaluation:eval-system-active"), false);
  const systemRequirement = snapshot.requirements.find((item) =>
    item.id.startsWith("requirement-") &&
    item.trace.elementId === "requirement-usage-system"
  );
  assert(systemRequirement);
  assertEquals(
    snapshot.evaluations.some((item) =>
      item.id === "eval-system-active" &&
      item.requirementId === systemRequirement.id &&
      item.freshness.status === "fresh"
    ),
    true,
  );
  const newRequirement = snapshot.requirements.find((item) =>
    item.trace.sourceArtifactId === evidenceId
  );
  assert(newRequirement);
  assertEquals(
    snapshot.evaluations.some((item) => item.requirementId === newRequirement.id),
    false,
  );
  assertEquals(
    await fixture.requirementsCaptures.read(fixture.predecessor.fingerprint),
    deterministicJson(parseExactRequirementsCapture(
      JSON.parse(
        (await fixture.requirementsCaptures.read(
          fixture.predecessor.fingerprint,
        ))!,
      ),
    )),
  );
  assert(
    snapshot.artifacts.some((item) => item.id === fixture.predecessor.id),
    "historical predecessor entity must be preserved",
  );
  assertEquals(
    fixture.syson.calls.some((call) => call.name === "syson_element_insert_sysml"),
    false,
  );
  assertEquals(
    fixture.syson.calls.some((call) => call.name === "syson_element_delete"),
    false,
  );
});

Deno.test("requirements recapture publication resume never opens a second SysON client", async () => {
  const fixture = await recaptureFixture({ failSnapshotOnce: true });
  const events: string[] = [];
  const connection = passthroughCapabilityRuntimeConnection(
    fixture.syson as unknown as McpToolClient,
    events,
  );
  const capability = successfulCapabilityRuntimeFor(
    PROJECT_ID,
    MODEL_RECAPTURE_REQUIREMENTS_OPERATION,
    "model.inspect-system",
  );
  const executor = () =>
    new ModelRecaptureRequirementsRunExecutor({
      ...fixture.deps(),
      capabilityRuntimeConnection: connection,
      syson: undefined,
      capabilityRuntime: capability.capabilityRuntime,
      capabilityRuntimeSession: capability.capabilityRuntimeSession,
    });
  await assertRejects(() => executor().execute(AGENT, fixture.command()));
  assertEquals(connection.opens, 1);
  fixture.syson.failIfCalled = true;
  const completed = await executor().execute(AGENT, fixture.command());
  assertEquals(completed.agentRuns[0]!.status, "completed");
  assertEquals(connection.opens, 1);
});

Deno.test("recapture opens the inspect broker after JIT and before claim", async () => {
  const fixture = await recaptureFixture();
  const events: string[] = [];
  const lease = { id: "capability-jit-recapture" } as never;
  const session = recordingCapabilityRuntimeSession(async (input) => {
    events.push("begin");
    await input.recheck();
    return {
      lease,
      releaseTerminal: () => Promise.resolve(),
      retainForRecovery: () => undefined,
    };
  });
  const originalCall = fixture.syson.callTool.bind(fixture.syson);
  fixture.syson.callTool = (call) => {
    events.push(`provider:${call.name}`);
    return originalCall(call);
  };
  const deps = fixture.deps();
  const commands = deps.commands as {
    claimRun: (
      origin: unknown,
      command: unknown,
    ) => Promise<void>;
  };
  const originalClaim = commands.claimRun.bind(commands);
  commands.claimRun = (origin, command) => {
    events.push("claim");
    return originalClaim(origin, command);
  };
  const connection = passthroughCapabilityRuntimeConnection(
    fixture.syson as unknown as McpToolClient,
    events,
  );
  const capability = successfulCapabilityRuntimeFor(
    PROJECT_ID,
    MODEL_RECAPTURE_REQUIREMENTS_OPERATION,
    "model.inspect-system",
  );
  await new ModelRecaptureRequirementsRunExecutor({
    ...deps,
    capabilityRuntimeConnection: connection,
    syson: undefined,
    capabilityRuntime: capability.capabilityRuntime,
    capabilityRuntimeSession: session,
  }).execute(AGENT, fixture.command());
  assertEquals(events[0], "begin");
  assertEquals(events.indexOf("begin") < events.indexOf("connect"), true);
  assertEquals(events.indexOf("connect") < events.indexOf("open"), true);
  assertEquals(events.indexOf("open") < events.indexOf("claim"), true);
  assertEquals(
    events.indexOf("claim") <
      events.findIndex((event) => event.startsWith("provider:")),
    true,
  );
  assertEquals(connection.requests[0]?.binding, {
    id: "model.inspect-system-binding",
    version: "1",
  });
});

Deno.test("unqualified inspect capability does not claim or call SysON", async () => {
  const fixture = await recaptureFixture();
  await assertRejects(
    () =>
      new ModelRecaptureRequirementsRunExecutor({
        ...fixture.deps(),
        capabilityRuntime: undefined,
        capabilityRuntimeSession: undefined,
      }).execute(AGENT, fixture.command()),
    EngineeringProjectCommandError,
  );
  assertEquals(fixture.syson.calls, []);
  assertEquals(fixture.project.agentRuns[0]!.status, "queued");
});

Deno.test("native metric drift refuses recapture publication", async () => {
  const fixture = await recaptureFixture({ driftedMetric: true });
  await assertRejects(
    () => fixture.executor().execute(AGENT, fixture.command()),
    EngineeringProjectCommandError,
  );
  assertEquals(await fixture.publications.read(PROJECT_ID, RUN_ID), undefined);
});

Deno.test("a quarantined writer sibling blocks recapture", async () => {
  const fixture = await recaptureFixture({ writerSibling: true });
  const result = await fixture.review.execute({ projectId: PROJECT_ID });
  assertEquals(result.status, "unresolved");
  if (result.status === "unresolved") {
    assertEquals(result.diagnostics[0]?.code, "writer-sibling-uncertain");
  }
});

Deno.test("only an authenticated agent can recapture requirements", async () => {
  const fixture = await recaptureFixture();
  await assertRejects(
    () => fixture.executor().execute(HUMAN, fixture.command()),
    Error,
    "Only an authenticated agent",
  );
  assertEquals(fixture.syson.calls, []);
});

Deno.test("completed recapture replay ignores a later Thread successor and never reopens SysON", async () => {
  const fixture = await recaptureFixture();
  const events: string[] = [];
  const connection = passthroughCapabilityRuntimeConnection(
    fixture.syson as unknown as McpToolClient,
    events,
  );
  const capability = successfulCapabilityRuntimeFor(
    PROJECT_ID,
    MODEL_RECAPTURE_REQUIREMENTS_OPERATION,
    "model.inspect-system",
  );
  const executor = () =>
    new ModelRecaptureRequirementsRunExecutor({
      ...fixture.deps(),
      capabilityRuntimeConnection: connection,
      syson: undefined,
      capabilityRuntime: capability.capabilityRuntime,
      capabilityRuntimeSession: capability.capabilityRuntimeSession,
    });
  const completed = await executor().execute(AGENT, fixture.command());
  assertEquals(completed.agentRuns[0]!.status, "completed");
  const providerCalls = fixture.syson.calls.length;
  fixture.syson.failIfCalled = true;
  const replayed = await executor().execute(AGENT, fixture.command());
  assertEquals(replayed.agentRuns[0]!.status, "completed");
  assertEquals(fixture.syson.calls.length, providerCalls);
  const laterBase = (await fixture.snapshots.get(
    completed.agentRuns[0]!.resultSnapshot!.snapshotId,
  ))!;
  const later = {
    ...laterBase,
    id: `${SUBJECT_ID}:r99:later`,
    revision: 99,
  };
  await fixture.snapshots.save(later);
  (fixture.project.threadSnapshots as Array<{
    snapshotId: string;
    revision: number;
    subjectId: string;
  }>).push({
    snapshotId: later.id,
    revision: later.revision,
    subjectId: later.subject.id,
  });
  const replayedAfterSuccessor = await executor().execute(AGENT, fixture.command());
  assertEquals(replayedAfterSuccessor.agentRuns[0]!.status, "completed");
  assertEquals(fixture.syson.calls.length, providerCalls);
  assertEquals(connection.opens, 1);
  assertEquals(
    capability.capabilityRuntimeSession.events.includes("releaseRecorded"),
    true,
  );
});

Deno.test("malformed predecessor evidence is refused before any provider read", async () => {
  const cases = [
    {
      name: "foreign inputs",
      mutate: (snapshot: ThreadSnapshot) => {
        const predecessor = snapshot.artifacts.find((item) =>
          item.producer.runId === REQ_RUN_ID
        )!;
        (predecessor as unknown as { inputArtifactIds: string[] })
          .inputArtifactIds = [
            ...predecessor.inputArtifactIds,
            "architecture-foreign",
          ];
      },
      message: "exact requirements-capture evidence",
    },
    {
      name: "missing consumption",
      mutate: (snapshot: ThreadSnapshot) => {
        (snapshot as unknown as { consumptions: ThreadSnapshot["consumptions"] })
          .consumptions = snapshot.consumptions.filter((item) =>
            item.consumer.runId !== REQ_RUN_ID
          );
      },
      message: "consumption projection is not exact",
    },
    {
      name: "foreign trace",
      mutate: (snapshot: ThreadSnapshot) => {
        const trace = snapshot.provenance.find((item) =>
          item.relation === "traces_to"
        )!;
        (trace as unknown as { rationale: string }).rationale = "forged";
      },
      message: "trace projection diverges",
    },
    {
      name: "foreign seed",
      mutate: (snapshot: ThreadSnapshot) => {
        const seed = snapshot.artifacts.find((item) =>
          item.producer.tool === "syson_model_create"
        )!;
        (seed as unknown as { producer: { runId: string } }).producer = {
          ...seed.producer,
          runId: "run:foreign-seed",
        };
      },
      message: "basis or seed anchor diverges",
    },
  ] as const;
  for (const testCase of cases) {
    const fixture = await recaptureFixture();
    const tip = fixture.project.threadSnapshots[0]!;
    const snapshot = structuredClone(await fixture.snapshots.get(tip.snapshotId));
    assert(snapshot);
    testCase.mutate(snapshot);
    await fixture.snapshots.save(snapshot);
    const result = await fixture.review.execute({ projectId: PROJECT_ID });
    assertEquals(result.status, "unresolved", testCase.name);
    if (result.status === "unresolved") {
      assertEquals(
        result.diagnostics[0]?.message.includes(testCase.message) ||
          result.diagnostics[0]?.code === "predecessor-invalid" ||
          result.diagnostics[0]?.code === "architecture-invalid" ||
          result.diagnostics[0]?.code === "snapshot-invalid",
        true,
        `${testCase.name}: ${result.diagnostics[0]?.message}`,
      );
    }
    assertEquals(fixture.syson.calls, [], testCase.name);
  }
});

Deno.test("explicit v4 predecessor identity is refused when it is foreign to Thread input", async () => {
  const fixture = await recaptureFixture({ v4Predecessor: true });
  const text = await fixture.requirementsCaptures.read(
    fixture.predecessor.fingerprint,
  );
  const record = JSON.parse(text!) as {
    predecessor: { artifactId: string; producerRunId: string };
  };
  record.predecessor.artifactId = "requirements-Arm-foreign";
  record.predecessor.producerRunId = "run:foreign";
  const forged = deterministicJson(record);
  const fingerprint = await sha256Fingerprint(JSON.parse(forged));
  await fixture.requirementsCaptures.save(fingerprint, forged);
  const snapshot = structuredClone(
    await fixture.snapshots.get(fixture.project.threadSnapshots[0]!.snapshotId),
  )!;
  const artifact = snapshot.artifacts.find((item) =>
    item.id === fixture.predecessor.id
  )!;
  (artifact as unknown as { fingerprint: ContentFingerprint }).fingerprint =
    fingerprint;
  await fixture.snapshots.save(snapshot);
  const result = await fixture.review.execute({
    projectId: PROJECT_ID,
    targetElementId: ARM_ID,
  });
  assertEquals(result.status, "unresolved");
  if (result.status === "unresolved") {
    assertEquals(
      result.diagnostics[0]?.message.includes("predecessor") ||
        result.diagnostics[0]?.code === "predecessor-invalid",
      true,
      result.diagnostics[0]?.message,
    );
  }
  assertEquals(fixture.syson.calls, []);
});

Deno.test("source-analysis mismatch is refused before any provider read", async () => {
  const fixture = await recaptureFixture();
  const review = new PrepareProjectRequirementsRecaptureReview({
    projects: { get: () => Promise.resolve(fixture.project) },
    snapshots: fixture.snapshots,
    architectureCaptures: fixture.deps().architectureCaptures,
    requirementsCaptures: fixture.requirementsCaptures,
    seedCaptures: fixture.deps().seedCaptures,
    sysmlSourceAnalysis: {
      reopen: () => Promise.reject(new Error("foreign source analysis")),
    },
  });
  const result = await review.execute({ projectId: PROJECT_ID });
  assertEquals(result.status, "unresolved");
  if (result.status === "unresolved") {
    assertEquals(
      result.diagnostics[0]?.message.includes("source-analysis") ||
        result.diagnostics[0]?.code === "architecture-invalid" ||
        result.diagnostics[0]?.code === "predecessor-invalid",
      true,
      result.diagnostics[0]?.message,
    );
  }
  assertEquals(fixture.syson.calls, []);
});

Deno.test("requirements recapture review refuses a capture predecessor that is not bijective with Thread inputs", async () => {
  const fixture = await recaptureFixture({
    architecturePredecessorMismatch: "thread-omits",
  });
  const result = await fixture.review.execute({ projectId: PROJECT_ID });
  assertEquals(result.status, "unresolved");
  if (result.status === "unresolved") {
    assertEquals(result.diagnostics[0]?.code, "architecture-invalid");
    assertEquals(
      result.diagnostics[0]!.message.includes("bijective"),
      true,
      result.diagnostics[0]?.message,
    );
  }
  assertEquals(fixture.syson.calls, []);
});

Deno.test("requirements recapture review refuses Thread inputs that name a predecessor the architecture CAS omits", async () => {
  const fixture = await recaptureFixture({
    architecturePredecessorMismatch: "cas-omits",
  });
  const result = await fixture.review.execute({ projectId: PROJECT_ID });
  assertEquals(result.status, "unresolved");
  if (result.status === "unresolved") {
    assertEquals(result.diagnostics[0]?.code, "architecture-invalid");
    assertEquals(
      result.diagnostics[0]!.message.includes("bijective"),
      true,
      result.diagnostics[0]?.message,
    );
  }
  assertEquals(fixture.syson.calls, []);
});

Deno.test("requirements recapture review refuses a foreign architecture seed lineage before it resolves", async () => {
  const fixture = await recaptureFixture({ foreignLineage: true });
  const result = await fixture.review.execute({ projectId: PROJECT_ID });
  assertEquals(result.status, "unresolved");
  if (result.status === "unresolved") {
    assertEquals(result.diagnostics[0]?.code, "architecture-invalid");
    assertEquals(
      result.diagnostics[0]!.message.includes("monotone architecture chain") ||
        result.diagnostics[0]!.message.includes("seed"),
      true,
      result.diagnostics[0]?.message,
    );
  }
  assertEquals(fixture.syson.calls, []);
});

Deno.test("requirements recapture review refuses an absent seed capture before it resolves", async () => {
  const fixture = await recaptureFixture();
  const review = new PrepareProjectRequirementsRecaptureReview({
    projects: { get: () => Promise.resolve(fixture.project) },
    snapshots: fixture.snapshots,
    architectureCaptures: fixture.deps().architectureCaptures,
    requirementsCaptures: fixture.requirementsCaptures,
    seedCaptures: { read: () => Promise.resolve(undefined) },
    sysmlSourceAnalysis: stubSysmlSourceAnalysis(),
  });
  const result = await review.execute({ projectId: PROJECT_ID });
  assertEquals(result.status, "unresolved");
  if (result.status === "unresolved") {
    assertEquals(result.diagnostics[0]?.code, "architecture-invalid");
    assertEquals(
      result.diagnostics[0]!.message.includes("seed capture"),
      true,
      result.diagnostics[0]?.message,
    );
  }
  assertEquals(fixture.syson.calls, []);
});

Deno.test("requirements recapture review resolves a two-step architecture successor chain", async () => {
  const fixture = await recaptureFixture({ secondSuccessor: true });
  const result = await fixture.review.execute({ projectId: PROJECT_ID });
  assertEquals(result.status, "resolved");
  if (result.status !== "resolved") return;
  assertEquals(result.admission.target.elementId, ARM_ID);
  const completed = await fixture.executor().execute(AGENT, fixture.command());
  assertEquals(completed.agentRuns[0]!.status, "completed");
  assertEquals(
    fixture.syson.calls.some((call) => call.name === "syson_element_insert_sysml"),
    false,
  );
});

Deno.test("publication persistence uncertainty resumes the same successor without a second native read", async () => {
  const fixture = await recaptureFixture();
  const inner = fixture.publications;
  let thrown = false;
  const publications = {
    save: async (value: Parameters<typeof inner.save>[0]) => {
      await inner.save(value);
      if (!thrown) {
        thrown = true;
        throw new Error("publication persist uncertain");
      }
    },
    read: (projectId: string, runId: string) => inner.read(projectId, runId),
    pathFor: (projectId: string, runId: string) => inner.pathFor(projectId, runId),
  };
  const events: string[] = [];
  const connection = passthroughCapabilityRuntimeConnection(
    fixture.syson as unknown as McpToolClient,
    events,
  );
  const capability = successfulCapabilityRuntimeFor(
    PROJECT_ID,
    MODEL_RECAPTURE_REQUIREMENTS_OPERATION,
    "model.inspect-system",
  );
  const executor = () =>
    new ModelRecaptureRequirementsRunExecutor({
      ...fixture.deps(),
      publications: publications as never,
      capabilityRuntimeConnection: connection,
      syson: undefined,
      capabilityRuntime: capability.capabilityRuntime,
      capabilityRuntimeSession: capability.capabilityRuntimeSession,
    });
  await assertRejects(() => executor().execute(AGENT, fixture.command()));
  assertEquals(connection.opens, 1);
  fixture.syson.failIfCalled = true;
  const completed = await executor().execute(AGENT, fixture.command());
  assertEquals(completed.agentRuns[0]!.status, "completed");
  assertEquals(connection.opens, 1);
  assertEquals(
    capability.capabilityRuntimeSession.events.includes("releaseRecorded"),
    true,
  );
});

Deno.test("durable publication save with thrown acknowledgement and a transient reload still resumes once readable", async () => {
  const fixture = await recaptureFixture();
  const inner = fixture.publications;
  let saveThrown = false;
  let reads = 0;
  const publications = {
    save: async (value: Parameters<typeof inner.save>[0]) => {
      await inner.save(value);
      if (!saveThrown) {
        saveThrown = true;
        throw new Error("publication acknowledgement lost");
      }
    },
    read: async (projectId: string, runId: string) => {
      reads += 1;
      if (reads === 1) {
        throw new Error("publication reload unavailable");
      }
      return await inner.read(projectId, runId);
    },
    pathFor: (projectId: string, runId: string) => inner.pathFor(projectId, runId),
  };
  const events: string[] = [];
  const connection = passthroughCapabilityRuntimeConnection(
    fixture.syson as unknown as McpToolClient,
    events,
  );
  const capability = successfulCapabilityRuntimeFor(
    PROJECT_ID,
    MODEL_RECAPTURE_REQUIREMENTS_OPERATION,
    "model.inspect-system",
  );
  const executor = () =>
    new ModelRecaptureRequirementsRunExecutor({
      ...fixture.deps(),
      publications: publications as never,
      capabilityRuntimeConnection: connection,
      syson: undefined,
      capabilityRuntime: capability.capabilityRuntime,
      capabilityRuntimeSession: capability.capabilityRuntimeSession,
    });
  await assertRejects(() => executor().execute(AGENT, fixture.command()));
  assertEquals(fixture.project.agentRuns[0]!.status, "running");
  assertEquals(connection.opens, 1);
  fixture.syson.failIfCalled = true;
  const completed = await executor().execute(AGENT, fixture.command());
  assertEquals(completed.agentRuns[0]!.status, "completed");
  assertEquals(connection.opens, 1);
  assertEquals(reads >= 2, true);
  assertEquals(
    capability.capabilityRuntimeSession.events.includes("releaseRecorded"),
    true,
  );
});

Deno.test("durable resume after snapshot failure recovers absent CAS and releases the recorded lease", async () => {
  const fixture = await recaptureFixture({ failSnapshotOnce: true });
  const innerCaptures = fixture.requirementsCaptures;
  const hidden = new Set<string>();
  const captures = {
    save: (fingerprint: ContentFingerprint, text: string) => {
      hidden.delete(fingerprint.digest);
      return innerCaptures.save(fingerprint, text);
    },
    read: async (fingerprint: ContentFingerprint) => {
      if (hidden.has(fingerprint.digest)) return undefined;
      return await innerCaptures.read(fingerprint);
    },
  };
  const events: string[] = [];
  const connection = passthroughCapabilityRuntimeConnection(
    fixture.syson as unknown as McpToolClient,
    events,
  );
  const capability = successfulCapabilityRuntimeFor(
    PROJECT_ID,
    MODEL_RECAPTURE_REQUIREMENTS_OPERATION,
    "model.inspect-system",
  );
  const executor = () =>
    new ModelRecaptureRequirementsRunExecutor({
      ...fixture.deps(),
      captures: captures as never,
      capabilityRuntimeConnection: connection,
      syson: undefined,
      capabilityRuntime: capability.capabilityRuntime,
      capabilityRuntimeSession: capability.capabilityRuntimeSession,
    });
  await assertRejects(() => executor().execute(AGENT, fixture.command()));
  const publication = await fixture.publications.read(PROJECT_ID, RUN_ID);
  assert(publication);
  hidden.add(publication.fingerprint.digest);
  fixture.syson.failIfCalled = true;
  const completed = await executor().execute(AGENT, fixture.command());
  assertEquals(completed.agentRuns[0]!.status, "completed");
  assertEquals(connection.opens, 1);
  assertEquals(
    capability.capabilityRuntimeSession.events.filter((event) => event === "begin")
      .length,
    1,
  );
  assertEquals(
    capability.capabilityRuntimeSession.events.includes("releaseRecorded"),
    true,
  );
});

Deno.test("native identity collisions are refused in live readback", async () => {
  const fixture = await recaptureFixture();
  fixture.syson.collideSubjectWithTarget = true;
  await assertRejects(
    () => fixture.executor().execute(AGENT, fixture.command()),
    EngineeringProjectCommandError,
    "pairwise disjoint",
  );
});

for (const tracedPredecessor of [false, true]) {
  Deno.test(`writer @2 enrichment consumes an honest recapture v${tracedPredecessor ? "6" : "4"} predecessor with a new MRTR`, async () => {
    const fixture = await recaptureFixture({ tracedPredecessor, approvedBrief: true });
    const recaptured = await fixture.executor().execute(AGENT, fixture.command());
    const basisSnap = (await fixture.snapshots.get(
      recaptured.agentRuns[0]!.resultSnapshot!.snapshotId,
    ))!;
    const enrichmentParams = [
      {
        key: "requirements.containerComponent",
        label: "Container",
        value: "Arm",
      },
      {
        key: "requirement.max-mass.name",
        label: "Name",
        value: "Max mass",
      },
      {
        key: "requirement.max-mass.metric",
        label: "Metric",
        value: "maxMass",
      },
      {
        key: "requirement.max-mass.operator",
        label: "Operator",
        value: "<=",
      },
      {
        key: "requirement.max-mass.threshold",
        label: "Threshold",
        value: 5,
        unit: "kg",
      },
      {
        key: "requirement.max-force.name",
        label: "Name",
        value: "Max force",
      },
      {
        key: "requirement.max-force.metric",
        label: "Metric",
        value: "maxForce",
      },
      {
        key: "requirement.max-force.operator",
        label: "Operator",
        value: "<=",
      },
      {
        key: "requirement.max-force.threshold",
        label: "Threshold",
        value: 100,
        unit: "Pa",
      },
    ];
    const noOpParams = enrichmentParams.slice(0, 5);
    const conflictParams = noOpParams.map((parameter) =>
      parameter.key === "requirement.max-mass.threshold"
        ? { ...parameter, value: 8 }
        : parameter
    );
    const directory = await Deno.makeTempDir({ prefix: "casys-writer-from-v4-" });
    try {
      await queueWriterRun(fixture.project, basisSnap, noOpParams, "run:writer-noop");
      await assertRejects(
        () =>
          writerFromRecapture(fixture, directory, new EnrichmentArmSyson()).execute(
            AGENT,
            {
              commandId: "writer-noop",
              projectId: PROJECT_ID,
              expectedRevision: fixture.project.revision,
              issuedAt: TIME,
              runId: "run:writer-noop",
            },
          ),
        EngineeringProjectCommandError,
        "No insertion is needed",
      );
      await queueWriterRun(
        fixture.project,
        basisSnap,
        conflictParams,
        "run:writer-conflict",
      );
      await assertRejects(
        () =>
          writerFromRecapture(fixture, directory, new EnrichmentArmSyson()).execute(
            AGENT,
            {
              commandId: "writer-conflict",
              projectId: PROJECT_ID,
              expectedRevision: fixture.project.revision,
              issuedAt: TIME,
              runId: "run:writer-conflict",
            },
          ),
        EngineeringProjectCommandError,
        "threshold conflict",
      );
      await queueWriterRun(
        fixture.project,
        basisSnap,
        enrichmentParams,
        "run:writer-enrich",
      );
      const syson = new EnrichmentArmSyson();
      const enriched = await writerFromRecapture(fixture, directory, syson).execute(
        AGENT,
        {
          commandId: "writer-enrich",
          projectId: PROJECT_ID,
          expectedRevision: fixture.project.revision,
          issuedAt: TIME,
          runId: "run:writer-enrich",
        },
      );
      const run = enriched.agentRuns.find((item) => item.id === "run:writer-enrich");
      assertEquals(run?.status, "completed");
      const snapshot = await fixture.snapshots.get(run!.resultSnapshot!.snapshotId);
      assert(snapshot);
      const artifact = snapshot.artifacts.find((item) =>
        item.producer.runId === "run:writer-enrich"
      );
      assert(artifact);
      const capture = parseExactRequirementsCapture(
        JSON.parse((await fixture.requirementsCaptures.read(artifact.fingerprint))!),
      );
      assertEquals(capture.schemaVersion, "requirements-capture/5.0");
      assert("briefProvenance" in capture);
      assertEquals(artifact.producer.tool, "model.write-requirements@2");
      assertEquals(
        capture.briefProvenance.requirements.find((item) =>
          item.requirementId === "maxMass"
        ),
        fixture.approved!.provenance.requirements[0],
      );
      assertEquals(
        capture.briefProvenance.requirements.find((item) =>
          item.requirementId === "maxForce"
        )!.sourceItem,
        fixture.approved!.project.framing!.currentBrief!.items.find((item) =>
          item.id === "success-max-force"
        ),
      );
      assertEquals(
        capture.requirements.map((item) => item.metric).toSorted(),
        ["maxForce", "maxMass"],
      );
      assertEquals(
        syson.calls.some((call) => call.name === "syson_element_delete"),
        true,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });
}

Deno.test("a v4 predecessor refuses silent subject replacement", async () => {
  const fixture = await recaptureFixture({ v4Predecessor: true });
  fixture.syson.replacedSubjectId = "reference-usage-replaced";
  await assertRejects(
    () => fixture.executor().execute(AGENT, fixture.command()),
    EngineeringProjectCommandError,
    "replaced the sealed v4 subject",
  );
  assertEquals(
    fixture.syson.calls.some((call) => call.name === "syson_element_insert_sysml"),
    false,
  );
});

Deno.test("traced recapture review selects operation @2 and the closed admission 2.0", async () => {
  for (const v4Predecessor of [false, true]) {
    const fixture = await recaptureFixture({ tracedPredecessor: true, v4Predecessor });
    const result = await fixture.review.execute({ projectId: PROJECT_ID });
    assertEquals(result.status, "resolved");
    assert(result.status === "resolved");
    assertEquals(result.operation, MODEL_RECAPTURE_TRACED_REQUIREMENTS_OPERATION);
    assertEquals(
      result.admission.schemaVersion,
      "requirements-recapture-admission/2.0",
    );
    assertEquals(
      result.admission.predecessor.schemaVersion,
      v4Predecessor ? "requirements-capture/6.0" : "requirements-capture/5.0",
    );
    assertEquals(
      result.decisionParameters,
      encodeTracedRequirementsRecaptureParameters(result.admission),
    );
    assertEquals(fixture.syson.calls, []);
  }
});

Deno.test("traced recapture publishes V6 preserving complete exact V5/V6 brief origins", async () => {
  for (const v4Predecessor of [false, true]) {
    const fixture = await recaptureFixture({ tracedPredecessor: true, v4Predecessor });
    const priorText =
      (await fixture.requirementsCaptures.read(fixture.predecessor.fingerprint))!;
    const completed = await fixture.executor().execute(AGENT, fixture.command());
    const { capture, artifact, snapshot } = await publishedRecapture(
      fixture,
      completed,
    );
    assertEquals(capture.schemaVersion, "requirements-capture/6.0");
    assert(capture.schemaVersion === "requirements-capture/6.0");
    assertEquals(capture.operation, MODEL_RECAPTURE_TRACED_REQUIREMENTS_OPERATION);
    assertEquals(artifact.producer.tool, "model.recapture-requirements@2");
    assertEquals(capture.briefProvenance, fixture.approved!.provenance);
    assertEquals(capture.subject.id, REQ_SUBJECT_ID);
    assertEquals(capture.predecessor.artifactId, fixture.predecessor.id);
    assertEquals(capture.constraintUsages[0]!.id, REQ_CONSTRAINT_ID);
    assertEquals(capture.requirements[0]!.limit, { value: 5, unit: "kg" });
    assertEquals(
      await fixture.requirementsCaptures.read(fixture.predecessor.fingerprint),
      priorText,
    );
    const currentRequirement = snapshot.requirements.find((item) =>
      item.trace.sourceArtifactId === artifact.id
    )!;
    assertEquals(
      snapshot.evaluations.some((item) => item.requirementId === currentRequirement.id),
      false,
    );
    assertEquals(
      fixture.syson.calls.some((call) => /insert|delete/.test(call.name)),
      false,
    );
  }
});

Deno.test("completed traced recapture replays after a later Thread and approved brief without provider reads", async () => {
  const fixture = await recaptureFixture({ tracedPredecessor: true });
  const completed = await fixture.executor().execute(AGENT, fixture.command());
  const published = await publishedRecapture(fixture, completed);
  assert("briefProvenance" in published.capture);
  const originalProvenance: RequirementsBriefProvenance =
    published.capture.briefProvenance;
  const providerCalls = fixture.syson.calls.length;
  fixture.syson.failIfCalled = true;
  const later = {
    ...published.snapshot,
    id: `${SUBJECT_ID}:r99:later-traced`,
    revision: 99,
    previous: {
      snapshotId: published.snapshot.id,
      revision: published.snapshot.revision,
    },
  };
  await fixture.snapshots.save(later);
  (fixture.project as MutableProject).threadSnapshots.push({
    snapshotId: later.id,
    revision: later.revision,
    subjectId: later.subject.id,
  });
  const successor = await fixture.approved!.approveSuccessor();
  Object.assign(fixture.project, {
    framing: successor.framing,
    commandReceipts: [
      ...(fixture.project.commandReceipts ?? []),
      ...(successor.commandReceipts ?? []),
    ],
    revision: fixture.project.revision + 1,
  });
  assertEquals(
    fixture.project.framing!.currentBrief!.revision,
    originalProvenance.briefBasis.briefRevision + 1,
  );
  const replayed = await fixture.executor().execute(AGENT, fixture.command());
  assertEquals(
    replayed.agentRuns[0]!.resultSnapshot,
    completed.agentRuns[0]!.resultSnapshot,
  );
  assertEquals(fixture.syson.calls.length, providerCalls);
  const replay = await publishedRecapture(fixture, replayed);
  assert("briefProvenance" in replay.capture);
  assertEquals(replay.capture.briefProvenance, originalProvenance);
  assertEquals(replay.artifact.fingerprint, published.artifact.fingerprint);
});

Deno.test("traced publication resume preserves source bytes without a second provider read", async () => {
  const fixture = await recaptureFixture({
    tracedPredecessor: true,
    failSnapshotOnce: true,
  });
  await assertRejects(() => fixture.executor().execute(AGENT, fixture.command()));
  const publication = await fixture.publications.read(PROJECT_ID, RUN_ID);
  assert(publication);
  const saved = parseExactRequirementsCapture(JSON.parse(publication.capture));
  assert("briefProvenance" in saved);
  assertEquals(saved.briefProvenance, fixture.approved!.provenance);
  const providerCalls = fixture.syson.calls.length;
  fixture.syson.failIfCalled = true;
  const resumed = await fixture.executor().execute(AGENT, fixture.command());
  const { capture, artifact } = await publishedRecapture(fixture, resumed);
  assert("briefProvenance" in capture);
  assertEquals(capture.briefProvenance, saved.briefProvenance);
  assertEquals(artifact.fingerprint, publication.fingerprint);
  assertEquals(fixture.syson.calls.length, providerCalls);
});

Deno.test("recapture refuses reviewed version downgrades and false predecessor schemas before reads", async () => {
  const cases = [
    {
      tracedPredecessor: true,
      operationVersion: "1",
      admissionSchema: "1.0",
      predecessorSchema: "5.0",
    },
    {
      tracedPredecessor: false,
      operationVersion: "2",
      admissionSchema: "2.0",
      predecessorSchema: "5.0",
    },
    {
      tracedPredecessor: true,
      operationVersion: "2",
      admissionSchema: "2.0",
      predecessorSchema: "6.0",
    },
    {
      tracedPredecessor: true,
      operationVersion: "2",
      admissionSchema: "1.0",
      predecessorSchema: "5.0",
    },
  ];
  for (const testCase of cases) {
    const fixture = await recaptureFixture({
      tracedPredecessor: testCase.tracedPredecessor,
    });
    const decision = fixture.project.decisions[0]!;
    const proposal = {
      ...decision.proposal!,
      parameters: decision.proposal!.parameters.map((parameter) => {
        const values: Record<string, string> = {
          "model.recaptureRequirements.operation.version": testCase.operationVersion,
          "model.recaptureRequirements.schemaVersion":
            `requirements-recapture-admission/${testCase.admissionSchema}`,
          "model.recaptureRequirements.predecessor.schemaVersion":
            `requirements-capture/${testCase.predecessorSchema}`,
        };
        return parameter.key in values
          ? { ...parameter, value: values[parameter.key]! }
          : parameter;
      }),
    };
    const inputFingerprint = await sha256Fingerprint({
      baseSnapshot: decision.baseSnapshot,
      inputEvidenceRefs: decision.inputEvidenceRefs,
      proposal,
    });
    Object.assign(decision, { proposal, inputFingerprint });
    Object.assign(fixture.project.approvals[0]!, { inputFingerprint });
    Object.assign(fixture.project.workItems[0]!.operation!, {
      version: testCase.operationVersion,
    });
    await assertRejects(() => fixture.executor().execute(AGENT, fixture.command()));
    assertEquals(fixture.syson.calls, [], JSON.stringify(testCase));
    assertEquals(await fixture.publications.read(PROJECT_ID, RUN_ID), undefined);
  }
});

async function publishedRecapture(
  fixture: Awaited<ReturnType<typeof recaptureFixture>>,
  completed: EngineeringProjectSnapshot,
) {
  const run = completed.agentRuns.find((item) => item.id === RUN_ID)!;
  assertEquals(run.status, "completed");
  const snapshot = (await fixture.snapshots.get(run.resultSnapshot!.snapshotId))!;
  const artifact = snapshot.artifacts.find((item) =>
    item.id === run.evidenceRefs[0]!.id
  )!;
  assert(artifact);
  const text = (await fixture.requirementsCaptures.read(artifact.fingerprint))!;
  return {
    snapshot,
    artifact,
    capture: parseExactRequirementsCapture(JSON.parse(text)),
  };
}

async function recaptureFixture(options: {
  readonly sameArchitecture?: boolean;
  readonly extraFamily?: boolean;
  readonly failSnapshotOnce?: boolean;
  readonly driftedMetric?: boolean;
  readonly writerSibling?: boolean;
  readonly v4Predecessor?: boolean;
  /** V5 writer origin; combining with v4Predecessor creates a V6 recapture origin. */
  readonly tracedPredecessor?: boolean;
  /** Real approved brief is also available for the V4-to-V5 writer migration. */
  readonly approvedBrief?: boolean;
  readonly secondSuccessor?: boolean;
  readonly foreignLineage?: boolean;
  readonly architecturePredecessorMismatch?: "thread-omits" | "cas-omits";
} = {}) {
  const approved = options.tracedPredecessor || options.approvedBrief
    ? await approvedArmBriefFixture()
    : undefined;
  const directory = await Deno.makeTempDir({ prefix: "casys-recapture-" });
  const seedCaptures = new FileCaptureStore({
    ...SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR,
    directory: `${directory}/seed`,
  });
  const architectureCaptures = new FileCaptureStore({
    ...ARCHITECTURE_CAPTURE_DESCRIPTOR,
    directory: `${directory}/architecture`,
  });
  const requirementsCaptures = new FileCaptureStore({
    ...REQUIREMENTS_CAPTURE_DESCRIPTOR,
    directory: `${directory}/requirements`,
  });
  const seedRecord = seedCaptureRecord();
  const seedFingerprint = await sha256Fingerprint(seedRecord);
  await seedCaptures.save(seedFingerprint, deterministicJson(seedRecord));
  const seed = seedArtifact(seedFingerprint);
  const architectureRecord = architectureCaptureRecord(seed, ARCH_RUN_ID, TIME);
  const architectureFingerprint = await sha256Fingerprint(architectureRecord);
  await architectureCaptures.save(
    architectureFingerprint,
    deterministicJson(architectureRecord),
  );
  const architecture = architectureArtifact(
    architectureFingerprint,
    seed.id,
    ARCH_RUN_ID,
    TIME,
  );
  let successorSeed = seed;
  let foreignSeed: ThreadArtifact | undefined;
  if (options.foreignLineage) {
    const foreignSeedRecord = seedCaptureRecord(FOREIGN_SEED_RUN_ID);
    const foreignSeedFingerprint = await sha256Fingerprint(foreignSeedRecord);
    await seedCaptures.save(
      foreignSeedFingerprint,
      deterministicJson(foreignSeedRecord),
    );
    foreignSeed = seedArtifact(foreignSeedFingerprint, FOREIGN_SEED_RUN_ID);
    successorSeed = foreignSeed;
  }
  const casOmitsPredecessor = options.architecturePredecessorMismatch === "cas-omits";
  const threadOmitsPredecessor =
    options.architecturePredecessorMismatch === "thread-omits";
  const successorRecord = {
    ...architectureCaptureRecord(
      successorSeed,
      ARCH_SUCCESSOR_RUN_ID,
      SUCCESSOR_AT,
    ),
    ...(casOmitsPredecessor ? {} : {
      predecessor: {
        artifactId: architecture.id,
        fingerprint: architecture.fingerprint,
        producerRunId: architecture.producer.runId,
      },
    }),
  };
  const successorFingerprint = await sha256Fingerprint(successorRecord);
  await architectureCaptures.save(
    successorFingerprint,
    deterministicJson(successorRecord),
  );
  const successor = {
    ...architectureArtifact(
      successorFingerprint,
      successorSeed.id,
      ARCH_SUCCESSOR_RUN_ID,
      SUCCESSOR_AT,
    ),
    inputArtifactIds: threadOmitsPredecessor
      ? [successorSeed.id]
      : [successorSeed.id, architecture.id],
  };
  const v3Record = {
    ...requirementsV3(architecture, seed),
    ...(options.tracedPredecessor
      ? {
        schemaVersion: "requirements-capture/5.0",
        operation: MODEL_WRITE_TRACED_REQUIREMENTS_OPERATION,
        briefProvenance: approved!.provenance,
      }
      : {}),
  };
  const v3Fingerprint = await sha256Fingerprint(v3Record);
  await requirementsCaptures.save(v3Fingerprint, deterministicJson(v3Record));
  let predecessor = requirementsArtifact(
    v3Fingerprint,
    architecture.id,
    REQ_RUN_ID,
    TIME,
    options.tracedPredecessor
      ? "model.write-requirements@2"
      : "syson_element_insert_sysml",
  );
  const v3Predecessor = predecessor;
  let v4Record: Record<string, unknown> | undefined;
  let v4Fingerprint: ContentFingerprint | undefined;
  if (options.v4Predecessor) {
    v4Record = {
      ...requirementsV4(architecture, seed, predecessor),
      ...(options.tracedPredecessor
        ? {
          schemaVersion: "requirements-capture/6.0",
          operation: MODEL_RECAPTURE_TRACED_REQUIREMENTS_OPERATION,
          briefProvenance: approved!.provenance,
        }
        : {}),
    };
    v4Fingerprint = await sha256Fingerprint(v4Record);
    await requirementsCaptures.save(v4Fingerprint, deterministicJson(v4Record));
    predecessor = {
      ...requirementsArtifact(
        v4Fingerprint,
        architecture.id,
        "run:requirements-recapture-prior",
        TIME,
        options.tracedPredecessor
          ? "model.recapture-requirements@2"
          : "syson_constraint_extract",
      ),
      inputArtifactIds: [architecture.id, v3Predecessor.id],
    };
  }
  const extraRecord = options.extraFamily
    ? requirementsV3(
      architecture,
      seed,
      SYSTEM_ID,
      "LampSystem",
    )
    : undefined;
  let extra: ThreadArtifact | undefined;
  if (extraRecord) {
    const extraFingerprint = await sha256Fingerprint(extraRecord);
    await requirementsCaptures.save(
      extraFingerprint,
      deterministicJson(extraRecord),
    );
    extra = requirementsArtifact(
      extraFingerprint,
      architecture.id,
      "run:requirements-system",
      TIME,
      "syson_element_insert_sysml",
      "LampSystem",
    );
  }
  const familyHistory = familyEvidence(
    `requirement-${predecessor.fingerprint.digest}-maxMass`,
    extra ? `requirement-${extra.fingerprint.digest}-maxMass` : undefined,
    predecessor.id,
  );
  const documentary = documentaryArtifact();
  const r1 = snapshot(1, documentary.id, [documentary]);
  const r2 = snapshot(2, seed.id, [seed], r1);
  const r3 = snapshot(3, architecture.id, [seed, architecture], r2, {
    consumptions: [consume(seed, architecture, TIME)],
    provenance: [
      derived(architecture.id, seed.id, "architecture-derived-from-seed"),
      uses(architecture, seed, TIME),
    ],
  });
  const r4 = snapshot(
    4,
    architecture.id,
    [
      seed,
      architecture,
      ...(options.v4Predecessor ? [v3Predecessor] : []),
      predecessor,
      ...(extra ? [extra] : []),
    ],
    r3,
    {
      consumptions: [
        consume(seed, architecture, TIME),
        consume(architecture, predecessor, TIME),
        ...(options.v4Predecessor
          ? [
            consume(architecture, v3Predecessor, TIME),
            consume(v3Predecessor, predecessor, TIME),
          ]
          : []),
        ...(extra ? [consume(architecture, extra, TIME)] : []),
      ],
      provenance: [
        derived(architecture.id, seed.id, "architecture-derived-from-seed"),
        uses(architecture, seed, TIME),
        ...(options.v4Predecessor
          ? [
            derived(
              v3Predecessor.id,
              architecture.id,
              "v3-requirements-derived-from-architecture",
            ),
            requirementsArchitectureUses(v3Predecessor, architecture),
          ]
          : []),
        derived(
          predecessor.id,
          architecture.id,
          "requirements-derived-from-architecture",
        ),
        ...(options.v4Predecessor
          ? [
            derived(
              predecessor.id,
              v3Predecessor.id,
              "requirements-derived-from-predecessor",
            ),
            {
              id: `uses-consume-prior-requirements-${predecessor.fingerprint.digest}`,
              relation: "uses" as const,
              from: {
                kind: "consumption" as const,
                id: `consume-${v3Predecessor.id}-by-${predecessor.id}`,
              },
              to: { kind: "artifact" as const, id: v3Predecessor.id },
              rationale: predecessorUsesRationale("recapture"),
            },
          ]
          : []),
        options.v4Predecessor
          ? {
            id: `uses-consume-${architecture.id}-by-${predecessor.id}`,
            relation: "uses" as const,
            from: {
              kind: "consumption" as const,
              id: `consume-${architecture.id}-by-${predecessor.id}`,
            },
            to: { kind: "artifact" as const, id: architecture.id },
            rationale: architectureUsesRationale("recapture"),
          }
          : requirementsArchitectureUses(predecessor, architecture),
        tracesToTarget(
          `requirement-${predecessor.fingerprint.digest}-maxMass`,
          architecture.id,
          "Arm",
          ARM_ID,
        ),
        ...(extra
          ? [
            derived(
              extra.id,
              architecture.id,
              "system-requirements-derived-from-architecture",
            ),
            requirementsArchitectureUses(extra, architecture),
            tracesToTarget(
              `requirement-${extra.fingerprint.digest}-maxMass`,
              architecture.id,
              "LampSystem",
              SYSTEM_ID,
            ),
          ]
          : []),
        ...familyHistory.extraProvenance,
      ],
      requirements: [
        tracedRequirement(
          predecessor,
          architecture.id,
          predecessor.fingerprint.digest,
        ),
        ...(extra
          ? [
            tracedRequirement(
              extra,
              architecture.id,
              extra.fingerprint.digest,
              "requirement-usage-system",
              "LampSystem",
            ),
          ]
          : []),
      ],
      observations: familyHistory.observations,
      evaluations: familyHistory.evaluations,
      violations: familyHistory.violations,
      proposedActions: familyHistory.proposedActions,
    },
  );
  const currentArtifacts = options.sameArchitecture
    ? r4.artifacts
    : [...r4.artifacts, ...(foreignSeed ? [foreignSeed] : []), successor];
  const r5 = options.sameArchitecture ? r4 : snapshot(
    5,
    successor.id,
    currentArtifacts,
    r4,
    {
      consumptions: [
        ...r4.consumptions,
        consume(successorSeed, successor, SUCCESSOR_AT),
        ...(threadOmitsPredecessor
          ? []
          : [consume(architecture, successor, SUCCESSOR_AT)]),
      ],
      provenance: [
        ...r4.provenance,
        derived(successor.id, successorSeed.id, "successor-derived-from-seed"),
        uses(successor, successorSeed, SUCCESSOR_AT),
        ...(threadOmitsPredecessor
          ? [{
            id: "changes-archive-historical-architecture",
            relation: "changes" as const,
            from: {
              kind: "change" as const,
              id: "archive-historical-architecture",
            },
            to: { kind: "artifact" as const, id: architecture.id },
            rationale:
              "Archived the historical architecture that the current capture still names.",
          }]
          : [
            derived(
              successor.id,
              architecture.id,
              "successor-derived-from-predecessor",
            ),
            uses(successor, architecture, SUCCESSOR_AT),
          ]),
      ],
      changes: threadOmitsPredecessor
        ? [{
          id: "archive-historical-architecture",
          kind: "archived" as const,
          target: { kind: "artifact" as const, id: architecture.id },
          summary: "Historical architecture is not the current architecture tip.",
        }]
        : [],
      requirements: r4.requirements,
      observations: r4.observations,
      evaluations: r4.evaluations,
      violations: r4.violations,
      proposedActions: r4.proposedActions,
    },
  );
  let currentArchitecture = options.sameArchitecture ? architecture : successor;
  let basis = r5;
  const snapshotItems: ThreadSnapshot[] = [r1, r2, r3, r4];
  if (!options.sameArchitecture) snapshotItems.push(r5);
  if (
    options.secondSuccessor && !options.sameArchitecture &&
    !options.foreignLineage
  ) {
    const secondRecord = {
      ...architectureCaptureRecord(
        seed,
        ARCH_SECOND_SUCCESSOR_RUN_ID,
        SECOND_SUCCESSOR_AT,
      ),
      predecessor: {
        artifactId: successor.id,
        fingerprint: successor.fingerprint,
        producerRunId: successor.producer.runId,
      },
    };
    const secondFingerprint = await sha256Fingerprint(secondRecord);
    await architectureCaptures.save(
      secondFingerprint,
      deterministicJson(secondRecord),
    );
    const second = {
      ...architectureArtifact(
        secondFingerprint,
        seed.id,
        ARCH_SECOND_SUCCESSOR_RUN_ID,
        SECOND_SUCCESSOR_AT,
      ),
      inputArtifactIds: [seed.id, successor.id],
    };
    const r6 = snapshot(
      6,
      second.id,
      [...r5.artifacts, second],
      r5,
      {
        consumptions: [
          ...r5.consumptions,
          consume(seed, second, SECOND_SUCCESSOR_AT),
          consume(successor, second, SECOND_SUCCESSOR_AT),
        ],
        provenance: [
          ...r5.provenance,
          derived(second.id, seed.id, "second-successor-derived-from-seed"),
          derived(
            second.id,
            successor.id,
            "second-successor-derived-from-predecessor",
          ),
          uses(second, seed, SECOND_SUCCESSOR_AT),
          uses(second, successor, SECOND_SUCCESSOR_AT),
        ],
        requirements: r5.requirements,
        observations: r5.observations,
        evaluations: r5.evaluations,
        violations: r5.violations,
        proposedActions: r5.proposedActions,
      },
    );
    snapshotItems.push(r6);
    basis = r6;
    currentArchitecture = second;
  }
  const snapshots = new MemorySnapshots(
    snapshotItems,
    options.failSnapshotOnce,
  );
  const holder: { project: EngineeringProjectSnapshot } = {
    project: skeletonProject(basis),
  };
  const sysmlSourceAnalysis = stubSysmlSourceAnalysis();
  const review = new PrepareProjectRequirementsRecaptureReview({
    projects: { get: () => Promise.resolve(holder.project) },
    snapshots,
    architectureCaptures,
    requirementsCaptures,
    seedCaptures,
    sysmlSourceAnalysis,
  });
  const publications = new FileRequirementsRecapturePublicationStore(
    `${directory}/publications`,
  );
  const syson = new RecaptureSyson({ driftedMetric: options.driftedMetric === true });
  holder.project = await projectState(basis, currentArchitecture.id, predecessor.id, {
    extra: extra?.id,
    writerSibling: options.writerSibling === true,
    review,
  });
  if (approved) {
    holder.project = {
      ...holder.project,
      id: `${PROJECT_ID}:runtime-fixture`,
      revision: approved.project.revision + 1,
      framing: structuredClone(approved.project.framing),
      commandReceipts: [
        ...(approved.project.commandReceipts ?? []),
        ...(holder.project.commandReceipts ?? []),
      ],
    };
  }
  const project = holder.project;
  const projects = {
    get: () => Promise.resolve(project),
    getRevision: (projectId: string, revision: number) =>
      approved?.store.getRevision(projectId, revision) ?? Promise.resolve(undefined),
  };
  const operation = options.tracedPredecessor
    ? MODEL_RECAPTURE_TRACED_REQUIREMENTS_OPERATION
    : MODEL_RECAPTURE_REQUIREMENTS_OPERATION;
  const commands = new ProductCommands(project as MutableProject);
  const deps = () => ({
    projects: projects as never,
    commands: commands as never,
    snapshots,
    architectureCaptures,
    seedCaptures,
    captures: requirementsCaptures,
    sysmlSourceAnalysis,
    review,
    syson: syson as unknown as McpToolClient,
    lease: immediateLease,
    publications,
    capabilityRuntime: successfulCapabilityRuntimeFor(
      PROJECT_ID,
      operation,
      "model.inspect-system",
    ).capabilityRuntime,
    capabilityRuntimeSession: successfulCapabilityRuntimeFor(
      PROJECT_ID,
      operation,
      "model.inspect-system",
    ).capabilityRuntimeSession,
  });
  return {
    project,
    projects,
    approved,
    operation,
    snapshots,
    predecessor,
    requirementsCaptures,
    publications,
    syson,
    review,
    deps,
    command: () => ({
      commandId: "execute-recapture-requirements",
      projectId: PROJECT_ID,
      expectedRevision: project.revision,
      issuedAt: TIME,
      runId: RUN_ID,
    }),
    executor: () => new ModelRecaptureRequirementsRunExecutor(deps()),
  };
}

async function projectState(
  basis: ThreadSnapshot,
  architectureId: string,
  predecessorId: string,
  options: {
    extra?: string;
    writerSibling?: boolean;
    review: PrepareProjectRequirementsRecaptureReview;
  },
): Promise<EngineeringProjectSnapshot> {
  const reviewed = await options.review.execute({
    projectId: PROJECT_ID,
    ...(options.extra ? { targetElementId: ARM_ID } : {}),
  });
  const parameters = reviewed.status === "resolved"
    ? reviewed.decisionParameters
    : encodeRequirementsRecaptureParameters({
      schemaVersion: "requirements-recapture-admission/1.0",
      operation: MODEL_RECAPTURE_REQUIREMENTS_OPERATION,
      basis: {
        snapshotId: basis.id,
        revision: basis.revision,
        subjectId: basis.subject.id,
        fingerprint: await sha256Fingerprint(basis),
      },
      architecture: {
        artifactId: architectureId,
        fingerprint: basis.artifacts.find((item) => item.id === architectureId)!
          .fingerprint,
        producerRunId: basis.artifacts.find((item) => item.id === architectureId)!
          .producer.runId,
      },
      predecessor: {
        artifactId: predecessorId,
        fingerprint: basis.artifacts.find((item) => item.id === predecessorId)!
          .fingerprint,
        producerRunId: basis.artifacts.find((item) => item.id === predecessorId)!
          .producer.runId,
        schemaVersion: "requirements-capture/3.0",
      },
      target: { kind: "part-definition", label: "Arm", elementId: ARM_ID },
      containerComponent: "Arm",
      partDefName: "ArmRequirements",
      requirementsElementId: REQ_USAGE_ID,
      envelope: { fingerprint: { algorithm: "sha256", digest: "e".repeat(64) } },
    });
  const operation = reviewed.status === "resolved"
    ? reviewed.operation
    : MODEL_RECAPTURE_REQUIREMENTS_OPERATION;
  const basisRef = {
    kind: "thread-snapshot" as const,
    snapshotId: basis.id,
    revision: basis.revision,
    subjectId: basis.subject.id,
  };
  const evidenceRefs = [
    {
      snapshotId: basis.id,
      snapshotRevision: basis.revision,
      kind: "artifact" as const,
      id: architectureId,
    },
    {
      snapshotId: basis.id,
      snapshotRevision: basis.revision,
      kind: "artifact" as const,
      id: predecessorId,
    },
  ];
  const proposal = {
    summary: "Recapture Arm requirements",
    parameters,
  };
  const decisionFingerprint = await sha256Fingerprint({
    baseSnapshot: basisRef,
    inputEvidenceRefs: evidenceRefs,
    proposal,
  });
  return {
    schemaVersion: "4.0",
    id: PROJECT_ID,
    revision: 1,
    generatedAt: TIME,
    project: {
      id: PROJECT_ID,
      name: "Lamp",
      subjectId: basis.subject.id,
      objective: { title: "Lamp", statement: "Recapture requirements." },
    },
    threadSnapshots: [{
      snapshotId: basis.id,
      revision: basis.revision,
      subjectId: basis.subject.id,
    }],
    phases: [],
    workItems: [
      {
        id: "recapture-requirements",
        activityId: "activity:recapture-requirements",
        phaseId: "requirements",
        title: "Recapture requirements",
        description: "Re-read unchanged native requirements.",
        kind: "verify",
        status: "ready",
        owner: "agent",
        dependsOnWorkItemIds: [],
        evidenceRefs: [],
        decisionIds: ["decision-recapture"],
        blockerIds: [],
        operation: {
          ...operation,
          bindings: [{
            name: "architecture",
            source: { kind: "thread-entity", reference: evidenceRefs[0]! },
          }, {
            name: "predecessor",
            source: { kind: "thread-entity", reference: evidenceRefs[1]! },
          }],
        },
      },
      ...(options.writerSibling
        ? [{
          id: "write-requirements",
          activityId: "activity:write-requirements",
          phaseId: "requirements",
          title: "Write requirements",
          description: "Uncertain writer sibling.",
          kind: "verify" as const,
          status: "failed" as const,
          owner: "agent" as const,
          dependsOnWorkItemIds: [],
          evidenceRefs: [],
          decisionIds: [],
          blockerIds: [],
          operation: {
            id: "model.write-requirements",
            version: "1",
            bindings: [],
          },
        }]
        : []),
    ],
    agentRuns: [
      {
        id: RUN_ID,
        workItemId: "recapture-requirements",
        status: "queued",
        summary: "Recapture unchanged requirements.",
        queuedAt: TIME,
        basis: basisRef,
        evidenceRefs: [],
      },
      ...(options.writerSibling
        ? [{
          id: "run:writer-sibling",
          workItemId: "write-requirements",
          status: "failed" as const,
          summary: "Uncertain writer.",
          queuedAt: TIME,
          basis: basisRef,
          evidenceRefs: [],
          failure: {
            code: "model-write-requirements-post-acknowledgement-quarantined",
            message: "quarantined",
          },
        }]
        : []),
    ],
    decisions: [{
      id: "decision-recapture",
      status: "approved",
      title: "Recapture",
      baseSnapshot: basisRef,
      inputEvidenceRefs: evidenceRefs,
      inputFingerprint: decisionFingerprint,
      proposal,
    }],
    approvals: [{
      id: "approval-recapture",
      decisionId: "decision-recapture",
      status: "approved",
      decidedByOrigin: "human",
      decidedBy: { id: HUMAN.actorId, origin: "human" },
      decidedAt: TIME,
      baseSnapshot: basisRef,
      inputEvidenceRefs: evidenceRefs,
      inputFingerprint: decisionFingerprint,
      rationale: "Confirmed recapture.",
    }],
    blockers: [],
    commandReceipts: [],
  } as unknown as EngineeringProjectSnapshot;
}

function skeletonProject(basis: ThreadSnapshot): EngineeringProjectSnapshot {
  return {
    schemaVersion: "4.0",
    id: PROJECT_ID,
    revision: 1,
    generatedAt: TIME,
    project: {
      id: PROJECT_ID,
      name: "Lamp",
      subjectId: basis.subject.id,
      objective: { title: "Lamp", statement: "Recapture requirements." },
    },
    threadSnapshots: [{
      snapshotId: basis.id,
      revision: basis.revision,
      subjectId: basis.subject.id,
    }],
    phases: [],
    workItems: [],
    agentRuns: [],
    decisions: [],
    approvals: [],
    blockers: [],
    commandReceipts: [],
  } as unknown as EngineeringProjectSnapshot;
}

/** Actual brief commands and immutable revision reopening; no approval-reader stub. */
async function approvedArmBriefFixture() {
  const store = new MemoryApprovedProjects();
  const service = new ProjectBriefCommandService(store, () => TIME);
  let project = await service.startProject(AGENT, {
    commandId: "start-arm-brief",
    projectId: PROJECT_ID,
    projectName: "Lamp requirements provenance fixture",
    issuedAt: TIME,
    intent: "Review the reusable Arm scalar requirements.",
    intentSource: { kind: "human", reference: "conversation:arm-fixture" },
  });
  const sourceRefs = [{
    kind: "intent" as const,
    reference: "conversation:arm-fixture",
  }];
  const items: readonly ProjectBriefItem[] = [
    {
      id: "objective",
      kind: "objective",
      statement: "Review the reusable Arm scalar requirements.",
      sourceRefs,
    },
    {
      id: "mission-arm",
      kind: "mission-scenario",
      statement: "The reusable Arm carries the lamp head in the reviewed scenario.",
      sourceRefs,
    },
    {
      id: "success-max-mass",
      kind: "success-criterion",
      statement: "The Arm mass remains at or below the reviewed 5 kg threshold.",
      sourceRefs,
      dependsOnItemIds: ["mission-arm"],
    },
    {
      id: "success-max-force",
      kind: "success-criterion",
      statement: "The additional synthetic maxForce scalar is reviewed at 100 Pa.",
      sourceRefs,
      dependsOnItemIds: ["mission-arm"],
    },
  ];
  project = await service.proposeBrief(AGENT, {
    commandId: "propose-arm-brief",
    projectId: PROJECT_ID,
    expectedRevision: project.revision,
    issuedAt: TIME,
    items,
  });
  project = await service.approveBrief(HUMAN, {
    commandId: "approve-arm-brief",
    projectId: PROJECT_ID,
    expectedRevision: project.revision,
    issuedAt: TIME,
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
    rationale: "Human-reviewed synthetic Arm criterion sources.",
  });
  const parameters = await tracedWriterParameters(project, [
    { key: "requirements.containerComponent", label: "Container", value: "Arm" },
    { key: "requirement.max-mass.name", label: "Name", value: "Max mass" },
    { key: "requirement.max-mass.metric", label: "Metric", value: "maxMass" },
    { key: "requirement.max-mass.operator", label: "Operator", value: "<=" },
    { key: "requirement.max-mass.threshold", label: "Threshold", value: 5, unit: "kg" },
  ]);
  const provenance = await buildRequirementsBriefProvenance({
    brief: project.framing!.currentBrief!,
    basis: approvedBriefBasisForProject(project),
    proposal: parseTracedRequirementsProposalParameters(parameters),
  });
  return {
    project,
    store,
    provenance,
    approveSuccessor: async () => {
      const successorService = new ProjectBriefCommandService(
        store,
        () => SUCCESSOR_AT,
      );
      let successor = await successorService.proposeBrief(AGENT, {
        commandId: "propose-arm-brief-successor",
        projectId: PROJECT_ID,
        expectedRevision: project.revision,
        issuedAt: SUCCESSOR_AT,
        items: items.map((item) =>
          item.id === "success-max-mass"
            ? {
              ...item,
              statement: "The successor Arm mass criterion is reviewed at 4 kg.",
            }
            : item
        ),
      });
      successor = await successorService.approveBrief(HUMAN, {
        commandId: "approve-arm-brief-successor",
        projectId: PROJECT_ID,
        expectedRevision: successor.revision,
        issuedAt: SUCCESSOR_AT,
        briefSnapshotId: successor.framing!.proposedBrief!.id,
        briefRevision: successor.framing!.proposedBrief!.revision,
        inputFingerprint: successor.framing!.proposalReview!.inputFingerprint,
        rationale: "Human-reviewed successor mass criterion.",
      });
      return successor;
    },
  };
}

async function tracedWriterParameters(
  project: EngineeringProjectSnapshot,
  parameters: readonly EngineeringDecisionProposalParameter[],
): Promise<readonly EngineeringDecisionProposalParameter[]> {
  const basis = approvedBriefBasisForProject(project);
  const briefFingerprint = await sha256Fingerprint(project.framing!.currentBrief!);
  const result: EngineeringDecisionProposalParameter[] = [
    ...parameters,
    {
      key: "requirements.sourceProjectId",
      label: "Source project",
      value: basis.projectId,
    },
    {
      key: "requirements.sourceProjectSnapshotId",
      label: "Source project snapshot",
      value: basis.projectSnapshotId,
    },
    {
      key: "requirements.sourceProjectRevision",
      label: "Source project revision",
      value: basis.projectRevision,
    },
    { key: "requirements.sourceBriefId", label: "Source brief", value: basis.briefId },
    {
      key: "requirements.sourceBriefSnapshotId",
      label: "Source brief snapshot",
      value: basis.briefSnapshotId,
    },
    {
      key: "requirements.sourceBriefRevision",
      label: "Source brief revision",
      value: basis.briefRevision,
    },
    {
      key: "requirements.sourceBriefFingerprint",
      label: "Approved brief fingerprint",
      value: `sha256:${basis.approvedBriefFingerprint.digest}`,
    },
    {
      key: "requirements.sourceBriefContentFingerprint",
      label: "Brief content fingerprint",
      value: `sha256:${briefFingerprint.digest}`,
    },
    {
      key: "requirements.containerSourceItemId",
      label: "Container source",
      value: "mission-arm",
    },
  ];
  for (const parameter of parameters) {
    const match = /^requirement\.([a-z0-9-]+)\.threshold$/.exec(parameter.key);
    if (!match) continue;
    result.push(
      {
        key: `requirement.${match[1]}.sourceItemId`,
        label: "Requirement source",
        value: `success-${match[1]}`,
      },
      {
        ...parameter,
        key: `requirement.${match[1]}.declaredThreshold`,
        label: "Declared threshold",
      },
    );
  }
  parseTracedRequirementsProposalParameters(result);
  return result;
}

class MemoryApprovedProjects implements EngineeringProjectRevisionStore {
  readonly #revisions = new Map<number, EngineeringProjectSnapshot>();
  get(projectId: string): Promise<EngineeringProjectSnapshot | undefined> {
    const value = [...this.#revisions.values()]
      .filter((project) => project.project.id === projectId)
      .sort((left, right) => right.revision - left.revision)[0];
    return Promise.resolve(value && structuredClone(value));
  }
  getRevision(
    projectId: string,
    revision: number,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const value = this.#revisions.get(revision);
    return Promise.resolve(
      value?.project.id === projectId ? structuredClone(value) : undefined,
    );
  }
  createInitial(
    project: EngineeringProjectSnapshot,
  ): Promise<EngineeringProjectSnapshot> {
    if (this.#revisions.size) {
      throw new EngineeringProjectStoreConflictError("Already exists.");
    }
    this.#revisions.set(project.revision, structuredClone(project));
    return Promise.resolve(structuredClone(project));
  }
  async commit(
    project: EngineeringProjectSnapshot,
    expectedRevision: number,
  ): Promise<EngineeringProjectSnapshot> {
    const current = await this.get(project.project.id);
    if (current?.revision !== expectedRevision) {
      throw new EngineeringProjectStoreConflictError("Stale revision.");
    }
    this.#revisions.set(project.revision, structuredClone(project));
    return structuredClone(project);
  }
}

function seedCaptureRecord(trustedRunId = SEED_RUN_ID) {
  return {
    schemaVersion: "syson-model-seed-capture/2.0",
    kind: "syson-model-seed",
    scope: "sysml-container-identity",
    statement:
      "Immutable normalized identity record of a newly created SysON project, SysML document, and root package. It does not capture model semantics, requirements, CAD, simulation, measurements, or verification verdicts.",
    capturedAt: trustedRunId === SEED_RUN_ID ? TIME : SUCCESSOR_AT,
    trustedRunId,
    operation: { id: "architecture.seed-syson-model", version: "2" },
    lineage: {
      approvedBriefBasis: {
        kind: "approved-brief",
        projectId: PROJECT_ID,
        projectSnapshotId: `${SUBJECT_ID}:r1:baseline`,
        projectRevision: 1,
        briefId: "brief-001",
        briefSnapshotId: "brief-snap-001",
        briefRevision: 1,
        approvedBriefFingerprint: {
          algorithm: "sha256",
          digest: "a".repeat(64),
        },
      },
      plan: {
        publishedAt: TIME,
        publishedBy: { id: "agent:test", origin: "agent" },
      },
      projectChange: {
        id: "change-001",
        commandId: "cmd-001",
        publishedAt: TIME,
        publishedBy: { id: "agent:test", origin: "agent" },
      },
      workItemId: "work-001",
      baseSnapshot: {
        snapshotId: `${SUBJECT_ID}:r1:baseline`,
        revision: 1,
        subjectId: SUBJECT_ID,
      },
      documentaryArtifact: {
        id: "documentary-baseline",
        fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
        uri: `casys://approved-brief-capture/sha256/${"b".repeat(64)}`,
        producerRunId: "run-baseline",
      },
    },
    provider: {
      serverId: "syson",
      tools: {
        projectCreate: "syson_project_create",
        modelCreate: "syson_model_create",
        rootPackageGet: "syson_element_get",
      },
    },
    normalizedResults: {
      project: {
        id: "syson-proj",
        name: "Lamp project",
        editingContextId: EDITING_CONTEXT_ID,
      },
      document: { id: "syson-doc", name: "Lamp document", kind: "SysML" },
      rootPackage: { id: ROOT_PACKAGE_ID, kind: "Package", label: "Root" },
    },
  };
}

function architectureCaptureRecord(
  seed: ThreadArtifact,
  runId: string,
  insertedAt: string,
) {
  return {
    schemaVersion: "architecture-capture/4.0",
    operation: { id: "model.write-architecture", version: "1" },
    trustedRunId: runId,
    packageName: PACKAGE_NAME,
    systemName: "LampSystem",
    scopeRoot: { id: PACKAGE_ID, kind: "Package", label: PACKAGE_NAME },
    semanticRoot: {
      id: SYSTEM_ID,
      kind: "PartDefinition",
      label: "LampSystem",
    },
    seed: {
      artifactId: seed.id,
      fingerprint: seed.fingerprint,
      producerRunId: seed.producer.runId,
    },
    sourceAnalyses: [{
      sourceId: "sysml-source:lamp-package",
      selector: { kind: "full-package", packageName: PACKAGE_NAME },
      runId,
      operation: { id: "model.write-architecture", version: "1" },
      sourceFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
      sourceCaptureFingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
      analysisFingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
    }],
    partDefinitions: [{
      id: SYSTEM_ID,
      kind: "PartDefinition",
      label: "LampSystem",
      usages: [{
        id: USAGE_ID,
        kind: "PartUsage",
        label: "arm",
        targetId: ARM_ID,
        targetKind: "PartDefinition",
        targetLabel: "Arm",
      }],
    }, {
      id: ARM_ID,
      kind: "PartDefinition",
      label: "Arm",
      usages: [],
    }],
    insertedAt,
  };
}

function requirementsV4(
  architecture: ThreadArtifact,
  seed: ThreadArtifact,
  predecessor: ThreadArtifact,
) {
  const { insertedAt: _insertedAt, ...common } = requirementsV3(
    architecture,
    seed,
  );
  return {
    ...common,
    schemaVersion: "requirements-capture/4.0",
    operation: { id: "model.recapture-requirements", version: "1" },
    trustedRunId: "run:requirements-recapture-prior",
    predecessor: {
      artifactId: predecessor.id,
      fingerprint: predecessor.fingerprint,
      producerRunId: predecessor.producer.runId,
    },
    capturedAt: TIME,
    subject: {
      id: REQ_SUBJECT_ID,
      kind: "ReferenceUsage",
      name: "target",
    },
  };
}

function requirementsV3(
  architecture: ThreadArtifact,
  seed: ThreadArtifact,
  elementId = ARM_ID,
  label = "Arm",
) {
  return {
    schemaVersion: "requirements-capture/3.0",
    operation: { id: "model.write-requirements", version: "1" },
    trustedRunId: label === "Arm" ? REQ_RUN_ID : "run:requirements-system",
    containerComponent: label,
    partDefName: `${label}Requirements`,
    target: {
      kind: "part-definition",
      label,
      elementId,
    },
    architectureBasis: {
      snapshotId: `${SUBJECT_ID}:r3:rev`,
      revision: 3,
      fingerprint: architecture.fingerprint.digest,
    },
    requirements: [{
      id: "maxMass",
      name: "Max mass",
      metric: "maxMass",
      operator: "<=",
      limit: { value: 5, unit: "kg" },
    }],
    seed: {
      artifactId: seed.id,
      fingerprint: seed.fingerprint,
      producerRunId: seed.producer.runId,
    },
    architecture: {
      artifactId: architecture.id,
      fingerprint: architecture.fingerprint,
      producerRunId: architecture.producer.runId,
    },
    requirementsElementId: label === "Arm" ? REQ_USAGE_ID : "requirement-usage-system",
    requirementUsage: {
      id: label === "Arm" ? REQ_USAGE_ID : "requirement-usage-system",
      kind: "RequirementUsage",
    },
    constraintUsages: [{
      requirementId: "maxMass",
      id: label === "Arm" ? REQ_CONSTRAINT_ID : "constraint-usage-system-mass",
      kind: "ConstraintUsage",
      sourceId: label === "Arm" ? REQ_CONSTRAINT_ID : "constraint-usage-system-mass",
    }],
    insertedAt: TIME,
  };
}

function documentaryArtifact(): ThreadArtifact {
  return {
    id: "documentary-baseline",
    name: "Approved brief",
    kind: "document",
    version: "1",
    fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
    uri: `casys://approved-brief-capture/sha256/${"b".repeat(64)}`,
    mediaType: "application/json",
    producer: { serverId: "casys", tool: "baseline", runId: "run-baseline" },
    inputArtifactIds: [],
    freshness: fresh(TIME),
  };
}

function seedArtifact(
  fingerprint: ContentFingerprint,
  runId = SEED_RUN_ID,
): ThreadArtifact {
  return {
    id: `syson-model-seed-${fingerprint.digest}`,
    name: "SysON model seed",
    kind: "sysml-model",
    version: fingerprint.digest,
    fingerprint,
    uri: `casys://syson-model-seed-capture/sha256/${fingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "syson",
      tool: "syson_model_create",
      runId,
    },
    inputArtifactIds: [],
    freshness: fresh(TIME),
  };
}

function architectureArtifact(
  fingerprint: ContentFingerprint,
  seedId: string,
  runId: string,
  at: string,
): ThreadArtifact {
  return {
    id: `architecture-${fingerprint.digest}`,
    name: "Architecture",
    kind: "sysml-model",
    version: fingerprint.digest,
    fingerprint,
    uri: `casys://architecture-capture/sha256/${fingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "syson",
      tool: "syson_element_insert_sysml",
      runId,
    },
    inputArtifactIds: [seedId],
    freshness: fresh(at),
  };
}

function requirementsArtifact(
  fingerprint: ContentFingerprint,
  architectureId: string,
  runId: string,
  at: string,
  tool: string,
  component = "Arm",
): ThreadArtifact {
  return {
    id: `requirements-${component}-${fingerprint.digest}`,
    name: `Requirements: ${component}`,
    kind: "sysml-model",
    version: fingerprint.digest,
    fingerprint,
    uri: `casys://requirements-capture/${component}/sha256/${fingerprint.digest}`,
    mediaType: "application/json",
    producer: { serverId: "syson", tool, runId },
    inputArtifactIds: [architectureId],
    freshness: fresh(at),
  };
}

function tracedRequirement(
  predecessor: ThreadArtifact,
  architectureId: string,
  digest: string,
  elementId = REQ_USAGE_ID,
  _label = "Arm",
) {
  return {
    id: `requirement-${digest}-maxMass`,
    name: "Max mass",
    statement: "Max mass: maxMass <= 5 kg.",
    version: digest,
    criterion: {
      metric: "maxMass",
      operator: "<=" as const,
      limit: { value: 5, unit: "kg" },
    },
    trace: {
      sourceArtifactId: predecessor.id,
      elementId,
      targetArtifactIds: [architectureId],
    },
    freshness: fresh(TIME),
  };
}

function requirementsArchitectureUses(
  consumer: ThreadArtifact,
  architecture: ThreadArtifact,
) {
  return {
    id: `uses-consume-${architecture.id}-by-${consumer.id}`,
    relation: "uses" as const,
    from: {
      kind: "consumption" as const,
      id: `consume-${architecture.id}-by-${consumer.id}`,
    },
    to: { kind: "artifact" as const, id: architecture.id },
    rationale: architectureUsesRationale("write"),
  };
}

function tracesToTarget(
  requirementId: string,
  architectureId: string,
  label: string,
  elementId: string,
) {
  return {
    id: `traces-to-target-${requirementId}`,
    relation: "traces_to" as const,
    from: { kind: "requirement" as const, id: requirementId },
    to: { kind: "artifact" as const, id: architectureId },
    rationale:
      `The requirement constrains PartDefinition "${label}" (${elementId}) inside this architecture artifact.`,
  };
}

function familyEvidence(
  armRequirementId: string,
  systemRequirementId: string | undefined,
  sourceArtifactId: string,
) {
  if (!systemRequirementId) {
    return {
      observations: [] as ThreadSnapshot["observations"],
      evaluations: [] as ThreadSnapshot["evaluations"],
      violations: [] as ThreadSnapshot["violations"],
      proposedActions: [] as ThreadSnapshot["proposedActions"],
      extraProvenance: [] as ThreadSnapshot["provenance"],
    };
  }
  const evaluator = {
    serverId: "casys",
    tool: "evaluate",
    runId: "run:evaluate",
  };
  const armPassObs = {
    id: "observation:arm-pass",
    name: "Arm mass observation",
    metric: "maxMass",
    quantity: { value: 4, unit: "kg" },
    source: {
      operation: evaluator,
      artifactIds: [sourceArtifactId],
      capturedAt: TIME,
    },
    freshness: fresh(TIME),
  };
  const armFailObs = {
    id: "observation:arm-fail",
    name: "Arm mass overshoot",
    metric: "maxMass",
    quantity: { value: 9, unit: "kg" },
    source: {
      operation: evaluator,
      artifactIds: [sourceArtifactId],
      capturedAt: TIME,
    },
    freshness: fresh(TIME),
  };
  const systemObs = {
    id: "observation:system-pass",
    name: "System mass observation",
    metric: "maxMass",
    quantity: { value: 4, unit: "kg" },
    source: {
      operation: evaluator,
      artifactIds: [sourceArtifactId],
      capturedAt: TIME,
    },
    freshness: fresh(TIME),
  };
  const armPass = {
    id: "eval-arm-old",
    name: "Old pass",
    requirementId: armRequirementId,
    observationIds: [armPassObs.id],
    status: "pass" as const,
    evaluatedAt: TIME,
    evaluator,
    comparison: {
      observationId: armPassObs.id,
      actual: { value: 4, unit: "kg" },
      operator: "<=" as const,
      limit: { value: 5, unit: "kg" },
      normalizedUnit: "kg",
      margin: { value: 1, unit: "kg" },
    },
    evidenceArtifactIds: [] as string[],
    message: "Passed.",
    freshness: fresh(TIME),
  };
  const armFail = {
    id: "eval-arm-fail",
    name: "Old fail",
    requirementId: armRequirementId,
    observationIds: [armFailObs.id],
    status: "fail" as const,
    evaluatedAt: TIME,
    evaluator,
    comparison: {
      observationId: armFailObs.id,
      actual: { value: 9, unit: "kg" },
      operator: "<=" as const,
      limit: { value: 5, unit: "kg" },
      normalizedUnit: "kg",
      margin: { value: -4, unit: "kg" },
    },
    evidenceArtifactIds: [] as string[],
    message: "Failed.",
    freshness: fresh(TIME),
  };
  const systemPass = {
    id: "eval-system-active",
    name: "Unrelated pass",
    requirementId: systemRequirementId,
    observationIds: [systemObs.id],
    status: "pass" as const,
    evaluatedAt: TIME,
    evaluator,
    comparison: {
      observationId: systemObs.id,
      actual: { value: 4, unit: "kg" },
      operator: "<=" as const,
      limit: { value: 5, unit: "kg" },
      normalizedUnit: "kg",
      margin: { value: 1, unit: "kg" },
    },
    evidenceArtifactIds: [] as string[],
    message: "Passed.",
    freshness: fresh(TIME),
  };
  const violation = {
    id: "viol-arm-old",
    name: "Old violation",
    requirementId: armRequirementId,
    evaluationId: armFail.id,
    severity: "error" as const,
    status: "open" as const,
    detectedAt: TIME,
    observationIds: [armFailObs.id],
    evidenceArtifactIds: [] as string[],
    summary: "Historical family failure.",
    freshness: fresh(TIME),
  };
  const action = {
    id: "action:arm-old",
    name: "Review old violation",
    kind: "review" as const,
    readiness: "ready" as const,
    rationale: "Inspect the archived family violation.",
    targets: [{ kind: "violation" as const, id: violation.id }],
    addressesViolationIds: [violation.id],
    dependsOnActionIds: [] as string[],
  };
  return {
    observations: [armPassObs, armFailObs, systemObs],
    evaluations: [armPass, armFail, systemPass],
    violations: [violation],
    proposedActions: [action],
    extraProvenance: [
      {
        id: "derived-obs-arm-pass",
        relation: "derived_from" as const,
        from: { kind: "observation" as const, id: armPassObs.id },
        to: { kind: "artifact" as const, id: sourceArtifactId },
        rationale: "Observation derived from the prior family capture.",
      },
      {
        id: "derived-obs-arm-fail",
        relation: "derived_from" as const,
        from: { kind: "observation" as const, id: armFailObs.id },
        to: { kind: "artifact" as const, id: sourceArtifactId },
        rationale: "Observation derived from the prior family capture.",
      },
      {
        id: "derived-obs-system-pass",
        relation: "derived_from" as const,
        from: { kind: "observation" as const, id: systemObs.id },
        to: { kind: "artifact" as const, id: sourceArtifactId },
        rationale: "Unrelated observation derived from its family capture.",
      },
      {
        id: "evaluates-arm-pass",
        relation: "evaluates" as const,
        from: { kind: "evaluation" as const, id: armPass.id },
        to: { kind: "requirement" as const, id: armRequirementId },
        rationale: "Pass evaluation of the prior family.",
      },
      {
        id: "uses-arm-pass-obs",
        relation: "uses" as const,
        from: { kind: "evaluation" as const, id: armPass.id },
        to: { kind: "observation" as const, id: armPassObs.id },
        rationale: "Pass evaluation uses the observation.",
      },
      {
        id: "evaluates-arm-fail",
        relation: "evaluates" as const,
        from: { kind: "evaluation" as const, id: armFail.id },
        to: { kind: "requirement" as const, id: armRequirementId },
        rationale: "Fail evaluation of the prior family.",
      },
      {
        id: "uses-arm-fail-obs",
        relation: "uses" as const,
        from: { kind: "evaluation" as const, id: armFail.id },
        to: { kind: "observation" as const, id: armFailObs.id },
        rationale: "Fail evaluation uses the observation.",
      },
      {
        id: "caused-by-arm-fail",
        relation: "caused_by" as const,
        from: { kind: "violation" as const, id: violation.id },
        to: { kind: "evaluation" as const, id: armFail.id },
        rationale: "Violation caused by the failed evaluation.",
      },
      {
        id: "addresses-arm-old",
        relation: "addresses" as const,
        from: { kind: "action" as const, id: action.id },
        to: { kind: "violation" as const, id: violation.id },
        rationale: "Action addresses the open violation.",
      },
      {
        id: "evaluates-system-pass",
        relation: "evaluates" as const,
        from: { kind: "evaluation" as const, id: systemPass.id },
        to: { kind: "requirement" as const, id: systemRequirementId },
        rationale: "Unrelated family remains active.",
      },
      {
        id: "uses-system-pass-obs",
        relation: "uses" as const,
        from: { kind: "evaluation" as const, id: systemPass.id },
        to: { kind: "observation" as const, id: systemObs.id },
        rationale: "Unrelated pass uses its observation.",
      },
    ],
  };
}

async function queueWriterRun(
  project: EngineeringProjectSnapshot,
  basis: ThreadSnapshot,
  parameters: readonly EngineeringDecisionProposalParameter[],
  runId: string,
): Promise<void> {
  const mutable = project as MutableProject;
  const basisRef = {
    kind: "thread-snapshot" as const,
    snapshotId: basis.id,
    revision: basis.revision,
    subjectId: basis.subject.id,
  };
  const evidenceRefs = [{
    snapshotId: basis.id,
    snapshotRevision: basis.revision,
    kind: "artifact" as const,
    id: basis.subject.modelArtifactId,
  }];
  const proposal = {
    summary: `Writer enrichment ${runId}`,
    parameters: await tracedWriterParameters(project, parameters),
  };
  const decisionId = `decision-${runId}`;
  const workItemId = `wi-${runId}`;
  const operation = {
    ...MODEL_WRITE_TRACED_REQUIREMENTS_OPERATION,
    bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
  };
  const decisionFingerprint = await sha256Fingerprint({
    baseSnapshot: basisRef,
    inputEvidenceRefs: evidenceRefs,
    proposal,
  });
  mutable.workItems.push({
    id: workItemId,
    activityId: `activity-${runId}`,
    phaseId: "requirements",
    title: "Write requirements",
    description: "Enrich after recapture.",
    kind: "verify",
    status: "ready",
    owner: "agent",
    dependsOnWorkItemIds: [],
    evidenceRefs: [],
    decisionIds: [decisionId],
    blockerIds: [],
    operation,
  } as never);
  // Each new writer work item and MRTR decision has one exact owning change.
  // The basis is the receipt of a real synthetic human-approved brief below.
  (project as { planChanges: NonNullable<EngineeringProjectSnapshot["planChanges"]> })
    .planChanges = [
      ...(project.planChanges ?? []),
      {
        id: `change-${runId}`,
        commandId: `append-${runId}`,
        approvedBriefBasis: approvedBriefBasisForProject(project),
        baseSnapshot: basisRef,
        phaseIds: ["requirements"],
        workItemIds: [workItemId],
        decisionIds: [decisionId],
        publishedAt: TIME,
        publishedBy: { id: AGENT.actorId, origin: "agent" },
      },
    ];
  const runFingerprint = await sha256Fingerprint({
    workItemId,
    basis: basisRef,
    operation: {
      id: operation.id,
      version: operation.version,
      bindings: operation.bindings,
    },
    approvedDecisions: [{
      id: decisionId,
      inputFingerprint: decisionFingerprint,
    }],
  });
  mutable.agentRuns.push({
    id: runId,
    workItemId,
    status: "queued",
    summary: "Enrich requirements.",
    queuedAt: TIME,
    basis: basisRef,
    evidenceRefs: [],
    inputFingerprint: runFingerprint,
  } as never);
  mutable.decisions.push({
    id: decisionId,
    status: "approved",
    title: "Enrich",
    baseSnapshot: basisRef,
    inputEvidenceRefs: evidenceRefs,
    inputFingerprint: decisionFingerprint,
    proposal,
  } as never);
  mutable.approvals.push({
    id: `approval-${runId}`,
    decisionId,
    status: "approved",
    decidedByOrigin: "human",
    decidedBy: { id: HUMAN.actorId, origin: "human" },
    decidedAt: TIME,
    baseSnapshot: basisRef,
    inputEvidenceRefs: evidenceRefs,
    inputFingerprint: decisionFingerprint,
    rationale: "Approved enrichment after recapture.",
  } as never);
}

function writerFromRecapture(
  fixture: Awaited<ReturnType<typeof recaptureFixture>>,
  directory: string,
  syson: McpToolClient,
): ModelWriteRequirementsRunExecutor {
  const capability = successfulCapabilityRuntimeFor(
    PROJECT_ID,
    MODEL_WRITE_TRACED_REQUIREMENTS_OPERATION,
    "model.author-system",
  );
  return new ModelWriteRequirementsRunExecutor({
    projects: fixture.projects as never,
    commands: fixture.deps().commands,
    snapshots: fixture.snapshots,
    seedCaptures: fixture.deps().seedCaptures,
    architectureCaptures: fixture.deps().architectureCaptures,
    sysmlSourceAnalysis: stubSysmlSourceAnalysis(),
    captures: fixture.requirementsCaptures,
    attempts: new FileRequirementsAttemptStore(
      `${directory}/attempts-${crypto.randomUUID()}`,
    ),
    syson,
    lease: new FileEngineeringProjectRunLease(`${directory}/leases`),
    capabilityRuntime: capability.capabilityRuntime,
    capabilityRuntimeSession: capability.capabilityRuntimeSession,
    now: () => TIME,
  });
}

class EnrichmentArmSyson implements McpToolClient {
  readonly calls: McpToolCall[] = [];
  #children = 0;
  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(new Error(`unused ${call.name}`));
  }
  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(structuredClone(call));
    if (call.name === "syson_element_children") {
      const elementId = call.arguments?.element_id;
      if (elementId === ARM_ID) {
        this.#children++;
        const id = this.#children === 1 ? REQ_USAGE_ID : "requirement-usage-arm-2";
        return Promise.resolve({
          text: "children",
          structuredContent: {
            parentId: ARM_ID,
            children: [{
              id,
              kind: "siriusComponents://semantic?domain=sysml&entity=RequirementUsage",
              label: "ArmRequirements",
            }],
            count: 1,
          },
        });
      }
      const membersId = String(elementId);
      const extraConstraint = membersId === "requirement-usage-arm-2";
      return Promise.resolve({
        text: "members",
        structuredContent: {
          parentId: membersId,
          children: [
            {
              id: extraConstraint ? "reference-usage-arm-2" : REQ_SUBJECT_ID,
              kind: "siriusComponents://semantic?domain=sysml&entity=ReferenceUsage",
              label: "target",
            },
            {
              id: extraConstraint ? "constraint-usage-arm-force" : REQ_CONSTRAINT_ID,
              kind: "siriusComponents://semantic?domain=sysml&entity=ConstraintUsage",
              label: extraConstraint ? "max_force_limit" : "max_mass_limit",
            },
            ...(extraConstraint
              ? [{
                id: "constraint-usage-arm-mass-2",
                kind: "siriusComponents://semantic?domain=sysml&entity=ConstraintUsage",
                label: "max_mass_limit",
              }]
              : []),
          ],
          count: extraConstraint ? 3 : 2,
        },
      });
    }
    if (call.name === "syson_element_delete") {
      return Promise.resolve({ text: "deleted", structuredContent: { deleted: true } });
    }
    if (call.name === "syson_element_insert_sysml") {
      return Promise.resolve({
        text: "inserted",
        structuredContent: {
          inserted: true,
          parentId: call.arguments?.parent_id,
        },
      });
    }
    if (call.name === "syson_element_get") {
      return Promise.resolve({
        text: "requirement",
        structuredContent: {
          id: call.arguments?.element_id,
          kind: "siriusComponents://semantic?domain=sysml&entity=RequirementUsage",
          label: "ArmRequirements",
        },
      });
    }
    if (call.name === "syson_query_aql") {
      return Promise.resolve({
        text: "typing",
        structuredContent: {
          objectId: call.arguments?.object_id,
          expression: ARCHITECTURE_FEATURE_TYPING_AQL,
          type: "objects",
          results: [{
            id: ARM_ID,
            kind: "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
            label: "Arm",
          }],
          count: 1,
        },
      });
    }
    if (call.name === "syson_constraint_extract") {
      const extra = call.arguments?.element_id === "requirement-usage-arm-2";
      return Promise.resolve({
        text: "constraints",
        structuredContent: {
          constraints: [
            ...(extra
              ? [{
                id: "constraint-usage-arm-force",
                name: "max_force_limit",
                sourceId: "constraint-usage-arm-force",
                expression: {
                  kind: "binary",
                  op: "<=",
                  left: { kind: "ref", featurePath: ["maxForce"] },
                  right: { kind: "literal", value: 100, unit: "Pa" },
                },
              }]
              : []),
            {
              id: extra ? "constraint-usage-arm-mass-2" : REQ_CONSTRAINT_ID,
              name: "max_mass_limit",
              sourceId: extra ? "constraint-usage-arm-mass-2" : REQ_CONSTRAINT_ID,
              expression: {
                kind: "binary",
                op: "<=",
                left: { kind: "ref", featurePath: ["maxMass"] },
                right: { kind: "literal", value: 5, unit: "kg" },
              },
            },
          ],
        },
      });
    }
    return Promise.reject(new Error(`Unexpected tool ${call.name}`));
  }
}

function stubSysmlSourceAnalysis(): SysmlSourceAnalysisReader {
  return {
    reopen: (value) =>
      Promise.resolve({
        reference: value as never,
        source: {} as never,
        analysis: {} as never,
      }),
  };
}

function consume(
  input: ThreadArtifact,
  consumer: ThreadArtifact,
  at: string,
) {
  return {
    id: `consume-${input.id}-by-${consumer.id}`,
    artifactId: input.id,
    consumer: consumer.producer,
    observedFingerprint: input.fingerprint,
    verifiedAt: at,
    status: "verified" as const,
  };
}

function derived(fromId: string, toId: string, id: string) {
  return {
    id,
    relation: "derived_from" as const,
    from: { kind: "artifact" as const, id: fromId },
    to: { kind: "artifact" as const, id: toId },
    rationale: id,
  };
}

function uses(consumer: ThreadArtifact, input: ThreadArtifact, at: string) {
  return {
    id: `uses-consume-${input.id}-by-${consumer.id}`,
    relation: "uses" as const,
    from: {
      kind: "consumption" as const,
      id: `consume-${input.id}-by-${consumer.id}`,
    },
    to: { kind: "artifact" as const, id: input.id },
    rationale: `verified at ${at}`,
  };
}

function snapshot(
  revision: number,
  modelArtifactId: string,
  artifacts: readonly ThreadArtifact[],
  previous?: ThreadSnapshot,
  extras: {
    consumptions?: ThreadSnapshot["consumptions"];
    provenance?: ThreadSnapshot["provenance"];
    changes?: ThreadSnapshot["changeSet"]["changes"];
    requirements?: ThreadSnapshot["requirements"];
    observations?: ThreadSnapshot["observations"];
    evaluations?: ThreadSnapshot["evaluations"];
    violations?: ThreadSnapshot["violations"];
    proposedActions?: ThreadSnapshot["proposedActions"];
  } = {},
): ThreadSnapshot {
  return {
    schemaVersion: "1.0",
    id: revision === 1 ? `${SUBJECT_ID}:r1:baseline` : `${SUBJECT_ID}:r${revision}:rev`,
    revision,
    ...(previous
      ? { previous: { snapshotId: previous.id, revision: previous.revision } }
      : {}),
    generatedAt: revision >= 6
      ? SECOND_SUCCESSOR_AT
      : revision >= 5
      ? SUCCESSOR_AT
      : TIME,
    subject: {
      id: SUBJECT_ID,
      name: "Lamp",
      kind: "system",
      version: `r${revision}`,
      modelArtifactId,
    },
    freshness: fresh(
      revision >= 6 ? SECOND_SUCCESSOR_AT : revision >= 5 ? SUCCESSOR_AT : TIME,
    ),
    changeSet: {
      id: `cs-r${revision}`,
      name: `Revision ${revision}`,
      status: "applied",
      createdAt: revision >= 6
        ? SECOND_SUCCESSOR_AT
        : revision >= 5
        ? SUCCESSOR_AT
        : TIME,
      appliedAt: revision >= 6
        ? SECOND_SUCCESSOR_AT
        : revision >= 5
        ? SUCCESSOR_AT
        : TIME,
      changes: extras.changes ? [...extras.changes] : [],
    },
    artifacts: [...artifacts],
    consumptions: extras.consumptions ?? [],
    observations: extras.observations ?? [],
    requirements: extras.requirements ?? [],
    evaluations: extras.evaluations ?? [],
    violations: extras.violations ?? [],
    provenance: extras.provenance ?? [],
    proposedActions: extras.proposedActions ?? [],
  };
}

function fresh(at: string) {
  return {
    status: "fresh" as const,
    changedAt: at,
    invalidatedByChangeIds: [],
  };
}

type MutableProject = EngineeringProjectSnapshot & {
  agentRuns: Array<EngineeringProjectSnapshot["agentRuns"][number]>;
  workItems: Array<EngineeringProjectSnapshot["workItems"][number]>;
  decisions: Array<EngineeringProjectSnapshot["decisions"][number]>;
  approvals: Array<EngineeringProjectSnapshot["approvals"][number]>;
  threadSnapshots: Array<EngineeringProjectSnapshot["threadSnapshots"][number]>;
  commandReceipts: Array<{ commandId: string }>;
  revision: number;
};

class ProductCommands {
  constructor(private readonly project: MutableProject) {}
  claimRun(_origin: unknown, value: { runId: string }): Promise<void> {
    this.replace(value.runId, {
      status: "running",
      startedAt: TIME,
      claimedAt: TIME,
      claimedBy: { id: AGENT.actorId, origin: "agent" },
    });
    return Promise.resolve();
  }
  publishRun(_origin: unknown, value: { runId: string }): Promise<void> {
    this.replace(value.runId, { status: "publishing" });
    return Promise.resolve();
  }
  completeRun(
    _origin: unknown,
    value: {
      runId: string;
      resultSnapshot: {
        snapshotId: string;
        revision: number;
        subjectId: string;
      };
      evidenceRefs: readonly unknown[];
      commandId: string;
    },
  ): Promise<void> {
    this.replace(value.runId, {
      status: "completed",
      completedAt: TIME,
      resultSnapshot: value.resultSnapshot,
      evidenceRefs: value.evidenceRefs as never,
    });
    this.project.threadSnapshots.push(value.resultSnapshot);
    this.project.commandReceipts.push({ commandId: value.commandId });
    return Promise.resolve();
  }
  failRun(_origin: unknown, value: { runId: string }): Promise<void> {
    this.replace(value.runId, { status: "failed" });
    return Promise.resolve();
  }
  private replace(runId: string, update: Record<string, unknown>): void {
    const index = this.project.agentRuns.findIndex((run) => run.id === runId);
    this.project.agentRuns[index] = {
      ...this.project.agentRuns[index]!,
      ...update,
    } as never;
    this.project.revision++;
  }
}

class MemorySnapshots implements ThreadSnapshotStore {
  #items = new Map<string, ThreadSnapshot>();
  #fail = false;
  constructor(items: readonly ThreadSnapshot[], failOnce = false) {
    for (const item of items) this.#items.set(item.id, structuredClone(item));
    this.#fail = failOnce;
  }
  get(id: string): Promise<ThreadSnapshot | undefined> {
    const value = this.#items.get(id);
    return Promise.resolve(value && structuredClone(value));
  }
  getFresh(id: string): Promise<ThreadSnapshot | undefined> {
    return this.get(id);
  }
  latest(subjectId: string): Promise<ThreadSnapshot | undefined> {
    return Promise.resolve(
      [...this.#items.values()].filter((item) => item.subject.id === subjectId)
        .sort((a, b) => b.revision - a.revision)[0],
    );
  }
  save(snapshot: ThreadSnapshot): Promise<void> {
    if (this.#fail) {
      this.#fail = false;
      return Promise.reject(new Error("simulated snapshot save failure"));
    }
    this.#items.set(snapshot.id, structuredClone(snapshot));
    return Promise.resolve();
  }
}

const immediateLease: EngineeringProjectRunLease = {
  withLease: async <T>(
    _projectId: string,
    _runId: string,
    operation: () => Promise<T>,
  ) => await operation(),
};

class RecaptureSyson implements McpToolClient {
  readonly calls: McpToolCall[] = [];
  failIfCalled = false;
  collideSubjectWithTarget = false;
  replacedSubjectId: string | undefined;
  constructor(private readonly options: { driftedMetric: boolean }) {}
  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(new Error(`unused ${call.name}`));
  }
  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(structuredClone(call));
    if (this.failIfCalled) {
      return Promise.reject(new Error("SysON must not be queried again."));
    }
    if (call.name === "syson_element_children") {
      const elementId = call.arguments?.element_id;
      if (elementId === ARM_ID) {
        return Promise.resolve({
          text: "owned",
          structuredContent: {
            parentId: ARM_ID,
            children: [{
              id: REQ_USAGE_ID,
              kind: "siriusComponents://semantic?domain=sysml&entity=RequirementUsage",
              label: "ArmRequirements",
            }],
            count: 1,
          },
        });
      }
      if (elementId === REQ_USAGE_ID) {
        return Promise.resolve({
          text: "members",
          structuredContent: {
            parentId: REQ_USAGE_ID,
            children: [
              {
                id: this.collideSubjectWithTarget
                  ? ARM_ID
                  : (this.replacedSubjectId ?? REQ_SUBJECT_ID),
                kind: "siriusComponents://semantic?domain=sysml&entity=ReferenceUsage",
                label: "target",
              },
              {
                id: REQ_CONSTRAINT_ID,
                kind: "siriusComponents://semantic?domain=sysml&entity=ConstraintUsage",
                label: "max_mass_limit",
              },
            ],
            count: 2,
          },
        });
      }
    }
    if (call.name === "syson_element_get") {
      return Promise.resolve({
        text: "requirement",
        structuredContent: {
          id: REQ_USAGE_ID,
          kind: "siriusComponents://semantic?domain=sysml&entity=RequirementUsage",
          label: "ArmRequirements",
        },
      });
    }
    if (call.name === "syson_query_aql") {
      return Promise.resolve({
        text: "typing",
        structuredContent: {
          objectId: this.collideSubjectWithTarget
            ? ARM_ID
            : (this.replacedSubjectId ?? REQ_SUBJECT_ID),
          expression: ARCHITECTURE_FEATURE_TYPING_AQL,
          type: "objects",
          results: [{
            id: ARM_ID,
            kind: "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
            label: "Arm",
          }],
          count: 1,
        },
      });
    }
    if (call.name === "syson_constraint_extract") {
      return Promise.resolve({
        text: "constraints",
        structuredContent: {
          constraints: [{
            id: REQ_CONSTRAINT_ID,
            name: "max_mass_limit",
            sourceId: REQ_CONSTRAINT_ID,
            expression: {
              kind: "binary",
              op: "<=",
              left: { kind: "ref", featurePath: ["maxMass"] },
              right: {
                kind: "literal",
                value: this.options.driftedMetric ? 9 : 5,
                unit: "kg",
              },
            },
          }],
        },
      });
    }
    return Promise.reject(new Error(`Unexpected tool ${call.name}`));
  }
}
