
const API = "https://www.thesportsdb.com/api/v1/json/123";

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
let currentMatch = null;
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
  updateDashboard();
  renderHistory();
}

function percent(value) {
  return (value * 100).toFixed(1) + "%";
}

// NAVIGATION
document.querySelectorAll(".nav-btn").forEach(button => {
  button.addEventListener("click", () => {
    const page = button.dataset.page;

    document.querySelectorAll(".page").forEach(section => {
      section.classList.remove("active");
    });

    document.querySelectorAll(".nav-btn").forEach(item => {
      item.classList.remove("active");
    });

    $(page)?.classList.add("active");
    button.classList.add("active");

    if (page === "history") renderHistory();
    if (page === "dashboard") updateDashboard();
  });
});

// CHARGEMENT DES MATCHS
async function loadMatches() {
  const container = $("matchList");
  container.innerHTML = "<p>Chargement des rencontres...</p>";

  try {
    const results = await Promise.all(
      LEAGUES.map(async league => {
        try {
          const data = await getJSON(
            `${API}/eventsnextleague.php?id=${league.id}`
          );

          return (data.events || []).map(match => ({
            ...match,
            leagueName: league.name
          }));
        } catch {
          return [];
        }
      })
    );

    allMatches = results.flat().filter(match =>
      match.strHomeTeam && match.strAwayTeam
    );

    allMatches.sort((a, b) =>
      new Date(a.dateEvent) - new Date(b.dateEvent)
    );

    $("matchCount").textContent = allMatches.length;

    if (!allMatches.length) {
      container.innerHTML =
        "<p>Aucun match disponible pour le moment. Réessaie plus tard.</p>";
      return;
    }

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

  } catch (error) {
    container.innerHTML =
      "<p>Erreur de chargement. Vérifie ta connexion Internet.</p>";
  }

  updateDashboard();
}

// HISTORIQUE DES ÉQUIPES
async function getTeamHistory(teamName) {
  try {
    const search = await getJSON(
      `${API}/searchteams.php?t=${encodeURIComponent(teamName)}`
    );

    const team = search.teams?.[0];
    if (!team?.idTeam) return [];

    const data = await getJSON(
      `${API}/eventslast.php?id=${team.idTeam}`
    );

    return (data.results || data.events || [])
      .filter(event =>
        event.intHomeScore !== null &&
        event.intAwayScore !== null &&
        event.intHomeScore !== "" &&
        event.intAwayScore !== ""
      )
      .slice(0, 10);

  } catch {
    return [];
  }
}

