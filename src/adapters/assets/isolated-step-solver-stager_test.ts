import { assertEquals, assertRejects } from "@std/assert";
import { fingerprintResourceBytes } from "../../domain/compile/source/provider-resource-reader.ts";
import { IsolatedStepSolverStager } from "./isolated-step-solver-stager.ts";

Deno.test("isolated STEP cache rereads the exact published bytes", async () => {
  const directory = await Deno.makeTempDir({ prefix: "sensitivity-step-" });
  try {
    const bytes = new TextEncoder().encode("STEP-BASE");
    const digest = await fingerprintResourceBytes(bytes);
    const files = new Map<string, Uint8Array>();
    const stager = new IsolatedStepSolverStager(
      directory,
      {
        stage: (input: { readonly containerFileName: string }) =>
          Promise.resolve({ containerPath: `/inputs/${input.containerFileName}` }),
      } as never,
      (path, written) => {
        files.set(path, written);
        return Promise.resolve();
      },
      (path) => {
        const found = files.get(path);
        if (!found) return Promise.reject(new Deno.errors.NotFound(path));
        return Promise.resolve(found);
      },
    );
    const staged = await stager.stage({
      bytes,
      fingerprint: { algorithm: "sha256", digest },
      byteCount: bytes.byteLength,
    });
    assertEquals(staged.stagedAsset.location, `/inputs/fea-${digest}.step`);
    const reread = await stager.read({
      fingerprint: { algorithm: "sha256", digest },
      byteCount: bytes.byteLength,
    });
    assertEquals(reread ? [...reread] : undefined, [...bytes]);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("isolated STEP cache returns undefined when the object is absent", async () => {
  const directory = await Deno.makeTempDir({ prefix: "sensitivity-step-" });
  try {
    const stager = new IsolatedStepSolverStager(directory, {
      stage: () => Promise.reject(new Error("unused")),
    } as never);
    const missing = await stager.read({
      fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
      byteCount: 4,
    });
    assertEquals(missing, undefined);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("isolated STEP cache rejects a digest mismatch", async () => {
  const directory = await Deno.makeTempDir({ prefix: "sensitivity-step-" });
  try {
    const bytes = new TextEncoder().encode("STEP-BASE");
    const digest = await fingerprintResourceBytes(bytes);
    await Deno.writeFile(`${directory}/fea-${digest}.step`, bytes);
    const stager = new IsolatedStepSolverStager(directory, {
      stage: () => Promise.reject(new Error("unused")),
    } as never);
    await assertRejects(
      () =>
        stager.read({
          fingerprint: { algorithm: "sha256", digest },
          byteCount: 3,
        }),
      TypeError,
      "byteCount",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
