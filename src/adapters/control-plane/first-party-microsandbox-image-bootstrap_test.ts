import { assertEquals, assertThrows } from "@std/assert";
import { relative } from "node:path";
import { pinnedOciImageReference } from "../../domain/compile/isolation/local-isolation-runtime.ts";
import { LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE } from "../../domain/modelica/local-execution-image.ts";
import { createFirstPartyCapabilityRuntimeCatalog } from "./first-party-capability-binding-catalog.ts";
import {
  assertFirstPartyPhysicalImageHasUniqueTargetDigest,
  createFirstPartyMicrosandboxImageBootstrapDescriptors,
  FIRST_PARTY_BUILD123D_ISOLATED_CACHE_RECIPE_ID,
  FIRST_PARTY_CALCULIX_CACHE_RECIPE_ID,
  FIRST_PARTY_GEOMETRY_MODULE_CACHE_RECIPE_ID,
  FIRST_PARTY_MODELICA_CACHE_RECIPE_ID,
  FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID,
  firstPartyMicrosandboxBootstrapRepoRoot,
  resolveTrustedFirstPartyBootstrapPath,
} from "./first-party-microsandbox-image-bootstrap.ts";

Deno.test("first-party bootstrap descriptors cover the five catalogued microvm-images", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const descriptors = createFirstPartyMicrosandboxImageBootstrapDescriptors(catalog);
  assertEquals(descriptors.map((descriptor) => descriptor.recipeId), [
    FIRST_PARTY_BUILD123D_ISOLATED_CACHE_RECIPE_ID,
    FIRST_PARTY_GEOMETRY_MODULE_CACHE_RECIPE_ID,
    FIRST_PARTY_CALCULIX_CACHE_RECIPE_ID,
    FIRST_PARTY_MODELICA_CACHE_RECIPE_ID,
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
    assertEquals(descriptor.buildRecipe.platform, "linux/arm64");
    assertEquals(descriptor.buildRecipe.os, "linux");
    assertEquals(descriptor.buildRecipe.architecture, "arm64");
    assertEquals(typeof descriptor.physicalImageId, "string");
    assertEquals("physicalImageId" in descriptor.buildRecipe, false);
    assertEquals("dockerfile" in descriptor.source, false);
    assertEquals("physicalImageId" in descriptor.source, false);
    assertEquals("platform" in descriptor.source, false);
    assertEquals(descriptor.source.dockerImageName.endsWith(":latest"), false);
    assertEquals(descriptor.source.dockerImageName.includes("@"), false);
    const dockerfile = resolveTrustedFirstPartyBootstrapPath(
      descriptor.buildRecipe.dockerfile,
    );
    const context = resolveTrustedFirstPartyBootstrapPath(
      descriptor.buildRecipe.context,
    );
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

Deno.test("Modelica has one bootstrap descriptor, one material, and one physical image", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const descriptors = createFirstPartyMicrosandboxImageBootstrapDescriptors(catalog);
  const modelica = descriptors.filter((descriptor) =>
    descriptor.recipeId === FIRST_PARTY_MODELICA_CACHE_RECIPE_ID
  );
  assertEquals(modelica.length, 1);
  const descriptor = modelica[0]!;
  assertEquals(descriptor.unitId, "casys.modelica-worker");
  assertEquals(descriptor.materialId, "modelica-worker-image");
  assertEquals(descriptor.physicalImageId, "modelica-microsandbox-worker");
  if (descriptor.source.kind !== "trusted-dockerfile") {
    throw new Error("Modelica bootstrap must stay on trusted Dockerfiles");
  }
  const cataloguedModelica = catalog.units.find((unit) =>
    unit.id === "casys.modelica-worker"
  )?.materials.find((material) => material.id === "modelica-worker-image");
  assertEquals(
    descriptor.targetImageReference,
    pinnedOciImageReference(
      LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE,
      "$bootstrap.modelica",
    ),
  );
  assertEquals(
    descriptor.targetImageReference,
    "docker.io/casys/modelica-microsandbox-worker@sha256:834c759291320eb5f35ccb6eba03587445d259dcb38a2814c5def4ac41d5d730",
  );
  assertEquals(descriptor.targetImageReference, cataloguedModelica?.imageReference);
  assertEquals(descriptor.target.reference, descriptor.targetImageReference);
  assertEquals(
    catalog.bindings.filter((binding) =>
      binding.unitIds.includes("casys.modelica-worker")
    ).map((binding) => binding.id),
    ["openmodelica-qualified-kit", "openmodelica-admitted-modelica"],
  );
  assertFirstPartyPhysicalImageHasUniqueTargetDigest(descriptors);
  assertThrows(
    () =>
      assertFirstPartyPhysicalImageHasUniqueTargetDigest([
        descriptor,
        {
          ...descriptor,
          target: {
            ...descriptor.target,
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

const MICROSANDBOX_NATIVE_ENV = [
  "NAPI_RS_ENFORCE_VERSION_CHECK",
  "NAPI_RS_NATIVE_LIBRARY_PATH",
  "NAPI_RS_FORCE_WASI",
  "NAPI_RS_WASI_FLAVOR",
  "MSB_PATH",
  "MSB_LIBKRUNFW_PATH",
  "MSB_CONFIG_PATH",
  "MSB_HOME",
  "MSB_BACKEND",
  "MSB_API_URL",
  "MSB_API_KEY",
  "MSB_PROFILE",
] as const;

Deno.test(
  "deno tasks that load first-party bootstrap descriptors can stat repo-root contexts under --no-prompt",
  async () => {
    const catalog = await createFirstPartyCapabilityRuntimeCatalog();
    const descriptors = createFirstPartyMicrosandboxImageBootstrapDescriptors(
      catalog,
    );
    assertEquals(
      descriptors.some((descriptor) =>
        descriptor.source.kind === "trusted-dockerfile" &&
        descriptor.buildRecipe.context === "."
      ),
      true,
    );

    const config = JSON.parse(await Deno.readTextFile("deno.json")) as {
      tasks: Record<string, string>;
    };
    const bootstrapTasks: string[] = [];
    for (const [name, command] of Object.entries(config.tasks)) {
      const scripts = command.match(/scripts\/[^\s"*]+\.ts/g) ?? [];
      let loadsBootstrap = false;
      for (const script of scripts) {
        const source = await Deno.readTextFile(script);
        if (source.includes("first-party-microsandbox-image-bootstrap.ts")) {
          loadsBootstrap = true;
          break;
        }
      }
      if (!loadsBootstrap) continue;
      bootstrapTasks.push(name);
      assertNarrowMicrosandboxTaskRead(command, { worktreeRoot: true });
    }
    assertEquals(bootstrapTasks.toSorted(), [
      "prepare:geometry-module:microsandbox",
      "prepare:ngspice:microsandbox",
    ]);

    for (const name of ["start", "start:yolo", "dev"]) {
      const reads = [...config.tasks[name]!.matchAll(/--allow-read=([^ ]+)/g)]
        .flatMap((match) => match[1]!.split(","));
      assertEquals(
        reads.includes("."),
        true,
        `${name} composes the bootstrap registry and must stat repo-root contexts`,
      );
    }

    assertNarrowMicrosandboxTaskRead(config.tasks["capability:admin"], {
      worktreeRoot: false,
    });
    assertNarrowMicrosandboxTaskRead(config.tasks["capability:qualify"], {
      worktreeRoot: true,
    });
  },
);

function assertNarrowMicrosandboxTaskRead(
  command: string,
  options: { readonly worktreeRoot: boolean },
): void {
  assertEquals(command.includes("--no-prompt"), true);
  assertEquals(command.includes("--frozen"), true);
  assertEquals(command.includes("--allow-ffi=node_modules"), true);
  assertEquals(command.includes("--allow-all"), false);
  assertEquals(/(?:^|\s)--allow-read(?:\s|$)/.test(command), false);
  const reads = [...command.matchAll(/--allow-read=([^ ]+)/g)].flatMap(
    (match) => match[1]!.split(","),
  );
  assertEquals(reads.includes("node_modules"), true);
  assertEquals(
    reads.includes(".") || reads.includes("config") ||
      reads.includes("config/microsandbox-local.json"),
    true,
  );
  if (options.worktreeRoot) {
    assertEquals(reads.includes("."), true);
  }
  for (const name of MICROSANDBOX_NATIVE_ENV) {
    assertEquals(command.includes(name), true);
  }
}
