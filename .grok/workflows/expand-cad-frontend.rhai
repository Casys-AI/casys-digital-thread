let meta = #{
    name: "expand-cad-frontend",
    description: "Qualify the next D4 Build123d solids and rotation in the closed-subset analyzer",
    when_to_use: "When expanding agent-authored CAD beyond Box/Cylinder/Pos/Compound",
    phases: [
        #{ title: "Implement", detail: "Cone Sphere Rot plus tests" },
        #{ title: "Verify", detail: "targeted analyzer tests" },
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
let impl = "Implement the next Build123d closed-subset slice in the current checkout (this repository). ";
impl += "Read src/adapters/analyzers/qualified-build123d-source-analyzer.ts, ";
impl += "src/adapters/analyzers/qualified-build123d-source-analyzer_test.ts, ";
impl += "and ALLOWED_BUILD123D_NAMES in src/domain/engineering/geometry-script-validation.ts. ";
impl += "Qualify Cone, Sphere, and Rot only. Keep fail-closed: unknown calls stay unresolved. ";
impl += "Do not change D4, isolated execute, export, or SysML. ";
impl += "Add tests that accept those three and still reject an unqualified D4 name. ";
impl += "Bump analyzer version only if the public analysis identity must change; otherwise keep 1.1.0 and document why. ";
impl += "Use deno fmt on edited files. Return ok/summary/files.";

let implemented = agent(impl, #{
    label: "implement-cad-slice",
    capability_mode: "read-write",
    output_schema: status_schema,
});
if (implemented == () || !implemented.success || implemented.output.ok != true) {
    complete(#{ ok: false, summary: "CAD slice implementation failed." });
}

phase("Verify");
let ver = "Run only these Deno tests in the current checkout (this repository): ";
ver += "deno test --allow-read --allow-write --allow-net=127.0.0.1,localhost --allow-env ";
ver += "src/adapters/analyzers/qualified-build123d-source-analyzer_test.ts. ";
ver += "Do not change production code unless a test you just added is red for a real bug. ";
ver += "Return ok true only if the suite is green.";

let verified = agent(ver, #{
    label: "verify-cad-slice",
    capability_mode: "execute",
    output_schema: status_schema,
});
if (verified != () && verified.success && verified.output.ok == true) {
    complete(#{
        ok: true,
        summary: implemented.output.summary,
    });
}
complete(#{ ok: false, summary: "CAD slice tests failed." });
