/* =====================================================
   FOOTBALL EXPERT PRO
   Moteur de pronostics statistiques
   Source de données : TheSportsDB
   ===================================================== */

const API_KEY = "123";
const API = `https://www.thesportsdb.com/api/v1/json/${API_KEY}`;

const LEAGUES = [
  { name: "Premier League", id: "4328" },
  { name: "La Liga", id: "4335" },
  { name: "Bundesliga", id: "4331" },
  { name: "Serie A", id: "4332" },
  { name: "Ligue 1", id: "4334" },
  { name: "Champions League", id: "4480" }
];

const $ = id => document.getElementById(id);

let allMatches = [];
let charts = {};

function showMessage(element, message, type = "") {
  if (!element) return;
  element.textContent = message;
  element.className = type;
}

async function apiRequest(endpoint) {
  const response = await fetch(`${API}/${endpoint}`);
  if (!response.ok) throw new Error("Erreur de connexion à la source de données.");
  const data = await response.json();
  return data;
}

function getEvents(data) {
  return data?.results || data?.events || [];
}

function validScore(event) {
  return event &&
    event.intHomeScore !== null &&
    event.intAwayScore !== null &&
    event.intHomeScore !== "" &&
    event.intAwayScore !== "" &&
    Number.isFinite(Number(event.intHomeScore)) &&
    Number.isFinite(Number(event.intAwayScore));
}

/* ------------------ MATCHS À VENIR ------------------ */

async function loadMatches() {
  const list = $("matchList");
  if (list) list.innerHTML = "<p>Chargement des matchs...</p>";

  allMatches = [];

  try {
    const results = await Promise.all(
      LEAGUES.map(async league => {
        try {
          const data = await apiRequest(
            `eventsnextleague.php?id=${league.id}`
          );
          return getEvents(data).map(event => ({
            ...event,
            leagueName: league.name
          }));
        } catch (error) {
          console.warn("Championnat indisponible :", league.name, error);
          return [];
        }
      })
    );

    const unique = new Map();

    results.flat().forEach(match => {
      if (match.idEvent) unique.set(match.idEvent, match);
    });

    allMatches = [...unique.values()];

    allMatches.sort((a, b) => {
      const dateA = new Date(`${a.date || ""}T${a.strTime || "00:00:00"}`);
      const dateB = new Date(`${b.date || ""}T${b.strTime || "00:00:00"}`);
      return dateA - dateB;
    });

    renderMatches();

    if ($("matchCount")) $("matchCount").textContent = allMatches.length;
    if ($("leagueCount")) {
      const count = new Set(allMatches.map(m => m.leagueName)).size;
      $("leagueCount").textContent = count;
    }
  } catch (error) {
    if (list) list.innerHTML =
      "<p>Impossible de charger les matchs. Réessaie plus tard.</p>";
  }
}

function renderMatches() {
  const list = $("matchList");
  if (!list) return;

  if (!allMatches.length) {
    list.innerHTML = "<p>Aucun match disponible pour le moment.</p>";
    return;
  }

  list.innerHTML = allMatches.map(match => `
    <article class="match-card">
      <small>${escapeHTML(match.leagueName || "Football")}</small>
      <h3>${escapeHTML(match.strHomeTeam || "Équipe domicile")}
        - ${escapeHTML(match.strAwayTeam || "Équipe extérieure")}</h3>
      <p>${escapeHTML(match.date || "")} ${escapeHTML(match.strTime || "")}</p>
      <button type="button"
        data-home="${escapeAttr(match.strHomeTeam || "")}"
        data-away="${escapeAttr(match.strAwayTeam || "")}">
        Analyser ce match
      </button>
    </article>
  `).join("");

  list.querySelectorAll("button[data-home]").forEach(button => {
    button.addEventListener("click", () => {
      if ($("manualHome")) $("manualHome").value = button.dataset.home;
      if ($("manualAway")) $("manualAway").value = button.dataset.away;
      analyzeMatch(button.dataset.home, button.dataset.away);
    });
  });
}

/* ------------------ RECHERCHE DES ÉQUIPES ------------------ */

