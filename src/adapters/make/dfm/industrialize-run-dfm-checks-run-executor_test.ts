import { assertEquals, assertRejects } from "@std/assert";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type { McpToolCall } from "../../../application/ports/out/mcp-tool-client.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type FailRunCommand,
  type RunCommand,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  DFM_CHECK_CASE_SCHEMA,
  validateDfmCheckCase,
} from "../../../domain/make/dfm/dfm-case.ts";
import { encodeDfmRunDecisionParameters } from "../../../domain/make/dfm/dfm-proposal.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import { stubCallToolTextResult } from "../../../testing/stub-mcp-tool-client.ts";
import { FileCanonicalAssetReader } from "../../assets/canonical-asset-reader.ts";
import {
  DFM_CASE_CAPTURE_SCHEMA,
  DFM_CASE_CAPTURE_URI_PREFIX,
  validateDfmCaseCapture,
} from "./dfm-case-capture.ts";
import { FileDfmCheckAttemptStore } from "./file-dfm-check-attempt-store.ts";
import qualification from "./dfm-mcp-qualification.json" with {
  type: "json",
};
import {
  DFM_RUN_AUTHORITY_DIVERGENT_REASON,
  DFM_RUN_AUTHORITY_MISSING_REASON,
} from "../../../domain/make/dfm/dfm-run-authority.ts";
import { IndustrializeRunDfmChecksRunExecutor } from "./industrialize-run-dfm-checks-run-executor.ts";
import { McpToolCallError } from "../../shared/mcp/http-mcp-tool-client.ts";
import { CapabilityRuntimeConnectionError } from "../../../application/ports/out/capability/capability-runtime-connection.ts";
import type { CapabilityRuntimeExecutionSession } from "../../../application/control-plane/capability-runtime-execution-session.ts";
import {
  passthroughCapabilityRuntimeConnection,
  recordingCapabilityRuntimeSession,
  testResolvedCapabilityRuntimeOperation,
} from "../../../testing/capability-runtime-execution-session-test-support.ts";
import { firstPartyDfmLaunchGroupReference } from "../../control-plane/first-party-capability-runtime-launch-groups.ts";
import { MCP_DFM_010_IMAGE_REFERENCE } from "../../control-plane/first-party-capability-runtime-identities.ts";
import type { CapabilitySessionGeometryExportStagerFactory } from "../../../application/ports/out/make/geometry-export-stager.ts";

const AT = "2026-08-15T00:00:00.000Z";
const PROJECT_ID = "reviewed-project-v1";
const SUBJECT_ID = "project:reviewed-project-v1";
const RUN_ID = "run.dfm-checks";
const WORK_ID = "work.dfm-checks";
const DECISION_ID = "decision.dfm-checks";
const APPROVAL_ID = "approval.dfm-checks";
const COMMAND_ID = "command.dfm-checks";
const CASE_ARTIFACT_ID = "dfm-case-sealed";
const GEOMETRY_ID = "geometry-step-support-bracket";
const CANONICAL_CAPTURE =
  "b59023102670e06b4e33e534d05008c0fe2440ae91dafbaa9c256c92a4ebe3e8";
const AGENT = { kind: "agent" as const, actorId: "agent:test" };

function caseJson(sha256: string, artifactId = GEOMETRY_ID) {
  return {
    schemaVersion: DFM_CHECK_CASE_SCHEMA,
    id: "reviewed-dfm-v1",
    revision: 1,
    scope: "Measured DFM checks for the isolated component.",
    evidenceBoundary: "Measured verdicts against the sealed case.",
    project: { id: PROJECT_ID, subjectId: SUBJECT_ID },
    target: {
      componentKey: "support-bracket",
      artifactUri: `thread-artifact://${PROJECT_ID}/${artifactId}`,
      sha256,
      mediaType: "model/step",
    },
    buildVolumeMm: {
      x: { value: 250, unit: "mm" },
      y: { value: 210, unit: "mm" },
      z: { value: 200, unit: "mm" },
    },
    minThicknessMm: { value: 2, unit: "mm" },
    maxOverhangAngleDeg: { value: 45, unit: "deg" },
    meshSizeMm: { value: 2, unit: "mm" },
    buildDirection: [0, 0, 1],
    zMinFilter: {
      enabled: true,
      planeZMm: { value: -3, unit: "mm" },
      toleranceMm: { value: 0.1, unit: "mm" },
    },
    provider: {
      envelopeTool: "dfm_check_envelope",
      thicknessTool: "dfm_check_min_thickness",
      overhangTool: "dfm_check_overhangs",
    },
    limitations: ["The live mcp-dfm tools analyse STEP, not STL."],
    provenance: {
      status: "provisional",
      note: "Limits copied from the archived mcp-dfm qualification call.",
    },
  };
}

