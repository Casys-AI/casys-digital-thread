import { assertEquals } from "@std/assert";
import { PrepareProjectAssemblyIntegrityEvaluationCloseoutReview } from "./prepare-project-assembly-integrity-evaluation-closeout-review.ts";

Deno.test("assembly-integrity L5 public review reads only an exact projectId request", async () => {
  let projectReads = 0;
  const review = new PrepareProjectAssemblyIntegrityEvaluationCloseoutReview({
    projects: {
      get: async () => {
        projectReads++;
        return undefined;
      },
    },
    snapshots: {
      get: async () => undefined,
      latest: async () => undefined,
      save: async () => {},
    },
    evaluationCaptures: {
      read: async () => undefined,
    },
  });

  const result = await review.execute({
    projectId: "project-assembly",
    provider: "forbidden",
    tolerance: 0.01,
    verdict: "pass",
    gateItemId: "caller-gate",
    syson: { requirement: "forbidden" },
  });

  assertEquals(projectReads, 0);
  assertEquals(result, {
    status: "unavailable",
    family: "assembly-integrity",
    diagnostic: {
      code: "invalid_request",
      message:
        "The assembly-integrity evaluation-closeout review request must name exactly one project.",
    },
  });
});
