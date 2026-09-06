/**
 * Server-owned bootstrap descriptors for first-party Microsandbox images.
 *
 * One descriptor is one catalogued microvm-image. `physicalImageId` is the
 * stable descriptor-level identity of one physical image; it is not a
 * field of the mutable build recipe and not an acquisition-source field.
 * `buildRecipe` is the repo-owned candidate Dockerfile used to publish a
 * future image. `source` is how local acquisition obtains bytes today.
 * Those identities stay separate: a later descriptor may acquire by
 * immutable OCI digest while still carrying the recipe that publishes the
 * next candidate.
 *
 * A `trusted-dockerfile` rebuild is not proof of a bit-reproducible
 * image. After import, the cached image must still be the exact target
 * digest; otherwise the capability stays unavailable. `oci-digest` is the
 * preferred immutable distribution source when a reviewed digest exists.
 * A moving APT repository does not promise that a later rebuild will
 * reproduce the pin. The catalogued Microsandbox runtime digest is never
 * the candidate publication identity.
 *
 * Docker build context is internal acquisition material, not a second
 * recipe or project capability.
 */

import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CapabilityRuntimeCatalog } from "../../domain/capability/runtime/capability-runtime-catalog.ts";
import { pinnedOciImageReference } from "../../domain/compile/isolation/local-isolation-runtime.ts";
import {
  BUILD123D_ISOLATED_WORKER_MATERIAL_ID,
  BUILD123D_ISOLATED_WORKER_UNIT_ID,
  BUILD123D_MICROSANDBOX_WORKER_CONTRACT,
} from "../cad/isolated/worker-contract.ts";
import { GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_WORKER_CONTRACT } from "../cad/module-assembly/worker-contract.ts";
import {
  LOCAL_ADMITTED_SPICE_DOCKER_SOURCE_IMAGE_REFERENCE,
  LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE,
} from "../electrical/spice/admitted/local-image-references.ts";
import { NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT } from "../electrical/spice/admitted/worker-contract.ts";
import { CALCULIX_MICROSANDBOX_WORKER_CONTRACT } from "../fea/isolated-v3/calculix-static-proof-v1/worker-contract.ts";
import { LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE } from "../fea/isolated-v3/local-calculix-image-reference.ts";
import { MODELICA_ADMITTED_MICROSANDBOX_WORKER_CONTRACT } from "../modelica/admitted/closed-subset-v2/worker-contract.ts";
import { MODELICA_MICROSANDBOX_WORKER_CONTRACT } from "../modelica/qualified-kit/kit-v1/worker-contract.ts";
import type { ExactMicrosandboxImageExpectation } from "../shared/execution/microsandbox-ephemeral-execution-backend.ts";
import { createFirstPartyNonpersistentMicrosandboxExpectations } from "./first-party-capability-runtime-nonpersistent-materials.ts";
import {
  LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE,
  LOCAL_GEOMETRY_MODULE_ASSEMBLY_DOCKER_SOURCE_IMAGE_REFERENCE,
  LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE,
  LOCAL_GEOMETRY_MODULE_ASSEMBLY_SOURCE_HASH_LABELS,
  LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE,
} from "./first-party-capability-runtime-identities.ts";
import { exactMicrosandboxMaterialArchitecture } from "./microsandbox-capability-runtime-cache.ts";

export const FIRST_PARTY_BUILD123D_ISOLATED_CACHE_RECIPE_ID =
  "cache.build123d-isolated" as const;
export const FIRST_PARTY_GEOMETRY_MODULE_CACHE_RECIPE_ID =
  "cache.geometry-module" as const;
export const FIRST_PARTY_CALCULIX_CACHE_RECIPE_ID = "cache.calculix" as const;
export const FIRST_PARTY_MODELICA_CACHE_RECIPE_ID = "cache.modelica" as const;
export const FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID = "cache.ngspice" as const;

const REPO_ROOT = resolveRepoRoot();
const MODELICA_PHYSICAL_IMAGE_ID = "modelica-microsandbox-worker" as const;
const PHYSICAL_IMAGE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