Deno.test(
  "run DFM checks calls the three tools with an object build volume and publishes named violations",
  async () => {
    const fixture = await createFixture();
    try {
      const project = await fixture.executor.execute(AGENT, fixture.command);
      assertEquals(project.agentRuns[0]?.status, "completed");
      assertEquals(fixture.dfm.names, [
        "dfm_check_envelope",
        "dfm_check_min_thickness",
        "dfm_check_overhangs",
      ]);
      const envelopeArgs = fixture.dfm.arguments[0] as Record<string, unknown>;
      assertEquals(Array.isArray(envelopeArgs.build_volume_mm), false);
      assertEquals(envelopeArgs.build_volume_mm, { x: 250, y: 210, z: 200 });
      assertEquals(typeof envelopeArgs.expected_step_sha256, "string");
      const snapshot = await fixture.snapshots.getFresh(
        project.agentRuns[0]!.resultSnapshot!.snapshotId,
      );
      assertEquals(snapshot?.evaluations.some((item) => item.status === "fail"), true);
      assertEquals(
        snapshot?.violations.some((item) =>
          item.name === "overhang-zone-0-requires-support"
        ),
        true,
      );
      assertEquals(
        snapshot?.observations.some((item) =>
          item.metric === "dfm_zmin_filtered_zone_count" && item.quantity.value === 1
        ),
        true,
      );
      assertEquals(fixture.stager.calls, 1);
      assertEquals(fixture.stager.paths[0]?.startsWith("/tmp/dfm-"), true);
      assertEquals(fixture.session.releases, 1);
      assertEquals(fixture.session.retains, 0);
    } finally {
      await fixture.cleanup();
    }
  },
);

