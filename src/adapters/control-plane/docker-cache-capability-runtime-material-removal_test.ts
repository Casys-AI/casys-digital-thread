import { assertEquals } from "@std/assert";
import {
  capabilityRuntimeNonpersistentRemovalIntentId,
  createCapabilityRuntimeNonpersistentMaterialRemovalIntent,
  createCapabilityRuntimeNonpersistentMaterialRemovalPlan,
} from "../../domain/capability/runtime/capability-runtime-nonpersistent-material-removal.ts";
import { authorizeDurableNonpersistentMaterialRemoval } from "../../application/control-plane/capability-runtime-nonpersistent-material-removal-authorization.ts";
import type { CommandResult, CommandRunner } from "../shared/docker-observer.ts";
import { DockerCacheCapabilityRuntimeMaterialRemovalHost } from "./docker-cache-capability-runtime-material-removal.ts";
import { InMemoryCapabilityRuntimeNonpersistentMaterialRemovalJournal } from "./in-memory-capability-runtime-nonpersistent-material-removal.ts";

const DIGEST = "a".repeat(64);
const REFERENCE = `casys/ngspice-source@sha256:${DIGEST}`;
const CANONICAL = `docker.io/casys/ngspice-source@sha256:${DIGEST}`;
const CLOCK = "2026-08-31T00:00:01.000Z";

Deno.test("Docker cache removal inspects the sealed digest and removes without force or prune", async () => {
  const runner = new FakeDockerRunner({
    inspect: ownedInspect(REFERENCE),
    containers: "",
  });
  const host = new DockerCacheCapabilityRuntimeMaterialRemovalHost({
    runner,
    clock: () => CLOCK,
  });
  const { authorization, plan, journal } = await granted(host, "owned");
  const result = await host.mutate({ authorization, plan });
  assertEquals(result.status, "succeeded");
  assertEquals(result.observedState, "absent");
  assertEquals(
    runner.calls.some((call) => call[0] === "image" && call[1] === "inspect"),
    true,
  );
  assertEquals(
    runner.calls.filter((call) => call[0] === "image" && call[1] === "rm"),
    [["image", "rm", CANONICAL]],
  );
  assertEquals(
    runner.calls.some((call) =>
      call.includes("prune") || call.includes("--force") || call.includes("-f") ||
      call.includes("rmi")
    ),
    false,
  );
  assertEquals((await journal.listOutcomes()).length, 0);
});

Deno.test("Docker cache exact ownership accepts catalog and docker.io repository+digest spellings", async () => {
  const dockerIo = `docker.io/casys/ngspice-source@sha256:${DIGEST}`;
  const cases: readonly {
    readonly name: string;
    readonly inspect: CommandResult;
  }[] = [
    { name: "catalog spelling", inspect: ownedInspect(REFERENCE) },
    { name: "docker.io spelling", inspect: ownedInspect(dockerIo) },
    {
      name: "multiple equivalent RepoDigests",
      inspect: success(JSON.stringify([{
        RepoTags: [],
        RepoDigests: [REFERENCE, dockerIo],
      }])),
    },
    {
      name: "exact digest-as-RepoTag",
      inspect: success(JSON.stringify([{
        RepoTags: [REFERENCE],
        RepoDigests: [REFERENCE],
      }])),
    },
  ];
  for (const variant of cases) {
    const runner = new FakeDockerRunner({
      inspect: variant.inspect,
      containers: "",
    });
    const host = new DockerCacheCapabilityRuntimeMaterialRemovalHost({
      runner,
      clock: () => CLOCK,
    });
    const observed = await host.inspect({ material: fixtureMaterial() });
    assertEquals(observed.state, "owned", variant.name);
    assertEquals(observed.safety, "exact", variant.name);
    const { authorization, plan } = await granted(host, "owned");
    runner.calls.length = 0;
    const result = await host.mutate({ authorization, plan });
    assertEquals(result.status, "succeeded", variant.name);
    assertEquals(
      runner.calls.filter((call) => call[0] === "image" && call[1] === "rm"),
      [["image", "rm", CANONICAL]],
      variant.name,
    );
  }
});

