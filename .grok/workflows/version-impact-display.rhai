let meta = #{
    name: "version-impact-display",
    description: "Design how selecting a historical evidence version should affect graph impacts and project gates",
    when_to_use: "When deciding how version wrapping should re-scope downstream impacts without rewriting Thread truth",
    phases: [
        #{ title: "Perspectives", detail: "graph, authority, gates in parallel" },
        #{ title: "Synthesize", detail: "one recommendation" },
    ],
};

let view_schema = #{
    "type": "object",
    "required": ["ok", "summary", "must", "must_not"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "must": #{ "type": "array", "items": #{ "type": "string" } },
        "must_not": #{ "type": "array", "items": #{ "type": "string" } },
    },
};

let rec_schema = #{
    "type": "object",
    "required": ["ok", "summary", "default_view", "historical_view", "open_questions"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "default_view": #{ "type": "string" },
        "historical_view": #{ "type": "string" },
        "open_questions": #{ "type": "array", "items": #{ "type": "string" } },
    },
};

phase("Perspectives");
let root = "/Users/erwanpesle/Documents/GitHub/casys-digital-thread";
let common_prompt = "Read with read_file/grep before answering: ";
common_prompt += root + "/src/ui/src/thread/version-history.tsx, ";
common_prompt += root + "/src/ui/src/thread/versioned-provenance-model.ts, ";
common_prompt += root + "/src/adapters/thread/evidence-family-graph.ts, ";
common_prompt += root + "/src/ui/src/project/model.ts (PROJECT_PATH_PRESENTATION_POLICY and architectureVersionAttachments). ";
common_prompt += "This is design only. Do not edit files. Empty must/must_not is invalid unless you read those files.";

let graph_p = common_prompt;
graph_p += " Perspective: Evidence graph UX. How should selecting VERSION N of one wrapped node affect visible downstream edges (derived_from, uses, requirements, geometry, FEA)? ";
graph_p += "Default view must stay the current tip. Say what the inspector may show without forking the graph.";

let auth_p = common_prompt;
auth_p += " Perspective: Thread authority. Selecting a historical version must not rewrite Thread, project gates, or MRTR. ";
auth_p += "What is presentation-only vs what would be a forbidden implicit latest?";

let gates_p = common_prompt;
gates_p += " Perspective: Project Path gates. Architecture 2.0/3.0 now wrap as one gate. ";
gates_p += "If the human inspects 2.0, should the gate rail change? What about work items that still bind 2.0 (requirements, geometry, FEA)?";

let views = parallel([
    #{ prompt: graph_p, label: "graph-ux", capability_mode: "read-only", output_schema: view_schema },
    #{ prompt: auth_p, label: "authority", capability_mode: "read-only", output_schema: view_schema },
    #{ prompt: gates_p, label: "gates", capability_mode: "read-only", output_schema: view_schema },
]);

let packed = "";
let i = 0;
for v in views {
    if v != () && v.success && v.output.summary != () {
        packed += json_encode(v.output);
        packed += "\n";
    }
    i += 1;
}
if packed == "" {
    complete(#{ ok: false, summary: "No usable perspective.", default_view: "", historical_view: "", open_questions: [] });
}

phase("Synthesize");
let synth = "Synthesize one product recommendation from these three independent perspectives. ";
synth += "Read them as JSON lines, do not invent files you did not see:\n";
synth += packed;
synth += "\nReturn default_view (what the graph/gates show before any click), ";
synth += "historical_view (what happens when the human selects an older member in the inspector), ";
synth += "and at most 5 open_questions. Design only. Do not edit code.";

let rec = agent(synth, #{
    label: "synthesize",
    capability_mode: "read-only",
    output_schema: rec_schema,
});
if rec != () && rec.success && rec.output.ok != () {
    complete(rec.output);
}
complete(#{
    ok: false,
    summary: "Synthesis failed.",
    default_view: "",
    historical_view: "",
    open_questions: [],
});