Deno.test("run DFM checks is fail-closed on a SHA-256 mismatch", async () => {
  const fixture = await createFixture({ mismatch: true });
  try {
    await assertRejects(
      () => fixture.executor.execute(AGENT, fixture.command),
      Error,
      "STEP SHA-256 mismatch",
    );
    assertEquals(fixture.dfm.names, ["dfm_check_envelope"]);
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("run DFM checks refuses an isolated-geometry binding", async () => {
  const fixture = await createFixture({
    geometryTool: "design.seal-isolated-geometry@1",
  });
  try {
    await assertRejects(
      () => fixture.executor.execute(AGENT, fixture.command),
      EngineeringProjectCommandError,
      "design.seal-isolated-geometry@1",
    );
    assertEquals(fixture.dfm.names.length, 0);
  } finally {
    await fixture.cleanup();
  }
});

Deno.test(
  "run DFM checks binds a cad-asset STEP child of design.write-geometry@1",
  async () => {
    const fixture = await createFixture({ canonicalChild: true });
    try {
      const project = await fixture.executor.execute(AGENT, fixture.command);
      assertEquals(project.agentRuns[0]?.status, "completed");
      assertEquals(fixture.dfm.names, [
        "dfm_check_envelope",
        "dfm_check_min_thickness",
        "dfm_check_overhangs",
      ]);
    } finally {
      await fixture.cleanup();
    }
  },
);

Deno.test("a completed DFM check run replays without a second provider dispatch", async () => {
  const fixture = await createFixture();
  try {
    await fixture.executor.execute(AGENT, fixture.command);
    assertEquals(fixture.dfm.names.length, 3);
    assertEquals(fixture.session.events, ["begin"]);
    assertEquals(fixture.session.releases, 1);
    const again = await fixture.executor.execute(AGENT, fixture.command);
    assertEquals(again.agentRuns[0]?.status, "completed");
    assertEquals(fixture.dfm.names.length, 3);
    assertEquals(fixture.session.events, ["begin"]);
    assertEquals(fixture.stager.calls, 1);
    assertEquals(fixture.connection.opens, 1);
  } finally {
    await fixture.cleanup();
  }
});

Deno.test(
  "run DFM checks opens JIT, stages owned STEP, then claims before WAL or provider",
  async () => {
    const fixture = await createFixture();
    try {
      const events: string[] = [];
      const session = recordingCapabilityRuntimeSession(async (input) => {
        events.push("begin");
        await input.recheck();
        return {
          lease: { id: "capability-jit-dfm" } as CapabilityRuntimeExecutionSession[
            "lease"
          ],
          releaseTerminal: () => Promise.resolve(),
          retainForRecovery: () => undefined,
        };
      });
      const connection = passthroughCapabilityRuntimeConnection(fixture.dfm, events);
      const commands = Object.create(fixture.commands) as typeof fixture.commands;
      commands.claimRun = (
        origin: typeof AGENT,
        command: Parameters<typeof fixture.commands.claimRun>[1],
      ) => {
        events.push("claim");
        return fixture.commands.claimRun(origin, command);
      };
      const originalBegin = fixture.attempts.begin.bind(fixture.attempts);
      fixture.attempts.begin = (input) => {
        events.push("wal");
        return originalBegin(input);
      };
      const stagerFactory: CapabilitySessionGeometryExportStagerFactory = {
        forActiveCapabilitySession: () => {
          events.push("stage");
          return Promise.resolve(fixture.stager);
        },
      };
      const originalCall = fixture.dfm.callTool.bind(fixture.dfm);
      fixture.dfm.callTool = (call) => {
        events.push(`provider:${call.name}`);
        return originalCall(call);
      };
      const executor = new IndustrializeRunDfmChecksRunExecutor({
        ...executorDeps(fixture),
        commands,
        stagerFactory,
        capabilityRuntimeConnection: connection,
        capabilityRuntimeSession: session,
      });
      await executor.execute(AGENT, fixture.command);
      assertEquals(events[0], "begin");
      assertEquals(events.indexOf("begin") < events.indexOf("connect"), true);
      assertEquals(events.indexOf("connect") < events.indexOf("open"), true);
      assertEquals(events.indexOf("open") < events.indexOf("stage"), true);
      assertEquals(events.indexOf("stage") < events.indexOf("claim"), true);
      assertEquals(events.indexOf("claim") < events.indexOf("wal"), true);
      assertEquals(
        events.indexOf("wal") < events.indexOf("provider:dfm_check_envelope"),
        true,
      );
      assertEquals(fixture.dfm.names, [
        "dfm_check_envelope",
        "dfm_check_min_thickness",
        "dfm_check_overhangs",
      ]);
      assertEquals(fixture.stager.paths[0]?.startsWith("/tmp/dfm-"), true);
    } finally {
      await fixture.cleanup();
    }
  },
);

Deno.test("JIT unavailability before claim leaves the DFM run queued with no WAL", async () => {
  const fixture = await createFixture();
  try {
    const session = recordingCapabilityRuntimeSession(() =>
      Promise.reject(new Error("exact mcp-dfm host group unavailable"))
    );
    const executor = new IndustrializeRunDfmChecksRunExecutor({
      ...executorDeps(fixture),
      capabilityRuntimeSession: session,
    });
    await assertRejects(
      () => executor.execute(AGENT, fixture.command),
      Error,
      "host group unavailable",
    );
    assertEquals(fixture.dfm.names.length, 0);
    assertEquals(fixture.stager.calls, 0);
    assertEquals(fixture.project.agentRuns[0]?.status, "queued");
    assertEquals(await fixture.attempts.read(PROJECT_ID, RUN_ID), undefined);
    assertEquals(session.releases, 0);
    assertEquals(session.retains, 0);
  } finally {
    await fixture.cleanup();
  }
});

Deno.test(
  "a failed runtime connection after JIT begin does not claim or call mcp-dfm",
  async () => {
    const fixture = await createFixture();
    try {
      const session = recordingCapabilityRuntimeSession();
      const connection = {
        ...passthroughCapabilityRuntimeConnection(fixture.dfm),
        broker: {
          connect: () =>
            Promise.reject(
              new CapabilityRuntimeConnectionError(
                "exact mcp-dfm publication is unavailable",
              ),
            ),
        },
      };
      const executor = new IndustrializeRunDfmChecksRunExecutor({
        ...executorDeps(fixture),
        capabilityRuntimeConnection: connection,
        capabilityRuntimeSession: session,
      });
      await assertRejects(
        () => executor.execute(AGENT, fixture.command),
        Error,
        "publication is unavailable",
      );
      assertEquals(session.events, ["begin"]);
      assertEquals(session.releases, 1);
      assertEquals(session.retains, 0);
      assertEquals(fixture.dfm.names.length, 0);
      assertEquals(fixture.stager.calls, 0);
      assertEquals(fixture.project.agentRuns[0]?.status, "queued");
      assertEquals(await fixture.attempts.read(PROJECT_ID, RUN_ID), undefined);
    } finally {
      await fixture.cleanup();
    }
  },
);

Deno.test("staging failure before claim leaves the DFM run queued with no WAL", async () => {
  const fixture = await createFixture();
  try {
    const session = recordingCapabilityRuntimeSession();
    const executor = new IndustrializeRunDfmChecksRunExecutor({
      ...executorDeps(fixture),
      capabilityRuntimeSession: session,
      stagerFactory: {
        forActiveCapabilitySession: () =>
          Promise.reject(new Error("owned DFM container is absent")),
      },
    });
    await assertRejects(
      () => executor.execute(AGENT, fixture.command),
      Error,
      "owned DFM container is absent",
    );
    assertEquals(session.events, ["begin"]);
    assertEquals(session.releases, 1);
    assertEquals(session.retains, 0);
    assertEquals(fixture.dfm.names.length, 0);
    assertEquals(fixture.project.agentRuns[0]?.status, "queued");
    assertEquals(await fixture.attempts.read(PROJECT_ID, RUN_ID), undefined);
  } finally {
    await fixture.cleanup();
  }
});

Deno.test(
  "run DFM checks executes only the exact human-approved Thread basis",
  async () => {
    const fixture = await createFixture();
    try {
      const project = await fixture.executor.execute(AGENT, fixture.command);
      assertEquals(project.agentRuns[0]?.status, "completed");
      assertEquals(fixture.dfm.names.length, 3);
    } finally {
      await fixture.cleanup();
    }
  },
);

Deno.test(
  "run DFM checks refuses a same-subject MRTR on a later Thread revision before claim",
  async () => {
    const fixture = await createFixture();
    try {
      patchMrtrBaseSnapshot(fixture.project, { revision: 117 });
      await assertRejectedBeforeDispatch(
        fixture,
        DFM_RUN_AUTHORITY_DIVERGENT_REASON,
      );
    } finally {
      await fixture.cleanup();
    }
  },
);

Deno.test(
  "run DFM checks refuses an MRTR whose snapshot id is not the run basis before claim",
  async () => {
    const fixture = await createFixture();
    try {
      patchMrtrBaseSnapshot(fixture.project, {
        snapshotId: "snapshot.dfm.run.r115",
      });
      await assertRejectedBeforeDispatch(
        fixture,
        DFM_RUN_AUTHORITY_DIVERGENT_REASON,
      );
    } finally {
      await fixture.cleanup();
    }
  },
);

Deno.test(
  "run DFM checks refuses an MRTR whose subject is not the run basis before claim",
  async () => {
    const fixture = await createFixture();
    try {
      patchMrtrBaseSnapshot(fixture.project, {
        subjectId: "project:other-subject",
      });
      await assertRejectedBeforeDispatch(
        fixture,
        DFM_RUN_AUTHORITY_DIVERGENT_REASON,
      );
    } finally {
      await fixture.cleanup();
    }
  },
);

Deno.test(
  "run DFM checks refuses a human MRTR that declares no Thread base before claim",
  async () => {
    const fixture = await createFixture();
    try {
      delete (fixture.project.decisions[0] as { baseSnapshot?: unknown })
        .baseSnapshot;
      await assertRejectedBeforeDispatch(fixture);
    } finally {
      await fixture.cleanup();
    }
  },
);

async function createFixture(options: {
  readonly geometryTool?: string;
  readonly mismatch?: boolean;
  readonly canonicalChild?: boolean;
} = {}) {
  const geometryBytes = new TextEncoder().encode("ISO-10303-21;END-ISO-10303-21;\n");
  const geometryDigest = await fingerprintResourceBytes(geometryBytes);
  const stepId = options.canonicalChild
    ? `cad-asset-${CANONICAL_CAPTURE}-target-0-${geometryDigest}`
    : GEOMETRY_ID;
  const dfmCase = validateDfmCheckCase(caseJson(geometryDigest, stepId));
  const caseDigest = (await sha256Fingerprint(dfmCase)).digest;
  const caseCapture = await validateDfmCaseCapture({
    schemaVersion: DFM_CASE_CAPTURE_SCHEMA,
    operation: { id: "industrialize.seal-dfm-case", version: "1" },
    trustedRunId: "run.seal",
    caseDigest,
    canonicalCaseText: deterministicJson(dfmCase),
    dfmCase,
    sealedAt: AT,
  });
  const caseFingerprint = await sha256Fingerprint(caseCapture);
  const assetDir = await Deno.makeTempDir({ prefix: "dfm-assets-" });
  await Deno.writeFile(`${assetDir}/${geometryDigest}.step`, geometryBytes);
  const caseArtifact = {
    id: CASE_ARTIFACT_ID,
    name: "DFM case",
    kind: "document" as const,
    version: caseDigest,
    fingerprint: caseFingerprint,
    uri: `${DFM_CASE_CAPTURE_URI_PREFIX}${caseFingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "industrialize.seal-dfm-case@1",
      runId: "run.seal",
    },
    inputArtifactIds: [],
    freshness: fresh(AT),
  };
  const geometryArtifact = {
    id: stepId,
    name: "Canonical STEP",
    kind: "step" as const,
    version: geometryDigest,
    fingerprint: { algorithm: "sha256" as const, digest: geometryDigest },
    uri: `/api/thread/assets/${geometryDigest}.step`,
    mediaType: "model/step",
    producer: {
      serverId: options.canonicalChild ? "build123d-sandbox" : "digital-thread",
      tool: options.geometryTool ??
        (options.canonicalChild ? "build123d_export" : "design.write-geometry@1"),
      runId: "run.geometry",
    },
    inputArtifactIds: [],
    freshness: fresh(AT),
  };
  const geometryParent = {
    id: `geometry-${CANONICAL_CAPTURE}`,
    name: "CameraBoardEnvelope",
    kind: "cad-model" as const,
    version: CANONICAL_CAPTURE,
    fingerprint: { algorithm: "sha256" as const, digest: CANONICAL_CAPTURE },
    uri: `casys://geometry-capture/sha256/${CANONICAL_CAPTURE}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "design.write-geometry@1",
      runId: "run.geometry",
    },
    inputArtifactIds: [],
    freshness: fresh(AT),
  };
  const basisSnapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "snapshot.dfm.run.r1",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "DFM run fixture",
      kind: "system",
      version: "r1",
      modelArtifactId: "artifact.brief",
    },
    freshness: fresh(AT),
    changeSet: {
      id: "change-set.run",
      name: "Run basis",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [{
        id: "change.case",
        kind: "created",
        target: { kind: "artifact", id: CASE_ARTIFACT_ID },
        summary: "Sealed the DFM case.",
        afterFingerprint: caseFingerprint,
      }],
    },
    artifacts: [
      {
        id: "artifact.brief",
        name: "Brief",
        kind: "document",
        version: "1",
        fingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
        producer: {
          serverId: "digital-thread",
          tool: "baseline.from-approved-brief@1",
          runId: "run.brief",
        },
        inputArtifactIds: [],
        freshness: fresh(AT),
      },
      caseArtifact,
      geometryArtifact,
      ...(options.canonicalChild ? [geometryParent] : []),
    ],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "provenance.change.case",
      relation: "changes",
      from: { kind: "change", id: "change.case" },
      to: { kind: "artifact", id: CASE_ARTIFACT_ID },
      rationale: "The applied change introduced the sealed case.",
    }],
    proposedActions: [],
  });
  const reviewBasis = {
    snapshotId: basisSnapshot.id,
    revision: basisSnapshot.revision,
    subjectId: SUBJECT_ID,
  };
  const runBasis = { kind: "thread-snapshot" as const, ...reviewBasis };
  const operation = {
    id: "industrialize.run-dfm-checks",
    version: "1",
    bindings: [
      {
        name: "dfmCase",
        source: {
          kind: "thread-entity" as const,
          reference: {
            snapshotId: basisSnapshot.id,
            snapshotRevision: 1,
            kind: "artifact" as const,
            id: CASE_ARTIFACT_ID,
          },
        },
      },
      {
        name: "geometry",
        source: {
          kind: "thread-entity" as const,
          reference: {
            snapshotId: basisSnapshot.id,
            snapshotRevision: 1,
            kind: "artifact" as const,
            id: stepId,
          },
        },
      },
    ],
  };
  const parameters = encodeDfmRunDecisionParameters({
    caseDigest,
    targetSha256: geometryDigest,
    zMinFilter: dfmCase.zMinFilter,
  });
  const decisionFingerprint = await sha256Fingerprint({
    baseSnapshot: reviewBasis,
    inputEvidenceRefs: [],
    proposal: { summary: "Run measured DFM checks", parameters },
  });
  const runFingerprint = await sha256Fingerprint({
    workItemId: WORK_ID,
    basis: runBasis,
    operation,
    approvedDecisions: [{ id: DECISION_ID, inputFingerprint: decisionFingerprint }],
  });
  const project = {
    schemaVersion: "4.0",
    id: `${PROJECT_ID}:r2`,
    revision: 1,
    generatedAt: AT,
    project: {
      id: PROJECT_ID,
      name: "DFM run fixture",
      subjectId: SUBJECT_ID,
      objective: { title: "Run", statement: "Run measured DFM checks." },
    },
    threadSnapshots: [reviewBasis],
    phases: [{
      id: "phase.industrialize",
      name: "Industrialize",
      order: 1,
      description: "Run measured DFM checks.",
      workItemIds: [WORK_ID],
      requiredDecisionIds: [DECISION_ID],
      evidenceRefs: [],
    }],
    workItems: [{
      id: WORK_ID,
      activityId: `activity:${WORK_ID}`,
      phaseId: "phase.industrialize",
      title: "Run DFM checks",
      description: "Run the sealed case.",
      kind: "industrialize",
      operation,
      status: "in-progress",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [DECISION_ID],
      blockerIds: [],
    }],
    agentRuns: [{
      id: RUN_ID,
      workItemId: WORK_ID,
      status: "queued",
      summary: "Run measured DFM checks.",
      queuedAt: AT,
      basis: runBasis,
      inputFingerprint: runFingerprint,
      evidenceRefs: [],
    }],
    decisions: [{
      id: DECISION_ID,
      phaseId: "phase.industrialize",
      title: "Approve DFM run",
      question: "Run the sealed DFM case?",
      status: "approved",
      requestedAt: AT,
      baseSnapshot: reviewBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [],
      approvalIds: [APPROVAL_ID],
      proposal: {
        summary: "Run measured DFM checks",
        parameters,
        proposedAt: AT,
        proposedBy: { id: AGENT.actorId, origin: "agent" },
      },
    }],
    approvals: [{
      id: APPROVAL_ID,
      decisionId: DECISION_ID,
      status: "approved",
      requestedAt: AT,
      decidedAt: AT,
      decidedBy: "human:test",
      decidedByOrigin: "human",
      rationale: "Reviewed the bindings.",
      baseSnapshot: reviewBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [],
    }],
    blockers: [],
    commandReceipts: [],
  } as unknown as MutableProject;
  const snapshots = new MemorySnapshots(basisSnapshot);
  const caseCaptures = new MemoryCaptures(DFM_CASE_CAPTURE_URI_PREFIX);
  await caseCaptures.save(caseFingerprint, deterministicJson(caseCapture));
  const checkCaptures = new MemoryCaptures("casys://dfm-check-capture/sha256/");
  const dfm = new FakeDfm(geometryDigest, options.mismatch === true);
  const stager = new FakeStager(geometryDigest);
  const walDir = await Deno.makeTempDir({ prefix: "dfm-run-wal-" });
  const commands = new MemoryCommands(project);
  const attempts = new FileDfmCheckAttemptStore(walDir);
  const projects: EngineeringProjectRevisionStore = {
    get: () => Promise.resolve(project as unknown as EngineeringProjectSnapshot),
    getRevision: () =>
      Promise.resolve(project as unknown as EngineeringProjectSnapshot),
    createInitial: () => Promise.reject(new Error("unused")),
    commit: () => Promise.reject(new Error("unused")),
  };
  const session = recordingCapabilityRuntimeSession();
  const connection = passthroughCapabilityRuntimeConnection(dfm);
  const stagerFactory: CapabilitySessionGeometryExportStagerFactory = {
    forActiveCapabilitySession: () => Promise.resolve(stager),
  };
  const capabilityRuntime = {
    requireExecution: () => dfmOperationalCapability(PROJECT_ID),
  };
  const deps = {
    projects,
    commands,
    snapshots,
    caseCaptures: caseCaptures as never,
    checkCaptures: checkCaptures as never,
    geometryAssets: new FileCanonicalAssetReader({ directory: assetDir }),
    stagerFactory,
    capabilityRuntimeConnection: connection,
    attempts,
    lease: {
      withLease: <T>(
        _projectId: string,
        _scope: string,
        operation: () => Promise<T>,
      ) => operation(),
    },
    capabilityRuntime,
    capabilityRuntimeSession: session,
  };
  return {
    command: {
      commandId: COMMAND_ID,
      projectId: PROJECT_ID,
      expectedRevision: 1,
      issuedAt: AT,
      runId: RUN_ID,
    },
    dfm,
    project,
    snapshots,
    stager,
    session,
    connection,
    attempts,
    commands,
    cleanup: async () => {
      await Deno.remove(walDir, { recursive: true });
      await Deno.remove(assetDir, { recursive: true });
    },
    executor: new IndustrializeRunDfmChecksRunExecutor(deps),
    deps,
  };
}

