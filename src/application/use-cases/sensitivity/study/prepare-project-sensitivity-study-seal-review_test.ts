import { assertEquals, assertExists } from "@std/assert";
import type { ReopenedTechnicalCompilationAdmission } from "../../../ports/out/compile/admission/technical-compilation-admission-reader.ts";
import { parseFeaProofCaseCapture } from "../../../../domain/fea/seal-case/fea-proof-case-capture.ts";
import { canonicalProofText } from "../../../../domain/fea/seal-case/fea-proof-proposal.ts";
import {
  type MechanicalProofCase,
  validateMechanicalProofCase,
} from "../../../../domain/fea/seal-case/mechanical-proof-case.ts";
import {
  compileSensitivityCatalogOfferFromAdmission,
  SENSITIVITY_CATALOG_OFFER_CAPTURE_SCHEMA,
} from "../../../../domain/sensitivity/study/sensitivity-catalog-from-proof.ts";
import {
  parseSensitivityStudyDecisionParameters,
} from "../../../../domain/sensitivity/study/sensitivity-study-proposal.ts";
import { fingerprintTechnicalSourceText } from "../../../../domain/compile/admission/technical-compilation.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import { validateThreadSnapshot } from "../../../../domain/thread/thread-snapshot-validation.ts";
import type { ThreadSnapshot } from "../../../../domain/thread/thread-snapshot.ts";
import type { EngineeringProjectSnapshot } from "../../../../domain/project/engineering-project.ts";
import { PrepareProjectSensitivityStudySealReview } from "./prepare-project-sensitivity-study-seal-review.ts";

