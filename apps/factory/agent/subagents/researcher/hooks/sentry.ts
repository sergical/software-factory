import { eveConversationHook } from "@sentry/node";
import { defineHook } from "eve/hooks";
import { getConversationId } from "../../../lib/sentry-conversation.js";

export default defineHook(eveConversationHook({ getConversationId }));
