import { assertEquals, assertRejects } from "@std/assert";
import {
  canonicalProviderResourceAcquisitionLedgerText,
  createProviderResourceRead,
  fingerprintResourceBytes,
  PROVIDER_RESOURCE_ACQUISITION_LEDGER_SCHEMA,
  validateProviderResourceAcquisitionLedger,
} from "../../../domain/compile/source/provider-resource-reader.ts";
import { FileByteStore } from "./file-byte-store.ts";
import {
  createProviderArtifactCaptureManifest,
  PROVIDER_ARTIFACT_CAPTURE_MANIFEST_SCHEMA,
  type ProviderArtifactCaptureInput,
  validateProviderArtifactCaptureManifest,
} from "./provider-artifact-capture-manifest.ts";

interface ResourceSpec {
  role: string;
  bytes: Uint8Array;
}

type TestInput = ProviderArtifactCaptureInput<
  "provider-artifact",
  "provider-resource-ledger"
>;

async function captureFixture(
  directory: string,
  specs: readonly ResourceSpec[],
): Promise<TestInput> {
  const resources = await Promise.all(specs.map(async ({ role, bytes }) => ({
    role,
    uri: `artifact://provider/run-1/${role}.bin`,
    mediaType: "application/octet-stream",
    byteCount: bytes.byteLength,
    sha256: await fingerprintResourceBytes(bytes),
  })));
  const ledger = validateProviderResourceAcquisitionLedger({
    schemaVersion: PROVIDER_RESOURCE_ACQUISITION_LEDGER_SCHEMA,
    id: "expected-output-ledger-1",
    provider: { id: "mcp-provider", runId: "run-1" },
    resources,
  });
  const ledgerBytes = new TextEncoder().encode(
    canonicalProviderResourceAcquisitionLedgerText(ledger),
  );
  const ledgerDigest = await fingerprintResourceBytes(ledgerBytes);
  const ledgerStore = new FileByteStore(
    {
      kind: "provider-resource-ledger",
      directory: `${directory}/ledger`,
      uriNamespace: "provider-resource-ledgers",
      label: "Provider resource ledger",
    } as const,
  );
  const ledgerStored = await ledgerStore.save(
    { algorithm: "sha256", digest: ledgerDigest },
    ledgerBytes,
  );

  const artifactStore = new FileByteStore(
    {
      kind: "provider-artifact",
      directory: `${directory}/artifacts`,
      uriNamespace: "provider-artifacts",
      label: "Provider artifacts",
    } as const,
  );
  const artifacts = await Promise.all(specs.map(async ({ role, bytes }) => {
    const expected = ledger.resources.find((resource) => resource.role === role);
    if (!expected) throw new Error("test ledger resource missing");
    const resourceRead = await createProviderResourceRead({
      uri: expected.uri,
      mediaType: expected.mediaType,
      byteCount: expected.byteCount,
      sha256: expected.sha256,
    }, bytes);
    const stored = await artifactStore.save(
      { algorithm: "sha256", digest: expected.sha256 },
      resourceRead.bytes.copy(),
    );
    return { role, resourceRead, stored };
  }));
  return {
    schemaVersion: PROVIDER_ARTIFACT_CAPTURE_MANIFEST_SCHEMA,
    ledger: { stored: ledgerStored },
    artifacts,
  };
}

