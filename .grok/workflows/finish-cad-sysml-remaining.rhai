let meta = #{
    name: "finish-cad-sysml-remaining",
    description: "Parallel fillet form, SysML source spans, isolated geometry seal",
    when_to_use: "When finishing the remaining CAD/SysML frontend slices together",
    phases: [
        #{ title: "Implement", detail: "three isolated worktrees" },
        #{ title: "Verify", detail: "tests and authority skeptics" },
    ],
};

let status_schema = #{
    "type": "object",
    "required": ["ok", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "files": #{ "type": "array", "items": #{ "type": "string" } },
        "worktree_path": #{ "type": "string" },
    },
};

let verdict_schema = #{
    "type": "object",
    "required": ["ok", "real", "reason"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "real": #{ "type": "boolean" },
        "reason": #{ "type": "string" },
    },
};

phase("Implement");
let cad = "Implement ONE reviewed fillet form in ";
cad += "/Users/erwanpesle/Documents/GitHub/casys-digital-thread. ";
cad += "Use read_file/grep. Form: fillet(<qualified-solid>.edges(), radius=<scalar>). ";
cad += "Empty .edges() only. Keyword radius only. Keep analyzer 1.1.0 if Box-only ";
cad += "bundles stay bit-identical. Do not open general MemberExpression. ";
cad += "Do not qualify chamfer, fillet(solid, r), filters, or solid.fillet. ";
cad += "Do not change D4, execute, SysML, or registry. Tests + deno fmt. ";
cad += "Return ok/summary/files.";

let sysml = "Implement documentary source spans for sealed architecture SysML in ";
sysml += "/Users/erwanpesle/Documents/GitHub/casys-digital-thread. ";
sysml += "Use read_file/grep. Add sourceStatus, sourceText when reopen works, ";
sysml += "span on symbols/incidences/unresolved, message on unresolved from ";
sysml += "reopened analysis only. Artifact stays document. No SysON, no @2, ";
sysml += "no Product parts, no analysis-graph write, no subset expansion. ";
sysml += "Update types.ts validators. Tests. If UI src changes, build:thread. ";
sysml += "deno fmt. Return ok/summary/files.";

let seal = "Implement design.seal-isolated-geometry@1 in ";
seal += "/Users/erwanpesle/Documents/GitHub/casys-digital-thread. ";
seal += "LOCKED: Thread document only. Schema isolated-geometry-seal-capture/1.0. ";
seal += "URI casys://isolated-geometry-seal-capture/sha256/<digest>. ";
seal += "Bytes stay behind IsolatedOutputPublicationReader. ";
seal += "Do not copy to thread-assets. Do not publish kind step or cad-model. ";
seal += "Do not reuse write-geometry. Do not treat isolation receipt as MRTR. ";
seal += "Review tool project_isolated_geometry_seal_review. Binding executionCapture. ";
seal += "sysmlBindings unresolved explicit. Product/FEA stay unavailable. ";
seal += "Add modules to deno.json check. Tests + docs lookalikes + deno fmt. ";
seal += "Return ok/summary/files.";

let implemented = parallel([
    #{
        prompt: cad,
        label: "fillet",
        capability_mode: "read-write",
        isolation_worktree: true,
        output_schema: status_schema,
    },
    #{
        prompt: sysml,
        label: "sysml-spans",
        capability_mode: "read-write",
        isolation_worktree: true,
        output_schema: status_schema,
    },
    #{
        prompt: seal,
        label: "isolated-seal",
        capability_mode: "read-write",
        isolation_worktree: true,
        output_schema: status_schema,
    },
]);

let failed = [];
let i = 0;
let labels = ["fillet", "sysml-spans", "isolated-seal"];
for r in implemented {
    if (r == () || !r.success || r.output.ok == false) {
        failed.push(labels[i]);
    }
    i += 1;
}

phase("Verify");
let v1 = "Run deno test --allow-read --allow-write --allow-net=127.0.0.1,localhost --allow-env ";
v1 += "src/adapters/analyzers/qualified-build123d-source-analyzer_test.ts ";
v1 += "in /Users/erwanpesle/Documents/GitHub/casys-digital-thread. ";
v1 += "ok true only if green. Do not edit unless a test you own is red.";

let v2 = "Run Deno tests for architecture-sysml-seal enricher and UI models ";
v2 += "in /Users/erwanpesle/Documents/GitHub/casys-digital-thread with explicit perms. ";
v2 += "ok true only if green and artifact remains document.";

let v3 = "Review isolated geometry seal authority in ";
v3 += "/Users/erwanpesle/Documents/GitHub/casys-digital-thread. ";
v3 += "Run new seal tests if present. ok true only if document-only and ";
v3 += "no thread-assets copy.";

let s1 = "Adversarial CAD: real=true only if fillet opened general MemberExpression ";
s1 += "or chamfer was qualified. Read the analyzer. Do not edit.";
let s2 = "Adversarial SysML: real=true only if seal became sysml-model, Product, ";
s2 += "or analysis-graph write. Read enricher. Do not edit.";
let s3 = "Adversarial geometry seal: real=true only if kind step/cad-model or ";
s3 += "thread-assets copy exists. Read new executor if any. Do not edit.";

let checked = parallel([
    #{ prompt: v1, label: "verify-fillet", capability_mode: "execute", output_schema: status_schema },
    #{ prompt: v2, label: "verify-spans", capability_mode: "execute", output_schema: status_schema },
    #{ prompt: v3, label: "verify-seal", capability_mode: "execute", output_schema: status_schema },
    #{ prompt: s1, label: "skeptic-cad", capability_mode: "read-only", output_schema: verdict_schema },
    #{ prompt: s2, label: "skeptic-sysml", capability_mode: "read-only", output_schema: verdict_schema },
    #{ prompt: s3, label: "skeptic-seal", capability_mode: "read-only", output_schema: verdict_schema },
]);

if (failed.len() != 0) {
    complete(#{ ok: false, summary: "Implement failed." });
}
if (checked[0] == () || !checked[0].success || checked[0].output.ok == false) {
    complete(#{ ok: false, summary: "Fillet tests failed." });
}
if (checked[1] == () || !checked[1].success || checked[1].output.ok == false) {
    complete(#{ ok: false, summary: "SysML tests failed." });
}
if (checked[2] == () || !checked[2].success || checked[2].output.ok == false) {
    complete(#{ ok: false, summary: "Seal tests failed." });
}
if (checked[3] != () && checked[3].success && checked[3].output.real == true) {
    complete(#{ ok: false, summary: "CAD authority break." });
}
if (checked[4] != () && checked[4].success && checked[4].output.real == true) {
    complete(#{ ok: false, summary: "SysML authority break." });
}
if (checked[5] != () && checked[5].success && checked[5].output.real == true) {
    complete(#{ ok: false, summary: "Seal authority break." });
}
complete(#{ ok: true, summary: "Remaining CAD/SysML slices implemented." });
