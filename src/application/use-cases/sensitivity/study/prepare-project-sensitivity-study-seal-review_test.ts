import { assertEquals } from "@std/assert";
import type { ReopenedTechnicalCompilationAdmission } from "../../../ports/out/compile/admission/technical-compilation-admission-reader.ts";
import {
  parseSensitivityStudyDecisionParameters,
} from "../../../../domain/sensitivity/study/sensitivity-study-proposal.ts";
import { validateThreadSnapshot } from "../../../../domain/thread/thread-snapshot-validation.ts";
import type { ThreadSnapshot } from "../../../../domain/thread/thread-snapshot.ts";
import type { EngineeringProjectSnapshot } from "../../../../domain/project/engineering-project.ts";
import { FileCataloguedSensitivityStudyCaseReader } from "../../../../adapters/sensitivity/study/file-catalogued-sensitivity-study-case-reader.ts";
import { PrepareProjectSensitivityStudySealReview } from "./prepare-project-sensitivity-study-seal-review.ts";
import {
  SIGNED_OFFER_AT,
  SIGNED_OFFER_CASE_ID,
  SIGNED_OFFER_PROJECT_ID,
  signedCatalogOfferFixture,
} from "../../../../testing/signed-catalog-offer-test-support.ts";

const AT = SIGNED_OFFER_AT;
const PROJECT_ID = SIGNED_OFFER_PROJECT_ID;
const SUBJECT_ID = "project:desk-lamp-dl06";
const CASE_ID = SIGNED_OFFER_CASE_ID;
const ADMISSION_ID = "compile-admission-1";
const ADMISSION_DIGEST = "a".repeat(64);
const REAL_CATALOG = new FileCataloguedSensitivityStudyCaseReader();

function matchingAdmission(
  sourceText = "arm_thickness = 10\nresult = Box(1, 1, arm_thickness)\n",
  semanticKey = "arm_thickness",
): ReopenedTechnicalCompilationAdmission {
  return {
    document: {
      inputManifest: {
        sources: [{
          sourceText,
          analysis: {
            symbols: [{
              id: `sym:${semanticKey}`,
              kind: "parameter",
              name: semanticKey,
              span: {
                start: { line: 1, column: 0 },
                end: { line: 1, column: semanticKey.length },
              },
            }],
          },
        }],
      },
    },
  } as unknown as ReopenedTechnicalCompilationAdmission;
}

const MATCHING_ADMISSIONS = {
  read: () => Promise.resolve(matchingAdmission()),
};

Deno.test("sensitivity-study seal review refuses latest as an unresolved basis-latest", async () => {
  const fixture = await signedCatalogOfferFixture();
  const review = new PrepareProjectSensitivityStudySealReview({
    snapshots: new MemorySnapshots(fixture.snapshot),
    catalogReader: REAL_CATALOG,
    admissions: fixture.admissions,
    catalogOffers: fixture.catalogOffers,
    proofCaptures: fixture.proofCaptures,
  });
  const result = await review.execute({
    projectId: PROJECT_ID,
    basis: { ...fixture.basis, snapshotId: "latest" },
  });
  assertEquals(result.status, "unresolved");
  assertEquals(result.decisionParameters, undefined);
  assertEquals(result.diagnostics.map((item) => item.code), ["basis-latest"]);
});

Deno.test("sensitivity-study seal review emits no paste-ready hop from a historical project basis", async () => {
  const fixture = await signedCatalogOfferFixture();
  const current = {
    kind: "thread-snapshot" as const,
    snapshotId: "snap-sensitivity-seal-current",
    revision: 2,
    subjectId: SUBJECT_ID,
  };
  const project = {
    ...projectState(fixture.snapshot),
    threadSnapshots: [
      projectState(fixture.snapshot).threadSnapshots[0]!,
      current,
    ],
  } as EngineeringProjectSnapshot;
  const review = new PrepareProjectSensitivityStudySealReview({
    snapshots: new MemorySnapshots(fixture.snapshot),
    projects: { get: () => Promise.resolve(project) },
    catalogReader: REAL_CATALOG,
    admissions: fixture.admissions,
    catalogOffers: fixture.catalogOffers,
    proofCaptures: fixture.proofCaptures,
  });
  const result = await review.execute({
    projectId: PROJECT_ID,
    caseId: CASE_ID,
    basis: fixture.basis,
  });
  assertEquals(result.status, "unavailable");
  assertEquals(result.next, undefined);
  assertEquals(result.decisionParameters, undefined);
  assertEquals(result.diagnostics.map((item) => item.code), ["basis-not-current"]);
});

