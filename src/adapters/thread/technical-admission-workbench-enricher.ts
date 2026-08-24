/**
 * BFF-only reopen of sealed compile.seal-admission@3 documents.
 *
 * The thread-workbench projector stays pure. This enricher rereads CAS after
 * projection, paints uniquely parameterized CAD levers, and recrosses exact
 * project source files onto the current architecture basis and named
 * workspace revision. A missing, unreadable or mismatched seal adds nothing.
 */

import type {
  ThreadArtifact,
  ThreadWorkbenchSnapshot,
} from "../../presentation/workbench/thread/snapshot.ts";
import {
  listSealedAdmissionCadLevers,
  listSealedAdmissionUnnamedCadLiterals,
  type SealedAdmissionCadLever,
  type SealedAdmissionUnnamedCadLiteral,
} from "../../domain/compile/admission/sealed-cad-levers.ts";
import type { NamedCadLeverBinding } from "../../domain/compile/source/named-cad-levers.ts";
import { COMPILE_SEAL_ADMISSION_OPERATION } from "../../domain/compile/admission/technical-compilation-proposal.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type { ProjectSourceWorkspaceEventStore } from "../../application/ports/out/project-source-workspace/project-source-workspace-event-store.ts";
import type { ProjectSourceWorkspaceState } from "../../domain/project-source-workspace/types.ts";
import {
  TECHNICAL_COMPILATION_ADMISSION_CAPTURE_URI_PREFIX,
  type TechnicalCompilationAdmissionCapture,
  validateTechnicalCompilationAdmissionCapture,
} from "../compile/executors/compile-seal-admission-run-executor.ts";
import {
  projectSealedCadLeverGraph,
  projectSealedUnnamedCadLiteralGraph,
} from "./sealed-cad-lever-graph.ts";
import { recrossTechnicalAdmissionSourceFiles } from "./technical-admission-source-files.ts";
import { projectTechnicalAdmissionSourceFileGraph } from "./technical-admission-source-file-graph.ts";
import { currentArchitectureArtifact } from "./thread-workbench-architecture-basis.ts";
import {
  THREAD_SOURCE_FILE_CATALOG_SCHEMA,
  type ThreadSourceFileCatalog,
  type ThreadSourceFileRecord,
  unattachedThreadSourceFileCatalog,
  unavailableThreadSourceFileCatalog,
} from "../../presentation/workbench/thread/source-files.ts";

const ADMISSION_ID = /^technical-compilation-admission-([0-9a-f]{64})$/;
const PROJECTED_FINGERPRINT = /^sha256:([0-9a-f]{64})$/;
const PRODUCER =
  `${COMPILE_SEAL_ADMISSION_OPERATION.id}@${COMPILE_SEAL_ADMISSION_OPERATION.version}` as const;

