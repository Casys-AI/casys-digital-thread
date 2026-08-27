import { assertEquals, assertRejects } from "@std/assert";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type { McpToolCall } from "../../../application/ports/out/mcp-tool-client.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type FailRunCommand,
  type RunCommand,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import { validatePrintEstimateCase } from "../../../domain/make/print-estimate/print-estimate-case.ts";
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
  PRINT_ESTIMATE_CASE_CAPTURE_SCHEMA,
  PRINT_ESTIMATE_CASE_CAPTURE_URI_PREFIX,
  validatePrintEstimateCaseCapture,
} from "./print-estimate-case-capture.ts";
import { FileCanonicalAssetReader } from "../../assets/canonical-asset-reader.ts";
import { FilePrintEstimateAttemptStore } from "./file-print-estimate-attempt-store.ts";
import { IndustrializeObservePrintEstimateRunExecutor } from "./industrialize-observe-print-estimate-run-executor.ts";

const AT = "2026-08-15T00:00:00.000Z";
const PROJECT_ID = "reviewed-project-v1";
const SUBJECT_ID = "project:reviewed-project-v1";
const RUN_ID = "run.print-estimate-observe";
const WORK_ID = "work.print-estimate-observe";
const DECISION_ID = "decision.print-estimate-observe";
const APPROVAL_ID = "approval.print-estimate-observe";
const COMMAND_ID = "command.print-estimate-observe";
const CASE_ARTIFACT_ID = "print-estimate-case-sealed";
const GEOMETRY_ARTIFACT_ID = "geometry-stl-1";
const AGENT = { kind: "agent" as const, actorId: "agent:test" };
const PROFILE_TEXT = "# reviewed fixture\nlayer_height = 0.2\n";

function caseJson(profileSha256: string, withDensity = false) {
  const base = {
    schemaVersion: "print-estimate-case/1.0",
    id: "reviewed-fff-estimate-v1",
    revision: 1,
    scope: "FFF print-time-and-material estimate for the isolated component.",
    evidenceBoundary: "Observations only; not a cost quote or verdict.",
    project: { id: PROJECT_ID, subjectId: SUBJECT_ID },
    target: { componentKey: "support-bracket" },
    profile: {
      repoPath: "config/print-estimate-cases/reviewed-fff-0.2-pla.ini",
      exportName: "reviewed-fff-0.2-pla",
      sha256: profileSha256,
      layerHeightMm: { value: 0.2, unit: "mm" },
      nozzleDiameterMm: { value: 0.4, unit: "mm" },
      material: "PLA",
    },
    provider: {
      build123dTool: "build123d_export",
      prusaslicerTool: "prusaslicer_estimate_fff",
    },
    limitations: [
      "Profile parameters are provisional engineering candidates.",
      "gcode_sha256 is an audit reference, not a deterministic attestation.",
    ],
    provenance: {
      status: "provisional",
      note: "Profile parameters are reviewed candidates, not supplier data.",
    },
  };
  return withDensity
    ? { ...base, filamentDensityGCm3: { value: 1.24, unit: "g/cm3" } }
    : base;
}

Deno.test(
  "observe print-estimate publishes time and volume without mass or price when density is absent",
  async () => {
    const fixture = await createFixture();
    try {
      const project = await fixture.executor.execute(AGENT, fixture.command);
      assertEquals(project.agentRuns[0]?.status, "completed");
      const snapshot = await fixture.snapshots.getFresh(
        project.agentRuns[0]!.resultSnapshot!.snapshotId,
      );
      const metrics = snapshot?.observations.map((item) => item.metric) ?? [];
      assertEquals(metrics.includes("print_time_s"), true);
      assertEquals(metrics.includes("filament_volume_mm3"), true);
      assertEquals(metrics.includes("filament_mass_g"), false);
      assertEquals(metrics.some((metric) => metric.includes("price")), false);
      assertEquals(snapshot?.evaluations.length, 0);
    } finally {
      await fixture.cleanup();
    }
  },
);

