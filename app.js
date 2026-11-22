/* =====================================================================
   Pusteblume – Laden · PWA
   Daten: Firebase Cloud Firestore (mit Offline-Speicher)
   Anmeldung: Firebase Authentication (E-Mail + Passwort)
   ===================================================================== */
import { firebaseConfig } from "./firebase-config.js";

const FB_VERSION = "11.0.2";
const FB_URL = "https://www.gstatic.com/firebasejs/" + FB_VERSION + "/";
const configured = !!firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith("HIER");
let F = null, AUTH = null, fs = null, au = null, currentUser = null, started = false;

async function loadFirebase(){
  const [appMod, fsMod, authMod] = await Promise.all([
    import(FB_URL + "firebase-app.js"),
    import(FB_URL + "firebase-firestore.js"),
    import(FB_URL + "firebase-auth.js"),
  ]);
  fs = fsMod; au = authMod;
  const app = appMod.initializeApp(firebaseConfig);
  try {
    F = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
  } catch (e) {
    console.warn("Offline-Speicher nicht verfügbar", e);
    F = fs.getFirestore(app);
  }
  AUTH = au.getAuth(app);
  try { await au.setPersistence(AUTH, au.browserLocalPersistence); } catch (_) {}
}

/* Schreibzugriffe: Firestore bestätigt erst, wenn der Server antwortet.
   Offline würde das ewig dauern – deshalb gilt eine Buchung nach 1.5 s als
   «gespeichert» (sie liegt dann sicher im Offline-Speicher und wird später übertragen). */
function settle(p){
  let timedOut = false;
  p.catch(err => { if (timedOut){ console.error(err); toast("Nicht gespeichert" + errText(err)); } });
  return Promise.race([p, new Promise(r => setTimeout(() => { timedOut = true; r(undefined); }, 1500))]);
}
function fsRef(path){
  const r = fs.doc(F, path);
  return {
    id: r.id, path,
    set: d => settle(fs.setDoc(r, d)),
    update: d => settle(fs.updateDoc(r, d)),
    delete: () => settle(fs.deleteDoc(r)),
  };
}
function fsCol(path){
  return {
    path,
    doc: id => fsRef(id ? path + "/" + id : fs.doc(fs.collection(F, path)).path),
    onSnapshot: (next, error) => fs.onSnapshot(fs.collection(F, path), { includeMetadataChanges: true },
      s => next({ docs: s.docs.map(d => ({ id: d.id, data: () => d.data() })), size: s.size, metadata: s.metadata }),
      e => { console.error(e); if (error) error(e); }),
  };
}
const firestoreDb = () => ({ collection: fsCol, doc: fsRef });

/* ---------- Anmeldung ---------- */
function showNav(on){ document.getElementById("nav").style.display = on ? "" : "none"; }
function renderSetupMissing(){
  showNav(false);
  document.getElementById("app").innerHTML = `<div class="login"><h2>Noch nicht eingerichtet</h2>
    <p class="small">In der Datei <b>firebase-config.js</b> fehlen noch die Zugangsdaten deines Firebase-Projekts. Trag sie dort ein und lade die App neu hoch.</p></div>`;
}
function renderLogin(msg){
  showNav(false);
  document.getElementById("app").innerHTML = `<form class="login" id="loginForm" autocomplete="on">
    <h2>Anmelden</h2>
    <p class="small">Mit der E-Mail-Adresse und dem Passwort, die in Firebase für dich angelegt wurden.</p>
    <label>E-Mail</label><input class="f" id="lmail" type="email" autocomplete="username" required>
    <label>Passwort</label><input class="f" id="lpw" type="password" autocomplete="current-password" required>
    <div class="small" id="lmsg" style="margin-top:10px;color:var(--terra)">${msg ? esc(msg) : ""}</div>
    <button class="btn block" type="submit" style="margin-top:14px">Anmelden</button>
    <button class="btn sec block" type="button" id="lreset" style="margin-top:8px">Passwort vergessen?</button>
  </form>`;
  const form = document.getElementById("loginForm");
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Anmelden …";
    try { await au.signInWithEmailAndPassword(AUTH, form.lmail.value.trim(), form.lpw.value); }
    catch (err){
      const c = err && err.code || "";
      const t = /invalid-credential|wrong-password|user-not-found|invalid-email/.test(c) ? "E-Mail oder Passwort stimmt nicht."
        : /too-many-requests/.test(c) ? "Zu viele Versuche – bitte kurz warten."
        : /network/.test(c) ? "Keine Internetverbindung." : "Anmeldung fehlgeschlagen (" + c + ").";
      document.getElementById("lmsg").textContent = t; btn.disabled = false; btn.textContent = "Anmelden";
    }
  });
  document.getElementById("lreset").addEventListener("click", async () => {
    const mail = form.lmail.value.trim();
    if (!mail){ document.getElementById("lmsg").textContent = "Bitte zuerst die E-Mail-Adresse eingeben."; return; }
    try { await au.sendPasswordResetEmail(AUTH, mail); document.getElementById("lmsg").textContent = "E-Mail zum Zurücksetzen wurde verschickt."; }
    catch (err){ document.getElementById("lmsg").textContent = "Das hat nicht geklappt (" + (err.code||"") + ")."; }
  });
}
async function signOutNow(){ try { await au.signOut(AUTH); } catch (_) {} location.reload(); }

async function boot(){
  if (!configured){ renderSetupMissing(); return; }
  try { await loadFirebase(); }
  catch (e){
    console.error(e); showNav(false);
    document.getElementById("app").innerHTML = `<div class="login"><h2>Keine Verbindung</h2><p class="small">Die App konnte nicht starten. Bitte Internetverbindung prüfen und neu öffnen.</p><button class="btn block" onclick="location.reload()">Nochmals versuchen</button></div>`;
    return;
  }
  au.onAuthStateChanged(AUTH, user => {
    if (user){
      currentUser = user; showNav(true);
      if (!started){ started = true; init(); } else render();
    } else {
      currentUser = null;
      if (started){ location.reload(); return; }
      renderLogin();
    }
  });
}

/* ---------- Datei herunterladen / Import ---------- */
function downloadFile(name, text, type){
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
async function importData(data){
  const ops = [];
  for (const [id, d] of Object.entries(data.articles || {})) ops.push(["articles/" + id, d]);
  for (const m of (data.moves || [])){ const { id, ...rest } = m; if (id) ops.push(["moves/" + id, rest]); }
  for (const c of (data.closings || [])){ const { id, ...rest } = c; if (id) ops.push(["closings/" + id, rest]); }
  for (let i = 0; i < ops.length; i += 400){
    const b = fs.writeBatch(F);
    for (const [p, d] of ops.slice(i, i + 400)) b.set(fs.doc(F, p), d);
    await b.commit();
  }
  return ops.length;
}
function pickImportFile(){
  const inp = document.getElementById("importFile");
  inp.value = ""; inp.click();
}
function openPasteImport(){
  openSheet(`<h3>Daten einfügen</h3>
    <p class="small">Wenn die bisherige App «Daten kopiert» gemeldet hat: hier ins Feld tippen und <b>Einsetzen</b> wählen.</p>
    <textarea class="f" id="pasteData" rows="6" placeholder="Hier einsetzen …" style="font-size:12px;font-family:monospace"></textarea>
    <div class="actions"><button class="btn sec" id="cancel">Abbrechen</button><button class="btn" id="ok">Weiter</button></div>`, s => {
    s.querySelector("#cancel").onclick = closeSheet;
    s.querySelector("#ok").onclick = () => {
      let data; try { data = JSON.parse(s.querySelector("#pasteData").value.trim()); } catch (_){ toast("Das sind keine gültigen Daten – bitte nochmals kopieren."); return; }
      confirmImport(data);
    };
  });
}
document.addEventListener("change", async e => {
  if (e.target.id !== "importFile" || !e.target.files[0]) return;
  let data;
  try { data = JSON.parse(await e.target.files[0].text()); } catch (_){ toast("Die Datei ist keine gültige Datensicherung."); return; }
  confirmImport(data);
});
function confirmImport(data){
  if (!data || data.app !== "pusteblume-laden"){ toast("Das ist keine Pusteblume-Datensicherung."); return; }
  const na = Object.keys(data.articles || {}).length, nm = (data.moves || []).length, nc = (data.closings || []).length;
  const hasData = Object.keys(articles).length > 0;
  openSheet(`<h3>Daten importieren</h3>
    <div style="margin-top:6px">Sicherung vom <b>${esc(new Date(data.exportedAt).toLocaleString("de-CH",{dateStyle:"medium",timeStyle:"short"}))}</b>:</div>
    <div class="small" style="margin-top:4px">${na} Artikel · ${nm} Buchungen · ${nc} Abschlüsse</div>
    ${hasData ? '<div class="banner" style="margin-top:10px">In der App sind bereits Daten. Einträge aus der Sicherung werden ergänzt bzw. mit dem Stand der Sicherung überschrieben.</div>' : ""}
    <div class="actions"><button class="btn sec" id="cancel">Abbrechen</button><button class="btn" id="ok">Importieren</button></div>`, s => {
    s.querySelector("#cancel").onclick = closeSheet;
    s.querySelector("#ok").onclick = async () => {
      if (!navigator.onLine) return toast("Für den Import braucht es Internet.");
      const b = s.querySelector("#ok"); b.disabled = true; b.textContent = "Importiere …";
      try { const n = await importData(data); closeSheet(); toast(`${n} Einträge importiert`); }
      catch (err){ console.error(err); b.disabled = false; b.textContent = "Importieren"; toast("Import fehlgeschlagen" + errText(err)); }
    };
  });
}

/* ---------- Updates (Service Worker) ---------- */
function showUpdateBanner(reg){
  const el = document.getElementById("updateBar"); if (!el) return;
  el.classList.add("show");
  el.onclick = () => { if (reg.waiting) reg.waiting.postMessage("SKIP_WAITING"); el.textContent = "Wird aktualisiert …"; };
}
if ("serviceWorker" in navigator){
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").then(reg => {
      if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg);
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (nw) nw.addEventListener("statechange", () => { if (nw.state === "installed" && navigator.serviceWorker.controller) showUpdateBanner(reg); });
      });
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
      setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
    }).catch(err => console.warn("Service Worker", err));
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (refreshing) return; refreshing = true; location.reload(); });
  });
}
window.addEventListener("online", () => { if (started) render(); });
window.addEventListener("offline", () => { if (started) render(); });


