import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  assembleTechnicalCompilationAdmissionOperation,
  TECHNICAL_COMPILATION_ADMISSION_ARTIFACT_KIND,
  TECHNICAL_COMPILATION_ADMISSION_BINDING_NAME,
  TECHNICAL_COMPILATION_ADMISSION_BINDING_SOURCE_KIND,
} from "./technical-compilation-admission-operation.ts";

const BASIS = {
  kind: "thread-snapshot",
  snapshotId: "snapshot.12",
  revision: 12,
  subjectId: "subject.lamp",
} as const;

const SYSML_ARTIFACT_ID = "architecture-sysml-lamp";

Deno.test(
  "assembleTechnicalCompilationAdmissionOperation fixes the seal identity and current review basis",
  () => {
    const operation = assembleTechnicalCompilationAdmissionOperation({
      basis: BASIS,
      sysmlArtifactId: SYSML_ARTIFACT_ID,
    });

    assertEquals(operation, {
      id: "compile.seal-admission",
      version: "3",
      bindings: [{
        name: TECHNICAL_COMPILATION_ADMISSION_BINDING_NAME,
        source: {
          kind: TECHNICAL_COMPILATION_ADMISSION_BINDING_SOURCE_KIND,
          reference: {
            snapshotId: BASIS.snapshotId,
            snapshotRevision: BASIS.revision,
            kind: TECHNICAL_COMPILATION_ADMISSION_ARTIFACT_KIND,
            id: SYSML_ARTIFACT_ID,
          },
        },
      }],
    });
    assert(Object.isFrozen(operation));
    assert(Object.isFrozen(operation.bindings));
    assert(Object.isFrozen(operation.bindings[0]));
    assert(Object.isFrozen(operation.bindings[0]!.source));
    assert(Object.isFrozen(operation.bindings[0]!.source.reference));
  },
);

Deno.test(
  "assembleTechnicalCompilationAdmissionOperation refuses latest aliases and caller operation fields",
  () => {
    assertThrows(
      () =>
        assembleTechnicalCompilationAdmissionOperation({
          basis: { ...BASIS, snapshotId: "latest" },
          sysmlArtifactId: SYSML_ARTIFACT_ID,
        }),
      TypeError,
      "must not use a latest alias",
    );
    assertThrows(
      () =>
        assembleTechnicalCompilationAdmissionOperation(
          {
            basis: BASIS,
            sysmlArtifactId: SYSML_ARTIFACT_ID,
            operation: { id: "caller.selected", version: "1" },
          } as unknown as Parameters<
            typeof assembleTechnicalCompilationAdmissionOperation
          >[0],
        ),
      TypeError,
      "has unsupported field operation",
    );
  },
);
