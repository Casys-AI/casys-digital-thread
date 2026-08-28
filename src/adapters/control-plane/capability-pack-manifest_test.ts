import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import {
  emptyCapabilityInstallationLock,
  syntheticBehaveFoundationPack,
} from "../../testing/capability-pack-fixture.ts";
import {
  CapabilityPackContractError,
  loadCapabilityPackManifest,
  validateCapabilityInstallationLock,
  validateCapabilityPackManifest,
} from "./capability-pack-manifest.ts";

Deno.test("capability pack parser accepts and freezes the synthetic Behave foundation", () => {
  const manifest = validateCapabilityPackManifest(
    syntheticBehaveFoundationPack(),
  );

  assertEquals(manifest.schemaVersion, "capability-pack-candidate/0.1");
  assertEquals(manifest.id, "test.casys.behave-foundation");
  assertEquals(manifest.materials.map((material) => material.id), [
    "syson-db",
    "syson-app",
    "mcp-syson",
    "mcp-build123d-sandbox",
    "calculix-worker",
  ]);
  assertEquals(Object.isFrozen(manifest), true);
  assertEquals(Object.isFrozen(manifest.materials[0]), true);
});

Deno.test("capability pack loader reports file and JSON failures", async () => {
  const missing = await assertRejects(
    () =>
      loadCapabilityPackManifest("missing.json", {
        readTextFile: () => Promise.reject(new Error("not found")),
      }),
    CapabilityPackContractError,
  );
  assertStringIncludes(missing.message, "missing.json");
  assertStringIncludes(missing.message, "not found");

  const malformed = await assertRejects(
    () =>
      loadCapabilityPackManifest("broken.json", {
        readTextFile: () => Promise.resolve("{"),
      }),
    CapabilityPackContractError,
  );
  assertStringIncludes(malformed.message, "Invalid JSON");
});

Deno.test("capability pack parser rejects unknown fields and mutable image references", () => {
  const withUnknown = record(syntheticBehaveFoundationPack());
  withUnknown.command = ["docker", "run"];
  assertThrows(
    () => validateCapabilityPackManifest(withUnknown),
    CapabilityPackContractError,
    "$pack has unsupported field command",
  );

  const withTag = record(syntheticBehaveFoundationPack());
  const materials = array(withTag.materials);
  record(materials[0]).image = "postgres:latest";
  assertThrows(
    () => validateCapabilityPackManifest(withTag),
    CapabilityPackContractError,
    "must be one OCI image name pinned",
  );
});

Deno.test("capability pack parser rejects public exposure and mutable capability aliases", () => {
  const publicPack = record(syntheticBehaveFoundationPack());
  record(array(publicPack.materials)[0]).exposure = "public";
  assertThrows(
    () => validateCapabilityPackManifest(publicPack),
    CapabilityPackContractError,
    "must be one of: internal, loopback-only",
  );

  const aliased = record(syntheticBehaveFoundationPack());
  const firstClaim = record(array(aliased.bindingClaims)[0]);
  record(firstClaim.capability).version = "latest";
  assertThrows(
    () => validateCapabilityPackManifest(aliased),
    CapabilityPackContractError,
    "must not be a mutable version alias",
  );
});

Deno.test("capability pack parser accepts exact SemVer and rejects ambiguous separators", () => {
  const exact = record(syntheticBehaveFoundationPack());
  exact.version = "1.2.3-rc.1+build.7";
  assertEquals(validateCapabilityPackManifest(exact).version, exact.version);

  const ambiguous = record(syntheticBehaveFoundationPack());
  ambiguous.version = "1.2.3+one+two";
  assertThrows(
    () => validateCapabilityPackManifest(ambiguous),
    CapabilityPackContractError,
    "at most one build separator",
  );
});

Deno.test("capability pack parser rejects dangling, cyclic and orphan runtime material", () => {
  const dangling = record(syntheticBehaveFoundationPack());
  record(array(dangling.materials)[1]).dependsOn = ["missing"];
  assertThrows(
    () => validateCapabilityPackManifest(dangling),
    CapabilityPackContractError,
    "references unknown material missing",
  );

  const cyclic = record(syntheticBehaveFoundationPack());
  record(array(cyclic.materials)[0]).dependsOn = ["syson-app"];
  assertThrows(
    () => validateCapabilityPackManifest(cyclic),
    CapabilityPackContractError,
    "dependency cycle",
  );

  const orphan = record(syntheticBehaveFoundationPack());
  const claims = array(orphan.bindingClaims);
  const build123dClaim = claims.find((claim) =>
    record(claim).id === "test.binding.build123d-export"
  );
  record(build123dClaim).materialIds = ["mcp-syson"];
  assertThrows(
    () => validateCapabilityPackManifest(orphan),
    CapabilityPackContractError,
    "unreferenced material mcp-build123d-sandbox",
  );
});

Deno.test("capability pack parser keeps the fixed deny-all Microsandbox identity", () => {
  const manifest = record(syntheticBehaveFoundationPack());
  const worker = record(array(manifest.materials)[4]);
  worker.runner = { ...record(worker.runner), network: "host" };
  assertThrows(
    () => validateCapabilityPackManifest(manifest),
    CapabilityPackContractError,
    '$pack.materials[4].runner.network must equal "none"',
  );
});

Deno.test("installation lock is strict host state with server-owned binding selection", () => {
  const lock = record(emptyCapabilityInstallationLock());
  lock.packs = [
    {
      id: "casys.behave-foundation",
      version: "1.0.0",
      manifest: { algorithm: "sha256", digest: "a".repeat(64) },
      activation: "inactive",
      policy: {
        trust: "first-party-only",
        minimumQualification: "qualified",
        bindingMode: "server-policy",
      },
      secretSlots: [],
      routes: [{ materialId: "mcp-syson", port: 3009 }],
    },
  ];

  const parsed = validateCapabilityInstallationLock(lock);
  assertEquals(parsed.packs[0]?.activation, "inactive");
  assertEquals(parsed.packs[0]?.policy.bindingMode, "server-policy");
  assertEquals(Object.isFrozen(parsed), true);
});

Deno.test("installation lock rejects secret values and ambiguous loopback routes", () => {
  const secret = record(emptyCapabilityInstallationLock());
  secret.secretValues = { token: "forbidden" };
  assertThrows(
    () => validateCapabilityInstallationLock(secret),
    CapabilityPackContractError,
    "$lock has unsupported field secretValues",
  );

  const duplicate = record(emptyCapabilityInstallationLock());
  duplicate.packs = [
    {
      id: "casys.behave-foundation",
      version: "1.0.0",
      manifest: { algorithm: "sha256", digest: "b".repeat(64) },
      activation: "active",
      policy: {
        trust: "first-party-only",
        minimumQualification: "qualified",
        bindingMode: "server-policy",
      },
      secretSlots: [],
      routes: [
        { materialId: "mcp-syson", port: 3009 },
        { materialId: "mcp-build123d-sandbox", port: 3009 },
      ],
    },
  ];
  assertThrows(
    () => validateCapabilityInstallationLock(duplicate),
    CapabilityPackContractError,
    "routes[].port must not contain duplicates",
  );
});

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("fixture value must be an object");
  }
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new TypeError("fixture value must be an array");
  return value;
}
