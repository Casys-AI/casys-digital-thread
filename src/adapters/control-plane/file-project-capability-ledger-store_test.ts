import { assertEquals, assertRejects } from "@std/assert";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import {
  fingerprintProjectCapabilityAuthorizationEvent,
  fingerprintProjectCapabilityProposal,
  PROJECT_CAPABILITY_LEDGER_SCHEMA_VERSION,
  PROJECT_CAPABILITY_PROPOSAL_SCHEMA_VERSION,
  type ProjectCapabilityAuthorizationEvent,
  type ProjectCapabilityLedger,
  type ProjectCapabilityProposal,
  reconstructProjectCapabilityEffectiveEnvelope,
} from "../../domain/capability/project-capability-authorization.ts";
import { projectCapabilityEnvelopeDelta } from "../../application/control-plane/plan-project-capability-intent.ts";
import {
  FileProjectCapabilityLedgerStore,
  InMemoryProjectCapabilityLedgerStore,
  type ProjectCapabilityLedgerDurability,
  type ProjectCapabilityLedgerDurabilityTransition,
} from "./file-project-capability-ledger-store.ts";

Deno.test("capability ledger retains the exact event prefix and recovers a matching claimed pending revision", async () => {
  const directory = await Deno.makeTempDir({ prefix: "capability-ledger-" });
  try {
    const store = new FileProjectCapabilityLedgerStore(directory);
    const proposal = await proposalFor("ledger-test");
    const first = await ledger("ledger-test", null, [await prepared(proposal)]);
    await store.append(first, 0);
    const second = await ledger("ledger-test", first, [
      ...first.events,
      await authorized(proposal),
    ]);
    // Interruption after pending bytes but before a claim: the exact retry is
    // recoverable and may safely complete claim then publication.
    await Deno.writeTextFile(
      `${directory}/ledger-test/0000000002.json.pending`,
      `${deterministicJson(second)}\n`,
      { createNew: true },
    );
    await store.append(second, 1);
    assertEquals((await store.get("ledger-test"))?.revision, 2);

    const third = await ledger("ledger-test", second, [
      ...second.events,
      await amendment(
        second.effectiveEnvelope!.effectiveEnvelopeFingerprint,
        proposal,
        projectCapabilityEnvelopeDelta(proposal, proposal),
      ),
    ]);
    const base = `${directory}/ledger-test/0000000003`;
    await Deno.writeTextFile(`${base}.${third.ledgerFingerprint.digest}.claim`, "", {
      createNew: true,
    });
    await Deno.writeTextFile(`${base}.json.pending`, `${deterministicJson(third)}\n`, {
      createNew: true,
    });
    const recovered = await store.get("ledger-test");
    assertEquals(recovered?.revision, 3);
    assertEquals(recovered?.effectiveEnvelope?.status, "authorized");

    const replacementProposal = await proposalFor("ledger-test", "changed");
    const replacementPrepared = await prepared(replacementProposal);
    const replacementAuthorized = await authorized(replacementProposal);
    const replacementEnvelope = await reconstructProjectCapabilityEffectiveEnvelope([
      replacementPrepared,
      replacementAuthorized,
    ]);
    const forged = await ledger("ledger-test", recovered!, [
      replacementPrepared,
      replacementAuthorized,
      await amendment(
        replacementEnvelope!.effectiveEnvelopeFingerprint,
        replacementProposal,
        projectCapabilityEnvelopeDelta(replacementProposal, replacementProposal),
        "2026-08-29T00:00:03.000Z",
      ),
      await revoked(),
    ]);
    await assertRejects(
      () => store.append(forged, 3),
      Error,
      "exact prior event prefix",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("capability ledger rejects a competing pending revision rather than claiming it", async () => {
  const directory = await Deno.makeTempDir({ prefix: "capability-ledger-" });
  try {
    const store = new FileProjectCapabilityLedgerStore(directory);
    const proposal = await proposalFor("ledger-mismatch");
    const first = await ledger("ledger-mismatch", null, [await prepared(proposal)]);
    await store.append(first, 0);
    const wanted = await ledger("ledger-mismatch", first, [
      ...first.events,
      await authorized(proposal),
    ]);
    const competing = await ledger("ledger-mismatch", first, [
      ...first.events,
      await authorized(proposal, "2026-08-29T00:00:01.999Z"),
    ]);
    await Deno.writeTextFile(
      `${directory}/ledger-mismatch/0000000002.json.pending`,
      `${deterministicJson(competing)}\n`,
      { createNew: true },
    );
    await assertRejects(
      () => store.append(wanted, 1),
      Error,
      "pending revision bytes differ",
    );
    assertEquals((await store.get("ledger-mismatch"))?.revision, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("capability ledger enumerates an exact first pending revision without a published ledger", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "capability-ledger-orphan-pending-",
  });
  try {
    const store = new FileProjectCapabilityLedgerStore(directory);
    const proposal = await proposalFor("orphan-pending");
    const pending = await ledger("orphan-pending", null, [await prepared(proposal)]);
    await Deno.mkdir(`${directory}/orphan-pending`, { recursive: true });
    await Deno.writeTextFile(
      `${directory}/orphan-pending/0000000001.json.pending`,
      `${deterministicJson(pending)}\n`,
      { createNew: true },
    );

    assertEquals(await store.list(), []);
    assertEquals(
      (await store.listPending()).map((ledger) => ledger.ledgerFingerprint),
      [pending.ledgerFingerprint],
    );
    await Deno.writeTextFile(
      `${directory}/orphan-pending/0000000001.json.pending`,
      `${JSON.stringify(pending, null, 2)}\n`,
    );
    await assertRejects(
      () => store.listPending(),
      Error,
      "not canonical exact bytes",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("capability ledger attests concurrent identical appends and rejects divergent ones", async () => {
  const directory = await Deno.makeTempDir({ prefix: "capability-ledger-concurrent-" });
  try {
    const left = new FileProjectCapabilityLedgerStore(directory);
    const right = new FileProjectCapabilityLedgerStore(directory);
    const identicalProposal = await proposalFor("concurrent-identical");
    const identical = await ledger("concurrent-identical", null, [
      await prepared(identicalProposal),
    ]);
    const [leftResult, rightResult] = await Promise.all([
      left.append(identical, 0),
      right.append(identical, 0),
    ]);
    assertEquals(leftResult.ledgerFingerprint, identical.ledgerFingerprint);
    assertEquals(rightResult.ledgerFingerprint, identical.ledgerFingerprint);
    assertEquals(
      (await left.get("concurrent-identical"))?.ledgerFingerprint,
      identical.ledgerFingerprint,
    );
    assertEquals(await left.getPending("concurrent-identical"), undefined);

    const winner = new FileProjectCapabilityLedgerStore(directory);
    const loser = new FileProjectCapabilityLedgerStore(directory);
    const winningProposal = await proposalFor("concurrent-divergent");
    const competingProposal = await proposalFor("concurrent-divergent", "other-brief");
    const winning = await ledger("concurrent-divergent", null, [
      await prepared(winningProposal),
    ]);
    const competing = await ledger("concurrent-divergent", null, [
      await prepared(competingProposal),
    ]);
    const [first, second] = await Promise.all([
      winner.append(winning, 0).then(
        () => "published",
        () => "rejected",
      ),
      loser.append(competing, 0).then(
        () => "published",
        () => "rejected",
      ),
    ]);
    assertEquals([first, second].sort(), ["published", "rejected"]);
    assertEquals((await winner.get("concurrent-divergent"))?.revision, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("capability ledger sustains 200 exact concurrent appends", async () => {
  const directory = await Deno.makeTempDir({ prefix: "capability-ledger-stress-" });
  try {
    const left = new FileProjectCapabilityLedgerStore(directory);
    const right = new FileProjectCapabilityLedgerStore(directory);
    for (let index = 0; index < 200; index++) {
      const projectId = `stress-identical-${index}`;
      const proposal = await proposalFor(projectId);
      const next = await ledger(projectId, null, [await prepared(proposal)]);
      const [one, two] = await Promise.all([
        left.append(next, 0),
        right.append(next, 0),
      ]);
      assertEquals(one.ledgerFingerprint, next.ledgerFingerprint);
      assertEquals(two.ledgerFingerprint, next.ledgerFingerprint);
      assertEquals(
        (await left.get(projectId))?.ledgerFingerprint,
        next.ledgerFingerprint,
      );
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("capability ledger ignores torn temps and fails closed on visible legacy fragments", async () => {
  const directory = await Deno.makeTempDir({ prefix: "capability-ledger-fault-" });
  try {
    const store = new FileProjectCapabilityLedgerStore(directory);
    await Deno.mkdir(`${directory}/torn-temp`, { recursive: true });
    await Deno.writeTextFile(
      `${directory}/torn-temp/0000000001.json.pending.tmp-power-loss`,
      '{"partial"',
      { createNew: true },
    );
    assertEquals(await store.get("torn-temp"), undefined);
    const proposal = await proposalFor("torn-temp");
    const next = await ledger("torn-temp", null, [await prepared(proposal)]);
    assertEquals((await store.append(next, 0)).revision, 1);

    await Deno.mkdir(`${directory}/partial-pending`, { recursive: true });
    await Deno.writeTextFile(
      `${directory}/partial-pending/0000000001.json.pending`,
      '{"partial"',
      { createNew: true },
    );
    await assertRejects(
      () => store.getPending("partial-pending"),
      Error,
      "pending revision is not valid",
    );
    await assertRejects(
      () => store.listPending(),
      Error,
      "pending revision is not valid",
    );

    await Deno.mkdir(`${directory}/partial-legacy-claim`, { recursive: true });
    await Deno.writeTextFile(
      `${directory}/partial-legacy-claim/0000000001.claim`,
      "partial claim body",
      { createNew: true },
    );
    await assertRejects(
      () => store.get("partial-legacy-claim"),
      Error,
      "malformed visible claim",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("capability ledger flushes each authority-visible directory transition in order", async () => {
  const directory = await Deno.makeTempDir({ prefix: "capability-ledger-durability-" });
  try {
    const durability = new RecordingDurability();
    const store = new FileProjectCapabilityLedgerStore(directory, durability);
    const proposal = await proposalFor("durable-order");
    const next = await ledger("durable-order", null, [await prepared(proposal)]);
    await store.append(next, 0);
    assertEquals(durability.transitions, [
      "project-directory-created",
      "temporary-created",
      "pending-published",
      "temporary-removed",
      "claim-created",
      "revision-published",
    ]);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("capability ledger fails closed when directory fsync is unavailable", async () => {
  const directory = await Deno.makeTempDir({ prefix: "capability-ledger-no-fsync-" });
  try {
    const durability: ProjectCapabilityLedgerDurability = {
      syncDirectory: () => {
        throw new Error("directory fsync unavailable");
      },
    };
    const store = new FileProjectCapabilityLedgerStore(directory, durability);
    const proposal = await proposalFor("no-fsync");
    const next = await ledger("no-fsync", null, [await prepared(proposal)]);
    await assertRejects(
      () => store.append(next, 0),
      Error,
      "cannot establish durable directory metadata",
    );
    assertEquals(await store.get("no-fsync"), undefined);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("in-memory capability ledger enforces the same compare-and-swap and append-only boundary", async () => {
  const store = new InMemoryProjectCapabilityLedgerStore();
  const proposal = await proposalFor("memory-ledger");
  const first = await ledger("memory-ledger", null, [await prepared(proposal)]);
  await store.append(first, 0);
  await assertRejects(() => store.append(first, 0), Error, "expected revision");
});

Deno.test("capability ledger accepts an exact unavailable binding delta with binding null", async () => {
  const store = new InMemoryProjectCapabilityLedgerStore();
  const initial = await proposalFor("unavailable-delta");
  const first = await ledger("unavailable-delta", null, [await prepared(initial)]);
  await store.append(first, 0);
  const second = await ledger("unavailable-delta", first, [
    ...first.events,
    await authorized(initial),
  ]);
  await store.append(second, 1);
  const successor = await unavailableProposal("unavailable-delta");
  const delta = projectCapabilityEnvelopeDelta(initial, successor);
  const third = await ledger("unavailable-delta", second, [
    ...second.events,
    await amendment(
      second.effectiveEnvelope!.effectiveEnvelopeFingerprint,
      successor,
      delta,
    ),
  ]);
  await store.append(third, 2);
  assertEquals(
    (await store.get("unavailable-delta"))?.effectiveEnvelope?.proposal.bindings[0]
      ?.binding,
    null,
  );
});

async function proposalFor(
  projectId: string,
  briefSnapshotId = "brief",
): Promise<ProjectCapabilityProposal> {
  const body = {
    schemaVersion: PROJECT_CAPABILITY_PROPOSAL_SCHEMA_VERSION,
    mutatesRuntime: false as const,
    projectId,
    source: "brief-intent" as const,
    brief: {
      briefSnapshotId,
      briefRevision: 1,
      briefReviewFingerprint: { algorithm: "sha256" as const, digest: "1".repeat(64) },
    },
    intent: null,
    semanticRequirements: [],
    bindings: [],
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

async function prepared(
  proposal: ProjectCapabilityProposal,
): Promise<ProjectCapabilityAuthorizationEvent> {
  const body = {
    kind: "initial-prepared" as const,
    recordedAt: "2026-08-29T00:00:00.000Z",
    proposal,
  };
  return {
    ...body,
    eventFingerprint: await fingerprintProjectCapabilityAuthorizationEvent(body),
  };
}

async function amendment(
  previousEnvelopeFingerprint: ProjectCapabilityLedger["ledgerFingerprint"],
  successor: ProjectCapabilityProposal,
  delta: ReturnType<typeof projectCapabilityEnvelopeDelta>,
  recordedAt = "2026-08-29T00:00:01.500Z",
): Promise<ProjectCapabilityAuthorizationEvent> {
  const body = {
    kind: "amendment-authorized" as const,
    recordedAt,
    previousEnvelopeFingerprint,
    proposalFingerprint: successor.capabilityProposalFingerprint,
    delta,
  };
  return {
    ...body,
    eventFingerprint: await fingerprintProjectCapabilityAuthorizationEvent(body),
  };
}

async function authorized(
  proposal: ProjectCapabilityProposal,
  recordedAt = "2026-08-29T00:00:01.000Z",
): Promise<ProjectCapabilityAuthorizationEvent> {
  const body = {
    kind: "initial-authorized" as const,
    recordedAt,
    proposalFingerprint: proposal.capabilityProposalFingerprint,
    approval: {
      projectSnapshotId: "snapshot",
      projectRevision: 2,
      approvedBriefFingerprint: proposal.brief.briefReviewFingerprint,
    },
  };
  return {
    ...body,
    eventFingerprint: await fingerprintProjectCapabilityAuthorizationEvent(body),
  };
}

async function revoked(): Promise<ProjectCapabilityAuthorizationEvent> {
  const body = {
    kind: "revocation-recorded" as const,
    recordedAt: "2026-08-29T00:00:02.000Z",
    scope: "full-envelope" as const,
    reason: "Administrative test revocation.",
  };
  return {
    ...body,
    eventFingerprint: await fingerprintProjectCapabilityAuthorizationEvent(body),
  };
}

async function unavailableProposal(
  projectId: string,
): Promise<ProjectCapabilityProposal> {
  const empty = await proposalFor(projectId);
  const { capabilityProposalFingerprint: _fingerprint, ...base } = empty;
  const requirement = {
    id: "simulation.run-admitted-modelica",
    version: "1",
    minimumQualification: "qualified" as const,
    use: "execution" as const,
  };
  const body = {
    ...base,
    source: "published-plan" as const,
    semanticRequirements: [requirement],
    bindings: [{
      requirement,
      status: "unavailable" as const,
      binding: null,
      unitIds: [],
      reasons: ["Selected binding is not qualified."],
      candidate: {
        id: "modelica-admitted",
        version: "1",
        qualification: "unqualified" as const,
        adapter: { id: "modelica", version: "1", source: "test" },
        profile: null,
        unitIds: [],
      },
    }],
    status: "unresolved" as const,
    activation: "blocked" as const,
    blockers: ["Selected binding is not qualified."],
  };
  return {
    ...body,
    capabilityProposalFingerprint: await fingerprintProjectCapabilityProposal(body),
  };
}

async function ledger(
  projectId: string,
  previous: ProjectCapabilityLedger | null,
  events: readonly ProjectCapabilityAuthorizationEvent[],
): Promise<ProjectCapabilityLedger> {
  const effectiveEnvelope = await reconstructProjectCapabilityEffectiveEnvelope(events);
  const body = {
    schemaVersion: PROJECT_CAPABILITY_LEDGER_SCHEMA_VERSION,
    projectId,
    revision: (previous?.revision ?? 0) + 1,
    previous: previous?.ledgerFingerprint ?? null,
    events,
    effectiveEnvelope,
  };
  return { ...body, ledgerFingerprint: await sha256Fingerprint(body) };
}

class RecordingDurability implements ProjectCapabilityLedgerDurability {
  readonly transitions: ProjectCapabilityLedgerDurabilityTransition[] = [];

  syncDirectory(
    _directory: string,
    transition: ProjectCapabilityLedgerDurabilityTransition,
  ): Promise<void> {
    this.transitions.push(transition);
    return Promise.resolve();
  }
}
