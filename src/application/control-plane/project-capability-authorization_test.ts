import { assertEquals, assertRejects } from "@std/assert";
import {
  fingerprintProjectCapabilityAuthorizationEvent,
  fingerprintProjectCapabilityProposal,
  PROJECT_CAPABILITY_PROPOSAL_SCHEMA_VERSION,
  type ProjectCapabilityAuthorizationEvent,
  type ProjectCapabilityProposal,
  reconstructProjectCapabilityEffectiveEnvelope,
} from "./project-capability-authorization.ts";
import {
  projectCapabilityEnvelopeDelta,
  projectCapabilityProposalCovers,
} from "./plan-project-capability-intent.ts";

Deno.test("capability amendment is a structured delta that reconstructs only the exact successor", async () => {
  const initial = await proposal("brief-intent", []);
  const successor = await proposal("published-plan", [{
    id: "geometry.observe-assembly-integrity",
    version: "1",
    minimumQualification: "qualified",
    use: "execution",
  }]);
  const delta = projectCapabilityEnvelopeDelta(initial, successor);
  assertEquals(delta.addedRequirementKeys, [
    "geometry.observe-assembly-integrity\u00001\u0000execution",
  ]);
  assertEquals(delta.bindingReplacements[0]?.next?.candidate?.id, "assembly-observer");
  assertEquals(delta.units, {
    addedIds: [],
    removedIds: [],
    changedIds: [],
    added: [],
    changed: [],
  });
  assertEquals(delta.effects.downloadBytes, { previous: 0, next: 0, delta: 0 });

  const prepared = await event({
    kind: "initial-prepared" as const,
    recordedAt: "2026-08-29T00:00:00.000Z",
    proposal: initial,
  });
  const authorized = await event({
    kind: "initial-authorized" as const,
    recordedAt: "2026-08-29T00:00:01.000Z",
    proposalFingerprint: initial.capabilityProposalFingerprint,
    approval: {
      projectSnapshotId: "snapshot",
      projectRevision: 2,
      approvedBriefFingerprint: initial.brief.briefReviewFingerprint,
    },
  });
  const amended = await event({
    kind: "amendment-authorized" as const,
    recordedAt: "2026-08-29T00:00:02.000Z",
    previousEnvelopeFingerprint: (await reconstructProjectCapabilityEffectiveEnvelope([
      prepared,
      authorized,
    ]))!.effectiveEnvelopeFingerprint,
    proposalFingerprint: successor.capabilityProposalFingerprint,
    delta,
  });
  const envelope = await reconstructProjectCapabilityEffectiveEnvelope([
    prepared,
    authorized,
    amended,
  ]);
  assertEquals(
    envelope?.proposal.capabilityProposalFingerprint,
    successor.capabilityProposalFingerprint,
  );

  const forged = await event({
    ...amended,
    eventFingerprint: undefined,
    delta: { ...delta, addedRequirementKeys: [] },
  });
  await assertRejects(
    () => reconstructProjectCapabilityEffectiveEnvelope([prepared, authorized, forged]),
    TypeError,
    "added requirement",
  );

  const mismatchedApproval = await event({
    kind: "initial-authorized" as const,
    recordedAt: "2026-08-29T00:00:01.100Z",
    proposalFingerprint: initial.capabilityProposalFingerprint,
    approval: {
      projectSnapshotId: "snapshot",
      projectRevision: 2,
      approvedBriefFingerprint: {
        algorithm: "sha256" as const,
        digest: "f".repeat(64),
      },
    },
  });
  await assertRejects(
    () => reconstructProjectCapabilityEffectiveEnvelope([prepared, mismatchedApproval]),
    TypeError,
    "match the prepared brief",
  );

  const revoked = await event({
    kind: "revocation-recorded" as const,
    recordedAt: "2026-08-29T00:00:03.000Z",
    scope: "full-envelope" as const,
    reason: "Test revocation.",
  });
  const repeatedRevocation = await event({
    kind: "revocation-recorded" as const,
    recordedAt: "2026-08-29T00:00:04.000Z",
    scope: "full-envelope" as const,
    reason: "Repeated test revocation.",
  });
  await assertRejects(
    () =>
      reconstructProjectCapabilityEffectiveEnvelope([
        prepared,
        authorized,
        revoked,
        repeatedRevocation,
      ]),
    TypeError,
    "only once",
  );
});

