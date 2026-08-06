import { parseArgs, stableId } from "./cli.ts";
import { materializeCoffeeMachineBuildRunExtension } from "../src/adapters/historical/coffee-machine-build-run-extension.ts";
import { FileLiveThreadUpdateStore } from "../src/adapters/stores/live-thread-update-store.ts";
import { FileThreadSnapshotStore } from "../src/adapters/stores/file-thread-snapshot-store.ts";
import { applyThreadSnapshotExtensionIfNew } from "../src/domain/thread/thread-snapshot-extension.ts";

export interface AttachCoffeeMachineBuildOptions {
  runId: string;
  capturePath?: string;
  snapshotDirectory?: string;
  liveUpdateDirectory?: string;
  subjectId?: string;
  now?: () => Date;
}

/** Publish one verified build capture, then retire its provisional feed nodes. */
export async function attachCoffeeMachineBuildRun(
  options: AttachCoffeeMachineBuildOptions,
) {
  const runId = stableId(options.runId, "runId");
  const subjectId = stableId(
    options.subjectId ?? "coffee-machine-cm01",
    "subjectId",
  );
  const capturePath = options.capturePath ??
    `state/local/coffee-machine-build-runs/${runId}.json`;
  const snapshotStore = new FileThreadSnapshotStore(
    options.snapshotDirectory ?? "state/local/thread-snapshots",
  );
  const base = await snapshotStore.latest(subjectId);
  if (!base) throw new Error(`No canonical ThreadSnapshot for ${subjectId}.`);
  const capture: unknown = JSON.parse(await Deno.readTextFile(capturePath));
  const extension = await materializeCoffeeMachineBuildRunExtension(capture, {
    runId,
    sourceUri: capturePath,
  });
  const result = applyThreadSnapshotExtensionIfNew(base, extension, {
    appliedAt: extension.capturedAt,
  });
  if (result.applied) await snapshotStore.save(result.snapshot);

  // The canonical snapshot must be durable before provisional activity is
  // retired; otherwise the feed could temporarily lose both representations.
  const liveUpdates = new FileLiveThreadUpdateStore(
    options.liveUpdateDirectory ?? "state/local/live-thread-updates",
  );
  await liveUpdates.reconcileRun(
    subjectId,
    runId,
    (options.now ?? (() => new Date()))().toISOString(),
  );
  return {
    runId,
    applied: result.applied,
    snapshot: result.snapshot,
    path: snapshotStore.pathFor(result.snapshot.id),
    artifactIds: extension.artifacts.map((artifact) => artifact.id),
  };
}

if (import.meta.main) {
  const args = parseArgs(Deno.args);
  const runId = args["run-id"];
  if (!runId) throw new Error("--run-id is required.");
  const result = await attachCoffeeMachineBuildRun({
    runId,
    capturePath: args["capture"],
    snapshotDirectory: args["snapshot-dir"],
    liveUpdateDirectory: args["live-update-dir"],
    subjectId: args["subject"],
  });
  console.log(JSON.stringify(
    {
      runId: result.runId,
      applied: result.applied,
      snapshotId: result.snapshot.id,
      revision: result.snapshot.revision,
      artifacts: result.artifactIds,
      path: result.path,
    },
    null,
    2,
  ));
}
