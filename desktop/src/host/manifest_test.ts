import { fail, ok } from "./result.ts";
import { type ComponentManifest, validateComponentManifest } from "./manifest.ts";

const EMBEDDED_MANIFEST: ComponentManifest = {
  schemaVersion: "casys-desktop-components/1.0",
  product: {
    identifier: "ai.casys.digital-thread",
    name: "Casys Digital Thread",
    version: "0.1.0",
  },
  runtime: {
    denoVersion: "2.9.2",
    desktopRuntimeVersion: "2.9.2",
    backend: "webview",
    backendVersionAuthority: "operating-system",
  },
  components: [
    {
      id: "desktop-shell",
      version: "0.1.0",
      delivery: "bundled",
      lifecycle: "active",
    },
    {
      id: "casys-control-plane",
      version: null,
      delivery: "local",
      lifecycle: "deferred-lot-2",
    },
    {
      id: "workbench-projection",
      version: null,
      delivery: "bundled",
      lifecycle: "deferred-lot-3",
    },
    {
      id: "chat-host",
      version: null,
      delivery: "sidecar",
      lifecycle: "deferred-lot-4",
    },
  ],
};

function cloneManifest(): Record<string, unknown> {
  return structuredClone(EMBEDDED_MANIFEST) as unknown as Record<string, unknown>;
}

function assertEquals(actual: unknown, expected: unknown, message?: string): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) {
    throw new Error(
      `${message ?? "assertEquals failed"}\nactual:   ${left}\nexpected: ${right}`,
    );
  }
}

function assertFailed(
  value: unknown,
  code: string,
): { code: string; message: string; recovery: string } {
  const result = validateComponentManifest(value);
  if (result.ok) {
    throw new Error(`expected failure ${code}, got a valid manifest`);
  }
  assertEquals(result.error.code, code, `error code should be ${code}`);
  if (result.error.message.length === 0) {
    throw new Error("failure message must not be empty");
  }
  if (result.error.recovery.length === 0) {
    throw new Error("failure recovery must not be empty");
  }
  return result.error;
}

Deno.test("validateComponentManifest accepts the exact embedded Lot 1 document", () => {
  const result = validateComponentManifest(EMBEDDED_MANIFEST);
  assertEquals(result, ok(EMBEDDED_MANIFEST));
  if (!result.ok) throw new Error("expected ok");
  if (!Object.isFrozen(result.value)) {
    throw new Error("validated manifest must be frozen");
  }
  if (!Object.isFrozen(result.value.components)) {
    throw new Error("validated components must be frozen");
  }
});

Deno.test("validateComponentManifest rejects a non-object root", () => {
  assertFailed(null, "manifest.schema-invalid");
  assertFailed([], "manifest.schema-invalid");
  assertFailed("casys-desktop-components/1.0", "manifest.schema-invalid");
});

Deno.test("validateComponentManifest rejects a wrong schemaVersion", () => {
  const extra = cloneManifest();
  extra.schemaVersion = "casys-desktop-components/2.0";
  assertFailed(extra, "manifest.schema-invalid");
  const missing = cloneManifest();
  delete missing.schemaVersion;
  assertFailed(missing, "manifest.schema-invalid");
  const unknownKey = cloneManifest();
  unknownKey.extra = true;
  assertFailed(unknownKey, "manifest.schema-invalid");
});

Deno.test("validateComponentManifest rejects a wrong product shape", () => {
  const missing = cloneManifest();
  delete missing.product;
  assertFailed(missing, "manifest.schema-invalid");

  const notObject = cloneManifest();
  notObject.product = "Casys Digital Thread";
  assertFailed(notObject, "manifest.product-invalid");

  const extraField = cloneManifest();
  (extraField.product as Record<string, unknown>).channel = "stable";
  assertFailed(extraField, "manifest.product-invalid");

  const emptyName = cloneManifest();
  (emptyName.product as Record<string, unknown>).name = " ";
  assertFailed(emptyName, "manifest.product-invalid");

  const badIdentifier = cloneManifest();
  (badIdentifier.product as Record<string, unknown>).identifier =
    "../casys-digital-thread";
  assertFailed(badIdentifier, "manifest.product-invalid");
});

Deno.test("validateComponentManifest rejects a wrong runtime shape", () => {
  const missing = cloneManifest();
  delete missing.runtime;
  assertFailed(missing, "manifest.schema-invalid");

  const backend = cloneManifest();
  (backend.runtime as Record<string, unknown>).backend = "chrome";
  assertFailed(backend, "manifest.runtime-invalid");

  const authority = cloneManifest();
  (authority.runtime as Record<string, unknown>).backendVersionAuthority =
    "pinned-chromium";
  assertFailed(authority, "manifest.runtime-invalid");

  const extraField = cloneManifest();
  (extraField.runtime as Record<string, unknown>).channel = "stable";
  assertFailed(extraField, "manifest.runtime-invalid");
});

