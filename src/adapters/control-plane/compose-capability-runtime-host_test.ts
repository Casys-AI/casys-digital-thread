import { assertEquals, assertRejects } from "@std/assert";
import { createCapabilityRuntimeHostAdapter } from "./compose-capability-runtime-host.ts";
import { FixedCapabilityRuntimeLaunchProfileRegistry } from "../../application/control-plane/capability-runtime-launch-profile-registry.ts";
import {
  type CapabilityRuntimeLaunchProfile,
  capabilityRuntimeLaunchProfileReference,
} from "../../domain/capability/runtime/capability-runtime-host.ts";
import type { CapabilityRuntimeJournalEntry } from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import {
  InMemoryCapabilityRuntimeJournal,
} from "./in-memory-capability-runtime-supervisor.ts";
import { authorizeDurableCapabilityRuntimeHostMutation } from "../../application/control-plane/capability-runtime-host-authorization.ts";
import type { CommandResult, CommandRunner } from "../shared/docker-observer.ts";
import type {
  AuthorizedCapabilityRuntimeHostMutation,
  CapabilityRuntimeHostMutationLock,
  CapabilityRuntimeHostMutator,
  CapabilityRuntimeSecretSlotObserver,
} from "../../application/ports/out/capability/capability-runtime-supervisor.ts";
import {
  FAKE_CAPABILITY_RUNTIME_MATERIAL,
  fakeCapabilityRuntimeLaunchProfile,
} from "../../testing/capability-runtime-host-fixture.ts";

const EXPECTED_IMAGE =
  `example.invalid/capability-host@sha256:${FAKE_CAPABILITY_RUNTIME_MATERIAL.imageDigest}`;

Deno.test("Compose host refuses an ownership-label mismatch without issuing an ID stop or removal command", async () => {
  const profile = await fakeCapabilityRuntimeLaunchProfile();
  const fixture = composeHost(
    profile,
    new FakeComposeRunner({ ownership: "mismatch" }),
  );

  const result = await mutate(fixture, entry(profile, "runtime-stop"));

  assertEquals(result.status, "failed");
  assertEquals(fixture.runner.calls.some((call) => call.includes("stop")), false);
  assertNoDestructiveCommand(fixture.runner);
});

Deno.test("Compose receives the exact sealed descriptor on stdin, not mutable source YAML", async () => {
  const profile = await fakeCapabilityRuntimeLaunchProfile();
  const composeRoot = await Deno.makeTempDir({
    prefix: "casys-host-runtime-mutable-source-",
  });
  const canonicalRoot = await Deno.realPath(composeRoot);
  const source = `${composeRoot}/compose.yaml`;
  const dotenv = `${composeRoot}/.env`;
  const previousImage = Deno.env.get("IMAGE");
  try {
    await Deno.writeTextFile(source, "services: { original: {} }\n");
    Deno.env.set("IMAGE", "example.invalid/attacker:mutable");
    const fixture = composeHost(
      profile,
      new FakeComposeRunner({
        ownership: "absent",
        onFirstComposePs: async () => {
          await Deno.writeTextFile(source, "services: { attacker: {} }\n");
          await Deno.writeTextFile(dotenv, "IMAGE=example.invalid/attacker:mutable\n");
        },
      }),
      new SecretSlots(["available"]),
      canonicalRoot,
    );
    const result = await mutate(fixture, entry(profile, "material-acquire"));

    assertEquals(result.status, "succeeded");
    assertEquals(fixture.runner.calls.find((call) => call.includes("pull")), [
      "docker",
      "compose",
      "--env-file",
      "/dev/null",
      "--project-name",
      "test_host_runtime",
      "--project-directory",
      canonicalRoot,
      "--file",
      "-",
      "pull",
      "host-runtime",
    ]);
    assertEquals(fixture.runner.composeStdin.at(-1), profile.compose.content);
    assertEquals(fixture.runner.composeOptions.at(-1), {
      clearEnv: true,
      env: { COMPOSE_DISABLE_ENV_FILE: "1" },
    });
    assertEquals(await Deno.readTextFile(source), "services: { attacker: {} }\n");
    assertEquals(
      await Deno.readTextFile(dotenv),
      "IMAGE=example.invalid/attacker:mutable\n",
    );
    assertEquals(
      fixture.runner.calls
        .filter((call) => call[1] === "image")
        .every((call) => !call.some((argument) => argument.includes("attacker"))),
      true,
    );
  } finally {
    if (previousImage === undefined) Deno.env.delete("IMAGE");
    else Deno.env.set("IMAGE", previousImage);
    await Deno.remove(composeRoot, { recursive: true });
  }
});

