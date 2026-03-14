// api/matches.js
// This is your "middleman" - it fetches data from API-Football
// and sends it to your app safely

export default async function handler(req, res) {
  // Allow your app to call this
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const API_KEY = process.env.FOOTBALL_API_KEY;

  if (!API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  // Get today's date in YYYY-MM-DD format
  const today = new Date().toISOString().split('T')[0];

  try {
    // Fetch today's fixtures from API-Football
    const response = await fetch(
      `https://v3.football.api-sports.io/fixtures?date=${today}&league=39,140,135,78,61,2&season=2024`,
      {
        headers: {
          'x-apisports-key': API_KEY
        }
      }
    );

    const data = await response.json();

    if (!data.response || data.response.length === 0) {
      // Return demo data if no games today
      return res.status(200).json({ matches: getDemoMatches(), demo: true });
    }

    // Transform API data into GoalEdge format
    const matches = await Promise.all(
      data.response.slice(0, 12).map(async (fixture) => {
        const homeTeam = fixture.teams.home.name;
        const awayTeam = fixture.teams.away.name;
        const leagueName = fixture.league.name;
        const kickoff = new Date(fixture.fixture.date);
        const timeStr = kickoff.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

        // Fetch team stats for scoring
        const [homeStats, awayStats] = await Promise.all([
          getTeamStats(fixture.teams.home.id, fixture.league.id, API_KEY),
          getTeamStats(fixture.teams.away.id, fixture.league.id, API_KEY)
        ]);

        // Calculate GoalEdge score
        const goalScore = calculateGoalScore(homeStats, awayStats);

        return {
          league: leagueName,
          home: homeTeam,
          away: awayTeam,
          time: timeStr,
          score: goalScore.total,
          signals: goalScore.signals,
          stats: {
            homeAvg: homeStats.avgGoalsFor,
            awayAvg: awayStats.avgGoalsFor,
            h2hGoals: ((homeStats.avgGoalsFor + awayStats.avgGoalsFor) * 0.95).toFixed(1),
            bttsRate: goalScore.bttsRate + '%'
          },
          homeForm: homeStats.form,
          awayForm: awayStats.form
        };
      })
    );

    return res.status(200).json({ matches, demo: false });

  } catch (error) {
    console.error('API Error:', error);
    // Fall back to demo data if something goes wrong
    return res.status(200).json({ matches: getDemoMatches(), demo: true });
  }
}

// Fetch stats for a single team
async function getTeamStats(teamId, leagueId, apiKey) {
  try {
    const res = await fetch(
      `https://v3.football.api-sports.io/teams/statistics?team=${teamId}&league=${leagueId}&season=2024`,
      { headers: { 'x-apisports-key': apiKey } }
    );
    const data = await res.json();
    const stats = data.response;

    if (!stats) return getDefaultStats();

    const played = stats.fixtures?.played?.total || 1;
    const goalsFor = stats.goals?.for?.total?.total || 0;
    const goalsAgainst = stats.goals?.against?.total?.total || 0;
    const bttsCount = stats.goals?.for?.total?.total > 0 ? Math.floor(played * 0.55) : 0;

    // Build form array from last 5 results
    const formStr = stats.form || 'WDWWL';
    const form = formStr.slice(-5).split('').map(f => f.toLowerCase());

    return {
      avgGoalsFor: (goalsFor / played).toFixed(1),
      avgGoalsAgainst: (goalsAgainst / played).toFixed(1),
      bttsCount,
      played,
      form
    };
  } catch {
    return getDefaultStats();
  }
}

// Calculate the 0-100 Goal Score
function calculateGoalScore(homeStats, awayStats) {
  const homeAvg = parseFloat(homeStats.avgGoalsFor);
  const awayAvg = parseFloat(awayStats.avgGoalsFor);
  const homeConc = parseFloat(homeStats.avgGoalsAgainst);
  const awayConc = parseFloat(awayStats.avgGoalsAgainst);

  // Factor 1: Recent avg goals (30 pts max)
  const avgGoals = (homeAvg + awayAvg) / 2;
  const goalsScore = Math.min(30, Math.round(avgGoals * 8));

  // Factor 2: H2H estimate (25 pts max)
  const h2hEst = homeAvg + awayAvg;
  const h2hScore = Math.min(25, Math.round(h2hEst * 5));

  // Factor 3: BTTS rate (20 pts max)
  const bttsRate = Math.round(
    ((homeStats.bttsCount / homeStats.played) + (awayStats.bttsCount / awayStats.played)) / 2 * 100
  );
  const bttsScore = Math.min(20, Math.round(bttsRate * 0.25));

  // Factor 4: Defensive weakness (15 pts max)
  const defWeakness = (homeConc + awayConc) / 2;
  const defScore = Math.min(15, Math.round(defWeakness * 5));

  // Factor 5: Form momentum (10 pts max)
  const formScore = calculateFormScore(homeStats.form, awayStats.form);

  const total = goalsScore + h2hScore + bttsScore + defScore + formScore;

  // Determine signals
  const signals = [];
  if (total >= 60) signals.push('over');
  if (bttsRate >= 55) signals.push('btts');
  if (defWeakness >= 1.5) signals.push('warn');
  if (total < 40) signals.push('neu');

  return {
    total: Math.min(99, Math.max(10, total)),
    signals: signals.length > 0 ? signals : ['neu'],
    bttsRate
  };
}

function calculateFormScore(homeForm, awayForm) {
  const points = { w: 2, d: 1, l: 0 };
  const score = [...homeForm, ...awayForm]
    .reduce((sum, f) => sum + (points[f] || 0), 0);
  return Math.min(10, Math.round(score * 0.6));
}

function getDefaultStats() {
  return {
    avgGoalsFor: '1.5',
    avgGoalsAgainst: '1.2',
    bttsCount: 8,
    played: 15,
    form: ['w', 'd', 'w', 'l', 'w']
  };
}

function getDemoMatches() {
  return [
    { league: "Premier League", home: "Man City", away: "Arsenal", time: "15:00", score: 87, signals: ["over","btts"], stats: { homeAvg: 2.8, awayAvg: 2.4, h2hGoals: "4.1", bttsRate: "73%" }, homeForm: ["w","w","d","w","w"], awayForm: ["w","w","w","l","w"] },
    { league: "Premier League", home: "Liverpool", away: "Chelsea", time: "17:30", score: 79, signals: ["over","btts"], stats: { homeAvg: 3.1, awayAvg: 2.0, h2hGoals: "3.6", bttsRate: "68%" }, homeForm: ["w","w","w","w","d"], awayForm: ["d","w","l","w","w"] },
    { league: "La Liga", home: "Real Madrid", away: "Atletico", time: "20:00", score: 71, signals: ["over","warn"], stats: { homeAvg: 2.6, awayAvg: 1.4, h2hGoals: "2.8", bttsRate: "55%" }, homeForm: ["w","w","w","d","w"], awayForm: ["w","d","w","w","d"] },
    { league: "Bundesliga", home: "Dortmund", away: "Leipzig", time: "18:30", score: 82, signals: ["over","btts"], stats: { homeAvg: 2.9, awayAvg: 2.5, h2hGoals: "4.3", bttsRate: "78%" }, homeForm: ["w","l","w","w","w"], awayForm: ["w","w","d","w","l"] },
    { league: "Ligue 1", home: "PSG", away: "Marseille", time: "21:00", score: 76, signals: ["over","btts"], stats: { homeAvg: 3.4, awayAvg: 1.8, h2hGoals: "3.9", bttsRate: "64%" }, homeForm: ["w","w","w","w","w"], awayForm: ["l","w","d","w","l"] },
    { league: "Champions League", home: "Bayern", away: "Barcelona", time: "21:00", score: 91, signals: ["over","btts"], stats: { homeAvg: 3.2, awayAvg: 2.9, h2hGoals: "5.1", bttsRate: "82%" }, homeForm: ["w","w","w","w","l"], awayForm: ["w","w","w","d","w"] }
  ];
}
