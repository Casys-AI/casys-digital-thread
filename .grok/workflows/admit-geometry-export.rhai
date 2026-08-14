let meta = #{
    name: "admit-geometry-export",
    description: "Implement, verify, then YOLO-test admitted CAD export to mcp-build123d",
    when_to_use: "When wiring sealed compile.seal-admission to private mcp-build123d without replacing isolated execute",
    phases: [
        #{ title: "Implement", detail: "ports, use case, adapter, MCP tool, server wiring" },
        #{ title: "Verify", detail: "targeted tests plus authority review" },
        #{ title: "Yolo", detail: "live capture and compilation preview on desk-lamp-dl04" },
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

let mode = "full";
if args != () && args.mode != () {
    mode = args.mode;
}
log("admit-geometry-export mode=" + mode);

phase("Implement");
let implement_prompt = "Implement admitted-geometry MCP export in /Users/erwanpesle/Documents/GitHub/casys-digital-thread. ";
implement_prompt += "Read CLAUDE.md, src/adapters/captures/geometry-draft-capture.ts, ";
implement_prompt += "src/application/use-cases/prepare-project-build123d-execution-review.ts, ";
implement_prompt += "src/tools/project-control/technical-compilation-tools.ts, and server.ts before writing. ";
implement_prompt += "Goal: after compile.seal-admission@1, callers cannot pass Python. ";
implement_prompt += "The server reopens the sealed admission and sends exact admitted bytes to private mcp-build123d via existing build123d_export / geometry-draft-capture. ";
implement_prompt += "Output is a geometry DRAFT, not Thread. design.write-geometry@1 remains the sealer. ";
implement_prompt += "Do NOT change design.execute-build123d@1. Do NOT let callers select provider, tool, path, image, or source text. ";
implement_prompt += "Create: src/application/ports/out/admitted-geometry-exporter.ts, ";
implement_prompt += "src/application/ports/in/project-admitted-geometry-export.ts, ";
implement_prompt += "src/application/use-cases/export-admitted-project-geometry.ts plus _test.ts, ";
implement_prompt += "src/adapters/captures/admission-backed-geometry-export-adapter.ts plus _test.ts, ";
implement_prompt += "tool project_admitted_geometry_export in technical-compilation-tools.ts, ";
implement_prompt += "server.ts wiring using the same private build123d MCP client as geometry preview, ";
implement_prompt += "and add every new non-test module to deno.json check. ";
implement_prompt += "Register the tool only when the use case is composed. Do not require --local-execution. ";
implement_prompt += "Hexagonal, exactRecord, fail-closed, colocated tests with @std/assert. ";
implement_prompt += "Run targeted deno tests and fix them. Do not commit. ";
implement_prompt += "Return ok=true only if the new tests passed. List files you created or edited.";

let implemented = agent(implement_prompt, #{
    label: "implement-export",
    capability_mode: "all",
    output_schema: status_schema,
});

let implement_ok = implemented != () && implemented.success && implemented.output.ok == true;
if implemented == () || !implemented.success {
    log("implement agent did not complete");
}

phase("Verify");
let test_prompt = "In /Users/erwanpesle/Documents/GitHub/casys-digital-thread run targeted deno tests for ";
test_prompt += "src/application/use-cases/export-admitted-project-geometry_test.ts, ";
test_prompt += "src/adapters/captures/admission-backed-geometry-export-adapter_test.ts, ";
test_prompt += "src/tools/project-control/technical-compilation-tools_test.ts, ";
test_prompt += "and src/adapters/analyzers/qualified-build123d-source-analyzer_test.ts. ";
test_prompt += "Use deno test --allow-read --allow-write --allow-net=127.0.0.1,localhost --allow-env and those paths. ";
test_prompt += "If tests fail, fix the code and rerun. Confirm deno.json check lists every new non-test module. ";
test_prompt += "Return ok=true only if those tests passed. Summarize failures if any.";

let review_prompt = "Read-only authority review in /Users/erwanpesle/Documents/GitHub/casys-digital-thread. ";
review_prompt += "Use read_file and grep on the new admitted-geometry export files. ";
review_prompt += "Confirm: no caller sourceText reaches MCP; no provider/tool/path selection; ";
review_prompt += "design.execute-build123d@1 is untouched; domain/application import no adapters. ";
review_prompt += "Set ok=true only after reading the files. If a leak exists, set ok=false and describe it in summary.";

let verified = parallel([
    #{ prompt: test_prompt, label: "run-tests", capability_mode: "all", output_schema: status_schema },
    #{ prompt: review_prompt, label: "authority-review", capability_mode: "read-only", output_schema: status_schema },
]);

let tests_ok = verified[0] != () && verified[0].success && verified[0].output.ok == true;
let review_ok = verified[1] != () && verified[1].success && verified[1].output.ok == true;
if !tests_ok || !review_ok {
    let fix_prompt = "Fix admitted-geometry export so targeted tests pass and authority holds. ";
    fix_prompt += "Repo /Users/erwanpesle/Documents/GitHub/casys-digital-thread. ";
    fix_prompt += "Re-run the same targeted deno tests after the fix. Do not commit. Return ok=true only if tests passed.";
    let fixed = agent(fix_prompt, #{
        label: "fix-export",
        capability_mode: "all",
        output_schema: status_schema,
    });
    if fixed != () && fixed.success && fixed.output.ok == true {
        tests_ok = true;
    }
}

if mode == "skip-yolo" {
    complete(#{
        summary: "Implemented and verified; YOLO skipped.",
        implement_ok: implement_ok,
        tests_ok: tests_ok,
        review_ok: review_ok,
        ok: implement_ok && tests_ok,
    });
}

phase("Yolo");
let yolo_prompt = "Live-test admitted CAD compilation in /Users/erwanpesle/Documents/GitHub/casys-digital-thread. ";
yolo_prompt += "Use curl or python against http://127.0.0.1:3020/mcp with mcp-protocol-version 2026-07-28. ";
yolo_prompt += "If the server is not up, start deno task start:yolo in the background and wait until Tools available. ";
yolo_prompt += "1) Call project_technical_source_capture with profileId build123d-closed-subset-v1 and the exact DL-04 fused-arm script: ";
yolo_prompt += "from build123d import Box, Pos then column = Pos(0, 0, 190) * Box(28, 28, 340) then arm = Pos(180, 0, 346) * Box(360, 28, 28) then result = column + arm. ";
yolo_prompt += "2) Call project_snapshot for desk-lamp-dl04, then project_technical_compilation_preview against that exact current thread basis. Never use latest. ";
yolo_prompt += "3) If project_admitted_geometry_export exists and a sealed admission artifact exists, call it. Otherwise say export needs a sealed admission. ";
yolo_prompt += "Do not invent source as authority. Do not commit. ";
yolo_prompt += "Return ok=true if capture and preview ran and you report ready-for-review or the exact unresolved diagnostics.";

let yolo = agent(yolo_prompt, #{
    label: "yolo-dl04",
    capability_mode: "all",
    output_schema: status_schema,
});

let yolo_ok = yolo != () && yolo.success && yolo.output.ok == true;
let summary = "admit-geometry-export finished";
if yolo != () && yolo.success && yolo.output.summary != () {
    summary = yolo.output.summary;
}
complete(#{
    summary: summary,
    implement_ok: implement_ok,
    tests_ok: tests_ok,
    review_ok: review_ok,
    yolo_ok: yolo_ok,
    ok: tests_ok && yolo_ok,
});
