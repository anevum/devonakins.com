import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAgentEvent,
  syncAgentTurnPresence,
} from '../scripts/agent-presence-bridge.mjs';

async function* stream(...events) { for (const event of events) yield event; }
const root = (type) => ({ type, turn: { subagent_id: null } });
const subagent = (type) => ({ type, turn: { subagent_id: 'sub1' } });
function harness(events, opts = {}) {
  const calls = [];
  let at = 100_000;
  const run = syncAgentTurnPresence({
    events,
    file: '/private/task1.json',
    projectSlug: 'mizvo',
    clock: () => at,
    report: async (args) => { calls.push(args); },
    ...opts,
  });
  return { run, calls, setTime: (time) => { at = time; } };
}

test('maps only verified root lifecycle; subagent outcomes do not stop work', () => {
  assert.equal(classifyAgentEvent(root('agent.session.turn.completed')).state, 'completed');
  assert.equal(classifyAgentEvent(root('agent.session.turn.failed')).state, 'failed');
  assert.equal(classifyAgentEvent(subagent('agent.session.turn.completed')), null);
  assert.equal(classifyAgentEvent({type:'agent.session.idle'}), null);
  assert.equal(classifyAgentEvent({type:'agent.session.requires_action'}).state, 'waiting');
  assert.equal(classifyAgentEvent({type:'agent.session.turn.completed'}), null);
});

test('emits only fixed public-safe fields and never source content', async () => {
  const privateText = 'PRIVATE_CLIENT_TRANSCRIPT';
  const f = harness(stream(
    {type:'agent.session.turn.output_text.delta', delta:privateText, prompt:privateText, session_id:privateText},
    subagent('agent.session.turn.completed'),
    root('agent.session.turn.completed'),
  ));
  const result = await f.run;
  assert.equal(result.outcome, 'completed');
  assert.deepEqual(f.calls.map(x=>x.state), ['running','completed']);
  for (const call of f.calls) {
    assert.deepEqual(Object.keys(call).sort(), ['checkpoint','clock','command','file','projectSlug','state'].sort());
    assert.equal(call.projectSlug,'mizvo');
    assert.equal(call.checkpoint,null);
    assert.doesNotMatch(JSON.stringify(call), /PRIVATE_CLIENT_TRANSCRIPT/);
    assert.notEqual(call.state, 'tests-passed');
  }
});

test('requires_action waits; no false restart on incidental output', async () => {
  const f = harness(stream(
    {type:'agent.session.requires_action', required_actions:[{secret:'DO_NOT_SHARE'}]},
    {type:'agent.session.turn.output_text.delta', delta:'private'},
    root('agent.session.turn.cancelled'),
  ));
  assert.equal((await f.run).outcome, 'cancelled');
  assert.deepEqual(f.calls.map(x=>x.state), ['running','waiting','cancelled']);
});

test('disconnection expires normally and does not fabricate a result', async () => {
  const f = harness(stream({type:'agent.session.idle'}));
  assert.equal((await f.run).outcome,'unverified-disconnect');
  assert.deepEqual(f.calls.map(x=>x.state), ['running']);
});

test('telemetry errors do not interrupt the agent, and raw errors are redacted', async () => {
  const markers=[];
  const result = await syncAgentTurnPresence({
    events:stream(root('agent.session.turn.failed')),
    file:'/private/task1.json',
    projectSlug:null,
    report:async()=>{ throw Error('SENSITIVE_TOKEN_VALUE'); },
    onReporterFailure:(msg)=>markers.push(msg),
  });
  assert.equal(result.outcome,'failed');
  assert.equal(result.deliveryFailures,2);
  assert.deepEqual(markers,['presence-unavailable','presence-unavailable']);
});

test('refuses invalid projects, missing private file and untrusted streams', async () => {
  await assert.rejects(syncAgentTurnPresence({events:stream(),file:'/private/task1.json',projectSlug:'patient/123'}));
  await assert.rejects(syncAgentTurnPresence({events:stream(),file:'',projectSlug:'mizvo'}));
  await assert.rejects(syncAgentTurnPresence({events:[],file:'/private/task1.json',projectSlug:'mizvo'}));
  await assert.rejects(syncAgentTurnPresence({events:stream(),file:'/private/task1.json',heartbeatMs:1000}));
});

test('active event stream permits spaced heartbeats, not a timer-driven false signal', async () => {
  let at=100_000;
  const calls=[];
  async function* events() {
    yield {type:'agent.session.turn.output_text.delta'};
    at+=60_001;
    yield {type:'agent.session.turn.output_text.delta'};
    yield root('agent.session.turn.completed');
  }
  const result=await syncAgentTurnPresence({
    events:events(),file:'/private/task1.json',projectSlug:'mizvo',
    report:async x=>{calls.push(x.state);},clock:()=>at,
  });
  assert.equal(result.outcome,'completed');
  assert.deepEqual(calls,['running','running','completed']);
});

test('transport error event is unverified, never a fabricated failed turn', async () => {
  const calls = [];
  const outcome = await syncAgentTurnPresence({
    events: stream({type:'error',error:{message:'PRIVATE_NETWORK_CREDENTIAL'}}),
    file:'/private/task1.json',projectSlug:'mizvo',
    report:async ({state})=>calls.push(state),
  });
  assert.equal(outcome.outcome,'unverified-disconnect');
  assert.deepEqual(calls,['running']);
});

test('only explicit resumed processing ends a waiting state', async () => {
  const calls=[];
  const outcome=await syncAgentTurnPresence({
    events:stream(
      {type:'agent.session.requires_action'},
      {type:'agent.session.turn.output_text.delta',delta:'possibly delayed'},
      {type:'agent.session.in_progress'},
      root('agent.session.turn.completed'),
    ),
    file:'/private/task1.json',projectSlug:'mizvo',
    report:async ({state})=>calls.push(state),
  });
  assert.equal(outcome.outcome,'completed');
  assert.deepEqual(calls,['running','waiting','running','completed']);
});

test('stream exception remains unverified and does not leak sensitive exception detail', async () => {
  async function* interrupted(){yield {type:'agent.session.turn.output_text.delta'};throw new Error('SECRET_SESSION_ID');}
  const calls=[];
  const outcome=await syncAgentTurnPresence({
    events:interrupted(),file:'/private/task1.json',
    report:async ({state})=>calls.push(state),
  });
  assert.equal(outcome.outcome,'unverified-disconnect');
  assert.deepEqual(calls,['running']);
});