Deno.test("capability ledger grammar permits one prepared initial authority only", async () => {
  const initial = await proposal("brief-intent", []);
  const alternative = await proposal("brief-intent", [{
    id: "geometry.observe-assembly-integrity",
    version: "1",
    minimumQualification: "qualified",
    use: "execution",
  }]);
  const preparedInitial = await event({
    kind: "initial-prepared" as const,
    recordedAt: "2026-08-29T00:00:00.000Z",
    proposal: initial,
  });
  const authorizedInitial = await event({
    kind: "initial-authorized" as const,
    recordedAt: "2026-08-29T00:00:01.000Z",
    proposalFingerprint: initial.capabilityProposalFingerprint,
    approval: {
      projectSnapshotId: "snapshot",
      projectRevision: 2,
      approvedBriefFingerprint: initial.brief.briefReviewFingerprint,
    },
  });
  const preparedAlternative = await event({
    kind: "initial-prepared" as const,
    recordedAt: "2026-08-29T00:00:02.000Z",
    proposal: alternative,
  });
  const revoked = await event({
    kind: "revocation-recorded" as const,
    recordedAt: "2026-08-29T00:00:03.000Z",
    scope: "full-envelope" as const,
    reason: "Administrative test revocation.",
  });

  await assertRejects(
    () =>
      reconstructProjectCapabilityEffectiveEnvelope([
        preparedInitial,
        preparedAlternative,
      ]),
    TypeError,
    "only one initial-prepared",
  );
  await assertRejects(
    () =>
      reconstructProjectCapabilityEffectiveEnvelope([
        preparedInitial,
        authorizedInitial,
        preparedAlternative,
      ]),
    TypeError,
    "only one initial-prepared",
  );
  await assertRejects(
    () =>
      reconstructProjectCapabilityEffectiveEnvelope([
        preparedInitial,
        authorizedInitial,
        revoked,
        preparedAlternative,
      ]),
    TypeError,
    "only one initial-prepared",
  );
});

Deno.test("adding prescribed kinematics later is a Chrono-only semantic amendment", async () => {
  const initial = await proposal("brief-intent", []);
  const chronoRequirement = {
    id: "mechanics.observe-prescribed-kinematics",
    version: "1",
    minimumQualification: "qualified" as const,
    use: "execution" as const,
  };
  const successor = await proposal("published-plan", [chronoRequirement]);
  const delta = projectCapabilityEnvelopeDelta(initial, successor);
  assertEquals(delta.addedRequirementKeys, [
    "mechanics.observe-prescribed-kinematics\u00001\u0000execution",
  ]);
  assertEquals(delta.removedRequirementKeys, []);
  assertEquals(delta.bindingReplacements.map((entry) => entry.requirementKey), [
    "mechanics.observe-prescribed-kinematics\u00001\u0000execution",
  ]);
  // An amendment compares only the changed operational envelope. It neither
  // rewrites the Brief nor invents provider input for an agent.
  assertEquals(initial.brief, successor.brief);
});

Deno.test("capability coverage keeps the exact candidate ceiling while local qualification mode may change", async () => {
  const requirement = {
    id: "geometry.observe-assembly-integrity",
    version: "1",
    minimumQualification: "qualified" as const,
    use: "execution" as const,
  };
  const envelope = await withOperationalMaterial(
    await proposal("brief-intent", [requirement]),
    { mode: "native", downloadBytes: 12, storageBytes: 20 },
  );
  assertEquals(projectCapabilityProposalCovers(envelope, envelope), true);

  const emulated = await withOperationalMaterial(envelope, {
    mode: "emulated",
    downloadBytes: 12,
    storageBytes: 20,
  });
  assertEquals(projectCapabilityProposalCovers(envelope, emulated), true);

  const revisedBytes = await withOperationalMaterial(envelope, {
    mode: "native",
    downloadBytes: 13,
    storageBytes: 20,
  });
  assertEquals(projectCapabilityProposalCovers(envelope, revisedBytes), false);

  const licensed = await withOperationalMaterial(
    envelope,
    { mode: "native", downloadBytes: 12, storageBytes: 20 },
    [{ status: "reviewed", reference: "licence.example" }],
  );
  assertEquals(projectCapabilityProposalCovers(envelope, licensed), false);

  const profileChanged = await withBindingProfile(envelope);
  assertEquals(projectCapabilityProposalCovers(envelope, profileChanged), false);
});

Deno.test("an approved unqualified candidate becomes executable after its exact local qualification without an amendment", async () => {
  const requirement = {
    id: "geometry.observe-assembly-integrity",
    version: "1",
    minimumQualification: "qualified" as const,
    use: "execution" as const,
  };
  const initial = await withOperationalMaterial(
    await proposal("brief-intent", [requirement]),
    { mode: "unavailable", downloadBytes: 12, storageBytes: 20 },
  );
  const authorizedUnqualified = await withCandidateQualification(
    initial,
    "unqualified",
  );
  const exactQualified = await withCandidateQualification(
    await withOperationalMaterial(authorizedUnqualified, {
      mode: "emulated",
      downloadBytes: 12,
      storageBytes: 20,
    }),
    "qualified",
  );

  assertEquals(
    projectCapabilityProposalCovers(authorizedUnqualified, exactQualified),
    true,
  );
  assertEquals(
    projectCapabilityEnvelopeDelta(authorizedUnqualified, exactQualified)
      .bindingReplacements,
    [],
  );
});

