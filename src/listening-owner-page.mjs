/** Owner-only mobile UI; never contains account credentials. */
export function renderListeningOwner() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow,noarchive">
<meta name="theme-color" content="#080b13">
<title>Listening Control — Devon Alan Akins</title>
<link rel="stylesheet" href="/v2/listening-owner.css"><link rel="stylesheet" href="/v2/presence.css">
</head>
<body>
<a class="skip" href="#main">Skip to controls</a>
<div class="halo" aria-hidden="true"></div>
<header class="topbar">
  <a href="/" class="wordmark">DEVON ALAN AKINS <span>/ CONTROL ROOM</span></a>
  <a href="/listening/" class="return">PUBLIC LISTENING <span aria-hidden="true">↗</span></a>
</header>
<main id="main" class="container">
  <div class="eyebrow"><span class="live-dot" aria-hidden="true"></span> PRIVATE / OWNER SESSION</div>
  <h1>Listen anywhere.<br><em>Share deliberately.</em></h1>
  <p class="intro">Connect your Spotify account once. Your site can then read playback from any device signed into Spotify. Nothing is published without your approval.</p>
  <div class="grid">
    <section class="card connection" aria-labelledby="connection-heading">
      <div class="card-head"><span>01 / ACCOUNT</span><span class="state" id="connection-state">CHECKING</span></div>
      <div class="record"><div class="vinyl" aria-hidden="true"><span></span></div><div class="record-copy">
        <h2 id="connection-heading">Spotify connection</h2>
        <p id="connection-description">Checking your private connection…</p>
      </div></div>
      <div class="actions">
        <button type="button" id="connect" disabled>Connect Spotify</button>
        <button type="button" id="disconnect" class="secondary" disabled>Disconnect</button>
      </div>
      <p class="fine" id="spotify-setup" hidden><strong>Spotify app setup required.</strong> Open the <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener noreferrer">Spotify Developer Dashboard</a> to create an app. Register this exact redirect URI: <code>https://devonakins.com/api/listening/oauth/callback</code>. Then add the app's Client ID as the <code>SPOTIFY_CLIENT_ID</code> variable on the <code>devonakins-personal</code> Cloudflare Worker. Reload this private page to connect. No Client Secret is needed for PKCE.</p>
      <p class="fine">Spotify authorization is read-only. You retain control over what the public website can show.</p>
      <div class="private-preview" aria-labelledby="private-preview-heading">
        <h3 id="private-preview-heading">Private playback check</h3>
        <p class="fine">Test the currently playing track on any Spotify device. This checks once, only when you tap the button. Track details stay in your private session and are never published or stored as history.</p>
        <button type="button" id="preview-playback" class="secondary" disabled>Check playback privately</button>
        <p id="preview-status" class="fine" role="status" aria-live="polite">Connect Spotify to run a private check.</p>
      </div>
    </section>
    <section class="card privacy" aria-labelledby="privacy-heading">
      <div class="card-head"><span>02 / DISCLOSURE</span><span>OFF BY DEFAULT</span></div>
      <h2 id="privacy-heading">Visibility controls</h2>
      <label class="setting" for="public-status"><span><strong>Share Spotify playback</strong><small>Publish listening status independently of development</small></span><input type="checkbox" id="public-status" disabled></label>
      <label class="setting" for="track-details"><span><strong>Show track and artist</strong><small>Display the current Spotify song and official artwork</small></span><input type="checkbox" id="track-details" disabled></label>
      <button id="save-settings" type="button" class="secondary" disabled>Save visibility settings</button>
      <p class="fine" id="release-message">Public broadcasting remains locked until the release review is approved.</p>
    </section>
  </div>
  <section class="card presence-project-card" aria-labelledby="collections-title">
    <h2 id="collections-title">Curated public playlists</h2>
    <p class="fine">Choose up to twelve playlists you created and made public. Only these selections can appear on the website; private playlists and saved songs are never mirrored.</p>
    <label class="presence-field">Spotify playlist links or IDs, one per line<textarea id="collections-ids" rows="4" autocomplete="off" spellcheck="false" disabled></textarea></label>
    <label class="setting"><span><strong>Share these playlists</strong><small>Public ownership is verified with Spotify before publication.</small></span><input type="checkbox" id="collections-enabled" disabled></label>
    <button type="button" id="collections-save" disabled>Save playlist choices</button>
    <p class="fine" id="collections-status" role="status">Checking playlist controls…</p>
  </section>
  <section class="lower" aria-labelledby="connection-details">
    <h2 id="connection-details">Connection details</h2>
    <div><span>Account status</span><strong id="detail-status">Not connected</strong></div>
    <div><span>Reauthorize by</span><strong id="reauth-date">—</strong></div>
    <div><span>Public signal</span><strong id="public-state">Disabled</strong></div>
    <p>Spotify playback does not prove editor activity. Some offline and private playback may not be reported by Spotify. <a href="/owner/presence/">Presence controls and stop broadcasting ↗</a></p>
  </section>
  <p class="notice" id="notice" role="status" aria-live="polite">Loading private connection status…</p>
</main>
<footer>PERSONAL SPACE / PRIVATE CONTROL <span>NO AUTOPLAY · NO PUBLIC AUTH TOKENS</span></footer>
<script src="/v2/listening-owner.js" defer></script>
</body></html>`;
}
