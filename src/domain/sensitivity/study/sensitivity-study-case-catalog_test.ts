import { assertEquals } from "@std/assert";
import {
  isKnownSensitivityStudyCaseId,
  selectUniqueCataloguedSensitivityCase,
  SENSITIVITY_STUDY_CASE_SOURCES,
  sensitivityStudyCaseSourcePath,
  sensitivityStudySealIdentities,
} from "./sensitivity-study-case-catalog.ts";

Deno.test("the sensitivity-study catalog names only reviewed files and refuses unknown ids before I/O", () => {
  assertEquals(isKnownSensitivityStudyCaseId("dl05-arm-thickness-isolated"), true);
  assertEquals(
    sensitivityStudyCaseSourcePath("dl05-arm-thickness-isolated"),
    "config/sensitivity-study-cases/dl05-arm-thickness-isolated.json",
  );
  assertEquals(isKnownSensitivityStudyCaseId("cm-01-retired-replay"), false);
  assertEquals(sensitivityStudyCaseSourcePath("cm-01-retired-replay"), undefined);
  assertEquals(
    SENSITIVITY_STUDY_CASE_SOURCES.has("desk-lamp-dl06-arm-cantilever"),
    false,
  );
  assertEquals(isKnownSensitivityStudyCaseId("dl06-arm-thickness-sensitivity"), false);
});

Deno.test("unique catalog selection stays unresolved when several cases share a project", () => {
  const selected = selectUniqueCataloguedSensitivityCase("desk-lamp-dl05", [
    { caseId: "dl05-arm-thickness-sensitivity", projectId: "desk-lamp-dl05" },
    { caseId: "dl05-arm-thickness-isolated", projectId: "desk-lamp-dl05" },
  ]);
  assertEquals(selected.status, "unresolved");
  if (selected.status !== "unresolved") return;
  assertEquals(selected.code, "catalog-ambiguous");
  assertEquals(selected.caseIds, [
    "dl05-arm-thickness-sensitivity",
    "dl05-arm-thickness-isolated",
  ]);
});

Deno.test("unique catalog selection names catalog-absent when no case binds the project", () => {
  const selected = selectUniqueCataloguedSensitivityCase("desk-lamp-dl06", [
    { caseId: "dl05-arm-thickness-isolated", projectId: "desk-lamp-dl05" },
    { caseId: "dl04-size-z-sensitivity", projectId: "desk-lamp-dl04" },
  ]);
  assertEquals(selected.status, "unresolved");
  if (selected.status !== "unresolved") return;
  assertEquals(selected.code, "catalog-absent");
  assertEquals(selected.caseIds, []);
});

Deno.test("sensitivity seal identities are compiled from the catalogued case id", () => {
  assertEquals(
    sensitivityStudySealIdentities("dl05-arm-thickness-isolated"),
    {
      workItemId: "wi-sensitivity-seal-dl05-arm-thickness-isolated",
      decisionId: "dec-sensitivity-seal-dl05-arm-thickness-isolated",
    },
  );
});
