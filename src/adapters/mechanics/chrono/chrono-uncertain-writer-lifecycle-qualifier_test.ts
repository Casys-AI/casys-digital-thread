import { assertEquals } from "@std/assert";
import {
  ChronoUncertainWriterLifecycleQualifier,
  sealedPrescribedKinematicsRuntimeFromPlan,
} from "./chrono-uncertain-writer-lifecycle-qualifier.ts";
import { FilePrescribedKinematicsObservationAttemptStore } from "./file-prescribed-kinematics-observation-attempt-store.ts";
import {
  ChronoPrescribedKinematicsCaseLowerer,
  fingerprintChronoPrescribedKinematicsLowering,
} from "./chrono-prescribed-kinematics-case-lowerer.ts";
import {
  canonicalizePrescribedKinematicsCaseSource,
} from "../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-case-source.ts";
import {
  type PrescribedKinematicsCase,
  sealPrescribedKinematicsCase,
} from "../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-source-closure.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  canonicalResolvedOperationPlanV2Text,
  fingerprintResolvedOperationPlanV2,
  type ResolvedOperationPlanRef,
  type ResolvedOperationPlanV2,
  validateResolvedOperationPlanV2,
} from "../../../domain/compile/rop/resolved-operation-plan-v2.ts";
import { resolvedOperationPlanRequestIdFor } from "../../compile/plans/resolved-operation-plan-resolver.ts";
import {
  VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION,
  VERIFY_RUN_PRESCRIBED_KINEMATICS_PROVIDER_OUTCOME_UNKNOWN_FAILURE,
} from "../../../domain/mechanism/prescribed-kinematics/operations.ts";
import { prescribedKinematicsObservationMethod } from "../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-observation.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../../../domain/project/engineering-project.ts";
import type {
  ResolvedCapabilityRuntimeOperation,
} from "../../../domain/capability/runtime/capability-runtime-supervision.ts";
import { TERMINAL_UNCERTAIN_WRITE_FAILURE_CODES } from "../../../domain/record/reconcile-uncertain-writer-proposal.ts";
import { firstPartyChronoLaunchGroupReference } from "../../control-plane/first-party-capability-runtime-launch-groups.ts";
import type { PrescribedKinematicsObservationAttempt } from "../../../application/ports/out/mechanics/prescribed-kinematics-observation-attempt-store.ts";
import { closedUncertainWriterLifecycleQualifier } from "../../../application/ports/out/record/uncertain-writer-lifecycle-qualifier.ts";

const PROJECT_ID = "project-lifecycle";
const RUN_ID = "run-kinematics";
const WORK_ID = "work-kinematics";
const STARTED_AT = "2026-08-29T00:01:00.000Z";
const GENERIC_FAILURE = "prescribed-kinematics-execution-failed";
/** Historical 0.3.1 ROP/WAL material; it must not reuse the active runtime pin. */
const HISTORICAL_CHRONO_031_IMAGE_REFERENCE =
  "ghcr.io/casys-ai/mcp-chrono@sha256:b6302001725df4722d84096a51eeff7e7ffeee843690a2ba0cc417191c67683c" as const;
const FP = (digest: string) => ({
  algorithm: "sha256" as const,
  digest: digest.length === 64 ? digest : digest.repeat(64).slice(0, 64),
});

Deno.test("the closed lifecycle qualifier never grants extra eligibility", async () => {
  const result = await closedUncertainWriterLifecycleQualifier.qualify({
    project: emptyProject(),
    failedRunId: RUN_ID,
  });
  assertEquals(result.status, "not-qualified");
});

Deno.test("the generic Chrono failure stays out of the dedicated catalogue", () => {
  assertEquals(TERMINAL_UNCERTAIN_WRITE_FAILURE_CODES.has(GENERIC_FAILURE), false);
  assertEquals(
    TERMINAL_UNCERTAIN_WRITE_FAILURE_CODES.has(
      VERIFY_RUN_PRESCRIBED_KINEMATICS_PROVIDER_OUTCOME_UNKNOWN_FAILURE,
    ),
    true,
  );
});

Deno.test("Chrono lifecycle authority accepts only the exact quarantined/malformed recross", async () => {
  const fixture = await recrossFixture({
    wal: { phase: "quarantined", reason: "malformed" },
  });
  try {
    const result = await fixture.qualifier.qualify({
      project: fixture.project,
      failedRunId: RUN_ID,
    });
    assertEquals(result.status, "qualified-uncertain-write");
  } finally {
    await Deno.remove(fixture.directory, { recursive: true });
  }
});

