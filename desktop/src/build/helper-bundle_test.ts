import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import {
  assertNoGeneralDenoCli,
  HELPER_BUNDLE_RELATIVE_PATH,
  HELPER_STAGE_SOURCE,
  stageControlPlaneHelper,
  stageWorkbenchHelper,
  WORKBENCH_BUNDLE_RELATIVE_PATH,
  WORKBENCH_STAGE_SOURCE,
} from "./helper-bundle.ts";

Deno.test("stageControlPlaneHelper copies the dedicated helper into Contents/Helpers", async () => {
  const root = await Deno.makeTempDir({ prefix: "casys-bundle-" });
  const source = `${root}/casys-control-plane`;
  const appPath = `${root}/CasysDigitalThread.app`;
  await Deno.writeTextFile(source, "helper-bytes");
  const staged = await stageControlPlaneHelper({ appPath, sourcePath: source });
  assertEquals(staged, `${appPath}/${HELPER_BUNDLE_RELATIVE_PATH}`);
  assertEquals(await Deno.readTextFile(staged), "helper-bytes");
});

Deno.test("stageControlPlaneHelper refuses a general Deno CLI name", async () => {
  await assertRejects(
    () =>
      stageControlPlaneHelper({
        appPath: "/tmp/app.app",
        sourcePath: "/tmp/deno",
      }),
    Error,
    "general Deno CLI",
  );
});

Deno.test("stageWorkbenchHelper copies only the dedicated read-only helper", async () => {
  const root = await Deno.makeTempDir({ prefix: "casys-workbench-bundle-" });
  const source = `${root}/casys-workbench`;
  const appPath = `${root}/CasysDigitalThread.app`;
  await Deno.writeTextFile(source, "workbench-helper-bytes");
  const staged = await stageWorkbenchHelper({ appPath, sourcePath: source });
  assertEquals(staged, `${appPath}/${WORKBENCH_BUNDLE_RELATIVE_PATH}`);
  assertEquals(await Deno.readTextFile(staged), "workbench-helper-bytes");
  assertEquals(WORKBENCH_STAGE_SOURCE.endsWith("/casys-workbench"), true);
  assertEquals(WORKBENCH_STAGE_SOURCE.includes("/deno"), false);
});

Deno.test("assertNoGeneralDenoCli fails closed when a Deno CLI is nested in the app", async () => {
  const appPath = await Deno.makeTempDir({ prefix: "casys-deno-cli-" });
  await Deno.mkdir(`${appPath}/Contents/MacOS`, { recursive: true });
  await Deno.writeTextFile(`${appPath}/Contents/MacOS/deno`, "cli");
  await assertRejects(
    () => assertNoGeneralDenoCli(appPath),
    Error,
    "general Deno CLI",
  );
});

Deno.test("the staged helper source is not the Deno CLI", () => {
  assertEquals(HELPER_STAGE_SOURCE.endsWith("/casys-control-plane"), true);
  assertEquals(HELPER_STAGE_SOURCE.includes("/deno"), false);
});
