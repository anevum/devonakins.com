import { renderPublicGptProfile } from "./gpt-profile.mjs";
/**
 * Render every public deep link inside the same cinematic shell as the home
 * interface. Legacy page source stays in Git history for reversible recovery,
 * but no public HTML route ships the old navbar or old stylesheet.
 */
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));
const link = (href, label, className = "route-link") =>
  '<a class="' + className + '" href="' + esc(href) + '">' + esc(label) + '<span aria-hidden="true"> ↗</span></a>';
const external = (href, label) =>
  '<a class="route-link" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' +
  esc(label) + '<span aria-hidden="true"> ↗</span></a>';
const paragraph = (content) => '<p>' + esc(content) + '</p>';
const block = (label, body) =>
  '<article class="route-block"><p class="route-block-label">' + esc(label) + '</p>' + body + '</article>';

function layout({ breadcrumb, index, title, intro, body, actions = "", brand = "" }) {
  return '<div class="panel-inner route-panel-inner"><div class="route-content">' +
    '<nav class="route-breadcrumb" aria-label="Breadcrumb">' + breadcrumb + '</nav>' +
    '<header class="route-header' + (brand ? ' route-header-with-brand' : '') + '">' +
    '<span class="route-kicker"><span class="route-kicker-line" aria-hidden="true"></span>' + esc(index) + '</span>' +
    brand + '<h1 class="route-title">' + esc(title) + '<span class="route-stop">.</span></h1>' +
    '<p class="route-lead">' + esc(intro) + '</p></header>' +
    body +
    '<nav class="route-actions" aria-label="Related destinations">' + actions + '</nav>' +
    '</div></div>';
}

const PUBLIC_PROJECT_IDENTITIES = Object.freeze({
  merit: { file: "merit.svg", width: 580, kind: "wordmark" },
  "rhen-language": { file: "rhen.svg", width: 560, kind: "wordmark" },
  squelch: { file: "squelch.svg", width: 770, kind: "wordmark" },
  brandicade: { file: "brandicade.svg", width: 646, kind: "wordmark" },
  anevum: { file: "anevum.svg", width: 434, kind: "wordmark" },
  ideaflow: { file: "ideaflow-mark.svg", width: 112, kind: "emblem" },
  devonstation: { file: "devonstation-mark.svg", width: 112, kind: "emblem" },
});
// The historical /work/rhen/ finance page deliberately has no programming-language identity.
// This is a fixed map: portfolio content cannot supply arbitrary image paths.
const projectIdentity = (project) => Object.hasOwn(PUBLIC_PROJECT_IDENTITIES, project.slug)
  ? PUBLIC_PROJECT_IDENTITIES[project.slug] : null;

function projectBrandTitle(project) {
  const asset = projectIdentity(project);
  if (!asset) return '<strong>' + esc(project.title) + '</strong>';
  const src = '/v2/identity/' + asset.file;
  if (asset.kind === "emblem") {
    return '<strong class="route-project-brand route-project-brand-compact">' +
      '<img src="' + src + '" alt="" width="112" height="112" decoding="async" loading="lazy">' +
      '<span>' + esc(project.title) + '</span></strong>';
  }
  return '<strong class="route-project-brand"><img src="' + src + '" alt="' +
    esc(project.title) + '" width="' + asset.width +
    '" height="112" loading="lazy" decoding="async"></strong>';
}

function detailBrand(project) {
  const asset = projectIdentity(project);
  if (!asset) return "";
  // The real H1 beneath this decorative accent remains plain searchable text.
  return '<div class="route-header-identity" aria-hidden="true"><img src="/v2/identity/' +
    asset.file + '" alt="" width="' + asset.width + '" height="112" decoding="async"></div>';
}

function projectCard(project, index) {
  const asset = projectIdentity(project);
  const modifier = asset ? ' route-project-' + esc(project.slug) : '';
  const brandAttribute = asset ? ' data-identity="' + esc(project.slug) + '"' : '';
  return '<a class="route-project' + modifier + '"' + brandAttribute +
    ' href="/work/' + esc(project.slug) + '/">' +
    '<span class="route-project-index">' + String(index + 1).padStart(2, "0") + ' / ' + esc(project.category) + '</span>' +
    projectBrandTitle(project) +
    '<span class="route-project-description">' + esc(project.summary) + '</span>' +
    '<span class="route-project-footer"><span>' + esc(project.status) + '</span><span aria-hidden="true">↗</span></span>' +
    '</a>';
}

