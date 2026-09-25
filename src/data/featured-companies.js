// Sélection éditoriale (curatée à la main) d'entreprises emblématiques de Sophia
// Antipolis, organisée par catégorie pour l'onglet "Entreprises" de l'IHM.
//
// - `site` : site corporate (utilisé pour la candidature spontanée si aucune page
//   dédiée n'est connue).
// - `careerUrl` : page carrières / offres, utilisée pour le bouton « Voir les offres »
//   quand le cache interne n'a rien détecté pour cette entreprise.
// - `applyUrl` : page dédiée à la candidature spontanée quand elle existe (sinon on
//   retombe sur `careerUrl` puis `site`).

export const FEATURED_CATEGORIES = [
  {
    id: "top15",
    label: "Grandes entreprises",
    description: "Les plus gros employeurs de la technopole.",
    companies: [
      { name: "Amadeus", site: "https://amadeus.com", careerUrl: "https://amadeus.wd502.myworkdayjobs.com/jobs" },
      { name: "Orange", site: "https://orange.jobs", careerUrl: "https://orange.jobs/fr/fr/search-results?location=Valbonne%2C%20France" },
      { name: "Docaposte", site: "https://www.docaposte.com", careerUrl: "https://www.docaposte.com/carrieres" },
      { name: "PRO BTP", site: "https://probtp.com", careerUrl: "https://recrute-probtp.talent-soft.com/offre-de-emploi/liste-toutes-offres.aspx" },
      { name: "Thales", site: "https://www.thalesgroup.com", careerUrl: "https://www.thalesgroup.com/fr/carrieres" },
      { name: "SAP Labs France", site: "https://www.sap.com/france", careerUrl: "https://jobs.sap.com/search/?q=&locationsearch=Sophia%20Antipolis" },
      { name: "Arm", site: "https://www.arm.com", careerUrl: "https://careers.arm.com/" },
      { name: "NXP Semiconductors", site: "https://www.nxp.com", careerUrl: "https://www.nxp.com/company/about-nxp/careers:CAREERS" },
      { name: "Toyota Motor Europe", site: "https://www.toyota.fr", careerUrl: "https://www.toyota-europe.com/careers" },
      { name: "IBM", site: "https://www.ibm.com/fr-fr", careerUrl: "https://www.ibm.com/careers/search?field_keyword_08%5B0%5D=Sophia%20Antipolis" },
      { name: "Acoss / Urssaf", site: "https://www.urssaf.org", careerUrl: "https://www.acoss.urssaf.fr/home/nous-connaitre/rejoignez-nous.html" },
      { name: "GIEPS (ASAF-AFPS)", site: "https://carriere.gieps.fr", careerUrl: "https://carriere.gieps.fr/fr/gieps/offers" },
      { name: "Cisco Systems France", site: "https://www.cisco.com/c/fr_fr/index.html", careerUrl: "https://jobs.cisco.com/jobs/SearchJobs/Sophia%20Antipolis" },
      { name: "Galderma", site: "https://www.galderma.com", careerUrl: "https://jobs.galderma.com/" },
      { name: "Intersec", site: "https://www.intersec.com", careerUrl: "https://www.intersec.com/careers/" },
    ],
  },
  {
    id: "startups",
    label: "Startups",
    description: "Jeunes pousses en croissance de la technopole.",
    companies: [
      { name: "Symphony", site: "https://symphony.com", careerUrl: "https://symphony.com/careers/" },
      { name: "Instant System", site: "https://www.instant-system.com", careerUrl: "https://www.instant-system.com/carrieres/" },
      { name: "AKT (Vancelian)", site: "https://www.vancelian.com", careerUrl: "https://www.vancelian.com/carrieres" },
    ],
  },
  {
    id: "esn-majeures",
    label: "Grandes ESN",
    description: "Grands cabinets de conseil et ESN nationales.",
    companies: [
      { name: "Atos", site: "https://atos.net", careerUrl: "https://jobs.atos.net/search/?locationsearch=valbonne" },
      { name: "Alten", site: "https://www.alten.fr", careerUrl: "https://www.alten.fr/nos-offres-emploi/" },
      { name: "Sopra Steria", site: "https://www.soprasteria.com/fr", careerUrl: "https://www.soprasteria.com/fr/carrieres" },
      { name: "Capgemini", site: "https://www.capgemini.com/fr-fr", careerUrl: "https://www.capgemini.com/fr-fr/carrieres/nos-offres-demploi/" },
      { name: "Ausy (Randstad Digital)", site: "https://www.randstaddigital.fr", careerUrl: "https://www.randstaddigital.fr/nos-offres-demploi/" },
      { name: "Abylsen", site: "https://www.abylsen.com", careerUrl: "https://www.abylsen.com/nos-offres-demploi/" },
      { name: "Infotel", site: "https://www.infotel.com", careerUrl: "https://www.infotel.com/carrieres/nos-offres/" },
      { name: "CGI", site: "https://www.cgi.com/fr/fr", careerUrl: "https://www.cgi.com/fr/fr/carrieres" },
      { name: "Akkodis", site: "https://www.akkodis.com/fr", careerUrl: "https://www.akkodis.com/fr/nos-offres-demploi" },
    ],
  },
  {
    id: "esn-montantes",
    label: "ESN montantes",
    description: "ESN en forte croissance, souvent fondées par des Sophipolitains.",
    companies: [
      { name: "Fenyx Consult", site: "https://fenyx.fr", careerUrl: "https://fenyx.fr/carrieres/" },
      { name: "Faseya", site: "https://faseya.fr", careerUrl: "https://faseya.fr/esn-france" },
      { name: "Heliaq", site: "https://heliaq.fr", careerUrl: "https://heliaq.fr/nos-agences/sophia-antipolis/" },
      { name: "Inovelya", site: "https://www.inovelya.com", careerUrl: "https://inovelya.com/carrieres" },
      { name: "Inov Team", site: "https://www.inov-team.fr", careerUrl: "https://www.inov-team.fr/offres" },
    ],
  },
];
