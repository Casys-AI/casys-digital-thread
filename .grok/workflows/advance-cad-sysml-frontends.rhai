let meta = #{
    name: "advance-cad-sysml-frontends",
    description: "Design then implement the next CAD AST slice and SysML documentary frontend",
    when_to_use: "When advancing closed-subset CAD/SysML frontends after solids and seal incidences",
    phases: [
        #{ title: "Design", detail: "CAD next AST and SysML next documentary slice" },
        #{ title: "Implement", detail: "worktree agents for locked slices" },
        #{ title: "Verify", detail: "tests plus authority skeptics" },
    ],
};

let design_schema = #{
    "type": "object",
    "required": ["ok", "summary", "slice", "must_not"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "slice": #{ "type": "string" },
        "implementable": #{ "type": "boolean" },
        "must_not": #{ "type": "array", "items": #{ "type": "string" } },
    },
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

phase("Design");
let cad_d_p = "Read-only in /Users/erwanpesle/Documents/GitHub/casys-digital-thread. ";
cad_d_p += "Use read_file and grep. Read qualified-build123d-source-analyzer.ts ";
cad_d_p += "and geometry-script-validation.ts ALLOWED_BUILD123D_NAMES. ";
cad_d_p += "Solids + Pos/Rot + Compound + solid +/− solid are already 1.1.0. ";
cad_d_p += "Decide the NEXT CAD frontend slice. Prefer one closed AST form. ";
cad_d_p += "fillet/chamfer need MemberExpression+kwargs — say implementable false ";
cad_d_p += "unless you find a positional-only reviewed form. ";
cad_d_p += "Do not edit files. Return ok, summary, slice, implementable, must_not.";

let sys_d_p = "Read-only in /Users/erwanpesle/Documents/GitHub/casys-digital-thread. ";
sys_d_p += "Use read_file and grep. Agent-authored SysML v1 and workbench ";
sys_d_p += "symbols/unresolved/incidences already exist. ";
sys_d_p += "Decide the NEXT documentary frontend slice. ";
sys_d_p += "Must not expand subset, insert SysON, write-architecture@2, ";
sys_d_p += "compile.seal-admission, or Product part nodes. ";
sys_d_p += "Do not edit files. Return ok, summary, slice, implementable, must_not.";

let designed = parallel([
    #{
        prompt: cad_d_p,
        label: "design-cad",
        capability_mode: "read-only",
        output_schema: design_schema,
    },
    #{
        prompt: sys_d_p,
        label: "design-sysml",
        capability_mode: "read-only",
        output_schema: design_schema,
    },
]);

let cad_design = designed[0];
let sys_design = designed[1];
if (cad_design == () || !cad_design.success || cad_design.output.ok == false) {
    complete(#{ ok: false, summary: "CAD design failed." });
}
if (sys_design == () || !sys_design.success || sys_design.output.ok == false) {
    complete(#{ ok: false, summary: "SysML design failed." });
}

phase("Implement");
let cad_notes = "";
if (cad_design.output.summary != ()) {
    cad_notes = json_encode(cad_design.output);
}
let sys_notes = "";
if (sys_design.output.summary != ()) {
    sys_notes = json_encode(sys_design.output);
}

let cad_i = "Implement the next CAD closed-subset frontend slice in ";
cad_i += "/Users/erwanpesle/Documents/GitHub/casys-digital-thread. ";
cad_i += "Use read_file and grep first. Keep analyzer version 1.1.0 ";
cad_i += "unless identity must change. Design notes: ";
cad_i += cad_notes;
cad_i += " If fillet/chamfer/extrude need MemberExpression or kwargs, ";
cad_i += "do NOT qualify them. Instead add or keep a fail-closed test that ";
cad_i += "fillet stays unresolved, and document the next AST lock. ";
cad_i += "If a positional-only form is already the same scheme as Box/+/-, implement it. ";
cad_i += "Do not change D4, execute, SysML, or registry. deno fmt. Return ok/summary/files.";

let sys_i = "Implement the next documentary SysML frontend slice in ";
sys_i += "/Users/erwanpesle/Documents/GitHub/casys-digital-thread. ";
sys_i += "Use read_file and grep first. Design notes: ";
sys_i += sys_notes;
sys_i += " Artifact stays kind document. Bindings are symbol ids. ";
sys_i += "Do not insert SysON, expand the closed subset, touch ";
sys_i += "product-structure-catalog or technical-compilation. ";
sys_i += "Do not use surface documentary (brief r1). ";
sys_i += "If the design is not implementable without those, return ok false. ";
sys_i += "Tests + deno fmt. If src/ui/src changes, npm --prefix src/ui run build:thread. ";
sys_i += "New non-test modules go in deno.json check. Return ok/summary/files.";

let implemented = parallel([
    #{
        prompt: cad_i,
        label: "implement-cad",
        capability_mode: "read-write",
        isolation_worktree: true,
        output_schema: status_schema,
    },
    #{
        prompt: sys_i,
        label: "implement-sysml",
        capability_mode: "read-write",
        isolation_worktree: true,
        output_schema: status_schema,
    },
]);

