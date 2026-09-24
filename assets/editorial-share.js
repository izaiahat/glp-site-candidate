(() => {
  const controls = document.querySelector('[data-article-share]');
  if (!controls) return;
  const url = controls.dataset.shareUrl || location.href;
  const title = controls.dataset.shareTitle || document.title;
  const nativeButton = controls.querySelector('[data-share-native]');
  const copyButton = controls.querySelector('[data-share-copy]');
  const status = controls.querySelector('[data-share-status]');
  const announce = (message) => { if (status) status.textContent = message; };
  if (navigator.share) {
    nativeButton.hidden = false;
    nativeButton.addEventListener('click', async () => {
      try {
        await navigator.share({ title, url });
        announce('Share sheet opened.');
      } catch (error) {
        if (error?.name !== 'AbortError') announce('The share sheet was unavailable. Copy the link instead.');
      }
    });
  }
  copyButton?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      announce('Link copied.');
    } catch {
      const input = document.createElement('textarea');
      input.value = url;
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.append(input);
      input.select();
      const copied = document.execCommand('copy');
      input.remove();
      announce(copied ? 'Link copied.' : 'Copy failed. Use the address bar.');
    }
  });
})();
