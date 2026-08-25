import { assertEquals } from "@std/assert";
import { createGeometryModuleInputBundle } from "../../../domain/cad/module-assembly/geometry-module-input-bundle.ts";
import { GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_WORKER_CONTRACT } from "./worker-contract.ts";

const STEP = new TextEncoder().encode(
  "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n/* worker */\nENDSEC;\nEND-ISO-10303-21;\n",
);

Deno.test("module-assembler worker contract keeps the untrusted Build123d source path unused", () => {
  const worker = GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_WORKER_CONTRACT;
  assertEquals(worker.sourcePath, "/input/geometry-module.bundle");
  assertEquals(worker.args.includes("/input/source.py"), false);
  assertEquals(worker.childDirectory, "/work/children");
  assertEquals(worker.childStepBasename(0), "000.step");
  assertEquals(worker.childStepBasename(12), "012.step");
  assertEquals(worker.expectedImageUser, "65532:65532");
});

Deno.test("module-assembler wrapper reaches the sibling decoder under isolated Python", async () => {
  const python = await findPython();
  if (python === undefined) return;
  const bundle = await createGeometryModuleInputBundle([{
    usageElementId: "usage-b",
    partDefinitionElementId: "def-shared",
    placement: { translationMm: [1e-7, 0, 0], rotationDeg: [0, 0, 90] },
    childCapture: {
      schemaVersion: "geometry-part-capture/1.0",
      artifactId: "geometry-part-usage-b",
      fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
    },
    stepBytes: STEP,
  }, {
    usageElementId: "usage-a",
    partDefinitionElementId: "def-shared",
    placement: { translationMm: [0, 0, 0], rotationDeg: [0, 0, 0] },
    childCapture: {
      schemaVersion: "geometry-part-capture/1.0",
      artifactId: "geometry-part-usage-a",
      fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
    },
    stepBytes: STEP,
  }]);
  const directory = await Deno.makeTempDir({
    prefix: "casys-module-bundle-python-",
  });
  try {
    const bundlePath = `${directory}/bundle.bin`;
    await Deno.writeFile(bundlePath, bundle.bytes.copy());
    const env = { ...Deno.env.toObject() };
    delete env.PYTHONPATH;
    const command = new Deno.Command(python, {
      args: [
        "-I",
        "-B",
        "-c",
        [
          "import importlib.util, json, sys, types",
          "from pathlib import Path",
          "build123d = types.ModuleType('build123d')",
          "for name in ('Compound', 'Location', 'export_gltf', 'export_step', 'import_step'):",
          "    setattr(build123d, name, object)",
          "sys.modules['build123d'] = build123d",
          "ocp = types.ModuleType('OCP')",
          "gp = types.ModuleType('OCP.gp')",
          "for name in ('gp_Ax1', 'gp_Dir', 'gp_Pnt', 'gp_Trsf', 'gp_Vec'):",
          "    setattr(gp, name, object)",
          "ocp.gp = gp",
          "sys.modules['OCP'] = ocp",
          "sys.modules['OCP.gp'] = gp",
          "wrapper = Path('images/build123d-module-assembler-worker/run-module-assembler.py').resolve()",
          "spec = importlib.util.spec_from_file_location('run_module_assembler', wrapper)",
          "assert spec is not None and spec.loader is not None",
          "module = importlib.util.module_from_spec(spec)",
          "spec.loader.exec_module(module)",
          "decoder = Path(module.parse_bundle.__code__.co_filename).resolve()",
          "assert decoder == wrapper.with_name('geometry_module_bundle.py'), decoder",
          "bundle = module.parse_bundle(open(sys.argv[1], 'rb').read())",
          "print(json.dumps({'sha256': bundle['sha256'], 'usages': [item['usageElementId'] for item in bundle['occurrences']]}))",
        ].join("\n"),
        bundlePath,
      ],
      cwd: Deno.cwd(),
      env,
      stdout: "piped",
      stderr: "piped",
    });
    const output = await command.output();
    assertEquals(output.success, true, new TextDecoder().decode(output.stderr));
    const decoded = JSON.parse(new TextDecoder().decode(output.stdout));
    assertEquals(decoded.sha256, bundle.fingerprint.digest);
    assertEquals(decoded.usages, ["usage-a", "usage-b"]);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("module-assembler Dockerfile pins the exact worker and decoder bytes", async () => {
  const dockerfile = await Deno.readTextFile(
    "images/build123d-module-assembler-worker/Dockerfile",
  );
  const wrapper = dockerfile.match(/ARG WRAPPER_SHA256=([a-f0-9]{64})/)?.[1];
  const decoder = dockerfile.match(/ARG BUNDLE_DECODER_SHA256=([a-f0-9]{64})/)?.[1];
  assertEquals(
    wrapper,
    await sha256File(
      "images/build123d-module-assembler-worker/run-module-assembler.py",
    ),
  );
  assertEquals(
    decoder,
    await sha256File(
      "images/build123d-module-assembler-worker/geometry_module_bundle.py",
    ),
  );
});

async function findPython(): Promise<string | undefined> {
  for (const candidate of ["python3", "python"]) {
    try {
      const output = await new Deno.Command(candidate, {
        args: ["-c", "import sys; print(sys.version_info[0])"],
        stdout: "piped",
        stderr: "null",
      }).output();
      if (output.success && new TextDecoder().decode(output.stdout).trim() === "3") {
        return candidate;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

async function sha256File(path: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await Deno.readFile(path));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
