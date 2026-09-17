import { defineHook } from "eve/hooks";
import {
  advancePipeline,
  type PipelineEvent,
  pipelineState,
} from "../lib/pipeline.js";

/**
 * Keeps {@link pipelineState} current. Hooks run before the session's next
 * step, so the `createPullRequest` policy sees a background station as soon as
 * its launch returns.
 */
const track = (event: PipelineEvent) => {
  pipelineState.update((state) => advancePipeline(state, event));
};

export default defineHook({
  events: {
    "message.received": track,
    "subagent.completed": track,
  },
});
