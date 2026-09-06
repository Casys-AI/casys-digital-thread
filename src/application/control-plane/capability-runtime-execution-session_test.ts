import { assertEquals, assertRejects } from "@std/assert";
import {
  CapabilityRuntimeExecutionSessionCoordinator,
  CapabilityRuntimeSessionUnavailableError,
} from "./capability-runtime-execution-session.ts";
import {
  InMemoryCapabilityRuntimeLeaseStore,
} from "../../adapters/control-plane/in-memory-capability-runtime-supervisor.ts";
import {
  fingerprintResolvedCapabilityRuntimeOperation,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import type {
  CapabilityRuntimeLease,
  ResolvedCapabilityRuntimeOperation,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import type { CapabilityRuntimeMaterialIdentity } from "../../domain/capability/runtime/capability-runtime-material.ts";
import type {
  CapabilityRuntimeLaunchGroupReference,
} from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import type {
  ProjectCapabilityRuntimeContextReader,
} from "../ports/out/capability/capability-runtime-supervisor.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";

const AT = "2026-08-29T00:00:00.000Z";
const PROJECT_ID = "project:session";
const FINGERPRINT = { algorithm: "sha256" as const, digest: "f".repeat(64) };

Deno.test("JIT session deduplicates persistent group activation, preserves one lease, and separately attests its microVM", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const alpha = launchGroup("casys-alpha");
  const bravo = launchGroup("casys-bravo");
  const operation = operationFor(alpha, bravo);
  const activation: {
    readonly groupId: string;
    readonly reuseExistingLease: "allow" | "reject";
  }[] = [];
  const released: string[][] = [];
  const cached: string[] = [];
  const coordinator = new CapabilityRuntimeExecutionSessionCoordinator({
    contexts: contextFor(),
    leases,
    groups: {
      ensureActive: async (input: {
        readonly group: CapabilityRuntimeLaunchGroupReference;
        readonly lease: CapabilityRuntimeLease;
        readonly reuseExistingLease: "allow" | "reject";
      }) => {
        const claim = await leases.claim(input.lease);
        activation.push({
          groupId: input.group.id,
          reuseExistingLease: input.reuseExistingLease,
        });
        return {
          group: input.group,
          states: new Map([[input.group.id, {
            material: "installed" as const,
            runtime: "active" as const,
          }]]),
          leaseDisposition: claim.status === "created"
            ? "created" as const
            : "reused" as const,
          mutation: undefined,
        };
      },
      releaseTerminal: async (input: {
        readonly groups: readonly CapabilityRuntimeLaunchGroupReference[];
        readonly leaseId: string;
      }) => {
        released.push(input.groups.map((group) => group.id));
        await leases.release(input.leaseId);
      },
    } as never,
    microsandbox: {
      ensureExactCached: ({ imageReference }) => {
        cached.push(imageReference);
        return Promise.resolve();
      },
    },
    hasRemainingJitDemand: () => Promise.resolve(false),
    now: () => AT,
  });

  const session = await coordinator.begin({
    project: projectFor(),
    runId: "run:session",
    operationalCapability: operation,
    microsandboxExecutionProfiles: [{
      material: microMaterial(),
      executionProfileFingerprint: FINGERPRINT,
    }],
    recheck: () => Promise.resolve(operation),
  });

  assertEquals(activation, [
    { groupId: "casys-alpha", reuseExistingLease: "reject" },
    { groupId: "casys-bravo", reuseExistingLease: "allow" },
  ]);
  assertEquals(cached, [`example.test/calculix@sha256:${microMaterial().imageDigest}`]);
  assertEquals((await leases.listActive(AT)).length, 1);

  await session.releaseTerminal();
  assertEquals(released, [["casys-alpha", "casys-bravo"]]);
  assertEquals(await leases.listActive(AT), []);
});

Deno.test("terminal JIT cleanup keeps a shared group active for another project's demand", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const operation = persistentOperation();
  let stopped = false;
  let globalReads = 0;
  let legacyReads = 0;
  const coordinator = new CapabilityRuntimeExecutionSessionCoordinator({
    contexts: contextFor(),
    leases,
    groups: {
      ensureActive: async (input: { readonly lease: CapabilityRuntimeLease }) => {
        const claim = await leases.claim(input.lease);
        return {
          group: launchGroup("casys-observation"),
          states: new Map(),
          leaseDisposition: claim.status === "created"
            ? "created" as const
            : "reused" as const,
          mutation: undefined,
        };
      },
      releaseTerminal: async (input: {
        readonly leaseId: string;
        readonly groups: readonly CapabilityRuntimeLaunchGroupReference[];
        readonly hasRemainingJitDemand: (
          materialKeys: readonly string[],
        ) => Promise<boolean>;
      }) => {
        const remaining = await input.hasRemainingJitDemand([
          materialKey(persistentOperation().bindings[0]!.materials[0]!),
        ]);
        stopped = !remaining;
        await leases.release(input.leaseId);
      },
    } as never,
    hasAnyRemainingJitDemand: {
      hasAnyRemainingDemand: () => {
        globalReads++;
        return Promise.resolve(true);
      },
    },
    hasRemainingJitDemand: () => {
      legacyReads++;
      return Promise.resolve(false);
    },
    now: () => AT,
  });

  const session = await coordinator.begin({
    project: projectFor(),
    runId: "run:session",
    operationalCapability: operation,
    microsandboxExecutionProfiles: [],
    recheck: () => Promise.resolve(operation),
  });
  await session.releaseTerminal();

  assertEquals(stopped, false);
  assertEquals(globalReads, 1);
  assertEquals(legacyReads, 0);
});