Deno.test("Chrono lifecycle recross uses the sealed 0.3.1 lowering identity, not the active 0.3.2 lowerer", async () => {
  const fixture = await recrossFixture({
    wal: { phase: "quarantined", reason: "malformed" },
  });
  try {
    const sealedCase = await sealedCaseFixture();
    const sourceFingerprint =
      sealedCase.sourceClosure.workspace.root.resourceFingerprint;
    const historical = await fingerprintChronoPrescribedKinematicsLowering({
      sourceFingerprint,
      binding: { unitId: "casys.mcp-chrono", adapterVersion: "0.3.1" },
    });
    const active = await new ChronoPrescribedKinematicsCaseLowerer().lower({
      source: sealedCase.sourceClosure.source,
      sourceFingerprint,
    });
    assertEquals(fixture.historicalLoweringFingerprint, historical);
    assertEquals(
      fingerprintsEqual(historical, active.loweringFingerprint),
      false,
    );
    assertEquals(
      (await fixture.qualifier.qualify({
        project: fixture.project,
        failedRunId: RUN_ID,
      })).status,
      "qualified-uncertain-write",
    );
  } finally {
    await Deno.remove(fixture.directory, { recursive: true });
  }
});

Deno.test("Chrono lifecycle authority also accepts quarantined/uncertain recross", async () => {
  const fixture = await recrossFixture({
    wal: { phase: "quarantined", reason: "uncertain" },
  });
  try {
    const result = await fixture.qualifier.qualify({
      project: fixture.project,
      failedRunId: RUN_ID,
    });
    assertEquals(result.status, "qualified-uncertain-write");
  } finally {
    await Deno.remove(fixture.directory, { recursive: true });
  }
});

Deno.test("Chrono lifecycle authority refuses absent, corrupt, divergent, nonterminal, recorded, and rejected recrosses", async () => {
  const cases: readonly {
    readonly name: string;
    readonly setup: (
      fixture: RecrossFixture,
    ) => Promise<EngineeringProjectSnapshot> | EngineeringProjectSnapshot;
  }[] = [
    {
      name: "absent WAL",
      setup: async (fixture) => {
        await Deno.remove(fixture.directory, { recursive: true });
        const rebuilt = await recrossFixture({ wal: { phase: "absent" } });
        fixture.directory = rebuilt.directory;
        fixture.qualifier = rebuilt.qualifier;
        return rebuilt.project;
      },
    },
    {
      name: "corrupt WAL",
      setup: async (fixture) => {
        await corruptWal(fixture.directory);
        return fixture.project;
      },
    },
    {
      name: "divergent request",
      setup: (fixture) => {
        if (fixture.plan.action.kind !== "prescribed-kinematics-observation") {
          throw new Error("Fixture plan is not a prescribed-kinematics observation.");
        }
        if (!("requestId" in fixture.plan.recovery)) {
          throw new Error("Fixture recovery has no request identity.");
        }
        const requestId = "rop2-prescribed-kinematics-ffffffffffffffffffffffffffffffff";
        return withPlan(fixture, {
          ...fixture.plan,
          action: { ...fixture.plan.action, requestId },
          recovery: { ...fixture.plan.recovery, requestId },
        });
      },
    },
    {
      name: "divergent runtime",
      setup: async (fixture) => {
        await rewriteWalRuntime(fixture, "e".repeat(64));
        return fixture.project;
      },
    },
    {
      name: "prepared",
      setup: async (fixture) => {
        await Deno.remove(fixture.directory, { recursive: true });
        const rebuilt = await recrossFixture({ wal: { phase: "prepared" } });
        fixture.directory = rebuilt.directory;
        fixture.qualifier = rebuilt.qualifier;
        return rebuilt.project;
      },
    },
    {
      name: "case-submitted",
      setup: async (fixture) => {
        await Deno.remove(fixture.directory, { recursive: true });
        const rebuilt = await recrossFixture({ wal: { phase: "case-submitted" } });
        fixture.directory = rebuilt.directory;
        fixture.qualifier = rebuilt.qualifier;
        return rebuilt.project;
      },
    },
    {
      name: "dispatching",
      setup: async (fixture) => {
        await Deno.remove(fixture.directory, { recursive: true });
        const rebuilt = await recrossFixture({ wal: { phase: "dispatching" } });
        fixture.directory = rebuilt.directory;
        fixture.qualifier = rebuilt.qualifier;
        return rebuilt.project;
      },
    },
    {
      name: "recorded",
      setup: async (fixture) => {
        await Deno.remove(fixture.directory, { recursive: true });
        const rebuilt = await recrossFixture({ wal: { phase: "recorded" } });
        fixture.directory = rebuilt.directory;
        fixture.qualifier = rebuilt.qualifier;
        return rebuilt.project;
      },
    },
    {
      name: "rejected",
      setup: async (fixture) => {
        await Deno.remove(fixture.directory, { recursive: true });
        const rebuilt = await recrossFixture({ wal: { phase: "rejected" } });
        fixture.directory = rebuilt.directory;
        fixture.qualifier = rebuilt.qualifier;
        return rebuilt.project;
      },
    },
    {
      name: "dedicated Chrono failure",
      setup: (fixture) =>
        withFailure(
          fixture.project,
          VERIFY_RUN_PRESCRIBED_KINEMATICS_PROVIDER_OUTCOME_UNKNOWN_FAILURE,
        ),
    },
    {
      name: "evidence present",
      setup: (fixture) => ({
        ...fixture.project,
        agentRuns: fixture.project.agentRuns.map((run) =>
          run.id === RUN_ID
            ? {
              ...run,
              evidenceRefs: [{
                snapshotId: "thread",
                snapshotRevision: 1,
                kind: "artifact" as const,
                id: "artifact",
              }],
            }
            : run
        ),
      }),
    },
  ];

  for (const entry of cases) {
    const fixture = await recrossFixture({
      wal: { phase: "quarantined", reason: "malformed" },
    });
    try {
      const project = await entry.setup(fixture);
      const result = await fixture.qualifier.qualify({
        project,
        failedRunId: RUN_ID,
      });
      assertEquals(result.status, "not-qualified", entry.name);
    } finally {
      await Deno.remove(fixture.directory, { recursive: true }).catch(() => {});
    }
  }
});

