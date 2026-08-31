import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { FileThreadViewerAppRegistry } from "../../src/adapters/thread/file-thread-viewer-app-registry.ts";
import {
  materializeThreadViewerApps,
  parseMaterializeThreadViewerAppsCli,
  THREAD_VIEWER_APP_MATERIALIZATION_CATALOG_SCHEMA,
} from "./materialize-thread-viewer-apps.ts";

Deno.test("viewer App registrar CLI accepts the deno task separator", () => {
  assertEquals(
    parseMaterializeThreadViewerAppsCli(["--", "--catalog=/tmp/apps.json"]),
    {
      catalogPath: "/tmp/apps.json",
      registryPath: undefined,
      objectDirectory: undefined,
    },
  );
});

Deno.test("viewer App registrar derives identities and atomically admits a complete catalogue", async () => {
  const root = await Deno.makeTempDir();
  try {
    const fixture = await writeFixture(root);
    const result = await materializeThreadViewerApps(fixture.request);
    assertEquals(result.bindingCount, 1);
    assertEquals(result.objectCount, 3);

    const document = JSON.parse(await Deno.readTextFile(fixture.registryPath));
    assertEquals(document.schemaVersion, "thread-viewer-app-registry/1.0");
    assertEquals(document.bindings.length, 1);
    assertEquals(document.objects.length, 3);
    assertEquals(document.bindings[0].session.action, "viewer.session.apply");
    assertStringIncludes(
      document.bindings[0].readResources[0].uri,
      "/api/thread/viewer-apps/resources/",
    );
    assertEquals("launchUri" in document.bindings[0], false);

    const admitted = await new FileThreadViewerAppRegistry({
      registryPath: fixture.registryPath,
      objectDirectory: fixture.objectDirectory,
    }).read();
    assertEquals(admitted?.bindings.length, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("viewer App registrar rejects authority fields without replacing the live registry", async () => {
  const root = await Deno.makeTempDir();
  try {
    const fixture = await writeFixture(root);
    await materializeThreadViewerApps(fixture.request);
    const before = await Deno.readTextFile(fixture.registryPath);
    const catalog = JSON.parse(await Deno.readTextFile(fixture.catalogPath));
    catalog.bindings[0].launchUri = "https://provider.invalid/app";
    await Deno.writeTextFile(fixture.catalogPath, JSON.stringify(catalog));

    await assertRejects(
      () => materializeThreadViewerApps(fixture.request),
      TypeError,
      "unsupported contract",
    );
    assertEquals(await Deno.readTextFile(fixture.registryPath), before);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("viewer App registrar keeps the live registry when manifest admission fails", async () => {
  const root = await Deno.makeTempDir();
  try {
    const fixture = await writeFixture(root);
    await materializeThreadViewerApps(fixture.request);
    const before = await Deno.readTextFile(fixture.registryPath);
    const manifest = JSON.parse(await Deno.readTextFile(fixture.manifestPath));
    manifest.app.id = "io.casys.lookalike";
    await Deno.writeTextFile(fixture.manifestPath, JSON.stringify(manifest));

    await assertRejects(
      () => materializeThreadViewerApps(fixture.request),
      Error,
      "failed exact manifest and CAS admission",
    );
    assertEquals(await Deno.readTextFile(fixture.registryPath), before);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

async function writeFixture(root: string) {
  const registryPath = `${root}/registry/registry.json`;
  const objectDirectory = `${root}/registry/objects`;
  const catalogPath = `${root}/catalog.json`;
  const manifestPath = `${root}/manifest.json`;
  const htmlPath = `${root}/viewer.html`;
  const assetPath = `${root}/part.glb`;
  const sessionSchema = "io.casys.mcp-build123d.recorded-geometry-session/1.0";
  await Deno.writeTextFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: "io.casys.mcp.view-app-manifest/1.0",
      app: {
        id: "io.casys.mcp-build123d.results",
        title: "Build123d geometry",
        version: "1.2.3",
      },
      resources: [{
        uri: "ui://mcp-build123d/results-viewer",
        ownership: "whole-view",
        resultSchemas: ["io.casys.mcp-build123d.geometry-result/1.0"],
        acceptedActions: ["viewer.session.apply"],
        sessionSchemas: [sessionSchema],
      }],
    }),
  );
  await Deno.writeTextFile(
    htmlPath,
    '<!doctype html><html>\n<head></head><body><script type="module">globalThis.ready=true</script></body></html>',
  );
  await Deno.writeFile(assetPath, new Uint8Array([0x67, 0x6c, 0x54, 0x46]));
  await Deno.writeTextFile(
    catalogPath,
    JSON.stringify({
      schemaVersion: THREAD_VIEWER_APP_MATERIALIZATION_CATALOG_SCHEMA,
      bindings: [{
        basis: {
          projectId: "project-a",
          projectRevision: 4,
          subjectId: "subject-a",
          thread: { id: "thread-a", revision: 2 },
        },
        anchor: { kind: "artifact", id: "geometry-a" },
        app: { id: "io.casys.mcp-build123d.results", version: "1.2.3" },
        manifest: {
          uri: "ui://mcp-build123d/app-manifest",
          path: manifestPath,
        },
        resource: {
          uri: "ui://mcp-build123d/results-viewer",
          path: htmlPath,
        },
        readResources: [{ path: assetPath, mimeType: "model/gltf-binary" }],
        session: {
          schema: sessionSchema,
          payload: {
            schemaVersion: sessionSchema,
            kind: "recorded-canonical-geometry",
          },
        },
      }],
    }),
  );
  return {
    catalogPath,
    manifestPath,
    registryPath,
    objectDirectory,
    request: { catalogPath, registryPath, objectDirectory },
  };
}
