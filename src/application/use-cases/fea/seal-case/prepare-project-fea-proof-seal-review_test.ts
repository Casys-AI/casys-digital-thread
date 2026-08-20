import { assertEquals, assertExists } from "@std/assert";
import { parseFeaProofDecisionParameters } from "../../../../domain/fea/seal-case/fea-proof-proposal.ts";
import { feaProofDecisionParametersToMap } from "../../../../domain/fea/seal-case/fea-proof-proposal.ts";
import { sha256Hex } from "../../../../domain/kernel/deterministic-json.ts";
import { fingerprintTechnicalSourceText } from "../../../../domain/compile/admission/technical-compilation.ts";
import { validateThreadSnapshot } from "../../../../domain/thread/thread-snapshot-validation.ts";
import type { ThreadSnapshot } from "../../../../domain/thread/thread-snapshot.ts";
import type { EngineeringProjectSnapshot } from "../../../../domain/project/engineering-project.ts";
import type {
  ReopenedTechnicalCompilationAdmission,
  TechnicalCompilationAdmissionReader,
  TechnicalCompilationAdmissionReadRequest,
} from "../../../ports/out/compile/admission/technical-compilation-admission-reader.ts";
import { PrepareProjectFeaProofSealReview } from "./prepare-project-fea-proof-seal-review.ts";

const ADMISSION_ID = "admission-compile-1";
const ADMISSION_DIGEST = "d".repeat(64);

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
const LINKED_SOURCE_TEXT =
  "from build123d import Box\narm_thickness = 10\nresult = Box(220, 20, arm_thickness)\n";