/**
 * Repo-owned candidate build recipe. Paths stay below this repository.
 * A successful `docker buildx` is not proof of a bit-reproducible image
 * and does not become the catalogued Microsandbox runtime digest.
 */
export interface FirstPartyMicrosandboxImageBuildRecipe {
  readonly dockerfile: string;
  readonly context: string;
  readonly platform: "linux/arm64";
  readonly os: "linux";
  readonly architecture: "arm64";
  readonly user: string;
  readonly entrypoint: readonly string[];
  readonly labels?: Readonly<Record<string, string>>;
}

/**
 * Local candidate acquisition: rebuild or reuse a Docker tag/digest, then
 * import under the catalogued Microsandbox target. Not a publication identity.
 */
export interface FirstPartyTrustedDockerfileSource {
  readonly kind: "trusted-dockerfile";
  readonly dockerImageName: string;
  readonly dockerSourceReference: string;
}

/**
 * Preferred immutable distribution source when a reviewed digest exists.
 * No first-party descriptor uses this today. The recipe remains the way to
 * publish a later candidate; this source never replaces `buildRecipe`.
 */
export interface FirstPartyOciDigestSource {
  readonly kind: "oci-digest";
  readonly reference: string;
}

export type FirstPartyMicrosandboxImageBootstrapSource =
  | FirstPartyTrustedDockerfileSource
  | FirstPartyOciDigestSource;

export interface FirstPartyMicrosandboxImageBootstrapDescriptor {
  readonly unitId: string;
  readonly materialId: string;
  readonly recipeId: string;
  readonly physicalImageId: string;
  readonly targetImageReference: string;
  readonly target: ExactMicrosandboxImageExpectation;
  readonly buildRecipe: FirstPartyMicrosandboxImageBuildRecipe;
  readonly source: FirstPartyMicrosandboxImageBootstrapSource;
}

export function firstPartyMicrosandboxBootstrapRepoRoot(): string {
  return REPO_ROOT;
}

export function resolveTrustedFirstPartyBootstrapPath(relativePath: string): string {
  if (
    relativePath.includes("\0") || relativePath.includes("\\") ||
    isAbsolute(relativePath)
  ) {
    throw new TypeError(
      "First-party Microsandbox bootstrap paths must be repo-relative posix paths.",
    );
  }
  const resolved = resolve(REPO_ROOT, relativePath);
  const rel = relative(REPO_ROOT, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new TypeError(
      "First-party Microsandbox bootstrap path escaped the repository.",
    );
  }
  return resolved;
}

export function createFirstPartyMicrosandboxImageBootstrapDescriptors(
  catalog: CapabilityRuntimeCatalog,
): readonly FirstPartyMicrosandboxImageBootstrapDescriptor[] {
  const expectations = createFirstPartyNonpersistentMicrosandboxExpectations(catalog);
  const descriptors = closedFirstPartyBootstrapDescriptors().map((descriptor) =>
    bindDescriptorToCatalog(descriptor, catalog, expectations)
  );
  const expectedKeys = new Set(
    expectations.map((entry) => materialKey(entry.material)),
  );
  const boundKeys = new Set(
    descriptors.map((descriptor) =>
      materialKey({ unitId: descriptor.unitId, materialId: descriptor.materialId })
    ),
  );
  if (expectedKeys.size !== boundKeys.size) {
    throw new TypeError(
      "First-party Microsandbox bootstrap does not cover every catalogued microvm-image.",
    );
  }
  for (const key of expectedKeys) {
    if (!boundKeys.has(key)) {
      throw new TypeError(
        `First-party Microsandbox bootstrap lacks catalogued material ${key}.`,
      );
    }
  }
  assertFirstPartyPhysicalImageHasUniqueTargetDigest(descriptors);
  return Object.freeze(descriptors);
}

/**
 * One physical image is one target manifest. Distinct catalog pins may share
 * a load identity only when they already pin that same digest.
 */