/* ---------- Helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num = v => { if (v === "" || v == null) return null; const n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : null; };
const chf = v => v == null ? "–" : "CHF " + v.toLocaleString("de-CH", {minimumFractionDigits:2, maximumFractionDigits:2});
const fmt2 = v => v == null ? "" : v.toLocaleString("de-CH", {minimumFractionDigits:2, maximumFractionDigits:2});
function isoWeek(d){
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear(); const ys = new Date(Date.UTC(y,0,1));
  return {y, w: Math.ceil(((t - ys)/86400000 + 1)/7)};
}
const todayStr = () => { const d = new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); };
const dayLabel = d => d.toLocaleDateString("de-CH", {weekday:"long", day:"numeric", month:"long"});
const timeLabel = d => d.toLocaleTimeString("de-CH", {hour:"2-digit", minute:"2-digit"});
const dtLabel = d => d.toLocaleString("de-CH", {weekday:"short", day:"numeric", month:"short", hour:"2-digit", minute:"2-digit"});
const CATS = ["Baby & Kinder","Taschen & Textil","Papeterie","Deko & Geschenke"];
/* Artikelgruppen: Artikel ohne Eintrag gehören zur ersten Gruppe (Manu). */
const GROUPS = ["Manu","Marlies","Esther"];
const groupOf = a => (a && GROUPS.includes(a.group)) ? a.group : GROUPS[0];
const grpBadge = a => `<span class="badge b-grp g-${groupOf(a).toLowerCase()}">${esc(groupOf(a))}</span>`;
const TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>';
const LOC = {home:"Zuhause", shop:"Laden", gift:"Geschenksets"};
const LOCS = ["home","shop","gift"];
function trPath(m){ if (m.from && m.to) return [m.from, m.to]; return (m.q||0) > 0 ? ["home","shop"] : ["shop","home"]; }

/* Move types:
   in    Lieferung, immer ins Lager Zuhause (q > 0)
   tr    Umbuchung: q > 0 = Zuhause → Laden, q < 0 = Laden → Zuhause
   sale  Verkauf aus dem Laden (q < 0)
   inv   Inventur-Korrektur an einem Lager (loc)
   start Startbestand an einem Lager (loc, Standard Laden) */
function moveLabel(m){
  if (m.t === "tr"){ const [f,t] = trPath(m); return LOC[f] + " → " + LOC[t]; }
  if (m.t === "sale") return locOf(m) === "home" ? "Ausserord. Verkauf" : locOf(m) === "gift" ? "Verkauf Geschenkset" : "Verkauf";
  if (m.t === "in") return "Lieferung";
  if (m.t === "inv") return "Inventur " + LOC[locOf(m)];
  if (m.t === "start") return "Start " + LOC[locOf(m)];
  return m.t;
}
function locOf(m){ return m.loc || (m.t === "in" ? "home" : "shop"); }

/* ---------- State ---------- */
let db = null;
let articles = {};
let moves = [];
let closings = [];
let home = {}, shop = {}, gift = {}, lastSale = {};
const stockAt = loc => loc === "home" ? home : loc === "gift" ? gift : shop;
let loaded = {a:false, m:false, c:false};
let status = "loading";
let readOnly = false;
let tab = "verkauf";
const ui = { saleMode:"laden", payFilter:"offen", q:"", cat:"Alle", lagerMode:"umbuchen", grp:"Alle", stockFilter:"alle", period:"woche", logFilter:"alle", lq:"" };

function recompute(){
  home = {}; shop = {}; gift = {}; lastSale = {};
  for (const id in articles){ home[id] = 0; shop[id] = 0; gift[id] = 0; }
  for (const m of moves){
    const q = m.q || 0;
    if (m.t === "tr"){ const [f,t] = trPath(m), n = Math.abs(q); const F = stockAt(f), T = stockAt(t); F[m.a] = (F[m.a]||0) - n; T[m.a] = (T[m.a]||0) + n; continue; }
    const tgt = stockAt(locOf(m));
    tgt[m.a] = (tgt[m.a]||0) + q;
    if (m.t === "sale"){ const d = new Date(m.d); if (!lastSale[m.a] || d > lastSale[m.a]) lastSale[m.a] = d; }
  }
}
const total = id => (home[id]||0) + (shop[id]||0) + (gift[id]||0);
const label = a => a.variant ? a.name + " · " + a.variant : a.name;
function allArticles(){
  return Object.entries(articles).filter(([,a]) => a.active !== false)
    .map(([id,a]) => ({id, ...a})).sort((x,y) => (x.order ?? 999) - (y.order ?? 999) || label(x).localeCompare(label(y), "de"));
}
function matches(a, q){
  if (!q) return true;
  const hay = (label(a) + " " + (a.supplier||"") + " " + (a.cat||"")).toLowerCase();
  return q.toLowerCase().split(/\s+/).every(w => hay.includes(w));
}
function groupBy(list){
  const g = new Map();
  for (const a of list){ if (!g.has(a.name)) g.set(a.name, []); g.get(a.name).push(a); }
  return [...g.entries()];
}
const isGrouped = items => items.length > 1 || !!items[0].variant;
const rowTitle = (a, items) => isGrouped(items) ? (a.variant || "Standard") : a.name;
function shopBadge(a){
  const s = shop[a.id] || 0;
  if (s <= 0) return '<span class="badge b-out">' + ((home[a.id]||0) > 0 ? "im Laden leer" : "leer") + '</span>';
  if (s <= (a.min ?? 2)) return '<span class="badge b-low">knapp</span>';
  return "";
}
function lastClosing(){ return closings.reduce((mx, c) => !mx || c.d > mx.d ? c : mx, null); }
function salesSince(sinceIso, untilIso){
  return moves.filter(m => m.t === "sale" && locOf(m) !== "home" && (!sinceIso || m.d > sinceIso) && (!untilIso || m.d <= untilIso));
}
const saleAmount = m => -m.q * (m.p||0);
function paidBox(m){
  return `<label class="paid ${m.paid?"on":""}"><input type="checkbox" data-paid="${m.id}" ${m.paid?"checked":""} ${readOnly?"disabled":""}><span>${m.paid?"erhalten":"offen"}</span></label>`;
}
function openSum(list){ return list.filter(m => m.t === "sale" && !m.paid).reduce((s,m) => s + saleAmount(m), 0); }
function sumSales(list){
  let pcs = 0, rev = 0, cost = 0; const items = {};
  for (const m of list){ const n = -m.q; pcs += n; rev += n*(m.p||0); cost += n*(m.ek||0); items[m.a] = items[m.a] || {pcs:0, rev:0}; items[m.a].pcs += n; items[m.a].rev += n*(m.p||0); }
  return {pcs, rev, cost, margin: rev - cost, items};
}

