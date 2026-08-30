import { assertEquals, assertRejects } from "@std/assert";
import {
  type CapabilityRuntimeLaunchGroup,
  capabilityRuntimeLaunchGroupReference,
  fingerprintCapabilityRuntimeLaunchGroup,
} from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import {
  CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID,
  type CapabilityRuntimeJournalEntry,
  createCapabilityRuntimeAdministrativeRemovalPlan,
  createEffectiveCapabilityRuntimeLaunchProjection,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import { FixedCapabilityRuntimeLaunchGroupRegistry } from "../../application/control-plane/capability-runtime-launch-group-registry.ts";
import {
  authorizeDurableAdministrativeMaterialRemoval,
  authorizeDurableMaterialAcquire,
  authorizeDurableNormalRuntimeStart,
  authorizeDurableQualificationRuntimeStart,
  authorizeDurableRuntimeStop,
} from "../../application/control-plane/capability-runtime-host-authorization.ts";
import {
  authorizeDurableRolloverSuccessorMaterialAcquire,
  authorizeDurableRolloverSuccessorRuntimeStart,
} from "../../application/control-plane/capability-runtime-rollover-host-authorization.ts";
import {
  sysonRolloverIdentityFor,
} from "../../application/control-plane/capability-runtime-syson-rollover-definition.ts";
import { InMemoryCapabilityRuntimeJournal } from "./in-memory-capability-runtime-supervisor.ts";
import {
  createFirstPartyCapabilityRuntimeLaunchGroups,
  createFirstPartySysonRolloverPredecessorLaunchGroup,
} from "./first-party-capability-runtime-launch-groups.ts";
import {
  createFirstPartyCapabilityRuntimeCatalog,
  createFirstPartySysonRolloverPredecessorUnit,
} from "./first-party-capability-binding-catalog.ts";
import {
  FileCapabilityRuntimeRolloverSagaStore,
} from "./file-capability-runtime-rollover-saga-store.ts";
import { createCapabilityRuntimeHostAdapter } from "./compose-capability-runtime-host.ts";
import {
  CHRONO_MCP_BEARER_TOKEN_SLOT,
} from "./local-chrono-runtime-secret-resolver.ts";
import type {
  CapabilityRuntimeLaunchSecretInjector,
  CapabilityRuntimeSecretSlotObserver,
  CapabilityRuntimeSecretSnapshot,
} from "../../application/ports/out/capability/capability-runtime-supervisor.ts";
import type { CommandResult, CommandRunner } from "../shared/docker-observer.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";

Deno.test("relative compose root stays lexical and never realPaths the worktree", async () => {
  const group = await sysonGroup();
  const runner = new FakeGroupRunner(group, { images: false, state: "absent" });
  const journal = new InMemoryCapabilityRuntimeJournal();
  const realPathCalls: string[] = [];
  const runtime = createCapabilityRuntimeHostAdapter({
    registry: new FixedCapabilityRuntimeLaunchGroupRegistry([group]),
    journal,
    secrets: {
      observe: (slots) =>
        Promise.resolve(new Map(slots.map((slot) => [slot, "available" as const]))),
    },
    runner,
    paths: {
      realPath: (path) => {
        realPathCalls.push(path);
        return Promise.reject(new Error(`must not realPath ${path}`));
      },
    },
  });

  await runtime.observe([group.materials[0]!.material]);

  assertEquals(realPathCalls, []);
  const compose = runner.calls.find((call) => call[1] === "compose");
  assertEquals(compose?.includes("--project-directory"), true);
  assertEquals(compose?.includes("."), true);
});

Deno.test("Compose host pulls the whole exact group then starts it with health wait and no dependency suppression", async () => {
  const group = await sysonGroup();
  const runner = new FakeGroupRunner(group, { images: false, state: "absent" });
  const fixture = host(group, runner);

  const acquired = await mutate(fixture, group, "material-acquire");
  const started = await mutate(fixture, group, "runtime-start");

  assertEquals(acquired.status, "succeeded");
  assertEquals(started.status, "succeeded");
  const pull = runner.calls.find((call) => call.includes("pull"))!;
  assertEquals(pull.includes("--no-deps"), false);
  const up = runner.calls.find((call) => call.includes("up"))!;
  assertEquals(up.includes("--wait"), true);
  assertEquals(up.includes("--pull"), true);
  assertEquals(up.includes("never"), true);
  assertEquals(up.includes("--no-deps"), false);
  assertEquals(up.includes("--no-recreate"), false);
  assertEquals(up.includes("--remove-orphans"), false);
  assertEquals(
    runner.stdin.every((content) => content === group.compose.content),
    true,
  );
  assertNoDestructiveComposeCommand(runner);
});

Deno.test("Compose host performs the sealed SysON successor rollover commands exactly once", async () => {
  const fixture = await rolloverHostFixture();
  try {
    await assertRejects(
      () =>
        fixture.host.acquireRolloverSuccessorMaterial({
          authorization: {} as never,
        }),
      Error,
      "authorization is absent or consumed",
    );
    assertEquals(
      fixture.runner.calls.filter((call) => call.includes("pull")).length,
      0,
    );

    await fixture.sagas.prepare(fixture.identity);
    const materialAuthorization =
      await authorizeDurableRolloverSuccessorMaterialAcquire(
        fixture.identity,
        fixture.sagas,
      );
    const acquired = await fixture.host.acquireRolloverSuccessorMaterial({
      authorization: materialAuthorization,
    });
    assertEquals(acquired.classification, "predecessor");
    assertEquals(acquired.successor.materials, "complete");
    const pullCommands = fixture.runner.calls.filter((call) => call.includes("pull"));
    assertEquals(pullCommands.length, 1);
    assertEquals(pullCommands[0], composeCommand(fixture.successor, ["pull"]));
    await assertRejects(
      () =>
        fixture.host.acquireRolloverSuccessorMaterial({
          authorization: materialAuthorization,
        }),
      Error,
      "authorization is absent or consumed",
    );
    assertEquals(
      fixture.runner.calls.filter((call) => call.includes("pull")).length,
      1,
    );

    await fixture.sagas.advance(fixture.identity, {
      phase: "successor-material-observed",
      evidenceFingerprint: await sha256Fingerprint(acquired),
    });
    const startAuthorization = await authorizeDurableRolloverSuccessorRuntimeStart(
      fixture.identity,
      fixture.sagas,
    );
    const activated = await fixture.host.activateRolloverSuccessor({
      authorization: startAuthorization,
    });
    assertEquals(activated.classification, "successor");
    assertEquals(activated.successor.runtime, "active");
    const upCommands = fixture.runner.calls.filter((call) => call.includes("up"));
    assertEquals(upCommands.length, 1);
    assertEquals(
      upCommands[0],
      composeCommand(fixture.successor, [
        "up",
        "--detach",
        "--wait",
        "--wait-timeout",
        "300",
        "--pull",
        "never",
        "--no-build",
      ]),
    );
    await assertRejects(
      () =>
        fixture.host.activateRolloverSuccessor({ authorization: startAuthorization }),
      Error,
      "authorization is absent or consumed",
    );
    assertEquals(fixture.runner.calls.filter((call) => call.includes("up")).length, 1);
    assertNoRolloverDestructiveCommand(fixture.runner);
  } finally {
    await fixture.dispose();
  }
});

Deno.test("Compose host normal-start reconciles only an observed registered rollover predecessor", async () => {
  const fixture = await rolloverHostFixture();
  try {
    fixture.runner.installSuccessorMaterial();

    const started = await mutate(
      { host: fixture.host, journal: fixture.journal },
      fixture.successor,
      "runtime-start",
    );

    assertEquals(started.status, "succeeded");
    assertEquals(
      fixture.runner.calls.filter((call) => call.includes("up")),
      [
        composeCommand(fixture.successor, [
          "up",
          "--detach",
          "--wait",
          "--wait-timeout",
          "300",
          "--pull",
          "never",
          "--no-build",
        ]),
      ],
    );
  } finally {
    await fixture.dispose();
  }
});

Deno.test("Compose host normal-start does not reconcile a predecessor without complete successor material", async () => {
  const fixture = await rolloverHostFixture();
  try {
    const observed = await fixture.host.observeRollover({
      identity: fixture.identity,
    });
    assertEquals(observed.classification, "predecessor");
    assertEquals(observed.successor.materials, "incomplete");

    const started = await mutate(
      { host: fixture.host, journal: fixture.journal },
      fixture.successor,
      "runtime-start",
    );

    assertEquals(started.status, "failed");
    assertEquals(fixture.runner.calls.some((call) => call.includes("up")), false);
  } finally {
    await fixture.dispose();
  }
});

Deno.test("Compose host keeps qualification-start and unregistered mismatch fail-closed", async () => {
  const rollover = await rolloverHostFixture();
  try {
    rollover.runner.installSuccessorMaterial();
    const qualification = await mutate(
      { host: rollover.host, journal: rollover.journal },
      rollover.successor,
      "runtime-qualification-start",
    );
    assertEquals(qualification.status, "failed");
    assertEquals(rollover.runner.calls.some((call) => call.includes("up")), false);
  } finally {
    await rollover.dispose();
  }

  const group = await sysonGroup();
  const runner = new FakeGroupRunner(group, {
    images: true,
    state: "running",
    foreignService: "mcp-syson",
  });
  const fixture = host(group, runner);
  const normal = await mutate(fixture, group, "runtime-start");
  assertEquals(normal.status, "failed");
  assertEquals(runner.calls.some((call) => call.includes("up")), false);
});

Deno.test("Compose host rejects ambiguous registered rollover successors without reconciling", async () => {
  const fixture = await rolloverHostFixture({ duplicateSuccessorDefinition: true });
  try {
    fixture.runner.installSuccessorMaterial();

    const normal = await mutate(
      { host: fixture.host, journal: fixture.journal },
      fixture.successor,
      "runtime-start",
    );

    assertEquals(normal.status, "failed");
    assertEquals(fixture.runner.calls.some((call) => call.includes("up")), false);
  } finally {
    await fixture.dispose();
  }
});

Deno.test("Compose host rejects hybrid and unknown registered rollover observations without reconciling", async () => {
  for (const options of [
    { mismatchedSharedService: "syson-db" },
    { unknownPredecessorObservation: true },
  ] as const) {
    const fixture = await rolloverHostFixture(options);
    try {
      fixture.runner.installSuccessorMaterial();

      const normal = await mutate(
        { host: fixture.host, journal: fixture.journal },
        fixture.successor,
        "runtime-start",
      );

      assertEquals(normal.status, "failed");
      assertEquals(fixture.runner.calls.some((call) => call.includes("up")), false);
    } finally {
      await fixture.dispose();
    }
  }
});

Deno.test("Compose host consumes only the private qualification-start brand for the same sealed health-wait start", async () => {
  const group = await sysonGroup();
  const runner = new FakeGroupRunner(group, { images: true, state: "absent" });
  const fixture = host(group, runner);

  const result = await mutate(fixture, group, "runtime-qualification-start");

  assertEquals(result.status, "succeeded");
  const up = runner.calls.find((call) => call.includes("up"));
  assertEquals(up?.includes("--wait"), true);
  assertEquals(up?.includes("--pull"), true);
  assertEquals(up?.includes("never"), true);
  assertNoDestructiveComposeCommand(runner);

  const stopped = await mutate(fixture, group, "runtime-stop");
  assertEquals(stopped.status, "succeeded");
  assertEquals(
    runner.calls.some((call) => call[1] === "container" && call[2] === "stop"),
    true,
  );
});

Deno.test("Compose host stops only exact owned IDs in reverse group order and preserves all material", async () => {
  const group = await sysonGroup();
  const runner = new FakeGroupRunner(group, { images: true, state: "running" });
  const fixture = host(group, runner);

  const result = await mutate(fixture, group, "runtime-stop");

  assertEquals(result.status, "succeeded");
  assertEquals(
    runner.calls.filter((call) => call[1] === "container" && call[2] === "stop").map((
      call,
    ) => call[3]),
    ["container-mcp-syson", "container-syson-app", "container-syson-db"],
  );
  assertNoDestructiveComposeCommand(runner);
  assertEquals(
    runner.calls.some((call) => call[1] === "image" && call[2] === "rm"),
    false,
  );
  assertEquals(runner.calls.some((call) => call[1] === "volume"), false);
});

Deno.test("Compose host refuses a foreign same-name service without stopping its container", async () => {
  const group = await sysonGroup();
  const runner = new FakeGroupRunner(group, {
    images: true,
    state: "running",
    foreignService: "mcp-syson",
  });
  const fixture = host(group, runner);

  const result = await mutate(fixture, group, "runtime-stop");

  assertEquals(result.status, "failed");
  assertEquals(
    runner.calls.some((call) => call[1] === "container" && call[2] === "stop"),
    false,
  );
});

Deno.test("Compose host removes only the exact reviewed containers and digest references, never volumes or prune", async () => {
  const group = await sysonGroup();
  const runner = new FakeGroupRunner(group, { images: true, state: "running" });
  const fixture = host(group, runner);
  const plan = await removalPlan(group, "owned");
  const entry = removalEntry(group, plan);
  await fixture.journal.appendBeforeMutation(entry);

  const result = await fixture.host.mutate({
    authorization: await authorizeDurableAdministrativeMaterialRemoval(
      entry,
      plan,
      fixture.journal,
    ),
    removalPlan: plan,
  });

  assertEquals(result.status, "succeeded");
  assertEquals(
    runner.calls.filter((call) => call[1] === "container" && call[2] === "stop").map(
      (call) => call[3],
    ),
    ["container-mcp-syson", "container-syson-app", "container-syson-db"],
  );
  assertEquals(
    runner.calls.filter((call) => call[1] === "container" && call[2] === "rm").map(
      (call) => call[3],
    ),
    ["container-mcp-syson", "container-syson-app", "container-syson-db"],
  );
  assertEquals(
    runner.calls.filter((call) => call[1] === "image" && call[2] === "rm").map(
      (call) => call[3],
    ),
    group.materials.map((member) => member.imageReference),
  );
  assertEquals(
    runner.calls.some((call) =>
      call.includes("-v") || call.includes("--volumes") || call.includes("prune") ||
      call.includes("rmi") || call.includes("--force")
    ),
    false,
  );
  assertNoDestructiveComposeCommand(runner);
});

Deno.test("Compose host treats an exact already-absent group as a removal no-op", async () => {
  const group = await sysonGroup();
  const runner = new FakeGroupRunner(group, { images: false, state: "absent" });
  const fixture = host(group, runner);
  const plan = await removalPlan(group, "absent");
  const entry = removalEntry(group, plan);
  await fixture.journal.appendBeforeMutation(entry);

  const result = await fixture.host.mutate({
    authorization: await authorizeDurableAdministrativeMaterialRemoval(
      entry,
      plan,
      fixture.journal,
    ),
    removalPlan: plan,
  });

  assertEquals(result.status, "succeeded");
  assertEquals(
    runner.calls.some((call) =>
      call[1] === "container" && (call[2] === "stop" || call[2] === "rm")
    ) || runner.calls.some((call) => call[1] === "image" && call[2] === "rm"),
    false,
  );
});

Deno.test("Compose host refuses removal when another catalogue group retains the digest", async () => {
  const groups = await createFirstPartyCapabilityRuntimeLaunchGroups();
  const group = groups.find((candidate) => candidate.id === "casys-build123d-sandbox")!;
  const runner = new FakeGroupRunner(group, { images: true, state: "running" });
  const journal = new InMemoryCapabilityRuntimeJournal();
  const runtime = createCapabilityRuntimeHostAdapter({
    registry: new FixedCapabilityRuntimeLaunchGroupRegistry(groups),
    journal,
    secrets: {
      observe: (slots) =>
        Promise.resolve(new Map(slots.map((slot) => [slot, "available" as const]))),
    },
    runner,
    composeRoot: "/workspace",
    paths: { realPath: () => Promise.resolve("/canonical") },
  });
  const plan = await removalPlan(group, "owned");
  const entry = removalEntry(group, plan);
  await journal.appendBeforeMutation(entry);

  const result = await runtime.mutate({
    authorization: await authorizeDurableAdministrativeMaterialRemoval(
      entry,
      plan,
      journal,
    ),
    removalPlan: plan,
  });

  assertEquals(result.status, "failed");
  assertEquals(
    runner.calls.some((call) =>
      call[1] === "container" || call[1] === "image" && call[2] === "rm"
    ),
    false,
  );
});

Deno.test("Compose host refuses named-volume topology drift before treating CalculiX as owned", async () => {
  const group = await calculixGroup();
  const expected = descriptorMounts(group, "mcp-calculix");
  const variants: readonly {
    readonly name: string;
    readonly mounts: readonly Record<string, unknown>[];
  }[] = [
    {
      name: "bind",
      mounts: [
        { ...expected[0]!, Type: "bind", Name: "", Source: "/tmp/inputs" },
        expected[1]!,
      ],
    },
    { name: "missing", mounts: [] },
    {
      name: "mismatched-volume",
      mounts: [
        { ...expected[0]!, Name: "casys-mcp-calculix_other-inputs" },
        expected[1]!,
      ],
    },
    {
      name: "extra-volume",
      mounts: [
        ...expected,
        {
          Type: "volume",
          Name: "casys-mcp-calculix_extra",
          Destination: "/unexpected",
          RW: true,
        },
      ],
    },
  ];
  for (const variant of variants) {
    const runner = new FakeGroupRunner(group, {
      images: true,
      state: "running",
      mountsByService: { "mcp-calculix": variant.mounts },
    });
    const fixture = host(group, runner);

    const observed = await fixture.host.observe([group.materials[0]!.material]);
    assertEquals(
      observed.get(materialKey(group.materials[0]!.material))?.runtime,
      "degraded",
      variant.name,
    );
    const result = await mutate(fixture, group, "runtime-stop");
    assertEquals(result.status, "failed", variant.name);
    assertEquals(
      runner.calls.some((call) => call[1] === "container" && call[2] === "stop"),
      false,
      variant.name,
    );
  }
});

Deno.test("sealed SysON group has the one approved loopback publication and no historical 8180 exposure", async () => {
  const group = await sysonGroup();
  const descriptor = JSON.parse(group.compose.content) as {
    services: {
      "mcp-syson": { ports: string[] };
      "syson-app": Record<string, unknown>;
    };
  };

  assertEquals(descriptor.services["mcp-syson"].ports, ["127.0.0.1:3009:3009"]);
  assertEquals("ports" in descriptor.services["syson-app"], false);
  assertEquals(group.secretSlots, []);
});

Deno.test("sealed SysON group pins Postgres with its canonical Docker Hub repository", async () => {
  const group = await sysonGroup();
  const postgres = group.materials.find((member) => member.serviceName === "syson-db");

  assertEquals(
    postgres?.imageReference,
    "docker.io/library/postgres@sha256:926f8799aef36e00001cfe15fba7abbd37d3c5224ea57e4c858e4bb670f10561",
  );
});

Deno.test("Compose host accepts Docker Hub's official familiar RepoDigest spelling", async () => {
  const group = await sysonGroup();
  const postgres = group.materials.find((member) => member.serviceName === "syson-db")!;
  const runner = new FakeGroupRunner(group, {
    images: true,
    state: "running",
    repoDigestsByService: {
      "syson-db": [`postgres@sha256:${postgres.material.imageDigest}`],
    },
  });
  const fixture = host(group, runner);

  const observed = await fixture.host.observe(
    group.materials.map((member) => member.material),
  );

  assertEquals(
    observed.get(materialKey(postgres.material)),
    { material: "installed", runtime: "active" },
  );

  const plan = await removalPlan(group, "owned");
  const entry = removalEntry(group, plan);
  await fixture.journal.appendBeforeMutation(entry);
  const removal = await fixture.host.mutate({
    authorization: await authorizeDurableAdministrativeMaterialRemoval(
      entry,
      plan,
      fixture.journal,
    ),
    removalPlan: plan,
  });
  assertEquals(removal.status, "succeeded");
});

Deno.test("Compose host observes an exact RepoDigest when Docker reports additional aliases", async () => {
  const group = await sysonGroup();
  const postgres = group.materials.find((member) => member.serviceName === "syson-db")!;
  const runner = new FakeGroupRunner(group, {
    images: true,
    state: "running",
    repoDigestsByService: {
      "syson-db": [
        `postgres@sha256:${postgres.material.imageDigest}`,
        `registry.example/postgres-mirror@sha256:${postgres.material.imageDigest}`,
      ],
    },
  });
  const fixture = host(group, runner);

  const observed = await fixture.host.observe(
    group.materials.map((member) => member.material),
  );

  assertEquals(
    observed.get(materialKey(postgres.material)),
    { material: "installed", runtime: "active" },
  );
});

Deno.test("Compose host rejects non-equivalent RepoDigests even when Docker Hub names look familiar", async () => {
  const group = await sysonGroup();
  const postgres = group.materials.find((member) => member.serviceName === "syson-db")!;
  const mcpSyson = group.materials.find((member) =>
    member.serviceName === "mcp-syson"
  )!;
  const cases: readonly {
    readonly name: string;
    readonly member: typeof postgres;
    readonly repoDigest: string;
  }[] = [
    {
      name: "different digest",
      member: postgres,
      repoDigest: `postgres@sha256:${"a".repeat(64)}`,
    },
    {
      name: "tagged repository",
      member: postgres,
      repoDigest: `postgres:17@sha256:${postgres.material.imageDigest}`,
    },
    {
      name: "GHCR repository without its registry",
      member: mcpSyson,
      repoDigest: `casys-ai/mcp-syson@sha256:${mcpSyson.material.imageDigest}`,
    },
  ];

  for (const testCase of cases) {
    const runner = new FakeGroupRunner(group, {
      images: true,
      state: "running",
      repoDigestsByService: {
        [testCase.member.serviceName]: [testCase.repoDigest],
      },
    });
    const fixture = host(group, runner);

    const observed = await fixture.host.observe(
      group.materials.map((member) => member.material),
    );

    assertEquals(
      observed.get(materialKey(testCase.member.material))?.material,
      "failed",
      testCase.name,
    );
  }
});

Deno.test("Build123d group without a declared healthcheck is active only when its exact owned service is running", async () => {
  const group = (await createFirstPartyCapabilityRuntimeLaunchGroups()).find((
    candidate,
  ) => candidate.id === "casys-build123d-sandbox")!;
  const runner = new FakeGroupRunner(group, { images: true, state: "running" });
  const fixture = host(group, runner);

  const states = await fixture.host.observe(
    group.materials.map((member) => member.material),
  );

  assertEquals([...states.values()][0]?.runtime, "active");
});

Deno.test("Compose host translates only the observed Docker daemon platform, never the controller architecture", async () => {
  const group = await sysonGroup();
  const runner = new FakeGroupRunner(group, {
    images: false,
    state: "absent",
    hostPlatform: "linux/aarch64",
  });
  const fixture = host(group, runner);

  assertEquals(await fixture.host.observePlatform(), "linux/arm64");
  assertEquals(
    runner.calls.some((call) =>
      call[0] === "docker" && call[1] === "version" &&
      call[2] === "--format" && call[3] === "{{.Server.Os}}/{{.Server.Arch}}"
    ),
    true,
  );

  const mismatch = host(
    group,
    new FakeGroupRunner(group, {
      images: false,
      state: "absent",
      hostPlatform: "linux/ppc64le",
    }),
  );
  await assertRejects(
    () => mismatch.host.observePlatform(),
    Error,
    "unsupported or malformed",
  );
});

Deno.test("sealed Chrono topology has one exact AMD64 service with no host privilege or interpolation", async () => {
  const group = await chronoGroup();
  const descriptor = JSON.parse(group.compose.content) as {
    services: Record<string, Record<string, unknown>>;
    volumes: Record<string, unknown>;
  };
  const service = descriptor.services["mcp-chrono"]!;

  assertEquals(group.id, "casys-chrono");
  assertEquals(group.version, "1.0.0");
  assertEquals(group.secretSlots, [CHRONO_MCP_BEARER_TOKEN_SLOT]);
  assertEquals(group.materials.map((member) => member.material), [{
    unitId: "casys.mcp-chrono",
    materialId: "mcp-chrono-image",
    imageDigest: "b6302001725df4722d84096a51eeff7e7ffeee843690a2ba0cc417191c67683c",
  }]);
  assertEquals(
    service.image,
    "ghcr.io/casys-ai/mcp-chrono@sha256:b6302001725df4722d84096a51eeff7e7ffeee843690a2ba0cc417191c67683c",
  );
  assertEquals(service.platform, "linux/amd64");
  assertEquals(service.ports, ["127.0.0.1:3025:3025"]);
  assertEquals(service.volumes, ["chrono-data:/data"]);
  assertEquals(service.cap_drop, ["ALL"]);
  assertEquals(service.security_opt, ["no-new-privileges:true"]);
  assertEquals(descriptor.volumes, { "chrono-data": {} });
  assertEquals("environment" in service, false);
  assertEquals("devices" in service, false);
  assertEquals("privileged" in service, false);
  assertEquals("network_mode" in service, false);
  assertEquals(group.compose.content.includes("$"), false);
});

Deno.test("Compose host acquires Chrono material without requiring a secret or qualification", async () => {
  const group = await chronoGroup();
  const runner = new FakeGroupRunner(group, { images: true, state: "running" });
  const fixture = host(group, runner);

  const outcome = await mutate(fixture, group, "material-acquire");

  assertEquals(outcome.status, "succeeded");
  assertEquals(runner.calls.some((call) => call.includes("pull")), true);
});

Deno.test("Compose host stops an owned secret-bearing group after its topology policy degrades", async () => {
  const reviewed = await chronoGroup();
  const body = { ...reviewed, security: "unknown" as const };
  const degraded: CapabilityRuntimeLaunchGroup = {
    ...body,
    fingerprint: await fingerprintCapabilityRuntimeLaunchGroup(body),
  };
  const runner = new FakeGroupRunner(degraded, { images: true, state: "running" });
  // The default fixture has no available secret. Stop must never read it or
  // require a currently reviewed topology once the group is already owned.
  const fixture = host(degraded, runner);

  const outcome = await mutate(fixture, degraded, "runtime-stop");

  assertEquals(outcome.status, "succeeded");
  assertEquals(
    runner.calls.some((call) => call[1] === "container" && call[2] === "stop"),
    true,
  );
});

Deno.test("Compose host reconciles a secret-bearing group through stdin without journalling it or placing it in argv", async () => {
  const group = await chronoGroup();
  const token = "test-chrono-bearer-value";
  const snapshot = Object.freeze({}) as CapabilityRuntimeSecretSnapshot;
  const secrets: CapabilityRuntimeSecretSlotObserver = {
    observe: (slots) =>
      Promise.resolve(new Map(slots.map((slot) => [slot, "available" as const]))),
  };
  const secretInjector: CapabilityRuntimeLaunchSecretInjector = {
    composeOverlay: ({ group: overlayGroup, snapshot: suppliedSnapshot }) => {
      assertEquals(overlayGroup.id, "casys-chrono");
      assertEquals(suppliedSnapshot, snapshot);
      const descriptor = JSON.parse(overlayGroup.compose.content) as {
        services: Record<string, Record<string, unknown>>;
        volumes: Record<string, unknown>;
      };
      return Promise.resolve(
        new TextEncoder().encode(
          deterministicJson({
            ...descriptor,
            services: {
              ...descriptor.services,
              "mcp-chrono": {
                ...descriptor.services["mcp-chrono"],
                environment: { MCP_BEARER_TOKEN: token },
              },
            },
          }),
        ),
      );
    },
  };
  const runner = new FakeGroupRunner(group, { images: true, state: "running" });
  const fixture = host(group, runner, { secrets, secretInjector });

  const outcome = await mutate(fixture, group, "runtime-start", snapshot);

  assertEquals(outcome.status, "succeeded");
  assertEquals(outcome.detail?.includes(token) ?? false, false);
  assertEquals(
    runner.calls.some((call) => call.some((argument) => argument.includes(token))),
    false,
  );
  assertEquals(
    runner.stdin.some((content) =>
      content.includes(`\"MCP_BEARER_TOKEN\":\"${token}\"`)
    ),
    true,
  );
  assertEquals(JSON.stringify(await fixture.journal.list()).includes(token), false);
  assertEquals(
    JSON.stringify(await fixture.journal.listOutcomes()).includes(token),
    false,
  );
});

async function sysonGroup(): Promise<CapabilityRuntimeLaunchGroup> {
  return (await createFirstPartyCapabilityRuntimeLaunchGroups())[0]!;
}

async function rolloverHostFixture(
  options: {
    readonly duplicateSuccessorDefinition?: boolean;
    readonly mismatchedSharedService?: string;
    readonly unknownPredecessorObservation?: boolean;
  } = {},
) {
  const [catalog, predecessorUnit, predecessor, successor] = await Promise.all([
    createFirstPartyCapabilityRuntimeCatalog(),
    createFirstPartySysonRolloverPredecessorUnit(),
    createFirstPartySysonRolloverPredecessorLaunchGroup(),
    sysonGroup(),
  ]);
  const successorUnit = catalog.units.find((unit) => unit.id === "casys.syson-stack");
  if (!successorUnit) throw new Error("Expected the exact successor SysON unit.");
  const identity = sysonRolloverIdentityFor(
    {
      catalog,
      predecessor: {
        unit: predecessorUnit,
        launchGroup: predecessor,
      },
      successor: { unit: successorUnit, launchGroup: successor },
    },
    [],
    "2026-08-30T12:00:00.000Z",
  );
  const directory = await Deno.makeTempDir({ prefix: "compose-rollover-" });
  const sagas = new FileCapabilityRuntimeRolloverSagaStore(directory);
  const runner = new RolloverFakeGroupRunner(predecessor, successor, options);
  const journal = new InMemoryCapabilityRuntimeJournal();
  const host = createCapabilityRuntimeHostAdapter({
    registry: new FixedCapabilityRuntimeLaunchGroupRegistry([successor]),
    journal,
    secrets: { observe: () => Promise.resolve(new Map()) },
    runner,
    composeRoot: "/workspace",
    paths: { realPath: () => Promise.resolve("/canonical") },
    rollovers: options.duplicateSuccessorDefinition
      ? [{ predecessor, successor }, { predecessor, successor }]
      : [{ predecessor, successor }],
  });
  return {
    identity,
    sagas,
    runner,
    journal,
    host,
    successor,
    dispose: () => Deno.remove(directory, { recursive: true }),
  };
}

function composeCommand(
  group: CapabilityRuntimeLaunchGroup,
  operation: readonly string[],
): string[] {
  return [
    "docker",
    "compose",
    "--env-file",
    "/dev/null",
    "--project-name",
    group.acquisition.projectName,
    "--project-directory",
    "/canonical",
    "--file",
    "-",
    ...operation,
  ];
}

async function calculixGroup(): Promise<CapabilityRuntimeLaunchGroup> {
  const group = (await createFirstPartyCapabilityRuntimeLaunchGroups()).find(
    (candidate) => candidate.id === "casys-mcp-calculix",
  );
  if (!group) throw new Error("CalculiX launch group is absent.");
  return group;
}

async function chronoGroup(): Promise<CapabilityRuntimeLaunchGroup> {
  const group = (await createFirstPartyCapabilityRuntimeLaunchGroups()).find((
    candidate,
  ) => candidate.id === "casys-chrono");
  if (!group) throw new Error("Expected the exact Chrono launch group.");
  return group;
}

function host(
  group: CapabilityRuntimeLaunchGroup,
  runner: FakeGroupRunner,
  options: {
    readonly secrets?: CapabilityRuntimeSecretSlotObserver;
    readonly secretInjector?: CapabilityRuntimeLaunchSecretInjector;
  } = {},
) {
  const journal = new InMemoryCapabilityRuntimeJournal();
  const host = createCapabilityRuntimeHostAdapter({
    registry: new FixedCapabilityRuntimeLaunchGroupRegistry([group]),
    journal,
    secrets: options.secrets ?? {
      observe: (slots) =>
        Promise.resolve(new Map(slots.map((slot) => [slot, "unavailable" as const]))),
    },
    secretInjector: options.secretInjector,
    runner,
    composeRoot: "/workspace",
    paths: { realPath: () => Promise.resolve("/canonical") },
    clock: () => "2026-08-29T00:00:01.000Z",
  });
  return { host, journal };
}

async function mutate(
  fixture: ReturnType<typeof host>,
  group: CapabilityRuntimeLaunchGroup,
  action: CapabilityRuntimeJournalEntry["action"],
  secretSnapshot?: CapabilityRuntimeSecretSnapshot,
) {
  const entry: CapabilityRuntimeJournalEntry = {
    id: `group-${action}`,
    action,
    materials: group.materials.map((member) => member.material),
    launchGroup: capabilityRuntimeLaunchGroupReference(group),
    projectId: action === "runtime-qualification-start"
      ? CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID
      : "project-test",
    plannedAt: "2026-08-29T00:00:00.000Z",
    previousObservations: group.materials.map((member) => ({
      material: member.material,
      state: null,
    })),
    effectiveRuntimeProjection: action === "runtime-start"
      ? await projection(group)
      : null,
    qualificationStartAuthority: action === "runtime-qualification-start"
      ? qualificationAuthority()
      : null,
    administrativeRemovalPlanFingerprint: null,
  };
  await fixture.journal.appendBeforeMutation(entry);
  return await fixture.host.mutate({
    authorization: action === "material-acquire"
      ? await authorizeDurableMaterialAcquire(entry, fixture.journal)
      : action === "runtime-start"
      ? await authorizeDurableNormalRuntimeStart(entry, fixture.journal)
      : action === "runtime-qualification-start"
      ? await authorizeDurableQualificationRuntimeStart(entry, fixture.journal)
      : action === "runtime-stop"
      ? await authorizeDurableRuntimeStop(entry, fixture.journal)
      : (() => {
        throw new Error("Use removalEntry with its reviewed removal plan.");
      })(),
    secretSnapshot,
  });
}

function qualificationAuthority() {
  return {
    candidate: {
      id: "chrono-arm64-emulation-v1",
      fingerprint: { algorithm: "sha256" as const, digest: "a".repeat(64) },
    },
    reviewFingerprint: { algorithm: "sha256" as const, digest: "b".repeat(64) },
  };
}

class FakeGroupRunner implements CommandRunner {
  readonly calls: string[][] = [];
  readonly stdin: string[] = [];
  #images: boolean;
  #states: Map<string, "running" | "exited">;

  constructor(
    private readonly group: CapabilityRuntimeLaunchGroup,
    options: {
      readonly images: boolean;
      readonly state: "absent" | "running";
      readonly foreignService?: string;
      readonly mountsByService?: Readonly<
        Record<string, readonly Record<string, unknown>[]>
      >;
      readonly repoDigestsByService?: Readonly<Record<string, readonly string[]>>;
      readonly hostPlatform?: string;
    },
  ) {
    this.#images = options.images;
    this.#states = new Map(
      options.state === "absent"
        ? []
        : group.materials.map((member) => [member.serviceName, "running"] as const),
    );
    this.foreignService = options.foreignService;
    this.mountsByService = options.mountsByService ?? {};
    this.repoDigestsByService = options.repoDigestsByService ?? {};
    this.hostPlatform = options.hostPlatform ?? "linux/arm64";
  }

  readonly foreignService: string | undefined;
  readonly mountsByService: Readonly<
    Record<string, readonly Record<string, unknown>[]>
  >;
  readonly repoDigestsByService: Readonly<Record<string, readonly string[]>>;
  readonly hostPlatform: string;

  async run(
    command: string,
    args: string[],
    _cwd: string,
    options: { readonly stdin?: Uint8Array } = {},
  ): Promise<CommandResult> {
    await Promise.resolve();
    this.calls.push([command, ...args]);
    if (options.stdin) this.stdin.push(new TextDecoder().decode(options.stdin));
    if (args[0] === "version") return success(this.hostPlatform);
    if (args[0] === "image" && args[1] === "inspect") {
      const requested = args[2]!;
      const member = this.group.materials.find((candidate) =>
        candidate.imageReference === requested ||
        `sha256:${candidate.serviceName}` === requested
      );
      return this.#images && member
        ? success(JSON.stringify([{
          RepoDigests: this.repoDigestsByService[member.serviceName] ?? [
            member.imageReference,
          ],
        }]))
        : failure("No such image");
    }
    if (args[0] === "container" && args[1] === "ls") {
      const reference = args.find((value) => value.startsWith("ancestor="))?.slice(
        "ancestor=".length,
      );
      const member = this.group.materials.find((candidate) =>
        candidate.imageReference === reference
      );
      return success(
        member && this.#states.has(member.serviceName)
          ? JSON.stringify({ ID: `container-${member.serviceName}` })
          : "",
      );
    }
    if (args[0] === "inspect") {
      const service = args[1]!.replace("container-", "");
      if (
        !this.group.materials.some((candidate) => candidate.serviceName === service)
      ) {
        return failure("unknown container");
      }
      return success(JSON.stringify([{
        Id: `container-${service}`,
        Image: `sha256:${service}`,
        Config: {
          Labels: {
            "com.docker.compose.project": service === this.foreignService
              ? "foreign-project"
              : this.group.acquisition.projectName,
            "com.docker.compose.service": service,
            ...(service === this.foreignService ? { foreign: "true" } : {}),
          },
        },
        State: {
          Status: this.#states.get(service) ?? "exited",
          Health: serviceDeclaresHealthcheck(this.group, service)
            ? {
              Status: this.#states.get(service) === "running" ? "healthy" : "unhealthy",
            }
            : null,
        },
        Mounts: this.mountsByService[service] ?? descriptorMounts(this.group, service),
      }]));
    }
    if (args.includes("ps")) {
      return success(JSON.stringify([...this.#states].map(([service, state]) => ({
        Service: service,
        ID: `container-${service}`,
        State: state,
      }))));
    }
    if (args.includes("pull")) this.#images = true;
    if (args.includes("up")) {
      for (const member of this.group.materials) {
        this.#states.set(member.serviceName, "running");
      }
    }
    if (args[0] === "container" && args[1] === "stop") {
      this.#states.set(args[2]!.replace("container-", ""), "exited");
    }
    if (args[0] === "container" && args[1] === "rm") {
      this.#states.delete(args[2]!.replace("container-", ""));
    }
    if (args[0] === "image" && args[1] === "rm") this.#images = false;
    return success("");
  }
}

