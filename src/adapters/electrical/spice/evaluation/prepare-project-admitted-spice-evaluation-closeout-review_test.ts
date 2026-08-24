import { assertEquals, assertRejects } from "@std/assert";
import {
  createAdmittedSpiceCloseoutEvidenceFixture,
  SPICE_CLOSEOUT_REVIEW_PROJECT_ID,
} from "../../../../testing/admitted-spice-evaluation-closeout-fixture.ts";
import {
  deterministicJson,
  fingerprintsEqual,
} from "../../../../domain/kernel/deterministic-json.ts";
import { spiceDocumentaryRequirementBindings } from "../../../../domain/electrical/spice/evaluation/spice-documentary-requirement-binding.ts";
import { requirementEvaluationIdentity } from "../../../../domain/thread/requirement-evaluation-identity.ts";
import { encodeSpiceAdmittedObservationEvaluationCloseoutAdmission } from "../../../../domain/electrical/spice/evaluation/admitted-observation-evaluation-closeout-proposal.ts";
import type { ThreadSnapshot } from "../../../../domain/thread/thread-snapshot.ts";
import { PrepareProjectAdmittedSpiceEvaluationCloseoutReview } from "./prepare-project-admitted-spice-evaluation-closeout-review.ts";
import {
  admittedSpiceEvaluationCloseoutAdmission,
  AdmittedSpiceEvaluationCloseoutResolutionError,
  resolveAdmittedSpiceEvaluationCloseoutEvidence,
} from "./admitted-spice-observation-evaluation-closeout-evidence-resolver.ts";

Deno.test(
  "admitted SPICE closeout review accepts only projectId and derives both closeouts from the unique current L4",
  async () => {
    const fixture = await createAdmittedSpiceCloseoutEvidenceFixture();
    const review = new PrepareProjectAdmittedSpiceEvaluationCloseoutReview({
      projects: { get: () => Promise.resolve(fixture.project) },
      snapshots: memorySnapshots(fixture.snapshot, fixture.previousSnapshot),
      ...fixture.dependencies,
    });
    const beforeRevision = fixture.project.revision;
    const beforeCaptureSaves = fixture.evaluationCaptures.saves;
    const beforeSheetSaves = fixture.sheetCaptures.saves;
    const resolved = await review.execute({
      projectId: SPICE_CLOSEOUT_REVIEW_PROJECT_ID,
    });
    assertEquals(resolved.status, "resolved");
    if (resolved.status !== "resolved") {
      throw new Error("Expected resolved closeout evidence.");
    }
    assertEquals(resolved.selected.capture.id, fixture.l4Artifact?.id);
    assertEquals(resolved.selected.sheet.id, fixture.sheet.id);
    assertEquals(resolved.selected.evaluations[0]?.status, "unresolved");
    assertEquals(
      resolved.selected.evaluations[0]?.criterionId,
      "criterion-node-voltage",
    );
    assertEquals(resolved.selected.limitations.l4PassIsNotL5, true);
    assertEquals(resolved.selected.accept.admission.consequence, "accept");
    assertEquals(resolved.selected.reject.admission.consequence, "reject");
    assertEquals(
      resolved.selected.accept.admission.capture,
      resolved.selected.reject.admission.capture,
    );
    assertEquals(
      resolved.selected.accept.admission.sheet,
      resolved.selected.reject.admission.sheet,
    );
    assertEquals(
      resolved.selected.accept.admission.basis,
      resolved.selected.reject.admission.basis,
    );
    assertEquals(
      deterministicJson(resolved.selected.accept.decisionParameters) ===
        deterministicJson(resolved.selected.reject.decisionParameters),
      false,
    );
    assertEquals(fixture.project.revision, beforeRevision);
    assertEquals(fixture.evaluationCaptures.saves, beforeCaptureSaves);
    assertEquals(fixture.sheetCaptures.saves, beforeSheetSaves);
    assertEquals(fixture.evaluationCaptures.reads > 0, true);

    const extra = await review.execute({
      projectId: SPICE_CLOSEOUT_REVIEW_PROJECT_ID,
      consequence: "accept",
      capture: fixture.l4Artifact?.id,
      provider: "ngspice",
      tool: "simulate.run-admitted-spice@1",
      args: { image: "latest" },
      value: 3,
      unit: "V",
      spiceText: "Vin in 0 5",
    });
    assertEquals(extra, {
      status: "unavailable",
      diagnostic: {
        code: "invalid_request",
        message:
          "The admitted SPICE evaluation-closeout review request must name exactly one project.",
      },
    });
  },
);

