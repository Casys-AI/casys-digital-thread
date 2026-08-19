import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import {
  createProviderResourceRead,
  type ExpectedProviderResource,
  fingerprintResourceBytes,
  type ProviderResourceReader,
} from "../../../domain/compile/source/provider-resource-reader.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import { FileByteStore } from "./file-byte-store.ts";
import { ProviderResourceCaptureService } from "./provider-resource-capture-service.ts";

type Service = ProviderResourceCaptureService<
  "provider-resource",
  "provider-resource-ledger",
  "provider-artifact-capture-manifest"
>;

Deno.test("ProviderResourceCaptureService captures ASCII-ordered exact resources and rereads each CAS boundary", async () => {
  await withService({
    "z-result": new Uint8Array([1, 2]),
    "I-empty": new Uint8Array(),
    "a-log": new Uint8Array([3]),
  }, async ({ service, directory, calls }) => {
    const result = await service.capture(
      await requestFor({
        "z-result": new Uint8Array([1, 2]),
        "I-empty": new Uint8Array(),
        "a-log": new Uint8Array([3]),
      }),
    );

    assertEquals(result.ledger.resources.map((resource) => resource.role), [
      "I-empty",
      "a-log",
      "z-result",
    ]);
    assertEquals(calls, result.ledger.resources.map((resource) => resource.uri));
    assertEquals(result.manifest.artifacts.map((artifact) => artifact.role), [
      "I-empty",
      "a-log",
      "z-result",
    ]);
    assertEquals(result.manifest.artifacts[0].resource.byteCount, 0);
    assertNotEquals(
      result.storedManifest.fingerprint.digest,
      result.manifest.fingerprint.digest,
    );

    const persisted = await Deno.readFile(
      `${directory}/manifests/${result.storedManifest.fingerprint.digest}`,
    );
    assertEquals(
      new TextDecoder().decode(persisted),
      deterministicJson(result.manifest),
    );
    assertEquals(
      await fingerprintResourceBytes(persisted),
      result.storedManifest.fingerprint.digest,
    );
  });
});

Deno.test("ProviderResourceCaptureService derives a stable ledger id from normalized tuple order", async () => {
  const bytes = { a: new Uint8Array([1]), b: new Uint8Array([2]) };
  await withService(bytes, async ({ service }) => {
    const first = await service.capture(await requestFor(bytes));
    const second = await service.capture({
      ...(await requestFor(bytes)),
      resources: [...(await requestFor(bytes)).resources].reverse(),
    });
    assertEquals(first.ledger.id, second.ledger.id);
    assertEquals(first.manifest.fingerprint, second.manifest.fingerprint);
    assertEquals(
      first.storedManifest.fingerprint,
      second.storedManifest.fingerprint,
    );
  });
});

Deno.test("ProviderResourceCaptureService fails closed before provider I/O for malformed or authority-bearing selection", async () => {
  await withService({ result: new Uint8Array([1]) }, async ({ service, calls }) => {
    const valid = await requestFor({ result: new Uint8Array([1]) });
    await assertRejects(
      () => service.capture({ ...valid, authority: "approved" } as never),
      TypeError,
      "unsupported field authority",
    );
    await assertRejects(
      () => service.capture({ ...valid, resources: [] }),
      TypeError,
      "must not be empty",
    );
    await assertRejects(
      () =>
        service.capture({
          ...valid,
          resources: [{ ...valid.resources[0], graph: { node: "x" } }],
        } as never),
      TypeError,
      "unsupported field graph",
    );
    assertEquals(calls, []);
  });
});

Deno.test("ProviderResourceCaptureService rejects bytes that do not match the selected exact tuple", async () => {
  await withService({ result: new Uint8Array([9]) }, async ({ service }) => {
    await assertRejects(
      async () =>
        await service.capture(await requestFor({ result: new Uint8Array([1]) })),
      Error,
      "expected",
    );
  });
});

async function withService(
  values: Record<string, Uint8Array>,
  action: (value: {
    service: Service;
    directory: string;
    calls: string[];
  }) => Promise<void>,
): Promise<void> {
  const directory = await Deno.makeTempDir({ prefix: "provider-resource-capture-" });
  try {
    const calls: string[] = [];
    const reader: ProviderResourceReader = {
      async read(expected: ExpectedProviderResource) {
        calls.push(expected.uri);
        const role = new URL(expected.uri).pathname.slice(1, -4);
        const bytes = values[role];
        if (!bytes) throw new Error(`missing fixture bytes for ${role}`);
        return await createProviderResourceRead(expected, bytes);
      },
    };
    await action({
      service: new ProviderResourceCaptureService({
        reader,
        artifactStore: new FileByteStore(
          {
            kind: "provider-resource",
            directory: `${directory}/artifacts`,
            uriNamespace: "test-provider-artifacts",
            label: "Test provider artifacts",
          } as const,
        ),
        ledgerStore: new FileByteStore(
          {
            kind: "provider-resource-ledger",
            directory: `${directory}/ledgers`,
            uriNamespace: "test-provider-ledgers",
            label: "Test provider ledgers",
          } as const,
        ),
        manifestStore: new FileByteStore(
          {
            kind: "provider-artifact-capture-manifest",
            directory: `${directory}/manifests`,
            uriNamespace: "test-provider-manifests",
            label: "Test provider manifests",
          } as const,
        ),
      }),
      directory,
      calls,
    });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

async function requestFor(
  values: Record<string, Uint8Array>,
): Promise<{
  provider: { id: string; runId: string };
  resources: Array<{
    role: string;
    uri: string;
    mediaType: string;
    byteCount: number;
    sha256: string;
  }>;
}> {
  return {
    provider: { id: "provider-alpha", runId: "run-1" },
    resources: await Promise.all(
      Object.entries(values).map(async ([role, bytes]) => ({
        role,
        uri: `artifact://provider-alpha/${role}.bin`,
        mediaType: "application/octet-stream",
        byteCount: bytes.byteLength,
        sha256: await fingerprintResourceBytes(bytes),
      })),
    ),
  };
}
