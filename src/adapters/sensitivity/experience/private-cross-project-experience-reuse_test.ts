import { assertEquals, assertRejects } from "@std/assert";
import type { Build123dExecutionProfile } from "../../../application/ports/out/cad/isolated/build123d-execution-profile-catalog.ts";
import type { ReopenedTechnicalCompilationAdmission } from "../../../application/ports/out/compile/admission/technical-compilation-admission-reader.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import {
  PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION,
} from "../../../domain/compile/admission/technical-compilation.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  createSensitivityExperienceOriginBinding,
  deriveSensitivityExperienceRecord,
  sensitivityExperienceExecutionPlanDigest,
} from "../../../domain/sensitivity/experience/sensitivity-experience.ts";
import {
  assembleSensitivityStudyCaseV2,
  validateSensitivityStudyCaseTemplate,
} from "../../../domain/sensitivity/study/sensitivity-study-template.ts";
import { computeSensitivities } from "../../../domain/sensitivity/study/sensitivity-study.ts";
import type { SensitivityStudyCaseV2 } from "../../../domain/sensitivity/study/sensitivity-study-v2.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import { SENSITIVITY_STUDY_CASE_CAPTURE_SCHEMA } from "../study/sensitivity-study-case-capture.ts";
import type { FeaSensitivityAttempt } from "../live-fea/file-fea-sensitivity-attempt-store.ts";
import { FileSensitivityExperienceRepository } from "./file-sensitivity-experience-repository.ts";
import { SensitivityExperienceCoordinator } from "./sensitivity-experience-coordinator.ts";

const AT = "2026-08-23T00:00:00.000Z";
const SOURCE = "size_z = 50\nresult = Box(1, 1, size_z)\n";
const ADMISSION_DIGEST = "a".repeat(64);
const CAD_RUNTIME_DIGEST = "b".repeat(64);
const SOLVER_RUNTIME_DIGEST = "c".repeat(64);

Deno.test("two local projects reuse one exact healthy sensitivity result", async () => {
  const harness = await createHarness();
  try {
    const source = await harness.addSource("source-project", 0);
    const target = await harness.target("target-project");
    const lookup = await harness.coordinator.review({
      projectId: "target-project",
      basis: harness.targetBasis,
      basisSnapshot: harness.targetSnapshot,
      target,
      reviewedAt: AT,
    });
    assertEquals(lookup.review.outcome, "exact");
    assertEquals(lookup.review.freshExecutionRequired, false);
    assertEquals(lookup.selected?.record, source.record);
    assertEquals(lookup.selected?.origin.source.projectId, "source-project");
  } finally {
    await harness.dispose();
  }
});

Deno.test("scientific and method misses remain fresh-execution misses", async () => {
  const harness = await createHarness();
  try {
    await harness.addSource("source-project", 0);
    const target = await harness.target("target-project");
    const changedScientific = {
      ...target,
      scientificKey: { algorithm: "sha256" as const, digest: "d".repeat(64) },
    };
    const scientificMiss = await harness.coordinator.review({
      projectId: "target-project",
      basis: harness.targetBasis,
      basisSnapshot: harness.targetSnapshot,
      target: changedScientific,
      reviewedAt: AT,
    });
    assertEquals(scientificMiss.review.outcome, "incompatible");
    assertEquals(scientificMiss.review.reasons, ["scientific-key-miss"]);

    const incompatibleCoordinator = harness.makeCoordinator("e".repeat(64));
    const changedMethod = await incompatibleCoordinator.compileTarget({
      studyCase: await makeStudyCase("target-project"),
      admission: harness.admission,
      build123dProfile: buildProfile(),
    });
    const methodMiss = await incompatibleCoordinator.review({
      projectId: "target-project",
      basis: harness.targetBasis,
      basisSnapshot: harness.targetSnapshot,
      target: changedMethod,
      reviewedAt: AT,
    });
    assertEquals(methodMiss.review.outcome, "incompatible");
    assertEquals(methodMiss.review.freshExecutionRequired, true);
  } finally {
    await harness.dispose();
  }
});

