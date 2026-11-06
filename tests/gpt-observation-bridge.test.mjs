import test from "node:test";
import assert from "node:assert/strict";
import {createHandler} from "../src/worker.mjs";
import {
  validateObservation, projectObservation, handleObservationRequest,
  OBSERVATION_READ_PATH, OBSERVATION_WRITE_PATH,
} from "../src/gpt-observation-bridge.mjs";

const now=new Date("2026-11-06T12:00:00.000Z");
const later=new Date("2026-11-06T12:06:00.000Z");
const secret="a-long-random-collector-secret-with-at-least-32-characters";
const one={
  version:1,metric:"work_codex_credits_remaining",value:120,
  unit:"credits",source:"user-selected-visible-usage-text",
  scope:"work-codex",observedAt:"2026-11-06T11:59:50.000Z",
  lastChangedAt:"2026-11-06T11:50:00.000Z",sourceUpdatedAt:null,
};
function mockStore(){
  let value=null;
  const writes=[];
  const calls=[];
  return {get:async(key,type)=>{
    calls.push(["get",key,type]);return value;
  },put:async(key,data,options)=>{
    calls.push(["put",key]);writes.push({key,data,options});value=data;
  },writes,calls,raw(x){value=x;}};
}
const env=(store,read=true,write=true)=>({
  GPT_USAGE_STORE:store,
  GPT_USAGE_READ_ENABLED:read?"true":"false",
  GPT_USAGE_WRITE_ENABLED:write?"true":"false",
  GPT_USAGE_INGEST_SECRET:secret,
});
const req=(path,method="GET",value=undefined,token=secret,extraHeaders={})=>
  new Request("https://devonakins.com"+path,{
    method,headers:{
      ...(method==="POST" ? {
        "Content-Type":"application/json",
        ...(token!==null?{Authorization:"Bearer "+token}:{}),
      } : {}),...extraHeaders,
    },
    ...(method==="POST"?{body:typeof value==="string"?value:JSON.stringify(value)}:{}),
  });
const handle=(request,configuration,at=now)=>
  handleObservationRequest(request,configuration,at,{
    "X-Content-Type-Options":"nosniff",
    "Content-Security-Policy":"default-src 'none'",
  });

test("fail-closed without provisioned bindings and opt-in flags",async()=>{
  for(const config of [{}, {GPT_USAGE_READ_ENABLED:"true"},
    {GPT_USAGE_STORE:mockStore(),GPT_USAGE_READ_ENABLED:"true",
     GPT_USAGE_WRITE_ENABLED:"true",GPT_USAGE_READ_ENABLED:"false",GPT_USAGE_INGEST_SECRET:"weak"}]){
    for(const [path,request] of [
      [OBSERVATION_READ_PATH,req(OBSERVATION_READ_PATH)],
      [OBSERVATION_WRITE_PATH,req(OBSERVATION_WRITE_PATH,"POST",one)],
    ]){
      const response=await handle(request,config);
      assert.equal(response.status,404,path);
      assert.equal(response.headers.get("cache-control"),"no-store");
    }
  }
  const worker=createHandler({}, {version:"test"}, {now:()=>now});
  const none=await worker.fetch(req(OBSERVATION_READ_PATH));
  assert.equal(none.status,404);
  const noWrite=await worker.fetch(req(OBSERVATION_WRITE_PATH,"POST",one));
  assert.equal(noWrite.status,404);
});

test("only supported numeric scope and time provenance are permitted",()=>{
  assert.equal(validateObservation(one,now).value,120);
  for(const altered of [
    {...one,accountId:"owner"},
    {...one,value:"120"},
    {...one,value:-1},
    {...one,value:Infinity},
    {...one,unit:"tokens"},
    {...one,metric:"weekly_token_total"},
    {...one,scope:"all-chat"},
    {...one,source:"OpenAI certified live API"},
    {...one,sourceUpdatedAt:one.observedAt},
    {...one,observedAt:"2026-11-06T12:04:00.000Z"},
    {...one,observedAt:"2026-11-05T12:00:00.000Z"},
    {...one,lastChangedAt:"2026-11-06T12:01:00.000Z"},
  ])assert.equal(validateObservation(altered,now),null,JSON.stringify(altered));
  assert.equal(validateObservation({...one,metric:"work_codex_used_percent",
    unit:"percent",value:110},now),null);
});

