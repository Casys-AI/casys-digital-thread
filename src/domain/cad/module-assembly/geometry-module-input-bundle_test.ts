import { assertEquals, assertRejects } from "@std/assert";
import { fingerprintResourceBytes } from "../../compile/source/provider-resource-reader.ts";
import { deterministicJson } from "../../kernel/deterministic-json.ts";
import {
  GEOMETRY_MODULE_CHILD_STEP_MEDIA_TYPE,
  GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA,
  GEOMETRY_MODULE_PLACEMENT_CONVENTION,
} from "../geometry-module-contract.ts";
import {
  createGeometryModuleInputBundle,
  GEOMETRY_MODULE_INPUT_BUNDLE_MAGIC,
  GEOMETRY_MODULE_MAXIMUM_OCCURRENCES,
  type GeometryModuleInputOccurrenceInput,
  parseGeometryModuleInputBundle,
  rehashGeometryModuleInputBundleSteps,
} from "./geometry-module-input-bundle.ts";

const STEP_A = step("A");
const STEP_B = step("B");

Deno.test("geometry-module input bundle encodes ordered occurrences, placements and exact STEP bytes", async () => {
  const bundle = await createGeometryModuleInputBundle([
    occurrence("usage-b", "def-b", STEP_B, [10, 0, 0], [0, 0, 90]),
    occurrence("usage-a", "def-a", STEP_A, [0, 0, 0], [0, 0, 0]),
  ]);
  const reopened = await parseGeometryModuleInputBundle(bundle.bytes.copy());

  assertEquals(reopened.manifest.schemaVersion, GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA);
  assertEquals(
    reopened.manifest.placementConvention,
    GEOMETRY_MODULE_PLACEMENT_CONVENTION,
  );
  assertEquals(reopened.manifest.occurrences.map((item) => item.usageElementId), [
    "usage-a",
    "usage-b",
  ]);
  assertEquals(reopened.manifest.occurrences[0], {
    usageElementId: "usage-a",
    partDefinitionElementId: "def-a",
    placement: { translationMm: [0, 0, 0], rotationDeg: [0, 0, 0] },
    childCapture: {
      schemaVersion: "geometry-part-capture/1.0",
      artifactId: "geometry-part-usage-a",
      fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
    },
    step: {
      mediaType: GEOMETRY_MODULE_CHILD_STEP_MEDIA_TYPE,
      byteOffset: 0,
      byteCount: STEP_A.byteLength,
      sha256: await fingerprintResourceBytes(STEP_A),
    },
  });
  assertEquals(reopened.manifest.occurrences[1]?.step.byteOffset, STEP_A.byteLength);
  assertEquals(reopened.stepBytes[0]?.copy(), STEP_A);
  assertEquals(reopened.stepBytes[1]?.copy(), STEP_B);
  assertEquals(reopened.fingerprint, bundle.fingerprint);
  await rehashGeometryModuleInputBundleSteps(reopened);

  const copy = bundle.bytes.copy();
  copy[copy.byteLength - 1] ^= 1;
  await assertRejects(
    () => parseGeometryModuleInputBundle(copy),
    TypeError,
    "failed exact rehash",
  );
});

Deno.test("geometry-module input bundle refuses extra fields, unsorted identities and non-finite placements", async () => {
  await assertRejects(
    () => createGeometryModuleInputBundle([]),
    TypeError,
    "must not be empty",
  );
  await assertRejects(
    () =>
      createGeometryModuleInputBundle([
        occurrence("usage-a", "def-a", STEP_A, [0, Number.NaN, 0], [0, 0, 0]),
      ]),
    TypeError,
    "finite",
  );
  await assertRejects(
    () =>
      createGeometryModuleInputBundle([
        occurrence("usage-a", "def-a", STEP_A, [0, 0, 0], [0, 0, 0]),
        occurrence("usage-a", "def-b", STEP_B, [1, 0, 0], [0, 0, 0]),
      ]),
    TypeError,
    "must not contain duplicates",
  );
  await assertRejects(
    () =>
      createGeometryModuleInputBundle(
        Array.from({ length: GEOMETRY_MODULE_MAXIMUM_OCCURRENCES + 1 }, (_, index) =>
          occurrence(`usage-${index}`, "def-a", STEP_A, [0, 0, 0], [0, 0, 0])),
      ),
    TypeError,
    "one-level occurrence ceiling",
  );

  const valid = await createGeometryModuleInputBundle([
    occurrence("usage-a", "def-a", STEP_A, [0, 0, 0], [0, 0, 0]),
  ]);
  const mutated = JSON.parse(
    new TextDecoder().decode(manifestBytes(valid.bytes.copy())),
  );
  mutated.productName = "lamp";
  await assertRejects(
    () => parseGeometryModuleInputBundle(rewriteManifest(valid.bytes.copy(), mutated)),
    TypeError,
    "unsupported field productName",
  );
  mutated.productName = undefined;
  delete mutated.productName;
  mutated.occurrences[0].label = "bracket";
  await assertRejects(
    () => parseGeometryModuleInputBundle(rewriteManifest(valid.bytes.copy(), mutated)),
    TypeError,
    "unsupported field label",
  );
});

