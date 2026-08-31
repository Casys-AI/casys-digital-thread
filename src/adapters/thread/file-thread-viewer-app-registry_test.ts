import { assertEquals, assertStringIncludes } from "@std/assert";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import { FileByteStore } from "../shared/cas/file-byte-store.ts";
import type { ThreadViewerAppBinding } from "../../presentation/workbench/thread/viewer-sessions.ts";
import {
  FileThreadViewerAppRegistry,
  THREAD_VIEWER_APP_LAUNCH_PREFIX,
  THREAD_VIEWER_APP_REGISTRY_SCHEMA,
  THREAD_VIEWER_APP_RESOURCE_PREFIX,
} from "./file-thread-viewer-app-registry.ts";

Deno.test("file viewer App registry attests exact CAS launch and read resources", async () => {
  const temporary = await Deno.makeTempDir();
  try {
    const registryPath = `${temporary}/registry.json`;
    const objectDirectory = `${temporary}/objects`;
    const fixture = await registryFixture(objectDirectory);
    const alternatePayload = {
      schemaVersion: "io.casys.mcp-build123d.recorded-mesh-session/1.0",
      projection: { status: "available", view: "mesh" },
    } as const;
    const alternateSeal = await sha256Fingerprint(alternatePayload);
    const alternateBinding: ThreadViewerAppBinding = {
      ...fixture.binding,
      session: {
        action: "viewer.session.apply",
        schema: alternatePayload.schemaVersion,
        payload: alternatePayload,
        fingerprint: fingerprint(alternateSeal),
      },
    };
    await Deno.writeTextFile(
      registryPath,
      JSON.stringify({
        ...fixture.document,
        bindings: [fixture.binding, alternateBinding],
      }),
    );
    const registry = new FileThreadViewerAppRegistry({
      registryPath,
      objectDirectory,
    });

    const snapshot = await registry.read();
    assertEquals(snapshot?.bindings, [fixture.binding, alternateBinding]);
    assertEquals(
      snapshot?.bindings.map((binding) => binding.resource),
      [fixture.binding.resource, fixture.binding.resource],
      "one coherent whole App owns both exact internal session views",
    );
    const launch = await snapshot?.launchResolver.resolve({
      app: fixture.binding.app,
      manifest: fixture.binding.manifest,
      resource: fixture.binding.resource,
      readResources: fixture.binding.readResources,
    });
    assertEquals(
      launch?.launchUri,
      `${THREAD_VIEWER_APP_LAUNCH_PREFIX}${
        digest(fixture.binding.manifest.fingerprint)
      }/${digest(fixture.binding.resource.fingerprint)}`,
    );
    assertEquals(launch?.readResources, fixture.binding.readResources);

    const html = await registry.serve(launch!.launchUri);
    assertEquals(html.status, 200);
    assertEquals(html.headers.get("content-type"), "text/html;profile=mcp-app");
    assertStringIncludes(
      html.headers.get("content-security-policy") ?? "",
      "connect-src 'none'",
    );
    assertStringIncludes(
      html.headers.get("content-security-policy") ?? "",
      "img-src data: blob:",
    );
    assertEquals(
      /(?:https?:|\*)/.test(html.headers.get("content-security-policy") ?? ""),
      false,
    );
    assertEquals(await html.text(), new TextDecoder().decode(fixture.html));

    const asset = await registry.serve(fixture.binding.readResources[0]!.uri);
    assertEquals(asset.status, 200);
    assertEquals(asset.headers.get("content-type"), "model/gltf-binary");
    assertEquals(new Uint8Array(await asset.arrayBuffer()), fixture.asset);
  } finally {
    await Deno.remove(temporary, { recursive: true });
  }
});

