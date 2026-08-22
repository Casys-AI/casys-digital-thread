import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { MACOS_MINIMUM_SYSTEM_VERSION } from "./macos-bundle-contract.ts";
import {
  installMacosLauncher,
  MACOS_CLANG,
  MACOS_LAUNCHER_SOURCE,
  MACOS_RUNTIME_EXECUTABLE_NAME,
  macosRuntimeExecutablePath,
} from "./macos-launcher.ts";

Deno.test("installMacosLauncher compiles before atomically replacing the bundle entry", async () => {
  const root = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-launcher-stage-" }),
  );
  const appPath = `${root}/CasysDigitalThread.app`;
  const macos = `${appPath}/Contents/MacOS`;
  const original = `${macos}/laufey_webview`;
  await Deno.mkdir(macos, { recursive: true });
  await Deno.writeTextFile(original, "runtime");
  await Deno.chmod(original, 0o755);
  const compiled: Array<{ program: string; args: readonly string[] }> = [];

  const installed = await installMacosLauncher({
    appPath,
    bundleExecutable: "laufey_webview",
    async compile(program, args) {
      compiled.push({ program, args });
      const output = args[args.indexOf("-o") + 1];
      await Deno.writeTextFile(output, "launcher");
      await Deno.chmod(output, 0o755);
    },
  });

  assertEquals(compiled[0].program, MACOS_CLANG);
  assertEquals(compiled[0].args.at(-1), MACOS_LAUNCHER_SOURCE);
  assertEquals(
    compiled[0].args.includes(
      `-mmacosx-version-min=${MACOS_MINIMUM_SYSTEM_VERSION}`,
    ),
    true,
  );
  assertEquals(await Deno.readTextFile(installed.launcherPath), "launcher");
  assertEquals(await Deno.readTextFile(installed.runtimePath), "runtime");
  assertEquals(
    installed.runtimePath,
    macosRuntimeExecutablePath(appPath),
  );
  assertEquals(installed.runtimePath.endsWith(MACOS_RUNTIME_EXECUTABLE_NAME), true);
});

Deno.test("installMacosLauncher rejects an open executable name and a second install", async () => {
  await assertRejects(
    () =>
      installMacosLauncher({
        appPath: "/tmp/Casys.app",
        bundleExecutable: "../escape",
      }),
    Error,
    "closed basename",
  );

  const root = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-launcher-repeat-" }),
  );
  const appPath = `${root}/Casys.app`;
  const macos = `${appPath}/Contents/MacOS`;
  await Deno.mkdir(macos, { recursive: true });
  await Deno.writeTextFile(`${macos}/laufey_webview`, "runtime");
  await Deno.chmod(`${macos}/laufey_webview`, 0o755);
  await Deno.writeTextFile(
    `${macos}/${MACOS_RUNTIME_EXECUTABLE_NAME}`,
    "existing",
  );
  await assertRejects(
    () =>
      installMacosLauncher({
        appPath,
        bundleExecutable: "laufey_webview",
        async compile(_program, args) {
          const output = args[args.indexOf("-o") + 1];
          await Deno.writeTextFile(output, "launcher");
          await Deno.chmod(output, 0o755);
        },
      }),
    Error,
    "already contains",
  );
  assertEquals(await Deno.readTextFile(`${macos}/laufey_webview`), "runtime");
});