test("authorized upload stores one allowlisted observation and serves owner-approved projection",async()=>{
  const store=mockStore(), config=env(store);
  const write=await handle(req(OBSERVATION_WRITE_PATH,"POST",one),config);
  assert.equal(write.status,202);
  assert.equal(store.writes.length,1);
  assert.equal(store.writes[0].key,"owner-approved-work-codex-reading-v1");
  assert.equal(store.writes[0].options.expirationTtl,30*24*60*60);
  assert.equal(write.headers.get("access-control-allow-origin"),null);
  assert.equal(write.headers.get("cache-control"),"no-store");
  const get=await handle(req(OBSERVATION_READ_PATH),config);
  assert.equal(get.status,200);
  assert.equal(get.headers.get("cache-control"),"no-store");
  const payload=await get.json();
  assert.deepEqual(Object.keys(payload),["version","status","observation"]);
  assert.equal(payload.status,"recent");
  assert.deepEqual(Object.keys(payload.observation).sort(),[
    "lastChangedAt","metric","observedAt","receivedAt","scope","source",
    "sourceUpdatedAt","status","unit","value","version",
  ].sort());
  assert.equal(payload.observation.value,120);
  assert.equal(payload.observation.sourceUpdatedAt,null);
  assert.equal(payload.observation.receivedAt,now.toISOString());
  assert.doesNotMatch(JSON.stringify(payload),/Bearer|secret|accountId|chatContent|privateUrl/i);
  const head=await handle(req(OBSERVATION_READ_PATH,"HEAD"),config);
  assert.equal(head.status,200);
  assert.equal(await head.text(),"");
  assert.equal(store.calls.filter(x=>x[0]==="get").length,2,
    "GET invokes KV; HEAD avoids KV");
  assert.equal((await handle(req(OBSERVATION_READ_PATH),env(store,false))).status,404);
});

test("no record is not zero; disabled public read never reveals private stored values",async()=>{
  const store=mockStore();
  const empty=await handle(req(OBSERVATION_READ_PATH),env(store));
  assert.deepEqual(await empty.json(),{version:1,status:"no-data",observation:null});
  await handle(req(OBSERVATION_WRITE_PATH,"POST",one),env(store,false));
  const hidden=await handle(req(OBSERVATION_READ_PATH),env(store,false));
  assert.equal(hidden.status,404);
});

test("invalid credentials, payloads and body lengths are rejected before KV writes",async()=>{
  const store=mockStore(), config=env(store);
  const wrong=await handle(req(OBSERVATION_WRITE_PATH,"POST",one,"wrong"),config);
  assert.equal(wrong.status,401);
  const missing=await handle(req(OBSERVATION_WRITE_PATH,"POST",one,null),config);
  assert.equal(missing.status,401);
  assert.equal((await handle(req(OBSERVATION_WRITE_PATH,"GET"),config)).status,405);
  assert.equal((await handle(req(OBSERVATION_WRITE_PATH,"POST",one,secret,
    {"Content-Type":"text/plain"}),config)).status,415);
  assert.equal((await handle(req(OBSERVATION_WRITE_PATH,"POST",{
    ...one,cookie:"private session"
  }),config)).status,400);
  assert.equal((await handle(req(OBSERVATION_WRITE_PATH,"POST",
    "x".repeat(1500)),config)).status,413);
  assert.equal((await handle(req(OBSERVATION_WRITE_PATH,"POST","{",secret),config)).status,400);
  assert.equal(store.writes.length,0);
});

test("old/replayed readings, rapid writes and unsupported writes never update KV",async()=>{
  const store=mockStore(), config=env(store);
  assert.equal((await handle(req(OBSERVATION_WRITE_PATH,"POST",one),config)).status,202);
  assert.equal((await handle(req(OBSERVATION_WRITE_PATH,"POST",one),config,later)).status,409);
  const update={...one,value:115,observedAt:"2026-11-06T12:00:10.000Z"};
  assert.equal((await handle(req(OBSERVATION_WRITE_PATH,"POST",update),config,
    new Date("2026-11-06T12:01:00.000Z"))).status,429);
  assert.equal(store.writes.length,1);
  assert.equal((await handle(req(OBSERVATION_WRITE_PATH,"POST",{
    ...update,observedAt:"2026-11-06T12:05:45.000Z",
  }),config,later)).status,202);
  assert.equal(store.writes.length,2);
});

test("readers receive an explicit stale status rather than synthetic live values",async()=>{
  const stored={
    version:1,reading:one,receivedAt:now.toISOString(),
  };
  assert.equal(projectObservation(stored,now).status,"recent");
  const old=new Date("2026-11-07T12:00:00.000Z");
  const projection=projectObservation(stored,old);
  assert.equal(projection.status,"stale");
  assert.equal(projection.value,120);
  assert.equal(projection.sourceUpdatedAt,null);
  const corrupt=mockStore();
  corrupt.raw(JSON.stringify({...stored,privateNotes:"do not leak"}));
  const response=await handle(req(OBSERVATION_READ_PATH),env(corrupt));
  assert.equal(response.status,503);
  assert.doesNotMatch(await response.text(),/do not leak/);
});

test("storage failure returns generic errors without leaking provider internals",async()=>{
  const exploding={
    get:async()=>{throw new Error("secret internal stack trace");},
    put:async()=>{throw new Error("sensitive kv error");},
  };
  const read=await handle(req(OBSERVATION_READ_PATH),env(exploding));
  assert.equal(read.status,503);
  assert.doesNotMatch(await read.text(),/secret|internal|stack/);
  const write=await handle(req(OBSERVATION_WRITE_PATH,"POST",one),env(exploding));
  assert.equal(write.status,503);
  assert.doesNotMatch(await write.text(),/sensitive|kv error/);
});
