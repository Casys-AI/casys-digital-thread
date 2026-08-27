import { assertEquals, assertRejects } from "@std/assert";
import {
  Base64EngineeringAssetReader,
  type EngineeringAssetReader,
  OrderedEngineeringAssetReader,
} from "./engineering-asset-resolver.ts";

const ASSET = "generic-bracket.stl";

Deno.test("base64 asset reader decodes the exact bytes from its configured directory", async () => {
  const directory = await Deno.makeTempDir({ prefix: "engineering-asset-reader-" });
  try {
    const expected = new TextEncoder().encode(
      "solid generic-bracket\nendsolid generic-bracket\n",
    );
    await Deno.writeTextFile(
      `${directory}/${ASSET}.base64`,
      `${expected.toBase64()}\n`,
    );
    const reader = new Base64EngineeringAssetReader(directory);

    const bytes = await reader.read(ASSET);

    assertEquals(bytes, expected);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("engineering asset resolution gives active bytes priority", async () => {
  const reader = new OrderedEngineeringAssetReader([
    new MemoryAssetReader(new Uint8Array([1, 2, 3])),
    new MemoryAssetReader(new Uint8Array([4, 5, 6])),
  ]);

  assertEquals(await reader.read(ASSET), new Uint8Array([1, 2, 3]));
});

Deno.test("engineering asset resolution does not substitute another filename", async () => {
  const reader = new Base64EngineeringAssetReader("unused-test-assets");

  assertEquals(await reader.read("another-model.stl"), undefined);
  await assertRejects(
    () => reader.read(`../${ASSET}`),
    TypeError,
    "not safe",
  );
});

class MemoryAssetReader implements EngineeringAssetReader {
  constructor(private readonly bytes: Uint8Array | undefined) {}

  read(): Promise<Uint8Array | undefined> {
    return Promise.resolve(this.bytes);
  }
}