/* ---------- Render ---------- */
function render(){
  $("#kwLabel").textContent = "KW " + isoWeek(new Date()).w + " · " + new Date().toLocaleDateString("de-CH",{day:"numeric",month:"short"});
  document.querySelectorAll("nav button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  const app = $("#app");
  let top = "";
  if (!navigator.onLine) top = '<div class="banner">Offline – Buchungen werden auf dem Handy gespeichert und übertragen, sobald wieder Internet da ist.</div>';
  else if (status === "denied") top = '<div class="banner err">Kein Zugriff auf die Daten. Ist deine E-Mail-Adresse in den Firebase-Sicherheitsregeln eingetragen?</div>';
  else if (status === "slow") top = '<div class="banner">Die Daten sind noch nicht erreichbar. Prüfe die Internetverbindung – die App versucht es weiter.</div>';
  else if (status === "error") top = '<div class="banner err">Verbindung zur Datenbank unterbrochen. Bitte App neu öffnen.</div>';
  if (readOnly) top += '<div class="banner">Du hast keinen Bearbeitungszugriff. Bitte lass dich per E-Mail mit «Kann bearbeiten» einladen.</div>';
  if (!(loaded.a && loaded.m && loaded.c) && status !== "denied"){ app.innerHTML = top + '<div class="empty">Daten werden geladen …</div>'; return; }
  const views = {verkauf:viewVerkauf, lager:viewLager, artikel:viewArtikel, auswertung:viewAuswertung, verlauf:viewVerlauf};
  app.innerHTML = top + views[tab]();
  bindView();
}
function catChips(){
  return '<div class="chips">' + ["Alle", ...CATS].map(c => `<button class="chip ${ui.cat===c?"on":""}" data-cat="${esc(c)}">${esc(c)}</button>`).join("") + '</div>';
}
function searchBox(ph){ return `<div class="search"><input id="q" type="search" placeholder="${ph}" value="${esc(ui.q)}" autocomplete="off"></div>`; }
function filtered(){ return allArticles().filter(a => (ui.cat === "Alle" || a.cat === ui.cat) && matches(a, ui.q)); }

/* Verkauf: Laden / Ausserordentlich (Zuhause) / Zahlungen */
function viewVerkauf(){
  if (!Object.keys(articles).length) return `<div class="login" style="margin-top:12px"><h2>Willkommen</h2><p class="small">Noch keine Artikel vorhanden. Übernimm deine Daten aus der bisherigen App: dort unter <b>Auswertung → «Alle Daten sichern»</b> die Datei speichern und hier einlesen.</p><button class="btn block" data-import>Datensicherung einlesen (Datei)</button><button class="btn sec block" data-import-paste style="margin-top:8px">Kopierte Daten einfügen</button><button class="btn sec block" data-new style="margin-top:8px">Oder: ersten Artikel anlegen</button></div>`;
  const open = openSum(moves);
  let h = `<div class="seg" style="margin-top:4px">${[["laden","Laden"],["sets","Geschenksets"],["extra","Ausserord."],["zahlungen","Zahlungen"]].map(([k,l]) => `<button class="${ui.saleMode===k?"on":""}" data-smode="${k}">${l}${k==="zahlungen"&&open>0?' <span class="dot"></span>':""}</button>`).join("")}</div>`;
  if (ui.saleMode === "extra") return h + viewExtra();
  if (ui.saleMode === "zahlungen") return h + viewZahlungen();
  if (ui.saleMode === "sets") return h + viewLaden("gift");
  return h + viewLaden("shop");
}
function viewLaden(loc){
  const isGift = loc === "gift"; const S = stockAt(loc);
  const lc = lastClosing();
  const st = sumSales(salesSince(lc && lc.d));
  let h = `<div class="session">
      <div><div class="l">Seit ${lc ? "Abschluss " + esc(dtLabel(new Date(lc.d))) : "Beginn"}</div>
      <div class="v">${st.pcs} Stk. · ${chf(st.rev)}</div></div>
      <button class="btn terra" data-close ${readOnly?"disabled":""}>Beenden</button></div>`;
  let list = filtered();
  if (isGift){
    h += `<div class="small" style="margin:-2px 0 8px">Verkauf aus dem Lager «Artikel in Geschenksets» – zählt wie der Laden zum Abschluss.</div>`;
    list = list.filter(a => (gift[a.id]||0) > 0);
  }
  h += searchBox(isGift ? "Artikel in Geschenksets suchen …" : "Artikel im Laden suchen …") + catChips();
  if (!list.length) return h + `<div class="empty">${isGift && !ui.q && ui.cat==="Alle" ? "Im Lager Geschenksets ist nichts gebucht. Ware kommt über Lager → Umbuchen dazu." : "Kein Artikel gefunden."}</div>`;
  for (const [name, items] of groupBy(list)){
    h += `<div class="group">${isGrouped(items) ? `<div class="ghead">${esc(name)}<span class="sub">${items[0].vk!=null?chf(items[0].vk):""}</span></div>` : ""}`;
    for (const a of items){
      const s = S[a.id] || 0; const noPrice = a.vk == null;
      h += `<div class="row" data-open-sale="${a.id}" data-loc="${loc}"><div class="main"><div class="name">${esc(rowTitle(a, items))}${isGift?"":shopBadge(a)}</div>
        <div class="meta">${grpBadge(a)}${noPrice?'<span class="badge b-warn" style="margin:0">Preis fehlt</span>':chf(a.vk)} · ${isGift?"in Geschenksets":"im Laden"} ${s}${!isGift&&(home[a.id]||0)>0?` · zuhause ${home[a.id]}`:""}${!isGift&&(gift[a.id]||0)>0?` · in Sets ${gift[a.id]}`:""}</div></div>
        <button class="quick ${isGift?"gs":""}" data-quick="${a.id}" data-loc="${loc}" ${(s<=0||noPrice||readOnly)?"disabled":""} aria-label="1 verkauft">−1</button></div>`;
    }
    h += `</div>`;
  }
  return h;
}

const saleCls = m => locOf(m) === "home" ? "xsale" : locOf(m) === "gift" ? "gsale" : "sale";
function saleLine(m, opts = {}){
  const a = articles[m.a]; const d = new Date(m.d);
  return `<div class="mv"><div class="main">${opts.tag?`<span class="tag t-${saleCls(m)}">${esc(moveLabel(m))}</span>`:""}<div class="name" style="font-weight:500">${-m.q}× ${esc(a?label(a):"(gelöschter Artikel)")}</div>
    <div class="small">${opts.date?esc(d.toLocaleDateString("de-CH",{day:"numeric",month:"short"}))+" · ":""}${timeLabel(d)} · <b>${chf(saleAmount(m))}</b>${m.note?" · "+esc(m.note):""}</div></div>${paidBox(m)}</div>`;
}
function viewExtra(){
  const xs = moves.filter(m => m.t === "sale" && locOf(m) === "home").sort((a,b) => b.d.localeCompare(a.d));
  const tot = xs.reduce((s,m) => s + saleAmount(m), 0), op = openSum(xs);
  let h = `<div class="small" style="margin:-2px 0 8px">Verkäufe direkt aus dem Lager Zuhause – zählen nicht zum Laden-Abschluss.</div>`;
  h += `<div class="kpis"><div class="kpi"><div class="l">Ausserordentlich total</div><div class="v">${chf(tot)}</div></div>
    <div class="kpi ${op>0?"warn":""}"><div class="l">Davon noch offen</div><div class="v">${chf(op)}</div></div></div>`;
  h += `<h2>Bisherige ausserordentliche Verkäufe</h2>`;
  h += xs.length ? xs.slice(0, 40).map(m => saleLine(m, {date:true})).join("") + (xs.length>40?`<div class="empty">… ${xs.length-40} ältere im Verlauf</div>`:"") : '<div class="group empty">Noch keine ausserordentlichen Verkäufe.</div>';
  h += `<h2>Neuer Verkauf aus Lager Zuhause</h2>` + searchBox("Artikel suchen …") + catChips();
  const list = filtered().filter(a => (home[a.id]||0) > 0);
  if (!list.length) return h + `<div class="empty">${ui.q||ui.cat!=="Alle" ? "Kein passender Artikel zuhause an Lager." : "Im Lager Zuhause ist gerade nichts gebucht. Ware kommt über Lager → Lieferung einbuchen dazu."}</div>`;
  for (const [name, items] of groupBy(list)){
    h += `<div class="group">${isGrouped(items) ? `<div class="ghead">${esc(name)}<span class="sub">${items[0].vk!=null?chf(items[0].vk):""}</span></div>` : ""}`;
    for (const a of items){
      const H = home[a.id]||0; const noPrice = a.vk == null;
      h += `<div class="row" data-open-xsale="${a.id}"><div class="main"><div class="name">${esc(rowTitle(a, items))}${H<=0?'<span class="badge b-out">zuhause leer</span>':""}</div>
        <div class="meta">${grpBadge(a)}${noPrice?'<span class="badge b-warn" style="margin:0">Preis fehlt</span>':chf(a.vk)} · zuhause ${H}</div></div>
        <button class="quick xs" data-open-xsale="${a.id}" ${(H<=0||readOnly)?"disabled":""} aria-label="Ausserordentlich verkaufen">−</button></div>`;
    }
    h += `</div>`;
  }
  return h;
}
function viewZahlungen(){
  const sales = moves.filter(m => m.t === "sale").sort((a,b) => b.d.localeCompare(a.d));
  const op = openSum(sales), opN = sales.filter(m => !m.paid).length;
  const recv = sales.filter(m => m.paid).reduce((s,m) => s + saleAmount(m), 0);
  let h = `<div class="kpis"><div class="kpi ${op>0?"warn":""}"><div class="l">Noch nicht erhalten</div><div class="v">${chf(op)}</div><div class="l">${opN} Verkäufe</div></div>
    <div class="kpi"><div class="l">Erhalten</div><div class="v">${chf(recv)}</div></div></div>`;
  h += '<div class="chips" style="margin-top:10px">' + [["offen","Offen"],["erhalten","Erhalten"],["alle","Alle"]].map(([k,l]) => `<button class="chip ${ui.payFilter===k?"on":""}" data-pf="${k}">${l}</button>`).join("") + '</div>';
  let list = sales;
  if (ui.payFilter === "offen") list = list.filter(m => !m.paid);
  if (ui.payFilter === "erhalten") list = list.filter(m => m.paid);
  if (!list.length) return h + `<div class="empty">${ui.payFilter==="offen"?"Alles erhalten – keine offenen Beträge.":"Keine Verkäufe."}</div>`;
  if (ui.payFilter === "offen" && !readOnly) h += `<button class="btn sec block" data-payall style="margin-bottom:10px">Alle ${list.length} offenen als erhalten markieren</button>`;
  let cur = "";
  for (const m of list.slice(0, 200)){
    const dl = dayLabel(new Date(m.d));
    if (dl !== cur){ const daySum = list.filter(x => dayLabel(new Date(x.d)) === dl).reduce((s,x) => s + saleAmount(x), 0); h += `<div class="day">${dl} <span style="float:right">${chf(daySum)}</span></div>`; cur = dl; }
    h += saleLine(m, {tag:true});
  }
  return h;
}

/* Lager: Umbuchen Zuhause <-> Laden, Lieferungen zuhause einbuchen, Übersicht */
function viewLager(){
  const all = allArticles();
  let hp=0, sp=0, gp=0, ekVal=0, vkVal=0;
  for (const a of all){ const H = Math.max(0,home[a.id]||0), S = Math.max(0,shop[a.id]||0), G = Math.max(0,gift[a.id]||0); hp += H; sp += S; gp += G; ekVal += (H+S+G)*(a.ek||0); vkVal += (H+S+G)*(a.vk||0); }
  let h = `<div class="kpis kpis3" style="margin-top:6px">
    <div class="kpi"><div class="l">Zuhause</div><div class="v">${hp}</div></div>
    <div class="kpi"><div class="l">Laden</div><div class="v">${sp}</div></div>
    <div class="kpi"><div class="l">Geschenksets</div><div class="v">${gp}</div></div></div>
    <div class="kpis" style="margin-top:8px">
    <div class="kpi"><div class="l">Warenwert Einkauf</div><div class="v">${chf(ekVal)}</div></div>
    <div class="kpi"><div class="l">Warenwert Verkauf</div><div class="v">${chf(vkVal)}</div></div></div>`;
  h += `<div class="seg">${[["umbuchen","Umbuchen"],["einbuchen","Lieferung einbuchen"]].map(([k,l]) => `<button class="${ui.lagerMode===k?"on":""}" data-lmode="${k}">${l}</button>`).join("")}</div>`;
  h += `<div class="small" style="margin:-2px 0 8px">${ui.lagerMode==="umbuchen" ? "Ware zwischen Zuhause, Laden und Geschenksets verschieben." : "Neue Ware kommt immer ins Lager Zuhause."}</div>`;
  h += searchBox("Artikel suchen …");
  if (ui.lagerMode === "umbuchen")
    h += '<div class="chips">' + [["alle","Alle"],["knapp","Im Laden knapp"],["zuhause","Zuhause vorrätig"],["sets","In Geschenksets"]].map(([k,l]) => `<button class="chip ${ui.stockFilter===k?"on":""}" data-sf="${k}">${l}</button>`).join("") + '</div>';
  h += catChips();
  let list = filtered();
  if (ui.lagerMode === "umbuchen"){
    if (ui.stockFilter === "knapp") list = list.filter(a => (shop[a.id]||0) <= (a.min ?? 2));
    if (ui.stockFilter === "zuhause") list = list.filter(a => (home[a.id]||0) > 0);
    if (ui.stockFilter === "sets") list = list.filter(a => (gift[a.id]||0) > 0);
  }
  if (!list.length) return h + '<div class="empty">Nichts in dieser Ansicht.</div>';
  for (const [name, items] of groupBy(list)){
    h += `<div class="group">${isGrouped(items) ? `<div class="ghead">${esc(name)}<span class="sub">${esc(items[0].supplier||"")}</span></div>` : ""}`;
    for (const a of items){
      const H = home[a.id]||0, S = shop[a.id]||0;
      if (ui.lagerMode === "umbuchen"){
        h += `<div class="row" data-open-tr="${a.id}"><div class="main"><div class="name">${esc(rowTitle(a, items))}</div><div class="meta">${grpBadge(a)}</div></div>
          <div class="locs"><span><small>Zuhause</small>${H}</span><span><small>Laden</small>${S}</span><span><small>Sets</small>${gift[a.id]||0}</span></div>
          <button class="quick in" data-open-tr="${a.id}" ${readOnly?"disabled":""} aria-label="Umbuchen">⇄</button></div>`;
      } else {
        h += `<div class="row" data-open-in="${a.id}"><div class="main"><div class="name">${esc(rowTitle(a, items))}</div>
          <div class="meta">${grpBadge(a)}EK ${chf(a.ek)} · zuhause ${H}${a.supplier && !isGrouped(items)?" · "+esc(a.supplier):""}</div></div>
          <button class="quick in" data-open-in="${a.id}" ${readOnly?"disabled":""} aria-label="Lieferung einbuchen">+</button></div>`;
      }
    }
    h += `</div>`;
  }
  h += `<div class="toolbar" style="margin-top:14px"><button class="btn sec" data-inv-all="home">Inventur Zuhause</button><button class="btn sec" data-inv-all="shop">Inventur Laden</button></div><button class="btn sec block" data-inv-all="gift" style="margin-top:8px">Inventur Geschenksets</button>`;
  return h;
}

/* Artikelverwaltung */
function viewArtikel(){
  const list = filtered().filter(a => ui.grp === "Alle" || groupOf(a) === ui.grp);
  let h = `<div class="toolbar"><button class="btn" data-new ${readOnly?"disabled":""}>+ Neuer Artikel</button></div>`;
  h += searchBox("Artikel suchen …");
  h += '<div class="chips">' + ["Alle", ...GROUPS].map(g => `<button class="chip ${ui.grp===g?"on":""}" data-grp="${esc(g)}">${g==="Alle"?"Alle Gruppen":esc(g)}</button>`).join("") + '</div>';
  h += catChips();
  h += `<div class="small" style="margin:0 0 8px">${list.length} von ${allArticles().length} Artikeln · antippen zum Bearbeiten oder Löschen</div>`;
  if (!list.length) return h + '<div class="empty">Kein Artikel gefunden.</div>';
  for (const [name, items] of groupBy(list)){
    h += `<div class="group">${isGrouped(items) ? `<div class="ghead">${esc(name)}<span class="sub">${esc(items[0].cat||"")}</span></div>` : ""}`;
    for (const a of items){
      const miss = [a.ek==null?"EK":null, a.vk==null?"VK":null].filter(Boolean);
      h += `<div class="row" data-open-art="${a.id}"><div class="main"><div class="name">${esc(rowTitle(a, items))}${miss.length?`<span class="badge b-warn">${miss.join(" + ")} fehlt</span>`:""}</div>
        <div class="meta">${grpBadge(a)}EK ${chf(a.ek)} · VK ${chf(a.vk)}${a.supplier?" · "+esc(a.supplier):""}</div></div>
        <div class="locs"><span><small>Total</small>${total(a.id)}</span></div><span class="chev">›</span></div>`;
    }
    h += `</div>`;
  }
  return h;
}

function periodRange(p){
  const now = new Date(); const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = (d0.getDay()+6)%7;
  if (p === "woche"){ const s = new Date(d0); s.setDate(s.getDate()-dow); return [s, null, "KW " + isoWeek(now).w]; }
  if (p === "vorwoche"){ const e = new Date(d0); e.setDate(e.getDate()-dow); const s = new Date(e); s.setDate(s.getDate()-7); return [s, e, "KW " + isoWeek(s).w]; }
  if (p === "monat"){ const s = new Date(now.getFullYear(), now.getMonth(), 1); return [s, null, s.toLocaleDateString("de-CH",{month:"long"})]; }
  if (p === "vormonat"){ const s = new Date(now.getFullYear(), now.getMonth()-1, 1); const e = new Date(now.getFullYear(), now.getMonth(), 1); return [s, e, s.toLocaleDateString("de-CH",{month:"long"})]; }
  if (p === "jahr"){ return [new Date(now.getFullYear(),0,1), null, String(now.getFullYear())]; }
  return [new Date(0), null, "Gesamt"];
}
function stats(list){
  const s = sumSales(list.filter(m => m.t === "sale"));
  let inCost = 0; for (const m of list) if (m.t === "in") inCost += m.q*(m.p||0);
  return {...s, inCost};
}
function viewAuswertung(){
  const [s, e, lbl] = periodRange(ui.period);
  const inP = moves.filter(m => { const d = new Date(m.d); return d >= s && (!e || d < e); });
  const st = stats(inP);
  let h = '<div class="chips" style="margin-top:6px">' + [["woche","Diese Woche"],["vorwoche","Letzte Woche"],["monat","Dieser Monat"],["vormonat","Letzter Monat"],["jahr","Dieses Jahr"],["alles","Gesamt"]].map(([k,l]) => `<button class="chip ${ui.period===k?"on":""}" data-period="${k}">${l}</button>`).join("") + '</div>';
  h += `<div class="kpis">
    <div class="kpi hl"><div class="l">Umsatz ${esc(lbl)}</div><div class="v">${chf(st.rev)}</div></div>
    <div class="kpi"><div class="l">Ertrag (Umsatz − EK)</div><div class="v">${chf(st.margin)}</div></div>
    <div class="kpi"><div class="l">Verkaufte Stück</div><div class="v">${st.pcs}</div></div>
    <div class="kpi"><div class="l">Eingekauft</div><div class="v">${chf(st.inCost)}</div></div></div>
    <div class="small" style="margin-top:8px">Davon ausserordentlich (Lager Zuhause): <b>${chf(inP.filter(m => m.t==="sale" && locOf(m)==="home").reduce((s,m)=>s+saleAmount(m),0))}</b> · Noch nicht erhalten: <b>${chf(openSum(inP))}</b></div>`;
  // Abschlüsse
  const cl = closings.slice().sort((a,b) => b.d.localeCompare(a.d)).slice(0, 12);
  h += `<h2>Abschlüsse</h2>`;
  h += cl.length ? `<div class="group"><table><tr><th>Beendet</th><th>Stk.</th><th>Umsatz</th></tr>` + cl.map(c => `<tr data-closing="${c.id}" style="cursor:pointer"><td>${esc(dtLabel(new Date(c.d)))}</td><td>${c.pcs}</td><td>${fmt2(c.rev)}</td></tr>`).join("") + `</table></div>` : '<div class="group empty">Noch kein Abschluss – im Verkauf auf «Beenden» tippen.</div>';
  const top = Object.entries(st.items).sort((a,b) => b[1].rev - a[1].rev).slice(0,8);
  h += `<h2>Bestseller</h2>`;
  h += top.length ? `<div class="group"><table><tr><th>Artikel</th><th>Stk.</th><th>Umsatz</th></tr>` + top.map(([id,v]) => `<tr><td>${esc(articles[id]?label(articles[id]):"(gelöschter Artikel)")}</td><td>${v.pcs}</td><td>${fmt2(v.rev)}</td></tr>`).join("") + `</table></div>` : '<div class="group empty">Noch keine Verkäufe in diesem Zeitraum.</div>';
  const now = new Date(); const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()); d0.setDate(d0.getDate() - (d0.getDay()+6)%7);
  h += `<h2>Pro Kalenderwoche</h2><div class="group"><table><tr><th>KW</th><th>Stk.</th><th>Umsatz</th><th>Ertrag</th><th>Einkauf</th></tr>`;
  for (let i=0;i<10;i++){
    const ws = new Date(d0); ws.setDate(ws.getDate()-7*i); const we = new Date(ws); we.setDate(we.getDate()+7);
    const w = stats(moves.filter(m => { const d = new Date(m.d); return d >= ws && d < we; }));
    h += `<tr><td>KW ${isoWeek(ws).w}</td><td>${w.pcs}</td><td>${fmt2(w.rev)}</td><td>${fmt2(w.margin)}</td><td>${fmt2(w.inCost)}</td></tr>`;
  }
  h += `</table></div>`;
  h += `<h2>Export</h2><div class="small" style="margin-bottom:8px">Für Excel oder die Buchhaltung (CSV, mit Semikolon getrennt).</div>
    <div class="toolbar"><button class="btn sec" data-export="bestand">Bestand</button><button class="btn sec" data-export="buchungen">Alle Buchungen</button></div>
    <h2>Daten &amp; Konto</h2>
    <div class="toolbar"><button class="btn sec" data-export="json">Sicherung herunterladen</button><button class="btn sec" data-import>Sicherung einlesen</button></div>
    <button class="btn sec block" data-import-paste style="margin-top:8px">Kopierte Daten einfügen</button>
    <div class="small" style="margin-top:10px">Angemeldet als <b>${esc(currentUser && currentUser.email || "")}</b></div>
    <button class="btn sec block" data-logout style="margin-top:8px">Abmelden</button>`;
  return h;
}

