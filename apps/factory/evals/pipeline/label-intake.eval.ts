import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MessageStreamEvent } from "eve/client";
import type { EveEvalContext, EveEvalTurn } from "eve/evals";
import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { FACTORY_LABEL, FACTORY_REPO } from "../../agent/lib/constants.js";
import {
  advancePipeline,
  deliveryHold,
  initialPipeline,
  type PipelineState,
  parseStationEnd,
} from "../../agent/lib/pipeline.js";
import { addedRepeat } from "../../agent/lib/repeated-lines.js";
import { calledInOrder, STATIONS } from "../helpers.js";

/** The local workflow world, shared by `eve dev` and `eve eval`. */
const RUNS_DIR = ".eve/.workflow-data/runs";
const TOOL_TEXT =
  /<function|<tool_call|\[TOOL_CALLS\]|"toolCallId"|"agentId"|"taskId"/;
const RUNTIME_TEXT = /\bruntime\b|ending the turn|background task/i;
const CHECK_SCRIPTS = ["typecheck", "lint", "test"];
const CHECK_ATTEMPTS = 3;
/** Leaves time for the branch checks and the judge inside `timeoutMs`. */
const FOLLOW_MS = 2_100_000;
/** The demo app the issues are about; the factory's own code shares the repository. */
const APP_DIR = "apps/web/";
/**
 * Good factory fixes so far changed 1 to 24 lines in 1 to 3 files. The run
 * that pasted `App.css` into itself changed 96, and its reviewer approved.
 */
const MAX_FILES = 5;
const MAX_CHANGED_LINES = 60;

interface RunRecord {
  attributes?: Record<string, string>;
  createdAt: string;
  runId: string;
  status: string;
}

interface IssueComment {
  body: string;
  created_at: string;
  user: { login: string; type: string };
}

interface PullRequest {
  base: { sha: string };
  body: string | null;
  created_at: string;
  draft: boolean;
  head: { ref: string; sha: string };
  html_url: string;
  number: number;
}

interface PullFile {
  additions: number;
  changes: number;
  deletions: number;
  filename: string;
  status: string;
}

const gh = <T>(path: string): T =>
  JSON.parse(
    execFileSync("gh", ["api", path], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    })
  ) as T;

const fileAt = (path: string, ref: string): string =>
  Buffer.from(
    gh<{ content: string }>(
      `repos/${FACTORY_REPO}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${ref}`
    ).content,
    "base64"
  ).toString("utf8");

/** GitHub tools report a failed call as `{ error }` in a completed result. */
const failedOutput = (result: { isError?: boolean; output: unknown }) =>
  result.isError === true ||
  (typeof result.output === "object" &&
    result.output !== null &&
    "error" in result.output);

const readRuns = async (): Promise<RunRecord[]> => {
  // The local world creates the runs directory with its first run.
  const files = (await readdir(RUNS_DIR).catch(() => [] as string[])).filter(
    (f) => f.endsWith(".json")
  );
  const runs = await Promise.all(
    files.map(async (file) => {
      try {
        return JSON.parse(
          await readFile(join(RUNS_DIR, file), "utf8")
        ) as RunRecord;
      } catch {
        // A record can be mid-write; the next poll reads it whole.
        return null;
      }
    })
  );
  return runs.filter((run): run is RunRecord => run !== null);
};

/**
 * Cancels every session and station in the local world. A local host resumes
 * any session it finds unfinished, and run records stay "running" after a
 * session ends, so the store cannot say which ones are still live.
 */
const cancelSessions = async (t: EveEvalContext, reason: string) => {
  const ids = (await readRuns())
    .filter((run) =>
      ["session", "subagent"].includes(run.attributes?.["$eve.type"] ?? "")
    )
    .map((run) => run.runId);
  for (const id of ids) {
    // biome-ignore lint/performance/noAwaitInLoops: cancels are logged in order
    const cancel = await t.target
      .fetch(`/eve/v1/session/${encodeURIComponent(id)}/cancel`, {
        method: "POST",
      })
      .then((res) => String(res.status))
      .catch((error: unknown) => String(error));
    t.log(`${reason}: cancel ${id}: ${cancel}`);
  }
};

/**
 * Clones the delivered branch and runs the repository's own checks on it,
 * the same ones `push_branch` gates on, with the same retry for the seeded
 * flaky test.
 */
