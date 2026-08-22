import { MACOS_MINIMUM_SYSTEM_VERSION } from "./macos-bundle-contract.ts";

export const MACOS_LAUNCHER_SOURCE = "src/build/macos-launcher.c";
export const MACOS_RUNTIME_EXECUTABLE_NAME = "casys-desktop-runtime";
export const MACOS_CLANG = "/usr/bin/clang";

const BUNDLE_EXECUTABLE = /^[A-Za-z0-9._-]+$/;

export interface InstalledMacosLauncher {
  readonly launcherPath: string;
  readonly runtimePath: string;
}

export async function installMacosLauncher(input: {
  readonly appPath: string;
  readonly bundleExecutable: string;
  readonly compile?: (
    program: string,
    args: readonly string[],
  ) => Promise<void>;
  readonly rename?: (from: string, to: string) => Promise<void>;
  readonly remove?: (path: string) => Promise<void>;
  readonly chmod?: (path: string, mode: number) => Promise<void>;
}): Promise<InstalledMacosLauncher> {
  if (
    !BUNDLE_EXECUTABLE.test(input.bundleExecutable) ||
    input.bundleExecutable === MACOS_RUNTIME_EXECUTABLE_NAME
  ) {
    throw new Error("The macOS bundle executable name is not a closed basename.");
  }

  const macosDirectory = `${input.appPath}/Contents/MacOS`;
  const launcherPath = `${macosDirectory}/${input.bundleExecutable}`;
  const runtimePath = `${macosDirectory}/${MACOS_RUNTIME_EXECUTABLE_NAME}`;
  const temporaryLauncher = `${launcherPath}.launcher-new`;
  const compile = input.compile ?? compileLauncher;
  const rename = input.rename ?? Deno.rename;
  const remove = input.remove ?? Deno.remove;
  const chmod = input.chmod ?? Deno.chmod;

  await rejectExistingRuntime(runtimePath);
  await compile(MACOS_CLANG, [
    "-std=c17",
    "-Os",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-fstack-protector-strong",
    "-D_FORTIFY_SOURCE=2",
    `-mmacosx-version-min=${MACOS_MINIMUM_SYSTEM_VERSION}`,
    "-Wl,-dead_strip",
    "-o",
    temporaryLauncher,
    MACOS_LAUNCHER_SOURCE,
  ]);

  await assertRegularExecutable(temporaryLauncher);
  await rename(launcherPath, runtimePath);
  try {
    await rename(temporaryLauncher, launcherPath);
  } catch (error) {
    try {
      await rename(runtimePath, launcherPath);
    } catch {
      // Preserve the first failure; the bundle remains visibly unfinalized.
    }
    throw error;
  }

  try {
    await chmod(launcherPath, 0o755);
    await chmod(runtimePath, 0o755);
  } catch (error) {
    try {
      await remove(launcherPath);
      await rename(runtimePath, launcherPath);
    } catch {
      // Preserve the first failure; signing will reject a partial bundle.
    }
    throw error;
  }
  return { launcherPath, runtimePath };
}

export function macosRuntimeExecutablePath(appPath: string): string {
  return `${appPath}/Contents/MacOS/${MACOS_RUNTIME_EXECUTABLE_NAME}`;
}

async function compileLauncher(
  program: string,
  args: readonly string[],
): Promise<void> {
  const output = await new Deno.Command(program, {
    args: [...args],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(
      `macOS launcher compile failed: ${
        new TextDecoder().decode(output.stderr).trim()
      }`,
    );
  }
}

async function rejectExistingRuntime(path: string): Promise<void> {
  try {
    await Deno.lstat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
  throw new Error("The macOS bundle already contains a staged Desktop runtime.");
}

async function assertRegularExecutable(path: string): Promise<void> {
  const stat = await Deno.lstat(path);
  if (
    !stat.isFile || stat.isSymlink || stat.mode === null ||
    (stat.mode & 0o111) === 0
  ) {
    throw new Error("The compiled macOS launcher is not a regular executable.");
  }
}
