import {
  type EnvironmentReader,
  type LayoutEnvironmentName,
  resolveApplicationSupportLayout,
} from "./layout.ts";

const PRODUCT_IDENTIFIER = "ai.casys.digital-thread";

function env(
  values: Partial<Record<LayoutEnvironmentName, string>>,
): EnvironmentReader {
  return (name) => values[name];
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
  input: Parameters<typeof resolveApplicationSupportLayout>[0],
  code: string,
): { code: string; message: string; recovery: string } {
  const result = resolveApplicationSupportLayout(input);
  if (result.ok) {
    throw new Error(`expected failure ${code}, got ${JSON.stringify(result.value)}`);
  }
  assertEquals(result.error.code, code, `error code should be ${code}`);
  if (
    result.error.message.includes("/Users/") || result.error.message.includes("C:\\")
  ) {
    throw new Error("layout errors must not leak absolute local paths");
  }
  return result.error;
}

Deno.test("resolveApplicationSupportLayout returns the macOS application-support layout", () => {
  const result = resolveApplicationSupportLayout({
    platform: "macOS",
    productIdentifier: PRODUCT_IDENTIFIER,
    env: env({ HOME: "/Users/ada" }),
  });
  if (!result.ok) throw new Error(result.error.message);
  const root = "/Users/ada/Library/Application Support/ai.casys.digital-thread";
  assertEquals(result.value, {
    root,
    controlPlaneLaunchCwd: "/Users/ada/Library/Application Support",
    controlPlaneWorkspace: `${root}/control-plane`,
    controlPlaneRelativeWorkspace: "ai.casys.digital-thread/control-plane",
    controlPlaneLayoutProfile: "macos-application-support",
    config: `${root}/config`,
    thread: `${root}/thread`,
    cas: `${root}/cas`,
    experience: `${root}/experience`,
    journals: `${root}/journals`,
    logs: `${root}/logs`,
    cache: `${root}/cache`,
    runtime: `${root}/runtime`,
  });
  for (
    const path of [
      result.value.root,
      result.value.controlPlaneWorkspace,
      result.value.config,
      result.value.thread,
      result.value.cas,
      result.value.experience,
      result.value.journals,
      result.value.logs,
      result.value.cache,
      result.value.runtime,
    ]
  ) {
    if (path === "/Users/ada") {
      throw new Error("macOS layout must not use the home-directory root");
    }
  }
});

Deno.test("resolveApplicationSupportLayout prefers Linux XDG_DATA_HOME over HOME", () => {
  const result = resolveApplicationSupportLayout({
    platform: "Linux",
    productIdentifier: PRODUCT_IDENTIFIER,
    env: env({
      HOME: "/home/ada",
      XDG_DATA_HOME: "/var/lib/casys-data",
    }),
  });
  if (!result.ok) throw new Error(result.error.message);
  const root = "/var/lib/casys-data/ai.casys.digital-thread";
  assertEquals(result.value.root, root);
  assertEquals(result.value.controlPlaneLaunchCwd, "/var/lib/casys-data");
  assertEquals(
    result.value.controlPlaneRelativeWorkspace,
    "ai.casys.digital-thread/control-plane",
  );
  assertEquals(result.value.controlPlaneLayoutProfile, "linux-xdg");
  assertEquals(result.value.thread, `${root}/thread`);
  assertEquals(result.value.cas, `${root}/cas`);
  if (result.value.root.startsWith("/home/ada")) {
    throw new Error(
      "Linux layout must not fall back to HOME when XDG_DATA_HOME is set",
    );
  }
});

Deno.test("resolveApplicationSupportLayout uses the Linux XDG default under HOME", () => {
  const result = resolveApplicationSupportLayout({
    platform: "Linux",
    productIdentifier: PRODUCT_IDENTIFIER,
    env: env({ HOME: "/home/ada" }),
  });
  if (!result.ok) throw new Error(result.error.message);
  const root = "/home/ada/.local/share/ai.casys.digital-thread";
  assertEquals(result.value.root, root);
  assertEquals(result.value.controlPlaneLaunchCwd, "/home/ada");
  assertEquals(
    result.value.controlPlaneRelativeWorkspace,
    ".local/share/ai.casys.digital-thread/control-plane",
  );
  assertEquals(result.value.controlPlaneLayoutProfile, "linux-home");
  assertEquals(result.value.config, `${root}/config`);
  assertEquals(result.value.runtime, `${root}/runtime`);
  if (result.value.root === "/home/ada") {
    throw new Error("Linux layout must not choose the home-directory root");
  }
});

