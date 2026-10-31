// One continuous figure: orbital circles open into six wings and a golden spiral.
// Geometry follows the reading position, with no perpetual animation loop.
const svg = document.querySelector('#celestial-geometry');
const wings = document.querySelector('#wings');
const thread = document.querySelector('#golden-thread');
const chapters = [...document.querySelectorAll('header, main section')];
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const phi = (1 + Math.sqrt(5)) / 2;
const ns = 'http://www.w3.org/2000/svg';
const paths = Array.from({ length: 6 }, () => {
  const path = document.createElementNS(ns, 'path');
  wings.append(path);
  return path;
});
// [wing spread, orbit radius, rotation, spiral turns]
const forms = [
  [0.16, 150, 0, 1.5],
  [0.42, 165, 0.18, 1.8],
  [0.88, 185, 0.38, 2.1],
  [0.62, 150, 0.58, 2.4],
  [1, 185, 0.78, 2.7],
  [0.52, 165, 1, 2.3],
  [0.3, 140, 1.2, 1.9],
  [0.12, 150, 1.4, 1.5],
];
let anchors = [];
let scheduled = false;
const mix = (a, b, t) => a + (b - a) * t;
function measure() {
  anchors = chapters.map(el => el.getBoundingClientRect().top + window.scrollY + el.offsetHeight * .4);
}
function draw() {
  scheduled = false;
  const position = window.scrollY + innerHeight * .5;
  let index = 0;
  while (index < anchors.length - 2 && position > anchors[index + 1]) index++;
  let t = Math.max(0, Math.min(1, (position - anchors[index]) / (anchors[index + 1] - anchors[index])));
  t = t * t * (3 - 2 * t);
  const current = motion.matches ? forms[2] : forms[index].map((v, i) => mix(v, forms[index + 1][i], t));
  const [spread, radius, rotation, turns] = current;
  paths.forEach((path, wing) => {
    const angle = wing * Math.PI / 3 + rotation;
    const points = [];
    for (let i = 0; i <= 96; i++) {
      const a = i / 96 * Math.PI * 2;
      // Closed ellipses share a center, opening into a seraph's six wings.
      const x = Math.cos(a) * radius + spread * radius * .7;
      const y = Math.sin(a) * radius * (1 - spread * .62);
      points.push(`${i ? 'L' : 'M'}${(x * Math.cos(angle) - y * Math.sin(angle)).toFixed(2)},${(x * Math.sin(angle) + y * Math.cos(angle)).toFixed(2)}`);
    }
    path.setAttribute('d', points.join(' ') + 'Z');
  });
  const spiral = [];
  for (let i = 0; i <= 220; i++) {
    const angle = i / 220 * turns * Math.PI * 2;
    // Radius grows by phi every quarter turn.
    const r = 345 * phi ** ((angle - turns * Math.PI * 2) / (Math.PI / 2));
    spiral.push(`${i ? 'L' : 'M'}${(r * Math.cos(angle + rotation)).toFixed(2)},${(r * Math.sin(angle + rotation)).toFixed(2)}`);
  }
  thread.setAttribute('d', spiral.join(' '));
  svg.style.rotate = `${motion.matches ? 0 : (index + t) * 3}deg`;
}
function requestDraw() {
  if (!scheduled) { scheduled = true; requestAnimationFrame(draw); }
}
function refresh() { measure(); requestDraw(); }
window.addEventListener('scroll', () => { if (!motion.matches) requestDraw(); }, { passive: true });
window.addEventListener('resize', refresh);
motion.addEventListener('change', requestDraw);
new ResizeObserver(refresh).observe(document.body);
document.fonts.ready.then(refresh);
refresh();
