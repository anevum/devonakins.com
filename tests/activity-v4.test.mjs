import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createActivityTasksApi,activityTasks} from '../src/activity-tasks.mjs';
import {createLiveSignal} from '../src/live-signal.mjs';
import {projectActivityHistory} from '../src/activity-history.mjs';
import {projectPlayback} from '../src/spotify-presence.mjs';
const START=Date.parse('2026-11-07T02:00:00.000Z');
const ctx={access:{aud:'fixture',getIdentity:async()=>({email:'owner@example.test'})}};
function fixture(){
 const sql=new DatabaseSync(':memory:');for(const n of ['0002_presence.sql','0003_presence_preferences.sql','0004_editor_pairing.sql','0006_cloud_presence.sql','0007_activity_tasks.sql'])sql.exec(readFileSync(new URL('../migrations/'+n,import.meta.url),'utf8'));
 let at=START,hook=null;
 const db={prepare(q){const stmt=sql.prepare(q);let v=[];return {bind(...values){v=values;return this;},async first(){const value=stmt.get(...v)||null;if(hook)await hook(q);return value;},async all(){const value={results:stmt.all(...v)};if(hook)await hook(q);return value;},async run(){return {meta:{changes:Number(stmt.run(...v).changes)}};}};}};
 const env={PRESENCE_ENABLED:'true',PRESENCE_PUBLIC_RELEASE_APPROVED:'false',LISTENING_DB:db,LISTENING_ACCESS_AUD:'fixture',LISTENING_OWNER_EMAIL:'owner@example.test'};
 const clock=()=>at,api=createActivityTasksApi({clock});
 const req=(path,method='POST',body,token,origin='https://devonakins.com')=>new Request('https://devonakins.com'+path,{method,headers:{'Content-Type':'application/json',Origin:origin,...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const admin=(body,method='POST',context=ctx,origin)=>api(req('/api/presence/owner?channel=tasks',method,body,null,origin),env,context);
 const source=async(projectSlug='merit')=>{const r=await admin({action:'connect',source:'codex',projectSlug});assert.equal(r.status,200);return r.json();};
 const start=async s=>{const r=await api(req('/api/activity/tasks/start','POST',{version:1},s.token),env);assert.equal(r.status,200);return r.json();};
 const signal=(t,sequence,state='running',extra={})=>api(req('/api/activity/tasks/signal','POST',{version:1,sequence,state,checkpoint:null,observedAt:new Date(at).toISOString(),...extra},t.token),env);
 const publish=()=>{env.PRESENCE_PUBLIC_RELEASE_APPROVED='true';sql.exec('UPDATE presence_state SET public_enabled=1;UPDATE activity_sources SET public_enabled=1,revision=revision+1;');};
 return {sql,db,env,clock,api,req,admin,source,start,signal,publish,advance:(ms=30000)=>{at+=ms;},hook:fn=>{hook=fn;}};
}
test('additive migration preserves original owner and singleton; private defaults and credential allowlists',async()=>{
 const f=fixture(),s=await f.source(),t=await f.start(s);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM presence_state').get().n,1);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM presence_cloud').get().n,1);
 assert.deepEqual(await activityTasks(f.env,f.clock()),{version:1,visibility:'hidden',tasks:[]});
 const privateData=await (await f.admin(null,'GET')).json();assert.equal(privateData.preview.tasks[0].project,'Merit');assert.ok(!JSON.stringify(privateData).includes(s.token));assert.ok(!JSON.stringify(privateData).includes(t.token));
 assert.equal(f.sql.prepare('SELECT token_hash FROM activity_sources').get().token_hash.length,43);
 f.publish();const pub=await activityTasks(f.env,f.clock());assert.equal(pub.tasks.length,1);assert.deepEqual(Object.keys(pub.tasks[0]).sort(),['asOf','checkpoint','expiresAt','id','project','source','state']);assert.ok(!JSON.stringify(pub).includes(s.id));
});
test('two independently authenticated tasks survive another task finishing or being revoked',async()=>{
 const f=fixture(),a=await f.start(await f.source('merit')),b=await f.start(await f.source('rhen'));f.publish();assert.equal((await activityTasks(f.env,f.clock())).tasks.length,2);
 assert.equal((await f.signal(a,1,'completed')).status,200);assert.equal((await f.signal(a,2)).status,409);
 f.advance();assert.equal((await f.signal(b,1)).status,200);
 let tasks=(await activityTasks(f.env,f.clock())).tasks;assert.equal(tasks.find(x=>x.id===a.id).state,'completed');assert.equal(tasks.find(x=>x.id===b.id).state,'running');
 await f.admin({kind:'task',id:a.id},'DELETE');tasks=(await activityTasks(f.env,f.clock())).tasks;assert.deepEqual(tasks.map(x=>x.id),[b.id]);
});
test('missing checkpoints expire without a laptop or a synthetic heartbeat',async()=>{
 const f=fixture(),t=await f.start(await f.source());f.publish();f.advance(120000);assert.equal((await activityTasks(f.env,f.clock())).tasks.length,0);
 assert.equal((await f.signal(t,1,'running',{observedAt:new Date(START).toISOString()})).status,400);
 f.advance();assert.equal((await f.signal(t,1)).status,200);assert.equal((await activityTasks(f.env,f.clock())).tasks.length,1);
});
test('replay, future evidence, extra private fields, forged scope, cooldown and bearer boundaries fail closed',async()=>{
 const f=fixture(),s=await f.source(),t=await f.start(s);
 assert.equal((await f.signal(t,1)).status,429);f.advance();assert.equal((await f.signal(t,1)).status,200);assert.equal((await f.signal(t,1)).status,409);
 assert.equal((await f.signal(t,2,'running',{projectSlug:'rhen'})).status,400);
 assert.equal((await f.signal(t,2,'running',{title:'private task'})).status,400);
 assert.equal((await f.signal(t,2,'running',{observedAt:new Date(f.clock()+11000).toISOString()})).status,400);
 assert.equal((await f.api(f.req('/api/activity/tasks/signal','POST',{},s.token),f.env)).status,400);
 const r=await f.api(f.req('/api/activity/tasks/start','POST',{version:1},t.token),f.env);assert.equal(r.status,401);
});
test('workspace revocation, project deselection and global generation stop invalidate all linked tasks',async()=>{
 const f=fixture(),s=await f.source(),t=await f.start(s);f.publish();
 f.sql.exec(`UPDATE presence_state SET public_projects_json='["rhen"]',revision=revision+1`);assert.equal((await activityTasks(f.env,f.clock())).tasks.length,0);assert.equal((await f.signal(t,1,'completed')).status,401);
 f.sql.exec('UPDATE presence_state SET public_projects_json=NULL,editor_generation=editor_generation+1,revision=revision+1');assert.equal((await activityTasks(f.env,f.clock())).tasks.length,0);assert.equal((await f.signal(t,1,'completed')).status,401);
 const s2=await f.source(),t2=await f.start(s2);await f.admin({kind:'source',id:s2.id},'DELETE');assert.equal((await f.signal(t2,1,'completed')).status,401);
});
test('owner Access, same-origin, release gate and no-store are independently enforced',async()=>{
 const f=fixture();assert.equal((await f.admin(null,'GET',{})).status,403);
 assert.equal((await f.admin({action:'connect',source:'codex',projectSlug:'merit'},'POST',ctx,'https://hostile.test')).status,403);
 const s=await f.source();assert.equal((await f.admin({action:'settings',id:s.id,revision:0,enabled:true})).status,403);
 const r=await f.admin(null,'GET');assert.match(r.headers.get('Cache-Control'),/no-store/);assert.match(r.headers.get('CDN-Cache-Control'),/no-store/);
});
test('revocation during public task reads cannot disclose the in-flight task',async()=>{
 const f=fixture(),s=await f.source();await f.start(s);f.publish();let fired=false;f.hook(q=>{if(q.startsWith('SELECT * FROM activity_tasks')&&!fired){fired=true;f.sql.prepare('UPDATE activity_sources SET revoked=1,revision=revision+1 WHERE id=?').run(s.id);}});
 assert.equal((await activityTasks(f.env,f.clock())).tasks.length,0);
});
test('aggregate separates Spotify from coding and drops delayed provider data after global stop',async()=>{
 const f=fixture();f.publish();f.sql.exec('UPDATE presence_state SET share_listening=1');
 let entered,release,calls=0;const started=new Promise(r=>entered=r);
 const read=createLiveSignal({clock:f.clock,readGithub:async()=>[],readListening:async()=>{calls++;if(calls===1){entered();return new Promise(r=>release=r);}return Response.json({version:1,mode:'hidden',detailsVisible:false});}});
 const pending=read(f.env);await started;f.sql.exec('UPDATE presence_state SET public_enabled=0,editor_generation=editor_generation+1,revision=revision+1');release(Response.json({version:1,mode:'playing',detailsVisible:false,updatedAt:new Date(f.clock()).toISOString()}));
 const result=await pending;assert.equal(result.spotify.mode,'hidden');assert.equal(result.work.visibility,'hidden');assert.deepEqual(result.remote.tasks,[]);assert.equal(result.gpt.count,null);
});
test('aggregate allows music without a development signal; GPT is scoped disconnected, never a historical total',async()=>{
 const f=fixture();f.publish();f.sql.exec('UPDATE presence_state SET share_listening=1');
 const read=createLiveSignal({clock:f.clock,readGithub:async()=>[],readListening:async()=>Response.json({version:1,mode:'playing',detailsVisible:false,updatedAt:new Date(f.clock()).toISOString()})});
 const result=await read(f.env);assert.equal(result.spotify.mode,'playing');assert.equal(result.work.state,'listening');assert.equal(result.gpt.count,null);assert.equal(result.gpt.scope,'personal-work-codex');assert.ok(!JSON.stringify(result).includes('2700000000'));
});
test('GitHub history includes only fixed public catalog names and official links, never provider text or private repos',()=>{
 const e={public:true,type:'PushEvent',created_at:new Date(START).toISOString(),repo:{name:'devonalanakins/merit'},payload:{title:'SECRET',commits:[{message:'PRIVATE'}]}};
 assert.deepEqual(projectActivityHistory([e],START),[{project:'Merit',projectSlug:'merit',kind:'Commit',at:new Date(START).toISOString(),url:'https://github.com/devonalanakins/merit'}]);assert.deepEqual(projectActivityHistory([{...e,public:false},{...e,repo:{name:'devonalanakins/private-client'}},{...e,repo:{name:'attacker/merit'}}],START),[]);
});
test('Spotify progress projects only bounded numeric metadata and never changes paused or private state',()=>{
 const payload={is_playing:true,currently_playing_type:'track',progress_ms:1000,item:{id:'1234567890123456789012',type:'track',duration_ms:180000,name:'Fixture',artists:[{name:'Fixture artist'}]}};
 assert.deepEqual(projectPlayback(payload,true,new Date(START).toISOString()).playback,{durationMs:180000,progressMs:1000});
 assert.equal(projectPlayback({...payload,is_playing:false},true,'').mode,'off_air');assert.equal(projectPlayback({...payload,device:{is_private_session:true}},true,'').mode,'off_air');assert.equal(projectPlayback({...payload,progress_ms:999999999},true,'').playback,undefined);assert.equal(projectPlayback(payload,false,'').playback,undefined);
});

test('actual Worker V4 route has bounded hidden defaults, no-store, HEAD and owner protection',async()=>{
 const {createHandler}=await import('../src/worker.mjs');const site=createHandler({}, {version:'fixture'},{githubFetch:async()=>Response.json([]),now:()=>new Date(START),cache:null});
 const request=(path,method='GET')=>site.fetch(new Request('https://devonakins.com'+path,{method}));
 const r=await request('/api/activity/v4');assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal(r.headers.get('CDN-Cache-Control'),'no-store');const data=await r.json();assert.equal(data.version,4);assert.equal(data.gpt.count,null);assert.equal(data.spotify.mode,'hidden');assert.equal(data.work.visibility,'hidden');assert.deepEqual(data.remote.tasks,[]);
 assert.equal(await(await request('/api/activity/v4','HEAD')).text(),'');assert.equal((await request('/api/activity/v4','POST')).status,405);assert.notEqual((await request('/api/presence/owner?channel=tasks')).status,200);
});
