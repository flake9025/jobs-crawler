// Onglet « Candidatures » : candidatures spontanées assistées auprès des entreprises vedettes.
//
// Aucune de ces entreprises n'ouvre son outil de recrutement à des envois extérieurs :
// les API des ATS (Workday, Talentsoft, SuccessFactors, Greenhouse…) exigent une clé
// délivrée à l'employeur. L'envoi final reste donc fait par le candidat, sur le site
// officiel ; l'onglet prépare tout le reste : profil et CV saisis une fois, entreprises
// à cocher, puis, pour chacune, sa page de candidature et chaque champ prêt à copier.
//
// Tout reste sur l'appareil (localStorage, IndexedDB pour le CV) : rien n'est envoyé
// au serveur de Sophia Jobs.
import { icon, escapeHtml, safeUrl, store, avatar } from "/ui.js";

const PROFILE_KEY = "sophia-jobs:apply-profile";
const SELECTION_KEY = "sophia-jobs:apply-selection";
export const SENT_KEY = "sophia-jobs:applications";

const PROFILE_FIELDS = ["firstName", "lastName", "email", "phone", "title", "pitch", "link"];
const CV_MAX_BYTES = 10 * 1024 * 1024;
const CV_EXTENSIONS = /\.(pdf|docx?|odt|rtf)$/i;
const CV_ACCEPT = ".pdf,.doc,.docx,.odt,.rtf";

const normalize = (s = "") => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const plural = (n, word, many = `${word}s`) => `${n} ${n > 1 ? many : word}`;
const remove = (key) => {
  try {
    localStorage.removeItem(key);
  } catch {
    /* stockage indisponible */
  }
};

export function formatDay(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const options = { day: "numeric", month: "long" };
  if (d.getFullYear() !== new Date().getFullYear()) options.year = "numeric";
  return d.toLocaleDateString("fr-FR", options);
}

const formatSize = (n) =>
  n >= 1048576 ? `${(n / 1048576).toFixed(1).replace(".", ",")} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`;

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Où candidater : formulaire spontané, vivier de talents ou, à défaut, site carrières
// ---------------------------------------------------------------------------
export function applyTarget(c) {
  if (c.applyUrl) return { url: c.applyUrl, kind: c.applyKind === "talent" ? "talent" : "spontaneous" };
  const url = c.careerUrl || c.site;
  return url ? { url, kind: "career" } : null;
}

export const APPLY_LABELS = {
  spontaneous: "Candidature spontanée",
  talent: "Vivier de talents",
  career: "Postuler sur leur site",
};

const KIND_INFO = {
  spontaneous: { cls: "is-form", icon: "send", label: "Formulaire de candidature spontanée" },
  talent: { cls: "is-talent", icon: "user", label: "Vivier de talents (Talent Community)" },
  career: { cls: "", icon: "globe", label: "Pas de candidature spontanée : via leurs offres" },
};

const KIND_HELP = {
  spontaneous: "Formulaire officiel de candidature spontanée.",
  talent:
    "Pas de candidature spontanée chez cet employeur : leur vivier de talents (Talent Community) transmet votre profil à leurs recruteurs.",
  career:
    "Pas de candidature spontanée chez cet employeur : postulez sur leur site carrières à l'offre la plus proche de votre profil.",
};

// ---------------------------------------------------------------------------
// Suivi des candidatures envoyées (affiché aussi sur les cartes de l'onglet Entreprises)
// ---------------------------------------------------------------------------
export const sentApplication = (name) => store.get(SENT_KEY, {})[name] || null;

function setSent(name, sent) {
  const all = store.get(SENT_KEY, {});
  if (sent) all[name] = { at: new Date().toISOString() };
  else delete all[name];
  store.set(SENT_KEY, all);
}

