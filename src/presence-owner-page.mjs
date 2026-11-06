/** Private controls reuse the existing protected Listening control-room design. */
export function renderPresenceOwner() {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow,noarchive"><title>Presence Control — Devon Alan Akins</title>
<link rel="stylesheet" href="/v2/listening-owner.css"><link rel="stylesheet" href="/v2/presence.css"></head><body>
<a class="skip" href="#main">Skip to controls</a><header class="topbar"><a class="wordmark" href="/">DEVON ALAN AKINS <span>/ CONTROL ROOM</span></a><a class="return" href="/owner/listening/">SPOTIFY CONNECTION ↗</a></header>
<main class="container" id="main"><div class="eyebrow">PRIVATE / OWNER SESSION</div>
<h1>Your work.<br><em>Your signal.</em></h1><p class="intro">Start a short session from any device. Remote sessions are labeled owner-declared. Nothing here observes your editor or conversations.</p>
<div class="grid"><section class="card" aria-labelledby="session-title"><h2 id="session-title">Development session</h2>
<label class="presence-field">Public project<select id="presence-project"><option value="">No public project</option></select></label>
<label class="presence-field">Expires after<select id="presence-duration"><option value="15">15 minutes</option><option value="30">30 minutes</option></select></label>
<div class="actions"><button id="session-start" type="button" disabled>Start session</button><button id="session-pause" type="button" class="secondary" disabled>Pause</button><button id="session-resume" type="button" class="secondary" disabled>Resume</button><button id="session-end" type="button" class="secondary" disabled>End session</button></div>
<p class="fine" id="session-expiry">No active session.</p>
<label class="presence-field">Manual status<select id="presence-manual"><option value="writing">Writing</option><option value="researching">Researching</option><option value="family-time">Family time</option><option value="sleeping">Sleeping</option><option value="away">Away</option></select></label>
<div class="actions"><button id="manual-set" type="button" class="secondary" disabled>Set status</button><button id="manual-clear" type="button" class="secondary" disabled>Clear status</button></div></section>
<section class="card" aria-labelledby="sharing-title"><h2 id="sharing-title">Public visibility</h2>
<label class="setting"><span><strong>Broadcast presence</strong><small>Off until release approval and your opt-in</small></span><input type="checkbox" id="presence-enabled" disabled></label>
<label class="setting"><span><strong>Work privately</strong><small>Hide project and all music while this is selected</small></span><input type="checkbox" id="presence-private" disabled></label>
<label class="setting"><span><strong>Allow Spotify sharing</strong><small>Also requires Spotify's separate sharing approval</small></span><input type="checkbox" id="presence-music" disabled></label>
<div class="actions"><button id="presence-save" type="button" disabled>Save visibility</button><button id="presence-off" type="button" class="presence-stop" disabled>Stop all broadcasting</button></div>
<h3>Public preview</h3><p id="presence-preview" role="status">Not broadcasting.</p><p class="fine">This is the presence projection. Track details, when separately enabled, appear on the public Listening page. Existing visitors clear on their next refresh, within 60 seconds while connected.</p>
<a href="/studio/" target="_blank" rel="noopener">Open public preview ↗</a></section></div>
<p class="notice" id="presence-notice" role="status">Checking private controls…</p></main>
<script src="/v2/presence-owner.js" defer></script></body></html>`;
}
