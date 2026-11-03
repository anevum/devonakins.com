/**
 * Create the canonical portrait home from the approved V2 preview source.
 * The /v2/ page remains noindex and does not change.
 */
export function promotePortraitHome(previewHtml) {
  if (typeof previewHtml !== "string") throw new TypeError("Expected V2 HTML source");
  let html = previewHtml;
  const replaceOnce = (from, to) => {
    if (html.split(from).length !== 2)
      throw new Error("V2 homepage template changed: " + from.slice(0, 80));
    html = html.replace(from, to);
  };
  replaceOnce(
    '<meta name="robots" content="noindex,nofollow">',
    '<link rel="canonical" href="https://devonakins.com/">',
  );
  replaceOnce(
    '<meta name="description" content="A private-preview interface for Devon Alan Akins: family, original writing, software, systems design, and research.">',
    '<meta name="description" content="Devon Alan Akins is a father, author and independent developer creating original worlds, open-source software and useful systems.">',
  );
  replaceOnce(
    '<title>Devon Alan Akins — Immersive Interface V2 Preview</title>',
    [
      '<title>Devon Alan Akins — Father, Author and Developer</title>',
      '<meta property="og:type" content="website">',
      '<meta property="og:site_name" content="Devon Alan Akins">',
      '<meta property="og:title" content="Devon Alan Akins — Father, Author and Developer">',
      '<meta property="og:description" content="Original worlds, open-source software and useful systems.">',
      '<meta property="og:url" content="https://devonakins.com/">',
      '<meta property="og:image" content="https://devonakins.com/social-card.jpg">',
      '<meta name="twitter:card" content="summary_large_image">',
      '<meta name="twitter:image" content="https://devonakins.com/social-card.jpg">',
    ].join("\n  "),
  );
  replaceOnce(
    '<span class="topbar-version">/ V2 PREVIEW</span>',
    '<span class="topbar-version">/ ORIGINAL WORKS</span>',
  );
  replaceOnce(
    '<a href="/">Current public website <span aria-hidden="true">↗</span></a>',
    '<a href="/about/">Extended biography <span aria-hidden="true">↗</span></a>',
  );
  replaceOnce(
    'JavaScript is required to switch preview panels. The <a href="/">current homepage</a> and <a href="/work/">work archive</a> remain usable.',
    'JavaScript is required to switch interactive panels. The <a href="/work/">work archive</a> and <a href="/about/">about page</a> remain usable.',
  );
  return html;
}
