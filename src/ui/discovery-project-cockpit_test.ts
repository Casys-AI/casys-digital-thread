import { assertStringIncludes } from "@std/assert";

Deno.test("the canonical cockpit renders one EngineeringProject from first intent", async () => {
  const native = await Deno.readTextFile(
    new URL("./src/thread/native-preview.tsx", import.meta.url),
  );
  assertStringIncludes(native, "<ThreadWorkbench client={client} />");
  assertStringIncludes(native, '"/api/thread/workbench"');
  for (
    const retiredRoute of [
      "ProjectDiscoverySnapshot",
      "HttpProjectDiscoveryClient",
      "DiscoveryProjectCockpit",
      "/api/project-discoveries/active",
    ]
  ) {
    if (native.includes(retiredRoute)) {
      throw new Error(`Native cockpit still contains ${retiredRoute}.`);
    }
  }
});
