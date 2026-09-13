import { assertEquals } from "@std/assert";
import type { Build123dExecutionProfile } from "../../../application/ports/out/cad/isolated/build123d-execution-profile-catalog.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type { IsolatedCodeRunner } from "../../../application/ports/out/compile/isolation/isolated-code-runner.ts";
import type { ReopenedTechnicalCompilationAdmission } from "../../../application/ports/out/compile/admission/technical-compilation-admission-reader.ts";
import type {
  CompleteRunCommand,
  RunCommand,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import { BUILD123D_EXECUTION_PROFILE } from "../../../domain/cad/isolated/build123d-execution-proposal.ts";
import {
  fingerprintResourceBytes,
  immutableBytes,
} from "../../../domain/compile/source/provider-resource-reader.ts";
import { PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION } from "../../../domain/compile/admission/technical-compilation.ts";
import {
  capabilityRuntimeLaunchGroupReference,
} from "../../../domain/capability/runtime/capability-runtime-launch-group.ts";
import {
  capabilityRuntimeMaterialKey,
} from "../../../domain/capability/runtime/capability-runtime-supervision.ts";
import type { IsolatedCodeExecutionReceipt } from "../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  assembleSensitivityStudyCaseV3,
  validateSensitivityStudyCaseTemplate,
} from "../../../domain/sensitivity/study/sensitivity-study-template.ts";
import { SENSITIVITY_STUDY_CASE_CAPTURE_SCHEMA } from "../study/sensitivity-study-case-capture.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  EngineeringProjectCommandReceipt,
  EngineeringProjectSnapshot,
} from "../../../domain/project/engineering-project.ts";
import type { EngineeringProjectCommandOrigin } from "../../../application/ports/in/engineering-project-command-origin.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import { AnalyzeRunFeaSensitivityRunExecutor } from "../live-fea/analyze-run-fea-sensitivity-run-executor.ts";
import { FileFeaSensitivityAttemptStore } from "../live-fea/file-fea-sensitivity-attempt-store.ts";
import {
  FileCaptureStore,
  SENSITIVITY_RUNTIME_PROVENANCE_CAPTURE_DESCRIPTOR,
  SENSITIVITY_STUDY_CAPTURE_DESCRIPTOR,
  SENSITIVITY_STUDY_CASE_CAPTURE_DESCRIPTOR,
} from "../../shared/cas/file-capture-store.ts";
import { FileThreadSnapshotStore } from "../../shared/stores/file-thread-snapshot-store.ts";
import { createFirstPartyCapabilityRuntimeLaunchGroupRegistry } from "../../control-plane/first-party-capability-runtime-launch-groups.ts";
import {
  BUILD123D_ISOLATED_WORKER_MATERIAL_ID,
  BUILD123D_ISOLATED_WORKER_UNIT_ID,
} from "../../cad/isolated/worker-contract.ts";
import { FileSensitivityExperienceRepository } from "./file-sensitivity-experience-repository.ts";
import { FileSensitivityExperienceReuseAttemptStore } from "./file-sensitivity-experience-reuse-attempt-store.ts";
import { createSensitivityExperienceExecutorBinding } from "./session-bound-sensitivity-experience.ts";
import { SENSITIVITY_EXPERIENCE_SOLVER_OPERATION_RECORDED } from "../../../domain/sensitivity/experience/sensitivity-experience.ts";
import { validateSensitivityStudyResult } from "../../../domain/sensitivity/study/sensitivity-study-result.ts";

const AT = "2026-08-23T00:00:00.000Z";
const SOURCE_TEXT = "size_z = 50\nresult = Box(1, 1, size_z)\n";
const ADMISSION_DIGEST = "a".repeat(64);
const BUILD123D_IMAGE_DIGEST = "6".repeat(64);
const BUILD123D_IMAGE_FINGERPRINT = {
  algorithm: "sha256" as const,
  digest: BUILD123D_IMAGE_DIGEST,
};
const BUILD123D_PROFILE_FINGERPRINT = {
  algorithm: "sha256" as const,
  digest: "7".repeat(64),
};
const AGENT = { kind: "agent" as const, actorId: "agent:test" };
const HUMAN = { kind: "human" as const, actorId: "human:test" };

