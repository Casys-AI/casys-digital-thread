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
  CapabilityRuntimeDfmGeometryExportStagerFactory,
} from "./capability-runtime-dfm-geometry-export-stager.ts";

const CONTAINER_ID = "b".repeat(64);

Deno.test("DFM staging copies once to the fixed /tmp path in the exact owned container", async () => {
  const { group, material } = await dfmGroup();
  const bytes = new TextEncoder().encode("ISO-10303-21;\nEND-ISO-10303-21;\n");
  const digest = await fingerprintResourceBytes(bytes);
  const calls: string[][] = [];
  let copied = false;
  const directory = await Deno.makeTempDir({ prefix: "dfm-group-staging-" });
  try {
    const factory = new CapabilityRuntimeDfmGeometryExportStagerFactory({
      groups: new FixedCapabilityRuntimeLaunchGroupRegistry([group]),
      hostCacheDirectory: directory,
      commandRunner: ownedRunner({
        group,
        copied: () => copied,
        copy: () => {
          copied = true;
        },
        bytes,
        calls,
      }),
    });
    const stager = await factory.forActiveCapabilitySession({
      lease: leaseFor(group, material),
      launchGroup: capabilityRuntimeLaunchGroupReference(group),
      material,
    });

    const staged = await stager.stage({
      bytes,
      digest,
      fileName: `${digest}.step`,
    });

    const source = `${directory}/dfm-${digest}.step`;
    assertEquals(staged.path, `/tmp/dfm-${digest}.step`);
    assertEquals(staged.sha256, digest);
    assertEquals(staged.byteCount, bytes.byteLength);
    const copy = calls.find((args) => args[1] === "cp");
    assertEquals(copy, [
      "docker",
      "cp",
      source,
      `${CONTAINER_ID}:/tmp/dfm-${digest}.step`,
    ]);
    assertEquals(calls.some((args) => args.includes("compose")), false);
    assertEquals(
      calls.some((args) => args.includes("/exports") || args.includes("dfm-exports")),
      false,
    );
    const list = calls.find((args) => args[1] === "container" && args[2] === "ls");
    assertEquals(list, [
      "docker",
      "container",
      "ls",
      "--all",
      "--filter",
      "label=com.docker.compose.project=casys-mcp-dfm-v1",
      "--filter",
      "label=com.docker.compose.service=mcp-dfm",
      "--format",
      "{{.ID}}",
    ]);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("DFM staging reuses the exact preexisting /tmp file without a second copy", async () => {
  const { group, material } = await dfmGroup();
  const bytes = new TextEncoder().encode("ISO-10303-21;\nEND-ISO-10303-21;\n");
  const digest = await fingerprintResourceBytes(bytes);
  const calls: string[][] = [];
  const directory = await Deno.makeTempDir({ prefix: "dfm-group-reuse-" });
  try {
    const factory = new CapabilityRuntimeDfmGeometryExportStagerFactory({
      groups: new FixedCapabilityRuntimeLaunchGroupRegistry([group]),
      hostCacheDirectory: directory,
      commandRunner: ownedRunner({
        group,
        copied: () => true,
        copy: () => {
          throw new Error("must not copy");
        },
        bytes,
        calls,
      }),
    });
    const stager = await factory.forActiveCapabilitySession({
      lease: leaseFor(group, material),
      launchGroup: capabilityRuntimeLaunchGroupReference(group),
      material,
    });
    const staged = await stager.stage({ bytes, digest, fileName: "ignored.step" });
    assertEquals(staged.path, `/tmp/dfm-${digest}.step`);
    assertEquals(calls.some((args) => args[1] === "cp"), false);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("DFM staging refuses a divergent preexisting /tmp file", async () => {
  const { group, material } = await dfmGroup();
  const bytes = new TextEncoder().encode("ISO-10303-21;\nEND-ISO-10303-21;\n");
  const digest = await fingerprintResourceBytes(bytes);
  const calls: string[][] = [];
  const directory = await Deno.makeTempDir({ prefix: "dfm-group-divergent-" });
  try {
    const factory = new CapabilityRuntimeDfmGeometryExportStagerFactory({
      groups: new FixedCapabilityRuntimeLaunchGroupRegistry([group]),
      hostCacheDirectory: directory,
      commandRunner: ownedRunner({
        group,
        copied: () => true,
        copy: () => {
          throw new Error("must not overwrite");
        },
        bytes: new TextEncoder().encode("other-bytes"),
        calls,
      }),
    });
    const stager = await factory.forActiveCapabilitySession({
      lease: leaseFor(group, material),
      launchGroup: capabilityRuntimeLaunchGroupReference(group),
      material,
    });
    await assertRejects(
      () => stager.stage({ bytes, digest, fileName: "ignored.step" }),
      Error,
      "divergent",
    );
    assertEquals(calls.some((args) => args[1] === "cp"), false);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("DFM staging refuses an owned-name container whose image lacks the sealed digest", async () => {
  const { group, material } = await dfmGroup();
  const bytes = new TextEncoder().encode("STEP");
  const digest = await fingerprintResourceBytes(bytes);
  const calls: string[][] = [];
  const directory = await Deno.makeTempDir({ prefix: "dfm-group-image-" });
  try {
    const factory = new CapabilityRuntimeDfmGeometryExportStagerFactory({
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
      () => stager.stage({ bytes, digest, fileName: "ignored.step" }),
      Error,
      "does not match the sealed digest",
    );
    assertEquals(calls.some((args) => args[1] === "cp"), false);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("DFM staging rejects writable, bind, or extra exports mounts before docker cp", async () => {
  const { group, material } = await dfmGroup();
  const bytes = new TextEncoder().encode("STEP");
  const digest = await fingerprintResourceBytes(bytes);
  const expected = ownedMounts(group);
  const variants: readonly {
    readonly name: string;
    readonly mounts: readonly Record<string, unknown>[];
  }[] = [
    {
      name: "writable-exports",
      mounts: [{ ...expected[0]!, RW: true }],
    },
    {
      name: "bind",
      mounts: [{
        Type: "bind",
        Name: "",
        Source: "/tmp/exports",
        Destination: "/exports",
        RW: false,
      }],
    },
    {
      name: "wrong-volume",
      mounts: [{ ...expected[0]!, Name: "casys-mcp-dfm_other-exports" }],
    },
    {
      name: "extra-volume",
      mounts: [
        ...expected,
        {
          Type: "volume",
          Name: "casys-mcp-dfm-v1_ambiguous",
          Destination: "/unexpected",
          RW: true,
        },
      ],
    },
  ];
  for (const variant of variants) {
    const calls: string[][] = [];
    const directory = await Deno.makeTempDir({ prefix: "dfm-group-mounts-" });
    try {
      const factory = new CapabilityRuntimeDfmGeometryExportStagerFactory({
        groups: new FixedCapabilityRuntimeLaunchGroupRegistry([group]),
        hostCacheDirectory: directory,
        commandRunner: ownedRunner({
          group,
          copied: () => false,
          copy: () => {
            throw new Error(`copied ${variant.name}`);
          },
          bytes,
          calls,
          mounts: variant.mounts,
        }),
      });
      const stager = await factory.forActiveCapabilitySession({
        lease: leaseFor(group, material),
        launchGroup: capabilityRuntimeLaunchGroupReference(group),
        material,
      });
      await assertRejects(
        () => stager.stage({ bytes, digest, fileName: "ignored.step" }),
        Error,
        "mount",
      );
      assertEquals(
        calls.some((args) => args[0] === "docker" && args[1] === "cp"),
        false,
        variant.name,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  }
});

Deno.test("DFM staging refuses ambiguous owned-container membership", async () => {
  const { group, material } = await dfmGroup();
  const bytes = new TextEncoder().encode("STEP");
  const digest = await fingerprintResourceBytes(bytes);
  const calls: string[][] = [];
  const directory = await Deno.makeTempDir({ prefix: "dfm-group-ambiguous-" });
  try {
    const factory = new CapabilityRuntimeDfmGeometryExportStagerFactory({
      groups: new FixedCapabilityRuntimeLaunchGroupRegistry([group]),
      hostCacheDirectory: directory,
      commandRunner: ownedRunner({
        group,
        copied: () => false,
        copy: () => {
          throw new Error("must not copy");
        },
        bytes,
        calls,
        ids: `${CONTAINER_ID}\n${"c".repeat(64)}\n`,
      }),
    });
    const stager = await factory.forActiveCapabilitySession({
      lease: leaseFor(group, material),
      launchGroup: capabilityRuntimeLaunchGroupReference(group),
      material,
    });
    await assertRejects(
      () => stager.stage({ bytes, digest, fileName: "ignored.step" }),
      Error,
      "ambiguous",
    );
    assertEquals(calls.some((args) => args[1] === "cp"), false);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("DFM staging refuses a lease that does not cover the exact material", async () => {
  const { group, material } = await dfmGroup();
  const factory = new CapabilityRuntimeDfmGeometryExportStagerFactory({
    groups: new FixedCapabilityRuntimeLaunchGroupRegistry([group]),
    hostCacheDirectory: "/tmp",
  });
  await assertRejects(
    () =>
      factory.forActiveCapabilitySession({
        lease: {
          ...leaseFor(group, material),
          materialKeys: ["casys.mcp-calculix@mcp-calculix-image0.8.2"],
        },
        launchGroup: capabilityRuntimeLaunchGroupReference(group),
        material,
      }),
    TypeError,
    "exact material",
  );
});

async function dfmGroup() {
  const group = (await createFirstPartyCapabilityRuntimeLaunchGroups()).find(
    (candidate) => candidate.id === "casys-mcp-dfm",
  );
  if (!group) throw new Error("mcp-dfm launch group is absent");
  const material = group.materials[0]?.material;
  if (!material) throw new Error("mcp-dfm launch group material is absent");
  return { group, material };
}

function leaseFor(
  group: Awaited<ReturnType<typeof dfmGroup>>["group"],
  material: Awaited<ReturnType<typeof dfmGroup>>["material"],
): CapabilityRuntimeLease {
  return {
    id: "lease-dfm-measured",
    projectId: "project-dfm-measured",
    bindingIds: ["mcp-dfm-measured-checks"],
    materialKeys: [capabilityRuntimeMaterialKey(material)],
    launchGroups: [capabilityRuntimeLaunchGroupReference(group)],
    acquiredAt: "2026-08-29T00:00:00.000Z",
    expiresAt: "2026-08-29T00:15:00.000Z",
  };
}

function ownedRunner(input: {
  readonly group: Awaited<ReturnType<typeof dfmGroup>>["group"];
  readonly copied: () => boolean;
  readonly copy: () => void;
  readonly bytes: Uint8Array;
  readonly calls: string[][];
  readonly imageDigestMatches?: boolean;
  readonly mounts?: readonly Record<string, unknown>[];
  readonly ids?: string;
}): ContainerCommandRunner {
  const member = input.group.materials[0]!;
  return (exe, args) => {
    input.calls.push([exe, ...args]);
    if (exe !== "docker") {
      return Promise.reject(new Error(`unexpected executable ${exe}`));
    }
    if (args[0] === "container" && args[1] === "ls") {
      return Promise.resolve(result(true, input.ids ?? `${CONTAINER_ID}\n`));
    }
    if (args[0] === "inspect" && args[1] === CONTAINER_ID) {
      return Promise.resolve(result(
        true,
        JSON.stringify([{
          Id: CONTAINER_ID,
          Image: "sha256:sealed-dfm-image",
          Config: {
            Labels: Object.fromEntries(
              member.ownership.map((label) => [label.key, label.value]),
            ),
          },
          State: { Status: "running" },
          Mounts: input.mounts ?? ownedMounts(input.group),
        }]),
      ));
    }
    if (args[0] === "image" && args[1] === "inspect") {
      return Promise.resolve(result(
        input.imageDigestMatches !== false,
        JSON.stringify([{
          RepoDigests: input.imageDigestMatches === false
            ? ["ghcr.io/casys-ai/mcp-dfm@sha256:deadbeef"]
            : [member.imageReference],
        }]),
      ));
    }
    if (args[0] === "exec" && args[2] === "cat") {
      return Promise.resolve(
        input.copied() ? result(true, input.bytes) : result(false, "", "not found"),
      );
    }
    if (args[0] === "cp") {
      input.copy();
      return Promise.resolve(result(true, ""));
    }
    return Promise.reject(new Error(`unexpected docker argv ${args.join(" ")}`));
  };
}

function ownedMounts(
  group: Awaited<ReturnType<typeof dfmGroup>>["group"],
): readonly Record<string, unknown>[] {
  return [{
    Type: "volume",
    Name: `${group.acquisition.projectName}_dfm-exports`,
    Destination: "/exports",
    RW: false,
  }];
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
