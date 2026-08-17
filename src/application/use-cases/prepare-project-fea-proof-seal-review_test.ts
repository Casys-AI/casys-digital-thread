import { assertEquals, assertExists } from "@std/assert";
import { parseFeaProofDecisionParameters } from "../../domain/analysis/fea-proof-proposal.ts";
import { feaProofDecisionParametersToMap } from "../../domain/analysis/fea-proof-proposal.ts";
import { sha256Hex } from "../../domain/kernel/deterministic-json.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import type { ThreadSnapshot } from "../../domain/thread/thread-snapshot.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import { PrepareProjectFeaProofSealReview } from "./prepare-project-fea-proof-seal-review.ts";

const AT = "2026-08-16T00:00:00.000Z";
const PROJECT_ID = "desk-lamp-dl06";
const SUBJECT_ID = "project:desk-lamp-dl06";
const CASE_ID = "desk-lamp-dl06-arm-cantilever";
const GEOM_DIGEST = "b".repeat(64);
const REQ_DIGEST = "c".repeat(64);
const TARGET_ELEMENT_ID = "7dda85d1-764e-4329-95ea-09052355cc47";
const STEP_BYTES = 15460;
const STEP_BYTES_DATA = new Uint8Array(STEP_BYTES);
const STEP_DIGEST = await sha256Hex(STEP_BYTES_DATA);
const CATALOG_READER = {
  async read(path: string): Promise<string | undefined> {
    try {
      const parsed = JSON.parse(await Deno.readTextFile(path)) as {
        expectedCadArtifact: { sha256: string; bytes: number };
      };
      parsed.expectedCadArtifact.sha256 = STEP_DIGEST;
      parsed.expectedCadArtifact.bytes = STEP_BYTES;
      return JSON.stringify(parsed);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
  },
};
const ADMITTED_GEOMETRY = {
  read: () =>
    Promise.resolve(JSON.stringify({
      schemaVersion: "geometry-capture/2.1",
      manifest: {
        partDefinitions: [{
          elementId: TARGET_ELEMENT_ID,
          files: [{
            format: "step",
            fingerprint: { algorithm: "sha256", digest: STEP_DIGEST },
          }],
        }],
      },
    })),
};
const ADMITTED_STEP = {
  read: () => Promise.resolve(STEP_BYTES_DATA),
};
const REQUIREMENTS_REVIEWER = {
  review({ snapshot }: { readonly snapshot: ThreadSnapshot }) {
    const artifact = snapshot.artifacts.find((item) =>
      item.kind === "sysml-model" &&
      item.uri?.startsWith("casys://requirements-capture/Arm/")
    );
    return Promise.resolve(
      artifact ? { status: "resolved" as const, artifact } : {
        status: "unresolved" as const,
        diagnostics: [{
          code: "requirements-absent" as const,
          artifactId: null,
          message: "The active Arm requirements capture is absent.",
        }],
      },
    );
  },
};

Deno.test("fea proof-case seal review refuses an unknown catalog id without opening a file", async () => {
  let reads = 0;
  const review = new PrepareProjectFeaProofSealReview({
    snapshots: new MemorySnapshots(basisSnapshot()),
    catalogReader: {
      read: () => {
        reads += 1;
        return Promise.resolve("{}");
      },
    },
    requirementsReviewer: REQUIREMENTS_REVIEWER,
    geometryCaptures: ADMITTED_GEOMETRY,
    stepAssets: ADMITTED_STEP,
  });
  const result = await review.execute({
    projectId: PROJECT_ID,
    caseId: "cm-01-retired-replay",
    basis: basisRef(),
  });
  assertEquals(result.status, "unresolved");
  assertEquals(result.decisionParameters, undefined);
  assertEquals(result.diagnostics.map((item) => item.code), ["catalog-absent"]);
  assertEquals(reads, 0);
});

Deno.test("fea proof-case seal review compiles fea.proof.* from the catalog and the matching STEP", async () => {
  const snapshot = basisSnapshot();
  const review = new PrepareProjectFeaProofSealReview({
    snapshots: new MemorySnapshots(snapshot),
    projects: new MemoryProjects(snapshot),
    catalogReader: CATALOG_READER,
    requirementsReviewer: REQUIREMENTS_REVIEWER,
    geometryCaptures: ADMITTED_GEOMETRY,
    stepAssets: ADMITTED_STEP,
  });
  const result = await review.execute({
    projectId: PROJECT_ID,
    caseId: CASE_ID,
    basis: basisRef(),
  });
  assertEquals(result.status, "resolved");
  if (result.status !== "resolved") return;
  assertExists(result.decisionParameters);
  const parsed = parseFeaProofDecisionParameters(
    feaProofDecisionParametersToMap(result.decisionParameters),
  );
  assertEquals(parsed.id, CASE_ID);
  assertEquals(parsed.step.digest, STEP_DIGEST);
  assertEquals(parsed.geometryArtifact.id, `geometry-${GEOM_DIGEST}`);
  assertEquals(parsed.requirementsArtifact.id, "req-Arm-test");
});

Deno.test("fea proof-case seal review selects the unique catalogued case when caseId is omitted", async () => {
  const snapshot = basisSnapshot();
  const review = new PrepareProjectFeaProofSealReview({
    snapshots: new MemorySnapshots(snapshot),
    catalogReader: CATALOG_READER,
    requirementsReviewer: REQUIREMENTS_REVIEWER,
    projects: new MemoryProjects(snapshot),
    geometryCaptures: ADMITTED_GEOMETRY,
    stepAssets: ADMITTED_STEP,
  });
  const result = await review.execute({
    projectId: PROJECT_ID,
    basis: basisRef(),
  });
  assertEquals(result.status, "resolved");
  if (result.status !== "resolved") return;
  assertEquals(result.caseId, CASE_ID);
  assertExists(result.decisionParameters);
  assertEquals(result.basis, basisRef());
  assertEquals(result.next.append.tool, "project_change_append");
  assertEquals(result.next.propose.tool, "project_decision_propose");
  assertEquals(result.next.append.arguments.workItems[0]?.operation, {
    id: "verify.seal-proof-case",
    version: "1",
    bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
  });
  assertEquals(
    result.next.propose.arguments.proposal.parameters,
    result.decisionParameters,
  );
  assertEquals(result.next.append.arguments.workItems[0]?.id, "wi-proof-seal");
  assertEquals(
    result.next.append.arguments.requiredDecisions[0]?.id,
    "dec-proof-seal",
  );
  assertEquals(result.next.propose.arguments.decisionId, "dec-proof-seal");
  assertEquals(result.next.queue.workItemId, "wi-proof-seal");
  assertEquals(result.selected.caseId, CASE_ID);
  assertEquals(result.selected.stepArtifactId.startsWith("cad-asset-"), true);
  assertEquals(
    result.next.propose.arguments.proposal.summary.includes(CASE_ID),
    true,
  );
});

Deno.test("fea proof-case seal review selects the current Thread tip when basis is omitted", async () => {
  const snapshot = basisSnapshot();
  const review = new PrepareProjectFeaProofSealReview({
    snapshots: new MemorySnapshots(snapshot),
    projects: new MemoryProjects(snapshot),
    catalogReader: CATALOG_READER,
    requirementsReviewer: REQUIREMENTS_REVIEWER,
    geometryCaptures: ADMITTED_GEOMETRY,
    stepAssets: ADMITTED_STEP,
  });
  const result = await review.execute({ projectId: PROJECT_ID });
  assertEquals(result.status, "resolved");
  if (result.status !== "resolved") return;
  assertEquals(result.basis, basisRef());
  assertExists(result.decisionParameters);
  assertEquals(result.next.append.arguments.expectedRevision, 12);
});

Deno.test("fea proof-case seal review is unresolved when the project has no Thread tip", async () => {
  const snapshot = basisSnapshot();
  const review = new PrepareProjectFeaProofSealReview({
    snapshots: new MemorySnapshots(snapshot),
    projects: {
      get: () =>
        Promise.resolve({
          ...projectState(snapshot),
          threadSnapshots: [],
        } as EngineeringProjectSnapshot),
    },
    catalogReader: CATALOG_READER,
    requirementsReviewer: REQUIREMENTS_REVIEWER,
    geometryCaptures: ADMITTED_GEOMETRY,
    stepAssets: ADMITTED_STEP,
  });
  const result = await review.execute({ projectId: PROJECT_ID });
  assertEquals(result.status, "unresolved");
  assertEquals(result.diagnostics.map((item) => item.code), ["basis-absent"]);
});

Deno.test("fea proof-case seal review refuses latest as an unresolved basis-latest", async () => {
  const review = new PrepareProjectFeaProofSealReview({
    snapshots: new MemorySnapshots(basisSnapshot()),
    catalogReader: CATALOG_READER,
    requirementsReviewer: REQUIREMENTS_REVIEWER,
    geometryCaptures: ADMITTED_GEOMETRY,
    stepAssets: ADMITTED_STEP,
  });
  const result = await review.execute({
    projectId: PROJECT_ID,
    basis: { ...basisRef(), snapshotId: "latest" },
  });
  assertEquals(result.status, "unresolved");
  assertEquals(result.decisionParameters, undefined);
  assertEquals(result.diagnostics.map((item) => item.code), ["basis-latest"]);
});

Deno.test("fea proof-case seal review names a basis identity mismatch instead of a grammar error", async () => {
  const review = new PrepareProjectFeaProofSealReview({
    snapshots: new MemorySnapshots(basisSnapshot()),
    catalogReader: CATALOG_READER,
    requirementsReviewer: REQUIREMENTS_REVIEWER,
    geometryCaptures: ADMITTED_GEOMETRY,
    stepAssets: ADMITTED_STEP,
  });
  const result = await review.execute({
    projectId: PROJECT_ID,
    basis: { ...basisRef(), subjectId: "other-subject" },
  });
  assertEquals(result.status, "unresolved");
  assertEquals(result.diagnostics.map((item) => item.code), ["basis-mismatch"]);
});

Deno.test("fea proof-case seal review is unresolved when the catalogued STEP is absent", async () => {
  const snapshot = basisSnapshot({ omitStep: true });
  const review = new PrepareProjectFeaProofSealReview({
    snapshots: new MemorySnapshots(snapshot),
    catalogReader: CATALOG_READER,
    requirementsReviewer: REQUIREMENTS_REVIEWER,
    geometryCaptures: ADMITTED_GEOMETRY,
    stepAssets: ADMITTED_STEP,
  });
  const result = await review.execute({
    projectId: PROJECT_ID,
    caseId: CASE_ID,
    basis: basisRef(),
  });
  assertEquals(result.status, "unresolved");
  assertEquals(result.decisionParameters, undefined);
  assertEquals(
    result.diagnostics.some((item) => item.code === "step-absent"),
    true,
  );
});

Deno.test("fea proof-case seal review emits no paste-ready hop from a historical project basis", async () => {
  const snapshot = basisSnapshot();
  const current = {
    kind: "thread-snapshot" as const,
    snapshotId: "snap-fea-seal-current",
    revision: 6,
    subjectId: SUBJECT_ID,
  };
  const project = {
    ...projectState(snapshot),
    threadSnapshots: [
      projectState(snapshot).threadSnapshots[0]!,
      current,
    ],
  } as EngineeringProjectSnapshot;
  const review = new PrepareProjectFeaProofSealReview({
    snapshots: new MemorySnapshots(snapshot),
    projects: { get: () => Promise.resolve(project) },
    catalogReader: CATALOG_READER,
    requirementsReviewer: REQUIREMENTS_REVIEWER,
    geometryCaptures: ADMITTED_GEOMETRY,
    stepAssets: ADMITTED_STEP,
  });

  const result = await review.execute({
    projectId: PROJECT_ID,
    caseId: CASE_ID,
    basis: basisRef(),
  });

  assertEquals(result.status, "unavailable");
  assertEquals(result.next, undefined);
  assertEquals(result.decisionParameters, undefined);
  assertEquals(
    result.diagnostics.map((item) => item.code),
    ["basis-not-current"],
  );
});

Deno.test("fea proof-case seal review is unresolved when compiled identities already exist", async () => {
  const snapshot = basisSnapshot();
  const project = {
    ...projectState(snapshot),
    workItems: [{ id: "wi-proof-seal" }],
    decisions: [{ id: "dec-proof-seal" }],
  } as unknown as EngineeringProjectSnapshot;
  const review = new PrepareProjectFeaProofSealReview({
    snapshots: new MemorySnapshots(snapshot),
    projects: { get: () => Promise.resolve(project) },
    catalogReader: CATALOG_READER,
    requirementsReviewer: REQUIREMENTS_REVIEWER,
    geometryCaptures: ADMITTED_GEOMETRY,
    stepAssets: ADMITTED_STEP,
  });
  const result = await review.execute({
    projectId: PROJECT_ID,
    caseId: CASE_ID,
    basis: basisRef(),
  });
  assertEquals(result.status, "unresolved");
  assertEquals(result.next, undefined);
  assertEquals(result.decisionParameters, undefined);
  assertEquals(
    result.diagnostics.map((item) => item.code),
    ["compiled-identities-conflict"],
  );
});

Deno.test("fea proof-case seal review emits no next when the geometry capture is unreadable", async () => {
  const snapshot = basisSnapshot();
  const review = new PrepareProjectFeaProofSealReview({
    snapshots: new MemorySnapshots(snapshot),
    projects: new MemoryProjects(snapshot),
    catalogReader: CATALOG_READER,
    requirementsReviewer: REQUIREMENTS_REVIEWER,
    geometryCaptures: { read: () => Promise.resolve(undefined) },
    stepAssets: ADMITTED_STEP,
  });
  const result = await review.execute({
    projectId: PROJECT_ID,
    caseId: CASE_ID,
    basis: basisRef(),
  });
  assertEquals(result.status, "unavailable");
  assertEquals(result.next, undefined);
  assertEquals(result.decisionParameters, undefined);
  assertEquals(
    result.diagnostics.map((item) => item.code),
    ["geometry-capture-unavailable"],
  );
});

Deno.test("fea proof-case seal review distinguishes unavailable and corrupt catalog sources", async () => {
  for (
    const [text, code] of [
      [undefined, "catalog-unavailable"],
      ["{}", "catalog-integrity-failed"],
    ] as const
  ) {
    const review = new PrepareProjectFeaProofSealReview({
      snapshots: new MemorySnapshots(basisSnapshot()),
      catalogReader: { read: () => Promise.resolve(text) },
      requirementsReviewer: REQUIREMENTS_REVIEWER,
      geometryCaptures: ADMITTED_GEOMETRY,
      stepAssets: ADMITTED_STEP,
    });

    const result = await review.execute({
      projectId: PROJECT_ID,
      caseId: CASE_ID,
      basis: basisRef(),
    });

    assertEquals(result.status, "unresolved");
    assertEquals(result.next, undefined);
    assertEquals(result.diagnostics.map((item) => item.code), [code]);
  }
});

function basisRef() {
  return {
    kind: "thread-snapshot" as const,
    snapshotId: "snap-fea-seal",
    revision: 5,
    subjectId: SUBJECT_ID,
  };
}

function basisSnapshot(
  options: { readonly omitStep?: boolean } = {},
): ThreadSnapshot {
  const geomId = `geometry-${GEOM_DIGEST}`;
  const stepId = `cad-asset-${GEOM_DIGEST}-definition-0-0-${STEP_DIGEST}`;
  const reqId = "req-Arm-test";
  const artifacts = [
    artifact(geomId, "Geometry", "cad-model", GEOM_DIGEST, {
      uri: `casys://geometry-capture/sha256/${GEOM_DIGEST}`,
      mediaType: "application/json",
    }),
    artifact(reqId, "Requirements", "sysml-model", REQ_DIGEST, {
      uri: `casys://requirements-capture/Arm/sha256/${REQ_DIGEST}`,
      mediaType: "application/json",
    }),
    ...(options.omitStep ? [] : [
      artifact(stepId, "Arm STEP", "step", STEP_DIGEST, {
        uri: `casys://step-export/${STEP_DIGEST}.step`,
        mediaType: "model/step",
      }),
    ]),
  ];
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "snap-fea-seal",
    revision: 5,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "Desk Lamp DL06",
      kind: "system",
      version: "r5",
      modelArtifactId: geomId,
    },
    freshness: fresh(),
    changeSet: {
      id: "change-set.fea-seal",
      name: "FEA seal basis",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: artifacts.map((item) => ({
        id: `change.${item.id}`,
        kind: "created" as const,
        target: { kind: "artifact" as const, id: item.id },
        summary: `Created ${item.id}.`,
        afterFingerprint: item.fingerprint,
      })),
    },
    artifacts,
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: artifacts.map((item) => ({
      id: `prov-${item.id}`,
      relation: "changes" as const,
      from: { kind: "change" as const, id: `change.${item.id}` },
      to: { kind: "artifact" as const, id: item.id },
      rationale: `Created ${item.id}.`,
    })),
    proposedActions: [],
  });
}