Deno.test("recorded interproject reuse hits from a cold admitted run without CAD or solver", async () => {
  const root = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "sensitivity-experience-reuse-" }),
  );
  try {
    const groups = await createFirstPartyCapabilityRuntimeLaunchGroupRegistry();
    const calculix = (await groups.list()).find((group) =>
      group.id === "casys-mcp-calculix"
    )!;
    const member = calculix.materials[0]!;
    const launchGroup = capabilityRuntimeLaunchGroupReference(calculix);
    const observer = {
      observe: (materials: readonly typeof member.material[]) => {
        const observed = new Map();
        for (const material of materials) {
          if (
            material.unitId === member.material.unitId &&
            material.materialId === member.material.materialId &&
            material.imageDigest === member.material.imageDigest
          ) {
            observed.set(capabilityRuntimeMaterialKey(material), {
              material: "installed",
              runtime: "active",
            });
          }
        }
        return Promise.resolve(observed);
      },
    };
    const snapshots = new FileThreadSnapshotStore(`${root}/snapshots`);
    const caseCaptures = new FileCaptureStore({
      ...SENSITIVITY_STUDY_CASE_CAPTURE_DESCRIPTOR,
      directory: `${root}/cases`,
      syncBoundary: root,
    });
    const studyCaptures = new FileCaptureStore({
      ...SENSITIVITY_STUDY_CAPTURE_DESCRIPTOR,
      directory: `${root}/studies`,
      syncBoundary: root,
    });
    const runtimeProvenanceCaptures = new FileCaptureStore({
      ...SENSITIVITY_RUNTIME_PROVENANCE_CAPTURE_DESCRIPTOR,
      directory: `${root}/runtime-provenance`,
      syncBoundary: root,
    });
    const attempts = new FileFeaSensitivityAttemptStore(`${root}/fea-attempts`);
    const repository = new FileSensitivityExperienceRepository(
      `${root}/experience`,
    );
    const reuseAttempts = new FileSensitivityExperienceReuseAttemptStore(
      `${root}/experience/reuse-attempts`,
    );
    const admission = await makeAdmission();
    const profile = executionProfile();
    const source = await seedProject({
      projectId: "source-project",
      runId: "run-source",
      snapshots,
      caseCaptures,
    });
    const target = await seedProject({
      projectId: "target-project",
      runId: "run-target",
      snapshots,
      caseCaptures,
    });
    const projects = new Map([
      [source.project.project.id, source.project],
      [target.project.project.id, target.project],
    ]);
    const runner = new FakeRunner();
    const solver = new FakeSolver();
    const experience = createSensitivityExperienceExecutorBinding({
      repository,
      projects: {
        get: (id) => Promise.resolve(projects.get(id) as never),
      },
      snapshots,
      caseCaptures,
      studyCaptures,
      admissions: { read: () => Promise.resolve(admission) },
      executionAttempts: attempts,
      groups,
      observer,
      reuseAttempts,
    });
    const executor = makeExecutor({
      projects,
      snapshots,
      caseCaptures,
      studyCaptures,
      runtimeProvenanceCaptures,
      attempts,
      experience,
      runner,
      solver,
      profile,
      launchGroup,
      material: member.material,
    });

    await executor.execute(AGENT, {
      commandId: "command.source",
      projectId: "source-project",
      expectedRevision: 1,
      issuedAt: AT,
      runId: "run-source",
    });
    assertEquals(source.project.agentRuns[0]?.status, "completed");
    assertEquals(runner.sources.length, 2);
    assertEquals(solver.calls, 2);
    const indexed = await repository.rebuild();
    assertEquals(indexed.length, 1);
    const admitted = await repository.readRecord(
      indexed[0]!.records[0]!.recordFingerprint,
    );
    assertEquals(
      admitted?.identity.method.solver.operationId,
      SENSITIVITY_EXPERIENCE_SOLVER_OPERATION_RECORDED,
    );

    const firstTarget = await executor.execute(AGENT, {
      commandId: "command.target",
      projectId: "target-project",
      expectedRevision: 1,
      issuedAt: AT,
      runId: "run-target",
    });
    assertEquals(firstTarget.agentRuns[0]?.status, "completed");
    assertEquals(runner.sources.length, 2);
    assertEquals(solver.calls, 2);
    const targetSnapshot = await snapshots.getFresh(
      firstTarget.agentRuns[0]!.resultSnapshot!.snapshotId,
    );
    const reuseArtifact = targetSnapshot?.artifacts.find((artifact) =>
      artifact.uri?.startsWith("casys://sensitivity-study-reuse-result/sha256/")
    );
    assertEquals(reuseArtifact !== undefined, true);
    const resultText = await studyCaptures.read(reuseArtifact!.fingerprint);
    const result = await validateSensitivityStudyResult(
      JSON.parse(resultText!),
    );
    assertEquals("cad" in result, false);
    assertEquals(result.studyCase.project.id, "target-project");

    const reconstructedAttempts = new FileFeaSensitivityAttemptStore(
      `${root}/fea-attempts`,
    );
    const reconstructedRepository = new FileSensitivityExperienceRepository(
      `${root}/experience`,
    );
    const reconstructedReuse = new FileSensitivityExperienceReuseAttemptStore(
      `${root}/experience/reuse-attempts`,
    );
    const reconstructedSnapshots = new FileThreadSnapshotStore(
      `${root}/snapshots`,
    );
    const reconstructedExperience = createSensitivityExperienceExecutorBinding({
      repository: reconstructedRepository,
      projects: {
        get: (id) => Promise.resolve(projects.get(id) as never),
      },
      snapshots: reconstructedSnapshots,
      caseCaptures,
      studyCaptures,
      admissions: { read: () => Promise.resolve(admission) },
      executionAttempts: reconstructedAttempts,
      groups,
      observer,
      reuseAttempts: reconstructedReuse,
    });
    resetRunToRunning(target.project);
    const replayRunner = new FakeRunner();
    const replaySolver = new FakeSolver();
    const replay = makeExecutor({
      projects,
      snapshots: reconstructedSnapshots,
      caseCaptures,
      studyCaptures,
      runtimeProvenanceCaptures,
      attempts: reconstructedAttempts,
      experience: reconstructedExperience,
      runner: replayRunner,
      solver: replaySolver,
      profile,
      launchGroup,
      material: member.material,
    });
    const replayed = await replay.execute(AGENT, {
      commandId: "command.target-replay",
      projectId: "target-project",
      expectedRevision: target.project.revision,
      issuedAt: AT,
      runId: "run-target",
    });
    assertEquals(replayed.agentRuns[0]?.status, "completed");
    assertEquals(
      replayed.agentRuns[0]?.resultSnapshot?.snapshotId,
      firstTarget.agentRuns[0]?.resultSnapshot?.snapshotId,
    );
    assertEquals(replayRunner.sources.length, 0);
    assertEquals(replaySolver.calls, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

function makeExecutor(input: {
  readonly projects: Map<string, MutableProject>;
  readonly snapshots: FileThreadSnapshotStore;
  readonly caseCaptures: FileCaptureStore<"sensitivity-study-case">;
  readonly studyCaptures: FileCaptureStore<"sensitivity-study">;
  readonly runtimeProvenanceCaptures: FileCaptureStore<
    "sensitivity-runtime-provenance"
  >;
  readonly attempts: FileFeaSensitivityAttemptStore;
  readonly experience: ReturnType<
    typeof createSensitivityExperienceExecutorBinding
  >;
  readonly runner: FakeRunner;
  readonly solver: FakeSolver;
  readonly profile: Build123dExecutionProfile;
  readonly launchGroup: ReturnType<
    typeof capabilityRuntimeLaunchGroupReference
  >;
  readonly material: {
    readonly unitId: string;
    readonly materialId: string;
    readonly imageDigest: string;
  };
}) {
  const projectStore: EngineeringProjectRevisionStore = {
    get: (id) => Promise.resolve(input.projects.get(id) as never),
    getRevision: (id) => Promise.resolve(input.projects.get(id) as never),
    createInitial: () => Promise.reject(new Error("unused")),
    commit: () => Promise.reject(new Error("unused")),
  };
  const runtimeOperation = sensitivityRuntimeOperation(
    input.launchGroup,
    input.material,
  );
  return new AnalyzeRunFeaSensitivityRunExecutor({
    projects: projectStore,
    commands: new ProjectMapCommands(input.projects),
    snapshots: input.snapshots,
    caseCaptures: input.caseCaptures,
    studyCaptures: input.studyCaptures,
    runtimeProvenanceCaptures: input.runtimeProvenanceCaptures,
    admissions: {
      read: () => Promise.resolve(cachedAdmission!),
    },
    profiles: {
      initial: () => Promise.reject(new Error("initial is latest; must resolve")),
      resolve: (ref) => {
        if (
          ref.id !== BUILD123D_EXECUTION_PROFILE.id ||
          ref.version !== BUILD123D_EXECUTION_PROFILE.version
        ) {
          return Promise.reject(new Error("unsealed execution profile"));
        }
        return Promise.resolve(input.profile);
      },
    },
    runner: input.runner,
    stagerFactory: {
      forActiveCapabilitySession: () => Promise.resolve(new FakeStager()),
    },
    solver: input.solver as never,
    attempts: input.attempts,
    capabilityRuntime: {
      requireExecution: () => Promise.resolve(runtimeOperation as never),
    },
    capabilityRuntimeSession: {
      async begin(sessionInput: {
        readonly recheck: () => Promise<unknown>;
      }) {
        await sessionInput.recheck();
        return {
          lease: {
            id: "lease-calculix",
            projectId: "session",
            bindingIds: ["calculix-static-sensitivity"],
            materialKeys: [capabilityRuntimeMaterialKey(input.material)],
            launchGroups: [input.launchGroup],
            acquiredAt: AT,
            expiresAt: "2026-08-23T06:00:00.000Z",
          },
          releaseTerminal: () => Promise.resolve(),
          retainForRecovery: () => undefined,
        };
      },
    },
    experience: input.experience,
    lease: { withLease: (_projectId, _scope, operation) => operation() },
  });
}

async function seedProject(input: {
  readonly projectId: string;
  readonly runId: string;
  readonly snapshots: FileThreadSnapshotStore;
  readonly caseCaptures: FileCaptureStore<"sensitivity-study-case">;
}) {
  const template = validateSensitivityStudyCaseTemplate(
    JSON.parse(
      await Deno.readTextFile(
        "config/sensitivity-study-cases/dl04-size-z-sensitivity.json",
      ),
    ),
  );
  const studyCase = assembleSensitivityStudyCaseV3({
    ...template,
    id: `case-${input.projectId}`,
    project: { id: input.projectId, subjectId: `subject-${input.projectId}` },
  }, {
    artifactUri: `thread-artifact://${input.projectId}/admission-${input.projectId}`,
    sha256: ADMISSION_DIGEST,
  });
  const caseDigest = (await sha256Fingerprint(studyCase)).digest;
  const caseCapture = {
    schemaVersion: SENSITIVITY_STUDY_CASE_CAPTURE_SCHEMA,
    operation: { id: "analyze.seal-sensitivity-study", version: "1" },
    trustedRunId: `seal-${input.projectId}`,
    caseDigest,
    canonicalCaseText: deterministicJson(studyCase),
    studyCase,
    admissionArtifact: {
      id: `admission-${input.projectId}`,
      fingerprint: { algorithm: "sha256" as const, digest: ADMISSION_DIGEST },
    },
    sealedAt: AT,
  };
  const caseFingerprint = await sha256Fingerprint(caseCapture);
  await input.caseCaptures.save(
    caseFingerprint,
    deterministicJson(caseCapture),
  );
  const caseArtifact = {
    id: `case-${input.projectId}`,
    name: "Sealed sensitivity case",
    kind: "document" as const,
    version: caseDigest,
    fingerprint: caseFingerprint,
    uri: `casys://sensitivity-study-case-capture/sha256/${caseFingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "analyze.seal-sensitivity-study@1",
      runId: `seal-${input.projectId}`,
    },
    inputArtifactIds: [],
    freshness: fresh(),
  };
  const admissionArtifact = {
    id: `admission-${input.projectId}`,
    name: "Admission",
    kind: "document" as const,
    version: ADMISSION_DIGEST,
    fingerprint: { algorithm: "sha256" as const, digest: ADMISSION_DIGEST },
    uri: `casys://technical-compilation-admission-capture/sha256/${ADMISSION_DIGEST}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "compile.seal-admission@3",
      runId: `admit-${input.projectId}`,
    },
    inputArtifactIds: [],
    freshness: fresh(),
  };
  const basisSnapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: `snapshot-${input.projectId}`,
    revision: 1,
    generatedAt: AT,
    subject: {
      id: `subject-${input.projectId}`,
      name: input.projectId,
      kind: "system",
      version: "r1",
      modelArtifactId: "artifact.brief",
    },
    freshness: fresh(),
    changeSet: {
      id: `change-set-${input.projectId}`,
      name: "Case",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [{
        id: `change-case-${input.projectId}`,
        kind: "created",
        target: { kind: "artifact", id: caseArtifact.id },
        summary: "Sealed the sensitivity study case.",
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
          runId: `run.brief-${input.projectId}`,
        },
        inputArtifactIds: [],
        freshness: fresh(),
      },
      admissionArtifact,
      caseArtifact,
    ],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: `provenance.change.case-${input.projectId}`,
      relation: "changes",
      from: { kind: "change", id: `change-case-${input.projectId}` },
      to: { kind: "artifact", id: caseArtifact.id },
      rationale: "The applied change introduced the sealed case.",
    }],
    proposedActions: [],
  });
  await input.snapshots.save(basisSnapshot);
  const reviewBasis = {
    snapshotId: basisSnapshot.id,
    revision: basisSnapshot.revision,
    subjectId: basisSnapshot.subject.id,
  };
  const evidenceRef = {
    snapshotId: basisSnapshot.id,
    snapshotRevision: basisSnapshot.revision,
    kind: "artifact" as const,
    id: caseArtifact.id,
  };
  const operation = {
    id: "analyze.run-fea-sensitivity",
    version: "1",
    bindings: [{
      name: "studyCase",
      source: { kind: "thread-entity" as const, reference: evidenceRef },
    }],
  };
  const decisionFingerprint = await sha256Fingerprint({
    baseSnapshot: reviewBasis,
    inputEvidenceRefs: [evidenceRef],
    proposal: { summary: "Run the study", parameters: [] },
  });
  const runFingerprint = await sha256Fingerprint({
    workItemId: `work-${input.projectId}`,
    basis: { kind: "thread-snapshot", ...reviewBasis },
    operation,
    approvedDecisions: [{
      id: `decision-${input.projectId}`,
      inputFingerprint: decisionFingerprint,
    }],
  });
  const project = {
    schemaVersion: "4.0",
    id: `${input.projectId}:r1`,
    revision: 1,
    generatedAt: AT,
    project: {
      id: input.projectId,
      name: input.projectId,
      subjectId: `subject-${input.projectId}`,
      objective: { title: "Study", statement: "Measure derivatives." },
    },
    threadSnapshots: [reviewBasis],
    phases: [{
      id: "phase.simulate",
      name: "Simulate",
      order: 1,
      description: "Run sensitivity.",
      workItemIds: [`work-${input.projectId}`],
      requiredDecisionIds: [`decision-${input.projectId}`],
      evidenceRefs: [],
    }],
    workItems: [{
      id: `work-${input.projectId}`,
      activityId: `activity:work-${input.projectId}`,
      phaseId: "phase.simulate",
      title: "Run sensitivity",
      description: "Two-solve study.",
      kind: "simulate",
      operation,
      status: "in-progress",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [`decision-${input.projectId}`],
      blockerIds: [],
    }],
    agentRuns: [{
      id: input.runId,
      workItemId: `work-${input.projectId}`,
      status: "queued",
      summary: "Run sensitivity.",
      queuedAt: AT,
      basis: { kind: "thread-snapshot", ...reviewBasis },
      inputFingerprint: runFingerprint,
      evidenceRefs: [],
    }],
    decisions: [{
      id: `decision-${input.projectId}`,
      phaseId: "phase.simulate",
      title: "Approve run",
      question: "Run the sealed study?",
      status: "approved",
      requestedAt: AT,
      baseSnapshot: reviewBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [evidenceRef],
      approvalIds: [`approval-${input.projectId}`],
      proposal: {
        summary: "Run the study",
        parameters: [],
        proposedAt: AT,
        proposedBy: { id: AGENT.actorId, origin: "agent" },
      },
    }],
    approvals: [{
      id: `approval-${input.projectId}`,
      decisionId: `decision-${input.projectId}`,
      status: "approved",
      requestedAt: AT,
      decidedAt: AT,
      decidedBy: HUMAN.actorId,
      decidedByOrigin: "human",
      rationale: "Go.",
      baseSnapshot: reviewBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [evidenceRef],
    }],
    blockers: [],
    commandReceipts: [],
  } as unknown as MutableProject;
  return { project, basisSnapshot };
}