export function assertFirstPartyPhysicalImageHasUniqueTargetDigest(
  descriptors: readonly FirstPartyMicrosandboxImageBootstrapDescriptor[],
): void {
  const seen = new Map<string, string>();
  for (const descriptor of descriptors) {
    const physicalId = descriptor.physicalImageId;
    const digest = descriptor.target.manifestDigest;
    const previous = seen.get(physicalId);
    if (previous !== undefined && previous !== digest) {
      throw new TypeError(
        `First-party Microsandbox physical image ${physicalId} cannot load under both ${previous} and ${digest}.`,
      );
    }
    seen.set(physicalId, digest);
  }
}

function closedFirstPartyBootstrapDescriptors(): readonly Omit<
  FirstPartyMicrosandboxImageBootstrapDescriptor,
  "target"
>[] {
  if (
    MODELICA_ADMITTED_MICROSANDBOX_WORKER_CONTRACT.expectedImageUser !==
      MODELICA_MICROSANDBOX_WORKER_CONTRACT.expectedImageUser
  ) {
    throw new TypeError(
      "Modelica qualified and admitted workers must keep the same image user.",
    );
  }
  const modelicaBuildRecipe = firstPartyBuildRecipe({
    dockerfile: "images/modelica-microsandbox-worker/Dockerfile",
    context: ".",
    user: MODELICA_MICROSANDBOX_WORKER_CONTRACT.expectedImageUser,
    entrypoint: imageEntrypoint(MODELICA_MICROSANDBOX_WORKER_CONTRACT),
  });
  const modelicaSource = trustedDockerfileSource({
    dockerImageName: "casys/modelica-microsandbox-worker:local",
    dockerSourceReference: "casys/modelica-microsandbox-worker:local",
  });
  return Object.freeze([
    {
      unitId: BUILD123D_ISOLATED_WORKER_UNIT_ID,
      materialId: BUILD123D_ISOLATED_WORKER_MATERIAL_ID,
      recipeId: FIRST_PARTY_BUILD123D_ISOLATED_CACHE_RECIPE_ID,
      physicalImageId: "build123d-isolated-worker",
      targetImageReference: LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE,
      buildRecipe: firstPartyBuildRecipe({
        dockerfile: "images/build123d-microsandbox-worker/Dockerfile",
        context: "images/build123d-microsandbox-worker",
        user: BUILD123D_MICROSANDBOX_WORKER_CONTRACT.expectedImageUser,
        entrypoint: imageEntrypoint(BUILD123D_MICROSANDBOX_WORKER_CONTRACT),
      }),
      source: trustedDockerfileSource({
        dockerImageName: "casys/build123d-microsandbox-worker:local",
        dockerSourceReference: "casys/build123d-microsandbox-worker:local",
      }),
    },
    {
      unitId: "casys.geometry-module-assembler-worker",
      materialId: "geometry-module-assembler-worker-image",
      recipeId: FIRST_PARTY_GEOMETRY_MODULE_CACHE_RECIPE_ID,
      physicalImageId: "geometry-module-assembler-worker",
      targetImageReference: LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE,
      buildRecipe: firstPartyBuildRecipe({
        dockerfile: "images/build123d-module-assembler-worker/Dockerfile",
        context: ".",
        user: GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_WORKER_CONTRACT.expectedImageUser,
        entrypoint: imageEntrypoint(
          GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_WORKER_CONTRACT,
        ),
        labels: LOCAL_GEOMETRY_MODULE_ASSEMBLY_SOURCE_HASH_LABELS,
      }),
      source: trustedDockerfileSource({
        dockerImageName: "casys/build123d-module-assembler-worker:local",
        dockerSourceReference:
          LOCAL_GEOMETRY_MODULE_ASSEMBLY_DOCKER_SOURCE_IMAGE_REFERENCE,
      }),
    },
    {
      unitId: "casys.calculix-worker",
      materialId: "calculix-worker-image",
      recipeId: FIRST_PARTY_CALCULIX_CACHE_RECIPE_ID,
      physicalImageId: "calculix-worker",
      targetImageReference: LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE,
      buildRecipe: firstPartyBuildRecipe({
        dockerfile: "images/calculix-microsandbox-worker/Dockerfile",
        context: ".",
        user: CALCULIX_MICROSANDBOX_WORKER_CONTRACT.expectedImageUser,
        entrypoint: imageEntrypoint(CALCULIX_MICROSANDBOX_WORKER_CONTRACT),
      }),
      source: trustedDockerfileSource({
        dockerImageName: "casys/calculix-microsandbox-worker:local",
        dockerSourceReference: "casys/calculix-microsandbox-worker:local",
      }),
    },
    {
      unitId: "casys.modelica-worker",
      materialId: "modelica-worker-image",
      recipeId: FIRST_PARTY_MODELICA_CACHE_RECIPE_ID,
      physicalImageId: MODELICA_PHYSICAL_IMAGE_ID,
      targetImageReference: LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE,
      buildRecipe: modelicaBuildRecipe,
      source: modelicaSource,
    },
    {
      unitId: "casys.spice-worker",
      materialId: "ngspice-runtime-image",
      recipeId: FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID,
      physicalImageId: "ngspice-worker",
      targetImageReference: LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE,
      buildRecipe: firstPartyBuildRecipe({
        dockerfile: "images/ngspice-microsandbox-worker/Dockerfile",
        context: ".",
        user: NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT.expectedImageUser,
        entrypoint: imageEntrypoint(NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT),
      }),
      source: trustedDockerfileSource({
        dockerImageName: "casys/ngspice-microsandbox-worker:local",
        dockerSourceReference: LOCAL_ADMITTED_SPICE_DOCKER_SOURCE_IMAGE_REFERENCE,
      }),
    },
  ]);
}

