let meta = #{
    name: "admit-geometry-export",
    description: "Implement, verify, then live-test admitted CAD export from sealed compile.seal-admission@2",
    when_to_use: "When wiring sealed compile.seal-admission@2 to private mcp-build123d without replacing isolated execute",
    phases: [
        #{ title: "Implement", detail: "ports, use case, adapter, MCP tool, server wiring" },
        #{ title: "Verify", detail: "targeted tests plus authority review" },
        #{ title: "Yolo", detail: "caller-supplied project/workspace/file coordinates, never DL04 repair" },
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
let implement_prompt = "Implement admitted-geometry MCP export in the current checkout (this repository). ";
implement_prompt += "Read CLAUDE.md, docs/reference/agent/agent-workspace.md, ";
implement_prompt += "src/tools/project-control/technical-compilation-tools.ts, and server.ts before writing. ";
implement_prompt += "Goal: after compile.seal-admission@2, callers cannot pass Python. ";
implement_prompt += "Ingress is AgentResource plus a ProjectSourceWorkspace exact file revision. ";
implement_prompt += "Capture names only projectId, workspaceRevision, fileId and fileRevision. ";
implement_prompt += "Preview takes projectId plus result.reference locators. Then compile.seal-admission@2. ";
implement_prompt += "The server reopens the sealed admission and sends exact admitted bytes to private mcp-build123d. ";
implement_prompt += "Output is a geometry DRAFT, not Thread. design.write-geometry@1 remains the sealer. ";
implement_prompt += "Do NOT change design.execute-build123d@1. Do NOT let callers select provider, tool, path, image, or source text. ";
implement_prompt += "Do NOT inline Python into MCP capture. ";
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
let test_prompt = "In the current checkout (this repository), run targeted Deno tests for ";
test_prompt += "src/application/use-cases/cad/canonical/export-admitted-project-geometry_test.ts, ";
test_prompt += "src/tools/project-control/technical-compilation-tools_test.ts, ";
test_prompt += "and src/adapters/compile/server-composition_test.ts. ";
test_prompt += "Use deno test --allow-read --allow-write --allow-net=127.0.0.1,localhost --allow-env and those paths. ";
test_prompt += "If tests fail, fix the code and rerun. ";
test_prompt += "Return ok=true only if those tests passed. Summarize failures if any.";

let review_prompt = "Read-only authority review in the current checkout (this repository). ";
review_prompt += "Use read_file and grep on the admitted-geometry export files. ";
review_prompt += "Confirm: no caller sourceText reaches MCP; no provider/tool/path selection; ";
review_prompt += "capture names only the workspace quadruplet; design.execute-build123d@1 is untouched; ";
review_prompt += "only compile.seal-admission@2 is the live compile operation. ";
review_prompt += "Set ok=true only after reading the files. If a leak exists, set ok=false and describe it in summary.";

let verified = parallel([
    #{ prompt: test_prompt, label: "run-tests", capability_mode: "all", output_schema: status_schema },
    #{ prompt: review_prompt, label: "authority-review", capability_mode: "read-only", output_schema: status_schema },
]);

let tests_ok = verified[0] != () && verified[0].success && verified[0].output.ok == true;
let review_ok = verified[1] != () && verified[1].success && verified[1].output.ok == true;
if !tests_ok || !review_ok {
    let fix_prompt = "Fix admitted-geometry export so targeted tests pass and authority holds. ";
    fix_prompt += "Repository: current checkout. ";
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
let yolo_prompt = "Live-test admitted CAD compilation in the current checkout (this repository). ";
yolo_prompt += "Do not start servers. Do not auto-repair desk-lamp-dl04 or any historical project. ";
yolo_prompt += "Caller must supply exact live coordinates: projectId, workspaceRevision, fileId, fileRevision. ";
if args != () && args.projectId != () {
    yolo_prompt += "projectId=" + args.projectId + " workspaceRevision=" + args.workspaceRevision + " ";
    yolo_prompt += "fileId=" + args.fileId + " fileRevision=" + args.fileRevision + ". ";
} else {
    yolo_prompt += "If those coordinates are missing from workflow args, fail closed and report they are required. ";
}
yolo_prompt += "Use curl against an already-running http://127.0.0.1:3020/mcp with mcp-protocol-version 2026-07-28. ";
yolo_prompt += "1) Call project_technical_source_capture with only that quadruplet. Never pass sourceText, profileId, sourceId or resourceRef. ";
yolo_prompt += "2) Call project_technical_compilation_preview with projectId and sourceRefs = [result.reference]. Never use latest. ";
yolo_prompt += "3) If a sealed compile.seal-admission@2 artifact exists, call project_admitted_geometry_export. Otherwise say export needs that sealed admission. ";
yolo_prompt += "Do not invent source as authority. Do not commit. ";
yolo_prompt += "Return ok=true if capture and preview ran and you report ready-for-review or the exact unresolved diagnostics.";

let yolo = agent(yolo_prompt, #{
    label: "yolo-caller-coordinates",
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