Deno.test("JIT session rechecks inside group activation before a revoked capability can claim a lease", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const alpha = launchGroup("casys-alpha");
  const bravo = launchGroup("casys-bravo");
  const operation = operationFor(alpha, bravo);
  const changed = {
    ...operation,
    authorizationFingerprint: { algorithm: "sha256" as const, digest: "a".repeat(64) },
  };
  let rechecks = 0;
  let hostMutations = 0;
  const coordinator = new CapabilityRuntimeExecutionSessionCoordinator({
    contexts: contextFor(),
    leases,
    groups: {
      ensureActive: async (input: {
        readonly lease: CapabilityRuntimeLease;
        readonly guard?: () => Promise<boolean>;
      }) => {
        if (input.guard && !(await input.guard())) {
          throw new Error("activation is no longer authorized");
        }
        hostMutations++;
        const claim = await leases.claim(input.lease);
        return {
          group: alpha,
          states: new Map([[alpha.id, {
            material: "installed" as const,
            runtime: "active" as const,
          }]]),
          leaseDisposition: claim.status === "created"
            ? "created" as const
            : "reused" as const,
          mutation: undefined,
        };
      },
      releaseTerminal: () => Promise.resolve(),
    } as never,
    microsandbox: { ensureExactCached: () => Promise.resolve() },
    now: () => AT,
  });

  await assertRejects(
    () =>
      coordinator.begin({
        project: projectFor(),
        runId: "run:session",
        operationalCapability: operation,
        microsandboxExecutionProfiles: [{
          material: microMaterial(),
          executionProfileFingerprint: FINGERPRINT,
        }],
        // The first recheck is the outer cold gate. The revoke happens before
        // H1 invokes the guarded activation callback.
        recheck: () => Promise.resolve(++rechecks === 1 ? operation : changed),
      }),
    Error,
    "authorized",
  );
  assertEquals(hostMutations, 0);
  assertEquals(await leases.listActive(AT), []);
});

Deno.test("a queued run resumes only its exact durable pre-claim persistent lease", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const operation = persistentOperation();
  const activation: {
    readonly reuseExistingLease: "allow" | "reject";
    readonly queuedPreclaimResumeOwner: CapabilityRuntimeLease["executionOwner"];
  }[] = [];
  let firstActivation = true;
  const coordinator = new CapabilityRuntimeExecutionSessionCoordinator({
    contexts: contextFor(),
    leases,
    groups: {
      ensureActive: async (input: {
        readonly group: CapabilityRuntimeLaunchGroupReference;
        readonly lease: CapabilityRuntimeLease;
        readonly reuseExistingLease: "allow" | "reject";
        readonly queuedPreclaimResumeOwner?: CapabilityRuntimeLease["executionOwner"];
      }) => {
        activation.push({
          reuseExistingLease: input.reuseExistingLease,
          queuedPreclaimResumeOwner: input.queuedPreclaimResumeOwner,
        });
        const claim = await leases.claim(input.lease);
        if (claim.status === "existing" && input.reuseExistingLease === "reject") {
          throw new Error("H1 rejects an external queued lease claim");
        }
        if (firstActivation) {
          firstActivation = false;
          throw new Error("H1 persistent activation failed before the agent run claim");
        }
        return {
          group: input.group,
          states: new Map([[input.group.id, {
            material: "installed" as const,
            runtime: "active" as const,
          }]]),
          leaseDisposition: claim.status === "created"
            ? "created" as const
            : "reused" as const,
          mutation: undefined,
        };
      },
      releaseTerminal: async (input: { readonly leaseId: string }) => {
        await leases.release(input.leaseId);
      },
    } as never,
    now: () => AT,
  });
  const project = projectFor("queued", true);

  await assertRejects(
    () =>
      coordinator.begin({
        project,
        runId: "run:session",
        operationalCapability: operation,
        microsandboxExecutionProfiles: [],
        recheck: () => Promise.resolve(operation),
      }),
    Error,
    "persistent activation failed",
  );
  const retained = (await leases.listActive(AT))[0]!;

  const session = await coordinator.begin({
    project,
    runId: "run:session",
    operationalCapability: operation,
    microsandboxExecutionProfiles: [],
    recheck: () => Promise.resolve(operation),
  });

  assertEquals(activation, [{
    reuseExistingLease: "reject",
    queuedPreclaimResumeOwner: undefined,
  }, {
    reuseExistingLease: "allow",
    queuedPreclaimResumeOwner: retained.executionOwner,
  }]);
  assertEquals(session.lease.id, retained.id);
  assertEquals(session.lease.executionOwner, retained.executionOwner);
  await session.releaseTerminal();
});