Deno.test("Chrono lifecycle authority refuses divergent lowering, request, and case identities", async () => {
  const mutations: readonly {
    readonly name: string;
    readonly mutate: (
      attempt: PrescribedKinematicsObservationAttempt,
    ) => PrescribedKinematicsObservationAttempt;
  }[] = [
    {
      name: "divergent lowering fingerprint",
      mutate: (attempt) => ({
        ...attempt,
        loweringFingerprint: FP("9"),
      }),
    },
    {
      name: "divergent request fingerprint",
      mutate: (attempt) => ({
        ...attempt,
        requestFingerprint: FP("9"),
      }),
    },
    {
      name: "divergent case SHA/request identity",
      mutate: (attempt) =>
        "caseSha256" in attempt
          ? {
            ...attempt,
            caseSha256: "9".repeat(64),
            caseUri: `chrono-case:sha256:${"9".repeat(64)}`,
          }
          : attempt,
    },
  ];

  for (const mutation of mutations) {
    const fixture = await recrossFixture({
      wal: { phase: "quarantined", reason: "malformed" },
    });
    try {
      await rewriteWal(fixture, mutation.mutate);
      const result = await fixture.qualifier.qualify({
        project: fixture.project,
        failedRunId: RUN_ID,
      });
      assertEquals(result.status, "not-qualified", mutation.name);
    } finally {
      await Deno.remove(fixture.directory, { recursive: true }).catch(() => {});
    }
  }
});

Deno.test("the qualifier does not hardcode a run, project, or request identity", async () => {
  const source = await Deno.readTextFile(
    new URL("./chrono-uncertain-writer-lifecycle-qualifier.ts", import.meta.url),
  );
  assertEquals(source.includes("ml01-requeue-kinematics-observation-v2"), false);
  assertEquals(source.includes("06a36c51bb9e1c932463f22cc8c137d9"), false);
});

interface RecrossFixture {
  directory: string;
  qualifier: ChronoUncertainWriterLifecycleQualifier;
  project: EngineeringProjectSnapshot;
  plan: ResolvedOperationPlanV2;
  historicalLoweringFingerprint: ContentFingerprint;
}

