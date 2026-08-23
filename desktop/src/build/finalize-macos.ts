import rawManifest from "../../component-manifest.json" with { type: "json" };
import { validateComponentManifest } from "../host/mod.ts";
import {
  assertNoGeneralDenoCli,
  HELPER_STAGE_SOURCE,
  helperBundlePath,
  stageControlPlaneHelper,
  stageWorkbenchHelper,
  WORKBENCH_STAGE_SOURCE,
  workbenchBundlePath,
} from "./helper-bundle.ts";
import {
  assertMacosBundleStrings,
  expectedMacosBundleStrings,
  MACOS_BUNDLE_STRING_KEYS,
  MACOS_MINIMUM_SYSTEM_VERSION,
} from "./macos-bundle-contract.ts";
import { installMacosLauncher, macosRuntimeExecutablePath } from "./macos-launcher.ts";

const PLUTIL = "/usr/bin/plutil";
const CODESIGN = "/usr/bin/codesign";
const EXPECTED_APP_PATH = "dist/CasysDigitalThread.app";
const UNUSED_PRIVACY_KEYS = [
  "NSAudioCaptureUsageDescription",
  "NSBluetoothAlwaysUsageDescription",
  "NSBluetoothPeripheralUsageDescription",
  "NSCameraUsageDescription",
  "NSMicrophoneUsageDescription",
] as const;

if (Deno.build.os !== "darwin") {
  throw new Error("The macOS bundle finalizer can run only on macOS.");
}

const appPath = Deno.args[0];
if (appPath !== EXPECTED_APP_PATH) {
  throw new Error(
    `The macOS finalizer accepts only ${EXPECTED_APP_PATH}.`,
  );
}
const plistPath = `${appPath}/Contents/Info.plist`;

const manifest = validateComponentManifest(rawManifest);
if (!manifest.ok) {
  throw new Error(
    `Cannot finalize Desktop: ${manifest.error.code}: ${manifest.error.message}`,
  );
}

async function command(
  program: string,
  args: readonly string[],
): Promise<Deno.CommandOutput> {
  const output = await new Deno.Command(program, {
    args: [...args],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    const stderr = new TextDecoder().decode(output.stderr).trim();
    throw new Error(`${program} ${args.join(" ")} failed: ${stderr}`);
  }
  return output;
}

async function plistValue(key: string): Promise<string | undefined> {
  const output = await new Deno.Command(PLUTIL, {
    args: ["-extract", key, "raw", "-o", "-", plistPath],
    stdout: "piped",
    stderr: "null",
  }).output();
  if (!output.success) return undefined;
  return new TextDecoder().decode(output.stdout).trim();
}

async function replacePlistString(key: string, value: string): Promise<void> {
  await command(PLUTIL, ["-replace", key, "-string", value, plistPath]);
}

await replacePlistString(
  "CFBundleShortVersionString",
  manifest.value.product.version,
);
await replacePlistString("CFBundleVersion", manifest.value.product.version);
await replacePlistString(
  "LSMinimumSystemVersion",
  MACOS_MINIMUM_SYSTEM_VERSION,
);

for (const key of UNUSED_PRIVACY_KEYS) {
  if (await plistValue(key) !== undefined) {
    await command(PLUTIL, ["-remove", key, plistPath]);
  }
}

const helperPath = await stageControlPlaneHelper({
  appPath,
  sourcePath: HELPER_STAGE_SOURCE,
});
const workbenchPath = await stageWorkbenchHelper({
  appPath,
  sourcePath: WORKBENCH_STAGE_SOURCE,
});
const bundleExecutable = await plistValue("CFBundleExecutable");
if (bundleExecutable === undefined) {
  throw new Error("Final bundle omits CFBundleExecutable.");
}
const installed = await installMacosLauncher({
  appPath,
  bundleExecutable,
});
await assertNoGeneralDenoCli(appPath);
await command(CODESIGN, ["--force", "--sign", "-", helperPath]);
await command(CODESIGN, ["--force", "--sign", "-", workbenchPath]);
await command(CODESIGN, ["--force", "--sign", "-", installed.runtimePath]);
await command(CODESIGN, ["--force", "--sign", "-", installed.launcherPath]);
await command(CODESIGN, ["--force", "--sign", "-", appPath]);
await command(CODESIGN, ["--verify", "--strict", helperPath]);
await command(CODESIGN, ["--verify", "--strict", workbenchPath]);
await command(CODESIGN, ["--verify", "--strict", installed.runtimePath]);
await command(CODESIGN, ["--verify", "--strict", installed.launcherPath]);
await command(CODESIGN, ["--verify", "--deep", "--strict", appPath]);
if (helperBundlePath(appPath) !== helperPath) {
  throw new Error("Staged helper path is not the exact bundle Helpers path.");
}
if (workbenchBundlePath(appPath) !== workbenchPath) {
  throw new Error("Staged Workbench path is not the exact bundle Helpers path.");
}
if (macosRuntimeExecutablePath(appPath) !== installed.runtimePath) {
  throw new Error("Staged Desktop runtime path is not the exact MacOS path.");
}

const expected = manifest.value.product;
const expectedBundleStrings = expectedMacosBundleStrings(expected);
const actualBundleStrings = Object.fromEntries(
  await Promise.all(
    MACOS_BUNDLE_STRING_KEYS.map(async (key) => [key, await plistValue(key)]),
  ),
);
assertMacosBundleStrings(actualBundleStrings, expectedBundleStrings);
for (const key of UNUSED_PRIVACY_KEYS) {
  if (await plistValue(key) !== undefined) {
    throw new Error(`Final bundle still declares unused privacy key ${key}.`);
  }
}

console.log(
  `Finalized ${appPath}: ${expected.identifier} ${expected.version}, ad-hoc signature verified.`,
);
