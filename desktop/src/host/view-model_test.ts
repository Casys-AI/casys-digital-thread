import type { DesktopShellViewModel } from "../contracts/diagnostics.ts";
import { classifyShellStatus } from "./classify.ts";
import { resolveApplicationSupportLayout } from "./layout.ts";
import { validateComponentManifest } from "./manifest.ts";
import { fail } from "./result.ts";
import { deriveDesktopShellViewModel } from "./view-model.ts";

const EMBEDDED_MANIFEST = {
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

function assertEquals(actual: unknown, expected: unknown, message?: string): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) {
    throw new Error(
      `${message ?? "assertEquals failed"}\nactual:   ${left}\nexpected: ${right}`,
    );
  }
}

function macosLayout() {
  return resolveApplicationSupportLayout({
    platform: "macOS",
    productIdentifier: "ai.casys.digital-thread",
    env: (name) => name === "HOME" ? "/Users/ada" : undefined,
  });
}

function lot1Observations() {
  return {
    manifest: validateComponentManifest(EMBEDDED_MANIFEST),
    actualDenoVersion: "2.9.2",
    actualDesktopRuntimeVersion: "2.9.2",
    actualProductVersion: "0.1.0",
    platform: "macOS" as const,
    layout: macosLayout(),
  };
}

function lot2Observations() {
  const manifest = structuredClone(EMBEDDED_MANIFEST);
  manifest.product.version = "0.2.0";
  manifest.components[0].version = "0.2.0";
  manifest.components[1] = {
    id: "casys-control-plane",
    version: "0.2.0",
    delivery: "sidecar",
    lifecycle: "active",
  };
  return {
    ...lot1Observations(),
    manifest: validateComponentManifest(manifest),
    actualProductVersion: "0.2.0",
    controlPlane: {
      configuration: "verified" as const,
      lifecycle: "owned-ready" as const,
      controlPlaneVersion: "0.2.0",
      providers: {
        state: "unavailable" as const,
        total: 8,
        healthy: 0,
        drift: 8,
      },
      persistedEvidence: "unavailable" as const,
    },
  };
}

function serialized(model: DesktopShellViewModel): string {
  return JSON.stringify(model);
}

function assertNoAbsolutePath(model: DesktopShellViewModel): void {
  const text = serialized(model);
  const leaks = [
    "/Users/",
    "/home/",
    "/var/",
    "C:\\",
    "C:/",
    "AppData",
    "Application Support",
    ".local/share",
    "/Users/ada",
  ];
  for (const leak of leaks) {
    if (text.includes(leak)) {
      throw new Error(`view model leaked local path fragment ${leak}: ${text}`);
    }
  }
}

function states(model: DesktopShellViewModel): Record<string, string> {
  return Object.fromEntries(
    model.components.map((component) => [component.id, component.state]),
  );
}

Deno.test("deriveDesktopShellViewModel yields a degraded Lot 1 aggregate", () => {
  const model = deriveDesktopShellViewModel(lot1Observations());
  assertEquals(model.productName, "Casys Digital Thread");
  assertEquals(model.productVersion, "0.1.0");
  assertEquals(model.status, "degraded");
  assertEquals(model.platform, "macOS");
  assertEquals(model.status, classifyShellStatus(model.components));
  assertEquals(states(model), {
    manifest: "ready",
    runtime: "ready",
    layout: "ready",
    "desktop-shell": "ready",
    "casys-control-plane": "unavailable",
    "engineering-providers": "unavailable",
    "workbench-projection": "unavailable",
    "chat-host": "unavailable",
  });
  if (!model.summary.includes("unavailable")) {
    throw new Error("degraded summary must keep the unavailable label");
  }
  if (!model.title.includes("degraded")) {
    throw new Error("title must keep the degraded label");
  }
  assertNoAbsolutePath(model);
});

Deno.test("deriveDesktopShellViewModel is recovery-required when the manifest is invalid", () => {
  const model = deriveDesktopShellViewModel({
    ...lot1Observations(),
    manifest: fail(
      "manifest.version-alias",
      "runtime.denoVersion must not be the alias latest",
      "Pin an exact Deno version.",
    ),
  });
  assertEquals(model.status, "recovery-required");
  assertEquals(states(model).manifest, "error");
  assertEquals(states(model)["desktop-shell"], "error");
  assertEquals(states(model)["casys-control-plane"], "unavailable");
  if (!model.summary.includes("error")) {
    throw new Error("recovery summary must keep the error label");
  }
  assertNoAbsolutePath(model);
});

