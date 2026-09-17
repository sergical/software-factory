// Replays single recorded model calls from real factory runs against the
// current build's instructions, so an instruction fix is tested in seconds
// instead of by a deploy and a full run.
//
//   pnpm replay fetch <case> <traceId> <spanId> '<checks json>'
//   pnpm replay run [--n 24] [--recorded] [case...]
//
// `fetch` saves one generate_content span (system prompt, tools, messages)
// from Sentry with the `sentry` CLI. `run` swaps the recorded instructions
// for the ones in .output (run `pnpm build` first), sends the call N times,
// and applies the case's checks. `--recorded` keeps the recorded prompt,
// which shows whether a case still catches the failure it was saved for.
// Failures that show up in one call out of five or six need about 24 runs
// before a clean result means anything.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { gateway, generateText, jsonSchema, tool } from "ai";

const CASES = new URL("cases/", import.meta.url);
const MANIFEST = new URL(
  "../../.output/.eve/compile/compiled-agent-manifest.json",
  import.meta.url
);
const PROJECT =
  process.env.REPLAY_SENTRY_PROJECT ??
  "sentry-developer-experience/software-factory";
// eve renders the instructions block first in every system prompt, under
// this header; skills and connection sections follow it.
const HEADER = "Instructions (instructions)\n";
const TOOL_TEXT =
  /<function|<tool_call|\[TOOL_CALLS\]|"toolCallId"|"agentId"|"taskId"/;

