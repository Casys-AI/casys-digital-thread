import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { fingerprintResourceBytes } from "../../domain/analysis/provider-resource-reader.ts";
import type { ContentFingerprint } from "../../domain/kernel/types.ts";
import type { ThreadArtifact } from "../../domain/thread/thread-snapshot.ts";
import { FileByteStore } from "./file-byte-store.ts";
import { FileCaptureStore } from "./file-capture-store.ts";
import {
  RecordedAnalysisCasReader,
  type RecordedAnalysisCasStoreBinding,
  type RecordedAnalysisCasTuple,
} from "./recorded-analysis-cas-reader.ts";

const encoder = new TextEncoder();

/** Mirrors the two independent ThreadArtifact reader ports without importing an executor. */
interface ThreadArtifactReaderPort {
  read(artifact: Readonly<ThreadArtifact>): Promise<Uint8Array | undefined>;
}

/** Mirrors the tuple reader port consumed by the recorded Modelica executor. */
interface TupleReaderPort {
  read(expected: Readonly<RecordedAnalysisCasTuple>): Promise<Uint8Array | undefined>;
}

Deno.test(
  "RecordedAnalysisCasReader reads every reviewed Modelica byte store and the FEA proof text store",
  async () => {
    const fixture = await createFixture();
    try {
      const modelicaValues = await Promise.all([
        saveBytes(fixture.simulationCases, "simulation case"),
        saveBytes(fixture.providerManifests, "qualified manifest"),
        saveBytes(fixture.qualifiedSources, "model M end M;", "text/x-modelica"),
        saveBytes(fixture.sourceCaptures, "source capture"),
        saveBytes(fixture.qualificationCaptures, "qualification capture"),
      ]);
      const proof = await saveText(fixture.proofCaptures, "proof capture");

      const reader = fixture.reader();
      const modelicaReader: TupleReaderPort = reader;
      const recordedPlanReader: ThreadArtifactReaderPort = reader;
      const feaPlanReader: ThreadArtifactReaderPort = reader;
      assertEquals(typeof modelicaReader.read, "function");
      assertEquals(typeof recordedPlanReader.read, "function");
      assertEquals(typeof feaPlanReader.read, "function");

      for (const value of modelicaValues) {
        assertEquals(await reader.read(value.tuple), value.bytes);
      }
      assertEquals(await reader.read(proof.tuple), proof.bytes);
      assertEquals(
        await reader.read(threadArtifact(proof.tuple, proof.fingerprint)),
        proof.bytes,
      );
    } finally {
      await Deno.remove(fixture.directory, { recursive: true });
    }
  },
);

Deno.test(
  "RecordedAnalysisCasReader rejects unknown and malformed local references before consulting a store",
  async () => {
    let reads = 0;
    const reader = new RecordedAnalysisCasReader({
      stores: countingBindings(() => reads += 1),
    });
    const digest = "a".repeat(64);
    const rejected = [
      tuple(`casys://unreviewed/sha256/${digest}`, digest),
      tuple(`casys://simulation-case-v2/not-sha256/${digest}`, digest),
      tuple(`casys://simulation-case-v2/sha256/${digest}`, digest, "text/plain"),
      tuple(`file:///private/recorded-analysis/${digest}`, digest),
      tuple(`mcp://modelica/resources/${digest}`, digest),
    ];

    for (const input of rejected) {
      await assertRejects(() => reader.read(input), TypeError);
    }
    assertEquals(reads, 0);
  },
);

Deno.test(
  "RecordedAnalysisCasReader rejects an exact tuple with a mismatched count or hash",
  async () => {
    const fixture = await createFixture();
    try {
      const saved = await saveBytes(fixture.simulationCases, "case bytes");
      const reader = fixture.reader();
      await assertRejects(
        () => reader.read({ ...saved.tuple, byteCount: saved.tuple.byteCount + 1 }),
        TypeError,
      );
      await assertRejects(
        () => reader.read({ ...saved.tuple, sha256: "0".repeat(64) }),
        TypeError,
      );
    } finally {
      await Deno.remove(fixture.directory, { recursive: true });
    }
  },
);

