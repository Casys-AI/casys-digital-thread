import { assertEquals, assertRejects } from "@std/assert";
import type {
  ProjectAdmittedSpiceRunReviewCommand,
  ProjectAdmittedSpiceRunReviewResult,
} from "../../../../ports/in/electrical/spice/admitted-run-review.ts";
import type {
  ReopenedTechnicalCompilationAdmission,
  TechnicalCompilationAdmissionReader,
  TechnicalCompilationAdmissionReadRequest,
} from "../../../../ports/out/compile/admission/technical-compilation-admission-reader.ts";
import { uniqueCompilationAdmissionTarget } from "../../../../../domain/compile/admission/technical-compilation.ts";
import type {
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotRef,
} from "../../../../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadFreshness,
  ThreadSnapshot,
} from "../../../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../../../domain/thread/thread-snapshot-validation.ts";
import {
  ResolveProjectAdmittedSpiceRunReview,
  ResolveProjectAdmittedSpiceRunReviewError,
} from "./resolve-run-review.ts";

const PROJECT_ID = "project.spice-al01";
const SUBJECT_ID = "subject.spice-al01";
const AT = "2026-08-23T05:00:00.000Z";
const RESULT = Object.freeze({
  admission: Object.freeze({ marker: "exact-review" }),
  decisionParameters: Object.freeze([]),
}) as unknown as ProjectAdmittedSpiceRunReviewResult;

class CapturingExactReview {
  readonly calls: ProjectAdmittedSpiceRunReviewCommand[] = [];

  constructor(private readonly failure?: Error) {}

  execute(value: unknown): Promise<ProjectAdmittedSpiceRunReviewResult> {
    this.calls.push(
      structuredClone(value) as ProjectAdmittedSpiceRunReviewCommand,
    );
    return this.failure ? Promise.reject(this.failure) : Promise.resolve(RESULT);
  }
}

class ClassifyingAdmissionReader implements TechnicalCompilationAdmissionReader {
  readonly calls: TechnicalCompilationAdmissionReadRequest[] = [];

  constructor(
    private readonly byArtifactId: Readonly<
      Record<string, ReopenedTechnicalCompilationAdmission | undefined | "throw">
    > = {},
    private readonly fallback: ReopenedTechnicalCompilationAdmission | undefined =
      compilationFacts("spice-circuit-source"),
  ) {}

  read(
    request: TechnicalCompilationAdmissionReadRequest,
  ): Promise<ReopenedTechnicalCompilationAdmission | undefined> {
    this.calls.push(structuredClone(request));
    const mapped = Object.hasOwn(this.byArtifactId, request.artifactId)
      ? this.byArtifactId[request.artifactId]
      : this.fallback;
    if (mapped === "throw") {
      return Promise.reject(new Error("admission reopen failed"));
    }
    return Promise.resolve(mapped);
  }
}

Deno.test(
  "admitted SPICE public review selects only the SPICE admission beside CAD and Modelica",
  async () => {
    const cad = admissionArtifact("c".repeat(64));
    const modelica = admissionArtifact("d".repeat(64));
    const spice = admissionArtifact("e".repeat(64));
    const snapshot = threadSnapshot([cad, modelica, spice]);
    const admissions = new ClassifyingAdmissionReader({
      [cad.id]: compilationFacts("build123d-source"),
      [modelica.id]: compilationFacts("modelica-source-qualification"),
      [spice.id]: compilationFacts("spice-circuit-source"),
    });
    const exactReview = new CapturingExactReview();
    const service = new ResolveProjectAdmittedSpiceRunReview({
      projects: { get: () => Promise.resolve(projectSnapshot(snapshot)) },
      snapshots: { get: () => Promise.resolve(snapshot) },
      admissions,
      exactReview,
    });

    await service.execute({ projectId: PROJECT_ID });

    assertEquals(exactReview.calls.length, 1);
    assertEquals(exactReview.calls[0]?.artifactId, spice.id);
    assertEquals(
      exactReview.calls[0]?.artifactFingerprint,
      spice.fingerprint,
    );
    assertEquals(
      admissions.calls.map((call) => call.artifactId).sort(),
      [cad.id, modelica.id, spice.id].sort(),
    );
  },
);

Deno.test(
  "admitted SPICE public review refuses CAD and Modelica admissions as unresolved SPICE",
  async () => {
    const cad = admissionArtifact("c".repeat(64));
    const modelica = admissionArtifact("d".repeat(64));
    const snapshot = threadSnapshot([cad, modelica]);
    const admissions = new ClassifyingAdmissionReader({
      [cad.id]: compilationFacts("build123d-source"),
      [modelica.id]: compilationFacts("modelica-source-qualification"),
    });
    const fixture = reviewFixture(snapshot, admissions);

    await assertResolutionError(
      () => fixture.service.execute({ projectId: PROJECT_ID }),
      "admission_not_found",
    );
    assertEquals(fixture.exactReview.calls, []);
  },
);

