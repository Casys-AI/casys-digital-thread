import { assertStringIncludes } from "@std/assert";

Deno.test("pre-approval discovery renders inside the canonical Project cockpit", async () => {
  const cockpit = await Deno.readTextFile(
    new URL("./src/project/discovery-project-cockpit.tsx", import.meta.url),
  );
  assertStringIncludes(cockpit, "ENGINEERING PROJECT COCKPIT");
  assertStringIncludes(cockpit, "<ProjectNavigation");
  assertStringIncludes(cockpit, 'activeView="overview"');
  assertStringIncludes(cockpit, "PRETECHNICAL_DISABLED_VIEWS");
  assertStringIncludes(
    cockpit,
    "<DiscoveryWorkbench discovery={discovery} embedded />",
  );

  const native = await Deno.readTextFile(
    new URL("./src/thread/native-preview.tsx", import.meta.url),
  );
  assertStringIncludes(native, "<DiscoveryProjectCockpit");
  assertStringIncludes(native, 'kind: "project"');
  assertStringIncludes(native, "cockpit URL");
});
