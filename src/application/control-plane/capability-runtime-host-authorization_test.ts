import { assertEquals } from "@std/assert";
import {
  capabilityRuntimeLaunchGroupReference,
} from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import {
  type CapabilityRuntimeJournalEntry,
  createCapabilityRuntimeAdministrativeRemovalPlan,
  createEffectiveCapabilityRuntimeLaunchProjection,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import {
  InMemoryCapabilityRuntimeJournal,
} from "../../adapters/control-plane/in-memory-capability-runtime-supervisor.ts";
import {
  createFirstPartyCapabilityRuntimeLaunchGroups,
} from "../../adapters/control-plane/first-party-capability-runtime-launch-groups.ts";
import {
  authorizeDurableAdministrativeMaterialRemoval,
  authorizeDurableMaterialAcquire,
  authorizeDurableNormalRuntimeStart,
  authorizeDurableRuntimeStop,
  consumeAuthorizedAdministrativeMaterialRemoval,
  consumeAuthorizedMaterialAcquire,
  consumeAuthorizedNormalRuntimeStart,
  consumeAuthorizedRuntimeStop,
} from "./capability-runtime-host-authorization.ts";

Deno.test("host mutation brands are action-specific and one-shot", async () => {
  const [group] = await createFirstPartyCapabilityRuntimeLaunchGroups();
  if (!group) throw new Error("Expected a first-party launch group.");
  const journal = new InMemoryCapabilityRuntimeJournal();
  const removalPlan = await createCapabilityRuntimeAdministrativeRemovalPlan({
    launchGroup: capabilityRuntimeLaunchGroupReference(group),
    ownedMaterials: group.materials.map((member) => member.material),
    observedMaterials: group.materials.map((member) => ({
      material: member.material,
      state: "owned" as const,
    })),
    ownedContainerIds: [],
  });
  const acquire = entry(group, "material-acquire", null);
  const start = entry(group, "runtime-start", await projection(group));
  const stop = entry(group, "runtime-stop", null);
  const remove = entry(group, "material-remove", null, removalPlan.fingerprint);
  await Promise.all([
    journal.appendBeforeMutation(acquire),
    journal.appendBeforeMutation(start),
    journal.appendBeforeMutation(stop),
    journal.appendBeforeMutation(remove),
  ]);

  const acquireBrand = await authorizeDurableMaterialAcquire(acquire, journal);
  assertEquals(consumeAuthorizedNormalRuntimeStart(acquireBrand), undefined);
  assertEquals(consumeAuthorizedMaterialAcquire(acquireBrand)?.id, acquire.id);
  assertEquals(consumeAuthorizedMaterialAcquire(acquireBrand), undefined);

  const startBrand = await authorizeDurableNormalRuntimeStart(start, journal);
  assertEquals(consumeAuthorizedRuntimeStop(startBrand), undefined);
  assertEquals(consumeAuthorizedNormalRuntimeStart(startBrand)?.id, start.id);
  assertEquals(consumeAuthorizedNormalRuntimeStart(startBrand), undefined);

  const stopBrand = await authorizeDurableRuntimeStop(stop, journal);
  assertEquals(consumeAuthorizedAdministrativeMaterialRemoval(stopBrand), undefined);
  assertEquals(consumeAuthorizedRuntimeStop(stopBrand)?.id, stop.id);
  assertEquals(consumeAuthorizedRuntimeStop(stopBrand), undefined);

  const removeBrand = await authorizeDurableAdministrativeMaterialRemoval(
    remove,
    removalPlan,
    journal,
  );
  assertEquals(consumeAuthorizedMaterialAcquire(removeBrand), undefined);
  assertEquals(
    consumeAuthorizedAdministrativeMaterialRemoval(removeBrand)?.id,
    remove.id,
  );
  assertEquals(consumeAuthorizedAdministrativeMaterialRemoval(removeBrand), undefined);
});

function entry(
  group: Awaited<ReturnType<typeof createFirstPartyCapabilityRuntimeLaunchGroups>>[number],
  action: CapabilityRuntimeJournalEntry["action"],
  effectiveRuntimeProjection: CapabilityRuntimeJournalEntry["effectiveRuntimeProjection"],
  administrativeRemovalPlanFingerprint: CapabilityRuntimeJournalEntry[
    "administrativeRemovalPlanFingerprint"
  ] = null,
): CapabilityRuntimeJournalEntry {
  return {
    id: `authorization-${action}`,
    action,
    materials: group.materials.map((member) => member.material),
    launchGroup: capabilityRuntimeLaunchGroupReference(group),
    projectId: action === "material-remove" ? null : "project-test",
    plannedAt: "2026-08-29T00:00:00.000Z",
    previousObservations: group.materials.map((member) => ({
      material: member.material,
      state: null,
    })),
    effectiveRuntimeProjection,
    administrativeRemovalPlanFingerprint,
  };
}

async function projection(
  group: Awaited<ReturnType<typeof createFirstPartyCapabilityRuntimeLaunchGroups>>[number],
) {
  return await createEffectiveCapabilityRuntimeLaunchProjection({
    launchGroup: capabilityRuntimeLaunchGroupReference(group),
    materials: group.materials.map((member) => ({
      material: member.material,
      binding: { id: "test-binding", version: "1" },
      effectiveQualification: "qualified" as const,
      minimumQualification: "qualified" as const,
      runtimeMode: {
        material: member.material,
        targetPlatform: "linux/arm64" as const,
        mode: "native" as const,
        qualificationAttestationFingerprint: null,
      },
    })),
  });
}
