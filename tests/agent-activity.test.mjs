import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyAgentActivityEvent, reportAgentTurnActivity } from '../scripts/agent-activity.mjs';

const sourceToken = 'S'.repeat(43);
const taskToken = 'T'.repeat(43);
const root = (type, extra = {}) => ({ type, turn: { subagent_id: null }, ...extra });
const subagent = (type) => ({ type, turn: { subagent_id: 'other' } });

function harness(sequence, options = {}) {
  let now = 100_000;
  const calls = [];
  const warnings = [];
  const stream = async function* () {
    for (const [afterMs, event] of sequence) {
      now += afterMs;
      if (event instanceof Error) throw event;
      yield event;
    }
  };
  const request = async (path, body, token) => {
    calls.push({ path, body, token });
    if (path.endsWith('/start')) return {
      token: taskToken, source: 'codex', projectSlug: 'merit', expiresAt: new Date(now + 86400000).toISOString(),
    };
    return { accepted: true };
  };
  const run = reportAgentTurnActivity({
    events: stream(), projectSlug: 'merit', sourceToken,
    request, clock: () => now,
    onReporterFailure: marker => warnings.push(marker), ...options,
  });
  return { run, calls, warnings };
}

test('classifies only authenticated root turn terminal events', () => {
  assert.deepEqual(classifyAgentActivityEvent(root('agent.session.turn.completed')),{kind:'terminal',state:'completed'});
  assert.deepEqual(classifyAgentActivityEvent(root('agent.session.turn.failed')),{kind:'terminal',state:'failed'});
  assert.deepEqual(classifyAgentActivityEvent(root('agent.session.turn.cancelled')),{kind:'terminal',state:'cancelled'});
  assert.equal(classifyAgentActivityEvent(subagent('agent.session.turn.completed')),null);
  assert.equal(classifyAgentActivityEvent({type:'agent.session.turn.completed'}),null);
  assert.equal(classifyAgentActivityEvent({type:'agent.session.idle'}),null);
  assert.deepEqual(classifyAgentActivityEvent({type:'agent.session.requires_action'}),{kind:'state',state:'waiting'});
  assert.deepEqual(classifyAgentActivityEvent({type:'error',message:'PRIVATE'}),{kind:'disconnect'});
  assert.equal(classifyAgentActivityEvent({type:'agent.session.turn.untrusted.ran'}),null);
});

test('confirmed work reports fixed bounded checkpoints without any private provider content', async()=>{
  const SECRET='PRIVATE_PROMPTS_COMMAND_OUTPUT_SESSION_ID';
  const h=harness([
    [31_000,{type:'agent.session.turn.output_text.delta',delta:SECRET,session_id:SECRET,turn:{subagent_id:null}}],
    [1_000,subagent('agent.session.turn.completed')],
    [5_000,root('agent.session.turn.completed',{prompt:SECRET})],
  ]);
  assert.deepEqual(await h.run,{outcome:'completed',reported:true,failures:0});
  assert.equal(h.calls.length,3);
  assert.equal(h.calls[0].path,'/api/activity/tasks/start');
  assert.deepEqual(h.calls[0].body,{version:1,projectSlug:'merit'});
  assert.equal(h.calls[0].token,sourceToken);
  assert.deepEqual(h.calls.slice(1).map(c=>[c.body.sequence,c.body.state,c.body.checkpoint]),[
    [1,'running',null],[2,'completed',null],
  ]);
  assert.equal(h.calls[1].token,taskToken);
  assert.equal(h.calls[2].token,taskToken);
  assert.equal(JSON.stringify(h.calls).includes(SECRET),false);
  assert.equal(h.calls.some(x=>x.body.checkpoint==='tests-passed'),false);
});

