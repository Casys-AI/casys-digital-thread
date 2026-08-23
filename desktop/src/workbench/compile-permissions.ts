import {
  WORKBENCH_CONTROL_PLANE_RELATIVE_ROOT,
  WORKBENCH_HELPER_NAME,
  WORKBENCH_HOSTNAME,
  WORKBENCH_PORT,
  WORKBENCH_RUNTIME_RELATIVE_ROOT,
} from "./contracts.ts";

export const WORKBENCH_STAGE_SOURCE = `dist/helpers/${WORKBENCH_HELPER_NAME}`;

export const WORKBENCH_COMPILE_PERMISSION_FLAGS = Object.freeze([
  `--allow-read=./${WORKBENCH_CONTROL_PLANE_RELATIVE_ROOT},./${WORKBENCH_RUNTIME_RELATIVE_ROOT}`,
  `--allow-write=./${WORKBENCH_RUNTIME_RELATIVE_ROOT}`,
  `--allow-net=${WORKBENCH_HOSTNAME}:${WORKBENCH_PORT}`,
  "--deny-env",
  "--deny-run",
  "--deny-ffi",
  "--deny-sys",
  "--deny-import",
]);

export function workbenchCompilePermissionsAreClosed(
  flags: readonly string[],
): boolean {
  return flags.length === WORKBENCH_COMPILE_PERMISSION_FLAGS.length &&
    flags.every((flag, index) => flag === WORKBENCH_COMPILE_PERMISSION_FLAGS[index]) &&
    !flags.includes("-A") && !flags.includes("--allow-all");
}
