import { assertEquals, assertRejects } from "@std/assert";
import { createFirstPartyCapabilityRuntimeCatalog } from "../../adapters/control-plane/first-party-capability-binding-catalog.ts";
import { ProjectCapabilityJitDemandReader } from "./project-capability-jit-demand-reader.ts";

const PROJECT = { id: "project:jit:r9", project: { id: "project:jit" } } as never;

Deno.test("terminal group release retains a group while a sibling ready operation still demands its material", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const reader = new ProjectCapabilityJitDemandReader({
    projects: { get: () => Promise.resolve(PROJECT) },
    contexts: {
      read: () =>
        Promise.resolve({
          catalog,
          demand: {
            jitDemand: {
              status: "resolved",
              capabilityRequirements: [{
                id: "model.author-system",
                version: "1",
                use: "execution",
                minimumQualification: "qualified",
              }],
            },
          },
        } as never),
    },
  });

  assertEquals(
    await reader.hasRemainingDemand({
      projectId: "project:jit",
      materialKeys: ["casys.syson-stack\u0000mcp-syson-image"],
    }),
    true,
  );
  assertEquals(
    await reader.hasRemainingDemand({
      projectId: "project:jit",
      materialKeys: ["casys.calculix-worker\u0000calculix-worker-image"],
    }),
    false,
  );
});

Deno.test("terminal group release fails closed when the exact current JIT demand cannot be read", async () => {
  const reader = new ProjectCapabilityJitDemandReader({
    projects: { get: () => Promise.resolve(undefined) },
    contexts: { read: () => Promise.reject(new Error("must not read")) },
  });
  await assertRejects(
    () => reader.hasRemainingDemand({ projectId: "project:missing", materialKeys: [] }),
    Error,
    "cannot read project",
  );
});
