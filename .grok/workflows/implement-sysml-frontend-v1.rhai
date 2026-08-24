let meta = #{
    name: "implement-sysml-frontend-v1",
    description: "Implement the sealed SysML v2 closed-subset frontend without SysON insert",
    when_to_use: "After locking sysml-architecture-closed-subset-v1; first slice only",
    phases: [
        #{ title: "Implement", detail: "D4 guard, analyzer, capture, preview, seal" },
        #{ title: "Verify", detail: "targeted tests and authority review" },
    ],
};

let status_schema = #{
    "type": "object",
    "required": ["ok", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "files": #{ "type": "array", "items": #{ "type": "string" } },
    },
};

phase("Implement");
let impl = "Implement FIRST SLICE ONLY of agent-authored SysML in ";
impl += "/Users/erwanpesle/Documents/GitHub/casys-digital-thread. ";
impl += "Read CLAUDE.md, src/domain/architecture/renderer/architecture-proposal.ts, ";
impl += "src/adapters/analyzers/qualified-build123d-source-analyzer.ts, ";
impl += "src/adapters/captures/technical-source-analysis-capture.ts, ";
impl += "src/domain/analysis/technical-compilation.ts, deno.json check list. ";
impl += "LOCKED: subset = exactly the 3 renderer forms (package block, part def empty-or-block, part usage : Type). ";
impl += "Agent writes SysML UTF-8. Digital Thread tokenizes fail-closed, parses, CAS-captures, analyses. ";
impl += "unresolved is first-class, never omitted. Bindings are ids, never labels. ";
impl += "Keep model.write-architecture@1 flat renderer. Do NOT insert into SysON. ";
impl += "Do NOT add model.write-architecture@2. Do NOT reuse compile.seal-admission@2. ";
impl += "Do NOT reuse sysml-source-capture/1.0 renderer envelopes as agent-authored authority. ";
impl += "Do NOT call providers. No LLM. No attributes/constraints/requirements/imports/comments. ";
impl += "Need: lexical guard, QualifiedArchitectureSysmlAnalyzer, profile sysml-architecture-closed-subset-v1, ";
impl += "capture+preview tools, provider-free seal operation that writes Thread document only, tests that ";
impl += "renderArchitectureSysmlWithManifest output parses with unresolved=[]. ";
impl += "Add every new non-test module to deno.json check. deno fmt edited files. Return ok/summary/files.";

let implemented = agent(impl, #{
    label: "implement-sysml-v1",
    capability_mode: "read-write",
    output_schema: status_schema,
});
if (implemented == () || !implemented.success || implemented.output.ok != true) {
    complete(#{ ok: false, summary: "SysML v1 implementation failed." });
}

phase("Verify");
let ver = "In /Users/erwanpesle/Documents/GitHub/casys-digital-thread run the new SysML frontend tests ";
ver += "with explicit deno test permissions (no deno task test path args). ";
ver += "Also confirm deno.json check lists every new non-test module. ";
ver += "Review authority: caller cannot supply provider/tool/path/SysON ids; ";
ver += "model.write-architecture@1 still unused as dispatch of agent text; no syson_ call. ";
ver += "Return ok true only if tests are green and those authorities hold.";

let verified = agent(ver, #{
    label: "verify-sysml-v1",
    capability_mode: "execute",
    output_schema: status_schema,
});
if (verified != () && verified.success && verified.output.ok == true) {
    complete(#{ ok: true, summary: implemented.output.summary });
}
complete(#{ ok: false, summary: "SysML v1 verification failed." });