function contentFor(path, projects, gptSnapshot) {
  const parent = '<a href="/#work">Interface</a><span aria-hidden="true"> / </span>';
  if (path === "/work/") {
    return {
      view: "work", title: "Selected work", description: "Original writing, independent software and practical systems, with honest project status.",
      index: "01 / ACTIVE PORTFOLIO", heading: "What I build",
      intro: "Books, original worlds, open-source software and the systems behind real work. Active projects are clearly distinguished from finished releases.",
      breadcrumb: parent + '<span aria-current="page">Work archive</span>',
      body: '<div class="route-projects">' + projects.map(projectCard).join("") + '</div>' +
        '<p class="route-fine-print">Private records, client details and unpublished manuscripts stay private. The links above lead to public project records in this same interface.</p>',
      actions: link("/#work", "Return to overview") + link("/source/", "Open-source projects"),
    };
  }

  const projectIndex = projects.findIndex((p) => path === "/work/" + p.slug + "/");
  if (projectIndex !== -1) {
    const p = projects[projectIndex];
    const next = projects[(projectIndex + 1) % projects.length];
    const visit = typeof p.url === "string" && /^https:\/\//.test(p.url)
      ? external(p.url, p.urlLabel || "Visit project") : "";
    return {
      view: "work", title: p.title + " — Devon Alan Akins", description: p.description,
      index: "01 / PROJECT FILE / " + String(projectIndex + 1).padStart(2, "0"),
      heading: p.title,
      intro: p.summary,
      brand: detailBrand(p),
      breadcrumb: parent + '<a href="/work/">Work archive</a><span aria-hidden="true"> / </span><span aria-current="page">' + esc(p.title) + '</span>',
      body: '<div class="route-meta"><span>' + esc(p.label) + '</span><span>' + esc(p.status) + '</span><span>' + esc(p.role) + '</span></div>' +
        '<div class="route-blocks">' +
        block("THE WORK", paragraph(p.description) + paragraph(p.detail)) +
        block("WHAT COMES NEXT", paragraph(p.next)) +
        '</div>' +
        '<aside class="route-privacy"><strong>PUBLIC / PRIVATE BOUNDARY</strong>' + paragraph(p.boundary) + '</aside>',
      actions: link("/work/", "All projects") + link("/work/" + next.slug + "/", "Next: " + next.title) + visit,
    };
  }

  if (path === "/gpt/") {
    return {
      view: "home", title: "GPT profile — Devon Alan Akins",
      description: "Dated Work/Codex activity, weekly analytics, personal workflow skills and tools.",
      index: "00 / GPT PROFILE", heading: "GPT profile",
      intro: "A dated public snapshot of AI-assisted development: cumulative and weekly activity, skills, profile insights and tools.",
      breadcrumb: '<a href="/#home">Interface</a><span aria-hidden="true"> / </span><span aria-current="page">GPT profile</span>',
      body: renderPublicGptProfile(gptSnapshot),
      actions: link("/#home", "Return to the interface") +
        external(gptSnapshot.profile.publicProfileUrl, "Original ChatGPT profile"),
    };
  }
  if (path === "/about/") {
    return {
      view: "home", title: "About — Devon Alan Akins",
      description: "Father of two, author and independent developer. Personal priorities, background, interests and work.",
      index: "00 / THE PERSON", heading: "More than a title",
      intro: "I'm Devon. A father of two, author, and independent developer based in Central Florida.",
      breadcrumb: '<a href="/#home">Interface</a><span aria-hidden="true"> / </span><span aria-current="page">About</span>',
      body: '<div class="route-blocks">' +
        block("THE FOUNDATION", paragraph("My family comes first. Around raising two boys, I write fiction, develop open-source software, and help improve the operations of family businesses.") +
          paragraph("I prefer practical systems that give people more time for what matters. Finishing thoughtful work takes priority over endlessly expanding plans.")) +
        block("WHAT I STUDY", paragraph("Physics, mathematics, psychology, cognition, engineering, and how humans learn and solve problems.") +
          paragraph("Those interests inform what I create; they are not claims of published research or expertise I do not hold.")) +
        '</div>' +
        '<div class="route-values"><span>FAMILY FIRST</span><span>ORIGINAL WRITING</span><span>OPEN SOURCE</span><span>VERIFIED ENGINEERING</span></div>',
      actions: link("/#home", "Back to the interface") + link("/#work", "Explore the work") + link("/contact/", "Get in touch"),
    };
  }

  if (path === "/source/") {
    return {
      view: "research", title: "Open source — Devon Alan Akins",
      description: "Read the public code, project documentation and open-source development work of Devon Alan Akins.",
      index: "04 / PUBLIC SOURCE", heading: "Open the hood",
      intro: "Software is more useful when people can inspect, understand, modify and independently operate it.",
      breadcrumb: '<a href="/#research">Interface</a><span aria-hidden="true"> / </span><span aria-current="page">Open source</span>',
      body: '<div class="route-blocks">' +
        block("THE PRINCIPLE", paragraph("I publish source so that implementation can be reviewed, learned from, and improved. Open-source code does not make private data, client records or personal systems public.")) +
        block("PUBLIC REPOSITORIES & RESEARCH", '<div class="route-repos">' +
          external("https://github.com/devonalanakins/devonakins.com", "This website — source") +
          external("https://github.com/devonalanakins/merit", "Merit — engineering integrity toolkit") +
          link("/work/rhen-language/", "Rhen — experimental language") +
          external("https://github.com/devonalanakins/anevum-web", "ANEVUM web") +
          external("https://github.com/devonalanakins", "All public repositories") + '</div>') +
        '</div><p class="route-fine-print">Check each repository for its own license, contribution guidelines and current development status.</p>',
      actions: link("/#research", "Return to research") + link("/work/", "Project archive"),
    };
  }

  if (path === "/contact/") {
    return {
      view: "contact", title: "Contact — Devon Alan Akins",
      description: "Contact Devon Alan Akins about original writing, software engineering or creative work.",
      index: "05 / OPEN CHANNEL", heading: "Let's connect",
      intro: "For writing, software and meaningful collaborations, email remains the simplest way to reach me.",
      breadcrumb: '<a href="/#contact">Interface</a><span aria-hidden="true"> / </span><span aria-current="page">Contact</span>',
      body: '<div class="route-contact-address"><span>DIRECT EMAIL</span><a href="mailto:devon@anevum.com">devon@anevum.com<span aria-hidden="true"> ↗</span></a></div>' +
        '<div class="route-blocks">' +
        block("WORK & CREATIVE INQUIRIES", paragraph("Please include what you're interested in discussing. Client, family, clinical and other private details should not be sent through a public website.")) +
        block("PUBLIC WORK", paragraph("You can review public source and project notes before getting in touch.") + external("https://github.com/devonalanakins", "View my GitHub")) +
        '</div><p class="route-fine-print">This website has no contact form, tracking cookies or public inbox that stores your message.</p>',
      actions: link("/#contact", "Return to contact") + link("/work/", "Project archive"),
    };
  }

  if (path === "/404/") {
    return {
      view: "home", title: "Page not found — Devon Alan Akins",
      description: "This Devon Akins page does not exist or is no longer available.",
      index: "404 / OUT OF RANGE", heading: "Nothing here",
      intro: "This address doesn't lead to a current public page. The rest of the site is still here.",
      breadcrumb: '<a href="/#home">Interface</a><span aria-hidden="true"> / </span><span aria-current="page">404</span>',
      body: '<p class="route-fine-print">The requested page may have moved, or the address may contain an error.</p>',
      actions: link("/#home", "Return home") + link("/work/", "Browse the work"),
    };
  }
  throw new Error("Unrecognized public route: " + path);
}