Deno.test("admitted SPICE public review refuses a CAD-only fresh admission", async () => {
  const cad = admissionArtifact("c".repeat(64));
  const snapshot = threadSnapshot([cad]);
  const admissions = new ClassifyingAdmissionReader({
    [cad.id]: compilationFacts("build123d-source"),
  });
  const fixture = reviewFixture(snapshot, admissions);

  await assertResolutionError(
    () => fixture.service.execute({ projectId: PROJECT_ID }),
    "admission_not_found",
  );
  assertEquals(fixture.exactReview.calls, []);
});

Deno.test("admitted SPICE public review refuses ambiguous fresh SPICE admissions", async () => {
  const cad = admissionArtifact("c".repeat(64));
  const first = admissionArtifact("e".repeat(64));
  const second = admissionArtifact("f".repeat(64));
  const snapshot = threadSnapshot([cad, first, second]);
  const fixture = reviewFixture(
    snapshot,
    new ClassifyingAdmissionReader({
      [cad.id]: compilationFacts("build123d-source"),
      [first.id]: compilationFacts("spice-circuit-source"),
      [second.id]: compilationFacts("spice-circuit-source"),
    }),
  );

  await assertResolutionError(
    () => fixture.service.execute({ projectId: PROJECT_ID }),
    "admission_ambiguous",
  );
  assertEquals(fixture.exactReview.calls, []);
});

Deno.test("admitted SPICE public review accepts only projectId", async () => {
  const spice = admissionArtifact("e".repeat(64));
  const fixture = reviewFixture(threadSnapshot([spice]));

  for (
    const extra of [
      { artifactId: spice.id },
      { image: "casys/ngspice-microsandbox-worker:latest" },
      { runtime: "ngspice" },
      { args: [".op"] },
      { path: "/input/source.cir" },
      { observations: ["v(out)"] },
      { sourceText: "Vin in 0 DC 5\n" },
    ]
  ) {
    await assertResolutionError(
      () =>
        fixture.service.execute({
          projectId: PROJECT_ID,
          ...extra,
        }),
      "invalid_request",
    );
  }
  assertEquals(fixture.exactReview.calls, []);
});

Deno.test("admitted SPICE public review refuses a spoofed artifact prefix", async () => {
  const digest = "e".repeat(64);
  const spoofed = {
    ...admissionArtifact(digest),
    id: `spice-circuit-admission-${digest}`,
  } satisfies ThreadArtifact;
  const fixture = reviewFixture(threadSnapshot([spoofed]));

  await assertResolutionError(
    () => fixture.service.execute({ projectId: PROJECT_ID }),
    "admission_not_found",
  );
  assertEquals(fixture.exactReview.calls, []);
});

Deno.test("admitted SPICE public review refuses a foreign-producer admission", async () => {
  const artifact = {
    ...admissionArtifact("e".repeat(64)),
    producer: {
      serverId: "digital-thread",
      tool: "compile.capture-corrected-source@1",
      runId: "run.compile",
    },
  } satisfies ThreadArtifact;
  const fixture = reviewFixture(threadSnapshot([artifact]));

  await assertResolutionError(
    () => fixture.service.execute({ projectId: PROJECT_ID }),
    "admission_not_found",
  );
  assertEquals(fixture.exactReview.calls, []);
});

Deno.test("unique compilation admission target joins SPICE by target/source only", () => {
  assertEquals(
    uniqueCompilationAdmissionTarget(compilationFacts("spice-circuit-source")),
    "spice-circuit-source",
  );
  assertEquals(
    uniqueCompilationAdmissionTarget(
      compilationFacts("modelica-source-qualification"),
    ),
    "modelica-source-qualification",
  );
  const mixed = compilationFacts("spice-circuit-source");
  (mixed.admission.sources[0] as { language: string }).language = "modelica";
  assertEquals(uniqueCompilationAdmissionTarget(mixed), undefined);
});

function reviewFixture(
  snapshot: ThreadSnapshot,
  admissions: TechnicalCompilationAdmissionReader = new ClassifyingAdmissionReader(),
): {
  readonly service: ResolveProjectAdmittedSpiceRunReview;
  readonly exactReview: CapturingExactReview;
} {
  const exactReview = new CapturingExactReview();
  return {
    service: new ResolveProjectAdmittedSpiceRunReview({
      projects: { get: () => Promise.resolve(projectSnapshot(snapshot)) },
      snapshots: {
        get: (snapshotId) =>
          Promise.resolve(snapshotId === snapshot.id ? snapshot : undefined),
      },
      admissions,
      exactReview,
    }),
    exactReview,
  };
}

async function assertResolutionError(
  run: () => Promise<unknown>,
  code: string,
): Promise<void> {
  const error = await assertRejects(
    run,
    ResolveProjectAdmittedSpiceRunReviewError,
  );
  assertEquals(error.code, code);
}