Deno.test("file viewer App registry revocation and CAS tamper fail closed", async () => {
  const temporary = await Deno.makeTempDir();
  try {
    const registryPath = `${temporary}/registry.json`;
    const objectDirectory = `${temporary}/objects`;
    const fixture = await registryFixture(objectDirectory);
    const registryText = JSON.stringify(fixture.document);
    await Deno.writeTextFile(registryPath, registryText);
    const registry = new FileThreadViewerAppRegistry({
      registryPath,
      objectDirectory,
    });
    assertEquals((await registry.read())?.bindings.length, 1);

    await Deno.remove(registryPath);
    assertEquals(await registry.read(), undefined);
    assertEquals(
      (await registry.serve(
        `${THREAD_VIEWER_APP_LAUNCH_PREFIX}${
          digest(fixture.binding.manifest.fingerprint)
        }/${digest(fixture.binding.resource.fingerprint)}`,
      )).status,
      404,
    );

    await Deno.writeTextFile(registryPath, registryText);
    await Deno.writeTextFile(
      `${objectDirectory}/${digest(fixture.binding.resource.fingerprint)}`,
      "tampered",
    );
    assertEquals(await registry.read(), undefined);
  } finally {
    await Deno.remove(temporary, { recursive: true });
  }
});

Deno.test("file viewer App registry requires the App-owned whole-view manifest contract", async () => {
  const temporary = await Deno.makeTempDir();
  try {
    const registryPath = temporary + "/registry.json";
    const objectDirectory = temporary + "/objects";
    const fixture = await registryFixture(objectDirectory);
    const manifest = JSON.parse(new TextDecoder().decode(fixture.manifest)) as {
      schemaVersion: string;
      app: { id: string; title: string; version: string };
      resources: Array<{
        uri: string;
        ownership: string;
        resultSchemas: string[];
        acceptedActions?: string[];
        sessionSchemas?: string[];
        components?: Record<string, unknown>;
      }>;
    };
    const resource = manifest.resources[0]!;
    const variants = [{
      ...manifest,
      app: { ...manifest.app, id: "io.casys.lookalike" },
    }, {
      ...manifest,
      app: { ...manifest.app, version: "9.9.9" },
    }, {
      ...manifest,
      resources: [{
        ...resource,
        ownership: "component-catalog",
        components: { components: { raw: { title: "Raw" } } },
      }],
    }, {
      ...manifest,
      resources: [{
        ...resource,
        acceptedActions: ["viewer.other"],
      }],
    }, {
      ...manifest,
      resources: [{
        ...resource,
        sessionSchemas: ["io.casys.lookalike.session/1.0"],
      }],
    }, {
      ...manifest,
      resources: [{ ...resource, uri: "ui://mcp-build123d/lookalike" }],
    }];
    const store = new FileByteStore({
      kind: "thread-viewer-app-object",
      directory: objectDirectory,
      uriNamespace: "thread-viewer-apps",
      label: "Thread viewer App object",
    });

    for (const variant of variants) {
      const bytes = new TextEncoder().encode(JSON.stringify(variant));
      const seal = await rawFingerprint(bytes);
      const fingerprint = seal.algorithm + ":" + seal.digest;
      await store.save(seal, bytes);
      await Deno.writeTextFile(
        registryPath,
        JSON.stringify({
          ...fixture.document,
          bindings: [{
            ...fixture.binding,
            manifest: { ...fixture.binding.manifest, fingerprint },
          }],
          objects: fixture.document.objects.map((object) =>
            object.role === "manifest"
              ? { ...object, bytes: bytes.byteLength, fingerprint }
              : object
          ),
        }),
      );
      const registry = new FileThreadViewerAppRegistry({
        registryPath,
        objectDirectory,
      });
      assertEquals(await registry.read(), undefined);
      assertEquals(
        (await registry.serve(
          THREAD_VIEWER_APP_LAUNCH_PREFIX + seal.digest + "/" +
            digest(fixture.binding.resource.fingerprint),
        )).status,
        404,
      );
    }
  } finally {
    await Deno.remove(temporary, { recursive: true });
  }
});