const PHOTO_SOURCE_TEXT = "from build123d import Box\nresult = Box(20, 10, 5)\n";
const CATALOG_READER = {
  async list(): Promise<readonly { readonly caseId: string }[]> {
    return (await catalogEntries()).map(({ id }) => ({ caseId: id }));
  },
  async read(caseId: string): Promise<string | undefined> {
    try {
      const entry = (await catalogEntries()).find((item) => item.id === caseId);
      if (!entry) return undefined;
      const parsed = JSON.parse(
        await Deno.readTextFile(
          `config/mechanical-proof-cases/${entry.file}`,
        ),
      ) as {
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

async function catalogEntries(): Promise<
  readonly { readonly id: string; readonly file: string }[]
> {
  const manifest = JSON.parse(
    await Deno.readTextFile("config/mechanical-proof-cases/catalog.json"),
  ) as { cases: readonly { readonly id: string; readonly file: string }[] };
  return manifest.cases;
}
const LINKED_CATALOG_READER = catalogReaderForSource(LINKED_SOURCE_TEXT);
const PHOTO_CATALOG_READER = catalogReaderForSource(PHOTO_SOURCE_TEXT);
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

function catalogReaderForSource(sourceText: string) {
  return {
    list: () => CATALOG_READER.list(),
    async read(caseId: string): Promise<string | undefined> {
      const raw = await CATALOG_READER.read(caseId);
      if (raw === undefined) return undefined;
      const parsed = JSON.parse(raw) as {
        cadSource: {
          kind: string;
          generator: {
            definition: { mediaType: string; sha256: string; bytes: number };
          };
        };
      };
      const fingerprint = await fingerprintTechnicalSourceText(sourceText);
      parsed.cadSource.kind = "parametric";
      parsed.cadSource.generator.definition = {
        mediaType: "text/x-python",
        sha256: fingerprint.digest,
        bytes: new TextEncoder().encode(sourceText).byteLength,
      };
      return JSON.stringify(parsed);
    },
  };
}

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
      list: () => Promise.resolve([]),
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
  assertEquals(parsed.sensitivityCatalog, undefined);
  assertEquals(result.sensitivityCatalog.status, "admission-absent");
});

Deno.test(
  "fea proof-case seal review offers a ready-for-opt-in catalog from a unique cotée admission",
  async () => {
    const snapshot = basisSnapshot({ withAdmission: true });
    const review = new PrepareProjectFeaProofSealReview({
      snapshots: new MemorySnapshots(snapshot),
      projects: new MemoryProjects(snapshot),
      catalogReader: LINKED_CATALOG_READER,
      requirementsReviewer: REQUIREMENTS_REVIEWER,
      geometryCaptures: ADMITTED_GEOMETRY,
      stepAssets: ADMITTED_STEP,
      admissions: new FakeAdmissionReader(LINKED_SOURCE_TEXT),
    });
    const result = await review.execute({
      projectId: PROJECT_ID,
      caseId: CASE_ID,
      basis: basisRef(),
      sensitivityCatalogOptIn: true,
    });
    assertEquals(result.status, "resolved");
    if (result.status !== "resolved") return;
    assertEquals(result.sensitivityCatalog.status, "ready-for-opt-in");
    if (result.sensitivityCatalog.status !== "ready-for-opt-in") return;
    assertEquals(result.sensitivityCatalog.optInDefault, false);
    assertEquals(result.sensitivityCatalog.lever, {
      semanticKey: "arm_thickness",
      value: 10,
    });
    assertEquals(
      result.sensitivityCatalog.metrics.map((metric) => metric.id).sort(),
      ["maxDisplacement", "maxVonMises"],
    );
    assertEquals(
      result.sensitivityCatalog.metrics.find((metric) => metric.id === "maxVonMises")
        ?.unit,
      "MPa",
    );
    assertEquals(
      result.sensitivityCatalog.authority.resultBinding.modelElementId,
      TARGET_ELEMENT_ID,
    );
    assertEquals(result.sensitivityCatalog.solver.mesh.targetSize, {
      value: 3,
      unit: "mm",
    });
    assertEquals(result.sensitivityCatalog.solver.loads[0]?.force, {
      value: [0, 0, -10],
      unit: "N",
    });
    assertEquals(result.sensitivityCatalog.step.status, "not-compiled");
    const parsed = parseFeaProofDecisionParameters(
      feaProofDecisionParametersToMap(result.decisionParameters),
    );
    assertEquals(parsed.id, CASE_ID);
    assertEquals(
      parsed.sensitivityCatalog?.admissionArtifact.id,
      ADMISSION_ID,
    );
  },
);

Deno.test(
  "fea proof-case seal review stays resolved when the admission is only a photo",
  async () => {
    const snapshot = basisSnapshot({ withAdmission: true });
    const review = new PrepareProjectFeaProofSealReview({
      snapshots: new MemorySnapshots(snapshot),
      projects: new MemoryProjects(snapshot),
      catalogReader: PHOTO_CATALOG_READER,
      requirementsReviewer: REQUIREMENTS_REVIEWER,
      geometryCaptures: ADMITTED_GEOMETRY,
      stepAssets: ADMITTED_STEP,
      admissions: new FakeAdmissionReader(PHOTO_SOURCE_TEXT),
    });
    const result = await review.execute({
      projectId: PROJECT_ID,
      caseId: CASE_ID,
      basis: basisRef(),
    });
    assertEquals(result.status, "resolved");
    if (result.status !== "resolved") return;
    assertEquals(result.sensitivityCatalog.status, "no-named-lever");
    assertExists(result.decisionParameters);
    assertExists(result.next);
  },
);

Deno.test(
  "fea proof-case seal review refuses an opt-in joined to a different CAD definition",
  async () => {
    const snapshot = basisSnapshot({ withAdmission: true });
    const review = new PrepareProjectFeaProofSealReview({
      snapshots: new MemorySnapshots(snapshot),
      projects: new MemoryProjects(snapshot),
      catalogReader: CATALOG_READER,
      requirementsReviewer: REQUIREMENTS_REVIEWER,
      geometryCaptures: ADMITTED_GEOMETRY,
      stepAssets: ADMITTED_STEP,
      admissions: new FakeAdmissionReader(LINKED_SOURCE_TEXT),
    });
    const result = await review.execute({
      projectId: PROJECT_ID,
      caseId: CASE_ID,
      basis: basisRef(),
      sensitivityCatalogOptIn: true,
    });
    assertEquals(result.status, "unresolved");
    assertEquals(result.decisionParameters, undefined);
    assertEquals(
      result.diagnostics.map((diagnostic) => diagnostic.code),
      ["sensitivity-catalog-unavailable"],
    );
  },
);

Deno.test(
  "fea proof-case seal review preserves an admission reopening failure as unavailable",
  async () => {
    const snapshot = basisSnapshot({ withAdmission: true });
    const review = new PrepareProjectFeaProofSealReview({
      snapshots: new MemorySnapshots(snapshot),
      projects: new MemoryProjects(snapshot),
      catalogReader: LINKED_CATALOG_READER,
      requirementsReviewer: REQUIREMENTS_REVIEWER,
      geometryCaptures: ADMITTED_GEOMETRY,
      stepAssets: ADMITTED_STEP,
      admissions: {
        read(): Promise<undefined> {
          throw new Error("CAS unavailable");
        },
      },
    });
    const result = await review.execute({
      projectId: PROJECT_ID,
      caseId: CASE_ID,
      basis: basisRef(),
    });
    assertEquals(result.status, "resolved");
    if (result.status !== "resolved") return;
    assertEquals(result.sensitivityCatalog.status, "admission-unavailable");
  },
);

Deno.test("fea proof-case seal review auto-select ignores a broken sibling catalog entry", async () => {
  const snapshot = basisSnapshot();
  for (
    const sibling of [
      undefined,
      "{}",
      "throw",
    ] as const
  ) {
    const review = new PrepareProjectFeaProofSealReview({
      snapshots: new MemorySnapshots(snapshot),
      catalogReader: {
        list: () => CATALOG_READER.list(),
        read(caseId: string): Promise<string | undefined> {
          if (caseId !== "desk-lamp-dl06-arm-cantilever") {
            if (sibling === "throw") {
              throw new Error("sibling catalog source is unreadable");
            }
            return Promise.resolve(sibling);
          }
          return CATALOG_READER.read(caseId);
        },
      },
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
  }
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
      catalogReader: {
        list: () => Promise.resolve([{ caseId: "desk-lamp-dl06-arm-cantilever" }]),
        read: () => Promise.resolve(text),
      },
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
  options: { readonly omitStep?: boolean; readonly withAdmission?: boolean } = {},
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
    ...(options.withAdmission
      ? [
        artifact(ADMISSION_ID, "Compilation admission", "document", ADMISSION_DIGEST, {
          uri:
            `casys://technical-compilation-admission-capture/sha256/${ADMISSION_DIGEST}`,
          mediaType: "application/json",
          tool: "compile.seal-admission@1",
        }),
      ]
      : []),
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
  kind: "cad-model" | "sysml-model" | "step" | "document",
  digest: string,
  extra: {
    readonly uri: string;
    readonly mediaType: string;
    readonly tool?: string;
  },
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
      tool: extra.tool ?? "design.write-geometry@1",
      runId: "run-geom",
    },
    inputArtifactIds: [] as string[],
    freshness: fresh(),
  };
}

class FakeAdmissionReader implements TechnicalCompilationAdmissionReader {
  constructor(private readonly sourceText: string) {}

  async read(
    _request: TechnicalCompilationAdmissionReadRequest,
  ): Promise<ReopenedTechnicalCompilationAdmission | undefined> {
    const hasLever = this.sourceText.includes("arm_thickness = 10");
    const sourceFingerprint = await fingerprintTechnicalSourceText(this.sourceText);
    const parameter = {
      id: "parameter.arm-thickness",
      kind: "parameter" as const,
      name: "arm_thickness",
      span: {
        start: { line: 2, column: 0 },
        end: { line: 2, column: 13 },
      },
    };
    const result = {
      id: "artifact.result",
      kind: "artifact" as const,
      name: "result",
    };
    const analysis = {
      schemaVersion: "source-analysis/1.0",
      source: {
        id: "source.cad",
        role: "cad-script",
        language: "python",
        fingerprint: sourceFingerprint,
      },
      analyzer: {
        id: "build123d-qualified-lezer",
        version: "1.6.0",
      },
      policy: {
        profile: "build123d-closed-subset-v1",
        status: "passed",
        findings: [],
      },
      symbols: hasLever ? [parameter, result] : [result],
      dependencies: hasLever
        ? [{
          id: "dependency.arm-thickness.result",
          kind: "structural-incidence",
          fromSymbolId: parameter.id,
          toSymbolId: result.id,
        }]
        : [],
      unresolvedConstructs: [],
    };
    const bindings = [
      ...(hasLever
        ? [{
          id: "binding.arm-thickness",
          sourceId: "source.cad",
          sourceSymbolId: parameter.id,
          sysmlElementId: "sysml.attribute.arm-thickness",
          sysmlElementKind: "AttributeUsage",
          relation: "parameterizes",
        }]
        : []),
      {
        id: "binding.result",
        sourceId: "source.cad",
        sourceSymbolId: result.id,
        sysmlElementId: TARGET_ELEMENT_ID,
        sysmlElementKind: "PartDefinition",
        relation: "represents",
      },
    ];
    const projectionSource = {
      sourceText: this.sourceText,
      analysis,
      analysisFingerprint: { algorithm: "sha256", digest: "2".repeat(64) },
      bindings,
    };
    return {
      document: {
        inputManifest: {
          sources: [{
            sourceText: this.sourceText,
            analysis,
          }],
          bindings,
        },
        projections: [{
          target: "build123d-source",
          status: "ready-for-review",
          sources: [projectionSource],
        }],
      },
    } as unknown as ReopenedTechnicalCompilationAdmission;
  }
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
