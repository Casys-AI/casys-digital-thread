import { assertEquals, assertStringIncludes } from "@std/assert";
import { registerProjectPrescribedKinematicsReviewTools } from "./prescribed-kinematics-review-tools.ts";

Deno.test("prescribed-kinematics review registers only its provider-free case review", () => {
  const tools: { name: string; description: string; inputSchema: unknown }[] = [];
  registerProjectPrescribedKinematicsReviewTools({
    registerTool(tool: { name: string; description: string; inputSchema: unknown }) {
      tools.push(tool);
    },
  } as never, {
    prescribedKinematicsCaseReview: {
      capture: async () => ({
        status: "unavailable" as const,
        diagnostic: { code: "fixture", message: "fixture" },
        grants: "none" as const,
      }),
    },
  });
  assertEquals(tools.map((tool) => tool.name), [
    "project_prescribed_kinematics_case_review",
  ]);
  assertStringIncludes(tools[0]!.description, "provider, image, tool, args, runtime");
  assertEquals(tools[0]!.description.includes("Chrono client"), false);
  assertEquals(JSON.stringify(tools[0]!.inputSchema).includes("case_json"), false);
  assertEquals(
    JSON.stringify(tools[0]!.inputSchema).includes("loweredCaseJson"),
    false,
  );
});
