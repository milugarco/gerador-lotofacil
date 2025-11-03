// Pools de números
const nums1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const nums2 = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25];

// Parâmetros
const GAMES = 10;
const PER_GAME_FROM_1 = 9;
const PER_GAME_FROM_2 = 8;
const REPEAT_POOL1 = 6; // 15 * 6 = 90 = 10 * 9
const REPEAT_POOL2 = 8; // 10 * 8 = 80 = 10 * 8

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateGames({ verbose = false, maxAttempts = 200 } = {}) {
  if (verbose) {
    console.log("🧩 Iniciando geração de jogos...");
    console.log(`Total de jogos: ${GAMES}`);
    console.log(`Números por jogo: ${PER_GAME_FROM_1 + PER_GAME_FROM_2}`);
    console.log("----------------------------------------------------");
  }

  const games = Array.from({ length: GAMES }, (_, i) => ({
    id: i + 1,
    set: new Set(), // conterá números de AMBAS as pools
  }));

  // Alocador robusto por pool usando "deal cards" com retries
  function allocatePoolNumbers(poolNums, repeatEach, perGameNeeded, label) {
    const totalToPlace = poolNums.length * repeatEach;
    const expected = perGameNeeded.reduce((a, b) => a + b, 0);
    if (expected !== totalToPlace) {
      throw new Error(
        `[${label}] Soma de vagas por jogo (${expected}) != total a alocar (${totalToPlace}).`
      );
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Limpa apenas números desta pool (caso seja um retry)
      for (const g of games) {
        for (const n of [...g.set]) {
          if (poolNums.includes(n)) g.set.delete(n);
        }
      }

      const remainingPerGame = perGameNeeded.slice(); // cópia
      // multiconjunto: cada número aparece repeatEach vezes
      const tokens = [];
      for (const n of poolNums)
        for (let k = 0; k < repeatEach; k++) tokens.push(n);
      shuffle(tokens);

      let failed = false;

      for (const n of tokens) {
        // candidatos: jogos com vaga nesta pool e ainda sem esse número
        const candidates = [];
        for (let gi = 0; gi < GAMES; gi++) {
          if (remainingPerGame[gi] > 0 && !games[gi].set.has(n)) {
            candidates.push(gi);
          }
        }

        if (candidates.length === 0) {
          failed = true;
          break; // tenta novamente com outro shuffle
        }

        // Escolhe o jogo com MAIOR capacidade restante (tie-break aleatório)
        let bestCap = -1;
        let best = [];
        for (const gi of candidates) {
          const cap = remainingPerGame[gi];
          if (cap > bestCap) {
            bestCap = cap;
            best = [gi];
          } else if (cap === bestCap) {
            best.push(gi);
          }
        }
        const chosen = best[Math.floor(Math.random() * best.length)];

        games[chosen].set.add(n);
        remainingPerGame[chosen]--;
      }

      if (!failed) {
        if (verbose)
          console.log(`✅ [${label}] alocada na tentativa ${attempt}.`);
        return; // sucesso
      } else {
        if (attempt % 20 === 0 && verbose) {
          console.warn(`⚠️ [${label}] retry ${attempt}/${maxAttempts}...`);
        }
      }
    }

    throw new Error(`[${label}] Falha após ${maxAttempts} tentativas.`);
  }

  // Chama o alocador para cada pool
  allocatePoolNumbers(
    nums1,
    REPEAT_POOL1,
    Array(GAMES).fill(PER_GAME_FROM_1),
    "pool1"
  );
  allocatePoolNumbers(
    nums2,
    REPEAT_POOL2,
    Array(GAMES).fill(PER_GAME_FROM_2),
    "pool2"
  );

  // Converte para arrays ordenadas
  const result = games.map((g) => ({
    id: g.id,
    nums: Array.from(g.set).sort((a, b) => a - b),
  }));

  // Valida: 17 números por jogo
  for (const g of result) {
    const size = g.nums.length;
    if (size !== PER_GAME_FROM_1 + PER_GAME_FROM_2) {
      throw new Error(`Jogo ${g.id} tem ${size} números (esperado: 17).`);
    }
  }

  // Valida: contagens globais
  const counts = new Map();
  for (const g of result)
    for (const n of g.nums) counts.set(n, (counts.get(n) || 0) + 1);
  for (const n of nums1) {
    if (counts.get(n) !== REPEAT_POOL1) {
      throw new Error(
        `Número ${n} (pool1) com repetição ${counts.get(n)} != ${REPEAT_POOL1}`
      );
    }
  }
  for (const n of nums2) {
    if (counts.get(n) !== REPEAT_POOL2) {
      throw new Error(
        `Número ${n} (pool2) com repetição ${counts.get(n)} != ${REPEAT_POOL2}`
      );
    }
  }

  if (verbose)
    console.log("🎲 Jogos gerados com sucesso (todos com 17 números).");
  return result;
}

// === utilidades de pool ===
const POOL1 = new Set(nums1);
const POOL2 = new Set(nums2);
const isPool1 = (n) => POOL1.has(n);
const isPool2 = (n) => POOL2.has(n);

// === comparação e otimização ===
function hitCount(arr, resultSet) {
  let c = 0;
  for (const n of arr) if (resultSet.has(n)) c++;
  return c;
}

/**
 * Empilha números do resultado no melhor jogo via swaps válidos (mesma pool),
 * mantendo todas as regras (17 por jogo, 9/8 por pool, frequências globais).
 */
