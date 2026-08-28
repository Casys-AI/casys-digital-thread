import { assertEquals, assertStringIncludes } from "@std/assert";
import { registerProjectPrescribedKinematicsReviewTools } from "./prescribed-kinematics-review-tools.ts";

Deno.test("prescribed-kinematics review registers only its provider-free case review", () => {
  const tools: { name: string; description: string }[] = [];
  registerProjectPrescribedKinematicsReviewTools({
    registerTool(tool: { name: string; description: string }) {
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
});
