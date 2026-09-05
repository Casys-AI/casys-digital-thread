import { assertEquals, assertThrows } from "@std/assert";
import { pinnedOciImageReference } from "../../domain/compile/isolation/local-isolation-runtime.ts";
import { createFirstPartyCapabilityRuntimeCatalog } from "./first-party-capability-binding-catalog.ts";
import {
  createFirstPartyMicrosandboxImageBootstrapDescriptors,
  FIRST_PARTY_MODELICA_ADMITTED_CACHE_RECIPE_ID,
  FIRST_PARTY_MODELICA_QUALIFIED_CACHE_RECIPE_ID,
  FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID,
  type FirstPartyMicrosandboxImageBootstrapDescriptor,
  type FirstPartyOciDigestSource,
} from "./first-party-microsandbox-image-bootstrap.ts";
import {
  assertFirstPartyMicrosandboxImageDistributionContract,
  createFirstPartyMicrosandboxImageDistributionMatrix,
  FIRST_PARTY_MICROSANDBOX_IMAGE_DISTRIBUTION_CONTRACT,
  FIRST_PARTY_MICROSANDBOX_IMAGE_DISTRIBUTION_MATRIX_SCHEMA,
  firstPartyMicrosandboxGhcrImageName,
  firstPartyMicrosandboxGhcrPackageName,
  planFirstPartyMicrosandboxImageDistribution,
} from "./first-party-microsandbox-image-distribution-matrix.ts";

Deno.test(
  "distribution matrix groups six logical workers into five physical images",
  async () => {
    const catalog = await createFirstPartyCapabilityRuntimeCatalog();
    const descriptors = createFirstPartyMicrosandboxImageBootstrapDescriptors(
      catalog,
    );
    const matrix = createFirstPartyMicrosandboxImageDistributionMatrix(catalog);
    assertEquals(descriptors.length, 6);
    assertEquals(
      matrix.schemaVersion,
      FIRST_PARTY_MICROSANDBOX_IMAGE_DISTRIBUTION_MATRIX_SCHEMA,
    );
    assertEquals(
      matrix.contract,
      FIRST_PARTY_MICROSANDBOX_IMAGE_DISTRIBUTION_CONTRACT,
    );
    assertEquals(matrix.platform, "linux/arm64");
    assertEquals(matrix.images.map((image) => image.physicalImageId), [
      "build123d-isolated-worker",
      "geometry-module-assembler-worker",
      "calculix-worker",
      "modelica-microsandbox-worker",
      "ngspice-worker",
    ]);
    assertEquals(
      matrix.images.map((image) => image.packageName),
      [
        "casys-digital-thread-build123d-isolated-worker",
        "casys-digital-thread-geometry-module-assembler-worker",
        "casys-digital-thread-calculix-worker",
        "casys-digital-thread-modelica-microsandbox-worker",
        "casys-digital-thread-ngspice-worker",
      ],
    );
    assertEquals(
      matrix.images.every((image) =>
        image.imageName === `ghcr.io/casys-ai/${image.packageName}` &&
        image.imageName === image.imageName.toLowerCase() &&
        !image.imageName.includes(":") &&
        !image.imageName.includes("@") &&
        !image.imageName.endsWith("latest") &&
        image.platform === "linux/arm64"
      ),
      true,
    );
    const modelica = matrix.images.find((image) =>
      image.physicalImageId === "modelica-microsandbox-worker"
    );
    if (!modelica) throw new Error("Modelica physical image is absent");
    assertEquals(modelica.dockerfile, "images/modelica-microsandbox-worker/Dockerfile");
    assertEquals(modelica.context, ".");
    assertEquals(
      modelica.logicalTargets.map((target) => target.recipeId),
      [
        FIRST_PARTY_MODELICA_QUALIFIED_CACHE_RECIPE_ID,
        FIRST_PARTY_MODELICA_ADMITTED_CACHE_RECIPE_ID,
      ],
    );
    assertEquals(
      modelica.logicalTargets.map((target) => target.unitId),
      ["casys.modelica-qualified-worker", "casys.modelica-worker"],
    );
    const cataloguedModelica = descriptors.find((descriptor) =>
      descriptor.recipeId === FIRST_PARTY_MODELICA_ADMITTED_CACHE_RECIPE_ID
    );
    if (!cataloguedModelica) throw new Error("Modelica admitted descriptor is absent");
    assertEquals(
      modelica.qualificationTarget.imageReference,
      pinnedOciImageReference(
        cataloguedModelica.targetImageReference,
        "$test",
      ),
    );
    assertEquals(
      modelica.imageName === modelica.qualificationTarget.imageReference,
      false,
    );
    assertEquals(
      modelica.imageName.includes(modelica.qualificationTarget.manifestDigest),
      false,
    );
    const geometry = matrix.images.find((image) =>
      image.physicalImageId === "geometry-module-assembler-worker"
    );
    if (!geometry) throw new Error("geometry-module physical image is absent");
    assertEquals(geometry.expectedLabels !== undefined, true);
  },
);

Deno.test("Modelica qualified and admitted share one physical publication", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const matrix = createFirstPartyMicrosandboxImageDistributionMatrix(catalog);
  const modelicaEntries = matrix.images.filter((image) =>
    image.physicalImageId === "modelica-microsandbox-worker"
  );
  assertEquals(modelicaEntries.length, 1);
  assertEquals(modelicaEntries[0]?.logicalTargets.length, 2);
  assertEquals(
    matrix.images.reduce((count, image) => count + image.logicalTargets.length, 0),
    6,
  );
});

