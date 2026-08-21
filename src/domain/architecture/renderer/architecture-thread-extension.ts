/**
 * Deterministic Thread extension for a sealed generic architecture capture.
 *
 * Construction only: IDs, provenance order and artifact bytes stay exactly
 * as the executor published them. This module does not sort, rename or
 * reconstruct provider identities.
 */

import type {
  ArchitectureProposal,
  ExistingArchitectureStructure,
} from "./architecture-proposal.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadFreshness,
  ThreadOperationRef,
  ThreadSnapshot,
} from "../../thread/thread-snapshot.ts";
import type { ThreadSnapshotExtension } from "../../thread/thread-snapshot-extension.ts";

export function buildArchitectureThreadExtension(options: {
  base: ThreadSnapshot;
  seedArtifact: ThreadArtifact;
  previousArchitectureArtifact: ThreadArtifact | undefined;
  /** Finding 6 — fingerprint recomputed from the bytes actually read, not copied
   * from the snapshot record. Proves a real byte-level verification occurred. */
  seedVerifiedFingerprint: ContentFingerprint;
  runId: string;
  capturedAt: string;
  captureFp: ContentFingerprint;
  captureUri: string;
  architectureProposal: ArchitectureProposal;
  verified: ExistingArchitectureStructure;
}): ThreadSnapshotExtension {
  const {
    base,
    seedArtifact,
    previousArchitectureArtifact,
    seedVerifiedFingerprint,
    runId,
    capturedAt,
    captureFp,
    captureUri,
    architectureProposal,
    verified,
  } = options;

  const artifactId = `architecture-${captureFp.digest}`;
  const freshness: ThreadFreshness = {
    status: "fresh",
    changedAt: capturedAt,
    invalidatedByChangeIds: [],
  };
  const producer: ThreadOperationRef = {
    serverId: "syson",
    tool: "syson_element_insert_sysml",
    runId,
  };

  const artifact: ThreadArtifact = {
    id: artifactId,
    name: `Architecture: ${architectureProposal.packageName}`,
    kind: "sysml-model",
    version: captureFp.digest,
    fingerprint: captureFp,
    uri: captureUri,
    mediaType: "application/json",
    producer,
    inputArtifactIds: [
      seedArtifact.id,
      ...(previousArchitectureArtifact ? [previousArchitectureArtifact.id] : []),
    ],
    freshness,
  };

  const extensionId = `model-write-architecture-${captureFp.digest}`;

  const consumptionId = `consume-${seedArtifact.id}-by-${artifactId}`;
  const consumption: ThreadArtifactConsumption = {
    id: consumptionId,
    artifactId: seedArtifact.id,
    consumer: producer,
    observedFingerprint: seedVerifiedFingerprint,
    verifiedAt: capturedAt,
    status: "verified",
  };
  const predecessorConsumption = previousArchitectureArtifact
    ? {
      id: `consume-${previousArchitectureArtifact.id}-by-${artifactId}`,
      artifactId: previousArchitectureArtifact.id,
      consumer: producer,
      observedFingerprint: previousArchitectureArtifact.fingerprint,
      verifiedAt: capturedAt,
      status: "verified" as const,
    }
    : undefined;

  const provenance = [
    {
      id: `derived-from-seed-${captureFp.digest}`,
      relation: "derived_from" as const,
      from: { kind: "artifact" as const, id: artifactId },
      to: { kind: "artifact" as const, id: seedArtifact.id },
      rationale:
        "The architecture package was inserted into the SysON model container " +
        "created by the seed run.",
    },
    ...(previousArchitectureArtifact
      ? [{
        id: `derived-from-architecture-${captureFp.digest}`,
        relation: "derived_from" as const,
        from: { kind: "artifact" as const, id: artifactId },
        to: { kind: "artifact" as const, id: previousArchitectureArtifact.id },
        rationale:
          "The exact previous generic architecture capture was re-read as the predecessor of this enrichment.",
      }, {
        id: `uses-${predecessorConsumption!.id}`,
        relation: "uses" as const,
        from: { kind: "consumption" as const, id: predecessorConsumption!.id },
        to: { kind: "artifact" as const, id: previousArchitectureArtifact.id },
        rationale:
          "The executor re-read the exact previous generic architecture capture before enriching it.",
      }]
      : []),
    {
      id: `uses-${consumptionId}`,
      relation: "uses" as const,
      from: { kind: "consumption" as const, id: consumptionId },
      to: { kind: "artifact" as const, id: seedArtifact.id },
      rationale: "The executor re-read the exact seed capture before inserting the " +
        "architecture package.",
    },
  ];

  return {
    id: extensionId,
    name: `Generic architecture: ${architectureProposal.packageName}`,
    subjectId: base.subject.id,
    capturedAt,
    artifacts: [artifact],
    consumptions: [
      consumption,
      ...(predecessorConsumption ? [predecessorConsumption] : []),
    ],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance,
    proposedActions: [],
    bindingProofs: [
      {
        provider: "syson",
        kind: "package",
        id: verified.packageId,
      },
    ],
  };
}
