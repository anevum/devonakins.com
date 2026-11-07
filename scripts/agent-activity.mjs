/**
 * Private, event-driven bridge for ONE confirmed root turn of an authenticated
 * OpenAI Agents API stream. The caller owns session creation, authorization,
 * turn submission, recovery and tool-result verification.
 *
 * Only fixed-state reports reach the existing source-scoped V4 task API.
 * Raw events, prompts, tool output, usage and session identifiers never do.
 */
import { activityRequest } from './activity-run.mjs';
import { PUBLIC_PRESENCE_PROJECTS } from '../src/presence-model.mjs';

const TERMINAL = Object.freeze({
  'agent.session.turn.completed': 'completed',
  'agent.session.turn.failed': 'failed',
  'agent.session.turn.cancelled': 'cancelled',
});
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const REPORTER_SOURCES = new Set(['codex', 'chatgpt-work']);
const PROGRESS = new Set([
  'agent.session.turn.created',
  'agent.session.turn.in_progress',
  'agent.session.turn.output_text.delta',
  'agent.session.turn.item.added',
  'agent.session.turn.item.completed',
  'agent.session.turn.item.updated',
  'agent.session.subagent.created',
  'agent.session.subagent.active',
]);

export function classifyAgentActivityEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event) ||
      typeof event.type !== 'string') return null;
  const type = event.type;
  if (Object.hasOwn(TERMINAL, type)) {
    // Subagent completion cannot establish the root turn's outcome.
    return event.turn?.subagent_id === null
      ? { kind: 'terminal', state: TERMINAL[type] }
      : null;
  }
  if (type === 'agent.session.failed' || type === 'agent.session.environment.failed')
    return { kind: 'terminal', state: 'failed' };
  if (type === 'error') return { kind: 'disconnect' };
  if (type === 'agent.session.requires_action')
    return { kind: 'state', state: 'waiting' };
  if (type === 'agent.session.in_progress' ||
      (type === 'agent.session.turn.in_progress' && event.turn?.subagent_id === null))
    return { kind: 'state', state: 'running' };
  if (type === 'agent.session.idle') return null;
  if (PROGRESS.has(type)) return { kind: 'progress' };
  return null;
}

/**
 * Call after a private dispatcher has successfully submitted one root turn.
 * events must come from that turn's authenticated stream, not a public feed.
 * Do not use this to watch arbitrary ChatGPT Work conversations.
 *
 * Reports are evidence-triggered: no timers or fake activity heartbeats.
 * Backend imposes a 20-second nonterminal signal cooldown. Transitions seen
 * sooner are held until the next genuine event; a root terminal event can be
 * reported immediately, without delaying or fabricating a waiting state.
 */
export async function reportAgentTurnActivity({
  events,
  projectSlug,
  sourceToken = process.env.DEVON_ACTIVITY_SOURCE_TOKEN,
  fetcher = fetch,
  clock = Date.now,
  request = activityRequest,
  onReporterFailure = () => {},
} = {}) {
  if (!events || typeof events[Symbol.asyncIterator] !== 'function')
    throw Error('An authenticated asynchronous agent stream is required.');
  if (typeof projectSlug !== 'string' ||
      !Object.hasOwn(PUBLIC_PRESENCE_PROJECTS, projectSlug))
    throw Error('A fixed approved public project slug is required.');

  function warn() {
    try { onReporterFailure('activity-unavailable'); } catch { /* private diagnostics cannot affect work */ }
  }
  let taskToken = null;
  let sequence = 0;
  let lastAttempt = clock();
  let reportedState = 'running'; // A successful task start creates running state.
  let wantedState = 'running';
  let failures = 0;

  if (TOKEN.test(sourceToken || '')) {
    try {
      const started = await request(
        '/api/activity/tasks/start', { version: 1, projectSlug }, sourceToken, fetcher,
      );
      if (!TOKEN.test(started?.token || '') ||
          started?.projectSlug !== projectSlug ||
          !REPORTER_SOURCES.has(started?.source) ||
          !Number.isFinite(Date.parse(started?.expiresAt)) ||
          Date.parse(started.expiresAt) <= clock())
        throw Error('Invalid private task receipt');
      taskToken = started.token;
      lastAttempt = clock();
    } catch {
      failures++;
      warn();
    }
  } else {
    failures++;
    warn();
  }

  async function signal(state, now) {
    if (!taskToken) return false;
    lastAttempt = now;
    try {
      const result = await request('/api/activity/tasks/signal', {
        version: 1,
        sequence: ++sequence,
        state,
        checkpoint: null,
        observedAt: new Date(now).toISOString(),
      }, taskToken, fetcher);
      if (result?.accepted !== true) throw Error('Unconfirmed delivery');
      reportedState = state;
      return true;
    } catch {
      failures++;
      warn();
      return false;
    }
  }

  try {
    for await (const event of events) {
      const phase = classifyAgentActivityEvent(event);
      if (!phase) continue;
      if (phase.kind === 'disconnect') {
        return { outcome: 'unverified-disconnect', reported: false, failures };
      }
      const now = clock();
      if (!Number.isFinite(now)) {
        return { outcome: 'unverified-disconnect', reported: false, failures };
      }
      if (phase.kind === 'terminal') {
        const reported = await signal(phase.state, now);
        return { outcome: phase.state, reported, failures };
      }
      if (phase.kind === 'state') wantedState = phase.state;
      if (taskToken && now - lastAttempt >= 21_000 && wantedState !== reportedState) {
        await signal(wantedState, now);
      } else if (taskToken && now - lastAttempt >= 30_000 &&
                 wantedState === 'running' && phase.kind === 'progress') {
        await signal('running', now);
      }
    }
  } catch {
    // Transport errors are not proof that the agent failed or completed.
    // The authenticated controller must retrieve saved turn state itself.
  }
  return { outcome: 'unverified-disconnect', reported: false, failures };
}
