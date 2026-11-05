import test from "node:test";
import assert from "node:assert/strict";
import { makeVerifier, makeState, authorizationURL, redirectURI, parseCallback, challengeFromVerifier, SPOTIFY_SCOPE } from "../scripts/spotify-connect.mjs";

const clientId = "0123456789abcdef0123456789abcdef";

test("loopback authorization has PKCE challenge and minimal scope", () => {
  const verifier = makeVerifier();
  const state = makeState();
  const link = new URL(authorizationURL({clientId, verifier, state}));
  assert.equal(link.origin, "https://accounts.spotify.com");
  assert.equal(link.searchParams.get("redirect_uri"), redirectURI());
  assert.equal(link.searchParams.get("scope"), SPOTIFY_SCOPE);
  assert.equal(link.searchParams.get("code_challenge"), challengeFromVerifier(verifier));
  assert.equal(link.searchParams.has("client_secret"), false);
  assert.throws(() => redirectURI(80));
});

test("callback checks exact origin and one-time state", () => {
  const state = makeState();
  assert.equal(parseCallback("/callback?state=" + state + "&code=abc", state), "abc");
  assert.throws(() => parseCallback("/callback?state=" + makeState() + "&code=abc", state));
  assert.throws(() => parseCallback("https://bad.invalid/callback?state=" + state + "&code=abc", state));
  assert.throws(() => parseCallback("/callback?state=" + state + "&code=a&code=b", state));
});

import { exchangeCode, saveCredentials, parseArgs } from "../scripts/spotify-connect.mjs";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("PKCE exchange requires granted playback scope", async () => {
  const verifier = makeVerifier();
  const fake = async (url, options) => {
    assert.equal(url, "https://accounts.spotify.com/api/token");
    assert.equal(options.method, "POST");
    const body = new URLSearchParams(options.body);
    assert.equal(body.get("client_id"), clientId);
    assert.equal(body.get("code_verifier"), verifier);
    assert.equal(body.get("grant_type"), "authorization_code");
    return new Response(JSON.stringify({
      token_type:"Bearer", access_token:"placeholder_access",
      refresh_token:"placeholder_refresh", scope:SPOTIFY_SCOPE
    }), {status:200});
  };
  const result=await exchangeCode({clientId,code:"temporary-code",verifier,fetcher:fake});
  assert.equal(result.scope,SPOTIFY_SCOPE);
  const wrongScope=async()=>new Response(JSON.stringify({
    token_type:"Bearer",access_token:"placeholder_access",refresh_token:"placeholder_refresh",scope:"user-read-email"
  }),{status:200});
  await assert.rejects(()=>exchangeCode({clientId,code:"temporary-code",verifier,fetcher:wrongScope}));
});

test("local owner files have private permissions and require explicit replacement",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"local-listening-"));
  try{
    const settings={directory:dir,clientId,refreshToken:"placeholder_refresh",scope:SPOTIFY_SCOPE,now:new Date("2026-11-05T00:00:00Z")};
    const saved=await saveCredentials(settings);
    assert.equal((await readFile(saved.secretPath,"utf8")).trim(),"placeholder_refresh");
    assert.equal((await stat(saved.secretPath)).mode&0o077,0);
    assert.equal((await stat(dir)).mode&0o077,0);
    const metadata=JSON.parse(await readFile(saved.metadataPath,"utf8"));
    assert.equal(metadata.publicBroadcastEnabled,false);
    assert.equal(metadata.reauthorizationDueBy,"2027-05-05T00:00:00.000Z");
    await assert.rejects(()=>saveCredentials(settings));
    assert.equal((await readFile(saved.secretPath,"utf8")).trim(),"placeholder_refresh");
  }finally{await rm(dir,{recursive:true,force:true});}
});