type WalPhase =
  | { readonly phase: "absent" }
  | {
    readonly phase: "quarantined";
    readonly reason: "uncertain" | "malformed" | "absent";
  }
  | {
    readonly phase:
      | "prepared"
      | "case-submitted"
      | "dispatching"
      | "recorded"
      | "rejected";
  };

async function recrossFixture(input: {
  readonly wal: WalPhase;
}): Promise<RecrossFixture> {
  const directory = await Deno.makeTempDir({ prefix: "chrono-lifecycle-wal-" });
  const sealedCase = await sealedCaseFixture();
  const caseBytes = new TextEncoder().encode(deterministicJson(sealedCase));
  const artifactFingerprint = {
    algorithm: "sha256" as const,
    digest: await fingerprintResourceBytes(caseBytes),
  };
  const operation = {
    ...VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION,
    bindings: [],
  };
  const operationalCapability = await chronoOperationalCapability(PROJECT_ID);
  const requestId = await resolvedOperationPlanRequestIdFor(
    RUN_ID,
    "prescribed-kinematics",
  );
  const method = await prescribedKinematicsObservationMethod();
  const basisFingerprint = FP("b");
  const inputFingerprint = FP("c");
  const draft: ResolvedOperationPlanV2 = {
    schemaVersion: "resolved-operation-plan/2.0",
    id: RUN_ID,
    run: {
      projectId: PROJECT_ID,
      runId: RUN_ID,
      workItemId: WORK_ID,
      inputFingerprint,
      queueBasisProject: {
        snapshotId: "project:r1",
        revision: 1,
        fingerprint: FP("d"),
      },
    },
    workItem: {
      id: WORK_ID,
      operation: {
        id: VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION.id,
        version: VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION.version,
      },
      operationFingerprint: await sha256Fingerprint(operation),
    },
    operationalCapability,
    authorization: {
      kind: "human-mrtr-and-qualified-method",
      mrtr: {
        decisionId: "decision-kinematics",
        decisionInputFingerprint: FP("e"),
        approvalId: "approval-kinematics",
        approvalFingerprint: FP("f"),
      },
      methodQualification: {
        id: method.id,
        version: method.version,
        fingerprint: method.fingerprint,
      },
    },
    basis: {
      kind: "thread-snapshot",
      snapshotId: "thread",
      revision: 1,
      subjectId: "subject",
      fingerprint: basisFingerprint,
    },
    sources: [{
      bindingName: "case",
      role: "prescribed-kinematics-case",
      threadRef: {
        snapshotId: "thread",
        snapshotRevision: 1,
        kind: "artifact",
        id: "artifact.case",
      },
      artifact: {
        fingerprint: artifactFingerprint,
        byteCount: caseBytes.byteLength,
        mediaType: "application/json",
        casUri:
          `casys://prescribed-kinematics-case/sha256/${artifactFingerprint.digest}`,
      },
    }],
    action: {
      kind: "prescribed-kinematics-observation",
      lowering: { id: "prescribed-kinematics.case-json", version: "1.0" },
      requestId,
      input: {
        prescribedKinematicsCase: {
          id: "artifact.case",
          fingerprint: artifactFingerprint,
          sourceBinding: "case",
        },
      },
    },
    expectedProviderResources: {
      receiptSchema: "chrono-prescribed-kinematics-receipt/1.0",
      evidenceSchema: "prescribed-kinematics-observation/1.0",
      resourceProfile: {
        id: "prescribed-kinematics.observation-artifacts",
        version: "1.0",
      },
    },
    recovery: {
      policy: "prescribed-kinematics.observation-recovery@1.0",
      requestId,
      mode: "same-request-readback-no-blind-redispatch",
      ambiguousOutcome: "quarantine-for-human-review",
      capturedOutcome: "cas-only-recovery",
    },
  };
  const plan = validateResolvedOperationPlanV2(draft);
  const ref = await planRef(plan);
  const workItem: EngineeringWorkItem = {
    id: WORK_ID,
    activityId: "activity-kinematics",
    phaseId: "phase",
    title: "Run prescribed kinematics",
    description: "Observe one sealed case.",
    kind: "verify",
    operation,
    status: "cancelled",
    owner: "agent",
    dependsOnWorkItemIds: [],
    evidenceRefs: [],
    decisionIds: ["decision-kinematics"],
    blockerIds: [],
  };
  const run: EngineeringAgentRun = {
    id: RUN_ID,
    workItemId: WORK_ID,
    status: "failed",
    summary: "Prescribed-kinematics execution did not materialize evidence.",
    queuedAt: "2026-08-29T00:00:00.000Z",
    startedAt: STARTED_AT,
    completedAt: "2026-08-29T00:02:00.000Z",
    claimedAt: STARTED_AT,
    claimedBy: { id: "agent:test", origin: "agent" },
    basis: {
      kind: "thread-snapshot",
      snapshotId: "thread",
      revision: 1,
      subjectId: "subject",
    },
    inputFingerprint,
    resolvedOperationPlan: ref,
    evidenceRefs: [],
    failure: {
      code: GENERIC_FAILURE,
      message: "Chrono outcome remains recoverable/quarantined: malformed.",
    },
  };
  const project = projectOf(workItem, run);
  const runtime = await sealedPrescribedKinematicsRuntimeFromPlan(plan);
  if (!runtime) throw new Error("Sealed Chrono runtime could not be derived.");
  const attempts = new FilePrescribedKinematicsObservationAttemptStore(directory);
  const lowerer = new ChronoPrescribedKinematicsCaseLowerer();
  const lowered = await lowerer.lower({
    source: sealedCase.sourceClosure.source,
    sourceFingerprint: sealedCase.sourceClosure.workspace.root.resourceFingerprint,
  });
  const historicalLoweringFingerprint =
    await fingerprintChronoPrescribedKinematicsLowering({
      sourceFingerprint: sealedCase.sourceClosure.workspace.root.resourceFingerprint,
      binding: { unitId: "casys.mcp-chrono", adapterVersion: "0.3.1" },
    });
  const identity = {
    projectId: PROJECT_ID,
    agentRunId: RUN_ID,
    requestId,
    caseFingerprint: sealedCase.fingerprint,
    runtime,
    sourceFingerprint: sealedCase.sourceClosure.workspace.root.resourceFingerprint,
    loweringFingerprint: historicalLoweringFingerprint,
    requestFingerprint: lowered.requestFingerprint,
    startedAt: STARTED_AT,
  };
  if (input.wal.phase !== "absent") {
    await driveWal(attempts, identity, input.wal, {
      caseSha256: lowered.requestFingerprint.digest,
      caseUri: `chrono-case:sha256:${lowered.requestFingerprint.digest}`,
    });
  }
  const qualifier = new ChronoUncertainWriterLifecycleQualifier({
    attempts,
    plans: {
      read: (value) => {
        if (value.planId !== ref.planId) {
          return Promise.reject(
            new TypeError("Plan reader refuses an arbitrary CAS reference."),
          );
        }
        return Promise.resolve(structuredClone(plan));
      },
    },
    captures: {
      readCase: (fingerprint) =>
        Promise.resolve(
          fingerprintsEqual(fingerprint, artifactFingerprint) ? sealedCase : undefined,
        ),
    },
    lowerer,
  });
  return {
    directory,
    qualifier,
    project,
    plan,
    historicalLoweringFingerprint,
  };
}

