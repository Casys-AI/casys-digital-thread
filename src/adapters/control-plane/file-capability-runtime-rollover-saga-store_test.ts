import { assertEquals, assertRejects } from "@std/assert";
import {
  type CapabilityRuntimeRolloverIdentity,
  capabilityRuntimeRolloverKeyFor,
  CapabilityRuntimeRolloverSagaIntegrityError,
} from "../../domain/capability/runtime/capability-runtime-rollover-saga.ts";
import { FileCapabilityRuntimeRolloverSagaStore } from "./file-capability-runtime-rollover-saga-store.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";

Deno.test("rollover WAL is append-only, chained and returns exact bytes on retry", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const store = new FileCapabilityRuntimeRolloverSagaStore(directory);
    const identity = await fixtureIdentity();
    const prepared = await store.prepare(identity);
    const preparedAgain = await store.prepare(identity);
    assertEquals(preparedAgain, prepared);
    for (
      const phase of [
        "successor-material-observed",
        "successor-runtime-observed",
      ] as const
    ) {
      const proof = await fingerprint(phase);
      const first = await store.advance(identity, {
        phase,
        evidenceFingerprint: proof,
      });
      const retry = await store.advance(identity, {
        phase,
        evidenceFingerprint: proof,
      });
      assertEquals(retry, first);
    }
    const amendmentProof = await fingerprint("amendment");
    await store.advance(identity, {
      phase: "project-amendment-recorded",
      projectId: "ats01-adjustable-tablet-stand",
      evidenceFingerprint: amendmentProof,
    });
    for (const phase of ["successor-lock-recorded", "completed"] as const) {
      const proof = await fingerprint(phase);
      const first = await store.advance(identity, {
        phase,
        evidenceFingerprint: proof,
      });
      const retry = await store.advance(identity, {
        phase,
        evidenceFingerprint: proof,
      });
      assertEquals(retry, first);
    }
    const recovered = new FileCapabilityRuntimeRolloverSagaStore(directory);
    const terminal = await recovered.read(capabilityRuntimeRolloverKeyFor(identity));
    assertEquals(terminal?.phase, "completed");
    const files = await allEventBytes(directory);
    assertEquals(files.length, 6);
    assertEquals(files.every((entry) => entry.text.endsWith("\n")), true);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("rollover WAL fails closed on skipped, rewritten and divergent successor transitions", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const store = new FileCapabilityRuntimeRolloverSagaStore(directory);
    const identity = await fixtureIdentity();
    await store.prepare(identity);
    const wrong = await fingerprint("wrong");
    await assertRejects(
      () =>
        store.advance(identity, {
          phase: "successor-runtime-observed",
          evidenceFingerprint: wrong,
        }),
      CapabilityRuntimeRolloverSagaIntegrityError,
      "cannot skip",
    );
    const drained = await fingerprint("material");
    await store.advance(identity, {
      phase: "successor-material-observed",
      evidenceFingerprint: drained,
    });
    const rewritten = await fingerprint("rewritten");
    await assertRejects(
      () =>
        store.advance(identity, {
          phase: "successor-material-observed",
          evidenceFingerprint: rewritten,
        }),
      CapabilityRuntimeRolloverSagaIntegrityError,
      "cannot be rewritten",
    );
    const divergent: CapabilityRuntimeRolloverIdentity = {
      ...identity,
      successor: {
        ...identity.successor,
        unit: { ...identity.successor.unit, version: "0.2.1" },
      },
    };
    await assertRejects(
      () => store.prepare(divergent),
      CapabilityRuntimeRolloverSagaIntegrityError,
      "identity conflicts",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("rollover failure is terminal yet has the same deterministic retry bytes", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const store = new FileCapabilityRuntimeRolloverSagaStore(directory);
    const identity = await fixtureIdentity();
    await store.prepare(identity);
    const failure = await fingerprint("observed-hybrid-state");
    const first = await store.advance(identity, {
      phase: "recovery-required",
      recoveryState: "hybrid",
      evidenceFingerprint: failure,
    });
    assertEquals(
      await store.advance(identity, {
        phase: "recovery-required",
        recoveryState: "hybrid",
        evidenceFingerprint: failure,
      }),
      first,
    );
    const late = await fingerprint("late");
    await assertRejects(
      () =>
        store.advance(identity, {
          phase: "successor-material-observed",
          evidenceFingerprint: late,
        }),
      CapabilityRuntimeRolloverSagaIntegrityError,
      "terminal outcome",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("rollover amendments follow the exact ledger order and may be absent", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const identity = await fixtureIdentity();
    const twoProjects: CapabilityRuntimeRolloverIdentity = {
      ...identity,
      affectedProjects: [
        {
          projectId: "alpha",
          ledgerRevision: 2,
          ledgerFingerprint: await fingerprint("alpha-ledger"),
          proposalFingerprint: await fingerprint("alpha"),
        },
        {
          projectId: "bravo",
          ledgerRevision: 3,
          ledgerFingerprint: await fingerprint("bravo-ledger"),
          proposalFingerprint: await fingerprint("bravo"),
        },
      ],
    };
    const store = new FileCapabilityRuntimeRolloverSagaStore(directory);
    await store.prepare(twoProjects);
    await store.advance(twoProjects, {
      phase: "successor-material-observed",
      evidenceFingerprint: await fingerprint("material"),
    });
    await store.advance(twoProjects, {
      phase: "successor-runtime-observed",
      evidenceFingerprint: await fingerprint("runtime"),
    });
    const earlyBravo = await fingerprint("bravo-amendment");
    await assertRejects(
      () =>
        store.advance(twoProjects, {
          phase: "project-amendment-recorded",
          projectId: "bravo",
          evidenceFingerprint: earlyBravo,
        }),
      CapabilityRuntimeRolloverSagaIntegrityError,
      "cannot skip",
    );
    await store.advance(twoProjects, {
      phase: "project-amendment-recorded",
      projectId: "alpha",
      evidenceFingerprint: await fingerprint("alpha-amendment"),
    });
    await store.advance(twoProjects, {
      phase: "project-amendment-recorded",
      projectId: "bravo",
      evidenceFingerprint: await fingerprint("bravo-amendment"),
    });

    const empty: CapabilityRuntimeRolloverIdentity = {
      ...identity,
      transitionId: "administrative-no-project-rollover",
      affectedProjects: [],
    };
    await store.prepare(empty);
    await store.advance(empty, {
      phase: "successor-material-observed",
      evidenceFingerprint: await fingerprint("empty-material"),
    });
    await store.advance(empty, {
      phase: "successor-runtime-observed",
      evidenceFingerprint: await fingerprint("empty-runtime"),
    });
    assertEquals(
      (await store.advance(empty, {
        phase: "successor-lock-recorded",
        evidenceFingerprint: await fingerprint("empty-lock"),
      })).phase,
      "successor-lock-recorded",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

async function fixtureIdentity(): Promise<CapabilityRuntimeRolloverIdentity> {
  const oldArtifact = await fingerprint("old-image");
  const newArtifact = await fingerprint("new-image");
  return {
    transitionId: "syson-v2026.7.0-casys.2-rollover",
    authorizedAt: "2026-08-30T12:00:00.000Z",
    predecessor: {
      launchGroup: { id: "casys-syson", version: "1.0.0", fingerprint: oldArtifact },
      unit: {
        id: "casys.syson-stack",
        version: "1.0.0",
        manifestFingerprint: oldArtifact,
      },
    },
    successor: {
      launchGroup: { id: "casys-syson", version: "1.0.1", fingerprint: newArtifact },
      unit: {
        id: "casys.syson-stack",
        version: "1.0.1",
        manifestFingerprint: newArtifact,
      },
    },
    affectedProjects: [{
      projectId: "ats01-adjustable-tablet-stand",
      ledgerRevision: 4,
      ledgerFingerprint: await fingerprint("ledger-r4"),
      proposalFingerprint: await fingerprint("proposal-r4"),
    }],
    preserved: {
      thread: "preserve",
      cas: "preserve",
      wal: "preserve",
      project: "preserve",
      volumes: [{ id: "casys-syson-db-data", action: "preserve" }],
    },
  };
}

function fingerprint(value: string) {
  return sha256Fingerprint({ value });
}

async function allEventBytes(
  directory: string,
): Promise<readonly { readonly name: string; readonly text: string }[]> {
  const subdirectories = await Array.fromAsync(Deno.readDir(directory));
  const only = subdirectories.find((entry) => entry.isDirectory);
  if (!only) throw new Error("rollover directory absent");
  const entries = await Array.fromAsync(Deno.readDir(`${directory}/${only.name}`));
  return await Promise.all(
    entries.filter((entry) => entry.name.startsWith("event-")).map(async (entry) => ({
      name: entry.name,
      text: await Deno.readTextFile(`${directory}/${only.name}/${entry.name}`),
    })),
  );
}