Deno.test("a queued run refuses a foreign or expired durable pre-claim lease", async () => {
  for (
    const [name, mutate] of [
      ["foreign owner", (lease: CapabilityRuntimeLease): CapabilityRuntimeLease => ({
        ...lease,
        executionOwner: {
          ...lease.executionOwner!,
          runId: "run:foreign",
        },
      })],
      ["expired lease", (lease: CapabilityRuntimeLease): CapabilityRuntimeLease => ({
        ...lease,
        acquiredAt: "2026-08-28T17:59:59.999Z",
        expiresAt: "2026-08-28T23:59:59.999Z",
      })],
    ] as const
  ) {
    const leases = new InMemoryCapabilityRuntimeLeaseStore();
    const operation = persistentOperation();
    const activation: ("allow" | "reject")[] = [];
    const coordinator = new CapabilityRuntimeExecutionSessionCoordinator({
      contexts: contextFor(),
      leases,
      groups: {
        ensureActive: async (input: {
          readonly group: CapabilityRuntimeLaunchGroupReference;
          readonly lease: CapabilityRuntimeLease;
          readonly reuseExistingLease: "allow" | "reject";
        }) => {
          activation.push(input.reuseExistingLease);
          const claim = await leases.claim(input.lease);
          if (claim.status === "existing" && input.reuseExistingLease === "reject") {
            throw new Error("H1 rejects an external queued lease claim");
          }
          return {
            group: input.group,
            states: new Map([[input.group.id, {
              material: "installed" as const,
              runtime: "active" as const,
            }]]),
            leaseDisposition: "created" as const,
            mutation: undefined,
          };
        },
        releaseTerminal: () => Promise.resolve(),
      } as never,
      now: () => AT,
    });
    const project = projectFor("queued", true);
    const seeded = await coordinator.begin({
      project,
      runId: "run:session",
      operationalCapability: operation,
      microsandboxExecutionProfiles: [],
      recheck: () => Promise.resolve(operation),
    });
    const candidate = seeded.lease;
    await leases.release(candidate.id);
    await leases.claim(mutate(candidate));
    activation.length = 0;

    await assertRejects(
      () =>
        coordinator.begin({
          project,
          runId: "run:session",
          operationalCapability: operation,
          microsandboxExecutionProfiles: [],
          recheck: () => Promise.resolve(operation),
        }),
      CapabilityRuntimeSessionUnavailableError,
      name === "foreign owner" ? "owner-bearing" : "expired",
    );
    assertEquals(activation, []);
  }
});

Deno.test("production JIT seam observes the one exact ngspice Microsandbox material before its first claim", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const operation = admittedSpiceOperation();
  const microsandboxObservations: string[] = [];
  const coordinator = new CapabilityRuntimeExecutionSessionCoordinator({
    contexts: contextForExactMaterials([spiceRuntimeMaterial()]),
    leases,
    microsandbox: {
      ensureExactCached: ({ material }) => {
        microsandboxObservations.push(materialKey(material));
        return Promise.resolve();
      },
    },
    now: () => AT,
  });

  const session = await coordinator.begin({
    project: projectFor(),
    runId: "run:session",
    operationalCapability: operation,
    microsandboxExecutionProfiles: [{
      material: spiceRuntimeMaterial(),
      executionProfileFingerprint: FINGERPRINT,
    }],
    recheck: () => Promise.resolve(operation),
  });

  assertEquals(microsandboxObservations, [materialKey(spiceRuntimeMaterial())]);
  assertEquals((await leases.listActive(AT)).map((lease) => lease.id), [
    session.lease.id,
  ]);
  await session.releaseTerminal();
  assertEquals(await leases.listActive(AT), []);
});

Deno.test("a missing exact ngspice Microsandbox material leaves the JIT run unclaimed", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const operation = admittedSpiceOperation();
  const microsandboxObservations: string[] = [];
  const coordinator = new CapabilityRuntimeExecutionSessionCoordinator({
    contexts: contextForExactMaterials([spiceRuntimeMaterial()]),
    leases,
    microsandbox: {
      ensureExactCached: ({ material }) => {
        microsandboxObservations.push(materialKey(material));
        return Promise.reject(new Error("exact runtime image is absent"));
      },
    },
    now: () => AT,
  });

  await assertRejects(
    () =>
      coordinator.begin({
        project: projectFor(),
        runId: "run:session",
        operationalCapability: operation,
        microsandboxExecutionProfiles: [{
          material: spiceRuntimeMaterial(),
          executionProfileFingerprint: FINGERPRINT,
        }],
        recheck: () => Promise.resolve(operation),
      }),
    CapabilityRuntimeSessionUnavailableError,
    "no lease or provider dispatch was attempted",
  );
  assertEquals(microsandboxObservations, [materialKey(spiceRuntimeMaterial())]);
  assertEquals(await leases.listActive(AT), []);
});

