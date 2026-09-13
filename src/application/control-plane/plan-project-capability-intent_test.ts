import { assertEquals } from "@std/assert";
import {
  MANUFACTURING_RUN_DFM_CHECKS_CAPABILITY,
  MECHANICS_SOLVE_STATIC_STRUCTURAL_CAPABILITY,
  MODEL_AUTHOR_SYSTEM_CAPABILITY,
  MODEL_EVALUATE_REQUIREMENT_CAPABILITY,
  type RequiredEngineeringCapability,
} from "../../domain/capability/engineering-capability.ts";
import {
  fingerprintProjectCapabilityAuthorizationEvent,
  reconstructProjectCapabilityEffectiveEnvelope,
} from "../../domain/capability/project-capability-authorization.ts";
import { createFirstPartyCapabilityRuntimeCatalog } from "../../adapters/control-plane/first-party-capability-binding-catalog.ts";
import {
  CAPABILITY_RUNTIME_ADMIN_LOCK_SCHEMA_VERSION,
  CAPABILITY_RUNTIME_ADMIN_POLICY_SCHEMA_VERSION,
  CAPABILITY_RUNTIME_HOST_OBSERVATION_SCHEMA_VERSION,
} from "../../domain/capability/runtime/capability-runtime-catalog.ts";
import {
  validateCapabilityRuntimeAdminLock,
  validateCapabilityRuntimeAdminPolicy,
  validateCapabilityRuntimeHostObservation,
} from "../../adapters/control-plane/capability-runtime-catalog.ts";
import {
  planProjectCapabilityRequirementsProposal,
  projectCapabilityEnvelopeDelta,
} from "./plan-project-capability-intent.ts";

const BASE_REQUIREMENTS: readonly RequiredEngineeringCapability[] = [
  {
    ...MODEL_EVALUATE_REQUIREMENT_CAPABILITY,
    use: "execution",
    minimumQualification: "qualified",
  },
  {
    ...MODEL_AUTHOR_SYSTEM_CAPABILITY,
    use: "execution",
    minimumQualification: "qualified",
  },
  {
    ...MECHANICS_SOLVE_STATIC_STRUCTURAL_CAPABILITY,
    use: "execution",
    minimumQualification: "qualified",
  },
];

const DFM_REQUIREMENT: RequiredEngineeringCapability = {
  ...MANUFACTURING_RUN_DFM_CHECKS_CAPABILITY,
  use: "execution",
  minimumQualification: "qualified",
};

Deno.test(
  "adding catalogued DFM onto the live ID01 envelope reconstructs the exact successor",
  async () => {
    let ledgerJson: string;
    try {
      ledgerJson = await Deno.readTextFile(
        "state/local/project-capability-ledgers/inspection-drone-id01/0000000004.json",
      );
    } catch {
      return;
    }
    const ledger = JSON.parse(ledgerJson) as {
      events: Parameters<typeof reconstructProjectCapabilityEffectiveEnvelope>[0];
    };
    const current = await reconstructProjectCapabilityEffectiveEnvelope(ledger.events);
    if (!current) throw new Error("live ledger has no envelope");
    const catalog = await createFirstPartyCapabilityRuntimeCatalog();
    const ctx = await planningContext(catalog);
    const successor = await planProjectCapabilityRequirementsProposal({
      ...ctx,
      source: "published-plan",
      brief: current.proposal.brief,
      intent: current.proposal.intent,
      requirements: [
        ...current.proposal.semanticRequirements,
        DFM_REQUIREMENT,
      ],
      unresolvedBlockers: [],
    });
    const delta = projectCapabilityEnvelopeDelta(current.proposal, successor);
    try {
      await reconstructProjectCapabilityEffectiveEnvelope([
        ...ledger.events,
        await event({
          kind: "amendment-authorized" as const,
          recordedAt: "2026-09-12T00:00:03.000Z",
          previousEnvelopeFingerprint: current.effectiveEnvelopeFingerprint,
          proposalFingerprint: successor.capabilityProposalFingerprint,
          delta,
        }),
      ]);
    } catch (error) {
      await Deno.writeTextFile(
        "/var/folders/8z/7c5x0xvj47lbnm8rb3n_8_9m0000gn/T/grok-goal-0ed5a9e9956e/implementer/amend-successor-dump.json",
        JSON.stringify(
          {
            successorFp: successor.capabilityProposalFingerprint,
            successorReqs: successor.semanticRequirements.map((item) => item.id),
            successorUnits: successor.units.map((item) => item.id),
            successorPorts: successor.effects.loopbackPorts,
            successorBlockers: successor.blockers,
            successorStatus: successor.status,
            addedUnits: delta.units.addedIds,
            changedUnits: delta.units.changedIds,
            addedReqs: delta.addedRequirementKeys,
          },
          null,
          2,
        ),
      );
      throw error;
    }
  },
);

