import {
  CONTROL_PLANE_HELPER_NAME,
  CONTROL_PLANE_LOOPBACK_PORTS,
} from "./contracts.ts";

export { CONTROL_PLANE_HELPER_NAME, CONTROL_PLANE_LOOPBACK_PORTS };

export const CONTROL_PLANE_NET_ALLOWLIST = CONTROL_PLANE_LOOPBACK_PORTS
  .map((port) => `127.0.0.1:${port}`)
  .join(",");

export const PACKAGED_CONTROL_PLANE_RELATIVE_PRODUCT_ROOT = "./ai.casys.digital-thread";

/** Baked into `deno compile`. Relative FS grants resolve against launch cwd. */
export const CONTROL_PLANE_COMPILE_PERMISSION_FLAGS = Object.freeze([
  `--allow-read=${PACKAGED_CONTROL_PLANE_RELATIVE_PRODUCT_ROOT}`,
  `--allow-write=${PACKAGED_CONTROL_PLANE_RELATIVE_PRODUCT_ROOT}`,
  `--allow-net=${CONTROL_PLANE_NET_ALLOWLIST}`,
  "--deny-env",
  "--deny-run",
  "--deny-ffi",
  "--deny-sys",
  "--deny-import",
]);

export function compilePermissionFlagsAreClosed(
  flags: readonly string[],
): boolean {
  const joined = flags.join(" ");
  const readFlags = flags.filter((flag) => flag.startsWith("--allow-read"));
  const writeFlags = flags.filter((flag) => flag.startsWith("--allow-write"));
  if (flags.includes("-A") || flags.includes("--allow-all")) return false;
  if (flags.includes("--allow-net") || flags.includes("--allow-env")) return false;
  if (flags.some((flag) => flag.startsWith("--allow-env="))) return false;
  if (flags.some((flag) => flag === "--allow-run" || flag.startsWith("--allow-run="))) {
    return false;
  }
  if (flags.some((flag) => flag === "--allow-ffi" || flag.startsWith("--allow-ffi="))) {
    return false;
  }
  if (flags.some((flag) => flag === "--allow-sys" || flag.startsWith("--allow-sys="))) {
    return false;
  }
  if (joined.includes("allow-run=deno")) return false;
  return flags.includes("--deny-run") &&
    flags.includes("--deny-env") &&
    flags.includes("--deny-ffi") &&
    flags.includes("--deny-sys") &&
    flags.includes("--deny-import") &&
    readFlags.length === 1 &&
    readFlags[0] ===
      `--allow-read=${PACKAGED_CONTROL_PLANE_RELATIVE_PRODUCT_ROOT}` &&
    writeFlags.length === 1 &&
    writeFlags[0] ===
      `--allow-write=${PACKAGED_CONTROL_PLANE_RELATIVE_PRODUCT_ROOT}` &&
    flags.some((flag) => flag.startsWith("--allow-net=127.0.0.1:"));
}