/**
 * Minimal two-topology fake for the one server-owned SysON transition. It
 * models Docker's retained predecessor image separately from the container's
 * active image, which is what lets the adapter distinguish material preload
 * from the later sealed `up --wait` handoff.
 */
class RolloverFakeGroupRunner implements CommandRunner {
  readonly calls: string[][] = [];
  readonly stdin: string[] = [];
  readonly #installed = new Set<string>();
  readonly #states = new Map<string, "running" | "exited">();
  #active: CapabilityRuntimeLaunchGroup;

  constructor(
    private readonly predecessor: CapabilityRuntimeLaunchGroup,
    private readonly successor: CapabilityRuntimeLaunchGroup,
    private readonly options: {
      readonly mismatchedSharedService?: string;
      readonly unknownPredecessorObservation?: boolean;
    } = {},
  ) {
    this.#active = predecessor;
    for (const member of predecessor.materials) {
      this.#installed.add(member.imageReference);
      this.#states.set(member.serviceName, "running");
    }
  }

  installSuccessorMaterial(): void {
    for (const member of this.successor.materials) {
      this.#installed.add(member.imageReference);
    }
  }

  async run(
    command: string,
    args: string[],
    _cwd: string,
    options: { readonly stdin?: Uint8Array } = {},
  ): Promise<CommandResult> {
    await Promise.resolve();
    this.calls.push([command, ...args]);
    const input = options.stdin ? new TextDecoder().decode(options.stdin) : undefined;
    if (input !== undefined) this.stdin.push(input);
    if (args[0] === "image" && args[1] === "inspect") {
      const reference = args[2]!;
      const actualService = reference.startsWith("sha256:")
        ? reference.slice("sha256:".length)
        : undefined;
      const activeMember = actualService === undefined
        ? undefined
        : this.#active.materials.find(
          (candidate) => candidate.serviceName === actualService,
        );
      if (activeMember && this.#installed.has(activeMember.imageReference)) {
        return success(
          JSON.stringify([{ RepoDigests: [activeMember.imageReference] }]),
        );
      }
      if (this.#installed.has(reference)) {
        return success(JSON.stringify([{ RepoDigests: [reference] }]));
      }
      return failure("No such image");
    }
    if (args[0] === "inspect") {
      const service = args[1]!.replace("container-", "");
      const member = this.#active.materials.find((candidate) =>
        candidate.serviceName === service
      );
      if (!member) return failure("unknown container");
      return success(JSON.stringify([{
        Id: `container-${service}`,
        Image: `sha256:${service}`,
        Config: {
          Labels: {
            "com.docker.compose.project": service === this.options.mismatchedSharedService
              ? "foreign-project"
              : this.#active.acquisition.projectName,
            "com.docker.compose.service": service,
          },
        },
        State: {
          Status: this.#states.get(service) ?? "exited",
          Health: serviceDeclaresHealthcheck(this.#active, service)
            ? {
              Status: this.#states.get(service) === "running" ? "healthy" : "unhealthy",
            }
            : null,
        },
        Mounts: descriptorMounts(this.#active, service),
      }]));
    }
    if (args.includes("ps")) {
      if (
        this.options.unknownPredecessorObservation &&
        input === this.predecessor.compose.content
      ) {
        return failure("predecessor Docker observation unavailable");
      }
      return success(JSON.stringify([...this.#states].map(([service, state]) => ({
        Service: service,
        ID: `container-${service}`,
        State: state,
      }))));
    }
    if (args.includes("pull")) {
      for (const member of this.successor.materials) {
        this.#installed.add(member.imageReference);
      }
      return success("");
    }
    if (args.includes("up")) {
      if (input?.includes(this.successor.compose.content)) {
        this.#active = this.successor;
      }
      for (const member of this.#active.materials) {
        this.#states.set(member.serviceName, "running");
      }
      return success("");
    }
    return success("");
  }
}

