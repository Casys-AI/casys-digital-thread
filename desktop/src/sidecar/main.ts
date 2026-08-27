import { parseHelperCli } from "./cli.ts";
import { SidecarFailure } from "./contracts.ts";
import { PACKAGED_CONTROL_PLANE_ASSETS } from "./embedded-assets.ts";
import { inspectControlPlane } from "./inspect.ts";
import { denoLifelineRuntime } from "./lifeline.ts";
import { sealDenoEnvironment, sealNodeProcessEnvironment } from "./runtime-sandbox.ts";
import { startControlPlane } from "./start.ts";

export async function runControlPlaneHelper(
  args: readonly string[],
): Promise<void> {
  const cli = parseHelperCli(args);
  if (cli.mode === "inspect") {
    await inspectControlPlane({
      launchCwd: Deno.cwd(),
      layoutProfile: cli.layoutProfile,
      assets: PACKAGED_CONTROL_PLANE_ASSETS,
      stdout: (line) => console.log(line.replace(/\n$/, "")),
    });
    return;
  }

  sealNodeProcessEnvironment();
  sealDenoEnvironment();
  const { bindPackagedConsoleServer } = await import("./server-binding.ts");
  await startControlPlane({
    launchId: cli.launchId,
    launchCwd: Deno.cwd(),
    layoutProfile: cli.layoutProfile,
    pid: Deno.pid,
    now: () => new Date(),
    assets: PACKAGED_CONTROL_PLANE_ASSETS,
    createServer: bindPackagedConsoleServer,
    lifeline: denoLifelineRuntime,
    stdout: (line) => console.log(line.replace(/\n$/, "")),
    stderr: (line) => console.error(line),
  });
}

if (import.meta.main) {
  try {
    await runControlPlaneHelper(Deno.args);
  } catch (error) {
    const message = error instanceof SidecarFailure
      ? `${error.code}: ${error.message}`
      : error instanceof Error
      ? error.message
      : String(error);
    console.error(message);
    Deno.exit(1);
  }
}
