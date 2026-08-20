import { assertEquals, assertRejects } from "@std/assert";
import { FileCataloguedMechanicalProofCaseReader } from "./file-catalogued-mechanical-proof-case-reader.ts";

Deno.test("mechanical proof-case reader resolves only manifest-declared case ids", async () => {
  const root = await Deno.makeTempDir({ prefix: "casys-fea-proof-catalog-" });
  try {
    const caseId = "project:a-arm-static-v1";
    const raw = JSON.stringify({ id: caseId, declaration: "reviewed" });
    await Deno.writeTextFile(
      `${root}/catalog.json`,
      JSON.stringify({
        schemaVersion: "mechanical-proof-case-catalog/1.0",
        cases: [{ id: caseId, file: "project-a-arm-static-v1.json" }],
      }),
    );
    await Deno.writeTextFile(`${root}/project-a-arm-static-v1.json`, raw);

    const reader = new FileCataloguedMechanicalProofCaseReader(root);
    assertEquals(await reader.list(), [{ caseId }]);
    assertEquals(await reader.read(caseId), raw);
    assertEquals(await reader.read("../project-a-arm-static-v1.json"), undefined);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("mechanical proof-case reader rejects an unsafe manifest path", async () => {
  const root = await Deno.makeTempDir({ prefix: "casys-fea-proof-catalog-" });
  try {
    await Deno.writeTextFile(
      `${root}/catalog.json`,
      JSON.stringify({
        schemaVersion: "mechanical-proof-case-catalog/1.0",
        cases: [{ id: "project-a-arm-static-v1", file: "../outside.json" }],
      }),
    );

    const reader = new FileCataloguedMechanicalProofCaseReader(root);
    await assertRejects(
      () => reader.list(),
      Error,
      "Catalog manifest case 0 is invalid",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("mechanical proof-case reader rejects a file whose id differs from its manifest", async () => {
  const root = await Deno.makeTempDir({ prefix: "casys-fea-proof-catalog-" });
  try {
    await Deno.writeTextFile(
      `${root}/catalog.json`,
      JSON.stringify({
        schemaVersion: "mechanical-proof-case-catalog/1.0",
        cases: [{ id: "project-a-arm-static-v1", file: "case.json" }],
      }),
    );
    await Deno.writeTextFile(
      `${root}/case.json`,
      JSON.stringify({ id: "other-case" }),
    );

    const reader = new FileCataloguedMechanicalProofCaseReader(root);
    await assertRejects(
      () => reader.read("project-a-arm-static-v1"),
      Error,
      "does not match manifest id",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