function compilationFacts(
  target:
    | "spice-circuit-source"
    | "modelica-source-qualification"
    | "build123d-source",
): ReopenedTechnicalCompilationAdmission {
  const contract = target === "spice-circuit-source"
    ? {
      language: "spice" as const,
      role: "spice-circuit" as const,
      sourceRole: "spice-circuit" as const,
    }
    : target === "modelica-source-qualification"
    ? {
      language: "modelica" as const,
      role: "modelica-model" as const,
      sourceRole: "modelica-model" as const,
    }
    : {
      language: "python" as const,
      role: "cad-script" as const,
      sourceRole: "cad-script" as const,
    };
  return {
    admission: {
      sources: [{ language: contract.language, role: contract.role }],
      compilationProfileRequests: [{ target }],
    },
    document: {
      projections: [{
        target,
        profile: {
          target,
          language: contract.language,
          sourceRole: contract.sourceRole,
        },
      }],
      inputManifest: {
        sources: [{
          analysis: {
            source: { language: contract.language, role: contract.role },
          },
        }],
      },
    },
  } as unknown as ReopenedTechnicalCompilationAdmission;
}

function projectSnapshot(
  snapshot: ThreadSnapshot,
  extraThreadSnapshots: readonly EngineeringThreadSnapshotRef[] = [],
): EngineeringProjectSnapshot {
  const objective = "Review the exact sealed SPICE source before execution.";
  return {
    schemaVersion: "4.0",
    id: `${PROJECT_ID}:r2`,
    revision: 2,
    previous: { snapshotId: `${PROJECT_ID}:r1`, revision: 1 },
    generatedAt: AT,
    project: {
      id: PROJECT_ID,
      name: "SPICE AL01",
      subjectId: SUBJECT_ID,
      objective: {
        title: objective,
        statement: objective,
      },
    },
    framing: {
      intent: {
        statement: objective,
        source: { kind: "human", reference: "conversation:al01" },
        capturedAt: AT,
        capturedBy: { id: "agent:guide", origin: "agent" },
      },
      questions: [],
      answers: [],
    },
    threadSnapshots: [{
      snapshotId: snapshot.id,
      revision: snapshot.revision,
      subjectId: snapshot.subject.id,
    }, ...extraThreadSnapshots],
    phases: [],
    workItems: [],
    agentRuns: [],
    decisions: [],
    approvals: [],
    blockers: [],
    commandReceipts: [{
      commandId: "project-start",
      type: "project.start",
      actor: { id: "agent:guide", origin: "agent" },
      issuedAt: AT,
      appliedAt: AT,
      requestFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
      resultingSnapshot: { snapshotId: `${PROJECT_ID}:r1`, revision: 1 },
    }, {
      commandId: "project-question-propose",
      type: "project.question-propose",
      actor: { id: "agent:guide", origin: "agent" },
      issuedAt: AT,
      appliedAt: AT,
      requestFingerprint: { algorithm: "sha256", digest: "2".repeat(64) },
      resultingSnapshot: { snapshotId: `${PROJECT_ID}:r2`, revision: 2 },
    }],
  };
}

function threadSnapshot(
  artifacts: readonly ThreadArtifact[],
): ThreadSnapshot {
  const createdChanges = artifacts.map((artifact) => ({
    id: `change.${artifact.id}`,
    kind: "created" as const,
    target: { kind: "artifact" as const, id: artifact.id },
    summary: `Created ${artifact.id}.`,
    afterFingerprint: artifact.fingerprint,
  }));
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "snapshot.spice-al01-r5",
    revision: 5,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "SPICE AL01",
      kind: "system",
      version: "r5",
      modelArtifactId: artifacts[0]!.id,
    },
    freshness: {
      status: "fresh",
      changedAt: AT,
      invalidatedByChangeIds: [],
    },
    changeSet: {
      id: "changes.spice-al01.8",
      name: "SPICE admissions",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: createdChanges,
    },
    artifacts,
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: artifacts.map((artifact) => ({
      id: `provenance.${artifact.id}`,
      relation: "changes" as const,
      from: { kind: "change" as const, id: `change.${artifact.id}` },
      to: { kind: "artifact" as const, id: artifact.id },
      rationale: `Created ${artifact.id}.`,
    })),
    proposedActions: [],
  });
}

function admissionArtifact(
  digest: string,
  freshness: ThreadFreshness = {
    status: "fresh",
    changedAt: AT,
    invalidatedByChangeIds: [],
  },
): ThreadArtifact {
  return {
    id: `technical-compilation-admission-${digest}`,
    name: "Technical compilation admission",
    kind: "document",
    version: digest,
    fingerprint: { algorithm: "sha256", digest },
    uri: `casys://technical-compilation-admission-capture/sha256/${digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "compile.seal-admission@3",
      runId: "run.compile.seal",
    },
    inputArtifactIds: [],
    freshness,
  };
}