async function driveWal(
  attempts: FilePrescribedKinematicsObservationAttemptStore,
  identity: Parameters<FilePrescribedKinematicsObservationAttemptStore["prepare"]>[0],
  wal: Exclude<WalPhase, { readonly phase: "absent" }>,
  submitted: { readonly caseSha256: string; readonly caseUri: string },
): Promise<void> {
  await attempts.prepare(identity);
  if (wal.phase === "prepared") return;
  await attempts.markCaseSubmitted(identity, submitted);
  if (wal.phase === "case-submitted") return;
  await attempts.markDispatching(identity);
  if (wal.phase === "dispatching") return;
  if (wal.phase === "recorded") {
    await attempts.markRecorded(identity, "b".repeat(64));
    return;
  }
  if (wal.phase === "rejected") {
    await attempts.markRejected(identity, "invalid_case_json");
    return;
  }
  if (wal.phase !== "quarantined") {
    throw new Error("WAL fixture phase is not quarantined.");
  }
  await attempts.markQuarantined(identity, wal.reason);
}

async function rewriteWalRuntime(
  fixture: RecrossFixture,
  imageDigest: string,
): Promise<void> {
  await rewriteWal(fixture, (value) => ({
    ...value,
    runtime: {
      ...value.runtime,
      material: { ...value.runtime.material, imageDigest },
    },
  }));
}

