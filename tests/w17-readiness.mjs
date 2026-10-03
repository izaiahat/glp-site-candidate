// Readiness only. This does not qualify paint or manufacture a contrast ratio.
async function observeW17Readiness(target, { timeout = 5000 } = {}) {
  await target.page().evaluate(() => document.fonts.ready);
  return target.evaluate(async (element, timeout) => {
    const deadline = performance.now() + timeout;
    let previous = '', stable = 0, samples = 0, last;
    do {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const ancestors = [];
      for (let node = element; node; node = node.parentElement) ancestors.push(node);
      const gsap = window.CS_MOTION?.gsap || window.gsap;
      const pendingTweens = gsap ? gsap.getTweensOf(ancestors).filter(tween => !tween.paused() && tween.totalProgress() < 1).length : 0;
      // Document.getAnimations includes pseudo-element transitions that
      // Element.getAnimations() omits without subtree:true. The paint guard
      // observes the whole document, so finite transitions must finish first.
      const finiteAnimations = document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity && ['running', 'pending'].includes(animation.playState)).length;
      const geometry = ancestors.map(node => {
        const s = getComputedStyle(node), b = node.getBoundingClientRect();
        return { tag: node.tagName, opacity: s.opacity, transform: s.transform, translate: s.translate, visibility: s.visibility, display: s.display, rect: [b.x,b.y,b.width,b.height] };
      });
      const pendingReveal = geometry.some(row => Number(row.opacity) !== 1 || row.visibility !== 'visible' || row.display === 'none');
      const fingerprint = JSON.stringify(geometry);
      const lenis = window.CS_MOTION?.lenis || window.__gcsLenis;
      const pendingScroll = Boolean(lenis?.isScrolling);
      stable = !pendingScroll && !pendingTweens && !finiteAnimations && !pendingReveal && fingerprint === previous ? stable + 1 : 0;
      previous = fingerprint; samples++;
      last = { pendingScroll, pendingTweens, finiteAnimations, pendingReveal, geometry, samples, stable };
      if (stable >= 6) return { ready: true, ...last };
    } while (performance.now() < deadline);
    return { ready: false, reason: 'natural entrance/geometry readiness unresolved', ...last };
  }, timeout);
}

// Bound the returned observation, including font loading and stalled frames.
// Timing out does not cancel page work or change the page's fonts/animations.
export async function waitW17Readiness(target, { timeout = 5000 } = {}) {
  let timer;
  const deadline = new Promise(resolve => {
    timer = setTimeout(() => resolve({ ready: false, reason: 'font/entrance/geometry readiness deadline elapsed' }), timeout);
  });
  try {
    return await Promise.race([deadline, observeW17Readiness(target, { timeout })]);
  } finally {
    clearTimeout(timer);
  }
}
