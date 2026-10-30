export function waveAt(x, time, frequency, phase) {
  const base = Math.sin(x * frequency - time);
  const harmonic = 0.55 * Math.sin(x * frequency * 2 - time + phase);
  return { base, harmonic, sum: base + harmonic };
}
export function orbitAt(t, e) {
  const a = 1,
    b = Math.sqrt(1 - e * e);
  return { x: a * Math.cos(t) - e, y: b * Math.sin(t) };
}
export function makeQuestion(subject, constraint) {
  const subjects = {
    learning: "learning a difficult idea",
    software: "using an everyday tool",
    stories: "exploring a fictional world",
  };
  const constraints = {
    simpler: "make it simpler without losing what matters",
    visible: "make the hidden assumptions visible",
    smaller: "test the smallest useful version",
  };
  return `What would change about ${subjects[subject] || subjects.learning} if you tried to ${constraints[constraint] || constraints.smaller}?`;
}
