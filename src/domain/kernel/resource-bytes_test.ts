import { assertEquals } from "@std/assert";
import { fingerprintResourceBytes } from "./resource-bytes.ts";
import { sha256Hex } from "./deterministic-json.ts";

Deno.test("kernel resource-byte SHA-256 is lowercase hex of exact bytes", async () => {
  const digest = await fingerprintResourceBytes(new TextEncoder().encode("abc"));
  assertEquals(
    digest,
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  const same = Uint8Array.from([1, 2, 3, 255]);
  assertEquals(await fingerprintResourceBytes(same), await sha256Hex(same));
});
