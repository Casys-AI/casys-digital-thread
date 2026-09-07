import { assertEquals, assertRejects } from "@std/assert";
import { FileByteStore } from "../shared/cas/file-byte-store.ts";
import { sha256Hex } from "../../domain/kernel/deterministic-json.ts";
import {
  readThreadViewerAppPackages,
  THREAD_VIEWER_APP_PACKAGES_SCHEMA,
} from "./thread-viewer-app-packages.ts";

Deno.test("installed viewer App packages reopen exact immutable manifest and HTML", async () => {
  const fixture = await packageFixture();
  try {
    const packages = await readThreadViewerAppPackages(
      fixture.catalogPath,
      fixture.objects,
    );
    assertEquals(packages?.length, 1);
    assertEquals(packages?.[0]?.app, { id: "io.example.viewer", version: "1.2.3" });
    assertEquals(packages?.[0]?.resources[0]?.resultSchemas, ["capture/1.0"]);
  } finally {
    await Deno.remove(fixture.root, { recursive: true });
  }
});

Deno.test("installed viewer App packages reject package aliases", async () => {
  const fixture = await packageFixture();
  try {
    const catalog = JSON.parse(await Deno.readTextFile(fixture.catalogPath));
    catalog.packages[0].app.version = "latest";
    await Deno.writeTextFile(fixture.catalogPath, JSON.stringify(catalog));
    await assertRejects(
      () => readThreadViewerAppPackages(fixture.catalogPath, fixture.objects),
      TypeError,
    );
  } finally {
    await Deno.remove(fixture.root, { recursive: true });
  }
});

Deno.test("installed viewer App packages reject duplicate App identities", async () => {
  const fixture = await packageFixture();
  try {
    const catalog = JSON.parse(await Deno.readTextFile(fixture.catalogPath));
    catalog.packages.push(structuredClone(catalog.packages[0]));
    await Deno.writeTextFile(fixture.catalogPath, JSON.stringify(catalog));
    await assertRejects(
      () => readThreadViewerAppPackages(fixture.catalogPath, fixture.objects),
      TypeError,
    );
  } finally {
    await Deno.remove(fixture.root, { recursive: true });
  }
});

Deno.test("installed viewer App packages reject tampered immutable display bytes", async () => {
  const fixture = await packageFixture();
  try {
    const catalog = JSON.parse(await Deno.readTextFile(fixture.catalogPath));
    const digest = catalog.packages[0].resources[0].fingerprint.slice("sha256:".length);
    await Deno.writeTextFile(`${fixture.objects}/${digest}`, "tampered html");
    await assertRejects(
      () => readThreadViewerAppPackages(fixture.catalogPath, fixture.objects),
      Error,
    );
  } finally {
    await Deno.remove(fixture.root, { recursive: true });
  }
});

Deno.test("installed viewer App packages reject resource schema lies", async () => {
  const fixture = await packageFixture();
  try {
    const catalog = JSON.parse(await Deno.readTextFile(fixture.catalogPath));
    catalog.packages[0].resources[0].uri = "ui://example/not-in-manifest";
    await Deno.writeTextFile(fixture.catalogPath, JSON.stringify(catalog));
    await assertRejects(
      () => readThreadViewerAppPackages(fixture.catalogPath, fixture.objects),
      TypeError,
    );
  } finally {
    await Deno.remove(fixture.root, { recursive: true });
  }
});

Deno.test("installed viewer App packages treat an absent catalogue as absent", async () => {
  const root = await Deno.makeTempDir();
  try {
    assertEquals(
      await readThreadViewerAppPackages(`${root}/missing.json`, `${root}/objects`),
      undefined,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

async function packageFixture() {
  const root = await Deno.makeTempDir();
  const objects = `${root}/objects`;
  const store = new FileByteStore({
    kind: "thread-viewer-app-object",
    directory: objects,
    uriNamespace: "thread-viewer-apps",
    label: "test App object",
  });
  const manifest = new TextEncoder().encode(JSON.stringify({
    schemaVersion: "io.casys.mcp.view-app-manifest/1.0",
    app: { id: "io.example.viewer", title: "Example", version: "1.2.3" },
    resources: [{
      uri: "ui://example/viewer",
      ownership: "whole-view",
      resultSchemas: ["capture/1.0"],
      acceptedActions: ["viewer.session.apply"],
      sessionSchemas: ["session/1.0"],
    }],
  }));
  const html = new TextEncoder().encode(
    "<!doctype html><html><head></head><body></body></html>",
  );
  const manifestDigest = await sha256Hex(manifest);
  const htmlDigest = await sha256Hex(html);
  await store.save({ algorithm: "sha256", digest: manifestDigest }, manifest);
  await store.save({ algorithm: "sha256", digest: htmlDigest }, html);
  const catalogPath = `${root}/packages.json`;
  await Deno.writeTextFile(
    catalogPath,
    JSON.stringify({
      schemaVersion: THREAD_VIEWER_APP_PACKAGES_SCHEMA,
      packages: [{
        app: { id: "io.example.viewer", version: "1.2.3" },
        manifest: {
          uri: "ui://example/manifest",
          fingerprint: `sha256:${manifestDigest}`,
        },
        resources: [{
          uri: "ui://example/viewer",
          fingerprint: `sha256:${htmlDigest}`,
        }],
      }],
    }),
  );
  return { root, objects, catalogPath };
}
