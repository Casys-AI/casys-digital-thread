import rawManifest from "../../component-manifest.json" with { type: "json" };
import denoConfig from "../../deno.json" with { type: "json" };
import { validateComponentManifest } from "../host/mod.ts";

const manifest = validateComponentManifest(rawManifest);
if (!manifest.ok) {
  throw new Error(
    `Cannot build Desktop: ${manifest.error.code}: ${manifest.error.message}`,
  );
}

const pinnedDeno = manifest.value.runtime.denoVersion;
const pinnedDesktop = manifest.value.runtime.desktopRuntimeVersion;
if (Deno.version.deno !== pinnedDeno || Deno.version.deno !== pinnedDesktop) {
  throw new Error(
    `Cannot build Desktop with Deno ${Deno.version.deno}; manifest pins Deno ${pinnedDeno} and Desktop ${pinnedDesktop}.`,
  );
}

if (denoConfig.version !== manifest.value.product.version) {
  throw new Error(
    `Cannot build Desktop: deno.json version ${denoConfig.version} does not match product manifest ${manifest.value.product.version}.`,
  );
}

if (
  denoConfig.desktop.app.identifier !== manifest.value.product.identifier ||
  denoConfig.desktop.backend !== manifest.value.runtime.backend
) {
  throw new Error(
    "Cannot build Desktop: package identifier or backend differs from the component manifest.",
  );
}

const expectedEnvironment = [
  "APPDATA",
  "HOME",
  "LOCALAPPDATA",
  "XDG_DATA_HOME",
];
const actualEnvironment = [...denoConfig.permissions.desktop.env].sort();
const permissionKeys = Object.keys(denoConfig.permissions.desktop).sort();
if (
  JSON.stringify(actualEnvironment) !== JSON.stringify(expectedEnvironment) ||
  JSON.stringify(permissionKeys) !== JSON.stringify(["env", "import"]) ||
  denoConfig.permissions.desktop.import !== false
) {
  throw new Error(
    "Cannot build Desktop: the runtime permission set must contain only the exact application-support environment allowlist and denied remote imports.",
  );
}

if (
  !denoConfig.tasks.dev.includes("--deny-import") ||
  !denoConfig.tasks.package.includes("--deny-import")
) {
  throw new Error(
    "Cannot build Desktop: dev and package tasks must deny runtime remote imports explicitly.",
  );
}

console.log(
  `Pinned Deno Desktop runtime ${Deno.version.deno} and product ${denoConfig.version} verified.`,
);
