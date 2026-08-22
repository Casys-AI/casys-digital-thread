import rawManifest from "./component-manifest.json" with { type: "json" };
import { bootstrapDesktopShell } from "./src/application/bootstrap.ts";
import { createDesktopShellHandler } from "./src/application/shell-handler.ts";
import type { DesktopPlatform, EnvironmentReader } from "./src/host/mod.ts";

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

const model = bootstrapDesktopShell({
  manifest: rawManifest,
  actualDenoVersion: Deno.version.deno,
  // Deno Desktop ships in the same pinned runtime binary as Deno itself.
  actualDesktopRuntimeVersion: Deno.version.deno,
  actualProductVersion: Deno.desktopVersion,
  platform: desktopPlatform(Deno.build.os),
  env: readEnvironment,
});

Deno.serve(createDesktopShellHandler(model));
