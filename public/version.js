const versionEl = document.getElementById("site-version");

if (versionEl) {
  fetch("/api/version")
    .then((response) => {
      if (!response.ok) throw new Error(`version HTTP ${response.status}`);
      return response.json();
    })
    .then(({ version, build, builtAt }) => {
      const date = builtAt
        ? new Intl.DateTimeFormat("fr-FR", {
            dateStyle: "short",
            timeStyle: "short",
            timeZone: "Europe/Paris",
          }).format(new Date(builtAt))
        : "date inconnue";
      const buildLabel = build && build !== "dev" ? build.slice(0, 7) : build;
      versionEl.textContent = `v${version} · build ${buildLabel} · livré le ${date}`;
    })
    .catch(() => {
      versionEl.textContent = "version indisponible";
    });
}
