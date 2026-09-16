import type { HookContext } from "eve/hooks";

/**
 * Picks the Sentry conversation id for `eveConversationHook`: eve's root
 * session id, so the foreman and every station of one issue share one
 * conversation.
 *
 * @remarks
 * A declared subagent inherits no hooks from the root agent, so the root
 * agent and each subagent have their own `hooks/sentry.ts` that uses this.
 * `@sentry/node` 11.0.0-rc.0 types the hook context as `{ session: { id } }`
 * only, so reading `session.parent` needs eve's own `HookContext`.
 */
export function getConversationId(context: {
  session: { id: string };
}): string {
  const { session } = context as HookContext;
  return session.parent?.rootSessionId ?? session.id;
}
