// Favori « Remplir avec Sophia Jobs » (bookmarklet).
//
// Un site ne peut pas remplir le formulaire d'un autre (politique de même origine) : le
// favori, glissé une fois dans la barre de favoris puis cliqué par le candidat sur la page
// de l'entreprise, s'exécute dans cette page. Il ouvre la petite fenêtre /remplir.html, qui
// seule lit le profil et le CV (conservés sur l'appareil) ; les deux dialoguent par
// postMessage sur un canal privé (MessageChannel). Rien n'est transmis avant un clic sur
// « Remplir », seuls les champs reconnus et vides sont remplis (jamais les cases à cocher ni
// les listes) et le formulaire n'est jamais envoyé : le candidat vérifie et valide lui-même.
import { store } from "/ui.js";

// À incrémenter si le dialogue avec la fenêtre change : elle signale alors les anciens favoris.
export const PREFILL_VERSION = 1;
export const FILL_KEY = "sophia-jobs:fill-key";
export const FILL_USED_KEY = "sophia-jobs:fill-used";

// Clé propre à ce navigateur, inscrite dans le favori : la fenêtre refuse de servir une page
// qui l'ouvrirait d'elle-même, sans le favori, pour tenter de récupérer le profil.
export function fillKey() {
  let key = store.get(FILL_KEY, null);
  if (typeof key !== "string" || !/^[0-9a-f]{32}$/.test(key)) {
    key = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
    store.set(FILL_KEY, key);
  }
  return key;
}

// Adresse du favori : le code de sophiaFill, sans indentation ni commentaires.
export function bookmarkletHref(origin, key) {
  const source = sophiaFill
    .toString()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//"))
    .join("\n");
  const cfg = JSON.stringify({ app: origin, v: PREFILL_VERSION, k: key });
  // Encodé : sauts de ligne, « % » et « # » doivent survivre à l'enregistrement du favori.
  return `javascript:${encodeURIComponent(`void (${source})(${cfg});`)}`;
}