Deno.test("observe print-estimate refuses a profile sha256 mismatch", async () => {
  const fixture = await createFixture({ profileOverride: "# other\n" });
  try {
    await assertRejects(
      () => fixture.executor.execute(AGENT, fixture.command),
      EngineeringProjectCommandError,
      "profile sha256",
    );
    assertEquals(fixture.prusaslicer.names.length, 0);
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("observe print-estimate refuses a model/step binding", async () => {
  const fixture = await createFixture({ geometryMediaType: "model/step" });
  try {
    await assertRejects(
      () => fixture.executor.execute(AGENT, fixture.command),
      EngineeringProjectCommandError,
      "model/stl",
    );
    assertEquals(fixture.prusaslicer.names.length, 0);
  } finally {
    await fixture.cleanup();
  }
});

async function createFixture(options: {
  readonly profileOverride?: string;
  readonly geometryMediaType?: "model/step" | "model/stl";
} = {}) {
  const profileSha256 = await fingerprintResourceBytes(
    new TextEncoder().encode(PROFILE_TEXT),
  );
  const printEstimateCase = validatePrintEstimateCase(caseJson(profileSha256));
  const caseDigest = (await sha256Fingerprint(printEstimateCase)).digest;
  const caseCapture = await validatePrintEstimateCaseCapture({
    schemaVersion: PRINT_ESTIMATE_CASE_CAPTURE_SCHEMA,
    operation: { id: "industrialize.seal-print-estimate-case", version: "1" },
    trustedRunId: "run.seal",
    caseDigest,
    canonicalCaseText: deterministicJson(printEstimateCase),
    printEstimateCase,
    sealedAt: AT,
  });
  const caseFingerprint = await sha256Fingerprint(caseCapture);
  const geometryBytes = new TextEncoder().encode("solid fixture\nendsolid fixture\n");
  const geometryDigest = await fingerprintResourceBytes(geometryBytes);
  const geometryMediaType = options.geometryMediaType ?? "model/stl";
  const geometryExtension = geometryMediaType === "model/step" ? "step" : "stl";
  const assetDir = await Deno.makeTempDir({ prefix: "print-estimate-assets-" });
  await Deno.writeFile(
    `${assetDir}/${geometryDigest}.${geometryExtension}`,
    geometryBytes,
  );
  const caseArtifact = {
    id: CASE_ARTIFACT_ID,
    name: "Print-estimate case",
    kind: "document" as const,
    version: caseDigest,
    fingerprint: caseFingerprint,
    uri: `${PRINT_ESTIMATE_CASE_CAPTURE_URI_PREFIX}${caseFingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "industrialize.seal-print-estimate-case@1",
      runId: "run.seal",
    },
    inputArtifactIds: [],
    freshness: fresh(AT),
  };
  const geometryArtifact = {
    id: GEOMETRY_ARTIFACT_ID,
    name: geometryMediaType === "model/step" ? "Canonical STEP" : "Canonical STL",
    kind: geometryMediaType === "model/step" ? "step" as const : "cad-model" as const,
    version: geometryDigest,
    fingerprint: { algorithm: "sha256" as const, digest: geometryDigest },
    uri: `/api/thread/assets/${geometryDigest}.${geometryExtension}`,
    mediaType: geometryMediaType,
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
    id: "snapshot.print-estimate.observe.r1",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "Print-estimate observe fixture",
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
        summary: "Sealed the print-estimate case.",
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
    id: "industrialize.observe-print-estimate",
    version: "1",
    bindings: [
      {
        name: "printEstimateCase",
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
    key: "printEstimate.observe.ready",
    label: "Observe the sealed case",
    value: true,
  }];
  const decisionFingerprint = await sha256Fingerprint({
    baseSnapshot: reviewBasis,
    inputEvidenceRefs: [],
    proposal: { summary: "Observe print-estimate", parameters },
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
      name: "Print-estimate observe fixture",
      subjectId: SUBJECT_ID,
      objective: { title: "Observe", statement: "Observe print-estimate." },
    },
    threadSnapshots: [reviewBasis],
    phases: [{
      id: "phase.industrialize",
      name: "Industrialize",
      order: 1,
      description: "Observe print-estimate.",
      workItemIds: [WORK_ID],
      requiredDecisionIds: [DECISION_ID],
      evidenceRefs: [],
    }],
    workItems: [{
      id: WORK_ID,
      activityId: `activity:${WORK_ID}`,
      phaseId: "phase.industrialize",
      title: "Observe print-estimate",
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
      summary: "Observe print-estimate.",
      queuedAt: AT,
      basis: runBasis,
      inputFingerprint: runFingerprint,
      evidenceRefs: [],
    }],
    decisions: [{
      id: DECISION_ID,
      phaseId: "phase.industrialize",
      title: "Approve print-estimate observe",
      question: "Observe the sealed print-estimate case?",
      status: "approved",
      requestedAt: AT,
      baseSnapshot: reviewBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [],
      approvalIds: [APPROVAL_ID],
      proposal: {
        summary: "Observe print-estimate",
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
  const caseCaptures = new MemoryCaptures(PRINT_ESTIMATE_CASE_CAPTURE_URI_PREFIX);
  await caseCaptures.save(caseFingerprint, deterministicJson(caseCapture));
  const observationCaptures = new MemoryCaptures(
    "casys://print-estimate-observation-capture/sha256/",
  );
  const prusaslicer = new FakePrusa(geometryDigest, profileSha256);
  const walDir = await Deno.makeTempDir({ prefix: "print-estimate-observe-wal-" });
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
    snapshots,
    prusaslicer,
    cleanup: async () => {
      await Deno.remove(walDir, { recursive: true });
      await Deno.remove(assetDir, { recursive: true });
    },
    executor: new IndustrializeObservePrintEstimateRunExecutor({
      projects,
      commands,
      snapshots,
      caseCaptures: caseCaptures as never,
      observationCaptures: observationCaptures as never,
      geometryAssets: new FileCanonicalAssetReader({
        directory: assetDir,
        extension: "stl",
      }),
      stager: {
        stage: (input) =>
          Promise.resolve({
            path: `/exports/${input.fileName}`,
            sha256: input.digest,
            byteCount: input.bytes.byteLength,
          }),
      },
      prusaslicer,
      attempts: new FilePrintEstimateAttemptStore(walDir),
      lease: { withLease: (_projectId, _scope, operation) => operation() },
      readTextFile: () => Promise.resolve(options.profileOverride ?? PROFILE_TEXT),
    }),
  };
}

function fresh(changedAt: string) {
  return { status: "fresh" as const, changedAt, invalidatedByChangeIds: [] };
}

class FakePrusa {
  readonly names: string[] = [];
  constructor(
    private readonly geometryDigest: string,
    private readonly profileDigest: string,
  ) {}
  callTool(call: McpToolCall) {
    this.names.push(call.name);
    return Promise.resolve({
      structuredContent: {
        print_time_s: 3600,
        print_time_normal_mode: "1h 0m",
        print_time_silent_mode: null,
        filament_length_mm: 1200,
        filament_volume_mm3: 4000,
        gcode_sha256: "d".repeat(64),
        not_checked: ["warm-up"],
        stl_artifact: { sha256: this.geometryDigest },
        profile_artifact: { sha256: this.profileDigest, bytes: 12 },
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