function bindDescriptorToCatalog(
  descriptor: Omit<FirstPartyMicrosandboxImageBootstrapDescriptor, "target">,
  catalog: CapabilityRuntimeCatalog,
  expectations: ReturnType<
    typeof createFirstPartyNonpersistentMicrosandboxExpectations
  >,
): FirstPartyMicrosandboxImageBootstrapDescriptor {
  const unit = catalog.units.find((candidate) => candidate.id === descriptor.unitId);
  const material = unit?.materials.find((candidate) =>
    candidate.id === descriptor.materialId
  );
  const authoredTarget = pinnedOciImageReference(
    descriptor.targetImageReference,
    "$firstPartyMicrosandboxBootstrap.targetImageReference",
  );
  if (
    !unit || !material || material.kind !== "microvm-image" ||
    material.lifecycle !== "ephemeral" || material.launchGroup !== null ||
    material.imageReference !== authoredTarget
  ) {
    throw new TypeError(
      `First-party Microsandbox bootstrap lacks exact ${descriptor.unitId}/${descriptor.materialId}.`,
    );
  }
  const expectation = expectations.find((entry) =>
    entry.material.unitId === descriptor.unitId &&
    entry.material.materialId === descriptor.materialId
  );
  if (!expectation || expectation.image.reference !== material.imageReference) {
    throw new TypeError(
      `First-party Microsandbox bootstrap drifted from the worker contract for ${descriptor.unitId}/${descriptor.materialId}.`,
    );
  }
  assertFirstPartyPhysicalImageId(descriptor.physicalImageId);
  assertFirstPartyBuildRecipe(descriptor.buildRecipe);
  assertAcquisitionSource(descriptor.source);
  const architecture = exactMicrosandboxMaterialArchitecture(material.platforms);
  if (
    descriptor.buildRecipe.architecture !== architecture ||
    descriptor.buildRecipe.platform !== `linux/${architecture}` ||
    descriptor.buildRecipe.user !== expectation.image.user ||
    !sameEntrypoint(descriptor.buildRecipe.entrypoint, expectation.image.entrypoint)
  ) {
    throw new TypeError(
      `First-party Microsandbox bootstrap platform drifted for ${descriptor.unitId}/${descriptor.materialId}.`,
    );
  }
  const target = Object.freeze({
    reference: material.imageReference,
    manifestDigest: `sha256:${imageDigest(material.imageReference)}`,
    os: "linux" as const,
    architecture,
    user: descriptor.buildRecipe.user,
    entrypoint: descriptor.buildRecipe.entrypoint,
  });
  return Object.freeze({
    ...descriptor,
    targetImageReference: material.imageReference,
    buildRecipe: structuredClone(descriptor.buildRecipe),
    source: structuredClone(descriptor.source),
    target,
  });
}

