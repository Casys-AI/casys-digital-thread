import { assertEquals, assertThrows } from "@std/assert";
import { CapabilityRuntimeConnectionError } from "../ports/out/capability/capability-runtime-connection.ts";
import { testResolvedCapabilityRuntimeOperation } from "../../testing/capability-runtime-execution-session-test-support.ts";
import { requiredQualifiedPersistentComposePublication } from "./capability-runtime-persistent-compose-publication.ts";

const FINGERPRINT = { algorithm: "sha256" as const, digest: "a".repeat(64) };

Deno.test("the control-plane rule returns the unique qualified binding and compose group", () => {
  const operational = testResolvedCapabilityRuntimeOperation({
    projectId: "project-review-demo",
    operation: { id: "architecture.seed-syson-model", version: "2" },
    capabilityId: "model.author-system",
    binding: { id: "syson-author-system", version: "1.0.0" },
  });
  assertEquals(requiredQualifiedPersistentComposePublication(operational), {
    binding: { id: "syson-author-system", version: "1.0.0" },
    launchGroup: {
      id: "casys-syson",
      version: "1.0.0",
      fingerprint: FINGERPRINT,
    },
  });
});

Deno.test("duplicate persistent-compose lifecycles collapse to one launch group", () => {
  const operational = testResolvedCapabilityRuntimeOperation({
    projectId: "project-review-demo",
    operation: { id: "architecture.seed-syson-model", version: "2" },
    capabilityId: "model.author-system",
    binding: { id: "syson-author-system", version: "1.0.0" },
  });
  const binding = operational.bindings[0]!;
  const duplicate = {
    ...operational,
    bindings: [{
      ...binding,
      hostLifecycles: [binding.hostLifecycles[0]!, binding.hostLifecycles[0]!],
    }],
  };
  assertEquals(
    requiredQualifiedPersistentComposePublication(duplicate).launchGroup.id,
    "casys-syson",
  );
});

Deno.test("the rule refuses a second binding, an unqualified binding, or two groups", () => {
  const syson = testResolvedCapabilityRuntimeOperation({
    projectId: "project-review-demo",
    operation: { id: "architecture.seed-syson-model", version: "2" },
    capabilityId: "model.author-system",
    binding: { id: "syson-author-system", version: "1.0.0" },
  });
  const assembly = testResolvedCapabilityRuntimeOperation({
    projectId: "project-review-demo",
    operation: { id: "verify.observe-assembly-integrity", version: "1" },
    capabilityId: "geometry.observe-assembly-integrity",
    binding: { id: "build123d-observe-assembly-integrity", version: "1.0.0" },
    unitId: "casys.mcp-build123d-observation",
    materialId: "mcp-build123d-observation-image",
    launchGroup: {
      id: "casys-build123d-observation",
      version: "1.0.0",
      fingerprint: FINGERPRINT,
    },
  });
  assertThrows(
    () =>
      requiredQualifiedPersistentComposePublication({
        ...syson,
        bindings: [...syson.bindings, ...assembly.bindings],
      }),
    CapabilityRuntimeConnectionError,
    "exactly one qualified binding",
  );
  assertThrows(
    () =>
      requiredQualifiedPersistentComposePublication({
        ...syson,
        bindings: [{
          ...syson.bindings[0]!,
          effectiveQualification: "compatible",
          capability: {
            ...syson.bindings[0]!.capability,
            minimumQualification: "compatible",
          },
        }],
      }),
    CapabilityRuntimeConnectionError,
    "exactly one qualified binding",
  );
  assertThrows(
    () =>
      requiredQualifiedPersistentComposePublication({
        ...syson,
        bindings: [{
          ...syson.bindings[0]!,
          hostLifecycles: [
            syson.bindings[0]!.hostLifecycles[0]!,
            {
              ...assembly.bindings[0]!.hostLifecycles[0]!,
              material: syson.bindings[0]!.materials[0]!,
            },
          ],
        }],
      }),
    CapabilityRuntimeConnectionError,
    "exactly one distinct persistent-Compose launch group",
  );
  assertThrows(
    () =>
      requiredQualifiedPersistentComposePublication({
        ...syson,
        bindings: [{
          ...syson.bindings[0]!,
          hostLifecycles: [{
            material: syson.bindings[0]!.materials[0]!,
            kind: "ephemeral-microsandbox",
            launchGroup: null,
          }],
        }],
      }),
    CapabilityRuntimeConnectionError,
    "exactly one distinct persistent-Compose launch group",
  );
});

Deno.test("assembly observation resolves the observation group, not the sandbox", () => {
  const operational = testResolvedCapabilityRuntimeOperation({
    projectId: "project.assembly-integrity",
    operation: { id: "verify.observe-assembly-integrity", version: "1" },
    capabilityId: "geometry.observe-assembly-integrity",
    binding: { id: "build123d-observe-assembly-integrity", version: "1.0.0" },
    unitId: "casys.mcp-build123d-observation",
    materialId: "mcp-build123d-observation-image",
    launchGroup: {
      id: "casys-build123d-observation",
      version: "1.0.0",
      fingerprint: FINGERPRINT,
    },
  });
  assertEquals(requiredQualifiedPersistentComposePublication(operational), {
    binding: { id: "build123d-observe-assembly-integrity", version: "1.0.0" },
    launchGroup: {
      id: "casys-build123d-observation",
      version: "1.0.0",
      fingerprint: FINGERPRINT,
    },
  });
});
