// Fenêtre du favori « Remplir avec Sophia Jobs », ouverte par le favori depuis le formulaire
// d'une entreprise. Elle seule lit le profil et le CV (même origine que l'application) et les
// transmet à la page sur un canal privé, uniquement au clic sur « Remplir le formulaire ».
import { icon, escapeHtml, store, apiFetch } from "/ui.js";
import { loadProfile, cvStore, messageFor, subjectFor, fullName, formatSize, hostOf, PROFILE_KEY, CURRENT_KEY } from "/apply.js";
import { PREFILL_VERSION, FILL_KEY, FILL_USED_KEY } from "/prefill.js";

const LABELS = {
  firstName: "Prénom",
  lastName: "Nom",
  fullName: "Nom complet",
  email: "Email",
  emailConfirm: "Confirmation de l'email",
  phone: "Téléphone",
  linkedin: "LinkedIn",
  website: "Site ou portfolio",
  subject: "Objet",
  title: "Poste recherché",
  message: "Message",
  cv: "CV",
};
const ORDER = Object.keys(LABELS);
// Plateformes de recrutement partagées : leur domaine ne désigne pas une entreprise.
const SHARED_HOSTS =
  /(^|\.)(myworkdayjobs|workday|talent-soft|smartrecruiters|successfactors|sapsf|taleo|oraclecloud|lever|greenhouse|teamtailor|recruitee|jobvite|icims|csod|welcometothejungle|jobteaser|indeed|linkedin|softy|flatchr|digitalrecruiters|beetween|jobaffinity|gestmax|cornerstoneondemand|avature|phenompeople|eightfold)\./i;
const CURRENT_MAX_AGE = 6 * 3600 * 1000;

const main = document.getElementById("fill");
const hostEl = document.getElementById("fill-host");
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const isLinkedIn = (url) => /(^|\.|\/)linkedin\.[a-z]+/i.test(url);

let gen = 0; // incrémenté à chaque (re)connexion : les réponses d'une ancienne tentative sont ignorées
let port = null;
let seq = 0;
const pending = new Map();
const ui = {}; // éléments de la vue principale, construite une seule fois par connexion
let page = null; // { origin, host, url, title, v }
let scanData = { kinds: [], cv: false, frames: [] };
let profile = loadProfile();
let cv = null;
let companies = [];
let company = null;
let companySource = "none";
let messageEdited = false;
let busy = false;
let lastScan = 0;
let error = "";

// --- Canal privé avec la page ---
function closePort() {
  for (const { reject, timer } of pending.values()) {
    clearTimeout(timer);
    reject(new Error("gone"));
  }
  pending.clear();
  if (port) port.close();
  port = null;
}

function call(type, payload = {}, timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (!port) return reject(new Error("gone"));
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("gone"));
    }, timeout);
    pending.set(id, { resolve, reject, timer });
    port.postMessage({ ...payload, type, id });
  });
}

function listen(p) {
  p.onmessage = (e) => {
    const msg = e.data;
    const req = msg && pending.get(msg.id);
    if (!req) return;
    pending.delete(msg.id);
    clearTimeout(req.timer);
    if (msg.error) req.reject(new Error(String(msg.error)));
    else req.resolve(msg);
  };
}

// Le favori répond à « hello » par un canal : on le demande jusqu'à ce que la page réponde.
// Une tentative dépassée (favori recliqué entre-temps) s'arrête sans prendre de canal.
function connect(origin, my) {
  return new Promise((resolve) => {
    let tries = 0;
    let timer = null;
    const done = (result) => {
      clearInterval(timer);
      window.removeEventListener("message", onMessage);
      resolve(result);
    };
    const onMessage = (e) => {
      if (my !== gen) return done(null);
      const data = e.data;
      if (e.source !== window.opener || e.origin !== origin || !data || data.type !== "sophia-jobs:ready" || !e.ports[0]) return;
      done({ port: e.ports[0], ready: data });
    };
    const ping = () => {
      if (my !== gen || tries++ >= 12 || !window.opener || window.opener.closed) return done(null);
      try {
        window.opener.postMessage({ type: "sophia-jobs:hello" }, origin);
      } catch {
        /* page partie entre-temps */
      }
    };
    window.addEventListener("message", onMessage);
    timer = setInterval(ping, 250);
    ping();
  });
}