Deno.test(
  "adding catalogued DFM to a first-party envelope reconstructs the exact successor",
  async () => {
    const catalog = await createFirstPartyCapabilityRuntimeCatalog();
    const ctx = await planningContext(catalog);
    const initial = await planProjectCapabilityRequirementsProposal({
      ...ctx,
      source: "brief-intent",
      requirements: BASE_REQUIREMENTS,
      unresolvedBlockers: [],
    });
    const successor = await planProjectCapabilityRequirementsProposal({
      ...ctx,
      source: "published-plan",
      requirements: [DFM_REQUIREMENT, ...BASE_REQUIREMENTS],
      unresolvedBlockers: [],
    });
    const delta = projectCapabilityEnvelopeDelta(initial, successor);
    assertEquals(delta.units.addedIds, ["casys.mcp-dfm"]);
    const prepared = await event({
      kind: "initial-prepared" as const,
      recordedAt: "2026-09-12T00:00:00.000Z",
      proposal: initial,
    });
    const authorized = await event({
      kind: "initial-authorized" as const,
      recordedAt: "2026-09-12T00:00:01.000Z",
      proposalFingerprint: initial.capabilityProposalFingerprint,
      approval: {
        projectSnapshotId: "snapshot",
        projectRevision: 2,
        approvedBriefFingerprint: initial.brief.briefReviewFingerprint,
      },
    });
    const envelope = await reconstructProjectCapabilityEffectiveEnvelope([
      prepared,
      authorized,
    ]);
    const amended = await event({
      kind: "amendment-authorized" as const,
      recordedAt: "2026-09-12T00:00:02.000Z",
      previousEnvelopeFingerprint: envelope!.effectiveEnvelopeFingerprint,
      proposalFingerprint: successor.capabilityProposalFingerprint,
      delta,
    });
    const next = await reconstructProjectCapabilityEffectiveEnvelope([
      prepared,
      authorized,
      amended,
    ]);
    assertEquals(
      next?.proposal.capabilityProposalFingerprint,
      successor.capabilityProposalFingerprint,
    );
  },
);

async function planningContext(
  catalog: Awaited<ReturnType<typeof createFirstPartyCapabilityRuntimeCatalog>>,
) {
  const references = [
    ...new Set(
      catalog.units.flatMap((unit) =>
        unit.materials.map((material) => material.imageReference)
      ),
    ),
  ];
  return {
    projectId: "inspection-drone-id01",
    brief: {
      briefSnapshotId: "brief",
      briefRevision: 7,
      briefReviewFingerprint: {
        algorithm: "sha256" as const,
        digest: "2".repeat(64),
      },
    },
    intent: null,
    catalog,
    policy: validateCapabilityRuntimeAdminPolicy({
      schemaVersion: CAPABILITY_RUNTIME_ADMIN_POLICY_SCHEMA_VERSION,
      disabledBindingIds: [],
      preferences: [],
    }, catalog),
    host: validateCapabilityRuntimeHostObservation({
      schemaVersion: CAPABILITY_RUNTIME_HOST_OBSERVATION_SCHEMA_VERSION,
      identityFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
      platform: "linux/arm64",
      images: references.map((reference) => ({ reference, sizeBytes: null })),
    }),
    lock: await validateCapabilityRuntimeAdminLock({
      schemaVersion: CAPABILITY_RUNTIME_ADMIN_LOCK_SCHEMA_VERSION,
      revision: 1,
      previous: { algorithm: "sha256", digest: "a".repeat(64) },
      units: catalog.units.map((unit) => ({
        id: unit.id,
        version: unit.version,
        manifestFingerprint: unit.manifestFingerprint,
        desired: "active",
      })),
    }, catalog),
  };
}

async function event<T extends object>(body: T) {
  return {
    ...body,
    eventFingerprint: await fingerprintProjectCapabilityAuthorizationEvent(body),
  };
}