// Code exécuté dans la page de l'entreprise : autonome (aucune référence extérieure) et sans
// balise <style> ni innerHTML, que la politique de sécurité (CSP) de certains sites bloque.
export function sophiaFill(cfg) {
  const APP = cfg.app;
  if (location.origin === APP) {
    alert("Ce bouton s'utilise depuis la barre de favoris : glissez-le dans la barre, puis cliquez sur le favori depuis le formulaire de candidature d'une entreprise.");
    return;
  }
  if (!/^https?:$/.test(location.protocol)) {
    alert("Sophia Jobs : ouvrez d'abord le formulaire de candidature d'une entreprise, puis cliquez sur le favori.");
    return;
  }
  // Conservé d'un clic à l'autre sur la même page : valeurs posées par Sophia Jobs, écouteur, bandeau.
  const state = (window.__sophiaJobsFill ||= { mine: new WeakMap() });

  // Reconnaissance des champs, sur un texte normalisé (minuscules, sans accents ni ponctuation).
  const RX = {
    trap: /\b(ne pas remplir|laisse[rz]? vide|leave (this )?(empty|blank)|do not fill|honey ?pot|robots?|spam)\b/,
    confirm: /\b(confirm\w*|verif\w*|repeat|retype|re ?enter|ressaisi\w*|saisir a nouveau|again)\b/,
    email: /\b(e ?mail|mail|courriel|mel|adresse electronique)\b/,
    phone: /\b(tel(?! qu)|telephone|phone|mobile|portable|gsm|cellulaire|cell ?phone)\b/,
    notPhone: /\b(indicatif|country code|code pays|dial code|prefix\w*|extension|ext|fax)\b/,
    secondPhone: /\b(fixe|domicile|home|landline|bureau|office|work|professionnel|secondaire|second|autre|other|alternati\w*)\b/,
    otherPerson: /\b(parrain\w*|referent|referee|reference|referr\w*|referral|coopt\w*|manager|responsable|tuteur|urgence|emergency|recruteur|recruiter|ami|friend|conjoint|spouse)\b/,
    linkedin: /\blinked ?in\b/,
    alsoSite: /\b(portfolio|site web|site internet|website|web ?site|blog|github|autres?)\b/,
    website: /\b(portfolio|github|gitlab|behance|dribbble|site web|site internet|site perso\w*|website|web ?site|blog|url|lien|link|page perso\w*|personal (site|page))\b/,
    notWebsite: /\b(offre|annonce|posting|reference|video)\b/,
    fullName: /\b(noms? (et )?prenoms?|prenoms? (et )?noms?|nom complet|full ?name|your name|first (and )?last name|name and surname)\b/,
    firstName: /\b(prenoms?|first ?name|given ?names?|forename|fname)\b/,
    lastName: /\b(nom de famille|nom de naissance|nom d usage|nom patronymique|last ?name|family ?name|surname|lname)\b/,
    bareLast: /\bnom\b/,
    bareName: /\bname\b/,
    nameOf: /\b(nom|name) (du|de|des|d|of)\b/,
    otherName: /\b(user ?name|login|identifiant|pseudo\w*|nickname|surnom|middle|suffix|prefix|previous|former|ancien\w*|precedent\w*|deuxieme|second|autres? prenoms?|entreprise|societe|company|employeur|employer|ecole|etablissement|school|universite|university|fichier|file|urgence|emergency|parrain\w*|referent|referee|reference|referr\w*|referral|coopt\w*|manager|responsable|tuteur|recruteur|recruiter|ami|friend|conjoint|spouse|pere|mere|father|mother|enfant|child|rue|street|ville|city|pays|country|diplome|degree|formation|projet|project|produit|marque|brand|organisation|organization|cabinet|agence|agency|client|banque|bank|compte|account|poste|job|position|jeune fille|maiden)\b/,
    subject: /\b(objet|sujet|subject)\b/,
    title: /\b(poste|fonction|metier|emploi|job|position|role|intitule) (recherch\w*|souhait\w*|vise|visez|desir\w*|convoit\w*|sought|desired|wanted)\b|\b(desired|target|wanted|preferred) (job|position|role|title)\b|\b(poste|job|position) (qui vous interesse|pour lequel|of interest)\b/,
    notTitle: /\b(type de|contrat|actuel\w*|current|numero|prise de poste|date|disponibilit\w*|salaire|salary|remuneration|lieu|location|ville|city)\b/,
    message: /\b(message|motivations?|lettre|cover|commentaires|comments|presentation|presentez vous|pourquoi|why|informations? complementaires?|additional (information|comments)|complement|remarques?|precisions?|votre demande|votre candidature|a propos de vous|about (you|yourself)|parlez nous|dites nous|expliquez|texte libre|champ libre|free text)\b/,
    notMessage: /\b(adresse|address|rue|street|comment avez vous|how did you hear|handicap|disabilit\w*)\b/,
    cv: /\b(cv|c v|resumes?|curriculum)\b/,
    notCv: /\b(lettre|cover|motivation|photo|picture|image|avatar|portrait|diplomes?|diplomas?|certificat\w*|certificate\w*|identite|identity|passport|passeport|permis)\b/,
    skipForm: /\b(newsletter|subscri\w*|abonn\w*|search|recherche|login|log in|signin|sign in|connexion|se connecter)\b/,
    frameAds: /captcha|turnstile|challenges\.cloudflare|youtube|vimeo|dailymotion|google\.[a-z.]+\/maps|maps\.google|doubleclick|googlesyndication|googletagmanager|facebook|twitter|instagram|linkedin\.com\/embed|consent|cookie|didomi|onetrust|axeptio|cookiebot|trustarc|usercentrics|intercom|drift|crisp|zendesk|hubspot|livechat|tawk|hotjar|calendly/i,
  };
  // Types de champ compatibles avec chaque type HTML (un champ « email » ne reçoit que l'email…).
  const TYPES = { email: /^email/, tel: /^phone$/, number: /^phone$/, url: /^(linkedin|website)$/ };
  const MACHINE = ["name", "id", "autocomplete", "data-automation-id", "formcontrolname", "ng-model", "data-testid", "data-test", "data-qa", "data-field", "data-name"];

  const norm = (s) =>
    String(s || "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const textOf = (node) => String((node && (node.innerText || node.textContent)) || "").replace(/\s+/g, " ").trim().slice(0, 300);

  // Texte « humain » (libellés, aria, indications) et « technique » (name, id…), normalisés à part :
  // les sources restent séparées par « | » pour qu'un motif ne s'étende pas de l'une à l'autre.
  function describe(el) {
    const human = [];
    const machine = [];
    const attr = (n) => el.getAttribute(n) || "";
    const root = el.getRootNode();
    const host = root.host;
    try {
      for (const label of el.labels || []) human.push(textOf(label));
    } catch (e) {
      human.push("");
    }
    human.push(attr("aria-label"));
    for (const id of attr("aria-labelledby").split(/\s+/)) {
      const target = id && root.getElementById ? root.getElementById(id) : null;
      if (target) human.push(textOf(target));
    }
    if (host) human.push(host.getAttribute("label") || "", host.getAttribute("aria-label") || "");
    const labelled = human.some((t) => norm(t));
    human.push(attr("placeholder"), attr("title"));
    if (!labelled) human.push(nearText(el));
    for (const name of MACHINE) machine.push(attr(name));
    if (host) machine.push(host.getAttribute("name") || "", host.id || "");
    const h = human.map(norm).filter(Boolean).join(" | ");
    const m = machine.map(norm).filter(Boolean).join(" | ");
    return { human: h, machine: m, all: `${h} | ${m}`, auto: attr("autocomplete").toLowerCase().split(/\s+/) };
  }

  // Libellé non relié au champ : texte du plus petit bloc qui ne contient que ce champ.
  function nearText(el) {
    let node = el;
    for (let i = 0; i < 3; i++) {
      const parent = node.parentElement || (node.parentNode && node.parentNode.host) || null;
      if (!parent || parent.tagName === "FORM" || parent.tagName === "BODY") break;
      if (parent.querySelectorAll("input:not([type=hidden]),select,textarea").length > 1) break;
      node = parent;
      const text = textOf(node);
      if (text) return text.length <= 120 ? text : "";
    }
    const prev = el.previousElementSibling;
    return prev && !/^(INPUT|SELECT|TEXTAREA|SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(prev.tagName) ? textOf(prev).slice(0, 120) : "";
  }

  // Champ réellement proposé au candidat : ni désactivé, ni caché, ni piège à robots hors écran.
  function shown(el) {
    if (el.disabled || el.readOnly || el.getAttribute("tabindex") === "-1") return false;
    if (el.closest("[aria-hidden=true],[inert]")) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) return false;
    const view = el.ownerDocument.defaultView || window;
    if (el.checkVisibility) {
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    } else if (view.getComputedStyle(el).visibility === "hidden") return false;
    return r.right + view.scrollX > 0 && r.bottom + view.scrollY > 0;
  }

  // null : rien de reconnu ; kind vide : reconnu mais écarté (ex. « Prénom du référent »).
  function guess(s) {
    if (!s) return null;
    const is = (rx) => rx.test(s);
    let kind = null;
    let bare = false;
    if (is(RX.email)) kind = "email";
    else if (is(RX.phone)) kind = "phone";
    else if (is(RX.linkedin)) kind = "linkedin";
    else if (is(RX.fullName)) kind = "fullName";
    else if (is(RX.firstName)) kind = "firstName";
    else if (is(RX.lastName)) kind = "lastName";
    else if (is(RX.subject)) kind = "subject";
    else if (is(RX.title)) kind = is(RX.notTitle) ? "" : "title";
    else if (is(RX.website)) kind = is(RX.notWebsite) ? "" : "website";
    else if (is(RX.bareLast)) kind = is(RX.nameOf) ? "" : "lastName";
    else if (is(RX.bareName)) kind = is(RX.nameOf) ? "" : "fullName";
    if (kind === null) return null;
    bare = kind === "lastName" && !is(RX.lastName);
    if (/Name$/.test(kind) && is(RX.otherName)) kind = "";
    if ((kind === "email" || kind === "phone") && is(RX.otherPerson)) kind = "";
    return { kind, bare };
  }

  function classify(el, type) {
    const d = describe(el);
    if (RX.trap.test(d.all)) return null;
    let kind = "";
    let bare = false;
    if (el.tagName === "TEXTAREA") {
      if (!RX.notMessage.test(d.all) && (RX.message.test(d.human) || RX.message.test(d.machine))) kind = "message";
    } else {
      const auto = d.auto;
      if (auto.includes("given-name")) kind = "firstName";
      else if (auto.includes("family-name")) kind = "lastName";
      else if (auto.includes("email") || type === "email") kind = "email";
      else if (auto.includes("tel") || auto.includes("tel-national") || type === "tel") kind = "phone";
      let found = kind ? null : guess(d.human);
      if (!kind && !found && auto.includes("name")) kind = "fullName";
      if (!kind && !found) found = guess(d.machine);
      if (found) ({ kind, bare } = found);
      if (!kind && !found && auto.includes("url")) kind = "website";
      if (kind === "email" && RX.confirm.test(d.all)) kind = "emailConfirm";
      if (/^(email|emailConfirm|phone)$/.test(kind) && RX.otherPerson.test(d.human)) kind = "";
      if (kind === "phone" && RX.notPhone.test(d.all)) kind = "";
      if (kind && TYPES[type] && !TYPES[type].test(kind)) kind = "";
    }
    return kind ? { el, kind, bare, text: d.all } : null;
  }

  // Champ fichier : 2 = CV explicite, 0 = pièce jointe générique, -1 = autre document, -2 = invisible.
  function fileScore(el) {
    let node = el;
    let zone = "";
    for (let i = 0; i < 5; i++) {
      const parent = node.parentElement;
      if (!parent || parent.querySelectorAll("input[type=file]").length > 1) break;
      const text = textOf(parent);
      if (text.length > 250) break;
      node = parent;
      zone = text;
    }
    const box = (node === el ? el.parentElement || el : node).getBoundingClientRect();
    if (!box.width && !box.height) return -2;
    const s = `${describe(el).all} | ${norm(zone)} | ${norm(el.accept)}`;
    return RX.cv.test(s) ? 2 : RX.notCv.test(s) ? -1 : 0;
  }

  const bigFrame = (frame) => {
    const src = frame.src || "";
    const r = frame.getBoundingClientRect();
    return /^https?:/.test(src) && r.width > 200 && r.height > 150 && !RX.frameAds.test(src);
  };
  const formText = (form) => norm(["id", "class", "name", "action", "aria-label", "role"].map((a) => form.getAttribute(a) || "").join(" "));

  // Parcourt la page (y compris shadow DOM et cadres de même origine) et retient le formulaire
  // de candidature : celui qui a le plus de champs reconnus, un champ fichier en priorité.
  function analyze() {
    const inputs = [];
    const frames = [];
    const visit = (root, depth) => {
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) visit(el.shadowRoot, depth);
        const tag = el.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") inputs.push(el);
        else if (tag === "IFRAME" || tag === "FRAME") {
          let doc = null;
          try {
            doc = el.contentDocument;
          } catch (e) {
            doc = null;
          }
          if (doc && doc.documentElement) {
            if (depth < 3) visit(doc, depth + 1);
          } else if (bigFrame(el)) frames.push(el.src);
        }
      }
    };
    visit(document, 0);

    const groups = new Map();
    const files = [];
    for (const el of inputs) {
      const key = el.form || el.ownerDocument;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { key, fields: [], controls: [], checks: [], files: 0 }));
      const type = el.tagName === "INPUT" ? el.type : el.tagName.toLowerCase();
      if (type === "file") {
        const score = el.disabled ? -2 : fileScore(el);
        if (score > -2) files.push({ el, score, key });
        if (score >= 0) g.files++;
        continue;
      }
      if (/^(hidden|submit|button|reset|image)$/.test(type)) continue;
      // Cases à cocher souvent masquées par le site au profit d'un dessin : jamais cochées, comptées si obligatoires.
      if (type === "checkbox" || type === "radio") {
        if (!el.disabled) g.checks.push(el);
        continue;
      }
      if (!shown(el)) continue;
      g.controls.push(el);
      const found = /^(text|email|tel|url|search|number|textarea)$/.test(type) ? classify(el, type) : null;
      if (found) g.fields.push(found);
    }

    for (const g of groups.values()) {
      const has = (k) => g.fields.some((f) => f.kind === k);
      // « Nom » sans « Prénom » (formulaire de contact) : le nom complet.
      if (!has("firstName") && !has("fullName")) for (const f of g.fields) if (f.kind === "lastName" && f.bare) f.kind = "fullName";
      // Plusieurs téléphones : le mobile plutôt que le fixe.
      const phones = g.fields.filter((f) => f.kind === "phone");
      if (phones.length > 1) {
        const main = phones.filter((f) => !RX.secondPhone.test(f.text));
        for (const f of phones) if (main.length ? !main.includes(f) : f !== phones[0]) f.kind = "";
      }
      // Pas de zone « Message » reconnue : l'unique zone de texte du formulaire.
      if (!has("message")) {
        const areas = g.controls.filter((el) => {
          if (el.tagName !== "TEXTAREA") return false;
          const s = describe(el).all;
          return !RX.trap.test(s) && !RX.notMessage.test(s);
        });
        if (areas.length === 1) g.fields.push({ el: areas[0], kind: "message", bare: false, text: "" });
      }
      g.fields = g.fields.filter((f) => f.kind);
      g.score = g.fields.length + (g.files ? 1 : 0);
    }

    const skip = (g) => g.key.nodeType === 1 && RX.skipForm.test(formText(g.key));
    const list = [...groups.values()].filter((g) => g.score > 0 && !skip(g));
    const rank = (g) => (g.files ? 10 : 0) + g.score;
    const strong = list.filter((g) => g.score >= 2).sort((a, b) => rank(b) - rank(a));
    const chosen = strong.length ? [strong[0]] : list;
    const inChosen = (f) => chosen.some((g) => g.key === f.key);
    const explicit = files.filter((f) => f.score === 2);
    const generic = files.filter((f) => f.score === 0 && inChosen(f));
    const cv = explicit.find(inChosen) || (explicit.length === 1 ? explicit[0] : null) || (generic.length === 1 ? generic[0] : null);
    return {
      fields: chosen.flatMap((g) => g.fields),
      controls: chosen.flatMap((g) => g.controls),
      checks: chosen.flatMap((g) => g.checks),
      uploads: files.filter(inChosen).map((f) => f.el),
      cv: cv ? cv.el : null,
      frames: [...new Set(frames)].slice(0, 3),
    };
  }

  // Valeur du profil pour un champ : le lien va dans « LinkedIn » s'il s'agit d'un profil LinkedIn
  // (ou si le champ accepte aussi un site), sinon dans « Site ou portfolio ».
  function valueFor(f, values) {
    const link = String(values.link || "");
    const isLinkedIn = /(^|\.|\/)linkedin\.[a-z]+/i.test(link);
    if (f.kind === "emailConfirm") return values.email;
    if (f.kind === "linkedin") return isLinkedIn || RX.alsoSite.test(f.text) ? link : "";
    if (f.kind === "website") return isLinkedIn ? "" : link;
    return values[f.kind];
  }

  // Écrit comme le ferait le candidat : setter natif (React, Vue ou Angular voient la nouvelle
  // valeur), puis événements input et change. Téléphone : plusieurs écritures si le site impose la sienne.
  function write(el, value, kind) {
    const view = el.ownerDocument.defaultView || window;
    const proto = el.tagName === "TEXTAREA" ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    const set = (v) => setter.call(el, v);
    const max = el.maxLength > 0 ? el.maxLength : 0;
    let options = [value];
    let note = null;
    if (kind === "phone") {
      const plus = value.replace(/[^\d+]/g, "");
      const local = plus.replace(/^\+33/, "0");
      options = el.type === "number" ? [local.replace(/\D/g, ""), plus.replace(/\D/g, "")] : [value, plus, local, plus.replace(/^\+/, "00"), local.replace(/\D/g, "")];
      options = [...new Set(options.filter(Boolean))];
    } else if (kind === "message" && max && value.length > max) {
      const cut = value.slice(0, max);
      const floor = max * 0.6;
      let end = cut.lastIndexOf("\n");
      if (end < floor) end = cut.lastIndexOf(". ") + 1;
      if (end < floor) end = cut.lastIndexOf(" ");
      options = [(end >= floor ? cut.slice(0, end) : cut).trim()];
      note = { kind, max };
    }
    const old = el.value;
    for (const v of options) {
      if (max && v.length > max) continue;
      set(v);
      const bad = el.validity && (el.validity.patternMismatch || el.validity.typeMismatch || el.validity.badInput);
      if (bad || !el.value) continue;
      try {
        el.focus({ preventScroll: true });
      } catch (e) {
        el.focus();
      }
      set(v);
      el.dispatchEvent(new view.Event("input", { bubbles: true, composed: true }));
      el.dispatchEvent(new view.Event("change", { bubbles: true, composed: true }));
      el.blur();
      return { ok: true, note };
    }
    set(old);
    return { ok: false, reason: max && options.every((v) => v.length > max) ? "long" : "format" };
  }

  function glow(el) {
    const s = el.style;
    const keep = ["box-shadow", "transition"].map((p) => [p, s.getPropertyValue(p), s.getPropertyPriority(p)]);
    s.setProperty("transition", "box-shadow .3s", "important");
    s.setProperty("box-shadow", "0 0 0 3px rgba(37,99,235,.45)", "important");
    setTimeout(() => {
      for (const [p, v, prio] of keep) s.setProperty(p, v, prio);
    }, 2600);
  }

  // CV : "" (ni CV ni champ), off (non joint), none (pas de champ), present (déjà un fichier),
  // format (refusé par le site), attached, failed.
  function attachCv(input, cv) {
    if (!input) return cv ? "none" : "";
    if (!cv) return "off";
    if (input.files && input.files.length) return "present";
    const type = cv.type || cv.blob.type || "";
    const ext = (String(cv.name).match(/\.[^.]+$/) || [""])[0].toLowerCase();
    const accept = String(input.accept || "").toLowerCase().split(",").map((a) => a.trim()).filter(Boolean);
    const ok = !accept.length || accept.some((a) => a === ext || a === type || (a.endsWith("/*") && type.startsWith(a.slice(0, -1))));
    if (!ok) return "format";
    try {
      const view = input.ownerDocument.defaultView || window;
      const data = new view.DataTransfer();
      data.items.add(new view.File([cv.blob], cv.name, { type }));
      input.files = data.files;
      input.dispatchEvent(new view.Event("input", { bubbles: true, composed: true }));
      input.dispatchEvent(new view.Event("change", { bubbles: true, composed: true }));
      return input.files.length ? "attached" : "failed";
    } catch (e) {
      return "failed";
    }
  }

  // Champs obligatoires encore vides (listes, cases à cocher, pièces jointes…), à compléter par le candidat.
  function requiredLeft(a) {
    const need = (el) => el.required || el.getAttribute("aria-required") === "true";
    let left = 0;
    for (const el of a.controls) if (need(el) && !String(el.value || "").trim()) left++;
    for (const el of a.uploads) if (need(el) && !(el.files && el.files.length)) left++;
    const radios = new Map();
    for (const el of a.checks) {
      if (el.type === "checkbox") {
        if (need(el) && !el.checked) left++;
      } else {
        const key = el.name || el;
        const group = radios.get(key) || { need: false, checked: false };
        group.need ||= need(el);
        group.checked ||= el.checked;
        radios.set(key, group);
      }
    }
    for (const group of radios.values()) if (group.need && !group.checked) left++;
    return left;
  }

  function scan() {
    const a = analyze();
    return { kinds: [...new Set(a.fields.map((f) => f.kind))], cv: !!a.cv, frames: a.frames };
  }

  // Remplit les champs reconnus encore vides (ou remplis par Sophia Jobs et non retouchés depuis).
  function fill(req) {
    const a = analyze();
    const values = req.values || {};
    const filled = [];
    const skipped = [];
    const notes = [];
    let first = null;
    for (const f of a.fields) {
      const value = String(valueFor(f, values) || "").trim();
      if (!value) {
        skipped.push({ kind: f.kind, reason: "missing" });
        continue;
      }
      const current = f.el.value;
      if (current.trim() && current !== state.mine.get(f.el)) {
        skipped.push({ kind: f.kind, reason: "filled" });
        continue;
      }
      const done = write(f.el, value, f.kind);
      if (!done.ok) {
        skipped.push({ kind: f.kind, reason: done.reason });
        continue;
      }
      state.mine.set(f.el, f.el.value);
      glow(f.el);
      filled.push(f.kind);
      if (done.note) notes.push(done.note);
      first ||= f.el;
    }
    const cv = attachCv(a.cv, req.cv);
    if (cv === "attached") {
      const zone = a.cv.getBoundingClientRect().width ? a.cv : a.cv.parentElement;
      if (zone) glow(zone);
      first ||= zone;
    }
    if (first) {
      const r = first.getBoundingClientRect();
      const view = first.ownerDocument.defaultView || window;
      if (r.top < 0 || r.bottom > view.innerHeight) first.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    return { filled, skipped, notes, cv, frames: a.frames, requiredLeft: requiredLeft(a) };
  }

  // Bandeau dans la page, isolé du style du site (shadow DOM fermé, styles posés un à un : la CSP
  // de certains sites bloque les balises <style> ajoutées).
  function toast(lines, action, onAction) {
    if (state.toast) state.toast.remove();
    const make = (tag, rules, text) => {
      const el = document.createElement(tag);
      for (const [k, v] of Object.entries(rules)) el.style.setProperty(k, v, "important");
      if (text) el.textContent = text;
      return el;
    };
    const host = make("sophia-jobs-toast", { position: "fixed", right: "16px", bottom: "16px", "z-index": "2147483647", display: "block", width: "340px", "max-width": "calc(100vw - 32px)", margin: "0", padding: "0", border: "0" });
    const root = host.attachShadow({ mode: "closed" });
    const box = make("div", { "box-sizing": "border-box", background: "#fff", color: "#0f172a", "border-left": "4px solid #2563eb", "border-radius": "10px", "box-shadow": "0 12px 32px rgba(15,23,42,.28)", padding: "12px 14px", font: "14px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif", "text-align": "left" });
    box.setAttribute("role", "status");
    const head = make("div", { display: "flex", "align-items": "center", "justify-content": "space-between", gap: "8px", "margin-bottom": "4px", "font-weight": "700", color: "#1d4ed8" });
    const close = make("button", { background: "none", border: "0", padding: "0 4px", cursor: "pointer", color: "#64748b", font: "22px/1 system-ui,sans-serif" }, "×");
    close.type = "button";
    close.setAttribute("aria-label", "Fermer");
    close.addEventListener("click", () => host.remove());
    head.append(make("span", {}, "Sophia Jobs"), close);
    box.append(head);
    for (const line of lines) box.append(make("div", { margin: "2px 0" }, line));
    if (action) {
      const button = make("button", { "margin-top": "10px", padding: "8px 14px", border: "0", "border-radius": "8px", background: "#2563eb", color: "#fff", cursor: "pointer", font: "600 14px/1.2 system-ui,sans-serif" }, action);
      button.type = "button";
      button.addEventListener("click", () => {
        host.remove();
        onAction();
      });
      box.append(button);
    }
    root.append(box);
    (document.body || document.documentElement).append(host);
    state.toast = host;
    if (!action) setTimeout(() => host.remove(), 9000);
    return host;
  }

  // Requêtes de la fenêtre Sophia Jobs, reçues sur le canal privé ; chaque réponse reprend l'id.
  function serve(port, msg) {
    if (!msg || typeof msg !== "object") return;
    let reply;
    try {
      if (msg.type === "fill") reply = fill(msg);
      else if (msg.type === "scan") reply = scan();
      else if (msg.type === "toast") {
        toast(Array.isArray(msg.lines) ? msg.lines.map(String) : []);
        reply = {};
      } else reply = { error: "unknown" };
    } catch (err) {
      reply = { error: String((err && err.message) || err) };
    }
    port.postMessage({ ...reply, id: msg.id });
  }

  // Seule la fenêtre Sophia Jobs (vérifiée par son origine) obtient un canal ; un nouveau à chaque appel.
  function onMessage(e) {
    const data = e.data;
    if (e.origin !== APP || !data || data.type !== "sophia-jobs:hello" || !e.source) return;
    e.stopImmediatePropagation();
    const channel = new MessageChannel();
    channel.port1.onmessage = (m) => serve(channel.port1, m.data);
    try {
      e.source.postMessage({ type: "sophia-jobs:ready", v: cfg.v, url: location.href, title: document.title, scan: scan() }, APP, [channel.port2]);
    } catch (err) {
      channel.port1.close();
    }
  }
  if (state.listener) window.removeEventListener("message", state.listener, true);
  state.listener = onMessage;
  window.addEventListener("message", onMessage, true);

  const width = 460;
  const height = Math.max(480, Math.min(820, (screen.availHeight || 900) - 60));
  const left = Math.max(0, (window.screenX || 0) + (window.outerWidth || 1280) - width - 24);
  const top = Math.max(0, (window.screenY || 0) + 64);
  const url = APP + "/remplir.html#o=" + encodeURIComponent(location.origin) + "&v=" + cfg.v + "&k=" + encodeURIComponent(cfg.k) + "&t=" + Date.now();
  const open = () => {
    const win = window.open(url, "sophia-jobs-fill", "popup,width=" + width + ",height=" + height + ",left=" + left + ",top=" + top);
    if (win) {
      try {
        win.focus();
      } catch (e) {}
    }
    return win;
  };
  if (!open()) toast(["Votre navigateur a bloqué la fenêtre Sophia Jobs."], "Ouvrir la fenêtre Sophia Jobs", open);
}