function getTeamStats(events, teamName) {
  let played = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  let wins = 0;
  let draws = 0;
  let losses = 0;

  events.forEach(event => {
    const home = Number(event.intHomeScore);
    const away = Number(event.intAwayScore);

    const isHome =
      event.strHomeTeam?.toLowerCase() === teamName.toLowerCase();

    const isAway =
      event.strAwayTeam?.toLowerCase() === teamName.toLowerCase();

    if (!isHome && !isAway) return;

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
    played, goalsFor, goalsAgainst, wins, draws, losses,
    averageFor: played ? goalsFor / played : null,
    averageAgainst: played ? goalsAgainst / played : null
  };
}

// MODÈLE DE POISSON
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
        poisson(homeLambda, home) * poisson(awayLambda, away);

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

function showTeamStats(team, stats) {
  if (!stats.played) {
    return `
      <p><strong>${escapeHTML(team)}</strong></p>
      <p>Données historiques indisponibles.</p>
    `;
  }

  return `
    <p><strong>${escapeHTML(team)}</strong></p>
    <p>Matchs analysés : ${stats.played}</p>
    <p>Victoires : ${stats.wins} | Nuls : ${stats.draws}
    | Défaites : ${stats.losses}</p>
    <p>Buts marqués : ${stats.goalsFor}</p>
    <p>Buts encaissés : ${stats.goalsAgainst}</p>
    <p>Moyenne marquée : ${stats.averageFor.toFixed(2)}</p>
    <p>Moyenne encaissée : ${stats.averageAgainst.toFixed(2)}</p>
  `;
}

// ANALYSE
window.analyzeMatch = async function(index) {
  const match = allMatches[index];
  if (!match) return;

  currentMatch = match;

  document.querySelector('[data-page="analysis"]').click();

  $("analysisContent").innerHTML =
    "<h3>Analyse en cours...</h3><p>Récupération des données historiques.</p>";

  try {
    const [homeEvents, awayEvents] = await Promise.all([
      getTeamHistory(match.strHomeTeam),
      getTeamHistory(match.strAwayTeam)
    ]);

    const homeStats = getTeamStats(homeEvents, match.strHomeTeam);
    const awayStats = getTeamStats(awayEvents, match.strAwayTeam);

    const dataAvailable =
      homeStats.played > 0 && awayStats.played > 0;

    let homeLambda;
    let awayLambda;

    if (dataAvailable) {
      homeLambda = (
        homeStats.averageFor + awayStats.averageAgainst
      ) / 2;

      awayLambda = (
        awayStats.averageFor + homeStats.averageAgainst
      ) / 2;
    } else {
      homeLambda = 1.3;
      awayLambda = 1.1;
    }

    homeLambda = Math.max(0.15, Math.min(homeLambda, 4));
    awayLambda = Math.max(0.15, Math.min(awayLambda, 4));

    const predictions = calculateProbabilities(
      homeLambda, awayLambda
    );

    currentPredictions = predictions;

    const confidence = dataAvailable
      ? Math.round(
          Math.min(homeStats.played, awayStats.played) / 10 * 100
        )
      : 0;

    $("analysisContent").innerHTML = `
      <div class="analysis-card">
        <h2>${escapeHTML(match.strHomeTeam)}
          VS ${escapeHTML(match.strAwayTeam)}</h2>

        <p>Championnat : ${escapeHTML(match.leagueName)}</p>

        <h3>Statistiques récentes</h3>
        ${showTeamStats(match.strHomeTeam, homeStats)}
        ${showTeamStats(match.strAwayTeam, awayStats)}

        <h3>Pronostics 1X2</h3>
        <p>${escapeHTML(match.strHomeTeam)} : ${percent(predictions.homeWin)}</p>
        <p>Nul : ${percent(predictions.draw)}</p>
        <p>${escapeHTML(match.strAwayTeam)} : ${percent(predictions.awayWin)}</p>

        <h3>BTTS</h3>
        <p>Oui : ${percent(predictions.bttsYes)}</p>
        <p>Non : ${percent(1 - predictions.bttsYes)}</p>

        <h3>Over / Under 2,5</h3>
        <p>Over 2,5 : ${percent(predictions.over25)}</p>
        <p>Under 2,5 : ${percent(1 - predictions.over25)}</p>

        <h3>Les 10 scores exacts possibles</h3>
        ${predictions.scores.map(item => `
          <p>${item.home} - ${item.away} : ${percent(item.probability)}</p>
        `).join("")}

        <h3>Disponibilité des données : ${confidence}%</h3>
        <p class="warning">
          ${dataAvailable
            ? "Estimation basée sur les résultats historiques récupérés. Cet indice mesure la disponibilité des données, pas la chance de gagner."
            : "Statistiques insuffisantes : les hypothèses de secours ne constituent pas une véritable analyse de ce match."}
        </p>
      </div>
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
    $("analysisContent").innerHTML =
      "<p>Impossible de terminer l'analyse. Réessaie plus tard.</p>";
  }
};

// GRAPHIQUES
function destroyChart(chart) {
  if (chart) chart.destroy();
}

function drawCharts(predictions) {
  if (typeof Chart === "undefined") {
    $("analysisContent").innerHTML +=
      "<p>Les graphiques ne sont pas disponibles : bibliothèque Chart.js inaccessible.</p>";
    return;
  }

  destroyChart(resultChart);
  destroyChart(goalsChart);
  destroyChart(scoreChart);

  const options = {
    responsive: true,
    plugins: {
      legend: {
        labels: { color: "#f4f6fb" }
      }
    },
    scales: {
      x: { ticks: { color: "#c5d0df" }, grid: { color: "#26364a" } },
      y: {
        beginAtZero: true,
        ticks: { color: "#c5d0df" },
        grid: { color: "#26364a" }
      }
    }
  };

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
        ],
        backgroundColor: ["#e8b84c", "#7796bd", "#29c987"]
      }]
    },
    options
  });

  goalsChart = new Chart($("goalsChart"), {
    type: "doughnut",
    data: {
      labels: ["BTTS Oui", "BTTS Non", "Over 2,5", "Under 2,5"],
      datasets: [{
        data: [
          predictions.bttsYes * 100,
          (1 - predictions.bttsYes) * 100,
          predictions.over25 * 100,
          (1 - predictions.over25) * 100
        ],
        backgroundColor: ["#29c987", "#7796bd", "#e8b84c", "#d47777"]
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: "#f4f6fb" } } }
    }
  });

  scoreChart = new Chart($("scoreChart"), {
    type: "bar",
    data: {
      labels: predictions.scores.map(item =>
        `${item.home}-${item.away}`
      ),
      datasets: [{
        label: "Probabilité (%)",
        data: predictions.scores.map(item =>
          item.probability * 100
        ),
        backgroundColor: "#e8b84c"
      }]
    },
    options
  });

  const empty = $("emptyDashboard");
  if (empty) empty.style.display = "none";

  drawDashboardChart();
}

// HISTORIQUE
function renderHistory() {
  const history = getHistory();
  const container = $("historyList");

  if (!history.length) {
    container.innerHTML = "Aucune analyse enregistrée.";
    return;
  }

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

  $("recentAnalyses").innerHTML = history.slice(0, 3).map(item => `
    <p>${escapeHTML(item.home)} VS ${escapeHTML(item.away)}
    — ${escapeHTML(item.date)}</p>
  `).join("");
}

$("clearHistory").addEventListener("click", () => {
  if (confirm("Veux-tu vraiment effacer tout l'historique ?")) {
    localStorage.removeItem("fep_history");
    renderHistory();
    updateDashboard();
  }
});

// TABLEAU DE BORD
function drawDashboardChart() {
  const history = getHistory();
  if (!history.length || typeof Chart === "undefined") return;

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
        ],
        backgroundColor: ["#e8b84c", "#7796bd", "#29c987"]
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: "#f4f6fb" } } }
    }
  });

  $("emptyDashboard").style.display = "none";
}

function updateDashboard() {
  const history = getHistory();

  $("matchCount").textContent = allMatches.length;
  $("analysisCount").textContent = history.length;
  $("leagueCount").textContent = LEAGUES.length;

  if (history.length) {
    $("recentAnalyses").innerHTML = history.slice(0, 3).map(item => `
      <p>${escapeHTML(item.home)} VS ${escapeHTML(item.away)}
      — ${escapeHTML(item.date)}</p>
    `).join("");
  } else {
    $("recentAnalyses").textContent = "Aucune analyse enregistrée.";
  }

  drawDashboardChart();
}

// COMPARAISON DES COTES
$("compareButton").addEventListener("click", () => {
  const home = Number($("bookHome").value);
  const draw = Number($("bookDraw").value);
  const away = Number($("bookAway").value);
  const result = $("bookResult");

  if (!currentPredictions) {
    result.innerHTML = "<p>Analyse d'abord un match.</p>";
    return;
  }

  if ([home, draw, away].some(value =>
    !Number.isFinite(value) || value <= 1
  )) {
    result.innerHTML = "<p>Entre trois cotes valides supérieures à 1.</p>";
    return;
  }

  const raw = [1 / home, 1 / draw, 1 / away];
  const total = raw.reduce((sum, value) => sum + value, 0);
  const fair = raw.map(value => value / total);

  result.innerHTML = `
    <h3>Probabilités estimées par les cotes</h3>
    <p>Domicile : ${percent(fair[0])}</p>
    <p>Nul : ${percent(fair[1])}</p>
    <p>Extérieur : ${percent(fair[2])}</p>
    <h3>Probabilités du modèle</h3>
    <p>Domicile : ${percent(currentPredictions.homeWin)}</p>
    <p>Nul : ${percent(currentPredictions.draw)}</p>
    <p>Extérieur : ${percent(currentPredictions.awayWin)}</p>
    <p>Comparaison indicative uniquement, sans garantie de gain.</p>
  `;
});

// DATE ET DÉMARRAGE
$("today").textContent = new Date().toLocaleDateString("fr-FR");

renderHistory();
updateDashboard();
loadMatches();
