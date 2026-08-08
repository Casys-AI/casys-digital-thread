import { assertEquals, assertThrows } from "@std/assert";
import type { ThreadArtifact } from "../../domain/thread/thread-snapshot.ts";
import { parseInspectionDroneV4ArchitectureCapture } from "./inspection-drone-v4-part-definitions-run-executor.ts";

// This is the read-only r3 evidence produced by the reviewed V4 architecture
// run. It is deliberately never copied, rewritten, or used as provider state.
const MAIN_FIXTURE =
  "/Users/erwanpesle/Documents/GitHub/casys-digital-thread/state/local/inspection-drone-v4-architecture-captures/9535ba575e0dc79ae24b67a96b74802444930adee621af534bd79fc72fbe4862.json";
const MAIN_SNAPSHOT =
  "/Users/erwanpesle/Documents/GitHub/casys-digital-thread/state/local/thread-snapshots/project%3Ainspection-drone-v4%3Ar3%3Acapture-inspection-drone-v4-architecture-9535ba575e0dc79ae24b67a96b74802444930adee621af534bd79fc72fbe4862.json";
const liveFixtureAvailable = await exists(MAIN_FIXTURE) && await exists(MAIN_SNAPSHOT);

Deno.test({
  name:
    "inspection-drone PartDefinitions parser accepts exactly the live r3 architecture fixture",
  ignore: !liveFixtureAvailable,
  fn: async () => {
    const [text, snapshotText] = await Promise.all([
      Deno.readTextFile(MAIN_FIXTURE),
      Deno.readTextFile(MAIN_SNAPSHOT),
    ]);
    const snapshot = JSON.parse(snapshotText) as { artifacts: ThreadArtifact[] };
    const artifact = snapshot.artifacts.find((candidate) =>
      candidate.id.startsWith("inspection-drone-v4-architecture-")
    )!;
    const parsed = parseInspectionDroneV4ArchitectureCapture(text, artifact);
    assertEquals(
      parsed.recipeDigest,
      "eba0ccf48143a0f3ef8f8f0b985b373a97ead0ed57e7cbd6dff717c56693a530",
    );
    assertEquals(parsed.declarationByLabel.size, 10);
    assertEquals(parsed.rootUsages.length, 5);
  },
});

Deno.test({
  name:
    "inspection-drone PartDefinitions parser rejects a recipe fingerprint shape that is not the real r3 contract",
  ignore: !liveFixtureAvailable,
  fn: async () => {
    const [text, snapshotText] = await Promise.all([
      Deno.readTextFile(MAIN_FIXTURE),
      Deno.readTextFile(MAIN_SNAPSHOT),
    ]);
    const snapshot = JSON.parse(snapshotText) as { artifacts: ThreadArtifact[] };
    const artifact = snapshot.artifacts.find((candidate) =>
      candidate.id.startsWith("inspection-drone-v4-architecture-")
    )!;
    const tampered = JSON.parse(text) as { recipe: { textSha256: unknown } };
    tampered.recipe.textSha256 = "not-a-content-fingerprint";
    assertThrows(() =>
      parseInspectionDroneV4ArchitectureCapture(JSON.stringify(tampered), artifact)
    );
  },
});

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}
