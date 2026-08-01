import { assertEquals, assertRejects } from "@std/assert";
import {
  Base64EngineeringAssetReader,
  type EngineeringAssetReader,
  OrderedEngineeringAssetReader,
} from "./engineering-asset-resolver.ts";

const ASSET = "coffee-machine-8208d581f067.stl";
const EXPECTED_SHA256 =
  "8208d581f06796b4e6b6c5f6f6dc4e3785245c251b355859d31ea69445ccaf7e";

Deno.test("checked-in presentation baseline decodes to the exact observed STL", async () => {
  const reader = new Base64EngineeringAssetReader(
    "config/projects/baselines/assets",
  );

  const bytes = await reader.read(ASSET);

  if (!bytes) throw new Error("Versioned STL baseline is missing.");
  assertEquals(bytes.byteLength, 56_284);
  assertEquals(await sha256(bytes), EXPECTED_SHA256);
});

Deno.test("engineering asset resolution gives active bytes priority", async () => {
  const reader = new OrderedEngineeringAssetReader([
    new MemoryAssetReader(new Uint8Array([1, 2, 3])),
    new MemoryAssetReader(new Uint8Array([4, 5, 6])),
  ]);

  assertEquals(await reader.read(ASSET), new Uint8Array([1, 2, 3]));
});

Deno.test("engineering asset resolution does not substitute another filename", async () => {
  const reader = new Base64EngineeringAssetReader(
    "config/projects/baselines/assets",
  );

  assertEquals(await reader.read("another-model.stl"), undefined);
  await assertRejects(
    () => reader.read("../coffee-machine-8208d581f067.stl"),
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

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes).buffer,
  );
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