Deno.test("origin health and target basis are revalidated on every review", async () => {
  const harness = await createHarness();
  try {
    const source = await harness.addSource("source-project", 0);
    const target = await harness.target("target-project");
    const exact = await harness.coordinator.review({
      projectId: "target-project",
      basis: harness.targetBasis,
      basisSnapshot: harness.targetSnapshot,
      target,
      reviewedAt: AT,
    });
    await assertRejects(
      () =>
        harness.coordinator.reopenReview({
          fingerprint: exact.reviewFingerprint,
          projectId: "target-project",
          basis: harness.targetBasis,
          basisSnapshot: {
            ...harness.targetSnapshot,
            generatedAt: "2026-08-24T00:00:00.000Z",
          },
          target,
        }),
      Error,
      "target basis is stale",
    );

    harness.studyCaptures.delete(source.studyArtifact.fingerprint.digest);
    const unhealthy = await harness.coordinator.review({
      projectId: "target-project",
      basis: harness.targetBasis,
      basisSnapshot: harness.targetSnapshot,
      target,
      reviewedAt: AT,
    });
    assertEquals(unhealthy.review.outcome, "unavailable");
    assertEquals(unhealthy.review.reasons, ["source-unhealthy"]);

    await assertRejects(
      () =>
        harness.coordinator.review({
          projectId: "target-project",
          basis: { ...harness.targetBasis, revision: 99 },
          basisSnapshot: harness.targetSnapshot,
          target,
          reviewedAt: AT,
        }),
      Error,
      "basis",
    );
  } finally {
    await harness.dispose();
  }
});

Deno.test("an intact current branch that does not descend from the source is unavailable", async () => {
  const harness = await createHarness();
  try {
    const source = await harness.addSource("source-project", 0);
    const distinctBranch = validateThreadSnapshot({
      ...source.snapshot,
      id: "snapshot-source-project-distinct-branch",
    });
    harness.snapshots.set(distinctBranch.id, distinctBranch);
    harness.projects.set("source-project", {
      threadSnapshots: [{
        snapshotId: distinctBranch.id,
        revision: distinctBranch.revision,
        subjectId: distinctBranch.subject.id,
      }],
    });

    const target = await harness.target("target-project");
    const lookup = await harness.coordinator.review({
      projectId: "target-project",
      basis: harness.targetBasis,
      basisSnapshot: harness.targetSnapshot,
      target,
      reviewedAt: AT,
    });
    assertEquals(lookup.review.outcome, "unavailable");
    assertEquals(lookup.review.reasons, ["source-unhealthy"]);
  } finally {
    await harness.dispose();
  }
});

Deno.test("same key with divergent healthy results is unresolved", async () => {
  const harness = await createHarness();
  try {
    await harness.addSource("source-project-a", 0);
    await harness.addSource("source-project-b", 7);
    const target = await harness.target("target-project");
    const lookup = await harness.coordinator.review({
      projectId: "target-project",
      basis: harness.targetBasis,
      basisSnapshot: harness.targetSnapshot,
      target,
      reviewedAt: AT,
    });
    assertEquals(lookup.review.outcome, "unresolved");
    assertEquals(lookup.review.reasons, ["divergent-results"]);
    assertEquals(lookup.review.freshExecutionRequired, true);
  } finally {
    await harness.dispose();
  }
});

Deno.test("index coalesces identical records and rebuilds after invalidation", async () => {
  const harness = await createHarness();
  try {
    const first = await harness.addSource("source-project-a", 0);
    const second = await harness.addSource("source-project-b", 0);
    const indexed = await harness.repository.lookup(first.record.scientificKey);
    assertEquals(indexed?.records.length, 1);
    assertEquals(indexed?.records[0]?.originBindingFingerprints.length, 2);

    await harness.repository.invalidateOrigin({
      recordFingerprint: second.recordFingerprint,
      originBindingFingerprint: second.originBindingFingerprint,
      reason: "owner-withdrawn",
      invalidatedAt: AT,
    });
    const rebuilt = await harness.repository.rebuild();
    const firstIndexBytes = await Deno.readTextFile(harness.repository.indexPath);
    assertEquals(rebuilt[0]?.records[0]?.originBindingFingerprints.length, 1);
    await harness.repository.rebuild();
    assertEquals(
      await Deno.readTextFile(harness.repository.indexPath),
      firstIndexBytes,
    );
  } finally {
    await harness.dispose();
  }
});

