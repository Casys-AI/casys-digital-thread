import { assertEquals, assertRejects } from "@std/assert";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type { McpToolCall } from "../../../application/ports/out/mcp-tool-client.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type FailRunCommand,
  type RunCommand,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import { validatePrintabilityCheckCase } from "../../../domain/make/printability/printability-case.ts";
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
import {
  PRINTABILITY_CASE_CAPTURE_SCHEMA,
  PRINTABILITY_CASE_CAPTURE_URI_PREFIX,
  validatePrintabilityCaseCapture,
} from "./printability-case-capture.ts";
import { FileCanonicalAssetReader } from "../../assets/canonical-asset-reader.ts";
import { FilePrintabilityAttemptStore } from "./file-printability-attempt-store.ts";
import { IndustrializeObservePrintabilityRunExecutor } from "./industrialize-observe-printability-run-executor.ts";

const AT = "2026-08-15T00:00:00.000Z";
const PROJECT_ID = "reviewed-project-v1";
const SUBJECT_ID = "project:reviewed-project-v1";
const RUN_ID = "run.printability-observe";
const WORK_ID = "work.printability-observe";
const DECISION_ID = "decision.printability-observe";
const APPROVAL_ID = "approval.printability-observe";
const COMMAND_ID = "command.printability-observe";
const CASE_ARTIFACT_ID = "printability-case-sealed";
const GEOMETRY_ARTIFACT_ID = "geometry-step-1";
const AGENT = { kind: "agent" as const, actorId: "agent:test" };

function caseJson() {
  return {
    schemaVersion: "printability-check-case/1.0",
    id: "reviewed-printability-v1",
    revision: 1,
    scope: "FDM printability check for the isolated component.",
    evidenceBoundary: "Observations only; not a verdict or certification.",
    project: { id: PROJECT_ID, subjectId: SUBJECT_ID },
    target: { componentKey: "support-bracket" },
    thresholds: {
      minWallThicknessMm: { value: 1.2, unit: "mm" },
      maxOverhangAngleDeg: { value: 45.0, unit: "deg" },
      maxUnsupportedAreaMm2: { value: 600.0, unit: "mm2" },
    },
    meshSizeMm: { value: 2.0, unit: "mm" },
    buildDirection: [0, 0, 1],
    provider: {
      build123dTool: "build123d_export",
      thicknessTool: "dfm_check_min_thickness",
      overhangTool: "dfm_check_overhangs",
    },
    limitations: [
      "Thresholds are provisional FDM candidate values.",
      "This check covers only min wall thickness and max overhang angle.",
    ],
    provenance: {
      status: "provisional",
      note: "Thresholds sourced from typical FDM desktop-printer guidelines.",
    },
  };
}

Deno.test(
  "observe printability stages geometry, journals WAL before DFM, and publishes observations only",
  async () => {
    const fixture = await createFixture();
    try {
      const project = await fixture.executor.execute(AGENT, fixture.command);
      assertEquals(project.agentRuns[0]?.status, "completed");
      assertEquals(fixture.dfm.names[0], "dfm_check_min_thickness");
      assertEquals(fixture.dfm.names[1], "dfm_check_overhangs");
      assertEquals(fixture.stager.calls.length, 1);
      assertEquals(String(fixture.stager.calls[0]).endsWith(".step"), true);
      const snapshot = await fixture.snapshots.getFresh(
        project.agentRuns[0]!.resultSnapshot!.snapshotId,
      );
      assertEquals(snapshot?.evaluations.length, 0);
      assertEquals(snapshot?.violations.length, 0);
      assertEquals(
        snapshot?.observations.some((item) => item.metric === "min_wall_thickness_mm"),
        true,
      );
      assertEquals(
        snapshot?.observations.some((item) =>
          item.metric === "dfm_violation_zone_count"
        ),
        true,
      );
      assertEquals(
        snapshot?.observations.some((item) => item.metric === "dfm_not_checked_count"),
        true,
      );
    } finally {
      await fixture.cleanup();
    }
  },
);