Deno.test("Docker cache already-absent is a no-op without image rm", async () => {
  const runner = new FakeDockerRunner({
    inspect: notFound(),
    containers: "",
  });
  const host = new DockerCacheCapabilityRuntimeMaterialRemovalHost({
    runner,
    clock: () => CLOCK,
  });
  const observation = await host.inspect({ material: fixtureMaterial() });
  assertEquals(observation.state, "absent");
  assertEquals(observation.safety, "exact");
  const { authorization, plan } = await granted(host, "absent");
  runner.calls.length = 0;
  const result = await host.mutate({ authorization, plan });
  assertEquals(result.status, "succeeded");
  assertEquals(
    runner.calls.some((call) => call[0] === "image" && call[1] === "rm"),
    false,
  );
});

Deno.test("Docker cache refuses extra tags, a foreign digest and ancestor containers before mutation", async () => {
  const cases: readonly {
    readonly name: string;
    readonly inspect?: CommandResult;
    readonly containers?: string;
  }[] = [
    {
      name: "extra tag",
      inspect: success(JSON.stringify([{
        RepoTags: ["casys/ngspice-source:latest"],
        RepoDigests: [REFERENCE],
      }])),
    },
    {
      name: "mixed exact and extra tag",
      inspect: success(JSON.stringify([{
        RepoTags: [REFERENCE, "casys/ngspice-source:latest"],
        RepoDigests: [REFERENCE],
      }])),
    },
    {
      name: "mixed foreign digest",
      inspect: success(JSON.stringify([{
        RepoTags: [],
        RepoDigests: [REFERENCE, `mirror.example/ngspice@sha256:${DIGEST}`],
      }])),
    },
    {
      name: "ancestor container",
      inspect: ownedInspect(REFERENCE),
      containers: "abc123",
    },
  ];
  for (const variant of cases) {
    const runner = new FakeDockerRunner({
      inspect: variant.inspect ?? ownedInspect(REFERENCE),
      containers: variant.containers ?? "",
    });
    const host = new DockerCacheCapabilityRuntimeMaterialRemovalHost({
      runner,
      clock: () => CLOCK,
    });
    const observed = await host.inspect({ material: fixtureMaterial() });
    assertEquals(observed.safety, "foreign", variant.name);
    const { authorization, plan } = await granted(host, "owned");
    const result = await host.mutate({ authorization, plan });
    assertEquals(result.status, "failed", variant.name);
    assertEquals(
      runner.calls.some((call) => call[0] === "image" && call[1] === "rm"),
      false,
      variant.name,
    );
  }
});

Deno.test("Docker cache treats Compose-equivalent missing images as exact absence", async () => {
  const cases: readonly CommandResult[] = [
    {
      success: false,
      code: 1,
      stdout: "",
      stderr: `Error: No such image: ${REFERENCE}`,
    },
    {
      success: false,
      code: 1,
      stdout: "",
      stderr: "Error: no such object: sha256:deadbeef",
    },
  ];
  for (const inspect of cases) {
    const runner = new FakeDockerRunner({ inspect, containers: "" });
    const host = new DockerCacheCapabilityRuntimeMaterialRemovalHost({
      runner,
      clock: () => CLOCK,
    });
    const observed = await host.inspect({ material: fixtureMaterial() });
    assertEquals(observed.state, "absent", inspect.stderr);
    assertEquals(observed.safety, "exact", inspect.stderr);
  }
});

Deno.test("Docker cache inspect errors other than Compose absence stay unknown", async () => {
  const cases: readonly string[] = [
    "Cannot connect to the Docker daemon",
    'context "foo" not found',
    "docker: command not found",
    "Error: image not found",
  ];
  for (const stderr of cases) {
    const runner = new FakeDockerRunner({
      inspect: {
        success: false,
        code: 1,
        stdout: `Error: No such image: ${REFERENCE}`,
        stderr,
      },
      containers: "",
    });
    const host = new DockerCacheCapabilityRuntimeMaterialRemovalHost({
      runner,
      clock: () => CLOCK,
    });
    const observed = await host.inspect({ material: fixtureMaterial() });
    assertEquals(observed.safety, "unknown", stderr);
    assertEquals(observed.state, "owned", stderr);
  }
});