Deno.test("index rebuild fails closed on a symlinked private journal", async () => {
  const harness = await createHarness();
  const outside = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "experience-outside-" }),
  );
  try {
    await harness.addSource("source-project", 0);
    await Deno.remove(`${harness.root}/admissions`, { recursive: true });
    await Deno.symlink(outside, `${harness.root}/admissions`);
    await assertRejects(
      () => harness.repository.rebuild(),
      Error,
      "confined directory",
    );
  } finally {
    await harness.dispose();
    await Deno.remove(outside, { recursive: true });
  }
});

async function createHarness() {
  const root = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "sensitivity-experience-" }),
  );
  const repository = new FileSensitivityExperienceRepository(root);
  const snapshots = new Map<string, ThreadSnapshot>();
  const projects = new Map<string, {
    threadSnapshots: readonly {
      snapshotId: string;
      revision: number;
      subjectId: string;
    }[];
  }>();
  const caseCaptures = new Map<string, string>();
  const studyCaptures = new Map<string, string>();
  const attempts = new Map<string, FeaSensitivityAttempt>();
  const admission = await makeAdmission();
  const targetSnapshot = makeSnapshot("target-snapshot", "target-subject", []);
  const targetBasis = {
    kind: "thread-snapshot" as const,
    snapshotId: targetSnapshot.id,
    revision: targetSnapshot.revision,
    subjectId: targetSnapshot.subject.id,
  };
  snapshots.set(targetSnapshot.id, targetSnapshot);
  projects.set("target-project", { threadSnapshots: [targetBasis] });
  const makeCoordinator = (solverDigest = SOLVER_RUNTIME_DIGEST) =>
    new SensitivityExperienceCoordinator({
      repository,
      projects: { get: (id) => Promise.resolve(projects.get(id) as never) },
      snapshots: { get: (id) => Promise.resolve(snapshots.get(id)) },
      caseCaptures: {
        read: (fingerprint) => Promise.resolve(caseCaptures.get(fingerprint.digest)),
      },
      studyCaptures: {
        read: (fingerprint) => Promise.resolve(studyCaptures.get(fingerprint.digest)),
      },
      admissions: { read: () => Promise.resolve(admission) },
      executionAttempts: {
        read: (projectId, runId) =>
          Promise.resolve(attempts.get(`${projectId}:${runId}`)),
      },
      solverRuntime: solverRuntime(solverDigest),
      solverRuntimeAuthority: { attest: () => Promise.resolve(true) },
    });
  const coordinator = makeCoordinator();

  return {
    root,
    repository,
    coordinator,
    makeCoordinator,
    admission,
    targetSnapshot,
    targetBasis,
    snapshots,
    projects,
    studyCaptures,
    target: async (projectId: string) =>
      await coordinator.compileTarget({
        studyCase: await makeStudyCase(projectId),
        admission,
        build123dProfile: buildProfile(),
      }),
    addSource: async (projectId: string, resultOffset: number) => {
      const studyCase = await makeStudyCase(projectId);
      const target = await coordinator.compileTarget({
        studyCase,
        admission,
        build123dProfile: buildProfile(),
      });
      const capture = await makeStudyCapture(studyCase, projectId, resultOffset);
      const record = await deriveSensitivityExperienceRecord(target, capture);
      const recordFingerprint = await sha256Fingerprint(record);
      const caseCapture = {
        schemaVersion: SENSITIVITY_STUDY_CASE_CAPTURE_SCHEMA,
        operation: { id: "analyze.seal-sensitivity-study", version: "1" },
        trustedRunId: `seal-${projectId}`,
        caseDigest: (await sha256Fingerprint(studyCase)).digest,
        canonicalCaseText: deterministicJson(studyCase),
        studyCase,
        admissionArtifact: {
          id: `admission-${projectId}`,
          fingerprint: fingerprint(ADMISSION_DIGEST),
        },
        sealedAt: AT,
      };
      const caseFingerprint = await sha256Fingerprint(caseCapture);
      const studyFingerprint = await sha256Fingerprint(capture);
      caseCaptures.set(caseFingerprint.digest, deterministicJson(caseCapture));
      studyCaptures.set(studyFingerprint.digest, deterministicJson(capture));
      const runId = `run-${projectId}`;
      const admissionArtifact = artifact({
        id: `admission-${projectId}`,
        fingerprint: fingerprint(ADMISSION_DIGEST),
        tool: "compile.seal-admission@3",
        runId: `admit-${projectId}`,
      });
      const caseArtifact = artifact({
        id: `case-${projectId}`,
        fingerprint: caseFingerprint,
        tool: "analyze.seal-sensitivity-study@1",
        runId: `seal-${projectId}`,
        inputArtifactIds: [admissionArtifact.id],
      });
      const studyArtifact = artifact({
        id: `study-${projectId}`,
        fingerprint: studyFingerprint,
        tool: "analyze.run-fea-sensitivity@1",
        runId,
        inputArtifactIds: [caseArtifact.id],
      });
      const snapshot = makeSnapshot(
        `snapshot-${projectId}`,
        `subject-${projectId}`,
        [admissionArtifact, caseArtifact, studyArtifact],
      );
      snapshots.set(snapshot.id, snapshot);
      const basis = {
        kind: "thread-snapshot" as const,
        snapshotId: snapshot.id,
        revision: snapshot.revision,
        subjectId: snapshot.subject.id,
      };
      const planDigest = await sensitivityExperienceExecutionPlanDigest({
        caseDigest: caseCapture.caseDigest,
        cadSource: studyCase.cadSource,
        step: studyCase.step,
        scientificKey: target.scientificKey,
      });
      const solverEnvelope = (phase: "base" | "stepped") => ({
        schemaVersion: "sensitivity-solver-result/1.0",
        phase,
        stepSha256: capture.cad[phase].stepSha256,
        stepBytes: capture.cad[phase].stepBytes,
        measurements: capture.measurements[phase],
      });
      const baseEnvelope = solverEnvelope("base");
      const steppedEnvelope = solverEnvelope("stepped");
      attempts.set(`${projectId}:${runId}`, {
        schemaVersion: "fea-sensitivity-attempt/1.0",
        projectId,
        runId,
        planDigest,
        cad: {
          base: {
            status: "published",
            dispatchedAt: AT,
            ...capture.cad.base,
          },
          stepped: {
            status: "published",
            dispatchedAt: AT,
            ...capture.cad.stepped,
          },
        },
        solves: {
          base: {
            status: "solver-recorded",
            dispatchedAt: AT,
            stepSha256: capture.cad.base.stepSha256,
            captureFp: (await sha256Fingerprint(baseEnvelope)).digest,
            canonicalSolverCaptureText: deterministicJson(baseEnvelope),
          },
          stepped: {
            status: "solver-recorded",
            dispatchedAt: AT,
            stepSha256: capture.cad.stepped.stepSha256,
            captureFp: (await sha256Fingerprint(steppedEnvelope)).digest,
            canonicalSolverCaptureText: deterministicJson(steppedEnvelope),
          },
        },
        status: "completed",
        snapshot: {
          snapshotId: snapshot.id,
          revision: snapshot.revision,
          subjectId: snapshot.subject.id,
        },
      } as FeaSensitivityAttempt);
      projects.set(projectId, { threadSnapshots: [basis] });
      const origin = await createSensitivityExperienceOriginBinding({
        recordFingerprint,
        projectId,
        basis,
        studyArtifact,
        caseArtifact,
        admissionArtifact,
        trustedRunId: runId,
        executionPlanDigest: planDigest,
        admittedAt: AT,
      });
      const saved = await repository.saveExperience(record, origin);
      return { ...saved, studyArtifact, snapshot };
    },
    dispose: () => Deno.remove(root, { recursive: true }),
  };
}