async function registryFixture(objectDirectory: string) {
  const manifest = new TextEncoder().encode(JSON.stringify({
    schemaVersion: "io.casys.mcp.view-app-manifest/1.0",
    app: {
      id: "io.casys.mcp-build123d.results",
      title: "Build123d geometry",
      version: "1.2.3",
    },
    resources: [{
      uri: "ui://mcp-build123d/results-viewer",
      ownership: "whole-view",
      acceptedActions: ["viewer.session.apply"],
      sessionSchemas: [
        "io.casys.mcp-build123d.recorded-geometry-session/1.0",
        "io.casys.mcp-build123d.recorded-mesh-session/1.0",
      ],
      resultSchemas: ["io.casys.mcp-build123d.geometry-result/1.0"],
    }],
  }));
  const html = new TextEncoder().encode(
    "<!doctype html><html><head><meta charset=utf-8></head><body><script type=\"module\">parent.postMessage({jsonrpc:'2.0',id:1,method:'ui/initialize',params:{}} ,'*')</script></body></html>",
  );
  const asset = new Uint8Array([0x67, 0x6c, 0x54, 0x46]);
  const manifestFingerprint = await rawFingerprint(manifest);
  const htmlFingerprint = await rawFingerprint(html);
  const assetFingerprint = await rawFingerprint(asset);
  const store = new FileByteStore({
    kind: "thread-viewer-app-object",
    directory: objectDirectory,
    uriNamespace: "thread-viewer-apps",
    label: "Thread viewer App object",
  });
  await store.save(manifestFingerprint, manifest);
  await store.save(htmlFingerprint, html);
  await store.save(assetFingerprint, asset);

  const payload = {
    schemaVersion: "io.casys.mcp-build123d.recorded-geometry-session/1.0",
    projection: {
      status: "available",
      resourceFingerprint: fingerprint(assetFingerprint),
    },
  } as const;
  const payloadFingerprint = await sha256Fingerprint(payload);
  const binding: ThreadViewerAppBinding = {
    basis: {
      projectId: "project-one",
      projectRevision: 7,
      subjectId: "subject-one",
      thread: { id: "thread-one", revision: 3 },
    },
    anchor: { kind: "artifact", id: "artifact-one" },
    app: { id: "io.casys.mcp-build123d.results", version: "1.2.3" },
    manifest: {
      uri: "ui://mcp-build123d/app-manifest",
      fingerprint: fingerprint(manifestFingerprint),
    },
    resource: {
      uri: "ui://mcp-build123d/results-viewer",
      fingerprint: fingerprint(htmlFingerprint),
      ownership: "whole-view",
      mimeType: "text/html;profile=mcp-app",
      bytes: html.byteLength,
    },
    readResources: [{
      uri: `${THREAD_VIEWER_APP_RESOURCE_PREFIX}${assetFingerprint.digest}`,
      mimeType: "model/gltf-binary",
      bytes: asset.byteLength,
      fingerprint: fingerprint(assetFingerprint),
    }],
    session: {
      action: "viewer.session.apply",
      schema: payload.schemaVersion,
      payload,
      fingerprint: fingerprint(payloadFingerprint),
    },
  };
  return {
    binding,
    manifest,
    html,
    asset,
    document: {
      schemaVersion: THREAD_VIEWER_APP_REGISTRY_SCHEMA,
      bindings: [binding],
      objects: [
        {
          role: "manifest",
          mimeType: "application/json",
          bytes: manifest.byteLength,
          fingerprint: fingerprint(manifestFingerprint),
        },
        {
          role: "whole-view",
          mimeType: "text/html;profile=mcp-app",
          bytes: html.byteLength,
          fingerprint: fingerprint(htmlFingerprint),
        },
        {
          role: "read-resource",
          mimeType: "model/gltf-binary",
          bytes: asset.byteLength,
          fingerprint: fingerprint(assetFingerprint),
        },
      ],
    },
  };
}

function fingerprint(value: { algorithm: "sha256"; digest: string }): string {
  return `${value.algorithm}:${value.digest}`;
}

function digest(value: string): string {
  return value.slice("sha256:".length);
}

async function rawFingerprint(bytes: Uint8Array) {
  const digestBytes = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes),
  );
  return {
    algorithm: "sha256" as const,
    digest: [...new Uint8Array(digestBytes)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(""),
  };
}