Deno.test("validateComponentManifest rejects semver-like aliases", () => {
  for (
    const [path, alias] of [
      ["product", "latest"],
      ["product", "canary"],
      ["product", "nightly"],
      ["runtime.denoVersion", "latest"],
      ["runtime.desktopRuntimeVersion", "CANARY"],
      ["desktop-shell", "nightly"],
    ] as const
  ) {
    const manifest = cloneManifest();
    if (path === "product") {
      (manifest.product as Record<string, unknown>).version = alias;
    } else if (path === "runtime.denoVersion") {
      (manifest.runtime as Record<string, unknown>).denoVersion = alias;
    } else if (path === "runtime.desktopRuntimeVersion") {
      (manifest.runtime as Record<string, unknown>).desktopRuntimeVersion = alias;
    } else {
      (manifest.components as Record<string, unknown>[])[0].version = alias;
    }
    const error = assertFailed(manifest, "manifest.version-alias");
    if (
      !error.message.includes(alias.toLowerCase()) && !error.message.includes(alias)
    ) {
      throw new Error(`alias ${alias} should appear in the message`);
    }
  }
});

Deno.test("validateComponentManifest rejects invalid exact versions", () => {
  for (
    const version of ["", "2", "2.9", "2.9.2.0", "v2.9.2", "^2.9.2", "~0.1.0", "1.x"]
  ) {
    const manifest = cloneManifest();
    (manifest.product as Record<string, unknown>).version = version;
    assertFailed(manifest, "manifest.version-invalid");
  }
});

Deno.test("validateComponentManifest rejects duplicate component ids", () => {
  const manifest = cloneManifest();
  (manifest.components as Record<string, unknown>[]).push({
    id: "desktop-shell",
    version: "0.1.1",
    delivery: "bundled",
    lifecycle: "active",
  });
  const error = assertFailed(manifest, "manifest.duplicate-id");
  if (!error.message.includes("desktop-shell")) {
    throw new Error("duplicate id should name desktop-shell");
  }
});

Deno.test("validateComponentManifest rejects an unpinned active executable component", () => {
  const manifest = cloneManifest();
  (manifest.components as Record<string, unknown>[])[0].version = null;
  const error = assertFailed(manifest, "manifest.unpinned-active");
  if (!error.message.includes("desktop-shell")) {
    throw new Error("unpinned active failure should name desktop-shell");
  }
});

Deno.test("validateComponentManifest binds the shell version to the product release", () => {
  const manifest = cloneManifest();
  (manifest.components as Record<string, unknown>[])[0].version = "0.1.1";
  assertFailed(manifest, "manifest.lifecycle-inconsistent");
});

Deno.test("validateComponentManifest rejects inconsistent lifecycle and version combinations", () => {
  const pinnedDeferred = cloneManifest();
  (pinnedDeferred.components as Record<string, unknown>[])[1].version = "1.0.0";
  assertFailed(pinnedDeferred, "manifest.lifecycle-inconsistent");

  const activeDeferred = cloneManifest();
  (activeDeferred.components as Record<string, unknown>[])[0].lifecycle =
    "deferred-lot-2";
  assertFailed(activeDeferred, "manifest.lifecycle-inconsistent");

  const unknownLifecycle = cloneManifest();
  (unknownLifecycle.components as Record<string, unknown>[])[1].lifecycle =
    "deferred-lot-1";
  assertFailed(unknownLifecycle, "manifest.lifecycle-inconsistent");
});

Deno.test("validateComponentManifest rejects a missing desktop-shell", () => {
  const manifest = cloneManifest();
  (manifest.components as unknown[]) = (
    manifest.components as Record<string, unknown>[]
  ).filter((component) => component.id !== "desktop-shell");
  assertFailed(manifest, "manifest.lifecycle-inconsistent");
});

Deno.test("validateComponentManifest rejects malformed components", () => {
  const notArray = cloneManifest();
  notArray.components = {};
  assertFailed(notArray, "manifest.schema-invalid");

  const extraField = cloneManifest();
  (extraField.components as Record<string, unknown>[])[0].command = "start";
  assertFailed(extraField, "manifest.component-invalid");

  const badDelivery = cloneManifest();
  (badDelivery.components as Record<string, unknown>[])[2].delivery = "npm";
  assertFailed(badDelivery, "manifest.component-invalid");
});

Deno.test("fail helper stays a structured host error", () => {
  assertEquals(
    fail("manifest.schema-invalid", "broken", "replace the manifest"),
    {
      ok: false,
      error: {
        code: "manifest.schema-invalid",
        message: "broken",
        recovery: "replace the manifest",
      },
    },
  );
});
