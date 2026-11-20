
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
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#039;"
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

function percent(value) {
  return (value * 100).toFixed(1) + "%";
}

function saveHistory(item) {
  const history = getHistory();
  history.unshift(item);
  localStorage.setItem("fep_history", JSON.stringify(history.slice(0, 100)));
  updateDashboard();
  renderHistory();
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
      console.warn(league.name, error);
      return [];
    }
  }));

  allMatches = results.flat().filter(match =>
    match.strHomeTeam && match.strAwayTeam
  );

  allMatches.sort((a, b) =>
    new Date(a.dateEvent || 0) - new Date(b.dateEvent || 0)
  );

  if ($("matchCount")) {
    $("matchCount").textContent = allMatches.length;
  }

  if (!allMatches.length) {
    container.innerHTML =
      "<p>Aucun match disponible pour le moment. Réessaie plus tard.</p>";
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

// CINQ DERNIERS MATCHS TERMINÉS
async function getTeamHistory(teamName) {
  const search = await getJSON(
    `${API}/searchteams.php?t=${encodeURIComponent(teamName)}`
  );

  const team = search.teams?.[0];
  if (!team?.idTeam) {
    throw new Error("Équipe introuvable : " + teamName);
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
    teamId: team.idTeam,
    events: events.slice(0, REQUIRED_MATCHES)
  };
}

// STATISTIQUES DES ÉQUIPES
function getTeamStats(events, teamName) {
  let played = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  let wins = 0;
  let draws = 0;
  let losses = 0;

  const wanted = teamName.trim().toLowerCase();

  events.forEach(event => {
    const homeName = (event.strHomeTeam || "").trim().toLowerCase();
    const awayName = (event.strAwayTeam || "").trim().toLowerCase();

    const isHome = homeName === wanted;
    const isAway = awayName === wanted;

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
    played, goalsFor, goalsAgainst, wins, draws, losses,
    averageFor: played ? goalsFor / played : null,
    averageAgainst: played ? goalsAgainst / played : null
  };
}

function showTeamStats(team, stats) {
  return `
    <p><strong>${escapeHTML(team)}</strong></p>
    <p>Matchs analysés : ${stats.played} / 5</p>
    <p>Victoires : ${stats.wins} | Nuls : ${stats.draws}
    | Défaites : ${stats.losses}</p>
    <p>Buts marqués : ${stats.goalsFor}
    | Buts encaissés : ${stats.goalsAgainst}</p>
    ${stats.played ? `
      <p>Moyenne marquée : ${stats.averageFor.toFixed(2)}
      | Moyenne encaissée : ${stats.averageAgainst.toFixed(2)}</p>
    ` : ""}
  `;
}

// MODÈLE DE POISSON
function poisson(lambda, goals) {
  let factorial = 1;
  for (let i = 2; i <= goals; i++) factorial *= i;
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

  scores.forEach(item => item.probability /= total);

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
    homeWin, draw, awayWin, bttsYes, over25,
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
    <p>Récupération des cinq derniers matchs de chaque équipe.</p>
  `;

  try {
    const [homeData, awayData] = await Promise.all([
      getTeamHistory(match.strHomeTeam),
      getTeamHistory(match.strAwayTeam)
    ]);

    const homeStats = getTeamStats(
      homeData.events, match.strHomeTeam
    );

    const awayStats = getTeamStats(
      awayData.events, match.strAwayTeam
    );

    if (
      homeStats.played < REQUIRED_MATCHES ||
      awayStats.played < REQUIRED_MATCHES
    ) {
      output.innerHTML = `
        <div class="analysis-card">
          <h2>${escapeHTML(match.strHomeTeam)}
          VS ${escapeHTML(match.strAwayTeam)}</h2>
          <p>Championnat : ${escapeHTML(match.leagueName)}</p>

          <h3>Statistiques réelles</h3>
          ${showTeamStats(match.strHomeTeam, homeStats)}
          ${showTeamStats(match.strAwayTeam, awayStats)}

          <h3>Données insuffisantes</h3>
          <p class="warning">
            Cinq matchs terminés sont nécessaires pour chaque équipe.
            Aucun pronostic n'est généré.
          </p>
          <p>Disponibilité des données :
          ${Math.round(
            Math.min(homeStats.played, awayStats.played) /
            REQUIRED_MATCHES * 100
          )}%</p>
        </div>
      `;

      clearAnalysisCharts();
      return;
    }

    // Estimation basée sur les moyennes observées
    let homeLambda =
      (homeStats.averageFor + awayStats.averageAgainst) / 2;

    let awayLambda =
      (awayStats.averageFor + homeStats.averageAgainst) / 2;

    homeLambda = Math.max(0.15, Math.min(homeLambda, 4));
    awayLambda = Math.max(0.15, Math.min(awayLambda, 4));

    const predictions =
      calculateProbabilities(homeLambda, awayLambda);

    currentPredictions = predictions;

    output.innerHTML = `
      <div class="analysis-card">
        <h2>${escapeHTML(match.strHomeTeam)}
        VS ${escapeHTML(match.strAwayTeam)}</h2>

        <p>Championnat : ${escapeHTML(match.leagueName)}</p>

        <h3>Statistiques des cinq derniers matchs</h3>
        ${showTeamStats(match.strHomeTeam, homeStats)}
        ${showTeamStats(match.strAwayTeam, awayStats)}

        <h3>Pronostics 1X2</h3>
        <p>${escapeHTML(match.strHomeTeam)} :
        ${percent(predictions.homeWin)}</p>
        <p>Nul : ${percent(predictions.draw)}</p>
        <p>${escapeHTML(match.strAwayTeam)} :
        ${percent(predictions.awayWin)}</p>

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

        <h3>Disponibilité des données : 100%</h3>
        <p class="warning">
          Estimation mathématique basée sur cinq résultats récupérés
          pour chaque équipe. Ce n'est pas une garantie.
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
    console.error(error);
    output.innerHTML = `
      <p class="warning">
        Impossible de récupérer les statistiques réelles.
        Aucun pronostic n'a été fabriqué.
        Vérifie ta connexion ou réessaie plus tard.
      </p>
    `;
    clearAnalysisCharts();
  }
};

// GRAPHIQUES
function destroyChart(chart) {
  if (chart) chart.destroy();
}

function clearAnalysisCharts() {
  destroyChart(resultChart);
  destroyChart(goalsChart);
  destroyChart(scoreChart);
  resultChart = goalsChart = scoreChart = null;
}

function drawCharts(predictions) {
  if (typeof Chart === "undefined") {
    $("analysisContent").innerHTML +=
      "<p>Les graphiques ne sont pas disponibles.</p>";
    return;
  }

  clearAnalysisCharts();

  const options = {
    responsive: true,
    plugins: {
      legend: { labels: { color: "#f4f6fb" } }
    },
    scales: {
      x: { ticks: { color: "#c5d0df" } },
      y: { beginAtZero: true, ticks: { color: "#c5d0df" } }
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
        labels: ["BTTS Oui", "BTTS Non", "Over 2,5", "Under 2,5"],
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
    container.innerHTML = "Aucune analyse enregistrée.";
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
      `<p>${escapeHTML(item.home)} VS
      ${escapeHTML(item.away)} — ${escapeHTML(item.date)}</p>`
    ).join("") || "Aucune analyse enregistrée.";
  }
}

if ($("clearHistory")) {
  $("clearHistory").addEventListener("click", () => {
    if (confirm("Veux-tu vraiment effacer tout l'historique ?")) {
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

  if ($("emptyDashboard")) {
    $("emptyDashboard").style.display = "none";
  }
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

  if ($("recentAnalyses")) {
    $("recentAnalyses").innerHTML = history.slice(0, 3).map(item =>
      `<p>${escapeHTML(item.home)} VS
      ${escapeHTML(item.away)} — ${escapeHTML(item.date)}</p>`
    ).join("") || "Aucune analyse enregistrée.";
  }

  drawDashboardChart();
}

// COMPARAISON BOOKMAKERS
if ($("compareButton")) {
  $("compareButton").addEventListener("click", () => {
    const home = Number($("bookHome").value);
    const draw = Number($("bookDraw").value);
    const away = Number($("bookAway").value);
    const result = $("bookResult");

    if (!currentPredictions) {
      result.innerHTML =
        "<p>Analyse d'abord un match avec cinq matchs réels par équipe.</p>";
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
}

// DÉMARRAGE
if ($("today")) {
  $("today").textContent = new Date().toLocaleDateString("fr-FR");
}

renderHistory();
updateDashboard();
loadMatches();
