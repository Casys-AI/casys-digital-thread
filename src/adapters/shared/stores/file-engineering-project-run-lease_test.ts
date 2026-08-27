import { assertEquals } from "@std/assert";
import { FileEngineeringProjectRunLease } from "./file-engineering-project-run-lease.ts";

Deno.test("file project-run lease blocks a concurrent holder until release", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-project-run-lease-" });
  try {
    const firstLease = new FileEngineeringProjectRunLease(directory);
    const secondLease = new FileEngineeringProjectRunLease(directory);
    const firstEntered = deferred<void>();
    const releaseFirst = deferred<void>();
    let secondEntered = false;

    const first = firstLease.withLease("project:drone", "run:baseline", async () => {
      firstEntered.resolve();
      await releaseFirst.promise;
      return "first";
    });
    await firstEntered.promise;
    const second = secondLease.withLease("project:drone", "run:baseline", () => {
      secondEntered = true;
      return Promise.resolve("second");
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    assertEquals(secondEntered, false);

    releaseFirst.resolve();
    assertEquals(await first, "first");
    assertEquals(await second, "second");
    assertEquals(secondEntered, true);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("file project-run lease keeps maximum identities in one stable short concurrent lock", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-project-run-lease-" });
  try {
    const projectId = "p".repeat(160);
    const runId = "r".repeat(160);
    const firstLease = new FileEngineeringProjectRunLease(directory);
    const secondLease = new FileEngineeringProjectRunLease(directory);
    const firstEntered = deferred<void>();
    const releaseFirst = deferred<void>();
    let secondEntered = false;

    const first = firstLease.withLease(projectId, runId, async () => {
      firstEntered.resolve();
      await releaseFirst.promise;
    });
    await firstEntered.promise;
    const second = secondLease.withLease(projectId, runId, () => {
      secondEntered = true;
      return Promise.resolve();
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    assertEquals(secondEntered, false);
    const entries = [...(await Array.fromAsync(Deno.readDir(directory)))];
    assertEquals(entries.length, 1);
    assertEquals(entries[0]!.name.length, 69);

    releaseFirst.resolve();
    await first;
    await second;
    assertEquals(secondEntered, true);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