Deno.test("production JIT seam observes the exact admitted Modelica Microsandbox material", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const operation = admittedModelicaOperation();
  const microsandboxObservations: string[] = [];
  const coordinator = new CapabilityRuntimeExecutionSessionCoordinator({
    contexts: contextForExactMaterials([modelicaRuntimeMaterial()]),
    leases,
    microsandbox: {
      ensureExactCached: ({ material, executionProfileFingerprint }) => {
        microsandboxObservations.push(
          `${materialKey(material)}:${executionProfileFingerprint.digest}`,
        );
        return Promise.resolve();
      },
    },
    now: () => AT,
  });

  const session = await coordinator.begin({
    project: projectFor(),
    runId: "run:session",
    operationalCapability: operation,
    microsandboxExecutionProfiles: [{
      material: modelicaRuntimeMaterial(),
      executionProfileFingerprint: FINGERPRINT,
    }],
    recheck: () => Promise.resolve(operation),
  });

  assertEquals(microsandboxObservations, [
    `${materialKey(modelicaRuntimeMaterial())}:${FINGERPRINT.digest}`,
  ]);
  await session.releaseTerminal();
  assertEquals(await leases.listActive(AT), []);
});

Deno.test("JIT direct session rechecks after Microsandbox observation before a revoked capability can claim a lease", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const operation = admittedModelicaOperation();
  const changed = {
    ...operation,
    authorizationFingerprint: { algorithm: "sha256" as const, digest: "a".repeat(64) },
  };
  const observations: string[] = [];
  const rechecks: boolean[] = [];
  let revoked = false;
  const coordinator = new CapabilityRuntimeExecutionSessionCoordinator({
    contexts: contextForExactMaterials([modelicaRuntimeMaterial()]),
    leases,
    microsandbox: {
      ensureExactCached: ({ material }) => {
        observations.push(materialKey(material));
        revoked = true;
        return Promise.resolve();
      },
    },
    now: () => AT,
  });

  await assertRejects(
    () =>
      coordinator.begin({
        project: projectFor(),
        runId: "run:session",
        operationalCapability: operation,
        microsandboxExecutionProfiles: [{
          material: modelicaRuntimeMaterial(),
          executionProfileFingerprint: FINGERPRINT,
        }],
        recheck: () => {
          rechecks.push(revoked);
          return Promise.resolve(revoked ? changed : operation);
        },
      }),
    CapabilityRuntimeSessionUnavailableError,
    "Operational capability changed",
  );
  assertEquals(observations, [materialKey(modelicaRuntimeMaterial())]);
  assertEquals(rechecks, [false, true]);
  assertEquals(await leases.listActive(AT), []);
});

Deno.test("recorded execution cleanup releases the exact lease without activation", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const activations: string[] = [];
  const cleanups: string[] = [];
  const coordinator = recordedCleanupCoordinator(leases, activations, cleanups);
  const operation = persistentOperation();
  const session = await coordinator.begin({
    project: projectFor("queued"),
    runId: "run:session",
    operationalCapability: operation,
    microsandboxExecutionProfiles: [],
    recheck: () => Promise.resolve(operation),
  });
  assertEquals(activations, ["casys-observation"]);
  assertEquals((await leases.listActive(AT)).map((lease) => lease.id), [
    session.lease.id,
  ]);

  await coordinator.releaseRecorded({
    project: projectFor("completed"),
    runId: "run:session",
    operationalCapability: operation,
  });
  assertEquals(activations, ["casys-observation"]);
  assertEquals(cleanups, [session.lease.id]);
  assertEquals(await leases.listActive(AT), []);
});

Deno.test("JIT execution lease records its exact run, operation and Thread basis for future reconciliation", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const activations: string[] = [];
  const cleanups: string[] = [];
  const coordinator = recordedCleanupCoordinator(leases, activations, cleanups);
  const operation = persistentOperation();
  const session = await coordinator.begin({
    project: projectFor("queued", true),
    runId: "run:session",
    operationalCapability: operation,
    microsandboxExecutionProfiles: [],
    recheck: () => Promise.resolve(operation),
  });

  assertEquals((await leases.read(session.lease.id))?.executionOwner, {
    kind: "execution-run",
    runId: "run:session",
    operation: { id: operation.operation.id, version: operation.operation.version },
    basis: {
      snapshotId: "subject:thread:r4",
      revision: 4,
      subjectId: "subject",
    },
    operationalCapabilityFingerprint:
      await fingerprintResolvedCapabilityRuntimeOperation(operation),
  });
});

Deno.test("human did-not-write reconciliation releases only the retained lease owned by that failed run", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const activations: string[] = [];
  const cleanups: string[] = [];
  const coordinator = recordedCleanupCoordinator(leases, activations, cleanups);
  const operation = persistentOperation();
  const project = await reconciledDidNotWriteProject(operation);
  const session = await coordinator.begin({
    project,
    runId: "run:failed",
    operationalCapability: operation,
    microsandboxExecutionProfiles: [],
    recheck: () => Promise.resolve(operation),
  });
  await coordinator.releaseReconciledUncertainWriterLease({
    project,
    failedRunId: "run:failed",
    reconciliationRunId: "run:reconcile",
  });

  assertEquals(cleanups, [session.lease.id]);
  assertEquals(await leases.read(session.lease.id), undefined);
  assertEquals(activations, ["casys-observation"]);
});