let cachedAdmission: ReopenedTechnicalCompilationAdmission | undefined;

async function makeAdmission(): Promise<ReopenedTechnicalCompilationAdmission> {
  if (cachedAdmission) return cachedAdmission;
  const sourceFingerprint = await sha256Fingerprint(SOURCE_TEXT);
  const closureFingerprint = {
    algorithm: "sha256" as const,
    digest: ADMISSION_DIGEST,
  };
  const sourceId = `technical-unit:${closureFingerprint.digest}`;
  const analysis = {
    schemaVersion: "source-analysis/1.0" as const,
    source: {
      id: sourceId,
      role: "cad-script" as const,
      language: "python" as const,
      fingerprint: sourceFingerprint,
    },
    analyzer: { id: "python-cad-source-frontend", version: "1.0.0" },
    policy: {
      profile: "build123d-closed-subset-v1",
      status: "passed" as const,
      findings: [],
    },
    symbols: [{
      id: "symbol.size-z",
      kind: "parameter" as const,
      name: "size_z",
      span: { start: { line: 1, column: 0 }, end: { line: 1, column: 6 } },
    }],
    dependencies: [],
    unresolvedConstructs: [],
  };
  const source = {
    sourceText: SOURCE_TEXT,
    analysis,
    analysisFingerprint: await sha256Fingerprint(analysis),
    effectiveUnit: {
      kind: "authored-root" as const,
      closureKind: "root-only" as const,
      unitId: sourceId,
      closureFingerprint,
      scriptFingerprint: sourceFingerprint,
    },
  };
  const binding = {
    id: "binding.size-z",
    sourceId,
    sourceSymbolId: "symbol.size-z",
    sysmlElementId: "attribute.size-z",
    sysmlElementKind: "AttributeUsage",
    relation: "parameterizes" as const,
  };
  const profile = {
    id: "build123d-closed-subset-v1",
    version: PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION,
    target: "build123d-source" as const,
    sourceRole: "cad-script" as const,
    language: "python" as const,
    analyzer: analysis.analyzer,
    analysisPolicyProfile: analysis.policy.profile,
    requiredBindingSymbolKinds: ["parameter" as const],
  };
  cachedAdmission = {
    document: {
      schemaVersion: "technical-compilation/2.0",
      basis: {} as never,
      basisFingerprint: closureFingerprint,
      inputManifest: {
        sources: [source],
        bindings: [binding],
        profileRequests: [],
      },
      status: "ready-for-review",
      diagnostics: [],
      projections: [{
        target: "build123d-source",
        profile,
        profileFingerprint: closureFingerprint,
        status: "ready-for-review",
        diagnostics: [],
        sources: [{ ...source, bindings: [binding] }],
      }],
    },
  } as unknown as ReopenedTechnicalCompilationAdmission;
  return cachedAdmission;
}