function viewVerlauf(){
  let list = moves.slice().sort((a,b) => b.d.localeCompare(a.d));
  if (ui.logFilter === "xsale") list = list.filter(m => m.t === "sale" && locOf(m) === "home");
  else if (ui.logFilter !== "alle") list = list.filter(m => m.t === ui.logFilter);
  if (ui.lq) list = list.filter(m => articles[m.a] && matches({id:m.a, ...articles[m.a]}, ui.lq));
  let h = `<div class="search"><input id="lq" type="search" placeholder="Nach Artikel filtern …" value="${esc(ui.lq)}"></div>`;
  h += '<div class="chips">' + [["alle","Alle"],["sale","Verkäufe"],["xsale","Ausserordentlich"],["tr","Umbuchungen"],["in","Lieferungen"],["inv","Inventur"],["start","Start"]].map(([k,l]) => `<button class="chip ${ui.logFilter===k?"on":""}" data-lf="${k}">${l}</button>`).join("") + '</div>';
  if (!list.length) return h + '<div class="empty">Noch keine Buchungen.</div>';
  let cur = "";
  for (const m of list.slice(0, 200)){
    const d = new Date(m.d); const dl = dayLabel(d);
    if (dl !== cur){ h += `<div class="day">${dl}</div>`; cur = dl; }
    const a = articles[m.a];
    const amt = m.t === "sale" ? chf(-m.q*(m.p||0)) : m.t === "in" ? "EK " + chf(m.q*(m.p||0)) + " · ins Lager Zuhause" : "";
    const shown = m.t === "tr" ? Math.abs(m.q) : m.q;
    const cls = m.t === "tr" ? "" : (m.q>0?"pos":"neg");
    h += `<div class="mv"><div class="main"><span class="tag t-${m.t==="sale"?saleCls(m):m.t}">${esc(moveLabel(m))}</span><div class="name" style="font-weight:500">${esc(a?label(a):"(gelöschter Artikel)")}</div><div class="small">${timeLabel(d)}${amt?" · "+amt:""}${m.note?" · "+esc(m.note):""}</div></div>
      <div class="stock ${cls}">${m.t!=="tr"&&m.q>0?"+":""}${shown}</div>${m.t==="sale"?paidBox(m):""}${readOnly?"":`<button class="x" data-del="${m.id}" aria-label="Buchung löschen">${TRASH}</button>`}</div>`;
  }
  if (list.length > 200) h += `<div class="empty">… ${list.length-200} ältere Buchungen (im Export enthalten)</div>`;
  return h;
}

