import { assertEquals, assertRejects } from "@std/assert";
import { FixedCapabilityRuntimeLaunchGroupRegistry } from "../../../application/control-plane/capability-runtime-launch-group-registry.ts";
import {
  type CapabilityRuntimeLease,
  capabilityRuntimeMaterialKey,
} from "../../../domain/capability/runtime/capability-runtime-supervision.ts";
import { capabilityRuntimeLaunchGroupReference } from "../../../domain/capability/runtime/capability-runtime-launch-group.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import type { ContainerCommandRunner } from "../../assets/container-asset-stager.ts";
import {
  createFirstPartyCapabilityRuntimeLaunchGroups,
} from "../../control-plane/first-party-capability-runtime-launch-groups.ts";
import {
  CapabilityRuntimeCalculixInputStagerFactory,
} from "./capability-runtime-calculix-input-stager.ts";

const CONTAINER_ID = "a".repeat(64);

Deno.test("CalculiX sensitivity staging copies once through the exact owned launch-group container without Compose fallback", async () => {
  const { group, material } = await calculixGroup();
  const bytes = new TextEncoder().encode("ISO-10303-21;\nEND-ISO-10303-21;\n");
  const digest = await fingerprintResourceBytes(bytes);
  const calls: string[][] = [];
  let copied = false;
  const runner = ownedRunner({
    group,
    copied: () => copied,
    copy: () => {
      copied = true;
    },
    bytes,
    calls,
  });
  const directory = await Deno.makeTempDir({ prefix: "calculix-group-staging-" });
  try {
    const factory = new CapabilityRuntimeCalculixInputStagerFactory({
      groups: new FixedCapabilityRuntimeLaunchGroupRegistry([group]),
      hostCacheDirectory: directory,
      commandRunner: runner,
    });
    const stager = await factory.forActiveCapabilitySession({
      lease: leaseFor(group, material),
      launchGroup: capabilityRuntimeLaunchGroupReference(group),
      material,
    });

    const staged = await stager.stage({
      bytes,
      fingerprint: { algorithm: "sha256", digest },
      byteCount: bytes.byteLength,
    });

    const source = `${directory}/fea-${digest}.step`;
    assertEquals(staged.stagedAsset.location, `/inputs/fea-${digest}.step`);
    const copy = calls.find((args) => args[1] === "cp");
    assertEquals(copy, [
      "docker",
      "cp",
      source,
      `${CONTAINER_ID}:/inputs/fea-${digest}.step`,
    ]);
    assertEquals(copy?.filter((argument) => argument === source).length, 1);
    assertEquals(calls.some((args) => args.includes("compose")), false);
    assertEquals(
      calls.some((args) =>
        args.includes("--project-directory") || args.includes("--file")
      ),
      false,
    );
    const list = calls.find((args) => args[1] === "container" && args[2] === "ls");
    assertEquals(list, [
      "docker",
      "container",
      "ls",
      "--all",
      "--filter",
      "label=com.docker.compose.project=casys-mcp-calculix",
      "--filter",
      "label=com.docker.compose.service=mcp-calculix",
      "--format",
      "{{.ID}}",
    ]);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("CalculiX sensitivity staging refuses an owned-name container whose image lacks the sealed digest", async () => {
  const { group, material } = await calculixGroup();
  const bytes = new TextEncoder().encode("STEP");
  const digest = await fingerprintResourceBytes(bytes);
  const calls: string[][] = [];
  const directory = await Deno.makeTempDir({ prefix: "calculix-group-staging-" });
  try {
    const factory = new CapabilityRuntimeCalculixInputStagerFactory({
      groups: new FixedCapabilityRuntimeLaunchGroupRegistry([group]),
      hostCacheDirectory: directory,
      commandRunner: ownedRunner({
        group,
        copied: () => false,
        copy: () => undefined,
        bytes,
        calls,
        imageDigestMatches: false,
      }),
    });
    const stager = await factory.forActiveCapabilitySession({
      lease: leaseFor(group, material),
      launchGroup: capabilityRuntimeLaunchGroupReference(group),
      material,
    });

    await assertRejects(
      () =>
        stager.stage({
          bytes,
          fingerprint: { algorithm: "sha256", digest },
          byteCount: bytes.byteLength,
        }),
      Error,
      "does not match the sealed digest",
    );
    assertEquals(calls.some((args) => args[1] === "cp"), false);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

async function calculixGroup() {
  const group = (await createFirstPartyCapabilityRuntimeLaunchGroups()).find(
    (candidate) => candidate.id === "casys-mcp-calculix",
  );
  if (!group) throw new Error("mcp-calculix launch group is absent");
  const material = group.materials[0]?.material;
  if (!material) throw new Error("mcp-calculix launch group material is absent");
  return { group, material };
}

function leaseFor(
  group: Awaited<ReturnType<typeof calculixGroup>>["group"],
  material: Awaited<ReturnType<typeof calculixGroup>>["material"],
): CapabilityRuntimeLease {
  return {
    id: "lease-calculix-sensitivity",
    projectId: "project-calculix-sensitivity",
    bindingIds: ["calculix-http-static-sensitivity"],
    materialKeys: [capabilityRuntimeMaterialKey(material)],
    launchGroups: [capabilityRuntimeLaunchGroupReference(group)],
    acquiredAt: "2026-08-29T00:00:00.000Z",
    expiresAt: "2026-08-29T00:15:00.000Z",
  };
}

function ownedRunner(input: {
  readonly group: Awaited<ReturnType<typeof calculixGroup>>["group"];
  readonly copied: () => boolean;
  readonly copy: () => void;
  readonly bytes: Uint8Array;
  readonly calls: string[][];
  readonly imageDigestMatches?: boolean;
}): ContainerCommandRunner {
  const member = input.group.materials[0]!;
  return async (exe, args) => {
    input.calls.push([exe, ...args]);
    if (exe !== "docker") throw new Error(`unexpected executable ${exe}`);
    if (args[0] === "container" && args[1] === "ls") {
      return result(true, `${CONTAINER_ID}\n`);
    }
    if (args[0] === "inspect" && args[1] === CONTAINER_ID) {
      return result(
        true,
        JSON.stringify([{
          Id: CONTAINER_ID,
          Image: "sha256:sealed-calculix-image",
          Config: {
            Labels: Object.fromEntries(
              member.ownership.map((label) => [label.key, label.value]),
            ),
          },
          State: { Status: "running" },
        }]),
      );
    }
    if (args[0] === "image" && args[1] === "inspect") {
      return result(
        input.imageDigestMatches !== false,
        JSON.stringify([{
          RepoDigests: input.imageDigestMatches === false
            ? ["ghcr.io/casys-ai/mcp-calculix@sha256:deadbeef"]
            : [member.imageReference],
        }]),
      );
    }
    if (args[0] === "exec" && args[2] === "cat") {
      return input.copied()
        ? result(true, input.bytes)
        : result(false, "", "not found");
    }
    if (args[0] === "cp") {
      input.copy();
      return result(true, "");
    }
    throw new Error(`unexpected docker argv ${args.join(" ")}`);
  };
}

function result(
  success: boolean,
  stdout: string | Uint8Array,
  stderr = "",
): {
  readonly success: boolean;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly code: number;
} {
  const encode = (value: string | Uint8Array) =>
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  return {
    success,
    stdout: encode(stdout),
    stderr: new TextEncoder().encode(stderr),
    code: success ? 0 : 1,
  };
}