function executionProfile(): Build123dExecutionProfile {
  return {
    executionProfile: { id: "build123d-closed-subset-v1", version: "1.0.0" },
    compilationProfileFingerprint: {
      algorithm: "sha256",
      digest: ADMISSION_DIGEST,
    },
    isolationPolicy: {
      id: "isolation.build123d-closed-v1",
      version: "1.0.0",
      fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
    },
    runtimeBackend: {
      id: "microsandbox-local",
      version: "0.6.8",
      imageReference:
        `docker.io/casys/build123d-microsandbox-worker@sha256:${BUILD123D_IMAGE_DIGEST}`,
      imageDigest: BUILD123D_IMAGE_FINGERPRINT,
    },
    runtime: {
      isolationClass: "microvm",
      imageDigest: BUILD123D_IMAGE_FINGERPRINT,
    },
    outputValidator: { id: "build123d-step-validator", version: "1.0.0" },
    outputManifest: [{
      role: "geometry",
      basename: "geometry.step",
      mediaType: "model/step",
      format: "step-ap214",
    }],
    maximumSourceBytes: 1_000_000,
    profileFingerprint: BUILD123D_PROFILE_FINGERPRINT,
  } as unknown as Build123dExecutionProfile;
}

function sensitivityRuntimeOperation(
  launchGroup: ReturnType<typeof capabilityRuntimeLaunchGroupReference>,
  material: {
    readonly unitId: string;
    readonly materialId: string;
    readonly imageDigest: string;
  },
) {
  const build123dMaterial = {
    unitId: BUILD123D_ISOLATED_WORKER_UNIT_ID,
    materialId: BUILD123D_ISOLATED_WORKER_MATERIAL_ID,
    imageDigest: BUILD123D_IMAGE_DIGEST,
  };
  return {
    schemaVersion: "resolved-capability-runtime-operation/2.0" as const,
    projectId: "source-project",
    operation: { id: "analyze.run-fea-sensitivity", version: "1" },
    authorizationFingerprint: {
      algorithm: "sha256" as const,
      digest: "1".repeat(64),
    },
    demandFingerprint: { algorithm: "sha256" as const, digest: "2".repeat(64) },
    registryFingerprint: {
      algorithm: "sha256" as const,
      digest: "3".repeat(64),
    },
    bindings: [{
      capability: {
        id: "geometry.execute-admitted-source",
        version: "1",
        use: "preparation" as const,
        minimumQualification: "qualified" as const,
      },
      binding: {
        id: "build123d-execute-admitted-source-preparation",
        version: "1.0.0",
      },
      effectiveQualification: "qualified" as const,
      adapter: {
        id: "build123d-isolated-execution-adapter",
        version: "1.0.0",
        source: "fixture",
      },
      profile: null,
      materials: [build123dMaterial],
      runtimeModes: [{
        material: build123dMaterial,
        targetPlatform: "linux/arm64" as const,
        mode: "native" as const,
        qualificationAttestationFingerprint: null,
      }],
      hostLifecycles: [{
        material: build123dMaterial,
        kind: "ephemeral-microsandbox" as const,
        launchGroup: null,
      }],
    }, {
      capability: {
        id: "mechanics.observe-static-structural-sensitivity",
        version: "1",
        use: "execution" as const,
        minimumQualification: "qualified" as const,
      },
      binding: { id: "calculix-static-sensitivity", version: "1" },
      effectiveQualification: "qualified" as const,
      adapter: {
        id: "casys.mcp-calculix",
        version: "0.8.2",
        source: "fixture",
      },
      profile: null,
      materials: [material],
      runtimeModes: [{
        material,
        targetPlatform: "linux/arm64" as const,
        mode: "native" as const,
        qualificationAttestationFingerprint: null,
      }],
      hostLifecycles: [{
        material,
        kind: "persistent-compose" as const,
        launchGroup,
      }],
    }],
  };
}

