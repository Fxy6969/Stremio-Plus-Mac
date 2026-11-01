/**
 * @name Cinematic Details
 * @description Streaming-app style title pages: the trailer plays full screen behind the title, with Watch Now, Add to Library and the episodes underneath.
 * @version 1.0.0
 * @author Fxy
 * @permission storage
 * @permission network
 */

(function () {
  if (window.__cinematicDetails) window.__cinematicDetails.destroy();

  const CINEMETA = "https://v3-cinemeta.strem.io/meta/";
  const SOUND_KEY = "cd_trailer_sound";
  const ROUTE = /^#\/detail\/([^/]+)\/([^/?]+)(?:\/([^/?]+))?/;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // ── Small helpers ──────────────────────────────────────────────────────────
  function h(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

  function icon(name) {
    const paths = {
      play: '<path fill="currentColor" d="M7 4.9v14.2c0 .9 1 1.4 1.7.9l11-7.1c.7-.4.7-1.4 0-1.8l-11-7.1C8 3.5 7 4 7 4.9z"/>',
      plus: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 5v14M5 12h14"/>',
      check: '<path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7.5"/>',
      muted: '<path fill="currentColor" d="M4 9.2v5.6c0 .4.3.7.7.7h3l4.4 3.9c.5.4 1.2.1 1.2-.5V5.1c0-.6-.7-.9-1.2-.5L7.7 8.5h-3c-.4 0-.7.3-.7.7z"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M16.5 9.5l5 5M21.5 9.5l-5 5"/>',
      sound: '<path fill="currentColor" d="M4 9.2v5.6c0 .4.3.7.7.7h3l4.4 3.9c.5.4 1.2.1 1.2-.5V5.1c0-.6-.7-.9-1.2-.5L7.7 8.5h-3c-.4 0-.7.3-.7.7z"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M16.2 8.6a5 5 0 0 1 0 6.8M18.9 6a8.6 8.6 0 0 1 0 12"/>',
      left: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M14.5 5.5L8 12l6.5 6.5"/>',
      right: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9.5 5.5L16 12l-6.5 6.5"/>',
      close: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    };
    const span = h("span", "cd-icon");
    span.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + paths[name] + "</svg>";
    return span;
  }

  function formatDate(value, withDay) {
    const date = new Date(value);
    if (isNaN(date)) return null;
    return date.toLocaleDateString(undefined, withDay ? { month: "short", day: "numeric", year: "numeric" } : { year: "numeric" });
  }

  function linksOf(meta, category) {
    return (meta.links || []).filter((l) => l.category === category).map((l) => l.name);
  }

  function episodeLabel(v) {
    return v.season ? "S" + v.season + " E" + v.episode : "E" + v.episode;
  }

  function released(v) {
    return !v.released || new Date(v.released) <= new Date();
  }

  function progressOf(v) {
    if (typeof v.progress !== "number" || v.progress <= 0) return 0;
    return Math.min(1, v.progress > 1 ? v.progress / 100 : v.progress);
  }

  function go(link) {
    if (link) location.hash = link.replace(/^#/, "");
  }

  // ── Data: Stremio's own details model, with Cinemeta as a fallback ─────────
  function route() {
    const m = ROUTE.exec(location.hash);
    if (!m) return null;
    return { type: m[1], id: decodeURIComponent(m[2]), videoId: m[3] ? decodeURIComponent(m[3]) : null };
  }

  function readCore(r) {
    if (!window.core || !window.core.getState) return Promise.resolve(null);
    return Promise.resolve(window.core.getState("meta_details"))
      .then((state) => {
        const item = state && state.metaItem && state.metaItem.content;
        if (!item || item.type !== "Ready" || !item.content || item.content.id !== r.id) return null;
        return { meta: item.content, library: state.libraryItem && !state.libraryItem.removed ? state.libraryItem : null };
      })
      .catch(() => null);
  }

  const cinemetaCache = {};
  function readCinemeta(r) {
    const key = r.type + "/" + r.id;
    if (!cinemetaCache[key]) {
      cinemetaCache[key] = fetch(CINEMETA + key + ".json")
        .then((res) => res.json())
        .then((d) => (d.meta ? { meta: d.meta, library: null } : null))
        .catch(() => null);
    }
    return cinemetaCache[key];
  }

  // Stremio fills its model a moment after the page opens; wait for it briefly
  function loadDetails(r, attempt) {
    return readCore(r).then((data) => {
      if (data) return data;
      if ((attempt || 0) < 15) return new Promise((res) => setTimeout(res, 200)).then(() => loadDetails(r, (attempt || 0) + 1));
      return readCinemeta(r);
    });
  }

  function coreAction(action, args) {
    if (!window.core || !window.core.dispatch) return false;
    window.core.dispatch({ action: "Ctx", args: { action: action, args: args } });
    return true;
  }

  function metaPreview(m) {
    const p = { id: m.id, type: m.type, name: m.name, posterShape: m.posterShape || "poster", links: [], trailerStreams: [], behaviorHints: {} };
    ["poster", "background", "logo", "description", "releaseInfo", "runtime", "released"].forEach((k) => { if (m[k]) p[k] = m[k]; });
    return p;
  }

  // ── What Watch Now plays ───────────────────────────────────────────────────
  function sortedEpisodes(meta) {
    return (meta.videos || []).slice().sort((a, b) => {
      const sa = a.season || 9999, sb = b.season || 9999; // specials last
      return sa - sb || (a.episode || 0) - (b.episode || 0);
    });
  }

  function nextUp(meta, library) {
    const episodes = sortedEpisodes(meta).filter((v) => v.season !== 0);
    if (!episodes.length) return null;
    const lastId = library && library.state && library.state.video_id;
    let index = lastId ? episodes.findIndex((v) => v.id === lastId) : -1;
    if (index < 0) {
      for (let i = episodes.length - 1; i >= 0; i--) if (episodes[i].watched || progressOf(episodes[i])) { index = i; break; }
    }
    if (index < 0) return { video: episodes.find(released) || episodes[0], label: "Watch Now" };
    const current = episodes[index];
    if (!current.watched && progressOf(current) > 0 && progressOf(current) < 0.92) return { video: current, label: "Resume " + episodeLabel(current) };
    const next = episodes.slice(index + 1).find(released);
    if (next) return { video: next, label: "Watch " + episodeLabel(next) };
    return { video: current, label: "Watch Again" };
  }

  // ── Trailer (muted YouTube embed behind the title) ─────────────────────────
  function createTrailer(ytId, onPlaying, onEnded, onHold) {
    const frame = document.createElement("iframe");
    frame.className = "cd-trailer";
    frame.allow = "autoplay; encrypted-media";
    frame.tabIndex = -1;
    frame.setAttribute("aria-hidden", "true");
    frame.src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(ytId) +
      "?autoplay=1&mute=1&controls=0&disablekb=1&fs=0&iv_load_policy=3&modestbranding=1&playsinline=1&rel=0&enablejsapi=1&origin=" +
      encodeURIComponent(location.origin);

    let playing = false, held = false;
    function send(func, args) {
      if (frame.contentWindow) frame.contentWindow.postMessage(JSON.stringify({ event: "command", func: func, args: args || [] }), "*");
    }
    function onMessage(e) {
      if (e.source !== frame.contentWindow) return;
      let data;
      try { data = typeof e.data === "string" ? JSON.parse(e.data) : e.data; } catch (err) { return; }
      const state = data && data.info && typeof data.info.playerState === "number" ? data.info.playerState : null;
      if (state === 1 && !playing) { playing = true; onPlaying(); }
      if (state === 0) { playing = false; onEnded(); }
    }
    window.addEventListener("message", onMessage);
    // The embed only reports its state after it has been told someone listens
    frame.addEventListener("load", () => {
      if (frame.contentWindow) frame.contentWindow.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "*");
    });

    return {
      el: frame,
      setMuted: (muted) => send(muted ? "mute" : "unMute"),
      // YouTube flashes a play/pause symbol on every command, so only resume
      // what we paused ourselves
      pause: () => { if (playing && !held) { held = true; onHold(true); send("pauseVideo"); } },
      play: () => { if (held) { held = false; onHold(false); send("playVideo"); } },
      destroy: () => { window.removeEventListener("message", onMessage); frame.remove(); },
    };
  }

  // ── The page ───────────────────────────────────────────────────────────────
  let root = null;        // our layer inside Stremio's details container
  let shown = null;       // route key currently rendered
  let trailer = null;
  let heroObserver = null;
  let renderToken = 0;

  function container() {
    return document.querySelector('[class*="metadetails-container"]');
  }

  function soundOn() {
    try { return localStorage.getItem(SOUND_KEY) === "on"; } catch (e) { return false; }
  }

  function teardown() {
    renderToken++;
    if (trailer) { trailer.destroy(); trailer = null; }
    if (heroObserver) { heroObserver.disconnect(); heroObserver = null; }
    const c = root && root.parentElement;
    if (c) c.classList.remove("cd-on", "cd-sheet");
    document.querySelectorAll(".cd-scrim, .cd-sheet-close").forEach((el) => el.remove());
    if (root) root.remove();
    root = null;
    shown = null;
  }

  // Stremio's stream list becomes a sheet over the page
  function setSheet(open) {
    const c = container();
    if (!c) return;
    c.classList.toggle("cd-sheet", open);
    if (trailer) open ? trailer.pause() : trailer.play();
  }

  function closeSheet() {
    const r = route();
    if (!r) return;
    setSheet(false);
    // Series: the list belongs to an episode route; go back to the show
    if (r.type !== "movie" && r.videoId) location.replace(location.href.split("#")[0] + "#/detail/" + r.type + "/" + encodeURIComponent(r.id));
  }

  function ensureSheetChrome(c) {
    if (!c.querySelector(":scope > .cd-scrim")) {
      const scrim = h("div", "cd-scrim");
      scrim.addEventListener("click", closeSheet);
      c.appendChild(scrim);
    }
    const list = c.querySelector('[class*="streams-list-container"]');
    if (list && !list.querySelector(".cd-sheet-close")) {
      const close = h("button", "cd-sheet-close");
      close.title = "Close";
      close.appendChild(icon("close"));
      close.addEventListener("click", closeSheet);
      list.appendChild(close);
    }
  }

  function buildActions(meta, library) {
    const actions = h("div", "cd-actions");
    const isSeries = meta.type !== "movie" && (meta.videos || []).length > 0;
    const up = isSeries ? nextUp(meta, library) : null;
    const resumeMovie = !isSeries && library && library.state && library.state.timeOffset > 0;
    const watch = h("button", "cd-watch");
    watch.appendChild(icon("play"));
    watch.appendChild(h("span", null, up ? up.label : resumeMovie ? "Resume" : "Watch Now"));
    watch.addEventListener("click", () => {
      if (up) go(up.video.deepLinks && up.video.deepLinks.metaDetailsStreams);
      else {
        const r = route();
        if (r && !r.videoId) location.hash = "/detail/" + r.type + "/" + encodeURIComponent(r.id) + "/" + encodeURIComponent(r.id);
        setSheet(true);
      }
    });
    actions.appendChild(watch);

    let inList = !!(meta.inLibrary || library);
    const listButton = h("button", "cd-round cd-list");
    const renderList = () => {
      listButton.replaceChildren(icon(inList ? "check" : "plus"));
      listButton.title = inList ? "Remove from Library" : "Add to Library";
      listButton.classList.toggle("on", inList);
    };
    listButton.addEventListener("click", () => {
      const ok = inList ? coreAction("RemoveFromLibrary", meta.id) : coreAction("AddToLibrary", metaPreview(meta));
      if (ok) { inList = !inList; renderList(); }
    });
    renderList();
    if (window.core) actions.appendChild(listButton);
    return actions;
  }

  function buildHero(meta, library) {
    const hero = h("section", "cd-hero");
    const media = h("div", "cd-media");
    const backdrop = h("img", "cd-backdrop");
    backdrop.alt = "";
    backdrop.src = String(meta.background || meta.poster || "").replace("/background/medium/", "/background/large/");
    backdrop.addEventListener("error", () => { if (meta.poster && backdrop.src !== meta.poster) backdrop.src = meta.poster; });
    media.appendChild(backdrop);
    hero.appendChild(media);
    hero.appendChild(h("div", "cd-shade"));

    const content = h("div", "cd-content");
    const left = h("div", "cd-left");
    if (meta.logo) {
      const logo = h("img", "cd-logo");
      logo.alt = meta.name;
      logo.src = meta.logo;
      logo.addEventListener("error", () => logo.replaceWith(h("h1", "cd-title", meta.name)));
      left.appendChild(logo);
    } else left.appendChild(h("h1", "cd-title", meta.name));

    left.appendChild(buildActions(meta, library));

    const isSeries = meta.type !== "movie" && (meta.videos || []).length > 0;
    const right = h("div", "cd-right");
    const facts = h("div", "cd-facts");
    const seasons = new Set((meta.videos || []).map((v) => v.season).filter(Boolean)).size;
    const imdb = linksOf(meta, "imdb")[0] || meta.imdbRating;
    [
      meta.runtime,
      meta.type === "movie" ? formatDate(meta.released, true) || meta.releaseInfo : meta.releaseInfo,
      linksOf(meta, "Genres").concat(meta.genres || []).slice(0, 2).join(" · ") || null,
      isSeries && seasons ? seasons + (seasons === 1 ? " Season" : " Seasons") : null,
      imdb ? "IMDb " + imdb : null,
    ].filter(Boolean).forEach((t) => facts.appendChild(h("span", null, t)));
    right.appendChild(facts);
    if (meta.description) right.appendChild(h("p", "cd-description", meta.description));
    const cast = linksOf(meta, "Cast").concat(meta.cast || []);
    if (cast.length) {
      const line = h("p", "cd-cast");
      line.append(h("b", null, "Cast: "), document.createTextNode(Array.from(new Set(cast)).slice(0, 5).join(", ")));
      right.appendChild(line);
    }

    content.append(left, right);
    hero.appendChild(content);

    // Trailer: muted by default, sound remembered
    const ytId = (meta.trailerStreams || []).map((t) => t.ytId).filter(Boolean)[0] || (meta.trailers || []).map((t) => t.source).filter(Boolean)[0];
    if (ytId && !reducedMotion.matches) {
      const mute = h("button", "cd-round cd-mute");
      let muted = !soundOn();
      const renderMute = () => { mute.replaceChildren(icon(muted ? "muted" : "sound")); mute.title = muted ? "Unmute trailer" : "Mute trailer"; };
      renderMute();
      mute.addEventListener("click", () => {
        muted = !muted;
        try { localStorage.setItem(SOUND_KEY, muted ? "off" : "on"); } catch (e) {}
        if (trailer) trailer.setMuted(muted);
        renderMute();
      });

      trailer = createTrailer(ytId, () => {
        if (!muted) trailer.setMuted(false);
        // Wait out YouTube's title overlay and start-up play symbol before
        // revealing the video
        setTimeout(() => { hero.classList.add("cd-playing"); hero.appendChild(mute); }, 2200);
      }, () => hero.classList.remove("cd-playing"), (held) => hero.classList.toggle("cd-held", held));
      media.appendChild(trailer.el);

      // Pause while scrolled away from the hero
      heroObserver = new IntersectionObserver((entries) => {
        if (!trailer) return;
        const visible = entries[0].intersectionRatio > 0.35;
        const c = container();
        if (visible && !(c && c.classList.contains("cd-sheet"))) trailer.play(); else trailer.pause();
      }, { threshold: [0, 0.35, 1] });
      heroObserver.observe(hero);
    }
    return hero;
  }

  function buildEpisodes(meta) {
    const episodes = sortedEpisodes(meta);
    if (meta.type === "movie" || !episodes.length) return null;
    const section = h("section", "cd-section cd-episodes");
    const head = h("div", "cd-section-head");
    head.appendChild(h("h2", null, "Episodes"));
    const tabs = h("div", "cd-seasons");
    head.appendChild(tabs);
    section.appendChild(head);

    const railWrap = h("div", "cd-rail-wrap");
    const rail = h("div", "cd-rail");
    const prev = h("button", "cd-round cd-arrow cd-prev");
    const next = h("button", "cd-round cd-arrow cd-next");
    prev.appendChild(icon("left"));
    next.appendChild(icon("right"));
    prev.addEventListener("click", () => rail.scrollBy({ left: -rail.clientWidth * 0.85, behavior: "smooth" }));
    next.addEventListener("click", () => rail.scrollBy({ left: rail.clientWidth * 0.85, behavior: "smooth" }));
    const updateArrows = () => {
      prev.classList.toggle("hidden", rail.scrollLeft < 8);
      next.classList.toggle("hidden", rail.scrollLeft + rail.clientWidth > rail.scrollWidth - 8);
    };
    rail.addEventListener("scroll", updateArrows, { passive: true });
    railWrap.append(rail, prev, next);
    section.appendChild(railWrap);

    const seasons = Array.from(new Set(episodes.map((v) => v.season || 0)));
    const up = nextUp(meta, null);
    let current = up && up.video ? up.video.season || 0 : seasons[0];

    function card(v) {
      const c = h("button", "cd-card");
      if (!released(v)) c.classList.add("upcoming");
      if (v.watched) c.classList.add("watched");
      const thumb = h("div", "cd-thumb");
      const img = h("img");
      img.alt = "";
      img.loading = "lazy";
      img.src = v.thumbnail || meta.background || "";
      img.addEventListener("error", () => { if (meta.background && img.src !== meta.background) img.src = meta.background; });
      thumb.appendChild(img);
      if (v.watched) { const badge = h("span", "cd-badge"); badge.appendChild(icon("check")); thumb.appendChild(badge); }
      const p = progressOf(v);
      if (p > 0 && !v.watched) { const bar = h("span", "cd-progress"); bar.style.setProperty("--p", (p * 100).toFixed(1) + "%"); thumb.appendChild(bar); }
      thumb.appendChild(icon("play"));
      c.appendChild(thumb);
      c.appendChild(h("div", "cd-card-kicker", episodeLabel(v) + (v.released ? " · " + (released(v) ? formatDate(v.released, true) : "Coming " + formatDate(v.released, true)) : "")));
      c.appendChild(h("div", "cd-card-title", v.title || v.name || "Episode " + v.episode));
      if (v.overview || v.description) c.appendChild(h("div", "cd-card-text", v.overview || v.description));
      c.addEventListener("click", () => go(v.deepLinks && v.deepLinks.metaDetailsStreams ? v.deepLinks.metaDetailsStreams
        : "#/detail/" + meta.type + "/" + encodeURIComponent(meta.id) + "/" + encodeURIComponent(v.id)));
      return c;
    }

    function show(season) {
      current = season;
      tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("on", Number(b.dataset.season) === season));
      rail.replaceChildren(...episodes.filter((v) => (v.season || 0) === season).map(card));
      rail.scrollLeft = 0;
      // Start at the episode Watch Now points to
      if (up && up.video && (up.video.season || 0) === season) {
        const i = episodes.filter((v) => (v.season || 0) === season).indexOf(up.video);
        const target = rail.children[i];
        if (target) rail.scrollLeft = Math.max(0, target.offsetLeft - 4);
      }
      requestAnimationFrame(updateArrows);
    }

    seasons.forEach((s) => {
      const b = h("button", "cd-season", s ? "Season " + s : "Specials");
      b.dataset.season = s;
      b.addEventListener("click", () => show(s));
      tabs.appendChild(b);
    });
    if (seasons.length < 2) tabs.classList.add("single");
    show(current);
    return section;
  }

  function buildAbout(meta) {
    const rows = [
      ["Genres", linksOf(meta, "Genres").concat(meta.genres || [])],
      ["Starring", linksOf(meta, "Cast").concat(meta.cast || [])],
      [meta.type === "movie" ? "Directed by" : "Created by", linksOf(meta, "Directors").concat(meta.director || [])],
      ["Written by", linksOf(meta, "Writers").concat(meta.writer || [])],
    ].map(([label, list]) => [label, Array.from(new Set(list))]).filter(([, list]) => list.length);
    if (!rows.length) return null;
    const section = h("section", "cd-section cd-about");
    section.appendChild(h("h2", null, "About"));
    const grid = h("div", "cd-about-grid");
    rows.forEach(([label, list]) => {
      const row = h("div", "cd-about-row");
      row.append(h("div", "cd-about-label", label), h("div", "cd-about-value", list.slice(0, 8).join(", ")));
      grid.appendChild(row);
    });
    section.appendChild(grid);
    return section;
  }

  // Same title, different route (an episode opened or closed): keep the hero
  // and its trailer, refresh what depends on watch progress
  function refresh(r) {
    const token = ++renderToken;
    syncSheet();
    if (r.videoId && r.type !== "movie") return;
    loadDetails(r).then((data) => {
      if (token !== renderToken || !data || !root) return;
      const actions = root.querySelector(".cd-actions");
      if (actions) actions.replaceWith(buildActions(data.meta, data.library));
      const episodes = root.querySelector(".cd-episodes");
      const fresh = buildEpisodes(data.meta);
      if (episodes && fresh) episodes.replaceWith(fresh);
    });
  }

  function render(r) {
    const key = r.type + "/" + r.id;
    const token = ++renderToken;
    loadDetails(r).then((data) => {
      const c = container();
      if (token !== renderToken || !data || !c) return;
      const scroll = root ? root.scrollTop : 0;
      if (trailer) { trailer.destroy(); trailer = null; }
      if (heroObserver) { heroObserver.disconnect(); heroObserver = null; }
      if (root) root.remove();

      root = h("div", "cd-root");
      const hero = buildHero(data.meta, data.library);
      root.appendChild(hero);
      [buildEpisodes(data.meta), buildAbout(data.meta)].filter(Boolean).forEach((s) => root.appendChild(s));
      c.prepend(root);
      c.classList.add("cd-on");
      if (shown === key) root.scrollTop = scroll;
      shown = key;
      syncSheet();
    });
  }

  function syncSheet() {
    const r = route();
    const c = container();
    if (!r || !c) return;
    ensureSheetChrome(c);
    // Movies always carry their id as the video id, so only a real episode
    // route (or Watch Now) opens the stream list
    const episodeRoute = r.type !== "movie" && !!r.videoId;
    if (episodeRoute) setSheet(true);
    else if (r.type !== "movie") setSheet(false);
  }

  let lastHash = null;
  function check() {
    const r = route();
    if (!r) { if (root) teardown(); lastHash = location.hash; return; }
    const c = container();
    if (!c) return;
    const key = r.type + "/" + r.id;
    // Stremio rebuilt its page: move our layer back in (or render afresh)
    if (root && !c.contains(root)) {
      c.prepend(root);
      c.classList.add("cd-on");
    }
    if (shown !== key && !root) { render(r); lastHash = location.hash; return; }
    if (shown !== key) { teardown(); render(r); lastHash = location.hash; return; }
    if (location.hash !== lastHash) {
      lastHash = location.hash;
      refresh(r);
    }
    ensureSheetChrome(c);
  }

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; check(); });
  });
  observer.observe(document.body, { childList: true, subtree: true });

  function onKey(e) {
    const c = container();
    if (e.key === "Escape" && c && c.classList.contains("cd-sheet")) { e.stopPropagation(); closeSheet(); }
  }
  function onVisibility() {
    if (!trailer) return;
    if (document.hidden) trailer.pause(); else if (!(container() && container().classList.contains("cd-sheet"))) trailer.play();
  }
  window.addEventListener("hashchange", check);
  window.addEventListener("keydown", onKey, true);
  document.addEventListener("visibilitychange", onVisibility);

  // ── Styles (themes restyle these; see the Modern Glass theme) ─────────────
  const style = document.createElement("style");
  style.id = "cinematic-details-style";
  style.textContent = `
    .cd-on {
      --cd-bg: var(--background, #0c0b11);
      --cd-text: #fff;
      --cd-muted: rgba(255, 255, 255, 0.68);
      --cd-accent: #0064ff;
      --cd-accent-text: #fff;
      --cd-surface: rgba(255, 255, 255, 0.1);
      --cd-surface-hover: rgba(255, 255, 255, 0.18);
      --cd-radius: 10px;
      --cd-gutter: clamp(24px, 4vw, 64px);
    }
    .cd-on > [class*="background-image-layer"],
    .cd-on [class*="metadetails-content"] > [class*="meta-preview"],
    .cd-on [class*="metadetails-content"] > [class*="spacing"],
    .cd-on [class*="metadetails-content"] > [class*="videos-list"] { display: none !important; }
    .cd-on [class*="metadetails-content"] { position: static !important; z-index: 5 !important; pointer-events: none; }
    .cd-on > nav { position: relative; z-index: 3; background: none !important; }

    .cd-root { position: absolute; inset: 0; z-index: 1; overflow-y: auto; overflow-x: hidden; background: var(--cd-bg); color: var(--cd-text); scrollbar-width: none; }
    .cd-root::-webkit-scrollbar { display: none; }
    .cd-root button { font: inherit; color: inherit; border: 0; background: none; padding: 0; cursor: pointer; }
    .cd-icon { display: inline-grid; place-items: center; width: 22px; height: 22px; flex: none; }
    .cd-icon svg { width: 100%; height: 100%; }

    .cd-hero { position: relative; height: max(520px, calc(100vh - 110px)); overflow: hidden; }
    .cd-media { position: absolute; inset: 0; background: #000; }
    .cd-backdrop, .cd-trailer { position: absolute; top: 50%; left: 50%; border: 0; transform: translate(-50%, -50%); }
    .cd-backdrop { width: 100%; height: 100%; object-fit: cover; transition: opacity .8s ease; }
    .cd-trailer { width: max(100%, 177.78vh); height: max(100%, 56.25vw); transform: translate(-50%, -50%) scale(1.18); opacity: 0; pointer-events: none; transition: opacity .8s ease; }
    .cd-playing .cd-trailer { opacity: 1; transition-delay: .5s; }
    .cd-playing .cd-backdrop { opacity: 0; transition-delay: .5s; }
    /* paused (scrolled away, stream list open): back to the still, hiding YouTube's pause symbol */
    .cd-playing.cd-held .cd-trailer { opacity: 0; transition-delay: 0s; }
    .cd-playing.cd-held .cd-backdrop { opacity: 1; transition-delay: 0s; }
    .cd-shade { position: absolute; inset: 0; pointer-events: none;
      /* bottom fade first (on top), so the hero ends exactly in the page colour */
      background:
        linear-gradient(0deg, var(--cd-bg) 0%, color-mix(in srgb, var(--cd-bg) 82%, transparent) 12%, color-mix(in srgb, var(--cd-bg) 45%, transparent) 30%, transparent 58%),
        linear-gradient(90deg, rgba(0,0,0,.72) 0%, rgba(0,0,0,.35) 38%, transparent 62%),
        linear-gradient(180deg, rgba(0,0,0,.45) 0%, transparent 18%); }

    .cd-content { position: absolute; left: var(--cd-gutter); right: var(--cd-gutter); bottom: clamp(28px, 6vh, 64px); display: grid; grid-template-columns: minmax(240px, 0.9fr) minmax(320px, 1.1fr); align-items: end; gap: clamp(24px, 4vw, 72px); }
    .cd-logo { display: block; max-width: min(100%, 440px); max-height: 150px; object-fit: contain; object-position: left bottom; margin-bottom: 22px; filter: drop-shadow(0 4px 24px rgba(0,0,0,.5)); }
    .cd-title { margin: 0 0 22px; font-size: clamp(34px, 4.4vw, 64px); line-height: 1.02; letter-spacing: -0.02em; font-weight: 800; text-shadow: 0 4px 24px rgba(0,0,0,.5); }
    .cd-actions { display: flex; align-items: center; gap: 14px; }
    .cd-root .cd-watch { display: inline-flex; align-items: center; gap: 10px; height: 52px; padding: 0 30px 0 24px; border-radius: var(--cd-radius); background: var(--cd-accent); color: var(--cd-accent-text); font-size: 16px; font-weight: 700; letter-spacing: .02em; text-transform: uppercase; box-shadow: 0 8px 28px rgba(0,0,0,.35); transition: transform .12s ease, filter .15s ease; }
    .cd-root .cd-watch:hover { filter: brightness(1.12); }
    .cd-root .cd-watch:active { transform: scale(.97); }
    .cd-root .cd-round { display: grid; place-items: center; width: 46px; height: 46px; border-radius: 50%; background: var(--cd-surface); transition: background .15s ease, transform .12s ease; }
    .cd-root .cd-round:hover { background: var(--cd-surface-hover); }
    .cd-root .cd-round:active { transform: scale(.94); }
    .cd-root .cd-list .cd-icon { width: 26px; height: 26px; }

    .cd-facts { display: flex; flex-wrap: wrap; gap: 6px 22px; margin-bottom: 12px; font-size: 13px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--cd-text); }
    .cd-description { margin: 0 0 12px; max-width: 64ch; font-size: clamp(16px, 1.35vw, 20px); line-height: 1.4; font-weight: 500; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; text-shadow: 0 2px 12px rgba(0,0,0,.6); }
    .cd-cast { margin: 0; font-size: 14px; color: var(--cd-muted); display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
    .cd-cast b { color: var(--cd-text); font-weight: 600; }
    .cd-root .cd-mute { position: absolute; right: var(--cd-gutter); top: 96px; width: 40px; height: 40px; background: rgba(0,0,0,.35); animation: cd-in .4s ease both; }

    .cd-section { position: relative; padding: 8px var(--cd-gutter) 36px; }
    .cd-section h2 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.01em; }
    .cd-section-head { display: flex; align-items: center; gap: 22px; margin-bottom: 16px; }
    .cd-seasons { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; }
    .cd-seasons.single { display: none; }
    .cd-root .cd-season { flex: none; height: 32px; padding: 0 14px; border-radius: 16px; font-size: 14px; font-weight: 600; color: var(--cd-muted); background: transparent; transition: background .15s ease, color .15s ease; }
    .cd-root .cd-season:hover { color: var(--cd-text); background: var(--cd-surface); }
    .cd-root .cd-season.on { color: var(--cd-bg); background: var(--cd-text); }

    .cd-rail-wrap { position: relative; margin: 0 calc(var(--cd-gutter) * -1); }
    .cd-rail { display: flex; gap: 18px; overflow-x: auto; padding: 4px var(--cd-gutter) 8px; scroll-snap-type: x proximity; scroll-padding: 0 var(--cd-gutter); scrollbar-width: none; }
    .cd-rail::-webkit-scrollbar { display: none; }
    .cd-root .cd-arrow { position: absolute; top: calc((min(320px, 26vw) * 9 / 16) / 2 - 19px); width: 38px; height: 38px; background: rgba(20,20,22,.78); opacity: 0; transition: opacity .2s ease, background .15s ease; }
    .cd-rail-wrap:hover .cd-arrow:not(.hidden) { opacity: 1; }
    .cd-root .cd-arrow.hidden { pointer-events: none; }
    .cd-prev { left: calc(var(--cd-gutter) - 19px); }
    .cd-next { right: calc(var(--cd-gutter) - 19px); }

    .cd-root .cd-card { flex: none; width: min(320px, 26vw); min-width: 220px; text-align: left; scroll-snap-align: start; }
    .cd-thumb { position: relative; aspect-ratio: 16 / 9; border-radius: var(--cd-radius); overflow: hidden; background: var(--cd-surface); margin-bottom: 10px; box-shadow: 0 0 0 0 transparent; transition: box-shadow .15s ease, transform .2s ease; }
    .cd-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .cd-thumb > .cd-icon { position: absolute; left: 50%; top: 50%; width: 46px; height: 46px; padding: 12px; margin: -23px 0 0 -23px; border-radius: 50%; background: rgba(0,0,0,.55); opacity: 0; transition: opacity .15s ease; }
    .cd-card:hover .cd-thumb { box-shadow: 0 0 0 3px var(--cd-text); }
    .cd-card:hover .cd-thumb > .cd-icon { opacity: 1; }
    .cd-card:active .cd-thumb { transform: scale(.98); }
    .cd-badge { position: absolute; top: 8px; right: 8px; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: rgba(0,0,0,.6); }
    .cd-badge .cd-icon { width: 14px; height: 14px; }
    .cd-progress { position: absolute; left: 0; right: 0; bottom: 0; height: 4px; background: rgba(255,255,255,.3); }
    .cd-progress::after { content: ""; position: absolute; inset: 0 auto 0 0; width: var(--p); background: var(--cd-accent); }
    .cd-card-kicker { font-size: 12px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--cd-muted); margin-bottom: 4px; }
    .cd-card-title { font-size: 15px; font-weight: 600; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cd-card-text { font-size: 13px; line-height: 1.4; color: var(--cd-muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .cd-card.upcoming { opacity: .55; }
    .cd-card.watched .cd-thumb img { filter: brightness(.75); }

    .cd-about h2 { margin-bottom: 14px; }
    .cd-about-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px 40px; max-width: 1100px; }
    .cd-about-label { font-size: 12px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--cd-muted); margin-bottom: 4px; }
    .cd-about-value { font-size: 14px; line-height: 1.45; }

    /* Stremio's stream list as a sheet over the page */
    .cd-on [class*="streams-list-container"] { position: fixed !important; z-index: 5; top: 12px; right: 12px; bottom: 12px; width: min(440px, calc(100vw - 24px)) !important; border-radius: 16px; background: rgba(22,22,24,.94) !important; box-shadow: 0 24px 80px rgba(0,0,0,.6); pointer-events: auto; transform: translateX(calc(100% + 24px)); visibility: hidden; transition: transform .38s cubic-bezier(.32,.72,0,1), visibility 0s linear .38s; }
    .cd-on.cd-sheet [class*="streams-list-container"] { transform: none; visibility: visible; transition: transform .38s cubic-bezier(.32,.72,0,1); }
    .cd-scrim { position: absolute; inset: 0; z-index: 4; background: rgba(0,0,0,.5); opacity: 0; pointer-events: none; transition: opacity .3s ease; }
    .cd-on.cd-sheet > .cd-scrim { opacity: 1; pointer-events: auto; }
    .cd-sheet-close { position: absolute; top: 12px; right: 12px; z-index: 2; display: grid; place-items: center; width: 30px; height: 30px; border: 0; border-radius: 50%; color: #fff; background: rgba(255,255,255,.12); cursor: pointer; }
    .cd-sheet-close:hover { background: rgba(255,255,255,.2); }
    .cd-sheet-close .cd-icon { width: 16px; height: 16px; }

    .cd-root button:focus-visible, .cd-sheet-close:focus-visible { outline: 2px solid rgba(255, 255, 255, 0.85); outline-offset: 3px; }
    .cd-root .cd-card:focus-visible { outline: none; }
    .cd-root .cd-card:focus-visible .cd-thumb { box-shadow: 0 0 0 3px var(--cd-text); }

    @keyframes cd-in { from { opacity: 0; } }
    @media (max-width: 900px) {
      .cd-content { grid-template-columns: 1fr; gap: 18px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .cd-root *, .cd-on [class*="streams-list-container"] { transition-duration: .01ms !important; animation: none !important; }
    }
  `;
  document.head.appendChild(style);

  window.__cinematicDetails = {
    destroy() {
      observer.disconnect();
      window.removeEventListener("hashchange", check);
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("visibilitychange", onVisibility);
      teardown();
      style.remove();
      delete window.__cinematicDetails;
    },
  };

  check();
})();
