import { assertEquals, assertRejects } from "@std/assert";
import {
  capabilityRuntimeLaunchProfileReference,
  fingerprintCapabilityRuntimeComposeContent,
  validateCapabilityRuntimeLaunchProfile,
} from "./capability-runtime-host.ts";
import { deterministicJson } from "../../kernel/deterministic-json.ts";
import {
  type CapabilityRuntimeJournalEntry,
  recoverCapabilityRuntime,
} from "./capability-runtime-supervision.ts";
import { FixedCapabilityRuntimeLaunchProfileRegistry } from "../../../application/control-plane/capability-runtime-launch-profile-registry.ts";
import {
  FAKE_CAPABILITY_RUNTIME_MATERIAL,
  fakeCapabilityRuntimeLaunchProfile,
} from "../../../testing/capability-runtime-host-fixture.ts";

Deno.test("launch profiles reject body tampering and registry references require the exact fingerprint", async () => {
  const profile = await fakeCapabilityRuntimeLaunchProfile();
  const tampered = structuredClone(profile);
  (tampered.material as { materialId: string }).materialId = "other-material";
  await assertRejects(
    () => validateCapabilityRuntimeLaunchProfile(tampered),
    TypeError,
    "does not match the canonical launch-profile body",
  );

  const registry = new FixedCapabilityRuntimeLaunchProfileRegistry([profile]);
  const badReference = structuredClone(
    capabilityRuntimeLaunchProfileReference(profile),
  );
  (badReference.fingerprint as { digest: string }).digest = "0".repeat(64);
  await assertRejects(
    () => registry.require(badReference),
    TypeError,
    "0 exact matches",
  );
});

Deno.test("launch profiles seal exact Compose UTF-8 bytes independently from their profile fingerprint", async () => {
  const profile = await fakeCapabilityRuntimeLaunchProfile();
  const tampered = structuredClone(profile);
  (tampered.compose.fingerprint as { digest: string }).digest = "0".repeat(64);

  await assertRejects(
    () => validateCapabilityRuntimeLaunchProfile(tampered),
    TypeError,
    "exact UTF-8 Compose bytes",
  );
});

Deno.test("sealed Compose descriptors reject interpolation and external file directives", async () => {
  const profile = await fakeCapabilityRuntimeLaunchProfile();
  const labels = Object.fromEntries(
    profile.ownership.labels.map((label) => [label.key, label.value]),
  );
  const external = deterministicJson({
    services: {
      [profile.acquisition.serviceName]: {
        image: profile.acquisition.imageReference,
        labels,
        env_file: "attacker.env",
      },
    },
  });
  const externalFingerprint = await fingerprintCapabilityRuntimeComposeContent(
    external,
  );
  await assertRejects(
    () =>
      fakeCapabilityRuntimeLaunchProfile({
        compose: {
          schemaVersion: "capability-runtime-compose-descriptor/1.0",
          content: external,
          fingerprint: externalFingerprint,
        },
      }),
    TypeError,
    "forbidden external Compose directive",
  );

  const interpolated = profile.compose.content.replace(
    profile.acquisition.imageReference,
    "${IMAGE}",
  );
  const interpolatedFingerprint = await fingerprintCapabilityRuntimeComposeContent(
    interpolated,
  );
  await assertRejects(
    () =>
      fakeCapabilityRuntimeLaunchProfile({
        compose: {
          schemaVersion: "capability-runtime-compose-descriptor/1.0",
          content: interpolated,
          fingerprint: interpolatedFingerprint,
        },
      }),
    TypeError,
    "must not contain Compose interpolation",
  );
});

Deno.test("recovery degrades a crash-pending host intent and never replays it", async () => {
  const profile = await fakeCapabilityRuntimeLaunchProfile();
  const entry: CapabilityRuntimeJournalEntry = {
    id: "host-runtime:pending",
    action: "runtime-start",
    material: FAKE_CAPABILITY_RUNTIME_MATERIAL,
    launchProfile: capabilityRuntimeLaunchProfileReference(profile),
    projectId: "project:unrelated",
    plannedAt: "2026-08-29T00:00:00.000Z",
    previousObservation: {
      material: "installed",
      runtime: "inactive",
      qualification: "qualified",
    },
    administrativeRemovalPlanFingerprint: null,
  };
  const recovered = recoverCapabilityRuntime([
    {
      material: FAKE_CAPABILITY_RUNTIME_MATERIAL,
      state: { material: "installed", runtime: "active", qualification: "qualified" },
    },
  ], [entry]);

  assertEquals(recovered.pendingJournalEntries.map((pending) => pending.id), [
    entry.id,
  ]);
  assertEquals(recovered.observations[0]?.state.runtime, "degraded");
});

Deno.test("launch retention has no deletion state for container, image, or volume", async () => {
  const profile = await fakeCapabilityRuntimeLaunchProfile();
  const tampered = structuredClone(profile);
  (tampered.retention as { volumes: string }).volumes = "delete";
  await assertRejects(
    () => validateCapabilityRuntimeLaunchProfile(tampered),
    TypeError,
    'must equal "preserve"',
  );
});
