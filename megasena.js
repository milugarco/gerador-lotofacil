// ======================= CONFIG BÁSICA =======================
const POOL = Array.from({ length: 60 }, (_, i) => i + 1); // 1..60
const CUSTO_POR_BILHETE = 5.0;
const PREMIO_TABELA = { 4: 680, 5: 37000, 6: 5000000 }; // valores simbólicos
const DISALLOWED = new Set([26, 21, 55, 22,  31, 3, 48, 40, 60]); // proibidos (mude como quiser)

// ================= Helpers =================
function normalize(v) {
  const s = v.reduce((a, b) => a + b, 0);
  return s > 0 ? v.map((x) => x / s) : v.map((_) => 1 / v.length);
}
function uniq(a) {
  return [...new Set(a)];
}
function expDecayWeight(age, halfLife = 25) {
  const λ = Math.log(2) / Math.max(1, halfLife);
  return Math.exp(-λ * age);
}
function sampleKWeightedNoReplace(items, weights, k) {
  const g = items.map((it, i) => {
    const u = Math.random();
    const gumbel = -Math.log(-Math.log(Math.max(u, 1e-12)));
    return { it, score: Math.log(Math.max(weights[i], 1e-12)) + gumbel };
  });
  g.sort((a, b) => b.score - a.score);
  return g.slice(0, k).map((e) => e.it);
}

// ================= Pesos e Coocorrência =================
function buildNumberWeightsFromHistory(history, { halfLife = 40 } = {}) {
  const N = 60,
    counts = Array(N).fill(0),
    days = history?.length || 0;
  if (days > 0) {
    for (let d = 0; d < days; d++) {
      const w = expDecayWeight(days - 1 - d, halfLife);
      for (const n of history[d]) counts[n - 1] += w;
    }
  } else {
    for (let i = 0; i < N; i++) counts[i] = 1;
  }
  return normalize(counts);
}

// ================= Sorteio de bilhetes =================
function buildOneMegaTicket({
  required = [],
  weightsNum,
  seenSignatures,
  pickedSoFar,
  overlapPenalty = 0.08,
  perNumberCap = 3,
  dailyCountMap,
  maxTries = 2000,
}) {
  const ALLn = POOL.slice();
  const reqSet = new Set(required);
  const candidates = ALLn.filter((n) => !reqSet.has(n) && !DISALLOWED.has(n));

  for (const n of reqSet) {
    if (DISALLOWED.has(n)) {
      throw new Error(`Número proibido (${n}) encontrado em REQUIRED.`);
    }
  }

  function incrementalScore(setChosen, candidate) {
    const idx = candidate - 1;
    let s = Math.log(Math.max(weightsNum[idx], 1e-9));
    for (const t of pickedSoFar) {
      if (t.has(candidate)) s -= overlapPenalty;
    }
    const used = dailyCountMap.get(candidate) || 0;
    if (used >= perNumberCap) s -= 10;
    return s;
  }

  for (let att = 1; att <= maxTries; att++) {
    const chosen = new Set(required);
    const local = candidates.slice();
    while (chosen.size < 6 && local.length > 0) {
      const keyed = local
        .map((n) => {
          const u = Math.random();
          const g = -Math.log(-Math.log(Math.max(u, 1e-12)));
          return { n, s: incrementalScore(chosen, n) + g };
        })
        .sort((a, b) => b.s - a.s);
      const best = keyed[0].n;
      chosen.add(best);
      local.splice(local.indexOf(best), 1);
    }
    if (chosen.size !== 6) continue;
    const arr = [...chosen].sort((a, b) => a - b);
    const sig = arr.join(",");
    if (seenSignatures.has(sig)) continue;

    for (const n of arr) dailyCountMap.set(n, (dailyCountMap.get(n) || 0) + 1);
    seenSignatures.add(sig);
    return { nums: arr };
  }
  throw new Error("Falhou em montar bilhete único.");
}

