
const API = "https://www.thesportsdb.com/api/v1/json/123";
const REQUIRED_MATCHES = 5;

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
let currentPredictions = null;
let resultChart = null;
let goalsChart = null;
let scoreChart = null;
let dashboardChart = null;

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

async function getJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Erreur réseau");
  return response.json();
}

function percent(value) {
  return (value * 100).toFixed(1) + "%";
}

// HISTORIQUE
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
  localStorage.setItem(
    "fep_history",
    JSON.stringify(history.slice(0, 100))
  );
  renderHistory();
  updateDashboard();
}

// NAVIGATION
document.querySelectorAll(".nav-btn").forEach(button => {
  button.addEventListener("click", () => {
    const page = button.dataset.page;

    document.querySelectorAll(".page").forEach(section =>
      section.classList.remove("active")
    );

    document.querySelectorAll(".nav-btn").forEach(item =>
      item.classList.remove("active")
    );

    $(page)?.classList.add("active");
    button.classList.add("active");

    if (page === "history") renderHistory();
    if (page === "dashboard") updateDashboard();
  });
});

// CHARGEMENT DES MATCHS
async function loadMatches() {
  const container = $("matchList");
  if (!container) return;

  container.innerHTML = "<p>Chargement des rencontres...</p>";

  const results = await Promise.all(LEAGUES.map(async league => {
    try {
      const data = await getJSON(
        `${API}/eventsnextleague.php?id=${league.id}`
      );

      return (data.events || []).map(match => ({
        ...match,
        leagueName: league.name
      }));
    } catch (error) {
      console.warn("Erreur championnat :", league.name, error);
      return [];
    }
  }));

  allMatches = results.flat().filter(match =>
    match.strHomeTeam && match.strAwayTeam
  );

  // Éliminer les doublons
  const unique = new Map();

  allMatches.forEach(match => {
    const key = [
      match.idEvent,
      match.strHomeTeam,
      match.strAwayTeam,
      match.dateEvent
    ].join("_");

    unique.set(key, match);
  });

  allMatches = [...unique.values()];

  allMatches.sort((a, b) =>
    new Date(a.dateEvent || 0) - new Date(b.dateEvent || 0)
  );

  if ($("matchCount")) {
    $("matchCount").textContent = allMatches.length;
  }

  if (!allMatches.length) {
    container.innerHTML =
      "<p>Aucun match disponible pour le moment.</p>";
  } else {
    container.innerHTML = allMatches.map((match, index) => `
      <article class="match-card">
        <p>${escapeHTML(match.leagueName)}</p>
        <h3>${escapeHTML(match.strHomeTeam)}</h3>
        <p style="text-align:center">VS</p>
        <h3>${escapeHTML(match.strAwayTeam)}</h3>
        <p>📅 ${escapeHTML(match.dateEvent || "Date inconnue")}</p>
        <button onclick="analyzeMatch(${index})">
          ANALYSER CE MATCH
        </button>
      </article>
    `).join("");
  }

  updateDashboard();
}

// RECHERCHE D'UNE ÉQUIPE
async function getTeamHistory(teamName) {
  const search = await getJSON(
    `${API}/searchteams.php?t=${encodeURIComponent(teamName)}`
  );

  const teams = search.teams || [];

  if (!teams.length) {
    throw new Error("Équipe introuvable : " + teamName);
  }

  // Choisir le résultat dont le nom correspond le mieux
  const normalized = teamName.trim().toLowerCase();

  const team = teams.find(item =>
    item.strTeam?.trim().toLowerCase() === normalized
  ) || teams[0];

  if (!team.idTeam) {
    throw new Error("Identifiant de l'équipe indisponible.");
  }

  const data = await getJSON(
    `${API}/eventslast.php?id=${team.idTeam}`
  );

  const events = (data.results || data.events || []).filter(event =>
    event.intHomeScore !== null &&
    event.intAwayScore !== null &&
    event.intHomeScore !== "" &&
    event.intAwayScore !== "" &&
    Number.isFinite(Number(event.intHomeScore)) &&
    Number.isFinite(Number(event.intAwayScore))
  );

  events.sort((a, b) =>
    new Date(b.dateEvent || 0) - new Date(a.dateEvent || 0)
  );

  return {
    teamId: String(team.idTeam),
    teamName: team.strTeam,
    events: events.slice(0, REQUIRED_MATCHES)
  };
}

