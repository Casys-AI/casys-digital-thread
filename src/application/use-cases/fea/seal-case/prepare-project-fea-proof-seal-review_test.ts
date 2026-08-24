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
import { FileByteStore } from "../../../../adapters/shared/cas/file-byte-store.ts";
import { FeaProofCaseSourceCaptureService } from "../../../../adapters/fea/seal-case/fea-proof-case-source-capture.ts";
import { persistAgentResourceText } from "../../../../testing/agent-resource-test-support.ts";
import { PrepareProjectFeaProofCaseCapture } from "./prepare-project-fea-proof-case-capture.ts";
import { PrepareProjectFeaProofSealReview } from "./prepare-project-fea-proof-seal-review.ts";
import {
  dl06LikeSourceText,
  mechanicalProofCaseSourceText,
} from "../../../../testing/fea-proof-case-source-fixtures.ts";

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
const CAD_SCRIPT_DIGEST = await sha256Hex(
  new TextEncoder().encode(LINKED_SOURCE_TEXT),
);
const PHOTO_SCRIPT_DIGEST = await sha256Hex(
  new TextEncoder().encode(PHOTO_SOURCE_TEXT),
);

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

async function captureSource(sourceText: string) {
  const root = await Deno.makeTempDir({ prefix: "fea-proof-source-review-" });
  const captures = new FeaProofCaseSourceCaptureService({
    sourceCaptures: new FileByteStore({
      kind: "fea-proof-case-source",
      directory: `${root}/sources`,
      uriNamespace: "fea-proof-case-source",
      label: "FEA proof-case source",
    }),
  });
  const persisted = await persistAgentResourceText(`${root}/agent-resources`, {
    name: "proof.json",
    mimeType: "application/json",
    text: sourceText,
  });
  const review = await new PrepareProjectFeaProofCaseCapture({
    captures,
    resources: persisted.reopen,
  })
    .capture({ resourceRef: persisted.reference });
  return { captures, review, root };
}

function geometryCapture(script: string, digest: string) {
  return {
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
        sourceScripts: {
          partDefinitions: [{
            elementId: TARGET_ELEMENT_ID,
            script,
            scriptHash: { algorithm: "sha256", digest },
          }],
        },
      })),
  };
}