const verifyBranch = async (
  branch: string
): Promise<{ name: string; output: string; passed: boolean }[]> => {
  const dir = await mkdtemp(join(tmpdir(), "factory-eval-"));
  try {
    execFileSync(
      "git",
      [
        "clone",
        "--quiet",
        "--depth",
        "1",
        "--branch",
        branch,
        `https://github.com/${FACTORY_REPO}.git`,
        dir,
      ],
      { stdio: "pipe" }
    );
    const sh = (command: string) =>
      spawnSync("sh", ["-c", `${command} 2>&1`], {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, CI: "1" },
        maxBuffer: 64 * 1024 * 1024,
      });
    const pm = existsSync(join(dir, "pnpm-lock.yaml")) ? "pnpm" : "npm";
    const setup = process.env.FACTORY_SETUP_COMMAND?.trim() || `${pm} install`;
    const installed = sh(setup);
    if (installed.status !== 0) {
      return [
        { name: "setup", output: installed.stdout.slice(-2000), passed: false },
      ];
    }
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    const configured = process.env.FACTORY_CHECK_COMMAND?.trim();
    const checks = configured
      ? [{ command: configured, name: "checks" }]
      : CHECK_SCRIPTS.filter((name) => pkg.scripts?.[name]).map((name) => ({
          command: `${pm} run ${name}`,
          name,
        }));
    const results: { name: string; output: string; passed: boolean }[] = [];
    for (const check of checks) {
      let run = sh(check.command);
      for (
        let attempt = 1;
        run.status !== 0 && attempt < CHECK_ATTEMPTS;
        attempt += 1
      ) {
        run = sh(check.command);
      }
      results.push({
        name: check.name,
        output: run.stdout.slice(-2000),
        passed: run.status === 0,
      });
    }
    return results;
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
};

/**
 * Sends the labeled webhook Vercel Connect would forward from GitHub and
 * returns the session it started. The route answers before it dispatches the
 * session, so the session is found in the local world's run records.
 */
const startLabelSession = async (
  t: EveEvalContext,
  payload: { issue: unknown; label: unknown }
): Promise<{ since: Date; sessionId: string }> => {
  const since = new Date();
  const response = await t.target.fetch("/eve/v1/github", {
    body: JSON.stringify({
      action: "labeled",
      ...payload,
      repository: gh(`repos/${FACTORY_REPO}`),
      sender: gh("user"),
    }),
    headers: {
      authorization: `Bearer ${process.env.VERCEL_OIDC_TOKEN ?? ""}`,
      "content-type": "application/json",
      "x-github-delivery": crypto.randomUUID(),
      "x-github-event": "issues",
    },
    method: "POST",
  });
  await t.require(
    response.status,
    satisfies(
      (status: number) => status === 200,
      "the channel accepted the webhook"
    )
  );

  for (let poll = 0; poll < 60; poll += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: polling waits for the session record to appear
    const session = (await readRuns()).find(
      (run) =>
        run.attributes?.["$eve.type"] === "session" &&
        new Date(run.createdAt) >= since
    );
    if (session) {
      t.log(
        `session ${session.runId} (trigger ${session.attributes?.["$eve.trigger"]})`
      );
      return { sessionId: session.runId, since };
    }
    await t.sleep(2000);
  }
  throw new Error("The webhook started no session within two minutes.");
};

interface Delivery {
  /** Why the guard would refuse the call, as the stream showed the pipeline. */
  hold?: string;
  /** Whether GitHub created the pull request; a refused call leaves it unset. */
  opened?: boolean;
}

interface StationState {
  /** The `createPullRequest` calls the foreman requested, by call id. */
  deliveries: Map<string, Delivery>;
  pipeline: PipelineState;
}

const trackRequests = (
  { data }: Extract<MessageStreamEvent, { type: "actions.requested" }>,
  state: StationState
) => {
  for (const action of data.actions) {
    if (
      action.kind === "tool-call" &&
      action.toolName === "github__createPullRequest"
    ) {
      state.deliveries.set(action.callId, {
        hold: deliveryHold(state.pipeline),
      });
    }
  }
};

const trackResult = (
  { data }: Extract<MessageStreamEvent, { type: "action.result" }>,
  state: StationState
) => {
  const { result, status } = data;
  if (result.kind !== "tool-result") {
    return;
  }
  const delivery = state.deliveries.get(result.callId);
  if (delivery) {
    delivery.opened = status === "completed" && !failedOutput(result);
  }
};

/**
 * Updates the station state from one turn's events, in stream order, so a
 * pull request requested in the same turn a station starts counts as opened
 * while that station runs.
 */
const trackStations = (
  t: EveEvalContext,
  events: readonly MessageStreamEvent[],
  state: StationState
) => {
  for (const event of events) {
    switch (event.type) {
      case "subagent.completed":
        state.pipeline = advancePipeline(state.pipeline, event);
        break;
      case "message.received": {
        const end = parseStationEnd(event.data.message);
        if (end) {
          t.log(`${end.station} ${end.status}`);
        }
        state.pipeline = advancePipeline(state.pipeline, event);
        break;
      }
      case "actions.requested":
        trackRequests(event, state);
        break;
      case "action.result":
        trackResult(event, state);
        break;
      default:
    }
  }
};

