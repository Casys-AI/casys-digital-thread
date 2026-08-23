import { assertEquals, assertFalse } from "jsr:@std/assert@1.0.14";
import rawManifest from "../../component-manifest.json" with { type: "json" };
import type { DesktopControlPlaneProjection } from "../contracts/diagnostics.ts";
import {
  type DesktopControlPlaneController,
  type DesktopControlPlaneLaunch,
  type DesktopWorkbenchController,
  startDesktopApplication,
} from "./startup.ts";

const EXECUTABLE =
  "/Applications/CasysDigitalThread.app/Contents/MacOS/Casys Digital Thread";

function input(overrides: Record<string, unknown> = {}) {
  return {
    manifest: rawManifest,
    actualDenoVersion: "2.9.2",
    actualDesktopRuntimeVersion: "2.9.2",
    actualProductVersion: rawManifest.product.version,
    platform: "macOS" as const,
    env: (name: string) => name === "HOME" ? "/Users/ada" : undefined,
    executablePath: EXECUTABLE,
    ...overrides,
  };
}

class FakeController implements DesktopControlPlaneController {
  starts = 0;
  stops = 0;

  constructor(
    readonly projection: DesktopControlPlaneProjection = readyProjection(),
    readonly failStart = false,
  ) {}

  start(): Promise<DesktopControlPlaneProjection> {
    this.starts += 1;
    if (this.failStart) return Promise.reject(new Error("private helper failure"));
    return Promise.resolve(this.projection);
  }

  stop(): Promise<void> {
    this.stops += 1;
    return Promise.resolve();
  }
}

class FakeWorkbenchController implements DesktopWorkbenchController {
  starts = 0;
  stops = 0;

  start() {
    this.starts += 1;
    return Promise.resolve({
      projection: { lifecycle: "owned-ready" as const, version: "0.3.0" },
      session: {
        origin: "http://127.0.0.1:5176" as const,
        accessToken: "a".repeat(64),
      },
    });
  }

  stop(): Promise<void> {
    this.stops += 1;
    return Promise.resolve();
  }
}

Deno.test("invalid manifest, runtime, or layout causes zero lifecycle factory", async () => {
  for (
    const invalid of [
      { manifest: { schemaVersion: "invalid" } },
      { actualDenoVersion: "2.9.1" },
      { env: (_name: string) => undefined },
    ]
  ) {
    let factories = 0;
    const application = await startDesktopApplication(input(invalid), {
      createControlPlane() {
        factories += 1;
        throw new Error("must not be reached");
      },
    });
    assertEquals(factories, 0);
    assertEquals(application.model.status, "recovery-required");
    await application.stop();
    assertEquals(factories, 0);
  }
});

Deno.test("startup resolves the platform layout exactly once before the factory", async () => {
  let homeReads = 0;
  let factories = 0;
  const application = await startDesktopApplication(
    input({
      env(name: string) {
        if (name !== "HOME") return undefined;
        homeReads += 1;
        return "/Users/ada";
      },
    }),
    {
      createControlPlane() {
        factories += 1;
        return new FakeController();
      },
    },
  );
  assertEquals(homeReads, 1);
  assertEquals(factories, 1);
  await application.stop();
});

Deno.test("a wrong active sidecar pin fails closed before the lifecycle factory", async () => {
  const manifest = structuredClone(rawManifest);
  const controlPlane = manifest.components.find((component) =>
    component.id === "casys-control-plane"
  );
  if (controlPlane === undefined) throw new Error("missing control-plane fixture");
  controlPlane.version = "0.2.1";
  let factories = 0;
  const application = await startDesktopApplication(input({ manifest }), {
    createControlPlane() {
      factories += 1;
      return new FakeController();
    },
  });
  assertEquals(factories, 0);
  assertEquals(application.model.status, "recovery-required");
  assertEquals(
    application.model.components.find((component) =>
      component.id === "casys-control-plane"
    )?.state,
    "error",
  );
});

Deno.test("a wrong active Workbench pin fails closed before either lifecycle factory", async () => {
  const manifest = structuredClone(rawManifest);
  const workbench = manifest.components.find((component) =>
    component.id === "workbench-projection"
  );
  if (workbench === undefined) throw new Error("missing Workbench fixture");
  workbench.version = "0.3.1";
  let factories = 0;
  const application = await startDesktopApplication(input({ manifest }), {
    createControlPlane() {
      factories += 1;
      return new FakeController();
    },
    createWorkbench() {
      factories += 1;
      return new FakeWorkbenchController();
    },
  });
  assertEquals(factories, 0);
  assertEquals(application.model.status, "recovery-required");
  assertEquals(
    application.model.components.find((component) =>
      component.id === "workbench-projection"
    )?.state,
    "error",
  );
});

Deno.test("an active local control plane is not accepted as the packaged sidecar", async () => {
  const manifest = structuredClone(rawManifest);
  const controlPlane = manifest.components.find((component) =>
    component.id === "casys-control-plane"
  );
  if (controlPlane === undefined) throw new Error("missing control-plane fixture");
  controlPlane.delivery = "local";
  let factories = 0;
  const application = await startDesktopApplication(input({ manifest }), {
    createControlPlane() {
      factories += 1;
      return new FakeController();
    },
  });
  assertEquals(factories, 0);
  assertEquals(application.model.status, "recovery-required");
});