Deno.test("deriveDesktopShellViewModel is recovery-required when the runtime pin does not match", () => {
  const model = deriveDesktopShellViewModel({
    ...lot1Observations(),
    actualDenoVersion: "2.8.0",
    actualDesktopRuntimeVersion: "2.9.2",
    actualProductVersion: "0.1.0",
  });
  assertEquals(model.status, "recovery-required");
  assertEquals(states(model).runtime, "error");
  assertEquals(states(model).manifest, "ready");
  assertEquals(states(model).layout, "ready");
  assertEquals(states(model)["desktop-shell"], "error");
  if (!model.components.find((component) => component.id === "runtime")?.recovery) {
    throw new Error("runtime mismatch must carry recovery");
  }
  assertNoAbsolutePath(model);
});

Deno.test("deriveDesktopShellViewModel independently verifies the baked product version", () => {
  for (const actualProductVersion of ["0.1.1", null]) {
    const model = deriveDesktopShellViewModel({
      ...lot1Observations(),
      actualProductVersion,
    });
    assertEquals(model.status, "recovery-required");
    assertEquals(states(model).runtime, "error");
    assertEquals(states(model)["desktop-shell"], "error");
    assertNoAbsolutePath(model);
  }
});

Deno.test("deriveDesktopShellViewModel is recovery-required when layout resolution fails", () => {
  const model = deriveDesktopShellViewModel({
    ...lot1Observations(),
    layout: fail(
      "layout.base-unresolved",
      "HOME is unset, so the macOS application-support base cannot be resolved",
      "Set HOME so the macOS application-support base can be resolved.",
    ),
  });
  assertEquals(model.status, "recovery-required");
  assertEquals(states(model).layout, "error");
  assertEquals(states(model).manifest, "ready");
  assertEquals(states(model)["desktop-shell"], "error");
  assertNoAbsolutePath(model);
});

Deno.test("deriveDesktopShellViewModel never copies layout paths into renderer fields", () => {
  const layout = macosLayout();
  if (!layout.ok) throw new Error(layout.error.message);
  const model = deriveDesktopShellViewModel({
    ...lot1Observations(),
    layout,
  });
  const text = serialized(model);
  for (const path of Object.values(layout.value)) {
    if (text.includes(path)) {
      throw new Error(`absolute layout path leaked: ${path}`);
    }
  }
  assertNoAbsolutePath(model);
});

Deno.test("deriveDesktopShellViewModel keeps deferred components unavailable, not ready", () => {
  const model = deriveDesktopShellViewModel(lot1Observations());
  for (
    const id of [
      "casys-control-plane",
      "engineering-providers",
      "workbench-projection",
      "chat-host",
    ]
  ) {
    const component = model.components.find((entry) => entry.id === id);
    if (component?.state !== "unavailable") {
      throw new Error(`${id} must remain unavailable, got ${component?.state}`);
    }
  }
  if (model.status === "ready") {
    throw new Error("Lot 1 must not manufacture an all-ready product state");
  }
});

Deno.test("deriveDesktopShellViewModel keeps ready control plane separate from unavailable providers", () => {
  const model = deriveDesktopShellViewModel(lot2Observations());
  assertEquals(model.status, "degraded");
  assertEquals(states(model)["desktop-configuration"], "ready");
  assertEquals(states(model)["casys-control-plane"], "ready");
  assertEquals(states(model)["engineering-providers"], "unavailable");
  assertEquals(states(model)["persisted-project-evidence"], "unavailable");
  assertEquals(states(model)["workbench-projection"], "unavailable");
  assertEquals(states(model)["chat-host"], "unavailable");
  assertNoAbsolutePath(model);
});