Deno.test("an owned inactive container may restart JIT with no dependencies, but a foreign one may not", async () => {
  const profile = await fakeCapabilityRuntimeLaunchProfile();
  const owned = composeHost(
    profile,
    new FakeComposeRunner({ ownership: "owned", status: "exited" }),
  );
  const started = await mutate(owned, entry(profile, "runtime-start"));
  assertEquals(started.status, "succeeded");
  assertEquals(
    owned.runner.calls.find((call) => call.includes("up"))?.includes("--no-deps"),
    true,
  );

  const foreign = composeHost(
    profile,
    new FakeComposeRunner({ ownership: "mismatch", status: "exited" }),
  );
  const refused = await mutate(foreign, entry(profile, "runtime-start"));
  assertEquals(refused.status, "failed");
  assertEquals(foreign.runner.calls.some((call) => call.includes("up")), false);
});

Deno.test("Compose host binds the running container image to the exact profile digest", async () => {
  const profile = await fakeCapabilityRuntimeLaunchProfile();
  const fixture = composeHost(
    profile,
    new FakeComposeRunner({
      ownership: "owned",
      containerImageReference: `example.invalid/capability-host@sha256:${
        "a".repeat(64)
      }`,
    }),
  );
  const result = await mutate(fixture, entry(profile, "runtime-start"));

  assertEquals(result.status, "failed");
  assertEquals(fixture.runner.calls.some((call) => call.includes("up")), false);
  assertNoDestructiveCommand(fixture.runner);
});

Deno.test("stop is revalidated under the mutation lock and targets only the inspected container ID", async () => {
  const profile = await fakeCapabilityRuntimeLaunchProfile();
  const fixture = composeHost(
    profile,
    new FakeComposeRunner({ ownership: "owned", replaceWithForeignAfterStop: true }),
  );
  const result = await mutate(fixture, entry(profile, "runtime-stop"));

  assertEquals(result.status, "failed");
  assertEquals(fixture.runner.calls.find((call) => call[1] === "container"), [
    "docker",
    "container",
    "stop",
    "container-1",
  ]);
  assertEquals(
    fixture.runner.calls.some((call) => call[1] === "compose" && call.includes("stop")),
    false,
  );
});

Deno.test("exit zero is uncertain until a fresh observation proves the requested state", async () => {
  const profile = await fakeCapabilityRuntimeLaunchProfile();
  const fixture = composeHost(
    profile,
    new FakeComposeRunner({
      ownership: "absent",
      status: "exited",
      staleAfterStart: true,
    }),
  );
  const result = await mutate(fixture, entry(profile, "runtime-start"));

  assertEquals(result.status, "uncertain");
  assertEquals(result.recordedAt, "2026-08-29T00:00:01.000Z");
});

Deno.test("public host mutation requires its durable journal intent and available secret slots", async () => {
  const profile = await fakeCapabilityRuntimeLaunchProfile({
    secretSlots: ["host-token"],
  });
  const noJournal = composeHost(
    profile,
    new FakeComposeRunner({ ownership: "absent" }),
    new SecretSlots(["available"]),
  );
  const entryValue = entry(profile, "material-acquire");
  await assertRejects(
    () =>
      noJournal.host.mutate({
        authorization: { entry: entryValue } as AuthorizedCapabilityRuntimeHostMutation,
      }),
    Error,
    "authorization is absent or consumed",
  );
  assertEquals(noJournal.runner.calls, []);

  const unavailable = composeHost(
    profile,
    new FakeComposeRunner({ ownership: "absent" }),
    new SecretSlots(["unavailable"]),
  );
  const result = await mutate(unavailable, entryValue);
  assertEquals(result.status, "failed");
  assertEquals(unavailable.runner.calls, []);
});