// ---------------------------------------------------------------------------
// CV : conservé dans IndexedDB (le localStorage ne stocke que du texte, 5 Mo max)
// ---------------------------------------------------------------------------
const cvStore = (() => {
  let db = null;
  const open = () =>
    (db ||= new Promise((resolve, reject) => {
      const req = indexedDB.open("sophia-jobs", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("files");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((err) => {
      db = null;
      throw err;
    }));
  const run = async (mode, action) => {
    const conn = await open();
    return new Promise((resolve, reject) => {
      const tx = conn.transaction("files", mode);
      const req = action(tx.objectStore("files"));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  };
  return {
    get: () => run("readonly", (s) => s.get("cv")),
    put: (value) => run("readwrite", (s) => s.put(value, "cv")),
    delete: () => run("readwrite", (s) => s.delete("cv")),
  };
})();

// ---------------------------------------------------------------------------
// Textes prêts à coller
// ---------------------------------------------------------------------------
const fullName = (p) => [p.firstName, p.lastName].map((s) => s.trim()).filter(Boolean).join(" ");

const subjectFor = (p) => (p.title.trim() ? `Candidature spontanée : ${p.title.trim()}` : "Candidature spontanée");

function messageFor(p, company, hasCv) {
  const title = p.title.trim();
  const lines = [
    "Madame, Monsieur,",
    "",
    `Je vous adresse ma candidature spontanée${title ? ` pour un poste de ${title}` : ""} chez ${company}.`,
  ];
  if (p.pitch.trim()) lines.push("", p.pitch.trim());
  lines.push(
    "",
    `${hasCv ? "Vous trouverez mon CV en pièce jointe. " : ""}Je reste à votre disposition pour un échange et vous remercie de l'attention portée à ma candidature.`,
    "",
    "Cordialement,",
    ...[fullName(p), [p.phone.trim(), p.email.trim()].filter(Boolean).join(" · "), p.link.trim()].filter(Boolean)
  );
  return lines.join("\n");
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Contexte non sécurisé (http) ou permission refusée : ancienne méthode.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

const buttonLabels = new WeakMap();
function flash(btn, ok) {
  if (!buttonLabels.has(btn)) buttonLabels.set(btn, btn.innerHTML);
  clearTimeout(btn.flashTimer);
  btn.innerHTML = ok ? `${icon("check")}Copié` : `${icon("alert")}Copie impossible`;
  btn.classList.toggle("is-done", ok);
  btn.flashTimer = setTimeout(() => {
    btn.innerHTML = buttonLabels.get(btn);
    buttonLabels.delete(btn);
    btn.classList.remove("is-done");
  }, 1600);
}

// ---------------------------------------------------------------------------
// Onglet
// ---------------------------------------------------------------------------
export function createApplyTab({ fetchFeatured }) {
  const $ = (id) => document.getElementById(id);
  const form = $("apply-profile");
  const setupEl = $("apply-setup");
  const runnerEl = $("apply-runner");
  const listEl = $("apply-companies");
  const filterEl = $("apply-filter");
  const selectionEl = $("apply-selection");
  const startBtn = $("apply-start");
  const startHint = $("apply-start-hint");
  const cvBox = $("cv-box");
  const pitchCount = $("pitch-count");
  const feedbackEl = $("profile-feedback");

  const readProfile = () => {
    const saved = store.get(PROFILE_KEY, {});
    return Object.fromEntries(PROFILE_FIELDS.map((f) => [f, typeof saved[f] === "string" ? saved[f] : ""]));
  };

  let profile = readProfile();
  let selection = new Set(store.get(SELECTION_KEY, []));
  let categories = null;
  let cv = null; // { name, type, size, savedAt, blob }
  let cvPersisted = true;
  let run = null; // série en cours : { queue, index, results: Map(nom → "sent" | "skipped"), opened }
  let initialized = null;

  const saveSelection = () => store.set(SELECTION_KEY, [...selection]);
  const allCompanies = () => (categories || []).flatMap((cat) => cat.companies);
  const selectedCompanies = () => allCompanies().filter((c) => selection.has(c.name));

  // --- Profil ---
  function fillForm() {
    for (const f of PROFILE_FIELDS) form.elements[f].value = profile[f];
    pitchCount.textContent = profile.pitch.length;
  }

  let feedbackTimer = null;
  function feedback(message, type = "success") {
    clearTimeout(feedbackTimer);
    feedbackEl.className = `small feedback feedback-${type}`;
    feedbackEl.innerHTML = `${icon(type === "error" ? "alert" : "check")}${escapeHtml(message)}`;
    feedbackEl.hidden = false;
    feedbackTimer = setTimeout(() => (feedbackEl.hidden = true), type === "error" ? 6000 : 2000);
  }

  form.addEventListener("submit", (e) => e.preventDefault());
  form.addEventListener("input", (e) => {
    const field = e.target.name;
    if (!PROFILE_FIELDS.includes(field)) return;
    profile[field] = e.target.value;
    if (field === "pitch") pitchCount.textContent = profile.pitch.length;
    store.set(PROFILE_KEY, profile);
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => feedback("Profil enregistré sur cet appareil"), 600);
    updateStart();
  });

  // « linkedin.com/in/… » saisi sans protocole : on le complète.
  form.elements.link.addEventListener("blur", (e) => {
    const value = e.target.value.trim();
    if (value && !/^https?:\/\//i.test(value) && /^[\w-]+(\.[\w-]+)+(\/|$)/.test(value)) {
      e.target.value = `https://${value}`;
      profile.link = e.target.value;
      store.set(PROFILE_KEY, profile);
    }
  });

  $("profile-clear").addEventListener("click", async () => {
    if (!confirm("Effacer votre profil, votre CV, votre sélection et le suivi de vos candidatures sur cet appareil ?")) return;
    for (const key of [PROFILE_KEY, SELECTION_KEY, SENT_KEY]) remove(key);
    profile = readProfile();
    selection = new Set();
    cv = null;
    try {
      await cvStore.delete();
    } catch {
      /* rien à effacer */
    }
    fillForm();
    renderCv();
    renderList();
    feedback("Données effacées de cet appareil");
  });

  // --- CV ---
  function renderCv() {
    cvBox.classList.toggle("has-file", Boolean(cv));
    const input = `<input type="file" class="sr-only" accept="${CV_ACCEPT}" data-cv-input />`;
    cvBox.innerHTML = cv
      ? `<span class="cv-icon">${icon("file-text")}</span>
        <span class="cv-info">
          <strong title="${escapeHtml(cv.name)}">${escapeHtml(cv.name)}</strong>
          <small>${formatSize(cv.size)} · ajouté le ${formatDay(cv.savedAt)}${cvPersisted ? "" : " · conservé jusqu'à la fermeture de l'onglet"}</small>
        </span>
        <span class="cv-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-cv="download">${icon("download")}Télécharger</button>
          <label class="btn btn-ghost btn-sm">${icon("upload")}Remplacer${input}</label>
          <button type="button" class="icon-btn icon-btn-sm" data-cv="delete" title="Retirer le CV" aria-label="Retirer le CV">${icon("trash")}</button>
        </span>`
      : `<span class="cv-icon">${icon("file-text")}</span>
        <span class="cv-info">
          <strong>Mon CV</strong>
          <small>PDF ou Word, 10 Mo maximum. Glissez-le ici ou :</small>
        </span>
        <span class="cv-actions"><label class="btn btn-soft btn-sm">${icon("upload")}Choisir un fichier${input}</label></span>`;
  }

  async function setCv(file) {
    if (!file) return;
    if (!CV_EXTENSIONS.test(file.name)) return feedback("Format non pris en charge : PDF, Word (.doc, .docx), .odt ou .rtf.", "error");
    if (file.size > CV_MAX_BYTES) return feedback("Fichier trop volumineux : 10 Mo maximum.", "error");
    cv = { name: file.name, type: file.type, size: file.size, savedAt: new Date().toISOString(), blob: file };
    try {
      await cvStore.put(cv);
      cvPersisted = true;
      feedback("CV enregistré sur cet appareil");
    } catch {
      cvPersisted = false; // navigation privée, stockage plein… : gardé le temps de la session
      feedback("Stockage indisponible : CV conservé jusqu'à la fermeture de l'onglet.", "error");
    }
    renderCv();
    updateStart();
  }

  function downloadCv() {
    if (!cv) return;
    const url = URL.createObjectURL(cv.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = cv.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  cvBox.addEventListener("change", (e) => {
    if (e.target.matches("[data-cv-input]")) setCv(e.target.files[0]);
  });
  cvBox.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-cv]");
    if (!btn) return;
    if (btn.dataset.cv === "download") return downloadCv();
    cv = null;
    try {
      await cvStore.delete();
    } catch {
      /* déjà absent */
    }
    renderCv();
    updateStart();
  });
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  cvBox.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    cvBox.classList.add("is-drag");
  });
  cvBox.addEventListener("dragleave", (e) => {
    if (!cvBox.contains(e.relatedTarget)) cvBox.classList.remove("is-drag");
  });
  cvBox.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    cvBox.classList.remove("is-drag");
    setCv(e.dataTransfer.files[0]);
  });

  // --- Entreprises à cocher ---
  const visible = (companies) => {
    const q = normalize(filterEl.value.trim());
    return q ? companies.filter((c) => normalize(`${c.name} ${c.tagline || ""}`).includes(q)) : companies;
  };

  function companyRow(c, sent) {
    const on = selection.has(c.name);
    const info = KIND_INFO[applyTarget(c)?.kind || "career"];
    const kind = `<small class="${info.cls}">${icon(info.icon)}${escapeHtml(info.label)}</small>`;
    return `
      <div class="apply-row${on ? " is-selected" : ""}">
        <label class="apply-row-label">
          <input type="checkbox" value="${escapeHtml(c.name)}"${on ? " checked" : ""} />
          ${avatar(c.name)}
          <span class="apply-row-main"><strong>${escapeHtml(c.name)}</strong>${kind}</span>
        </label>
        ${
          sent
            ? `<span class="pill pill-applied" title="Candidature marquée envoyée le ${escapeHtml(formatDay(sent.at))}">${icon("check")}Envoyée le ${escapeHtml(formatDay(sent.at))}</span>
          <button type="button" class="icon-btn icon-btn-sm" data-unsend="${escapeHtml(c.name)}" title="Retirer du suivi" aria-label="Retirer ${escapeHtml(c.name)} du suivi">${icon("rotate-ccw")}</button>`
            : ""
        }
      </div>`;
  }

  // Libellé du bouton « Tout cocher » : les entreprises déjà sollicitées ne comptent pas.
  function groupToggleLabel(companies, sent) {
    const todo = companies.filter((c) => !sent[c.name]);
    return todo.length && todo.every((c) => selection.has(c.name)) ? "Tout décocher" : "Tout cocher";
  }

  function renderList() {
    if (!categories) return;
    const sent = store.get(SENT_KEY, {});
    const html = categories
      .map((cat) => {
        const companies = visible(cat.companies);
        if (!companies.length) return "";
        return `
          <section class="apply-group" data-category="${escapeHtml(cat.id)}">
            <header class="apply-group-head">
              <h3>${escapeHtml(cat.label)}</h3>
              <button type="button" class="btn btn-link btn-sm" data-toggle-category="${escapeHtml(cat.id)}">${groupToggleLabel(companies, sent)}</button>
            </header>
            <div class="apply-list">${companies.map((c) => companyRow(c, sent[c.name])).join("")}</div>
          </section>`;
      })
      .join("");
    listEl.innerHTML =
      html || `<div class="empty empty-small">${icon("search", "empty-icon")}<h3>Aucune entreprise ne correspond</h3><p>Essayez un autre nom.</p></div>`;
    updateStart();
  }

  function refreshToggles() {
    const sent = store.get(SENT_KEY, {});
    for (const btn of listEl.querySelectorAll("[data-toggle-category]")) {
      const cat = categories.find((c) => c.id === btn.dataset.toggleCategory);
      if (cat) btn.textContent = groupToggleLabel(visible(cat.companies), sent);
    }
  }

  function updateStart() {
    const count = selectedCompanies().length;
    const sentCount = Object.keys(store.get(SENT_KEY, {})).length;
    selectionEl.innerHTML = count
      ? `<strong>${plural(count, "entreprise sélectionnée", "entreprises sélectionnées")}</strong>${sentCount ? ` · ${plural(sentCount, "candidature envoyée", "candidatures envoyées")}` : ""} <button type="button" class="btn btn-link btn-sm" data-clear-selection>Tout décocher</button>`
      : sentCount
        ? `${plural(sentCount, "candidature envoyée", "candidatures envoyées")}`
        : "";
    startBtn.disabled = !count;
    startBtn.innerHTML = `${icon("send")}${count ? `Commencer · ${plural(count, "entreprise")}` : "Cochez au moins une entreprise"}`;

    const missing = [];
    if (!fullName(profile)) missing.push("nom");
    if (!profile.email.trim()) missing.push("email");
    if (!profile.title.trim()) missing.push("poste recherché");
    if (!profile.pitch.trim()) missing.push("présentation");
    if (!cv) missing.push("CV");
    startHint.textContent = missing.length
      ? `Profil incomplet (${missing.join(", ")}) : vous pourrez tout de même avancer.`
      : "Profil complet : chaque champ sera prêt à copier.";
    startHint.classList.toggle("is-ok", !missing.length);
  }

  listEl.addEventListener("change", (e) => {
    const box = e.target.closest('input[type="checkbox"]');
    if (!box) return;
    if (box.checked) selection.add(box.value);
    else selection.delete(box.value);
    box.closest(".apply-row").classList.toggle("is-selected", box.checked);
    saveSelection();
    refreshToggles();
    updateStart();
  });

  listEl.addEventListener("click", (e) => {
    const toggle = e.target.closest("[data-toggle-category]");
    if (toggle) {
      const cat = categories.find((c) => c.id === toggle.dataset.toggleCategory);
      if (!cat) return;
      const sent = store.get(SENT_KEY, {});
      const companies = visible(cat.companies);
      const select = groupToggleLabel(companies, sent) === "Tout cocher";
      for (const c of companies) {
        if (select && !sent[c.name]) selection.add(c.name);
        else if (!select) selection.delete(c.name);
      }
      saveSelection();
      renderList();
      return;
    }
    const unsend = e.target.closest("[data-unsend]");
    if (unsend) {
      setSent(unsend.dataset.unsend, false);
      renderList();
    }
  });

  selectionEl.addEventListener("click", (e) => {
    if (!e.target.closest("[data-clear-selection]")) return;
    selection.clear();
    saveSelection();
    renderList();
  });

  filterEl.addEventListener("input", renderList);

  // --- Série de candidatures, une entreprise à la fois ---
  startBtn.addEventListener("click", () => {
    const queue = selectedCompanies();
    if (!queue.length) return;
    run = { queue, index: 0, results: new Map(), opened: false };
    setupEl.hidden = true;
    runnerEl.hidden = false;
    renderRunner();
  });

  function copyField(label, value, wide = false) {
    return `
      <div class="copy-field${wide ? " copy-field-wide" : ""}">
        <span><small>${escapeHtml(label)}</small><strong title="${escapeHtml(value)}">${escapeHtml(value)}</strong></span>
        <button type="button" class="btn-chip" data-copy="${escapeHtml(value)}" aria-label="Copier : ${escapeHtml(label)}">${icon("copy")}Copier</button>
      </div>`;
  }

  function renderRunner() {
    const { queue, index } = run;
    if (index >= queue.length) return renderSummary();
    const c = queue[index];
    const sent = sentApplication(c.name);
    const target = applyTarget(c) || { url: "", kind: "career" };
    const p = profile;
    const fields = [
      ["Prénom", p.firstName],
      ["Nom", p.lastName],
      ["Email", p.email],
      ["Téléphone", p.phone],
      ["Poste recherché", p.title],
      ["LinkedIn / portfolio", p.link],
      ["Objet", subjectFor(p)],
    ].filter(([, value]) => value.trim());
    const pct = Math.round((index / queue.length) * 100);

    runnerEl.innerHTML = `
      <header class="runner-head">
        <button type="button" class="btn btn-link btn-sm" data-act="quit">${icon("arrow-left")}Retour à la liste</button>
        <span class="runner-count">${index + 1} / ${queue.length}</span>
        <span class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${queue.length}" aria-valuenow="${index}"><span class="progress-bar" style="width:${pct}%"></span></span>
      </header>
      <div class="runner-body">
        <div class="runner-company">
          ${avatar(c.name, "xl")}
          <div>
            <h2 id="runner-title" tabindex="-1">${escapeHtml(c.name)}</h2>
            ${c.tagline ? `<p class="muted">${escapeHtml(c.tagline)}</p>` : ""}
            ${sent ? `<p class="pill pill-applied">${icon("check-circle")}Déjà envoyée le ${escapeHtml(formatDay(sent.at))}</p>` : ""}
          </div>
        </div>
        <ol class="runner-steps">
          <li>
            <h3>Ouvrez leur page de candidature</h3>
            <p class="muted small">${escapeHtml(KIND_HELP[target.kind])} Certains sites demandent de créer un compte candidat.</p>
            <a class="btn ${run.opened ? "btn-ghost" : "btn-primary"}" data-act="open" href="${safeUrl(target.url)}" target="_blank" rel="noopener">${icon("external-link")}Ouvrir ${escapeHtml(hostOf(target.url) || "leur site")}</a>
          </li>
          <li>
            <h3>Copiez-collez vos informations</h3>
            ${
              fields.length
                ? `<div class="copy-grid">${fields.map(([label, value]) => copyField(label, value)).join("")}${p.pitch.trim() ? copyField("Présentation", p.pitch.trim(), true) : ""}</div>`
                : `<p class="notice">${icon("info")}<span>Votre profil est vide : <button type="button" class="btn-link" data-act="quit">complétez-le</button> pour avoir vos informations sous la main.</span></p>`
            }
            <div class="copy-cv">
              <span class="cv-icon">${icon("file-text")}</span>
              ${
                cv
                  ? `<span class="cv-info"><strong>${escapeHtml(cv.name)}</strong><small>À joindre dans leur formulaire (bouton « Parcourir » ou « Importer »).</small></span>
                <button type="button" class="btn btn-ghost btn-sm" data-act="cv">${icon("download")}Télécharger</button>`
                  : `<span class="cv-info"><strong>Aucun CV enregistré</strong><small>Ajoutez-le à votre profil pour l'avoir sous la main.</small></span>`
              }
            </div>
            <div class="copy-message">
              <div class="copy-message-head">
                <label for="runner-message">Message de motivation</label>
                <button type="button" class="btn-chip" data-act="copy-message">${icon("copy")}Copier le message</button>
              </div>
              <textarea id="runner-message" rows="12" spellcheck="true">${escapeHtml(messageFor(p, c.name, Boolean(cv)))}</textarea>
              <small class="muted">Rédigé à partir de votre présentation : modifiable avant de le copier.</small>
            </div>
          </li>
          <li>
            <h3>Validez sur leur site, puis notez-le ici</h3>
            <div class="runner-actions">
              <button type="button" class="btn ${run.opened ? "btn-primary" : "btn-soft"}" data-act="sent">${icon("check")}C'est envoyé${index + 1 < queue.length ? ", entreprise suivante" : ""}</button>
              <button type="button" class="btn btn-ghost" data-act="skip">Passer${icon("arrow-right")}</button>
              ${index > 0 ? `<button type="button" class="btn btn-link" data-act="prev">${icon("arrow-left")}Précédente</button>` : ""}
            </div>
          </li>
        </ol>
      </div>`;
    focusRunner();
  }

  function renderSummary() {
    const sentCount = [...run.results.values()].filter((r) => r === "sent").length;
    const skipped = run.queue.length - sentCount;
    const rows = run.queue
      .map((c) => {
        const done = run.results.get(c.name) === "sent";
        return `<li>${avatar(c.name)}<strong>${escapeHtml(c.name)}</strong>${
          done ? `<span class="pill pill-applied">${icon("check")}Envoyée</span>` : `<span class="pill pill-read">Passée</span>`
        }</li>`;
      })
      .join("");
    runnerEl.innerHTML = `
      <div class="runner-done">
        ${icon("check-circle", "empty-icon")}
        <h2 id="runner-title" tabindex="-1">Série terminée</h2>
        <p>${sentCount ? plural(sentCount, "candidature envoyée", "candidatures envoyées") : "Aucune candidature envoyée"}${
          skipped ? `, ${plural(skipped, "entreprise passée", "entreprises passées")}` : ""
        }.</p>
        <ul class="runner-recap">${rows}</ul>
        ${skipped ? `<p class="muted small">Les entreprises passées restent cochées : vous pourrez y revenir plus tard.</p>` : ""}
        <button type="button" class="btn btn-primary" data-act="quit">${icon("arrow-left")}Retour à la liste</button>
      </div>`;
    focusRunner();
  }

  function focusRunner() {
    runnerEl.scrollIntoView({ block: "start" });
    runnerEl.querySelector("#runner-title")?.focus({ preventScroll: true });
  }

  function closeRunner() {
    run = null;
    runnerEl.hidden = true;
    runnerEl.innerHTML = "";
    setupEl.hidden = false;
    renderList();
    window.scrollTo(0, 0);
  }

  function advance(result) {
    run.results.set(run.queue[run.index].name, result);
    run.index++;
    run.opened = false;
    renderRunner();
  }

  runnerEl.addEventListener("click", async (e) => {
    const copy = e.target.closest("[data-copy]");
    if (copy) return flash(copy, await copyText(copy.dataset.copy));
    const btn = e.target.closest("[data-act]");
    if (!btn || !run) return;
    const company = run.queue[run.index];
    switch (btn.dataset.act) {
      case "open":
        // Pas de nouveau rendu : le lien doit rester en place pour s'ouvrir.
        run.opened = true;
        btn.classList.replace("btn-primary", "btn-ghost");
        runnerEl.querySelector('[data-act="sent"]')?.classList.replace("btn-soft", "btn-primary");
        break;
      case "copy-message": {
        const area = $("runner-message");
        const ok = await copyText(area.value);
        if (!ok) area.select(); // copie bloquée : texte sélectionné pour un Ctrl+C manuel
        flash(btn, ok);
        break;
      }
      case "cv":
        downloadCv();
        break;
      case "sent":
        setSent(company.name, true);
        selection.delete(company.name);
        saveSelection();
        advance("sent");
        break;
      case "skip":
        advance("skipped");
        break;
      case "prev":
        run.index = Math.max(0, run.index - 1);
        run.opened = false;
        renderRunner();
        break;
      case "quit":
        closeRunner();
        break;
    }
  });

  // Un autre onglet a modifié le profil, la sélection ou le suivi : on se resynchronise.
  window.addEventListener("storage", (e) => {
    if (e.key === PROFILE_KEY && !form.contains(document.activeElement)) {
      profile = readProfile();
      fillForm();
    }
    if (e.key === SELECTION_KEY || e.key === SENT_KEY) {
      selection = new Set(store.get(SELECTION_KEY, []));
      if (!run) renderList();
    }
  });

  async function init() {
    fillForm();
    try {
      cv = (await cvStore.get()) || null;
    } catch {
      cv = null;
    }
    renderCv();
    updateStart();
  }

  async function show() {
    initialized ||= init();
    await initialized;
    if (run) return;
    if (!categories) {
      listEl.innerHTML = `<div class="apply-list">${Array.from({ length: 6 }, () => `<div class="apply-row skeleton"><span class="sk sk-title"></span></div>`).join("")}</div>`;
    }
    try {
      categories = await fetchFeatured();
    } catch (err) {
      if (!categories) {
        listEl.innerHTML = `<div class="notice notice-error">${icon("alert")}<span>${escapeHtml(err.message)}</span></div>`;
      }
      return;
    }
    renderList();
  }

  return { show };
}
