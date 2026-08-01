import { materializeAttestedMechanicalRun } from "../src/adapters/attested-mechanical-run.ts";
import { FileThreadSnapshotStore } from "../src/adapters/file-thread-snapshot-store.ts";

const inputPath = argument("input") ??
  "state/local/attested-mechanical-run.json";
const outputDirectory = argument("output") ??
  "state/local/thread-snapshots";

const capture: unknown = JSON.parse(await Deno.readTextFile(inputPath));
const snapshot = await materializeAttestedMechanicalRun(capture, {
  sourceUri: inputPath,
});
const store = new FileThreadSnapshotStore(outputDirectory);
await store.save(snapshot);

console.log(JSON.stringify(
  {
    snapshotId: snapshot.id,
    subjectId: snapshot.subject.id,
    revision: snapshot.revision,
    path: store.pathFor(snapshot.id),
    requirements: snapshot.requirements.length,
    verdict: "unavailable-no-model-owned-criterion",
  },
  null,
  2,
));

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return Deno.args.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}