/**
 * The client stops following after about 100 quiet seconds and a station can
 * run for many minutes, so a closed stream returns nothing and the caller
 * follows again from the same turn start, which keeps the turn result whole.
 */
const nextTurn = (
  t: EveEvalContext,
  sessionId: string,
  startIndex: number
): Promise<EveEvalTurn | undefined> =>
  t.target
    .watchTurn(sessionId, { startIndex })
    .result()
    .catch((error: unknown): undefined => {
      if (
        error instanceof Error &&
        error.message.includes("closed before a turn boundary")
      ) {
        return;
      }
      throw error;
    });

/**
 * Follows the session turn by turn. Every turn parks as "waiting" while a
 * station runs in the background, so the run is over only when no launched
 * station is left to wake it, or once the pull request is open.
 */
const followRun = async (t: EveEvalContext, sessionId: string) => {
  const turns: EveEvalTurn[] = [];
  const events: MessageStreamEvent[] = [];
  const stations: StationState = {
    deliveries: new Map(),
    pipeline: initialPipeline(),
  };
  const running = () =>
    Object.values(stations.pipeline.running).map((task) => task.station);
  const deadline = Date.now() + FOLLOW_MS;
  let seen = 0;
  try {
    while (Date.now() < deadline && !t.signal.aborted) {
      // biome-ignore lint/performance/noAwaitInLoops: each turn starts only after the previous one ends
      const turn = await nextTurn(t, sessionId, seen);
      if (!turn) {
        await t.sleep(5000);
        continue;
      }
      seen += turn.events.length;
      events.push(...turn.events);
      trackStations(t, turn.events, stations);
      turns.push(turn);
      t.log(
        `turn ${turns.length}: ${turn.status}, tools [${turn.toolCalls.map((c) => c.name).join(", ")}], running [${running().join(", ")}], message ${JSON.stringify((turn.message ?? "").slice(0, 200))}`
      );
      const delivered = [...stations.deliveries.values()].some((d) => d.opened);
      if (
        turn.status === "failed" ||
        turn.inputRequests.length > 0 ||
        delivered ||
        running().length === 0
      ) {
        break;
      }
    }
  } finally {
    // A station launched in the last followed turn can start after the stream
    // closes, so the cleanup cannot rely on the stations the stream showed.
    await cancelSessions(t, "cleanup");
  }
  return { events, stations, turns };
};

