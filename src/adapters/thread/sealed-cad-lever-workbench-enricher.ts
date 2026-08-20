/**
 * BFF-only reopen of sealed compile.seal-admission@1 documents.
 *
 * The thread-workbench projector stays pure. This enricher rereads CAS after
 * projection and paints uniquely parameterized CAD levers onto existing
 * AttributeUsage nodes, plus unnamed constructor literals onto the unique
 * represented PartDefinition. A missing or unreadable seal adds nothing.
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
import {
  TECHNICAL_COMPILATION_ADMISSION_CAPTURE_URI_PREFIX,
  validateTechnicalCompilationAdmissionCapture,
} from "../compile/executors/compile-seal-admission-run-executor.ts";
import {
  projectSealedCadLeverGraph,
  projectSealedUnnamedCadLiteralGraph,
} from "./sealed-cad-lever-graph.ts";

const ADMISSION_ID = /^technical-compilation-admission-([0-9a-f]{64})$/;
const PROJECTED_FINGERPRINT = /^sha256:([0-9a-f]{64})$/;
const PRODUCER =
  `${COMPILE_SEAL_ADMISSION_OPERATION.id}@${COMPILE_SEAL_ADMISSION_OPERATION.version}` as const;

export interface SealedCadLeverAdmissionReader {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export async function enrichThreadWorkbenchWithSealedCadLevers(
  snapshot: ThreadWorkbenchSnapshot,
  admissions: SealedCadLeverAdmissionReader,
): Promise<ThreadWorkbenchSnapshot> {
  const levers: SealedAdmissionCadLever[] = [];
  const unnamed: SealedAdmissionUnnamedCadLiteral[] = [];
  for (const artifact of snapshot.artifacts) {
    const identity = admissionIdentity(artifact);
    if (!identity) continue;
    const opened = await reopenCadFacts(
      artifact.id,
      identity.fingerprint,
      admissions,
    );
    if (opened === undefined) continue;
    levers.push(...opened.levers);
    unnamed.push(...opened.unnamed);
  }
  if (levers.length === 0 && unnamed.length === 0) return snapshot;
  const withLevers = projectSealedCadLeverGraph(snapshot.graph, levers);
  const graph = projectSealedUnnamedCadLiteralGraph(withLevers, unnamed);
  return graph === snapshot.graph ? snapshot : { ...snapshot, graph };
}

async function reopenCadFacts(
  admissionArtifactId: string,
  fingerprint: ContentFingerprint,
  admissions: SealedCadLeverAdmissionReader,
): Promise<
  | {
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
      levers: listSealedAdmissionCadLevers(input),
      unnamed: listSealedAdmissionUnnamedCadLiterals(input),
    };
  } catch {
    return undefined;
  }
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
