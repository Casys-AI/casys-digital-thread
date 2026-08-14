let meta = #{
    name: "sysml-frontend-design",
    description: "Design the agent-authored SysML v2 closed-subset frontend",
    when_to_use: "When replacing server-rendered architecture keys with parsed agent SysML",
    phases: [
        #{ title: "Read", detail: "current renderer and CAD admission pattern" },
        #{ title: "Design", detail: "closed subset, authority, first slice" },
    ],
};

let notes_schema = #{
    "type": "object",
    "required": ["ok", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "files": #{ "type": "array", "items": #{ "type": "string" } },
    },
};

let design_schema = #{
    "type": "object",
    "required": ["ok", "summary", "subset", "pipeline", "first_slice", "must_not"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "subset": #{ "type": "string" },
        "pipeline": #{ "type": "string" },
        "first_slice": #{ "type": "string" },
        "must_not": #{ "type": "array", "items": #{ "type": "string" } },
    },
};

phase("Read");
let read_p = "Read-only survey in /Users/erwanpesle/Documents/GitHub/casys-digital-thread. ";
read_p += "Use read_file/grep. Read src/domain/engineering/architecture-proposal.ts, ";
read_p += "src/adapters/analyzers/qualified-build123d-source-analyzer.ts, ";
read_p += "docs/reference/analysis-authority-pipeline.md architecture and compilation sections, ";
read_p += "src/adapters/executors/model-write-architecture-run-executor.ts capture pipeline. ";
read_p += "Summarize: who writes SysML today, what subset the renderer emits, ";
read_p += "and which CAD admission steps SysML must copy. Do not edit files.";

let notes = agent(read_p, #{
    label: "read-sysml-today",
    capability_mode: "read-only",
    output_schema: notes_schema,
});
if (notes == () || !notes.success || notes.output.ok != true) {
    complete(#{
        ok: false,
        summary: "Survey failed.",
        subset: "",
        pipeline: "",
        first_slice: "",
        must_not: [],
    });
}

phase("Design");
let design_p = "Design the agent-authored SysML v2 closed-subset frontend. ";
design_p += "Product decision already locked: agent writes SysML v2 text, Digital Thread parses a closed subset, admission, then private SysON MCP. ";
design_p += "No LLM between tools. Agent never supplies provider/tool/path. ";
design_p += "Keep the current flat-key renderer until the first parsed slice is sealed. ";
design_p += "Survey notes: ";
design_p += json_encode(notes.output);
design_p += " Propose subset, pipeline, first implementable slice, and must_not. Design only. Do not edit files.";

let designed = agent(design_p, #{
    label: "design-sysml-frontend",
    capability_mode: "read-only",
    output_schema: design_schema,
});
if (designed != () && designed.success && designed.output.ok == true) {
    complete(designed.output);
}
complete(#{
    ok: false,
    summary: "SysML design failed.",
    subset: "",
    pipeline: "",
    first_slice: "",
    must_not: [],
});