function resetRunToRunning(project: MutableProject) {
  const run = project.agentRuns[0] as unknown as {
    status: string;
    startedAt?: string;
    claimedBy?: { id: string; origin: "agent" };
    basis?: {
      snapshotId: string;
      revision: number;
      subjectId: string;
    };
  };
  run.status = "running";
  run.startedAt = AT;
  run.claimedBy = { id: AGENT.actorId, origin: "agent" };
  if (run.basis) {
    (project as { threadSnapshots: unknown }).threadSnapshots = [run.basis];
  }
}

function fresh() {
  return {
    status: "fresh" as const,
    changedAt: AT,
    invalidatedByChangeIds: [],
  };
}

type MutableProject = EngineeringProjectSnapshot & {
  revision: number;
  commandReceipts: EngineeringProjectCommandReceipt[];
};
type MutableRun = {
  -readonly [K in keyof MutableProject["agentRuns"][number]]:
    MutableProject["agentRuns"][number][K];
};

class ProjectMapCommands {
  constructor(private readonly projects: Map<string, MutableProject>) {}
  claimRun(origin: EngineeringProjectCommandOrigin, command: RunCommand) {
    const project = this.projects.get(command.projectId)!;
    const run = project.agentRuns[0] as MutableRun;
    if (run.status === "queued") {
      run.status = "running";
      run.startedAt = AT;
      run.claimedAt = AT;
      run.claimedBy = { id: origin.actorId, origin: origin.kind };
      run.summary = command.summary;
      project.revision += 1;
    }
    return Promise.resolve(project);
  }
  publishRun(_origin: typeof AGENT, command: RunCommand) {
    const project = this.projects.get(command.projectId)!;
    (project.agentRuns[0] as MutableRun).status = "publishing";
    project.revision += 1;
    return Promise.resolve(project);
  }
  completeRun(_origin: typeof AGENT, command: CompleteRunCommand) {
    const project = this.projects.get(command.projectId)!;
    const run = project.agentRuns[0] as MutableRun;
    run.status = "completed";
    run.resultSnapshot = command.resultSnapshot;
    run.evidenceRefs = [...command.evidenceRefs];
    if (
      !project.threadSnapshots.some((item) =>
        item.snapshotId === command.resultSnapshot.snapshotId
      )
    ) {
      (project as { threadSnapshots: unknown }).threadSnapshots = [
        ...project.threadSnapshots,
        command.resultSnapshot,
      ];
    }
    project.revision += 1;
    return Promise.resolve(project);
  }
  failRun() {
    return Promise.reject(new Error("unused"));
  }
}