Deno.test("a plain failed run cannot release a retained provenance-bearing lease", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const activations: string[] = [];
  const cleanups: string[] = [];
  const coordinator = recordedCleanupCoordinator(leases, activations, cleanups);
  const operation = persistentOperation();
  const reconciled = await reconciledDidNotWriteProject(operation);
  const project = {
    ...reconciled,
    agentRuns: reconciled.agentRuns.map((run) =>
      run.id === "run:failed"
        ? { ...run, uncertainWriterReconciliation: undefined }
        : run
    ),
  } as EngineeringProjectSnapshot;
  const session = await coordinator.begin({
    project,
    runId: "run:failed",
    operationalCapability: operation,
    microsandboxExecutionProfiles: [],
    recheck: () => Promise.resolve(operation),
  });

  await assertRejects(
    () =>
      coordinator.releaseReconciledUncertainWriterLease({
        project,
        failedRunId: "run:failed",
        reconciliationRunId: "run:reconcile",
      }),
    Error,
    "provider-did-not-write",
  );

  assertEquals(cleanups, []);
  assertEquals((await leases.read(session.lease.id))?.id, session.lease.id);
  assertEquals(activations, ["casys-observation"]);
});

Deno.test("human did-not-write reconciliation does not reconstruct an ownerless lease", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const activations: string[] = [];
  const cleanups: string[] = [];
  const coordinator = recordedCleanupCoordinator(leases, activations, cleanups);
  const operation = persistentOperation();
  const project = await reconciledDidNotWriteProject(operation);
  const session = await coordinator.begin({
    project,
    runId: "run:failed",
    operationalCapability: operation,
    microsandboxExecutionProfiles: [],
    recheck: () => Promise.resolve(operation),
  });
  await leases.release(session.lease.id);
  await leases.claim({ ...session.lease, executionOwner: undefined });

  await coordinator.releaseReconciledUncertainWriterLease({
    project,
    failedRunId: "run:failed",
    reconciliationRunId: "run:reconcile",
  });

  assertEquals(cleanups, []);
  assertEquals((await leases.read(session.lease.id))?.id, session.lease.id);
  assertEquals(activations, ["casys-observation"]);
});

Deno.test("recorded execution cleanup is a no-op without a lease and never activates", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const activations: string[] = [];
  const cleanups: string[] = [];
  const coordinator = recordedCleanupCoordinator(leases, activations, cleanups);
  await coordinator.releaseRecorded({
    project: projectFor("completed"),
    runId: "run:session",
    operationalCapability: persistentOperation(),
  });
  assertEquals(activations, []);
  assertEquals(cleanups, []);
});

Deno.test("recorded execution cleanup fails closed on a mismatched lease scope", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const activations: string[] = [];
  const cleanups: string[] = [];
  const coordinator = recordedCleanupCoordinator(leases, activations, cleanups);
  const operation = persistentOperation();
  const session = await coordinator.begin({
    project: projectFor("queued"),
    runId: "run:session",
    operationalCapability: operation,
    microsandboxExecutionProfiles: [],
    recheck: () => Promise.resolve(operation),
  });
  await leases.release(session.lease.id);
  await leases.claim({
    ...session.lease,
    bindingIds: ["foreign-binding"],
  });

  await assertRejects(
    () =>
      coordinator.releaseRecorded({
        project: projectFor("completed"),
        runId: "run:session",
        operationalCapability: operation,
      }),
    Error,
    "another operational scope",
  );
  assertEquals(cleanups, []);
  assertEquals((await leases.read(session.lease.id))?.bindingIds, ["foreign-binding"]);
});

Deno.test("recorded execution cleanup refuses a non-terminal run and retains on failed host cleanup", async () => {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const activations: string[] = [];
  const cleanups: string[] = [];
  const coordinator = recordedCleanupCoordinator(leases, activations, cleanups, {
    failRelease: true,
  });
  const operation = persistentOperation();
  await assertRejects(
    () =>
      coordinator.releaseRecorded({
        project: projectFor("running"),
        runId: "run:session",
        operationalCapability: operation,
      }),
    Error,
    "durable terminal run",
  );
  assertEquals(activations, []);

  const session = await coordinator.begin({
    project: projectFor("queued"),
    runId: "run:session",
    operationalCapability: operation,
    microsandboxExecutionProfiles: [],
    recheck: () => Promise.resolve(operation),
  });
  await assertRejects(
    () =>
      coordinator.releaseRecorded({
        project: projectFor("completed"),
        runId: "run:session",
        operationalCapability: operation,
      }),
    Error,
    "stop failed",
  );
  assertEquals(cleanups, []);
  assertEquals((await leases.read(session.lease.id))?.id, session.lease.id);
});

