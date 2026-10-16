# Tab Hibernation Manager

A Manifest V3 Chrome extension to keep chosen tabs awake forever, or hibernate (discard) tabs on demand to free memory.

## Features

- **Keep Awake**: lock a tab so Chrome never auto-discards it (`autoDiscardable: false`). Survives reloads and is re-matched by URL after a browser restart.
- **Hibernate Now**: discard any tab immediately, including the active one (focus moves to a neighbouring tab first).
- **Hibernate All**: discard every inactive tab in the window that isn't kept awake, a system page, or playing audio.
- **Popup** with all tabs in the window, their status (Kept Awake / Hibernated / Active) and per-tab controls.
- **Right-click menu** on any page, plus keyboard shortcuts:
  - `Alt+Shift+K`: toggle Keep Awake
  - `Alt+Shift+H`: hibernate the current tab

Permissions: `tabs`, `storage`, `contextMenus` only.

## Install (unpacked)

1. Clone or download this repo.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the repo folder.

Shortcuts can be changed at `chrome://extensions/shortcuts`.

## Notes

- Chrome draws its dotted "hibernated" ring only for tabs discarded by its own Memory Saver, not for tabs discarded through the extension API. Check `chrome://discards` or the popup badge to confirm a tab is hibernated.
- System pages (`chrome://`, `edge://`, `about:`, extension pages) can't be discarded and are skipped.