Deno.test(
  "RecordedAnalysisCasReader rejects duplicate or namespace-swapped closed configuration",
  async () => {
    const fixture = await createFixture();
    try {
      const bindings = fixture.bindings();
      assertThrows(
        () => new RecordedAnalysisCasReader({ stores: [...bindings, bindings[0]] }),
        TypeError,
      );
      const swapped: RecordedAnalysisCasStoreBinding[] = [
        {
          namespace: "simulation-case-v2",
          storage: "bytes",
          store: fixture.qualifiedSources,
        } as unknown as RecordedAnalysisCasStoreBinding,
        ...bindings.slice(1),
      ];
      assertThrows(
        () => new RecordedAnalysisCasReader({ stores: swapped }),
        TypeError,
      );
    } finally {
      await Deno.remove(fixture.directory, { recursive: true });
    }
  },
);

Deno.test(
  "RecordedAnalysisCasReader fails closed when byte or text capture storage is tampered",
  async () => {
    const fixture = await createFixture();
    try {
      const modelica = await saveBytes(fixture.simulationCases, "case before tamper");
      await Deno.writeFile(
        `${fixture.byteDirectory}/${modelica.fingerprint.digest}`,
        encoder.encode("tampered modelica bytes"),
      );
      await assertRejects(() => fixture.reader().read(modelica.tuple), Error);

      const proof = await saveText(fixture.proofCaptures, "proof before tamper");
      await Deno.writeFile(
        fixture.proofCaptures.pathFor(proof.fingerprint),
        encoder.encode("tampered proof bytes"),
      );
      await assertRejects(() => fixture.reader().read(proof.tuple), Error);
    } finally {
      await Deno.remove(fixture.directory, { recursive: true });
    }
  },
);

interface Fixture {
  readonly directory: string;
  readonly byteDirectory: string;
  readonly simulationCases: FileByteStore<"simulation-case-v2">;
  readonly providerManifests: FileByteStore<"modelica-qualified-provider-manifest">;
  readonly qualifiedSources: FileByteStore<"modelica-qualified-source">;
  readonly sourceCaptures: FileByteStore<"modelica-qualified-source-capture">;
  readonly qualificationCaptures: FileByteStore<"simulation-case-qualification">;
  readonly proofCaptures: FileCaptureStore<"fea-proof-case">;
  readonly bindings: () => RecordedAnalysisCasStoreBinding[];
  readonly reader: () => RecordedAnalysisCasReader;
}

async function createFixture(): Promise<Fixture> {
  const directory = await Deno.makeTempDir({ prefix: "recorded-analysis-cas-reader-" });
  const byteDirectory = `${directory}/simulation-cases`;
  const simulationCases = byteStore(
    "simulation-case-v2",
    byteDirectory,
    "simulation-case-v2",
  );
  const providerManifests = byteStore(
    "modelica-qualified-provider-manifest",
    `${directory}/provider-manifests`,
    "modelica-qualified-provider-manifest",
  );
  const qualifiedSources = byteStore(
    "modelica-qualified-source",
    `${directory}/qualified-sources`,
    "modelica-qualified-source",
  );
  const sourceCaptures = byteStore(
    "modelica-qualified-source-capture",
    `${directory}/source-captures`,
    "modelica-qualified-source-capture",
  );
  const qualificationCaptures = byteStore(
    "simulation-case-qualification",
    `${directory}/qualification-captures`,
    "simulation-case-qualification",
  );
  const proofCaptures = new FileCaptureStore({
    kind: "fea-proof-case",
    directory: `${directory}/proof-captures`,
    uriNamespace: "fea-proof-case-capture",
    label: "FEA proof case",
  });
  const bindings = (): RecordedAnalysisCasStoreBinding[] => [
    { namespace: "simulation-case-v2", storage: "bytes", store: simulationCases },
    {
      namespace: "modelica-qualified-provider-manifest",
      storage: "bytes",
      store: providerManifests,
    },
    {
      namespace: "modelica-qualified-source",
      storage: "bytes",
      store: qualifiedSources,
    },
    {
      namespace: "modelica-qualified-source-capture",
      storage: "bytes",
      store: sourceCaptures,
    },
    {
      namespace: "simulation-case-qualification",
      storage: "bytes",
      store: qualificationCaptures,
    },
    {
      namespace: "fea-proof-case-capture",
      storage: "text",
      store: proofCaptures,
    },
  ];
  return {
    directory,
    byteDirectory,
    simulationCases,
    providerManifests,
    qualifiedSources,
    sourceCaptures,
    qualificationCaptures,
    proofCaptures,
    bindings,
    reader: () => new RecordedAnalysisCasReader({ stores: bindings() }),
  };
}

