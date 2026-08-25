import { assertEquals, assertRejects } from "@std/assert";
import { GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST } from "../../../domain/cad/module-assembly/geometry-module-assembly-execution.ts";
import {
  GeometryModuleAssemblyOutputValidationError,
  GeometryModuleAssemblyOutputValidator,
} from "./geometry-module-assembly-output-validator.ts";

const STEP = new TextEncoder().encode(
  "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n",
);

Deno.test("module-assembly output validator accepts the registered STEP and GLB pair", async () => {
  const validator = new GeometryModuleAssemblyOutputValidator(() => ({
    ReadStepFile(bytes) {
      assertEquals(bytes, STEP);
      return { success: true };
    },
  }));
  await validator.validateOutput(stepDeclaration(), STEP);
  await validator.validateOutput(glbDeclaration(), minimalGlb());
});

Deno.test("module-assembly output validator refuses the untrusted Build123d declaration and broken containers", async () => {
  const validator = new GeometryModuleAssemblyOutputValidator(() => ({
    ReadStepFile() {
      return { success: true };
    },
  }));
  await expectCode(
    () =>
      validator.validateOutput({
        role: "geometry",
        basename: "geometry.step",
        mediaType: "model/step",
        format: "step-ap214",
      }, STEP),
    "unsupported_output_contract",
  );
  await expectCode(
    () => validator.validateOutput(stepDeclaration(), new Uint8Array()),
    "empty_output",
  );
  await expectCode(
    () =>
      validator.validateOutput(
        stepDeclaration(),
        new TextEncoder().encode("not a step file"),
      ),
    "invalid_step",
  );
  await expectCode(
    () => validator.validateOutput(glbDeclaration(), new Uint8Array([1, 2, 3])),
    "invalid_glb",
  );
});

function stepDeclaration() {
  return GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST.find((item) =>
    item.role === "assembly.step"
  )!;
}

function glbDeclaration() {
  return GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST.find((item) =>
    item.role === "assembly.glb"
  )!;
}

function minimalGlb(): Uint8Array {
  const bytes = new Uint8Array(12);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, 12, true);
  return bytes;
}

async function expectCode(
  run: () => Promise<void>,
  code: string,
): Promise<void> {
  const error = await assertRejects(
    run,
    GeometryModuleAssemblyOutputValidationError,
  );
  assertEquals(error.code, code);
}