Deno.test("geometry-module input bundle refuses a non-canonical or incomplete Part 21 payload", async () => {
  await assertRejects(
    () =>
      createGeometryModuleInputBundle([
        occurrence(
          "usage-a",
          "def-a",
          new TextEncoder().encode("not step"),
          [0, 0, 0],
          [
            0,
            0,
            0,
          ],
        ),
      ]),
    TypeError,
    "not one complete STEP Part 21",
  );

  const bundle = await createGeometryModuleInputBundle([
    occurrence("usage-a", "def-a", STEP_A, [0, 0, 0], [0, 0, 0]),
    occurrence("usage-b", "def-b", STEP_B, [5, 0, 0], [0, 90, 0]),
  ]);
  const parsed = JSON.parse(
    new TextDecoder().decode(manifestBytes(bundle.bytes.copy())),
  );
  parsed.occurrences[1].step.byteOffset = 1;
  await assertRejects(
    () => parseGeometryModuleInputBundle(rewriteManifest(bundle.bytes.copy(), parsed)),
    TypeError,
    "not densely packed",
  );
  if (!startsWithMagic(bundle.bytes.copy())) {
    throw new Error("expected magic");
  }
  const withoutMagic = bundle.bytes.copy().subarray(1);
  await assertRejects(
    () => parseGeometryModuleInputBundle(withoutMagic),
    TypeError,
    "invalid magic",
  );
});

function occurrence(
  usageElementId: string,
  partDefinitionElementId: string,
  stepBytes: Uint8Array,
  translationMm: readonly [number, number, number],
  rotationDeg: readonly [number, number, number],
): GeometryModuleInputOccurrenceInput {
  return {
    usageElementId,
    partDefinitionElementId,
    placement: { translationMm, rotationDeg },
    childCapture: {
      schemaVersion: "geometry-part-capture/1.0",
      artifactId: `geometry-part-${usageElementId}`,
      fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
    },
    stepBytes,
  };
}

function step(marker: string): Uint8Array {
  return new TextEncoder().encode(
    `ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n/* ${marker} */\nENDSEC;\nEND-ISO-10303-21;\n`,
  );
}

function manifestBytes(bytes: Uint8Array): Uint8Array {
  const lengthStart = GEOMETRY_MODULE_INPUT_BUNDLE_MAGIC.byteLength;
  const lengthEnd = bytes.indexOf(10, lengthStart);
  const manifestLength = Number(
    new TextDecoder().decode(bytes.subarray(lengthStart, lengthEnd)),
  );
  return bytes.subarray(lengthEnd + 1, lengthEnd + 1 + manifestLength);
}

function rewriteManifest(bytes: Uint8Array, manifest: unknown): Uint8Array {
  const lengthStart = GEOMETRY_MODULE_INPUT_BUNDLE_MAGIC.byteLength;
  const lengthEnd = bytes.indexOf(10, lengthStart);
  const oldManifestLength = Number(
    new TextDecoder().decode(bytes.subarray(lengthStart, lengthEnd)),
  );
  const payload = bytes.subarray(lengthEnd + 1 + oldManifestLength);
  const encoded = new TextEncoder().encode(deterministicJson(manifest));
  const length = new TextEncoder().encode(`${encoded.byteLength}\n`);
  const rewritten = new Uint8Array(
    GEOMETRY_MODULE_INPUT_BUNDLE_MAGIC.byteLength + length.byteLength +
      encoded.byteLength + payload.byteLength,
  );
  rewritten.set(GEOMETRY_MODULE_INPUT_BUNDLE_MAGIC, 0);
  rewritten.set(length, GEOMETRY_MODULE_INPUT_BUNDLE_MAGIC.byteLength);
  rewritten.set(
    encoded,
    GEOMETRY_MODULE_INPUT_BUNDLE_MAGIC.byteLength + length.byteLength,
  );
  rewritten.set(
    payload,
    GEOMETRY_MODULE_INPUT_BUNDLE_MAGIC.byteLength + length.byteLength +
      encoded.byteLength,
  );
  return rewritten;
}

function startsWithMagic(bytes: Uint8Array): boolean {
  return GEOMETRY_MODULE_INPUT_BUNDLE_MAGIC.every((byte, index) =>
    bytes[index] === byte
  );
}
