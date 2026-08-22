import { assertEquals, assertFalse } from "jsr:@std/assert@1.0.14";
import rawManifest from "../../component-manifest.json" with { type: "json" };
import type { DesktopControlPlaneProjection } from "../contracts/diagnostics.ts";
import {
  type DesktopControlPlaneController,
  type DesktopControlPlaneLaunch,
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
    productVersion: "0.2.0",
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
