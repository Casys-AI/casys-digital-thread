import { assertEquals } from "@std/assert";
import {
  FixedProjectSourceAttachmentRoleCatalog,
  PROJECT_SOURCE_ATTACHMENT_ROLE_IDS,
} from "./fixed-project-source-attachment-role-catalog.ts";

Deno.test("fixed attachment role catalog accepts only generic v1 roles on exact SysML kinds", async () => {
  const catalog = new FixedProjectSourceAttachmentRoleCatalog();
  for (const id of PROJECT_SOURCE_ATTACHMENT_ROLE_IDS) {
    assertEquals(
      catalog.accept({ id, version: 1 }, {
        elementId: "def-rail",
        elementKind: "PartDefinition",
      }),
      true,
    );
    assertEquals(
      catalog.accept({ id, version: 1 }, {
        elementId: "usage-left",
        elementKind: "PartUsage",
      }),
      true,
    );
  }
  assertEquals(
    catalog.accept({ id: "design-source", version: 2 }, {
      elementId: "def-rail",
      elementKind: "PartDefinition",
    }),
    false,
  );
  assertEquals(
    catalog.accept({ id: "cad-script", version: 1 }, {
      elementId: "def-rail",
      elementKind: "PartDefinition",
    }),
    false,
  );
  const source = await Deno.readTextFile(
    new URL("./fixed-project-source-attachment-role-catalog.ts", import.meta.url),
  );
  assertEquals(/\bprojectId\s*:/.test(source), false);
  assertEquals(/\bprovider\s*\??:/.test(source), false);
  assertEquals(/\bmcp-/.test(source), false);
});
