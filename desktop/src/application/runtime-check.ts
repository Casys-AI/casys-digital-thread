import rawManifest from "../../component-manifest.json" with { type: "json" };
import denoConfig from "../../deno.json" with { type: "json" };
import {
  CONTROL_PLANE_LOOPBACK_HOST,
  CONTROL_PLANE_PORT,
  CONTROL_PLANE_PRODUCT_VERSION,
  CONTROL_PLANE_SERVER_VERSION,
} from "../control-plane/contracts.ts";
import { validateComponentManifest } from "../host/mod.ts";
import { PACKAGED_CONTROL_PLANE_HELPER_NAME } from "./helper-path.ts";

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

const controlPlane = manifest.value.components.find((component) =>
  component.id === "casys-control-plane"
);
if (
  manifest.value.product.version !== CONTROL_PLANE_PRODUCT_VERSION ||
  controlPlane?.version !== CONTROL_PLANE_SERVER_VERSION ||
  controlPlane?.lifecycle !== "active" || controlPlane?.delivery !== "sidecar"
) {
  throw new Error(
    "Cannot build Desktop: Lot 2 requires the exact active packaged control-plane sidecar pin.",
  );
}

const expectedEnvironment = [
  "APPDATA",
  "HOME",
  "LOCALAPPDATA",
  "XDG_DATA_HOME",
];
const actualEnvironment = [...denoConfig.permissions.desktop.env].sort();
const actualRun = [...denoConfig.permissions.desktop.run].sort();
const actualNet = [...denoConfig.permissions.desktop.net].sort();
const permissionKeys = Object.keys(denoConfig.permissions.desktop).sort();
if (
  JSON.stringify(actualEnvironment) !== JSON.stringify(expectedEnvironment) ||
  JSON.stringify(actualRun) !==
    JSON.stringify([PACKAGED_CONTROL_PLANE_HELPER_NAME]) ||
  JSON.stringify(actualNet) !==
    JSON.stringify([`${CONTROL_PLANE_LOOPBACK_HOST}:${CONTROL_PLANE_PORT}`]) ||
  JSON.stringify(permissionKeys) !==
    JSON.stringify(["env", "import", "net", "run"]) ||
  denoConfig.permissions.desktop.import !== false
) {
  throw new Error(
    "Cannot build Desktop: runtime permissions must contain only application-support env reads, the packaged helper basename, the canonical loopback endpoint, and denied remote imports.",
  );
}

if (
  Object.hasOwn(denoConfig.tasks, "dev") ||
  !denoConfig.tasks.package.includes("--deny-import")
) {
  throw new Error(
    "Cannot build Desktop: the packaged-only helper topology has no checkout dev task, and package must deny runtime remote imports explicitly.",
  );
}

console.log(
  `Pinned Deno Desktop runtime ${Deno.version.deno} and product ${denoConfig.version} verified.`,
);
