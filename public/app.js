const addressForm = document.querySelector('#address-form');
const heroForm = document.querySelector('#hero-form');
const address = document.querySelector('#address');
const heroAddress = document.querySelector('#hero-address');
const welcome = document.querySelector('#welcome');
const browser = document.querySelector('#browser');
const viewport = document.querySelector('#viewport');
const status = document.querySelector('#status');
const compatibility = document.querySelector('#compatibility');

const platform = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent;
compatibility.hidden = /Windows|Win32|Win64|CrOS/i.test(platform);

function message(text) {
  status.textContent = text;
  status.hidden = !text;
}

function normalize(input) {
  const value = input.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[\w-]+(\.[\w-]+)+([/:?#].*)?$/i.test(value)) return `https://${value}`;
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

async function openTarget(raw) {
  const target = normalize(raw);
  if (!target) return;
  message('');
  if (!('serviceWorker' in navigator)) {
    message('This browser does not support the required service worker.');
    return;
  }
  try {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    address.value = target;
    viewport.src = `${__uv$config.prefix}${__uv$config.encodeUrl(target)}`;
    welcome.hidden = true;
    browser.hidden = false;
  } catch (error) {
    console.error(error);
    message('Could not start the proxy. Reload the page and try again.');
  }
}

addressForm.addEventListener('submit', (event) => {
  event.preventDefault();
  openTarget(address.value);
});
heroForm.addEventListener('submit', (event) => {
  event.preventDefault();
  openTarget(heroAddress.value);
});
document.querySelector('#back').addEventListener('click', () => {
  if (!browser.hidden) viewport.contentWindow.history.back();
});
document.querySelector('#forward').addEventListener('click', () => {
  if (!browser.hidden) viewport.contentWindow.history.forward();
});
document.querySelector('#reload').addEventListener('click', () => {
  if (!browser.hidden) viewport.contentWindow.location.reload();
});
document.querySelector('#home').addEventListener('click', () => {
  viewport.src = 'about:blank';
  browser.hidden = true;
  welcome.hidden = false;
  address.value = '';
  heroAddress.focus();
});
