import rawManifest from "../../component-manifest.json" with { type: "json" };
import { validateComponentManifest } from "../host/mod.ts";

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

for (const key of UNUSED_PRIVACY_KEYS) {
  if (await plistValue(key) !== undefined) {
    await command(PLUTIL, ["-remove", key, plistPath]);
  }
}

await command(CODESIGN, ["--force", "--deep", "--sign", "-", appPath]);
await command(CODESIGN, ["--verify", "--deep", "--strict", appPath]);

const expected = manifest.value.product;
if (await plistValue("CFBundleIdentifier") !== expected.identifier) {
  throw new Error("Final bundle identifier does not match the component manifest.");
}
if (await plistValue("CFBundleShortVersionString") !== expected.version) {
  throw new Error("Final bundle short version does not match the component manifest.");
}
if (await plistValue("CFBundleVersion") !== expected.version) {
  throw new Error("Final bundle version does not match the component manifest.");
}
for (const key of UNUSED_PRIVACY_KEYS) {
  if (await plistValue(key) !== undefined) {
    throw new Error(`Final bundle still declares unused privacy key ${key}.`);
  }
}

console.log(
  `Finalized ${appPath}: ${expected.identifier} ${expected.version}, ad-hoc signature verified.`,
);
