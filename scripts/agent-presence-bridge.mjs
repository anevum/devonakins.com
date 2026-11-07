/** Private-runner adapter for one confirmed OpenAI Agents API root turn.
 * Never forwards agent messages, tool payloads, session IDs or credentials.
 */
import { reportCloud } from './cloud-presence.mjs';

const terminalTypes = Object.freeze({
  'agent.session.turn.completed': 'completed',
  'agent.session.turn.failed': 'failed',
  'agent.session.turn.cancelled': 'cancelled',
});

export function classifyAgentEvent(event) {
  if (!event || typeof event !== 'object' || typeof event.type !== 'string') return null;
  const type = event.type;
  if (Object.hasOwn(terminalTypes, type)) {
    // Subagents may finish while the parent is still working; never end the
    // root task based on a subagent's turn outcome.
    return event.turn?.subagent_id === null
      ? { state: terminalTypes[type], terminal: true }
      : null;
  }
  if (type === 'agent.session.requires_action')
    return { state: 'waiting', terminal: false };
  if (type === 'error' || type === 'agent.session.failed' ||
      type === 'agent.session.environment.failed')
    return { state: 'failed', terminal: true };
  if (type.startsWith('agent.session.turn.') &&
      !type.startsWith('agent.session.turn.output_text.done'))
    return { state: 'progress', terminal: false };
  return null;
}

/**
 * Call only *after* the private controller has successfully submitted a root
 * turn and subscribed to its authenticated event stream.
 *
 * The existing site only permits one paired cloud task. Do not fan out many
 * root turns through one credential; v2 multi-task storage is a separate change.
 * The caller must still inspect saved turn output and independently verify work.
 */
export async function syncAgentTurnPresence({
  events,
  file,
  projectSlug = null,
  report = reportCloud,
  clock = Date.now,
  heartbeatMs = 60_000,
  onReporterFailure = () => {},
}) {
  if (!events || typeof events[Symbol.asyncIterator] !== 'function')
    throw Error('An authenticated agent event stream is required.');
  if (typeof file !== 'string' || !file.trim())
    throw Error('A task-private credential file is required.');
  if (projectSlug !== null &&
      (typeof projectSlug !== 'string' || !/^[a-z0-9-]{1,48}$/.test(projectSlug)))
    throw Error('Select one approved public project slug or private mode.');
  if (!Number.isSafeInteger(heartbeatMs) || heartbeatMs < 21_000)
    throw Error('Unsafe reporter heartbeat interval.');

  let state = 'running';
  let lastAttempt = -Infinity;
  let deliveryFailures = 0;
  async function safeSend(nextState) {
    lastAttempt = clock();
    try {
      await report({
        command: 'signal',
        file,
        projectSlug,
        state: nextState,
        checkpoint: null,
        clock,
      });
    } catch {
      deliveryFailures++;
      // Only a fixed marker, never the provider error or credential path.
      onReporterFailure('presence-unavailable');
    }
  }

  await safeSend('running');
  for await (const event of events) {
    const outcome = classifyAgentEvent(event);
    if (!outcome) continue;
    if (outcome.terminal) {
      await safeSend(outcome.state);
      return { outcome: outcome.state, deliveryFailures };
    }
    if (outcome.state === 'waiting') {
      if (state !== 'waiting') {
        state = 'waiting';
        await safeSend('waiting');
      }
    } else if (state === 'running' && clock() - lastAttempt >= heartbeatMs) {
      // Real, current stream activity only. A disconnected or silent stream
      // cannot keep the public page alive; the server TTL expires naturally.
      await safeSend('running');
    }
  }
  // A stream disconnect is NOT proof the agent failed, stopped or completed.
  return { outcome: 'unverified-disconnect', deliveryFailures };
}