const sentrySpan = (traceId, spanId, fields) => {
  const args = [
    "explore",
    PROJECT,
    "--dataset",
    "spans",
    "--query",
    `trace:${traceId} id:${spanId}`,
    "--period",
    "30d",
    "--limit",
    "1",
    "--json",
  ];
  for (const field of fields) {
    args.push("--field", field);
  }
  const out = JSON.parse(
    execFileSync("sentry", args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
  );
  if (!out.data?.length) {
    throw new Error(`span ${spanId} not found in trace ${traceId}`);
  }
  return out.data[0];
};

const fetchCase = (name, traceId, spanId, checks) => {
  const span = sentrySpan(traceId, spanId, [
    "gen_ai.request.model",
    "gen_ai.system_instructions",
    "gen_ai.tool.definitions",
    "gen_ai.input.messages",
    "gen_ai.output.messages",
  ]);
  const record = {
    checks: JSON.parse(checks ?? "{}"),
    messages: JSON.parse(span["gen_ai.input.messages"]),
    model: span["gen_ai.request.model"],
    output: span["gen_ai.output.messages"],
    source: { spanId, traceId },
    system: JSON.parse(span["gen_ai.system_instructions"])
      .map((part) => part.content)
      .join("\n\n"),
    tools: JSON.parse(span["gen_ai.tool.definitions"]),
  };
  writeFileSync(
    new URL(`${name}.json`, CASES),
    `${JSON.stringify(record, null, 1)}\n`
  );
  console.log(
    `saved ${name}: ${record.model}, ${record.messages.length} messages, ${record.tools.length} tools`
  );
};

// Every agent's instructions in the current build, keyed by station ("root"
// for the foreman).
const currentInstructions = () => {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const entries = [["root", manifest.instructions]];
  for (const sub of manifest.subagents ?? []) {
    entries.push([sub.name ?? sub.agent?.name, sub.agent?.instructions]);
  }
  return entries
    .filter(([, list]) => list?.length)
    .map(([station, list]) => ({
      content: list
        .map((item) => item.content)
        .join("\n\n")
        .trim(),
      station,
    }));
};

// The recorded agent is the one whose current instructions start the same way
// and still contain the recorded block's last line; everything after that
// line is eve's appended sections, which are kept as recorded.
const patchSystem = (system, agents) => {
  if (!system.startsWith(HEADER)) {
    throw new Error(
      "recorded system prompt does not start with the instructions header"
    );
  }
  const body = system.slice(HEADER.length);
  const edges = (content) => {
    const lines = content.split("\n");
    return { first: lines[0], last: lines.at(-1) };
  };
  const agent = agents.find((candidate) => {
    const { first, last } = edges(candidate.content);
    return body.startsWith(first) && body.includes(last);
  });
  if (!agent) {
    throw new Error("no agent in the build matches the recorded instructions");
  }
  const { last } = edges(agent.content);
  const end = body.indexOf(last) + last.length;
  return {
    station: agent.station,
    system: `${HEADER}${agent.content}${body.slice(end)}`,
  };
};

// Provider tools carry no input schema; the factory's only one is the
// gateway's web search.
const buildTools = (definitions) =>
  Object.fromEntries(
    definitions.map((definition) => [
      definition.name,
      definition.type === "provider"
        ? gateway.tools.exaSearch(definition.args)
        : tool({
            description: definition.description,
            inputSchema: jsonSchema(definition.inputSchema),
          }),
    ])
  );

const judge = (checks, result) => {
  const failures = [];
  const calls = result.toolCalls.map((call) => call.toolName);
  if (checks.noToolText !== false && TOOL_TEXT.test(result.text)) {
    failures.push("tool-call syntax in text");
  }
  for (const pattern of checks.forbidText ?? []) {
    if (new RegExp(pattern, "i").test(result.text)) {
      failures.push(`text matches /${pattern}/`);
    }
  }
  for (const name of checks.forbidCalls ?? []) {
    if (calls.includes(name)) {
      failures.push(`called ${name}`);
    }
  }
  for (const name of checks.requireCalls ?? []) {
    if (!calls.includes(name)) {
      failures.push(`did not call ${name}`);
    }
  }
  if (checks.endTurn && calls.length > 0) {
    failures.push(`did not end the turn (called ${calls.join(",")})`);
  }
  if (checks.maxTextLength && result.text.length > checks.maxTextLength) {
    failures.push(`text is ${result.text.length} chars`);
  }
  return failures;
};

const runCase = async (name, n, recorded, agents) => {
  const record = JSON.parse(readFileSync(new URL(`${name}.json`, CASES)));
  const { station, system } = recorded
    ? { station: "recorded", system: record.system }
    : patchSystem(record.system, agents);
  const tools = buildTools(record.tools);
  const messages = record.messages.map((message) => ({
    content: message.parts ?? message.content,
    role: message.role,
  }));
  // Stations with structured output run with toolChoice "required" (see
  // agent/lib/models.ts), so their final answer is a final_output call.
  const toolChoice = record.tools.some((t) => t.name === "final_output")
    ? "required"
    : undefined;
  const once = async (i) => {
    try {
      const result = await generateText({
        maxRetries: 2,
        messages,
        model: gateway(record.model),
        system,
        toolChoice,
        tools,
      });
      const failures = judge(record.checks, result);
      const calls = result.toolCalls.map((call) => call.toolName).join(",");
      const text = JSON.stringify(
        result.text.replace(/\s+/g, " ").slice(0, 120)
      );
      const verdict = failures.length ? "FAIL" : "pass";
      const reason = failures.length ? `  <- ${failures.join("; ")}` : "";
      return {
        failed: failures.length > 0,
        line: `${verdict} #${i} calls=[${calls}] text=${text}${reason}`,
      };
    } catch (error) {
      return {
        failed: true,
        line: `ERR  #${i} ${error.name}: ${String(error.message).slice(0, 120)}`,
      };
    }
  };
  const results = await Promise.all(
    Array.from({ length: n }, (_, i) => once(i + 1))
  );
  const failed = results.filter((result) => result.failed).length;
  console.log(
    `\n${name} (${station}, ${record.model}, prompt ${record.system.length} -> ${system.length} chars): ${n - failed} of ${n} pass`
  );
  for (const result of results) {
    console.log(`  ${result.line}`);
  }
  return failed;
};

const takeFlag = (args, flag, arity) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args.splice(index, arity + 1) : undefined;
};

const [command, ...rest] = process.argv.slice(2);
if (command === "fetch") {
  const [name, traceId, spanId, checks] = rest;
  fetchCase(name, traceId, spanId, checks);
} else if (command === "run") {
  const n = Number(takeFlag(rest, "--n", 1)?.[1] ?? 24);
  const recorded = takeFlag(rest, "--recorded", 0) !== undefined;
  const names = rest.length
    ? rest
    : readdirSync(CASES)
        .filter((file) => file.endsWith(".json"))
        .map((file) => file.slice(0, -".json".length));
  const agents = recorded ? [] : currentInstructions();
  let failed = 0;
  for (const name of names) {
    // biome-ignore lint/performance/noAwaitInLoops: cases run one at a time so their output stays grouped and the gateway sees one burst per case
    failed += await runCase(name, n, recorded, agents);
  }
  process.exitCode = failed ? 1 : 0;
} else {
  console.log(
    "usage: replay.mjs fetch <case> <traceId> <spanId> '<checks json>' | run [--n 24] [--recorded] [case...]"
  );
}
