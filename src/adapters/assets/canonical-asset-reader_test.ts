/**
 * Tests for FileCanonicalAssetReader.
 *
 * Invariants exercised:
 *   - read returns the exact bytes when the file exists and its SHA-256 matches
 *     the requested digest.
 *   - read throws CanonicalAssetReadError(not_found) when no file exists for
 *     the requested digest.
 *   - read throws CanonicalAssetReadError(integrity_mismatch) when the file
 *     exists but its bytes do not hash to the requested digest (corruption or
 *     rename scenario).
 *   - read(digest) throws TypeError when digest is not a 64-character lowercase
 *     hex string (programmer-error guard, no filesystem access attempted).
 */

import { assertEquals, assertRejects } from "@std/assert";
import {
  CanonicalAssetReadError,
  FileCanonicalAssetReader,
} from "./canonical-asset-reader.ts";

// ── Helpers ────────────────────────────────────────────────────────────────────

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Create a temporary directory, write one `.step` file with the given bytes,
 * then return the directory path and the SHA-256 digest of those bytes.
 */
async function setupAsset(
  bytes: Uint8Array,
): Promise<{ dir: string; digest: string }> {
  const dir = await Deno.makeTempDir();
  const digest = await sha256Hex(bytes);
  await Deno.writeFile(`${dir}/${digest}.step`, bytes);
  return { dir, digest };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

Deno.test(
  "FileCanonicalAssetReader returns exact bytes when file exists and hash matches",
  async () => {
    const expected = new TextEncoder().encode("STEP geometry payload");
    const { dir, digest } = await setupAsset(expected);

    try {
      const reader = new FileCanonicalAssetReader({ directory: dir });
      const actual = await reader.read(digest);
      assertEquals(actual, expected);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "FileCanonicalAssetReader throws not_found when no file exists for the digest",
  async () => {
    const dir = await Deno.makeTempDir();
    const digest = "a".repeat(64); // valid hex64 but no file on disk

    try {
      const reader = new FileCanonicalAssetReader({ directory: dir });
      const error = await assertRejects(
        () => reader.read(digest),
        CanonicalAssetReadError,
      );
      assertEquals(error.code, "not_found");
      assertEquals(error.context.digest, digest);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "FileCanonicalAssetReader throws integrity_mismatch when file content does not hash to the requested digest",
  async () => {
    const dir = await Deno.makeTempDir();

    // Write bytes for one digest but store them under a different digest name.
    const realBytes = new TextEncoder().encode("original payload");
    const realDigest = await sha256Hex(realBytes);

    // The digest we will request corresponds to different bytes.
    const otherBytes = new TextEncoder().encode("different payload");
    const requestedDigest = await sha256Hex(otherBytes);

    // Place realBytes under the requestedDigest filename (simulates corruption
    // or a renamed file scenario).
    await Deno.writeFile(`${dir}/${requestedDigest}.step`, realBytes);

    try {
      const reader = new FileCanonicalAssetReader({ directory: dir });
      const error = await assertRejects(
        () => reader.read(requestedDigest),
        CanonicalAssetReadError,
      );
      assertEquals(error.code, "integrity_mismatch");
      assertEquals(error.context.digest, requestedDigest);
      assertEquals(error.context.actual, realDigest);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "FileCanonicalAssetReader reads a .stl file when constructed with extension stl",
  async () => {
    const expected = new TextEncoder().encode("solid fixture\nendsolid fixture\n");
    const dir = await Deno.makeTempDir();
    try {
      const digest = await sha256Hex(expected);
      await Deno.writeFile(`${dir}/${digest}.stl`, expected);
      const reader = new FileCanonicalAssetReader({
        directory: dir,
        extension: "stl",
      });
      assertEquals(await reader.read(digest), expected);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "FileCanonicalAssetReader with extension stl does not read a sibling .step file",
  async () => {
    const bytes = new TextEncoder().encode("STEP geometry payload");
    const dir = await Deno.makeTempDir();
    try {
      const digest = await sha256Hex(bytes);
      await Deno.writeFile(`${dir}/${digest}.step`, bytes);
      const reader = new FileCanonicalAssetReader({
        directory: dir,
        extension: "stl",
      });
      const error = await assertRejects(
        () => reader.read(digest),
        CanonicalAssetReadError,
      );
      assertEquals(error.code, "not_found");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "FileCanonicalAssetReader throws TypeError for a digest that is not 64 lowercase hex characters",
  async () => {
    const dir = await Deno.makeTempDir();

    try {
      const reader = new FileCanonicalAssetReader({ directory: dir });

      // Too short
      await assertRejects(
        () => reader.read("deadbeef"),
        TypeError,
      );

      // Uppercase hex (not accepted — callers must supply lowercase)
      await assertRejects(
        () => reader.read("A".repeat(64)),
        TypeError,
      );

      // Non-hex characters
      await assertRejects(
        () => reader.read("z".repeat(64)),
        TypeError,
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);
