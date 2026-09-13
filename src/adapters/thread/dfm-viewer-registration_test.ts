import { assert, assertEquals, assertRejects } from "@std/assert";
import { FileEngineeringProjectRevisionStore } from "../shared/stores/engineering-project-store.ts";
import { FileThreadViewerAppRegistrar } from "./thread-viewer-app-registrar.ts";
import { FileThreadViewerAppRegistry } from "./file-thread-viewer-app-registry.ts";
import { DFM_VIEWER_SESSION_SCHEMA } from "./dfm-viewer-binding.ts";
import {
  createDfmViewerFixture,
  DFM_VIEWER_PROJECT_ID,
  DFM_VIEWER_STAGED_PATH,
  persistDfmViewerRegistrarState,
  writeDfmViewerPackageCatalog,
} from "./dfm-viewer-test-fixture.ts";

Deno.test("automatic registrar materializes one DFM whole-App binding and is idempotent across restarts", async () => {
  const root = await Deno.makeTempDir({ prefix: "dfm-viewer-registrar-" });
  try {
    const fixture = await createDfmViewerFixture();
    const projectSeal = JSON.stringify(fixture.project);
    const threadSeal = JSON.stringify(fixture.thread);
    await persistDfmViewerRegistrarState(root, fixture);
    await writeDfmViewerPackageCatalog(root);
    const directory = `${root}/state/local/thread-viewer-apps`;
    const registrar = new FileThreadViewerAppRegistrar({ root });
    const firstReconcile = await registrar.reconcile();
    assertEquals(firstReconcile.status, "updated");
    assertEquals(firstReconcile.projectCount, 1);
    assertEquals(firstReconcile.bindingCount, 1);
    assert(
      firstReconcile.diagnostics.every((item) => item.code === "app-unavailable"),
    );
    const registry = new FileThreadViewerAppRegistry({
      registryPath: `${directory}/registry.json`,
      objectDirectory: `${directory}/objects`,
    });
    const first = (await registry.read())!;
    assertEquals(first.bindings.length, 1);
    assertEquals(first.bindings[0]?.session.schema, DFM_VIEWER_SESSION_SCHEMA);
    assertEquals(first.bindings[0]?.anchor.id, fixture.artifactId);
    const persisted = await new FileEngineeringProjectRevisionStore(
      `${root}/state/local/engineering-projects`,
    ).get(DFM_VIEWER_PROJECT_ID);
    assertEquals(
      first.bindings[0]?.basis.projectRevision,
      persisted?.revision,
    );
    const serialized = JSON.stringify(first.bindings[0]?.session.payload);
    assertEquals(serialized.includes("stagedPath"), false);
    assertEquals(serialized.includes(DFM_VIEWER_STAGED_PATH), false);
    assertEquals(serialized.includes("volume_status"), false);
    const bytes = await Deno.readFile(`${directory}/registry.json`);
    assertEquals((await registrar.reconcile()).status, "unchanged");
    assertEquals(
      (await new FileThreadViewerAppRegistrar({ root }).reconcile()).status,
      "unchanged",
    );
    assertEquals(await Deno.readFile(`${directory}/registry.json`), bytes);
    assertEquals(JSON.stringify(fixture.project), projectSeal);
    assertEquals(JSON.stringify(fixture.thread), threadSeal);

    const checkPath =
      `${root}/state/local/dfm-check-captures/${fixture.captureFingerprint.digest}.json`;
    const goodRegistry = await Deno.readFile(`${directory}/registry.json`);
    await Deno.writeTextFile(checkPath, "{}");
    const failedRead = await new FileThreadViewerAppRegistrar({ root })
      .reconcile();
    assert(
      failedRead.diagnostics.some((item) => item.code === "registration-error"),
    );
    assertEquals(await Deno.readFile(`${directory}/registry.json`), goodRegistry);
    await Deno.writeTextFile(checkPath, fixture.captureText);
    await Deno.writeTextFile(`${directory}/packages.json`, "{}");
    await assertRejects(() => registrar.reconcile(), TypeError);
    assertEquals(await Deno.readFile(`${directory}/registry.json`), goodRegistry);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("automatic registrar leaves DFM unavailable without a compatible package", async () => {
  const root = await Deno.makeTempDir({ prefix: "dfm-viewer-registrar-pkg-" });
  try {
    const fixture = await createDfmViewerFixture();
    await persistDfmViewerRegistrarState(root, fixture);
    await writeDfmViewerPackageCatalog(root, { omit: true });
    const result = await new FileThreadViewerAppRegistrar({ root }).reconcile();
    assertEquals(result.bindingCount, 0);
    assertEquals(result.diagnostics[0]?.code, "app-unavailable");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("automatic registrar refuses an ambiguous DFM package catalogue", async () => {
  const root = await Deno.makeTempDir({ prefix: "dfm-viewer-registrar-amb-" });
  try {
    const fixture = await createDfmViewerFixture();
    await persistDfmViewerRegistrarState(root, fixture);
    await writeDfmViewerPackageCatalog(root, { duplicate: true });
    await assertRejects(
      () => new FileThreadViewerAppRegistrar({ root }).reconcile(),
      TypeError,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