async function rewriteWal(
  fixture: RecrossFixture,
  mutate: (
    value: PrescribedKinematicsObservationAttempt,
  ) => PrescribedKinematicsObservationAttempt,
): Promise<void> {
  for await (const entry of Deno.readDir(fixture.directory)) {
    if (!entry.isFile || !entry.name.endsWith(".json")) continue;
    const path = `${fixture.directory}/${entry.name}`;
    const value = JSON.parse(
      await Deno.readTextFile(path),
    ) as PrescribedKinematicsObservationAttempt;
    await Deno.writeTextFile(path, `${deterministicJson(mutate(value))}\n`);
  }
}

async function corruptWal(directory: string): Promise<void> {
  for await (const entry of Deno.readDir(directory)) {
    if (!entry.isFile || !entry.name.endsWith(".json")) continue;
    await Deno.writeTextFile(`${directory}/${entry.name}`, "{not-json");
  }
}

function withPlan(
  fixture: RecrossFixture,
  plan: ResolvedOperationPlanV2,
): EngineeringProjectSnapshot {
  const validated = validateResolvedOperationPlanV2(plan);
  fixture.qualifier = new ChronoUncertainWriterLifecycleQualifier({
    attempts: new FilePrescribedKinematicsObservationAttemptStore(fixture.directory),
    plans: { read: () => Promise.resolve(validated) },
    captures: {
      readCase: () => Promise.resolve(undefined),
    },
    lowerer: new ChronoPrescribedKinematicsCaseLowerer(),
  });
  return fixture.project;
}

function withFailure(
  project: EngineeringProjectSnapshot,
  code: string,
): EngineeringProjectSnapshot {
  return {
    ...project,
    agentRuns: project.agentRuns.map((run) =>
      run.id === RUN_ID && run.failure
        ? { ...run, failure: { ...run.failure, code } }
        : run
    ),
  };
}

function projectOf(
  workItem: EngineeringWorkItem,
  run: EngineeringAgentRun,
): EngineeringProjectSnapshot {
  return {
    schemaVersion: "4.0",
    id: "project:r2",
    revision: 2,
    generatedAt: STARTED_AT,
    project: {
      id: PROJECT_ID,
      name: "Lifecycle",
      subjectId: "subject",
      objective: { title: "Objective", statement: "Qualify one historical run." },
    },
    threadSnapshots: [{
      snapshotId: "thread",
      revision: 1,
      subjectId: "subject",
    }],
    phases: [{
      id: "phase",
      name: "Phase",
      order: 1,
      description: "Phase",
      workItemIds: [workItem.id],
      requiredDecisionIds: [],
      evidenceRefs: [],
    }],
    workItems: [workItem],
    agentRuns: [run],
    decisions: [],
    approvals: [],
    blockers: [],
  };
}

function emptyProject(): EngineeringProjectSnapshot {
  return projectOf({
    id: "work",
    activityId: "activity",
    phaseId: "phase",
    title: "Work",
    description: "Work",
    kind: "verify",
    status: "ready",
    owner: "agent",
    dependsOnWorkItemIds: [],
    evidenceRefs: [],
    decisionIds: [],
    blockerIds: [],
  }, {
    id: "run-other",
    workItemId: "work",
    status: "queued",
    summary: "Queued",
    queuedAt: STARTED_AT,
    evidenceRefs: [],
  });
}

async function planRef(
  plan: ResolvedOperationPlanV2,
): Promise<ResolvedOperationPlanRef> {
  const fingerprint = await fingerprintResolvedOperationPlanV2(plan);
  return {
    schemaVersion: "resolved-operation-plan-ref/1.0",
    planId: plan.id,
    fingerprint,
    byteCount: new TextEncoder().encode(canonicalResolvedOperationPlanV2Text(plan))
      .byteLength,
    casUri: `casys://resolved-operation-plan/sha256/${fingerprint.digest}`,
  };
}

