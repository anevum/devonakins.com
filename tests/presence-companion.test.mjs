import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(
  new URL("../extensions/presence-vscode/extension.cjs", import.meta.url),
  "utf8",
);
const start = Date.parse("2026-11-06T20:00:00.000Z");
const key = "devon-presence-pairing-v1";
const pairing = () => ({
  token: "T".repeat(43),
  expiresAt: new Date(start + 3600000).toISOString(),
  projects: [],
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const settle = () => new Promise((resolve) => setImmediate(resolve));
function companion({ transport, readSecret, storeSecret, deleteSecret, globals = new Map() } = {}) {
  let edit;
  let disposed = false;
  const secretValues = new Map();
  const signals = [];
  const errors = [];
  const texts = [];
  const status = {
    set text(value) {
      assert.equal(disposed, false, "disposed UI must not be updated");
      texts.push(value);
    },
    show() {},
    dispose() {
      disposed = true;
    },
  };
  const api = {
    StatusBarAlignment: { Right: 1 },
    window: {
      state: { focused: true },
      createStatusBarItem: () => status,
      showInputBox: async () => "P".repeat(43),
      showInformationMessage: async () => {},
      showErrorMessage: async (value) => {
        errors.push(value);
      },
    },
    commands: {
      registerCommand() {
        return { dispose() {} };
      },
    },
    workspace: {
      onDidChangeTextDocument(fn) {
        edit = fn;
        return { dispose() {} };
      },
    },
  };
  const context = {
    subscriptions: [],
    secrets: {
      async get(name) {
        return readSecret ? readSecret(name) : secretValues.get(name);
      },
      async store(name, value) {
        if (storeSecret) await storeSecret();
        secretValues.set(name, value);
      },
      async delete(name) {
        if (deleteSecret) await deleteSecret();
        secretValues.delete(name);
      },
    },
    globalState: { get(name) {return globals.get(name);}, async update(name,value) {globals.set(name,value);} },
  };
  const sandbox = {
    require: () => api,
    exports: {},
    AbortSignal,
    Date,
    JSON,
    Promise,
    setInterval,
    clearInterval,
  };
  vm.runInNewContext(source, sandbox);
  const client = sandbox.exports.createCompanion(api, context, {
    clock: () => start,
    setTimer: () => 1,
    clearTimer() {},
    async fetcher(url, init) {
      const body = JSON.parse(init.body);
      if (url.endsWith("/heartbeat")) signals.push(body);
      if (transport) return transport(url, init, body);
      return Response.json(
        url.endsWith("/claim") ? pairing() : { accepted: true },
      );
    },
  });
  return {
    client,
    signals,
    secretValues,
    texts,
    errors,
    edit() {
      edit({
        contentChanges: [{}],
        get document() {
          throw Error("private document must not be read");
        },
      });
    },
    async pairAndResume() {
      await client.ready;
      await client.actions.pair();
      await client.actions.resume();
    },
  };
}

for (const action of ["pause", "disconnect"]) {
  test(`${action} follows an in-flight active heartbeat with a newer inactive signal`, async () => {
    const active = deferred();
    const f = companion({
      async transport(url, init, body) {
        if (url.endsWith("/claim")) return Response.json(pairing());
        if (body.active) await active.promise;
        return Response.json({ accepted: true });
      },
    });
    await f.pairAndResume();
    f.edit();
    const stopping = f.client.actions[action]();
    assert.equal(f.signals.length, 1);
    const writesBeforeResponse = f.texts.length;
    active.resolve();
    await stopping;
    assert.deepEqual(
      f.signals.map((value) => value.active),
      [true, false],
    );
    assert.ok(
      Date.parse(f.signals[1].observedAt) > Date.parse(f.signals[0].observedAt),
    );
    assert.ok(
      f.texts
        .slice(writesBeforeResponse)
        .every((value) => !value.includes("editor active")),
    );
    if (action === "disconnect") {
      assert.equal(f.secretValues.has(key), false);
      await f.client.actions.resume();
      f.edit();
      await settle();
      assert.equal(
        f.signals.length,
        2,
        "forgetting must prevent subsequent active signals",
      );
    }
    f.client.dispose();
  });
}

test("a rejected active heartbeat still permits a stop attempt and cannot overwrite paused UI", async () => {
  const active = deferred();
  const f = companion({
    async transport(url, init, body) {
      if (url.endsWith("/claim")) return Response.json(pairing());
      if (body.active) {
        await active.promise;
        throw Error("synthetic transport rejection");
      }
      return Response.json({ accepted: true });
    },
  });
  await f.pairAndResume();
  f.edit();
  const paused = f.client.actions.pause();
  active.resolve();
  await paused;
  assert.deepEqual(
    f.signals.map((value) => value.active),
    [true, false],
  );
  assert.match(f.texts.at(-1), /paused/);
  f.client.dispose();
});

test("shutdown fences a pending response and any new editor events", async () => {
  const active = deferred();
  const f = companion({
    async transport(url, init, body) {
      if (url.endsWith("/claim")) return Response.json(pairing());
      if (body.active) await active.promise;
      return Response.json({ accepted: true });
    },
  });
  await f.pairAndResume();
  f.edit();
  f.client.dispose();
  active.resolve();
  await settle();
  f.edit();
  await settle();
  assert.equal(f.signals.length, 1);
});

test("forgetting prevents a delayed pairing claim from restoring credentials", async () => {
  const claim = deferred();
  const f = companion({
    async transport() {
      await claim.promise;
      return Response.json(pairing());
    },
  });
  await f.client.ready;
  const pairingRequest = f.client.actions.pair();
  await settle();
  await f.client.actions.disconnect();
  claim.resolve();
  await pairingRequest;
  assert.equal(f.secretValues.has(key), false);
  assert.match(f.texts.at(-1), /pairing forgotten/);
  f.client.dispose();
});

test("forgetting orders deletion after a pending save and prevents later restoration", async () => {
  const saved = deferred();
  const f = companion({ storeSecret: () => saved.promise });
  await f.client.ready;
  const pairingRequest = f.client.actions.pair();
  await settle();
  const forgotten = f.client.actions.disconnect();
  saved.resolve();
  await Promise.all([pairingRequest, forgotten]);
  assert.equal(f.secretValues.has(key), false);
  assert.match(f.texts.at(-1), /pairing forgotten/);
  f.client.dispose();
});

test("a delayed startup secret read cannot restore a forgotten token", async () => {
  const restored = deferred();
  const f = companion({ readSecret: () => restored.promise });
  await f.client.actions.disconnect();
  restored.resolve(
    JSON.stringify({
      token: "T".repeat(43),
      expires: start + 3600000,
      projects: [],
    }),
  );
  await f.client.ready;
  await f.client.actions.resume();
  f.edit();
  await settle();
  assert.equal(f.signals.length, 0);
  assert.match(f.texts.at(-1), /pairing required/);
  f.client.dispose();
});

test("credential deletion failure is visible and Forget Pairing can be retried", async () => {
  let fail = true;
  const f = companion({
    async deleteSecret() {
      if (fail) throw Error("synthetic storage failure");
    },
  });
  await f.pairAndResume();
  await f.client.actions.disconnect();
  assert.equal(f.secretValues.has(key), true);
  assert.match(f.texts.at(-1), /removal failed/);
  assert.equal(f.errors.length, 1);
  fail = false;
  await f.client.actions.disconnect();
  assert.equal(f.secretValues.has(key), false);
  assert.match(f.texts.at(-1), /pairing forgotten/);
  f.client.dispose();
});


test("explicit sharing consent survives restart; pause persists and startup never invents an edit",async()=>{
 const globals=new Map([["sharingEnabled",true]]);
 const saved=JSON.stringify({token:"T".repeat(43),expires:start+3600000,projects:[]});
 const first=companion({globals,readSecret:async()=>saved});await first.client.ready;
 assert.equal(first.signals.length,0);first.edit();await settle();assert.equal(first.signals[0].active,true);
 await first.client.actions.pause();assert.equal(globals.get("sharingEnabled"),false);first.client.dispose();
 const second=companion({globals,readSecret:async()=>saved});await second.client.ready;second.edit();await settle();assert.equal(second.signals.length,0);second.client.dispose();
});
