import { assertEquals } from "@std/assert";
import {
  CLOSEOUT_REVIEW_PROJECT_ID,
  createAdmittedModelicaCloseoutEvidenceFixture,
} from "../../../testing/admitted-modelica-evaluation-closeout-fixture.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import {
  encodeAdmittedObservationEvaluationCloseoutAdmission,
} from "../../../domain/modelica/evaluation/admitted-observation-evaluation-closeout-proposal.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import { PrepareProjectAdmittedModelicaEvaluationCloseoutReview } from "./prepare-project-admitted-modelica-evaluation-closeout-review.ts";
import {
  admittedModelicaEvaluationCloseoutAdmission,
  resolveAdmittedModelicaEvaluationCloseoutEvidence,
} from "./admitted-observation-evaluation-closeout-evidence-resolver.ts";

Deno.test(
  "admitted Modelica closeout review accepts only projectId and derives both closeouts from the unique current L4",
  async () => {
    const fixture = await createAdmittedModelicaCloseoutEvidenceFixture();
    const review = new PrepareProjectAdmittedModelicaEvaluationCloseoutReview({
      projects: { get: () => Promise.resolve(fixture.project) },
      snapshots: memorySnapshots(fixture.snapshot, fixture.previousSnapshot),
      ...fixture.dependencies,
    });
    const beforeRevision = fixture.project.revision;
    const beforeCaptureSaves = fixture.evaluationCaptures.saves;
    const beforeSheetSaves = fixture.sheetCaptures.saves;
    const resolved = await review.execute({
      projectId: CLOSEOUT_REVIEW_PROJECT_ID,
    });
    assertEquals(resolved.status, "resolved");
    if (resolved.status !== "resolved") {
      throw new Error("Expected resolved closeout evidence.");
    }
    assertEquals(resolved.selected.capture.id, fixture.l4Artifact?.id);
    assertEquals(resolved.selected.sheet.id, fixture.sheet.id);
    assertEquals(resolved.selected.evaluations[0]?.status, "unresolved");
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
      projectId: CLOSEOUT_REVIEW_PROJECT_ID,
      consequence: "accept",
      capture: fixture.l4Artifact?.id,
      provider: "syson",
      tool: "syson_constraint_evaluate",
      args: { solver: "dassl" },
      value: 80,
      unit: "K",
      modelicaText: "model X end X;",
    });
    assertEquals(extra, {
      status: "unavailable",
      diagnostic: {
        code: "invalid_request",
        message:
          "The admitted Modelica evaluation-closeout review request must name exactly one project.",
      },
    });
  },
);

Deno.test(
  "admitted Modelica closeout review preserves pass/fail/unresolved/error and never auto-decides",
  async () => {
    for (const status of ["pass", "fail", "unresolved", "error"] as const) {
      const fixture = await createAdmittedModelicaCloseoutEvidenceFixture({
        evaluationStatus: status,
      });
      const review = new PrepareProjectAdmittedModelicaEvaluationCloseoutReview({
        projects: { get: () => Promise.resolve(fixture.project) },
        snapshots: memorySnapshots(fixture.snapshot, fixture.previousSnapshot),
        ...fixture.dependencies,
      });
      const resolved = await review.execute({
        projectId: CLOSEOUT_REVIEW_PROJECT_ID,
      });
      assertEquals(resolved.status, "resolved");
      if (resolved.status !== "resolved") {
        throw new Error("Expected resolved closeout evidence.");
      }
      assertEquals(resolved.selected.evaluations.map((item) => item.status), [
        status,
      ]);
      assertEquals(
        resolved.selected.evaluations[0]?.output.limitation,
        fixture.sheet.outputs[0]?.limitation,
      );
      assertEquals(
        resolved.selected.evaluations[0]?.output.declaredUnit,
        fixture.sheet.outputs[0]?.declaredUnit,
      );
      assertEquals(
        resolved.selected.evaluations[0]?.output.role,
        fixture.sheet.outputs[0]?.role,
      );
      assertEquals(resolved.selected.limitations.sheetScope, fixture.sheet.scope);
      assertEquals(
        resolved.selected.limitations.sheetLimitations,
        fixture.sheet.limitations,
      );
      assertEquals(resolved.selected.accept.admission.consequence, "accept");
      assertEquals(resolved.selected.reject.admission.consequence, "reject");
      assertEquals(
        "acceptanceEligibility" in resolved.selected,
        false,
      );
      assertEquals(
        resolved.selected.accept.decisionParameters.some((parameter) =>
          /scope|limitation|unit|value|comparison|message/i.test(parameter.key)
        ),
        false,
      );
      assertEquals(
        deterministicJson(resolved.selected.accept.admission.capture) ===
          deterministicJson(resolved.selected.reject.admission.capture),
        true,
      );
    }
  },
);