function executorDeps(fixture: Awaited<ReturnType<typeof createFixture>>) {
  return fixture.deps;
}

async function dfmOperationalCapability(projectId: string) {
  const launchGroup = await firstPartyDfmLaunchGroupReference();
  const imageDigest = MCP_DFM_010_IMAGE_REFERENCE.slice(
    MCP_DFM_010_IMAGE_REFERENCE.lastIndexOf("@sha256:") + "@sha256:".length,
  );
  return testResolvedCapabilityRuntimeOperation({
    projectId,
    operation: { id: "industrialize.run-dfm-checks", version: "1" },
    capabilityId: "manufacturing.run-dfm-checks",
    binding: { id: "mcp-dfm-measured-checks", version: "1.0.0" },
    unitId: "casys.mcp-dfm",
    materialId: "mcp-dfm-image",
    imageDigest,
    launchGroup,
  });
}

function fresh(changedAt: string) {
  return { status: "fresh" as const, changedAt, invalidatedByChangeIds: [] };
}

type MutableSnapshotRef = {
  snapshotId: string;
  revision: number;
  subjectId: string;
};

function patchMrtrBaseSnapshot(
  project: MutableProject,
  patch: Partial<MutableSnapshotRef>,
): void {
  const decision = project.decisions[0] as { baseSnapshot: MutableSnapshotRef };
  const approval = project.approvals[0] as { baseSnapshot: MutableSnapshotRef };
  decision.baseSnapshot = { ...decision.baseSnapshot, ...patch };
  approval.baseSnapshot = { ...approval.baseSnapshot, ...patch };
}

