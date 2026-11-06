import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createPresenceOwnerApi, publicPresence, presenceRow, listeningDisclosure} from '../src/presence-api.mjs';
import {createHandler} from '../src/worker.mjs';

const start=Date.parse('2026-11-06T17:00:00.000Z');
const owner={access:{aud:'synthetic-audience',getIdentity:async()=>({email:'owner@example.test'})}};
function fixture() {
  const sql=new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../migrations/0002_presence.sql',import.meta.url),'utf8'));
  sql.exec(readFileSync(new URL('../migrations/0003_presence_preferences.sql',import.meta.url),'utf8'));
  sql.exec(readFileSync(new URL('../migrations/0004_editor_pairing.sql',import.meta.url),'utf8'));
  const db={prepare(query){
    const statement=sql.prepare(query);let values=[];
    return {bind(...v){values=v;return this;},async first(){return statement.get(...values)||null;},async run(){return {meta:{changes:Number(statement.run(...values).changes)}};}};
  }};
  const env={PRESENCE_ENABLED:'true',PRESENCE_PUBLIC_RELEASE_APPROVED:'true',LISTENING_DB:db,
    LISTENING_OWNER_EMAIL:'owner@example.test',LISTENING_ACCESS_AUD:'synthetic-audience'};
  let time=start;
  const clock=()=>time;
  const api=createPresenceOwnerApi({clock});
  const request=(data,headers={})=>new Request('https://devonakins.com/api/presence/owner',{
    method:data?'POST':'GET',headers:{Origin:'https://devonakins.com','Content-Type':'application/json',...headers},
    ...(data?{body:JSON.stringify(data)}:{}),
  });
  const write=async(action,extra={})=>api(request({action,revision:(await presenceRow(env)).revision,...extra}),env,owner);
  return {env,api,request,write,sql,clock,advance(ms=1100){time+=ms;}};
}
const hidden=async()=>Response.json({version:1,mode:'hidden'});
test('custom public statuses require explicit review, expire and obey privacy shutoff',async()=>{
  const f=fixture();
  await f.write('settings',{enabled:true,privateWork:false,shareListening:false});f.advance();
  for(const extra of [{label:'Editing a chapter',labelApproved:false},{label:'Hidden\nline',labelApproved:true},{label:'a'.repeat(61),labelApproved:true}])
    assert.equal((await f.write('manual',{status:'custom',minutes:15,...extra})).status,400);
  assert.equal((await f.write('manual',{status:'custom',minutes:15,label:'Editing a new chapter',labelApproved:true})).status,200);
  const view=await publicPresence(f.env,hidden,f.clock);assert.equal(view.state,'custom');assert.equal(view.label,'Editing a new chapter');
  f.advance(16*60_000);assert.equal((await publicPresence(f.env,hidden,f.clock)).state,'offline');
  await f.write('off');assert.equal((await publicPresence(f.env,hidden,f.clock)).visibility,'hidden');
});
test('owner project choices constrain sessions and remove an active disallowed label',async()=>{
  const f=fixture();await activate(f);f.advance();
  assert.equal((await f.write('projects',{projects:['mizvo']})).status,200);
  assert.equal((await publicPresence(f.env,hidden,f.clock)).project,null);f.advance();
  assert.equal((await f.write('start',{projectSlug:'merit',minutes:15})).status,400);
  assert.equal((await f.write('start',{projectSlug:'mizvo',minutes:15})).status,200);f.advance();
  for(const projects of [['../clinical'],['mizvo','mizvo']]) assert.equal((await f.write('projects',{projects})).status,400);
  assert.equal((await f.write('projects',{projects:[]})).status,200);
  assert.equal((await publicPresence(f.env,hidden,f.clock)).project,null);
});
async function activate(f) {
  assert.equal((await f.write('settings',{enabled:true,privateWork:false,shareListening:true})).status,200);
  f.advance();
  assert.equal((await f.write('start',{projectSlug:'merit',minutes:15})).status,200);
}
test('unconfigured feature touches no database; public view defaults hidden',async()=>{
  const f=fixture();const env={...f.env,PRESENCE_ENABLED:undefined,LISTENING_DB:{prepare(){throw Error('must not query');}}};
  assert.equal((await f.api(f.request(),env,owner)).status,404);
  assert.equal((await publicPresence(env,hidden)).visibility,'hidden');
});
test('owner controls reject spoofed headers, wrong audience, wrong identity and cross-site posts',async()=>{
  const f=fixture();
  for(const context of [{},{access:{...owner.access,aud:'other'}},{access:{...owner.access,getIdentity:async()=>({email:'someone@example.test'})}}]) {
    assert.equal((await f.api(f.request(null,{'Cf-Access-Authenticated-User-Email':'owner@example.test'}),f.env,context)).status,403);
  }
  for(const headers of [{Origin:'https://evil.example'},{'Sec-Fetch-Site':'cross-site'},{Origin:'null'}]) {
    assert.equal((await f.api(f.request({action:'off',revision:0},headers),f.env,owner)).status,403);
  }
});
test('public release requires separate approval, even for an authenticated owner',async()=>{
  const f=fixture();f.env.PRESENCE_PUBLIC_RELEASE_APPROVED='false';
  assert.equal((await f.write('settings',{enabled:true,privateWork:false,shareListening:true})).status,403);
  assert.equal((await f.write('start',{projectSlug:'merit',minutes:15})).status,200);
  assert.equal((await publicPresence(f.env,hidden,f.clock)).visibility,'hidden');
});
test('real SQLite state supports session, pause, resume, 15-minute expiration and end',async()=>{
  const f=fixture();await activate(f);
  let state=await publicPresence(f.env,hidden,f.clock);
  assert.equal(state.state,'developing');assert.equal(state.source,'owner-declared');assert.equal(state.project,'Merit');
  f.advance();assert.equal((await f.write('pause')).status,200);
  assert.equal((await publicPresence(f.env,hidden,f.clock)).state,'idle');
  f.advance();assert.equal((await f.write('resume',{minutes:15,projectSlug:'mizvo'})).status,200);
  assert.equal((await publicPresence(f.env,hidden,f.clock)).project,'Mizvo');
  f.advance(15*60_000);
  state=await publicPresence(f.env,hidden,f.clock);assert.equal(state.state,'idle');assert.equal(state.project,null);
  f.advance();assert.equal((await f.write('end')).status,200);
  assert.equal((await publicPresence(f.env,hidden,f.clock)).state,'offline');
});
test('music is independent; private mode hides all sources and private status expires',async()=>{
  const f=fixture();await activate(f);
  let calls=0;const music=async()=>{calls++;return Response.json({version:1,mode:'playing',updatedAt:new Date(f.clock()).toISOString()});};
  assert.equal((await publicPresence(f.env,music,f.clock)).state,'in-the-zone');
  f.advance();await f.write('settings',{enabled:true,privateWork:true,shareListening:true});
  const state=await publicPresence(f.env,music,f.clock);assert.equal(state.state,'working-privately');assert.equal(state.project,null);
  assert.equal(calls,1);assert.equal((await listeningDisclosure(f.env)).allowed,false);
  f.advance(16*60_000);assert.equal((await publicPresence(f.env,music,f.clock)).state,'idle');
});
test('manual family/sleep states are explicit and expire without restoring old sessions',async()=>{
  const f=fixture();await activate(f);f.advance();
  assert.equal((await f.write('manual',{status:'family-time',minutes:15})).status,200);
  assert.equal((await publicPresence(f.env,hidden,f.clock)).state,'family-time');
  f.advance(16*60_000);assert.equal((await publicPresence(f.env,hidden,f.clock)).state,'offline');
});
test('kill switch fences delayed Spotify responses and stale re-enable requests',async()=>{
  const f=fixture();await activate(f);const previous=await presenceRow(f.env);
  let release,entered;const started=new Promise(r=>{entered=r;});
  const delayed=publicPresence(f.env,async()=>{entered();return new Promise(r=>{release=r;});},f.clock);
  await started;
  assert.equal((await f.write('off')).status,200);
  release(Response.json({version:1,mode:'playing',updatedAt:new Date(f.clock()).toISOString()}));
  assert.equal((await delayed).visibility,'hidden');
  f.advance();
  const replay=await f.api(f.request({action:'settings',revision:previous.revision,enabled:true,privateWork:false,shareListening:true}),f.env,owner);
  assert.equal(replay.status,409);
  assert.equal((await listeningDisclosure(f.env)).allowed,false);
  assert.equal((await f.write('off',{revision:0})).status,200);
});
test('database CAS rejects two concurrent owner updates; cooldown never blocks shutoff',async()=>{
  const f=fixture();const data={action:'start',revision:0,projectSlug:'merit',minutes:15};
  const responses=await Promise.all([f.api(f.request(data),f.env,owner),f.api(f.request(data),f.env,owner)]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  assert.equal((await f.write('pause')).status,429);
  assert.equal((await f.write('off')).status,200);
});
test('strict schema rejects paths, clinical fields, unknown projects and unbounded content',async()=>{
  const f=fixture();
  for(const extra of [{projectSlug:'../patient',minutes:15},{projectSlug:'merit',minutes:2000},{projectSlug:'merit',minutes:15,filename:'patient.md'}]) {
    assert.equal((await f.write('start',extra)).status,400);
  }
  assert.equal((await f.write('manual',{status:'a'.repeat(2000),minutes:15})).status,400);
  assert.equal((await presenceRow(f.env)).revision,0);
});
test('owner status is no-store and preview matches public projection; no private SQL fields escape',async()=>{
  const f=fixture();await activate(f);
  const response=await f.api(f.request(),f.env,owner);assert.match(response.headers.get('Cache-Control'),/no-store/);
  const data=await response.json();assert.deepEqual(data.preview,await publicPresence(f.env,hidden,f.clock));
  assert.doesNotMatch(JSON.stringify(data),/session_source|changed_at|private_key|patient/);
});
test('actual Worker routes reject anonymous owner writes, never cache presence, and suppress music',async()=>{
  const f=fixture();const handler=createHandler({}, {version:'test'}, {now:()=>new Date(f.clock())});
  const response=await handler.fetch(new Request('https://devonakins.com/api/presence/public'),f.env);
  assert.equal(response.status,200);assert.equal((await response.json()).visibility,'hidden');assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal((await handler.fetch(f.request({action:'off',revision:0}),f.env)).status,403);
  const music=await handler.fetch(new Request('https://devonakins.com/api/listening/now'),f.env);
  assert.equal((await music.json()).mode,'hidden');assert.equal(music.headers.get('X-Content-Type-Options'),'nosniff');
  const head=await handler.fetch(new Request('https://devonakins.com/api/listening/now',{method:'HEAD'}),f.env);
  assert.equal(await head.text(),'');
});