async function proposal(
  source: ProjectCapabilityProposal["source"],
  semanticRequirements: ProjectCapabilityProposal["semanticRequirements"],
): Promise<ProjectCapabilityProposal> {
  const bindings = semanticRequirements.map((requirement) => ({
    requirement,
    status: "selected" as const,
    binding: {
      id: "assembly-observer",
      version: "1",
      qualification: "qualified" as const,
    },
    unitIds: [],
    reasons: [],
    candidate: {
      id: "assembly-observer",
      version: "1",
      qualification: "qualified" as const,
      adapter: { id: "adapter", version: "1", source: "test" },
      profile: null,
      unitIds: [],
    },
  }));
  const body = {
    schemaVersion: PROJECT_CAPABILITY_PROPOSAL_SCHEMA_VERSION,
    mutatesRuntime: false as const,
    projectId: "delta-test",
    source,
    brief: {
      briefSnapshotId: "brief",
      briefRevision: 1,
      briefReviewFingerprint: { algorithm: "sha256" as const, digest: "2".repeat(64) },
    },
    intent: null,
    semanticRequirements,
    bindings,
    units: [],
    materials: [],
    effects: {
      downloadBytes: 0,
      storageBytes: 0,
      services: [],
      volumes: [],
      networks: [],
      loopbackPorts: [],
      bindMounts: [],
      privileged: false as const,
      dockerSocket: false as const,
      devices: [],
      secretSlots: [],
      licences: [],
      security: "reviewed" as const,
    },
    status: "ready" as const,
    activation: "allowed" as const,
    blockers: [],
  };
  return {
    ...body,
    capabilityProposalFingerprint: await fingerprintProjectCapabilityProposal(body),
  };
}

async function withOperationalMaterial(
  proposal: ProjectCapabilityProposal,
  material: {
    readonly mode: "native" | "emulated" | "unavailable";
    readonly downloadBytes: number | null;
    readonly storageBytes: number | null;
  },
  licences: readonly {
    readonly status: "reviewed" | "unknown";
    readonly reference: string | null;
  }[] = [],
): Promise<ProjectCapabilityProposal> {
  const { capabilityProposalFingerprint: _fingerprint, ...body } = proposal;
  const materials = [{
    unitId: "casys.test-worker",
    materialId: "test-image",
    imageReference:
      "ghcr.io/casys/test@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ...material,
  }];
  const next = {
    ...body,
    materials,
    effects: {
      ...body.effects,
      downloadBytes: material.downloadBytes,
      storageBytes: material.storageBytes,
      licences,
    },
  };
  return {
    ...next,
    capabilityProposalFingerprint: await fingerprintProjectCapabilityProposal(next),
  };
}

async function withBindingProfile(
  proposal: ProjectCapabilityProposal,
): Promise<ProjectCapabilityProposal> {
  const { capabilityProposalFingerprint: _fingerprint, ...body } = proposal;
  const next = {
    ...body,
    bindings: body.bindings.map((binding) => ({
      ...binding,
      candidate: binding.candidate === undefined ? undefined : {
        ...binding.candidate,
        profile: {
          id: "profile.changed",
          version: "1",
          fingerprint: { algorithm: "sha256" as const, digest: "b".repeat(64) },
        },
      },
    })),
  };
  return {
    ...next,
    capabilityProposalFingerprint: await fingerprintProjectCapabilityProposal(next),
  };
}

async function withCandidateQualification(
  proposal: ProjectCapabilityProposal,
  qualification: "unqualified" | "qualified",
): Promise<ProjectCapabilityProposal> {
  const { capabilityProposalFingerprint: _fingerprint, ...body } = proposal;
  const next = {
    ...body,
    bindings: body.bindings.map((binding) => ({
      ...binding,
      status: qualification === "qualified"
        ? "selected" as const
        : "unavailable" as const,
      binding: qualification === "qualified"
        ? {
          id: binding.candidate!.id,
          version: binding.candidate!.version,
          qualification,
        }
        : null,
      candidate: binding.candidate === undefined ? undefined : {
        ...binding.candidate,
        qualification,
      },
      reasons: qualification === "qualified"
        ? []
        : ["Runtime qualification is pending."],
    })),
    status: qualification === "qualified" ? "ready" as const : "blocked" as const,
    activation: qualification === "qualified" ? "allowed" as const : "blocked" as const,
    blockers: qualification === "qualified"
      ? []
      : ["Runtime qualification is pending."],
  };
  return {
    ...next,
    capabilityProposalFingerprint: await fingerprintProjectCapabilityProposal(next),
  };
}

async function event<T extends object>(
  body: T,
): Promise<
  T & {
    readonly eventFingerprint: Awaited<
      ReturnType<typeof fingerprintProjectCapabilityAuthorizationEvent>
    >;
  }
> {
  return {
    ...body,
    eventFingerprint: await fingerprintProjectCapabilityAuthorizationEvent(body),
  };
}