async function searchTeam(teamName) {
  const data = await apiRequest(
    `searchteams.php?t=${encodeURIComponent(teamName)}`
  );

  const teams = data?.teams || [];
  if (!teams.length) return null;

  const normalized = normalize(teamName);

  return teams.find(team =>
    normalize(team.strTeam) === normalized
  ) || teams[0];
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

async function getTeamHistory(teamName) {
  const team = await searchTeam(teamName);

  if (!team || !team.idTeam) {
    throw new Error(`Équipe introuvable : ${teamName}`);
  }

  const data = await apiRequest(`eventslast.php?id=${team.idTeam}`);

  const events = getEvents(data)
    .filter(validScore)
    .filter(event =>
      event.idHomeTeam === team.idTeam ||
      event.idAwayTeam === team.idTeam
    )
    .sort((a, b) => {
      const dateA = new Date(a.date || 0);
      const dateB = new Date(b.date || 0);
      return dateB - dateA;
    })
    .slice(0, 5);

  return {
    teamId: team.idTeam,
    teamName: team.strTeam,
    events
  };
}

/* ------------------ STATISTIQUES ------------------ */

function getTeamStats(events, teamId) {
  let goalsFor = 0;
  let goalsAgainst = 0;
  let wins = 0;
  let draws = 0;
  let losses = 0;

  events.forEach(event => {
    const home = Number(event.intHomeScore);
    const away = Number(event.intAwayScore);
    const isHome = event.idHomeTeam === teamId;

    const scored = isHome ? home : away;
    const conceded = isHome ? away : home;

    goalsFor += scored;
    goalsAgainst += conceded;

    if (scored > conceded) wins++;
    else if (scored === conceded) draws++;
    else losses++;
  });

  const played = events.length;

  return {
    played,
    goalsFor,
    goalsAgainst,
    wins,
    draws,
    losses,
    averageFor: played ? goalsFor / played : 0,
    averageAgainst: played ? goalsAgainst / played : 0
  };
}

function displayLastFive(containerId, team) {
  const container = $(containerId);
  if (!container) return;

  container.innerHTML = team.events.map(event => {
    const isHome = event.idHomeTeam === team.teamId;
    const opponent = isHome ? event.strAwayTeam : event.strHomeTeam;
    const scored = isHome ? event.intHomeScore : event.intAwayScore;
    const conceded = isHome ? event.intAwayScore : event.intHomeScore;

    let result = "N";
    if (Number(scored) > Number(conceded)) result = "V";
    if (Number(scored) < Number(conceded)) result = "D";

    return `
      <div class="last-match">
        <span>${escapeHTML(opponent || "Adversaire")}</span>
        <strong>${scored} - ${conceded}</strong>
        <b>${result}</b>
      </div>
    `;
  }).join("");
}

/* ------------------ MODÈLE DE POISSON ------------------ */

function factorial(number) {
  if (number <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= number; i++) result *= i;
  return result;
}

function poisson(lambda, goals) {
  return (
    Math.exp(-lambda) *
    Math.pow(lambda, goals) /
    factorial(goals)
  );
}

function calculatePredictions(homeStats, awayStats) {
  /*
    Estimation simple à partir des buts marqués et encaissés
    sur les cinq derniers matchs. Ce n'est pas une garantie.
  */

  const homeLambda = Math.max(
    0.15,
    Math.min(4.5,
      (homeStats.averageFor + awayStats.averageAgainst) / 2
    )
  );

  const awayLambda = Math.max(
    0.15,
    Math.min(4.5,
      (awayStats.averageFor + homeStats.averageAgainst) / 2
    )
  );

  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  let bttsYes = 0;
  let over25 = 0;
  const scores = [];

  for (let h = 0; h <= 8; h++) {
    for (let a = 0; a <= 8; a++) {
      const probability = poisson(homeLambda, h) *
        poisson(awayLambda, a);

      if (h > a) homeWin += probability;
      else if (h === a) draw += probability;
      else awayWin += probability;

      if (h > 0 && a > 0) bttsYes += probability;
      if (h + a >= 3) over25 += probability;

      scores.push({
        score: `${h}-${a}`,
        probability
      });
    }
  }

  const total = homeWin + draw + awayWin;

  scores.sort((a, b) => b.probability - a.probability);

  return {
    homeLambda,
    awayLambda,
    homeWin: homeWin / total,
    draw: draw / total,
    awayWin: awayWin / total,
    bttsYes,
    bttsNo: 1 - bttsYes,
    over25,
    under25: 1 - over25,
    scores: scores.slice(0, 10)
  };
}

/* ------------------ ANALYSE PRINCIPALE ------------------ */

async function analyzeMatch(homeName, awayName) {
  const output = $("analysisContent");

  if (!homeName || !awayName) {
    showMessage(output, "Entre le nom des deux équipes.");
    return;
  }

  if (normalize(homeName) === normalize(awayName)) {
    showMessage(output, "Choisis deux équipes différentes.");
    return;
  }

  if (output) output.innerHTML = "<p>Analyse des deux équipes en cours...</p>";

  try {
    const [home, away] = await Promise.all([
      getTeamHistory(homeName),
      getTeamHistory(awayName)
    ]);

    displayLastFive("homeLastFive", home);
    displayLastFive("awayLastFive", away);

    if (home.events.length < 5 || away.events.length < 5) {
      const message =
        `Analyse impossible : ${home.teamName} possède ${home.events.length}/5 matchs ` +
        `et ${away.teamName} possède ${away.events.length}/5 matchs exploitables. ` +
        "Aucun pronostic ne sera inventé.";

      if (output) output.innerHTML = `<p>${escapeHTML(message)}</p>`;
      if ($("botAdvice")) $("botAdvice").textContent = message;
      return;
    }

    const homeStats = getTeamStats(home.events, home.teamId);
    const awayStats = getTeamStats(away.events, away.teamId);

    const prediction = calculatePredictions(homeStats, awayStats);

    renderAnalysis(home, away, homeStats, awayStats, prediction);
    saveHistory({
      date: new Date().toISOString(),
      home: home.teamName,
      away: away.teamName,
      prediction
    });

    updateDashboard();
  } catch (error) {
    console.error(error);
    if (output) {
      output.innerHTML =
        `<p>${escapeHTML(error.message || "Erreur pendant l'analyse.")}</p>`;
    }
  }
}

/* ------------------ AFFICHAGE DES PRONOSTICS ------------------ */

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function renderAnalysis(home, away, hs, as, p) {
  const output = $("analysisContent");

  if (output) {
    output.innerHTML = `
      <h2>${escapeHTML(home.teamName)} - ${escapeHTML(away.teamName)}</h2>
      <p>Matchs étudiés : 5 derniers matchs par équipe</p>

      <h3>Pronostic 1X2</h3>
      <div class="prediction-grid">
        <div>1 (domicile)<strong>${percent(p.homeWin)}</strong></div>
        <div>X (nul)<strong>${percent(p.draw)}</strong></div>
        <div>2 (extérieur)<strong>${percent(p.awayWin)}</strong></div>
      </div>

      <h3>BTTS</h3>
      <p>Oui : <strong>${percent(p.bttsYes)}</strong></p>
      <p>Non : <strong>${percent(p.bttsNo)}</strong></p>

      <h3>Over / Under 2,5</h3>
      <p>Over 2,5 : <strong>${percent(p.over25)}</strong></p>
      <p>Under 2,5 : <strong>${percent(p.under25)}</strong></p>

      <h3>Les 10 scores exacts les plus probables</h3>
      <ol>
        ${p.scores.map(s =>
          `<li>${s.score} : <strong>${percent(s.probability)}</strong></li>`
        ).join("")}
      </ol>

      <p class="disclaimer">
        Estimations statistiques basées sur les cinq derniers matchs disponibles.
        Elles ne garantissent pas le résultat réel.
      </p>
    `;
  }

  if ($("scorePredictions")) {
    $("scorePredictions").innerHTML = p.scores.map(s =>
      `<div>${s.score} — ${percent(s.probability)}</div>`
    ).join("");
  }

  if ($("botAdvice")) {
    const best = [
      ["1", p.homeWin],
      ["X", p.draw],
      ["2", p.awayWin]
    ].sort((a, b) => b[1] - a[1])[0];

    $("botAdvice").textContent =
      `Issue la plus probable : ${best[0]} (${percent(best[1])}). ` +
      `Buts attendus estimés : ${p.homeLambda.toFixed(2)} - ${p.awayLambda.toFixed(2)}. ` +
      "Ce résultat reste incertain.";
  }

  if ($("analysisCount")) {
    $("analysisCount").textContent = getHistory().length + 1;
  }

  drawAnalysisCharts(p, home.teamName, away.teamName, hs, as);
}

/* ------------------ GRAPHIQUES ------------------ */

function createChart(id, config) {
  const canvas = $(id);
  if (!canvas || typeof Chart === "undefined") return;

  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(canvas, config);
}

function drawAnalysisCharts(p, homeName, awayName, hs, as) {
  createChart("resultChart", {
    type: "bar",
    data: {
      labels: ["1", "Nul", "2"],
      datasets: [{
        label: "Probabilité (%)",
        data: [
          p.homeWin * 100,
          p.draw * 100,
          p.awayWin * 100
        ]
      }]
    },
    options: { responsive: true, scales: { y: { beginAtZero: true, max: 100 } } }
  });

  createChart("goalsChart", {
    type: "bar",
    data: {
      labels: ["Buts marqués", "Buts encaissés"],
      datasets: [
        {
          label: homeName,
          data: [hs.averageFor, hs.averageAgainst]
        },
        {
          label: awayName,
          data: [as.averageFor, as.averageAgainst]
        }
      ]
    },
    options: { responsive: true }
  });

  createChart("scoreChart", {
    type: "bar",
    data: {
      labels: p.scores.map(s => s.score),
      datasets: [{
        label: "Probabilité (%)",
        data: p.scores.map(s => s.probability * 100)
      }]
    },
    options: { responsive: true }
  });
}

/* ------------------ HISTORIQUE ------------------ */

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem("fep_history") || "[]");
  } catch {
    return [];
  }
}

