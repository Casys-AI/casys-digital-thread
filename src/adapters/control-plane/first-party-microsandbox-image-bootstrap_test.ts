import { assertEquals, assertThrows } from "@std/assert";
import { relative } from "node:path";
import { createFirstPartyCapabilityRuntimeCatalog } from "./first-party-capability-binding-catalog.ts";
import {
  assertFirstPartyPhysicalImageHasUniqueTargetDigest,
  createFirstPartyMicrosandboxImageBootstrapDescriptors,
  FIRST_PARTY_BUILD123D_ISOLATED_CACHE_RECIPE_ID,
  FIRST_PARTY_CALCULIX_CACHE_RECIPE_ID,
  FIRST_PARTY_GEOMETRY_MODULE_CACHE_RECIPE_ID,
  FIRST_PARTY_MODELICA_ADMITTED_CACHE_RECIPE_ID,
  FIRST_PARTY_MODELICA_QUALIFIED_CACHE_RECIPE_ID,
  FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID,
  firstPartyMicrosandboxBootstrapRepoRoot,
  physicalFirstPartyMicrosandboxImageId,
  resolveTrustedFirstPartyBootstrapPath,
} from "./first-party-microsandbox-image-bootstrap.ts";

Deno.test("first-party bootstrap descriptors cover the six catalogued microvm-images", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const descriptors = createFirstPartyMicrosandboxImageBootstrapDescriptors(catalog);
  assertEquals(descriptors.map((descriptor) => descriptor.recipeId), [
    FIRST_PARTY_BUILD123D_ISOLATED_CACHE_RECIPE_ID,
    FIRST_PARTY_GEOMETRY_MODULE_CACHE_RECIPE_ID,
    FIRST_PARTY_CALCULIX_CACHE_RECIPE_ID,
    FIRST_PARTY_MODELICA_QUALIFIED_CACHE_RECIPE_ID,
    FIRST_PARTY_MODELICA_ADMITTED_CACHE_RECIPE_ID,
    FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID,
  ]);
  assertEquals(
    descriptors.every((descriptor) => descriptor.source.kind === "trusted-dockerfile"),
    true,
  );
  assertEquals(
    descriptors.some((descriptor) => descriptor.source.kind === "oci-digest"),
    false,
  );
  for (const descriptor of descriptors) {
    if (descriptor.source.kind !== "trusted-dockerfile") {
      throw new Error(
        "current first-party descriptors use the local candidate recipe; oci-digest is preferred when a reviewed digest exists",
      );
    }
    assertEquals(descriptor.source.platform, "linux/arm64");
    assertEquals(descriptor.source.dockerImageName.endsWith(":latest"), false);
    assertEquals(descriptor.source.dockerImageName.includes("@"), false);
    const dockerfile = resolveTrustedFirstPartyBootstrapPath(
      descriptor.source.dockerfile,
    );
    const context = resolveTrustedFirstPartyBootstrapPath(descriptor.source.context);
    assertEquals(
      relative(firstPartyMicrosandboxBootstrapRepoRoot(), dockerfile).startsWith(".."),
      false,
    );
    assertEquals(
      relative(firstPartyMicrosandboxBootstrapRepoRoot(), context).startsWith(".."),
      false,
    );
  }
});

Deno.test("Modelica qualified and admitted share one physical image and target digest", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const descriptors = createFirstPartyMicrosandboxImageBootstrapDescriptors(catalog);
  const qualified = descriptors.find((descriptor) =>
    descriptor.recipeId === FIRST_PARTY_MODELICA_QUALIFIED_CACHE_RECIPE_ID
  );
  const admitted = descriptors.find((descriptor) =>
    descriptor.recipeId === FIRST_PARTY_MODELICA_ADMITTED_CACHE_RECIPE_ID
  );
  if (!qualified || !admitted) throw new Error("Modelica descriptors are absent");
  assertEquals(qualified.unitId, "casys.modelica-qualified-worker");
  assertEquals(admitted.unitId, "casys.modelica-worker");
  assertEquals(qualified.recipeId === admitted.recipeId, false);
  assertEquals(qualified.targetImageReference, admitted.targetImageReference);
  assertEquals(qualified.target.manifestDigest, admitted.target.manifestDigest);
  assertEquals(
    physicalFirstPartyMicrosandboxImageId(qualified.source),
    physicalFirstPartyMicrosandboxImageId(admitted.source),
  );
  if (
    qualified.source.kind !== "trusted-dockerfile" ||
    admitted.source.kind !== "trusted-dockerfile"
  ) {
    throw new Error("Modelica bootstrap must stay on trusted Dockerfiles");
  }
  assertEquals(qualified.source.dockerfile, admitted.source.dockerfile);
  assertEquals(qualified.source.context, admitted.source.context);
  assertEquals(qualified.source.dockerImageName, admitted.source.dockerImageName);
  assertFirstPartyPhysicalImageHasUniqueTargetDigest(descriptors);
  assertThrows(
    () =>
      assertFirstPartyPhysicalImageHasUniqueTargetDigest([
        qualified,
        {
          ...admitted,
          target: {
            ...admitted.target,
            manifestDigest: `sha256:${"0".repeat(64)}`,
          },
        },
      ]),
    TypeError,
    "cannot load under both",
  );
});

Deno.test("trusted bootstrap paths refuse absolute or escaped caller paths", () => {
  assertThrows(
    () => resolveTrustedFirstPartyBootstrapPath("/tmp/caller"),
    TypeError,
    "repo-relative posix paths",
  );
  assertThrows(
    () => resolveTrustedFirstPartyBootstrapPath("../outside"),
    TypeError,
    "escaped the repository",
  );
});