Deno.test("startup passes only the nested helper and validated finite layout", async () => {
  const controller = new FakeController();
  let launch: DesktopControlPlaneLaunch | undefined;
  const application = await startDesktopApplication(input(), {
    createControlPlane(value) {
      launch = value;
      return controller;
    },
  });
  assertEquals(launch, {
    helperPath:
      "/Applications/CasysDigitalThread.app/Contents/Helpers/casys-control-plane",
    platform: "macOS",
    layoutProfile: "macos-application-support",
    launchCwd: "/Users/ada/Library/Application Support",
    relativeWorkspace: "ai.casys.digital-thread/control-plane",
    productIdentifier: "ai.casys.digital-thread",
    productVersion: "0.3.0",
    controlPlaneVersion: "0.2.0",
  });
  assertEquals(controller.starts, 1);
  assertEquals(
    application.model.components.find((component) =>
      component.id === "casys-control-plane"
    )?.state,
    "ready",
  );

  await application.stop();
  await application.stop();
  assertEquals(controller.stops, 1);
});

Deno.test("startup selects the closed Linux and Windows bundle layouts", async () => {
  const cases = [{
    platform: "Linux" as const,
    executablePath: "/opt/casys-digital-thread/bin/casys-digital-thread",
    env: (name: string) => name === "HOME" ? "/home/ada" : undefined,
    controlPlane: "/opt/casys-digital-thread/libexec/casys-control-plane",
    workbench: "/opt/casys-digital-thread/libexec/casys-workbench",
    launchCwd: "/home/ada",
    layoutProfile: "linux-home",
    relativeWorkspace: ".local/share/ai.casys.digital-thread/control-plane",
  }, {
    platform: "Windows" as const,
    executablePath: "C:\\Program Files\\CasysDigitalThread\\CasysDigitalThread.exe",
    env: (name: string) =>
      name === "APPDATA"
        ? "C:\\Users\\ada\\AppData\\Roaming"
        : name === "LOCALAPPDATA"
        ? "C:\\Users\\ada\\AppData\\Local"
        : undefined,
    controlPlane:
      "C:\\Program Files\\CasysDigitalThread\\Helpers\\casys-control-plane.exe",
    workbench: "C:\\Program Files\\CasysDigitalThread\\Helpers\\casys-workbench.exe",
    launchCwd: "C:\\Users\\ada\\AppData\\Local",
    layoutProfile: "windows-local-appdata",
    relativeWorkspace: "ai.casys.digital-thread\\control-plane",
  }];
  for (const selected of cases) {
    let controlPlane: DesktopControlPlaneLaunch | undefined;
    let workbench: DesktopControlPlaneLaunch | undefined;
    const application = await startDesktopApplication(input(selected), {
      createControlPlane(launch) {
        controlPlane = launch;
        return new FakeController();
      },
      createWorkbench(launch) {
        workbench = launch;
        return new FakeWorkbenchController();
      },
    });
    assertEquals(controlPlane?.helperPath, selected.controlPlane);
    assertEquals(workbench?.helperPath, selected.workbench);
    assertEquals(controlPlane?.platform, selected.platform);
    assertEquals(controlPlane?.launchCwd, selected.launchCwd);
    assertEquals(controlPlane?.layoutProfile, selected.layoutProfile);
    assertEquals(controlPlane?.relativeWorkspace, selected.relativeWorkspace);
    await application.stop();
  }
});

Deno.test("startup keeps Workbench capability host-only and drains both owned helpers", async () => {
  const controlPlane = new FakeController();
  const workbench = new FakeWorkbenchController();
  let workbenchLaunch: DesktopControlPlaneLaunch | undefined;
  const application = await startDesktopApplication(input(), {
    createControlPlane: () => controlPlane,
    createWorkbench(launch) {
      workbenchLaunch = launch;
      return workbench;
    },
  });
  assertEquals(
    workbenchLaunch?.helperPath,
    "/Applications/CasysDigitalThread.app/Contents/Helpers/casys-workbench",
  );
  assertEquals(workbenchLaunch?.productVersion, "0.3.0");
  assertEquals(workbench.starts, 1);
  assertEquals(application.workbenchSession?.accessToken, "a".repeat(64));
  assertFalse(JSON.stringify(application.model).includes("a".repeat(64)));
  assertFalse(JSON.stringify(application.model).includes("127.0.0.1:5176"));
  assertEquals(
    application.model.components.find((component) =>
      component.id === "workbench-projection"
    )?.state,
    "ready",
  );
  await application.stop();
  await application.stop();
  assertEquals(controlPlane.stops, 1);
  assertEquals(workbench.stops, 1);
});

