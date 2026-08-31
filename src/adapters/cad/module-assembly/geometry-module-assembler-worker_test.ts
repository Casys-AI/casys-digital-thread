import { assertEquals } from "@std/assert";
import { createGeometryModuleInputBundle } from "../../../domain/cad/module-assembly/geometry-module-input-bundle.ts";
import { GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_WORKER_CONTRACT } from "./worker-contract.ts";

const STEP = new TextEncoder().encode(
  "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n/* worker */\nENDSEC;\nEND-ISO-10303-21;\n",
);

const WRAPPER_CAD_STUBS = [
  "import importlib.util, json, os, sys, types",
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
].join("\n");

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
          WRAPPER_CAD_STUBS,
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

Deno.test("module-assembler wrapper labels placed children by usage after Location", async () => {
  const python = await findPython();
  if (python === undefined) return;
  const output = await runWrapperPython(python, [
    "class DiscardingLocation:",
    "    def __mul__(self, imported):",
    "        return types.SimpleNamespace(source=getattr(imported, 'name', None))",
    "def place(imported, occurrence):",
    "    return module.label_placed_occurrence(DiscardingLocation() * imported, occurrence)",
    "first = place(types.SimpleNamespace(name='child-b'), {'usageElementId': 'usage-b'})",
    "second = place(types.SimpleNamespace(name='child-a'), {'usageElementId': 'usage-a'})",
    "by_label = {shape.label: getattr(shape, 'source', None) for shape in (second, first)}",
    "def rejected(shape, occurrence):",
    "    try:",
    "        module.label_placed_occurrence(shape, occurrence)",
    "        return False",
    "    except SystemExit as error:",
    "        return str(error).startswith('casys-module-assembler:')",
    "class Refusing:",
    "    def __setattr__(self, name, value):",
    "        raise TypeError('refused')",
    "class Liar:",
    "    def __init__(self):",
    "        self._written = None",
    "    @property",
    "    def label(self):",
    "        return 'not-the-usage'",
    "    @label.setter",
    "    def label(self, value):",
    "        self._written = value",
    "print(json.dumps({",
    "    'byLabel': by_label,",
    "    'labels': sorted(by_label),",
    "    'emptyRejected': rejected(types.SimpleNamespace(), {'usageElementId': ''}),",
    "    'missingRejected': rejected(types.SimpleNamespace(), {}),",
    "    'refusedRejected': rejected(Refusing(), {'usageElementId': 'usage-a'}),",
    "    'readbackRejected': rejected(Liar(), {'usageElementId': 'usage-a'}),",
    "}))",
  ]);
  assertEquals(output.success, true, output.stderr);
  assertEquals(JSON.parse(output.stdout), {
    byLabel: { "usage-a": "child-a", "usage-b": "child-b" },
    labels: ["usage-a", "usage-b"],
    emptyRejected: true,
    missingRejected: true,
    refusedRejected: true,
    readbackRejected: true,
  });
});