let cad_impl = implemented[0];
let sys_impl = implemented[1];
let impl_failed = [];
if (cad_impl == () || !cad_impl.success || cad_impl.output.ok == false) {
    impl_failed.push("cad");
}
if (sys_impl == () || !sys_impl.success || sys_impl.output.ok == false) {
    impl_failed.push("sysml");
}

phase("Verify");
let cad_v = "In /Users/erwanpesle/Documents/GitHub/casys-digital-thread run ";
cad_v += "deno test --allow-read --allow-write --allow-net=127.0.0.1,localhost --allow-env ";
cad_v += "src/adapters/analyzers/qualified-build123d-source-analyzer_test.ts. ";
cad_v += "Confirm solids +/− still pass and fillet or other D4 extras stay unresolved. ";
cad_v += "Return ok true only if green. Do not edit unless a test you own is red.";

let sys_v = "In /Users/erwanpesle/Documents/GitHub/casys-digital-thread review ";
sys_v += "SysML frontend authority: document only, no SysON, no @2, no Product parts. ";
sys_v += "Run touched Deno tests with explicit permissions. ";
sys_v += "Return ok true only if tests are green and authorities hold.";

let cad_s = "Adversarially check CAD authority in ";
cad_s += "/Users/erwanpesle/Documents/GitHub/casys-digital-thread. ";
cad_s += "Read the analyzer. Set real=true only if a D4-unqualified call is now ";
cad_s += "silently qualified or analyzer version bumped without identity change. ";
cad_s += "Otherwise real=false. Use read_file. Do not edit.";

let sys_s = "Adversarially check SysML authority in ";
sys_s += "/Users/erwanpesle/Documents/GitHub/casys-digital-thread. ";
sys_s += "Set real=true only if the seal became sysml-model, Product parts, ";
sys_s += "SysON insert, or compile.seal-admission. Else real=false. ";
sys_s += "Use read_file. Do not edit.";

let checked = parallel([
    #{
        prompt: cad_v,
        label: "verify-cad",
        capability_mode: "execute",
        output_schema: status_schema,
    },
    #{
        prompt: sys_v,
        label: "verify-sysml",
        capability_mode: "execute",
        output_schema: status_schema,
    },
    #{
        prompt: cad_s,
        label: "skeptic-cad",
        capability_mode: "read-only",
        output_schema: verdict_schema,
    },
    #{
        prompt: sys_s,
        label: "skeptic-sysml",
        capability_mode: "read-only",
        output_schema: verdict_schema,
    },
]);

let verify_failed = [];
if (checked[0] == () || !checked[0].success || checked[0].output.ok == false) {
    verify_failed.push("verify-cad");
}
if (checked[1] == () || !checked[1].success || checked[1].output.ok == false) {
    verify_failed.push("verify-sysml");
}
if (checked[2] != () && checked[2].success && checked[2].output.real == true) {
    verify_failed.push("cad-authority");
}
if (checked[3] != () && checked[3].success && checked[3].output.real == true) {
    verify_failed.push("sysml-authority");
}

let summary_text = "CAD and SysML frontend slices advanced.";
if (cad_impl != () && cad_impl.success && cad_impl.output.summary != ()) {
    summary_text = cad_impl.output.summary;
}
if (impl_failed.len() != 0) {
    complete(#{
        ok: false,
        summary: "Implement failed.",
    });
}
if (verify_failed.len() != 0) {
    complete(#{
        ok: false,
        summary: "Verify failed.",
    });
}
complete(#{ ok: true, summary: summary_text });
