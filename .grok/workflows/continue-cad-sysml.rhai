let meta = #{
    name: "continue-cad-sysml",
    description: "Next CAD solids, SysML workbench seal, isolated-geometry promotion design",
    when_to_use: "When continuing the closed-subset CAD/SysML frontends in parallel",
    phases: [
        #{ title: "Fanout", detail: "CAD solids, SysML workbench, promotion design" },
        #{ title: "Verify", detail: "targeted tests and authority check" },
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

let design_schema = #{
    "type": "object",
    "required": ["ok", "summary", "operation", "must_not", "open_questions"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "operation": #{ "type": "string" },
        "must_not": #{ "type": "array", "items": #{ "type": "string" } },
        "open_questions": #{ "type": "array", "items": #{ "type": "string" } },
    },
};

let slice = "all";
if args != () && args.slice != () {
    slice = args.slice;
}
log("continue-cad-sysml slice=" + slice);

phase("Fanout");
let jobs = [];

if (slice == "all" || slice == "cad") {
    let cad = "Implement the next Build123d closed-subset solids in ";
    cad += "/Users/erwanpesle/Documents/GitHub/casys-digital-thread. ";
    cad += "Use read_file and grep before editing. ";
    cad += "Qualify Torus (2), Ellipsoid (3), Wedge (7) only in ";
    cad += "QUALIFIED_BUILD123D_CALLS and parsePositionalSolidCall. ";
    cad += "Keep analyzer version 1.1.0: identity scheme build123d-ast-identity/1.0, ";
    cad += "Box/Cylinder bundles stay bit-identical. ";
    cad += "Wedge must require exactly 7 positionals. ";
    cad += "Move the unresolved D4 sentinel from Torus to fillet. ";
    cad += "Do not change D4, isolated execute, export, SysML, or registry. ";
    cad += "Update docs/reference/agent/agent-workspace.md, docs/reference/pipeline/analysis-authority-pipeline.md, ";
    cad += "and docs/reference/runtime/workspace-map.md lists. deno fmt edited files. Return ok/summary/files.";
    jobs.push(#{
        prompt: cad,
        label: "cad-solids",
        capability_mode: "read-write",
        isolation_worktree: true,
        output_schema: status_schema,
    });
}

if (slice == "all" || slice == "sysml") {
    let sysml = "Implement Workbench presentation of a sealed architecture SysML ";
    sysml += "document in /Users/erwanpesle/Documents/GitHub/casys-digital-thread. ";
    sysml += "Use read_file and grep. Slice is presentation only. ";
    sysml += "Artifact stays kind document, id architecture-sysml-seal-<digest>. ";
    sysml += "Do not insert SysON, do not add write-architecture@2, do not expand ";
    sysml += "the closed subset, do not touch product-structure-catalog or ";
    sysml += "technical-compilation. Do not use surface documentary (brief r1 only). ";
    sysml += "Special-case the seal id in the Activity feed. Add PREFIX_TABLE entry. ";
    sysml += "Inspector must keep documentary visible. Add tests. ";
    sysml += "If src/ui/src changes, run npm --prefix src/ui run build:thread. ";
    sysml += "Add new non-test modules to deno.json check. deno fmt. Return ok/summary/files.";
    jobs.push(#{
        prompt: sysml,
        label: "sysml-workbench",
        capability_mode: "read-write",
        isolation_worktree: true,
        output_schema: status_schema,
    });
}

if (slice == "all" || slice == "promotion") {
    let promo = "Design lock only for isolated Build123d geometry promotion in ";
    promo += "/Users/erwanpesle/Documents/GitHub/casys-digital-thread. ";
    promo += "Read-only. Do not edit files. Read analysis-authority-pipeline.md, ";
    promo += "build123d-execution-evidence.ts, design-execute-build123d-run-executor.ts, ";
    promo += "design-write-geometry-run-executor.ts, registry.ts. ";
    promo += "Lock a NEW operation, new capture schema, Thread artifacts, byte store, ";
    promo += "no invented SysML bindings, coexistence with write-geometry, ";
    promo += "and Product/FEA unavailable labels. ";
    promo += "Must not reuse write-geometry@1 or treat isolation receipt as MRTR. ";
    promo += "Return ok/summary/operation/must_not/open_questions.";
    jobs.push(#{
        prompt: promo,
        label: "promotion-design",
        capability_mode: "read-only",
        output_schema: design_schema,
    });
}

if (jobs.len() == 0) {
    complete(#{ ok: false, summary: "Unknown slice. Use all, cad, sysml, or promotion." });
}

let results = parallel(jobs);
let failed = [];
let summaries = [];
let i = 0;
for r in results {
    let label = jobs[i].label;
    if (r == () || !r.success) {
        failed.push(label + " missing");
    } else if (r.output.ok == false) {
        failed.push(label + " rejected");
    } else if (r.output.summary != ()) {
        summaries.push(label + ": " + r.output.summary);
    }
    i += 1;
}
if (failed.len() != 0) {
    complete(#{
        ok: false,
        summary: "Fanout failed: " + failed[0],
    });
}

let summary_text = "Slices completed.";
if (summaries.len() != 0) {
    summary_text = summaries[0];
}

phase("Verify");
let vjobs = [];
if (slice == "all" || slice == "cad") {
    let cad_v = "In /Users/erwanpesle/Documents/GitHub/casys-digital-thread run only ";
    cad_v += "deno test --allow-read --allow-write --allow-net=127.0.0.1,localhost --allow-env ";
    cad_v += "src/adapters/analyzers/qualified-build123d-source-analyzer_test.ts. ";
    cad_v += "Confirm Torus/Ellipsoid/Wedge qualify and fillet stays unresolved. ";
    cad_v += "Do not edit unless a test you own is red for a real bug. ";
    cad_v += "Return ok true only if green.";
    vjobs.push(#{
        prompt: cad_v,
        label: "verify-cad",
        capability_mode: "execute",
        output_schema: status_schema,
    });
}
if (slice == "all" || slice == "sysml") {
    let sys_v = "In /Users/erwanpesle/Documents/GitHub/casys-digital-thread review ";
    sys_v += "the SysML workbench slice authority: artifact remains document, ";
    sys_v += "no SysON, no write-architecture@2, no compilation admission, ";
    sys_v += "no product-structure-catalog change. Run any new or touched Deno tests ";
    sys_v += "with explicit permissions. Return ok true only if tests are green ";
    sys_v += "and those authorities hold.";
    vjobs.push(#{
        prompt: sys_v,
        label: "verify-sysml",
        capability_mode: "execute",
        output_schema: status_schema,
    });
}

if (vjobs.len() == 0) {
    complete(#{
        ok: true,
        summary: summary_text,
    });
}

let checks = parallel(vjobs);
let j = 0;
for c in checks {
    if (c == () || !c.success || c.output.ok == false) {
        complete(#{ ok: false, summary: "Verify failed: " + vjobs[j].label });
    }
    j += 1;
}

complete(#{
    ok: true,
    summary: summary_text,
});
