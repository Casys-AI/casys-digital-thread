import { assertEquals, assertRejects } from "@std/assert";
import { sha256Hex } from "../../domain/kernel/deterministic-json.ts";
import { FileThreadViewerAppRegistry } from "./file-thread-viewer-app-registry.ts";
import { materializeThreadViewerApps } from "../../../scripts/runners/materialize-thread-viewer-apps.ts";
import {
  materializeThreadViewerAppsCatalog,
  THREAD_VIEWER_APP_MATERIALIZATION_CATALOG_SCHEMA,
  ThreadViewerAppRegistryWriteConflictError,
} from "./thread-viewer-app-materializer.ts";

const STALE_SHA256 =
  "sha256:0000000000000000000000000000000000000000000000000000000000000000" as const;

Deno.test("in-memory catalogue materialization matches the file-catalogue CLI", async () => {
  const root = await Deno.makeTempDir();
  try {
    const fixture = await writeFixture(root);
    const viaCli = await materializeThreadViewerApps(fixture.request);
    const cliBytes = await Deno.readFile(fixture.registryPath);
    await Deno.remove(fixture.registryPath);

    const viaCatalog = await materializeThreadViewerAppsCatalog({
      catalog: JSON.parse(await Deno.readTextFile(fixture.catalogPath)),
      registryPath: fixture.registryPath,
      objectDirectory: fixture.objectDirectory,
    });
    assertEquals(viaCatalog, viaCli);
    assertEquals(await Deno.readFile(fixture.registryPath), cliBytes);

    const admitted = await new FileThreadViewerAppRegistry({
      registryPath: fixture.registryPath,
      objectDirectory: fixture.objectDirectory,
    }).read();
    assertEquals(admitted?.bindings.length, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("absent predecessor admits the first registry write", async () => {
  const root = await Deno.makeTempDir();
  try {
    const fixture = await writeFixture(root);
    const result = await materializeThreadViewerAppsCatalog({
      catalog: JSON.parse(await Deno.readTextFile(fixture.catalogPath)),
      registryPath: fixture.registryPath,
      objectDirectory: fixture.objectDirectory,
      predecessor: { kind: "absent" },
    });
    assertEquals(result.bindingCount, 1);
    const admitted = await new FileThreadViewerAppRegistry({
      registryPath: fixture.registryPath,
      objectDirectory: fixture.objectDirectory,
    }).read();
    assertEquals(admitted?.bindings.length, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("exact predecessor admits a full registry replacement", async () => {
  const root = await Deno.makeTempDir();
  try {
    const fixture = await writeFixture(root);
    await materializeThreadViewerAppsCatalog({
      catalog: JSON.parse(await Deno.readTextFile(fixture.catalogPath)),
      registryPath: fixture.registryPath,
      objectDirectory: fixture.objectDirectory,
      predecessor: { kind: "absent" },
    });
    const predecessor = {
      kind: "present" as const,
      sha256: await sha256OfFile(fixture.registryPath),
    };
    const nextCatalog = catalogWithKind(fixture, "recorded-canonical-geometry-next");
    const result = await materializeThreadViewerAppsCatalog({
      catalog: nextCatalog,
      registryPath: fixture.registryPath,
      objectDirectory: fixture.objectDirectory,
      predecessor,
    });
    assertEquals(result.bindingCount, 1);
    const document = JSON.parse(await Deno.readTextFile(fixture.registryPath));
    assertEquals(document.bindings.length, 1);
    assertEquals(
      document.bindings[0].session.payload.kind,
      "recorded-canonical-geometry-next",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("stale or different predecessor leaves live registry bytes unchanged", async () => {
  const root = await Deno.makeTempDir();
  try {
    const fixture = await writeFixture(root);
    await materializeThreadViewerApps(fixture.request);
    const before = await Deno.readFile(fixture.registryPath);
    const catalog = catalogWithKind(fixture, "recorded-canonical-geometry-stale");

    const stale = await assertRejects(
      () =>
        materializeThreadViewerAppsCatalog({
          catalog,
          registryPath: fixture.registryPath,
          objectDirectory: fixture.objectDirectory,
          predecessor: { kind: "present", sha256: STALE_SHA256 },
        }),
      ThreadViewerAppRegistryWriteConflictError,
    );
    assertEquals(stale.expected, { kind: "present", sha256: STALE_SHA256 });
    assertEquals(stale.observed, {
      kind: "present",
      sha256: await sha256OfFile(fixture.registryPath),
    });
    assertEquals(await Deno.readFile(fixture.registryPath), before);

    const missing = await assertRejects(
      () =>
        materializeThreadViewerAppsCatalog({
          catalog,
          registryPath: fixture.registryPath,
          objectDirectory: fixture.objectDirectory,
          predecessor: { kind: "absent" },
        }),
      ThreadViewerAppRegistryWriteConflictError,
    );
    assertEquals(missing.expected, { kind: "absent" });
    assertEquals(missing.observed.kind, "present");
    assertEquals(await Deno.readFile(fixture.registryPath), before);

    const recovered = await materializeThreadViewerAppsCatalog({
      catalog,
      registryPath: fixture.registryPath,
      objectDirectory: fixture.objectDirectory,
      predecessor: {
        kind: "present",
        sha256: await sha256OfFile(fixture.registryPath),
      },
    });
    assertEquals(recovered.bindingCount, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("two concurrent writes with the same predecessor cannot both commit", async () => {
  const root = await Deno.makeTempDir();
  try {
    const fixture = await writeFixture(root);
    await materializeThreadViewerAppsCatalog({
      catalog: JSON.parse(await Deno.readTextFile(fixture.catalogPath)),
      registryPath: fixture.registryPath,
      objectDirectory: fixture.objectDirectory,
      predecessor: { kind: "absent" },
    });
    const predecessor = {
      kind: "present" as const,
      sha256: await sha256OfFile(fixture.registryPath),
    };
    const left = catalogWithKind(fixture, "recorded-canonical-geometry-left");
    const right = catalogWithKind(fixture, "recorded-canonical-geometry-right");
    const outcomes = await Promise.allSettled([
      materializeThreadViewerAppsCatalog({
        catalog: left,
        registryPath: fixture.registryPath,
        objectDirectory: fixture.objectDirectory,
        predecessor,
      }),
      materializeThreadViewerAppsCatalog({
        catalog: right,
        registryPath: fixture.registryPath,
        objectDirectory: fixture.objectDirectory,
        predecessor,
      }),
    ]);
    const accepted = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    assertEquals(accepted.length, 1);
    assertEquals(rejected.length, 1);
    assertEquals(
      rejected[0].status === "rejected" &&
        rejected[0].reason instanceof ThreadViewerAppRegistryWriteConflictError,
      true,
    );
    const document = JSON.parse(await Deno.readTextFile(fixture.registryPath));
    assertEquals(document.bindings.length, 1);
    const kind = document.bindings[0].session.payload.kind;
    assertEquals(
      kind === "recorded-canonical-geometry-left" ||
        kind === "recorded-canonical-geometry-right",
      true,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("manifest admission failure preserves the live registry", async () => {
  const root = await Deno.makeTempDir();
  try {
    const fixture = await writeFixture(root);
    await materializeThreadViewerAppsCatalog({
      catalog: JSON.parse(await Deno.readTextFile(fixture.catalogPath)),
      registryPath: fixture.registryPath,
      objectDirectory: fixture.objectDirectory,
    });
    const before = await Deno.readFile(fixture.registryPath);
    const catalog = JSON.parse(await Deno.readTextFile(fixture.catalogPath));
    const manifest = JSON.parse(await Deno.readTextFile(fixture.manifestPath));
    manifest.app.id = "io.casys.lookalike";
    await Deno.writeTextFile(fixture.manifestPath, JSON.stringify(manifest));

    await assertRejects(
      () =>
        materializeThreadViewerAppsCatalog({
          catalog,
          registryPath: fixture.registryPath,
          objectDirectory: fixture.objectDirectory,
        }),
      Error,
      "failed exact manifest and CAS admission",
    );
    assertEquals(await Deno.readFile(fixture.registryPath), before);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("no-precondition CLI still fully replaces the live registry", async () => {
  const root = await Deno.makeTempDir();
  try {
    const fixture = await writeFixture(root);
    await materializeThreadViewerApps(fixture.request);
    const nextCatalog = catalogWithKind(fixture, "recorded-canonical-geometry-cli");
    await Deno.writeTextFile(fixture.catalogPath, JSON.stringify(nextCatalog));
    const result = await materializeThreadViewerApps(fixture.request);
    assertEquals(result.bindingCount, 1);
    const document = JSON.parse(await Deno.readTextFile(fixture.registryPath));
    assertEquals(document.bindings.length, 1);
    assertEquals(
      document.bindings[0].session.payload.kind,
      "recorded-canonical-geometry-cli",
    );
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
  const catalog = {
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
  };
  await Deno.writeTextFile(catalogPath, JSON.stringify(catalog));
  return {
    catalogPath,
    manifestPath,
    registryPath,
    objectDirectory,
    catalog,
    request: { catalogPath, registryPath, objectDirectory },
  };
}

function catalogWithKind(
  fixture: Awaited<ReturnType<typeof writeFixture>>,
  kind: string,
) {
  return {
    ...fixture.catalog,
    bindings: [{
      ...fixture.catalog.bindings[0],
      session: {
        ...fixture.catalog.bindings[0].session,
        payload: {
          ...fixture.catalog.bindings[0].session.payload,
          kind,
        },
      },
    }],
  };
}

async function sha256OfFile(path: string): Promise<`sha256:${string}`> {
  return `sha256:${await sha256Hex(await Deno.readFile(path))}`;
}