// --- États particuliers (pas de formulaire joignable) ---
const APP_LINK = `<a class="btn btn-ghost btn-sm" href="/#candidatures" target="_blank" rel="noopener">${icon("external-link")}Ouvrir Sophia Jobs</a>`;
const STATES = {
  invalid: {
    icon: "zap",
    title: "Remplissage automatique",
    text: "Cette fenêtre s'ouvre avec le favori <strong>Remplir avec Sophia Jobs</strong>, depuis le formulaire de candidature d'une entreprise. Installez-le depuis l'onglet Candidatures.",
  },
  isolated: {
    icon: "lock",
    title: "Ce site isole ses fenêtres",
    text: "Sa politique de sécurité empêche Sophia Jobs d'accéder à son formulaire. Utilisez les boutons <strong>Copier</strong> de l'onglet Candidatures pour ce site.",
  },
  closed: {
    icon: "info",
    title: "Page fermée",
    text: "La page du formulaire a été fermée. Rouvrez-la, puis cliquez à nouveau sur le favori.",
  },
  timeout: {
    icon: "alert",
    title: "La page ne répond pas",
    text: "La page a changé ou a été rechargée depuis le clic sur le favori. Revenez sur le formulaire et cliquez à nouveau sur le favori.",
    retry: true,
  },
  stale: {
    icon: "lock",
    title: "Favori installé ailleurs",
    text: "Ce favori n'a pas été installé depuis ce navigateur (favoris synchronisés depuis un autre appareil ?). Utilisez-le ici seulement si vous l'avez installé vous-même.",
    adopt: true,
  },
};

function showState(name) {
  const s = STATES[name];
  document.title = `${s.title} · Sophia Jobs`;
  main.innerHTML = `
    <div class="fill-state">
      <span class="fill-state-icon">${icon(s.icon)}</span>
      <h1>${s.title}</h1>
      <p>${s.text}</p>
      <div class="fill-state-actions">
        ${s.retry ? `<button type="button" class="btn btn-primary btn-sm" data-act="retry">${icon("refresh")}Réessayer</button>` : ""}
        ${s.adopt ? `<button type="button" class="btn btn-primary btn-sm" data-act="adopt">${icon("check")}Utiliser ce favori ici</button>` : ""}
        ${APP_LINK}
      </div>
    </div>`;
}

main.addEventListener("click", (e) => {
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "retry") init();
  if (act === "adopt") {
    const key = new URLSearchParams(location.hash.slice(1)).get("k") || "";
    if (/^[0-9a-f]{32}$/.test(key)) store.set(FILL_KEY, key);
    init();
  }
});

async function loadCompanies() {
  try {
    const data = await apiFetch("/api/featured-companies");
    const seen = new Map();
    for (const cat of data.categories || []) for (const c of cat.companies || []) if (c?.name && !seen.has(c.name)) seen.set(c.name, c);
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, "fr"));
  } catch {
    return [];
  }
}

async function loadCv() {
  try {
    return (await cvStore.get()) || null;
  } catch {
    return null;
  }
}