Deno.test("Docker cache post-state that is not exact absence is uncertain", async () => {
  const runner = new FakeDockerRunner({
    inspect: ownedInspect(REFERENCE),
    containers: "",
    inspectAfterRm: {
      success: false,
      code: 1,
      stdout: "",
      stderr: "Cannot connect to the Docker daemon",
    },
  });
  const host = new DockerCacheCapabilityRuntimeMaterialRemovalHost({
    runner,
    clock: () => CLOCK,
  });
  const { authorization, plan } = await granted(host, "owned");
  const result = await host.mutate({ authorization, plan });
  assertEquals(result.status, "uncertain");
});

async function granted(
  _host: DockerCacheCapabilityRuntimeMaterialRemovalHost,
  observedState: "owned" | "absent",
) {
  const plan = await createCapabilityRuntimeNonpersistentMaterialRemovalPlan({
    unit: {
      id: "casys.test-cache-worker",
      version: "1.0.0",
      manifestFingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
    },
    material: fixtureMaterial(),
    backend: "docker-cache",
    observedState,
  });
  const intent = await createCapabilityRuntimeNonpersistentMaterialRemovalIntent({
    id: capabilityRuntimeNonpersistentRemovalIntentId({
      planFingerprint: plan.fingerprint,
      generation: 1,
    }),
    unit: plan.unit,
    material: plan.material,
    backend: plan.backend,
    generation: 1,
    planFingerprint: plan.fingerprint,
    previousObservation: observedState,
    plannedAt: "2026-08-31T00:00:00.000Z",
  });
  const journal = new InMemoryCapabilityRuntimeNonpersistentMaterialRemovalJournal();
  await journal.appendIntent(intent);
  return {
    plan,
    journal,
    authorization: await authorizeDurableNonpersistentMaterialRemoval(
      intent,
      plan,
      journal,
    ),
  };
}

function fixtureMaterial() {
  return {
    unitId: "casys.test-cache-worker",
    materialId: "source-image",
    imageReference: REFERENCE,
    imageDigest: DIGEST,
    launchGroup: null,
  };
}

function ownedInspect(reference: string): CommandResult {
  return success(JSON.stringify([{ RepoTags: [], RepoDigests: [reference] }]));
}

function notFound(): CommandResult {
  return {
    success: false,
    code: 1,
    stdout: "",
    stderr: `Error: No such image: ${REFERENCE}`,
  };
}

function success(stdout: string): CommandResult {
  return { success: true, code: 0, stdout, stderr: "" };
}

class FakeDockerRunner implements CommandRunner {
  readonly calls: string[][] = [];
  #removed = false;

  constructor(
    private readonly options: {
      readonly inspect: CommandResult;
      readonly containers: string;
      readonly inspectAfterRm?: CommandResult;
    },
  ) {}

  run(
    command: string,
    args: string[],
    _cwd: string,
  ): Promise<CommandResult> {
    if (command !== "docker") {
      return Promise.resolve({
        success: false,
        code: 1,
        stdout: "",
        stderr: `unexpected ${command}`,
      });
    }
    this.calls.push([...args]);
    if (args[0] === "image" && args[1] === "inspect") {
      if (this.#removed) {
        return Promise.resolve(this.options.inspectAfterRm ?? notFound());
      }
      return Promise.resolve(this.options.inspect);
    }
    if (args[0] === "ps") {
      return Promise.resolve(success(this.options.containers));
    }
    if (args[0] === "image" && args[1] === "rm") {
      this.#removed = true;
      return Promise.resolve(success(""));
    }
    return Promise.resolve({
      success: false,
      code: 1,
      stdout: "",
      stderr: `unexpected ${args.join(" ")}`,
    });
  }
}
