import rawManifest from "./component-manifest.json" with { type: "json" };
import { createDesktopShellHandler } from "./src/application/shell-handler.ts";
import {
  drainAndExitDesktop,
  installDesktopShutdownSignals,
} from "./src/application/shutdown.ts";
import { startDesktopApplication } from "./src/application/startup.ts";
import {
  CONTROL_PLANE_PRODUCT_IDENTIFIER,
  CONTROL_PLANE_SERVER_NAME,
  ControlPlaneHost,
  createDenoControlPlanePorts,
} from "./src/control-plane/mod.ts";
import type { DesktopPlatform, EnvironmentReader } from "./src/host/mod.ts";
import { createDenoWorkbenchHost } from "./src/workbench/host.ts";

function desktopPlatform(os: typeof Deno.build.os): DesktopPlatform {
  switch (os) {
    case "darwin":
      return "macOS";
    case "windows":
      return "Windows";
    case "linux":
      return "Linux";
    default:
      throw new Error(`Deno Desktop does not support ${os}.`);
  }
}

const readEnvironment: EnvironmentReader = (name) => {
  try {
    return Deno.env.get(name);
  } catch (error) {
    // Missing named permission is represented in the recovery-required view.
    if (error instanceof Deno.errors.PermissionDenied) return undefined;
    throw error;
  }
};

const application = await startDesktopApplication({
  manifest: rawManifest,
  actualDenoVersion: Deno.version.deno,
  // Deno Desktop ships in the same pinned runtime binary as Deno itself.
  actualDesktopRuntimeVersion: Deno.version.deno,
  actualProductVersion: Deno.desktopVersion,
  platform: desktopPlatform(Deno.build.os),
  env: readEnvironment,
  executablePath: Deno.execPath(),
}, {
  createControlPlane(launch) {
    const host = new ControlPlaneHost({
      helperPath: launch.helperPath,
      cwd: launch.launchCwd,
      platform: launch.platform,
      layoutProfile: launch.layoutProfile,
      relativeWorkspace: launch.relativeWorkspace,
      expected: {
        productIdentifier: CONTROL_PLANE_PRODUCT_IDENTIFIER,
        productVersion: launch.productVersion,
        serverName: CONTROL_PLANE_SERVER_NAME,
        serverVersion: launch.controlPlaneVersion,
      },
      ports: createDenoControlPlanePorts(launch.platform),
    });
    return {
      async start() {
        return (await host.startResult()).projection;
      },
      stop: () => host.stop(),
    };
  },
  createWorkbench(launch) {
    const host = createDenoWorkbenchHost(launch.helperPath, launch.launchCwd);
    return {
      start: () => host.start(),
      stop: () => host.stop(),
    };
  },
});

let server: Deno.HttpServer;
try {
  server = Deno.serve(
    createDesktopShellHandler(
      application.model,
      application.workbenchSession,
    ),
  );
} catch (error) {
  await application.stop().catch(() => undefined);
  throw error;
}
const shutdownRequested = Promise.withResolvers<void>();
let receivedShutdownSignal = false;
const cleanupSignals = installDesktopShutdownSignals(() => {
  receivedShutdownSignal = true;
  shutdownRequested.resolve();
}, {
  add: (signal, listener) => Deno.addSignalListener(signal, listener),
  remove: (signal, listener) => Deno.removeSignalListener(signal, listener),
});

try {
  await Promise.race([server.finished, shutdownRequested.promise]);
  if (receivedShutdownSignal) {
    await drainAndExitDesktop({
      stopApplication: () => application.stop(),
      shutdownServer: () => server.shutdown(),
      exitProcess: (code) => Deno.exit(code),
    });
  }
} finally {
  cleanupSignals();
  await application.stop().catch(() => undefined);
}
