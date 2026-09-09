import { assertEquals, assertThrows } from "@std/assert";
import { relative } from "node:path";
import { pinnedOciImageReference } from "../../domain/compile/isolation/local-isolation-runtime.ts";
import { LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE } from "../fea/isolated-v3/local-calculix-image-reference.ts";
import { LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE } from "../../domain/modelica/local-execution-image.ts";
import { createFirstPartyCapabilityRuntimeCatalog } from "./first-party-capability-binding-catalog.ts";
import { LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE } from "./first-party-capability-runtime-identities.ts";
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
    descriptors.filter((descriptor) => descriptor.source.kind === "trusted-dockerfile")
      .map((descriptor) => descriptor.recipeId),
    [
      FIRST_PARTY_GEOMETRY_MODULE_CACHE_RECIPE_ID,
      FIRST_PARTY_MODELICA_CACHE_RECIPE_ID,
      FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID,
    ],
  );
  assertEquals(
    descriptors.filter((descriptor) => descriptor.source.kind === "oci-digest")
      .map((descriptor) => descriptor.recipeId),
    [
      FIRST_PARTY_BUILD123D_ISOLATED_CACHE_RECIPE_ID,
      FIRST_PARTY_CALCULIX_CACHE_RECIPE_ID,
    ],
  );
  for (const descriptor of descriptors) {
    assertEquals(descriptor.buildRecipe.platform, "linux/arm64");
    assertEquals(descriptor.buildRecipe.os, "linux");
    assertEquals(descriptor.buildRecipe.architecture, "arm64");
    assertEquals(typeof descriptor.physicalImageId, "string");
    assertEquals("physicalImageId" in descriptor.buildRecipe, false);
    assertEquals("dockerfile" in descriptor.source, false);
    assertEquals("physicalImageId" in descriptor.source, false);
    assertEquals("platform" in descriptor.source, false);
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
    if (descriptor.source.kind === "trusted-dockerfile") {
      assertEquals(descriptor.source.dockerImageName.endsWith(":latest"), false);
      assertEquals(descriptor.source.dockerImageName.includes("@"), false);
      continue;
    }
    assertEquals(descriptor.source.kind, "oci-digest");
    assertEquals("dockerImageName" in descriptor.source, false);
  }
});

Deno.test("Build123d acquires the qualified public GHCR arm64 digest and keeps its recipe", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const descriptors = createFirstPartyMicrosandboxImageBootstrapDescriptors(catalog);
  const build123d = descriptors.find((descriptor) =>
    descriptor.recipeId === FIRST_PARTY_BUILD123D_ISOLATED_CACHE_RECIPE_ID
  );
  if (!build123d || build123d.source.kind !== "oci-digest") {
    throw new Error("Build123d bootstrap must acquire by oci-digest");
  }
  assertEquals(build123d.unitId, "casys.build123d-isolated-worker");
  assertEquals(build123d.materialId, "build123d-isolated-worker-image");
  assertEquals(build123d.physicalImageId, "build123d-isolated-worker");
  assertEquals(
    build123d.source.reference,
    "ghcr.io/casys-ai/casys-digital-thread-build123d-isolated-worker@sha256:57bd9f9002cb258f99413b5f314c22b3e75a4b2485058c0780253f4285834609",
  );
  assertEquals(
    build123d.targetImageReference,
    pinnedOciImageReference(
      LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE,
      "$bootstrap.build123d",
    ),
  );
  assertEquals(
    build123d.targetImageReference,
    "docker.io/casys/build123d-microsandbox-worker@sha256:6484a43b3632972de349ba5aa55f3da7316fb5bd7ad957b7c22aaf7888fad159",
  );
  assertEquals(build123d.source.reference === build123d.targetImageReference, false);
  assertEquals(
    build123d.buildRecipe.dockerfile,
    "images/build123d-microsandbox-worker/Dockerfile",
  );
  assertEquals(
    build123d.buildRecipe.context,
    "images/build123d-microsandbox-worker",
  );
  const cataloguedBuild123d = catalog.units.find((unit) =>
    unit.id === "casys.build123d-isolated-worker"
  )?.materials.find((material) => material.id === "build123d-isolated-worker-image");
  assertEquals(build123d.targetImageReference, cataloguedBuild123d?.imageReference);
  assertEquals(build123d.target.reference, build123d.targetImageReference);
  assertEquals(
    build123d.target.manifestDigest,
    "sha256:6484a43b3632972de349ba5aa55f3da7316fb5bd7ad957b7c22aaf7888fad159",
  );
});

Deno.test("CalculiX acquires the public GHCR arm64 digest and keeps its recipe", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const descriptors = createFirstPartyMicrosandboxImageBootstrapDescriptors(catalog);
  const calculix = descriptors.find((descriptor) =>
    descriptor.recipeId === FIRST_PARTY_CALCULIX_CACHE_RECIPE_ID
  );
  if (!calculix || calculix.source.kind !== "oci-digest") {
    throw new Error("CalculiX bootstrap must acquire by oci-digest");
  }
  assertEquals(calculix.unitId, "casys.calculix-worker");
  assertEquals(calculix.materialId, "calculix-worker-image");
  assertEquals(calculix.physicalImageId, "calculix-worker");
  assertEquals(
    calculix.source.reference,
    "ghcr.io/casys-ai/casys-digital-thread-calculix-worker@sha256:0c96ae7f16c05aaa1b082740e1272ae6b4e35ac58866a4537f9d6e74cb236462",
  );
  assertEquals(
    calculix.targetImageReference,
    pinnedOciImageReference(
      LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE,
      "$bootstrap.calculix",
    ),
  );
  assertEquals(
    calculix.targetImageReference,
    "docker.io/casys/calculix-microsandbox-worker@sha256:2dc7d17454833a2c17b5812eb1e5504c4a025ef3764fc771fda2938d49fa9771",
  );
  assertEquals(
    calculix.source.reference === calculix.targetImageReference,
    false,
  );
  assertEquals(
    calculix.buildRecipe.dockerfile,
    "images/calculix-microsandbox-worker/Dockerfile",
  );
  assertEquals(calculix.buildRecipe.context, ".");
  const cataloguedCalculix = catalog.units.find((unit) =>
    unit.id === "casys.calculix-worker"
  )?.materials.find((material) => material.id === "calculix-worker-image");
  assertEquals(calculix.targetImageReference, cataloguedCalculix?.imageReference);
  assertEquals(calculix.target.reference, calculix.targetImageReference);
  assertEquals(
    calculix.target.manifestDigest,
    "sha256:2dc7d17454833a2c17b5812eb1e5504c4a025ef3764fc771fda2938d49fa9771",
  );
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
      "prepare:build123d:microsandbox",
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