function byteStore<K extends string>(
  kind: K,
  directory: string,
  uriNamespace: string,
): FileByteStore<K> {
  return new FileByteStore({ kind, directory, uriNamespace, label: kind });
}

async function saveBytes<K extends string>(
  store: FileByteStore<K>,
  text: string,
  mediaType = "application/json",
): Promise<StoredValue> {
  const bytes = encoder.encode(text);
  const fingerprint = await contentFingerprint(bytes);
  const receipt = await store.save(fingerprint, bytes);
  return {
    bytes,
    fingerprint,
    tuple: {
      uri: receipt.uri,
      byteCount: receipt.byteCount,
      sha256: fingerprint.digest,
      mediaType,
    },
  };
}

async function saveText(
  store: FileCaptureStore<"fea-proof-case">,
  text: string,
): Promise<StoredValue> {
  const bytes = encoder.encode(text);
  const fingerprint = await contentFingerprint(bytes);
  const saved = await store.save(fingerprint, text);
  return {
    bytes,
    fingerprint,
    tuple: {
      uri: saved.uri,
      byteCount: bytes.byteLength,
      sha256: fingerprint.digest,
      mediaType: "application/json",
    },
  };
}

interface StoredValue {
  readonly bytes: Uint8Array;
  readonly fingerprint: ContentFingerprint;
  readonly tuple: RecordedAnalysisCasTuple;
}

async function contentFingerprint(bytes: Uint8Array): Promise<ContentFingerprint> {
  return {
    algorithm: "sha256",
    digest: await fingerprintResourceBytes(bytes),
  };
}

function tuple(
  uri: string,
  sha256: string,
  mediaType = "application/json",
): RecordedAnalysisCasTuple {
  return { uri, byteCount: 1, sha256, mediaType };
}

function threadArtifact(
  tuple: RecordedAnalysisCasTuple,
  fingerprint: ContentFingerprint,
): ThreadArtifact {
  return {
    id: "recorded-proof-artifact",
    name: "Recorded proof artifact",
    kind: "document",
    version: "1",
    fingerprint,
    uri: tuple.uri,
    mediaType: tuple.mediaType,
    producer: { serverId: "digital-thread", tool: "recorded", runId: "run-1" },
    inputArtifactIds: [],
    freshness: {
      status: "fresh",
      changedAt: "2026-08-12T00:00:00.000Z",
      invalidatedByChangeIds: [],
    },
  };
}

function countingBindings(
  onRead: () => void,
): RecordedAnalysisCasStoreBinding[] {
  const bytes = <K extends string>(namespace: string) =>
    ({
      uriFor: (fingerprint: ContentFingerprint) =>
        `casys://${namespace}/sha256/${fingerprint.digest}`,
      read: () => {
        onRead();
        return Promise.resolve(undefined);
      },
    }) as unknown as FileByteStore<K>;
  const text = (namespace: string) =>
    ({
      uriFor: (fingerprint: ContentFingerprint) =>
        `casys://${namespace}/sha256/${fingerprint.digest}`,
      read: () => {
        onRead();
        return Promise.resolve(undefined);
      },
    }) as unknown as FileCaptureStore<"fea-proof-case">;
  return [
    {
      namespace: "simulation-case-v2",
      storage: "bytes",
      store: bytes("simulation-case-v2"),
    },
    {
      namespace: "modelica-qualified-provider-manifest",
      storage: "bytes",
      store: bytes("modelica-qualified-provider-manifest"),
    },
    {
      namespace: "modelica-qualified-source",
      storage: "bytes",
      store: bytes("modelica-qualified-source"),
    },
    {
      namespace: "modelica-qualified-source-capture",
      storage: "bytes",
      store: bytes("modelica-qualified-source-capture"),
    },
    {
      namespace: "simulation-case-qualification",
      storage: "bytes",
      store: bytes("simulation-case-qualification"),
    },
    {
      namespace: "fea-proof-case-capture",
      storage: "text",
      store: text("fea-proof-case-capture"),
    },
  ];
}
