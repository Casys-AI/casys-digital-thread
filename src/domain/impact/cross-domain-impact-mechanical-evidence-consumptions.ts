/**
 * Exact mechanical evidence consumption star.
 *
 * The Thread consumptions whose consumer identity equals the evidence
 * producer are the exhaustive actual set. Independence assertions must name
 * that set exactly. This never invents a causal edge.
 */

import { deterministicJson, fingerprintsEqual } from "../kernel/deterministic-json.ts";
import type {
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadOperationRef,
} from "../thread/thread-snapshot.ts";
import type {
  CrossDomainImpactInspectedConsumption,
  CrossDomainImpactReference,
} from "./cross-domain-impact-manifest.ts";

export interface ExactMechanicalProducerConsumption {
  readonly id: string;
  readonly consumerEvidence: CrossDomainImpactReference;
  readonly input: CrossDomainImpactReference;
}

export function recrossExactMechanicalProducerConsumptions(input: {
  readonly producer: ThreadOperationRef;
  readonly evidence: CrossDomainImpactReference;
  readonly inspected: readonly CrossDomainImpactInspectedConsumption[];
  readonly consumptions: readonly ThreadArtifactConsumption[];
  readonly artifacts: readonly ThreadArtifact[];
  readonly archived: ReadonlySet<string>;
}): readonly ExactMechanicalProducerConsumption[] | undefined {
  if (input.inspected.length === 0) return undefined;
  const producerKey = deterministicJson(input.producer);
  const actual = input.consumptions.filter((item) =>
    deterministicJson(item.consumer) === producerKey
  );
  if (actual.length === 0) return undefined;
  if (new Set(actual.map((item) => item.id)).size !== actual.length) {
    return undefined;
  }

  const recrossed: ExactMechanicalProducerConsumption[] = [];
  for (const consumption of actual) {
    if (consumption.status !== "verified") return undefined;
    const matches = input.artifacts.filter((artifact) =>
      artifact.id === consumption.artifactId
    );
    if (matches.length !== 1) return undefined;
    const artifact = matches[0]!;
    if (
      input.archived.has(`artifact:${artifact.id}`) ||
      artifact.freshness.status !== "fresh" ||
      !fingerprintsEqual(artifact.fingerprint, consumption.observedFingerprint)
    ) {
      return undefined;
    }
    recrossed.push({
      id: consumption.id,
      consumerEvidence: input.evidence,
      input: { id: artifact.id, fingerprint: artifact.fingerprint },
    });
  }

  const expected = new Set(
    input.inspected.map((item) => consumptionKey(item.id, item.input)),
  );
  const observed = new Set(
    recrossed.map((item) => consumptionKey(item.id, item.input)),
  );
  if (
    expected.size !== input.inspected.length ||
    observed.size !== recrossed.length ||
    expected.size !== observed.size ||
    [...expected].some((item) => !observed.has(item))
  ) {
    return undefined;
  }

  const byId = new Map(recrossed.map((item) => [item.id, item]));
  return input.inspected.map((item) => byId.get(item.id)!);
}

function consumptionKey(
  id: string,
  input: CrossDomainImpactReference,
): string {
  return `${id}:${input.id}:${input.fingerprint.algorithm}:${input.fingerprint.digest}`;
}
