import { assertEquals } from "@std/assert";
import { PrepareCrossDomainImpactDecision } from "./prepare-cross-domain-impact-decision.ts";

Deno.test("X09 review refuses a request that is not exactly one projectId", async () => {
  const review = new PrepareCrossDomainImpactDecision({
    projects: { get: () => Promise.reject(new Error("must not load")) },
    snapshots: { get: () => Promise.reject(new Error("must not load")) },
    briefGates: { read: () => Promise.reject(new Error("must not load")) },
    captures: {
      save: () => Promise.reject(new Error("must not save")),
      read: () => Promise.reject(new Error("must not read")),
    },
  });
  const extra = await review.execute({
    projectId: "project.impact",
    branch: "thermal",
  });
  assertEquals(extra.status, "unresolved");
  if (extra.status !== "unresolved") return;
  assertEquals(extra.diagnostics.map((item) => item.code), ["invalid_request"]);
});

Deno.test("X09 review reports unavailable when the project cannot be reopened", async () => {
  const review = new PrepareCrossDomainImpactDecision({
    projects: { get: () => Promise.resolve(undefined) },
    snapshots: { get: () => Promise.reject(new Error("must not load")) },
    briefGates: { read: () => Promise.reject(new Error("must not load")) },
    captures: {
      save: () => Promise.reject(new Error("must not save")),
      read: () => Promise.reject(new Error("must not read")),
    },
  });
  const result = await review.execute({ projectId: "project.impact" });
  assertEquals(result.status, "unavailable");
  if (result.status !== "unavailable") return;
  assertEquals(result.diagnostics.map((item) => item.code), ["project_unavailable"]);
});