/* ---------- Binding ---------- */
function bindView(){
  for (const [sel, key] of [["#q","q"],["#lq","lq"]]){
    const el = $(sel);
    if (el) el.addEventListener("input", e => { ui[key] = e.target.value; const pos = e.target.selectionStart; render(); const n = $(sel); n.focus(); try{ n.setSelectionRange(pos,pos); }catch(_){} });
  }
}
document.addEventListener("click", e => {
  if (e.target.closest("#sheet")) return;
  const t = e.target.closest("button, .row, tr[data-closing]");
  if (!t) return;
  const ds = t.dataset;
  if (ds.tab){ tab = ds.tab; ui.q = ""; render(); window.scrollTo(0,0); $("#screen").scrollTop = 0; return; }
  if (ds.cat){ ui.cat = ds.cat; render(); return; }
  if (ds.grp){ ui.grp = ds.grp; render(); return; }
  if (ds.sf){ ui.stockFilter = ds.sf; render(); return; }
  if (ds.smode){ ui.saleMode = ds.smode; ui.q = ""; render(); return; }
  if (ds.pf){ ui.payFilter = ds.pf; render(); return; }
  if (ds.payall !== undefined){ confirmPayAll(); return; }
  if (ds.openXsale){ openSale(ds.openXsale, "home"); return; }
  if (ds.lmode){ ui.lagerMode = ds.lmode; render(); return; }
  if (ds.period){ ui.period = ds.period; render(); return; }
  if (ds.lf){ ui.logFilter = ds.lf; render(); return; }
  if (ds.quick){ e.stopPropagation(); quickSale(ds.quick, ds.loc || "shop"); return; }
  if (ds.openSale){ openSale(ds.openSale, ds.loc || "shop"); return; }
  if (ds.openTr){ openTransfer(ds.openTr); return; }
  if (ds.openIn){ openDelivery(ds.openIn); return; }
  if (ds.openArt){ openArticle(ds.openArt); return; }
  if (ds.new !== undefined){ openNew(); return; }
  if (ds.invAll){ openInventory(ds.invAll); return; }
  if (ds.close !== undefined){ openClosing(); return; }
  if (ds.closing){ showClosing(ds.closing); return; }
  if (ds.del){ confirmDelete(ds.del); return; }
  if (ds.export){ exportCsv(ds.export); return; }
  if (ds.import !== undefined){ pickImportFile(); return; }
  if (ds.importPaste !== undefined){ openPasteImport(); return; }
  if (ds.logout !== undefined){ signOutNow(); return; }
});
document.addEventListener("change", e => {
  const cb = e.target.closest("[data-paid]"); if (!cb) return;
  setPaid([cb.dataset.paid], cb.checked);
});
const onScroll = () => $("#hdr").classList.toggle("scrolled", window.scrollY > 4 || $("#screen").scrollTop > 4);
window.addEventListener("scroll", onScroll, {passive:true});
$("#screen").addEventListener("scroll", onScroll, {passive:true});

/* ---------- Sheet ---------- */
function openSheet(html, onBind){
  delete $("#sheet").dataset.warned;
  $("#sheet").innerHTML = '<div class="grab"></div>' + html;
  $("#sheet").scrollTop = 0;
  $("#sheet").classList.add("open"); $("#scrim").classList.add("open");
  if (onBind) onBind($("#sheet"));
}
function closeSheet(){ $("#sheet").classList.remove("open"); $("#scrim").classList.remove("open"); }
$("#scrim").addEventListener("click", closeSheet);
function stepper(id, val){
  return `<div class="stepper"><button type="button" data-step="-1" data-for="${id}">−</button><input id="${id}" type="number" inputmode="numeric" value="${val}" min="0"><button type="button" data-step="1" data-for="${id}">+</button></div>`;
}
$("#sheet").addEventListener("click", e => {
  const b = e.target.closest("[data-step]");
  if (b){ const inp = document.getElementById(b.dataset.for); inp.value = Math.max(0, (parseInt(inp.value)||0) + parseInt(b.dataset.step)); inp.dispatchEvent(new Event("input")); return; }
  const d = e.target.closest("[data-del]");
  if (d){ confirmDelete(d.dataset.del); }
});

/* ---------- Toast ---------- */
let toastTimer = null, undoFn = null;
function toast(msg, undo){
  $("#toastMsg").textContent = msg; undoFn = undo || null;
  $("#toastUndo").style.display = undo ? "" : "none";
  $("#toast").classList.add("show"); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("#toast").classList.remove("show"); undoFn = null; }, undo ? 6000 : 3500);
}
$("#toastUndo").addEventListener("click", async () => { const f = undoFn; undoFn = null; $("#toast").classList.remove("show"); if (f) await f(); });

/* ---------- Writes ---------- */
const errText = err => err && (err.message || err.code) ? " (" + (err.message || err.code) + ")" : "";
async function guard(fn){
  if (!db){ toast("Keine Verbindung zur Datenbank – nichts gespeichert."); return null; }
  try { const r = await fn(); return r === undefined ? true : r; }
  catch(err){
    console.error(err);
    if (err && err.code === "unavailable"){
      await new Promise(r => setTimeout(r, 600 + Math.random()*600));
      try { const r = await fn(); return r === undefined ? true : r; } catch(e2){ toast("Gerade keine Verbindung – bitte nochmals versuchen."); return null; }
    }
    if (err && err.code === "quota_exceeded") toast("Speicher voll" + errText(err));
    else toast("Nicht gespeichert" + errText(err));
    return null;
  }
}
async function addMove(data){ return guard(async () => { const ref = db.collection("moves").doc(); await ref.set(data); return ref; }); }
async function deleteMove(id){
  const backup = moves.slice();
  moves = moves.filter(m => m.id !== id); recompute(); render();
  const r = await guard(() => db.doc("moves/" + id).delete());
  if (r === null){ moves = backup; recompute(); render(); }
  return r;
}

