import test from 'node:test';
import assert from 'node:assert/strict';
import {projectPublicPresence, PRESENCE_PROJECTOR_POLICY} from '../src/presence-model.mjs';
const now = Date.parse('2026-11-06T17:00:00.000Z');
const ago = ms => new Date(now - ms).toISOString();
const freshSession = (extra = {}) => ({approved:true, source:'editor-heartbeat', asOf:ago(15_000),publicProject:true,projectSlug:'merit',...extra});
const freshMusic = {playing:true,approved:true,asOf:ago(10_000)};
const base = {publicEnabled:true,shareListening:true,session:freshSession(),playback:freshMusic};
test('defaults to non-disclosure when flag, input or clock is invalid', () => {
 for(const input of [undefined,{}, {publicEnabled:1}, {...base,publicEnabled:false}]) {
  assert.deepEqual(projectPublicPresence(input,now),{version:1,visibility:'hidden',state:'not-broadcasting',asOf:null,source:'none',project:null});
 }
});
test('independent editor and music signals combine only when both are fresh and opted in', () => {
 const zone=projectPublicPresence(base,now);
 assert.equal(zone.state,'in-the-zone'); assert.equal(zone.project,'Merit'); assert.equal(zone.source,'editor-heartbeat');
 assert.equal(projectPublicPresence({...base,shareListening:false},now).state,'developing');
 assert.equal(projectPublicPresence({...base,session:null},now).state,'listening');
});
test('music never proves coding and owner-declared session is distinct', () => {
 assert.equal(projectPublicPresence({publicEnabled:true,playback:freshMusic,shareListening:true},now).source,'spotify-playback');
 const declared=projectPublicPresence({...base,session:freshSession({source:'owner-declared'})},now);
 assert.equal(declared.state,'in-the-zone'); assert.equal(declared.source,'owner-declared');
});
test('expired editor heartbeat becomes idle and cannot stay live', () => {
 const stale=projectPublicPresence({...base,session:freshSession({asOf:ago(121_000)}),playback:null},now);
 assert.equal(stale.state,'idle');assert.equal(stale.asOf,null);assert.equal(stale.project,null);
 assert.equal(projectPublicPresence({publicEnabled:true},now).state,'offline');
});
test('private and kill switches override everything else', () => {
 const privateState=projectPublicPresence({...base,privateOverride:true},now);
 assert.equal(privateState.state,'working-privately');assert.equal(privateState.project,null);assert.equal(privateState.asOf,null);
 assert.equal(projectPublicPresence({...base,broadcastOff:true},now).visibility,'hidden');
 assert.equal(projectPublicPresence({...base,broadcastOff:true,privateOverride:true},now).visibility,'hidden');
});
test('project slug must match an exact public allowlist, never free text',()=>{
 for(const slug of ['private-clinical','../.env','MERIT','merit<script>']) {
  assert.equal(projectPublicPresence({...base,session:freshSession({projectSlug:slug})},now).project,null);
 }
 assert.equal(projectPublicPresence({...base,session:freshSession({publicProject:false})},now).project,null);
});
test('manually selected sleeping is explicit, ephemeral, and not inferred from inactivity',()=>{
 const state=projectPublicPresence({...base,manual:{approved:true,state:'sleeping',asOf:ago(50_000)}},now);
 assert.equal(state.state,'sleeping');assert.equal(state.source,'owner-manual');
 const expired=projectPublicPresence({...base,session:null,playback:null,manual:{approved:true,state:'sleeping',asOf:ago(31*60_000)}},now);
 assert.equal(expired.state,'offline');
});
test('invalid timestamps, future timestamps, and arbitrary manual labels fail closed',()=>{
 const staleMusic={...freshMusic,asOf:'not-a-timestamp'};
 const wrong=projectPublicPresence({...base,session:freshSession({asOf:new Date(now+30_000).toISOString()}),playback:staleMusic,manual:{approved:true,state:'coding',asOf:ago(1_000)}},now);
 assert.equal(wrong.state,'idle');
});
test('no source fields or private objects escape public projection',()=>{
 const payload={...base,session:freshSession({filename:'patient.md',fileContent:'private',repo:'secret',branch:'client',token:'TOP_SECRET'}),secret:'HIDDEN'};
 const text=JSON.stringify(projectPublicPresence(payload,now));
 for (const forbidden of ['patient.md','private','secret','client','TOP_SECRET','fileContent','token']) assert.equal(text.includes(forbidden),false,forbidden);
 assert.deepEqual(PRESENCE_PROJECTOR_POLICY.publicProjects.includes('patient-clinical'),false);
});