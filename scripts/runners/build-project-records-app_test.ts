import { assertEquals, assertStringIncludes } from "@std/assert";
import { planMcpAppDocument } from "../../src/ui/src/thread/mcp-app-document-loader.ts";
import {
  buildProjectRecordsApp,
  parseBuildProjectRecordsAppCli,
} from "./build-project-records-app.ts";
import { parseViewAppManifestJson } from "@casys/mcp-view-contracts";
import {
  PROJECT_RECORDS_APP_ID,
  PROJECT_RECORDS_APP_VERSION,
  PROJECT_RECORDS_SESSION_SCHEMA,
  PROJECT_RECORDS_WHOLE_VIEW_URI,
} from "../../src/apps/project-records/identity.ts";

Deno.test("project-records App builder CLI accepts the deno task separator", () => {
  assertEquals(
    parseBuildProjectRecordsAppCli(["--", "--output=/tmp/project-records.html"]),
    { outputPath: "/tmp/project-records.html" },
  );
});

Deno.test("project-records App builder writes an admitted single-file HTML document", async () => {
  const root = await Deno.makeTempDir({ prefix: "project-records-build-" });
  try {
    const outputPath = `${root}/project-records.html`;
    const result = await buildProjectRecordsApp({ outputPath });
    const html = await Deno.readTextFile(outputPath);
    assertEquals(result.outputPath, outputPath);
    assertEquals(result.bytes, new TextEncoder().encode(html).byteLength);
    planMcpAppDocument(html);
    assertEquals((html.match(/<script /g) ?? []).length, 1);
    assertStringIncludes(html, 'type="module"');
    assertEquals(html.includes("importmap"), false);
    const manifest = parseViewAppManifestJson(
      await Deno.readTextFile(
        new URL("../../src/apps/project-records/manifest.json", import.meta.url),
      ),
    );
    assertEquals(manifest.app.id, PROJECT_RECORDS_APP_ID);
    assertEquals(manifest.app.version, PROJECT_RECORDS_APP_VERSION);
    assertEquals(manifest.resources[0]?.uri, PROJECT_RECORDS_WHOLE_VIEW_URI);
    assertEquals(
      manifest.resources[0]?.sessionSchemas?.includes(PROJECT_RECORDS_SESSION_SCHEMA),
      true,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