class FakeRunner implements IsolatedCodeRunner {
  readonly sources: string[] = [];
  async run(request: {
    readonly runId: string;
    readonly source: { readonly bytes: Uint8Array };
  }) {
    const text = new TextDecoder().decode(request.source.bytes);
    this.sources.push(text);
    const step = new TextEncoder().encode(
      text.includes("= 51") ? "STEP-STEPPED" : "STEP-BASE",
    );
    const sha256 = await fingerprintResourceBytes(step);
    return {
      outputs: [{
        role: "geometry",
        basename: "geometry.step",
        mediaType: "model/step",
        format: "step-ap214",
        byteCount: step.byteLength,
        sha256,
        casUri: `casys://isolated-output/sha256/${sha256}`,
        bytes: immutableBytes(step),
      }],
    } as unknown as IsolatedCodeExecutionReceipt;
  }
}

class FakeStager {
  readonly #byDigest = new Map<string, Uint8Array>();
  stage(input: {
    readonly bytes: Uint8Array;
    readonly fingerprint: ContentFingerprint;
    readonly byteCount: number;
  }) {
    this.#byDigest.set(input.fingerprint.digest, input.bytes);
    return Promise.resolve({
      stagedAsset: { location: `/inputs/fea-${input.fingerprint.digest}.step` },
    });
  }
  read(input: {
    readonly fingerprint: ContentFingerprint;
    readonly byteCount: number;
  }) {
    const bytes = this.#byDigest.get(input.fingerprint.digest);
    if (!bytes || bytes.byteLength !== input.byteCount) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(bytes);
  }
}

