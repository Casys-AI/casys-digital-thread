import {
  WORKBENCH_COMPILE_PERMISSION_FLAGS,
  WORKBENCH_STAGE_SOURCE,
  workbenchCompilePermissionsAreClosed,
} from "../workbench/compile-permissions.ts";

if (!workbenchCompilePermissionsAreClosed(WORKBENCH_COMPILE_PERMISSION_FLAGS)) {
  throw new Error("Workbench compile flags are not fail-closed.");
}

await Deno.mkdir("dist/helpers", { recursive: true });

const compiled = await new Deno.Command("deno", {
  args: [
    "compile",
    "--config=../deno.json",
    "--no-prompt",
    `--output=${WORKBENCH_STAGE_SOURCE}`,
    "--include=../src/ui/dist/thread",
    ...WORKBENCH_COMPILE_PERMISSION_FLAGS,
    "src/workbench/main.ts",
  ],
  stdout: "inherit",
  stderr: "inherit",
}).output();

if (!compiled.success) {
  throw new Error(`Workbench deno compile failed with code ${compiled.code}.`);
}

console.log(`Compiled dedicated Workbench helper ${WORKBENCH_STAGE_SOURCE}.`);
