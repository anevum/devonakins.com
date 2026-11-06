/**
 * First-party, privacy-first public presence projector for DevonAkins.com.
 * No editor text, path, user agent, IP, session ID, track, or repository metadata
 * are returned. Source adapters authenticate and validate before calling this.
 * Source-only prototype: not connected to a production route or owner account.
 */

const ALLOWED_PROJECTS = Object.freeze({
  merit: 'Merit',
  rhen: 'Rhen',
  mizvo: 'Mizvo',
  devonstation: 'DevonStation',
  squelch: 'Squelch',
  anevum: 'Anevum',
});
const MANUAL_STATUSES = new Set(['writing', 'researching', 'family-time', 'sleeping', 'away']);
const HEARTBEAT_TTL_MS = 120_000;
const PLAYBACK_TTL_MS = 120_000;
const MAX_CLOCK_SKEW_MS = 10_000;
const MANUAL_TTL_MS = 30 * 60_000;
const fixed = (visibility, state, asOf = null, source = 'none', project = null) =>
  Object.freeze({ version: 1, visibility, state, asOf, source, project });

function freshTime(iso, now, ttl) {
  if (typeof iso !== 'string' || iso.length > 36) return null;
  const time = Date.parse(iso);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== iso) return null;
  if (time > now + MAX_CLOCK_SKEW_MS || now - time > ttl) return null;
  return iso;
}

/**
 * Projection contract: flags must be literal booleans. Unknown data fails closed.
 * An owner-controlled privacy override precedes session and playback evidence.
 * A manually declared remote session is not editor-observed activity.
 * Input contains only allowlisted, server-validated booleans/timestamps/slugs.
 */
export function projectPublicPresence(input, now = Date.now()) {
  if (!Number.isFinite(now) || !input || typeof input !== 'object' || Array.isArray(input) ||
      input.publicEnabled !== true) {
    return fixed('hidden', 'not-broadcasting');
  }
  if (input.broadcastOff === true) return fixed('hidden', 'not-broadcasting');
  if (input.privateOverride === true) return fixed('public', 'working-privately');

  const manual = input.manual;
  if (manual && typeof manual === 'object' && !Array.isArray(manual) &&
      MANUAL_STATUSES.has(manual.state) && manual.approved === true) {
    const asOf = freshTime(manual.asOf, now, MANUAL_TTL_MS);
    if (asOf) return fixed('public', manual.state, asOf, 'owner-manual');
  }

  const session = input.session;
  const allowedSource = session && (session.source === 'editor-heartbeat' || session.source === 'owner-declared');
  const observedAt = allowedSource && session.approved === true
    ? freshTime(session.asOf, now, session.source === 'editor-heartbeat'
      ? HEARTBEAT_TTL_MS : MANUAL_TTL_MS)
    : null;
  const active = Boolean(observedAt);
  const music = input.playback;
  const playingAt = input.shareListening === true && music && music.playing === true &&
    music.approved === true ? freshTime(music.asOf, now, PLAYBACK_TTL_MS) : null;
  const playing = Boolean(playingAt);
  const project = active && session.publicProject === true &&
    Object.hasOwn(ALLOWED_PROJECTS, session.projectSlug)
    ? ALLOWED_PROJECTS[session.projectSlug] : null;

  if (active) {
    // Listening evidence may be more recent than editing evidence, but the
    // presence source stays explicit and must never imply editor verification
    // for owner-declared remote sessions.
    return fixed('public', playing ? 'in-the-zone' : 'developing', observedAt,
      session.source, project);
  }
  if (playing) return fixed('public', 'listening', playingAt, 'spotify-playback');
  if (session && session.approved === true) return fixed('public', 'idle');
  return fixed('public', 'offline');
}

export const PRESENCE_PROJECTOR_POLICY = Object.freeze({
  publicProjects: Object.keys(ALLOWED_PROJECTS),
  sessionTtlSeconds: HEARTBEAT_TTL_MS / 1000,
  playbackTtlSeconds: PLAYBACK_TTL_MS / 1000,
  manualTtlSeconds: MANUAL_TTL_MS / 1000,
});