async function makeStudyCase(projectId: string): Promise<SensitivityStudyCaseV2> {
  const template = validateSensitivityStudyCaseTemplate(
    JSON.parse(
      await Deno.readTextFile(
        "config/sensitivity-study-cases/dl04-size-z-sensitivity.json",
      ),
    ),
  );
  return assembleSensitivityStudyCaseV2({
    ...template,
    id: `case-${projectId}`,
    project: { id: projectId, subjectId: `subject-${projectId}` },
  }, {
    artifactUri: `thread-artifact://${projectId}/admission-${projectId}`,
    sha256: ADMISSION_DIGEST,
  });
}

async function makeAdmission(): Promise<ReopenedTechnicalCompilationAdmission> {
  const sourceFingerprint = await sha256Fingerprint(SOURCE);
  const closureFingerprint = fingerprint(ADMISSION_DIGEST);
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
    sourceText: SOURCE,
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
  return {
    document: {
      schemaVersion: "technical-compilation/2.0",
      basis: {} as never,
      basisFingerprint: fingerprint(ADMISSION_DIGEST),
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
        profileFingerprint: fingerprint(ADMISSION_DIGEST),
        status: "ready-for-review",
        diagnostics: [],
        sources: [{ ...source, bindings: [binding] }],
      }],
    },
  } as unknown as ReopenedTechnicalCompilationAdmission;
}