export interface SealedCadLeverAdmissionReader {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export interface TechnicalAdmissionWorkbenchEnricherDependencies {
  readonly admissions: SealedCadLeverAdmissionReader;
  readonly workspace?: Pick<
    ProjectSourceWorkspaceEventStore,
    "load" | "loadAtFresh"
  >;
}

export async function enrichThreadWorkbenchWithTechnicalAdmissions(
  snapshot: ThreadWorkbenchSnapshot,
  dependencies: TechnicalAdmissionWorkbenchEnricherDependencies,
  context: { readonly projectId?: string } = {},
): Promise<ThreadWorkbenchSnapshot> {
  const levers: SealedAdmissionCadLever[] = [];
  const unnamed: SealedAdmissionUnnamedCadLiteral[] = [];
  const sourceFiles: ThreadSourceFileRecord[] = [];
  let attemptedSourceRecross = false;
  const architecture = currentArchitectureArtifact(snapshot);
  const workspaceByRevision = new Map<string, ProjectSourceWorkspaceState>();

  for (const artifact of snapshot.artifacts) {
    const identity = admissionIdentity(artifact);
    if (!identity) continue;
    const opened = await reopenAdmission(
      artifact.id,
      identity.fingerprint,
      dependencies.admissions,
    );
    if (opened === undefined) continue;
    levers.push(...opened.levers);
    unnamed.push(...opened.unnamed);
    attemptedSourceRecross = true;
    const named = opened.capture.admission.sources[0]?.sourceClosure;
    const workspace = await loadExactWorkspace(
      dependencies.workspace,
      named?.projectId ?? context.projectId,
      named?.workspaceRevision,
      workspaceByRevision,
    );
    sourceFiles.push(
      ...recrossTechnicalAdmissionSourceFiles({
        facts: {
          admissionArtifactId: artifact.id,
          architecture: opened.capture.admission.basis.sysml,
          sources: opened.capture.admission.sources.map((source) => ({
            id: source.id,
            role: source.role,
            language: source.language,
            profileId: source.profileId,
            attachment: source.attachment,
            sourceClosure: source.sourceClosure,
          })),
          bindings: opened.capture.admission.bindings,
        },
        currentArchitecture: architecture,
        workspaceHead: workspace?.head,
        workspaceAtNamedRevision: workspace?.named,
        projectId: context.projectId,
      }),
    );
  }

  const withLevers = projectSealedCadLeverGraph(snapshot.graph, levers);
  const withLiterals = projectSealedUnnamedCadLiteralGraph(withLevers, unnamed);
  const graph = projectTechnicalAdmissionSourceFileGraph(
    withLiterals,
    sourceFiles,
  );
  const catalog = dependencies.workspace
    ? sourceFileCatalog(attemptedSourceRecross, sourceFiles)
    : undefined;
  if (
    graph === snapshot.graph &&
    sameSourceFileCatalog(snapshot.sourceFiles, catalog)
  ) {
    return snapshot;
  }
  return catalog
    ? { ...snapshot, graph, sourceFiles: catalog }
    : { ...snapshot, graph };
}

export async function enrichThreadWorkbenchWithSealedCadLevers(
  snapshot: ThreadWorkbenchSnapshot,
  admissions: SealedCadLeverAdmissionReader,
): Promise<ThreadWorkbenchSnapshot> {
  return await enrichThreadWorkbenchWithTechnicalAdmissions(snapshot, {
    admissions,
  });
}

async function reopenAdmission(
  admissionArtifactId: string,
  fingerprint: ContentFingerprint,
  admissions: SealedCadLeverAdmissionReader,
): Promise<
  | {
    readonly capture: TechnicalCompilationAdmissionCapture;
    readonly levers: readonly SealedAdmissionCadLever[];
    readonly unnamed: readonly SealedAdmissionUnnamedCadLiteral[];
  }
  | undefined
> {
  let text: string | undefined;
  try {
    text = await admissions.read(fingerprint);
  } catch {
    return undefined;
  }
  if (text === undefined) return undefined;
  try {
    const capture = await validateTechnicalCompilationAdmissionCapture(
      JSON.parse(text),
    );
    const input = {
      admissionArtifactId,
      sources: capture.document.inputManifest.sources,
      bindings: capture.document.inputManifest.bindings.map(toNamedBinding),
    };
    return {
      capture,
      levers: listSealedAdmissionCadLevers(input),
      unnamed: listSealedAdmissionUnnamedCadLiterals(input),
    };
  } catch {
    return undefined;
  }
}

async function loadExactWorkspace(
  store: TechnicalAdmissionWorkbenchEnricherDependencies["workspace"],
  projectId: string | undefined,
  workspaceRevision: number | undefined,
  cache: Map<string, ProjectSourceWorkspaceState>,
): Promise<
  | {
    readonly head: ProjectSourceWorkspaceState;
    readonly named: ProjectSourceWorkspaceState;
  }
  | undefined
> {
  if (!store || !projectId || workspaceRevision === undefined) return undefined;
  try {
    const head = await loadCached(
      cache,
      `head:${projectId}`,
      () => store.load(projectId),
    );
    const named = await loadCached(
      cache,
      `named:${projectId}:${workspaceRevision}`,
      () => store.loadAtFresh(projectId, workspaceRevision),
    );
    return { head, named };
  } catch {
    return undefined;
  }
}

async function loadCached(
  cache: Map<string, ProjectSourceWorkspaceState>,
  key: string,
  load: () => Promise<ProjectSourceWorkspaceState>,
): Promise<ProjectSourceWorkspaceState> {
  const existing = cache.get(key);
  if (existing) return existing;
  const loaded = await load();
  cache.set(key, loaded);
  return loaded;
}

function sourceFileCatalog(
  attempted: boolean,
  files: readonly ThreadSourceFileRecord[],
): ThreadSourceFileCatalog {
  if (files.length > 0) {
    return {
      schemaVersion: THREAD_SOURCE_FILE_CATALOG_SCHEMA,
      status: "observed",
      files: [...files].sort((left, right) =>
        left.fileId.localeCompare(right.fileId) ||
        left.fileRevision - right.fileRevision
      ),
    };
  }
  return attempted
    ? unattachedThreadSourceFileCatalog()
    : unavailableThreadSourceFileCatalog();
}

function sameSourceFileCatalog(
  left: ThreadSourceFileCatalog | undefined,
  right: ThreadSourceFileCatalog | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.status === right.status &&
    left.files.length === right.files.length &&
    left.files.every((file, index) => file === right.files[index]);
}

function toNamedBinding(
  binding: {
    readonly id: string;
    readonly sourceId: string;
    readonly sourceSymbolId: string;
    readonly sysmlElementId: string;
    readonly relation: string;
  },
): NamedCadLeverBinding {
  return {
    id: binding.id,
    sourceId: binding.sourceId,
    sourceSymbolId: binding.sourceSymbolId,
    sysmlElementId: binding.sysmlElementId,
    relation: binding.relation,
  };
}

function admissionIdentity(artifact: ThreadArtifact): {
  readonly fingerprint: ContentFingerprint;
} | undefined {
  const idMatch = ADMISSION_ID.exec(artifact.id);
  const fingerprintMatch = artifact.fingerprint
    ? PROJECTED_FINGERPRINT.exec(artifact.fingerprint)
    : null;
  if (
    !idMatch || !fingerprintMatch || artifact.kind !== "document" ||
    artifact.producedBy !== PRODUCER ||
    artifact.uri !==
      `${TECHNICAL_COMPILATION_ADMISSION_CAPTURE_URI_PREFIX}${fingerprintMatch[1]}` ||
    idMatch[1] !== fingerprintMatch[1]
  ) {
    return undefined;
  }
  return {
    fingerprint: {
      algorithm: "sha256",
      digest: fingerprintMatch[1]!,
    },
  };
}