async function removalPlan(
  group: CapabilityRuntimeLaunchGroup,
  state: "owned" | "absent",
) {
  return await createCapabilityRuntimeAdministrativeRemovalPlan({
    launchGroup: capabilityRuntimeLaunchGroupReference(group),
    ownedMaterials: group.materials.map((member) => member.material),
    observedMaterials: group.materials.map((member) => ({
      material: member.material,
      state,
    })),
    ownedContainerIds: state === "owned"
      ? group.materials.map((member) => ({
        material: member.material,
        containerId: `container-${member.serviceName}`,
      }))
      : [],
  });
}

function removalEntry(
  group: CapabilityRuntimeLaunchGroup,
  plan: Awaited<ReturnType<typeof removalPlan>>,
): CapabilityRuntimeJournalEntry {
  return {
    id: `removal-${plan.fingerprint.digest}`,
    action: "material-remove",
    materials: group.materials.map((member) => member.material),
    launchGroup: capabilityRuntimeLaunchGroupReference(group),
    projectId: null,
    plannedAt: "2026-08-29T00:00:00.000Z",
    previousObservations: plan.observedMaterials.map((entry) => ({
      material: entry.material,
      state: entry.state === "owned"
        ? { material: "installed", runtime: "inactive" }
        : { material: "absent", runtime: "inactive" },
    })),
    effectiveRuntimeProjection: null,
    qualificationStartAuthority: null,
    administrativeRemovalPlanFingerprint: plan.fingerprint,
  };
}

