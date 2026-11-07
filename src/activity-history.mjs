import { PUBLIC_PRESENCE_PROJECTS } from "./presence-model.mjs";
export const PUBLIC_REPOSITORIES = Object.freeze({
  "devonakins.com": "devonakins-com",
  merit: "merit",
  rhen: "rhen",
  mizvo: "mizvo",
  "devon-station": "devonstation",
  squelch: "squelch",
  "anevum-web": "anevum",
  brandicade: "brandicade",
  vesper: "vesper",
  knowledge: "knowledge",
});
export function projectActivityHistory(events, at = Date.now()) {
  if (!Array.isArray(events)) return [];
  const kind = {
    PushEvent: "Commit",
    PullRequestEvent: "Pull request",
    ReleaseEvent: "Release",
  };
  return events
    .filter(
      (e) =>
        e?.public === true &&
        Object.hasOwn(kind, e.type) &&
        typeof e.repo?.name === "string" &&
        e.repo.name.startsWith("devonalanakins/"),
    )
    .flatMap((e) => {
      const repo = e.repo.name.slice(15);
      const slug = PUBLIC_REPOSITORIES[repo],
        time = Date.parse(e.created_at);
      return slug &&
        Number.isFinite(time) &&
        time <= at + 10000 &&
        time > at - 30 * 86400000
        ? [
            {
              project: PUBLIC_PRESENCE_PROJECTS[slug],
              projectSlug: slug,
              kind: kind[e.type],
              at: new Date(time).toISOString(),
              url: "https://github.com/devonalanakins/" + repo,
            },
          ]
        : [];
    })
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8);
}
export function validActivityHistory(value, at = Date.now()) {
  if (!Array.isArray(value) || value.length > 8) return [];
  return value.filter(
    (e) =>
      e &&
      Object.keys(e).sort().join("|") === "at|kind|project|projectSlug|url" &&
      PUBLIC_PRESENCE_PROJECTS[e.projectSlug] === e.project &&
      ["Commit", "Pull request", "Release"].includes(e.kind) &&
      Object.entries(PUBLIC_REPOSITORIES).some(
        ([r, s]) =>
          s === e.projectSlug &&
          e.url === "https://github.com/devonalanakins/" + r,
      ) &&
      typeof e.at === "string" &&
      Number.isFinite(Date.parse(e.at)) &&
      new Date(e.at).toISOString() === e.at &&
      Date.parse(e.at) <= at + 10000 &&
      Date.parse(e.at) > at - 30 * 86400000,
  );
}
