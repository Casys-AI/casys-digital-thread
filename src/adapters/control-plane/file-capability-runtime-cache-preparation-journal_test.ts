import { assertEquals, assertRejects } from "@std/assert";
import {
  createCapabilityRuntimeCachePreparationIntent,
  createCapabilityRuntimeCachePreparationObserved,
  createCapabilityRuntimeCachePreparationRecipe,
} from "../../domain/capability/runtime/capability-runtime-cache-preparation.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import {
  DEFAULT_CAPABILITY_RUNTIME_MICROVM_PREPARATION_DIRECTORY,
  FileCapabilityRuntimeCachePreparationJournal,
} from "./file-capability-runtime-cache-preparation-journal.ts";

Deno.test("microVM preparation journal has one clean-break default root", () => {
  assertEquals(
    DEFAULT_CAPABILITY_RUNTIME_MICROVM_PREPARATION_DIRECTORY,
    "state/local/capability-runtime-microvm-preparation",
  );
});

Deno.test("file cache preparation journal is append-only and reconstructs an exact observed scope", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-cache-preparation-" });
  try {
    const journal = new FileCapabilityRuntimeCachePreparationJournal(directory);
    const intent = await fixtureIntent();
    await journal.appendIntent(intent);
    await journal.appendIntent(intent);
    const observed = await createCapabilityRuntimeCachePreparationObserved({
      intent,
      observedAt: "2026-08-31T00:00:01.000Z",
    });
    await journal.appendTerminal(observed);
    assertEquals(
      (await new FileCapabilityRuntimeCachePreparationJournal(directory).read(
        intent.id,
      ))
        ?.terminal,
      observed,
    );
    await assertRejects(
      () =>
        journal.appendTerminal({ ...observed, observedAt: "2026-08-31T00:00:02.000Z" }),
      Error,
      "already exists with different content",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("file cache preparation journal refuses a symlinked storage root", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-cache-preparation-link-" });
  const target = await Deno.makeTempDir({ prefix: "casys-cache-preparation-target-" });
  const link = `${directory}/journal`;
  try {
    await Deno.symlink(target, link, { type: "dir" });
    const journal = new FileCapabilityRuntimeCachePreparationJournal(link);
    const intent = await fixtureIntent();
    await assertRejects(
      () => journal.appendIntent(intent),
      Error,
      "must be real directories",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
    await Deno.remove(target, { recursive: true });
  }
});

Deno.test("file cache preparation journal rejects a symlink swap during an idempotent append", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-cache-preparation-entry-",
  });
  try {
    const journal = new FileCapabilityRuntimeCachePreparationJournal(directory);
    const intent = await fixtureIntent();
    await journal.appendIntent(intent);
    const key = (await sha256Fingerprint({ id: intent.id })).digest;
    const target = `${directory}/outside.json`;
    const record = `${directory}/intents/${key}.json`;
    await Deno.writeTextFile(target, "{}\n");
    await Deno.remove(record);
    await Deno.symlink(target, record, { type: "file" });
    await assertRejects(
      () => journal.appendIntent(intent),
      Error,
      "record must be one regular file",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

async function fixtureIntent() {
  const recipe = await createCapabilityRuntimeCachePreparationRecipe({
    schemaVersion: "capability-runtime-cache-preparation-recipe/1.0",
    id: "cache.recipe.file-test",
    version: "1.0.0",
    scope: {
      materials: [{
        material: {
          unitId: "casys.cache-source",
          materialId: "source-image",
          imageDigest: "a".repeat(64),
        },
        imageReference: `example.test/cache-source@sha256:${"a".repeat(64)}`,
        lifecycle: "cache",
        profile: {
          id: "profile.cache-source",
          version: "1.0.0",
          fingerprint: { algorithm: "sha256" as const, digest: "b".repeat(64) },
        },
      }],
    },
  });
  return await createCapabilityRuntimeCachePreparationIntent({
    projectId: "project:cache-preload",
    recipe,
    generation: 1,
    predecessor: null,
    plannedAt: "2026-08-31T00:00:00.000Z",
  });
}