Deno.test("sensitivity-study seal review is unresolved when compiled identities already exist", async () => {
  const fixture = await signedCatalogOfferFixture();
  const project = {
    ...projectState(fixture.snapshot),
    workItems: [{
      id: "wi-sensitivity-seal-desk-lamp-dl06-arm-cantilever-arm_thickness",
    }],
    decisions: [{
      id: "dec-sensitivity-seal-desk-lamp-dl06-arm-cantilever-arm_thickness",
    }],
  } as unknown as EngineeringProjectSnapshot;
  const review = new PrepareProjectSensitivityStudySealReview({
    snapshots: new MemorySnapshots(fixture.snapshot),
    projects: { get: () => Promise.resolve(project) },
    catalogReader: REAL_CATALOG,
    admissions: fixture.admissions,
    catalogOffers: fixture.catalogOffers,
    proofCaptures: fixture.proofCaptures,
  });
  const result = await review.execute({
    projectId: PROJECT_ID,
    caseId: CASE_ID,
    basis: fixture.basis,
  });
  assertEquals(result.status, "unresolved");
  assertEquals(result.next, undefined);
  assertEquals(result.decisionParameters, undefined);
  assertEquals(
    result.diagnostics.map((item) => item.code),
    ["compiled-identities-conflict"],
  );
});

Deno.test(
  "sensitivity-study seal review compiles a sealable case from the unique signed catalog offer",
  async () => {
    const fixture = await signedCatalogOfferFixture();
    const review = new PrepareProjectSensitivityStudySealReview({
      snapshots: new MemorySnapshots(fixture.snapshot),
      projects: new MemoryProjects(fixture.snapshot, "desk-lamp-dl06"),
      catalogReader: REAL_CATALOG,
      admissions: fixture.admissions,
      catalogOffers: fixture.catalogOffers,
      proofCaptures: fixture.proofCaptures,
    });
    const result = await review.execute({
      projectId: "desk-lamp-dl06",
      basis: fixture.basis,
    });
    assertEquals(result.status, "resolved");
    if (result.status !== "resolved") return;
    assertEquals(result.caseId, "desk-lamp-dl06-arm-cantilever-arm_thickness");
    assertEquals(result.selected.authority, "signed-offer");
    const parsed = parseSensitivityStudyDecisionParameters(
      result.decisionParameters,
    );
    assertEquals(parsed.id, "desk-lamp-dl06-arm-cantilever-arm_thickness");
    assertEquals(parsed.step, { value: 3, unit: "mm" });
    assertEquals(parsed.baseValue, { value: 10, unit: "mm" });
    assertEquals(parsed.target.semanticKey, "arm_thickness");
    assertEquals(parsed.solver.mesh.targetSizeMm, 3);
    assertEquals(parsed.cadSource.artifactUri, fixture.cadSource.artifactUri);
    assertEquals(
      result.next.append.arguments.workItems[0]?.id,
      "wi-sensitivity-seal-desk-lamp-dl06-arm-cantilever-arm_thickness",
    );
  },
);

Deno.test(
  "sensitivity-study seal review reopens a named case from the reviewed JSON manifest",
  async () => {
    const projectId = "desk-lamp-dl04";
    const subjectId = "lamp-arm";
    const snapshot = basisSnapshot({ projectId, subjectId });
    const review = new PrepareProjectSensitivityStudySealReview({
      snapshots: new MemorySnapshots(snapshot),
      projects: new MemoryProjects(snapshot, projectId),
      catalogReader: REAL_CATALOG,
      admissions: {
        read: () =>
          Promise.resolve(
            matchingAdmission(
              "size_z = 50\nresult = Box(1, 1, size_z)\n",
              "size_z",
            ),
          ),
      },
    });
    const result = await review.execute({
      projectId,
      caseId: "dl04-size-z-sensitivity",
      basis: {
        kind: "thread-snapshot",
        snapshotId: snapshot.id,
        revision: snapshot.revision,
        subjectId,
      },
    });
    assertEquals(result.status, "resolved");
    if (result.status !== "resolved") return;
    assertEquals(result.caseId, "dl04-size-z-sensitivity");
    assertEquals(result.selected.authority, "catalog");
    assertEquals(
      parseSensitivityStudyDecisionParameters(result.decisionParameters).target
        .semanticKey,
      "size_z",
    );
  },
);