function recordedCleanupCoordinator(
  leases: InMemoryCapabilityRuntimeLeaseStore,
  activations: string[],
  cleanups: string[],
  extras: { readonly failRelease?: boolean } = {},
) {
  return new CapabilityRuntimeExecutionSessionCoordinator({
    contexts: contextFor(),
    leases,
    groups: {
      ensureActive: async (input: {
        readonly group: CapabilityRuntimeLaunchGroupReference;
        readonly lease: CapabilityRuntimeLease;
      }) => {
        activations.push(input.group.id);
        const claim = await leases.claim(input.lease);
        return {
          group: input.group,
          states: new Map([[input.group.id, {
            material: "installed" as const,
            runtime: "active" as const,
          }]]),
          leaseDisposition: claim.status === "created"
            ? "created" as const
            : "reused" as const,
          mutation: undefined,
        };
      },
      releaseTerminal: async (input: { readonly leaseId: string }) => {
        if (extras.failRelease) throw new Error("stop failed");
        cleanups.push(input.leaseId);
        await leases.release(input.leaseId);
      },
    } as never,
    hasRemainingJitDemand: () => Promise.resolve(false),
    now: () => AT,
  });
}

function persistentOperation(): ResolvedCapabilityRuntimeOperation {
  const group = launchGroup("casys-observation");
  const material = persistentMaterial(
    "casys.mcp-build123d-observation",
    "mcp-build123d-observation-image",
    "c".repeat(64),
  );
  return {
    schemaVersion: "resolved-capability-runtime-operation/2.0",
    projectId: PROJECT_ID,
    operation: { id: "verify.observe-assembly-integrity", version: "1" },
    authorizationFingerprint: FINGERPRINT,
    demandFingerprint: FINGERPRINT,
    registryFingerprint: FINGERPRINT,
    bindings: [persistentBinding("observe", material, group)],
  };
}

function launchGroup(id: string): CapabilityRuntimeLaunchGroupReference {
  return { id, version: "1.0.0", fingerprint: FINGERPRINT };
}

function persistentMaterial(
  unitId: string,
  materialId: string,
  imageDigest: string,
): CapabilityRuntimeMaterialIdentity {
  return { unitId, materialId, imageDigest };
}

function microMaterial(): CapabilityRuntimeMaterialIdentity {
  return persistentMaterial("casys.calculix-worker", "worker", "d".repeat(64));
}

function spiceRuntimeMaterial(): CapabilityRuntimeMaterialIdentity {
  return persistentMaterial(
    "casys.spice-worker",
    "ngspice-runtime-image",
    "2".repeat(64),
  );
}

function modelicaRuntimeMaterial(): CapabilityRuntimeMaterialIdentity {
  return persistentMaterial(
    "casys.modelica-worker",
    "modelica-worker-image",
    "3".repeat(64),
  );
}

function admittedSpiceOperation(): ResolvedCapabilityRuntimeOperation {
  const runtime = spiceRuntimeMaterial();
  return {
    schemaVersion: "resolved-capability-runtime-operation/2.0",
    projectId: PROJECT_ID,
    operation: { id: "simulate.run-admitted-spice", version: "1" },
    authorizationFingerprint: FINGERPRINT,
    demandFingerprint: FINGERPRINT,
    registryFingerprint: FINGERPRINT,
    bindings: [{
      capability: {
        id: "electronics.run-admitted-spice",
        version: "1",
        use: "execution",
        minimumQualification: "qualified",
      },
      binding: { id: "ngspice-admitted-circuit", version: "1" },
      effectiveQualification: "qualified",
      adapter: {
        id: "ngspice-admitted-execution-adapter",
        version: "1",
        source: "server",
      },
      profile: {
        id: "spice-admitted-execution",
        version: "2",
        fingerprint: FINGERPRINT,
      },
      materials: [runtime],
      runtimeModes: [runtimeMode(runtime)],
      hostLifecycles: [{
        material: runtime,
        kind: "ephemeral-microsandbox",
        launchGroup: null,
      }],
    }],
  };
}

function admittedModelicaOperation(): ResolvedCapabilityRuntimeOperation {
  const runtime = modelicaRuntimeMaterial();
  return {
    schemaVersion: "resolved-capability-runtime-operation/2.0",
    projectId: PROJECT_ID,
    operation: { id: "simulate.run-admitted-modelica", version: "1" },
    authorizationFingerprint: FINGERPRINT,
    demandFingerprint: FINGERPRINT,
    registryFingerprint: FINGERPRINT,
    bindings: [{
      capability: {
        id: "simulation.run-admitted-modelica",
        version: "1",
        use: "execution",
        minimumQualification: "qualified",
      },
      binding: { id: "openmodelica-admitted-modelica", version: "1" },
      effectiveQualification: "qualified",
      adapter: {
        id: "modelica-admitted-execution-adapter",
        version: "1",
        source: "server",
      },
      profile: {
        id: "modelica-admitted-execution",
        version: "2",
        fingerprint: FINGERPRINT,
      },
      materials: [runtime],
      runtimeModes: [runtimeMode(runtime)],
      hostLifecycles: [{
        material: runtime,
        kind: "ephemeral-microsandbox",
        launchGroup: null,
      }],
    }],
  };
}

