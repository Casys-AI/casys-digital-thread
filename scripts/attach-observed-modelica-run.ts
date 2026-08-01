import { FileThreadSnapshotStore } from "../src/adapters/file-thread-snapshot-store.ts";
import { ModelicaRunObserver } from "../src/adapters/modelica-run-observer.ts";
import { createObservedModelicaRunExtension } from "../src/adapters/observed-modelica-thread-branch.ts";
import { applyThreadSnapshotExtension } from "../src/domain/thread-snapshot-extension.ts";

const runId = argument("run");
if (!runId) {
  throw new Error("Pass one persisted Modelica run id with --run=<run_id>.");
}

const directory = argument("output") ?? "state/local/thread-snapshots";
const subjectId = argument("subject") ?? "coffee-machine-cm01";
const snapshotId = argument("base");
const mcpUrl = argument("mcp-url") ?? "http://127.0.0.1:3016/mcp";
const store = new FileThreadSnapshotStore(directory);
const base = snapshotId ? await store.get(snapshotId) : await store.latest(subjectId);
if (!base) {
  throw new Error(
    snapshotId
      ? `Base ThreadSnapshot ${snapshotId} was not found in ${directory}.`
      : `No ThreadSnapshot for ${subjectId} was found in ${directory}.`,
  );
}

const observer = new ModelicaRunObserver({ mcpUrl });
const detail = await observer.detail(`modelica:${runId}`);
if (!detail) throw new Error(`Persisted Modelica run ${runId} was not found.`);

const extension = createObservedModelicaRunExtension(base.subject.id, detail, {
  sourceLabel: "persisted local mcp-modelica run",
});
const existingArtifactIds = new Set(base.artifacts.map((artifact) => artifact.id));
const alreadyAttached = extension.artifacts.every((artifact) =>
  existingArtifactIds.has(artifact.id)
);
if (
  !alreadyAttached &&
  extension.artifacts.some((artifact) => existingArtifactIds.has(artifact.id))
) {
  throw new Error(
    `Base ThreadSnapshot ${base.id} contains only part of Modelica run ${runId}; refusing an ambiguous merge.`,
  );
}
const snapshot = alreadyAttached ? base : applyThreadSnapshotExtension(base, extension);
if (!alreadyAttached) await store.save(snapshot);

console.log(JSON.stringify(
  {
    snapshotId: snapshot.id,
    previous: snapshot.previous,
    subjectId: snapshot.subject.id,
    modelicaRunId: runId,
    artifactsAttached: extension.artifacts.length,
    observationsAttached: extension.observations.map((item) => ({
      metric: item.metric,
      quantity: item.quantity,
    })),
    requirementsAttached: extension.requirements.length,
    verdict: "unavailable-no-model-owned-criterion",
    alreadyAttached,
    path: store.pathFor(snapshot.id),
  },
  null,
  2,
));

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return Deno.args.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}
