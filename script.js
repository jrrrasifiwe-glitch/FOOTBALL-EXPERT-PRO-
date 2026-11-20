
const matchesContainer = document.getElementById("matches");
const analysisContainer = document.getElementById("analysis");

const leagues = [
  { name: "Premier League", id: "4328" },
  { name: "La Liga", id: "4335" },
  { name: "Bundesliga", id: "4331" },
  { name: "Serie A", id: "4332" },
  { name: "Ligue 1", id: "4334" },
  { name: "Champions League", id: "4480" }
];

async function loadMatches() {
  matchesContainer.textContent = "Chargement des matchs réels...";
  const allMatches = [];

  for (const league of leagues) {
    try {
      const url = `https://www.thesportsdb.com/api/v1/json/123/eventsnextleague.php?id=${league.id}`;
      const response = await fetch(url);
      if (!response.ok) continue;

      const data = await response.json();
      (data.events || []).forEach(match => {
        allMatches.push({ ...match, leagueName: league.name });
      });
    } catch (error) {
      console.error(error);
    }
  }

  if (!allMatches.length) {
    matchesContainer.textContent =
      "Aucun match disponible. Réessaie plus tard.";
    return;
  }

  matchesContainer.innerHTML = "";

  allMatches.sort((a, b) =>
    (a.dateEvent || "").localeCompare(b.dateEvent || "")
  );

  allMatches.forEach(match => {
    const card = document.createElement("div");
    card.style.cssText =
      "background:#1b3049;padding:16px;margin:12px 0;border-radius:12px;";

    const league = document.createElement("p");
    league.textContent = match.leagueName;

    const title = document.createElement("h3");
    title.textContent =
      `${match.strHomeTeam} vs ${match.strAwayTeam}`;

    const date = document.createElement("p");
    date.textContent = match.dateEvent || "Date inconnue";

    const button = document.createElement("button");
    button.textContent = "ANALYSER LE MATCH";
    button.onclick = () => analyzeMatch(match);

    card.append(league, title, date, button);
    matchesContainer.appendChild(card);
  });
}

// Modèle statistique de Poisson
function poisson(lambda, goals) {
  let factorial = 1;
  for (let i = 2; i <= goals; i++) factorial *= i;

  return Math.exp(-lambda) * Math.pow(lambda, goals) / factorial;
}

function analyzeMatch(match) {
  analysisContainer.innerHTML = "";

  // Hypothèses de démonstration en attendant les statistiques réelles
  const homeLambda = 1.45;
  const awayLambda = 1.15;

  let homeWin = 0, draw = 0, awayWin = 0;
  let bttsYes = 0, over25 = 0;
  const scores = [];

  for (let h = 0; h <= 8; h++) {
    for (let a = 0; a <= 8; a++) {
      const probability =
        poisson(homeLambda, h) * poisson(awayLambda, a);

      if (h > a) homeWin += probability;
      else if (h === a) draw += probability;
      else awayWin += probability;

      if (h > 0 && a > 0) bttsYes += probability;
      if (h + a >= 3) over25 += probability;

      scores.push({
        score: `${h} - ${a}`,
        probability
      });
    }
  }

  scores.sort((a, b) => b.probability - a.probability);

  const bestResult = [
    { name: "Victoire domicile (1)", value: homeWin },
    { name: "Match nul (X)", value: draw },
    { name: "Victoire extérieur (2)", value: awayWin }
  ].sort((a, b) => b.value - a.value)[0];

  const container = document.createElement("div");

  container.innerHTML = `
    <h2>${match.strHomeTeam} vs ${match.strAwayTeam}</h2>
    <p><b>Championnat :</b> ${match.leagueName || "Football"}</p>
    <h3>Pronostics 1X2</h3>
    <p>1 : ${(homeWin * 100).toFixed(1)} %</p>
    <p>X : ${(draw * 100).toFixed(1)} %</p>
    <p>2 : ${(awayWin * 100).toFixed(1)} %</p>

    <h3>BTTS</h3>
    <p>Oui : ${(bttsYes * 100).toFixed(1)} %</p>
    <p>Non : ${((1 - bttsYes) * 100).toFixed(1)} %</p>

    <h3>Over / Under 2,5</h3>
    <p>Over 2,5 : ${(over25 * 100).toFixed(1)} %</p>
    <p>Under 2,5 : ${((1 - over25) * 100).toFixed(1)} %</p>

    <h3>10 scores exacts les plus probables</h3>
    <ol>
      ${scores.slice(0, 10).map(s =>
        `<li>${s.score} — ${(s.probability * 100).toFixed(2)} %</li>`
      ).join("")}
    </ol>

    <h3>Conseil de pari</h3>
    <p>${bestResult.name} : ${(bestResult.value * 100).toFixed(1)} %</p>
    <p>Ces résultats sont des simulations basées sur des hypothèses fixes,
    et non des prédictions fondées sur les statistiques réelles des équipes.</p>
  `;

  analysisContainer.appendChild(container);
  analysisContainer.scrollIntoView({ behavior: "smooth" });
}

loadMatches();
