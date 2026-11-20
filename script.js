
const API = "https://www.thesportsdb.com/api/v1/json/123";

const LEAGUES = [
  { name: "Premier League", id: "4328" },
  { name: "La Liga", id: "4335" },
  { name: "Bundesliga", id: "4331" },
  { name: "Serie A", id: "4332" },
  { name: "Ligue 1", id: "4334" },
  { name: "Champions League", id: "4480" }
];

const matchesElement = document.getElementById("matches");
const analysisElement = document.getElementById("analysis");

let allMatches = [];

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
  if (!response.ok) throw new Error("Erreur de connexion");
  return response.json();
}

async function loadMatches() {
  matchesElement.innerHTML = "<p>Chargement des matchs...</p>";

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

    if (!allMatches.length) {
      matchesElement.innerHTML =
        "<p>Aucun match disponible. Réessaie plus tard.</p>";
      return;
    }

    matchesElement.innerHTML = allMatches.map((match, index) => `
      <article class="match-card">
        <p>${escapeHTML(match.leagueName)}</p>
        <h3>${escapeHTML(match.strHomeTeam)}</h3>
        <p>VS</p>
        <h3>${escapeHTML(match.strAwayTeam)}</h3>
        <p>${escapeHTML(match.dateEvent || "Date inconnue")}</p>
        <button onclick="analyzeMatch(${index})">
          ANALYSER CE MATCH
        </button>
      </article>
    `).join("");

  } catch (error) {
    matchesElement.innerHTML =
      "<p>Impossible de charger les matchs. Vérifie ta connexion.</p>";
  }
}

