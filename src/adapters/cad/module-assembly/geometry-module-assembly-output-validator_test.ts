import { assertEquals, assertRejects } from "@std/assert";
import { GEOMETRY_MODULE_ASSEMBLY_ASSETS } from "../../../domain/cad/module-assembly/geometry-module-assembly-receipt.ts";
import {
  GeometryModuleAssemblyOutputValidationError,
  GeometryModuleAssemblyOutputValidator,
} from "./geometry-module-assembly-output-validator.ts";

const STEP = new TextEncoder().encode(
  "ISO-10303-21;\nHEADER;\n" +
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));\n" +
    "ENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n",
);

Deno.test("module-assembly output validator accepts the registered STEP and GLB pair", async () => {
  const validator = new GeometryModuleAssemblyOutputValidator(() => ({
    ReadStepFile(bytes) {
      assertEquals(bytes, STEP);
      return meaningfulGeometry();
    },
  }));
  await validator.validateOutput(stepDeclaration(), STEP);
  await validator.validateOutput(glbDeclaration(), structuralGlb());
  await validator.validateOutput(
    glbDeclaration(),
    encodeGlb([
      jsonChunk({
        asset: { version: "2.0" },
        buffers: [{ byteLength: 1 }],
      }),
      binChunk(new Uint8Array(4)),
    ]),
  );
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

  const emptyGeometry = new GeometryModuleAssemblyOutputValidator(() => ({
    ReadStepFile() {
      return { success: true, root: { meshes: [], children: [] }, meshes: [] };
    },
  }));
  await expectCode(
    () => emptyGeometry.validateOutput(stepDeclaration(), STEP),
    "invalid_geometry",
  );
});

Deno.test("module-assembly output validator refuses structurally broken GLB containers", async () => {
  const validator = new GeometryModuleAssemblyOutputValidator(() => {
    throw new Error("GLB validation must not load a STEP reader.");
  });
  const jsonOnly = jsonChunk({ asset: { version: "2.0" } });
  const declaredBin = jsonChunk({
    asset: { version: "2.0" },
    buffers: [{ byteLength: 4 }],
  });
  const embeddedBin = binChunk(new Uint8Array(4));
  for (
    const bytes of [
      headerOnlyGlb(),
      encodeGlb([jsonOnly]),
      encodeGlb([declaredBin]),
      encodeGlb([binChunk(new Uint8Array(4))]),
      encodeGlb([jsonOnly, embeddedBin]),
      encodeGlb([jsonOnly, { type: 0x12345678, data: new Uint8Array(4) }]),
      encodeGlb([jsonOnly, jsonOnly]),
      encodeGlb([
        declaredBin,
        binChunk(new Uint8Array(4)),
        binChunk(new Uint8Array(4)),
      ]),
      encodeGlb([jsonOnly], { extra: new Uint8Array(4) }),
      encodeGlb([jsonOnly], {
        extra: new Uint8Array(4),
        length: 12 + 8 + jsonOnly.data.byteLength,
      }),
      encodeGlb([{ type: GLB_JSON, data: new TextEncoder().encode("{") }]),
      encodeGlb([jsonChunk({ asset: { version: 2 } })]),
      encodeGlb([
        jsonChunk({
          asset: { version: "2.0" },
          buffers: [{ byteLength: 4, uri: "buffer.bin" }],
        }),
        embeddedBin,
      ]),
      encodeGlb([
        jsonChunk({
          asset: { version: "2.0" },
          buffers: [
            { byteLength: 4, uri: "buffer.bin" },
            { byteLength: 4 },
          ],
        }),
        embeddedBin,
      ]),
      encodeGlb([
        jsonChunk({
          asset: { version: "2.0" },
          buffers: [{ byteLength: 4 }, { byteLength: 4 }],
        }),
        embeddedBin,
      ]),
      encodeGlb([
        jsonChunk({
          asset: { version: "2.0" },
          buffers: [{ byteLength: 4 }],
        }),
        binChunk(new Uint8Array(8)),
      ]),
      encodeGlb([
        jsonChunk({
          asset: { version: "2.0" },
          buffers: [{}],
        }),
        embeddedBin,
      ]),
      encodeGlb([
        jsonChunk({
          asset: { version: "2.0" },
          buffers: [{ byteLength: 0 }],
        }),
        embeddedBin,
      ]),
      encodeGlb([
        jsonChunk({
          asset: { version: "2.0" },
          buffers: [{ byteLength: 1.5 }],
        }),
        embeddedBin,
      ]),
      encodeGlb([
        jsonChunk({
          asset: { version: "2.0" },
          buffers: { byteLength: 4 },
        }),
        embeddedBin,
      ]),
      encodeGlb([
        jsonChunk({
          asset: { version: "2.0" },
          buffers: [],
        }),
        embeddedBin,
      ]),
      encodeGlb([
        jsonChunk({
          asset: { version: "2.0" },
          buffers: [4],
        }),
        embeddedBin,
      ]),
    ]
  ) {
    await expectCode(
      () => validator.validateOutput(glbDeclaration(), bytes),
      "invalid_glb",
    );
  }
  const overrun = new Uint8Array(20);
  const overrunView = new DataView(overrun.buffer);
  overrunView.setUint32(0, GLB_MAGIC, true);
  overrunView.setUint32(4, GLB_VERSION, true);
  overrunView.setUint32(8, overrun.byteLength, true);
  overrunView.setUint32(12, 16, true);
  overrunView.setUint32(16, GLB_JSON, true);
  await expectCode(
    () => validator.validateOutput(glbDeclaration(), overrun),
    "invalid_glb",
  );
});

