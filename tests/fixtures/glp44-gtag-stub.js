/* Offline gtag transport fixture. NOT Google's SDK; proves our browser command/wire contract only. */
(() => {
  const id = 'G-2WQ42JY0WK';
  const layer = window.gcsGa4Layer;
  let config = null, consent = 'denied';
  const handle = args => {
    const [type, name, fields] = args;
    if (type === 'config') config = fields;
    if (type === 'consent') consent = fields.analytics_storage;
    if (type === 'event' && name === 'page_view' && config && consent === 'granted' && !window['ga-disable-' + id]) {
      document.cookie = '_ga=canary; Path=/; Secure; SameSite=Lax';
      document.cookie = '_ga_2WQ42JY0WK=canary; Path=/; Secure; SameSite=Lax';
      const url = new URL('https://www.google-analytics.com/g/collect');
      url.searchParams.set('en', name);
      for (const key of ['page_location', 'page_title', 'page_referrer']) url.searchParams.set(key, fields[key]);
      fetch(url.toString()).catch(() => {});
    }
  };
  for (const args of layer) handle(args);
  const push = layer.push.bind(layer);
  layer.push = function (...args) { for (const arg of args) handle(arg); return push(...args); };
})();
