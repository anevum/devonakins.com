import test from "node:test";
import assert from "node:assert/strict";
import {createHandler} from "../src/worker.mjs";
import {
  GITHUB_SIGNAL_URL,
  GITHUB_REPOS_URL,
  normalizeRecentGitHubProject,
  GITHUB_SIGNAL_CACHE_KEY,
  GITHUB_SIGNAL_MAX_AGE_MS,
  createGitHubPublicSignal,
  normalizeGitHubProfile,
  validGitHubSignal,
} from "../src/public-github.mjs";

const observed = Date.parse("2026-11-02T18:15:00.000Z");
const identity = {
  login: "anevum", type: "User", public_repos: 12,
  email: "should-never-leak@example.test", private_gists: 44,
  followers: 900000, plan: {name: "private"}, access_token: "untrusted",
};
const upstream = (data=identity, status=200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {"Content-Type":"application/json", "Content-Length":String(JSON.stringify(data).length)},
  });
const url = "https://devonakins.com/v2/github-profile.json";
const request = (method="GET", suffix="") => new Request(url+suffix,{method});

test("GitHub public normalization whitelists only observed repository statistics",()=>{
  const signal=normalizeGitHubProfile(identity,new Date(observed).toISOString());
  assert.deepEqual(signal,{
    version:2, account:"anevum", metric:"public-repositories",
    count:12, asOf:"2026-11-02T18:15:00.000Z",
    source:"GitHub REST API",attestation:"public-provider-response",recent:null,
  });
  assert(!JSON.stringify(signal).includes("email"));
  assert(!JSON.stringify(signal).includes("followers"));
  assert(!JSON.stringify(signal).includes("access_token"));
  assert(validGitHubSignal(signal,observed));
  assert(!validGitHubSignal({...signal,source:"owner-entered"},observed));
  assert(!validGitHubSignal({...signal,token:"private"},observed));
  assert(!validGitHubSignal({...signal,count:"12"},observed));
  assert(!validGitHubSignal({...signal,asOf:"2026-12-01T18:15:00.000Z"},observed));
  assert(!validGitHubSignal(signal,observed+GITHUB_SIGNAL_MAX_AGE_MS));
  for(const data of [
    {...identity,login:"attacker"},
    {...identity,type:"Organization"},
    {...identity,public_repos:-1},
    {...identity,public_repos:1.3},
    {...identity,public_repos:"12"},
    {...identity,public_repos:1000001}
  ])assert.throws(()=>normalizeGitHubProfile(data,new Date(observed).toISOString()));
  assert.equal(normalizeGitHubProfile({...identity,public_repos:0},new Date(observed).toISOString()).count,0);
});

test("first-party Worker fetches one fixed public GitHub endpoint, caches and restricts methods",async()=>{
  let calls=0,now=observed;
  const handler=createHandler({}, {version:"test"}, {
    now:()=>now,
    cache:null,
    fetchRecent:async(u)=>{assert.equal(u,GITHUB_REPOS_URL);return upstream([]);},
    fetchProfile:async(u,opts)=>{
      calls++;
      assert.equal(u,GITHUB_SIGNAL_URL);
      assert.equal(opts.method,"GET");
      assert.equal(opts.redirect,"error");
      assert.match(opts.headers.Accept,/github/);
      assert(opts.signal instanceof AbortSignal);
      return upstream();
    },
  });
  const first=await handler.fetch(request());
  assert.equal(first.status,200);
  assert.match(first.headers.get("Content-Type"),/application\/json/);
  assert.match(first.headers.get("Content-Security-Policy"),/connect-src 'self'/);
  assert.match(first.headers.get("Cache-Control"),/max-age=300/);
  assert.deepEqual(await first.json(),normalizeGitHubProfile(identity,new Date(observed).toISOString()));
  const second=await handler.fetch(request());
  assert.equal((await second.json()).count,12);
  assert.equal(calls,1,"Warm Worker isolate uses source cache");
  const head=await handler.fetch(request("HEAD"));
  assert.equal(head.status,200);
  assert.equal(await head.text(),"");
  assert.equal(calls,1);
  assert.equal((await handler.fetch(request("POST"))).status,405);
  assert.equal((await handler.fetch(request("GET","?user=someone-else"))).status,400);
  assert.equal(calls,1);
  now+=GITHUB_SIGNAL_MAX_AGE_MS+1000;
  const next=await handler.fetch(request());
  assert.equal(next.status,200);
  assert.equal(calls,2,"Cache expires and fetches an updated observation");
  assert.equal((await next.json()).asOf,new Date(now).toISOString());
});

test("edge snapshot persists across different Worker instances without leaking profiles",async()=>{
  const data=new Map(),cache={
    async match(key){return data.get(key)?.clone();},
    async put(key,response){data.set(key,response.clone());},
  };
  let calls=0;
  const make=()=>createHandler({}, {version:"test"}, {
    now:()=>observed,cache,
    fetchRecent:async(u)=>{assert.equal(u,GITHUB_REPOS_URL);return upstream([]);},
    fetchProfile:async()=>{calls++;return upstream();},
  });
  const one=await (await make().fetch(request())).json();
  assert.equal(one.count,12);
  assert(data.has(GITHUB_SIGNAL_CACHE_KEY));
  const two=await (await make().fetch(request())).json();
  assert.deepEqual(two,one);
  assert.equal(calls,1);
  const stored=await data.get(GITHUB_SIGNAL_CACHE_KEY).text();
  assert(!stored.includes("should-never-leak"));
  assert(!stored.includes("access_token"));
  assert(!stored.includes("900000"));
});