export default defineEval({
  description: `Runs the production label path on this machine: a hand-built "${FACTORY_LABEL}" labeled webhook for the issue in FACTORY_EVAL_ISSUE goes to the local GitHub channel route with the development Vercel OIDC token, as Vercel Connect would send it, and the eval follows the unattended session to the end. It then checks what a person would see: the four stations in order, clean issue comments, a draft pull request that closes the issue, a small diff inside the demo app with no pasted copies, and the delivered branch passing the repository's checks. Opt-in and slow: it writes real comments, a branch, and a pull request on FACTORY_REPO. The label is added to the webhook's copy of the issue only: labeling the issue on GitHub would start the same run in production. Use a fresh issue with no factory history for each run. Run with FACTORY_EVAL_ISSUE=<n> VERCEL_PROJECT_ID=<id> pnpm eval pipeline/label-intake --verbose.`,
  tags: ["slow", "needs-connect", "pipeline", "label"],
  async test(t) {
    const issueNumber = Number(process.env.FACTORY_EVAL_ISSUE);
    if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
      t.skip("FACTORY_EVAL_ISSUE is not set.");
    }
    const issue = gh<{
      labels: { name: string }[];
      state: string;
    }>(`repos/${FACTORY_REPO}/issues/${issueNumber}`);
    if (issue.state !== "open") {
      t.skip(`Issue #${issueNumber} must be open.`);
    }
    const label = gh<{ name: string }>(
      `repos/${FACTORY_REPO}/labels/${FACTORY_LABEL}`
    );
    if (!issue.labels.some((l) => l.name === FACTORY_LABEL)) {
      issue.labels.push(label);
    }

    // Sessions left by earlier local runs resumed when this host started, and
    // runs on issues with the same title push to the same branch.
    await cancelSessions(t, "leftover");
    const { since, sessionId } = await startLabelSession(t, { issue, label });
    const { events, stations, turns } = await followRun(t, sessionId);
    const { deliveries } = stations;
    const running = Object.values(stations.pipeline.running).map(
      (task) => task.station
    );
    if (running.length > 0) {
      t.log(`stopped following with [${running.join(", ")}] still running`);
    }
    t.log(`pull request calls: ${JSON.stringify([...deliveries.values()])}`);
    t.check(
      [...deliveries.values()].filter((d) => d.opened),
      satisfies(
        (opened: Delivery[]) => opened.every((d) => d.hold === undefined),
        "the pull request opened only after the reviewer approved the latest revision, with no station running"
      )
    );
    t.check(
      running,
      satisfies(
        (names: string[]) => names.length === 0,
        "no station was left running"
      )
    );

    t.check(
      turns,
      satisfies(
        (all: EveEvalTurn[]) =>
          all.length > 0 &&
          all.every(
            (turn) =>
              turn.status !== "failed" && turn.inputRequests.length === 0
          ),
        "no turn failed or waited on a person"
      )
    );
    t.check(
      events,
      satisfies(
        (all: typeof events) => calledInOrder(all, [...STATIONS]),
        "the four stations ran in pipeline order"
      )
    );
    t.check(
      turns.map((turn) => turn.message ?? ""),
      satisfies(
        (messages: string[]) =>
          messages.every((m) => !(TOOL_TEXT.test(m) || RUNTIME_TEXT.test(m))),
        "no turn ends with tool-call syntax or runtime talk"
      )
    );

    const comments = gh<IssueComment[]>(
      `repos/${FACTORY_REPO}/issues/${issueNumber}/comments?since=${since.toISOString()}&per_page=100`
    ).filter((c) => c.user.type === "Bot" && new Date(c.created_at) >= since);
    t.log(`${comments.length} bot comments on #${issueNumber}`);
    t.check(
      comments,
      satisfies(
        (all: IssueComment[]) =>
          all.length > 0 &&
          all.every(
            (c) => !(TOOL_TEXT.test(c.body) || RUNTIME_TEXT.test(c.body))
          ),
        "the issue got progress comments, all plain"
      )
    );

    const closes = new RegExp(
      `\\b(close[sd]?|fix(e[sd])?|resolve[sd]?) #${issueNumber}\\b`,
      "i"
    );
    const pull = gh<PullRequest[]>(
      `repos/${FACTORY_REPO}/pulls?state=open&per_page=50`
    ).find((p) => new Date(p.created_at) >= since && closes.test(p.body ?? ""));
    // require stops the eval unless the pull request exists and is a draft.
    const delivered = (await t.require(
      pull,
      satisfies(
        (p: PullRequest | undefined) => p?.draft === true,
        `a draft pull request closes #${issueNumber}`
      )
    )) as PullRequest;
    t.log(`pull request ${delivered.html_url} from ${delivered.head.ref}`);

    const files = gh<PullFile[]>(
      `repos/${FACTORY_REPO}/pulls/${delivered.number}/files?per_page=100`
    );
    const changed = files.reduce((sum, f) => sum + f.changes, 0);
    t.log(
      `diff: ${files.map((f) => `${f.filename} +${f.additions} -${f.deletions}`).join(", ")}`
    );
    t.check(
      files,
      satisfies(
        (all: PullFile[]) =>
          all.length > 0 &&
          all.length <= MAX_FILES &&
          changed <= MAX_CHANGED_LINES &&
          all.every((f) => f.filename.startsWith(APP_DIR)),
        `the diff stays in ${APP_DIR}, with at most ${MAX_FILES} files and ${MAX_CHANGED_LINES} changed lines`
      )
    );
    const repeats = files
      .filter((f) => f.status === "modified")
      .flatMap((f) => {
        const repeat = addedRepeat(
          fileAt(f.filename, delivered.base.sha),
          fileAt(f.filename, delivered.head.sha)
        );
        return repeat
          ? [
              `${f.filename}: ${repeat.length} lines twice from "${repeat.start}"`,
            ]
          : [];
      });
    t.check(
      repeats,
      satisfies(
        (all: string[]) => all.length === 0,
        "no changed file holds a pasted copy of its own lines"
      )
    );

    const checks = await verifyBranch(delivered.head.ref);
    for (const check of checks.filter((c) => !c.passed)) {
      t.log(`${check.name} failed on ${delivered.head.ref}:\n${check.output}`);
    }
    t.check(
      checks,
      satisfies(
        (all: typeof checks) => all.length > 0 && all.every((c) => c.passed),
        "the delivered branch passes the repository's checks"
      )
    );

    t.judge.autoevals
      .closedQA(
        "Does the submission link a pull request, say what was built, and give the review verdict?",
        { on: turns.at(-1)?.message ?? "" }
      )
      .atLeast(0.5);
  },
  timeoutMs: 2_700_000,
});