async function setPaid(ids, paid){
  const backup = moves.slice(); const at = paid ? new Date().toISOString() : null;
  moves = moves.map(m => ids.includes(m.id) ? {...m, paid, paidAt:at} : m); render();
  for (const id of ids){
    const r = await guard(() => db.doc("moves/" + id).update({paid, paidAt:at}));
    if (r === null){ moves = backup; render(); return false; }
  }
  if (ids.length > 1) toast(`${ids.length} Verkäufe als erhalten markiert`);
  return true;
}
function confirmPayAll(){
  const list = moves.filter(m => m.t === "sale" && !m.paid);
  const sum = list.reduce((s,m) => s + saleAmount(m), 0);
  openSheet(`<h3>Alle als erhalten markieren?</h3><div style="margin-top:6px">${list.length} offene Verkäufe über <b>${chf(sum)}</b> werden als «Betrag erhalten» bestätigt.</div>
    <div class="actions"><button class="btn sec" id="cancel">Abbrechen</button><button class="btn" id="ok">Bestätigen</button></div>`, s => {
    s.querySelector("#cancel").onclick = closeSheet;
    s.querySelector("#ok").onclick = async () => { closeSheet(); await setPaid(list.map(m => m.id), true); };
  });
}
async function quickSale(id, loc = "shop"){
  const a = articles[id]; if (!a || a.vk == null) return;
  const ref = await addMove({a:id, t:"sale", loc, q:-1, p:a.vk, ek:a.ek ?? 0, paid:false, d:new Date().toISOString()});
  if (ref) toast(`1× ${label(a)} verkauft${loc==="gift"?" (Geschenkset)":""} · ${chf(a.vk)}`, () => deleteMove(ref.id));
}
function openSale(id, loc = "shop"){
  const a = articles[id]; if (!a) return;
  const xs = loc === "home";
  const head = xs ? '<div class="tag t-xsale" style="display:inline-block;margin-bottom:6px">Ausserordentlich · aus Lager Zuhause</div>' : loc === "gift" ? '<div class="tag t-gsale" style="display:inline-block;margin-bottom:6px">Aus Lager Geschenksets</div>' : "";
  openSheet(`${head}<h3>${esc(label(a))}</h3><div class="small">${LOCS.map(l => l===loc ? `${LOC[l]} <b>${stockAt(l)[id]||0}</b>` : `${LOC[l]} ${stockAt(l)[id]||0}`).join(" · ")} · EK ${chf(a.ek)}</div>
    <label>Anzahl verkauft</label>${stepper("sq", 1)}
    <div class="two"><div><label>Preis pro Stück (CHF)</label><input class="f" id="sp" inputmode="decimal" value="${a.vk!=null?fmt2(a.vk):""}"></div>
    <div><label>${xs?"Kunde / Notiz":"Notiz (optional)"}</label><input class="f" id="sn" placeholder="${xs?"z. B. Name":"z. B. Rabatt"}"></div></div>
    <label class="check"><input type="checkbox" id="spaid"> Betrag bereits erhalten</label>
    <div class="actions"><button class="btn sec" id="cancel">Abbrechen</button><button class="btn terra" id="ok" ${readOnly?"disabled":""}>Verkauf buchen</button></div>`,
  s => {
    s.querySelector("#cancel").onclick = closeSheet;
    s.querySelector("#ok").onclick = async () => {
      const n = parseInt(s.querySelector("#sq").value)||0; const p = num(s.querySelector("#sp").value);
      if (n <= 0) return toast("Bitte Anzahl angeben.");
      if (p == null) return toast("Bitte Preis angeben.");
      const avail = stockAt(loc)[id]||0;
      if (n > avail && !s.dataset.warned){ s.dataset.warned = "1"; return toast(`Achtung: im Lager ${LOC[loc]} sind nur ${avail} gebucht. Nochmals tippen zum Buchen.`); }
      const paid = s.querySelector("#spaid").checked;
      const ref = await addMove({a:id, t:"sale", loc, q:-n, p, ek:a.ek ?? 0, paid, paidAt: paid ? new Date().toISOString() : null, d:new Date().toISOString(), note:s.querySelector("#sn").value.trim()});
      if (ref){ closeSheet(); toast(`${n}× ${label(a)} ${xs?"ausserordentlich ":""}verkauft · ${chf(n*p)}`, () => deleteMove(ref.id)); }
    };
  });
}
function openTransfer(id){
  const a = articles[id]; if (!a) return;
  let from = (home[id]||0) > 0 ? "home" : (shop[id]||0) > 0 ? "shop" : "gift";
  let to = from === "shop" ? "gift" : "shop";
  const base = {home:home[id]||0, shop:shop[id]||0, gift:gift[id]||0};
  const segBtns = (attr, cur) => LOCS.map(l => `<button class="${cur===l?"on":""}" data-${attr}="${l}">${LOC[l]}</button>`).join("");
  openSheet(`<h3>Umbuchen</h3><div class="small">${esc(label(a))}</div>
    <div class="locpair three">${LOCS.map(l => `<div data-col="${l}"><small>${LOC[l]}</small><b id="p-${l}">${base[l]}</b></div>`).join("")}</div>
    <label>Von</label><div class="seg" id="segFrom" style="margin-top:4px">${segBtns("from", from)}</div>
    <label>Nach</label><div class="seg" id="segTo" style="margin-top:4px">${segBtns("to", to)}</div>
    <label>Menge</label>${stepper("tq", 1)}
    <div class="small" id="tw" style="margin-top:6px"></div>
    <div class="actions"><button class="btn sec" id="cancel">Abbrechen</button><button class="btn" id="ok" ${readOnly?"disabled":""}>Umbuchen</button></div>`,
  s => {
    const upd = () => {
      if (from === to){ to = LOCS.find(l => l !== from); }
      s.querySelectorAll("[data-from]").forEach(b => b.classList.toggle("on", b.dataset.from === from));
      s.querySelectorAll("[data-to]").forEach(b => { b.classList.toggle("on", b.dataset.to === to); b.disabled = b.dataset.to === from; });
      const n = parseInt(s.querySelector("#tq").value)||0;
      for (const l of LOCS){
        const v = base[l] + (l === to ? n : 0) - (l === from ? n : 0);
        s.querySelector("#p-" + l).textContent = v;
        s.querySelector(`[data-col="${l}"]`).className = l === from ? "out" : l === to ? "in" : "";
      }
      s.querySelector("#tw").textContent = n > base[from] ? `Achtung: im Lager ${LOC[from]} sind nur ${base[from]} gebucht.` : "";
    };
    s.querySelectorAll("[data-from]").forEach(b => b.onclick = () => { from = b.dataset.from; upd(); });
    s.querySelectorAll("[data-to]").forEach(b => b.onclick = () => { if (b.dataset.to !== from){ to = b.dataset.to; upd(); } });
    s.querySelector("#tq").addEventListener("input", upd); upd();
    s.querySelector("#cancel").onclick = closeSheet;
    s.querySelector("#ok").onclick = async () => {
      const n = parseInt(s.querySelector("#tq").value)||0; if (n <= 0) return toast("Bitte Menge angeben.");
      const ref = await addMove({a:id, t:"tr", from, to, q:n, d:new Date().toISOString()});
      if (ref){ closeSheet(); toast(`${n}× ${label(a)}: ${LOC[from]} → ${LOC[to]}`, () => deleteMove(ref.id)); }
    };
  });
}
function openDelivery(id){
  const a = articles[id]; if (!a) return;
  openSheet(`<h3>Lieferung einbuchen</h3><div class="small">${esc(label(a))} · ins Lager Zuhause (aktuell ${home[id]||0})${a.supplier?" · "+esc(a.supplier):""}</div>
    <label>Gelieferte Menge</label>${stepper("dq", 1)}
    <div class="two"><div><label>Einkaufspreis / Stk.</label><input class="f" id="dp" inputmode="decimal" value="${a.ek!=null?fmt2(a.ek):""}"></div>
    <div><label>Datum</label><input class="f" id="dd" type="date" value="${todayStr()}"></div></div>
    <label class="check"><input type="checkbox" id="du" checked> Neuen EK im Artikel speichern</label>
    <div class="actions"><button class="btn sec" id="cancel">Abbrechen</button><button class="btn" id="ok" ${readOnly?"disabled":""}>Einbuchen</button></div>`,
  s => {
    s.querySelector("#cancel").onclick = closeSheet;
    s.querySelector("#ok").onclick = async () => {
      const n = parseInt(s.querySelector("#dq").value)||0; const p = num(s.querySelector("#dp").value);
      if (n <= 0) return toast("Bitte Menge angeben.");
      const ds = s.querySelector("#dd").value || todayStr();
      const when = ds === todayStr() ? new Date() : new Date(ds + "T12:00:00");
      const ref = await addMove({a:id, t:"in", loc:"home", q:n, p:p ?? 0, d:when.toISOString()});
      if (!ref) return;
      if (s.querySelector("#du").checked && p != null && p !== a.ek) await guard(() => db.doc("articles/" + id).update({ek:p}));
      closeSheet(); toast(`+${n} ${label(a)} ins Lager Zuhause`, () => deleteMove(ref.id));
    };
  });
}

