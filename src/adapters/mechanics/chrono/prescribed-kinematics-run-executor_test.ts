import {
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "@std/assert";
import {
  exactPrescribedKinematicsRuntimeMode,
  prescribedKinematicsObservationCommandFromResolvedAction,
  PrescribedKinematicsRunExecutor,
  recrossResolvedPrescribedKinematicsCaseArtifact,
} from "./prescribed-kinematics-run-executor.ts";
import type {
  ResolvedCapabilityRuntimeOperation,
} from "../../../domain/capability/runtime/capability-runtime-supervision.ts";
import type {
  CapabilityRuntimeExecutionMode,
  CapabilityRuntimeMaterialIdentity,
  CapabilityRuntimeMaterialRuntimeMode,
} from "../../../domain/capability/runtime/capability-runtime-material.ts";
import {
  resolvedOperationPlanRequestIdFor,
  ResolvedOperationPlanResolver,
} from "../../compile/plans/resolved-operation-plan-resolver.ts";
import {
  fingerprintResourceBytes,
} from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import {
  canonicalResolvedOperationPlanV2Text,
  fingerprintResolvedOperationPlanV2,
  type ResolvedOperationPlanRef,
  type ResolvedOperationPlanV2,
  type ResolvedPrescribedKinematicsObservationAction,
  sameResolvedOperationPlanRef,
} from "../../../domain/compile/rop/resolved-operation-plan-v2.ts";
import {
  canonicalizePrescribedKinematicsCaseSource,
} from "../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-case-source.ts";
import {
  type PrescribedKinematicsCase,
  sealPrescribedKinematicsCase,
} from "../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-source-closure.ts";
import {
  DECIDE_ACCEPT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION,
  VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION,
  VERIFY_RUN_PRESCRIBED_KINEMATICS_PROVIDER_OUTCOME_UNKNOWN_FAILURE,
  VERIFY_SEAL_PRESCRIBED_KINEMATICS_CASE_OPERATION,
} from "../../../domain/mechanism/prescribed-kinematics/operations.ts";
import { encodePrescribedKinematicsRunProposalParameters } from "../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-proposal.ts";
import { TERMINAL_UNCERTAIN_WRITE_FAILURE_CODES } from "../../../domain/record/reconcile-uncertain-writer-proposal.ts";
import { MODEL_WRITE_ARCHITECTURE_OPERATION } from "../../../domain/architecture/renderer/architecture-proposal.ts";
import {
  EngineeringProjectCommandError,
  EngineeringProjectCommandService,
  type EngineeringProjectPlanningDependencies,
  type EngineeringProjectPlanOperationRegistry,
  type FailRunCommand,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  type EngineeringProjectRevisionStore,
  EngineeringProjectStoreConflictError,
} from "../../../application/ports/out/engineering-project-revision-store.ts";
import { ProjectBriefCommandService } from "../../../application/use-cases/project/project-brief-command-service.ts";
import type { ProjectBriefItem } from "../../../domain/project/project-brief.ts";
import type { RegisteredRunPlanSealInput } from "../../../domain/project/resolved-run-plan-sealer.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
} from "../../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import type {
  RunPrescribedKinematicsObservationResult,
} from "../../../application/ports/in/mechanics/prescribed-kinematics/run-prescribed-kinematics-observation.ts";
import type {
  UncertainWriterLifecycleQualifier,
} from "../../../application/ports/out/record/uncertain-writer-lifecycle-qualifier.ts";
import type {
  CapabilityRuntimeSecretSnapshot,
} from "../../../application/ports/out/capability/capability-runtime-supervisor.ts";
import {
  recordingCapabilityRuntimeSession,
} from "../../../testing/capability-runtime-execution-session-test-support.ts";
import {
  MCP_CHRONO_032_IMAGE_REFERENCE,
} from "../../control-plane/first-party-capability-runtime-identities.ts";
import {
  firstPartyChronoLaunchGroupReference,
} from "../../control-plane/first-party-capability-runtime-launch-groups.ts";

Deno.test("the dedicated Chrono uncertain failure code is in the canonical reconciliation catalogue", () => {
  assertEquals(
    VERIFY_RUN_PRESCRIBED_KINEMATICS_PROVIDER_OUTCOME_UNKNOWN_FAILURE,
    "verify-run-prescribed-kinematics-provider-outcome-unknown",
  );
  assertEquals(
    TERMINAL_UNCERTAIN_WRITE_FAILURE_CODES.has(
      VERIFY_RUN_PRESCRIBED_KINEMATICS_PROVIDER_OUTCOME_UNKNOWN_FAILURE,
    ),
    true,
  );
});

Deno.test("prescribed-kinematics executor refuses L3 without sealed runtime composition", async () => {
  const executor = fixture(VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION);
  await assertRejects(
    () => executor.execute({ kind: "agent", actorId: "agent:test" }, command),
    Error,
    "sealed runtime, plan, and host-session composition",
  );
});

Deno.test("an unavailable L3 session composition cannot claim a run or reach L3 persistence", async () => {
  let claims = 0;
  let captures = 0;
  const executor = fixture(VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION, {
    commands: {
      claimRun: () => {
        claims++;
        throw new Error("A failed session must preclude claimRun.");
      },
    },
    captures: {
      saveObservation: () => {
        captures++;
        throw new Error("A failed session must preclude the L3 capture lane.");
      },
    },
  });

  await assertRejects(
    () => executor.execute({ kind: "agent", actorId: "agent:test" }, command),
    Error,
    "sealed runtime, plan, and host-session composition",
  );
  assertEquals(claims, 0);
  assertEquals(captures, 0);
});

Deno.test("prescribed-kinematics executor refuses agent origin before any L5 side effect", async () => {
  const executor = fixture(DECIDE_ACCEPT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION);
  await assertRejects(
    () => executor.execute({ kind: "agent", actorId: "agent:test" }, command),
    Error,
    "human origin",
  );
});

Deno.test("the prescribed-kinematics executor checks the Thread write basis before L3 runtime effects", async () => {
  const effects = {
    planReads: 0,
    sessionBegins: 0,
    secretSnapshots: 0,
    claims: 0,
    observes: 0,
  };
  const harness = writerHarness({
    operation: VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION,
    status: "queued",
    siblingCompleted: MODEL_WRITE_ARCHITECTURE_OPERATION,
    l3: effects,
  });

  await assertRejects(
    () => harness.executor.execute(AGENT, command),
    EngineeringProjectCommandError,
    "sibling run",
  );
  assertEquals(effects, {
    planReads: 0,
    sessionBegins: 0,
    secretSnapshots: 0,
    claims: 0,
    observes: 0,
  });
  assertEquals(harness.failed, undefined);
});