function stepDeclaration() {
  return GEOMETRY_MODULE_ASSEMBLY_ASSETS.step;
}

function glbDeclaration() {
  return GEOMETRY_MODULE_ASSEMBLY_ASSETS.glb;
}

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const GLB_JSON = 0x4e4f534a;
const GLB_BIN = 0x004e4942;

function structuralGlb(): Uint8Array {
  return encodeGlb([
    jsonChunk({
      asset: { version: "2.0" },
      buffers: [{ byteLength: 4 }],
    }),
    binChunk(new Uint8Array(4)),
  ]);
}

function headerOnlyGlb(): Uint8Array {
  const bytes = new Uint8Array(12);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, GLB_VERSION, true);
  view.setUint32(8, 12, true);
  return bytes;
}

function jsonChunk(
  value: unknown,
): { readonly type: number; readonly data: Uint8Array } {
  return {
    type: GLB_JSON,
    data: alignChunk(new TextEncoder().encode(JSON.stringify(value)), 0x20),
  };
}

function binChunk(
  data: Uint8Array,
): { readonly type: number; readonly data: Uint8Array } {
  return { type: GLB_BIN, data: alignChunk(data, 0x00) };
}

function alignChunk(data: Uint8Array, fill: number): Uint8Array {
  const length = (data.byteLength + 3) & ~3;
  if (length === data.byteLength) return data;
  const aligned = new Uint8Array(length);
  aligned.set(data);
  aligned.fill(fill, data.byteLength);
  return aligned;
}

function encodeGlb(
  chunks: readonly { readonly type: number; readonly data: Uint8Array }[],
  options?: { readonly length?: number; readonly extra?: Uint8Array },
): Uint8Array {
  const payload = chunks.reduce(
    (total, chunk) => total + 8 + chunk.data.byteLength,
    0,
  );
  const extra = options?.extra?.byteLength ?? 0;
  const bytes = new Uint8Array(12 + payload + extra);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, GLB_VERSION, true);
  view.setUint32(8, options?.length ?? bytes.byteLength, true);
  let offset = 12;
  for (const chunk of chunks) {
    view.setUint32(offset, chunk.data.byteLength, true);
    view.setUint32(offset + 4, chunk.type, true);
    bytes.set(chunk.data, offset + 8);
    offset += 8 + chunk.data.byteLength;
  }
  if (options?.extra) bytes.set(options.extra, offset);
  return bytes;
}

function meaningfulGeometry() {
  return {
    success: true,
    root: { meshes: [0], children: [] },
    meshes: [{
      attributes: {
        position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
      },
      index: { array: [0, 1, 2] },
    }],
  };
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
