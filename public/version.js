// Pied de page (version affichée) et détection d'une nouvelle version déployée.
//
// Un chargement récupère toujours la dernière version (le serveur impose la revalidation
// des fichiers), mais une page restée ouverte, ou l'application installée reprise depuis
// l'arrière-plan, garde l'ancienne en mémoire : la version est revérifiée à chaque retour
// sur la page et un bandeau propose de recharger. Pas de rechargement forcé, qui ferait
// perdre une saisie en cours.
const versionEl = document.getElementById("site-version");
const CHECK_EVERY_MS = 10 * 60 * 1000;
const MIN_GAP_MS = 60 * 1000;

let loadedBuild = null;
let lastCheck = 0;

const buildKey = ({ version, build, builtAt }) => `${version}|${build}|${builtAt}`;

function versionLabel({ version, build, builtAt }) {
  const date = builtAt
    ? new Intl.DateTimeFormat("fr-FR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Europe/Paris",
      }).format(new Date(builtAt))
    : "date inconnue";
  const buildLabel = build && build !== "dev" ? build.slice(0, 7) : build;
  return `v${version} · build ${buildLabel} · livré le ${date}`;
}

function showUpdateBanner() {
  if (document.getElementById("update-banner")) return;
  const banner = document.createElement("div");
  banner.id = "update-banner";
  banner.className = "update-banner";
  banner.setAttribute("role", "status");
  const text = document.createElement("span");
  text.textContent = "Nouvelle version disponible";
  const reload = document.createElement("button");
  reload.type = "button";
  reload.className = "btn btn-primary btn-sm";
  reload.textContent = "Recharger";
  reload.addEventListener("click", () => location.reload());
  banner.append(text, reload);
  document.body.append(banner);
}

async function checkVersion() {
  lastCheck = Date.now();
  try {
    const response = await fetch("/api/version", { cache: "no-store" });
    if (!response.ok) throw new Error(`version HTTP ${response.status}`);
    const info = await response.json();
    if (!loadedBuild) {
      loadedBuild = buildKey(info);
      if (versionEl) versionEl.textContent = versionLabel(info);
    } else if (buildKey(info) !== loadedBuild) {
      showUpdateBanner();
    }
  } catch {
    if (versionEl && !loadedBuild) versionEl.textContent = "version indisponible";
  }
}

function checkIfDue() {
  if (document.visibilityState !== "visible" || Date.now() - lastCheck < MIN_GAP_MS) return;
  checkVersion();
}

checkVersion();
document.addEventListener("visibilitychange", checkIfDue);
window.addEventListener("focus", checkIfDue);
window.addEventListener("pageshow", (e) => e.persisted && checkIfDue());
setInterval(checkIfDue, CHECK_EVERY_MS);