Deno.test("a lifecycle-qualified legacy Chrono sibling blocks before JIT session begin or provider effects", async () => {
  const effects = {
    planReads: 0,
    sessionBegins: 0,
    secretSnapshots: 0,
    claims: 0,
    observes: 0,
  };
  const siblingId = "run:sibling";
  const harness = writerHarness({
    operation: VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION,
    status: "queued",
    siblingFailed: {
      operation: VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION,
      failure: {
        code: "prescribed-kinematics-execution-failed",
        message: "Chrono outcome remains recoverable/quarantined: malformed.",
      },
    },
    uncertainWriterLifecycle: {
      qualify: (input) =>
        Promise.resolve({
          status: input.failedRunId === siblingId
            ? "qualified-uncertain-write" as const
            : "not-qualified" as const,
        }),
    },
    l3: effects,
  });

  await assertRejects(
    () => harness.executor.execute(AGENT, command),
    EngineeringProjectCommandError,
    "sibling run",
  );
  assertEquals(effects, {
    planReads: 0,
    sessionBegins: 0,
    secretSnapshots: 0,
    claims: 0,
    observes: 0,
  });
  assertEquals(harness.failed, undefined);
});

Deno.test("a freshly claimed uncertain Chrono outcome is failed with the dedicated terminal code", async () => {
  const harness = await l3LifecycleHarness({
    status: "queued",
    observation: { status: "quarantined", reason: "uncertain" },
  });

  await assertRejects(
    () => harness.executor.execute(AGENT, harness.command),
    EngineeringProjectCommandError,
    "Chrono outcome remains recoverable/quarantined: uncertain.",
  );
  assertEquals(harness.claims, 1);
  assertEquals(
    harness.failed?.code,
    VERIFY_RUN_PRESCRIBED_KINEMATICS_PROVIDER_OUTCOME_UNKNOWN_FAILURE,
  );
  assertEquals(harness.session.releases, 0);
  assertEquals(harness.session.retains, 1);
  assertNoObservationMaterialization(harness);
  assertEquals(
    (await harness.store.get(L3_PROJECT_ID))?.agentRuns.find((run) =>
      run.id === L3_RUN_ID
    )?.status,
    "failed",
  );
});

Deno.test("a resumed running uncertain Chrono outcome is failed with the dedicated terminal code", async () => {
  const harness = await l3LifecycleHarness({
    status: "running",
    observation: { status: "quarantined", reason: "absent" },
  });

  await assertRejects(
    () => harness.executor.execute(AGENT, harness.command),
    EngineeringProjectCommandError,
    "Chrono outcome remains recoverable/quarantined: absent.",
  );
  assertEquals(harness.claims, 0);
  assertEquals(
    harness.failed?.code,
    VERIFY_RUN_PRESCRIBED_KINEMATICS_PROVIDER_OUTCOME_UNKNOWN_FAILURE,
  );
  assertEquals(harness.session.releases, 0);
  assertEquals(harness.session.retains, 1);
  assertNoObservationMaterialization(harness);
});

Deno.test("a known Chrono pre-dispatch rejection keeps the generic failure code and releases the session", async () => {
  const queued = await l3LifecycleHarness({
    status: "queued",
    observation: { status: "rejected", code: "invalid_case_json" },
  });
  await assertRejects(
    () => queued.executor.execute(AGENT, queued.command),
    EngineeringProjectCommandError,
    "Chrono rejected the request before dispatch: invalid_case_json.",
  );
  assertEquals(queued.claims, 1);
  assertEquals(queued.failed?.code, "prescribed-kinematics-execution-failed");
  assertEquals(queued.session.releases, 1);
  assertEquals(queued.session.retains, 0);
  assertNoObservationMaterialization(queued);

  const resumed = await l3LifecycleHarness({
    status: "running",
    observation: { status: "rejected", code: "invalid_case_json" },
  });
  await assertRejects(
    () => resumed.executor.execute(AGENT, resumed.command),
    EngineeringProjectCommandError,
    "Chrono rejected the request before dispatch: invalid_case_json.",
  );
  assertEquals(resumed.claims, 0);
  assertEquals(resumed.failed?.code, "prescribed-kinematics-execution-failed");
  assertEquals(resumed.session.releases, 1);
  assertEquals(resumed.session.retains, 0);
  assertNoObservationMaterialization(resumed);
  assertEquals(
    (await resumed.store.get(L3_PROJECT_ID))?.agentRuns.find((run) =>
      run.id === L3_RUN_ID
    )?.status,
    "failed",
  );
});

Deno.test("a recorded L3 successor attests derived_from and uses provenance to the exact sealed case", async () => {
  const harness = await l3LifecycleHarness({
    status: "queued",
    observation: recordedKinematicsObservation(),
  });

  const completed = await harness.executor.execute(AGENT, harness.command);
  const run = completed.agentRuns.find((item) => item.id === L3_RUN_ID);
  assertEquals(run?.status, "completed");
  assertEquals(harness.claims, 1);
  assertEquals(harness.observationSaves, 1);
  assertEquals(harness.threadSaves, 1);
  assertEquals(harness.publishes, 1);
  assertEquals(harness.completes, 1);
  assertEquals(harness.session.releases, 1);
  assertEquals(harness.session.retains, 0);

  const successor = harness.savedSuccessor;
  if (!successor) {
    throw new Error("The recorded L3 path must persist a Thread successor.");
  }
  validateThreadSnapshot(successor);
  assertEquals(successor.id, run?.resultSnapshot?.snapshotId);
  assertEquals(successor.revision, run?.resultSnapshot?.revision);

  const observation = successor.artifacts.find((artifact) =>
    artifact.producer.tool ===
      `${VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION.id}@${VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION.version}`
  );
  if (!observation) {
    throw new Error("The recorded L3 successor must contain the observation artifact.");
  }
  assertEquals(observation.inputArtifactIds, [L3_CASE_ARTIFACT_ID]);
  const consumptionId =
    `prescribed-kinematics-consume-${L3_RUN_ID}-${L3_CASE_ARTIFACT_ID}`;
  const caseArtifact = successor.artifacts.find((artifact) =>
    artifact.id === L3_CASE_ARTIFACT_ID
  );
  if (!caseArtifact) {
    throw new Error("The successor must keep the exact sealed L1 case.");
  }
  assertEquals(
    successor.consumptions.filter((item) => item.artifactId === L3_CASE_ARTIFACT_ID),
    [{
      id: consumptionId,
      artifactId: L3_CASE_ARTIFACT_ID,
      consumer: observation.producer,
      observedFingerprint: caseArtifact.fingerprint,
      verifiedAt: L3_AT,
      status: "verified",
    }],
  );
  assertEquals(
    successor.provenance.filter((link) => link.relation === "derived_from"),
    [{
      id: `prescribed-kinematics-derived-from-${L3_RUN_ID}-${L3_CASE_ARTIFACT_ID}`,
      relation: "derived_from",
      from: { kind: "artifact", id: observation.id },
      to: { kind: "artifact", id: L3_CASE_ARTIFACT_ID },
      rationale: "The captured evidence is derived from this exact consumed artifact.",
    }],
  );
  assertEquals(
    successor.provenance.filter((link) => link.relation === "uses"),
    [{
      id: `prescribed-kinematics-uses-${L3_RUN_ID}-${L3_CASE_ARTIFACT_ID}`,
      relation: "uses",
      from: { kind: "consumption", id: consumptionId },
      to: { kind: "artifact", id: L3_CASE_ARTIFACT_ID },
      rationale:
        "The verified consumption attests this exact consumed artifact fingerprint.",
    }],
  );
});