async function projection(group: CapabilityRuntimeLaunchGroup) {
  return await createEffectiveCapabilityRuntimeLaunchProjection({
    launchGroup: capabilityRuntimeLaunchGroupReference(group),
    materials: group.materials.map((member, index) => ({
      material: member.material,
      binding: { id: `test-binding-${index}`, version: "1.0.0" },
      effectiveQualification: "qualified" as const,
      minimumQualification: "qualified" as const,
      runtimeMode: {
        material: member.material,
        targetPlatform: "linux/arm64" as const,
        mode: "native" as const,
        qualificationAttestationFingerprint: null,
      },
    })),
  });
}

function materialKey(input: {
  readonly unitId: string;
  readonly materialId: string;
}): string {
  return `${input.unitId}\u0000${input.materialId}`;
}

function descriptorMounts(
  group: CapabilityRuntimeLaunchGroup,
  serviceName: string,
): readonly Record<string, unknown>[] {
  const descriptor = JSON.parse(group.compose.content) as {
    readonly services: Record<
      string,
      { readonly volumes?: readonly string[] }
    >;
  };
  return (descriptor.services[serviceName]?.volumes ?? []).map((mount) => {
    const [volume, destination, mode] = mount.split(":");
    return {
      Type: "volume",
      Name: `${group.acquisition.projectName}_${volume}`,
      Destination: destination,
      RW: mode !== "ro",
    };
  });
}

function serviceDeclaresHealthcheck(
  group: CapabilityRuntimeLaunchGroup,
  service: string,
): boolean {
  const descriptor = JSON.parse(group.compose.content) as {
    services: Record<string, { healthcheck?: unknown }>;
  };
  return descriptor.services[service]?.healthcheck !== undefined;
}

function assertNoDestructiveComposeCommand(runner: FakeGroupRunner): void {
  assertEquals(
    runner.calls.some((call) =>
      call[1] === "compose" &&
      (call.includes("down") || call.includes("--remove-orphans") ||
        call.includes("-v"))
    ),
    false,
  );
}

function assertNoRolloverDestructiveCommand(runner: RolloverFakeGroupRunner): void {
  assertEquals(
    runner.calls.some((call) =>
      call.some((argument) =>
        argument === "down" || argument === "-v" || argument === "--volumes" ||
        argument === "prune" || argument === "rm" || argument === "rmi" ||
        argument === "--force" || argument === "--force-recreate"
      )
    ),
    false,
  );
}

function success(stdout: string): CommandResult {
  return { success: true, code: 0, stdout, stderr: "" };
}

function failure(stderr: string): CommandResult {
  return { success: false, code: 1, stdout: "", stderr };
}