Deno.test("module-assembler wrapper rewrites only the unique OCC FILE_NAME timestamp", async () => {
  const python = await findPython();
  if (python === undefined) return;
  const directory = await Deno.makeTempDir({
    prefix: "casys-module-step-timestamp-",
  });
  try {
    const output = await runWrapperPython(
      python,
      [
        "os.environ['SOURCE_DATE_EPOCH'] = '1710000000'",
        "path = Path(sys.argv[1])",
        "before = path.read_bytes()",
        "assert module.CANONICAL_FILE_NAME_TIMESTAMP == b'1970-01-01T00:00:00'",
        "module.normalize_assembly_step_file_name_timestamp(path)",
        "after = path.read_bytes()",
        "print(json.dumps({",
        "    'byteCount': len(after),",
        "    'unchangedCount': len(after) == len(before),",
        '    \'timestamp\': after[after.index(b"FILE_NAME"):].split(b"\'")[3].decode(),',
        "    'geometry': after.split(b'DATA;', 1)[1] == before.split(b'DATA;', 1)[1],",
        "    'unique': after.count(b'1970-01-01T00:00:00') == 1,",
        "    'clockGone': b'2026-07-30T05:46:01' not in after,",
        "}))",
      ],
      [`${directory}/assembly.step`],
      {
        files: { [`${directory}/assembly.step`]: VALID_OCC_STEP },
      },
    );
    assertEquals(output.success, true, output.stderr);
    const decoded = JSON.parse(output.stdout);
    assertEquals(decoded, {
      byteCount: VALID_OCC_STEP.length,
      unchangedCount: true,
      timestamp: "1970-01-01T00:00:00",
      geometry: true,
      unique: true,
      clockGone: true,
    });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("module-assembler wrapper rejects missing duplicate malformed and ambiguous FILE_NAME headers", async () => {
  const python = await findPython();
  if (python === undefined) return;
  const directory = await Deno.makeTempDir({
    prefix: "casys-module-step-reject-",
  });
  try {
    const output = await runWrapperPython(
      python,
      [
        "cases = json.loads(Path(sys.argv[1]).read_text())",
        "results = []",
        "for item in cases:",
        "    path = Path(sys.argv[2]) / item['name']",
        "    raw = bytes(item['bytes'])",
        "    path.write_bytes(raw)",
        "    try:",
        "        module.normalize_assembly_step_file_name_timestamp(path)",
        "        results.append({'name': item['name'], 'rejected': False, 'unchanged': path.read_bytes() == raw})",
        "    except SystemExit as error:",
        "        text = str(error)",
        "        results.append({",
        "            'name': item['name'],",
        "            'rejected': True,",
        "            'unchanged': path.read_bytes() == raw,",
        "            'prefix': text.startswith('casys-module-assembler:'),",
        "            'message': text.split(':', 1)[1],",
        "        })",
        "print(json.dumps(results))",
      ],
      [`${directory}/cases.json`, directory],
      {
        files: {
          [`${directory}/cases.json`]: JSON.stringify([
            {
              name: "missing-token",
              bytes: [...stepHeader(
                "FILE_DESCRIPTION(('Open CASCADE Model'),'2;1');\n",
              )],
            },
            {
              name: "duplicate-token",
              bytes: [...stepHeader(
                "FILE_NAME('Open CASCADE Shape Model','2026-07-30T05:46:01',('Author'),('Open CASCADE'),'Open CASCADE STEP processor 7.9','build123d','Unknown');\nFILE_NAME('Open CASCADE Shape Model','2026-07-31T05:46:01',('Author'),('Open CASCADE'),'Open CASCADE STEP processor 7.9','build123d','Unknown');\n",
              )],
            },
            {
              name: "malformed-millis",
              bytes: [...stepHeader(
                "FILE_NAME('Open CASCADE Shape Model','2026-07-30T05:46:01.000',('Author'),('Open CASCADE'),'Open CASCADE STEP processor 7.9','build123d','Unknown');\n",
              )],
            },
            {
              name: "malformed-zone",
              bytes: [...stepHeader(
                "FILE_NAME('Open CASCADE Shape Model','2026-07-30T05:46:01Z',('Author'),('Open CASCADE'),'Open CASCADE STEP processor 7.9','build123d','Unknown');\n",
              )],
            },
            {
              name: "not-occ-name",
              bytes: [...stepHeader(
                "FILE_NAME('Other Shape Model','2026-07-30T05:46:01',('Author'),('Open CASCADE'),'Open CASCADE STEP processor 7.9','build123d','Unknown');\n",
              )],
            },
            {
              name: "ambiguous-extra-iso",
              bytes: [...stepHeader(
                "FILE_NAME('Open CASCADE Shape Model','2026-07-30T05:46:01',('2026-07-30T05:46:01'),('Open CASCADE'),'Open CASCADE STEP processor 7.9','build123d','Unknown');\n",
              )],
            },
          ]),
        },
      },
    );
    assertEquals(output.success, true, output.stderr);
    const decoded = JSON.parse(output.stdout);
    assertEquals(decoded.map((item: { name: string }) => item.name), [
      "missing-token",
      "duplicate-token",
      "malformed-millis",
      "malformed-zone",
      "not-occ-name",
      "ambiguous-extra-iso",
    ]);
    for (const item of decoded) {
      assertEquals(item.rejected, true, item.name);
      assertEquals(item.unchanged, true, item.name);
      assertEquals(item.prefix, true, item.name);
    }
    assertEquals(
      decoded[0].message,
      "The assembly STEP header FILE_NAME token is missing.",
    );
    assertEquals(
      decoded[1].message,
      "The assembly STEP header FILE_NAME token is duplicated.",
    );
    assertEquals(
      decoded[2].message,
      "The assembly STEP header FILE_NAME timestamp field is missing or malformed.",
    );
    assertEquals(
      decoded[3].message,
      "The assembly STEP header FILE_NAME timestamp field is missing or malformed.",
    );
    assertEquals(
      decoded[4].message,
      "The assembly STEP header FILE_NAME timestamp field is missing or malformed.",
    );
    assertEquals(
      decoded[5].message,
      "The assembly STEP header FILE_NAME timestamp is ambiguous.",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

const FONTCONFIG_SOURCE = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <dir>/opt/casys/fonts</dir>
</fontconfig>
`;

Deno.test("module-assembler image pins a closed Fontconfig default at the compiled path", async () => {
  const sourcePath = "images/build123d-module-assembler-worker/fonts.conf";
  const dockerfilePath = "images/build123d-module-assembler-worker/Dockerfile";
  const dockerignorePath =
    "images/build123d-module-assembler-worker/Dockerfile.dockerignore";
  const source = await Deno.readTextFile(sourcePath);
  const dockerfile = await Deno.readTextFile(dockerfilePath);
  const dockerignore = await Deno.readTextFile(dockerignorePath);
  assertEquals(source, FONTCONFIG_SOURCE);
  assertEquals(source.match(/<dir>/g)?.length, 1);
  assertEquals(source.includes("<dir>/opt/casys/fonts</dir>"), true);
  assertEquals(/<include\b/.test(source), false);
  assertEquals(
    /\/usr\/share\/fonts|\/usr\/local\/share\/fonts|\/usr\/X11|~\//.test(source),
    false,
  );
  assertEquals(
    dockerfile.match(/ARG FONTCONFIG_SHA256=([a-f0-9]{64})/)?.[1],
    await sha256File(sourcePath),
  );
  const fontDirInstall = dockerfile.indexOf(
    "install -d -o root -g root -m 0555 /etc/fonts /opt/casys/fonts",
  );
  const fontFileCopy = dockerfile.search(
    /COPY --chmod=0444 \\\n[ ]{2}images\/build123d-module-assembler-worker\/fonts\.conf \\\n[ ]{2}\/etc\/fonts\/fonts\.conf/,
  );
  assertEquals(fontDirInstall >= 0, true);
  assertEquals(fontFileCopy > fontDirInstall, true);
  assertEquals(
    dockerignore.includes("!images/build123d-module-assembler-worker/fonts.conf"),
    true,
  );
  assertEquals(/FONTCONFIG_FILE|FONTCONFIG_PATH/.test(dockerfile), false);
  assertEquals(/fonts-dejavu|fontconfig-config|ttf-|otf-/.test(dockerfile), false);
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

const VALID_OCC_STEP = stepHeader(
  "FILE_DESCRIPTION(('Open CASCADE Model'),'2;1');\nFILE_NAME('Open CASCADE Shape Model','2026-07-30T05:46:01',('Author'),(\n    'Open CASCADE'),'Open CASCADE STEP processor 7.9','build123d',\n  'Unknown');\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));\n",
);

function stepHeader(header: string): Uint8Array {
  return new TextEncoder().encode(
    `ISO-10303-21;\nHEADER;\n${header}ENDSEC;\nDATA;\n#1 = CARTESIAN_POINT('',(1.,2.,3.));\nENDSEC;\nEND-ISO-10303-21;\n`,
  );
}

async function runWrapperPython(
  python: string,
  script: string[],
  args: string[] = [],
  options: { files?: Record<string, string | Uint8Array> } = {},
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  for (const [path, contents] of Object.entries(options.files ?? {})) {
    if (typeof contents === "string") {
      await Deno.writeTextFile(path, contents);
    } else {
      await Deno.writeFile(path, contents);
    }
  }
  const env = { ...Deno.env.toObject() };
  delete env.PYTHONPATH;
  const output = await new Deno.Command(python, {
    args: ["-I", "-B", "-c", [WRAPPER_CAD_STUBS, ...script].join("\n"), ...args],
    cwd: Deno.cwd(),
    env,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    success: output.success,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

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
