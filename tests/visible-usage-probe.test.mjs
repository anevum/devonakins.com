import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
const base = new URL("../experiments/visible-usage-probe/", import.meta.url);
const read = async name => readFile(new URL(name, base), "utf8");
const schemaSource = await read("metric-schema.js");
const contentSource = await read("content.js");
const backgroundSource = await read("background.js");
const manifest = JSON.parse(await read("manifest.json"));
const SESSION = "0123456789abcdef0123456789abcdef";
const OTHER_SESSION = "fedcba9876543210fedcba9876543210";

const initSchema = () => {
  const ctx=vm.createContext({});
  vm.runInContext(schemaSource,ctx);
  return ctx.__devonVisibleUsageSchema;
};

test("local-only extension requests just activeTab, storage and scripting", async () => {
  assert.deepEqual(manifest.permissions.sort(), ["activeTab","scripting","storage"]);
  assert.equal(manifest.manifest_version,3);
  assert.equal(manifest.host_permissions,undefined);
  assert.equal(manifest.background.service_worker,"background.js");
  for (const file of ["content.js","background.js","popup.js"]) {
    const source=await read(file);
    assert.doesNotMatch(source,/fetch\(|XMLHttpRequest|captureVisibleTab|captureTab|mediaDevices|screenCapture/);
  }
});

test("visible numeric parser rejects broad text, approximate units and ambiguous percent", () => {
  const {parseVisibleNumber:parse} = initSchema();
  assert.equal(parse("1,235 credits", "work_codex_credits_remaining").value,1235);
  assert.equal(parse("credits 25.5", "work_codex_credits_used").value,25.5);
  assert.equal(parse("42%", "work_codex_remaining_percent").value,42);
  assert.equal(parse("10.2%", "work_codex_used_percent").value,10.2);
  for (const bad of ["workspaces 3 credits", "1,000.1.2", "12%", "10 credits remaining", "12k", "x123", "3,33", "1,1", "<script>alert(1)</script>", "9".repeat(80)]) {
    assert.equal(parse(bad,"work_codex_credits_remaining"),null,bad);
  }
  assert.equal(parse("101%","work_codex_used_percent"),null);
  assert.equal(parse("10 credits","work_codex_used_percent"),null);
  assert.equal(parse("1000001","work_codex_credits_used"),null);
  assert.equal(parse("17", "unknown_metric"),null);
});

test("reading proves observation only, never source update time", () => {
  const api=initSchema();
  const first="2026-11-06T12:10:00.000Z";
  const later="2026-11-06T12:11:00.000Z";
  const parsed=api.parseVisibleNumber("18 credits","work_codex_credits_used");
  const reading=api.createReading("work_codex_credits_used",parsed,later,first);
  assert.equal(reading.observedAt,later);
  assert.equal(reading.lastChangedAt,first);
  assert.equal(reading.sourceUpdatedAt,null);
  assert.deepEqual(Object.keys(reading).sort(),[
    "lastChangedAt","metric","observedAt","scope","source","sourceUpdatedAt","unit","value"
  ]);
  assert.equal(api.createReading("work_codex_credits_used",parsed,first,later),null);
  assert.equal(api.createReading("work_codex_used_percent",{unit:"percent",value:300},later,later),null);
});

function setup() {
  const store={};
  let workerHandler;
  const fakeBackgroundChrome={
    runtime:{id:"test-extension",getURL:path=>"chrome-extension://test-extension/"+path,
      onMessage:{addListener(fn){workerHandler=fn;}}},
    storage:{session:{
      set: async x=>Object.assign(store,x),
      get: async key=>({[key]:store[key]}),
      remove: async keys=>{for(const key of Array.isArray(keys)?keys:[keys]) delete store[key];},
    }},
  };
  const bg=vm.createContext({chrome:fakeBackgroundChrome,URL,importScripts:()=>vm.runInContext(schemaSource,bg)});
  vm.runInContext(backgroundSource,bg);
  let contentHandler;
  const listeners=new Map();
  const timers=[];
  const document={hidden:false,
    addEventListener(name,handler){listeners.set(name,handler);},
    removeEventListener(name){listeners.delete(name);},
  };
  const fakeContentChrome={
    runtime:{
      onMessage:{addListener(fn){contentHandler=fn;}},
      sendMessage: async message=>new Promise(resolve=>workerHandler(message,{id:"test-extension",url:"https://chatgpt.com/",tab:{id:7}},resolve)),
    },
  };
  const content=vm.createContext({chrome:fakeContentChrome,document,
    getComputedStyle:()=>({display:"block",visibility:"visible"}),
    setInterval(fn,delay){assert.equal(delay,5000);timers.push(fn);return timers.length;},
    clearInterval(){},
  });
  // Context globalThis must resolve to its own isolated world.
  vm.runInContext(schemaSource,content);
  vm.runInContext(contentSource,content);
  const command=(type,metric,sessionKey=SESSION)=>new Promise(resolve=>
    contentHandler({type,metric,sessionKey},{},resolve));
  const popup={id:"test-extension",url:"chrome-extension://test-extension/popup.html"};
  const authorize=(sessionKey=SESSION,tabId=7)=>new Promise(resolve=>
    workerHandler({type:"USAGE_PROBE_AUTHORIZE",tabId,sessionKey},popup,resolve));
  const revoke=()=>new Promise(resolve=>workerHandler({type:"USAGE_PROBE_REVOKE"},popup,resolve));
  const sendRecord=(data,url="https://chatgpt.com/",sessionKey=SESSION,tabId=7)=>
    new Promise(resolve=>workerHandler({type:"USAGE_PROBE_RECORD",data,sessionKey},
      {id:"test-extension",url,tab:{id:tabId}},resolve));
  return {store,command,listeners,timers,workerHandler,document,authorize,revoke,sendRecord};
}

const settled = async () => {await Promise.resolve();await Promise.resolve();await new Promise(r=>setImmediate(r));};

test("opt-in selection takes only one numeric node and samples every five seconds", async () => {
  const x=setup();
  assert.equal(Object.keys(x.store).length,0,"no capture on extension injection");
  assert.equal((await x.authorize()).ok,true);
  assert.equal((await x.command("USAGE_PROBE_SELECT","work_codex_credits_remaining")).ok,true);
  await settled();
  const element={nodeType:1,textContent:"75 credits",isConnected:true,parentElement:null,getClientRects:()=>[1]};
  const click={target:element,preventDefault(){this.cancelled=true;},stopImmediatePropagation(){this.stopped=true;}};
  x.listeners.get("click")(click);
  await settled();
  let record=x.store["devon-visible-usage-probe-v1"];
  assert.equal(click.cancelled,true);
  assert.equal(click.stopped,true);
  assert.equal(record.tabId,7);
  assert.equal(record.state,"observing");
  assert.equal(record.reading.value,75);
  assert.equal(record.reading.sourceUpdatedAt,null);
  assert.equal(x.timers.length,1);
  assert.doesNotMatch(JSON.stringify(record),/chatgpt\.com|password|token|cookies/i);
  element.textContent="71 credits";
  x.timers[0]();
  await settled();
  record=x.store["devon-visible-usage-probe-v1"];
  assert.equal(record.reading.value,71);
  x.document.hidden=true;
  x.timers[0]();
  await settled();
  assert.equal(x.store["devon-visible-usage-probe-v1"].state,"paused");
  x.document.hidden=false;
  element.isConnected=false;
  x.timers[0]();
  await settled();
  assert.equal(x.store["devon-visible-usage-probe-v1"].state,"stale");
  assert.equal((await x.revoke()).ok,true);
  await x.command("USAGE_PROBE_STOP");
  assert.equal(x.store["devon-visible-usage-probe-v1"],undefined,
    "revoke acknowledgment must follow trusted local storage clearance");
  assert.equal(x.store["devon-visible-usage-active-v1"],undefined);
});

test("trusted worker rejects wrong host, raw injected text and invalid scope", async () => {
  const x=setup();
  assert.equal((await x.authorize()).ok,true);
  const allowed={version:1,state:"observing",message:"Visible reading sampled; provider update time unknown",
    metric:"work_codex_credits_used",statusAt:"2026-11-06T12:00:00.000Z",reading:{
      source:"user-selected-visible-usage-text",scope:"work-codex",metric:"work_codex_credits_used",
      unit:"credits",value:15,observedAt:"2026-11-06T12:00:00.000Z",
      lastChangedAt:"2026-11-06T12:00:00.000Z",sourceUpdatedAt:null,
    }};
  const send=(data,url)=>x.sendRecord(data,url);
  assert.equal((await send(allowed,"https://evil.example/")).ok,false);
  assert.equal((await send({...allowed,rawCookie:"secret"},"https://chatgpt.com/")).ok,false);
  assert.equal((await send({...allowed,reading:{...allowed.reading,conversation:"private"}},"https://chatgpt.com/")).ok,false);
  assert.equal((await send({...allowed,reading:{...allowed.reading,value:1e12}},"https://chatgpt.com/")).ok,false);
  assert.equal((await send({...allowed,reading:{...allowed.reading,sourceUpdatedAt:allowed.statusAt}},"https://chatgpt.com/")).ok,false);
  assert.equal((await send(allowed,"https://chatgpt.com/")).ok,true);
  assert.equal(x.store["devon-visible-usage-probe-v1"].reading.value,15);
  assert.deepEqual(Object.keys(x.store["devon-visible-usage-probe-v1"].reading).sort(),
    ["source","scope","metric","unit","value","observedAt","lastChangedAt","sourceUpdatedAt"].sort());
});

test("revoking serialized session blocks queued and delayed samples", async () => {
  const x=setup();
  assert.equal((await x.authorize()).ok,true);
  const valid={version:1,state:"observing",message:"Visible reading sampled; provider update time unknown",
    metric:"work_codex_credits_used",statusAt:"2026-11-06T12:00:00.000Z",reading:{
      source:"user-selected-visible-usage-text",scope:"work-codex",metric:"work_codex_credits_used",
      unit:"credits",value:18,observedAt:"2026-11-06T12:00:00.000Z",
      lastChangedAt:"2026-11-06T12:00:00.000Z",sourceUpdatedAt:null,
    }};
  const pending=x.sendRecord(valid,"https://chatgpt.com/");
  const revoke=x.revoke();
  assert.equal((await pending).ok,true);
  assert.equal((await revoke).ok,true);
  assert.equal(x.store["devon-visible-usage-probe-v1"],undefined);
  assert.equal((await x.sendRecord(valid,"https://chatgpt.com/")).ok,false);
  assert.equal(x.store["devon-visible-usage-probe-v1"],undefined);
  assert.equal((await x.authorize(OTHER_SESSION,8)).ok,true);
  assert.equal((await x.sendRecord(valid,"https://chatgpt.com/",SESSION,7)).ok,false);
  assert.equal((await x.sendRecord(valid,"https://chatgpt.com/",OTHER_SESSION,7)).ok,false);
  assert.equal((await x.sendRecord(valid,"https://chatgpt.com/",OTHER_SESSION,8)).ok,true);
  assert.equal(x.store["devon-visible-usage-probe-v1"].reading.value,18);
});

test("only the extension popup may authorize or revoke capture", async () => {
  const x=setup();
  const malicious={url:"https://chatgpt.com/",id:"test-extension",tab:{id:7}};
  const forged=await new Promise(resolve=>x.workerHandler(
    {type:"USAGE_PROBE_AUTHORIZE",tabId:7,sessionKey:SESSION},malicious,resolve));
  assert.equal(forged.ok,false);
  const denied=await new Promise(resolve=>x.workerHandler(
    {type:"USAGE_PROBE_REVOKE"},malicious,resolve));
  assert.equal(denied.ok,false);
  assert.equal(x.store["devon-visible-usage-active-v1"],undefined);
});
