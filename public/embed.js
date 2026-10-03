/**
 * Tiny embed helper for badradio.com / badradio.rocks.
 * Usage: <script src="https://badradio.rocks/embed.js" async></script>
 * Optional: data-height="580"
 */
(function () {
  var script = document.currentScript;
  var origin = 'https://badradio.rocks';
  try {
    if (script && script.src) origin = new URL(script.src).origin;
  } catch (err) {
    origin = 'https://badradio.rocks';
  }
  var height = '580';
  if (script && script.getAttribute) {
    var requested = script.getAttribute('data-height');
    if (requested && /^\d{2,4}$/.test(requested)) height = requested;
  }
  var iframe = document.createElement('iframe');
  iframe.src = origin + '/widget';
  iframe.title = 'badradio live player';
  iframe.loading = 'lazy';
  iframe.setAttribute('allow', 'autoplay');
  iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  iframe.style.cssText =
    'display:block;width:100%;max-width:100%;height:' +
    height +
    'px;border:0;overflow:hidden;background:#080705';
  if (script && script.parentNode) {
    script.parentNode.insertBefore(iframe, script);
  }
})();