export function renderImmersiveRoute(canonicalHomepage, path, projects, gptSnapshot) {
  if (path === "/") throw new Error("The canonical homepage must not be replaced");
  const data = contentFor(path, projects, gptSnapshot);
  let html = canonicalHomepage;
  const replaceExactly = (from, to, description) => {
    const count = html.split(from).length - 1;
    if (count !== 1) throw new Error("Immersive route " + path + " template mismatch: " + description + " (" + count + ")");
    html = html.replace(from, to);
  };
  replaceExactly('<title>Devon Alan Akins — Father, Author and Developer</title>',
    '<title>' + esc(data.title) + '</title>', "title");
  replaceExactly('<link rel="canonical" href="https://devonakins.com/">',
    '<link rel="canonical" href="https://devonakins.com' + path + '">', "canonical");
  replaceExactly('<meta name="description" content="Devon Alan Akins is a father, author and independent developer creating original worlds, open-source software and useful systems.">',
    '<meta name="description" content="' + esc(data.description) + '">', "description");
  replaceExactly('<meta property="og:title" content="Devon Alan Akins — Father, Author and Developer">',
    '<meta property="og:title" content="' + esc(data.title) + '">', "og title");
  replaceExactly('<meta property="og:description" content="Original worlds, open-source software and useful systems.">',
    '<meta property="og:description" content="' + esc(data.description) + '">', "og description");
  replaceExactly('<meta property="og:url" content="https://devonakins.com/">',
    '<meta property="og:url" content="https://devonakins.com' + path + '">', "og url");
  replaceExactly('<link rel="stylesheet" href="/v2/terminal.css?v=1.2.3">',
    '<link rel="stylesheet" href="/v2/terminal.css?v=1.2.3">\n  <link rel="stylesheet" href="/v2/routes.css">' +
    (path === "/gpt/" ? '\n  <link rel="stylesheet" href="/v2/gpt-profile.css">' : ""), "style");
  replaceExactly('class="brand" href="#home"', 'class="brand" href="/#home"', "brand link");
  replaceExactly('<span class="topbar-version">/ ORIGINAL WORKS</span>',
    '<span class="topbar-version">/ ' + (data.view === "work" ? "WORK FILES" : data.view === "contact" ? "OPEN CHANNEL" : "PERSONAL RECORD") + '</span>', "header context");
  replaceExactly('data-view="home" data-motion="off" data-light="amber"',
    'data-view="' + data.view + '" data-initial-view="' + data.view + '" data-route-page="true" data-motion="off" data-light="amber"', "initial route view");

  if (data.view !== "home") {
    replaceExactly('data-panel="home">', 'data-panel="home" hidden>', "hide home");
    replaceExactly('data-panel="' + data.view + '" hidden>', 'data-panel="' + data.view + '">', "show route");
    const homeTab = /(<button class="rail-tab" id="tab-home"[^>]*>)/;
    const otherTab = new RegExp('(<button class="rail-tab" id="tab-' + data.view + '"[^>]*>)');
    if (!homeTab.test(html) || !otherTab.test(html)) throw new Error("Missing route navigation buttons");
    html = html.replace(homeTab, (tag) => tag.replace('aria-selected="true" tabindex="0"', 'aria-selected="false" tabindex="-1"'));
    html = html.replace(otherTab, (tag) => tag.replace('aria-selected="false" tabindex="-1"', 'aria-selected="true" tabindex="0"'));
  }

  const section = new RegExp('(<section class="panel[^"]*" id="panel-' + data.view + '"[^>]*>)[\\s\\S]*?(</section>)', "g");
  const hits = [...html.matchAll(section)];
  if (hits.length !== 1) throw new Error("Missing or ambiguous target panel on route " + path);
  const content = layout({
    breadcrumb: data.breadcrumb, index: data.index,
    title: data.heading, intro: data.intro,
    body: data.body, actions: data.actions, brand: data.brand,
  });
  html = html.replace(section, (_, open, close) => open + '\n' + content + '\n' + close);
  if (path === "/404/") {
    // The Worker already sends the correct 404 status. Don't index missing pages.
    html = html.replace('<link rel="canonical" href="https://devonakins.com/404/">',
      '<meta name="robots" content="noindex">');
  }
  return html;
}