async function getTeamHistory(teamName) {
  try {
    const search = await getJSON(
      `${API}/searchteams.php?t=${encodeURIComponent(teamName)}`
    );

    const team = search.teams?.[0];
    if (!team?.idTeam) return [];

    const history = await getJSON(
      `${API}/eventslast.php?id=${team.idTeam}`
    );

    return (history.results || [])
      .filter(event =>
        event.intHomeScore !== null &&
        event.intAwayScore !== null &&
        event.intHomeScore !== "" &&
        event.intAwayScore !== ""
      )
      .slice(0, 10);

  } catch (error) {
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

function poisson(lambda, goals) {
  let factorial = 1;
  for (let i = 2; i <= goals; i++) factorial *= i;

  return Math.exp(-lambda) * Math.pow(lambda, goals) / factorial;
}

function calculateProbabilities(homeLambda, awayLambda) {
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  let bttsYes = 0;
  let over25 = 0;
  const scores = [];

  for (let home = 0; home <= 8; home++) {
    for (let away = 0; away <= 8; away++) {
      const probability =
        poisson(homeLambda, home) * poisson(awayLambda, away);

      if (home > away) homeWin += probability;
      else if (home === away) draw += probability;
      else awayWin += probability;

      if (home > 0 && away > 0) bttsYes += probability;
      if (home + away >= 3) over25 += probability;

      scores.push({
        score: `${home} - ${away}`,
        probability
      });
    }
  }

  scores.sort((a, b) => b.probability - a.probability);

  return {
    homeWin,
    draw,
    awayWin,
    bttsYes,
    over25,
    scores: scores.slice(0, 10)
  };
}

function percent(value) {
  return (value * 100).toFixed(1) + "%";
}

function showHistory(team, stats) {
  if (!stats.played) {
    return `
      <p><strong>${escapeHTML(team)}</strong></p>
      <p>Données récentes indisponibles.</p>
    `;
  }

  return `
    <p><strong>${escapeHTML(team)}</strong></p>
    <p>Matchs analysés : ${stats.played}</p>
    <p>Victoires : ${stats.wins} | Nuls : ${stats.draws}
    | Défaites : ${stats.losses}</p>
    <p>Buts marqués : ${stats.goalsFor}</p>
    <p>Buts encaissés : ${stats.goalsAgainst}</p>
    <p>Moyenne de buts marqués : ${stats.averageFor.toFixed(2)}</p>
    <p>Moyenne de buts encaissés : ${stats.averageAgainst.toFixed(2)}</p>
  `;
}

window.analyzeMatch = async function(index) {
  const match = allMatches[index];
  if (!match) return;

  analysisElement.innerHTML =
    "<h2>Analyse en cours...</h2><p>Récupération des statistiques.</p>";

  try {
    const [homeEvents, awayEvents] = await Promise.all([
      getTeamHistory(match.strHomeTeam),
      getTeamHistory(match.strAwayTeam)
    ]);

    const homeStats = getTeamStats(homeEvents, match.strHomeTeam);
    const awayStats = getTeamStats(awayEvents, match.strAwayTeam);

    let homeLambda;
    let awayLambda;
    let dataAvailable = homeStats.played > 0 && awayStats.played > 0;

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

    // Limites de sécurité pour le modèle de Poisson.
    homeLambda = Math.max(0.15, Math.min(homeLambda, 4));
    awayLambda = Math.max(0.15, Math.min(awayLambda, 4));

    const predictions = calculateProbabilities(
      homeLambda,
      awayLambda
    );

    const confidence = dataAvailable
      ? Math.round(
          Math.min(homeStats.played, awayStats.played) / 10 * 100
        )
      : 0;

    analysisElement.innerHTML = `
      <section class="analysis-card">
        <h2>${escapeHTML(match.strHomeTeam)}
          VS ${escapeHTML(match.strAwayTeam)}</h2>

        <p><strong>Championnat :</strong>
          ${escapeHTML(match.leagueName)}</p>

        <h3>Statistiques des 10 derniers matchs</h3>
        ${showHistory(match.strHomeTeam, homeStats)}
        ${showHistory(match.strAwayTeam, awayStats)}

        <h3>Pronostics 1X2</h3>
        <p>Victoire ${escapeHTML(match.strHomeTeam)} :
          ${percent(predictions.homeWin)}</p>
        <p>Nul : ${percent(predictions.draw)}</p>
        <p>Victoire ${escapeHTML(match.strAwayTeam)} :
          ${percent(predictions.awayWin)}</p>

        <h3>BTTS</h3>
        <p>Oui : ${percent(predictions.bttsYes)}</p>
        <p>Non : ${percent(1 - predictions.bttsYes)}</p>

        <h3>Buts : Over / Under 2,5</h3>
        <p>Over 2,5 : ${percent(predictions.over25)}</p>
        <p>Under 2,5 : ${percent(1 - predictions.over25)}</p>

        <h3>10 scores exacts possibles</h3>
        ${predictions.scores.map(item => `
          <p>${item.score} — ${percent(item.probability)}</p>
        `).join("")}

        <h3>Indice de disponibilité des données</h3>
        <p>${confidence}%</p>
        <p>
          Cet indice indique la quantité de données historiques
          disponibles, et non une garantie de réussite.
        </p>

        <h3>Comparer les cotes du bookmaker</h3>
        <p>Entre les cotes décimales 1, X et 2 :</p>

        <div class="odds-inputs">
          <label>Victoire domicile
            <input id="oddHome" type="number" min="1.01"
              step="0.01" placeholder="Ex : 2.10">
          </label>
          <label>Match nul
            <input id="oddDraw" type="number" min="1.01"
              step="0.01" placeholder="Ex : 3.20">
          </label>
          <label>Victoire extérieur
            <input id="oddAway" type="number" min="1.01"
              step="0.01" placeholder="Ex : 3.50">
          </label>
        </div>

        <button onclick="compareOdds()">COMPARER LES COTES</button>
        <div id="oddsResult"></div>

        <p class="warning">
          ${dataAvailable
            ? "Les estimations utilisent les résultats historiques disponibles."
            : "Attention : statistiques insuffisantes. Les valeurs affichées utilisent des hypothèses de secours et ne constituent pas une véritable analyse."}
        </p>
        <p>Les probabilités sont des estimations, jamais des garanties.</p>
      </section>
    `;

    window.currentPredictions = predictions;

  } catch (error) {
    analysisElement.innerHTML =
      "<p>Erreur pendant l'analyse. Réessaie plus tard.</p>";
  }
};

window.compareOdds = function() {
  const home = Number(document.getElementById("oddHome").value);
  const draw = Number(document.getElementById("oddDraw").value);
  const away = Number(document.getElementById("oddAway").value);
  const result = document.getElementById("oddsResult");

  if ([home, draw, away].some(value =>
    !Number.isFinite(value) || value <= 1
  )) {
    result.innerHTML = "<p>Entre trois cotes valides supérieures à 1.</p>";
    return;
  }

  const raw = [1 / home, 1 / draw, 1 / away];
  const total = raw.reduce((sum, value) => sum + value, 0);
  const fair = raw.map(value => value / total);
  const model = window.currentPredictions;

  result.innerHTML = `
    <h4>Probabilités estimées par le bookmaker</h4>
    <p>Domicile : ${percent(fair[0])}</p>
    <p>Nul : ${percent(fair[1])}</p>
    <p>Extérieur : ${percent(fair[2])}</p>
    <h4>Comparaison avec le modèle</h4>
    <p>Domicile : ${percent(model.homeWin)}</p>
    <p>Nul : ${percent(model.draw)}</p>
    <p>Extérieur : ${percent(model.awayWin)}</p>
    <p>La comparaison ne garantit aucun bénéfice.</p>
  `;
};

loadMatches();
