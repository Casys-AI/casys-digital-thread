import { assertEquals, assertRejects } from "@std/assert";
import {
  closeCoffeeMachineCm01V3R11,
  CM01_V3_R11_CLOSEOUT_ACKNOWLEDGEMENT,
} from "./close-coffee-machine-cm01-v3-r11.ts";

Deno.test("CM-01 R11 closeout dry-run is inert before reading or creating local state", async () => {
  await withEmptyLocalRoot(async (root) => {
    const result = await closeCoffeeMachineCm01V3R11({
      projectDirectory: `${root}/projects`,
      snapshotDirectory: `${root}/snapshots`,
    });

    assertEquals(result.status, "confirmation-required");
    if (result.status !== "confirmation-required") {
      throw new Error("Dry-run unexpectedly attempted CM-01 closeout.");
    }
    assertEquals(
      result.acknowledgement,
      CM01_V3_R11_CLOSEOUT_ACKNOWLEDGEMENT,
    );
    await assertMissing(`${root}/projects`);
    await assertMissing(`${root}/snapshots`);
  });
});

Deno.test("CM-01 R11 closeout rejects a wrong acknowledgement without local writes", async () => {
  await withEmptyLocalRoot(async (root) => {
    await assertRejects(
      () =>
        closeCoffeeMachineCm01V3R11({
          execute: true,
          acknowledgement: "not-the-explicit-closeout-acknowledgement",
          projectDirectory: `${root}/projects`,
          snapshotDirectory: `${root}/snapshots`,
        }),
      Error,
      "Refusing CM-01 R11 closeout",
    );
    await assertMissing(`${root}/projects`);
    await assertMissing(`${root}/snapshots`);
  });
});

async function withEmptyLocalRoot(
  test: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "cm01-r11-closeout-test-" });
  try {
    await test(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

async function assertMissing(path: string): Promise<void> {
  await assertRejects(() => Deno.stat(path), Deno.errors.NotFound);
}
