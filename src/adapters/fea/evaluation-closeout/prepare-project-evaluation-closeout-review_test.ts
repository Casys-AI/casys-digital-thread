import { assertEquals } from "@std/assert";
import {
  createCompletedStaticMechanicalCloseoutFixture,
} from "../../../testing/static-mechanical-closeout-fixture.ts";
import { PrepareProjectEvaluationCloseoutReview } from "./prepare-project-evaluation-closeout-review.ts";

Deno.test(
  "static-mechanical closeout review accepts only projectId and derives exact current evidence",
  async () => {
    const fixture = await createCompletedStaticMechanicalCloseoutFixture();
    try {
      const review = new PrepareProjectEvaluationCloseoutReview({
        projects: fixture.fea.projects,
        snapshots: fixture.fea.snapshots,
        ...fixture.dependencies,
      });
      const before = await fixture.fea.projects.get(fixture.fea.projectId);
      const resolved = await review.execute({ projectId: fixture.fea.projectId });
      const after = await fixture.fea.projects.get(fixture.fea.projectId);
      assertEquals(before?.revision, after?.revision);
      assertEquals(resolved.status, "resolved");
      if (resolved.status !== "resolved") {
        throw new Error("Expected resolved closeout evidence.");
      }
      assertEquals(resolved.selected.family, "static-mechanical");
      assertEquals(resolved.selected.basis.snapshotId, fixture.snapshot.id);
      assertEquals(resolved.selected.acceptanceEligibility, true);
      assertEquals(
        resolved.selected.accept?.admission.criteria.every((criterion) =>
          criterion.status === "pass"
        ),
        true,
      );
      assertEquals(resolved.selected.reject.admission.rejectionDisposition, "none");
      assertEquals(
        Object.keys(resolved.selected.accept?.admission ?? {}).some((key) =>
          /provider|tool|args|uri|threshold|result/i.test(key)
        ),
        false,
      );

      const extra = await review.execute({
        projectId: fixture.fea.projectId,
        family: "static-mechanical",
        canonicalStepId: "caller-cannot-select-this",
      });
      assertEquals(extra, {
        status: "unavailable",
        family: "static-mechanical",
        diagnostic: {
          code: "invalid_request",
          message:
            "The evaluation-closeout review request must name exactly one project.",
        },
      });
    } finally {
      await fixture.dispose();
    }
  },
);

Deno.test(
  "static-mechanical closeout review with any non-pass criterion derives reject only",
  async () => {
    const fixture = await createCompletedStaticMechanicalCloseoutFixture({
      status: "unresolved",
    });
    try {
      const review = new PrepareProjectEvaluationCloseoutReview({
        projects: fixture.fea.projects,
        snapshots: fixture.fea.snapshots,
        ...fixture.dependencies,
      });
      const resolved = await review.execute({ projectId: fixture.fea.projectId });
      assertEquals(resolved.status, "resolved");
      if (resolved.status !== "resolved") {
        throw new Error("Expected resolved closeout evidence.");
      }
      assertEquals(resolved.selected.acceptanceEligibility, false);
      assertEquals(resolved.selected.accept, undefined);
      assertEquals(
        resolved.selected.reject.admission.rejectionDisposition,
        "mechanical-review-required",
      );
      assertEquals(
        resolved.selected.reject.admission.criteria.some((criterion) =>
          criterion.status !== "pass"
        ),
        true,
      );
    } finally {
      await fixture.dispose();
    }
  },
);