/* Beenden: Verkäufe seit dem letzten Abschluss zusammenrechnen */
function closingBody(st){
  const rows = Object.entries(st.items).sort((a,b) => b[1].pcs - a[1].pcs);
  return `<div class="kpis" style="margin-top:12px">
      <div class="kpi hl"><div class="l">Umsatz</div><div class="v">${chf(st.rev)}</div></div>
      <div class="kpi"><div class="l">Verkaufte Stück</div><div class="v">${st.pcs}</div></div></div>
    <div class="small" style="margin-top:8px">Ertrag (Umsatz − Einkauf): <b>${chf(st.margin ?? (st.rev - (st.cost||0)))}</b></div>
    ${rows.length ? `<div class="group" style="margin-top:12px;box-shadow:none;border:1px solid var(--line)"><table><tr><th>Artikel</th><th>Stk.</th><th>CHF</th></tr>${rows.map(([id,v]) => `<tr><td>${esc(articles[id]?label(articles[id]):"(gelöschter Artikel)")}</td><td>${v.pcs}</td><td>${fmt2(v.rev)}</td></tr>`).join("")}</table></div>` : '<div class="empty">Keine Verkäufe seit dem letzten Abschluss.</div>'}`;
}
function openClosing(){
  const lc = lastClosing(); const since = lc && lc.d;
  const st = sumSales(salesSince(since));
  openSheet(`<h3>Verkauf beenden</h3><div class="small">Abgebucht seit ${since ? "dem Abschluss vom " + esc(dtLabel(new Date(since))) : "Beginn"}</div>
    ${closingBody(st)}
    ${st.pcs ? '<label class="check"><input type="checkbox" id="cpaid"> Betrag erhalten – alle diese Verkäufe als bezahlt markieren</label>' : ""}
    <div class="actions"><button class="btn sec" id="cancel">Zurück</button><button class="btn terra" id="ok" ${readOnly?"disabled":""}>Beenden &amp; abschliessen</button></div>`,
  s => {
    s.querySelector("#cancel").onclick = closeSheet;
    s.querySelector("#ok").onclick = async () => {
      const items = {}; for (const [k,v] of Object.entries(st.items)) items[k] = {pcs:v.pcs, rev:Math.round(v.rev*100)/100};
      const doc = {d:new Date().toISOString(), from: since || null, pcs:st.pcs, rev:Math.round(st.rev*100)/100, cost:Math.round(st.cost*100)/100, items};
      const ok = await guard(async () => { await db.collection("closings").doc().set(doc); });
      if (ok){
        closeSheet(); toast(`Abgeschlossen: ${st.pcs} Stk. · ${chf(st.rev)}`);
        const cp = s.querySelector("#cpaid");
        if (cp && cp.checked){ const ids = salesSince(since, doc.d).filter(m => !m.paid).map(m => m.id); if (ids.length) await setPaid(ids, true); }
      }
    };
  });
}
function showClosing(id){
  const c = closings.find(x => x.id === id); if (!c) return;
  const cs = salesSince(c.from, c.d); const unpaid = cs.filter(m => !m.paid);
  openSheet(`<h3>Abschluss</h3><div class="small">${c.from ? esc(dtLabel(new Date(c.from))) + " bis " : "Bis "}${esc(dtLabel(new Date(c.d)))}</div>
    ${closingBody({pcs:c.pcs, rev:c.rev, margin:c.rev-(c.cost||0), items:c.items||{}})}
    <div class="small" style="margin-top:10px">Zahlung: ${cs.length ? (unpaid.length ? `<b style="color:var(--terra)">${unpaid.length} von ${cs.length} Verkäufen offen (${chf(openSum(unpaid))})</b>` : "<b style=\"color:var(--green)\">alles erhalten</b>") : "–"}</div>
    ${unpaid.length && !readOnly ? '<button class="btn sec block" id="cpay" style="margin-top:10px">Betrag erhalten – alle als bezahlt markieren</button>' : ""}
    <div class="actions"><button class="btn sec" id="cancel">Schliessen</button>${readOnly?"":`<button class="btn danger" id="delc">Abschluss löschen</button>`}</div>`, s => {
    s.querySelector("#cancel").onclick = closeSheet;
    const cp = s.querySelector("#cpay");
    if (cp) cp.onclick = async () => { closeSheet(); await setPaid(unpaid.map(m => m.id), true); };
    const dc = s.querySelector("#delc");
    if (dc) dc.onclick = async () => { const ok = await guard(() => db.doc("closings/" + id).delete()); if (ok){ closeSheet(); toast("Abschluss gelöscht – die Verkäufe zählen wieder zum vorherigen Zeitraum."); } };
  });
}

/* Artikelverwaltung */
function articleForm(a = {}){
  const isNew = !a.name;
  return `<label>Artikelname</label><input class="f" id="an" value="${esc(a.name||"")}" placeholder="z. B. Baby Body">
    <label>${isNew ? "Varianten / Grössen (mit Komma trennen, optional)" : "Variante / Grösse"}</label><input class="f" id="av" value="${esc(a.variant||"")}" placeholder="z. B. 0-3 Monate, 3-6 Monate">
    <label>Artikelgruppe</label><select class="f" id="ag">${GROUPS.map(g => `<option ${groupOf(a)===g?"selected":""}>${g}</option>`).join("")}</select>
    <div class="two"><div><label>Kategorie</label><select class="f" id="ac">${CATS.map(c => `<option ${a.cat===c?"selected":""}>${c}</option>`).join("")}</select></div>
    <div><label>Lieferant</label><input class="f" id="al" value="${esc(a.supplier||"")}"></div></div>
    <div class="two"><div><label>Einkaufspreis</label><input class="f" id="ae" inputmode="decimal" value="${a.ek!=null?fmt2(a.ek):""}"></div>
    <div><label>Verkaufspreis</label><input class="f" id="ak" inputmode="decimal" value="${a.vk!=null?fmt2(a.vk):""}"></div></div>
    <div class="two"><div><label>Warnen ab Bestand im Laden</label><input class="f" id="am" type="number" inputmode="numeric" value="${a.min ?? 2}"></div>${isNew?`<div><label>Startbestand zuhause</label><input class="f" id="as" type="number" inputmode="numeric" value="0"></div>`:""}</div>`;
}
function readForm(s){
  return { name:s.querySelector("#an").value.trim(), variant:s.querySelector("#av").value.trim(), cat:s.querySelector("#ac").value, group:s.querySelector("#ag").value,
    supplier:s.querySelector("#al").value.trim(), ek:num(s.querySelector("#ae").value), vk:num(s.querySelector("#ak").value),
    min:parseInt(s.querySelector("#am").value) || 0 };
}
function openNew(){
  openSheet(`<h3>Neuer Artikel</h3>${articleForm()}<div class="actions"><button class="btn sec" id="cancel">Abbrechen</button><button class="btn" id="ok" ${readOnly?"disabled":""}>Anlegen</button></div>`, s => {
    s.querySelector("#cancel").onclick = closeSheet;
    s.querySelector("#ok").onclick = async () => {
      const f = readForm(s); if (!f.name) return toast("Bitte Namen angeben.");
      const start = parseInt(s.querySelector("#as").value) || 0;
      const variants = f.variant ? f.variant.split(",").map(v => v.trim()).filter(Boolean) : [""];
      const maxOrder = Math.max(0, ...Object.values(articles).map(a => a.order||0));
      let i = 0;
      for (const v of variants){
        const ok = await guard(async () => {
          const ref = db.collection("articles").doc();
          await ref.set({...f, variant:v, active:true, order:maxOrder + 1 + i});
          if (start > 0) await db.collection("moves").doc().set({a:ref.id, t:"start", loc:"home", q:start, p:0, d:new Date().toISOString()});
        });
        if (!ok) return; i++;
      }
      closeSheet(); toast(variants.length > 1 ? `${variants.length} Varianten angelegt` : "Artikel angelegt");
    };
  });
}
/* ---------- Etiketten ----------
   Format in Millimetern – hier anpassen, sobald das Etikettenformat feststeht. */