function firstPartyBuildRecipe(
  input: Omit<
    FirstPartyMicrosandboxImageBuildRecipe,
    "platform" | "os" | "architecture"
  >,
): FirstPartyMicrosandboxImageBuildRecipe {
  return Object.freeze({
    platform: "linux/arm64",
    os: "linux",
    architecture: "arm64",
    ...input,
    entrypoint: Object.freeze([...input.entrypoint]),
    ...(input.labels === undefined
      ? {}
      : { labels: Object.freeze({ ...input.labels }) }),
  });
}

function trustedDockerfileSource(
  input: Omit<FirstPartyTrustedDockerfileSource, "kind">,
): FirstPartyTrustedDockerfileSource {
  return Object.freeze({
    kind: "trusted-dockerfile",
    ...input,
  });
}

function assertFirstPartyPhysicalImageId(physicalImageId: string): void {
  if (!PHYSICAL_IMAGE_ID.test(physicalImageId)) {
    throw new TypeError(
      "First-party Microsandbox physical image id must be a lowercase OCI repository segment.",
    );
  }
}

function assertFirstPartyBuildRecipe(
  recipe: FirstPartyMicrosandboxImageBuildRecipe,
): void {
  if (recipe.platform !== "linux/arm64") {
    throw new TypeError(
      "First-party Microsandbox build recipes are reviewed only for linux/arm64.",
    );
  }
  if (recipe.os !== "linux" || recipe.architecture !== "arm64") {
    throw new TypeError(
      "First-party Microsandbox build recipes must declare linux/arm64.",
    );
  }
  if (recipe.user === "") {
    throw new TypeError("First-party Microsandbox build recipe user is missing.");
  }
  if (
    recipe.entrypoint.length === 0 ||
    recipe.entrypoint.some((value) => value === "")
  ) {
    throw new TypeError(
      "First-party Microsandbox build recipe entrypoint must be a non-empty string array.",
    );
  }
  if (recipe.labels !== undefined) {
    for (const [name, value] of Object.entries(recipe.labels)) {
      if (name === "" || value === "") {
        throw new TypeError(
          "First-party Microsandbox build recipe labels must be non-empty strings.",
        );
      }
    }
  }
  const dockerfile = resolveTrustedFirstPartyBootstrapPath(recipe.dockerfile);
  const context = resolveTrustedFirstPartyBootstrapPath(recipe.context);
  if (!Deno.statSync(dockerfile).isFile) {
    throw new TypeError(
      `First-party Microsandbox bootstrap Dockerfile is missing: ${recipe.dockerfile}.`,
    );
  }
  if (recipe.context !== "." && !Deno.statSync(context).isDirectory) {
    throw new TypeError(
      `First-party Microsandbox bootstrap context is missing: ${recipe.context}.`,
    );
  }
}

function assertAcquisitionSource(
  source: FirstPartyMicrosandboxImageBootstrapSource,
): void {
  if (source.kind === "oci-digest") {
    pinnedOciImageReference(
      source.reference,
      "$firstPartyMicrosandboxBootstrap.ociDigest",
    );
    return;
  }
  if (
    source.dockerImageName.includes("@") || source.dockerImageName.endsWith(":latest")
  ) {
    throw new TypeError(
      "First-party Docker build tags cannot be digest pins or latest aliases.",
    );
  }
}

function imageEntrypoint(contract: {
  readonly executable: string;
  readonly args: readonly string[];
}): readonly string[] {
  return Object.freeze([contract.executable, ...contract.args]);
}

function sameEntrypoint(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function imageDigest(reference: string): string {
  const marker = "@sha256:";
  const index = reference.lastIndexOf(marker);
  if (index < 0) {
    throw new TypeError("First-party Microsandbox target is not digest-pinned.");
  }
  return reference.slice(index + marker.length);
}

function materialKey(
  value: { readonly unitId: string; readonly materialId: string },
): string {
  return `${value.unitId}\u0000${value.materialId}`;
}

function resolveRepoRoot(): string {
  return fileURLToPath(new URL("../../../", import.meta.url));
}
