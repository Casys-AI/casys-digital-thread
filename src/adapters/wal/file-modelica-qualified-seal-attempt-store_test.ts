import { assert } from "@std/assert";
import {
  FileModelicaQualifiedSealAttemptStore,
} from "./file-modelica-qualified-seal-attempt-store.ts";

const digest = "a".repeat(64);

Deno.test("qualified Modelica seal journal uses a bounded SHA-256 run key and admits only one concurrent collection", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-modelica-qualified-seal-wal-",
  });
  try {
    const store = new FileModelicaQualifiedSealAttemptStore(directory);
    const runId = `run:${"x".repeat(240)}`;
    const path = await store.pathFor("project:qualified", runId);
    assert(/^[a-f0-9]{64}\.json$/.test(path.split("/").at(-1) ?? ""));
    assert((path.split("/").at(-1)?.length ?? 0) < 100);

    const first = store.recordCollected({
      projectId: "project:qualified",
      runId,
      collection: collection("a"),
    });
    const conflicting = store.recordCollected({
      projectId: "project:qualified",
      runId,
      collection: collection("b"),
    });
    const [left, right] = await Promise.allSettled([first, conflicting]);
    assert(
      (left.status === "fulfilled" && right.status === "rejected") ||
        (left.status === "rejected" && right.status === "fulfilled"),
      "one collection must win and the competing exact collection must fail closed",
    );
    const saved = await store.read("project:qualified", runId);
    assert(saved?.status === "collected");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

function collection(seed: string) {
  const sourceDigest = seed.repeat(64);
  return {
    caseDigest: digest,
    simulationCase: cas(digest),
    manifest: cas("c".repeat(64)),
    sourceCapture: cas("d".repeat(64)),
    sources: [{
      role: "model" as const,
      mediaType: "text/x-modelica",
      resourceUri: "casys://modelica/kits/qualified/model.mo",
      cas: cas(sourceDigest),
    }, {
      role: "scenario" as const,
      mediaType: "application/json",
      resourceUri: "casys://modelica/scenarios/qualified.json",
      cas: cas("e".repeat(64)),
    }],
  };
}

function cas(sha256: string) {
  return { uri: `casys://test/sha256/${sha256}`, byteCount: 1, sha256 };
}
