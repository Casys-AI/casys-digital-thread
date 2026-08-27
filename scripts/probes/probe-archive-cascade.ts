/**
 * Diagnostic probe for the archive-cascade computation.
 *
 * DIAGNOSTIC ONLY — no writes, no snapshot revisions, no project commands.
 *
 * Reads the current head ThreadSnapshot from state/local/thread-snapshots and
 * computes the downward production closure from one or more nominated targets.
 * Prints a human-readable summary of what would be retired.
 *
 * Usage:
 *   deno task probe:archive-cascade --target=<artifact-id> [--target=<id> ...]
 *   deno task probe:archive-cascade --target=<id> --kind=observation
 *
 * --target=<id>   Entity id to nominate as a retirement seed. Repeatable.
 * --kind=<kind>   ThreadEntityKind for the target (default: artifact).
 *                 Accepted values: artifact | observation | requirement.
 * --snapshot=<id> Exact snapshot id to read. Required unless --project-id is
 *                 provided.
 * --project-id    Project whose latest thread snapshot is read when --snapshot
 *                 is omitted.
 * --projects-dir  Override the project store directory.
 * --snapshots-dir Override the snapshot store directory.
 *
 * WHY A PROBE RATHER THAN A UNIT TEST — the cascade must be exercised against
 * the real local state to validate that entity ids supplied by the operator
 * actually exist in the head snapshot and that the computed closure matches
 * operator expectations before a consequential run is queued.
 */

import { parseArgs } from "../lib/cli.ts";
import {
  computeArchiveCascade,
  renderArchiveCascadeSummary,
  UnknownArchiveTargetError,
} from "../../src/domain/thread/thread-retirement.ts";
import type {
  ThreadEntityKind,
  ThreadEntityRef,
} from "../../src/domain/thread/thread-snapshot.ts";
import { FileEngineeringProjectRevisionStore } from "../../src/adapters/shared/stores/engineering-project-store.ts";
import { FileThreadSnapshotStore } from "../../src/adapters/shared/stores/file-thread-snapshot-store.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PROJECTS_DIR = "state/local/engineering-projects";
const DEFAULT_SNAPSHOTS_DIR = "state/local/thread-snapshots";
/**
 * Only artifacts and requirements are valid DIRECT archive seeds — the
 * cascade reaches observations, evaluations and violations transitively.
 * Accepting other kinds here produced a misleading "does not exist" error
 * for entities that exist but cannot seed a retirement.
 */
const SEED_ENTITY_KINDS: readonly ThreadEntityKind[] = [
  "artifact",
  "requirement",
];

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const rawArgs = parseArgs(Deno.args);

// Accept --target repeatable (Deno parseArgs joins them via _).
// We re-parse directly so --target can appear multiple times.
import { parseArgs as _denoParseArgs } from "@std/cli";

const parsedMulti = _denoParseArgs(Deno.args, { collect: ["target"] });
const targetIds = (parsedMulti["target"] as string[]) ?? [];
const targetKind = (rawArgs["kind"] ?? "artifact") as ThreadEntityKind;
const explicitSnapshot = rawArgs["snapshot"];
const projectId = rawArgs["project-id"];
const projectsDir = rawArgs["projects-dir"] ?? DEFAULT_PROJECTS_DIR;
const snapshotsDir = rawArgs["snapshots-dir"] ?? DEFAULT_SNAPSHOTS_DIR;

if (targetIds.length === 0) {
  console.error(
    "probe:archive-cascade: no targets supplied. Use --target=<id> (repeatable).",
  );
  Deno.exit(1);
}

if (!SEED_ENTITY_KINDS.includes(targetKind)) {
  console.error(
    `probe:archive-cascade: --kind=${targetKind} cannot seed a retirement. ` +
      `Accepted seeds: ${SEED_ENTITY_KINDS.join(", ")} — other kinds are ` +
      `reached transitively by the cascade.`,
  );
  Deno.exit(1);
}

// ---------------------------------------------------------------------------
// Load snapshot
// ---------------------------------------------------------------------------

const snapshots = new FileThreadSnapshotStore(snapshotsDir);

let snapshotId = explicitSnapshot;
if (!snapshotId && projectId) {
  const projects = new FileEngineeringProjectRevisionStore(projectsDir);
  const project = await projects.get(projectId);
  if (!project) {
    console.error(
      `probe:archive-cascade: project "${projectId}" not found in ${projectsDir}.`,
    );
    Deno.exit(1);
  }
  snapshotId = project.threadSnapshots.at(-1)?.snapshotId;
}

if (!snapshotId) {
  console.error(
    "probe:archive-cascade: supply --snapshot=<id> or --project-id=<id> with a " +
      "thread snapshot.",
  );
  Deno.exit(1);
}

const snapshot = await snapshots.get(snapshotId);
if (!snapshot) {
  console.error(`probe:archive-cascade: snapshot "${snapshotId}" not found.`);
  Deno.exit(1);
}

console.log(`Snapshot: ${snapshot.id} (revision ${snapshot.revision})`);
console.log(`Subject:  ${snapshot.subject.id}`);
console.log(
  `Artifacts: ${snapshot.artifacts.length}, ` +
    `Observations: ${snapshot.observations.length}, ` +
    `Evaluations: ${snapshot.evaluations.length}, ` +
    `Violations: ${snapshot.violations.length}`,
);
console.log();

// ---------------------------------------------------------------------------
// Compute cascade
// ---------------------------------------------------------------------------

const targets: ThreadEntityRef[] = targetIds.map((id) => ({ kind: targetKind, id }));

let cascade: Awaited<ReturnType<typeof computeArchiveCascade>>;
try {
  cascade = computeArchiveCascade(snapshot, targets);
} catch (error) {
  if (error instanceof UnknownArchiveTargetError) {
    console.error(
      `probe:archive-cascade: ${error.message}`,
    );
    console.error(
      `  Tip: the --kind flag controls entity type (default: artifact). ` +
        `Check the entity id in the snapshot above.`,
    );
    Deno.exit(1);
  }
  throw error;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

console.log(`Cascade from ${targets.map((t) => `${t.kind}:${t.id}`).join(", ")}:`);
console.log();
console.log(renderArchiveCascadeSummary(cascade));
console.log();
console.log(`Total: ${cascade.length} entity/entities would be retired.`);
