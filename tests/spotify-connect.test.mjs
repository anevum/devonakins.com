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