function operationFor(
  alpha: CapabilityRuntimeLaunchGroupReference,
  bravo: CapabilityRuntimeLaunchGroupReference,
): ResolvedCapabilityRuntimeOperation {
  const alphaDb = persistentMaterial("casys.alpha", "db", "a".repeat(64));
  const alphaApp = persistentMaterial("casys.alpha", "app", "b".repeat(64));
  const bravoWorker = persistentMaterial("casys.bravo", "worker", "c".repeat(64));
  const micro = microMaterial();
  return {
    schemaVersion: "resolved-capability-runtime-operation/2.0",
    projectId: PROJECT_ID,
    operation: { id: "verify.session", version: "1" },
    authorizationFingerprint: FINGERPRINT,
    demandFingerprint: FINGERPRINT,
    registryFingerprint: FINGERPRINT,
    bindings: [
      persistentBinding("alpha-db", alphaDb, alpha),
      persistentBinding("alpha-app", alphaApp, alpha),
      persistentBinding("bravo-worker", bravoWorker, bravo),
      {
        capability: {
          id: "mechanics.static-fea",
          version: "1",
          use: "execution",
          minimumQualification: "qualified",
        },
        binding: { id: "calculix-worker", version: "1" },
        effectiveQualification: "qualified" as const,
        adapter: { id: "calculix-worker", version: "1", source: "server" },
        profile: null,
        materials: [micro],
        runtimeModes: [runtimeMode(micro)],
        hostLifecycles: [{
          material: micro,
          kind: "ephemeral-microsandbox",
          launchGroup: null,
        }],
      },
    ],
  };
}

function persistentBinding(
  id: string,
  material: CapabilityRuntimeMaterialIdentity,
  launchGroup: CapabilityRuntimeLaunchGroupReference,
) {
  return {
    capability: {
      id: `runtime.${id}`,
      version: "1",
      use: "execution" as const,
      minimumQualification: "qualified" as const,
    },
    binding: { id, version: "1" },
    effectiveQualification: "qualified" as const,
    adapter: { id, version: "1", source: "server" },
    profile: null,
    materials: [material],
    runtimeModes: [runtimeMode(material)],
    hostLifecycles: [{ material, kind: "persistent-compose" as const, launchGroup }],
  };
}

function runtimeMode(material: CapabilityRuntimeMaterialIdentity) {
  return {
    material,
    targetPlatform: "linux/arm64" as const,
    mode: "native" as const,
    qualificationAttestationFingerprint: null,
  };
}

function contextFor(): ProjectCapabilityRuntimeContextReader {
  return {
    read: () =>
      Promise.resolve({
        catalog: {
          units: [{
            id: "casys.calculix-worker",
            version: "1",
            manifestFingerprint: FINGERPRINT,
            materials: [{
              id: "worker",
              imageReference:
                `example.test/calculix@sha256:${microMaterial().imageDigest}`,
            }],
          }],
        },
      } as never),
  };
}

function contextForExactMaterials(
  materials: readonly CapabilityRuntimeMaterialIdentity[],
): ProjectCapabilityRuntimeContextReader {
  const units = new Map<string, {
    id: string;
    version: string;
    manifestFingerprint: typeof FINGERPRINT;
    materials: { id: string; imageReference: string }[];
  }>();
  for (const material of materials) {
    const unit = units.get(material.unitId) ?? {
      id: material.unitId,
      version: "1",
      manifestFingerprint: FINGERPRINT,
      materials: [],
    };
    unit.materials.push({
      id: material.materialId,
      imageReference:
        `example.test/${material.unitId}/${material.materialId}@sha256:${material.imageDigest}`,
    });
    units.set(material.unitId, unit);
  }
  return {
    read: () => Promise.resolve({ catalog: { units: [...units.values()] } } as never),
  };
}

function materialKey(material: CapabilityRuntimeMaterialIdentity): string {
  return `${material.unitId}\u0000${material.materialId}`;
}

function projectFor(
  status: "queued" | "running" | "completed" = "queued",
  withThreadBasis = false,
): EngineeringProjectSnapshot {
  return {
    id: "snapshot:session",
    project: { id: PROJECT_ID },
    revision: 1,
    agentRuns: [{
      id: "run:session",
      status,
      ...(withThreadBasis
        ? {
          basis: {
            kind: "thread-snapshot",
            snapshotId: "subject:thread:r4",
            revision: 4,
            subjectId: "subject",
          },
        }
        : {}),
    }],
  } as unknown as EngineeringProjectSnapshot;
}