async function assertRejectedBeforeDispatch(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  message = DFM_RUN_AUTHORITY_MISSING_REASON,
): Promise<void> {
  await assertRejects(
    () => fixture.executor.execute(AGENT, fixture.command),
    EngineeringProjectCommandError,
    message,
  );
  assertEquals(fixture.dfm.names.length, 0);
  assertEquals(fixture.stager.calls, 0);
  assertEquals(fixture.session.events.length, 0);
  assertEquals(fixture.project.agentRuns[0]?.status, "queued");
}

class FakeStager {
  calls = 0;
  readonly paths: string[] = [];
  constructor(private readonly digest: string) {}
  stage(input: { bytes: Uint8Array; digest: string; fileName: string }) {
    this.calls += 1;
    const path = `/tmp/dfm-${input.digest}.step`;
    this.paths.push(path);
    assertEquals(input.digest, this.digest);
    return Promise.resolve({
      path,
      sha256: input.digest,
      byteCount: input.bytes.byteLength,
    });
  }
}

class FakeDfm {
  readonly names: string[] = [];
  readonly arguments: Array<Record<string, unknown> | undefined> = [];
  constructor(
    private readonly digest: string,
    private readonly mismatch: boolean,
  ) {}
  callTool(call: McpToolCall) {
    this.names.push(call.name);
    this.arguments.push(call.arguments);
    if (this.mismatch) {
      return Promise.reject(
        new McpToolCallError(qualification.dfm_mismatch_test.message),
      );
    }
    if (call.name === "dfm_check_envelope") {
      return Promise.resolve({
        structuredContent: withDigest(qualification.dfm_check_envelope, this.digest),
        text: "ok",
      });
    }
    if (call.name === "dfm_check_min_thickness") {
      return Promise.resolve({
        structuredContent: withDigest(
          qualification.dfm_check_min_thickness,
          this.digest,
        ),
        text: "ok",
      });
    }
    return Promise.resolve({
      structuredContent: withDigest(qualification.dfm_check_overhangs, this.digest),
      text: "ok",
    });
  }
  callToolTextResult(call: McpToolCall) {
    return stubCallToolTextResult(call);
  }
}