Deno.test("resolveApplicationSupportLayout splits Windows roaming config from local data", () => {
  const result = resolveApplicationSupportLayout({
    platform: "Windows",
    productIdentifier: PRODUCT_IDENTIFIER,
    env: env({
      APPDATA: "C:\\Users\\ada\\AppData\\Roaming",
      LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local",
    }),
  });
  if (!result.ok) throw new Error(result.error.message);
  const root = "C:\\Users\\ada\\AppData\\Local\\ai.casys.digital-thread";
  const roaming = "C:\\Users\\ada\\AppData\\Roaming\\ai.casys.digital-thread";
  assertEquals(result.value, {
    root,
    controlPlaneLaunchCwd: "C:\\Users\\ada\\AppData\\Local",
    controlPlaneWorkspace: `${root}\\control-plane`,
    controlPlaneRelativeWorkspace: "ai.casys.digital-thread\\control-plane",
    controlPlaneLayoutProfile: "windows-local-appdata",
    config: `${roaming}\\config`,
    thread: `${root}\\thread`,
    cas: `${root}\\cas`,
    experience: `${root}\\experience`,
    journals: `${root}\\journals`,
    logs: `${root}\\logs`,
    cache: `${root}\\cache`,
    runtime: `${root}\\runtime`,
  });
});

Deno.test("resolveApplicationSupportLayout fails when the platform base cannot be resolved", () => {
  assertFailed({
    platform: "macOS",
    productIdentifier: PRODUCT_IDENTIFIER,
    env: env({}),
  }, "layout.base-unresolved");

  assertFailed({
    platform: "Linux",
    productIdentifier: PRODUCT_IDENTIFIER,
    env: env({}),
  }, "layout.base-unresolved");

  assertFailed({
    platform: "Windows",
    productIdentifier: PRODUCT_IDENTIFIER,
    env: env({ APPDATA: "C:\\Users\\ada\\AppData\\Roaming" }),
  }, "layout.base-unresolved");

  assertFailed({
    platform: "Windows",
    productIdentifier: PRODUCT_IDENTIFIER,
    env: env({ LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local" }),
  }, "layout.base-unresolved");
});

Deno.test("resolveApplicationSupportLayout rejects a home-directory root as the data base", () => {
  assertFailed({
    platform: "Linux",
    productIdentifier: PRODUCT_IDENTIFIER,
    env: env({ HOME: "/home/ada", XDG_DATA_HOME: "/home/ada" }),
  }, "layout.home-root-rejected");

  assertFailed({
    platform: "Windows",
    productIdentifier: PRODUCT_IDENTIFIER,
    env: env({
      APPDATA: "C:\\Users\\ada",
      LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local",
    }),
  }, "layout.home-root-rejected");

  assertFailed({
    platform: "macOS",
    productIdentifier: PRODUCT_IDENTIFIER,
    env: env({ HOME: "/" }),
  }, "layout.home-root-rejected");

  assertFailed({
    platform: "Linux",
    productIdentifier: PRODUCT_IDENTIFIER,
    env: env({ HOME: "/", XDG_DATA_HOME: "/" }),
  }, "layout.home-root-rejected");
});

Deno.test("resolveApplicationSupportLayout rejects relative or checkout-like bases", () => {
  assertFailed({
    platform: "macOS",
    productIdentifier: PRODUCT_IDENTIFIER,
    env: env({ HOME: "." }),
  }, "layout.relative-path-rejected");

  assertFailed({
    platform: "Linux",
    productIdentifier: PRODUCT_IDENTIFIER,
    env: env({ XDG_DATA_HOME: "state/local" }),
  }, "layout.relative-path-rejected");

  assertFailed({
    platform: "macOS",
    productIdentifier: PRODUCT_IDENTIFIER,
    env: env({ HOME: "casys-digital-thread-deno-desktop-lot1" }),
  }, "layout.relative-path-rejected");

  assertFailed({
    platform: "Linux",
    productIdentifier: PRODUCT_IDENTIFIER,
    env: env({ HOME: "/home/ada/.." }),
  }, "layout.relative-path-rejected");
});

Deno.test("resolveApplicationSupportLayout never returns the repository checkout or cwd", () => {
  const result = resolveApplicationSupportLayout({
    platform: "macOS",
    productIdentifier: PRODUCT_IDENTIFIER,
    env: env({ HOME: "/Users/ada" }),
  });
  if (!result.ok) throw new Error(result.error.message);
  for (const path of Object.values(result.value)) {
    if (path === "." || path.startsWith("./") || path.includes("..")) {
      throw new Error(`layout path ${path} is not an application-support path`);
    }
  }
});

Deno.test("resolveApplicationSupportLayout rejects an invalid platform or identifier", () => {
  assertFailed({
    platform: "darwin" as unknown as "macOS",
    productIdentifier: PRODUCT_IDENTIFIER,
    env: env({ HOME: "/Users/ada" }),
  }, "layout.platform-invalid");

  assertFailed({
    platform: "macOS",
    productIdentifier: "../tmp",
    env: env({ HOME: "/Users/ada" }),
  }, "layout.product-invalid");
});
