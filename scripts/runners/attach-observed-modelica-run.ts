import { parseArgs } from "../lib/cli.ts";
import { FileThreadSnapshotStore } from "../../src/adapters/stores/file-thread-snapshot-store.ts";
import { ModelicaRunObserver } from "../../src/adapters/historical/modelica-run-observer.ts";
import { createObservedModelicaRunExtension } from "../../src/adapters/observed-modelica-thread-branch.ts";
import { applyThreadSnapshotExtension } from "../../src/domain/thread/thread-snapshot-extension.ts";

const args = parseArgs(Deno.args);
const runId = args["run"];
if (!runId) {
  throw new Error("Pass one persisted Modelica run id with --run=<run_id>.");
}

const directory = args["output"] ?? "state/local/thread-snapshots";
const subjectId = args["subject"] ?? "coffee-machine-cm01";
const snapshotId = args["base"];
const mcpUrl = args["mcp-url"] ?? "http://127.0.0.1:3016/mcp";
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
