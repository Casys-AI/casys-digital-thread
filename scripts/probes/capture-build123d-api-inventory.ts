/**
 * Regenerate the pinned build123d public-API inventory from the running
 * sandbox container.
 *
 * The inventory (`config/build123d-api/inventory-<version>.json`) is the
 * introspected ground truth. No analyzer imports it yet. F1 must generate
 * qualification tables from this file (plus type methods). Until then the
 * frontend hand table in qualified-build123d-source-analyzer.ts remains
 * documentary coverage, not a derived table. See
 * docs/explanations/product/closed-language-compilation.md.
 *
 * Read-only probe: it runs `python3 inspect` inside the already-running
 * compose sandbox and rewrites the JSON artifact. It never touches the
 * provider state, the thread, or any qualification table.
 *
 *   deno run --allow-run=docker --allow-write=config/build123d-api \
 *     scripts/probes/capture-build123d-api-inventory.ts \
 *     [--container casys-digital-thread-mcp-build123d-sandbox-1]
 */

import { parseArgs } from "../lib/cli.ts";

const args = parseArgs(Deno.args);
const container = args["container"] ??
  "casys-digital-thread-mcp-build123d-sandbox-1";

const introspection = `
import build123d, inspect, json
names=[n for n in dir(build123d) if not n.startswith("_")]
out={"version":build123d.__version__,"names":{}}
for n in names:
    o=getattr(build123d,n)
    if inspect.isclass(o) and hasattr(o,"__members__"):
        out["names"][n]={"kind":"enum","members":list(o.__members__)}
    elif inspect.isclass(o):
        try: sig=str(inspect.signature(o))
        except Exception: sig=None
        out["names"][n]={"kind":"class","sig":sig}
    elif callable(o):
        try: sig=str(inspect.signature(o))
        except Exception: sig=None
        out["names"][n]={"kind":"function","sig":sig}
    else:
        out["names"][n]={"kind":"value","type":type(o).__name__}
print(json.dumps(out))
`;

const command = new Deno.Command("docker", {
  args: ["exec", container, "python3", "-c", introspection],
  stdout: "piped",
  stderr: "piped",
});
const result = await command.output();
if (!result.success) {
  const stderr = new TextDecoder().decode(result.stderr);
  console.error(`docker exec failed (container "${container}"): ${stderr}`);
  Deno.exit(1);
}

const raw = JSON.parse(new TextDecoder().decode(result.stdout)) as {
  version: string;
  names: Record<string, Record<string, unknown>>;
};

const kinds = { class: 0, function: 0, enum: 0, value: 0 } as Record<
  string,
  number
>;
for (const entry of Object.values(raw.names)) {
  kinds[entry.kind as string] = (kinds[entry.kind as string] ?? 0) + 1;
}

const sortedNames: Record<string, Record<string, unknown>> = {};
for (const name of Object.keys(raw.names).sort()) {
  sortedNames[name] = raw.names[name]!;
}

const inventory = {
  schemaVersion: "build123d-api-inventory/1.0",
  authority: "documentary-ground-truth",
  consumedByCompiler: false,
  note:
    "No analyzer imports this file. F1 generates QUALIFIED_* tables from it. Do not hand-edit the 1.6.0 Map from these names.",
  library: "build123d",
  version: raw.version,
  extractedFrom:
    "mcp-build123d-sandbox container (pinned compose image), python3 inspect introspection",
  counts: {
    total: Object.keys(raw.names).length,
    classes: kinds.class,
    functions: kinds.function,
    enums: kinds.enum,
    values: kinds.value,
  },
  names: sortedNames,
};

const outputPath = `config/build123d-api/inventory-${raw.version}.json`;
await Deno.writeTextFile(outputPath, JSON.stringify(inventory, null, 2) + "\n");
console.log(
  `${outputPath}: ${inventory.counts.total} public names ` +
    `(${inventory.counts.classes} classes, ${inventory.counts.functions} functions, ` +
    `${inventory.counts.enums} enums, ${inventory.counts.values} values)`,
);
