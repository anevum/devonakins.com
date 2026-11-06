import {
  PRESENCE_PROJECTOR_POLICY,
  PUBLIC_PRESENCE_PROJECTS,
} from "./presence-model.mjs";
export function approvedProjects(row) {
  if (row?.public_projects_json == null)
    return PRESENCE_PROJECTOR_POLICY.publicProjects;
  try {
    const value = JSON.parse(row.public_projects_json);
    return Array.isArray(value) &&
      value.length <= PRESENCE_PROJECTOR_POLICY.publicProjects.length &&
      new Set(value).size === value.length &&
      value.every((slug) => Object.hasOwn(PUBLIC_PRESENCE_PROJECTS, slug))
      ? value
      : [];
  } catch {
    return [];
  }
}
