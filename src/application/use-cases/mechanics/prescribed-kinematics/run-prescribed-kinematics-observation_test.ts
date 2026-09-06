import { assertEquals, assertRejects } from "@std/assert";
import { ChronoPrescribedKinematicsCaseLowerer } from "../../../../adapters/mechanics/chrono/chrono-prescribed-kinematics-case-lowerer.ts";
import { FilePrescribedKinematicsObservationAttemptStore } from "../../../../adapters/mechanics/chrono/file-prescribed-kinematics-observation-attempt-store.ts";
import { sampleAgentResourceReference } from "../../../../testing/agent-resource-test-support.ts";
import { sha256Hex } from "../../../../domain/kernel/deterministic-json.ts";
import {
  applyProjectSourceWorkspaceCommand,
  emptyProjectSourceWorkspace,
} from "../../../../domain/project-source-workspace/transitions.ts";
import { resolveProjectSourceClosure } from "../../../../domain/project-source-workspace/closure.ts";
import type { ProjectSourceWorkspaceState } from "../../../../domain/project-source-workspace/types.ts";
import {
  canonicalizePrescribedKinematicsCaseSource,
  canonicalPrescribedKinematicsCaseSourceText,
} from "../../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-case-source.ts";
import {
  PRESCRIBED_KINEMATICS_SOURCE_ATTACHMENT_ROLE,
  resolvePrescribedKinematicsSourceClosure,
  sealPrescribedKinematicsCase,
} from "../../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-source-closure.ts";
import type {
  PrescribedKinematicsObservationRecord,
  PrescribedKinematicsObserver,
} from "../../../ports/out/mechanics/prescribed-kinematics-observer.ts";
import type { PrescribedKinematicsCaseLowerer } from "../../../ports/out/mechanics/prescribed-kinematics-case-lowerer.ts";
import { RunPrescribedKinematicsObservation } from "./run-prescribed-kinematics-observation.ts";

