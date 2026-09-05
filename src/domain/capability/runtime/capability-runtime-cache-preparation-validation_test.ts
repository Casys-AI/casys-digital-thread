import { assertEquals, assertThrows } from "@std/assert";
import { pinnedOciImageReference } from "../../compile/isolation/local-isolation-runtime.ts";
import {
  parseRequestedMaterial,
  pinnedImageReference,
  sameRequestedMaterial,
} from "./capability-runtime-cache-preparation-validation.ts";

const DIGEST = "a".repeat(64);
const SHORT = `casys/test-source@sha256:${DIGEST}`;
const CANONICAL = `docker.io/casys/test-source@sha256:${DIGEST}`;
const GHCR = `ghcr.io/casys-ai/mcp-chrono@sha256:${DIGEST}`;

Deno.test("cache-preparation pinned image reference returns the canonical OCI form", () => {
  assertEquals(pinnedImageReference(SHORT, "$image"), CANONICAL);
  assertEquals(
    pinnedImageReference(`postgres@sha256:${DIGEST}`, "$image"),
    `docker.io/library/postgres@sha256:${DIGEST}`,
  );
  assertEquals(pinnedImageReference(GHCR, "$image"), GHCR);
  assertEquals(
    pinnedImageReference(SHORT, "$image"),
    pinnedOciImageReference(SHORT, "$image"),
  );
  assertThrows(
    () => pinnedImageReference("casys/test-source:latest", "$image"),
    TypeError,
    "must be one OCI image name pinned by a lowercase sha256 digest",
  );
});

Deno.test("cache-preparation requested materials expose the canonical image reference", () => {
  const short = requested(SHORT);
  const dockerIo = requested(CANONICAL);
  assertEquals(short.imageReference, CANONICAL);
  assertEquals(dockerIo.imageReference, CANONICAL);
  assertEquals(sameRequestedMaterial(short, dockerIo), true);
});

function requested(imageReference: string) {
  return parseRequestedMaterial({
    material: {
      unitId: "casys.test-cache-worker",
      materialId: "source-image",
      imageDigest: DIGEST,
    },
    imageReference,
    lifecycle: "cache",
  }, "$requested");
}