Deno.test("Workbench can reopen offline state while the control plane startup is degraded", async () => {
  const workbench = new FakeWorkbenchController();
  const application = await startDesktopApplication(input(), {
    createControlPlane: () => new FakeController(readyProjection(), true),
    createWorkbench: () => workbench,
  });
  assertEquals(workbench.starts, 1);
  assertEquals(application.workbenchSession?.origin, "http://127.0.0.1:5176");
  assertEquals(
    application.model.components.find((component) =>
      component.id === "casys-control-plane"
    )?.state,
    "error",
  );
  assertEquals(
    application.model.components.find((component) =>
      component.id === "workbench-projection"
    )?.state,
    "ready",
  );
  await application.stop();
  assertEquals(workbench.stops, 1);
});

Deno.test("missing packaged helper fabricates neither a version nor provider counts", async () => {
  let factories = 0;
  const application = await startDesktopApplication(
    input({ executablePath: "/opt/homebrew/bin/deno" }),
    {
      createControlPlane() {
        factories += 1;
        return new FakeController();
      },
    },
  );
  assertEquals(factories, 0);
  const controlPlane = application.model.components.find((component) =>
    component.id === "casys-control-plane"
  );
  assertEquals(controlPlane?.state, "error");
  assertEquals(controlPlane?.version, undefined);
  const providers = application.model.components.find((component) =>
    component.id === "engineering-providers"
  );
  assertEquals(providers?.state, "unavailable");
  assertFalse(providers?.evidence.includes("0/0") ?? true);
});

Deno.test("a non-conforming executable path fails closed on every platform", async () => {
  const cases = [{
    platform: "macOS" as const,
    executablePath: "/opt/homebrew/bin/deno",
    env: (name: string) => name === "HOME" ? "/Users/ada" : undefined,
  }, {
    platform: "Linux" as const,
    executablePath: "/usr/bin/deno",
    env: (name: string) => name === "HOME" ? "/home/ada" : undefined,
  }, {
    platform: "Windows" as const,
    executablePath: "C:\\Deno\\deno.exe",
    env: (name: string) =>
      name === "APPDATA"
        ? "C:\\Users\\ada\\AppData\\Roaming"
        : name === "LOCALAPPDATA"
        ? "C:\\Users\\ada\\AppData\\Local"
        : undefined,
  }];
  for (const selected of cases) {
    let factories = 0;
    const application = await startDesktopApplication(input(selected), {
      createControlPlane() {
        factories += 1;
        return new FakeController();
      },
      createWorkbench() {
        factories += 1;
        return new FakeWorkbenchController();
      },
    });
    assertEquals(factories, 0);
    assertEquals(
      application.model.components.find((component) =>
        component.id === "casys-control-plane"
      )?.state,
      "error",
    );
    assertEquals(
      application.model.components.find((component) =>
        component.id === "workbench-projection"
      )?.state,
      "unavailable",
    );
    await application.stop();
  }
});

Deno.test("a startup exception stops only the controller that retained its child", async () => {
  const controller = new FakeController(readyProjection(), true);
  const application = await startDesktopApplication(input(), {
    createControlPlane: () => controller,
  });
  assertEquals(controller.starts, 1);
  assertEquals(controller.stops, 1);
  assertEquals(application.model.status, "recovery-required");
  assertEquals(
    application.model.components.find((component) =>
      component.id === "casys-control-plane"
    )?.version,
    undefined,
  );
  assertFalse(
    application.model.components.find((component) =>
      component.id === "engineering-providers"
    )?.evidence.includes("0/0") ?? true,
  );
  await application.stop();
  assertEquals(controller.stops, 1);
});

Deno.test("every shutdown caller awaits the one owned-child stop in flight", async () => {
  let stopCalls = 0;
  let releaseStop: (() => void) | undefined;
  const stopGate = new Promise<void>((resolve) => {
    releaseStop = resolve;
  });
  const application = await startDesktopApplication(input(), {
    createControlPlane: () => ({
      start: () => Promise.resolve(readyProjection()),
      stop() {
        stopCalls += 1;
        return stopGate;
      },
    }),
  });

  const first = application.stop();
  const second = application.stop();
  let secondSettled = false;
  void second.then(() => {
    secondSettled = true;
  });
  await Promise.resolve();

  assertEquals(stopCalls, 1);
  assertFalse(secondSettled);
  releaseStop?.();
  await Promise.all([first, second]);
  assertEquals(secondSettled, true);
});

Deno.test("only the safe control-plane projection influences the renderer model", async () => {
  const projection = {
    ...readyProjection(),
    pid: 4242,
    helperPath: "/Users/ada/private/casys-control-plane",
    launchId: "11111111-1111-4111-8111-111111111111",
    configDigest:
      "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    endpoint: "http://127.0.0.1:3020/mcp",
  };
  const application = await startDesktopApplication(input(), {
    createControlPlane: () => new FakeController(projection),
  });
  const text = JSON.stringify(application.model);
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
    assertFalse(text.includes(forbidden), `renderer model leaked ${forbidden}`);
  }
});

function readyProjection(): DesktopControlPlaneProjection {
  return {
    configuration: "verified",
    lifecycle: "owned-ready",
    controlPlaneVersion: "0.2.0",
    providers: { state: "unavailable" },
    persistedEvidence: "candidate-unverified",
  };
}