function saveHistory(item) {
  const history = getHistory();
  history.unshift(item);
  localStorage.setItem("fep_history", JSON.stringify(history.slice(0, 100)));
  renderHistory();
}

function renderHistory() {
  const container = $("historyList");
  if (!container) return;

  const history = getHistory();

  if (!history.length) {
    container.innerHTML = "<p>Aucune analyse enregistrée.</p>";
    return;
  }

  container.innerHTML = history.map(item => `
    <article class="history-card">
      <strong>${escapeHTML(item.home)} - ${escapeHTML(item.away)}</strong>
      <p>${new Date(item.date).toLocaleString()}</p>
      <p>1 : ${percent(item.prediction.homeWin)} |
         X : ${percent(item.prediction.draw)} |
         2 : ${percent(item.prediction.awayWin)}</p>
    </article>
  `).join("");
}

function clearHistory() {
  localStorage.removeItem("fep_history");
  renderHistory();
  updateDashboard();
}

/* ------------------ TABLEAU DE BORD ------------------ */

function updateDashboard() {
  const history = getHistory();

  if ($("analysisCount")) {
    $("analysisCount").textContent = history.length;
  }

  if ($("recentAnalyses")) {
    $("recentAnalyses").innerHTML = history.slice(0, 5).map(item => `
      <p>${escapeHTML(item.home)} - ${escapeHTML(item.away)}</p>
    `).join("") || "<p>Aucune analyse récente.</p>";
  }

  createChart("dashboardChart", {
    type: "line",
    data: {
      labels: history.slice(0, 10).reverse().map((_, i) => `Analyse ${i + 1}`),
      datasets: [{
        label: "Probabilité de la meilleure issue (%)",
        data: history.slice(0, 10).reverse().map(item =>
          Math.max(
            item.prediction.homeWin,
            item.prediction.draw,
            item.prediction.awayWin
          ) * 100
        )
      }]
    },
    options: { responsive: true }
  });
}