Deno.test("the Chrono executor carries the resolver's sealed ROP request identity unchanged", async () => {
  const requestId = await resolvedOperationPlanRequestIdFor(
    "run",
    "prescribed-kinematics",
  );
  const action: ResolvedPrescribedKinematicsObservationAction = {
    kind: "prescribed-kinematics-observation",
    lowering: { id: "prescribed-kinematics.case-json", version: "1.0" },
    requestId,
    input: {
      prescribedKinematicsCase: {
        id: "case-capture",
        fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
        sourceBinding: "case",
      },
    },
  };
  const command = prescribedKinematicsObservationCommandFromResolvedAction({
    action,
    projectId: "project",
    agentRunId: "run",
    startedAt: "2026-08-29T00:00:00.000Z",
    runtime: {} as never,
    sealedCase: {} as never,
  });

  assertEquals(command.requestId, requestId);
  assertEquals(command.requestId.startsWith("rop2-prescribed-kinematics-"), true);
});

Deno.test("the Chrono executor recrosses an actual sealed case's outer capture identity before lowering its distinct domain case", async () => {
  const sealedCase = await sealedCaseFixture();
  const captureFingerprint = {
    algorithm: "sha256" as const,
    digest: await fingerprintResourceBytes(
      new TextEncoder().encode(deterministicJson(sealedCase)),
    ),
  };
  assertNotEquals(captureFingerprint, sealedCase.fingerprint);

  const action = prescribedKinematicsAction(
    captureFingerprint.digest,
    "case-capture",
  );
  const artifact = caseArtifact(captureFingerprint.digest, "case-capture");
  assertEquals(
    recrossResolvedPrescribedKinematicsCaseArtifact({
      action,
      caseArtifact: artifact,
      sealedCase,
    }),
    sealedCase,
  );
});

Deno.test("the Chrono executor refuses a ROP case identity that does not bind its exact Thread artifact", () => {
  const action = prescribedKinematicsAction("a", "case-capture");

  for (
    const artifact of [
      caseArtifact("c", "case-capture"),
      caseArtifact("a", "different-case-capture"),
    ]
  ) {
    assertThrows(
      () =>
        recrossResolvedPrescribedKinematicsCaseArtifact({
          action,
          caseArtifact: artifact,
          sealedCase: {} as PrescribedKinematicsCase,
        }),
      Error,
      "does not bind the exact Thread case artifact",
    );
  }
});

Deno.test("the Chrono executor stamps the exact sealed native or emulated runtime mode", () => {
  assertEquals(
    exactPrescribedKinematicsRuntimeMode(
      [runtimeMode(CHRONO_MATERIAL, "emulated")],
      CHRONO_MATERIAL,
    ),
    "emulated",
  );
  assertEquals(
    exactPrescribedKinematicsRuntimeMode(
      [runtimeMode(CHRONO_MATERIAL, "native")],
      CHRONO_MATERIAL,
    ),
    "native",
  );
});

Deno.test("the Chrono executor refuses missing, duplicate, or mismatched sealed runtime modes", () => {
  const cases: readonly (readonly CapabilityRuntimeMaterialRuntimeMode[])[] = [
    [],
    [
      runtimeMode(CHRONO_MATERIAL, "emulated"),
      runtimeMode(CHRONO_MATERIAL, "native"),
    ],
    [runtimeMode({ ...CHRONO_MATERIAL, materialId: "other-material" }, "emulated")],
  ];

  for (const runtimeModes of cases) {
    assertThrows(
      () => exactPrescribedKinematicsRuntimeMode(runtimeModes, CHRONO_MATERIAL),
      Error,
      "one exact qualified runtime mode",
    );
  }
});

const command = {
  commandId: "execute",
  projectId: "project",
  expectedRevision: 1,
  issuedAt: "2026-08-29T00:00:00.000Z",
  runId: "run",
} as const;

const CHRONO_MATERIAL: CapabilityRuntimeMaterialIdentity = {
  unitId: "casys.mcp-chrono",
  materialId: "mcp-chrono-image",
  imageDigest: "a".repeat(64),
};

function prescribedKinematicsAction(
  digest: string,
  id: string,
): ResolvedPrescribedKinematicsObservationAction {
  return {
    kind: "prescribed-kinematics-observation",
    lowering: { id: "prescribed-kinematics.case-json", version: "1.0" },
    requestId: "rop2-prescribed-kinematics-0123456789abcdef0123456789abcdef",
    input: {
      prescribedKinematicsCase: {
        id,
        fingerprint: { algorithm: "sha256", digest: digest64(digest) },
        sourceBinding: "case",
      },
    },
  };
}

function caseArtifact(digest: string, id: string): ThreadArtifact {
  return {
    id,
    name: "Prescribed kinematics case",
    kind: "document",
    version: "1",
    fingerprint: { algorithm: "sha256", digest: digest64(digest) },
    producer: {
      serverId: "digital-thread",
      tool:
        `${VERIFY_SEAL_PRESCRIBED_KINEMATICS_CASE_OPERATION.id}@${VERIFY_SEAL_PRESCRIBED_KINEMATICS_CASE_OPERATION.version}`,
      runId: "run",
    },
    inputArtifactIds: [],
    freshness: {
      status: "fresh",
      changedAt: "2026-08-29T00:00:00.000Z",
      invalidatedByChangeIds: [],
    },
  };
}