function buildProfile(): Build123dExecutionProfile {
  return {
    executionProfile: { id: "build123d-closed-subset-v1", version: "1.0.0" },
    compilationProfileFingerprint: fingerprint(ADMISSION_DIGEST),
    runtimeBackend: { id: "microsandbox-local", version: "1.0.0" },
    runtime: {
      isolationClass: "microvm",
      imageDigest: fingerprint(CAD_RUNTIME_DIGEST),
    },
    outputValidator: { id: "build123d-step-validator", version: "1.0.0" },
    outputManifest: [{ role: "geometry", format: "step-ap214" }],
    profileFingerprint: fingerprint(ADMISSION_DIGEST),
  } as unknown as Build123dExecutionProfile;
}

function solverRuntime(digest: string) {
  return {
    imageReference: `ghcr.io/casys/calculix@sha256:${digest}`,
    imageDigest: fingerprint(digest),
  };
}

async function makeStudyCapture(
  studyCase: SensitivityStudyCaseV2,
  projectId: string,
  offset: number,
) {
  const base = [
    { metric: "assembly_max_displacement", value: 2 + offset, unit: "mm" },
    { metric: "assembly_max_von_mises", value: 10 + offset, unit: "MPa" },
  ];
  const stepped = [
    { metric: "assembly_max_displacement", value: 3 + offset, unit: "mm" },
    { metric: "assembly_max_von_mises", value: 12 + offset, unit: "MPa" },
  ];
  return {
    schemaVersion: "sensitivity-study-capture/1.0" as const,
    operation: { id: "analyze.run-fea-sensitivity" as const, version: "1" as const },
    trustedRunId: `run-${projectId}`,
    caseDigest: (await sha256Fingerprint(studyCase)).digest,
    studyCase,
    cad: {
      base: {
        executionRunId: `run-${projectId}:cad-base`,
        sourceSha256: ADMISSION_DIGEST,
        stepSha256: "d".repeat(64),
        stepBytes: 10,
      },
      stepped: {
        executionRunId: `run-${projectId}:cad-stepped`,
        sourceSha256: ADMISSION_DIGEST,
        stepSha256: "e".repeat(64),
        stepBytes: 11,
      },
    },
    measurements: { base, stepped },
    derivatives: computeSensitivities(
      studyCase,
      new Map(base.map((item) => [item.metric, item])),
      new Map(stepped.map((item) => [item.metric, item])),
    ),
    capturedAt: AT,
  };
}

