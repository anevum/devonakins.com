import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createListeningCollections} from '../src/listening-collections.mjs';
import {base64url,importEncryptionKey,seal,unseal} from '../src/listening-crypto.mjs';
const ID='1234567890123456789012';
const START=Date.parse('2026-11-06T20:00:00.000Z');
const ctx={access:{aud:'synthetic',getIdentity:async()=>({email:'owner@example.test'})}};
async function fixture(){
  const raw=new DatabaseSync(':memory:');
  for(const name of ['0001_listening.sql','0002_presence.sql','0003_presence_preferences.sql','0004_editor_pairing.sql','0005_listening_collections.sql'])raw.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  const db={prepare(q){const stmt=raw.prepare(q);let args=[];return{bind(...v){args=v;return this;},async first(){return stmt.get(...args)||null;},async run(){return{meta:{changes:Number(stmt.run(...args).changes)}};}};}};
  let time=START;const clock=()=>time;let ownerId='owner-fixture',publicFlag=true,status=200;const calls=[];let hook=null;
  const env={LISTENING_DB:db,LISTENING_TOKEN_KEY:base64url(new Uint8Array(32).fill(9)),SPOTIFY_CLIENT_ID:'0123456789abcdef0123456789abcdef',LISTENING_ACCESS_AUD:'synthetic',LISTENING_OWNER_EMAIL:'owner@example.test',LISTENING_PUBLIC_RELEASE_APPROVED:'true',LISTENING_COLLECTIONS_ENABLED:'true'};
  const key=await importEncryptionKey(env.LISTENING_TOKEN_KEY);
  await db.prepare('UPDATE listening_account SET refresh_cipher=?,access_cipher=?,access_expires=?,reauth_due=?,connected_at=?,connection_key=? WHERE id=1')
    .bind(await seal('refresh_fixture',key,'refresh'),await seal('access_fixture',key,'access'),START+3600000,START+86400000,START,'connection-a').run();
  const fetcher=async(url,init)=>{
    calls.push(url);
    if(hook){const response=await hook(url,init);if(response)return response;}
    if(url.includes('accounts.spotify.com'))return Response.json({token_type:'Bearer',access_token:'new_access_fixture',refresh_token:'rotated_refresh_fixture',expires_in:3600});
    if(status!==200)return new Response('',{status,headers:{'Retry-After':'60'}});
    if(url.endsWith('/me'))return Response.json({id:'owner-fixture',email:'never-publish@example.test'});
    return Response.json({id:ID,type:'playlist',public:publicFlag,name:'Synthetic playlist',owner:{id:ownerId},description:'PRIVATE_PROVIDER_FIELD',images:[],items:{secret:'never publish tracks'}});
  };
  const api=createListeningCollections({clock,fetcher});
  const req=data=>new Request('https://devonakins.com/api/listening/admin/collections',{method:data?'POST':'GET',headers:{Origin:'https://devonakins.com','Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
  async function save(enabled=true,ids=[ID]){const row=await db.prepare('SELECT * FROM listening_collections').first();return api.owner(req({revision:row.revision,ids,enabled}),env,ctx);}
  return{raw,db,env,key,api,calls,req,save,clock,advance(ms=16*60000){time+=ms;},provider(values){if(values.ownerId!==undefined)ownerId=values.ownerId;if(values.publicFlag!==undefined)publicFlag=values.publicFlag;if(values.status!==undefined)status=values.status;},hook(fn){hook=fn;}};
}
test('playlist selection requires owner authentication, exact IDs and separate release approval',async()=>{
  const f=await fixture();
  assert.equal((await f.api.owner(f.req(),f.env,{})).status,403);
  for(const ids of [[ID,ID],['../private'],Array(13).fill(ID)])assert.equal((await f.save(true,ids)).status,400);
  f.env.LISTENING_PUBLIC_RELEASE_APPROVED='false';assert.equal((await f.save()).status,403);
  assert.equal((await f.save(false)).status,200);assert.equal(f.calls.length,0);
  assert.equal((await (await f.api.public(f.env)).json()).status,'hidden');
});
test('only selected owner-created public playlist metadata is projected and cached',async()=>{
  const f=await fixture();assert.equal((await f.save()).status,200);assert.equal(f.calls.length,2);
  const view=await (await f.api.public(f.env)).json();
  assert.equal(view.status,'available');assert.equal(view.playlists[0].title,'Synthetic playlist');assert.equal(f.calls.length,2);
  assert.deepEqual(Object.keys(view.playlists[0]).sort(),['id','image','title','url']);
  assert.doesNotMatch(JSON.stringify(view),/owner-fixture|PRIVATE_PROVIDER_FIELD|never-publish|secret|access_fixture/);
  f.advance();assert.equal((await (await f.api.public(f.env)).json()).status,'available');assert.equal(f.calls.length,4);
});
test('private, foreign-owned and inaccessible playlists cannot be published',async()=>{
  for(const values of [{publicFlag:false},{ownerId:'somebody-else'},{status:403}]){
    const f=await fixture();f.provider(values);
    assert.equal((await f.save()).status,503);
    assert.equal((await (await f.api.public(f.env)).json()).status,'hidden');
  }
});
test('master privacy shutoff fences a delayed public playlist refresh',async()=>{
  const f=await fixture();f.env.PRESENCE_ENABLED='true';f.env.PRESENCE_PUBLIC_RELEASE_APPROVED='true';
  await f.db.prepare('UPDATE presence_state SET public_enabled=1 WHERE id=1').run();
  assert.equal((await f.save()).status,200);f.advance();
  let enter,release;const started=new Promise(r=>{enter=r;});
  f.hook(async url=>{if(url.includes('/playlists/')){enter();return new Promise(r=>{release=r;});}});
  const pending=f.api.public(f.env);await started;
  await f.db.prepare('UPDATE presence_state SET public_enabled=0 WHERE id=1').run();
  release(Response.json({id:ID,type:'playlist',public:true,name:'Late playlist',owner:{id:'owner-fixture'},images:[]}));
  const result=await (await pending).json();assert.equal(result.status,'hidden');assert.equal(result.playlists.length,0);
});
test('disconnect and a new account never inherit cached playlist publication consent',async()=>{
  const f=await fixture();await f.save();
  await f.db.prepare('UPDATE listening_account SET refresh_cipher=NULL WHERE id=1').run();
  assert.equal((await (await f.api.public(f.env)).json()).status,'hidden');
  await f.db.prepare('UPDATE listening_account SET refresh_cipher=?,connection_key=? WHERE id=1').bind(await seal('new_refresh_fixture',f.key,'refresh'),'connection-b').run();
  const calls=f.calls.length;
  assert.equal((await (await f.api.public(f.env)).json()).status,'hidden');assert.equal(f.calls.length,calls);
});
test('a playlist provider failure preserves rotated credentials and withholds old metadata',async()=>{
  const f=await fixture();await f.save();f.advance();
  await f.db.prepare('UPDATE listening_account SET access_expires=0 WHERE id=1').run();f.provider({status:429});
  assert.equal((await (await f.api.public(f.env)).json()).status,'unavailable');
  const account=await f.db.prepare('SELECT * FROM listening_account').first();
  assert.equal(await unseal(account.refresh_cipher,f.key,'refresh'),'rotated_refresh_fixture');
  assert.equal((await f.db.prepare('SELECT * FROM listening_collections').first()).projection_json,null);
});

test('provider response size and MIME failures cannot publish playlist metadata',async()=>{
  for(const response of [new Response('x'.repeat(65537),{headers:{'Content-Type':'application/json'}}),new Response('<html>sign in</html>',{headers:{'Content-Type':'text/html'}})]){
    const f=await fixture();f.hook(async url=>url.endsWith('/me')?response:null);
    assert.equal((await f.save()).status,503);
    assert.equal((await(await f.api.public(f.env)).json()).status,'hidden');
    assert.equal((await f.db.prepare('SELECT lease_id FROM listening_account').first()).lease_id,null);
  }
});