Deno.test(
  "sensitivity-study seal review stays catalog-absent for dl06 when no signed offer exists",
  async () => {
    const snapshot = basisSnapshot({
      projectId: "desk-lamp-dl06",
      subjectId: "project:desk-lamp-dl06",
    });
    const review = new PrepareProjectSensitivityStudySealReview({
      snapshots: new MemorySnapshots(snapshot),
      projects: new MemoryProjects(snapshot, "desk-lamp-dl06"),
      catalogReader: REAL_CATALOG,
      admissions: MATCHING_ADMISSIONS,
    });
    const result = await review.execute({
      projectId: "desk-lamp-dl06",
      basis: {
        kind: "thread-snapshot",
        snapshotId: snapshot.id,
        revision: snapshot.revision,
        subjectId: "project:desk-lamp-dl06",
      },
    });
    assertEquals(result.status, "unresolved");
    assertEquals(result.diagnostics.map((item) => item.code), ["catalog-absent"]);
  },
);

Deno.test(
  "sensitivity-study seal review falls through catalog-absent to a unique signed offer without readers",
  async () => {
    const fixture = await signedCatalogOfferFixture();
    const review = new PrepareProjectSensitivityStudySealReview({
      snapshots: new MemorySnapshots(fixture.snapshot),
      projects: new MemoryProjects(fixture.snapshot, PROJECT_ID),
      catalogReader: REAL_CATALOG,
      admissions: fixture.admissions,
    });
    const result = await review.execute({
      projectId: PROJECT_ID,
      basis: fixture.basis,
    });
    assertEquals(result.status, "unavailable");
    assertEquals(result.decisionParameters, undefined);
    assertEquals(
      result.diagnostics.map((item) => item.code),
      ["catalog-offer-unavailable"],
    );
  },
);

Deno.test(
  "sensitivity-study seal review is catalog-offer-ambiguous when several signed offers exist",
  async () => {
    const fixture = await signedCatalogOfferFixture({ extraOffer: true });
    const review = new PrepareProjectSensitivityStudySealReview({
      snapshots: new MemorySnapshots(fixture.snapshot),
      projects: new MemoryProjects(fixture.snapshot, "desk-lamp-dl06"),
      catalogReader: REAL_CATALOG,
      admissions: fixture.admissions,
      catalogOffers: fixture.catalogOffers,
      proofCaptures: fixture.proofCaptures,
    });
    const result = await review.execute({
      projectId: "desk-lamp-dl06",
      basis: fixture.basis,
    });
    assertEquals(result.status, "unresolved");
    assertEquals(result.decisionParameters, undefined);
    assertEquals(
      result.diagnostics.map((item) => item.code),
      ["catalog-offer-ambiguous"],
    );
  },
);

Deno.test(
  "sensitivity-study seal review fails closed when the signed offer no longer compiles",
  async () => {
    const fixture = await signedCatalogOfferFixture({
      admissionSource: "from build123d import Box\nresult = Box(220, 20, 10)\n",
    });
    const review = new PrepareProjectSensitivityStudySealReview({
      snapshots: new MemorySnapshots(fixture.snapshot),
      projects: new MemoryProjects(fixture.snapshot, "desk-lamp-dl06"),
      catalogReader: REAL_CATALOG,
      admissions: fixture.admissions,
      catalogOffers: fixture.catalogOffers,
      proofCaptures: fixture.proofCaptures,
    });
    const result = await review.execute({
      projectId: "desk-lamp-dl06",
      basis: fixture.basis,
    });
    assertEquals(result.status, "unresolved");
    assertEquals(result.decisionParameters, undefined);
    assertEquals(
      result.diagnostics.map((item) => item.code),
      ["catalog-offer-admission-unlinked"],
    );
  },
);

