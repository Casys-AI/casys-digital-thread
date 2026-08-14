/**
 * BFF-only reopen of sealed architecture SysML Thread documents.
 *
 * The thread-workbench projector stays pure. This enricher reads CAS after
 * projection and never invents Product Structure or SysON part nodes.
 */

import type { ArchitectureSysmlSourceAnalysisReader } from "../../application/ports/out/architecture-sysml-source-analysis-reader.ts";
import type { ArchitectureSysmlSealCaptureReader } from "../../application/ports/out/architecture-sysml-seal-capture-reader.ts";
import type {
  ThreadArchitectureSysmlSealIncidence,
  ThreadArchitectureSysmlSealPresentation,
  ThreadArtifact,
  ThreadWorkbenchSnapshot,
} from "../../contracts/thread-workbench.ts";
import type { SourceAnalysisDependency } from "../../domain/analysis/source-analysis.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import {
  ARCHITECTURE_SYSML_SEAL_CAPTURE_URI_PREFIX,
  validateArchitectureSysmlSealCapture,
} from "../executors/model-seal-architecture-sysml-run-executor.ts";
import { MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION } from "../../domain/engineering/architecture-sysml-seal-proposal.ts";

const SEAL_ID = /^architecture-sysml-seal-([0-9a-f]{64})$/;
const PROJECTED_FINGERPRINT = /^sha256:([0-9a-f]{64})$/;
const PRODUCER =
  `${MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION.id}@${MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION.version}` as const;

export interface ArchitectureSysmlSealWorkbenchEnricherDependencies {
  readonly seals: ArchitectureSysmlSealCaptureReader;
  readonly sources: ArchitectureSysmlSourceAnalysisReader;
}

export async function enrichThreadWorkbenchWithArchitectureSysmlSeals(
  snapshot: ThreadWorkbenchSnapshot,
  dependencies: ArchitectureSysmlSealWorkbenchEnricherDependencies,
): Promise<ThreadWorkbenchSnapshot> {
  let changed = false;
  const artifacts: ThreadArtifact[] = [];
  for (const artifact of snapshot.artifacts) {
    const enriched = await enrichSealArtifact(artifact, dependencies);
    if (enriched !== artifact) changed = true;
    artifacts.push(enriched);
  }
  return changed ? { ...snapshot, artifacts } : snapshot;
}

async function enrichSealArtifact(
  artifact: ThreadArtifact,
  dependencies: ArchitectureSysmlSealWorkbenchEnricherDependencies,
): Promise<ThreadArtifact> {
  const identity = sealIdentity(artifact);
  if (!identity) return artifact;

  let captureText: string | undefined;
  try {
    captureText = await dependencies.seals.read(identity.fingerprint);
  } catch {
    return artifact;
  }
  if (captureText === undefined) return artifact;

  let capture: ReturnType<typeof validateArchitectureSysmlSealCapture>;
  try {
    capture = validateArchitectureSysmlSealCapture(JSON.parse(captureText));
  } catch {
    return artifact;
  }
  if (capture.trustedRunId.length === 0) return artifact;

  const unresolvedConstructs = capture.unresolvedConstructs.map((item) => ({
    id: item.id,
    kind: item.kind,
  }));

  try {
    const reopened = await dependencies.sources.reopen(capture.sourceCapture);
    return {
      ...artifact,
      architectureSysmlSeal: presentation({
        symbolsStatus: "observed",
        symbols: reopened.analysis.symbols.map((symbol) => ({
          id: symbol.id,
          kind: symbol.kind,
          ...(symbol.name === undefined ? {} : { label: symbol.name }),
        })),
        incidences: structuralIncidences(reopened.analysis.dependencies),
        unresolvedConstructs,
      }),
    };
  } catch {
    return {
      ...artifact,
      architectureSysmlSeal: presentation({
        symbolsStatus: "unavailable",
        symbols: [],
        incidences: [],
        unresolvedConstructs,
      }),
    };
  }
}

function structuralIncidences(
  dependencies: readonly SourceAnalysisDependency[],
): ThreadArchitectureSysmlSealIncidence[] {
  return dependencies
    .filter((item) => item.kind === "structural-incidence")
    .map((item) => ({
      id: item.id,
      kind: "structural-incidence",
      fromSymbolId: item.fromSymbolId,
      toSymbolId: item.toSymbolId,
    }));
}

function presentation(
  value: Pick<
    ThreadArchitectureSysmlSealPresentation,
    "symbolsStatus" | "symbols" | "incidences" | "unresolvedConstructs"
  >,
): ThreadArchitectureSysmlSealPresentation {
  return {
    producer: PRODUCER,
    authority: "documentary",
    artifactKind: "document",
    notSyson: true,
    notWriteArchitecture: true,
    notCompilationAdmission: true,
    symbolsStatus: value.symbolsStatus,
    symbols: value.symbols,
    incidences: value.incidences,
    unresolvedConstructs: value.unresolvedConstructs,
  };
}

function sealIdentity(artifact: ThreadArtifact): {
  readonly fingerprint: ContentFingerprint;
} | undefined {
  const idMatch = SEAL_ID.exec(artifact.id);
  const fingerprintMatch = artifact.fingerprint
    ? PROJECTED_FINGERPRINT.exec(artifact.fingerprint)
    : null;
  if (
    !idMatch || !fingerprintMatch || artifact.kind !== "document" ||
    artifact.producedBy !== PRODUCER ||
    artifact.uri !==
      `${ARCHITECTURE_SYSML_SEAL_CAPTURE_URI_PREFIX}${fingerprintMatch[1]}` ||
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