Deno.test("capture manifest binds canonical ledger to provider reads and CAS rereads, including zero bytes", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const input = await captureFixture(directory, [
      { role: "z-result", bytes: new Uint8Array([1, 2]) },
      { role: "a-empty-log", bytes: new Uint8Array() },
    ]);
    const manifest = await createProviderArtifactCaptureManifest(input);
    assertEquals(manifest.provider, { id: "mcp-provider", runId: "run-1" });
    assertEquals(manifest.ledger.id, "expected-output-ledger-1");
    assertEquals(manifest.ledger.fingerprint, input.ledger.stored.fingerprint);
    assertEquals(manifest.ledger.casUri, input.ledger.stored.uri);
    assertEquals(manifest.artifacts.map((entry) => entry.role), [
      "a-empty-log",
      "z-result",
    ]);
    assertEquals(manifest.artifacts[0].resource.byteCount, 0);
    assertEquals(Object.isFrozen(manifest.artifacts[0].resource), true);

    const validated = await validateProviderArtifactCaptureManifest(
      JSON.parse(JSON.stringify(manifest)),
    );
    assertEquals(validated, manifest);
    assertEquals(Object.isFrozen(validated.ledger.fingerprint), true);

    const reversed = await createProviderArtifactCaptureManifest({
      ...input,
      artifacts: [...input.artifacts].reverse(),
    });
    assertEquals(reversed.fingerprint, manifest.fingerprint);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("capture manifest rejects plain and prototype-forged FileByteStore receipts", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const input = await captureFixture(directory, [
      { role: "result", bytes: new Uint8Array([7]) },
    ]);
    const valid = input.artifacts[0].stored;
    const receiptShape = {
      kind: valid.kind,
      uri: valid.uri,
      fingerprint: valid.fingerprint,
      byteCount: valid.byteCount,
      verification: valid.verification,
      copyBytes: () => valid.copyBytes(),
    };
    for (
      const stored of [
        receiptShape,
        Object.assign(Object.create(Object.getPrototypeOf(valid)), receiptShape),
      ]
    ) {
      await assertRejects(
        () =>
          createProviderArtifactCaptureManifest({
            ...input,
            artifacts: [{ ...input.artifacts[0], stored }],
          } as never),
        TypeError,
        "verified FileByteStore reread receipt",
      );
    }
    await assertRejects(
      () =>
        createProviderArtifactCaptureManifest({
          ...input,
          ledger: { stored: receiptShape },
        } as never),
      TypeError,
      "verified FileByteStore reread receipt",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("capture manifest rejects a genuine receipt whose copier was substituted", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const input = await captureFixture(directory, [
      { role: "result", bytes: new Uint8Array([7]) },
    ]);
    const receiptPrototype = Object.getPrototypeOf(input.ledger.stored) as {
      copyBytes(): Uint8Array;
    };
    const originalCopyBytes = receiptPrototype.copyBytes;
    try {
      receiptPrototype.copyBytes = () => new Uint8Array();
      await assertRejects(
        () => createProviderArtifactCaptureManifest(input),
        TypeError,
        "verified FileByteStore reread receipt",
      );
    } finally {
      receiptPrototype.copyBytes = originalCopyBytes;
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("capture manifest rejects noncanonical ledger bytes and caller-supplied ledger fingerprints", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const input = await captureFixture(directory, [
      { role: "result", bytes: new Uint8Array([1]) },
    ]);
    await assertRejects(
      () =>
        createProviderArtifactCaptureManifest({
          ...input,
          ledger: {
            ...input.ledger,
            fingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
          },
        } as never),
      TypeError,
      "unsupported field fingerprint",
    );

    const canonical = input.ledger.stored.copyBytes();
    const noncanonical = new Uint8Array([...canonical, 0x0a]);
    const digest = await fingerprintResourceBytes(noncanonical);
    const ledgerStore = new FileByteStore(
      {
        kind: "provider-resource-ledger",
        directory: `${directory}/noncanonical-ledger`,
        uriNamespace: "provider-resource-ledgers",
        label: "Provider resource ledger",
      } as const,
    );
    const stored = await ledgerStore.save(
      { algorithm: "sha256", digest },
      noncanonical,
    );
    await assertRejects(
      () => createProviderArtifactCaptureManifest({ ...input, ledger: { stored } }),
      TypeError,
      "canonical JSON",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("capture manifest requires an exact ledger-to-artifact bijection", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const input = await captureFixture(directory, [
      { role: "a", bytes: new Uint8Array([1]) },
      { role: "b", bytes: new Uint8Array([2]) },
    ]);
    await assertRejects(
      () =>
        createProviderArtifactCaptureManifest({
          ...input,
          artifacts: [input.artifacts[0]],
        }),
      TypeError,
      "cover every ledger resource",
    );
    await assertRejects(
      () =>
        createProviderArtifactCaptureManifest({
          ...input,
          artifacts: [{ ...input.artifacts[0], role: "not-in-ledger" }],
        }),
      TypeError,
      "not declared by the ledger",
    );
    await assertRejects(
      () =>
        createProviderArtifactCaptureManifest({
          ...input,
          artifacts: [{
            ...input.artifacts[0],
            resourceRead: input.artifacts[1].resourceRead,
          }, input.artifacts[1]],
        }),
      TypeError,
      "exact ledger tuple",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("capture manifest permits distinct resource roles to deduplicate identical CAS bytes", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const bytes = new Uint8Array([4, 2]);
    const input = await captureFixture(directory, [
      { role: "a-primary", bytes },
      { role: "b-copy", bytes: Uint8Array.from(bytes) },
    ]);
    const manifest = await createProviderArtifactCaptureManifest(input);
    assertEquals(manifest.artifacts[0].cas.uri, manifest.artifacts[1].cas.uri);
    assertEquals(
      manifest.artifacts[0].resource.uri === manifest.artifacts[1].resource.uri,
      false,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("capture manifest sorts roles by ASCII code units", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const manifest = await createProviderArtifactCaptureManifest(
      await captureFixture(directory, [
        { role: "i-role", bytes: new Uint8Array([1]) },
        { role: "J-role", bytes: new Uint8Array([2]) },
        { role: "I-role", bytes: new Uint8Array([3]) },
      ]),
    );
    assertEquals(manifest.artifacts.map((artifact) => artifact.role), [
      "I-role",
      "J-role",
      "i-role",
    ]);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("capture manifest rejects authority fields and malformed exact keys", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const input = await captureFixture(directory, [
      { role: "result", bytes: new Uint8Array([1]) },
    ]);
    await assertRejects(
      () =>
        createProviderArtifactCaptureManifest({
          ...input,
          authority: "approved",
        } as never),
      TypeError,
      "unsupported field authority",
    );
    await assertRejects(
      () =>
        createProviderArtifactCaptureManifest({
          ...input,
          artifacts: [{ ...input.artifacts[0], path: "/tmp/output" }],
        } as never),
      TypeError,
      "unsupported field path",
    );
    await assertRejects(
      () => createProviderArtifactCaptureManifest({ ...input, artifacts: [] }),
      TypeError,
      "must not be empty",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("persisted capture manifest binds ledger/artifact CAS identity, sort order, and fingerprint", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const input = await captureFixture(directory, [
      { role: "a", bytes: new Uint8Array([1]) },
      { role: "b", bytes: new Uint8Array([2]) },
    ]);
    const manifest = await createProviderArtifactCaptureManifest(input);
    const changes: Array<[Record<string, unknown>, string]> = [
      [{ byteCount: 2 }, "must equal"],
      [{ sha256: "d".repeat(64) }, "declared sha256"],
      [
        { uri: `file:///tmp/${manifest.artifacts[0].cas.sha256}` },
        "canonical casys CAS URI",
      ],
      [
        { uri: `casys:///sha256/${manifest.artifacts[0].cas.sha256}` },
        "canonical casys CAS URI",
      ],
      [
        { uri: `casys://host:123/sha256/${manifest.artifacts[0].cas.sha256}` },
        "canonical casys CAS URI",
      ],
    ];
    for (const [change, message] of changes) {
      const parsed = JSON.parse(JSON.stringify(manifest));
      parsed.artifacts[0].cas = { ...parsed.artifacts[0].cas, ...change };
      await assertRejects(
        () => validateProviderArtifactCaptureManifest(parsed),
        TypeError,
        message,
      );
    }
    const badLedger = JSON.parse(JSON.stringify(manifest));
    badLedger.ledger.casUri = `file:///tmp/${manifest.ledger.fingerprint.digest}`;
    await assertRejects(
      () => validateProviderArtifactCaptureManifest(badLedger),
      TypeError,
      "canonical casys CAS URI",
    );
    const unsorted = JSON.parse(JSON.stringify(manifest));
    unsorted.artifacts.reverse();
    await assertRejects(
      () => validateProviderArtifactCaptureManifest(unsorted),
      TypeError,
      "sorted by role",
    );
    await assertRejects(
      () =>
        validateProviderArtifactCaptureManifest({
          ...manifest,
          fingerprint: { algorithm: "sha256", digest: "d".repeat(64) },
        }),
      TypeError,
      "fingerprint mismatch",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