Deno.test(
  "sensitivity-study seal review refuses a named caseId that is not the compiled offer id",
  async () => {
    const fixture = await signedCatalogOfferFixture();
    const review = new PrepareProjectSensitivityStudySealReview({
      snapshots: new MemorySnapshots(fixture.snapshot),
      projects: new MemoryProjects(fixture.snapshot, "desk-lamp-dl06"),
      catalogReader: REAL_CATALOG,
      admissions: fixture.admissions,
      catalogOffers: fixture.catalogOffers,
      proofCaptures: fixture.proofCaptures,
    });
    const result = await review.execute({
      projectId: "desk-lamp-dl06",
      caseId: "invented-dl06-case",
      basis: fixture.basis,
    });
    assertEquals(result.status, "unresolved");
    assertEquals(
      result.diagnostics.map((item) => item.code),
      ["catalog-offer-case-mismatch"],
    );
  },
);

Deno.test(
  "sensitivity-study seal review is catalog-offer-integrity-failed for a truncated offer and does not throw",
  async () => {
    const fixture = await signedCatalogOfferFixture({ truncatedOffer: true });
    const review = new PrepareProjectSensitivityStudySealReview({
      snapshots: new MemorySnapshots(fixture.snapshot),
      projects: new MemoryProjects(fixture.snapshot, "desk-lamp-dl06"),
      catalogReader: REAL_CATALOG,
      admissions: fixture.admissions,
      catalogOffers: fixture.catalogOffers,
      proofCaptures: fixture.proofCaptures,
    });
    const result = await review.execute({
      projectId: "desk-lamp-dl06",
      basis: fixture.basis,
    });
    assertEquals(result.status, "unresolved");
    assertEquals(result.decisionParameters, undefined);
    assertEquals(
      result.diagnostics.map((item) => item.code),
      ["catalog-offer-integrity-failed"],
    );
  },
);

Deno.test(
  "sensitivity-study seal review accepts several proof captures of the same digest",
  async () => {
    const fixture = await signedCatalogOfferFixture({ extraProofSameDigest: true });
    const review = new PrepareProjectSensitivityStudySealReview({
      snapshots: new MemorySnapshots(fixture.snapshot),
      projects: new MemoryProjects(fixture.snapshot, "desk-lamp-dl06"),
      catalogReader: REAL_CATALOG,
      admissions: fixture.admissions,
      catalogOffers: fixture.catalogOffers,
      proofCaptures: fixture.proofCaptures,
    });
    const result = await review.execute({
      projectId: "desk-lamp-dl06",
      basis: fixture.basis,
    });
    assertEquals(result.status, "resolved");
    if (result.status !== "resolved") return;
    assertEquals(result.selected.authority, "signed-offer");
  },
);

Deno.test(
  "sensitivity-study seal review ignores an invalid sibling proof when one digest matches",
  async () => {
    const fixture = await signedCatalogOfferFixture({ invalidProofSibling: true });
    const review = new PrepareProjectSensitivityStudySealReview({
      snapshots: new MemorySnapshots(fixture.snapshot),
      projects: new MemoryProjects(fixture.snapshot, "desk-lamp-dl06"),
      catalogReader: REAL_CATALOG,
      admissions: fixture.admissions,
      catalogOffers: fixture.catalogOffers,
      proofCaptures: fixture.proofCaptures,
    });
    const result = await review.execute({
      projectId: "desk-lamp-dl06",
      basis: fixture.basis,
    });
    assertEquals(result.status, "resolved");
    if (result.status !== "resolved") return;
    assertEquals(result.selected.authority, "signed-offer");
  },
);