function optimizeTowardsTarget(games, result, { maxPasses = 200 } = {}) {
  const resultSet = new Set(result);

  // escolhe jogo foco (mais acertos)
  let focusIdx = 0;
  let bestHits = -1;
  for (let i = 0; i < games.length; i++) {
    const h = hitCount(games[i].nums, resultSet);
    if (h > bestHits) {
      bestHits = h;
      focusIdx = i;
    }
  }

  const hasInGame = games.map((g) => new Set(g.nums));

  function tryImproveOnce() {
    for (let j = 0; j < games.length; j++) {
      if (j === focusIdx) continue;

      const focus = games[focusIdx].nums.slice();
      const other = games[j].nums.slice();
      const focusSet = hasInGame[focusIdx];
      const otherSet = hasInGame[j];

      const wantFromOther = other.filter(
        (n) => resultSet.has(n) && !focusSet.has(n)
      );
      if (wantFromOther.length === 0) continue;

      const canLeaveFocus = focus.filter((n) => !resultSet.has(n));

      for (const bring of wantFromOther) {
        const candidatesOut = canLeaveFocus
          .filter(
            (out) =>
              (isPool1(bring) && isPool1(out)) ||
              (isPool2(bring) && isPool2(out))
          )
          .filter((out) => !otherSet.has(out)); // evita duplicata no other

        if (candidatesOut.length === 0) continue;

        const out = candidatesOut[0];
        if (focusSet.has(bring)) continue;

        // aplica swap
        const newFocus = focus
          .filter((x) => x !== out)
          .concat([bring])
          .sort((a, b) => a - b);
        const newOther = other
          .filter((x) => x !== bring)
          .concat([out])
          .sort((a, b) => a - b);

        const newHits = hitCount(newFocus, resultSet);
        if (newHits > bestHits) {
          // commit
          games[focusIdx].nums = newFocus;
          games[j].nums = newOther;

          focusSet.delete(out);
          focusSet.add(bring);
          otherSet.delete(bring);
          otherSet.add(out);

          bestHits = newHits;
          return true; // melhorou, recomeça
        }
        // se não melhorou, tenta outro par
      }
    }
    return false;
  }

  let passes = 0;
  while (passes < maxPasses) {
    const improved = tryImproveOnce();
    if (!improved) break;
    passes++;
  }

  return { focus: focusIdx + 1, hits: bestHits, passes };
}

// ===== Helpers p/ comparação impressa =====
function compareAndReport(games, resultadoArr, label = "resultado") {
  const RESULT_SET = new Set(resultadoArr);
  console.log("----------------------------------------------------");
  console.log(`🎯 Comparando com ${label}:`);
  console.log(`${label}: [${resultadoArr.join(", ")}]`);
  console.log("----------------------------------------------------");

  let melhor = { jogo: null, acertos: -1, nums: [] };
  const hist = new Map();
  for (const g of games) {
    const acertos = g.nums.filter((n) => RESULT_SET.has(n));
    const total = acertos.length;
    hist.set(total, (hist.get(total) || 0) + 1);
    if (total > melhor.acertos)
      melhor = { jogo: g.id, acertos: total, nums: acertos };
    console.log(
      `🎮 Jogo ${g.id}: ${String(total).padStart(
        2,
        " "
      )} acertos → [${acertos.join(", ")}]`
    );
  }
  console.log("----------------------------------------------------");
  console.log(
    `🏆 Melhor jogo: ${melhor.jogo} com ${
      melhor.acertos
    } acertos → [${melhor.nums.join(", ")}]`
  );
  for (const k of [...hist.keys()].sort((a, b) => a - b)) {
    if (k >= 11)
      console.log(`  ${String(k).padStart(2, " ")} → ${hist.get(k)}`);
  }
}

// ===========================
// ===== GERA OS JOGOS =======
const games = generateGames({ verbose: true });
console.log("🧾 Jogos finais (antes):");
for (const g of games)
  console.log(
    `Jogo ${g.id}: [${g.nums.join(", ")}] | Números: ${g.nums.length}`
  );

// ===== Resultados =====
// Resultado passado mantido
const resultadoConcursoPassado = [
  2, 3, 4, 6, 7, 9, 13, 14, 15, 16, 17, 19, 20, 23, 24,
];
// Resultado mais recente solicitado
const resultadoAtual = [1, 3, 5, 6, 7, 9, 10, 16, 18, 19, 20, 22, 23, 24, 25];

// 1) Comparação com o resultadoConcursoPassado (antes da otimização)
compareAndReport(games, resultadoConcursoPassado, "resultadoConcursoPassado");

// ===== OTIMIZAÇÃO (empilhar acertos no melhor jogo do alvo passado) =====
const opt = optimizeTowardsTarget(games, resultadoConcursoPassado, {
  maxPasses: 300,
});

console.log("====================================================");
console.log(
  `🛠️ Otimização concluída (alvo: resultadoConcursoPassado): jogo foco ${opt.focus} | acertos ${opt.hits} | passes ${opt.passes}`
);
console.log("🧾 Jogos finais (depois):");
for (const g of games)
  console.log(
    `Jogo ${g.id}: [${g.nums.join(", ")}] | Números: ${g.nums.length}`
  );

// 2) Após a última geração, comparar com o resultado mais recente
compareAndReport(games, resultadoAtual, "resultadoAtual");
console.log("====================================================");
