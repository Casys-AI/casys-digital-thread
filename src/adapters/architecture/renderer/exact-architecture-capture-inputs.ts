/**
 * Exact seed + optional predecessor bijection for generic architecture captures.
 *
 * Shared by the architecture writer ratchet and requirements recapture so a
 * successor cannot claim a Thread predecessor its CAS does not name.
 */

import { EngineeringProjectCommandError } from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import { parseSysonModelSeedCapture } from "../../../domain/architecture/seed/syson-model-seed.ts";
import { MODEL_WRITE_ARCHITECTURE_OPERATION } from "../../../domain/architecture/renderer/architecture-proposal.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import { ARCHITECTURE_CAPTURE_URI_PREFIX } from "../../shared/cas/file-capture-store.ts";
import {
  type ExactArchitectureCapture,
  parseExactArchitectureCapture,
} from "./architecture-capture.ts";
import {
  requireCurrentArchitectureSourceAnalyses,
  type SysmlSourceAnalysisReader,
} from "./sysml-source-analysis-capture.ts";

export type ArchitectureCaptureRole = "predecessor" | "current";

function roleLabel(role: ArchitectureCaptureRole): string {
  return role === "predecessor" ? "predecessor" : "current";
}

export function assertExactGenericArchitectureArtifact(
  artifact: ThreadArtifact,
  capture: ExactArchitectureCapture,
  role: ArchitectureCaptureRole = "predecessor",
): void {
  if (
    artifact.id !== `architecture-${artifact.fingerprint.digest}` ||
    artifact.version !== artifact.fingerprint.digest ||
    artifact.kind !== "sysml-model" ||
    artifact.uri !==
      `${ARCHITECTURE_CAPTURE_URI_PREFIX}sha256/${artifact.fingerprint.digest}` ||
    artifact.mediaType !== "application/json" ||
    artifact.producer.serverId !== "syson" ||
    artifact.producer.tool !== "syson_element_insert_sysml" ||
    capture.trustedRunId !== artifact.producer.runId
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `The ${
        roleLabel(role)
      } architecture capture is not exact architecture-capture/4.0 evidence.`,
    );
  }
}

/**
 * Bind one architecture capture's seed and optional predecessor to its Thread
 * artifact inputs. This is the writer ratchet at
 * model-write-architecture-run-executor.ts (~1912-1968).
 */
export function assertArchitectureCaptureSeedAndInputs(
  snapshot: ThreadSnapshot,
  architectureArtifact: ThreadArtifact,
  capture: ExactArchitectureCapture,
  expectedSeed: ThreadArtifact,
  role: ArchitectureCaptureRole = "predecessor",
): ThreadArtifact | undefined {
  const who = roleLabel(role);
  if (
    capture.seed.artifactId !== expectedSeed.id ||
    !fingerprintsEqual(capture.seed.fingerprint, expectedSeed.fingerprint) ||
    capture.seed.producerRunId !== expectedSeed.producer.runId
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `The ${who} architecture capture does not name the exact SysON seed consumed by its Thread artifact.`,
    );
  }

  const capturePredecessor = capture.predecessor;
  let declaredPredecessor: ThreadArtifact | undefined;
  if (capturePredecessor) {
    declaredPredecessor = snapshot.artifacts.find((artifact) =>
      artifact.id === capturePredecessor.artifactId
    );
    if (
      !declaredPredecessor ||
      declaredPredecessor.kind !== "sysml-model" ||
      declaredPredecessor.uri?.startsWith(ARCHITECTURE_CAPTURE_URI_PREFIX) !==
        true ||
      declaredPredecessor.id !==
        `architecture-${declaredPredecessor.fingerprint.digest}` ||
      declaredPredecessor.version !== declaredPredecessor.fingerprint.digest ||
      declaredPredecessor.uri !==
        `${ARCHITECTURE_CAPTURE_URI_PREFIX}sha256/${declaredPredecessor.fingerprint.digest}` ||
      declaredPredecessor.mediaType !== "application/json" ||
      declaredPredecessor.producer.serverId !== "syson" ||
      declaredPredecessor.producer.tool !== "syson_element_insert_sysml" ||
      !fingerprintsEqual(
        capturePredecessor.fingerprint,
        declaredPredecessor.fingerprint,
      ) ||
      capturePredecessor.producerRunId !== declaredPredecessor.producer.runId
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `The ${who} architecture capture does not name one exact prior architecture artifact.`,
      );
    }
  }

  const expectedInputs = [
    expectedSeed.id,
    ...(declaredPredecessor ? [declaredPredecessor.id] : []),
  ];
  if (
    architectureArtifact.inputArtifactIds.length !== expectedInputs.length ||
    new Set(architectureArtifact.inputArtifactIds).size !==
      architectureArtifact.inputArtifactIds.length ||
    expectedInputs.some((id) => !architectureArtifact.inputArtifactIds.includes(id))
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `The ${who} architecture capture declarations and Thread artifact inputs are not bijective.`,
    );
  }
  return declaredPredecessor;
}

