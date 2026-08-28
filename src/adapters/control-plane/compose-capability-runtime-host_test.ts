import { assertEquals } from "@std/assert";
import {
  type CapabilityRuntimeLaunchGroup,
  capabilityRuntimeLaunchGroupReference,
} from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import type { CapabilityRuntimeJournalEntry } from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import { FixedCapabilityRuntimeLaunchGroupRegistry } from "../../application/control-plane/capability-runtime-launch-group-registry.ts";
import { authorizeDurableCapabilityRuntimeHostMutation } from "../../application/control-plane/capability-runtime-host-authorization.ts";
import { InMemoryCapabilityRuntimeJournal } from "./in-memory-capability-runtime-supervisor.ts";
import {
  createFirstPartyCapabilityRuntimeLaunchGroups,
} from "./first-party-capability-runtime-launch-groups.ts";
import { createCapabilityRuntimeHostAdapter } from "./compose-capability-runtime-host.ts";
import {
  CHRONO_MCP_BEARER_TOKEN_SLOT,
  LocalChronoRuntimeSecretResolver,
} from "./local-chrono-runtime-secret-resolver.ts";
import type {
  CapabilityRuntimeLaunchSecretInjector,
  CapabilityRuntimeSecretSlotObserver,
  CapabilityRuntimeSecretSnapshot,
} from "../../application/ports/out/capability/capability-runtime-supervisor.ts";
import type { CommandResult, CommandRunner } from "../shared/docker-observer.ts";

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

Deno.test("sealed Chrono group has one exact unqualified AMD64 service with no host privilege or interpolation", async () => {
  const group = await chronoGroup();
  const descriptor = JSON.parse(group.compose.content) as {
    services: Record<string, Record<string, unknown>>;
    volumes: Record<string, unknown>;
  };
  const service = descriptor.services["mcp-chrono"]!;

  assertEquals(group.id, "casys-chrono");
  assertEquals(group.version, "1.0.0");
  assertEquals(group.qualification, "unqualified");
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

Deno.test("Compose host reconciles a Chrono secret snapshot through stdin without journalling it or placing it in argv", async () => {
  const group = await chronoGroup();
  const token = "test-chrono-bearer-value";
  const secrets = new LocalChronoRuntimeSecretResolver({
    readToken: () => token,
  });
  const snapshot = await secrets.beginSnapshot({
    group: capabilityRuntimeLaunchGroupReference(group),
    slots: [CHRONO_MCP_BEARER_TOKEN_SLOT],
  });
  const runner = new FakeGroupRunner(group, { images: true, state: "running" });
  const fixture = host(group, runner, { secrets, secretInjector: secrets });

  const outcome = await mutate(fixture, group, "runtime-start", snapshot);

  // The binding has intentionally not passed a live qualification probe, so
  // a healthy container observation never becomes operational approval.
  assertEquals(outcome.status, "uncertain");
  assertEquals(outcome.detail?.includes(token), false);
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
    projectId: "project-test",
    plannedAt: "2026-08-29T00:00:00.000Z",
    previousObservations: group.materials.map((member) => ({
      material: member.material,
      state: null,
    })),
    administrativeRemovalPlanFingerprint: null,
  };
  await fixture.journal.appendBeforeMutation(entry);
  return await fixture.host.mutate({
    authorization: await authorizeDurableCapabilityRuntimeHostMutation(
      entry,
      fixture.journal,
    ),
    secretSnapshot,
  });
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
    },
  ) {
    this.#images = options.images;
    this.#states = new Map(
      options.state === "absent"
        ? []
        : group.materials.map((member) => [member.serviceName, "running"] as const),
    );
    this.foreignService = options.foreignService;
  }

  readonly foreignService: string | undefined;

  async run(
    command: string,
    args: string[],
    _cwd: string,
    options: { readonly stdin?: Uint8Array } = {},
  ): Promise<CommandResult> {
    await Promise.resolve();
    this.calls.push([command, ...args]);
    if (options.stdin) this.stdin.push(new TextDecoder().decode(options.stdin));
    if (args[0] === "image" && args[1] === "inspect") {
      const requested = args[2]!;
      const member = this.group.materials.find((candidate) =>
        candidate.imageReference === requested ||
        `sha256:${candidate.serviceName}` === requested
      );
      return this.#images && member
        ? success(JSON.stringify([{ RepoDigests: [member.imageReference] }]))
        : failure("image missing");
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
          Health: {
            Status: this.#states.get(service) === "running" ? "healthy" : "unhealthy",
          },
        },
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
    return success("");
  }
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

function success(stdout: string): CommandResult {
  return { success: true, code: 0, stdout, stderr: "" };
}

function failure(stderr: string): CommandResult {
  return { success: false, code: 1, stdout: "", stderr };
}