test('waiting and explicit resumption are reported only after backend cooldown on real events', async()=>{
  const h=harness([
    [1000,{type:'agent.session.requires_action'}],
    [21000,{type:'agent.session.turn.item.completed'}],
    [22000,root('agent.session.turn.in_progress')],
    [2000,root('agent.session.turn.cancelled')],
  ]);
  assert.deepEqual(await h.run,{outcome:'cancelled',reported:true,failures:0});
  assert.deepEqual(h.calls.slice(1).map(x=>x.body.state),['waiting','running','cancelled']);
  assert.deepEqual(h.calls.slice(1).map(x=>x.body.sequence),[1,2,3]);
});

test('stream EOF or error never yields fake completion', async()=>{
  for (const event of [null,{type:'error',error:'PRIVATE'},new Error('PRIVATE network response')]) {
    const h=harness(event===null?[]:[[30000,event]]);
    const result=await h.run;
    assert.equal(result.outcome,'unverified-disconnect');
    assert.equal(result.reported,false);
    assert.deepEqual(h.calls.map(x=>x.path),['/api/activity/tasks/start']);
    assert.equal(JSON.stringify(h.calls).includes('PRIVATE'),false);
  }
});

test('a session failure is a provider-confirmed terminal failure, no tool success inferred',async()=>{
  const h=harness([[1000,{type:'agent.session.environment.failed',error:{message:'PRIVATE'}}]]);
  assert.deepEqual(await h.run,{outcome:'failed',reported:true,failures:0});
  assert.deepEqual(h.calls.slice(1).map(x=>x.body.state),['failed']);
  assert.equal(JSON.stringify(h.calls).includes('PRIVATE'),false);
});

test('invalid source token does not interrupt observed work and never sends task data',async()=>{
  const h=harness([[0,root('agent.session.turn.completed')]],{sourceToken:'bad'});
  assert.deepEqual(await h.run,{outcome:'completed',reported:false,failures:1});
  assert.equal(h.calls.length,0);
  assert.deepEqual(h.warnings,['activity-unavailable']);
});

test('provider source and project must match the chosen reporter, otherwise the events continue privately',async()=>{
  for(const bad of [{source:'github-actions'}, {projectSlug:'rhen'}, {token:'wrong'}, {expiresAt:new Date(100_000).toISOString()}]){
    const calls=[];
    const h=harness([[0,root('agent.session.turn.completed')]],{
      request:async(path)=>{calls.push({path});return {token:taskToken,source:'codex',projectSlug:'merit',expiresAt:new Date(96400000).toISOString(),...bad};},
    });
    assert.deepEqual(await h.run,{outcome:'completed',reported:false,failures:1});
    assert.equal(calls.length,1);
  }
});

test('an unconfirmed task signal does not claim delivered status or reveal provider error',async()=>{
  const calls=[];
  const h=harness([[30000,root('agent.session.turn.failed',{private_context:'PRIVATE'})]],{
    request:async(path,body,token)=>{
      calls.push({path,body,token});
      if(path.endsWith('/start')) return {token:taskToken,source:'codex',projectSlug:'merit',expiresAt:new Date(96400000).toISOString()};
      throw Error('PRIVATE raw error');
    },
    onReporterFailure:()=>{throw Error('PRIVATE logger failure');},
  });
  assert.deepEqual(await h.run,{outcome:'failed',reported:false,failures:1});
  assert.equal(calls.length,2);
  assert.equal(JSON.stringify(calls).includes('PRIVATE'),false);
});

test('unknown project and untrusted stream contract fail without accessing reporter',async()=>{
  await assert.rejects(reportAgentTurnActivity({events:[],projectSlug:'merit'}),/authenticated asynchronous/);
  await assert.rejects(reportAgentTurnActivity({events:(async function*(){yield {type:'error'};})(),projectSlug:'private-client'}),/fixed approved/);
});

test('brief turn produces only a real terminal update, not a fabricated running heartbeat',async()=>{
  const h=harness([[200,{type:'agent.session.requires_action'}],[100,root('agent.session.turn.completed')]]);
  assert.equal((await h.run).reported,true);
  assert.deepEqual(h.calls.slice(1).map(x=>x.body.state),['completed']);
});
