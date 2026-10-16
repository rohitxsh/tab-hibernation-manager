// Storage shape: { keepAwake: { [tabId]: url } }

// Only regular web/file pages can be discarded; chrome://, edge://, about:, extension pages etc. cannot.
const canManage = (tab) => /^(https?|file):/i.test(tab?.url || tab?.pendingUrl || '');

const getStore = async () => (await chrome.storage.local.get('keepAwake')).keepAwake ?? {};

// Serialize read-modify-write so concurrent events don't drop each other's changes.
let queue = Promise.resolve();
function updateStore(fn) {
  const run = queue.then(async () => {
    const keepAwake = await getStore();
    const result = await fn(keepAwake);
    await chrome.storage.local.set({ keepAwake });
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

const setBadge = (tabId, on) =>
  chrome.action.setBadgeText({ tabId, text: on ? 'ON' : '' }).catch(() => {});

async function setKeepAwake(tabId, on) {
  const tab = await chrome.tabs.get(tabId);
  if (on && !canManage(tab)) throw new Error('System pages cannot be managed.');
  await chrome.tabs.update(tabId, { autoDiscardable: !on });
  await updateStore((s) => {
    if (on) s[tabId] = tab.url;
    else delete s[tabId];
  });
  await setBadge(tabId, on);
  return on;
}

async function toggleKeepAwake(tabId) {
  return setKeepAwake(tabId, !(tabId in (await getStore())));
}

// Chrome refuses to discard the active tab, so focus a neighbour (or a new blank tab) first.
async function moveFocusAway(tab) {
  const tabs = await chrome.tabs.query({ windowId: tab.windowId });
  const next = tabs
    .filter((t) => t.id !== tab.id && !t.discarded)
    .sort((a, b) => Math.abs(a.index - tab.index) - Math.abs(b.index - tab.index))[0];
  if (next) await chrome.tabs.update(next.id, { active: true });
  else await chrome.tabs.create({ windowId: tab.windowId, active: true });
}

async function hibernate(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.discarded) return;
  if (!canManage(tab)) throw new Error('System pages cannot be hibernated.');
  if (tabId in (await getStore())) throw new Error('Disable Keep Awake before hibernating this tab.');
  if (tab.active) await moveFocusAway(tab);
  await chrome.tabs.discard(tabId);
}

async function hibernateAll(windowId) {
  const store = await getStore();
  const tabs = await chrome.tabs.query({ windowId, active: false, discarded: false });
  // Skip audible tabs, like Chrome's own auto-discard does, so playing media isn't killed.
  const targets = tabs.filter((t) => canManage(t) && !t.audible && !(t.id in store));
  const results = await Promise.allSettled(targets.map((t) => chrome.tabs.discard(t.id)));
  return results.filter((r) => r.status === 'fulfilled').length;
}

// Drop dead tab IDs and re-apply the lock. After a browser restart tab IDs change,
// so orphaned entries are re-attached to open tabs with the same URL.
// shortcut: tabs restored after this runs (slow session restore) aren't re-matched; add an onCreated URL match if that bites.
async function reconcile() {
  const tabs = await chrome.tabs.query({});
  await updateStore(async (s) => {
    const live = new Set(tabs.map((t) => String(t.id)));
    const orphans = [];
    for (const [id, url] of Object.entries(s)) {
      if (!live.has(id)) {
        orphans.push(url);
        delete s[id];
      }
    }
    for (const t of tabs) {
      const i = orphans.indexOf(t.url);
      if (i !== -1 && !(t.id in s)) {
        s[t.id] = t.url;
        orphans.splice(i, 1);
      }
    }
    for (const id of Object.keys(s)) {
      await chrome.tabs.update(Number(id), { autoDiscardable: false }).catch(() => {});
      await setBadge(Number(id), true);
    }
  });
}

const actions = {
  toggleKeepAwake: ({ tabId }) => toggleKeepAwake(tabId),
  hibernate: ({ tabId }) => hibernate(tabId),
  hibernateAll: ({ windowId }) => hibernateAll(windowId),
};

// Popup -> service worker
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const fn = actions[msg?.action];
  if (!fn) return false;
  fn(msg).then(
    (result) => sendResponse({ ok: true, result }),
    (err) => sendResponse({ ok: false, error: err.message }),
  );
  return true; // async response
});

// Context menu and keyboard shortcuts share IDs with `actions`.
async function runOnTab(action, tab) {
  let tabId = tab?.id;
  if (!(tabId >= 0)) {
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    tabId = active?.id;
  }
  if (tabId != null) await actions[action]({ tabId });
}
chrome.contextMenus.onClicked.addListener((info, tab) => runOnTab(info.menuItemId, tab).catch(console.warn));
chrome.commands.onCommand.addListener((command, tab) => runOnTab(command, tab).catch(console.warn));

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    const contexts = ['page', 'frame', 'all'];
    chrome.contextMenus.create({ id: 'toggleKeepAwake', title: 'Toggle Keep Awake (Never Hibernate)', contexts });
    chrome.contextMenus.create({ id: 'hibernate', title: 'Hibernate This Tab Now', contexts });
  });
  chrome.action.setBadgeBackgroundColor({ color: '#b45309' });
  reconcile().catch(console.warn);
});
chrome.runtime.onStartup.addListener(() => reconcile().catch(console.warn));

chrome.tabs.onRemoved.addListener((tabId) => {
  updateStore((s) => { delete s[tabId]; }).catch(console.warn);
});

// A discarded/prerendered tab can be swapped for a new ID; carry the lock over.
chrome.tabs.onReplaced.addListener(async (addedId, removedId) => {
  if (!(removedId in (await getStore()))) return;
  await updateStore((s) => {
    s[addedId] = s[removedId];
    delete s[removedId];
  });
  await chrome.tabs.update(addedId, { autoDiscardable: false });
  await setBadge(addedId, true);
});

chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (!(tabId in (await getStore()))) return;
  try {
    if (info.url) await updateStore((s) => { if (tabId in s) s[tabId] = info.url; });
    // Re-apply on reload/navigation, or if anything flipped it back to discardable.
    if (info.status === 'loading' || info.autoDiscardable === true) {
      await chrome.tabs.update(tabId, { autoDiscardable: false });
    }
    if (info.status) await setBadge(tabId, true);
  } catch (err) {
    console.warn(err); // tab closed mid-update
  }
});