const AT = "2026-08-16T00:00:00.000Z";
const PROJECT_ID = "desk-lamp-dl05";
const SUBJECT_ID = "project:desk-lamp-dl05";
const CASE_ID = "dl05-arm-thickness-isolated";
const ADMISSION_ID = "compile-admission-1";
const ADMISSION_DIGEST = "a".repeat(64);
const REAL_CATALOG = {
  async read(path: string): Promise<string | undefined> {
    try {
      return await Deno.readTextFile(path);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
  },
};

const UNIQUE_ISOLATED_CATALOG = {
  read(path: string): Promise<string | undefined> {
    if (!path.endsWith("dl05-arm-thickness-isolated.json")) {
      return Promise.resolve(undefined);
    }
    return REAL_CATALOG.read(path);
  },
};

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

Deno.test("sensitivity-study seal review refuses an unknown catalog id without opening a file", async () => {
  let reads = 0;
  const review = new PrepareProjectSensitivityStudySealReview({
    snapshots: new MemorySnapshots(basisSnapshot()),
    catalogReader: {
      read: () => {
        reads += 1;
        return Promise.resolve("{}");
      },
    },
    admissions: MATCHING_ADMISSIONS,
  });
  const result = await review.execute({
    projectId: PROJECT_ID,
    caseId: "cm-01-retired-replay",
    basis: basisRef(),
  });
  assertEquals(result.status, "unresolved");
  assertEquals(result.decisionParameters, undefined);
  assertEquals(result.next, undefined);
  assertEquals(result.diagnostics.map((item) => item.code), ["catalog-absent"]);
  assertEquals(reads, 0);
});

Deno.test("sensitivity-study seal review selects the unique template when caseId is omitted", async () => {
  const snapshot = basisSnapshot();
  const review = new PrepareProjectSensitivityStudySealReview({
    snapshots: new MemorySnapshots(snapshot),
    projects: new MemoryProjects(snapshot),
    catalogReader: UNIQUE_ISOLATED_CATALOG,
    admissions: MATCHING_ADMISSIONS,
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
    id: "analyze.seal-sensitivity-study",
    version: "1",
    bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
  });
  assertEquals(
    result.next.propose.arguments.proposal.parameters,
    result.decisionParameters,
  );
  assertEquals(
    result.next.append.arguments.workItems[0]?.id,
    "wi-sensitivity-seal-dl05-arm-thickness-isolated",
  );
  assertEquals(
    result.next.propose.arguments.decisionId,
    "dec-sensitivity-seal-dl05-arm-thickness-isolated",
  );
});

Deno.test("sensitivity-study seal review is catalog-ambiguous when several templates bind the project", async () => {
  const snapshot = basisSnapshot();
  const review = new PrepareProjectSensitivityStudySealReview({
    snapshots: new MemorySnapshots(snapshot),
    projects: new MemoryProjects(snapshot),
    catalogReader: REAL_CATALOG,
    admissions: MATCHING_ADMISSIONS,
  });
  const result = await review.execute({
    projectId: PROJECT_ID,
    basis: basisRef(),
  });
  assertEquals(result.status, "unresolved");
  assertEquals(result.decisionParameters, undefined);
  assertEquals(result.next, undefined);
  assertEquals(result.diagnostics.map((item) => item.code), ["catalog-ambiguous"]);
});

Deno.test("sensitivity-study seal review is catalog-absent for desk-lamp-dl06 and emits no next", async () => {
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
  assertEquals(result.decisionParameters, undefined);
  assertEquals(result.next, undefined);
  assertEquals(result.diagnostics.map((item) => item.code), ["catalog-absent"]);
});

Deno.test("sensitivity-study seal review compiles sensitivity.case.* from the isolated template and a matching admission", async () => {
  const snapshot = basisSnapshot();
  const review = new PrepareProjectSensitivityStudySealReview({
    snapshots: new MemorySnapshots(snapshot),
    projects: new MemoryProjects(snapshot),
    catalogReader: REAL_CATALOG,
    admissions: MATCHING_ADMISSIONS,
  });
  const result = await review.execute({
    projectId: PROJECT_ID,
    caseId: CASE_ID,
    basis: basisRef(),
  });
  assertEquals(result.status, "resolved");
  if (result.status !== "resolved") return;
  assertExists(result.decisionParameters);
  const parsed = parseSensitivityStudyDecisionParameters(result.decisionParameters);
  assertEquals(parsed.id, CASE_ID);
  assertEquals(
    parsed.cadSource.artifactUri,
    `thread-artifact://${PROJECT_ID}/${ADMISSION_ID}`,
  );
  assertEquals(parsed.cadSource.sha256, ADMISSION_DIGEST);
  assertEquals(parsed.target.semanticKey, "arm_thickness");
  assertEquals(parsed.metrics.map((item) => item.id), [
    "maxDisplacement",
    "maxVonMises",
  ]);
  assertEquals(result.selected.admissionArtifactId, ADMISSION_ID);
  assertEquals(
    result.next.append.arguments.workItems[0]?.operation.id,
    "analyze.seal-sensitivity-study",
  );
});

Deno.test("sensitivity-study seal review emits no parameters when the admission is missing", async () => {
  const snapshot = basisSnapshot({ omitAdmission: true });
  const review = new PrepareProjectSensitivityStudySealReview({
    snapshots: new MemorySnapshots(snapshot),
    projects: new MemoryProjects(snapshot),
    catalogReader: REAL_CATALOG,
    admissions: { read: () => Promise.resolve(undefined) },
  });
  const result = await review.execute({
    projectId: PROJECT_ID,
    caseId: CASE_ID,
    basis: basisRef(),
  });
  assertEquals(result.status, "unresolved");
  assertEquals(result.decisionParameters, undefined);
  assertEquals(result.next, undefined);
  assertEquals(result.diagnostics.map((item) => item.code), ["admission-absent"]);
});

Deno.test("sensitivity-study seal review emits no parameters when semanticKey is unbound", async () => {
  const snapshot = basisSnapshot();
  const review = new PrepareProjectSensitivityStudySealReview({
    snapshots: new MemorySnapshots(snapshot),
    projects: new MemoryProjects(snapshot),
    catalogReader: REAL_CATALOG,
    admissions: {
      read: () =>
        Promise.resolve(
          matchingAdmission("size_z = 50\nresult = Box(1, 1, size_z)\n", "size_z"),
        ),
    },
  });
  const result = await review.execute({
    projectId: PROJECT_ID,
    caseId: CASE_ID,
    basis: basisRef(),
  });
  assertEquals(result.status, "unresolved");
  assertEquals(result.decisionParameters, undefined);
  assertEquals(result.next, undefined);
  assertEquals(
    result.diagnostics.map((item) => item.code),
    ["semantic-key-unbound"],
  );
});

Deno.test("sensitivity-study seal review rejects cad-model, write-geometry and STEP as cadSource", async () => {
  const snapshot = basisSnapshot({ lookalikesOnly: true });
  const review = new PrepareProjectSensitivityStudySealReview({
    snapshots: new MemorySnapshots(snapshot),
    projects: new MemoryProjects(snapshot),
    catalogReader: REAL_CATALOG,
    admissions: MATCHING_ADMISSIONS,
  });
  const result = await review.execute({
    projectId: PROJECT_ID,
    caseId: CASE_ID,
    basis: basisRef(),
  });
  assertEquals(result.status, "unresolved");
  assertEquals(result.decisionParameters, undefined);
  assertEquals(result.next, undefined);
  assertEquals(result.diagnostics.map((item) => item.code), ["cad-source-lookalike"]);
});

Deno.test("sensitivity-study seal review refuses latest as an unresolved basis-latest", async () => {
  const review = new PrepareProjectSensitivityStudySealReview({
    snapshots: new MemorySnapshots(basisSnapshot()),
    catalogReader: REAL_CATALOG,
    admissions: MATCHING_ADMISSIONS,
  });
  const result = await review.execute({
    projectId: PROJECT_ID,
    basis: { ...basisRef(), snapshotId: "latest" },
  });
  assertEquals(result.status, "unresolved");
  assertEquals(result.decisionParameters, undefined);
  assertEquals(result.diagnostics.map((item) => item.code), ["basis-latest"]);
});

Deno.test("sensitivity-study seal review emits no paste-ready hop from a historical project basis", async () => {
  const snapshot = basisSnapshot();
  const current = {
    kind: "thread-snapshot" as const,
    snapshotId: "snap-sensitivity-seal-current",
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
  const review = new PrepareProjectSensitivityStudySealReview({
    snapshots: new MemorySnapshots(snapshot),
    projects: { get: () => Promise.resolve(project) },
    catalogReader: REAL_CATALOG,
    admissions: MATCHING_ADMISSIONS,
  });
  const result = await review.execute({
    projectId: PROJECT_ID,
    caseId: CASE_ID,
    basis: basisRef(),
  });
  assertEquals(result.status, "unavailable");
  assertEquals(result.next, undefined);
  assertEquals(result.decisionParameters, undefined);
  assertEquals(result.diagnostics.map((item) => item.code), ["basis-not-current"]);
});

Deno.test("sensitivity-study seal review is unresolved when compiled identities already exist", async () => {
  const snapshot = basisSnapshot();
  const project = {
    ...projectState(snapshot),
    workItems: [{ id: "wi-sensitivity-seal-dl05-arm-thickness-isolated" }],
    decisions: [{ id: "dec-sensitivity-seal-dl05-arm-thickness-isolated" }],
  } as unknown as EngineeringProjectSnapshot;
  const review = new PrepareProjectSensitivityStudySealReview({
    snapshots: new MemorySnapshots(snapshot),
    projects: { get: () => Promise.resolve(project) },
    catalogReader: REAL_CATALOG,
    admissions: MATCHING_ADMISSIONS,
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

Deno.test(
  "sensitivity-study seal review compiles a sealable case from the unique signed catalog offer",
  async () => {
    const fixture = await signedOfferFixture();
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
    assertEquals(parsed.cadSource.artifactUri, fixture.cadSourceUri);
    assertEquals(
      result.next.append.arguments.workItems[0]?.id,
      "wi-sensitivity-seal-desk-lamp-dl06-arm-cantilever-arm_thickness",
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
  "sensitivity-study seal review keeps a named historical catalog id even when an offer is present",
  async () => {
    const snapshot = basisSnapshot({ extraOffer: true });
    const review = new PrepareProjectSensitivityStudySealReview({
      snapshots: new MemorySnapshots(snapshot),
      projects: new MemoryProjects(snapshot),
      catalogReader: REAL_CATALOG,
      admissions: MATCHING_ADMISSIONS,
    });
    const result = await review.execute({
      projectId: PROJECT_ID,
      caseId: CASE_ID,
      basis: basisRef(),
    });
    assertEquals(result.status, "resolved");
    if (result.status !== "resolved") return;
    assertEquals(result.caseId, CASE_ID);
    assertEquals(result.selected.authority, "catalog");
    const parsed = parseSensitivityStudyDecisionParameters(
      result.decisionParameters,
    );
    assertEquals(parsed.step, { value: 1, unit: "mm" });
  },
);

Deno.test(
  "sensitivity-study seal review falls through catalog-ambiguous to a unique signed offer",
  async () => {
    const snapshot = basisSnapshot({ extraOffer: true });
    const review = new PrepareProjectSensitivityStudySealReview({
      snapshots: new MemorySnapshots(snapshot),
      projects: new MemoryProjects(snapshot),
      catalogReader: REAL_CATALOG,
      admissions: MATCHING_ADMISSIONS,
    });
    const result = await review.execute({
      projectId: PROJECT_ID,
      basis: basisRef(),
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
    const fixture = await signedOfferFixture({ extraOffer: true });
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
    const fixture = await signedOfferFixture({
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
    const fixture = await signedOfferFixture();
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
    const fixture = await signedOfferFixture({ truncatedOffer: true });
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
    const fixture = await signedOfferFixture({ extraProofSameDigest: true });
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
    const fixture = await signedOfferFixture({ invalidProofSibling: true });
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
  const snapshot = basisSnapshot();
  const review = new PrepareProjectSensitivityStudySealReview({
    snapshots: new MemorySnapshots(snapshot),
    projects: new MemoryProjects(snapshot),
    catalogReader: REAL_CATALOG,
    admissions: { read: () => Promise.resolve(undefined) },
  });
  const result = await review.execute({
    projectId: PROJECT_ID,
    caseId: CASE_ID,
    basis: basisRef(),
  });
  assertEquals(result.status, "unavailable");
  assertEquals(result.decisionParameters, undefined);
  assertEquals(result.next, undefined);
  assertEquals(
    result.diagnostics.map((item) => item.code),
    ["admission-unavailable"],
  );
});

function basisRef() {
  return {
    kind: "thread-snapshot" as const,
    snapshotId: "snap-sensitivity-seal",
    revision: 5,
    subjectId: SUBJECT_ID,
  };
}

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
        tool: "compile.seal-admission@1",
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
    schemaVersion: "1.0",
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

const LINKED_SOURCE_TEXT =
  "from build123d import Box\narm_thickness = 10\nresult = Box(220, 20, arm_thickness)\n";
const DL06_TARGET_ELEMENT_ID = "7dda85d1-764e-4329-95ea-09052355cc47";

async function signedOfferFixture(
  options: {
    readonly extraOffer?: boolean;
    readonly admissionSource?: string;
    readonly truncatedOffer?: boolean;
    readonly extraProofSameDigest?: boolean;
    readonly invalidProofSibling?: boolean;
  } = {},
) {
  const sourceText = LINKED_SOURCE_TEXT;
  const proofCase = await linkedProofCase(sourceText);
  const admissionDocument = await linkedAdmissionDocument(sourceText);
  const liveDocument = await linkedAdmissionDocument(
    options.admissionSource ?? sourceText,
  );
  const offer = compileSensitivityCatalogOfferFromAdmission({
    proofCase,
    proofDigest: (await sha256Fingerprint(proofCase)).digest,
    admissionArtifact: {
      id: ADMISSION_ID,
      fingerprint: { algorithm: "sha256", digest: ADMISSION_DIGEST },
    },
    document: admissionDocument as never,
  });
  if (offer.status !== "ready-for-opt-in") {
    throw new Error(`Expected a ready offer, got ${offer.status}.`);
  }
  const sealedOffer = options.truncatedOffer
    ? (() => {
      const { authority: _dropped, ...truncated } = offer;
      return truncated;
    })()
    : offer;
  const offerDigest = (await sha256Fingerprint(sealedOffer)).digest;
  const proofCaptureRecord = {
    schemaVersion: "fea-proof-case-capture/1.0",
    operation: { id: "verify.seal-proof-case", version: "1" },
    trustedRunId: "run-seal",
    proofDigest: (await sha256Fingerprint(proofCase)).digest,
    canonicalProofText: canonicalProofText(proofCase),
    geometryArtifact: {
      id: "geometry-1",
      fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
      producerRunId: "run-geom",
    },
    stepArtifact: {
      id: "step-1",
      fingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
      producerRunId: "run-geom",
      bytes: proofCase.expectedCadArtifact.bytes,
    },
    requirementsArtifact: {
      id: "req-1",
      fingerprint: { algorithm: "sha256", digest: "d".repeat(64) },
      producerRunId: "run-req",
    },
    requirementsElementId: proofCase.requirementsSource.elementId,
    seedIdentity: {
      editingContextId: proofCase.requirementsSource.editingContextId,
      elementId: proofCase.requirementsSource.elementId,
    },
    sealedAt: AT,
  };
  const proofCaptureText = deterministicJson(proofCaptureRecord);
  await parseFeaProofCaseCapture(proofCaptureText);
  const proofCaptureFp = await sha256Fingerprint(JSON.parse(proofCaptureText));
  const proofArtifactId = `fea-proof-${proofCaptureFp.digest}`;
  const offerCaptureRecord = {
    schemaVersion: SENSITIVITY_CATALOG_OFFER_CAPTURE_SCHEMA,
    operation: { id: "verify.seal-proof-case", version: "1" },
    trustedRunId: "run-seal",
    sealedAt: AT,
    offerDigest,
    offer: sealedOffer,
  };
  const offerCaptureText = deterministicJson(offerCaptureRecord);
  const offerCaptureFp = await sha256Fingerprint(JSON.parse(offerCaptureText));
  const offerArtifactId = `sensitivity-catalog-offer-${offerCaptureFp.digest}`;
  const artifacts = [
    artifact(ADMISSION_ID, "Compilation admission", "document", ADMISSION_DIGEST, {
      uri: `casys://technical-compilation-admission-capture/sha256/${ADMISSION_DIGEST}`,
      mediaType: "application/json",
      tool: "compile.seal-admission@1",
    }),
    artifact(proofArtifactId, "FEA proof", "document", proofCaptureFp.digest, {
      uri: `casys://fea-proof-case-capture/sha256/${proofCaptureFp.digest}`,
      mediaType: "application/json",
      tool: "verify.seal-proof-case@1",
    }),
    {
      ...artifact(offerArtifactId, "Catalog offer", "document", offerCaptureFp.digest, {
        uri:
          `casys://sensitivity-catalog-offer-capture/sha256/${offerCaptureFp.digest}`,
        mediaType: "application/json",
        tool: "verify.seal-proof-case@1",
      }),
      version: offerDigest,
    },
    ...(options.extraOffer
      ? [artifact(
        "sensitivity-catalog-offer-sibling",
        "Sibling offer",
        "document",
        "e".repeat(64),
        {
          uri: "casys://sensitivity-catalog-offer-capture/sha256/" + "e".repeat(64),
          mediaType: "application/json",
          tool: "verify.seal-proof-case@1",
        },
      )]
      : []),
    ...(options.extraProofSameDigest
      ? [artifact(
        "fea-proof-duplicate",
        "FEA proof duplicate",
        "document",
        "9".repeat(64),
        {
          uri: "casys://fea-proof-case-capture/sha256/" + "9".repeat(64),
          mediaType: "application/json",
          tool: "verify.seal-proof-case@1",
        },
      )]
      : []),
    ...(options.invalidProofSibling
      ? [artifact(
        "fea-proof-invalid",
        "Invalid FEA proof",
        "document",
        "f".repeat(64),
        {
          uri: "casys://fea-proof-case-capture/sha256/" + "f".repeat(64),
          mediaType: "application/json",
          tool: "verify.seal-proof-case@1",
        },
      )]
      : []),
  ];
  const snapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "snap-sensitivity-offer",
    revision: 7,
    generatedAt: AT,
    subject: {
      id: "project:desk-lamp-dl06",
      name: "Heron",
      kind: "system",
      version: "r7",
      modelArtifactId: ADMISSION_ID,
    },
    freshness: fresh(),
    changeSet: {
      id: "change-set.sensitivity-offer",
      name: "Signed catalog offer",
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
  return {
    snapshot,
    basis: {
      kind: "thread-snapshot" as const,
      snapshotId: snapshot.id,
      revision: snapshot.revision,
      subjectId: snapshot.subject.id,
    },
    catalogOffers: new MemoryCaptures([[offerCaptureFp.digest, offerCaptureText]]),
    proofCaptures: new MemoryCaptures([
      [proofCaptureFp.digest, proofCaptureText],
      ...(options.extraProofSameDigest
        ? [["9".repeat(64), proofCaptureText] as const]
        : []),
      ...(options.invalidProofSibling ? [["f".repeat(64), "{not-json"] as const] : []),
    ]),
    admissions: {
      read: () =>
        Promise.resolve({
          document: liveDocument,
        } as unknown as ReopenedTechnicalCompilationAdmission),
    },
    cadSourceUri: `thread-artifact://desk-lamp-dl06/${ADMISSION_ID}`,
  };
}

async function linkedProofCase(sourceText: string): Promise<MechanicalProofCase> {
  const base = validateMechanicalProofCase(
    JSON.parse(
      await Deno.readTextFile(
        new URL(
          "../../../../../config/mechanical-proof-cases/desk-lamp-dl06-arm-cantilever.json",
          import.meta.url,
        ),
      ),
    ),
  );
  if (base.cadSource.kind !== "parametric") {
    throw new Error("Expected a parametric dl06 proof.");
  }
  const fingerprint = await fingerprintTechnicalSourceText(sourceText);
  return validateMechanicalProofCase({
    ...base,
    cadSource: {
      ...base.cadSource,
      generator: {
        ...base.cadSource.generator,
        definition: {
          mediaType: "text/x-python",
          sha256: fingerprint.digest,
          bytes: new TextEncoder().encode(sourceText).byteLength,
        },
      },
    },
  });
}

async function linkedAdmissionDocument(sourceText: string) {
  const hasLever = sourceText.includes("arm_thickness = 10");
  const sourceFingerprint = await fingerprintTechnicalSourceText(sourceText);
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
    schemaVersion: "source-analysis/1.0" as const,
    source: {
      id: "source.cad",
      role: "cad-script" as const,
      language: "python" as const,
      fingerprint: sourceFingerprint,
    },
    analyzer: { id: "build123d-qualified-lezer", version: "1.6.0" },
    policy: {
      profile: "build123d-closed-subset-v1",
      status: "passed" as const,
      findings: [],
    },
    symbols: hasLever ? [parameter, result] : [result],
    dependencies: hasLever
      ? [{
        id: "dependency.arm-thickness.result",
        kind: "structural-incidence" as const,
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
        relation: "parameterizes" as const,
      }]
      : []),
    {
      id: "binding.result",
      sourceId: "source.cad",
      sourceSymbolId: result.id,
      sysmlElementId: DL06_TARGET_ELEMENT_ID,
      sysmlElementKind: "PartDefinition",
      relation: "represents" as const,
    },
  ];
  return {
    inputManifest: {
      sources: [{
        sourceText,
        analysis,
      }],
      bindings,
    },
    projections: [{
      target: "build123d-source" as const,
      status: "ready-for-review" as const,
      sources: [{
        sourceText,
        analysis,
        analysisFingerprint: { algorithm: "sha256" as const, digest: "2".repeat(64) },
        bindings,
      }],
    }],
  };
}

class MemoryCaptures {
  constructor(private readonly items: ReadonlyArray<readonly [string, string]>) {}
  read(fingerprint: ContentFingerprint) {
    const found = this.items.find((item) => item[0] === fingerprint.digest);
    return Promise.resolve(found?.[1]);
  }
}