Deno.test("an unavailable helper needs no fabricated observed version or fleet counts", () => {
  const observations = lot2Observations();
  const model = deriveDesktopShellViewModel({
    ...observations,
    controlPlane: {
      configuration: "missing",
      lifecycle: "unavailable",
      providers: { state: "unavailable" },
      persistedEvidence: "unavailable",
    },
  });
  assertEquals(model.status, "degraded");
  assertEquals(states(model)["casys-control-plane"], "unavailable");
  assertEquals(states(model)["engineering-providers"], "unavailable");
  assertEquals(
    model.components.find((component) => component.id === "casys-control-plane")
      ?.version,
    undefined,
  );
  assertNoAbsolutePath(model);
});

Deno.test("non-ready lifecycle data cannot project process identity into the renderer", () => {
  const observations = lot2Observations();
  const projection = {
    configuration: "missing" as const,
    lifecycle: "unavailable" as const,
    controlPlaneVersion: "0.2.0",
    providers: { state: "unavailable" as const },
    persistedEvidence: "unavailable" as const,
    pid: 4242,
    helperPath: "/Users/ada/private/casys-control-plane",
    launchId: "11111111-1111-4111-8111-111111111111",
    configDigest:
      "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    endpoint: "http://127.0.0.1:3020/mcp",
  };
  const model = deriveDesktopShellViewModel({
    ...observations,
    controlPlane: projection,
  });
  const text = serialized(model);
  for (
    const forbidden of [
      "4242",
      "/Users/ada/private",
      "11111111-1111-4111-8111-111111111111",
      "sha256:",
      "127.0.0.1",
      "/mcp",
    ]
  ) {
    if (text.includes(forbidden)) {
      throw new Error(`renderer DTO leaked ${forbidden}`);
    }
  }
  assertEquals(
    model.components.find((component) => component.id === "casys-control-plane")
      ?.version,
    undefined,
  );
});

Deno.test("deriveDesktopShellViewModel fails closed for an unowned canonical listener", () => {
  const observations = lot2Observations();
  const model = deriveDesktopShellViewModel({
    ...observations,
    controlPlane: {
      ...observations.controlPlane,
      lifecycle: "recovery-required",
      recoveryCode: "foreign-listener",
    },
  });
  assertEquals(model.status, "recovery-required");
  assertEquals(states(model)["casys-control-plane"], "error");
  const serializedModel = serialized(model);
  if (!serializedModel.includes("without exact Desktop ownership")) {
    throw new Error("foreign listener evidence must remain explicit");
  }
  for (const forbidden of ["pid", "launchId", "127.0.0.1:3020"]) {
    if (serializedModel.includes(forbidden)) {
      throw new Error(`control-plane projection leaked ${forbidden}`);
    }
  }
  assertNoAbsolutePath(model);
});

Deno.test("deriveDesktopShellViewModel rejects a control-plane version mismatch without echoing it", () => {
  const observations = lot2Observations();
  const sentinel = "/Users/private/nonce-1234";
  const model = deriveDesktopShellViewModel({
    ...observations,
    controlPlane: {
      ...observations.controlPlane,
      controlPlaneVersion: sentinel,
    },
  });
  assertEquals(model.status, "recovery-required");
  assertEquals(states(model)["casys-control-plane"], "error");
  if (serialized(model).includes(sentinel)) {
    throw new Error("mismatched runtime identity must not reach the view model");
  }
  assertNoAbsolutePath(model);
});

Deno.test("deriveDesktopShellViewModel never promotes demo or run candidates to verified evidence", () => {
  const observations = lot2Observations();
  const model = deriveDesktopShellViewModel({
    ...observations,
    controlPlane: {
      ...observations.controlPlane,
      persistedEvidence: "candidate-unverified",
    },
  });
  assertEquals(states(model)["persisted-project-evidence"], "unresolved");
  if (!serialized(model).includes("has not validated exact Thread evidence")) {
    throw new Error("candidate evidence must retain its unverified limitation");
  }
});

Deno.test("deriveDesktopShellViewModel rejects inconsistent provider counts", () => {
  const observations = lot2Observations();
  const model = deriveDesktopShellViewModel({
    ...observations,
    controlPlane: {
      ...observations.controlPlane,
      providers: { state: "healthy", total: 2, healthy: 3, drift: 0 },
    },
  });
  assertEquals(model.status, "recovery-required");
  assertEquals(states(model)["engineering-providers"], "error");
});