Deno.test("sensitivity-study seal review is unavailable when the matching admission cannot be reopened", async () => {
  const fixture = await signedCatalogOfferFixture();
  const review = new PrepareProjectSensitivityStudySealReview({
    snapshots: new MemorySnapshots(fixture.snapshot),
    projects: new MemoryProjects(fixture.snapshot, PROJECT_ID),
    catalogReader: REAL_CATALOG,
    admissions: { read: () => Promise.resolve(undefined) },
    catalogOffers: fixture.catalogOffers,
    proofCaptures: fixture.proofCaptures,
  });
  const result = await review.execute({
    projectId: PROJECT_ID,
    caseId: CASE_ID,
    basis: fixture.basis,
  });
  assertEquals(result.status, "unavailable");
  assertEquals(result.decisionParameters, undefined);
  assertEquals(result.next, undefined);
  assertEquals(
    result.diagnostics.map((item) => item.code),
    ["admission-unavailable"],
  );
});

function basisSnapshot(
  options: {
    readonly omitAdmission?: boolean;
    readonly lookalikesOnly?: boolean;
    readonly extraOffer?: boolean;
    readonly projectId?: string;
    readonly subjectId?: string;
  } = {},
): ThreadSnapshot {
  const subjectId = options.subjectId ?? SUBJECT_ID;
  const artifacts = options.lookalikesOnly
    ? [
      artifact("geometry-cad", "Geometry", "cad-model", "b".repeat(64), {
        uri: "casys://geometry-capture/sha256/" + "b".repeat(64),
        mediaType: "application/json",
        tool: "design.write-geometry@1",
      }),
      artifact("cad-asset-step", "Arm STEP", "step", "c".repeat(64), {
        uri: "casys://step-export/" + "c".repeat(64) + ".step",
        mediaType: "model/step",
        tool: "design.write-geometry@1",
      }),
    ]
    : options.omitAdmission
    ? [
      artifact("artifact.brief", "Brief", "document", "1".repeat(64), {
        uri: "casys://brief/sha256/" + "1".repeat(64),
        mediaType: "application/json",
        tool: "baseline.from-approved-brief@1",
      }),
    ]
    : [
      artifact(ADMISSION_ID, "Compilation admission", "document", ADMISSION_DIGEST, {
        uri:
          `casys://technical-compilation-admission-capture/sha256/${ADMISSION_DIGEST}`,
        mediaType: "application/json",
        tool: "compile.seal-admission@3",
      }),
      ...(options.extraOffer
        ? [artifact(
          "sensitivity-catalog-offer-ignored",
          "Ignored offer",
          "document",
          "e".repeat(64),
          {
            uri: "casys://sensitivity-catalog-offer-capture/sha256/" +
              "e".repeat(64),
            mediaType: "application/json",
            tool: "verify.seal-proof-case@1",
          },
        )]
        : []),
    ];
  const modelArtifactId = artifacts[0]!.id;
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "snap-sensitivity-seal",
    revision: 5,
    generatedAt: AT,
    subject: {
      id: subjectId,
      name: "Desk Lamp",
      kind: "system",
      version: "r5",
      modelArtifactId,
    },
    freshness: fresh(),
    changeSet: {
      id: "change-set.sensitivity-seal",
      name: "Sensitivity seal basis",
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
  kind: "cad-model" | "document" | "step",
  digest: string,
  extra: {
    readonly uri: string;
    readonly mediaType: string;
    readonly tool: string;
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
      tool: extra.tool,
      runId: "run-source",
    },
    inputArtifactIds: [] as string[],
    freshness: fresh(),
  };
}

function fresh() {
  return { status: "fresh" as const, changedAt: AT, invalidatedByChangeIds: [] };
}

class MemoryProjects {
  constructor(
    private readonly snapshot: ThreadSnapshot,
    private readonly projectId = PROJECT_ID,
  ) {}
  get(projectId: string) {
    if (projectId !== this.projectId) return Promise.resolve(undefined);
    return Promise.resolve(projectState(this.snapshot, this.projectId));
  }
}

function projectState(
  snapshot: ThreadSnapshot,
  projectId = PROJECT_ID,
): EngineeringProjectSnapshot {
  return {
    schemaVersion: "4.0",
    id: `${projectId}:r12`,
    revision: 12,
    generatedAt: AT,
    project: {
      id: projectId,
      name: "Desk Lamp",
      subjectId: snapshot.subject.id,
      objective: { title: "Study", statement: "Seal the sensitivity study." },
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