const LABEL = { w: 50, h: 25, pad: 1.5 };
function labelData(f){
  const artikel = f.variant ? f.name + " · " + f.variant : f.name;
  return { artikel, label: f.group || GROUPS[0], preis: f.vk == null ? null : Math.round(f.vk * 100) / 100 };
}
function qrSvg(text){
  if (!window.makeQrMatrix) return "";
  const m = window.makeQrMatrix(text, "M"), n = m.length, q = 2, size = n + 2 * q;
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) d += `M${c + q} ${r + q}h1v1h-1z`;
  return `<svg class="lqr" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
function labelHtml(f){
  const d = labelData(f);
  const qr = qrSvg(JSON.stringify(d));
  return `<div class="plabel" style="width:${LABEL.w}mm;height:${LABEL.h}mm;padding:${LABEL.pad}mm">
    <div class="lqrw" style="width:${LABEL.h - 2 * LABEL.pad}mm;height:${LABEL.h - 2 * LABEL.pad}mm">${qr}</div>
    <div class="ltxt"><div class="l1${(d.artikel||"").length > 30 ? " long" : ""}">${esc(d.artikel || "Artikel")}</div><div class="l2">${esc(d.label)}</div><div class="l3">${d.preis == null ? "Preis fehlt" : "CHF " + fmt2(d.preis)}</div></div>
  </div>`;
}
function printLabels(f, count){
  if (!f.name) return toast("Bitte zuerst einen Artikelnamen eingeben.");
  if (f.vk == null) return toast("Bitte zuerst einen Verkaufspreis eingeben.");
  count = Math.max(1, Math.min(100, count));
  let area = document.getElementById("printArea");
  if (!area){ area = document.createElement("div"); area.id = "printArea"; document.body.appendChild(area); }
  const one = labelHtml(f);
  area.innerHTML = Array.from({length: count}, () => `<div class="printPage">${one}</div>`).join("");
  let st = document.getElementById("printPageStyle");
  if (!st){ st = document.createElement("style"); st.id = "printPageStyle"; document.head.appendChild(st); }
  st.textContent = `@page { size: ${LABEL.w}mm ${LABEL.h}mm; margin: 0; }`;
  document.body.classList.add("printing");
  const done = () => { document.body.classList.remove("printing"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  setTimeout(() => { try { window.print(); } catch (_) { toast("Drucken ist hier nicht möglich."); } setTimeout(done, 1500); }, 50);
}
function openArticle(id){
  const a = articles[id]; if (!a) return;
  const hist = moves.filter(m => m.a === id).sort((x,y) => y.d.localeCompare(x.d)).slice(0, 15);
  const soldAll = moves.filter(m => m.a === id && m.t === "sale").reduce((s,m) => s - m.q, 0);
  openSheet(`<h3>${esc(label(a))}</h3><div class="small">Zuhause <b>${home[id]||0}</b> · Laden <b>${shop[id]||0}</b> · Geschenksets <b>${gift[id]||0}</b> · bisher ${soldAll} verkauft${lastSale[id]?" · zuletzt "+lastSale[id].toLocaleDateString("de-CH"):""}</div>
    ${articleForm(a)}
    <div class="actions"><button class="btn sec" id="cancel">Abbrechen</button><button class="btn" id="ok" ${readOnly?"disabled":""}>Speichern</button></div>
    <h2 style="font-size:16px">Etikett</h2>
    <div class="small">${LABEL.w} × ${LABEL.h} mm · zeigt die Angaben aus dem Formular oben</div>
    <div class="labelPreview" id="labelPreview"></div>
    <div class="labelPrint">${stepper("lc", 1)}<button class="btn" id="lprint">Drucken</button></div>
    <h2 style="font-size:16px">Inventur – tatsächlich gezählt</h2>
    <div class="three"><div><label>Zuhause</label><input class="f" id="ih" type="number" inputmode="numeric" placeholder="${home[id]||0}"></div><div><label>Laden</label><input class="f" id="is" type="number" inputmode="numeric" placeholder="${shop[id]||0}"></div><div><label>Geschenksets</label><input class="f" id="ig" type="number" inputmode="numeric" placeholder="${gift[id]||0}"></div></div>
    <button class="btn sec block" id="icok" style="margin-top:10px" ${readOnly?"disabled":""}>Bestand korrigieren</button>
    <h2 style="font-size:16px">Letzte Buchungen</h2><div class="hist">${hist.length ? hist.map(m => `<div class="h" style="align-items:center"><span style="flex:1">${new Date(m.d).toLocaleDateString("de-CH")} · ${esc(moveLabel(m))}</span><span class="${m.t==="tr"?"":(m.q>0?"pos":"neg")}">${m.t==="tr"?Math.abs(m.q):(m.q>0?"+":"")+m.q}</span>${readOnly?"":`<button class="x" data-del="${m.id}" aria-label="Buchung löschen">${TRASH}</button>`}</div>`).join("") : '<div class="small">Noch keine.</div>'}</div>
    ${readOnly?"":`<button class="btn danger block" id="delart" style="margin-top:18px">Artikel löschen</button>`}`,
  s => {
    const updLabel = () => { const f = readForm(s); s.querySelector("#labelPreview").innerHTML = labelHtml(f); };
    s.querySelectorAll("#an, #av, #ag, #ak").forEach(el => { el.addEventListener("input", updLabel); el.addEventListener("change", updLabel); });
    updLabel();
    s.querySelector("#lprint").onclick = () => printLabels(readForm(s), parseInt(s.querySelector("#lc").value) || 1);
    s.querySelector("#cancel").onclick = closeSheet;
    s.querySelector("#ok").onclick = async () => {
      const f = readForm(s); if (!f.name) return toast("Bitte Namen angeben.");
      const ok = await guard(() => db.doc("articles/" + id).update(f));
      if (ok){ closeSheet(); toast("Gespeichert"); }
    };
    s.querySelector("#icok").onclick = async () => {
      const changes = [];
      for (const [sel, loc, cur] of [["#ih","home",home[id]||0],["#is","shop",shop[id]||0],["#ig","gift",gift[id]||0]]){
        const v = s.querySelector(sel).value; if (v === "") continue;
        const c = parseInt(v); if (isNaN(c) || c < 0) return toast("Bitte gültige Menge eingeben.");
        if (c !== cur) changes.push({loc, diff:c - cur});
      }
      if (!changes.length){ closeSheet(); return toast("Bestand stimmt bereits."); }
      for (const ch of changes){ const r = await addMove({a:id, t:"inv", loc:ch.loc, q:ch.diff, p:0, d:new Date().toISOString()}); if (!r) return; }
      closeSheet(); toast("Bestand korrigiert");
    };
    const del = s.querySelector("#delart");
    if (del) del.onclick = () => confirmDeleteArticle(id);
  });
}
function confirmDeleteArticle(id){
  const a = articles[id]; if (!a) return;
  const cnt = moves.filter(m => m.a === id).length;
  openSheet(`<h3>Artikel löschen?</h3><div style="margin-top:6px"><b>${esc(label(a))}</b> wird aus der Artikelliste entfernt.</div>
    <div class="small" style="margin-top:6px">Bestand: zuhause ${home[id]||0}, Laden ${shop[id]||0}, Geschenksets ${gift[id]||0}. ${cnt ? `Die ${cnt} bisherigen Buchungen bleiben in Verlauf und Auswertung erhalten.` : ""}</div>
    <div class="actions"><button class="btn sec" id="cancel">Behalten</button><button class="btn danger" id="ok">Endgültig löschen</button></div>`, s => {
    s.querySelector("#cancel").onclick = () => openArticle(id);
    s.querySelector("#ok").onclick = async () => {
      const ok = await guard(() => db.doc("articles/" + id).delete());
      if (ok){ closeSheet(); toast(`${label(a)} gelöscht`); }
    };
  });
}
function openInventory(loc){
  const list = allArticles();
  const st = stockAt(loc);
  openSheet(`<h3>Inventur ${LOC[loc]}</h3><div class="small">Trag nur ein, was vom gebuchten Bestand abweicht. Leere Felder bleiben unverändert.</div>
    <div style="margin-top:10px">${list.map(a => `<div class="row" style="cursor:default;padding-left:0"><div class="main"><div class="name">${esc(label(a))}</div><div class="meta">gebucht: ${st[a.id]||0}</div></div><input class="f" style="width:84px;text-align:center" type="number" inputmode="numeric" data-inv="${a.id}" placeholder="${st[a.id]||0}"></div>`).join("")}</div>
    <div class="actions"><button class="btn sec" id="cancel">Abbrechen</button><button class="btn" id="ok" ${readOnly?"disabled":""}>Abweichungen buchen</button></div>`, s => {
    s.querySelector("#cancel").onclick = closeSheet;
    s.querySelector("#ok").onclick = async () => {
      let count = 0;
      for (const inp of s.querySelectorAll("[data-inv]")){
        if (inp.value === "") continue; const c = parseInt(inp.value); if (isNaN(c) || c < 0) continue;
        const diff = c - (st[inp.dataset.inv]||0); if (!diff) continue;
        const ref = await addMove({a:inp.dataset.inv, t:"inv", loc, q:diff, p:0, d:new Date().toISOString()});
        if (!ref) return; count++;
      }
      closeSheet(); toast(count ? `${count} Bestände korrigiert` : "Keine Abweichungen");
    };
  });
}
function confirmDelete(id){
  const m = moves.find(x => x.id === id); if (!m) return; const a = articles[m.a];
  openSheet(`<h3>Buchung löschen?</h3><div style="margin-top:6px">${esc(moveLabel(m))} · ${esc(a?label(a):"")} · ${m.t==="tr"?Math.abs(m.q):(m.q>0?"+":"")+m.q} Stk. vom ${new Date(m.d).toLocaleString("de-CH",{dateStyle:"short",timeStyle:"short"})}</div>
    <div class="small" style="margin-top:6px">Der Bestand wird entsprechend zurückgerechnet.</div>
    <div class="actions"><button class="btn sec" id="cancel">Behalten</button><button class="btn danger" id="ok">Löschen</button></div>`, s => {
    s.querySelector("#cancel").onclick = closeSheet;
    s.querySelector("#ok").onclick = async () => { closeSheet(); const r = await deleteMove(id); if (r) toast("Buchung gelöscht"); };
  });
}

/* ---------- Export ---------- */
function csvCell(v){ v = v == null ? "" : String(v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g,'""') + '"' : v; }
const dec = v => v == null ? "" : String(Math.round(v*100)/100).replace(".", ",");
async function exportCsv(kind){
  let rows, fname;
  if (kind === "json"){
    const data = JSON.stringify({app:"pusteblume-laden", version:1, exportedAt:new Date().toISOString(), articles, moves, closings});
    downloadFile("Pusteblume_Daten_" + todayStr() + ".json", data, "application/json");
    return;
  }
  if (kind === "bestand"){
    rows = [["Artikel","Variante","Artikelgruppe","Kategorie","Lieferant","EK","VK","Zuhause","Laden","Geschenksets","Total","Warenwert EK","Warenwert VK"]];
    for (const a of allArticles()){ const t = total(a.id); rows.push([a.name, a.variant, groupOf(a), a.cat, a.supplier, dec(a.ek), dec(a.vk), home[a.id]||0, shop[a.id]||0, gift[a.id]||0, t, dec(t*(a.ek||0)), dec(t*(a.vk||0))]); }
    fname = "Bestand_" + todayStr() + ".csv";
  } else {
    rows = [["Datum","KW","Buchung","Artikel","Variante","Menge","Preis/Stk","Betrag","EK/Stk","Betrag erhalten","Notiz"]];
    for (const m of moves.slice().sort((a,b) => a.d.localeCompare(b.d))){
      const a = articles[m.a] || {}; const d = new Date(m.d);
      rows.push([d.toLocaleDateString("de-CH"), isoWeek(d).w, moveLabel(m), a.name, a.variant, m.q, dec(m.p), m.t==="sale"||m.t==="in" ? dec(Math.abs(m.q)*(m.p||0)) : "", m.t==="sale"?dec(m.ek):"", m.t==="sale"?(m.paid?"ja":"nein"):"", m.note||""]);
    }
    fname = "Buchungen_" + todayStr() + ".csv";
  }
  const text = "﻿" + rows.map(r => r.map(csvCell).join(";")).join("\r\n");
  downloadFile(fname, text, "text/csv;charset=utf-8");
}

/* ---------- Data ---------- */
function init(){
  render();
  db = firestoreDb();
  const slowTimer = setTimeout(() => { if (!(loaded.a && loaded.m && loaded.c) && status !== "denied"){ status = "slow"; render(); } }, 10000);
  const onErr = e => { status = e && e.code === "permission-denied" ? "denied" : "error"; render(); };
  const ready = () => { if (loaded.a && loaded.m && loaded.c && (status === "slow" || status === "loading")){ status = "ok"; clearTimeout(slowTimer); } recompute(); render(); };
  db.collection("articles").onSnapshot(snap => { articles = {}; snap.docs.forEach(d => articles[d.id] = d.data()); if (!snap.metadata.fromCache || snap.size) loaded.a = true; ready(); }, onErr);
  db.collection("moves").onSnapshot(snap => { moves = snap.docs.map(d => ({id:d.id, ...d.data()})).filter(m => m.a && m.d); if (!snap.metadata.fromCache || snap.size) loaded.m = true; ready(); }, onErr);
  db.collection("closings").onSnapshot(snap => { closings = snap.docs.map(d => ({id:d.id, ...d.data()})).filter(c => c.d); if (!snap.metadata.fromCache || snap.size) loaded.c = true; ready(); }, onErr);
}
// Für Fehlersuche in der Browser-Konsole
window.__pb = { get articles(){ return articles; }, get moves(){ return moves; }, get home(){ return home; }, get shop(){ return shop; }, get gift(){ return gift; } };
boot();