Deno.test("distribution matrix rejects incomplete or duplicate physical release entries", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const matrix = createFirstPartyMicrosandboxImageDistributionMatrix(catalog);
  assertThrows(
    () =>
      assertFirstPartyMicrosandboxImageDistributionContract(
        {
          ...matrix,
          schemaVersion: "first-party-microsandbox-image-distribution-matrix/1.0",
        } as unknown as typeof matrix,
      ),
    TypeError,
    "unsupported schema or platform",
  );
  assertThrows(
    () =>
      assertFirstPartyMicrosandboxImageDistributionContract({
        ...matrix,
        images: matrix.images.slice(1),
      }),
    TypeError,
    "exactly 5 physical images",
  );
  assertThrows(
    () =>
      assertFirstPartyMicrosandboxImageDistributionContract({
        ...matrix,
        images: [matrix.images[0]!, matrix.images[0]!, ...matrix.images.slice(2)],
      }),
    TypeError,
    "duplicate physical image ids",
  );
  assertThrows(
    () =>
      assertFirstPartyMicrosandboxImageDistributionContract({
        ...matrix,
        images: matrix.images.map((image, index) =>
          index === 0 ? { ...image, logicalTargets: [] } : image
        ),
      }),
    TypeError,
    "exactly 6 logical targets",
  );
});

Deno.test("divergent recipes for one physical image are refused", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const descriptors = createFirstPartyMicrosandboxImageBootstrapDescriptors(
    catalog,
  );
  const qualified = descriptors.find((descriptor) =>
    descriptor.recipeId === FIRST_PARTY_MODELICA_QUALIFIED_CACHE_RECIPE_ID
  );
  const admitted = descriptors.find((descriptor) =>
    descriptor.recipeId === FIRST_PARTY_MODELICA_ADMITTED_CACHE_RECIPE_ID
  );
  if (!qualified || !admitted) throw new Error("Modelica descriptors are absent");
  assertThrows(
    () =>
      planFirstPartyMicrosandboxImageDistribution([
        qualified,
        {
          ...admitted,
          buildRecipe: {
            ...admitted.buildRecipe,
            dockerfile: "images/ngspice-microsandbox-worker/Dockerfile",
          },
        },
      ]),
    TypeError,
    "divergent build recipes",
  );
});

Deno.test("publication names stay lowercase and refuse mutable aliases", () => {
  assertEquals(
    firstPartyMicrosandboxGhcrPackageName("ngspice-worker"),
    "casys-digital-thread-ngspice-worker",
  );
  assertEquals(
    firstPartyMicrosandboxGhcrImageName("casys-digital-thread-ngspice-worker"),
    "ghcr.io/casys-ai/casys-digital-thread-ngspice-worker",
  );
  assertThrows(
    () => firstPartyMicrosandboxGhcrPackageName("Ngspice-Worker"),
    TypeError,
    "lowercase OCI repository segment",
  );
  assertThrows(
    () => firstPartyMicrosandboxGhcrPackageName("ngspice-worker:latest"),
    TypeError,
    "lowercase OCI repository segment",
  );
  assertThrows(
    () => firstPartyMicrosandboxGhcrImageName("Casys-Digital-Thread-ngspice-worker"),
    TypeError,
    "lowercase",
  );
  assertThrows(
    () =>
      firstPartyMicrosandboxGhcrImageName("casys-digital-thread-ngspice-worker:latest"),
    TypeError,
    "digest pins, tags, or latest aliases",
  );
});

Deno.test(
  "candidate publication stays distinct from acquisition source and runtime digest",
  async () => {
    const catalog = await createFirstPartyCapabilityRuntimeCatalog();
    const descriptors = createFirstPartyMicrosandboxImageBootstrapDescriptors(
      catalog,
    );
    const ngspice = descriptors.find((descriptor) =>
      descriptor.recipeId === FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID
    );
    if (!ngspice || ngspice.source.kind !== "trusted-dockerfile") {
      throw new Error("ngspice trusted Dockerfile descriptor is absent");
    }
    const ociSource: FirstPartyOciDigestSource = {
      kind: "oci-digest",
      reference: ngspice.targetImageReference,
    };
    const acquiredByDigest: FirstPartyMicrosandboxImageBootstrapDescriptor = {
      ...ngspice,
      source: ociSource,
    };
    const matrix = planFirstPartyMicrosandboxImageDistribution(
      descriptors.map((descriptor) =>
        descriptor.recipeId === FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID
          ? acquiredByDigest
          : descriptor
      ),
    );
    const image = matrix.images.find((candidate) =>
      candidate.physicalImageId === "ngspice-worker"
    );
    if (!image) throw new Error("planned image is absent");
    assertEquals(image.physicalImageId, "ngspice-worker");
    assertEquals(image.dockerfile, ngspice.buildRecipe.dockerfile);
    assertEquals(image.context, ngspice.buildRecipe.context);
    assertEquals(image.expectedUser, ngspice.buildRecipe.user);
    assertEquals(
      image.imageName,
      "ghcr.io/casys-ai/casys-digital-thread-ngspice-worker",
    );
    assertEquals(image.imageName === ngspice.targetImageReference, false);
    assertEquals(image.imageName === ociSource.reference, false);
    if (ngspice.source.kind !== "trusted-dockerfile") {
      throw new Error("ngspice source must remain a trusted Dockerfile in the catalog");
    }
    assertEquals(image.imageName === ngspice.source.dockerImageName, false);
    assertEquals(image.imageName === ngspice.source.dockerSourceReference, false);
    assertEquals(
      image.qualificationTarget.imageReference,
      ngspice.targetImageReference,
    );
    assertEquals(
      image.qualificationTarget.manifestDigest,
      ngspice.target.manifestDigest,
    );
  },
);
