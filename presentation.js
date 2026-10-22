// Keep the native picker keyboard accessible without changing the converter pipeline.
document.getElementById('choose-file')?.addEventListener('click', () => {
  document.getElementById('file').click();
});

const scene = document.getElementById('conversion-example');
const example = document.getElementById('show-example');
let replayTimer;
example?.addEventListener('click', () => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  scene.scrollIntoView({ block: 'center', behavior: reduce ? 'instant' : 'smooth' });
  clearTimeout(replayTimer);
  scene.classList.remove('playing');
  // Restart the finite, optional demonstration on an explicit user action.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    scene.classList.add('playing');
    replayTimer = setTimeout(() => scene.classList.remove('playing'), 2400);
  }));
});
