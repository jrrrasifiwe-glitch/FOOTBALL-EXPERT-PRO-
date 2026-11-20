
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

  let allMatches = [];

  for (const league of leagues) {
    try {
      const response = await fetch(
        `https://www.thesportsdb.com/api/v1/json/3/eventsnextleague.php?id=${league.id}`
      );

      if (!response.ok) continue;

      const data = await response.json();

      if (data.events) {
        allMatches.push(
          ...data.events.map(match => ({
            ...match,
            leagueName: league.name
          }))
        );
      }
    } catch (error) {
      console.error("Erreur:", league.name, error);
    }
  }

  if (allMatches.length === 0) {
    matchesContainer.textContent =
      "Aucun match disponible depuis les sources gratuites. Réessaie plus tard.";
    return;
  }

  allMatches.sort((a, b) =>
    (a.dateEvent || "").localeCompare(b.dateEvent || "")
  );

  matchesContainer.innerHTML = "";

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
    button.textContent = "ANALYSER CE MATCH";

    button.onclick = () => analyzeMatch(match);

    card.append(league, title, date, button);
    matchesContainer.appendChild(card);
  });
}

function analyzeMatch(match) {
  analysisContainer.innerHTML = "";

  const title = document.createElement("h2");
  title.textContent =
    `${match.strHomeTeam} vs ${match.strAwayTeam}`;

  const explanation = document.createElement("p");
  explanation.textContent =
    "Analyse statistique en attente des données historiques des deux équipes. Les scores ci-dessous sont des scénarios de démonstration et non des prédictions calculées.";

  const scoresTitle = document.createElement("h3");
  scoresTitle.textContent = "10 scénarios de scores exacts";

  const scores = [
    "1-0", "1-1", "2-1", "2-0", "0-0",
    "0-1", "2-2", "3-1", "1-2", "3-0"
  ];

  const list = document.createElement("ol");

  scores.forEach(score => {
    const item = document.createElement("li");
    item.textContent = score;
    list.appendChild(item);
  });

  const advice = document.createElement("p");
  advice.textContent =
    "Conseil : ne mise pas sans données statistiques fiables.";

  analysisContainer.append(title, explanation, scoresTitle, list, advice);
  analysisContainer.scrollIntoView({ behavior: "smooth" });
}

loadMatches();
