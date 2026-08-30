import { assertEquals } from "@std/assert";
import { FixedAdmittedSpiceExecutionProfileCatalog } from "../electrical/spice/admitted/execution-profile-catalog.ts";
import {
  LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE,
} from "../electrical/spice/admitted/local-image-references.ts";
import { createFirstPartyCapabilityRuntimeCatalog } from "./first-party-capability-binding-catalog.ts";
import { FileCapabilityRuntimeCachePreparationJournal } from "./file-capability-runtime-cache-preparation-journal.ts";
import {
  createLocalCapabilityRuntimeCachePreparationComposition,
} from "./local-capability-runtime-cache-preparation-composition.ts";
import type {
  CapabilityRuntimeCachePreparationRequestedMaterial,
} from "../../domain/capability/runtime/capability-runtime-cache-preparation.ts";

const FINGERPRINT = { algorithm: "sha256" as const, digest: "a".repeat(64) };
const NOW = "2026-08-31T00:00:00.000Z";

Deno.test("local cache-preparation composition journals atomic SPICE cache work under the supplied host lock", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-cache-composition-" });
  try {
    let lockCalls = 0;
    let sourceObservations = 0;
    let runtimeObservations = 0;
    let runtimeAcquisitions = 0;
    let runtimeExact = false;
    const journal = new FileCapabilityRuntimeCachePreparationJournal(directory);
    const composition = await createLocalCapabilityRuntimeCachePreparationComposition({
      catalog: await createFirstPartyCapabilityRuntimeCatalog(),
      admittedSpiceRuntimeProfile: await admittedSpiceRuntimeProfile(),
      lock: {
        withLock: async <T>(operation: () => Promise<T>): Promise<T> => {
          lockCalls++;
          return await operation();
        },
      },
      journal,
      actions: {
        observeSource: () => {
          sourceObservations++;
          return Promise.resolve(true);
        },
        observeRuntime: () => {
          runtimeObservations++;
          return Promise.resolve(runtimeExact);
        },
        acquireRuntime: () => {
          runtimeAcquisitions++;
          runtimeExact = true;
          return Promise.resolve();
        },
      },
      now: () => NOW,
    });

    assertEquals(
      (await composition.cachePreparer.prepare({
        projectId: "project:cache-preload",
        materials: requested(composition.recipes),
        guard: () => Promise.resolve(true),
      })).map((result) => result.status),
      ["observed", "observed"],
    );
    assertEquals(lockCalls, 1);
    assertEquals(sourceObservations, 1);
    assertEquals(runtimeObservations, 2);
    assertEquals(runtimeAcquisitions, 1);
    assertEquals(
      (await journal.list()).map((attempt) => ({
        materialId: attempt.intent.scope.materials[0]?.material.materialId,
        terminal: attempt.terminal?.schemaVersion,
      })),
      [
        {
          materialId: "ngspice-docker-source-image",
          terminal: "capability-runtime-cache-preparation-observed/1.0",
        },
        {
          materialId: "ngspice-runtime-image",
          terminal: "capability-runtime-cache-preparation-observed/1.0",
        },
      ],
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("local cache-preparation composition uses its durable file journal by default", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-cache-composition-" });
  try {
    const composition = await createLocalCapabilityRuntimeCachePreparationComposition({
      catalog: await createFirstPartyCapabilityRuntimeCatalog(),
      admittedSpiceRuntimeProfile: await admittedSpiceRuntimeProfile(),
      lock: { withLock: <T>(operation: () => Promise<T>) => operation() },
      journalDirectory: directory,
      actions: {
        observeSource: () => Promise.resolve(false),
        observeRuntime: () => Promise.resolve(false),
        acquireRuntime: () => Promise.resolve(),
      },
    });

    assertEquals(
      composition.journal instanceof FileCapabilityRuntimeCachePreparationJournal,
      true,
    );
    assertEquals(await composition.journal.list(), []);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

async function admittedSpiceRuntimeProfile() {
  return await new FixedAdmittedSpiceExecutionProfileCatalog({
    imageReference: LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE,
    policy: {
      id: "spice-cache-composition-test-policy",
      version: "1.0.0",
      fingerprint: FINGERPRINT,
    },
    limits: {
      maxWallTimeMs: 30_000,
      maxCpuTimeMs: 25_000,
      maxMemoryBytes: 512 * 1_048_576,
      maxProcesses: 16,
      maxStdoutBytes: 65_536,
      maxStderrBytes: 65_536,
      maxOutputFileBytes: 262_144,
      maxOutputTotalBytes: 524_288,
    },
  }).initial();
}

function requested(
  recipes: readonly {
    readonly scope: {
      readonly materials: readonly {
        readonly material:
          CapabilityRuntimeCachePreparationRequestedMaterial["material"];
        readonly imageReference: string;
        readonly lifecycle: "ephemeral" | "cache";
      }[];
    };
  }[],
): readonly CapabilityRuntimeCachePreparationRequestedMaterial[] {
  return recipes.flatMap((recipe) =>
    recipe.scope.materials.map((material) => ({
      material: material.material,
      imageReference: material.imageReference,
      lifecycle: material.lifecycle,
    }))
  ).toSorted((left, right) =>
    `${left.material.unitId}\u0000${left.material.materialId}`.localeCompare(
      `${right.material.unitId}\u0000${right.material.materialId}`,
    )
  );
}
