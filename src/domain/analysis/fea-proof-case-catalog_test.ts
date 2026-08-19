import { assertEquals } from "@std/assert";
import {
  FEA_PROOF_CASE_SOURCES,
  feaProofCaseSourcePath,
  isKnownFeaProofCaseId,
  selectUniqueCataloguedProofCase,
} from "./fea-proof-case-catalog.ts";
import { validateMechanicalProofCase } from "./mechanical-proof-case.ts";

Deno.test("the FEA proof-case catalog names only reviewed files and refuses unknown ids before I/O", async () => {
  assertEquals(isKnownFeaProofCaseId("desk-lamp-dl06-arm-cantilever"), true);
  assertEquals(
    feaProofCaseSourcePath("desk-lamp-dl06-arm-cantilever"),
    "config/mechanical-proof-cases/desk-lamp-dl06-arm-cantilever.json",
  );
  assertEquals(isKnownFeaProofCaseId("cm-01-retired-replay"), false);
  assertEquals(feaProofCaseSourcePath("cm-01-retired-replay"), undefined);
  assertEquals(FEA_PROOF_CASE_SOURCES.has("desk-lamp-dl04-arm-cantilever"), true);
  assertEquals(
    isKnownFeaProofCaseId("cantilever-arm-ca01-arm-cantilever"),
    true,
  );
  const ca01 = validateMechanicalProofCase(
    JSON.parse(
      await Deno.readTextFile(
        "config/mechanical-proof-cases/cantilever-arm-ca01-arm-cantilever.json",
      ),
    ),
  );
  assertEquals(ca01.id, "cantilever-arm-ca01-arm-cantilever");
  assertEquals(ca01.project.id, "cantilever-arm-ca01");
});

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
