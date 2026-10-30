export const icons = {
  work: '<path d="M5 8V4h15v15h-4M3 9h12v12H3zM7 13h4m-4 4h2"/>',
  lab: '<path d="m12 7 5 5-5 5-5-5zM4 8a9 9 0 0 1 5-5m7 1a9 9 0 0 1 5 7m-2 6a9 9 0 0 1-7 4M7 20a9 9 0 0 1-4-7"/><circle cx="3" cy="11" r="1"/><circle cx="12" cy="3" r="1"/>',
  notes: '<path d="M5 3h10l4 4v14H5zM14 3v5h5M8 12h8m-8 4h8m-8 3h4"/>',
  source: '<path d="m8 8-5 4 5 4m8-8 5 4-5 4m-3-11-2 14"/>',
  about:
    '<circle cx="12" cy="7" r="3.5"/><path d="M5 21v-3a7 7 0 0 1 14 0v3z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  external: '<path d="M5 19 19 5M6 5h13v13"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  tune: '<path d="M5 3v18M12 3v18M19 3v18M2 8h6m1 8h6m1-9h6"/>',
  play: '<path d="m9 5 11 7-11 7z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  reset: '<path d="M4 9a8 8 0 1 1 0 7M4 3v6h6"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  station:
    '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4M7 8h10m-10 4h6"/>',
  flow: '<path d="M3 8c5-7 13 7 18 0M3 13c5-7 13 7 18 0M3 18c5-7 13 7 18 0"/>',
  anevum: '<path d="m3 20 9-17 9 17h-5l-4-8-4 8z"/>',
  orbit:
    '<circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="10" ry="5" transform="rotate(-30 12 12)"/><ellipse cx="12" cy="12" rx="5" ry="10" transform="rotate(-30 12 12)"/>',
  home: '<path d="m3 11 9-8 9 8M6 9v12h12V9M10 21v-7h4v7"/>',
  check: '<path d="m5 12 4 4L20 5"/>',
};
export function icon(name, cls = "") {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${icons[name] || icons.orbit}</svg>`;
}
