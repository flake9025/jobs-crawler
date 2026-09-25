// Sélection éditoriale (curatée à la main) des entreprises emblématiques de Sophia
// Antipolis, organisée par catégorie pour l'onglet « Entreprises » de l'IHM.
//
// Ces fiches sont fusionnées EN PRIORITÉ dans l'annuaire (src/data/companies.js) :
// elles sont donc crawlées et interrogeables par le moteur de recherche comme toute
// autre entreprise, avec les réglages ci-dessous.
//
// Champs :
// - `site`        : site corporate.
// - `careerUrl`   : page carrières destinée à l'humain (lien « Site carrières »).
// - `careerSite`  : page (ou ATS) crawlée pour détecter les offres locales. Les ATS
//                   Workday, Phenom, Greenhouse, Lever, Recruitee, SmartRecruiters et
//                   SuccessFactors sont interrogés via leur API publique.
// - `applyUrl`    : candidature spontanée (à défaut : `careerUrl`, puis `site`).
// - `aliases`     : autres raisons sociales (annuaires, France Travail…) : elles
//                   rattachent les doublons de l'annuaire et les offres à la fiche.
//                   Jamais d'alias trop générique (« Toyota » = une concession).
// - `localOnly`   : ne garder que les offres explicitement situées dans les
//                   Alpes-Maritimes (listes nationales sans filtre de lieu fiable).
// - `crawl:false` : site non exploitable (anti-bot, application JavaScript…) : la
//                   fiche renvoie vers le site, sans afficher un « 0 offre » trompeur.
// - `tagline`     : accroche courte affichée sur la carte.

