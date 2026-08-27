import { assertEquals } from "@std/assert";
import { sha256Hex } from "../../kernel/deterministic-json.ts";
import { extractParametricCadProvenanceFromGeometryCapture } from "./fea-proof-cad-lineage.ts";

const TARGET = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const SCRIPT = "from build123d import Box\nresult = Box(100, 20, 10)\n";

Deno.test("CAD lineage extracts unique part STEP and script identity from a 2.1 capture", async () => {
  const digest = await sha256Hex(new TextEncoder().encode(SCRIPT));
  const extracted = await extractParametricCadProvenanceFromGeometryCapture({
    schemaVersion: "geometry-capture/2.1",
    manifest: {
      partDefinitions: [{
        elementId: TARGET,
        files: [{
          format: "step",
          fingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
        }],
      }],
    },
    sourceScripts: {
      partDefinitions: [{
        elementId: TARGET,
        script: SCRIPT,
        scriptHash: { algorithm: "sha256", digest },
      }],
    },
  }, TARGET);
  assertEquals(extracted.status, "ok");
  if (extracted.status !== "ok") return;
  assertEquals(extracted.stepDigest, "c".repeat(64));
  assertEquals(extracted.definition.sha256, digest);
  assertEquals(extracted.definition.bytes, new TextEncoder().encode(SCRIPT).byteLength);
});

Deno.test("CAD lineage rejects geometry-capture/2.0", async () => {
  const extracted = await extractParametricCadProvenanceFromGeometryCapture({
    schemaVersion: "geometry-capture/2.0",
    manifest: {
      partDefinitions: [{
        elementId: TARGET,
        files: [{
          format: "step",
          fingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
        }],
      }],
    },
    sourceScripts: {
      partDefinitions: [{
        elementId: TARGET,
        script: SCRIPT,
      }],
    },
  }, TARGET);
  assertEquals(extracted.status, "unresolved");
  if (extracted.status !== "unresolved") return;
  assertEquals(extracted.code, "cad-lineage-invalid");
});

Deno.test("CAD lineage is unavailable when the unique part source script is missing", async () => {
  const extracted = await extractParametricCadProvenanceFromGeometryCapture({
    schemaVersion: "geometry-capture/2.1",
    manifest: {
      partDefinitions: [{
        elementId: TARGET,
        files: [{
          format: "step",
          fingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
        }],
      }],
    },
  }, TARGET);
  assertEquals(extracted.status, "unresolved");
  if (extracted.status !== "unresolved") return;
  assertEquals(extracted.code, "cad-lineage-unavailable");
});
