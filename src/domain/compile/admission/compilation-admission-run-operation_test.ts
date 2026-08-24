import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  assembleCompilationAdmissionRunOperation,
  COMPILATION_ADMISSION_ARTIFACT_KIND,
  COMPILATION_ADMISSION_BINDING_NAME,
  COMPILATION_ADMISSION_BINDING_SOURCE_KIND,
  type CompilationAdmissionRunOperationInput,
} from "./compilation-admission-run-operation.ts";

const CREATION_BASIS = {
  kind: "thread-snapshot",
  snapshotId: "snapshot.7",
  revision: 7,
  subjectId: "subject.ramp",
} as const;

const CURRENT_BASIS = {
  kind: "thread-snapshot",
  snapshotId: "snapshot.8",
  revision: 8,
  subjectId: "subject.ramp",
} as const;

const ARTIFACT_ID = `technical-compilation-admission-${"a".repeat(64)}`;
const REGISTERED_OPERATION = {
  id: "example.registered-admitted-run",
  version: "1",
} as const;

function assemble(
  input: CompilationAdmissionRunOperationInput = {
    operation: REGISTERED_OPERATION,
    basis: CURRENT_BASIS,
    artifactId: ARTIFACT_ID,
  },
) {
  return assembleCompilationAdmissionRunOperation(input);
}

Deno.test(
  "assembleCompilationAdmissionRunOperation binds the current review basis, not the historical creation snapshot",
  () => {
    const prepared = assemble();
    const binding = prepared.bindings[0];

    assertEquals(prepared.id, REGISTERED_OPERATION.id);
    assertEquals(prepared.version, REGISTERED_OPERATION.version);
    assertEquals(prepared.bindings.length, 1);
    assertEquals(binding.name, COMPILATION_ADMISSION_BINDING_NAME);
    assertEquals(binding.source.kind, COMPILATION_ADMISSION_BINDING_SOURCE_KIND);
    assertEquals(binding.source.reference, {
      snapshotId: CURRENT_BASIS.snapshotId,
      snapshotRevision: CURRENT_BASIS.revision,
      kind: COMPILATION_ADMISSION_ARTIFACT_KIND,
      id: ARTIFACT_ID,
    });
    assertEquals(
      binding.source.reference.snapshotId === CREATION_BASIS.snapshotId,
      false,
    );
    assertEquals(
      binding.source.reference.snapshotRevision === CREATION_BASIS.revision,
      false,
    );
    assert(Object.isFrozen(prepared));
    assert(Object.isFrozen(prepared.bindings));
    assert(Object.isFrozen(binding));
    assert(Object.isFrozen(binding.source));
    assert(Object.isFrozen(binding.source.reference));
  },
);

Deno.test(
  "assembleCompilationAdmissionRunOperation keeps the MCP JSON shape id/version/bindings",
  () => {
    const prepared = assemble();
    assertEquals(Object.keys(prepared), ["id", "version", "bindings"]);
    assertEquals(JSON.parse(JSON.stringify(prepared)), {
      id: REGISTERED_OPERATION.id,
      version: REGISTERED_OPERATION.version,
      bindings: [{
        name: COMPILATION_ADMISSION_BINDING_NAME,
        source: {
          kind: COMPILATION_ADMISSION_BINDING_SOURCE_KIND,
          reference: {
            snapshotId: CURRENT_BASIS.snapshotId,
            snapshotRevision: CURRENT_BASIS.revision,
            kind: COMPILATION_ADMISSION_ARTIFACT_KIND,
            id: ARTIFACT_ID,
          },
        },
      }],
    });
  },
);

Deno.test(
  "assembleCompilationAdmissionRunOperation copies caller-supplied registered identity without domain-specific ids",
  () => {
    const prepared = assemble({
      operation: { id: "example.other-admitted-run", version: "2" },
      basis: CURRENT_BASIS,
      artifactId: ARTIFACT_ID,
    });
    assertEquals(prepared.id, "example.other-admitted-run");
    assertEquals(prepared.version, "2");
  },
);

Deno.test(
  "assembleCompilationAdmissionRunOperation refuses a latest Thread basis",
  () => {
    assertThrows(
      () =>
        assemble({
          operation: REGISTERED_OPERATION,
          basis: { ...CURRENT_BASIS, snapshotId: "latest" },
          artifactId: ARTIFACT_ID,
        }),
      TypeError,
      "must not use a latest alias",
    );
  },
);

Deno.test(
  "assembleCompilationAdmissionRunOperation refuses an unsafe operation id",
  () => {
    assertThrows(
      () =>
        assemble({
          operation: { id: "not a stable id", version: "1" },
          basis: CURRENT_BASIS,
          artifactId: ARTIFACT_ID,
        }),
      TypeError,
      "must be a stable identifier",
    );
  },
);

Deno.test(
  "assembleCompilationAdmissionRunOperation refuses an unsafe operation version",
  () => {
    assertThrows(
      () =>
        assemble({
          operation: { id: REGISTERED_OPERATION.id, version: "" },
          basis: CURRENT_BASIS,
          artifactId: ARTIFACT_ID,
        }),
      TypeError,
      "must be a non-empty string without edge whitespace",
    );
  },
);

Deno.test(
  "assembleCompilationAdmissionRunOperation refuses an unsafe admission artifact id",
  () => {
    assertThrows(
      () =>
        assemble({
          operation: REGISTERED_OPERATION,
          basis: CURRENT_BASIS,
          artifactId: "not a stable id",
        }),
      TypeError,
      "must be a stable identifier",
    );
  },
);

Deno.test(
  "assembleCompilationAdmissionRunOperation refuses extra operation fields",
  () => {
    assertThrows(
      () =>
        assemble({
          operation: {
            id: REGISTERED_OPERATION.id,
            version: REGISTERED_OPERATION.version,
            alias: "latest",
          } as CompilationAdmissionRunOperationInput["operation"],
          basis: CURRENT_BASIS,
          artifactId: ARTIFACT_ID,
        }),
      TypeError,
      "has unsupported field alias",
    );
  },
);