// STATISTIQUES PAR IDENTIFIANT D'ÉQUIPE
function getTeamStats(events, teamId) {
  let played = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  let wins = 0;
  let draws = 0;
  let losses = 0;

  events.forEach(event => {
    const homeId = String(event.idHomeTeam || "");
    const awayId = String(event.idAwayTeam || "");

    const isHome = homeId === String(teamId);
    const isAway = awayId === String(teamId);

    if (!isHome && !isAway) return;

    const home = Number(event.intHomeScore);
    const away = Number(event.intAwayScore);

    const scored = isHome ? home : away;
    const conceded = isHome ? away : home;

    played++;
    goalsFor += scored;
    goalsAgainst += conceded;

    if (scored > conceded) wins++;
    else if (scored === conceded) draws++;
    else losses++;
  });

  return {
    played,
    goalsFor,
    goalsAgainst,
    wins,
    draws,
    losses,
    averageFor: played ? goalsFor / played : null,
    averageAgainst: played ? goalsAgainst / played : null
  };
}

function showTeamStats(team, stats) {
  return `
    <div class="card">
      <h3>${escapeHTML(team)}</h3>
      <p>Matchs récupérés : ${stats.played} / 5</p>
      <p>Victoires : ${stats.wins}</p>
      <p>Nuls : ${stats.draws}</p>
      <p>Défaites : ${stats.losses}</p>
      <p>Buts marqués : ${stats.goalsFor}</p>
      <p>Buts encaissés : ${stats.goalsAgainst}</p>
      ${stats.played ? `
        <p>Moyenne marquée :
          ${stats.averageFor.toFixed(2)}
        </p>
        <p>Moyenne encaissée :
          ${stats.averageAgainst.toFixed(2)}
        </p>
      ` : ""}
    </div>
  `;
}

// CALCUL DE POISSON
function poisson(lambda, goals) {
  let factorial = 1;

  for (let i = 2; i <= goals; i++) {
    factorial *= i;
  }

  return Math.exp(-lambda) * Math.pow(lambda, goals) / factorial;
}

function calculateProbabilities(homeLambda, awayLambda) {
  const scores = [];
  let total = 0;

  for (let home = 0; home <= 8; home++) {
    for (let away = 0; away <= 8; away++) {
      const probability =
        poisson(homeLambda, home) *
        poisson(awayLambda, away);

      scores.push({ home, away, probability });
      total += probability;
    }
  }

  scores.forEach(item => {
    item.probability /= total;
  });

  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  let bttsYes = 0;
  let over25 = 0;

  scores.forEach(item => {
    const p = item.probability;

    if (item.home > item.away) homeWin += p;
    else if (item.home === item.away) draw += p;
    else awayWin += p;

    if (item.home > 0 && item.away > 0) bttsYes += p;
    if (item.home + item.away >= 3) over25 += p;
  });

  return {
    homeWin,
    draw,
    awayWin,
    bttsYes,
    over25,
    scores: scores
      .sort((a, b) => b.probability - a.probability)
      .slice(0, 10)
  };
}