Deno.test("fea proof-case seal review compiles fea.proof.* from a captured source and matching STEP", async () => {
  const { captures, review, root } = await captureSource(dl06LikeSourceText());
  try {
    const snapshot = basisSnapshot();
    const result = await new PrepareProjectFeaProofSealReview({
      snapshots: new MemorySnapshots(snapshot),
      projects: new MemoryProjects(snapshot),
      proofCaseSources: captures,
      requirementsReviewer: REQUIREMENTS_REVIEWER,
      geometryCaptures: geometryCapture(LINKED_SOURCE_TEXT, CAD_SCRIPT_DIGEST),
      stepAssets: ADMITTED_STEP,
    }).execute({
      projectId: PROJECT_ID,
      caseRef: review.reference,
    });
    assertEquals(result.status, "resolved");
    if (result.status !== "resolved") return;
    assertExists(result.decisionParameters);
    const parsed = parseFeaProofDecisionParameters(
      feaProofDecisionParametersToMap(result.decisionParameters),
    );
    assertEquals(parsed.id, CASE_ID);
    assertEquals(parsed.sourceFingerprint, review.reference.fingerprint);
    assertEquals(parsed.step.digest, STEP_DIGEST);
    assertEquals(parsed.geometryArtifact.id, `geometry-${GEOM_DIGEST}`);
    assertEquals(
      result.selected.workItemId,
      "wi-proof-seal-desk-lamp-dl06-arm-cantilever-r1",
    );
    assertEquals(result.sensitivityCatalog.status, "admission-absent");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("a completely new non-lamp source reaches resolved seal review without a catalog entry", async () => {
  const { captures, review, root } = await captureSource(
    mechanicalProofCaseSourceText({
      project: { id: PROJECT_ID, subjectId: SUBJECT_ID },
      target: {
        id: "br01-bracket",
        modelElementId: TARGET_ELEMENT_ID,
      },
    }),
  );
  try {
    const snapshot = basisSnapshot();
    const result = await new PrepareProjectFeaProofSealReview({
      snapshots: new MemorySnapshots(snapshot),
      projects: new MemoryProjects(snapshot),
      proofCaseSources: captures,
      requirementsReviewer: REQUIREMENTS_REVIEWER,
      geometryCaptures: geometryCapture(LINKED_SOURCE_TEXT, CAD_SCRIPT_DIGEST),
      stepAssets: ADMITTED_STEP,
    }).execute({
      projectId: PROJECT_ID,
      caseRef: review.reference,
    });
    assertEquals(result.status, "resolved");
    if (result.status !== "resolved") return;
    assertEquals(result.caseId, "bracket-br01-static");
    assertEquals(result.selected.workItemId, "wi-proof-seal-bracket-br01-static-r1");
    assertEquals(
      result.next.append.arguments.workItems[0]?.operation.id,
      "verify.seal-proof-case",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("fea proof-case seal review is unresolved for a missing source fingerprint", async () => {
  const { captures, root } = await captureSource(dl06LikeSourceText());
  try {
    const result = await new PrepareProjectFeaProofSealReview({
      snapshots: new MemorySnapshots(basisSnapshot()),
      projects: new MemoryProjects(basisSnapshot()),
      proofCaseSources: captures,
      requirementsReviewer: REQUIREMENTS_REVIEWER,
      geometryCaptures: geometryCapture(LINKED_SOURCE_TEXT, CAD_SCRIPT_DIGEST),
      stepAssets: ADMITTED_STEP,
    }).execute({
      projectId: PROJECT_ID,
      caseRef: { fingerprint: "a".repeat(64) },
    });
    assertEquals(result.status, "unresolved");
    assertEquals(result.diagnostics.map((item) => item.code), ["source-absent"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("fea proof-case seal review is unresolved when the source project does not match", async () => {
  const { captures, review, root } = await captureSource(
    dl06LikeSourceText({ projectId: "other-project" }),
  );
  try {
    const result = await new PrepareProjectFeaProofSealReview({
      snapshots: new MemorySnapshots(basisSnapshot()),
      projects: new MemoryProjects(basisSnapshot()),
      proofCaseSources: captures,
      requirementsReviewer: REQUIREMENTS_REVIEWER,
      geometryCaptures: geometryCapture(LINKED_SOURCE_TEXT, CAD_SCRIPT_DIGEST),
      stepAssets: ADMITTED_STEP,
    }).execute({
      projectId: PROJECT_ID,
      caseRef: review.reference,
    });
    assertEquals(result.status, "unresolved");
    assertEquals(result.diagnostics.map((item) => item.code), ["project-mismatch"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("fea proof-case seal review is unresolved when the source subject does not match", async () => {
  const { captures, review, root } = await captureSource(
    dl06LikeSourceText({ subjectId: "project:other" }),
  );
  try {
    const result = await new PrepareProjectFeaProofSealReview({
      snapshots: new MemorySnapshots(basisSnapshot()),
      projects: new MemoryProjects(basisSnapshot()),
      proofCaseSources: captures,
      requirementsReviewer: REQUIREMENTS_REVIEWER,
      geometryCaptures: geometryCapture(LINKED_SOURCE_TEXT, CAD_SCRIPT_DIGEST),
      stepAssets: ADMITTED_STEP,
    }).execute({
      projectId: PROJECT_ID,
      caseRef: review.reference,
    });
    assertEquals(result.status, "unresolved");
    assertEquals(result.diagnostics.map((item) => item.code), ["subject-mismatch"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("fea proof-case seal review refuses extra caseId or basis authority", async () => {
  const { captures, review, root } = await captureSource(dl06LikeSourceText());
  try {
    const reviewUseCase = new PrepareProjectFeaProofSealReview({
      snapshots: new MemorySnapshots(basisSnapshot()),
      proofCaseSources: captures,
      requirementsReviewer: REQUIREMENTS_REVIEWER,
      geometryCaptures: geometryCapture(LINKED_SOURCE_TEXT, CAD_SCRIPT_DIGEST),
      stepAssets: ADMITTED_STEP,
    });
    let failed = false;
    try {
      await reviewUseCase.execute({
        projectId: PROJECT_ID,
        caseRef: review.reference,
        caseId: CASE_ID,
      });
    } catch {
      failed = true;
    }
    assertEquals(failed, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test(
  "fea proof-case seal review offers a ready-for-opt-in catalog from a unique cotée admission",
  async () => {
    const { captures, review, root } = await captureSource(dl06LikeSourceText());
    try {
      const snapshot = basisSnapshot({ withAdmission: true });
      const result = await new PrepareProjectFeaProofSealReview({
        snapshots: new MemorySnapshots(snapshot),
        projects: new MemoryProjects(snapshot),
        proofCaseSources: captures,
        requirementsReviewer: REQUIREMENTS_REVIEWER,
        geometryCaptures: geometryCapture(LINKED_SOURCE_TEXT, CAD_SCRIPT_DIGEST),
        stepAssets: ADMITTED_STEP,
        admissions: new FakeAdmissionReader(LINKED_SOURCE_TEXT),
      }).execute({
        projectId: PROJECT_ID,
        caseRef: review.reference,
        sensitivityCatalogOptIn: true,
      });
      assertEquals(result.status, "resolved");
      if (result.status !== "resolved") return;
      assertEquals(result.sensitivityCatalog.status, "ready-for-opt-in");
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
);

Deno.test("fea proof-case seal review stays resolved when the admission is only a photo", async () => {
  const { captures, review, root } = await captureSource(dl06LikeSourceText());
  try {
    const snapshot = basisSnapshot({ withAdmission: true });
    const result = await new PrepareProjectFeaProofSealReview({
      snapshots: new MemorySnapshots(snapshot),
      projects: new MemoryProjects(snapshot),
      proofCaseSources: captures,
      requirementsReviewer: REQUIREMENTS_REVIEWER,
      geometryCaptures: geometryCapture(PHOTO_SOURCE_TEXT, PHOTO_SCRIPT_DIGEST),
      stepAssets: ADMITTED_STEP,
      admissions: new FakeAdmissionReader(PHOTO_SOURCE_TEXT),
    }).execute({
      projectId: PROJECT_ID,
      caseRef: review.reference,
    });
    assertEquals(result.status, "resolved");
    if (result.status !== "resolved") return;
    assertEquals(result.sensitivityCatalog.status, "no-named-lever");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("fea proof-case seal review is unresolved when the unique STEP is absent", async () => {
  const { captures, review, root } = await captureSource(dl06LikeSourceText());
  try {
    const snapshot = basisSnapshot({ omitStep: true });
    const result = await new PrepareProjectFeaProofSealReview({
      snapshots: new MemorySnapshots(snapshot),
      projects: new MemoryProjects(snapshot),
      proofCaseSources: captures,
      requirementsReviewer: REQUIREMENTS_REVIEWER,
      geometryCaptures: geometryCapture(LINKED_SOURCE_TEXT, CAD_SCRIPT_DIGEST),
      stepAssets: ADMITTED_STEP,
    }).execute({
      projectId: PROJECT_ID,
      caseRef: review.reference,
    });
    assertEquals(result.status, "unresolved");
    assertEquals(
      result.diagnostics.some((item) => item.code === "step-absent"),
      true,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("fea proof-case seal review is unresolved when the project has no Thread tip", async () => {
  const { captures, review, root } = await captureSource(dl06LikeSourceText());
  try {
    const snapshot = basisSnapshot();
    const result = await new PrepareProjectFeaProofSealReview({
      snapshots: new MemorySnapshots(snapshot),
      projects: {
        get: () =>
          Promise.resolve({
            ...projectState(snapshot),
            threadSnapshots: [],
          } as EngineeringProjectSnapshot),
      },
      proofCaseSources: captures,
      requirementsReviewer: REQUIREMENTS_REVIEWER,
      geometryCaptures: geometryCapture(LINKED_SOURCE_TEXT, CAD_SCRIPT_DIGEST),
      stepAssets: ADMITTED_STEP,
    }).execute({
      projectId: PROJECT_ID,
      caseRef: review.reference,
    });
    assertEquals(result.status, "unresolved");
    assertEquals(result.diagnostics.map((item) => item.code), ["basis-absent"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("fea proof-case seal review is unresolved when compiled identities already exist", async () => {
  const { captures, review, root } = await captureSource(dl06LikeSourceText());
  try {
    const snapshot = basisSnapshot();
    const project = {
      ...projectState(snapshot),
      workItems: [{ id: "wi-proof-seal-desk-lamp-dl06-arm-cantilever-r1" }],
      decisions: [{ id: "dec-proof-seal-desk-lamp-dl06-arm-cantilever-r1" }],
    } as unknown as EngineeringProjectSnapshot;
    const result = await new PrepareProjectFeaProofSealReview({
      snapshots: new MemorySnapshots(snapshot),
      projects: { get: () => Promise.resolve(project) },
      proofCaseSources: captures,
      requirementsReviewer: REQUIREMENTS_REVIEWER,
      geometryCaptures: geometryCapture(LINKED_SOURCE_TEXT, CAD_SCRIPT_DIGEST),
      stepAssets: ADMITTED_STEP,
    }).execute({
      projectId: PROJECT_ID,
      caseRef: review.reference,
    });
    assertEquals(result.status, "unresolved");
    assertEquals(
      result.diagnostics.map((item) => item.code),
      ["compiled-identities-conflict"],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

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
        uri: `/api/thread/assets/${STEP_DIGEST}.step`,
        mediaType: "model/step",
      }),
    ]),
    ...(options.withAdmission
      ? [
        artifact(ADMISSION_ID, "Compilation admission", "document", ADMISSION_DIGEST, {
          uri:
            `casys://technical-compilation-admission-capture/sha256/${ADMISSION_DIGEST}`,
          mediaType: "application/json",
          tool: "compile.seal-admission@3",
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

class MemorySnapshots {
  constructor(private readonly snapshot: ThreadSnapshot) {}
  get(snapshotId: string) {
    return Promise.resolve(
      snapshotId === this.snapshot.id ? this.snapshot : undefined,
    );
  }
  latest(_subjectId: string) {
    return Promise.resolve(this.snapshot);
  }
  save() {
    return Promise.resolve();
  }
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
    schemaVersion: "4.0",
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
  } as unknown as EngineeringProjectSnapshot;
}
