import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {runParticipatingTask} from '../scripts/activity-run.mjs';
test('participating wrapper emits only real execution checkpoints and final status, never raw command/output or inherited credential',async()=>{
 const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();let at=Date.now();const sent=[];const token='T'.repeat(43);const sink={write(){}};
 const run=runParticipatingTask(['npm','test'],{sourceToken:'S'.repeat(43),clock:()=>at,stdout:sink,stderr:sink,fetcher:async(url,init)=>{const body=JSON.parse(init.body);sent.push({url,body});return Response.json(url.endsWith('/start')?{token,expiresAt:new Date(at+86400000).toISOString()}:{accepted:true});},spawnProcess:(file,args,opts)=>{assert.equal(file,'npm');assert.deepEqual(args,['test']);assert.equal(opts.shell,false);assert.equal(opts.env.DEVON_ACTIVITY_SOURCE_TOKEN,undefined);queueMicrotask(()=>{at+=31000;child.stdout.emit('data','PRIVATE command output');setImmediate(()=>child.emit('exit',0,null));});return child;}});
 assert.equal(await run,0);assert.deepEqual(sent.map(x=>x.body.state).filter(Boolean),['running','completed']);assert.equal(sent[1].body.checkpoint,'testing');assert.equal(sent[2].body.checkpoint,'tests-passed');assert.ok(!JSON.stringify(sent).includes('PRIVATE'));assert.ok(!JSON.stringify(sent).includes('npm'));
});
test('telemetry outage never prevents the real requested command from running',async()=>{
 let spawned=false;const child=new EventEmitter();const result=runParticipatingTask(['node','example.mjs'],{sourceToken:'S'.repeat(43),stdout:{write(){}},stderr:{write(){}},fetcher:async()=>new Response(null,{status:401}),spawnProcess:()=>{spawned=true;queueMicrotask(()=>child.emit('exit',7,null));return child;}});assert.equal(await result,7);assert.equal(spawned,true);
});
test('repository metadata maps only the owner catalog and unknown remotes never create a public task',async()=>{
 const {projectFromRemote}=await import('../scripts/activity-run.mjs');assert.equal(projectFromRemote('git@github.com:devonalanakins/merit.git'),'merit');assert.equal(projectFromRemote('https://github.com/devonalanakins/rhen.git'),'rhen');assert.equal(projectFromRemote('https://github.com/devonalanakins/private-client.git'),null);assert.equal(projectFromRemote('https://attacker.test/devonalanakins/merit'),null);
 const child=new EventEmitter();let calls=0;const result=runParticipatingTask(['npm','test'],{sourceToken:'S'.repeat(43),detectProject:()=>({available:true,projectSlug:null}),stdout:{write(){}},stderr:{write(){}},fetcher:async()=>{calls++;throw Error();},spawnProcess:()=>{queueMicrotask(()=>child.emit('exit',0,null));return child;}});assert.equal(await result,0);assert.equal(calls,0);
});
