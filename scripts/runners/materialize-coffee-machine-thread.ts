import {
  materializeErpNextCoffeeMachineBomDetailExtension,
  materializeErpNextCoffeeMachineBomExtension,
} from "../../src/adapters/historical/erpnext-coffee-machine-extension.ts";
import { ErpNextCoffeeMachineObserver } from "../../src/adapters/historical/erpnext-coffee-machine-observer.ts";
import { FileThreadSnapshotStore } from "../../src/adapters/stores/file-thread-snapshot-store.ts";
import { HttpMcpToolClient } from "../../src/adapters/mcp/http-mcp-tool-client.ts";
import { ModelicaRunObserver } from "../../src/adapters/historical/modelica-run-observer.ts";
import { createObservedModelicaRunExtension } from "../../src/adapters/observed-modelica-thread-branch.ts";
import {
  materializeSysonInventorySubject,
  sysonModelInventoryExtension,
} from "../../src/adapters/historical/syson-model-inventory-extension.ts";
import { applyThreadSnapshotExtensionIfNew } from "../../src/domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshot } from "../../src/domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotExtension } from "../../src/domain/thread/thread-snapshot-extension.ts";
import {
  bindThreadSnapshotExtension,
  validateThreadSubjectManifest,
} from "../../src/domain/thread/thread-subject-manifest.ts";
import { parseArgs } from "../lib/cli.ts";

const args = parseArgs(Deno.args);
const manifestPath = args["manifest"] ??
  "config/thread-subjects/coffee-machine-cm01.json";
const sysonPath = args["syson-inventory"] ??
  await latestJson("state/local/syson-inventory");
const outputDirectory = args["output"] ?? "state/local/thread-snapshots";
const manifest = validateThreadSubjectManifest(
  JSON.parse(await Deno.readTextFile(manifestPath)),
);
const store = new FileThreadSnapshotStore(outputDirectory);

const sysonCapture: unknown = JSON.parse(await Deno.readTextFile(sysonPath));
const bootstrap = await materializeSysonInventorySubject(
  sysonCapture,
  sysonPath,
  manifest,
);
let snapshot = await store.latest(manifest.subject.id);
if (!snapshot) {
  snapshot = bootstrap;
  await store.save(snapshot);
} else {
  const sysonExtension = await sysonModelInventoryExtension(
    sysonCapture,
    sysonPath,
    manifest.subject.id,
  );
  snapshot = await applyAndPersist(snapshot, sysonExtension);
}

const modelicaBinding = uniqueBinding(manifest, "modelica", "run");
const modelicaObserver = new ModelicaRunObserver({
  mcpUrl: args["modelica-mcp-url"] ?? "http://127.0.0.1:3016/mcp",
});
const modelicaDetail = await modelicaObserver.detail(`modelica:${modelicaBinding.id}`);
if (!modelicaDetail) {
  throw new Error(`Persisted Modelica run ${modelicaBinding.id} was not found.`);
}
const modelicaProviderExtension = createObservedModelicaRunExtension(
  `modelica-run:${modelicaBinding.id}`,
  modelicaDetail,
  { sourceLabel: "persisted local mcp-modelica run" },
);
snapshot = await applyAndPersist(
  snapshot,
  bindThreadSnapshotExtension(modelicaProviderExtension, manifest, modelicaBinding),
  { appliedAt: later(snapshot.generatedAt, modelicaProviderExtension.capturedAt) },
);

const erpBinding = uniqueBinding(manifest, "erpnext", "item");
const erpObserver = new ErpNextCoffeeMachineObserver({
  client: new HttpMcpToolClient({
    mcpUrl: args["erpnext-mcp-url"] ?? "http://127.0.0.1:3012/mcp",
    timeoutMs: 30_000,
  }),
  itemCode: erpBinding.id,
});
const erpCapture = await erpObserver.observe();
const erpCapturePath = await persistCapture(
  "state/local/erpnext-captures",
  erpCapture.capturedAt,
  erpCapture,
);
const erpProviderExtension = await materializeErpNextCoffeeMachineBomExtension(
  erpCapture,
  { sourceUri: erpCapturePath },
);
snapshot = await applyAndPersist(
  snapshot,
  bindThreadSnapshotExtension(erpProviderExtension, manifest, erpBinding),
  { appliedAt: later(snapshot.generatedAt, erpProviderExtension.capturedAt) },
);
const erpDetailProviderExtension =
  await materializeErpNextCoffeeMachineBomDetailExtension(
    erpCapture,
    { sourceUri: erpCapturePath },
  );
snapshot = await applyAndPersist(
  snapshot,
  bindThreadSnapshotExtension(
    erpDetailProviderExtension,
    manifest,
    erpBinding,
  ),
  { appliedAt: later(snapshot.generatedAt, erpDetailProviderExtension.capturedAt) },
);

console.log(JSON.stringify(
  {
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    subject: snapshot.subject,
    providers: [
      ...new Set(snapshot.artifacts.map((artifact) => artifact.producer.serverId)),
    ],
    artifacts: snapshot.artifacts.length,
    observations: snapshot.observations.map((observation) => ({
      metric: observation.metric,
      quantity: observation.quantity,
      server: observation.source.operation.serverId,
    })),
    requirements: snapshot.requirements.length,
    violations: snapshot.violations.length,
    verdict: "unavailable-no-model-owned-mechanical-criterion",
    path: store.pathFor(snapshot.id),
  },
  null,
  2,
));

function uniqueBinding(
  value: typeof manifest,
  provider: string,
  kind: string,
) {
  const matches = value.bindings.filter((binding) =>
    binding.provider === provider && binding.kind === kind
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one ${provider}:${kind} subject binding; received ${matches.length}.`,
    );
  }
  return matches[0];
}

async function latestJson(directory: string): Promise<string> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(directory)) {
    if (entry.isFile && entry.name.endsWith(".json")) names.push(entry.name);
  }
  const name = names.sort().at(-1);
  if (!name) throw new Error(`No JSON capture found in ${directory}.`);
  return `${directory}/${name}`;
}

async function persistCapture(
  directory: string,
  capturedAt: string,
  value: unknown,
): Promise<string> {
  await Deno.mkdir(directory, { recursive: true });
  const path = `${directory}/${capturedAt.replace(/[-:.]/g, "")}.json`;
  await Deno.writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    createNew: true,
  });
  return path;
}

function later(left: string, right: string): string {
  return left.localeCompare(right) >= 0 ? left : right;
}

async function applyAndPersist(
  base: ThreadSnapshot,
  extension: ThreadSnapshotExtension,
  options: { appliedAt?: string } = {},
): Promise<ThreadSnapshot> {
  const result = applyThreadSnapshotExtensionIfNew(base, extension, options);
  if (result.applied) await store.save(result.snapshot);
  return result.snapshot;
}