Deno.test("a one-use authorization cannot replay the same pending intent", async () => {
  const profile = await fakeCapabilityRuntimeLaunchProfile();
  const fixture = composeHost(profile, new FakeComposeRunner({ ownership: "absent" }));
  const entryValue = entry(profile, "material-acquire");
  await fixture.journal.appendBeforeMutation(entryValue);
  const authorization = await authorizeDurableCapabilityRuntimeHostMutation(
    entryValue,
    fixture.journal,
  );
  const first = await fixture.host.mutate({ authorization });
  const calls = fixture.runner.calls.length;
  await assertRejects(
    () => fixture.host.mutate({ authorization }),
    Error,
    "absent or consumed",
  );
  await fixture.journal.appendOutcome(first);
  await assertRejects(
    () =>
      authorizeDurableCapabilityRuntimeHostMutation(
        entryValue,
        fixture.journal,
      ),
    Error,
    "terminal outcome",
  );
  assertEquals(first.status, "succeeded");
  assertEquals(fixture.runner.calls.length, calls);
});

Deno.test("Compose host blocks revoked and cache-only profiles after durable authorization but before Docker", async () => {
  for (
    const profile of [
      await fakeCapabilityRuntimeLaunchProfile({ qualification: "revoked" }),
      await fakeCapabilityRuntimeLaunchProfile({ activationPolicy: "cache-only" }),
    ]
  ) {
    const fixture = composeHost(
      profile,
      new FakeComposeRunner({ ownership: "absent" }),
    );
    const result = await mutate(fixture, entry(profile, "runtime-start"));
    assertEquals(result.status, "failed");
    assertEquals(fixture.runner.calls, []);
  }
});

function composeHost(
  profile: CapabilityRuntimeLaunchProfile,
  runner: FakeComposeRunner,
  secrets: CapabilityRuntimeSecretSlotObserver = new SecretSlots(["available"]),
  composeRoot = "/workspace",
) {
  const journal = new InMemoryCapabilityRuntimeJournal();
  const host = createCapabilityRuntimeHostAdapter({
    registry: new FixedCapabilityRuntimeLaunchProfileRegistry([profile]),
    journal,
    secrets,
    mutationLock: new ImmediateLock(),
    runner,
    composeRoot,
    paths: {
      realPath: (path) =>
        path === "/workspace" ? Promise.resolve("/canonical") : Deno.realPath(path),
    },
    clock: () => "2026-08-29T00:00:01.000Z",
  });
  return { host, journal, runner };
}

async function mutate(
  fixture: {
    readonly host: CapabilityRuntimeHostMutator;
    readonly journal: InMemoryCapabilityRuntimeJournal;
  },
  value: CapabilityRuntimeJournalEntry,
) {
  await fixture.journal.appendBeforeMutation(value);
  const authorization = await authorizeDurableCapabilityRuntimeHostMutation(
    value,
    fixture.journal,
  );
  return await fixture.host.mutate({ authorization });
}

function entry(
  profile: CapabilityRuntimeLaunchProfile,
  action: CapabilityRuntimeJournalEntry["action"],
): CapabilityRuntimeJournalEntry {
  return {
    id: `host-runtime:${action}`,
    action,
    material: FAKE_CAPABILITY_RUNTIME_MATERIAL,
    launchProfile: capabilityRuntimeLaunchProfileReference(profile),
    projectId: null,
    plannedAt: "2026-08-29T00:00:00.000Z",
    previousObservation: null,
    administrativeRemovalPlanFingerprint: null,
  };
}

