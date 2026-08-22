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
