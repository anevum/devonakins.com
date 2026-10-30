import { icon } from "./icons.mjs";
import { projects, pages } from "./content.mjs";
import { initLab } from "./lab";

type SceneHandle = {
  setMotion: (value: boolean) => void;
  setQuality: (q: string) => void;
  turn: () => void;
  dispose: () => void;
};
const root = document.documentElement;
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const saved = (key: string, fallback: string) => {
  try {
    return localStorage.getItem("da-" + key) || fallback;
  } catch {
    return fallback;
  }
};
const save = (key: string, value: string) => {
  try {
    localStorage.setItem("da-" + key, value);
  } catch {
    /* Preferences are optional when browser storage is unavailable. */
  }
};
let motionWanted = saved("motion", "on") !== "off";
let quality = saved("quality", "auto");
let scene: SceneHandle | undefined;
let toastTimer: number;
const motionAllowed = () => motionWanted && !reduced.matches;
export function toast(message: string) {
  const el = document.querySelector("#toast")!;
  el.textContent = message;
  el.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("visible"), 2800);
}
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied.");
  } catch {
    toast("Clipboard unavailable. Select and copy the text.");
  }
}
function applyMotion() {
  const enabled = motionAllowed();
  root.dataset.motion = enabled ? "on" : "off";
  const checkbox = document.querySelector<HTMLInputElement>("#motion-setting")!;
  checkbox.checked = enabled;
  checkbox.disabled = reduced.matches;
  document.querySelector("#motion-description")!.textContent = reduced.matches
    ? "Your system asks for reduced motion."
    : "Slow, continuous environmental animation.";
  scene?.setMotion(enabled);
  document.dispatchEvent(new CustomEvent("da:motion", { detail: enabled }));
}
function setTheme(name: string) {
  root.dataset.theme = name;
  document
    .querySelectorAll<HTMLButtonElement>("button[data-theme]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.theme === name)),
    );
  save("theme", name);
  document.dispatchEvent(new CustomEvent("da:theme", { detail: name }));
}
const storedTheme = saved("theme", "tide");
setTheme(
  ["tide", "iris", "ember"].includes(storedTheme) ? storedTheme : "tide",
);
applyMotion();
reduced.addEventListener("change", applyMotion);
const qualitySelect =
  document.querySelector<HTMLSelectElement>("#quality-setting")!;
qualitySelect.value = ["auto", "high", "low"].includes(quality)
  ? quality
  : "auto";
quality = qualitySelect.value;
qualitySelect.addEventListener("change", () => {
  quality = qualitySelect.value;
  save("quality", quality);
  scene?.setQuality(quality);
});
document
  .querySelector<HTMLInputElement>("#motion-setting")!
  .addEventListener("change", (e) => {
    motionWanted = (e.target as HTMLInputElement).checked;
    save("motion", motionWanted ? "on" : "off");
    applyMotion();
  });
document
  .querySelectorAll<HTMLButtonElement>("button[data-theme]")
  .forEach((b) =>
    b.addEventListener("click", () => setTheme(b.dataset.theme!)),
  );
const searchDialog =
  document.querySelector<HTMLDialogElement>("#search-dialog")!;
const settingsDialog =
  document.querySelector<HTMLDialogElement>("#settings-dialog")!;
const searchInput = document.querySelector<HTMLInputElement>("#search-input")!;
let lastFocus: HTMLElement | null = null;
function openDialog(dialog: HTMLDialogElement) {
  lastFocus = document.activeElement as HTMLElement;
  dialog.showModal();
  if (dialog === searchDialog) {
    searchInput.value = "";
    renderSearch("");
    searchInput.focus();
  }
}
for (const dialog of [searchDialog, settingsDialog]) {
  dialog.addEventListener("close", () => lastFocus?.focus());
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) {
      const box = dialog.getBoundingClientRect();
      if (
        e.clientX < box.left ||
        e.clientX > box.right ||
        e.clientY < box.top ||
        e.clientY > box.bottom
      )
        dialog.close();
    }
  });
  dialog
    .querySelector("[data-close-dialog]")!
    .addEventListener("click", () => dialog.close());
}
document
  .querySelectorAll("[data-open-search]")
  .forEach((b) => b.addEventListener("click", () => openDialog(searchDialog)));
document
  .querySelectorAll("[data-open-settings]")
  .forEach((b) =>
    b.addEventListener("click", () => openDialog(settingsDialog)),
  );
