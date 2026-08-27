import { createHash } from "node:crypto";
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
const LN = "/bin/ln";
const EXPECTED_APP_PATH = "dist/CasysDigitalThread.app";
const CHAT_RUNTIME_SOURCE = "dist/chat-host-runtime";
const CHAT_LAUNCHER_SOURCE = "dist/helpers/casys-chat-host";
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
const chatBundle = await stageChatHost(appPath);
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
for (const executable of chatBundle.signedExecutables) {
  await command(CODESIGN, ["--verify", "--strict", executable]);
}
await command(CODESIGN, ["--force", "--sign", "-", installed.runtimePath]);
await command(CODESIGN, ["--force", "--sign", "-", installed.launcherPath]);
await command(CODESIGN, ["--force", "--sign", "-", appPath]);
await command(CODESIGN, ["--verify", "--strict", helperPath]);
await command(CODESIGN, ["--verify", "--strict", workbenchPath]);
await verifyChatBundle(chatBundle.runtimePath, chatBundle.launcherPath);
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

async function stageChatHost(app: string): Promise<{
  readonly runtimePath: string;
  readonly launcherPath: string;
  readonly signedExecutables: readonly string[];
}> {
  const runtimePath = `${app}/Contents/Resources/chat-host`;
  const launcherPath = `${app}/Contents/Helpers/casys-chat-host`;
  await Deno.remove(runtimePath, { recursive: true }).catch(ignoreNotFound);
  await Deno.remove(launcherPath).catch(ignoreNotFound);
  await copyTree(CHAT_RUNTIME_SOURCE, runtimePath);
  await Deno.copyFile(CHAT_LAUNCHER_SOURCE, launcherPath);
  await Deno.chmod(launcherPath, 0o755);
  await verifyChatBundle(runtimePath, launcherPath);
  return {
    runtimePath,
    launcherPath,
    signedExecutables: [
      launcherPath,
      `${runtimePath}/node`,
      `${runtimePath}/acpx/dist/native/lifeline`,
      `${runtimePath}/adapter/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex`,
      `${runtimePath}/adapter/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex-code-mode-host`,
      `${runtimePath}/adapter/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/codex-path/rg`,
      `${runtimePath}/adapter/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/codex-resources/zsh/bin/zsh`,
    ],
  };
}

async function copyTree(source: string, destination: string): Promise<void> {
  const stat = await Deno.lstat(source);
  if (stat.isSymlink) {
    await command(LN, ["-s", await Deno.readLink(source), destination]);
    return;
  }
  if (stat.isDirectory) {
    await Deno.mkdir(destination, { recursive: true, mode: stat.mode ?? 0o755 });
    for await (const entry of Deno.readDir(source)) {
      await copyTree(`${source}/${entry.name}`, `${destination}/${entry.name}`);
    }
    return;
  }
  if (!stat.isFile) throw new Error(`Chat Host artifact is not a file: ${source}`);
  await Deno.copyFile(source, destination);
  if (stat.mode !== null) await Deno.chmod(destination, stat.mode);
}

async function verifyChatBundle(
  runtimePath: string,
  launcherPath: string,
): Promise<void> {
  const value: unknown = JSON.parse(
    await Deno.readTextFile(`${runtimePath}/bundle-manifest.json`),
  );
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Chat Host bundle manifest is invalid.");
  }
  const manifest = value as Record<string, unknown>;
  if (
    manifest.schemaVersion !== "casys-chat-host-bundle/1.0" ||
    manifest.target !== "darwin-arm64" ||
    manifest.targetStatus !== "implemented-tested" ||
    typeof manifest.files !== "object" || manifest.files === null
  ) throw new Error("Chat Host bundle manifest target is invalid.");
  for (const entry of Object.values(manifest.files as Record<string, unknown>)) {
    if (typeof entry !== "object" || entry === null) {
      throw new Error("Chat Host bundle manifest file entry is invalid.");
    }
    const file = entry as Record<string, unknown>;
    if (typeof file.path !== "string" || typeof file.sha256 !== "string") {
      throw new Error("Chat Host bundle manifest digest entry is invalid.");
    }
    const path = file.path.startsWith("../../Helpers/")
      ? `${launcherPath.slice(0, launcherPath.lastIndexOf("/") + 1)}${
        file.path.slice("../../Helpers/".length)
      }`
      : `${runtimePath}/${file.path}`;
    const digest = createHash("sha256").update(await Deno.readFile(path)).digest("hex");
    if (digest !== file.sha256) {
      throw new Error(`Chat Host bundle digest mismatch: ${file.path}`);
    }
  }
}

function ignoreNotFound(error: unknown): void {
  if (!(error instanceof Deno.errors.NotFound)) throw error;
}