function digest64(value: string): string {
  return value.length === 1 ? value.repeat(64) : value;
}

async function sealedCaseFixture(input: {
  readonly projectId?: string;
  readonly subjectId?: string;
  readonly threadSnapshotId?: string;
  readonly threadRevision?: number;
} = {}): Promise<PrescribedKinematicsCase> {
  const projectId = input.projectId ?? "project-kinematics";
  const subjectId = input.subjectId ?? "subject";
  const { source, text } = canonicalizePrescribedKinematicsCaseSource(
    caseSource(projectId, subjectId),
  );
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
      workspaceEventFingerprint: {
        algorithm: "sha256" as const,
        digest: "a".repeat(64),
      },
      declaredAgainst: {
        thread: {
          snapshotId: input.threadSnapshotId ?? "thread",
          revision: input.threadRevision ?? 1,
          subjectId,
        },
        architecture: {
          artifactId: `architecture-${"b".repeat(64)}`,
          fingerprint: { algorithm: "sha256" as const, digest: "b".repeat(64) },
          captureSchema: "architecture-capture/4.0" as const,
        },
      },
      attachments: ["usage-assembly", "usage-base", "usage-head"].map(
        (elementId, index) => ({
          attachmentId: `attachment-${index + 1}`,
          attachmentRevision: 1,
          fingerprint: { algorithm: "sha256" as const, digest: "c".repeat(64) },
          closureFingerprint: {
            algorithm: "sha256" as const,
            digest: "d".repeat(64),
          },
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
  return await sealPrescribedKinematicsCase(
    {
      ...sourceClosureBody,
      fingerprint: await sha256Fingerprint(sourceClosureBody),
    },
  );
}

function caseSource(
  projectId = "project-kinematics",
  subjectId = "subject",
) {
  const pose = {
    positionM: [0, 0, 0] as const,
    orientationWxyz: [1, 0, 0, 0] as const,
  };
  return {
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
  } as const;
}

function runtimeMode(
  material: CapabilityRuntimeMaterialIdentity,
  mode: CapabilityRuntimeExecutionMode,
): CapabilityRuntimeMaterialRuntimeMode {
  return {
    material,
    targetPlatform: "linux/amd64",
    mode,
    qualificationAttestationFingerprint: {
      algorithm: "sha256",
      digest: "b".repeat(64),
    },
  };
}

function fixture(
  operation: { readonly id: string; readonly version: string },
  overrides: {
    readonly commands?: object;
    readonly captures?: object;
  } = {},
) {
  return new PrescribedKinematicsRunExecutor({
    projects: {
      get: () =>
        Promise.resolve({
          project: { id: "project" },
          agentRuns: [{ id: "run", workItemId: "work", status: "queued" }],
          workItems: [{ id: "work", operation }],
        } as never),
      getRevision: () => Promise.resolve(undefined),
    },
    commands: (overrides.commands ?? {}) as never,
    snapshots: {} as never,
    lease: {} as never,
    caseReview: {} as never,
    captures: (overrides.captures ?? {}) as never,
    sealMethod: {} as never,
    evaluate: {} as never,
    decideCloseout: {} as never,
  });
}

const AGENT = { kind: "agent" as const, actorId: "agent:test" };
const HUMAN = { kind: "human" as const, actorId: "human:kinematics-review" };
const CLAIMED_BY = { id: "agent:test", origin: "agent" as const };
const L3_AT = "2026-08-29T00:00:00.000Z";
const L3_PROJECT_ID = "project-kinematics";
const L3_RUN_ID = "run:kinematics-l3";
const L3_WORK_ID = "work-kinematics";
const L3_DECISION_ID = "decision:kinematics";
const L3_THREAD_ID = "thread:project-kinematics:r1";
const L3_CASE_ARTIFACT_ID = "case-capture";
const L3_OBSERVATION_DIGEST = "e".repeat(64);
const L3_SUBJECT_ID = `project:${L3_PROJECT_ID}`;
const THREAD_BASIS = {
  kind: "thread-snapshot" as const,
  snapshotId: "thread:r4",
  revision: 4,
  subjectId: "subject-1",
};

function writerHarness(input: {
  readonly operation: { readonly id: string; readonly version: string };
  readonly status: "queued" | "running";
  readonly siblingCompleted?: { readonly id: string; readonly version: string };
  readonly siblingFailed?: {
    readonly operation: { readonly id: string; readonly version: string };
    readonly failure: { readonly code: string; readonly message: string };
  };
  readonly uncertainWriterLifecycle?: UncertainWriterLifecycleQualifier;
  readonly l3?: {
    planReads: number;
    sessionBegins: number;
    secretSnapshots: number;
    claims: number;
    observes: number;
  };
}) {
  let snapshot = writerSnapshot(input);
  const harness: {
    project: EngineeringProjectSnapshot;
    claims: number;
    failed?: { readonly code: string; readonly message: string };
    executor: PrescribedKinematicsRunExecutor;
  } = {
    get project() {
      return snapshot;
    },
    claims: 0,
    executor: undefined as never,
  };
  const l3 = input.l3;
  harness.executor = new PrescribedKinematicsRunExecutor({
    projects: {
      get: () => Promise.resolve(snapshot),
      getRevision: () => Promise.resolve(undefined),
    },
    commands: {
      claimRun: () => {
        harness.claims++;
        if (l3) l3.claims++;
        snapshot = withRunStatus(snapshot, "running");
        return Promise.resolve(snapshot);
      },
      failRun: (_origin: unknown, command: FailRunCommand) => {
        harness.failed = { code: command.code, message: command.message };
        snapshot = {
          ...snapshot,
          revision: snapshot.revision + 1,
          agentRuns: snapshot.agentRuns.map((run) =>
            run.id === "run"
              ? {
                ...run,
                status: "failed",
                failure: { code: command.code, message: command.message },
              }
              : run
          ),
        };
        return Promise.resolve(snapshot);
      },
    } as never,
    snapshots: {
      getFresh: () => Promise.resolve(undefined),
    } as never,
    lease: { withLease: (_projectId, _scope, work) => work() },
    caseReview: {} as never,
    captures: {} as never,
    plans: l3
      ? {
        read: () => {
          l3.planReads++;
          return Promise.reject(new Error("plan store must not be read"));
        },
      }
      : undefined,
    capabilityRuntime: l3
      ? {
        requireExecution: () => {
          throw new Error("capability runtime must not be consulted");
        },
      }
      : undefined,
    capabilityRuntimeSession: l3
      ? {
        begin: () => {
          l3.sessionBegins++;
          return Promise.reject(new Error("JIT session must not start"));
        },
      }
      : undefined,
    chronoRuntime: l3
      ? {
        secrets: {
          beginSnapshot: () => {
            l3.secretSnapshots++;
            return Promise.reject(new Error("Chrono secrets must not be minted"));
          },
        },
        createObservation: () => ({
          execute: () => {
            l3.observes++;
            return Promise.reject(new Error("Chrono must not be dispatched"));
          },
        }),
      }
      : undefined,
    sealMethod: {} as never,
    evaluate: {} as never,
    decideCloseout: {} as never,
    uncertainWriterLifecycle: input.uncertainWriterLifecycle,
  });
  return harness;
}

function writerSnapshot(input: {
  readonly operation: { readonly id: string; readonly version: string };
  readonly status: "queued" | "running";
  readonly siblingCompleted?: { readonly id: string; readonly version: string };
  readonly siblingFailed?: {
    readonly operation: { readonly id: string; readonly version: string };
    readonly failure: { readonly code: string; readonly message: string };
  };
}): EngineeringProjectSnapshot {
  const current: EngineeringAgentRun = {
    id: "run",
    workItemId: "work",
    status: input.status,
    summary: "Prescribed-kinematics run",
    queuedAt: "2026-08-29T00:00:00.000Z",
    startedAt: input.status === "running" ? "2026-08-29T00:01:00.000Z" : undefined,
    claimedAt: input.status === "running" ? "2026-08-29T00:01:00.000Z" : undefined,
    claimedBy: input.status === "running" ? CLAIMED_BY : undefined,
    basis: THREAD_BASIS,
    evidenceRefs: [],
  };
  const sibling: EngineeringAgentRun | undefined = input.siblingCompleted
    ? {
      id: "run:sibling",
      workItemId: "work:sibling",
      status: "completed",
      summary: "Completed sibling writer",
      queuedAt: "2026-08-29T00:00:00.000Z",
      basis: THREAD_BASIS,
      evidenceRefs: [],
    }
    : input.siblingFailed
    ? {
      id: "run:sibling",
      workItemId: "work:sibling",
      status: "failed",
      summary: "Failed sibling writer",
      queuedAt: "2026-08-29T00:00:00.000Z",
      basis: THREAD_BASIS,
      evidenceRefs: [],
      failure: input.siblingFailed.failure,
    }
    : undefined;
  const runs = sibling ? [current, sibling] : [current];
  return {
    schemaVersion: "4.0",
    id: "project:r8",
    revision: 8,
    generatedAt: "2026-08-29T00:00:00.000Z",
    project: {
      id: "project",
      name: "Project",
      subjectId: THREAD_BASIS.subjectId,
      objective: { title: "Objective", statement: "Thread writer governance." },
    },
    threadSnapshots: [{
      snapshotId: THREAD_BASIS.snapshotId,
      revision: THREAD_BASIS.revision,
      subjectId: THREAD_BASIS.subjectId,
    }],
    phases: [{
      id: "phase",
      name: "Phase",
      order: 1,
      description: "Test phase.",
      workItemIds: runs.map((run) => run.workItemId),
      requiredDecisionIds: [],
      evidenceRefs: [],
    }],
    workItems: runs.map((run) => ({
      id: run.workItemId,
      activityId: `activity:${run.workItemId}`,
      phaseId: "phase",
      title: run.workItemId,
      description: `${run.workItemId} work`,
      kind: "verify" as const,
      operation: {
        ...(run.id === "run"
          ? input.operation
          : input.siblingCompleted ?? input.siblingFailed!.operation),
        bindings: [],
      },
      status: "ready" as const,
      owner: "agent" as const,
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [],
      blockerIds: [],
    })),
    agentRuns: runs,
    decisions: [],
    approvals: [],
    blockers: [],
  };
}

function withRunStatus(
  snapshot: EngineeringProjectSnapshot,
  status: "running",
): EngineeringProjectSnapshot {
  return {
    ...snapshot,
    revision: snapshot.revision + 1,
    agentRuns: snapshot.agentRuns.map((run) =>
      run.id === "run"
        ? {
          ...run,
          status,
          startedAt: "2026-08-29T00:01:00.000Z",
          claimedAt: "2026-08-29T00:01:00.000Z",
          claimedBy: CLAIMED_BY,
        }
        : run
    ),
  };
}

interface L3LifecycleHarness {
  executor: PrescribedKinematicsRunExecutor;
  readonly command: {
    readonly commandId: string;
    readonly projectId: string;
    readonly expectedRevision: number;
    readonly issuedAt: string;
    readonly runId: string;
  };
  readonly store: EngineeringProjectRevisionStore;
  readonly session: ReturnType<typeof recordingCapabilityRuntimeSession>;
  readonly requestId: string;
  claims: number;
  failed?: { readonly code: string; readonly message: string };
  observationSaves: number;
  threadSaves: number;
  publishes: number;
  completes: number;
  observes: number;
  secretSnapshots: number;
  observationRequestId?: string;
  savedSuccessor?: ThreadSnapshot;
}

function recordedKinematicsObservation(): RunPrescribedKinematicsObservationResult {
  const fingerprint = {
    algorithm: "sha256" as const,
    digest: L3_OBSERVATION_DIGEST,
  };
  const limits = {
    collision: "not_evaluated",
    contact: "not_evaluated",
    clearance: "not_evaluated",
    forces: "not_evaluated",
    strength: "not_evaluated",
    safety: "not_evaluated",
    manufacturability: "not_evaluated",
  } as const;
  return {
    status: "recorded",
    observation: {
      schemaVersion: "prescribed-kinematics-observation/1.0",
      operation: VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION,
      caseFingerprint: fingerprint,
      method: {
        schemaVersion: "prescribed-kinematics-observation-method/1.0",
        id: "prescribed-kinematics-observation",
        version: "1.0",
        samples: "case-derived-required-times",
        facts: [
          "poses",
          "joint-angles",
          "joint-translation-residuals",
          "joint-rotation-quaternion-imag-residuals",
          "convergence",
        ],
        limits,
        fingerprint,
      },
      samples: [],
      convergence: { status: "observed", value: "converged" },
      limits,
    },
    request: {
      requestId: "rop2-prescribed-kinematics-recorded",
      caseSha256: fingerprint.digest,
    },
    receipt: {
      receiptSha256: fingerprint.digest,
      caseSha256: fingerprint.digest,
      outcomeSha256: fingerprint.digest,
      requestId: "rop2-prescribed-kinematics-recorded",
      recordedAt: L3_AT,
      engine: { name: "chrono", version: "0.3.2" },
      runtime: {
        binding: "chrono-prescribed-kinematics",
        pythonVersion: "3.12",
        serverDenoVersion: "2",
      },
      workerSourceSha256: fingerprint.digest,
      executionState: "completed",
      kinematicsExit: { rawCode: 0, rawName: "ok" },
    },
    providerNotEvaluated: [
      "collision",
      "clearance",
      "contact",
      "forces",
      "torques",
      "dynamics",
      "strength",
      "safety",
      "product fitness",
    ],
    lowering: {
      sourceFingerprint: fingerprint,
      loweringFingerprint: fingerprint,
      requestFingerprint: fingerprint,
    },
  };
}

function assertNoObservationMaterialization(harness: L3LifecycleHarness): void {
  assertEquals(harness.observes, 1);
  assertEquals(harness.observationRequestId, harness.requestId);
  assertEquals(harness.secretSnapshots, 1);
  assertEquals(harness.session.events.includes("begin"), true);
  assertEquals(harness.observationSaves, 0);
  assertEquals(harness.threadSaves, 0);
  assertEquals(harness.publishes, 0);
  assertEquals(harness.completes, 0);
}

async function l3LifecycleHarness(input: {
  readonly status: "queued" | "running";
  readonly observation: RunPrescribedKinematicsObservationResult;
}): Promise<L3LifecycleHarness> {
  const sealedCase = await sealedCaseFixture({
    projectId: L3_PROJECT_ID,
    subjectId: L3_SUBJECT_ID,
    threadSnapshotId: L3_THREAD_ID,
    threadRevision: 1,
  });
  const caseBytes = new TextEncoder().encode(deterministicJson(sealedCase));
  const captureFingerprint = {
    algorithm: "sha256" as const,
    digest: await fingerprintResourceBytes(caseBytes),
  };
  const snapshot = kinematicsThreadSnapshot(captureFingerprint);
  const store = new MemoryProjectStore();
  const briefs = new ProjectBriefCommandService(store, () => L3_AT);
  let project = await approvedKinematicsProject(briefs);
  const basis = {
    kind: "thread-snapshot" as const,
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    subjectId: snapshot.subject.id,
  };
  const caseRef: EngineeringThreadEntityRef = {
    snapshotId: snapshot.id,
    snapshotRevision: snapshot.revision,
    kind: "artifact",
    id: L3_CASE_ARTIFACT_ID,
  };
  const operationalCapability = await chronoOperationalCapability(L3_PROJECT_ID);
  let sealed:
    | { plan: ResolvedOperationPlanV2; ref: ResolvedOperationPlanRef }
    | undefined;
  const resolver = new ResolvedOperationPlanResolver({
    snapshots: {
      get: (snapshotId) =>
        Promise.resolve(snapshotId === snapshot.id ? snapshot : undefined),
    },
    artifacts: {
      read: () => Promise.reject(new Error("unused recorded-plan artifact read")),
    },
    stepAssets: {
      read: () => Promise.reject(new Error("unused recorded-plan STEP read")),
    },
    prescribedKinematics: {
      captures: {
        readCase: (
          fingerprint: { readonly algorithm: "sha256"; readonly digest: string },
        ) =>
          Promise.resolve(
            fingerprintsEqual(fingerprint, captureFingerprint) ? sealedCase : undefined,
          ),
      },
    },
  });
  const planning: EngineeringProjectPlanningDependencies = {
    operations: kinematicsOperationRegistry(),
    queueEligibility: {
      validate: () => Promise.resolve(operationalCapability),
    },
    runPlanSealer: {
      seal: async (sealInput: RegisteredRunPlanSealInput) => {
        const plan = await resolver.resolve(sealInput);
        const ref = await kinematicsPlanReference(plan);
        sealed = { plan, ref };
        return ref;
      },
    },
  };
  const projectCommands = new EngineeringProjectCommandService(
    store,
    { validate: () => Promise.resolve() },
    () => L3_AT,
    planning,
  );
  project = await projectCommands.publishPlan(AGENT, {
    ...l3Context("publish-kinematics", project.revision),
    startingPoint: "idea-or-spec",
    phases: [{
      id: "phase-kinematics",
      name: "Prescribed kinematics",
      description: "Observe one reviewed sealed kinematics case.",
    }],
    workItems: [{
      id: L3_WORK_ID,
      phaseId: "phase-kinematics",
      owner: "agent",
      dependsOnWorkItemIds: [],
      decisionIds: [L3_DECISION_ID],
      operation: {
        ...VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION,
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
      },
    }],
    requiredDecisions: [{
      id: L3_DECISION_ID,
      phaseId: "phase-kinematics",
      title: "Human approval for prescribed kinematics",
      question: "Observe this exact sealed kinematics case?",
    }],
  });
  const caseBinding = {
    name: "case",
    source: { kind: "thread-entity" as const, reference: caseRef },
  };
  const prepared = {
    ...project,
    threadSnapshots: [{
      snapshotId: basis.snapshotId,
      revision: basis.revision,
      subjectId: basis.subjectId,
    }],
    workItems: project.workItems.map((item) =>
      item.id === L3_WORK_ID
        ? { ...item, operation: { ...item.operation!, bindings: [caseBinding] } }
        : item
    ),
    decisions: project.decisions.map((item) =>
      item.id === L3_DECISION_ID ? { ...item, inputEvidenceRefs: [caseRef] } : item
    ),
  };
  await store.commit(prepared, project.revision);
  project = (await store.get(L3_PROJECT_ID))!;
  project = await projectCommands.proposeDecision(AGENT, {
    ...l3Context("propose-kinematics", project.revision),
    decisionId: L3_DECISION_ID,
    baseSnapshot: {
      snapshotId: basis.snapshotId,
      revision: basis.revision,
      subjectId: basis.subjectId,
    },
    proposal: {
      summary: "Observe the exact sealed prescribed-kinematics case.",
      parameters: encodePrescribedKinematicsRunProposalParameters(
        sealedCase.fingerprint,
      ),
    },
  });
  const decision = project.decisions.find((candidate) =>
    candidate.id === L3_DECISION_ID
  )!;
  project = await projectCommands.approveDecision(HUMAN, {
    ...l3Context("approve-kinematics", project.revision),
    decisionId: decision.id,
    inputFingerprint: decision.inputFingerprint!,
    rationale: "The exact sealed kinematics case is approved.",
  });
  project = await projectCommands.queueRun(AGENT, {
    ...l3Context("queue-kinematics", project.revision),
    runId: L3_RUN_ID,
    workItemId: L3_WORK_ID,
    summary: "Queue the exact prescribed-kinematics observation.",
    basis,
  });
  if (!sealed) throw new Error("Prescribed-kinematics ROP was not sealed at queue.");
  const recorded = sealed;
  if (recorded.plan.action.kind !== "prescribed-kinematics-observation") {
    throw new Error("Sealed plan is not a prescribed-kinematics observation.");
  }
  const requestId = recorded.plan.action.requestId;
  if (input.status === "running") {
    project = await projectCommands.claimRun(AGENT, {
      ...l3Context("claim-kinematics-fixture", project.revision),
      runId: L3_RUN_ID,
      summary: "Started verify.run-prescribed-kinematics@1.",
    });
  }
  const harness: L3LifecycleHarness = {
    executor: undefined as never,
    command: {
      commandId: "execute",
      projectId: L3_PROJECT_ID,
      expectedRevision: project.revision,
      issuedAt: L3_AT,
      runId: L3_RUN_ID,
    },
    store,
    session: recordingCapabilityRuntimeSession(),
    requestId,
    claims: 0,
    observationSaves: 0,
    threadSaves: 0,
    publishes: 0,
    completes: 0,
    observes: 0,
    secretSnapshots: 0,
  };
  const recordedOutcome = input.observation.status === "recorded";
  const snapshotsById = new Map<string, ThreadSnapshot>([[snapshot.id, snapshot]]);
  const secretSnapshot = {} as CapabilityRuntimeSecretSnapshot;
  harness.executor = new PrescribedKinematicsRunExecutor({
    projects: store,
    commands: {
      claimRun: (origin, claimCommand) => {
        harness.claims++;
        return projectCommands.claimRun(origin, claimCommand);
      },
      failRun: (origin, failCommand) => {
        harness.failed = { code: failCommand.code, message: failCommand.message };
        return projectCommands.failRun(origin, failCommand);
      },
      publishRun: (origin, publishCommand) => {
        harness.publishes++;
        if (!recordedOutcome) {
          return Promise.reject(
            new Error("A non-recorded Chrono outcome must not publish."),
          );
        }
        return projectCommands.publishRun(origin, publishCommand);
      },
      completeRun: (origin, completeCommand) => {
        harness.completes++;
        if (!recordedOutcome) {
          return Promise.reject(
            new Error("A non-recorded Chrono outcome must not complete."),
          );
        }
        return projectCommands.completeRun(origin, completeCommand);
      },
    },
    snapshots: {
      get: (snapshotId) => Promise.resolve(snapshotsById.get(snapshotId)),
      getFresh: (snapshotId) => Promise.resolve(snapshotsById.get(snapshotId)),
      latest: () => Promise.resolve(snapshot),
      save: (successor) => {
        harness.threadSaves++;
        if (!recordedOutcome) {
          return Promise.reject(
            new Error(
              "A non-recorded Chrono outcome must not save a Thread successor.",
            ),
          );
        }
        snapshotsById.set(successor.id, successor);
        harness.savedSuccessor = successor;
        return Promise.resolve();
      },
    },
    lease: { withLease: (_projectId, _scope, work) => work() },
    caseReview: {} as never,
    captures: {
      readCase: (
        fingerprint: { readonly algorithm: "sha256"; readonly digest: string },
      ) =>
        Promise.resolve(
          fingerprintsEqual(fingerprint, captureFingerprint) ? sealedCase : undefined,
        ),
      saveObservation: () => {
        harness.observationSaves++;
        if (!recordedOutcome) {
          return Promise.reject(
            new Error("A non-recorded Chrono outcome must not capture an observation."),
          );
        }
        return Promise.resolve({
          fingerprint: {
            algorithm: "sha256" as const,
            digest: L3_OBSERVATION_DIGEST,
          },
          uri:
            `casys://prescribed-kinematics-observation/sha256/${L3_OBSERVATION_DIGEST}`,
        });
      },
    } as never,
    plans: {
      read: (ref) => {
        if (!sameResolvedOperationPlanRef(ref, recorded.ref)) {
          return Promise.reject(
            new Error("Plan reader refuses an arbitrary CAS reference."),
          );
        }
        return Promise.resolve(structuredClone(recorded.plan));
      },
    },
    capabilityRuntime: {
      requireExecution: () => Promise.resolve(recorded.plan.operationalCapability),
    },
    capabilityRuntimeSession: harness.session,
    chronoRuntime: {
      secrets: {
        beginSnapshot: () => {
          harness.secretSnapshots++;
          return Promise.resolve(secretSnapshot);
        },
      },
      createObservation: () => ({
        execute: (observationCommand) => {
          harness.observes++;
          harness.observationRequestId = observationCommand.requestId;
          return Promise.resolve(input.observation);
        },
      }),
    },
    sealMethod: {} as never,
    evaluate: {} as never,
    decideCloseout: {} as never,
  });
  return harness;
}

function kinematicsThreadSnapshot(
  captureFingerprint: { readonly algorithm: "sha256"; readonly digest: string },
): ThreadSnapshot {
  const modelDigest = "b".repeat(64);
  const artifacts: ThreadArtifact[] = [{
    id: "artifact.model",
    name: "Architecture",
    kind: "sysml-model",
    version: "1",
    fingerprint: { algorithm: "sha256", digest: modelDigest },
    uri: `casys://sysml/sha256/${modelDigest}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "model.write-architecture@1",
      runId: "run-architecture",
    },
    inputArtifactIds: [],
    freshness: {
      status: "fresh",
      changedAt: L3_AT,
      invalidatedByChangeIds: [],
    },
  }, {
    id: L3_CASE_ARTIFACT_ID,
    name: "Prescribed kinematics case",
    kind: "evidence",
    version: "1",
    fingerprint: captureFingerprint,
    uri: `casys://prescribed-kinematics-case/sha256/${captureFingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool:
        `${VERIFY_SEAL_PRESCRIBED_KINEMATICS_CASE_OPERATION.id}@${VERIFY_SEAL_PRESCRIBED_KINEMATICS_CASE_OPERATION.version}`,
      runId: "run-seal-case",
    },
    inputArtifactIds: [],
    freshness: {
      status: "fresh",
      changedAt: L3_AT,
      invalidatedByChangeIds: [],
    },
  }];
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id: L3_THREAD_ID,
    revision: 1,
    generatedAt: L3_AT,
    subject: {
      id: L3_SUBJECT_ID,
      name: "Prescribed kinematics subject",
      kind: "system",
      version: "1",
      modelArtifactId: artifacts[0]!.id,
    },
    freshness: { status: "fresh", changedAt: L3_AT, invalidatedByChangeIds: [] },
    changeSet: {
      id: "change:kinematics:baseline",
      name: "Capture the sealed prescribed-kinematics case",
      status: "applied",
      createdAt: L3_AT,
      appliedAt: L3_AT,
      changes: [],
    },
    artifacts,
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  });
}