function generateManyMegaGames(total = 10, extraRequired = [], ctx = null) {
  const seen = new Set();
  const games = [];
  const pickedSoFar = [];
  const dailyCountMap = new Map();
  const history = ctx?.history || null;
  const weightsNum = buildNumberWeightsFromHistory(history);
  const overlapPenalty = ctx?.overlapPenalty ?? 0.08;
  const perNumberCap = ctx?.perNumberCap ?? 3;

  for (let i = 0; i < total; i++) {
    const g = buildOneMegaTicket({
      required: uniq(extraRequired),
      weightsNum,
      seenSignatures: seen,
      pickedSoFar,
      overlapPenalty,
      perNumberCap,
      dailyCountMap,
    });
    games.push({ id: i + 1, nums: g.nums });
    pickedSoFar.push(new Set(g.nums));
  }
  return games;
}

// ================= Comparador =================
function parseResultString(str) {
  const nums = str
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((n) => n >= 1 && n <= 60);
  if (nums.length !== 6)
    throw new Error("Resultado inválido: precisa ter 6 dezenas de 1 a 60.");
  return [...new Set(nums)].sort((a, b) => a - b);
}

function countHitsForResult(games, resultado) {
  const set = new Set(resultado);
  return games.map((g) => g.nums.reduce((c, n) => c + (set.has(n) ? 1 : 0), 0));
}

function compareMegaGames(games, resultStr) {
  const resultado = parseResultString(resultStr);
  const hits = countHitsForResult(games, resultado);
  let totalPremios = 0;
  const buckets = { 4: 0, 5: 0, 6: 0 };

  console.log("\n=== Comparação com o resultado ===");
  console.log(
    "Resultado:",
    resultado.map((n) => String(n).padStart(2, "0")).join(" ")
  );

  games.forEach((g, i) => {
    const acertos = hits[i];
    const premiado = PREMIO_TABELA[acertos] != null;
    if (premiado) {
      buckets[acertos] += 1;
      totalPremios += PREMIO_TABELA[acertos];
    }
    const line = g.nums.map((n) => String(n).padStart(2, "0")).join(" ");
    console.log(
      `#${String(i + 1).padStart(2, "0")} [${line}] -> ${acertos} acertos` +
        (premiado ? ` (R$ ${PREMIO_TABELA[acertos].toFixed(2)})` : "")
    );
  });

  const custo = games.length * CUSTO_POR_BILHETE;
  const lucro = totalPremios - custo;
  const roi = custo > 0 ? (totalPremios / custo) * 100 : 0;

  console.log("\n--- Resumo ---");
  console.log(`4→${buckets[4]} | 5→${buckets[5]} | 6→${buckets[6]}`);
  console.log(
    `Bilhetes: ${games.length} | Custo: R$ ${custo.toFixed(
      2
    )} | Prêmios: R$ ${totalPremios.toFixed(2)}`
  );
  console.log(
    `${lucro >= 0 ? "✅ Lucro" : "❌ Prejuízo"}: R$ ${lucro.toFixed(
      2
    )} (ROI: ${roi.toFixed(2)}%)`
  );
}

// ================= Main =================
(function mainMega() {
  const RAW_REQUIRED = []; // fixos (opcional)
  const REQUIRED = RAW_REQUIRED.filter((n) => !DISALLOWED.has(n));
  const removed = RAW_REQUIRED.filter((n) => DISALLOWED.has(n));
  if (removed.length) {
    console.warn(
      "⚠️ REQUIRED continha números proibidos e foram removidos:",
      removed.join(", ")
    );
  }

  const games = generateManyMegaGames(10, REQUIRED, { history: null });

  console.log("\n=== 10 jogos Mega-Sena (sem proibidos) ===");
  games.forEach((g) =>
    console.log(g.nums.map((n) => String(n).padStart(2, "0")).join(" "))
  );

  // 👉 altere este resultado a cada sorteio
  const RESULT_STR = "04 07 09 15 29 32";

  compareMegaGames(games, RESULT_STR);
})();