async function reconciledDidNotWriteProject(
  operation: ResolvedCapabilityRuntimeOperation,
): Promise<EngineeringProjectSnapshot> {
  const basis = {
    kind: "thread-snapshot" as const,
    snapshotId: "subject:thread:r4",
    revision: 4,
    subjectId: "subject",
  };
  const origin = { kind: "human" as const, actorId: "operator" };
  const parameters = [
    { key: "reconcileAction", label: "Action", value: "resolve-uncertain-writer" },
    {
      key: "reconcileOperation",
      label: "Operation",
      value: "record.reconcile-uncertain-writer@1",
    },
    { key: "reconcileRunId", label: "Run", value: "run:failed" },
    {
      key: "reconcileFailureCode",
      label: "Failure",
      value: "model-write-architecture-provider-outcome-unknown",
    },
    { key: "reconcileBasisSnapshotId", label: "Basis", value: basis.snapshotId },
    { key: "reconcileOutcome", label: "Outcome", value: "provider-did-not-write" },
    {
      key: "reconcileAttestation",
      label: "Attestation",
      value: "Provider history shows no write.",
    },
  ];
  const decision = {
    id: "decision:reconcile",
    phaseId: "phase",
    title: "Reconcile",
    question: "What did the provider do?",
    status: "approved" as const,
    requestedAt: "2026-08-10T00:00:00.000Z",
    baseSnapshot: basis,
    inputEvidenceRefs: [],
    approvalIds: ["approval:reconcile"],
    proposal: {
      summary: "Provider inspection found no write.",
      proposedAt: "2026-08-10T00:00:00.000Z",
      proposedBy: { id: "agent", origin: "agent" as const },
      parameters,
    },
  };
  const decisionFingerprint = await sha256Fingerprint({
    baseSnapshot: decision.baseSnapshot,
    inputEvidenceRefs: decision.inputEvidenceRefs,
    proposal: {
      summary: decision.proposal.summary,
      parameters: decision.proposal.parameters,
    },
  });
  const command = {
    commandId: "reconcile-command",
    projectId: PROJECT_ID,
    expectedRevision: 8,
    issuedAt: "2026-08-10T00:00:00.000Z",
    reconciliationRunId: "run:reconcile",
    failedRunId: "run:failed",
    decisionId: decision.id,
    outcome: "provider-did-not-write" as const,
    providerInspectionAttestation: "Provider history shows no write.",
  };
  const requestFingerprint = await sha256Fingerprint({
    type: "agent-run.reconcile-annotation",
    origin,
    command,
  });
  const projectId = `${PROJECT_ID}:project:r9:${
    requestFingerprint.digest.slice(0, 16)
  }`;
  return {
    schemaVersion: "4.0",
    id: projectId,
    revision: 9,
    generatedAt: "2026-08-10T00:00:10.000Z",
    project: { id: PROJECT_ID, subjectId: basis.subjectId },
    threadSnapshots: [basis],
    phases: [{
      id: "phase",
      title: "Phase",
      workItemIds: ["work:failed", "work:reconcile"],
      requiredDecisionIds: [decision.id],
    }],
    workItems: [{
      id: "work:failed",
      activityId: "activity:failed",
      phaseId: "phase",
      title: "Failed writer",
      description: "Provider outcome unknown.",
      kind: "architect",
      operation: { ...operation.operation, bindings: [] },
      status: "ready",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [],
      blockerIds: [],
    }, {
      id: "work:reconcile",
      activityId: "activity:reconcile",
      phaseId: "phase",
      title: "Reconcile",
      description: "Human reconciliation.",
      kind: "review",
      operation: {
        id: "record.reconcile-uncertain-writer",
        version: "1",
        bindings: [],
      },
      status: "completed",
      owner: "human",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [decision.id],
      blockerIds: [],
    }],
    agentRuns: [{
      id: "run:failed",
      workItemId: "work:failed",
      status: "failed",
      summary: "Provider outcome unknown.",
      queuedAt: "2026-08-10T00:00:00.000Z",
      basis,
      evidenceRefs: [],
      failure: {
        code: "model-write-architecture-provider-outcome-unknown",
        message: "Provider outcome unknown.",
      },
      uncertainWriterReconciliation: {
        kind: "uncertain-writer-resolved",
        outcome: "provider-did-not-write",
        reconciledAt: "2026-08-10T00:00:10.000Z",
        reconciledBy: { id: "operator", origin: "human" },
        decisionId: decision.id,
        providerInspectionAttestation: command.providerInspectionAttestation,
      },
    }, {
      id: "run:reconcile",
      workItemId: "work:reconcile",
      status: "completed",
      summary: "Uncertain-writer reconciliation completed by human operator.",
      queuedAt: "2026-08-10T00:00:00.000Z",
      completedAt: "2026-08-10T00:00:10.000Z",
      basis,
      evidenceRefs: [],
      annotationOnly: true,
      statusHistory: [{
        status: "completed",
        at: "2026-08-10T00:00:10.000Z",
        summary: "Uncertain-writer reconciliation completed by human operator.",
        actor: { id: "operator", origin: "human" },
        commandId: command.commandId,
      }],
    }],
    decisions: [{ ...decision, inputFingerprint: decisionFingerprint }],
    approvals: [{
      id: "approval:reconcile",
      decisionId: decision.id,
      status: "approved",
      requestedAt: "2026-08-10T00:00:00.000Z",
      decidedAt: "2026-08-10T00:00:01.000Z",
      decidedBy: "operator",
      decidedByOrigin: "human",
      rationale: "Inspected provider.",
      baseSnapshot: basis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [],
    }],
    blockers: [],
    commandReceipts: [{
      commandId: command.commandId,
      type: "agent-run.reconcile-annotation",
      actor: { id: "operator", origin: "human" },
      issuedAt: command.issuedAt,
      appliedAt: "2026-08-10T00:00:10.000Z",
      requestFingerprint,
      resultingSnapshot: { snapshotId: projectId, revision: 9 },
    }],
  } as unknown as EngineeringProjectSnapshot;
}
