import { defineState } from "eve/context";
import type { HookEventMap } from "eve/hooks";

/**
 * The opening of the message eve sends to wake a session when one of its
 * background tasks ends, e.g.
 * "Background task task_… (reviewer) is completed.\n\nResult:\n{…}".
 * Progress updates ("… update: …") and input requests do not end the task.
 */
const TASK_END =
  /^Background task (\S+) \(([^)]+)\) (?:is )?(completed|failed|cancelled)\b/;
const RESULT_MARKER = "\n\nResult:\n";

export interface StationEnd {
  /** The task's result text; eve writes structured output as JSON. */
  result?: string;
  station: string;
  status: "cancelled" | "completed" | "failed";
  taskId: string;
}

/**
 * Reads a background-task wake message.
 *
 * @returns The ended station, or `undefined` for any other message.
 */
export function parseStationEnd(message: string): StationEnd | undefined {
  const match = TASK_END.exec(message);
  if (!match) {
    return;
  }
  const [, taskId = "", station = "", status] = match;
  const at = message.indexOf(RESULT_MARKER);
  return {
    result: at === -1 ? undefined : message.slice(at + RESULT_MARKER.length),
    station,
    status: status as StationEnd["status"],
    taskId,
  };
}

/**
 * The `verdict` field of the reviewer's structured output.
 *
 * @returns `approve`, `request_changes` or `reject`, or `undefined` when the
 * text is not a review.
 */
export function reviewVerdict(output: string | undefined): string | undefined {
  let parsed: { verdict?: unknown } | null;
  try {
    parsed = JSON.parse(output ?? "");
  } catch {
    return;
  }
  return typeof parsed?.verdict === "string" ? parsed.verdict : undefined;
}

export interface PipelineState {
  /**
   * Goes up each time an implementer run starts or ends, so a review counts
   * only for the code it saw. Zero until the session starts the implementer.
   */
  revision: number;
  /** Stations still working, by background task id. */
  running: Record<string, { revision: number; station: string }>;
  /** The reviewer's verdict on the current revision. */
  verdict: string | null;
}

export const initialPipeline = (): PipelineState => ({
  revision: 0,
  running: {},
  verdict: null,
});

/**
 * The foreman session's view of its stations, kept by `agent/hooks/pipeline.ts`
 * and read by the `createPullRequest` approval policy.
 */
export const pipelineState = defineState<PipelineState>(
  "factory.pipeline",
  initialPipeline
);

export type PipelineEvent = HookEventMap[
  | "message.received"
  | "subagent.completed"];

const bumpRevision = (state: PipelineState): PipelineState => ({
  ...state,
  revision: state.revision + 1,
  verdict: null,
});

const implementerRunning = (state: PipelineState): boolean =>
  Object.values(state.running).some((task) => task.station === "implementer");

/**
 * @param startedOn - The revision the station started on, or `undefined`
 * when it is not known.
 */
const endStation = (
  state: PipelineState,
  station: string,
  startedOn: number | undefined,
  result: string | undefined
): PipelineState => {
  if (station === "implementer") {
    return bumpRevision(state);
  }
  if (station !== "reviewer" || startedOn !== state.revision) {
    return state;
  }
  return { ...state, verdict: reviewVerdict(result) ?? null };
};

/**
 * Applies one session event to the pipeline state. The hook and the label
 * eval both use it, so the eval sees what the guard saw.
 *
 * @remarks
 * A background station starts with the `subagent.completed` event that
 * returns its task, and ends with the wake message. eve sends
 * `subagent.called` for a background station to the channel adapter only,
 * never to app hooks, so an earlier version that recorded the reviewed
 * revision there never counted an approval and refused every pull request.
 */
export function advancePipeline(
  state: PipelineState,
  event: PipelineEvent
): PipelineState {
  switch (event.type) {
    case "subagent.completed": {
      const { backgroundTask, output, subagentName } = event.data;
      if (!backgroundTask) {
        // A foreground station ran inside this turn, so it saw the current
        // revision unless an implementer was working beside it.
        return endStation(
          state,
          subagentName,
          implementerRunning(state) ? undefined : state.revision,
          output
        );
      }
      const next = subagentName === "implementer" ? bumpRevision(state) : state;
      return {
        ...next,
        running: {
          ...next.running,
          [backgroundTask.taskId]: {
            revision: next.revision,
            station: subagentName,
          },
        },
      };
    }
    case "message.received": {
      const end = parseStationEnd(event.data.message);
      if (!end) {
        return state;
      }
      const { [end.taskId]: task, ...running } = state.running;
      return endStation(
        { ...state, running },
        end.station,
        task?.revision,
        end.result
      );
    }
    default:
      return state;
  }
}

/**
 * Why the foreman may not open a pull request yet.
 *
 * @remarks
 * The prompt already says to deliver only after an approval, and a model can
 * still start a revision and open the pull request in the same turn. Sessions
 * that never started the implementer are not held, so a person can still ask
 * for a pull request on an existing branch.
 *
 * @returns The reason to give the model, or `undefined` when delivery may go
 * ahead.
 */
export function deliveryHold(
  state: PipelineState = pipelineState.get()
): string | undefined {
  const { revision, running, verdict } = state;
  if (revision === 0) {
    return;
  }
  const busy = Object.values(running).map((task) => task.station);
  if (busy.length > 0) {
    return `Not yet: ${busy.join(", ")} is still running, and no pull request exists yet. Wait for it to finish, and open the pull request only after the reviewer approves the latest revision.`;
  }
  if (verdict !== "approve") {
    return `Not yet: the reviewer has not approved the latest revision (latest verdict: ${verdict ?? "none"}), and no pull request exists yet. Follow the review loop, and open the pull request only after the reviewer approves.`;
  }
}
