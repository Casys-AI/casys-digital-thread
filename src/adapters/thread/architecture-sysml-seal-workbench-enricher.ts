/**
 * BFF-only reopen of sealed architecture SysML Thread documents.
 *
 * The thread-workbench projector stays pure. This enricher reads CAS after
 * projection and never invents Product Structure or SysON part nodes.
 */

import type { ArchitectureSysmlSourceAnalysisReader } from "../../application/ports/out/architecture/agent-seal/architecture-sysml-source-analysis-reader.ts";
import type { ArchitectureSysmlSealCaptureReader } from "../../application/ports/out/architecture/agent-seal/architecture-sysml-seal-capture-reader.ts";
import type {
  ThreadArchitectureSysmlSealIncidence,
  ThreadArchitectureSysmlSealPresentation,
  ThreadArchitectureSysmlSealSpan,
  ThreadArchitectureSysmlSealUnresolved,
} from "../../presentation/workbench/thread/architecture.ts";
import type {
  ThreadArtifact,
  ThreadWorkbenchSnapshot,
} from "../../presentation/workbench/thread/snapshot.ts";
import type {
  SourceAnalysisDependency,
  SourceAnalysisSpan,
  SourceAnalysisUnresolvedConstruct,
} from "../../domain/compile/source/source-analysis.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import {
  ARCHITECTURE_SYSML_SEAL_CAPTURE_URI_PREFIX,
  validateArchitectureSysmlSealCapture,
} from "../architecture/agent-seal/architecture-sysml-seal-capture-schema.ts";
import { MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION } from "../../domain/architecture/agent-seal/architecture-sysml-seal-proposal.ts";

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

  const captureUnresolved = capture.unresolvedConstructs.map((item) => ({
    id: item.id,
    kind: item.kind,
  }));

  try {
    const reopened = await dependencies.sources.reopen(capture.sourceCapture);
    return {
      ...artifact,
      architectureSysmlSeal: presentation({
        symbolsStatus: "observed",
        sourceStatus: "observed",
        sourceText: reopened.sourceText,
        symbols: reopened.analysis.symbols.map((symbol) => ({
          id: symbol.id,
          kind: symbol.kind,
          ...(symbol.name === undefined ? {} : { label: symbol.name }),
          ...copiedSpan(symbol.span),
        })),
        incidences: structuralIncidences(reopened.analysis.dependencies),
        unresolvedConstructs: documentaryUnresolved(
          captureUnresolved,
          reopened.analysis.unresolvedConstructs,
        ),
      }),
    };
  } catch {
    return {
      ...artifact,
      architectureSysmlSeal: presentation({
        symbolsStatus: "unavailable",
        sourceStatus: "unavailable",
        symbols: [],
        incidences: [],
        unresolvedConstructs: captureUnresolved,
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
      ...copiedSpan(item.span),
    }));
}

function documentaryUnresolved(
  captureItems: readonly { readonly id: string; readonly kind: string }[],
  analysisItems: readonly SourceAnalysisUnresolvedConstruct[],
): ThreadArchitectureSysmlSealUnresolved[] {
  const byId = new Map(analysisItems.map((item) => [item.id, item]));
  return captureItems.map((item) => {
    const fromAnalysis = byId.get(item.id);
    if (!fromAnalysis) return { id: item.id, kind: item.kind };
    return {
      id: item.id,
      kind: item.kind,
      message: fromAnalysis.message,
      ...copiedSpan(fromAnalysis.span),
    };
  });
}

function copiedSpan(
  span: SourceAnalysisSpan | undefined,
): { readonly span: ThreadArchitectureSysmlSealSpan } | Record<PropertyKey, never> {
  if (span === undefined) return {};
  return {
    span: {
      start: { line: span.start.line, column: span.start.column },
      end: { line: span.end.line, column: span.end.column },
    },
  };
}

function presentation(
  value:
    & Pick<
      ThreadArchitectureSysmlSealPresentation,
      | "symbolsStatus"
      | "sourceStatus"
      | "symbols"
      | "incidences"
      | "unresolvedConstructs"
    >
    & {
      readonly sourceText?: string;
    },
): ThreadArchitectureSysmlSealPresentation {
  return {
    producer: PRODUCER,
    authority: "documentary",
    artifactKind: "document",
    notSyson: true,
    notWriteArchitecture: true,
    notCompilationAdmission: true,
    symbolsStatus: value.symbolsStatus,
    sourceStatus: value.sourceStatus,
    ...(value.sourceText === undefined ? {} : { sourceText: value.sourceText }),
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