class FakeSolver {
  calls = 0;
  readonly #readbacks = new Map<string, unknown>();
  readonly #captures = new Map<string, unknown>();

  resolve(input: {
    readonly inputArtifact: {
      readonly fingerprint: ContentFingerprint;
      readonly byteCount: number;
    };
    readonly execution: { readonly phase: "base" | "stepped" };
  }) {
    return Promise.resolve({
      requestId: `request-${input.execution.phase}-${
        input.inputArtifact.fingerprint.digest.slice(0, 16)
      }`,
      phase: input.execution.phase,
      inputArtifact: input.inputArtifact,
      exactRequest: {},
    });
  }

  dispatch(
    plan: { readonly requestId: string; readonly phase: "base" | "stepped" },
  ) {
    this.calls += 1;
    return Promise.resolve({
      requestId: plan.requestId,
      runId: `r-11111111-1111-1111-1111-${
        plan.phase === "base" ? "111111111111" : "222222222222"
      }`,
      requestSha256: plan.phase === "base" ? "6".repeat(64) : "7".repeat(64),
    });
  }

  async readback(
    plan: {
      readonly requestId: string;
      readonly phase: "base" | "stepped";
      readonly inputArtifact: {
        readonly fingerprint: ContentFingerprint;
        readonly byteCount: number;
      };
    },
    expected?: { readonly runId: string; readonly requestSha256: string },
  ) {
    const runId = expected?.runId ??
      `r-11111111-1111-1111-1111-${
        plan.phase === "base" ? "111111111111" : "222222222222"
      }`;
    const requestSha256 = expected?.requestSha256 ??
      (plan.phase === "base" ? "6" : "7").repeat(64);
    const body = {
      schemaVersion: "mcp-calculix-sensitivity-readback/1.0",
      phase: plan.phase,
      stepSha256: plan.inputArtifact.fingerprint.digest,
      stepBytes: plan.inputArtifact.byteCount,
      requestId: plan.requestId,
      runId,
      requestSha256,
      resources: [],
    };
    const readback = {
      ...body,
      canonicalText: deterministicJson(body),
      fingerprint: await sha256Fingerprint(body),
    };
    this.#readbacks.set(readback.canonicalText, readback);
    return readback;
  }