function makeSnapshot(
  id: string,
  subjectId: string,
  artifacts: readonly ThreadArtifact[],
): ThreadSnapshot {
  const snapshotArtifacts = artifacts.length > 0 ? artifacts : [artifact({
    id: `model-${id}`,
    fingerprint: fingerprint("f".repeat(64)),
    tool: "baseline.from-approved-brief@1",
    runId: `baseline-${id}`,
  })];
  const consumptions = snapshotArtifacts.flatMap((consumerArtifact) =>
    consumerArtifact.inputArtifactIds.map((artifactId) => {
      const consumed = snapshotArtifacts.find((item) => item.id === artifactId)!;
      return {
        id: `consume-${artifactId}-by-${consumerArtifact.id}`,
        artifactId,
        consumer: consumerArtifact.producer,
        observedFingerprint: consumed.fingerprint,
        verifiedAt: AT,
        status: "verified" as const,
      };
    })
  );
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id,
    revision: 1,
    generatedAt: AT,
    subject: {
      id: subjectId,
      name: subjectId,
      kind: "system",
      version: "r1",
      modelArtifactId: snapshotArtifacts[0]!.id,
    },
    freshness: fresh(),
    changeSet: {
      id: `change-set-${id}`,
      name: "Experience fixture",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: snapshotArtifacts.map((item) => ({
        id: `change-${item.id}`,
        kind: "created",
        target: { kind: "artifact", id: item.id },
        summary: "Fixture artifact.",
        afterFingerprint: item.fingerprint,
      })),
    },
    artifacts: snapshotArtifacts,
    consumptions,
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [
      ...snapshotArtifacts.map((item) => ({
        id: `provenance-${item.id}`,
        relation: "changes" as const,
        from: { kind: "change" as const, id: `change-${item.id}` },
        to: { kind: "artifact" as const, id: item.id },
        rationale: "The fixture change introduced the artifact.",
      })),
      ...snapshotArtifacts.flatMap((consumerArtifact) =>
        consumerArtifact.inputArtifactIds.flatMap((artifactId) => [{
          id: `derived-${consumerArtifact.id}-from-${artifactId}`,
          relation: "derived_from" as const,
          from: { kind: "artifact" as const, id: consumerArtifact.id },
          to: { kind: "artifact" as const, id: artifactId },
          rationale: "The fixture artifact derives from its consumed input.",
        }, {
          id: `uses-${artifactId}-by-${consumerArtifact.id}`,
          relation: "uses" as const,
          from: {
            kind: "consumption" as const,
            id: `consume-${artifactId}-by-${consumerArtifact.id}`,
          },
          to: { kind: "artifact" as const, id: artifactId },
          rationale: "The fixture producer verified its exact input.",
        }])
      ),
    ],
    proposedActions: [],
  });
}

function artifact(input: {
  readonly id: string;
  readonly fingerprint: ContentFingerprint;
  readonly tool: string;
  readonly runId: string;
  readonly inputArtifactIds?: readonly string[];
}): ThreadArtifact {
  return {
    id: input.id,
    name: input.id,
    kind: "document",
    version: input.fingerprint.digest,
    fingerprint: input.fingerprint,
    uri: `casys://fixture/sha256/${input.fingerprint.digest}`,
    mediaType: "application/json",
    producer: { serverId: "digital-thread", tool: input.tool, runId: input.runId },
    inputArtifactIds: input.inputArtifactIds ?? [],
    freshness: fresh(),
  };
}

function fingerprint(digest: string): ContentFingerprint {
  return { algorithm: "sha256", digest };
}

function fresh() {
  return { status: "fresh" as const, changedAt: AT, invalidatedByChangeIds: [] };
}