class FakeComposeRunner implements CommandRunner {
  readonly calls: string[][] = [];
  readonly composeStdin: string[] = [];
  readonly composeOptions: {
    readonly clearEnv: boolean | undefined;
    readonly env: Readonly<Record<string, string>> | undefined;
  }[] = [];
  #exists: boolean;
  #status: string;
  #containerId = "container-1";
  #ownership: "owned" | "mismatch" | "absent";

  constructor(
    private readonly options: {
      readonly ownership: "owned" | "mismatch" | "absent";
      readonly status?: string;
      readonly imageReference?: string;
      readonly containerImageReference?: string;
      readonly staleAfterStart?: boolean;
      readonly replaceWithForeignAfterStop?: boolean;
      readonly onFirstComposePs?: () => Promise<void>;
    },
  ) {
    this.#ownership = options.ownership;
    this.#exists = options.ownership !== "absent";
    this.#status = options.status ?? "running";
  }

  async run(
    command: string,
    args: string[],
    _cwd: string,
    options: {
      readonly stdin?: Uint8Array;
      readonly env?: Readonly<Record<string, string>>;
      readonly clearEnv?: boolean;
    } = {},
  ): Promise<CommandResult> {
    this.calls.push([command, ...args]);
    if (args[0] === "compose" && options.stdin) {
      this.composeStdin.push(new TextDecoder().decode(options.stdin));
      this.composeOptions.push({
        clearEnv: options.clearEnv,
        env: options.env,
      });
    }
    if (args[0] === "image") {
      return successful(
        imageInspect(
          args[2] === "sha256:container-image"
            ? this.options.containerImageReference
            : this.options.imageReference,
        ),
      );
    }
    if (args[0] === "inspect") {
      return successful(JSON.stringify([{
        Id: this.#containerId,
        Image: "sha256:container-image",
        Config: {
          Labels: {
            "com.docker.compose.project": "test_host_runtime",
            "com.docker.compose.service": "host-runtime",
            "com.casys.capability-runtime.owned": this.#ownership === "mismatch"
              ? "false"
              : "true",
          },
        },
        State: { Status: this.#status },
      }]));
    }
    if (args.includes("ps")) {
      if (this.options.onFirstComposePs && this.composeStdin.length === 1) {
        await this.options.onFirstComposePs();
      }
      return successful(
        this.#exists
          ? JSON.stringify([{
            Service: "host-runtime",
            ID: this.#containerId,
            State: this.#status,
          }])
          : "",
      );
    }
    if (args.includes("up")) {
      this.#exists = true;
      if (!this.options.staleAfterStart) this.#status = "running";
    }
    if (args[0] === "container" && args[1] === "stop") {
      if (this.options.replaceWithForeignAfterStop) {
        this.#containerId = "container-foreign";
        this.#ownership = "mismatch";
      } else {
        this.#status = "exited";
      }
    }
    return successful("");
  }
}

class ImmediateLock implements CapabilityRuntimeHostMutationLock {
  withLock<T>(operation: () => Promise<T>): Promise<T> {
    return operation();
  }
}

class SecretSlots implements CapabilityRuntimeSecretSlotObserver {
  constructor(
    private readonly states: readonly ("available" | "unavailable" | "unknown")[],
  ) {}

  async observe(
    slots: readonly string[],
  ): Promise<ReadonlyMap<string, "available" | "unavailable" | "unknown">> {
    return new Map(slots.map((slot, index) => [slot, this.states[index] ?? "unknown"]));
  }
}

function imageInspect(reference = EXPECTED_IMAGE): string {
  return JSON.stringify([{ RepoDigests: [reference] }]);
}

function successful(stdout: string): CommandResult {
  return { success: true, code: 0, stdout, stderr: "" };
}

function assertNoDestructiveCommand(runner: FakeComposeRunner): void {
  for (const call of runner.calls) {
    assertEquals(
      call.some((arg) => ["down", "rm", "rmi", "volume"].includes(arg)),
      false,
    );
  }
}