Deno.test(
  "admitted Modelica closeout review fails closed on missing, duplicate, stale, historical, or foreign evidence",
  async () => {
    const cases: Array<{
      readonly name: string;
      readonly options?: Parameters<
        typeof createAdmittedModelicaCloseoutEvidenceFixture
      >[0];
      readonly mutate?: (
        fixture: Awaited<
          ReturnType<typeof createAdmittedModelicaCloseoutEvidenceFixture>
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
        options: { producerTool: "simulate.run-admitted-modelica@1" },
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
          l4Body: { kind: "modelica-qualified-kit", modelicaText: "model Fake" },
        },
        status: "unresolved",
      },
      {
        name: "foreign project identity",
        mutate: (fixture) => {
          const project = fixture.project as unknown as {
            project: { id: string };
          };
          project.project.id = "project.foreign";
        },
        status: "unresolved",
      },
      {
        name: "foreign subject",
        mutate: (fixture) => {
          const project = fixture.project as unknown as {
            project: { subjectId: string };
          };
          project.project.subjectId = "subject.foreign";
        },
        status: "unresolved",
      },
    ];
    for (const testCase of cases) {
      const fixture = await createAdmittedModelicaCloseoutEvidenceFixture(
        testCase.options,
      );
      testCase.mutate?.(fixture);
      const review = new PrepareProjectAdmittedModelicaEvaluationCloseoutReview({
        projects: { get: () => Promise.resolve(fixture.project) },
        snapshots: memorySnapshots(fixture.snapshot, fixture.previousSnapshot),
        ...fixture.dependencies,
      });
      const result = await review.execute({
        projectId: CLOSEOUT_REVIEW_PROJECT_ID,
      });
      assertEquals(result.status, testCase.status, testCase.name);
      if (result.status === "resolved") {
        throw new Error(`${testCase.name} unexpectedly resolved.`);
      }
    }
  },
);

Deno.test(
  "admitted Modelica closeout review and resolver recross the same L4 identities",
  async () => {
    const fixture = await createAdmittedModelicaCloseoutEvidenceFixture();
    const review = new PrepareProjectAdmittedModelicaEvaluationCloseoutReview({
      projects: { get: () => Promise.resolve(fixture.project) },
      snapshots: memorySnapshots(fixture.snapshot, fixture.previousSnapshot),
      ...fixture.dependencies,
    });
    const reviewed = await review.execute({
      projectId: CLOSEOUT_REVIEW_PROJECT_ID,
    });
    const resolved = await resolveAdmittedModelicaEvaluationCloseoutEvidence(
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
      admittedModelicaEvaluationCloseoutAdmission(resolved, "accept"),
    );
    assertEquals(
      reviewed.selected.reject.admission,
      admittedModelicaEvaluationCloseoutAdmission(resolved, "reject"),
    );
    assertEquals(
      reviewed.selected.accept.decisionParameters,
      encodeAdmittedObservationEvaluationCloseoutAdmission(
        reviewed.selected.accept.admission,
      ),
    );
    assertEquals(reviewed.selected.limitations.sheetScope, fixture.sheet.scope);
    assertEquals(
      reviewed.selected.evaluations[0]?.output.modelSymbolId,
      fixture.sheet.outputs[0]?.modelSymbolId,
    );
    assertEquals(
      reviewed.selected.evaluations[0]?.message,
      fixture.snapshot.evaluations[0]?.message,
    );
  },
);

Deno.test(
  "admitted Modelica closeout review read model cannot change accept/reject identities",
  async () => {
    const parameters: string[] = [];
    for (const status of ["pass", "fail", "unresolved", "error"] as const) {
      const fixture = await createAdmittedModelicaCloseoutEvidenceFixture({
        evaluationStatus: status,
      });
      const review = new PrepareProjectAdmittedModelicaEvaluationCloseoutReview({
        projects: { get: () => Promise.resolve(fixture.project) },
        snapshots: memorySnapshots(fixture.snapshot, fixture.previousSnapshot),
        ...fixture.dependencies,
      });
      const resolved = await review.execute({
        projectId: CLOSEOUT_REVIEW_PROJECT_ID,
      });
      assertEquals(resolved.status, "resolved");
      if (resolved.status !== "resolved") {
        throw new Error("Expected resolved closeout evidence.");
      }
      assertEquals(resolved.selected.evaluations[0]?.status, status);
      parameters.push(
        deterministicJson({
          accept: resolved.selected.accept.admission.consequence,
          reject: resolved.selected.reject.admission.consequence,
          keys: resolved.selected.accept.decisionParameters.map((item) => item.key),
        }),
      );
    }
    assertEquals(new Set(parameters).size, 1);
  },
);

function memorySnapshots(
  snapshot: ThreadSnapshot,
  previous?: ThreadSnapshot,
) {
  const items = new Map<string, ThreadSnapshot>([[snapshot.id, snapshot]]);
  if (previous) items.set(previous.id, previous);
  let writes = 0;
  return {
    get: (id: string) => Promise.resolve(items.get(id)),
    getFresh: (id: string) => Promise.resolve(items.get(id)),
    latest: () => Promise.resolve(snapshot),
    save: () => {
      writes += 1;
      return Promise.reject(
        new Error(`review must not write snapshots (${writes})`),
      );
    },
  };
}
