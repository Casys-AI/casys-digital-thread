import { assertEquals, assertRejects } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import { loadFleetManifest } from "./manifest.ts";
import {
  inspectBehaveFoundationCensus,
  loadWorkspaceBehaveFoundationCensus,
} from "./behave-foundation-census.ts";

const sha = (character: string) => character.repeat(64);

Deno.test("workspace Behave census selects the exact mandatory graph and attaches reviewed inputs", async () => {
  const census = await loadWorkspaceBehaveFoundationCensus({
    calculix: calculixProfile(),
  });

  assertEquals(census.mutatesRuntime, false);
  assertEquals(census.evidenceLevel, "declared");
  assertEquals(census.verticalQualification, "not-observed");
  assertEquals(census.productionEligible, false);
  assertEquals(
    census.status,
    census.blockers.length === 0 ? "candidate-ready" : "blocked",
  );
  assertEquals(census.candidateManifest !== null, census.blockers.length === 0);
  assertEquals(census.materials.map((material) => material.id), [
    "syson-db",
    "syson-app",
    "mcp-syson",
    "mcp-build123d-sandbox",
    "calculix-worker",
  ]);
  assertEquals(
    census.materials.every((material) => material.platforms.includes("linux/arm64")),
    true,
  );
  assertEquals(census.reviewEvidence.licences !== null, true);
  assertEquals(census.reviewEvidence.volumes !== null, true);
  assertEquals(census.reviewEvidence.security !== null, true);
  assertEquals(census.hostPrerequisites, [
    {
      id: "docker-compose-local",
      version: null,
      requiredByMaterialIds: [
        "syson-db",
        "syson-app",
        "mcp-syson",
        "mcp-build123d-sandbox",
      ],
      installableByPack: false,
    },
    {
      id: "microsandbox-local",
      version: "0.6.8",
      requiredByMaterialIds: ["calculix-worker"],
      installableByPack: false,
    },
  ]);
  assertEquals(
    census.excludedRuntimes.some((runtime) => runtime.id === "mcp-calculix"),
    true,
  );
  assertEquals(
    census.materials.map((material) => [
      material.id,
      material.packRole.fleetRequired,
      material.packRole.memberOfPack,
      material.packRole.requiredForOperation,
      material.packRole.qualifiedForPack,
    ]),
    [
      ["syson-db", null, true, false, false],
      ["syson-app", null, true, false, false],
      ["mcp-syson", true, true, true, false],
      ["mcp-build123d-sandbox", false, true, true, false],
      ["calculix-worker", null, true, true, false],
    ],
  );
});

Deno.test("reviewed pinned census renders a strict candidate manifest", async () => {
  const [fleet, composeSource] = await Promise.all([
    loadFleetManifest("config/mcp-fleet.json"),
    Deno.readTextFile("docker-compose.yml"),
  ]);
  const compose = cloneRecord(parseYaml(composeSource));
  const services = record(compose.services);
  record(services["syson-db"]).image = `example.invalid/casys/postgres@sha256:${
    sha("1")
  }`;
  const sysonApp = record(services["syson-app"]);
  sysonApp.image = `example.invalid/casys/syson@sha256:${sha("2")}`;
  delete sysonApp.build;
  const materialIds = [
    "syson-db",
    "syson-app",
    "mcp-syson",
    "mcp-build123d-sandbox",
    "calculix-worker",
  ];
  const platformsByMaterialId = Object.fromEntries(
    materialIds.map((id) => [id, ["linux/amd64", "linux/arm64"]] as const),
  );

  const census = inspectBehaveFoundationCensus({
    fleet,
    compose,
    calculix: calculixProfile(),
    platformsByMaterialId,
    reviewEvidence: {
      licences: fingerprint("a"),
      volumes: fingerprint("b"),
      security: fingerprint("c"),
    },
  });

  assertEquals(census.status, "candidate-ready");
  assertEquals(census.blockers, []);
  assertEquals(census.productionEligible, false);
  assertEquals(
    census.candidateManifest?.schemaVersion,
    "capability-pack-candidate/0.1",
  );
  assertEquals(
    census.candidateManifest?.bindingClaims.map((claim) => claim.capability.id),
    [
      "model.author-system",
      "model.evaluate-requirement",
      "geometry.export-admitted-source",
      "mechanics.solve-static-structural",
    ],
  );
});

Deno.test("census reports public exposure and fleet/Compose image drift", async () => {
  const [fleet, composeSource] = await Promise.all([
    loadFleetManifest("config/mcp-fleet.json"),
    Deno.readTextFile("docker-compose.yml"),
  ]);
  const compose = cloneRecord(parseYaml(composeSource));
  const services = record(compose.services);
  const syson = record(services["mcp-syson"]);
  syson.ports = ["0.0.0.0:3009:3009"];
  syson.image = `example.invalid/casys/drift@sha256:${sha("d")}`;

  const census = inspectBehaveFoundationCensus({
    fleet,
    compose,
    calculix: calculixProfile(),
  });

  assertEquals(
    census.blockers.some((blocker) =>
      blocker.code === "runtime.public-exposure" && blocker.subject === "mcp-syson"
    ),
    true,
  );
  assertEquals(
    census.blockers.some((blocker) =>
      blocker.code === "runtime.fleet-compose-image-drift" &&
      blocker.subject === "mcp-syson"
    ),
    true,
  );
});

Deno.test("workspace census loader reports malformed Compose YAML", async () => {
  await assertRejects(
    () =>
      loadWorkspaceBehaveFoundationCensus({
        calculix: calculixProfile(),
        reviewPath: null,
        readTextFile: (path) =>
          path.endsWith("mcp-fleet.json")
            ? Deno.readTextFile(path)
            : Promise.resolve("services: ["),
      }),
    TypeError,
    "Invalid YAML",
  );
});

function calculixProfile() {
  return {
    imageReference: `example.invalid/casys/calculix-worker@sha256:${sha("5")}`,
    policyFingerprint: fingerprint("f"),
  } as const;
}

function fingerprint(character: string) {
  return { algorithm: "sha256" as const, digest: sha(character) };
}

function cloneRecord(value: unknown): Record<string, unknown> {
  return structuredClone(record(value));
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("fixture value must be an object");
  }
  return value as Record<string, unknown>;
}