export const FEATURED_CATEGORIES = [
  {
    id: "top15",
    label: "Grands employeurs",
    description: "Les plus gros recruteurs de la technopole.",
    companies: [
      {
        name: "Amadeus",
        tagline: "Technologies du voyage — premier employeur de la technopole",
        site: "https://amadeus.com",
        careerUrl: "https://amadeus.wd502.myworkdayjobs.com/jobs",
        careerSite: "https://amadeus.wd502.myworkdayjobs.com/jobs",
        city: "Sophia Antipolis",
      },
      {
        name: "Orange",
        tagline: "Télécoms — innovation, réseaux et Orange Business",
        site: "https://orange.jobs",
        careerUrl:
          "https://orange.jobs/fr/fr/search-results?p=ChIJvUmYZ1gpzBIRlSJcMrwF10o&location=Valbonne%2C%20France",
        careerSite:
          "https://orange.jobs/fr/fr/search-results?p=ChIJvUmYZ1gpzBIRlSJcMrwF10o&location=Valbonne%2C%20France",
        city: "Sophia Antipolis",
        aliases: ["Orange Business Services", "Orange Business", "Orange Design & Build"],
      },
      {
        name: "Docaposte",
        tagline: "Numérique de confiance (groupe La Poste)",
        site: "https://www.docaposte.com",
        careerUrl: "https://docaposte-recrute.profils.org/accueil.aspx",
        careerSite: "https://docaposte-recrute.profils.org/offre-de-emploi/liste-offres.aspx",
        localOnly: true,
      },
      {
        name: "PRO BTP",
        tagline: "Protection sociale du BTP",
        site: "https://www.probtp.com",
        careerUrl:
          "https://recrute-probtp.talent-soft.com/offre-de-emploi/liste-toutes-offres.aspx?changefacet=1&facet_JobRegion=217",
        careerSite:
          "https://recrute-probtp.talent-soft.com/offre-de-emploi/liste-toutes-offres.aspx?changefacet=1&facet_JobRegion=217",
        city: "Sophia Antipolis",
        aliases: ["PROBTP"],
      },
      {
        name: "Thales",
        tagline: "Défense, spatial et cybersécurité — Sophia et Cannes",
        site: "https://www.thalesgroup.com/fr",
        careerUrl:
          "https://careers.thalesgroup.com/global/en/search-results?keywords=&from=0&s=1&rk=l-sophia-antipolis",
        careerSite: "https://thales.wd3.myworkdayjobs.com/Careers",
        aliases: ["Thales Dms France", "Thales Services", "Thales Alenia Space", "Thales SIX GTS France"],
      },
      {
        name: "SAP Labs France",
        tagline: "Éditeur de logiciels — laboratoire R&D de Mougins",
        site: "https://www.sap.com/france",
        careerUrl: "https://jobs.sap.com/go/SAP-Jobs-in-Mougins/914601/",
        applyUrl: "https://jobs.sap.com/talentcommunity/subscribe/",
        // Protégé par Cloudflare (403) : consultation sur le site uniquement.
        crawl: false,
        city: "Mougins",
        aliases: ["SAP", "SAP France", "Sap Developpement"],
      },
      {
        name: "Arm",
        tagline: "Conception de processeurs",
        site: "https://www.arm.com",
        careerUrl: "https://careers.arm.com/location/sophia-antipolis-jobs/34601/3017382-2985244-6640252/4",
        careerSite: "https://careers.arm.com/location/sophia-antipolis-jobs/34601/3017382-2985244-6640252/4",
        aliases: ["Arm France", "Arm Ltd"],
      },
      {
        name: "NXP Semiconductors",
        tagline: "Semi-conducteurs — automobile et IoT",
        site: "https://www.nxp.com",
        careerUrl: "https://nxp.wd3.myworkdayjobs.com/careers",
        careerSite: "https://nxp.wd3.myworkdayjobs.com/careers",
        aliases: ["NXP"],
      },
      {
        name: "Toyota ED²",
        tagline: "Centre de design européen de Toyota",
        site: "https://ed2.toyota-europe.com",
        careerUrl: "https://ed2.toyota-europe.com/tags/jobs.html",
        // Page carrières générée en JavaScript.
        crawl: false,
        aliases: ["Toyota Europe Design Development", "ED2"],
      },
      {
        name: "IBM",
        tagline: "Services informatiques, cloud et IA",
        site: "https://www.ibm.com/fr-fr",
        careerUrl: "https://www.ibm.com/careers/search?field_keyword_18%5B0%5D=France",
        // Moteur de recherche JavaScript.
        crawl: false,
        aliases: ["Cie Ibm France", "IBM France", "Compagnie IBM France"],
      },
      {
        name: "Urssaf Caisse nationale",
        tagline: "Sécurité sociale (ex-Acoss)",
        site: "https://www.urssaf.org",
        careerUrl: "https://www.urssaf.org/accueil/carrieres/nous-rejoindre/nos-offres-d-emploi.html",
        // Offres publiées sur lasecurecrute.fr, sans liste exploitable par commune.
        crawl: false,
        aliases: ["Acoss", "Urssaf"],
      },
      {
        name: "GIEPS (ASAF-AFPS)",
        tagline: "Protection sociale — groupement ASAF et AFPS",
        site: "https://carriere.gieps.fr",
        careerUrl: "https://carriere.gieps.fr/fr/offres",
        careerSite: "https://carriere.gieps.fr/fr/offres",
        applyUrl: "https://carriere.gieps.fr/fr/offres/candidature-spontanee-4db8f1",
        city: "Sophia Antipolis",
        aliases: ["GIEPS", "ASAF", "AFPS", "Asaf Ass Sante Action Familial"],
      },
      {
        name: "Air France",
        tagline: "Compagnie aérienne — centre informatique de Valbonne",
        site: "https://www.airfrance.fr",
        careerUrl: "https://recrutement.airfrance.com/offre-de-emploi/liste-offres.aspx",
        careerSite: "https://recrutement.airfrance.com/offre-de-emploi/liste-offres.aspx",
        city: "Valbonne",
        aliases: ["Societe Air France", "Air France KLM"],
      },
      {
        name: "Ampère (Renault Group)",
        tagline: "Logiciel embarqué et véhicule électrique",
        site: "https://www.ampere.cars",
        careerUrl: "https://alliancewd.wd3.myworkdayjobs.com/en-US/renault-group-careers",
        careerSite: "https://alliancewd.wd3.myworkdayjobs.com/en-US/renault-group-careers",
        aliases: ["Ampère", "Renault Sw Labs", "Renault Software Labs"],
      },
      {
        name: "Synopsys",
        tagline: "Logiciels de conception électronique",
        site: "https://www.synopsys.com",
        careerUrl:
          "https://careers.synopsys.com/location/sophia-antipolis-provence-alpes-cote-d-azur-region-france-jobs/44408/3017382-2985244-6640252/4",
        careerSite:
          "https://careers.synopsys.com/location/sophia-antipolis-provence-alpes-cote-d-azur-region-france-jobs/44408/3017382-2985244-6640252/4",
      },
    ],
  },
  {
    id: "startups",
    label: "Startups",
    description: "Jeunes pousses en croissance.",
    companies: [
      {
        name: "Symphony",
        tagline: "Messagerie sécurisée pour la finance",
        site: "https://symphony.com",
        careerUrl: "https://symphony.com/company/careers/",
        careerSite: "https://boards.greenhouse.io/symphony",
        aliases: ["Symphony Communication", "Symphony Communication Sce France"],
      },
      {
        name: "Instant System",
        tagline: "Applications de mobilité (MaaS)",
        site: "https://www.instant-system.com",
        careerUrl: "https://instantsystem.recruitee.com/",
        careerSite: "https://instantsystem.recruitee.com/",
        city: "Biot",
      },
      {
        name: "AKT (Vancelian)",
        tagline: "Fintech — épargne et actifs numériques",
        site: "https://vancelian.com",
        careerUrl: "https://vancelian.com/careers",
        // Application JavaScript.
        crawl: false,
        aliases: ["AKT", "Akt.io", "Vancelian"],
      },
    ],
  },
  {
    id: "esn-majeures",
    label: "Grandes ESN",
    description: "Grands groupes de conseil et de services numériques.",
    companies: [
      {
        name: "Atos",
        tagline: "Services numériques (Atos, Eviden)",
        site: "https://atos.net",
        careerUrl: "https://jobs.atos.net/search/?locationsearch=valbonne",
        careerSite:
          "https://jobs.atos.net/search/?createNewAlert=false&q=&locationsearch=valbonne&optionsFacetsDD_country=&optionsFacetsDD_city=&optionsFacetsDD_customfield2=",
        aliases: ["Atos Integration", "Eviden"],
      },
      {
        name: "Alten",
        tagline: "Ingénierie et conseil en technologies",
        site: "https://www.alten.fr",
        careerUrl: "https://www.alten.fr/carriere/jobs/?search=sophia",
        applyUrl: "https://www.alten.fr/carriere/candidature-spontanee/",
        // Protection anti-bot (403).
        crawl: false,
      },
      {
        name: "Sopra Steria",
        tagline: "Conseil et services numériques",
        site: "https://www.soprasteria.fr",
        careerUrl: "https://careers.soprasteria.com/jobs?options=252",
        careerSite: "https://careers.soprasteria.com/jobs?options=252",
        aliases: ["Sopra Steria Infrastructure & Security"],
      },
      {
        name: "Capgemini",
        tagline: "Conseil, technologies et ingénierie",
        site: "https://www.capgemini.com/fr-fr",
        careerUrl: "https://jobs.capgemini.com/fr-fr/?search=Sophia",
        // Moteur de recherche JavaScript.
        crawl: false,
        aliases: ["Capgemini Technology Services", "Capgemini Engineering"],
      },
      {
        name: "Randstad Digital",
        tagline: "Services numériques et ingénierie (ex-Ausy)",
        site: "https://www.randstaddigital.fr",
        careerUrl: "https://www.randstaddigital.fr/fr/carrieres/toutes-nos-offres/",
        careerSite: "https://www.randstaddigital.fr/fr/carrieres/toutes-nos-offres/",
        localOnly: true,
        // Jamais « Randstad » seul : ce sont les agences d'intérim.
        aliases: ["Ausy", "Ausy Technology"],
      },
      {
        name: "Abylsen",
        tagline: "Conseil en ingénierie et informatique",
        site: "https://www.abylsen.com",
        careerUrl: "https://jobs.abylsen.com/fr/offers?city=Valbonne",
        // Application JavaScript.
        crawl: false,
        aliases: ["Abylsen Sud"],
      },
      {
        name: "Infotel",
        tagline: "Services numériques et logiciels",
        site: "https://infotel.com",
        careerUrl: "https://infotel.com/offre-d-emploi/?filter_job_localisation=1997",
        careerSite: "https://infotel.com/offre-d-emploi/?filter_job_localisation=1997",
        applyUrl: "https://infotel.com/candidature-spontanee/",
        aliases: ["Infotel Conseil"],
      },
      {
        name: "CGI",
        tagline: "Conseil et services informatiques",
        site: "https://www.cgi.com/france/fr-fr",
        careerUrl: "https://www.cgi.com/france/fr-fr/recrute",
        // Offres sur un ATS protégé par captcha.
        crawl: false,
        aliases: ["CGI Business Consulting"],
      },
      {
        name: "Akkodis",
        tagline: "Ingénierie et services numériques (ex-Akka, Modis)",
        site: "https://www.akkodis.com/fr-fr",
        careerUrl: "https://akka-cand.talent-soft.com/accueil.aspx?LCID=1036",
        careerSite:
          "https://akka-cand.talent-soft.com/offre-de-emploi/liste-offres.aspx?changefacet=1&facet_JobRegion=217",
        localOnly: true,
        aliases: ["Akka Technologies", "Akka I&S", "Akka Ingenierie Produit", "Akka Services"],
      },
    ],
  },
  {
    id: "esn-montantes",
    label: "ESN montantes",
    description: "Cabinets en forte croissance, souvent nés à Sophia.",
    companies: [
      {
        name: "Fenyx Consult",
        tagline: "ESN sophipolitaine",
        site: "https://www.fenyx.fr",
        careerUrl: "https://www.fenyx.fr/fr/offres-emploi-it-esn.htm",
        careerSite: "https://www.fenyx.fr/fr/offres-emploi-it-esn.htm",
        applyUrl: "https://www.fenyx.fr/fr/candidature-spontanee.htm",
        city: "Sophia Antipolis",
        aliases: ["Fenyx", "Fenyx Tech"],
      },
      {
        name: "Faseya",
        tagline: "Conseil et ingénierie informatique",
        site: "https://faseya.com",
        careerUrl: "https://faseya.com",
        // Pas de liste d'offres publique.
        crawl: false,
      },
      {
        name: "Heliaq",
        tagline: "Conseil en ingénierie",
        site: "https://heliaq.fr",
        careerUrl: "https://heliaq.fr/carrieres/",
        // Offres sur un ATS JavaScript.
        crawl: false,
      },
      {
        name: "Inovelya",
        tagline: "Conseil et services numériques",
        site: "https://www.inovelya.com",
        careerUrl: "https://www.inovelya.com/carrieres",
        // Application JavaScript.
        crawl: false,
      },
      {
        name: "Inov Team",
        tagline: "ESN sophipolitaine",
        site: "https://www.inov-team.fr",
        careerUrl: "https://www.inov-team.fr/offres",
        careerSite: "https://www.inov-team.fr/offres",
        aliases: ["Inovteam"],
      },
    ],
  },
];

/** Fiches vedettes à plat, avec leur catégorie (`featured`). */
export const FEATURED_COMPANIES = FEATURED_CATEGORIES.flatMap((cat) =>
  cat.companies.map((c) => ({ ...c, featured: cat.id }))
);
