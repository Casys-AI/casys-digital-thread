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
  CapabilityRuntimeMaterialIdentity,
} from "../../../domain/capability/runtime/capability-runtime-supervision.ts";
import type {
  CapabilityRuntimeExecutionMode,
  CapabilityRuntimeMaterialRuntimeMode,
} from "../../../domain/capability/runtime/capability-runtime-binding-qualification-attestation.ts";
import {
  resolvedOperationPlanRequestIdFor,
} from "../../compile/plans/resolved-operation-plan-resolver.ts";
import {
  fingerprintResourceBytes,
} from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type {
  ResolvedPrescribedKinematicsObservationAction,
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
  VERIFY_SEAL_PRESCRIBED_KINEMATICS_CASE_OPERATION,
} from "../../../domain/mechanism/prescribed-kinematics/operations.ts";
import type { ThreadArtifact } from "../../../domain/thread/thread-snapshot.ts";

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

async function sealedCaseFixture(): Promise<PrescribedKinematicsCase> {
  const { source, text } = canonicalizePrescribedKinematicsCaseSource(caseSource());
  const sourceFingerprint = {
    algorithm: "sha256" as const,
    digest: await fingerprintResourceBytes(new TextEncoder().encode(text)),
  };
  const sourceClosureBody = {
    schemaVersion: "prescribed-kinematics-source-closure/1.0" as const,
    source,
    workspace: {
      projectId: "project-kinematics",
      workspaceRevision: 1,
      workspaceEventFingerprint: {
        algorithm: "sha256" as const,
        digest: "a".repeat(64),
      },
      declaredAgainst: {
        thread: { snapshotId: "thread", revision: 1, subjectId: "subject" },
        architecture: {
          artifactId: `architecture-${"b".repeat(64)}`,
          fingerprint: { algorithm: "sha256" as const, digest: "b".repeat(64) },
          captureSchema: "architecture-capture/4.0" as const,
        },
      },
      attachments: ["usage-assembly", "usage-base", "usage-head"].map(
        (partUsageElementId, index) => ({
          attachmentId: `attachment-${index + 1}`,
          attachmentRevision: 1,
          fingerprint: { algorithm: "sha256" as const, digest: "c".repeat(64) },
          closureFingerprint: {
            algorithm: "sha256" as const,
            digest: "d".repeat(64),
          },
          partUsageElementId,
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

function caseSource() {
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
    project: { id: "project-kinematics", subjectId: "subject" },
    assembly: { partUsageElementId: "usage-assembly" },
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