export async function reopenExactArchitectureCapture(
  text: string | undefined,
  artifact: ThreadArtifact,
  role: ArchitectureCaptureRole = "current",
): Promise<ExactArchitectureCapture> {
  const who = roleLabel(role);
  if (!text) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `The ${who} architecture capture is not durably readable.`,
    );
  }
  let record: unknown;
  try {
    record = JSON.parse(text);
  } catch {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `The ${who} architecture capture is invalid JSON.`,
    );
  }
  let capture: ExactArchitectureCapture;
  try {
    capture = parseExactArchitectureCapture(record);
    if (deterministicJson(capture) !== text) {
      throw new Error("capture is not canonical JSON");
    }
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `The ${who} architecture capture is not canonical architecture-capture/4.0 evidence: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (
    !fingerprintsEqual(await sha256Fingerprint(capture), artifact.fingerprint)
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `The ${who} architecture capture is not exact architecture-capture/4.0 evidence.`,
    );
  }
  assertExactGenericArchitectureArtifact(artifact, capture, role);
  return capture;
}

export async function reopenExactSysonSeedCapture(
  text: string | undefined,
  seedArtifact: ThreadArtifact,
): Promise<ReturnType<typeof parseSysonModelSeedCapture>> {
  if (!text) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The SysON seed capture referenced by the architecture capture is not durably readable.",
    );
  }
  let capture: ReturnType<typeof parseSysonModelSeedCapture>;
  try {
    capture = parseSysonModelSeedCapture(JSON.parse(text));
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `The SysON seed capture is not exact: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (
    seedArtifact.kind !== "sysml-model" ||
    seedArtifact.id !== `syson-model-seed-${seedArtifact.fingerprint.digest}` ||
    seedArtifact.version !== seedArtifact.fingerprint.digest ||
    seedArtifact.uri !==
      `casys://syson-model-seed-capture/sha256/${seedArtifact.fingerprint.digest}` ||
    seedArtifact.mediaType !== "application/json" ||
    seedArtifact.producer.serverId !== "syson" ||
    seedArtifact.producer.tool !== "syson_model_create" ||
    seedArtifact.producer.runId !== capture.trustedRunId ||
    !fingerprintsEqual(await sha256Fingerprint(capture), seedArtifact.fingerprint)
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The SysON seed capture does not exactly match its model-container artifact.",
    );
  }
  return capture;
}

export function architecturePartDefinitionUnchanged(
  partDefinitions: ExactArchitectureCapture["partDefinitions"],
  elementId: string,
  label: string,
): boolean {
  const matches = partDefinitions.filter((definition) => definition.id === elementId);
  return matches.length === 1 &&
    matches[0]!.label === label &&
    (matches[0]!.kind === undefined || matches[0]!.kind === "PartDefinition");
}

