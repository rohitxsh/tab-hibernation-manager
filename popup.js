const $ = (sel) => document.querySelector(sel);
const list = $('#tab-list');
const template = $('#tab-item');
const statusEl = $('#status');
const FALLBACK_ICON =
  'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="%23888"/></svg>';

// Keep in sync with canManage() in background.js.
const canManage = (tab) => /^(https?|file):/i.test(tab?.url || tab?.pendingUrl || '');

let windowId;

function showStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

function setIcon(img, tab) {
  img.onerror = () => { img.onerror = null; img.src = FALLBACK_ICON; };
  img.src = tab.favIconUrl || FALLBACK_ICON;
}

function statusOf(tab, kept) {
  if (kept) return ['Kept Awake', 'kept'];
  if (tab.discarded) return ['Hibernated', 'hibernated'];
  return ['Active', 'active'];
}

function configureButtons(keepBtn, hibBtn, tab, kept) {
  const manageable = canManage(tab);
  keepBtn.dataset.tabId = hibBtn.dataset.tabId = tab.id;
  keepBtn.setAttribute('aria-pressed', String(kept));
  keepBtn.disabled = !manageable && !kept;
  keepBtn.title = kept
    ? 'Keep Awake is on (click to allow hibernation)'
    : manageable ? 'Keep Awake (never hibernate)' : 'System pages cannot be managed';
  hibBtn.disabled = kept || tab.discarded || !manageable;
  hibBtn.title = kept
    ? 'Disable Keep Awake first'
    : tab.discarded ? 'Already hibernated'
    : manageable ? 'Hibernate this tab now' : 'System pages cannot be hibernated';
}

function renderCurrent(tab, kept) {
  $('#current-title').textContent = tab.title || tab.url || 'Untitled';
  setIcon($('#current-icon'), tab);
  const keepBtn = $('#current-keep');
  configureButtons(keepBtn, $('#current-hibernate'), tab, kept);
  keepBtn.textContent = kept ? '⚡ Keeping Awake' : '⚡ Keep Awake';
}

function tabItem(tab, kept) {
  const li = template.content.firstElementChild.cloneNode(true);
  li.classList.toggle('current', tab.active);
  setIcon(li.querySelector('.favicon'), tab);
  const title = li.querySelector('.title');
  title.textContent = tab.title || tab.url || 'Untitled'; // textContent: page titles are untrusted
  title.title = tab.url ?? '';
  const [label, cls] = statusOf(tab, kept);
  const badge = li.querySelector('.badge');
  badge.textContent = label;
  badge.classList.add(cls);
  const [keepBtn, hibBtn] = li.querySelectorAll('button');
  configureButtons(keepBtn, hibBtn, tab, kept);
  return li;
}

async function render() {
  const [tabs, { keepAwake = {} }] = await Promise.all([
    chrome.tabs.query({ currentWindow: true }),
    chrome.storage.local.get('keepAwake'),
  ]);
  const current = tabs.find((t) => t.active);
  windowId = current?.windowId ?? tabs[0]?.windowId;
  if (current) renderCurrent(current, current.id in keepAwake);
  list.replaceChildren(...tabs.map((t) => tabItem(t, t.id in keepAwake)));
}

async function act(action, data) {
  // Hibernating the active tab switches focus, which may close this popup; the work still finishes in the background.
  const res = await chrome.runtime.sendMessage({ action, ...data });
  if (!res?.ok) showStatus(res?.error || 'Something went wrong.', true);
  else if (action === 'hibernateAll') showStatus(`Hibernated ${res.result} tab(s).`);
  else showStatus('');
  await render();
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn || btn.disabled) return;
  act(btn.dataset.action, { tabId: Number(btn.dataset.tabId), windowId });
});

// Reflect changes made via shortcut / context menu while the popup is open.
chrome.storage.onChanged.addListener(render);

render();