Deno.test(
  "admitted SPICE closeout review preserves pass/fail/unresolved/error and never auto-decides",
  async () => {
    for (const status of ["pass", "fail", "unresolved", "error"] as const) {
      const fixture = await createAdmittedSpiceCloseoutEvidenceFixture({
        evaluationStatus: status,
      });
      const review = new PrepareProjectAdmittedSpiceEvaluationCloseoutReview({
        projects: { get: () => Promise.resolve(fixture.project) },
        snapshots: memorySnapshots(fixture.snapshot, fixture.previousSnapshot),
        ...fixture.dependencies,
      });
      const resolved = await review.execute({
        projectId: SPICE_CLOSEOUT_REVIEW_PROJECT_ID,
      });
      assertEquals(resolved.status, "resolved");
      if (resolved.status !== "resolved") {
        throw new Error("Expected resolved closeout evidence.");
      }
      assertEquals(resolved.selected.evaluations.map((item) => item.status), [
        status,
      ]);
      assertEquals(resolved.selected.limitations.sheetScope, fixture.sheet.scope);
      assertEquals(
        resolved.selected.limitations.sheetLimitations,
        fixture.sheet.limitations,
      );
      assertEquals(resolved.selected.accept.admission.consequence, "accept");
      assertEquals(resolved.selected.reject.admission.consequence, "reject");
      assertEquals("acceptanceEligibility" in resolved.selected, false);
      assertEquals(
        resolved.selected.accept.decisionParameters.some((parameter) =>
          /scope|limitation|unit|value|comparison|message/i.test(parameter.key)
        ),
        false,
      );
    }
  },
);

Deno.test(
  "admitted SPICE closeout review fails closed on missing, duplicate, stale, historical, or foreign evidence",
  async () => {
    const cases: Array<{
      readonly name: string;
      readonly options?: Parameters<
        typeof createAdmittedSpiceCloseoutEvidenceFixture
      >[0];
      readonly mutate?: (
        fixture: Awaited<
          ReturnType<typeof createAdmittedSpiceCloseoutEvidenceFixture>
        >,
      ) => void;
      readonly status: "unavailable" | "unresolved";
    }> = [
      {
        name: "zero L4",
        options: { includeL4Artifact: false },
        status: "unavailable",
      },
      {
        name: "two L4s",
        options: { l4Count: 2 },
        status: "unresolved",
      },
      {
        name: "stale L4",
        options: { stale: true },
        status: "unavailable",
      },
      {
        name: "archived L4",
        options: { archived: true },
        status: "unavailable",
      },
      {
        name: "wrong producer",
        options: { producerTool: "simulate.run-admitted-spice@1" },
        status: "unresolved",
      },
      {
        name: "unattached producer run",
        options: { attachProducerRun: false },
        status: "unresolved",
      },
      {
        name: "historical producer result",
        options: { producerResultRevision: 99 },
        status: "unresolved",
      },
      {
        name: "missing sheet",
        options: { includeSheet: false },
        status: "unavailable",
      },
      {
        name: "foreign sheet",
        options: { sheetForeignProject: true },
        status: "unresolved",
      },
      {
        name: "mismatched capture URI",
        options: { captureUri: "casys://foreign-capture/sha256/deadbeef" },
        status: "unresolved",
      },
      {
        name: "non-L4 capture bytes",
        options: {
          l4Body: { kind: "spice-netlist", spiceText: "Vin in 0 5" },
        },
        status: "unresolved",
      },
      {
        name: "missing L3 result CAS",
        options: { missingResult: true },
        status: "unavailable",
      },
    ];
    for (const testCase of cases) {
      const fixture = await createAdmittedSpiceCloseoutEvidenceFixture(
        testCase.options,
      );
      testCase.mutate?.(fixture);
      const review = new PrepareProjectAdmittedSpiceEvaluationCloseoutReview({
        projects: { get: () => Promise.resolve(fixture.project) },
        snapshots: memorySnapshots(fixture.snapshot, fixture.previousSnapshot),
        ...fixture.dependencies,
      });
      const result = await review.execute({
        projectId: SPICE_CLOSEOUT_REVIEW_PROJECT_ID,
      });
      assertEquals(result.status, testCase.status, testCase.name);
      if (result.status === "resolved") {
        throw new Error(`${testCase.name} unexpectedly resolved.`);
      }
    }
  },
);

