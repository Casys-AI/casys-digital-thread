import { parseArgs } from "./cli.ts";
import {
  projectCoffeeMachineCm01V3GoldenObservation,
} from "../src/adapters/executors/cm01/coffee-machine-cm01-v3-golden-observation.ts";
import { FileEngineeringProjectRevisionStore } from "../src/adapters/stores/engineering-project-store.ts";
import { FileThreadSnapshotStore } from "../src/adapters/stores/file-thread-snapshot-store.ts";
import {
  compareCoffeeMachineCm01V3GoldenReference,
  type GoldenReferenceComparison,
  validateCoffeeMachineCm01V3GoldenReference,
} from "../src/domain/cm01/coffee-machine-cm01-v3-golden-reference.ts";
import type { EngineeringThreadSnapshotRef } from "../src/domain/project/engineering-project.ts";

const RUNS_ROOT = "state/local/cm01-v3-local-runs";
const PROJECT_ID = "coffee-machine-cm01-v3";

export interface FinalizeCoffeeMachineCm01V3LocalOptions {
  /** One existing direct child of state/local/cm01-v3-local-runs/. */
  readonly outputDirectory: string;
  readonly goldenReferencePath?: string;
}

export interface CoffeeMachineCm01V3LocalFinalizationResult {
  readonly status: "completed";
  readonly outputDirectory: string;
  readonly observationPath: string;
  readonly project: {
    readonly id: string;
    readonly subjectId: string;
    readonly revision: number;
    readonly finalSnapshot: EngineeringThreadSnapshotRef;
  };
  readonly comparison: GoldenReferenceComparison;
  readonly note: string;
}

/**
 * Derive the final golden comparison for one already-completed local V3 run.
 *
 * This repair boundary intentionally has no MCP client, provider capture, or
 * project-command dependency. It reads exactly the project and declared head
 * snapshot stored below the supplied run directory, then writes only the two
 * immutable derived result documents. It never discovers a run directory,
 * follows a `latest` ThreadSnapshot, or falls back to another local run.
 */
export async function finalizeCoffeeMachineCm01V3Local(
  options: FinalizeCoffeeMachineCm01V3LocalOptions,
): Promise<CoffeeMachineCm01V3LocalFinalizationResult> {
  const outputDirectory = requireFinalizerOutputDirectory(options.outputDirectory);
  await requireExistingDirectRunDirectory(outputDirectory);

  const projects = new FileEngineeringProjectRevisionStore(
    `${outputDirectory}/projects`,
  );
  const project = await projects.get(PROJECT_ID);
  if (!project) {
    throw new Error(
      `CM-01 V3 project ${PROJECT_ID} is absent from ${outputDirectory}.`,
    );
  }
  const finalSnapshot = declaredFinalSnapshot(project.threadSnapshots);
  const snapshots = new FileThreadSnapshotStore(
    `${outputDirectory}/thread-snapshots`,
  );
  const snapshot = await snapshots.get(finalSnapshot.snapshotId);
  if (!snapshot) {
    throw new Error(
      `Declared final ThreadSnapshot ${finalSnapshot.snapshotId} is absent from ${outputDirectory}.`,
    );
  }
  if (
    snapshot.revision !== finalSnapshot.revision ||
    snapshot.subject.id !== finalSnapshot.subjectId
  ) {
    throw new Error(
      `Declared final ThreadSnapshot ${finalSnapshot.snapshotId} does not match its project reference.`,
    );
  }

  const observation = projectCoffeeMachineCm01V3GoldenObservation({
    project,
    finalSnapshot: snapshot,
  });
  const comparison = compareCoffeeMachineCm01V3GoldenReference(
    validateCoffeeMachineCm01V3GoldenReference(
      JSON.parse(
        await Deno.readTextFile(
          options.goldenReferencePath ??
            "config/golden-references/coffee-machine-cm01-v3.json",
        ),
      ),
    ),
    observation,
  );
  const observationPath = `${outputDirectory}/golden-observation.json`;
  const result: CoffeeMachineCm01V3LocalFinalizationResult = {
    status: "completed",
    outputDirectory,
    observationPath,
    project: {
      id: project.project.id,
      subjectId: project.project.subjectId,
      revision: project.revision,
      finalSnapshot,
    },
    comparison,
    note:
      "Technical local integration evidence only. The explicit fixture approval is not a production human-review record, and a matching comparison is not certification or manufacturing release.",
  };

  await writeExactDerivedResult(observationPath, observation);
  await writeExactDerivedResult(`${outputDirectory}/run-summary.json`, result);
  return result;
}

/** Reject aliases, parent traversal, nested paths, and paths outside V3 runs. */
export function requireFinalizerOutputDirectory(value: string): string {
  if (value.trim() === "") throw new Error("outputDirectory must not be empty.");
  const normalized = value.trim().replace(/\/+$/, "");
  const prefix = `${RUNS_ROOT}/`;
  if (!normalized.startsWith(prefix)) {
    throw new Error(`outputDirectory must be a direct child of ${RUNS_ROOT}.`);
  }
  const child = normalized.slice(prefix.length);
  if (
    child === "" || child === "." || child === ".." || child.includes("/") ||
    child.includes("\\")
  ) {
    throw new Error(`outputDirectory must be a direct child of ${RUNS_ROOT}.`);
  }
  return `${RUNS_ROOT}/${child}`;
}

async function requireExistingDirectRunDirectory(directory: string): Promise<void> {
  const entry = await Deno.lstat(directory);
  if (!entry.isDirectory || entry.isSymlink) {
    throw new Error(
      `outputDirectory must be an existing non-symlink directory: ${directory}.`,
    );
  }
}

function declaredFinalSnapshot(
  references: readonly EngineeringThreadSnapshotRef[],
): EngineeringThreadSnapshotRef {
  if (references.length === 0) {
    throw new Error("CM-01 V3 project declares no ThreadSnapshot.");
  }
  const headRevision = Math.max(...references.map((reference) => reference.revision));
  const heads = references.filter((reference) => reference.revision === headRevision);
  if (heads.length !== 1) {
    throw new Error("CM-01 V3 project has no unique declared final ThreadSnapshot.");
  }
  return heads[0]!;
}

async function writeExactDerivedResult(path: string, value: unknown): Promise<void> {
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  try {
    await Deno.writeTextFile(path, contents, { createNew: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    const existing = await Deno.readTextFile(path);
    if (existing !== contents) {
      throw new Error(`Refusing to overwrite a different derived result at ${path}.`);
    }
  }
}

if (import.meta.main) {
  const args = parseArgs(Deno.args);
  const outputDirectory = args["output-dir"];
  if (!outputDirectory) {
    throw new Error(
      "Usage: deno task thread:finalize-coffee-machine-cm01-v3-local --output-dir=state/local/cm01-v3-local-runs/<run>.",
    );
  }
  const result = await finalizeCoffeeMachineCm01V3Local({ outputDirectory });
  console.log(JSON.stringify(result, null, 2));
  if (!result.comparison.matches) Deno.exitCode = 1;
}