// ANALYSE D'UN MATCH
window.analyzeMatch = async function(index) {
  const match = allMatches[index];
  if (!match) return;

  currentPredictions = null;

  document.querySelector('[data-page="analysis"]')?.click();

  const output = $("analysisContent");

  output.innerHTML = `
    <h3>Analyse en cours...</h3>
    <p>Recherche des cinq derniers matchs de chaque équipe.</p>
  `;

  clearAnalysisCharts();

  try {
    const [homeData, awayData] = await Promise.all([
      getTeamHistory(match.strHomeTeam),
      getTeamHistory(match.strAwayTeam)
    ]);

    const homeStats = getTeamStats(
      homeData.events,
      homeData.teamId
    );

    const awayStats = getTeamStats(
      awayData.events,
      awayData.teamId
    );

    const availability = Math.round(
      (
        homeStats.played + awayStats.played
      ) / (REQUIRED_MATCHES * 2) * 100
    );

    if (
      homeStats.played < REQUIRED_MATCHES ||
      awayStats.played < REQUIRED_MATCHES
    ) {
      output.innerHTML = `
        <h2>${escapeHTML(match.strHomeTeam)}
        VS ${escapeHTML(match.strAwayTeam)}</h2>

        ${showTeamStats(match.strHomeTeam, homeStats)}
        ${showTeamStats(match.strAwayTeam, awayStats)}

        <h3>Données insuffisantes</h3>
        <p>Disponibilité : ${availability}%</p>
        <p>
          Il faut cinq matchs terminés pour chaque équipe.
          Aucun pronostic n'est généré.
        </p>
      `;
      return;
    }

    const homeLambda = Math.max(
      0.15,
      Math.min(
        4,
        (
          homeStats.averageFor +
          awayStats.averageAgainst
        ) / 2
      )
    );

    const awayLambda = Math.max(
      0.15,
      Math.min(
        4,
        (
          awayStats.averageFor +
          homeStats.averageAgainst
        ) / 2
      )
    );

    const predictions = calculateProbabilities(
      homeLambda,
      awayLambda
    );

    currentPredictions = predictions;

    output.innerHTML = `
      <h2>${escapeHTML(match.strHomeTeam)}
      VS ${escapeHTML(match.strAwayTeam)}</h2>

      <p>Championnat : ${escapeHTML(match.leagueName)}</p>

      <h3>Statistiques des équipes</h3>
      ${showTeamStats(match.strHomeTeam, homeStats)}
      ${showTeamStats(match.strAwayTeam, awayStats)}

      <h3>Pronostics 1X2</h3>
      <p>Domicile : ${percent(predictions.homeWin)}</p>
      <p>Nul : ${percent(predictions.draw)}</p>
      <p>Extérieur : ${percent(predictions.awayWin)}</p>

      <h3>BTTS</h3>
      <p>Oui : ${percent(predictions.bttsYes)}</p>
      <p>Non : ${percent(1 - predictions.bttsYes)}</p>

      <h3>Over / Under 2,5</h3>
      <p>Over 2,5 : ${percent(predictions.over25)}</p>
      <p>Under 2,5 : ${percent(1 - predictions.over25)}</p>

      <h3>Les 10 scores exacts les plus probables</h3>
      ${predictions.scores.map(item => `
        <p>${item.home} - ${item.away} :
        ${percent(item.probability)}</p>
      `).join("")}

      <p>Disponibilité des données : 100%</p>
      <p>
        Estimation mathématique fondée sur cinq matchs par équipe.
        Elle ne garantit aucun résultat.
      </p>
    `;

    drawCharts(predictions);

    saveHistory({
      home: match.strHomeTeam,
      away: match.strAwayTeam,
      league: match.leagueName,
      date: new Date().toLocaleString("fr-FR"),
      probabilities: {
        homeWin: predictions.homeWin,
        draw: predictions.draw,
        awayWin: predictions.awayWin,
        bttsYes: predictions.bttsYes,
        over25: predictions.over25
      },
      scores: predictions.scores
    });

  } catch (error) {
    console.error(error);

    output.innerHTML = `
      <h3>Analyse impossible</h3>
      <p>${escapeHTML(error.message)}</p>
      <p>
        Vérifie le nom des équipes ou réessaie plus tard.
        Aucun pronostic artificiel n'a été produit.
      </p>
    `;
  }
};

// ANALYSE MANUELLE
if ($("manualAnalyzeButton")) {
  $("manualAnalyzeButton").addEventListener("click", () => {
    const home = $("manualHome")?.value.trim();
    const away = $("manualAway")?.value.trim();

    if (!home || !away) {
      alert("Entre le nom des deux équipes.");
      return;
    }

    if (home.toLowerCase() === away.toLowerCase()) {
      alert("Choisis deux équipes différentes.");
      return;
    }

    const manualMatch = {
      strHomeTeam: home,
      strAwayTeam: away,
      leagueName: "Analyse manuelle"
    };

    allMatches.push(manualMatch);
    window.analyzeMatch(allMatches.length - 1);
  });
}

// GRAPHIQUES
function destroyChart(chart) {
  if (chart) chart.destroy();
}

function clearAnalysisCharts() {
  destroyChart(resultChart);
  destroyChart(goalsChart);
  destroyChart(scoreChart);

  resultChart = null;
  goalsChart = null;
  scoreChart = null;
}

function drawCharts(predictions) {
  if (typeof Chart === "undefined") return;

  clearAnalysisCharts();

  const options = {
    responsive: true,
    plugins: {
      legend: {
        labels: { color: "#f4f6fb" }
      }
    },
    scales: {
      x: {
        ticks: { color: "#c5d0df" }
      },
      y: {
        beginAtZero: true,
        ticks: { color: "#c5d0df" }
      }
    }
  };

  if ($("resultChart")) {
    resultChart = new Chart($("resultChart"), {
      type: "bar",
      data: {
        labels: ["Domicile", "Nul", "Extérieur"],
        datasets: [{
          label: "Probabilité (%)",
          data: [
            predictions.homeWin * 100,
            predictions.draw * 100,
            predictions.awayWin * 100
          ]
        }]
      },
      options
    });
  }

  if ($("goalsChart")) {
    goalsChart = new Chart($("goalsChart"), {
      type: "doughnut",
      data: {
        labels: [
          "BTTS Oui",
          "BTTS Non",
          "Over 2,5",
          "Under 2,5"
        ],
        datasets: [{
          data: [
            predictions.bttsYes * 100,
            (1 - predictions.bttsYes) * 100,
            predictions.over25 * 100,
            (1 - predictions.over25) * 100
          ]
        }]
      },
      options: { responsive: true }
    });
  }

  if ($("scoreChart")) {
    scoreChart = new Chart($("scoreChart"), {
      type: "bar",
      data: {
        labels: predictions.scores.map(
          item => `${item.home}-${item.away}`
        ),
        datasets: [{
          label: "Probabilité (%)",
          data: predictions.scores.map(
            item => item.probability * 100
          )
        }]
      },
      options
    });
  }

  drawDashboardChart();
}

