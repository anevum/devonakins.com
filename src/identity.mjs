// The same outlines power the flat vector and extruded Three.js identity.
export const dPath =
  "M 12 12 L 39 12 C 65 12 79 27 79 50 C 79 73 65 88 39 88 L 12 88 Z M 25 25 L 25 75 L 38 75 C 56 75 65 66 65 50 C 65 34 56 25 38 25 Z";
export const aPath =
  "M 56 88 L 82 12 L 94 12 L 120 88 L 106 88 L 100 70 L 75 70 L 69 88 Z M 79 57 L 96 57 L 87.5 31 Z";
export function markSVG({ mono = false, background = false } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 132 100" fill="none"><defs><linearGradient id="metal" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#d9fff8"/><stop offset=".25" stop-color="#6ce8dc"/><stop offset=".49" stop-color="#ebf7fa"/><stop offset=".7" stop-color="#b39ce6"/><stop offset="1" stop-color="#ffc7a4"/></linearGradient></defs>${background ? '<rect width="132" height="100" rx="18" fill="#090f17"/>' : ""}<path d="${dPath}" fill="${mono ? "#f0f7f4" : "url(#metal)"}" fill-rule="evenodd"/><path d="${aPath}" fill="${mono ? "#f0f7f4" : "url(#metal)"}" fill-rule="evenodd"/></svg>`;
}
export function dimensionalMarkSVG() {
  const back = Array.from(
    { length: 12 },
    (_, i) =>
      `<g transform="translate(${(12 - i) * 0.16} ${(12 - i) * 0.2})" fill="${i % 3 === 0 ? "#45606b" : "#112631"}" stroke="#526a74" stroke-width=".12"><path d="${dPath}" fill-rule="evenodd"/><path d="${aPath}" fill-rule="evenodd"/></g>`,
  ).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="4 5 126 91"><defs><linearGradient id="hero-metal" x2=".9" y2=".8"><stop stop-color="#061821"/><stop offset=".12" stop-color="#8adad9"/><stop offset=".26" stop-color="#2c4a58"/><stop offset=".48" stop-color="#142934"/><stop offset=".57" stop-color="#b2e8e9"/><stop offset=".7" stop-color="#625879"/><stop offset=".84" stop-color="#deb79c"/><stop offset="1" stop-color="#1a2a3e"/></linearGradient><linearGradient id="hero-rim" x2="1" y2="1"><stop stop-color="#aaffec"/><stop offset=".4" stop-color="#7ac4d7"/><stop offset=".68" stop-color="#ccbef1"/><stop offset="1" stop-color="#efba8d"/></linearGradient></defs>${back}<g fill="url(#hero-metal)" stroke="url(#hero-rim)" stroke-width=".55"><path d="${dPath}" fill-rule="evenodd"/><path d="${aPath}" fill-rule="evenodd"/></g><g fill="none" stroke="#c7fff4" stroke-opacity=".45" stroke-width=".12" transform="translate(.8 .8)"><path d="${dPath}"/><path d="${aPath}"/></g></svg>`;
}
export function fallbackEnvironment() {
  const towers = Array.from({ length: 22 }, (_, i) => {
    const x = i < 11 ? 20 + i * 43 : 1010 + (i - 11) * 40,
      h = 95 + ((i * 79) % 290);
    return `<g><path d="M${x} 680V${680 - h}h${12 + (i % 6)}v${h}" fill="#132330" stroke="#396174" stroke-opacity=".35"/><path d="M${x + 4} ${700 - h}v${h * 0.56}" stroke="${i % 4 === 0 ? "#dba573" : "#63b9bd"}" stroke-opacity=".45"/></g>`;
  }).join("");
  return `<div class="fallback-world" aria-hidden="true"><svg viewBox="0 0 1500 900" preserveAspectRatio="xMidYMid slice"><defs><radialGradient id="fw-haze"><stop stop-color="#58707c" stop-opacity=".24"/><stop offset="1" stop-color="#0c1723" stop-opacity="0"/></radialGradient><linearGradient id="fw-moon" x2="1" y2="1"><stop stop-color="#182737"/><stop offset=".65" stop-color="#273e53"/><stop offset="1" stop-color="#7eb3c8"/></linearGradient><linearGradient id="fw-ground" x2="0" y2="1"><stop stop-color="#101c29"/><stop offset="1" stop-color="#070d14"/></linearGradient></defs><circle cx="1120" cy="125" r="215" fill="url(#fw-moon)" stroke="#9ed5e1" stroke-opacity=".35"/><circle cx="1057" cy="100" r="210" fill="#162536"/><ellipse cx="1050" cy="420" rx="650" ry="370" fill="url(#fw-haze)"/><path d="M0 660 110 490 170 575 240 350 320 540 420 440 520 640 640 560 770 665 890 530 990 600 1070 480 1150 620 1250 350 1350 550 1450 450 1500 570V900H0Z" fill="#142738"/><path d="M0 700 120 570 200 650 290 490 330 620 450 580 600 750 740 650 900 760 1000 630 1130 710 1270 540 1340 620 1500 510V900H0Z" fill="#0c1c29"/>${towers}<rect y="690" width="1500" height="210" fill="url(#fw-ground)"/><ellipse cx="1020" cy="707" rx="335" ry="63" fill="#0e1f2a" stroke="#466673"/><ellipse cx="1020" cy="695" rx="315" ry="48" fill="#142632" stroke="#75d8d4" stroke-opacity=".65"/><ellipse cx="1020" cy="695" rx="292" ry="37" fill="#0d1b26" stroke="#9589b6" stroke-opacity=".5"/><path d="M725 724h35m26 0h15m450 0h25m20 0h23" stroke="#80e6d5" stroke-width="3"/><path d="M940 762h140m-105 15h87m-59 15h41" stroke="#8af3df" stroke-opacity=".14" stroke-width="2"/></svg><div class="fallback-cloud"></div><div class="fallback-dust"></div></div><div class="scene-fallback"><div class="fallback-mark">${dimensionalMarkSVG()}</div><div></div></div>`;
}
