(function () {
  const KEY = {
    pos: "tg.271.pos",
    mute: "tg.271.mute",
    font: "tg.271.font",
    theme: "tg.271.theme",
    sec: "tg.271.sec"
  };
  const SEC_MIN = 1;
  const SEC_MAX = 150;
  const FRAME_MAX_CHARS = 10;
  const FONT_STEPS = [32, 40, 48, 56, 64];
  const TAILS = ["けれども", "けれど", "ながら", "くらい", "ぐらい", "ばかり", "から", "まで", "より", "など", "だけ", "ほど", "って", "ので", "のに", "ては", "では", "には", "ても", "でも", "ます", "です", "た", "だ", "て", "で", "は", "が", "を", "に", "へ", "と", "も", "ね", "よ", "さ", "ぜ", "わ", "な", "か", "の", "や", "し", "ば"];

  let atoms = [];
  let shown = 0;
  let muted = false;
  let fontIndex = 1;
  let paused = false;
  let audioCtx = null;
  let resetArmed = false;
  let started = false;
  let sec = 20;
  let frameTimer = 0;

  const $ = (id) => document.getElementById(id);

  function isHira(ch) {
    const c = ch.charCodeAt(0);
    return c >= 0x3040 && c <= 0x309f;
  }
  function isKanji(ch) {
    const c = ch.charCodeAt(0);
    return (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf);
  }
  function isKata(ch) {
    const c = ch.charCodeAt(0);
    return c >= 0x30a0 && c <= 0x30ff && ch !== "ー";
  }

  function splitHira(s) {
    const out = [];
    let i = 0;
    while (i < s.length) {
      const rest = s.length - i;
      if (rest <= 14) {
        out.push(s.slice(i));
        break;
      }
      let best = -1;
      const limit = Math.min(14, rest - 4);
      for (let len = limit; len >= 5; len--) {
        const head = s.slice(i, i + len);
        for (let t = 0; t < TAILS.length; t++) {
          const tail = TAILS[t];
          if (head.endsWith(tail) && head.length > tail.length) {
            best = len;
            break;
          }
        }
        if (best > 0) break;
      }
      if (best < 0) best = Math.min(10, rest);
      if (rest - best < 4) best = rest;
      out.push(s.slice(i, i + best));
      i += best;
    }
    return out;
  }

  function baseString(s) {
    return String(s).replace(/｜([^《]*)《[^》]*》/g, "$1");
  }

  function indexMap(s) {
    const map = [];
    let i = 0;
    while (i < s.length) {
      if (s.charAt(i) === "｜") {
        const mid = s.indexOf("《", i);
        const end = s.indexOf("》", mid);
        for (let k = i + 1; k < mid; k++) map.push(k);
        i = end + 1;
        continue;
      }
      map.push(i);
      i += 1;
    }
    return map;
  }

  function rubySpans(s) {
    const spans = [];
    let base = 0;
    let i = 0;
    while (i < s.length) {
      if (s.charAt(i) === "｜") {
        const mid = s.indexOf("《", i);
        const start = base;
        base += mid - (i + 1);
        spans.push([start, base]);
        i = s.indexOf("》", mid) + 1;
        continue;
      }
      base += 1;
      i += 1;
    }
    return spans;
  }

  function snapCut(s, cut) {
    const spans = rubySpans(s);
    for (let i = 0; i < spans.length; i++) {
      if (cut > spans[i][0] && cut < spans[i][1]) return spans[i][1];
    }
    return cut;
  }

  function sliceMarked(s, map, a, b) {
    if (a >= b || !map.length) return "";
    let start = map[a];
    let end = b < map.length ? map[b] : s.length;
    if (start > 0 && s.charAt(start - 1) === "｜") start -= 1;
    if (end > 0 && s.charAt(end - 1) === "｜") end -= 1;
    return s.slice(start, end);
  }

  function splitBunsetsu(s) {
    const map = indexMap(s);
    const base = baseString(s);
    const cuts = [0];
    for (let i = 1; i < base.length; i++) {
      const prev = base.charAt(i - 1);
      const cur = base.charAt(i);
      if (isHira(prev) && (isKanji(cur) || isKata(cur))) cuts.push(i);
      if ("、。！？".indexOf(prev) >= 0 && "」』）".indexOf(cur) < 0) cuts.push(i);
    }
    cuts.push(base.length);
    const uniq = cuts.filter((n, i) => i === 0 || n !== cuts[i - 1]).sort((a, b) => a - b);
    const parts = [];
    for (let k = 0; k < uniq.length - 1; k++) {
      const pieceBase = base.slice(uniq[k], uniq[k + 1]);
      if (!pieceBase) continue;
      const longHira = pieceBase.length > 18 && Array.prototype.every.call(pieceBase, (ch) => {
        return isHira(ch) || "、。！？…「」『』（）ー—－・―".indexOf(ch) >= 0;
      });
      if (longHira) parts.push.apply(parts, splitHira(pieceBase));
      else parts.push(sliceMarked(s, map, uniq[k], uniq[k + 1]));
    }
    const merged = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!p) continue;
      const prev = merged[merged.length - 1];
      if (prev && (p.length === 1 && "」』）、。！？".indexOf(p) >= 0 || prev.endsWith("「") || prev.endsWith("『") || prev.endsWith("（"))) {
        merged[merged.length - 1] += p;
      } else if (prev && prev.length <= 2 && "「『（".indexOf(prev[0]) >= 0 && prev.length < 3) {
        merged[merged.length - 1] += p;
      } else {
        merged.push(p);
      }
    }
    return attachClosers(capUnits(merged.filter(Boolean)));
  }

  function capUnits(parts) {
    const out = [];
    for (let i = 0; i < parts.length; i++) {
      const map = indexMap(parts[i]);
      const base = baseString(parts[i]);
      let from = 0;
      while (base.length - from > FRAME_MAX_CHARS) {
        let cut = from + FRAME_MAX_CHARS;
        const win = base.slice(from, cut);
        for (let k = win.length - 1; k >= 1; k--) {
          if ("、。！？".indexOf(win.charAt(k)) >= 0) {
            cut = from + k + 1;
            break;
          }
        }
        if (cut <= from) cut = from + FRAME_MAX_CHARS;
        const snapped = snapCut(parts[i], cut);
        if (snapped > from + FRAME_MAX_CHARS) {
          const span = rubySpans(parts[i]).find(([a, b]) => a < cut && b > cut);
          cut = span && span[0] > from ? span[0] : snapped;
        } else {
          cut = snapped;
        }
        out.push(sliceMarked(parts[i], map, from, cut));
        from = cut;
      }
      if (from < base.length) out.push(sliceMarked(parts[i], map, from, base.length));
    }
    return out;
  }

  function attachClosers(parts) {
    const out = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const prev = out[out.length - 1];
      const plain = baseString(p);
      if (prev && plain.length === 1 && "」』）、。！？".indexOf(plain) >= 0 && baseString(prev).length < FRAME_MAX_CHARS) {
        out[out.length - 1] = prev + p;
      } else {
        out.push(p);
      }
    }
    return out;
  }

  function parseNovel(raw) {
    const lines = String(raw).replace(/\r\n/g, "\n").split("\n");
    const list = [];
    let para = 0;
    for (let n = 0; n < lines.length; n++) {
      const core = lines[n].replace(/^[\s\u3000]+|[\s\u3000]+$/g, "");
      if (!core || core === "二百十日" || core === "夏目漱石") continue;
      if (/^[一二三四五]$/.test(core)) {
        list.push({ type: "chapter", text: core });
        continue;
      }
      const dialog = core.charAt(0) === "「" || core.charAt(0) === "『";
      const parts = splitBunsetsu(core);
      for (let i = 0; i < parts.length; i++) {
        list.push({ type: "b", text: parts[i], para: para, lead: i === 0, dialog: dialog });
      }
      para += 1;
    }
    return list;
  }

  function readStore(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function writeStore(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }

  function unlock() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch (e) {
      audioCtx = null;
    }
  }

  function blip() {
    if (muted || !audioCtx) return;
    try {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = "sine";
      o.frequency.value = 660;
      const t = audioCtx.currentTime;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.03, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start(t);
      o.stop(t + 0.08);
    } catch (e) {}
  }

  function applyFont() {
    document.documentElement.style.setProperty("--fs", FONT_STEPS[fontIndex] + "px");
    const label = $("font-label");
    if (label) label.textContent = String(FONT_STEPS[fontIndex]);
  }

  function applyTheme() {
    const theme = readStore(KEY.theme) === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", theme);
    const btn = $("btn-theme");
    if (btn) btn.textContent = theme === "dark" ? "明るい画面" : "暗い画面";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#141311" : "#f3efe4");
  }

  function applyMute() {
    const btn = $("btn-mute");
    if (!btn) return;
    btn.textContent = muted ? "静" : "音";
    btn.setAttribute("aria-pressed", muted ? "true" : "false");
    btn.setAttribute("aria-label", muted ? "音を出す" : "音を消す");
    btn.classList.toggle("is-muted", muted);
  }

  function phraseAtOrAfter(index) {
    for (let i = Math.max(0, index); i < atoms.length; i++) {
      if (atoms[i].type === "b") return i;
    }
    return Math.max(0, atoms.length - 1);
  }

  function render() {
    const flow = $("flow");
    flow.replaceChildren();
    const i = shown - 1;
    if (i < 0 || i >= atoms.length || atoms[i].type !== "b") return;
    const p = document.createElement("p");
    p.className = "frame fresh";
    appendPhrase(p, atoms[i].text);
    flow.appendChild(p);
  }

  function appendPhrase(parent, s) {
    let i = 0;
    while (i < s.length) {
      if (s.charAt(i) === "｜") {
        const mid = s.indexOf("《", i);
        const end = s.indexOf("》", mid);
        const ruby = document.createElement("ruby");
        ruby.appendChild(document.createTextNode(s.slice(i + 1, mid)));
        const rt = document.createElement("rt");
        rt.textContent = s.slice(mid + 1, end);
        ruby.appendChild(rt);
        parent.appendChild(ruby);
        i = end + 1;
        continue;
      }
      const next = s.indexOf("｜", i);
      const end = next < 0 ? s.length : next;
      parent.appendChild(document.createTextNode(s.slice(i, end)));
      i = end;
    }
  }

  function currentChapter() {
    let name = "一";
    const end = Math.min(shown, atoms.length);
    for (let i = 0; i < end; i++) {
      if (atoms[i].type === "chapter") name = atoms[i].text;
    }
    return name;
  }

  function updateHud() {
    const total = Math.max(atoms.length, 1);
    const pct = Math.min(100, Math.round((shown / total) * 100));
    $("title-label").textContent = "二百十日　" + currentChapter();
    $("progress-label").textContent = pct < 1 ? String(shown) : pct + "%";
    $("meter-bar").style.width = pct + "%";
    let canPrev = false;
    for (let i = shown - 2; i >= 0; i--) {
      if (atoms[i] && atoms[i].type === "b") { canPrev = true; break; }
    }
    $("btn-prev").disabled = !canPrev;
    const atEnd = shown >= atoms.length && atoms.length > 0;
    $("btn-next").textContent = atEnd ? "おわり" : "次へ";
  }

  function persist() {
    writeStore(KEY.pos, String(shown));
  }

  function secText() {
    return (sec / 10).toFixed(1) + "秒";
  }

  function applySec() {
    $("sec-label").textContent = secText();
    $("sec-label-pause").textContent = secText();
    $("btn-sec-down").disabled = sec <= SEC_MIN;
    $("btn-sec-down-pause").disabled = sec <= SEC_MIN;
    $("btn-sec-up").disabled = sec >= SEC_MAX;
    $("btn-sec-up-pause").disabled = sec >= SEC_MAX;
  }

  function clearFrame() {
    if (!frameTimer) return;
    clearTimeout(frameTimer);
    frameTimer = 0;
  }

  function armFrame() {
    clearFrame();
    if (!started || paused || sec < SEC_MIN) return;
    if (!$("done").hidden || !$("cover").hidden || !$("pause").hidden) return;
    frameTimer = setTimeout(function () {
      frameTimer = 0;
      goNext(true);
    }, sec * 100);
  }

  function setSec(next) {
    sec = Math.max(SEC_MIN, Math.min(SEC_MAX, next));
    writeStore(KEY.sec, (sec / 10).toFixed(1));
    applySec();
    armFrame();
  }

  function goNext(fromTimer) {
    if (paused || !started) return;
    let i = shown;
    while (i < atoms.length && atoms[i].type !== "b") i += 1;
    if (i >= atoms.length) {
      clearFrame();
      $("done").hidden = false;
      return;
    }
    shown = i + 1;
    render();
    persist();
    updateHud();
    if (fromTimer !== true) blip();
    armFrame();
  }

  function goPrev() {
    if (paused || !started) return;
    let i = shown - 2;
    while (i >= 0 && atoms[i].type !== "b") i -= 1;
    if (i < 0) return;
    shown = i + 1;
    render();
    persist();
    updateHud();
    armFrame();
  }

  function jumpTo(index) {
    shown = phraseAtOrAfter(index) + 1;
    render();
    persist();
    updateHud();
    closePause();
  }

  function bindTap(el, handler) {
    if (!el) return;
    const release = () => el.classList.remove("is-pressed");
    el.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      el.classList.add("is-pressed");
      if (navigator.vibrate) navigator.vibrate(12);
      unlock();
      handler(e);
    });
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
  }

  function openPause() {
    paused = true;
    clearFrame();
    resetArmed = false;
    $("btn-reset").textContent = "はじめから";
    $("pause").hidden = false;
  }

  function closePause() {
    paused = false;
    resetArmed = false;
    $("btn-reset").textContent = "はじめから";
    $("pause").hidden = true;
    armFrame();
  }

  function startAt(pos) {
    started = true;
    $("cover").hidden = true;
    const index = phraseAtOrAfter(Math.max(0, Math.min(pos, atoms.length) - 1));
    shown = index + 1;
    render();
    persist();
    updateHud();
    armFrame();
  }

  function bootGuards() {
    let lastTouchEnd = 0;
    document.addEventListener("touchend", (e) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) e.preventDefault();
      lastTouchEnd = now;
    }, { passive: false });
    document.addEventListener("dblclick", (e) => e.preventDefault());
    document.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("gesturestart", (e) => e.preventDefault());
    document.addEventListener("selectstart", (e) => e.preventDefault());
    document.addEventListener("dragstart", (e) => e.preventDefault());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") {
        clearFrame();
        return;
      }
      if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
      armFrame();
    });
    window.addEventListener("error", () => {
      const fault = $("fault");
      if (!fault || atoms.length) return;
      fault.hidden = false;
      fault.textContent = "画面を開けませんでした。もう一度開いてください。";
    });
    document.addEventListener("touchmove", (e) => {
      if (e.target.closest("[data-scrollable]")) return;
      e.preventDefault();
    }, { passive: false });
  }

  function boot() {
    bootGuards();
    muted = readStore(KEY.mute) === "1";
    const savedFont = parseInt(readStore(KEY.font) || "1", 10);
    fontIndex = savedFont >= 0 && savedFont < FONT_STEPS.length ? savedFont : 1;
    applyFont();
    applyTheme();
    applyMute();
    const savedSec = parseFloat(readStore(KEY.sec) || "2");
    let tenths = Math.round(savedSec * 10);
    if (!isFinite(tenths)) tenths = 20;
    if (tenths < SEC_MIN) tenths = SEC_MIN;
    if (tenths > SEC_MAX) tenths = SEC_MAX;
    sec = tenths;
    applySec();

    const saved = parseInt(readStore(KEY.pos) || "0", 10);
    const resume = $("btn-resume");
    if (saved > 1) resume.hidden = false;

    bindTap($("btn-start"), () => startAt(1));
    bindTap(resume, () => startAt(saved));
    bindTap($("btn-next"), goNext);
    bindTap($("btn-prev"), goPrev);
    bindTap($("stage"), () => { if (!$("pause").hidden || !$("done").hidden || !$("cover").hidden) return; goNext(); });
    bindTap($("btn-pause"), openPause);
    bindTap($("btn-resume-read"), closePause);
    bindTap($("btn-mute"), () => {
      muted = !muted;
      writeStore(KEY.mute, muted ? "1" : "0");
      applyMute();
    });
    const slower = () => setSec(sec - 1);
    const faster = () => setSec(sec + 1);
    bindTap($("btn-sec-down"), slower);
    bindTap($("btn-sec-up"), faster);
    bindTap($("btn-sec-down-pause"), slower);
    bindTap($("btn-sec-up-pause"), faster);
    bindTap($("btn-font-down"), () => {
      fontIndex = Math.max(0, fontIndex - 1);
      writeStore(KEY.font, String(fontIndex));
      applyFont();
    });
    bindTap($("btn-font-up"), () => {
      fontIndex = Math.min(FONT_STEPS.length - 1, fontIndex + 1);
      writeStore(KEY.font, String(fontIndex));
      applyFont();
    });
    bindTap($("btn-theme"), () => {
      const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      writeStore(KEY.theme, next);
      applyTheme();
    });
    bindTap($("btn-reset"), () => {
      if (!resetArmed) {
        resetArmed = true;
        $("btn-reset").textContent = "もう一度で、はじめから";
        return;
      }
      closePause();
      startAt(1);
    });
    bindTap($("btn-done-close"), () => {
      $("done").hidden = true;
      armFrame();
    });
    bindTap($("btn-done-cover"), () => {
      $("done").hidden = true;
      started = false;
      clearFrame();
      $("cover").hidden = false;
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (!$("pause").hidden) closePause();
        else if (started && $("done").hidden) openPause();
        return;
      }
      if (!$("cover").hidden || !$("pause").hidden || !$("done").hidden) return;
      if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      }
    });

    window.addEventListener("pagehide", persist);

    fetch("novel.txt")
      .then((res) => {
        if (!res.ok) throw new Error("load");
        return res.text();
      })
      .then((text) => {
        atoms = parseNovel(text);
        if (!atoms.length) throw new Error("empty");
        $("btn-start").disabled = false;
        resume.disabled = false;
        const box = $("chapter-box");
        atoms.forEach((a, index) => {
          if (a.type !== "chapter") return;
          const b = document.createElement("button");
          b.type = "button";
          b.className = "game-btn";
          b.textContent = a.text;
          b.setAttribute("aria-label", "章 " + a.text);
          bindTap(b, () => {
            if (!started) startAt(1);
            jumpTo(index);
          });
          box.appendChild(b);
        });
      })
      .catch(() => {
        $("cover-note").textContent = "本文を開けませんでした。もう一度開いてください。";
      });
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { parseNovel: parseNovel, splitBunsetsu: splitBunsetsu };
  }
})();