async function init() {
  const my = ++gen;
  // Favori recliqué (étape suivante du formulaire) : entreprise choisie et message retouché conservés.
  const prev = page && ui.message ? { origin: page.origin, company, source: companySource, text: messageEdited ? ui.message.value : null } : null;
  closePort();
  error = "";
  const params = new URLSearchParams(location.hash.slice(1));
  const origin = params.get("o") || "";
  const version = Number(params.get("v")) || 0;
  const key = params.get("k") || "";
  hostEl.textContent = "";
  if (!/^https?:\/\/[^/?#\s]+$/.test(origin)) return showState("invalid");
  hostEl.textContent = hostOf(origin) || origin;
  if (key !== store.get(FILL_KEY, null)) return showState("stale");
  if (!window.opener) return showState("isolated");
  if (window.opener.closed) return showState("closed");

  main.innerHTML = `<div class="fill-state"><span class="fill-spinner" aria-hidden="true"></span><p>Connexion au formulaire…</p></div>`;
  const [link, list, file] = await Promise.all([connect(origin, my), companies.length ? companies : loadCompanies(), loadCv()]);
  if (my !== gen) {
    link?.port.close();
    return;
  }
  if (!link) return showState(window.opener && !window.opener.closed ? "timeout" : "closed");
  port = link.port;
  listen(port);
  companies = list;
  cv = file;
  profile = loadProfile();
  const ready = link.ready;
  // Seule l'origine vérifiée fait foi : l'adresse annoncée par la page doit lui appartenir.
  page = {
    origin,
    host: hostOf(origin) || origin,
    url: sameOrigin(ready.url, origin) ? String(ready.url) : `${origin}/`,
    title: String(ready.title || "").slice(0, 200),
    v: Number(ready.v) || version,
  };
  scanData = normalizeScan(ready.scan);
  lastScan = Date.now();
  if (prev && prev.origin === origin && prev.source === "manual") {
    company = prev.company;
    companySource = "manual";
  } else ({ company, source: companySource } = guessCompany(page.url));
  messageEdited = Boolean(prev && prev.text != null && (prev.company?.name || "") === (company?.name || ""));
  renderMain(messageEdited ? prev.text : null);
}

function sameOrigin(url, origin) {
  try {
    return new URL(String(url)).origin === origin;
  } catch {
    return false;
  }
}

function normalizeScan(s) {
  return {
    kinds: Array.isArray(s?.kinds) ? s.kinds.filter((k) => LABELS[k]) : [],
    cv: Boolean(s?.cv),
    frames: Array.isArray(s?.frames) ? s.frames.filter((u) => /^https?:\/\//i.test(u)).slice(0, 3) : [],
  };
}

// --- Entreprise : reconnue d'après l'adresse de la page, sinon celle de la série en cours ---
function current() {
  const cur = store.get(CURRENT_KEY, null);
  if (!cur || typeof cur.name !== "string") return null;
  const age = Date.now() - new Date(cur.at).getTime();
  return age >= 0 && age < CURRENT_MAX_AGE ? cur : null;
}

function urlParts(url) {
  try {
    const u = new URL(url);
    return { host: u.hostname.replace(/^www\./, "").toLowerCase(), seg: (u.pathname.split("/").find(Boolean) || "").toLowerCase() };
  } catch {
    return null;
  }
}

function guessCompany(url) {
  const at = urlParts(url);
  const cur = current();
  if (at) {
    const scored = [];
    for (const c of companies) {
      let best = 0;
      for (const u of [c.applyUrl, c.careerUrl, c.site]) {
        const p = u ? urlParts(u) : null;
        if (p && p.host === at.host) best = Math.max(best, p.seg && p.seg === at.seg ? 2 : 1);
      }
      if (best) scored.push({ c, best });
    }
    const top = Math.max(0, ...scored.map((s) => s.best));
    const tops = scored.filter((s) => s.best === top).map((s) => s.c);
    if (tops.length === 1) return { company: tops[0], source: "url" };
    const inRun = cur && tops.find((c) => c.name === cur.name);
    if (inRun) return { company: inRun, source: "url" };
    // Sous-domaine du site de l'entreprise (ex. careers.exemple.com pour exemple.com).
    if (!tops.length && !SHARED_HOSTS.test(`${at.host}.`)) {
      const own = companies.filter((c) => {
        const p = c.site ? urlParts(c.site) : null;
        return p && !SHARED_HOSTS.test(`${p.host}.`) && (at.host === p.host || at.host.endsWith(`.${p.host}`));
      });
      if (own.length === 1) return { company: own[0], source: "url" };
    }
  }
  if (cur) return { company: companies.find((c) => c.name === cur.name) || { name: cur.name }, source: "run" };
  return { company: null, source: "none" };
}

const COMPANY_HINTS = {
  url: "Reconnue d'après l'adresse de la page.",
  run: "Entreprise en cours dans votre série de candidatures.",
  none: "Non reconnue : choisissez-la pour personnaliser le message.",
  manual: "",
};

// --- Valeurs transmises ---
const attachCv = () => Boolean(cv && ui.cvInput?.checked);

// Message retouché dans la série en cours pour cette entreprise : repris tel quel.
function generatedMessage() {
  const cur = current();
  if (cur && company && cur.name === company.name && typeof cur.message === "string" && cur.message.trim()) return cur.message;
  return messageFor(profile, company?.name || "", attachCv());
}

function values() {
  const p = profile;
  return {
    firstName: p.firstName.trim(),
    lastName: p.lastName.trim(),
    fullName: fullName(p),
    email: p.email.trim(),
    phone: p.phone.trim(),
    title: p.title.trim(),
    link: p.link.trim(),
    subject: subjectFor(p),
    message: ui.message ? ui.message.value.trim() : "",
  };
}

function has(kind, v) {
  if (kind === "cv") return attachCv();
  if (kind === "emailConfirm") return Boolean(v.email);
  if (kind === "linkedin") return isLinkedIn(v.link);
  if (kind === "website") return Boolean(v.link) && !isLinkedIn(v.link);
  return Boolean(v[kind]);
}

// --- Vue principale : construite une fois, puis mise à jour par sections (sans jamais recréer
// les boutons, pour qu'un clic qui ramène le focus dans la fenêtre ne soit pas perdu) ---
const setHtml = (el, html) => {
  if (el.dataset.html !== html) {
    el.innerHTML = html;
    el.dataset.html = html;
  }
};

function renderMain(draft = null) {
  document.title = `Remplir · ${page.host} · Sophia Jobs`;
  hostEl.textContent = page.host;
  hostEl.title = page.title || page.url;
  const choices = company && !companies.some((c) => c.name === company.name) ? [company, ...companies] : companies;
  main.innerHTML = `
    <div class="fill-body">
      <div id="fill-notices"></div>
      <section class="fill-section">
        <label class="fill-label" for="fill-company">Entreprise</label>
        <select id="fill-company" class="fill-select">
          <option value="">Aucune (message sans nom d'entreprise)</option>
          ${choices.map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join("")}
        </select>
        <small id="fill-company-hint" class="muted"></small>
      </section>
      <section class="fill-section">
        <div class="fill-section-head">
          <h2 class="fill-label">Champs repérés sur la page</h2>
          <button type="button" class="btn btn-link btn-sm" id="fill-rescan">${icon("refresh")}Analyser à nouveau</button>
        </div>
        <div id="fill-fields"></div>
      </section>
      <section class="fill-section">
        ${
          cv
            ? `<label class="fill-check"><input type="checkbox" id="fill-cv" checked /><span>Joindre mon CV <small class="muted">${escapeHtml(cv.name)} · ${formatSize(cv.size || cv.blob?.size || 0)}</small></span></label>`
            : `<p class="small muted fill-cv-none">${icon("file-text")}<span>Aucun CV dans votre profil : <a href="/#candidatures" target="_blank" rel="noopener">ajoutez-le</a> pour le joindre automatiquement.</span></p>`
        }
        <small id="fill-cv-hint" class="muted"></small>
      </section>
      <section class="fill-section">
        <div class="fill-section-head">
          <label class="fill-label" for="fill-message">Message</label>
          <button type="button" class="btn btn-link btn-sm" id="fill-reset" hidden>${icon("refresh")}Rédiger à nouveau</button>
        </div>
        <textarea id="fill-message" rows="9" spellcheck="true"></textarea>
        <small class="muted">Pour leur champ « Message » ou « Lettre de motivation ».</small>
      </section>
      <div id="fill-report" class="fill-report" role="status" hidden></div>
    </div>
    <footer class="fill-actions">
      <div class="fill-buttons">
        <button type="button" class="btn btn-primary" id="fill-go">${icon("zap")}Remplir le formulaire</button>
        <button type="button" class="btn btn-ghost" id="fill-close">Fermer</button>
      </div>
      <p class="small muted">${icon("lock")}Rien n'est envoyé : vous vérifiez, puis validez vous-même sur leur site.</p>
    </footer>`;
  const $ = (id) => document.getElementById(`fill-${id}`);
  Object.assign(ui, {
    notices: $("notices"),
    company: $("company"),
    companyHint: $("company-hint"),
    fields: $("fields"),
    rescan: $("rescan"),
    cvInput: $("cv"),
    cvHint: $("cv-hint"),
    message: $("message"),
    reset: $("reset"),
    report: $("report"),
    go: $("go"),
    close: $("close"),
  });
  ui.company.value = company?.name || "";
  ui.companyHint.textContent = COMPANY_HINTS[companySource];
  ui.message.value = draft ?? generatedMessage();
  ui.reset.hidden = !messageEdited;

  ui.company.addEventListener("change", () => {
    const name = ui.company.value;
    company = choices.find((c) => c.name === name) || null;
    companySource = "manual";
    ui.companyHint.textContent = "";
    if (!messageEdited) ui.message.value = generatedMessage();
  });
  ui.message.addEventListener("input", () => {
    messageEdited = ui.message.value !== generatedMessage();
    ui.reset.hidden = !messageEdited;
  });
  ui.reset.addEventListener("click", () => {
    messageEdited = false;
    ui.reset.hidden = true;
    ui.message.value = generatedMessage();
    ui.message.focus();
  });
  ui.cvInput?.addEventListener("change", () => {
    if (!messageEdited) ui.message.value = generatedMessage();
    updateFields();
  });
  ui.rescan.addEventListener("click", () => rescan(false));
  ui.go.addEventListener("click", doFill);
  ui.close.addEventListener("click", () => window.close());
  updateNotices();
  updateFields();
}

function updateNotices() {
  const notes = [];
  if (!profile.firstName.trim() && !profile.lastName.trim() && !profile.email.trim()) {
    notes.push(["alert", "notice-warning", `Votre profil est vide : complétez-le dans l'onglet <a href="/#candidatures" target="_blank" rel="noopener">Candidatures</a> de Sophia Jobs.`]);
  }
  if (page.v < PREFILL_VERSION) {
    notes.push(["info", "", "Votre favori date d'une version précédente : glissez à nouveau le bouton depuis l'onglet Candidatures pour profiter des dernières améliorations."]);
  }
  if (error === "gone") {
    notes.push(["alert", "notice-error", "La page ne répond plus (elle a changé ou a été rechargée) : revenez sur le formulaire et cliquez à nouveau sur le favori."]);
  } else if (error) {
    notes.push(["alert", "notice-error", `Remplissage impossible : ${escapeHtml(error)}`]);
  }
  setHtml(ui.notices, notes.map(([name, cls, html]) => `<p class="notice ${cls}">${icon(name)}<span>${html}</span></p>`).join(""));
}

function updateFields() {
  const v = values();
  const kinds = ORDER.filter((k) => (k === "cv" ? scanData.cv : scanData.kinds.includes(k)));
  let html = "";
  if (kinds.length) {
    html = `<ul class="fill-chips">${kinds
      .map((k) => {
        const ok = has(k, v);
        const why = ok ? "Sera rempli" : k === "cv" ? "CV non joint" : "Absent de votre profil";
        return `<li class="fill-chip ${ok ? "is-ok" : "is-missing"}" title="${why}">${icon(ok ? "check" : "x")}${LABELS[k]}</li>`;
      })
      .join("")}</ul>`;
    const missing = kinds.filter((k) => k !== "cv" && !has(k, v));
    if (missing.length) {
      html += `<p class="small muted">Absent de votre profil : ${missing.map((k) => LABELS[k]).join(", ")} · <a href="/#candidatures" target="_blank" rel="noopener">compléter</a></p>`;
    }
  } else {
    html = `<p class="small fill-empty">${icon("info")}<span>Aucun champ reconnu pour l'instant. Ouvrez leur formulaire de candidature (souvent derrière un bouton « Postuler »), puis analysez à nouveau.</span></p>`;
  }
  if (scanData.frames.length) {
    const links = scanData.frames.map((u) => `<a href="${escapeHtml(u)}" target="_blank" rel="noopener">${escapeHtml(hostOf(u) || u)}</a>`).join(", ");
    html += `<p class="small fill-empty">${icon("info")}<span>Un formulaire semble intégré depuis un autre site (${links}) : ouvrez-le dans un onglet, puis cliquez à nouveau sur le favori.</span></p>`;
  }
  setHtml(ui.fields, html);
  ui.cvHint.textContent = cv && !scanData.cv ? "Aucun champ CV repéré pour l'instant sur la page." : "";
}

async function rescan(quiet) {
  if (!port) return;
  const my = gen;
  const button = ui.rescan;
  if (!quiet) button.disabled = true;
  try {
    const s = await call("scan", {}, 4000);
    if (my !== gen) return; // favori recliqué entre-temps : cette réponse ne concerne plus la vue
    scanData = normalizeScan(s);
    lastScan = Date.now();
    if (error === "gone") error = "";
  } catch (err) {
    if (my !== gen) return;
    if (err.message === "gone") error = "gone";
  } finally {
    if (!quiet) button.disabled = false;
  }
  updateFields();
  updateNotices();
}

// --- Remplissage ---
const CV_REPORT = {
  none: "Aucun champ CV repéré : joignez-le vous-même si le site le demande",
  present: "Un fichier était déjà joint : CV laissé tel quel",
  format: "Le site refuse ce format de fichier : joignez une autre version de votre CV",
  failed: "Le CV n'a pas pu être joint : joignez-le vous-même",
};

// Compte rendu : la réponse vient de la page, elle est vérifiée et échappée.
function report(r) {
  const filled = Array.isArray(r.filled) ? r.filled.filter((k) => LABELS[k]) : [];
  const skipped = Array.isArray(r.skipped) ? r.skipped.filter((s) => s && LABELS[s.kind]) : [];
  const cvDone = r.cv === "attached";
  const lines = [];
  if (filled.length || cvDone) {
    const text = filled.length ? `${plural(filled.length, "champ rempli", "champs remplis")}${cvDone ? ", CV joint" : ""}` : "CV joint";
    lines.push({ type: "ok", text });
  } else lines.push({ type: "info", text: "Aucun champ rempli" });
  const by = (reason) => [...new Set(skipped.filter((s) => s.reason === reason).map((s) => LABELS[s.kind]))].join(", ");
  for (const [reason, label] of [
    ["filled", "Déjà remplis, laissés tels quels"],
    ["missing", "Absents de votre profil"],
    ["format", "Format imposé par le site, à saisir vous-même"],
    ["long", "Trop longs pour le site"],
  ]) {
    const list = by(reason);
    if (list) lines.push({ type: "info", text: `${label} : ${list}` });
  }
  for (const note of Array.isArray(r.notes) ? r.notes : []) {
    const max = Number(note?.max);
    if (note?.kind === "message" && max > 0) lines.push({ type: "warn", text: `Message raccourci à ${max} caractères (limite du site) : relisez la fin` });
  }
  if (CV_REPORT[r.cv]) lines.push({ type: "warn", text: CV_REPORT[r.cv] });
  else if (r.cv === "off" && !cv) lines.push({ type: "info", text: "Aucun CV dans votre profil : joignez-le vous-même" });
  const left = Math.max(0, Math.floor(Number(r.requiredLeft) || 0));
  if (left) lines.push({ type: "warn", text: `${plural(left, "champ obligatoire reste", "champs obligatoires restent")} à compléter (listes, cases à cocher…)` });
  lines.push({ type: "info", text: "Vérifiez le formulaire, puis validez-le vous-même" });
  return lines;
}

const REPORT_ICONS = { ok: "check-circle", warn: "alert", info: "info" };

async function doFill() {
  if (busy || !port) return;
  busy = true;
  const my = gen;
  const go = ui.go;
  const label = go.innerHTML;
  go.disabled = true;
  go.innerHTML = `<span class="fill-spinner is-small" aria-hidden="true"></span>Remplissage…`;
  try {
    const withCv = attachCv();
    const r = await call("fill", {
      values: values(),
      cv: withCv ? { name: cv.name, type: cv.type || cv.blob?.type || "", blob: cv.blob } : null,
    }, 8000);
    if (my !== gen) return;
    error = "";
    const lines = report(r);
    if (lines[0].type === "ok") store.set(FILL_USED_KEY, new Date().toISOString());
    ui.report.hidden = false;
    ui.report.innerHTML = `<ul>${lines.map((l) => `<li class="is-${l.type}">${icon(REPORT_ICONS[l.type])}<span>${escapeHtml(l.text)}.</span></li>`).join("")}</ul>`;
    // Bandeau dans la page : l'essentiel (résultat, champs obligatoires restants, rappel).
    const brief = [lines[0], ...lines.filter((l, i) => i && l.type === "warn"), lines[lines.length - 1]].map((l) => `${l.text}.`);
    call("toast", { lines: brief }).catch(() => {});
    go.innerHTML = `${icon("refresh")}Remplir à nouveau`;
    // Le pied (boutons) reste collé en bas : le compte rendu doit s'afficher au-dessus.
    ui.report.style.scrollMarginBottom = `${(document.querySelector(".fill-actions")?.offsetHeight || 0) + 12}px`;
    ui.report.scrollIntoView({ block: "nearest", behavior: "smooth" });
    await rescan(true);
  } catch (err) {
    if (my !== gen) return;
    error = err.message === "gone" ? "gone" : err.message || "erreur inconnue";
    go.innerHTML = label;
    updateNotices();
  } finally {
    busy = false;
    go.disabled = false;
  }
}

// Retour dans la fenêtre (après être passé sur le formulaire) : les champs ont pu changer d'étape.
window.addEventListener("focus", () => {
  if (!port || busy || !ui.fields || Date.now() - lastScan < 1000) return;
  lastScan = Date.now();
  rescan(true);
});

// Profil modifié dans l'onglet Sophia Jobs : pris en compte sans rouvrir la fenêtre.
window.addEventListener("storage", (e) => {
  if (e.key !== PROFILE_KEY || !port || !ui.fields) return;
  profile = loadProfile();
  if (!messageEdited) ui.message.value = generatedMessage();
  updateNotices();
  updateFields();
});

// Favori recliqué (même page ou page suivante) : la fenêtre existante est réutilisée.
window.addEventListener("hashchange", init);
window.addEventListener("pagehide", closePort);

init();
