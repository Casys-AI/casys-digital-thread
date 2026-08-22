import { assertEquals, assertRejects } from "@std/assert";
import { FileCataloguedSensitivityStudyCaseReader } from "./file-catalogued-sensitivity-study-case-reader.ts";

Deno.test("sensitivity-study reader resolves only manifest-declared case ids", async () => {
  const root = await Deno.makeTempDir({ prefix: "casys-sensitivity-study-catalog-" });
  try {
    const caseId = "project-a-arm-sensitivity-v1";
    const raw = JSON.stringify({ id: caseId, declaration: "reviewed" });
    await Deno.writeTextFile(
      `${root}/catalog.json`,
      JSON.stringify({
        schemaVersion: "sensitivity-study-case-catalog/1.0",
        cases: [{ id: caseId, file: "project-a-arm-sensitivity-v1.json" }],
      }),
    );
    await Deno.writeTextFile(`${root}/project-a-arm-sensitivity-v1.json`, raw);

    const reader = new FileCataloguedSensitivityStudyCaseReader(root);
    assertEquals(await reader.list(), [{ caseId }]);
    assertEquals(await reader.read(caseId), raw);
    assertEquals(await reader.read("../project-a-arm-sensitivity-v1.json"), undefined);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("sensitivity-study reader rejects an unsafe manifest path", async () => {
  const root = await Deno.makeTempDir({ prefix: "casys-sensitivity-study-catalog-" });
  try {
    await Deno.writeTextFile(
      `${root}/catalog.json`,
      JSON.stringify({
        schemaVersion: "sensitivity-study-case-catalog/1.0",
        cases: [{ id: "project-a-arm-sensitivity-v1", file: "../outside.json" }],
      }),
    );

    const reader = new FileCataloguedSensitivityStudyCaseReader(root);
    await assertRejects(
      () => reader.list(),
      Error,
      "Catalog manifest case 0 is invalid",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("sensitivity-study reader rejects a file whose id differs from its manifest", async () => {
  const root = await Deno.makeTempDir({ prefix: "casys-sensitivity-study-catalog-" });
  try {
    await Deno.writeTextFile(
      `${root}/catalog.json`,
      JSON.stringify({
        schemaVersion: "sensitivity-study-case-catalog/1.0",
        cases: [{ id: "project-a-arm-sensitivity-v1", file: "case.json" }],
      }),
    );
    await Deno.writeTextFile(
      `${root}/case.json`,
      JSON.stringify({ id: "other-case" }),
    );

    const reader = new FileCataloguedSensitivityStudyCaseReader(root);
    await assertRejects(
      () => reader.read("project-a-arm-sensitivity-v1"),
      Error,
      "does not match manifest id",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test(
  "sensitivity-study reader rejects a directory symlink that escapes the catalog root",
  async () => {
    const root = await Deno.makeTempDir({
      prefix: "casys-sensitivity-study-catalog-",
    });
    const outside = await Deno.makeTempDir({
      prefix: "casys-sensitivity-study-outside-",
    });
    try {
      const caseId = "project-a-arm-sensitivity-v1";
      await Deno.writeTextFile(
        `${outside}/case.json`,
        JSON.stringify({ id: caseId, declaration: "escaped" }),
      );
      await Deno.symlink(outside, `${root}/linked`);
      await Deno.writeTextFile(
        `${root}/catalog.json`,
        JSON.stringify({
          schemaVersion: "sensitivity-study-case-catalog/1.0",
          cases: [{ id: caseId, file: "linked/case.json" }],
        }),
      );

      const reader = new FileCataloguedSensitivityStudyCaseReader(root);
      await assertRejects(
        () => reader.list(),
        Error,
        "escaped the catalog root",
      );
      await assertRejects(
        () => reader.read(caseId),
        Error,
        "escaped the catalog root",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
      await Deno.remove(outside, { recursive: true });
    }
  },
);

Deno.test(
  "sensitivity-study reader rejects a catalog.json symlink that escapes the catalog root",
  async () => {
    const root = await Deno.makeTempDir({
      prefix: "casys-sensitivity-study-catalog-",
    });
    const outside = await Deno.makeTempDir({
      prefix: "casys-sensitivity-study-outside-",
    });
    try {
      const caseId = "project-a-arm-sensitivity-v1";
      const raw = JSON.stringify({ id: caseId, declaration: "reviewed" });
      await Deno.writeTextFile(
        `${outside}/catalog.json`,
        JSON.stringify({
          schemaVersion: "sensitivity-study-case-catalog/1.0",
          cases: [{ id: caseId, file: "case.json" }],
        }),
      );
      await Deno.writeTextFile(`${root}/case.json`, raw);
      await Deno.symlink(`${outside}/catalog.json`, `${root}/catalog.json`);

      const reader = new FileCataloguedSensitivityStudyCaseReader(root);
      await assertRejects(
        () => reader.list(),
        Error,
        "escaped the catalog root",
      );
      await assertRejects(
        () => reader.read(caseId),
        Error,
        "escaped the catalog root",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
      await Deno.remove(outside, { recursive: true });
    }
  },
);