function withDigest(
  value: Record<string, unknown>,
  digest: string,
): Record<string, unknown> {
  return {
    ...value,
    input_artifact: {
      ...(value.input_artifact as Record<string, unknown>),
      sha256: digest,
    },
  };
}

class MemorySnapshots {
  readonly #byId = new Map<string, ThreadSnapshot>();
  constructor(initial: ThreadSnapshot) {
    this.#byId.set(initial.id, initial);
  }
  get(snapshotId: string) {
    return Promise.resolve(this.#byId.get(snapshotId));
  }
  getFresh(snapshotId: string) {
    return this.get(snapshotId);
  }
  latest(_subjectId?: string) {
    return Promise.resolve([...this.#byId.values()].at(-1));
  }
  save(snapshot: ThreadSnapshot) {
    this.#byId.set(snapshot.id, snapshot);
    return Promise.resolve();
  }
}

class MemoryCaptures {
  readonly #byDigest = new Map<string, string>();
  constructor(private readonly prefix: string) {}
  save(fingerprint: ContentFingerprint, text: string) {
    this.#byDigest.set(fingerprint.digest, text);
    return Promise.resolve({ uri: this.uriFor(fingerprint), path: "x" });
  }
  read(fingerprint: ContentFingerprint) {
    return Promise.resolve(this.#byDigest.get(fingerprint.digest));
  }
  uriFor(fingerprint: ContentFingerprint) {
    return `${this.prefix}${fingerprint.digest}`;
  }
}

type MutableProject = EngineeringProjectSnapshot & {
  revision: number;
  commandReceipts: unknown[];
};

class MemoryCommands {
  constructor(readonly project: MutableProject) {}
  claimRun(origin: typeof AGENT, _command: RunCommand) {
    const run = this.project.agentRuns[0]!;
    if (run.status === "queued") {
      (run as { status: string }).status = "running";
      (run as { startedAt?: string }).startedAt = AT;
      (run as { claimedAt?: string }).claimedAt = AT;
      (run as { claimedBy?: { id: string; origin: "agent" } }).claimedBy = {
        id: origin.actorId,
        origin: "agent",
      };
      this.project.revision += 1;
    }
    return Promise.resolve(this.project);
  }
  publishRun() {
    (this.project.agentRuns[0] as { status: string }).status = "publishing";
    this.project.revision += 1;
    return Promise.resolve(this.project);
  }
  completeRun(_origin: typeof AGENT, command: CompleteRunCommand) {
    const run = this.project.agentRuns[0] as unknown as {
      status: string;
      completedAt?: string;
      resultSnapshot?: CompleteRunCommand["resultSnapshot"];
      evidenceRefs: unknown[];
    };
    run.status = "completed";
    run.completedAt = AT;
    run.resultSnapshot = command.resultSnapshot;
    run.evidenceRefs = [...command.evidenceRefs];
    this.project.revision += 1;
    return Promise.resolve(this.project);
  }
  failRun(_origin: typeof AGENT, _command: FailRunCommand) {
    (this.project.agentRuns[0] as { status: string }).status = "failed";
    this.project.revision += 1;
    return Promise.resolve(this.project);
  }
}