export async function proveMonotoneArchitectureLineage(input: {
  readonly snapshot: ThreadSnapshot;
  readonly currentArtifact: ThreadArtifact;
  readonly currentCapture: ExactArchitectureCapture;
  readonly historicalArtifact: ThreadArtifact;
  readonly historicalSeed: {
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
    readonly producerRunId: string;
  };
  readonly target: { readonly elementId: string; readonly label: string };
  readonly architectureCaptures: {
    read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  };
  readonly seedCaptures: {
    read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  };
  readonly sysmlSourceAnalysis: SysmlSourceAnalysisReader;
}): Promise<{
  readonly seedArtifact: ThreadArtifact;
  readonly seedCapture: ReturnType<typeof parseSysonModelSeedCapture>;
}> {
  const seedArtifact = input.snapshot.artifacts.find((artifact) =>
    artifact.id === input.currentCapture.seed.artifactId
  );
  if (!seedArtifact) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The current architecture capture does not name the exact SysON seed consumed by its Thread artifact.",
    );
  }
  assertArchitectureCaptureSeedAndInputs(
    input.snapshot,
    input.currentArtifact,
    input.currentCapture,
    seedArtifact,
    "current",
  );
  const seedCapture = await reopenExactSysonSeedCapture(
    await input.seedCaptures.read(seedArtifact.fingerprint),
    seedArtifact,
  );
  if (
    input.currentCapture.seed.artifactId !== input.historicalSeed.artifactId ||
    !fingerprintsEqual(
      input.currentCapture.seed.fingerprint,
      input.historicalSeed.fingerprint,
    ) ||
    input.currentCapture.seed.producerRunId !== input.historicalSeed.producerRunId
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The current architecture seed diverges from the requirements historical architecture seed.",
    );
  }
  await requireCurrentArchitectureSourceAnalyses(
    input.currentCapture.sourceAnalyses,
    input.sysmlSourceAnalysis,
    {
      runId: input.currentArtifact.producer.runId,
      operation: MODEL_WRITE_ARCHITECTURE_OPERATION,
      packageName: input.currentCapture.packageName,
    },
  );
  assertExactGenericArchitectureArtifact(
    input.currentArtifact,
    input.currentCapture,
    "current",
  );
  if (
    !fingerprintsEqual(
      await sha256Fingerprint(input.currentCapture),
      input.currentArtifact.fingerprint,
    )
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The current architecture capture is not exact architecture-capture/4.0 evidence.",
    );
  }
  if (
    !architecturePartDefinitionUnchanged(
      input.currentCapture.partDefinitions,
      input.target.elementId,
      input.target.label,
    )
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "The captured target PartDefinition does not survive unchanged in the current architecture.",
    );
  }

  if (
    input.currentArtifact.id === input.historicalArtifact.id &&
    fingerprintsEqual(
      input.currentArtifact.fingerprint,
      input.historicalArtifact.fingerprint,
    )
  ) {
    return { seedArtifact, seedCapture };
  }

  const seen = new Set<string>([input.currentArtifact.id]);
  let cursorArtifact = input.currentArtifact;
  let cursorCapture = input.currentCapture;
  const budget = input.snapshot.artifacts.length;
  for (let step = 0; step < budget; step++) {
    const declared = cursorCapture.predecessor;
    if (!declared) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The current architecture does not continue the exact monotone architecture chain from the requirements historical architecture.",
      );
    }
    const next = assertArchitectureCaptureSeedAndInputs(
      input.snapshot,
      cursorArtifact,
      cursorCapture,
      seedArtifact,
      cursorArtifact.id === input.currentArtifact.id ? "current" : "predecessor",
    );
    if (!next) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The current architecture does not continue the exact monotone architecture chain from the requirements historical architecture.",
      );
    }
    if (seen.has(next.id)) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The architecture predecessor chain is cyclic.",
      );
    }
    seen.add(next.id);
    const nextCapture = await reopenExactArchitectureCapture(
      await input.architectureCaptures.read(next.fingerprint),
      next,
      "predecessor",
    );
    assertArchitectureCaptureSeedAndInputs(
      input.snapshot,
      next,
      nextCapture,
      seedArtifact,
      "predecessor",
    );
    await requireCurrentArchitectureSourceAnalyses(
      nextCapture.sourceAnalyses,
      input.sysmlSourceAnalysis,
      {
        runId: next.producer.runId,
        operation: MODEL_WRITE_ARCHITECTURE_OPERATION,
        packageName: nextCapture.packageName,
      },
    );
    if (
      !architecturePartDefinitionUnchanged(
        nextCapture.partDefinitions,
        input.target.elementId,
        input.target.label,
      )
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "The captured target PartDefinition is absent from its historical architecture.",
      );
    }
    if (
      next.id === input.historicalArtifact.id &&
      fingerprintsEqual(next.fingerprint, input.historicalArtifact.fingerprint)
    ) {
      return { seedArtifact, seedCapture };
    }
    cursorArtifact = next;
    cursorCapture = nextCapture;
  }
  throw new EngineeringProjectCommandError(
    "invalid_input",
    "The current architecture does not continue the exact monotone architecture chain from the requirements historical architecture.",
  );
}