async function chronoOperationalCapability(
  projectId: string,
): Promise<ResolvedCapabilityRuntimeOperation> {
  const launchGroup = await firstPartyChronoLaunchGroupReference();
  const imageDigest = MCP_CHRONO_032_IMAGE_REFERENCE.slice(
    MCP_CHRONO_032_IMAGE_REFERENCE.lastIndexOf("@sha256:") + "@sha256:".length,
  );
  const material = {
    unitId: "casys.mcp-chrono",
    materialId: "mcp-chrono-image",
    imageDigest,
  };
  const fingerprint = { algorithm: "sha256" as const, digest: "a".repeat(64) };
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
        version: "0.3.2",
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

function kinematicsOperationRegistry(): EngineeringProjectPlanOperationRegistry {
  return {
    validate(input) {
      if (
        input.operation.id !== VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION.id ||
        input.operation.version !== VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION.version
      ) {
        throw new TypeError(
          "Fixture registry accepts only verify.run-prescribed-kinematics@1.",
        );
      }
      return {
        operation: {
          ...VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION,
          startingPoint: "idea-or-spec",
          title: "Run prescribed kinematics",
          description: "Observe one exact sealed prescribed-kinematics case.",
          workItemKind: "verify",
          execution: "trusted",
          resolvedOperationPlan: "2.0",
          decisionEvidenceScope: "thread-entity-bindings",
        },
        bindings: input.operation.bindings,
      };
    },
  };
}

async function approvedKinematicsProject(
  service: ProjectBriefCommandService,
): Promise<EngineeringProjectSnapshot> {
  let project = await service.startProject(AGENT, {
    commandId: "start-kinematics-l3",
    projectId: L3_PROJECT_ID,
    projectName: "Prescribed kinematics L3",
    issuedAt: L3_AT,
    intent: "Observe one exact sealed prescribed-kinematics case after review.",
    intentSource: { kind: "human", reference: "conversation:kinematics-l3" },
  });
  project = await service.proposeBrief(AGENT, {
    ...l3Context("propose-kinematics-brief", project.revision),
    items: kinematicsBriefItems(),
  });
  const brief = project.framing!.proposedBrief!;
  const review = project.framing!.proposalReview!;
  return await service.approveBrief(HUMAN, {
    ...l3Context("approve-kinematics-brief", project.revision),
    briefSnapshotId: brief.id,
    briefRevision: brief.revision,
    rationale: "The bounded kinematics observation objective is approved.",
    inputFingerprint: review.inputFingerprint,
  });
}

function kinematicsBriefItems(): readonly ProjectBriefItem[] {
  return [{
    id: "objective",
    kind: "objective",
    statement: "Observe one sealed prescribed-kinematics case after human review.",
    sourceRefs: [{ kind: "intent", reference: "conversation:kinematics-l3" }],
  }, {
    id: "mission",
    kind: "mission-scenario",
    statement: "Run the exact reviewed kinematics observation once.",
    sourceRefs: [{ kind: "intent", reference: "conversation:kinematics-l3" }],
  }, {
    id: "success",
    kind: "success-criterion",
    statement: "The observation stays tied to its sealed case and Chrono runtime.",
    sourceRefs: [{ kind: "intent", reference: "conversation:kinematics-l3" }],
    dependsOnItemIds: [],
  }, {
    id: "verify",
    kind: "verification-activity",
    statement: "Verify the reviewed kinematics authority before Chrono dispatch.",
    sourceRefs: [{ kind: "intent", reference: "conversation:kinematics-l3" }],
    dependsOnItemIds: ["success"],
  }];
}

function l3Context(commandId: string, expectedRevision: number) {
  return {
    commandId,
    projectId: L3_PROJECT_ID,
    expectedRevision,
    issuedAt: L3_AT,
  };
}

async function kinematicsPlanReference(
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

class MemoryProjectStore implements EngineeringProjectRevisionStore {
  readonly #revisions = new Map<number, EngineeringProjectSnapshot>();

  get(projectId: string): Promise<EngineeringProjectSnapshot | undefined> {
    const current = [...this.#revisions.values()]
      .filter((snapshot) => snapshot.project.id === projectId)
      .sort((left, right) => right.revision - left.revision)[0];
    return Promise.resolve(current ? structuredClone(current) : undefined);
  }

  getRevision(
    projectId: string,
    revision: number,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const snapshot = this.#revisions.get(revision);
    return Promise.resolve(
      snapshot?.project.id === projectId ? structuredClone(snapshot) : undefined,
    );
  }

  createInitial(
    snapshot: EngineeringProjectSnapshot,
  ): Promise<EngineeringProjectSnapshot> {
    if (this.#revisions.size > 0) {
      throw new EngineeringProjectStoreConflictError("Project already exists.");
    }
    this.#revisions.set(snapshot.revision, structuredClone(snapshot));
    return Promise.resolve(structuredClone(snapshot));
  }

  async commit(
    snapshot: EngineeringProjectSnapshot,
    expectedRevision: number,
  ): Promise<EngineeringProjectSnapshot> {
    const current = await this.get(snapshot.project.id);
    if (!current || current.revision !== expectedRevision) {
      throw new EngineeringProjectStoreConflictError("Stale project revision.");
    }
    this.#revisions.set(snapshot.revision, structuredClone(snapshot));
    return structuredClone(snapshot);
  }
}