/* ------------------ COMPARAISON DES COTES ------------------ */

function compareOdds() {
  const home = Number($("bookHome")?.value);
  const draw = Number($("bookDraw")?.value);
  const away = Number($("bookAway")?.value);
  const result = $("bookResult");

  if (!home || !draw || !away || home <= 1 || draw <= 1 || away <= 1) {
    showMessage(result, "Entre trois cotes valides, supérieures à 1.");
    return;
  }

  const total = (1 / home) + (1 / draw) + (1 / away);
  const margin = (total - 1) * 100;

  if (result) {
    result.innerHTML = `
      <p>Probabilité implicite 1 : ${percent((1 / home) / total)}</p>
      <p>Probabilité implicite X : ${percent((1 / draw) / total)}</p>
      <p>Probabilité implicite 2 : ${percent((1 / away) / total)}</p>
      <p>Marge estimée du bookmaker : ${margin.toFixed(2)}%</p>
    `;
  }
}

/* ------------------ NAVIGATION ------------------ */

function setupNavigation() {
  document.querySelectorAll("[data-page]").forEach(button => {
    button.addEventListener("click", () => {
      const page = button.dataset.page;

      document.querySelectorAll(".page").forEach(section => {
        section.classList.remove("active");
      });

      const target = $(page);
      if (target) target.classList.add("active");

      document.querySelectorAll("[data-page]").forEach(item => {
        item.classList.toggle("active", item === button);
      });

      if (page === "history") renderHistory();
      if (page === "dashboard") updateDashboard();
    });
  });
}

/* ------------------ PROTECTION DU TEXTE HTML ------------------ */

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function escapeAttr(value) {
  return escapeHTML(value);
}

/* ------------------ DÉMARRAGE ------------------ */

document.addEventListener("DOMContentLoaded", () => {
  setupNavigation();

  if ($("manualAnalyzeButton")) {
    $("manualAnalyzeButton").addEventListener("click", () => {
      analyzeMatch(
        $("manualHome")?.value.trim(),
        $("manualAway")?.value.trim()
      );
    });
  }

  if ($("clearHistory")) {
    $("clearHistory").addEventListener("click", clearHistory);
  }

  if ($("compareButton")) {
    $("compareButton").addEventListener("click", compareOdds);
  }

  renderHistory();
  loadMatches();
  updateDashboard();
});
