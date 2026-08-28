import { assertEquals, assertThrows } from "@std/assert";
import { validateCapabilityPackManifest } from "../../adapters/control-plane/capability-pack-manifest.ts";
import { syntheticBehaveFoundationPack } from "../../testing/capability-pack-fixture.ts";
import type { CapabilityPackPlanningHost } from "./read-model/capability-pack.ts";
import { planCapabilityPackInstallation } from "./plan-capability-pack-installation.ts";

Deno.test("installation plan is read-only, dependency ordered and counts only missing images", () => {
  const pack = validateCapabilityPackManifest(syntheticBehaveFoundationPack());
  const existing = pack.materials.find((material) => material.id === "mcp-syson")!;
  const host: CapabilityPackPlanningHost = {
    platform: "linux/arm64",
    images: [{ reference: existing.image, sizeBytes: 300 }],
  };
  const packBefore = structuredClone(pack);
  const hostBefore = structuredClone(host);

  const plan = planCapabilityPackInstallation(pack, host);

  assertEquals(plan.mutatesRuntime, false);
  assertEquals(plan.status, "changes-required");
  assertEquals(plan.materials.map((material) => material.id), [
    "syson-db",
    "syson-app",
    "mcp-syson",
    "mcp-build123d-sandbox",
    "calculix-worker",
  ]);
  assertEquals(
    plan.images.find((image) => image.reference === existing.image)?.action,
    "reuse",
  );
  assertEquals(plan.estimatedAdditionalBytes, 1_200);
  assertEquals(plan.blockers, []);
  assertEquals(pack, packBefore);
  assertEquals(host, hostBefore);
});

Deno.test("installation plan deduplicates one exact image shared by several materials", () => {
  const raw = record(syntheticBehaveFoundationPack());
  const materials = array(raw.materials);
  const syson = record(materials[2]);
  const build123d = record(materials[3]);
  build123d.image = syson.image;
  build123d.estimatedBytes = syson.estimatedBytes;
  const pack = validateCapabilityPackManifest(raw);

  const plan = planCapabilityPackInstallation(pack, {
    platform: "linux/amd64",
    images: [],
  });

  assertEquals(plan.images.length, 4);
  const shared = plan.images.find((image) => image.reference === syson.image);
  assertEquals(shared?.materialIds, ["mcp-syson", "mcp-build123d-sandbox"]);
  assertEquals(shared?.estimatedAdditionalBytes, 300);
  assertEquals(plan.estimatedAdditionalBytes, 1_100);
});

Deno.test("installation plan blocks an unsupported host without hiding required acquisition", () => {
  const raw = record(syntheticBehaveFoundationPack());
  record(array(raw.materials)[4]).platforms = ["linux/amd64"];
  const pack = validateCapabilityPackManifest(raw);

  const plan = planCapabilityPackInstallation(pack, {
    platform: "linux/arm64",
    images: [],
  });

  assertEquals(plan.status, "blocked");
  assertEquals(plan.materials.at(-1)?.platformSupported, false);
  assertEquals(plan.blockers, [
    "Material calculix-worker does not support host platform linux/arm64.",
  ]);
  assertEquals(plan.images.every((image) => image.action === "acquire"), true);
});

Deno.test("installation plan keeps total bytes unknown when a missing estimate is unknown", () => {
  const raw = record(syntheticBehaveFoundationPack());
  delete record(array(raw.materials)[0]).estimatedBytes;
  const pack = validateCapabilityPackManifest(raw);

  const plan = planCapabilityPackInstallation(pack, {
    platform: "linux/amd64",
    images: [],
  });

  assertEquals(plan.estimatedAdditionalBytes, null);
  assertEquals(plan.unknownSizeImageReferences, [pack.materials[0]!.image]);
});

Deno.test("installation plan is ready when every exact image is already present", () => {
  const pack = validateCapabilityPackManifest(syntheticBehaveFoundationPack());
  const host: CapabilityPackPlanningHost = {
    platform: "linux/amd64",
    images: pack.materials.map((material) => ({ reference: material.image })),
  };

  const plan = planCapabilityPackInstallation(pack, host);

  assertEquals(plan.status, "ready");
  assertEquals(plan.estimatedAdditionalBytes, 0);
  assertEquals(plan.images.every((image) => image.action === "reuse"), true);
});

Deno.test("installation plan refuses mutable or contradictory host image observations", () => {
  const pack = validateCapabilityPackManifest(syntheticBehaveFoundationPack());
  assertThrows(
    () =>
      planCapabilityPackInstallation(pack, {
        platform: "linux/amd64",
        images: [{ reference: "postgres:latest" }],
      }),
    TypeError,
    "must be one OCI image name pinned",
  );

  assertThrows(
    () =>
      planCapabilityPackInstallation(pack, {
        platform: "linux/amd64",
        images: [
          { reference: pack.materials[0]!.image, sizeBytes: 10 },
          { reference: pack.materials[0]!.image, sizeBytes: 11 },
        ],
      }),
    TypeError,
    "conflicting observed sizes",
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
