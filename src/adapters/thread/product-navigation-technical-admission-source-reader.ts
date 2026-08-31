/**
 * Backend-only technical-admission source recross for product navigation.
 *
 * The generic browser Workbench never reopens admission documents. This
 * adapter exists only for the separate product-navigation evidence reader,
 * where exact source-file attachments are part of the agent read model.
 */

import type { ProjectSourceWorkspaceEventStore } from "../../application/ports/out/project-source-workspace/project-source-workspace-event-store.ts";
import { COMPILE_SEAL_ADMISSION_OPERATION } from "../../domain/compile/admission/technical-compilation-proposal.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type { ProjectSourceWorkspaceState } from "../../domain/project-source-workspace/types.ts";
import type {
  ThreadArtifact,
  ThreadWorkbenchSnapshot,
} from "../../presentation/workbench/thread/snapshot.ts";
import {
  TECHNICAL_COMPILATION_ADMISSION_CAPTURE_URI_PREFIX,
  type TechnicalCompilationAdmissionCapture,
  validateTechnicalCompilationAdmissionCapture,
} from "../compile/executors/compile-seal-admission-run-executor.ts";
import {
  recrossTechnicalAdmissionSourceFiles,
  type TechnicalAdmissionSourceFileRecord,
} from "./technical-admission-source-files.ts";

const ADMISSION_ID = /^technical-compilation-admission-([0-9a-f]{64})$/;
const PROJECTED_FINGERPRINT = /^sha256:([0-9a-f]{64})$/;
const PRODUCER =
  `${COMPILE_SEAL_ADMISSION_OPERATION.id}@${COMPILE_SEAL_ADMISSION_OPERATION.version}` as const;

export interface ProductNavigationTechnicalAdmissionReader {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export interface ProductNavigationTechnicalAdmissionSourceDependencies {
  readonly admissions: ProductNavigationTechnicalAdmissionReader;
  readonly workspace: Pick<
    ProjectSourceWorkspaceEventStore,
    "load" | "loadAtFresh"
  >;
}

export async function readProductNavigationTechnicalAdmissionSources(
  snapshot: ThreadWorkbenchSnapshot,
  dependencies: ProductNavigationTechnicalAdmissionSourceDependencies,
  context: { readonly projectId: string },
): Promise<readonly TechnicalAdmissionSourceFileRecord[]> {
  const files: TechnicalAdmissionSourceFileRecord[] = [];
  const workspaceByRevision = new Map<string, ProjectSourceWorkspaceState>();

  for (const artifact of snapshot.artifacts) {
    const identity = admissionIdentity(artifact);
    if (!identity) continue;
    const capture = await reopenAdmission(
      identity.fingerprint,
      dependencies.admissions,
    );
    if (!capture) continue;
    const named = capture.admission.sources[0]?.sourceClosure;
    const workspace = await loadExactWorkspace(
      dependencies.workspace,
      named?.projectId,
      named?.workspaceRevision,
      workspaceByRevision,
    );
    files.push(
      ...recrossTechnicalAdmissionSourceFiles({
        facts: {
          admissionArtifactId: artifact.id,
          architecture: capture.admission.basis.sysml,
          sources: capture.admission.sources.map((source) => ({
            id: source.id,
            role: source.role,
            language: source.language,
            profileId: source.profileId,
            attachment: source.attachment,
            sourceClosure: source.sourceClosure,
          })),
          bindings: capture.admission.bindings,
        },
        currentArchitecture: currentArchitecture(snapshot, capture),
        workspaceHead: workspace?.head,
        workspaceAtNamedRevision: workspace?.named,
        projectId: context.projectId,
      }),
    );
  }

  return uniqueSourceFiles(files);
}

async function reopenAdmission(
  fingerprint: ContentFingerprint,
  admissions: ProductNavigationTechnicalAdmissionReader,
): Promise<TechnicalCompilationAdmissionCapture | undefined> {
  let text: string | undefined;
  try {
    text = await admissions.read(fingerprint);
  } catch {
    return undefined;
  }
  if (text === undefined) return undefined;
  try {
    return await validateTechnicalCompilationAdmissionCapture(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function currentArchitecture(
  snapshot: ThreadWorkbenchSnapshot,
  capture: TechnicalCompilationAdmissionCapture,
): { readonly artifactId: string; readonly fingerprint: string } | undefined {
  const expected = capture.admission.basis.sysml;
  const fingerprint =
    `${expected.artifactFingerprint.algorithm}:${expected.artifactFingerprint.digest}`;
  const artifact = snapshot.artifacts.find((candidate) =>
    candidate.id === expected.artifactId && candidate.fingerprint === fingerprint
  );
  if (!artifact) return undefined;
  const isCurrent = snapshot.evidenceFamilyGraph.families.some((family) =>
    family.entityKind === "artifact" &&
    family.currentRefs.some((reference) =>
      reference.kind === "artifact" && reference.id === artifact.id
    )
  );
  return isCurrent ? { artifactId: artifact.id, fingerprint } : undefined;
}

async function loadExactWorkspace(
  store: ProductNavigationTechnicalAdmissionSourceDependencies["workspace"],
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
  if (!projectId || workspaceRevision === undefined) return undefined;
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

function uniqueSourceFiles(
  files: readonly TechnicalAdmissionSourceFileRecord[],
): readonly TechnicalAdmissionSourceFileRecord[] {
  const byIdentity = new Map<string, TechnicalAdmissionSourceFileRecord>();
  for (const file of files) {
    const key = `${file.fileId}@${file.fileRevision}`;
    const existing = byIdentity.get(key);
    if (existing && JSON.stringify(existing) !== JSON.stringify(file)) return [];
    byIdentity.set(key, file);
  }
  return [...byIdentity.values()].sort((left, right) =>
    left.fileId.localeCompare(right.fileId) ||
    left.fileRevision - right.fileRevision
  );
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