// HISTORIQUE
function renderHistory() {
  const history = getHistory();
  const container = $("historyList");

  if (!container) return;

  if (!history.length) {
    container.innerHTML = "<p>Aucune analyse enregistrée.</p>";
  } else {
    container.innerHTML = history.map(item => `
      <div class="match-card">
        <h3>${escapeHTML(item.home)} VS ${escapeHTML(item.away)}</h3>
        <p>${escapeHTML(item.league)}</p>
        <p>${escapeHTML(item.date)}</p>
        <p>Domicile : ${percent(item.probabilities.homeWin)}</p>
        <p>Nul : ${percent(item.probabilities.draw)}</p>
        <p>Extérieur : ${percent(item.probabilities.awayWin)}</p>
      </div>
    `).join("");
  }

  if ($("recentAnalyses")) {
    $("recentAnalyses").innerHTML = history.slice(0, 3).map(item =>
      `<p>${escapeHTML(item.home)} VS ${escapeHTML(item.away)}</p>`
    ).join("") || "Aucune analyse enregistrée.";
  }
}

if ($("clearHistory")) {
  $("clearHistory").addEventListener("click", () => {
    if (confirm("Effacer tout l'historique ?")) {
      localStorage.removeItem("fep_history");
      renderHistory();
      updateDashboard();
    }
  });
}

// TABLEAU DE BORD
function drawDashboardChart() {
  const history = getHistory();

  if (
    !history.length ||
    typeof Chart === "undefined" ||
    !$("dashboardChart")
  ) return;

  destroyChart(dashboardChart);

  const latest = history[0].probabilities;

  dashboardChart = new Chart($("dashboardChart"), {
    type: "doughnut",
    data: {
      labels: ["Domicile", "Nul", "Extérieur"],
      datasets: [{
        data: [
          latest.homeWin * 100,
          latest.draw * 100,
          latest.awayWin * 100
        ]
      }]
    },
    options: { responsive: true }
  });
}

function updateDashboard() {
  const history = getHistory();

  if ($("matchCount")) {
    $("matchCount").textContent = allMatches.length;
  }

  if ($("analysisCount")) {
    $("analysisCount").textContent = history.length;
  }

  if ($("leagueCount")) {
    $("leagueCount").textContent = LEAGUES.length;
  }

  drawDashboardChart();
}

// COMPARAISON BOOKMAKERS
if ($("compareButton")) {
  $("compareButton").addEventListener("click", () => {
    const home = Number($("bookHome")?.value);
    const draw = Number($("bookDraw")?.value);
    const away = Number($("bookAway")?.value);
    const result = $("bookResult");

    if (!currentPredictions) {
      result.innerHTML =
        "<p>Analyse d'abord un match avec les données suffisantes.</p>";
      return;
    }

    if ([home, draw, away].some(value =>
      !Number.isFinite(value) || value <= 1
    )) {
      result.innerHTML =
        "<p>Entre trois cotes valides supérieures à 1.</p>";
      return;
    }

    const raw = [1 / home, 1 / draw, 1 / away];
    const total = raw.reduce((sum, value) => sum + value, 0);
    const fair = raw.map(value => value / total);

    result.innerHTML = `
      <h3>Probabilités des cotes</h3>
      <p>Domicile : ${percent(fair[0])}</p>
      <p>Nul : ${percent(fair[1])}</p>
      <p>Extérieur : ${percent(fair[2])}</p>

      <h3>Probabilités du modèle</h3>
      <p>Domicile : ${percent(currentPredictions.homeWin)}</p>
      <p>Nul : ${percent(currentPredictions.draw)}</p>
      <p>Extérieur : ${percent(currentPredictions.awayWin)}</p>
    `;
  });
}

// DÉMARRAGE
if ($("today")) {
  $("today").textContent = new Date().toLocaleDateString("fr-FR");
}

renderHistory();
updateDashboard();
loadMatches();