test("concurrent requests are coalesced and no traffic is proxied from a visitor",async()=>{
  let calls=0,resolve;
  const barrier=new Promise(r=>{resolve=r});
  const handler=createHandler({}, {version:"test"},{
    now:()=>observed,cache:null,
    fetchRecent:async(u)=>{assert.equal(u,GITHUB_REPOS_URL);return upstream([]);},
    fetchProfile:async(u,opts)=>{calls++;assert.equal(u,GITHUB_SIGNAL_URL);assert(!opts.headers.Cookie);await barrier;return upstream();},
  });
  const pending=[handler.fetch(request()),handler.fetch(request()),handler.fetch(request())];
  resolve();
  const result=await Promise.all(pending);
  assert(result.every(r=>r.status===200));
  assert.equal(calls,1);
});

test("upstream failures, malformed responses and retry cooldown never manufacture counts",async()=>{
  let now=observed,calls=0,respond=()=>upstream({message:"API rate limit exceeded"},403);
  const handler=createHandler({}, {version:"test"},{
    now:()=>now,cache:null,
    fetchRecent:async(u)=>{assert.equal(u,GITHUB_REPOS_URL);return upstream([]);},
    fetchProfile:async()=>{calls++;return respond();},
  });
  let result=await handler.fetch(request());
  assert.equal(result.status,503);
  assert.deepEqual(await result.json(),{error:"github_public_signal_unavailable"});
  assert.equal(result.headers.get("Cache-Control"),"no-store");
  assert.equal(result.headers.get("Retry-After"),"60");
  assert.equal(calls,1);
  await handler.fetch(request());
  assert.equal(calls,1,"Cooldown avoids bursts on rate limiting");
  now+=61000;
  respond=()=>upstream({...identity,login:"evil"});
  result=await handler.fetch(request());
  assert.equal(result.status,503);
  assert.equal(calls,2);
  now+=61000;
  respond=()=>new Response("not json",{headers:{"Content-Type":"text/html"}});
  result=await handler.fetch(request());
  assert.equal(result.status,503);
  assert.equal(calls,3);
  now+=61000;
  respond=()=>upstream({...identity,public_repos:0});
  result=await handler.fetch(request());
  assert.equal(result.status,200);
  assert.equal((await result.json()).count,0,"Verified zero is distinct from unavailable");
});

const repo = (name="devonakins.com",pushed="2026-11-02T18:11:00Z")=>({
 name, pushed_at:pushed, private:false, fork:false, archived:false, disabled:false,
 owner:{login:"anevum"}, html_url:"https://github.com/anevum/"+name,
 stargazers_count:99999,email:"private-data",permissions:{admin:true}
});
test("recent public code only selects canonical original repos with a dated push",()=>{
 const recent=normalizeRecentGitHubProject([
  {...repo("secret"),private:true},
  {...repo("upstream"),fork:true},
  {...repo("old"),archived:true},
  repo(),
 ],"2026-11-02T18:15:00.000Z");
 assert.deepEqual(recent,{name:"devonakins.com",url:"https://github.com/anevum/devonakins.com",pushedAt:"2026-11-02T18:11:00.000Z"});
 assert(!JSON.stringify(recent).includes("stargazers"));
 assert(!JSON.stringify(recent).includes("permissions"));
 assert.equal(normalizeRecentGitHubProject([{...repo(),owner:{login:"someone-else"}}],"2026-11-02T18:15:00.000Z"),null);
 for(const name of ["../evil",'evil" onclick="alert(1)',".",".."])assert.equal(normalizeRecentGitHubProject([repo(name)],"2026-11-02T18:15:00.000Z"),null);
 assert.equal(normalizeRecentGitHubProject([repo("future","2040-01-01T00:00:00Z")],"2026-11-02T18:15:00.000Z"),null);
 assert.throws(()=>normalizeRecentGitHubProject(Array.from({length:11},()=>repo()),"2026-11-02T18:15:00.000Z"));
});
test("optional recent code remains bounded, cached and free of private fields",async()=>{
 let repoCalls=0,personCalls=0;
 const handler=createHandler({}, {version:"test"},{
  now:()=>observed,cache:null,
  fetchProfile:async(u)=>{personCalls++;assert.equal(u,GITHUB_SIGNAL_URL);return upstream();},
  fetchRecent:async(u,opts)=>{repoCalls++;assert.equal(u,GITHUB_REPOS_URL);assert.equal(opts.redirect,"error");return upstream([repo()]);}
 });
 const profile=await (await handler.fetch(request())).json();
 assert.equal(profile.version,2);
 assert.equal(profile.recent.name,"devonakins.com");
 assert.equal(profile.recent.pushedAt,"2026-11-02T18:11:00.000Z");
 assert(!JSON.stringify(profile).includes("private-data"));
 assert(!JSON.stringify(profile).includes("permissions"));
 assert(validGitHubSignal(profile,observed));
 for(const recent of [
 {...profile.recent,url:"javascript:alert(1)"},
 {...profile.recent,name:"<script>"},
 {...profile.recent,pushedAt:"2030-01-01T00:00:00.000Z"},
 {...profile.recent,token:"secret"}
 ])assert(!validGitHubSignal({...profile,recent},observed));
 await handler.fetch(request());
 assert.equal(personCalls,1);assert.equal(repoCalls,1);
});
test("failed optional repo listing leaves verified public count intact",async()=>{
 const handler=createHandler({}, {version:"test"},{
  now:()=>observed,cache:null,fetchProfile:async()=>upstream(),
  fetchRecent:async()=>upstream({message:"rate limited"},403),
 });
 const result=await handler.fetch(request());
 assert.equal(result.status,200);
 const payload=await result.json();
 assert.equal(payload.count,12);
 assert.equal(payload.recent,null);
});