Deno.test(
  "admitted SPICE closeout review and resolver recross the same L4 and L3 identities",
  async () => {
    const fixture = await createAdmittedSpiceCloseoutEvidenceFixture();
    const review = new PrepareProjectAdmittedSpiceEvaluationCloseoutReview({
      projects: { get: () => Promise.resolve(fixture.project) },
      snapshots: memorySnapshots(fixture.snapshot, fixture.previousSnapshot),
      ...fixture.dependencies,
    });
    const reviewed = await review.execute({
      projectId: SPICE_CLOSEOUT_REVIEW_PROJECT_ID,
    });
    const resolved = await resolveAdmittedSpiceEvaluationCloseoutEvidence(
      fixture.dependencies,
      {
        project: fixture.project,
        basis: fixture.basis,
        snapshot: fixture.snapshot,
      },
    );
    assertEquals(reviewed.status, "resolved");
    if (reviewed.status !== "resolved") {
      throw new Error("Expected resolved closeout evidence.");
    }
    assertEquals(
      reviewed.selected.accept.admission,
      admittedSpiceEvaluationCloseoutAdmission(resolved, "accept"),
    );
    assertEquals(
      reviewed.selected.reject.admission,
      admittedSpiceEvaluationCloseoutAdmission(resolved, "reject"),
    );
    assertEquals(
      reviewed.selected.accept.decisionParameters,
      encodeSpiceAdmittedObservationEvaluationCloseoutAdmission(
        reviewed.selected.accept.admission,
      ),
    );
    assertEquals(resolved.l3Run.id, "run.admitted-spice");
    assertEquals(resolved.result.id, fixture.sheet.spice.result.id);
    const sealFingerprint = fixture.sheetSeal?.fingerprint;
    if (!sealFingerprint) {
      throw new Error("Expected a sealed method-sheet capture artifact.");
    }
    assertEquals(
      fingerprintsEqual(fixture.sheetFingerprint, sealFingerprint),
      false,
    );
    const contentRequirementId = spiceDocumentaryRequirementBindings({
      criterion: fixture.sheet.criteria[0]!,
      methodSheetFingerprint: fixture.sheetFingerprint,
    })[0]!.requirementId;
    const sealRequirementId = spiceDocumentaryRequirementBindings({
      criterion: fixture.sheet.criteria[0]!,
      methodSheetFingerprint: sealFingerprint,
    })[0]!.requirementId;
    assertEquals(contentRequirementId === sealRequirementId, false);
    assertEquals(fixture.snapshot.requirements[0]?.id, contentRequirementId);
    assertEquals(resolved.evaluations[0]?.requirementId, contentRequirementId);
    assertEquals(
      fixture.snapshot.requirements[0]?.version,
      fixture.sheetFingerprint.digest,
    );
  },
);

Deno.test(
  "closeout resolver recrosses the capture-addressed L4 evaluation and refuses an unversioned id",
  async () => {
    const fixture = await createAdmittedSpiceCloseoutEvidenceFixture({
      evaluationStatus: "pass",
    });
    const resolved = await resolveAdmittedSpiceEvaluationCloseoutEvidence(
      fixture.dependencies,
      {
        project: fixture.project,
        basis: fixture.basis,
        snapshot: fixture.snapshot,
      },
    );
    const requirementId = fixture.snapshot.evaluations[0]!.requirementId;
    const expectedId = requirementEvaluationIdentity({
      requirementId,
      evidenceFingerprint: fixture.l4Artifact!.fingerprint,
    }).id;
    assertEquals(resolved.evaluations[0]?.id, expectedId);
    assertEquals(resolved.evaluations[0]?.id.includes(requirementId), true);
    assertEquals(
      resolved.evaluations[0]?.id.endsWith(
        fixture.l4Artifact!.fingerprint.digest,
      ),
      true,
    );
    assertEquals(
      resolved.evaluations[0]?.id === `${requirementId}-evaluation`,
      false,
    );

    const unversioned = structuredClone(fixture.snapshot) as ThreadSnapshot;
    (unversioned.evaluations[0] as { id: string }).id = `${requirementId}-evaluation`;
    await assertRejects(
      () =>
        resolveAdmittedSpiceEvaluationCloseoutEvidence(fixture.dependencies, {
          project: fixture.project,
          basis: fixture.basis,
          snapshot: unversioned,
        }),
      AdmittedSpiceEvaluationCloseoutResolutionError,
      "is not the exact capture outcome topology",
    );

    const foreign = structuredClone(fixture.snapshot) as ThreadSnapshot;
    (foreign.evaluations[0] as { id: string }).id = requirementEvaluationIdentity({
      requirementId,
      evidenceFingerprint: { algorithm: "sha256", digest: "f".repeat(64) },
    }).id;
    await assertRejects(
      () =>
        resolveAdmittedSpiceEvaluationCloseoutEvidence(fixture.dependencies, {
          project: fixture.project,
          basis: fixture.basis,
          snapshot: foreign,
        }),
      AdmittedSpiceEvaluationCloseoutResolutionError,
      "is not the exact capture outcome topology",
    );
  },
);

function memorySnapshots(
  snapshot: ThreadSnapshot,
  previous?: ThreadSnapshot,
) {
  const items = new Map<string, ThreadSnapshot>([[snapshot.id, snapshot]]);
  if (previous) items.set(previous.id, previous);
  return {
    get: (id: string) => Promise.resolve(items.get(id)),
    getFresh: (id: string) => Promise.resolve(items.get(id)),
    latest: () => Promise.resolve(snapshot),
    save: () => Promise.reject(new Error("review must not write snapshots")),
  };
}
