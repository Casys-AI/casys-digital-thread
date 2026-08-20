import { assertEquals } from "@std/assert";
import { selectUniqueCataloguedProofCase } from "./fea-proof-case-catalog.ts";

Deno.test("unique catalog selection stays unresolved when several cases share a project", () => {
  const selected = selectUniqueCataloguedProofCase("desk-lamp-dl06", [
    { caseId: "desk-lamp-dl06-arm-cantilever", projectId: "desk-lamp-dl06" },
    { caseId: "desk-lamp-dl06-base", projectId: "desk-lamp-dl06" },
  ]);
  assertEquals(selected.status, "unresolved");
  if (selected.status !== "unresolved") return;
  assertEquals(selected.code, "catalog-ambiguous");
  assertEquals(selected.caseIds, [
    "desk-lamp-dl06-arm-cantilever",
    "desk-lamp-dl06-base",
  ]);
});

Deno.test("unique catalog selection names catalog-absent when no case binds the project", () => {
  const selected = selectUniqueCataloguedProofCase("unknown-project", [
    { caseId: "desk-lamp-dl06-arm-cantilever", projectId: "desk-lamp-dl06" },
  ]);
  assertEquals(selected.status, "unresolved");
  if (selected.status !== "unresolved") return;
  assertEquals(selected.code, "catalog-absent");
});
