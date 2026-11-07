import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createPresenceEditorApi} from '../src/presence-editor-api.mjs';
import {createPresenceOwnerApi,publicPresence} from '../src/presence-api.mjs';
const start=Date.parse('2026-11-06T20:00:00.000Z');
const ctx={access:{aud:'synthetic-owner',getIdentity:async()=>({email:'owner@example.test'})}};
function fixture(){
  const raw=new DatabaseSync(':memory:');
  for(const name of ['0002_presence.sql','0003_presence_preferences.sql','0004_editor_pairing.sql'])raw.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  const db={prepare(query){const stmt=raw.prepare(query);let args=[];return {bind(...values){args=values;return this;},async first(){return stmt.get(...args)||null;},async run(){return{meta:{changes:Number(stmt.run(...args).changes)}};}};}};
  let time=start;const clock=()=>time;
  const env={PRESENCE_ENABLED:'true',PRESENCE_EDITOR_ENABLED:'true',PRESENCE_PUBLIC_RELEASE_APPROVED:'true',LISTENING_DB:db,LISTENING_ACCESS_AUD:'synthetic-owner',LISTENING_OWNER_EMAIL:'owner@example.test'};
  const editor=createPresenceEditorApi({clock});const owner=createPresenceOwnerApi({clock});
  const req=(path,body,headers={},method='POST')=>new Request('https://devonakins.com'+path,{method,headers:{'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
  async function change(action,extra={}){const row=await db.prepare('SELECT * FROM presence_state WHERE id=1').first();return owner(req('/api/presence/owner',{action,revision:row.revision,...extra},{Origin:'https://devonakins.com'}),env,ctx);}
  async function pair(){const response=await editor(req('/api/presence/editor/pairing',null,{Origin:'https://devonakins.com'}),env,ctx);assert.equal(response.status,200);const {pairCode}=await response.json();const claim=await editor(req('/api/presence/editor/claim',{pairCode}),env);assert.equal(claim.status,200);return{pairCode,...await claim.json()};}
  const hb=(token,extra={})=>editor(req('/api/presence/editor/heartbeat',{version:1,active:true,projectSlug:'merit',observedAt:new Date(time).toISOString(),...extra},{Authorization:'Bearer '+token}),env);
  return{raw,db,env,ctx,editor,owner,req,pair,hb,change,clock,advance(ms=60_000){time+=ms;}};
}
const hidden=async()=>Response.json({version:1,mode:'hidden'});
test('a newer stop clears the real SQLite editor session even within the last edit millisecond',async()=>{
  const f=fixture();const {token}=await f.pair();
  await f.change('settings',{enabled:true,privateWork:false,shareListening:false,editorEnabled:true});
  assert.equal((await f.hb(token)).status,200);
  assert.equal((await f.hb(token,{active:false})).status,409,'an equal timestamp is a replay');
  assert.equal((await f.hb(token,{active:false,observedAt:new Date(f.clock()+1).toISOString()})).status,200);
  const state=await f.db.prepare('SELECT * FROM presence_state WHERE id=1').first();
  assert.equal(state.session_source,null);assert.equal(state.session_until,0);assert.equal(state.project_slug,null);
});
test('editor routes stay disabled by default and pairing requires trusted owner plus Origin',async()=>{
  const f=fixture();const request=f.req('/api/presence/editor/pairing');
  assert.equal((await f.editor(request,{...f.env,PRESENCE_EDITOR_ENABLED:undefined},ctx)).status,404);
  assert.equal((await f.editor(request,f.env,{})).status,403);
  assert.equal((await f.editor(request,f.env,ctx)).status,403);
});
test('one-use pairing is atomic, expires, stores hashes only, and grants no owner control access',async()=>{
  const f=fixture();const {token,pairCode}=await f.pair();
  const stored=await f.db.prepare('SELECT * FROM presence_editor').first();
  assert.notEqual(stored.token_hash,token);assert.equal(stored.pair_hash,null);
  assert.equal((await f.editor(f.req('/api/presence/editor/claim',{pairCode}),f.env)).status,403);
  assert.equal((await f.owner(f.req('/api/presence/owner',{action:'off',revision:0},{Authorization:'Bearer '+token}),f.env,{})).status,403);
  const before=await f.editor(f.req('/api/presence/editor/pairing',null,{Origin:'https://devonakins.com'}),f.env,ctx);
  const code=(await before.json()).pairCode;f.advance(301_000);
  assert.equal((await f.editor(f.req('/api/presence/editor/claim',{pairCode:code}),f.env)).status,403);
});
test('observed edits expire, retain provenance and cannot override an owner session or pause',async()=>{
  const f=fixture();const {token}=await f.pair();
  assert.equal((await f.hb(token)).status,409);
  await f.change('settings',{enabled:true,privateWork:false,shareListening:false,editorEnabled:true});
  assert.equal((await f.hb(token)).status,200);
  const projection=await publicPresence(f.env,hidden,f.clock);
  assert.equal(projection.source,'editor-heartbeat');assert.equal(projection.project,'Merit');
  f.advance(121_000);assert.equal((await publicPresence(f.env,hidden,f.clock)).state,'idle');
  await f.change('start',{minutes:15,projectSlug:'mizvo'});f.advance();
  assert.equal((await f.hb(token)).status,409);
  assert.equal((await publicPresence(f.env,hidden,f.clock)).source,'owner-declared');
  await f.change('pause');f.advance();assert.equal((await f.hb(token)).status,409);
});
test('master shutoff invalidates an existing editor token even after broadcasting is re-enabled',async()=>{
  const f=fixture();const {token}=await f.pair();
  await f.change('settings',{enabled:true,privateWork:false,shareListening:false,editorEnabled:true});
  await f.hb(token);await f.change('off');f.advance();
  await f.change('settings',{enabled:true,privateWork:false,shareListening:false,editorEnabled:true});
  assert.equal((await f.hb(token)).status,401);
  assert.equal((await publicPresence(f.env,hidden,f.clock)).state,'offline');
});
test('malformed payloads, private paths, stale/replayed signals and concurrent over-polling are rejected',async()=>{
  const f=fixture();const {token}=await f.pair();
  await f.change('settings',{enabled:true,privateWork:false,shareListening:false,editorEnabled:true});
  for(const extra of [{filename:'patient.md'},{projectSlug:'../client'},{observedAt:'invalid'}])assert.equal((await f.hb(token,extra)).status,400);
  assert.equal((await f.hb(token)).status,200);assert.equal((await f.hb(token)).status,409);
  f.advance(1);assert.equal((await f.hb(token)).status,429);
  f.advance(30_000);
  const results=await Promise.all([f.hb(token),f.hb(token,{observedAt:new Date(f.clock()+1).toISOString()})]);
  assert.equal(results.filter(r=>r.status===200).length,1);
});
test('VS Code companion sends no document metadata, stays paused on startup and stores credentials only in SecretStorage',async()=>{
  let time=start,listener,tick;const commands={};const secrets=new Map();const globals=new Map();const requests=[];
  const api={StatusBarAlignment:{Right:1},window:{state:{focused:true},createStatusBarItem:()=>({show(){},dispose(){}}),
    showInputBox:async()=>'P'.repeat(43),showQuickPick:async items=>items[2],showInformationMessage:async()=>{},showErrorMessage:async()=>{}},
    commands:{registerCommand(name,fn){commands[name]=fn;return{dispose(){}};}},workspace:{onDidChangeTextDocument(fn){listener=fn;return{dispose(){}};}}};
  const context={subscriptions:[],secrets:{async get(k){return secrets.get(k);},async store(k,v){secrets.set(k,v);},async delete(k){secrets.delete(k);}},globalState:{get:k=>globals.get(k),async update(k,v){globals.set(k,v);}}};
  const sandbox={require:name=>{assert.equal(name,'vscode');return api;},exports:{},AbortSignal,Date,JSON,Promise,setInterval,clearInterval};
  vm.runInNewContext(readFileSync(new URL('../extensions/presence-vscode/extension.cjs',import.meta.url),'utf8'),sandbox);
  const client=sandbox.exports.createCompanion(api,context,{clock:()=>time,setTimer:fn=>{tick=fn;return 1;},clearTimer(){},fetcher:async(url,init)=>{
    requests.push({url,init});return Response.json(url.endsWith('/claim')?{token:'T'.repeat(43),expiresAt:new Date(time+3600000).toISOString(),projects:['merit']}:{accepted:true});
  }});await client.ready;
  listener({contentChanges:[{}],get document(){throw Error('document metadata must not be read');}});
  assert.equal(requests.length,0);await client.actions.pair();await client.actions.project();await client.actions.resume();
  listener({contentChanges:[{}],get document(){throw Error('document metadata must not be read');}});
  await new Promise(resolve=>setTimeout(resolve,0));
  const heartbeat=requests.find(r=>r.url.endsWith('/heartbeat'));
  assert.ok(heartbeat);assert.deepEqual(Object.keys(JSON.parse(heartbeat.init.body)).sort(),['active','observedAt','projectSlug','version']);
  assert.equal(JSON.parse(heartbeat.init.body).projectSlug,'merit');assert.equal(heartbeat.init.redirect,'error');
  assert.equal(JSON.stringify([...globals]).includes('T'.repeat(43)),false);assert.ok([...secrets.values()][0].includes('T'.repeat(43)));
  const callsBeforeIdle = requests.length;time+=60000;tick();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(requests.length,callsBeforeIdle,"idle timer must not mint a fresh edit timestamp");
  time+=61000;tick();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(JSON.parse(requests.at(-1).init.body).active,false);
  client.dispose();
});

test('automatic editor project follows only approved origin remotes and clears an unknown repository',async()=>{
 let listener,time=start,remote='git@github.com:devonalanakins/merit.git';const requests=[];
 const api={StatusBarAlignment:{Right:1},extensions:{getExtension:()=>({exports:{getAPI:()=>({getRepository:()=>({state:{remotes:[{name:'origin',fetchUrl:remote}]}})})}})},window:{state:{focused:true},createStatusBarItem:()=>({show(){},dispose(){}}),showInputBox:async()=>'P'.repeat(43),showInformationMessage:async()=>{},showErrorMessage:async()=>{}},commands:{registerCommand:()=>({dispose(){}})},workspace:{onDidChangeTextDocument(fn){listener=fn;return{dispose(){}};}}};
 const context={subscriptions:[],secrets:{get:async()=>null,store:async()=>{},delete:async()=>{}},globalState:{get:()=>undefined,update:async()=>{}}};
 const sandbox={require:()=>api,exports:{},AbortSignal,Date,JSON,Promise,setInterval,clearInterval};vm.runInNewContext(readFileSync(new URL('../extensions/presence-vscode/extension.cjs',import.meta.url),'utf8'),sandbox);
 const client=sandbox.exports.createCompanion(api,context,{clock:()=>time,setTimer:()=>1,clearTimer(){},fetcher:async(url,init)=>{requests.push({url,data:JSON.parse(init.body)});return Response.json(url.endsWith('/claim')?{token:'T'.repeat(43),expiresAt:new Date(time+3600000).toISOString(),projects:['merit','rhen']}:{accepted:true});}});
 await client.ready;await client.actions.pair();await client.actions.resume();
 const edit=()=>listener({contentChanges:[{}],document:{uri:{scheme:'file'},getText(){throw Error('Text must not be read');}}});
 edit();await new Promise(r=>setTimeout(r,0));assert.equal(requests.at(-1).data.projectSlug,'merit');
 time+=60001;remote='https://github.com/devonalanakins/rhen.git';edit();await new Promise(r=>setTimeout(r,0));assert.equal(requests.at(-1).data.projectSlug,'rhen');
 time+=60001;remote='https://github.com/devonalanakins/private-client.git';edit();await new Promise(r=>setTimeout(r,0));assert.equal(requests.at(-1).data.projectSlug,null);
 assert.ok(!JSON.stringify(requests).includes('private-client'));client.dispose();
});
