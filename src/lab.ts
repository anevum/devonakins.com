import { waveAt, orbitAt, makeQuestion } from "./lab-model.mjs";
import { icon } from "./icons.mjs";
type Options = {
  motionAllowed: () => boolean;
  toast: (s: string) => void;
  copy: (s: string) => Promise<void>;
};
export function initLab(options: Options) {
  let experiment = "waves",
    wavePaused = false,
    orbitPaused = false,
    phaseTime = 0,
    last = 0,
    raf = 0;
  const wave = document.querySelector<HTMLCanvasElement>("#wave-canvas")!,
    orbit = document.querySelector<HTMLCanvasElement>("#orbit-canvas")!;
  const frequency = document.querySelector<HTMLInputElement>("#frequency")!,
    phase = document.querySelector<HTMLInputElement>("#phase")!,
    eccentricity = document.querySelector<HTMLInputElement>("#eccentricity")!;
  const tabs = [
    ...document.querySelectorAll<HTMLButtonElement>("[data-experiment]"),
  ];
  const choose = (name: string) => {
    experiment = name;
    tabs.forEach((t) => {
      const selected = t.dataset.experiment === name;
      t.setAttribute("aria-selected", String(selected));
      t.tabIndex = selected ? 0 : -1;
    });
    document
      .querySelectorAll<HTMLElement>("[role=tabpanel]")
      .forEach((panel) => (panel.hidden = panel.id !== "experiment-" + name));
    last = 0;
    draw();
    schedule();
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => choose(tab.dataset.experiment!));
    tab.addEventListener("keydown", (e) => {
      if (["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) {
        e.preventDefault();
        const j =
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? tabs.length - 1
              : (i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) %
                tabs.length;
        choose(tabs[j].dataset.experiment!);
        tabs[j].focus();
      }
    });
  });
  function canvasContext(canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (!rect.width || !rect.height) return null;
    const w = Math.round(rect.width * dpr),
      h = Math.round(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    return { ctx, w: rect.width, h: rect.height };
  }
  function grid(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.strokeStyle = "rgba(128,175,194,.10)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 36) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = 0; y <= h; y += 36) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
    ctx.strokeStyle = "rgba(153,205,211,.25)";
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
  }
  function draw() {
    if (experiment === "waves") {
      const result = canvasContext(wave);
      if (!result) return;
      const { ctx, w, h } = result;
      grid(ctx, w, h);
      const f = Number(frequency.value),
        p = Number(phase.value);
      const amplitude = h * 0.19;
      for (const [field, color, width] of [
        ["base", "#839cab", 1],
        ["harmonic", "#ad98d6", 1],
        ["sum", "#8af3df", 2.2],
      ] as const) {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.shadowColor = field === "sum" ? "#8af3df" : "transparent";
        ctx.shadowBlur = field === "sum" ? 12 : 0;
        for (let x = 0; x <= w; x += 2) {
          const model = waveAt((x / w) * Math.PI * 4, phaseTime, f, p);
          const y = h / 2 - model[field] * amplitude;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#89a1b1";
      ctx.font = "9px monospace";
      ctx.fillText("DISPLACEMENT", 10, 19);
      ctx.fillText("POSITION →", Math.max(10, w - 85), h - 10);
    } else if (experiment === "orbits") {
      const result = canvasContext(orbit);
      if (!result) return;
      const { ctx, w, h } = result;
      grid(ctx, w, h);
      const e = Number(eccentricity.value),
        scale = Math.min(w * 0.27, h * 0.33),
        cx = w / 2 + e * scale * 0.5,
        cy = h / 2;
      ctx.strokeStyle = "#8af3df";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let t = 0; t <= Math.PI * 2 + 0.03; t += 0.025) {
        const p = orbitAt(t, e);
        ctx.lineTo(cx + p.x * scale, cy + p.y * scale);
      }
      ctx.stroke();
      ctx.beginPath();
      ctx.fillStyle = "#c5a0e9";
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#8b9fb0";
      ctx.font = "9px monospace";
      ctx.fillText("FOCUS", cx + 10, cy + 3);
      const p = orbitAt(phaseTime * 0.6, e);
      const px = cx + p.x * scale,
        py = cy + p.y * scale;
      ctx.beginPath();
      ctx.strokeStyle = "#8af3df22";
      ctx.moveTo(cx, cy);
      ctx.lineTo(px, py);
      ctx.stroke();
      ctx.shadowColor = "#baffeb";
      ctx.shadowBlur = 18;
      ctx.fillStyle = "#d7fff3";
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
  function active() {
    return (
      !document.hidden &&
      options.motionAllowed() &&
      experiment !== "questions" &&
      !(experiment === "waves" ? wavePaused : orbitPaused)
    );
  }
  function frame(now: number) {
    raf = 0;
    if (!active()) return;
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
    phaseTime += dt * 0.9;
    last = now;
    draw();
    raf = requestAnimationFrame(frame);
  }
  function schedule() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
    if (active()) raf = requestAnimationFrame(frame);
    else draw();
  }
  function controls() {
    document.querySelector("#frequency-output")!.textContent = Number(
      frequency.value,
    ).toFixed(1);
    document.querySelector("#phase-output")!.textContent =
      Number(phase.value).toFixed(1) + " rad";
    document.querySelector("#wave-readout")!.textContent =
      `f = ${Number(frequency.value).toFixed(1)} · φ = ${Number(phase.value).toFixed(1)}`;
    document.querySelector("#eccentricity-output")!.textContent = Number(
      eccentricity.value,
    ).toFixed(2);
    document.querySelector("#orbit-readout")!.textContent =
      "e = " + Number(eccentricity.value).toFixed(2);
    draw();
  }
  [frequency, phase, eccentricity].forEach((input) =>
    input.addEventListener("input", controls),
  );
  for (const kind of ["wave", "orbit"]) {
    const b = document.querySelector<HTMLButtonElement>("#" + kind + "-pause")!;
    b.addEventListener("click", () => {
      if (kind === "wave") wavePaused = !wavePaused;
      else orbitPaused = !orbitPaused;
      const paused = kind === "wave" ? wavePaused : orbitPaused;
      b.setAttribute("aria-pressed", String(paused));
      b.innerHTML =
        icon(paused ? "play" : "pause") + (paused ? "Play" : "Pause");
      schedule();
    });
    document
      .querySelector("#" + kind + "-reset")!
      .addEventListener("click", () => {
        if (kind === "wave") {
          frequency.value = "2";
          phase.value = "0";
        } else eccentricity.value = ".35";
        phaseTime = 0;
        controls();
      });
  }
  const question = () => {
    document.querySelector("#question-result")!.textContent = makeQuestion(
      document.querySelector<HTMLSelectElement>("#question-subject")!.value,
      document.querySelector<HTMLSelectElement>("#question-constraint")!.value,
    );
  };
  document
    .querySelector("#question-subject")!
    .addEventListener("change", question);
  document
    .querySelector("#question-constraint")!
    .addEventListener("change", question);
  document
    .querySelector("#copy-question")!
    .addEventListener("click", () =>
      options.copy(document.querySelector("#question-result")!.textContent!),
    );
  document.addEventListener("visibilitychange", schedule);
  document.addEventListener("da:motion", schedule);
  new ResizeObserver(draw).observe(wave.parentElement!);
  new ResizeObserver(draw).observe(orbit.parentElement!);
  controls();
  schedule();
}