  reopenReadback(text: string) {
    const readback = this.#readbacks.get(text);
    if (!readback) {
      return Promise.reject(new Error("fixture readback is absent"));
    }
    return Promise.resolve(readback);
  }

  async capture(readback: {
    readonly phase: "base" | "stepped";
    readonly stepSha256: string;
    readonly stepBytes: number;
    readonly canonicalText: string;
    readonly fingerprint: ContentFingerprint;
  }) {
    const stepped = readback.phase === "stepped";
    const displacement = stepped ? 1.5 : 0.5;
    const stress = stepped ? 8 : 10;
    const result = {
      inputAttestation: {
        fingerprint: {
          algorithm: "sha256" as const,
          digest: readback.stepSha256,
        },
        byteCount: readback.stepBytes,
      },
      boundaryConditions: { supports: [], loads: [] },
      mesh: { nodeCount: 4, elementCount: 1 },
      observations: {
        maximumDisplacement: {
          magnitude: { value: displacement, unit: "mm" as const },
          vector: { value: [0, 0, displacement] as const, unit: "mm" as const },
        },
        maximumVonMisesStress: {
          magnitude: { value: stress, unit: "MPa" as const },
        },
      },
    };
    const providerCapture = {
      manifestFingerprint: {
        algorithm: "sha256" as const,
        digest: "8".repeat(64),
      },
      manifestUri: "casys://fixture-calculix-manifest/sha256/" + "8".repeat(64),
      artifactSequenceFingerprint: {
        algorithm: "sha256" as const,
        digest: "9".repeat(64),
      },
      requestBinding: {
        requestResourceFingerprint: {
          algorithm: "sha256" as const,
          digest: "a".repeat(64),
        },
        loweredRequestFingerprint: {
          algorithm: "sha256" as const,
          digest: "b".repeat(64),
        },
        executionIdentityFingerprint: {
          algorithm: "sha256" as const,
          digest: "c".repeat(64),
        },
      },
    };
    const body = {
      schemaVersion: "mcp-calculix-sensitivity-capture/1.0",
      readback: JSON.parse(readback.canonicalText),
      providerCapture,
      result,
    };
    const capture = {
      result,
      readback: { ...readback, resources: [] },
      providerCapture,
      canonicalText: deterministicJson(body),
      fingerprint: await sha256Fingerprint(body),
    };
    this.#captures.set(capture.canonicalText, capture);
    return capture;
  }

  reopenCapture(text: string) {
    const capture = this.#captures.get(text);
    if (!capture) return Promise.reject(new Error("fixture capture is absent"));
    return Promise.resolve(capture);
  }
}
