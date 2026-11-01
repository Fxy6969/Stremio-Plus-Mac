/**
 * @name Sidebar Navigation
 * @description Replaces the navigation bar with a floating glass tab bar on the left, in the style of visionOS: icon tabs, a "…" button for everything else, and your profile. Use instead of Horizontal Navigation.
 * @version 1.2.0
 * @author Fxy
 */

(function () {
  if (window.__sidebarNavigation) window.__sidebarNavigation.destroy();

  const ICONS = {
    board: '<path fill="currentColor" d="M11.1 3.4a1.4 1.4 0 0 1 1.8 0l7.4 6.2c.4.3.6.8.6 1.3v8.3c0 .9-.7 1.6-1.6 1.6h-4.1v-5.5c0-.5-.4-.9-.9-.9h-4.6c-.5 0-.9.4-.9.9v5.5H4.7c-.9 0-1.6-.7-1.6-1.6v-8.3c0-.5.2-1 .6-1.3z"/>',
    discover: '<rect fill="currentColor" x="3.5" y="3.5" width="7.6" height="7.6" rx="2.4"/><rect fill="currentColor" x="12.9" y="3.5" width="7.6" height="7.6" rx="2.4"/><rect fill="currentColor" x="3.5" y="12.9" width="7.6" height="7.6" rx="2.4"/><rect fill="currentColor" x="12.9" y="12.9" width="7.6" height="7.6" rx="2.4"/>',
    library: '<rect fill="currentColor" x="3.5" y="7" width="17" height="13.5" rx="2.6"/><rect fill="currentColor" opacity=".6" x="5.5" y="4.2" width="13" height="1.8" rx=".9"/><rect fill="currentColor" opacity=".35" x="7.5" y="1.9" width="9" height="1.6" rx=".8"/>',
    calendar: '<path fill="currentColor" d="M7.5 2.5c.5 0 .9.4.9.9V5h7.2V3.4a.9.9 0 0 1 1.8 0V5h.6A2.8 2.8 0 0 1 20.8 7.8V9H3.2V7.8A2.8 2.8 0 0 1 6 5h.6V3.4c0-.5.4-.9.9-.9zM3.2 10.6h17.6v7.6a2.8 2.8 0 0 1-2.8 2.8H6a2.8 2.8 0 0 1-2.8-2.8z"/>',
    search: '<circle cx="10.6" cy="10.6" r="6.3" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="m15.3 15.3 4.8 4.8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
    more: '<circle fill="currentColor" cx="5.5" cy="12" r="1.9"/><circle fill="currentColor" cx="12" cy="12" r="1.9"/><circle fill="currentColor" cx="18.5" cy="12" r="1.9"/>',
    addons: '<path fill="currentColor" d="M9.6 3.2a2.2 2.2 0 0 1 4.4 0V5h3.6c.8 0 1.4.6 1.4 1.4V10h-1.6a2.2 2.2 0 0 0 0 4.4H19V18c0 .8-.6 1.4-1.4 1.4H14v-1.6a2.2 2.2 0 0 0-4.4 0v1.6H6c-.8 0-1.4-.6-1.4-1.4v-3.6h1.6a2.2 2.2 0 0 0 0-4.4H4.6V6.4C4.6 5.6 5.2 5 6 5h3.6z"/>',
    settings: '<path fill="currentColor" fill-rule="evenodd" d="M10.3 2.6h3.4l.5 2.4 1.6.9 2.3-.8 1.7 2.9-1.8 1.6v1.8l1.8 1.6-1.7 2.9-2.3-.8-1.6.9-.5 2.4h-3.4l-.5-2.4-1.6-.9-2.3.8-1.7-2.9 1.8-1.6v-1.8L3.7 8l1.7-2.9 2.3.8 1.6-.9zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>',
    fullscreen: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 9V5.5C4 4.7 4.7 4 5.5 4H9M15 4h3.5c.8 0 1.5.7 1.5 1.5V9M20 15v3.5c0 .8-.7 1.5-1.5 1.5H15M9 20H5.5C4.7 20 4 19.3 4 18.5V15"/>',
    tv: '<rect fill="none" stroke="currentColor" stroke-width="2" x="3" y="4.5" width="18" height="12.5" rx="2.5"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M8.5 20.5h7"/>',
    plus: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M7.5 4.5h9a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-9a3 3 0 0 1-3-3v-9a3 3 0 0 1 3-3zM12 8.5v7M8.5 12h7"/>',
  };

  function svg(name) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[name] + "</svg>";
  }

  function h(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

  function isHome(hash) { return hash === "" || hash === "#" || hash === "#/" || hash.startsWith("#/?"); }

  const TABS = [
    { id: "board", label: "Board", href: "#/", match: isHome },
    { id: "discover", label: "Discover", href: "#/discover", match: (x) => x.startsWith("#/discover") },
    { id: "library", label: "Library", href: "#/library", match: (x) => x.startsWith("#/library") },
    { id: "calendar", label: "Calendar", href: "#/calendar", match: (x) => x.startsWith("#/calendar") },
    { id: "search", label: "Search", match: (x) => x.startsWith("#/search") },
  ];

  // Collapsed toolbar items, behind the "…" button
  const MORE = [
    { id: "addons", label: "Addons", href: "#/addons", match: (x) => x.startsWith("#/addons") },
    { id: "settings", label: "Settings", href: "#/settings", match: (x) => x.startsWith("#/settings") },
    { id: "fullscreen", label: "Full Screen", run: () => {
        const nav = visibleNav();
        const button = nav && nav.querySelector('[title*="ullscreen"], [title*="ull screen"]');
        if (button) button.click();
      } },
    { id: "tv", label: "TV Mode", when: () => !!(window.stremioPlusShell && window.stremioPlusShell.tvMode),
      run: () => window.stremioPlusShell.tvMode.toggle() },
    { id: "plus", label: "Stremio+", when: () => typeof window.__st_toggle === "function", run: () => window.__st_toggle() },
  ];

  // ── Ornament ───────────────────────────────────────────────────────────────
  const root = h("div", "sb");
  root.setAttribute("role", "navigation");

  const moreButton = h("button", "sb-circle sb-more");
  moreButton.setAttribute("aria-label", "More");
  moreButton.setAttribute("aria-haspopup", "menu");
  moreButton.innerHTML = svg("more");

  const pill = h("div", "sb-pill");
  const indicator = h("span", "sb-indicator");
  pill.appendChild(indicator);
  const tabs = TABS.map((tab) => {
    const el = h(tab.href ? "a" : "button", "sb-tab");
    if (tab.href) el.href = tab.href;
    el.setAttribute("aria-label", tab.label);
    el.innerHTML = svg(tab.id);
    el.appendChild(h("span", "sb-tip", tab.label));
    pill.appendChild(el);
    return { tab, el };
  });

  // Stremio's real profile button is moved over this spot, so its menu works as usual
  const profileSlot = h("div", "sb-circle sb-profile-slot");

  root.append(moreButton, pill, profileSlot);

  // "…" menu, grows out of its button
  const menu = h("div", "sb-menu");
  menu.setAttribute("role", "menu");

  // Search field, grows out of the search tab
  const searchBox = h("form", "sb-searchbox");
  const searchIcon = h("span", "sb-searchbox-icon");
  searchIcon.innerHTML = svg("search");
  const input = h("input");
  input.type = "search";
  input.placeholder = "Movies, series, people";
  input.setAttribute("aria-label", "Search");
  searchBox.append(searchIcon, input);

  // ── Behaviour ──────────────────────────────────────────────────────────────
  function visibleNav() {
    return Array.from(document.querySelectorAll('[class*="main-nav-bars-container"] > [class*="horizontal-nav-bar"]'))
      .find((nav) => nav.offsetParent !== null) || null;
  }

  function openMenu(open) {
    if (open) {
      menu.replaceChildren(...MORE.filter((item) => !item.when || item.when()).map((item) => {
        const row = h("button", "sb-menu-item");
        row.setAttribute("role", "menuitem");
        row.innerHTML = svg(item.id);
        row.appendChild(h("span", null, item.label));
        if (item.match && item.match(location.hash)) row.classList.add("on");
        row.addEventListener("click", () => {
          openMenu(false);
          if (item.href) location.hash = item.href.slice(1); else item.run();
        });
        return row;
      }));
      const r = moreButton.getBoundingClientRect();
      menu.style.left = r.right + 12 + "px";
      menu.style.top = r.top + "px";
      openSearch(false);
    }
    menu.classList.toggle("open", open);
    moreButton.classList.toggle("pressed", open);
    moreButton.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function openSearch(open) {
    if (open) {
      const tab = tabs.find((t) => t.tab.id === "search").el.getBoundingClientRect();
      searchBox.style.left = tab.right + 14 + "px";
      searchBox.style.top = tab.top + tab.height / 2 + "px";
      openMenu(false);
      requestAnimationFrame(() => input.focus());
    } else if (document.activeElement === input) input.blur();
    searchBox.classList.toggle("open", open);
  }

  moreButton.addEventListener("click", (e) => { e.stopPropagation(); openMenu(!menu.classList.contains("open")); });
  tabs.find((t) => t.tab.id === "search").el.addEventListener("click", (e) => {
    e.stopPropagation();
    openSearch(!searchBox.classList.contains("open"));
  });
  searchBox.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    location.hash = "/search?search=" + encodeURIComponent(q);
    openSearch(false);
  });

  function onDocClick(e) {
    if (menu.classList.contains("open") && !menu.contains(e.target) && !moreButton.contains(e.target)) openMenu(false);
    if (searchBox.classList.contains("open") && !searchBox.contains(e.target)) openSearch(false);
  }
  function onKey(e) {
    if (e.key === "Escape" && (menu.classList.contains("open") || searchBox.classList.contains("open"))) {
      e.stopPropagation();
      openMenu(false);
      openSearch(false);
    }
  }

  function markSelected() {
    const hash = location.hash;
    let index = -1;
    tabs.forEach(({ tab, el }, i) => {
      const on = tab.match(hash);
      el.classList.toggle("on", on);
      if (on) { el.setAttribute("aria-current", "page"); index = i; } else el.removeAttribute("aria-current");
    });
    // The highlight slides to the selected tab (and stays put while nothing is selected)
    if (index >= 0) indicator.style.transform = "translateY(" + tabs[index].el.offsetTop + "px)";
    pill.classList.toggle("has-selection", index >= 0);
    // Addons and Settings live behind "…": mark it so you can tell where you are
    moreButton.classList.toggle("on", MORE.some((item) => item.match && item.match(hash)));
    const m = /^#\/search\?(?:.*&)?search=([^&]*)/.exec(hash);
    if (document.activeElement !== input) input.value = m ? decodeURIComponent(m[1]) : "";
  }

  // Place Stremio's profile button over the slot at the bottom of the ornament
  function placeProfile() {
    const r = profileSlot.getBoundingClientRect();
    const style = document.documentElement.style;
    style.setProperty("--sb-profile-x", r.left + "px");
    style.setProperty("--sb-profile-y", r.top + "px");
    style.setProperty("--sb-profile-size", r.width + "px");
  }

  function sync() {
    const on = !!visibleNav();
    document.documentElement.classList.toggle("sb-on", on);
    if (on) {
      if (!root.isConnected) document.body.append(root, menu, searchBox);
      markSelected();
      placeProfile();
    } else {
      openMenu(false);
      openSearch(false);
    }
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; sync(); });
  }
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("hashchange", schedule);
  window.addEventListener("resize", schedule);
  document.addEventListener("click", onDocClick, true);
  window.addEventListener("keydown", onKey, true);

  // ── Styles (themes restyle these; see the Modern Glass theme) ─────────────
  const style = document.createElement("style");
  style.id = "sidebar-navigation-style";
  style.textContent = `
    :root {
      --sb-inset: 16px;
      --sb-size: 52px;          /* tab and circle diameter */
      --sb-pad: 6px;            /* capsule padding around the tabs */
      --sb-glass: rgba(44, 44, 46, 0.5);
      --sb-glass-border: rgba(255, 255, 255, 0.14);
      --sb-glass-blur: blur(30px) saturate(170%);
      --sb-icon: rgba(255, 255, 255, 0.86);
      --sb-icon-on: #fff;
      --sb-highlight: rgba(255, 255, 255, 0.2);
      --sb-hover: rgba(255, 255, 255, 0.09);
      --sb-ease: cubic-bezier(.32, .72, 0, 1);
      --sb-offset: calc(var(--sb-size) + var(--sb-pad) * 2 + var(--sb-inset) * 2);
    }

    /* Stremio's own navigation gives way to the ornament.
       :not(#_) adds ID-level weight so these beat themes' #app selectors */
    html.sb-on [class*="vertical-nav-bar"]:not(#_):not(#_),
    html.sb-on [class*="main-nav-bars-container"] > [class*="horizontal-nav-bar"] [class*="logo-container"]:not(#_):not(#_),
    html.sb-on [class*="main-nav-bars-container"] > [class*="horizontal-nav-bar"] [class*="search-bar"]:not(#_):not(#_),
    html.sb-on [class*="main-nav-bars-container"] > [class*="horizontal-nav-bar"] [class*="buttons-container"] > :not([class*="menu-button-container"]):not(#_):not(#_) { display: none !important; }
    html.sb-on [class*="main-nav-bars-container"] > [class*="horizontal-nav-bar"]:not(#_):not(#_) { background: none !important; box-shadow: none !important; pointer-events: none; }
    html.sb-on [class*="main-nav-bars-container"] > [class*="nav-content-container"]:not(#_):not(#_) {
      left: var(--sb-offset) !important; width: auto !important; right: 0 !important;
    }
    html.sb-on [class*="warning-container"]:not(#_) { left: var(--sb-offset) !important; }

    /* Stremio's profile button becomes the circle at the bottom of the ornament */
    html.sb-on [class*="main-nav-bars-container"] > [class*="horizontal-nav-bar"] [class*="menu-button-container"]:not(#_):not(#_) {
      position: fixed !important; z-index: 61; pointer-events: auto;
      left: var(--sb-profile-x) !important; top: var(--sb-profile-y) !important;
      width: var(--sb-profile-size) !important; height: var(--sb-profile-size) !important;
      min-width: 0 !important; margin: 0 !important; padding: 0 !important; transform: none !important;
      display: grid !important; place-items: center; border-radius: 50% !important;
      background: var(--sb-glass) !important; border: 0.5px solid var(--sb-glass-border) !important;
      -webkit-backdrop-filter: var(--sb-glass-blur) !important; backdrop-filter: var(--sb-glass-blur) !important;
      box-shadow: 0 10px 34px rgba(0, 0, 0, 0.32), inset 0 1px 0 rgba(255, 255, 255, 0.12), inset 0 -1px 0 rgba(0, 0, 0, 0.12) !important;
      transition: transform .12s ease;
    }
    html.sb-on [class*="main-nav-bars-container"] > [class*="horizontal-nav-bar"] [class*="menu-button-container"]:active:not(#_):not(#_) { transform: scale(.92) !important; }
    html.sb-on [class*="main-nav-bars-container"] > [class*="horizontal-nav-bar"] [class*="menu-button-container"] > svg:not(#_) { display: none !important; }
    html.sb-on [class*="main-nav-bars-container"] > [class*="horizontal-nav-bar"] [class*="menu-button-container"] > [class*="avatar"]:not(#_) {
      width: calc(var(--sb-profile-size) - 8px) !important; height: calc(var(--sb-profile-size) - 8px) !important; margin: 0 !important; border-radius: 50%; overflow: hidden;
    }
    html.sb-on [class*="main-nav-bars-container"] > [class*="horizontal-nav-bar"] [class*="menu-button-container"] > [class*="avatar"] img:not(#_) { width: 100% !important; height: 100% !important; object-fit: cover; }

    /* Context Menu Fix shows the open profile menu from a copy of the button
       on its own layer: give the copy the circle's size and open the menu
       beside it, growing upward from the avatar */
    html.sb-on .context-menu-portal > [class*="menu-button-container"]:not(#_):not(#_) {
      width: var(--sb-profile-size) !important; height: var(--sb-profile-size) !important; padding: 0 !important; transform: none !important;
      background: none !important; border: 0 !important; box-shadow: none !important;
    }
    html.sb-on .context-menu-portal > [class*="menu-button-container"] > :not(:has([class*="menu-container"])):not(#_) { display: none !important; }
    html.sb-on .context-menu-portal > [class*="menu-button-container"] [class*="menu-container"][class*="menu-direction"]:not(#_):not(#_) {
      position: absolute !important; left: calc(100% + 12px) !important; bottom: 0 !important; top: auto !important; right: auto !important;
      transform-origin: bottom left;
    }

    /* Full-window banners (Dynamic Hero) fill the space beside the ornament */
    /* (14px: the Board's own side padding, which the banner bleeds through) */
    html.sb-on .hero-container:not(#_) { left: 0 !important; right: auto !important; margin-left: -14px !important; margin-right: 0 !important; width: calc(100% + 28px) !important; }
    html.sb-on .hero-container .hero-overlay:not(#_) { padding-left: 4% !important; padding-right: 4% !important; }
    html.sb-on .hero-container .hero-controls:not(#_) { right: 4% !important; }

    .sb, .sb-menu, .sb-searchbox { display: none; }
    html.sb-on .sb {
      position: fixed; z-index: 60; left: var(--sb-inset); top: 50%; transform: translateY(-50%);
      display: flex; flex-direction: column; align-items: center; gap: 16px;
      font-size: 14px; font-weight: 500; line-height: 1.2;
      animation: sb-in .45s var(--sb-ease) both;
      pointer-events: none;
    }
    .sb > .sb-more, .sb > .sb-pill { pointer-events: auto; }
    .sb button { font: inherit; border: 0; padding: 0; background: none; cursor: default; }
    .sb svg, .sb-menu svg, .sb-searchbox svg { display: block; width: 22px; height: 22px; }

    /* Glass: the capsule and the circles */
    .sb-pill, .sb-circle, .sb-menu, .sb-searchbox {
      background: var(--sb-glass); border: 0.5px solid var(--sb-glass-border);
      -webkit-backdrop-filter: var(--sb-glass-blur); backdrop-filter: var(--sb-glass-blur);
      box-shadow: 0 10px 34px rgba(0, 0, 0, 0.32), inset 0 1px 0 rgba(255, 255, 255, 0.12), inset 0 -1px 0 rgba(0, 0, 0, 0.12);
    }
    .sb .sb-circle { position: relative; display: grid; place-items: center; width: var(--sb-size); height: var(--sb-size); border-radius: 50%; color: var(--sb-icon); }
    /* Only reserves the space: Stremio's button (drawn below the ornament) shows through */
    .sb .sb-profile-slot { background: none; border: 0; box-shadow: none; -webkit-backdrop-filter: none; backdrop-filter: none; pointer-events: none; }
    .sb .sb-more { transition: transform .12s ease, background .15s ease; }
    .sb .sb-more:hover, .sb .sb-more.pressed { background: color-mix(in srgb, var(--sb-glass), white 12%); }
    .sb .sb-more:active { transform: scale(.92); }
    .sb .sb-more.on::after { content: ""; position: absolute; inset: -3px; border-radius: 50%; box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.55); }

    .sb-pill { position: relative; display: flex; flex-direction: column; gap: 4px; padding: var(--sb-pad); border-radius: calc(var(--sb-size) / 2 + var(--sb-pad)); }
    .sb-indicator { position: absolute; left: var(--sb-pad); top: 0; width: var(--sb-size); height: var(--sb-size); border-radius: 50%;
      background: var(--sb-highlight); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16);
      opacity: 0; transition: transform .42s var(--sb-ease), opacity .2s ease; pointer-events: none; }
    .sb-pill.has-selection .sb-indicator { opacity: 1; }
    .sb .sb-tab { position: relative; display: grid; place-items: center; width: var(--sb-size); height: var(--sb-size); border-radius: 50%;
      color: var(--sb-icon) !important; text-decoration: none; transition: background .15s ease, color .15s ease, transform .12s ease; }
    .sb .sb-tab:hover:not(.on) { background: var(--sb-hover); }
    .sb .sb-tab:active { transform: scale(.92); }
    .sb .sb-tab.on { color: var(--sb-icon-on) !important; }
    .sb-tab svg { position: relative; }

    /* Label that appears beside a tab on hover, like looking at it in visionOS */
    .sb-tip { position: absolute; left: calc(100% + 14px); top: 50%; transform: translate(-6px, -50%) scale(.96); transform-origin: left center;
      padding: 7px 12px; border-radius: 999px; white-space: nowrap; pointer-events: none; color: #fff; font-size: 13px; font-weight: 600;
      background: var(--sb-glass); border: 0.5px solid var(--sb-glass-border); -webkit-backdrop-filter: var(--sb-glass-blur); backdrop-filter: var(--sb-glass-blur);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3); opacity: 0; transition: opacity .15s ease, transform .25s var(--sb-ease); }
    .sb-tab:hover .sb-tip { opacity: 1; transform: translate(0, -50%) scale(1); transition-delay: .35s; }

    /* "…" menu */
    html.sb-on .sb-menu { display: block; position: fixed; z-index: 62; min-width: 200px; padding: 6px; border-radius: 22px; color: #fff;
      font-size: 14px; font-weight: 500; line-height: 1.2;
      transform-origin: top left; opacity: 0; transform: scale(.9); pointer-events: none; visibility: hidden;
      transition: opacity .18s ease, transform .32s var(--sb-ease), visibility 0s linear .32s; }
    html.sb-on .sb-menu.open { opacity: 1; transform: none; pointer-events: auto; visibility: visible; transition: opacity .18s ease, transform .32s var(--sb-ease); }
    .sb-menu .sb-menu-item { display: flex; align-items: center; gap: 12px; width: 100%; height: 44px; padding: 0 14px; border: 0; border-radius: 16px;
      background: none; color: rgba(255, 255, 255, 0.9); font: inherit; text-align: left; cursor: default; }
    .sb-menu .sb-menu-item:hover { background: var(--sb-hover); color: #fff; }
    .sb-menu .sb-menu-item:active { transform: scale(.98); }
    .sb-menu .sb-menu-item.on { background: var(--sb-highlight); color: #fff; font-weight: 600; }
    .sb-menu-item svg { width: 20px; height: 20px; opacity: .9; }

    /* Search field */
    html.sb-on .sb-searchbox { display: flex; position: fixed; z-index: 62; align-items: center; gap: 10px; width: 340px; height: 50px; padding: 0 16px; border-radius: 25px;
      transform-origin: left center; opacity: 0; transform: translateY(-50%) scaleX(.6); pointer-events: none; visibility: hidden;
      transition: opacity .16s ease, transform .34s var(--sb-ease), visibility 0s linear .34s; }
    html.sb-on .sb-searchbox.open { opacity: 1; transform: translateY(-50%); pointer-events: auto; visibility: visible; transition: opacity .16s ease, transform .34s var(--sb-ease); }
    .sb-searchbox-icon { color: rgba(255, 255, 255, 0.6); }
    .sb-searchbox-icon svg { width: 18px; height: 18px; }
    .sb-searchbox input { flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: none; color: #fff;
      font-size: 15px; font-family: inherit; }
    .sb-searchbox input::placeholder { color: rgba(255, 255, 255, 0.5); }
    .sb-searchbox input::-webkit-search-cancel-button { filter: invert(1); opacity: .5; }

    .sb .sb-tab:focus-visible, .sb .sb-more:focus-visible, .sb-menu .sb-menu-item:focus-visible { outline: 2px solid rgba(255, 255, 255, 0.85); outline-offset: 2px; }

    @keyframes sb-in { from { opacity: 0; transform: translate(-10px, -50%) scale(.96); } }
    @media (prefers-reduced-motion: reduce) {
      html.sb-on .sb, .sb-indicator, .sb-tip, html.sb-on .sb-menu, html.sb-on .sb-searchbox { animation: none !important; transition-property: opacity !important; }
      html.sb-on .sb-menu, html.sb-on .sb-menu.open { transform: none; }
      html.sb-on .sb-searchbox, html.sb-on .sb-searchbox.open { transform: translateY(-50%); }
    }
    @media (prefers-reduced-transparency: reduce) {
      .sb-pill, .sb-circle, .sb-menu, .sb-searchbox, .sb-tip { background: rgb(44, 44, 46); -webkit-backdrop-filter: none; backdrop-filter: none; }
    }
    @media (prefers-contrast: more) {
      .sb-pill, .sb-circle, .sb-menu, .sb-searchbox { background: rgb(28, 28, 30); border-color: rgba(255, 255, 255, 0.5); }
    }
  `;
  document.head.appendChild(style);

  window.__sidebarNavigation = {
    destroy() {
      observer.disconnect();
      window.removeEventListener("hashchange", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("click", onDocClick, true);
      window.removeEventListener("keydown", onKey, true);
      root.remove();
      menu.remove();
      searchBox.remove();
      style.remove();
      document.documentElement.classList.remove("sb-on");
      ["--sb-profile-x", "--sb-profile-y", "--sb-profile-size"].forEach((p) => document.documentElement.style.removeProperty(p));
      delete window.__sidebarNavigation;
    },
  };

  sync();
})();
