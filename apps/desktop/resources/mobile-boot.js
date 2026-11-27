// Loads before the phone UI. If the page's script or stylesheet fails to load, for example
// because the desktop app was rebuilt while this page was opening, reload once to pick up
// the new build. If loading still fails, or nothing has opened after 30 seconds, show a
// reload button in place of the placeholder instead of leaving the page stuck.
(function () {
  var key = 'budget-terminal-mobile-reload'
  function placeholder() { return document.querySelector('[data-mobile-boot]') }
  function reloadedRecently() {
    try { return Date.now() - Number(sessionStorage.getItem(key) || 0) < 60000 } catch (error) { return true }
  }
  function reload() {
    try { sessionStorage.setItem(key, String(Date.now())) } catch (error) { /* reload anyway */ }
    location.reload()
  }
  function showHelp(message) {
    var root = placeholder()
    if (!root) return
    var text = document.createElement('p')
    text.textContent = message
    var button = document.createElement('button')
    button.type = 'button'
    button.textContent = 'Reload'
    button.style.cssText = 'padding:10px 18px;border:1px solid #2c3e59;border-radius:6px;background:#2f6fd0;color:#d5dee9;font:inherit'
    button.addEventListener('click', reload)
    root.replaceChildren(text, button)
  }
  window.addEventListener('error', function (event) {
    var target = event.target
    if (!target || (target.tagName !== 'SCRIPT' && target.tagName !== 'LINK') || !placeholder()) return
    if (!reloadedRecently()) reload()
    else showHelp('Budget Terminal could not load. Keep the desktop app open and connected to Tailscale, then reload.')
  }, true)
  setTimeout(function () {
    if (placeholder()) showHelp('Budget Terminal is taking longer than usual to open. Check that the desktop app is open, then reload.')
  }, 30000)
})()