async function chronoOperationalCapability(
  projectId: string,
): Promise<ResolvedCapabilityRuntimeOperation> {
  const launchGroup = await firstPartyChronoLaunchGroupReference();
  const imageDigest = HISTORICAL_CHRONO_031_IMAGE_REFERENCE.slice(
    HISTORICAL_CHRONO_031_IMAGE_REFERENCE.lastIndexOf("@sha256:") +
      "@sha256:".length,
  );
  const material = {
    unitId: "casys.mcp-chrono",
    materialId: "mcp-chrono-image",
    imageDigest,
  };
  const fingerprint = FP("a");
  return {
    schemaVersion: "resolved-capability-runtime-operation/2.0",
    projectId,
    operation: { ...VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION },
    authorizationFingerprint: fingerprint,
    demandFingerprint: fingerprint,
    registryFingerprint: fingerprint,
    bindings: [{
      capability: {
        id: "mechanics.observe-prescribed-kinematics",
        version: "1",
        use: "execution",
        minimumQualification: "qualified",
      },
      binding: { id: "chrono-prescribed-kinematics", version: "1" },
      effectiveQualification: "qualified",
      adapter: {
        id: "chrono-prescribed-kinematics-adapter",
        version: "0.3.1",
        source: "src/adapters/mechanics/chrono/chrono-prescribed-kinematics-client.ts",
      },
      profile: null,
      materials: [material],
      runtimeModes: [{
        material,
        targetPlatform: "linux/amd64",
        mode: "native",
        qualificationAttestationFingerprint: null,
      }],
      hostLifecycles: [{
        material,
        kind: "persistent-compose",
        launchGroup,
      }],
    }],
  };
}

async function sealedCaseFixture(): Promise<PrescribedKinematicsCase> {
  const projectId = PROJECT_ID;
  const subjectId = "subject";
  const pose = {
    positionM: [0, 0, 0] as const,
    orientationWxyz: [1, 0, 0, 0] as const,
  };
  const { source, text } = canonicalizePrescribedKinematicsCaseSource({
    schemaVersion: "prescribed-kinematics-case-source/1.0",
    id: "case",
    revision: 1,
    scope: "Two-body prescribed mechanism.",
    evidenceBoundary:
      "Only kinematic poses, angles, residuals, and convergence are observable.",
    project: { id: projectId, subjectId },
    assembly: { elementId: "usage-assembly", elementKind: "PartUsage" },
    units: { length: "m", angle: "rad", time: "s" },
    durationS: 1,
    groundBodyId: "base",
    bodies: [{ bodyId: "base", partUsageElementId: "usage-base", zeroPose: pose }, {
      bodyId: "head",
      partUsageElementId: "usage-head",
      zeroPose: pose,
    }],
    joints: [{
      jointId: "joint",
      kind: "revolute",
      parentBodyId: "base",
      childBodyId: "head",
      parentFrame: { ...pose, axis: [0, 0, 1] as const },
      childFrame: { ...pose, axis: [0, 0, 1] as const },
      limitRad: { minimum: -1, maximum: 1 },
      ramp: {
        kind: "linear",
        startTimeS: 0,
        endTimeS: 1,
        initialAngleRad: 0,
        finalAngleRad: 0.5,
      },
    }],
    sampling: { timeStepS: 0.5 },
  });
  const sourceFingerprint = {
    algorithm: "sha256" as const,
    digest: await fingerprintResourceBytes(new TextEncoder().encode(text)),
  };
  const sourceClosureBody = {
    schemaVersion: "prescribed-kinematics-source-closure/1.0" as const,
    source,
    workspace: {
      projectId,
      workspaceRevision: 1,
      workspaceEventFingerprint: FP("a"),
      declaredAgainst: {
        thread: { snapshotId: "thread", revision: 1, subjectId },
        architecture: {
          artifactId: `architecture-${"b".repeat(64)}`,
          fingerprint: FP("b"),
          captureSchema: "architecture-capture/4.0" as const,
        },
      },
      attachments: ["usage-assembly", "usage-base", "usage-head"].map(
        (elementId, index) => ({
          attachmentId: `attachment-${index + 1}`,
          attachmentRevision: 1,
          fingerprint: FP("c"),
          closureFingerprint: FP("d"),
          elementId,
          elementKind: "PartUsage" as const,
        }),
      ),
      root: {
        fileId: "file",
        fileRevision: 1,
        resourceFingerprint: sourceFingerprint,
        byteCount: new TextEncoder().encode(text).byteLength,
      },
    },
  } as const;
  return await sealPrescribedKinematicsCase({
    ...sourceClosureBody,
    fingerprint: await sha256Fingerprint(sourceClosureBody),
  });
}