const searchItems = [
  ...pages.map((p) => ({
    title:
      p.key === "home"
        ? "Home"
        : p.key === "source"
          ? "Open source"
          : p.key === "lab"
            ? "The Lab"
            : p.key[0].toUpperCase() + p.key.slice(1),
    href: p.path,
    kind: "Page",
    icon: p.key === "contact" ? "mail" : p.key,
  })),
  ...projects.map((p) => ({
    title: p.title,
    href: `/work/${p.slug}/`,
    kind: "Project",
    icon: p.icon,
  })),
];
function renderSearch(query: string) {
  const results = searchItems.filter((item) =>
    (item.title + " " + item.kind)
      .toLowerCase()
      .includes(query.toLowerCase().trim()),
  );
  document.querySelector("#search-results")!.innerHTML =
    results
      .map(
        (item) =>
          `<a class="search-result" href="${item.href}">${icon(item.icon)}<span>${item.title}</span><small>${item.kind}</small></a>`,
      )
      .join("") ||
    '<p class="search-empty">No matches. Try “Lab”, “Work”, or a project name.</p>';
}
searchInput.addEventListener("input", () => renderSearch(searchInput.value));
searchDialog.addEventListener("keydown", (e) => {
  const links = [
    ...searchDialog.querySelectorAll<HTMLAnchorElement>(".search-result"),
  ];
  const index = links.indexOf(document.activeElement as HTMLAnchorElement);
  if (e.key === "ArrowDown") {
    e.preventDefault();
    links[(index + 1) % links.length]?.focus();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (index <= 0) searchInput.focus();
    else links[index - 1]?.focus();
  } else if (e.key === "Enter" && document.activeElement === searchInput) {
    e.preventDefault();
    links[0]?.click();
  }
});
document.addEventListener("keydown", (e) => {
  const editing = (e.target as HTMLElement).matches(
    "input,textarea,select,[contenteditable=true]",
  );
  if (
    (e.key === "k" && (e.metaKey || e.ctrlKey)) ||
    (e.key === "/" && !editing)
  ) {
    e.preventDefault();
    if (!searchDialog.open && !settingsDialog.open) openDialog(searchDialog);
  }
});
for (const filter of document.querySelectorAll<HTMLButtonElement>(
  "[data-filter]",
))
  filter.addEventListener("click", () => {
    const category = filter.dataset.filter;
    document
      .querySelectorAll("[data-filter]")
      .forEach((b) => b.setAttribute("aria-pressed", String(b === filter)));
    let count = 0;
    document
      .querySelectorAll<HTMLElement>(".work-grid .project-card")
      .forEach((card) => {
        card.hidden = category !== "all" && card.dataset.category !== category;
        if (!card.hidden) count++;
      });
    document.querySelector("#filter-count")!.textContent =
      `${count} ${count === 1 ? "project" : "projects"}`;
  });
document
  .querySelector("#copy-email")
  ?.addEventListener("click", () => copy("devon@anevum.com"));
// Desktop perspective responds to pointer position; touch scrolling is never captured.
if (matchMedia("(hover: hover) and (pointer: fine)").matches) {
  document.querySelectorAll<HTMLElement>(".tilt-card").forEach((card) => {
    card.addEventListener("pointermove", (e) => {
      if (!motionAllowed()) return;
      const r = card.getBoundingClientRect(),
        x = (e.clientX - r.left) / r.width - 0.5,
        y = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform = `perspective(900px) rotateX(${-y * 3}deg) rotateY(${x * 4}deg) translateY(-4px)`;
    });
    card.addEventListener("pointerleave", () => {
      card.style.transform = "";
    });
  });
}
if (document.querySelector("#wave-canvas"))
  initLab({ motionAllowed, toast, copy });
const container = document.querySelector<HTMLElement>("#scene");
if (container) {
  const fallback = () => {
    container.dataset.status = "fallback";
    document.querySelector("#scene-caption")!.textContent = "VECTOR FALLBACK";
    const turn = document.querySelector<HTMLButtonElement>(
      "[data-action=orbit]",
    );
    if (turn) {
      turn.disabled = true;
      turn.innerHTML = icon("orbit") + "<span>DA / vector study</span>";
    }
  };
  if (new URLSearchParams(location.search).get("render") === "fallback")
    fallback();
  else {
    // Load the rendering engine after useful HTML and fonts have painted.
    const start = () => {
      const canvas = document.createElement("canvas");
      let context: WebGL2RenderingContext | null = null;
      try {
        context = canvas.getContext("webgl2", {
          antialias: quality !== "low",
          powerPreference: "default",
        });
      } catch {}
      if (!context) {
        fallback();
        return;
      }
      const validContext = context;
      import("./scene")
        .then(({ createScene }) => {
          scene = createScene(container, {
            canvas,
            context: validContext,
            motion: motionAllowed(),
            quality,
            onFailure: fallback,
          });
          document
            .querySelector("[data-action=orbit]")
            ?.addEventListener("click", () => scene?.turn());
        })
        .catch(fallback);
    };
    if ("requestIdleCallback" in window)
      window.requestIdleCallback(start, { timeout: 1200 });
    else setTimeout(start, 80);
  }
}
window.addEventListener("pagehide", (event) => {
  if (!event.persisted) scene?.dispose();
});