Deno.test("observe printability refuses an isolated-geometry binding", async () => {
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

Deno.test("observe printability refuses a compilation-admission binding", async () => {
  const fixture = await createFixture({
    geometryTool: "compile.seal-admission@3",
  });
  try {
    await assertRejects(
      () => fixture.executor.execute(AGENT, fixture.command),
      EngineeringProjectCommandError,
      "compile.seal-admission@3",
    );
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("observe printability refuses a model/stl binding", async () => {
  const fixture = await createFixture({ geometryMediaType: "model/stl" });
  try {
    await assertRejects(
      () => fixture.executor.execute(AGENT, fixture.command),
      EngineeringProjectCommandError,
      "model/step",
    );
    assertEquals(fixture.dfm.names.length, 0);
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("a completed printability observe run replays without a second DFM dispatch", async () => {
  const fixture = await createFixture();
  try {
    await fixture.executor.execute(AGENT, fixture.command);
    assertEquals(fixture.dfm.names.length, 2);
    const again = await fixture.executor.execute(AGENT, fixture.command);
    assertEquals(again.agentRuns[0]?.status, "completed");
    assertEquals(fixture.dfm.names.length, 2);
  } finally {
    await fixture.cleanup();
  }
});

async function createFixture(options: {
  readonly geometryTool?: string;
  readonly geometryMediaType?: "model/step" | "model/stl";
} = {}) {
  const printabilityCase = validatePrintabilityCheckCase(caseJson());
  const caseDigest = (await sha256Fingerprint(printabilityCase)).digest;
  const caseCapture = await validatePrintabilityCaseCapture({
    schemaVersion: PRINTABILITY_CASE_CAPTURE_SCHEMA,
    operation: { id: "industrialize.seal-printability-case", version: "1" },
    trustedRunId: "run.seal",
    caseDigest,
    canonicalCaseText: deterministicJson(printabilityCase),
    printabilityCase,
    sealedAt: AT,
  });
  const caseFingerprint = await sha256Fingerprint(caseCapture);
  const geometryBytes = new TextEncoder().encode("ISO-10303-21;END-ISO-10303-21;\n");
  const geometryDigest = await fingerprintResourceBytes(geometryBytes);
  const geometryMediaType = options.geometryMediaType ?? "model/step";
  const geometryExtension = geometryMediaType === "model/stl" ? "stl" : "step";
  const assetDir = await Deno.makeTempDir({ prefix: "printability-assets-" });
  await Deno.writeFile(
    `${assetDir}/${geometryDigest}.${geometryExtension}`,
    geometryBytes,
  );
  const caseArtifact = {
    id: CASE_ARTIFACT_ID,
    name: "Printability case",
    kind: "document" as const,
    version: caseDigest,
    fingerprint: caseFingerprint,
    uri: `${PRINTABILITY_CASE_CAPTURE_URI_PREFIX}${caseFingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "industrialize.seal-printability-case@1",
      runId: "run.seal",
    },
    inputArtifactIds: [],
    freshness: fresh(AT),
  };
  const geometryArtifact = {
    id: GEOMETRY_ARTIFACT_ID,
    name: geometryMediaType === "model/stl" ? "Canonical STL" : "Canonical STEP",
    kind: geometryMediaType === "model/stl" ? "cad-model" as const : "step" as const,
    version: geometryDigest,
    fingerprint: { algorithm: "sha256" as const, digest: geometryDigest },
    uri: `/api/thread/assets/${geometryDigest}.${geometryExtension}`,
    mediaType: geometryMediaType,
    producer: {
      serverId: "digital-thread",
      tool: options.geometryTool ?? "design.write-geometry@1",
      runId: "run.geometry",
    },
    inputArtifactIds: [],
    freshness: fresh(AT),
  };
  const basisSnapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "snapshot.printability.observe.r1",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "Printability observe fixture",
      kind: "system",
      version: "r1",
      modelArtifactId: "artifact.brief",
    },
    freshness: fresh(AT),
    changeSet: {
      id: "change-set.observe",
      name: "Observe basis",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [{
        id: "change.case",
        kind: "created",
        target: { kind: "artifact", id: CASE_ARTIFACT_ID },
        summary: "Sealed the printability case.",
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
    id: "industrialize.observe-printability",
    version: "1",
    bindings: [
      {
        name: "printabilityCase",
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
            id: GEOMETRY_ARTIFACT_ID,
          },
        },
      },
    ],
  };
  const parameters = [{
    key: "printability.observe.ready",
    label: "Observe the sealed case",
    value: true,
  }];
  const decisionFingerprint = await sha256Fingerprint({
    baseSnapshot: reviewBasis,
    inputEvidenceRefs: [],
    proposal: { summary: "Observe printability", parameters },
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
      name: "Printability observe fixture",
      subjectId: SUBJECT_ID,
      objective: { title: "Observe", statement: "Observe printability." },
    },
    threadSnapshots: [reviewBasis],
    phases: [{
      id: "phase.industrialize",
      name: "Industrialize",
      order: 1,
      description: "Observe printability.",
      workItemIds: [WORK_ID],
      requiredDecisionIds: [DECISION_ID],
      evidenceRefs: [],
    }],
    workItems: [{
      id: WORK_ID,
      activityId: `activity:${WORK_ID}`,
      phaseId: "phase.industrialize",
      title: "Observe printability",
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
      summary: "Observe printability.",
      queuedAt: AT,
      basis: runBasis,
      inputFingerprint: runFingerprint,
      evidenceRefs: [],
    }],
    decisions: [{
      id: DECISION_ID,
      phaseId: "phase.industrialize",
      title: "Approve printability observe",
      question: "Observe the sealed printability case?",
      status: "approved",
      requestedAt: AT,
      baseSnapshot: reviewBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [],
      approvalIds: [APPROVAL_ID],
      proposal: {
        summary: "Observe printability",
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
  const caseCaptures = new MemoryCaptures(PRINTABILITY_CASE_CAPTURE_URI_PREFIX);
  await caseCaptures.save(caseFingerprint, deterministicJson(caseCapture));
  const observationCaptures = new MemoryCaptures(
    "casys://printability-observation-capture/sha256/",
  );
  const dfm = new FakeDfm(geometryDigest);
  const stager = new FakeStager();
  const walDir = await Deno.makeTempDir({ prefix: "printability-observe-wal-" });
  const commands = new MemoryCommands(project);
  const projects: EngineeringProjectRevisionStore = {
    get: () => Promise.resolve(project as unknown as EngineeringProjectSnapshot),
    getRevision: () =>
      Promise.resolve(project as unknown as EngineeringProjectSnapshot),
    createInitial: () => Promise.reject(new Error("unused")),
    commit: () => Promise.reject(new Error("unused")),
  };
  return {
    command: {
      commandId: COMMAND_ID,
      projectId: PROJECT_ID,
      expectedRevision: 1,
      issuedAt: AT,
      runId: RUN_ID,
    },
    project,
    snapshots,
    dfm,
    stager,
    walDir,
    cleanup: async () => {
      await Deno.remove(walDir, { recursive: true });
      await Deno.remove(assetDir, { recursive: true });
    },
    executor: new IndustrializeObservePrintabilityRunExecutor({
      projects,
      commands,
      snapshots,
      caseCaptures: caseCaptures as never,
      observationCaptures: observationCaptures as never,
      geometryAssets: new FileCanonicalAssetReader({ directory: assetDir }),
      stager,
      dfm,
      attempts: new FilePrintabilityAttemptStore(walDir),
      lease: { withLease: (_projectId, _scope, operation) => operation() },
    }),
  };
}

function fresh(changedAt: string) {
  return { status: "fresh" as const, changedAt, invalidatedByChangeIds: [] };
}

class FakeStager {
  readonly calls: unknown[] = [];
  stage(input: { bytes: Uint8Array; digest: string; fileName: string }) {
    this.calls.push(input.fileName);
    return Promise.resolve({
      path: `/exports/${input.fileName}`,
      sha256: input.digest,
      byteCount: input.bytes.byteLength,
    });
  }
}

class FakeDfm {
  readonly names: string[] = [];
  constructor(private readonly digest: string) {}
  callTool(call: McpToolCall) {
    this.names.push(call.name);
    if (call.name === "dfm_check_min_thickness") {
      return Promise.resolve({
        structuredContent: {
          violations: [{ area_mm2: 1, centroid_mm: [0, 0, 0] }],
          measured: {
            min_thickness_mm: 0.8,
            min_position_mm: [1, 2, 3],
            sample_count: 10,
            valid_ray_count: 8,
          },
          limits_declared: { min_thickness_mm: 1.2 },
          not_checked: ["bridging"],
          input_artifact: { sha256: this.digest },
        },
        text: "ok",
      });
    }
    return Promise.resolve({
      structuredContent: {
        violations: [],
        measured: {
          total_surface_area_mm2: 100,
          overhang_area_mm2: 4,
          overhang_triangle_count: 2,
          total_triangle_count: 20,
        },
        limits_declared: { max_overhang_deg: 45 },
        not_checked: ["support"],
        input_artifact: { sha256: this.digest },
      },
      text: "ok",
    });
  }
  callToolTextResult(call: McpToolCall) {
    return stubCallToolTextResult(call);
  }
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
