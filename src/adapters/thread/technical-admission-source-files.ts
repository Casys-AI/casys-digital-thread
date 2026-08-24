/**
 * Recross sealed technical-admission sources onto the exact ProjectSourceWorkspace.
 *
 * Architecture and workspace mismatches fail closed: no source-file records
 * are invented from labels, paths or a later workspace head.
 */

import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import { fingerprintsEqual } from "../../domain/kernel/deterministic-json.ts";
import type { TechnicalCompilationAdmissionBinding } from "../../domain/compile/admission/technical-compilation-proposal.ts";
import type { TechnicalProjectSourceAnchor } from "../../domain/compile/admission/technical-source-analysis-capture-locator.ts";
import { recrossTechnicalSourceWorkspace } from "../../domain/compile/admission/technical-source-analysis-capture-locator.ts";
import type { ProjectSourceWorkspaceState } from "../../domain/project-source-workspace/types.ts";
import { derivedFilePath } from "../../domain/project-source-workspace/validation.ts";
import type { ThreadSourceFileRecord } from "../../presentation/workbench/thread/source-files.ts";

export interface TechnicalAdmissionSourceFileFacts {
  readonly admissionArtifactId: string;
  readonly architecture: {
    readonly artifactId: string;
    readonly artifactFingerprint: ContentFingerprint;
  };
  readonly sources: readonly {
    readonly id: string;
    readonly role: "cad-script" | "modelica-model" | "spice-circuit";
    readonly language: "python" | "modelica" | "spice";
    readonly profileId: string;
    readonly projectSource: TechnicalProjectSourceAnchor;
  }[];
  readonly bindings: readonly TechnicalCompilationAdmissionBinding[];
}

export function recrossTechnicalAdmissionSourceFiles(input: {
  readonly facts: TechnicalAdmissionSourceFileFacts;
  readonly currentArchitecture:
    | { readonly artifactId: string; readonly fingerprint: string }
    | undefined;
  readonly workspaceHead: ProjectSourceWorkspaceState | undefined;
  readonly workspaceAtNamedRevision: ProjectSourceWorkspaceState | undefined;
  readonly projectId?: string;
}): readonly ThreadSourceFileRecord[] {
  const { facts } = input;
  if (facts.sources.length === 0) return [];
  if (!sameArchitecture(facts.architecture, input.currentArchitecture)) {
    return [];
  }
  const named = uniqueNamedWorkspace(facts.sources);
  if (!named) return [];
  if (
    input.projectId !== undefined &&
    named.projectId !== input.projectId
  ) {
    return [];
  }
  const head = input.workspaceHead;
  const namedState = input.workspaceAtNamedRevision;
  if (!head || !namedState) return [];
  if (!sameWorkspaceHead(head, named) || !sameWorkspaceHead(namedState, named)) {
    return [];
  }

  const files: ThreadSourceFileRecord[] = [];
  for (const source of facts.sources) {
    try {
      const record = recrossTechnicalSourceWorkspace(namedState, {
        ...source.projectSource,
        profileId: source.profileId,
        role: source.role,
      });
      files.push({
        fileId: record.fileId,
        fileRevision: record.fileRevision,
        workspaceRevision: namedState.workspaceRevision,
        workspaceEventFingerprint: fingerprintText(
          source.projectSource.workspaceEventFingerprint,
        ),
        fileFingerprint: fingerprintText(record.fingerprint),
        resourceFingerprint: fingerprintText(record.resourceRef.fingerprint),
        resourceUri: record.resourceRef.uri,
        resourceName: record.resourceRef.name,
        mimeType: record.resourceRef.mimeType,
        moduleId: record.moduleId,
        role: record.role,
        admissionArtifactId: facts.admissionArtifactId,
        bindings: facts.bindings.flatMap((binding) => {
          if (
            binding.sourceId !== source.id ||
            (binding.relation !== "represents" &&
              binding.relation !== "parameterizes")
          ) return [];
          return [{
            relation: binding.relation,
            sourceSymbolId: binding.sourceSymbolId,
            sysmlElementId: binding.sysmlElementId,
            sysmlElementKind: binding.sysmlElementKind,
          }];
        }),
        derivedPath: derivedFilePath(
          namedState.modules,
          record.moduleId,
          record.logicalName,
        ),
      });
    } catch {
      return [];
    }
  }
  return files;
}

function sameArchitecture(
  expected: TechnicalAdmissionSourceFileFacts["architecture"],
  observed:
    | { readonly artifactId: string; readonly fingerprint: string }
    | undefined,
): boolean {
  return observed !== undefined &&
    observed.artifactId === expected.artifactId &&
    observed.fingerprint === fingerprintText(expected.artifactFingerprint);
}

function uniqueNamedWorkspace(
  sources: TechnicalAdmissionSourceFileFacts["sources"],
): TechnicalProjectSourceAnchor | undefined {
  const first = sources[0]?.projectSource;
  if (!first) return undefined;
  for (const source of sources) {
    const item = source.projectSource;
    if (
      item.projectId !== first.projectId ||
      item.workspaceRevision !== first.workspaceRevision ||
      !fingerprintsEqual(
        item.workspaceEventFingerprint,
        first.workspaceEventFingerprint,
      )
    ) {
      return undefined;
    }
  }
  return first;
}

function sameWorkspaceHead(
  state: ProjectSourceWorkspaceState,
  expected: TechnicalProjectSourceAnchor,
): boolean {
  return state.projectId === expected.projectId &&
    state.workspaceRevision === expected.workspaceRevision &&
    state.lastEventFingerprint !== undefined &&
    fingerprintsEqual(
      state.lastEventFingerprint,
      expected.workspaceEventFingerprint,
    );
}

function fingerprintText(fingerprint: ContentFingerprint): string {
  return `${fingerprint.algorithm}:${fingerprint.digest}`;
}