const PROJECT = "project-kinematics";
const testLowerer: PrescribedKinematicsCaseLowerer = {
  async lower({ source, sourceFingerprint }) {
    const exactRequestText = canonicalPrescribedKinematicsCaseSourceText(source);
    return {
      sourceFingerprint,
      loweringFingerprint: { algorithm: "sha256" as const, digest: "b".repeat(64) },
      requestFingerprint: {
        algorithm: "sha256" as const,
        digest: await sha256Hex(new TextEncoder().encode(exactRequestText)),
      },
      exactRequestText,
    };
  },
};
Deno.test("prescribed-kinematics L3 restart reads an uncertain request and never redispatches", async () => {
  const { sealedCase, text } = await sealedFixture();
  const directory = await Deno.makeTempDir({ prefix: "prescribed-kinematics-run-" });
  let runs = 0;
  let reads = 0;
  const observer: PrescribedKinematicsObserver = {
    submitCase: (request) =>
      Promise.resolve({
        caseSha256: request.requestFingerprint.digest,
        caseUri: `chrono-case:sha256:${request.requestFingerprint.digest}`,
      }),
    run: () => {
      runs++;
      return Promise.reject(new Error("transport may have dispatched"));
    },
    readRun: () => {
      reads++;
      return Promise.resolve({ state: "absent" });
    },
    readReceipt: () => Promise.reject(new Error("no provider receipt exists")),
  };
  try {
    const first = new RunPrescribedKinematicsObservation({
      attempts: new FilePrescribedKinematicsObservationAttemptStore(directory),
      observer,
      lowerer: testLowerer,
    });
    assertEquals(
      (await first.execute(command(sealedCase, text))).status,
      "quarantined",
    );
    const restarted = new RunPrescribedKinematicsObservation({
      attempts: new FilePrescribedKinematicsObservationAttemptStore(directory),
      observer,
      lowerer: testLowerer,
    });
    const resumed = await restarted.execute(command(sealedCase, text));
    assertEquals(resumed, { status: "quarantined", reason: "uncertain" });
    assertEquals(runs, 1);
    assertEquals(reads, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("prescribed-kinematics L3 reopens the sealed source and submits only the server-owned lowered request", async () => {
  const { sealedCase, text } = await sealedFixture();
  const directory = await Deno.makeTempDir({ prefix: "prescribed-kinematics-run-" });
  let submittedText: string | undefined;
  try {
    const runner = new RunPrescribedKinematicsObservation({
      attempts: new FilePrescribedKinematicsObservationAttemptStore(directory),
      lowerer: new ChronoPrescribedKinematicsCaseLowerer(),
      observer: {
        submitCase: (submission) => {
          submittedText = submission.exactCaseText;
          return Promise.resolve({
            caseSha256: submission.requestFingerprint.digest,
            caseUri: `chrono-case:sha256:${submission.requestFingerprint.digest}`,
          });
        },
        run: () => Promise.resolve({ state: "rejected", code: "case_invalid" }),
        readRun: () =>
          Promise.reject(
            new Error("a definite pre-dispatch rejection must not read a run"),
          ),
        readReceipt: () =>
          Promise.reject(
            new Error("a definite pre-dispatch rejection has no receipt"),
          ),
      },
    });
    const internalCommand = command(sealedCase, text);
    assertEquals("loweredCaseJson" in internalCommand, false);
    assertEquals("exactCaseText" in internalCommand, false);
    assertEquals(await runner.execute(internalCommand), {
      status: "rejected",
      code: "case_invalid",
    });
    assertEquals(
      submittedText,
      '{"bodies":[{"absolute_com_pose":{"position_m":[0,0,0],"rotation_wxyz":[1,0,0,0]},"fixed":true,"id":"base"},{"absolute_com_pose":{"position_m":[0,0,0],"rotation_wxyz":[1,0,0,0]},"fixed":false,"id":"head"}],"duration_s":1,"frame":{"handedness":"right"},"joints":[{"absolute_joint_frame":{"position_m":[0,0,0],"rotation_wxyz":[1,0,0,0]},"angle_ramp":{"angular_speed_rad_s":0.5,"initial_angle_rad":0},"child_body":"head","id":"joint","limits_rad":[-1,1],"parent_body":"base"}],"sample_every_steps":1,"schema_id":"chrono-prescribed-kinematics-case/1.0","step_s":0.5,"units":{"angle":"rad","length":"m","time":"s"}}',
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("prescribed-kinematics L3 refuses a lowerer whose source fingerprint differs from the reopened seal", async () => {
  const { sealedCase, text } = await sealedFixture();
  const directory = await Deno.makeTempDir({ prefix: "prescribed-kinematics-run-" });
  let submitted = false;
  try {
    const runner = new RunPrescribedKinematicsObservation({
      attempts: new FilePrescribedKinematicsObservationAttemptStore(directory),
      lowerer: {
        async lower({ source }) {
          const exactRequestText = canonicalPrescribedKinematicsCaseSourceText(source);
          return {
            sourceFingerprint: { algorithm: "sha256" as const, digest: "f".repeat(64) },
            loweringFingerprint: {
              algorithm: "sha256" as const,
              digest: "b".repeat(64),
            },
            requestFingerprint: {
              algorithm: "sha256" as const,
              digest: await sha256Hex(new TextEncoder().encode(exactRequestText)),
            },
            exactRequestText,
          };
        },
      },
      observer: {
        submitCase: () => {
          submitted = true;
          return Promise.reject(
            new Error("mismatched lowering must fail before provider submission"),
          );
        },
        run: () => Promise.resolve({ state: "absent" }),
        readRun: () => Promise.resolve({ state: "absent" }),
        readReceipt: () => Promise.reject(new Error("unreachable")),
      },
    });
    await assertRejects(
      () => runner.execute(command(sealedCase, text)),
      TypeError,
      "server-owned prescribed-kinematics lowering is absent, unbound",
    );
    assertEquals(submitted, false);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("prescribed-kinematics L3 quarantines a receipt whose bounded fact page is incomplete", async () => {
  const { sealedCase, text } = await sealedFixture();
  const directory = await Deno.makeTempDir({ prefix: "prescribed-kinematics-run-" });
  const caseSha = await sha256Hex(new TextEncoder().encode(text));
  const request = {
    requestId: "run-1",
    caseSha256: caseSha,
    caseUri: `chrono-case:sha256:${caseSha}`,
  } as const;
  const malformed = {
    request,
    recordedAt: "2026-08-29T00:00:00.000Z",
    receipt: {
      receiptSha256: "c".repeat(64),
      caseSha256: caseSha,
      requestId: "request-1",
    },
    notEvaluated: [
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
    sampleCount: 1,
    sampleTimeRangeSeconds: { first: 0, last: 0 },
    samplePage: {
      sampleOffset: 0,
      sampleLimit: 512,
      total: 1,
      returned: 0,
      hasMore: true,
      samples: [],
    },
  } as unknown as PrescribedKinematicsObservationRecord;
  try {
    const runner = new RunPrescribedKinematicsObservation({
      attempts: new FilePrescribedKinematicsObservationAttemptStore(directory),
      observer: {
        submitCase: (submission) =>
          Promise.resolve({
            caseSha256: submission.requestFingerprint.digest,
            caseUri: `chrono-case:sha256:${submission.requestFingerprint.digest}`,
          }),
        run: () => Promise.resolve({ state: "recorded", record: malformed }),
        readRun: () => Promise.resolve({ state: "recorded", record: malformed }),
        readReceipt: () => Promise.resolve(malformed),
      },
      lowerer: testLowerer,
    });
    assertEquals(await runner.execute(command(sealedCase, text)), {
      status: "quarantined",
      reason: "malformed",
    });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("prescribed-kinematics L3 reads the same request after a post-intent outcome without redispatch", async () => {
  const { sealedCase, text } = await sealedFixture();
  const directory = await Deno.makeTempDir({ prefix: "prescribed-kinematics-run-" });
  let runs = 0;
  let reads = 0;
  try {
    const runner = new RunPrescribedKinematicsObservation({
      attempts: new FilePrescribedKinematicsObservationAttemptStore(directory),
      observer: {
        submitCase: (submission) =>
          Promise.resolve({
            caseSha256: submission.requestFingerprint.digest,
            caseUri: `chrono-case:sha256:${submission.requestFingerprint.digest}`,
          }),
        run: (request) => {
          runs++;
          return Promise.resolve({ state: "uncertain", ...request });
        },
        readRun: async (request) => {
          reads++;
          return {
            state: "uncertain",
            requestId: request.requestId,
            caseSha256: await sha256Hex(new TextEncoder().encode(text)),
            caseUri: `chrono-case:sha256:${await sha256Hex(
              new TextEncoder().encode(text),
            )}`,
          };
        },
        readReceipt: () => Promise.reject(new Error("not recorded")),
      },
      lowerer: testLowerer,
    });
    assertEquals(await runner.execute(command(sealedCase, text)), {
      status: "quarantined",
      reason: "uncertain",
    });
    assertEquals(runs, 1);
    assertEquals(reads, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("prescribed-kinematics L3 records a definite pre-dispatch rejection without quarantining it", async () => {
  const { sealedCase, text } = await sealedFixture();
  const directory = await Deno.makeTempDir({ prefix: "prescribed-kinematics-run-" });
  try {
    const runner = new RunPrescribedKinematicsObservation({
      attempts: new FilePrescribedKinematicsObservationAttemptStore(directory),
      observer: {
        submitCase: (submission) =>
          Promise.resolve({
            caseSha256: submission.requestFingerprint.digest,
            caseUri: `chrono-case:sha256:${submission.requestFingerprint.digest}`,
          }),
        run: () => Promise.resolve({ state: "rejected", code: "case_not_found" }),
        readRun: () =>
          Promise.reject(new Error("definite rejection must not read a new run")),
        readReceipt: () =>
          Promise.reject(new Error("definite rejection has no receipt")),
      },
      lowerer: testLowerer,
    });
    assertEquals(await runner.execute(command(sealedCase, text)), {
      status: "rejected",
      code: "case_not_found",
    });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("prescribed-kinematics L3 reads every 64-sample receipt page before sealing observation facts", async () => {
  const { sealedCase, text } = await sealedFixture(65);
  const caseSha = await sha256Hex(new TextEncoder().encode(text));
  const offsets: number[] = [];
  const page = (offset: number) => completeRecord(caseSha, offset, 65);
  const directory = await Deno.makeTempDir({ prefix: "prescribed-kinematics-run-" });
  try {
    const runner = new RunPrescribedKinematicsObservation({
      attempts: new FilePrescribedKinematicsObservationAttemptStore(directory),
      observer: {
        submitCase: (submission) =>
          Promise.resolve({
            caseSha256: submission.requestFingerprint.digest,
            caseUri: `chrono-case:sha256:${submission.requestFingerprint.digest}`,
          }),
        run: () => Promise.resolve({ state: "recorded", record: page(0) }),
        readRun: () => Promise.resolve({ state: "recorded", record: page(0) }),
        readReceipt: (_receiptSha256, request) => {
          offsets.push(request?.sampleOffset ?? -1);
          return Promise.resolve(page(request?.sampleOffset ?? 0));
        },
      },
      lowerer: testLowerer,
    });
    const result = await runner.execute(command(sealedCase, text));
    assertEquals(result.status, "recorded");
    if (result.status !== "recorded") throw new Error("The fixture must record L3.");
    assertEquals(
      result.lowering.sourceFingerprint,
      sealedCase.sourceClosure.workspace.root.resourceFingerprint,
    );
    assertEquals(result.lowering.requestFingerprint.digest, caseSha);
    assertEquals(result.request, {
      requestId: "request-1",
      caseSha256: caseSha,
    });
    // The provider wire preserves its published nine-item boundary, while
    // the code-owned L3 observation independently records the broader DT
    // coverage limit (including manufacturability).
    assertEquals(result.providerNotEvaluated, [
      "collision",
      "clearance",
      "contact",
      "forces",
      "torques",
      "dynamics",
      "strength",
      "safety",
      "product fitness",
    ]);
    assertEquals(result.observation.limits.manufacturability, "not_evaluated");
    assertEquals(offsets, [0, 64]);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("prescribed-kinematics L3 recovery reads every receipt page without another run dispatch", async () => {
  const { sealedCase, text } = await sealedFixture(65);
  const caseSha = await sha256Hex(new TextEncoder().encode(text));
  const directory = await Deno.makeTempDir({ prefix: "prescribed-kinematics-run-" });
  const offsets: number[] = [];
  let runs = 0;
  try {
    const attempts = new FilePrescribedKinematicsObservationAttemptStore(directory);
    const runCommand = command(sealedCase, text);
    const identity = {
      projectId: runCommand.projectId,
      agentRunId: runCommand.agentRunId,
      requestId: runCommand.requestId,
      runtime: runCommand.runtime,
      startedAt: runCommand.startedAt,
      caseFingerprint: sealedCase.fingerprint,
      sourceFingerprint: sealedCase.sourceClosure.workspace.root.resourceFingerprint,
      loweringFingerprint: { algorithm: "sha256" as const, digest: "b".repeat(64) },
      requestFingerprint: { algorithm: "sha256" as const, digest: caseSha },
    };
    await attempts.prepare(identity);
    await attempts.markCaseSubmitted(identity, {
      caseSha256: caseSha,
      caseUri: `chrono-case:sha256:${caseSha}`,
    });
    await attempts.markDispatching(identity);
    const runner = new RunPrescribedKinematicsObservation({
      attempts,
      observer: {
        submitCase: () =>
          Promise.reject(
            new Error("a dispatching request must not submit a case again"),
          ),
        run: () => {
          runs++;
          return Promise.reject(
            new Error("a dispatching request must never call run again"),
          );
        },
        readRun: () =>
          Promise.resolve({
            state: "recorded",
            record: completeRecord(caseSha, 0, 65),
          }),
        readReceipt: (_receiptSha256, request) => {
          offsets.push(request?.sampleOffset ?? -1);
          return Promise.resolve(
            completeRecord(caseSha, request?.sampleOffset ?? 0, 65),
          );
        },
      },
      lowerer: testLowerer,
    });
    assertEquals((await runner.execute(command(sealedCase, text))).status, "recorded");
    assertEquals(runs, 0);
    assertEquals(offsets, [0, 64]);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("prescribed-kinematics L3 quarantines missing, overlapping, duplicate, or incomplete receipt pages", async () => {
  const { sealedCase, text } = await sealedFixture(65);
  const caseSha = await sha256Hex(new TextEncoder().encode(text));
  for (const fault of ["missing", "overlap", "duplicate", "incomplete"] as const) {
    const directory = await Deno.makeTempDir({ prefix: "prescribed-kinematics-run-" });
    try {
      const runner = new RunPrescribedKinematicsObservation({
        attempts: new FilePrescribedKinematicsObservationAttemptStore(directory),
        observer: {
          submitCase: (submission) =>
            Promise.resolve({
              caseSha256: submission.requestFingerprint.digest,
              caseUri: `chrono-case:sha256:${submission.requestFingerprint.digest}`,
            }),
          run: () =>
            Promise.resolve({
              state: "recorded",
              record: completeRecord(caseSha, 0, 65),
            }),
          readRun: () =>
            Promise.resolve({
              state: "recorded",
              record: completeRecord(caseSha, 0, 65),
            }),
          readReceipt: (_receiptSha256, request) =>
            Promise.resolve(
              faultyRecord(
                completeRecord(caseSha, request?.sampleOffset ?? 0, 65),
                fault,
              ),
            ),
        },
        lowerer: testLowerer,
      });
      assertEquals(await runner.execute(command(sealedCase, text)), {
        status: "quarantined",
        reason: "malformed",
      });
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  }
});

function command(
  sealedCase: Awaited<ReturnType<typeof sealedFixture>>["sealedCase"],
  _text: string,
) {
  return {
    projectId: PROJECT,
    agentRunId: "run-1",
    requestId: "request-1",
    startedAt: "2026-08-29T00:00:00.000Z",
    runtime: {
      resolvedOperationPlanFingerprint: {
        algorithm: "sha256" as const,
        digest: "d".repeat(64),
      },
      operationalCapabilityFingerprint: {
        algorithm: "sha256" as const,
        digest: "e".repeat(64),
      },
      binding: { id: "chrono-prescribed-kinematics", version: "1" },
      adapter: {
        id: "chrono-prescribed-kinematics-adapter",
        version: "0.3.2",
        source: "src/adapters/mechanics/chrono/chrono-prescribed-kinematics-client.ts",
      },
      profile: null,
      material: {
        unitId: "casys.mcp-chrono",
        materialId: "mcp-chrono-image",
        imageDigest: "f".repeat(64),
      },
      launchGroup: {
        id: "casys-chrono",
        version: "1.0.0",
        fingerprint: { algorithm: "sha256" as const, digest: "a".repeat(64) },
      },
      platformMode: "emulated" as const,
    },
    sealedCase,
  };
}

async function sealedFixture(sampleCount = 3) {
  const { text } = canonicalizePrescribedKinematicsCaseSource(source(sampleCount));
  const digest = await sha256Hex(new TextEncoder().encode(text));
  let state = emptyProjectSourceWorkspace(PROJECT);
  state = await apply(state, {
    projectId: PROJECT,
    mutationId: "module",
    expectedWorkspaceRevision: state.workspaceRevision,
    mutation: {
      kind: "module_put",
      moduleId: "module",
      slug: "mechanism",
      displayName: "Mechanism",
    },
  });
  state = await apply(state, {
    projectId: PROJECT,
    mutationId: "file",
    expectedWorkspaceRevision: state.workspaceRevision,
    mutation: {
      kind: "file_put",
      fileId: "file",
      moduleId: "module",
      logicalName: "mechanism.json",
      role: "mechanism-source",
      dependencies: [],
      resourceRef: sampleAgentResourceReference({
        name: "mechanism.json",
        mimeType: "application/json",
        byteCount: new TextEncoder().encode(text).byteLength,
        fingerprint: { algorithm: "sha256", digest },
        uri: `casys://agent-resource-capture/sha256/${digest}`,
      }),
    },
  });
  for (const target of ["usage-assembly", "usage-base", "usage-head"]) {
    state = await apply(state, {
      projectId: PROJECT,
      mutationId: `attachment-${target}`,
      expectedWorkspaceRevision: state.workspaceRevision,
      mutation: {
        kind: "attachment_put",
        attachmentId: `attachment-${target.slice(6)}`,
        fileId: "file",
        role: PRESCRIBED_KINEMATICS_SOURCE_ATTACHMENT_ROLE,
        target: { elementId: target, elementKind: "PartUsage" },
        declaredAgainst: {
          thread: { snapshotId: "thread", revision: 1, subjectId: "subject" },
          architecture: {
            artifactId: `architecture-${"a".repeat(64)}`,
            fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
            captureSchema: "architecture-capture/4.0",
          },
        },
      },
    });
  }
  const closures = await Promise.all(
    ["attachment-assembly", "attachment-base", "attachment-head"].map((attachmentId) =>
      resolveProjectSourceClosure(state, { attachmentId, attachmentRevision: 1 })
    ),
  );
  return {
    text,
    sealedCase: await sealPrescribedKinematicsCase(
      await resolvePrescribedKinematicsSourceClosure({ closures, sourceText: text }),
    ),
  };
}

async function apply(
  state: ProjectSourceWorkspaceState,
  command: unknown,
): Promise<ProjectSourceWorkspaceState> {
  return (await applyProjectSourceWorkspaceCommand(state, command)).state;
}

function source(sampleCount = 3) {
  const pose = {
    positionM: [0, 0, 0] as const,
    orientationWxyz: [1, 0, 0, 0] as const,
  };
  const durationS = sampleCount === 3 ? 1 : 10;
  const stepS = sampleCount === 3 ? 0.5 : durationS / (sampleCount - 1);
  return {
    schemaVersion: "prescribed-kinematics-case-source/1.0",
    id: "case",
    revision: 1,
    scope: "Two-body prescribed mechanism.",
    evidenceBoundary:
      "Only kinematic poses, angles, residuals, and convergence are observable.",
    project: { id: PROJECT, subjectId: "subject" },
    assembly: { elementId: "usage-assembly", elementKind: "PartUsage" },
    units: { length: "m", angle: "rad", time: "s" },
    durationS,
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
        endTimeS: durationS,
        initialAngleRad: 0,
        finalAngleRad: 0.5,
      },
    }],
    sampling: { timeStepS: stepS },
  } as const;
}

function completeRecord(
  caseSha256: string,
  offset: number,
  total: number,
): PrescribedKinematicsObservationRecord {
  const samples = Array.from({ length: Math.min(64, total - offset) }, (_, index) => {
    const timeSeconds = 10 * (offset + index) / (total - 1);
    return {
      timeSeconds,
      bodies: ["base", "head"].map((bodyId) => ({
        bodyId,
        positionMetres: [0, 0, 0] as const,
        rotationWxyz: [1, 0, 0, 0] as const,
      })),
      joints: [{
        jointId: "joint",
        motorAngleRadians: 0.5 * timeSeconds / 10,
        declaredLimitObservation: "within" as const,
        translationResidualMetres: [0, 0, 0] as const,
        rotationQuaternionImagResidual: [0, 0, 0] as const,
      }],
    };
  });
  return {
    request: {
      requestId: "request-1",
      caseSha256,
      caseUri: `chrono-case:sha256:${caseSha256}`,
    },
    recordedAt: "2026-08-29T00:00:00.000Z",
    receipt: {
      receiptSha256: "c".repeat(64),
      caseSha256,
      outcomeSha256: "d".repeat(64),
      requestId: "request-1",
      recordedAt: "2026-08-29T00:00:00.000Z",
      engine: { name: "Project Chrono", version: "10.0.0" },
      runtime: {
        binding: "pychrono",
        pythonVersion: "3.12.0",
        serverDenoVersion: "2.0.0",
      },
      workerSourceSha256: "e".repeat(64),
      executionState: "completed",
      kinematicsExit: { rawCode: 1, rawName: "SUCCESS" },
    },
    notEvaluated: [
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
    sampleCount: total,
    sampleTimeRangeSeconds: { first: 0, last: 10 },
    samplePage: {
      sampleOffset: offset,
      sampleLimit: 64,
      total,
      returned: samples.length,
      hasMore: offset + samples.length < total,
      samples,
    },
  };
}

function faultyRecord(
  record: PrescribedKinematicsObservationRecord,
  fault: "missing" | "overlap" | "duplicate" | "incomplete",
): PrescribedKinematicsObservationRecord {
  if (fault === "missing") {
    return {
      ...record,
      samplePage: { ...record.samplePage, returned: 0, samples: [], hasMore: false },
    };
  }
  if (fault === "overlap") {
    return { ...record, samplePage: { ...record.samplePage, sampleOffset: 0 } };
  }
  if (fault === "duplicate") {
    if (record.samplePage.sampleOffset === 0) return record;
    return {
      ...record,
      samplePage: {
        ...record.samplePage,
        samples: [{ ...record.samplePage.samples[0]!, timeSeconds: 0 }],
      },
    };
  }
  return {
    ...record,
    samplePage: {
      ...record.samplePage,
      returned: 63,
      samples: record.samplePage.samples.slice(0, 63),
      hasMore: true,
    },
  };
}