function artifact(
  id: string,
  name: string,
  kind: "cad-model" | "sysml-model" | "step",
  digest: string,
  extra: { readonly uri: string; readonly mediaType: string },
) {
  return {
    id,
    name,
    kind,
    version: digest,
    fingerprint: { algorithm: "sha256" as const, digest },
    uri: extra.uri,
    mediaType: extra.mediaType,
    producer: {
      serverId: "digital-thread",
      tool: kind === "step" ? "design.write-geometry@1" : "design.write-geometry@1",
      runId: "run-geom",
    },
    inputArtifactIds: [] as string[],
    freshness: fresh(),
  };
}

function fresh() {
  return { status: "fresh" as const, changedAt: AT, invalidatedByChangeIds: [] };
}

class MemoryProjects {
  constructor(private readonly snapshot: ThreadSnapshot) {}
  get(projectId: string) {
    if (projectId !== PROJECT_ID) return Promise.resolve(undefined);
    return Promise.resolve(projectState(this.snapshot));
  }
}

function projectState(snapshot: ThreadSnapshot): EngineeringProjectSnapshot {
  return {
    schemaVersion: "1.0",
    id: `${PROJECT_ID}:r12`,
    revision: 12,
    generatedAt: AT,
    project: {
      id: PROJECT_ID,
      name: "Desk Lamp DL06",
      subjectId: SUBJECT_ID,
      objective: { title: "Verify arm", statement: "Verify the arm proof case." },
    },
    threadSnapshots: [{
      snapshotId: snapshot.id,
      revision: snapshot.revision,
      subjectId: snapshot.subject.id,
    }],
    phases: [],
    workItems: [],
    agentRuns: [],
    decisions: [],
    approvals: [],
    blockers: [],
  } as EngineeringProjectSnapshot;
}

class MemorySnapshots {
  saves = 0;
  constructor(private readonly snapshot: ThreadSnapshot) {}
  get(id: string) {
    return Promise.resolve(id === this.snapshot.id ? this.snapshot : undefined);
  }
  latest(_subjectId: string) {
    return Promise.resolve(this.snapshot);
  }
  save() {
    this.saves += 1;
    return Promise.reject(new Error("review must not persist a Thread snapshot"));
  }
}
