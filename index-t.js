// ======================= CONFIG BÁSICA =======================
const POOL = Array.from({ length: 25 }, (_, i) => i + 1); // 1..25
function groupOf(n) { if (n<=9) return 'L'; if (n<=19) return 'M'; return 'H'; }
const PREMIO_TABELA = { 11: 7, 12: 14, 13: 35, 14: 2200, 15: 1000000 };
const CUSTO_POR_BILHETE = 3.5;

// ================= Helpers gerais =================
function normalize(v){ const s=v.reduce((a,b)=>a+b,0); return s>0?v.map(x=>x/s):v.map(_=>1/v.length); }
function uniq(a){ return [...new Set(a)]; }

// -------- Soft stuff / amostragem ----------
function expDecayWeight(age, halfLife=15){ const λ=Math.log(2)/Math.max(1,halfLife); return Math.exp(-λ*age); }
function sampleKWeightedNoReplace(items, weights, k){
  const g = items.map((it,i)=>{
    const u=Math.random(); const gumbel=-Math.log(-Math.log(Math.max(u,1e-12)));
    return {it, score: Math.log(Math.max(weights[i],1e-12))+gumbel};
  });
  g.sort((a,b)=>b.score-a.score);
  return g.slice(0,k).map(e=>e.it);
}

// ================= Pesos, coocorrência e metas =================
function buildNumberWeightsFromHistory(history, {halfLife=20, laplace=1.0, hotColdExpo=1.1}={}){
  const N=25, counts=Array(N).fill(0), days=history?.length||0;
  if(days>0){
    for(let d=0; d<days; d++){
      const w=expDecayWeight(days-1-d, halfLife);
      for(const n of history[d]) counts[n-1]+=w;
    }
  } else {
    for(let i=0;i<N;i++) counts[i]=1;
  }
  const base = counts.map(c=>Math.pow(c+laplace, hotColdExpo));
  return normalize(base);
}

function buildPMIPairBoost(history, {laplace=0.1, scale=0.12}={}){
  const N=25;
  if(!history || history.length===0) return Array.from({length:N},()=>Array(N).fill(0));
  const cnt1=Array(N).fill(0), cnt2=Array.from({length:N},()=>Array(N).fill(0));
  let T=0;
  for(const res of history){
    T++; const s=new Set(res); const arr=[...s].sort((a,b)=>a-b);
    for(const n of arr) cnt1[n-1]+=1;
    for(let i=0;i<arr.length;i++){
      for(let j=i+1;j<arr.length;j++){
        const a=arr[i]-1, b=arr[j]-1;
        cnt2[a][b]+=1; cnt2[b][a]+=1;
      }
    }
  }
  const p1 = cnt1.map(c=>(c+laplace)/(T+25*laplace));
  const boost = Array.from({length:N},()=>Array(N).fill(0));
  for(let i=0;i<N;i++){
    for(let j=0;j<N;j++){
      if(i===j){ boost[i][j]=0; continue; }
      const pij = (cnt2[i][j]+laplace)/(T+laplace*25);
      const denom = p1[i]*p1[j];
      const pmi = Math.log(Math.max(pij,1e-12)/Math.max(denom,1e-12));
      boost[i][j] = Math.max(0,pmi)*scale;
    }
  }
  return boost;
}

function targetLMHFromHistory(history){
  if(!history || history.length===0) return {L:5,M:6,H:4};
  let cL=0,cM=0,cH=0, tot=0;
  for(const res of history){
    for(const n of res){
      const g=groupOf(n);
      if(g==='L') cL++; else if(g==='M') cM++; else cH++;
      tot++;
    }
  }
  const pL=cL/tot, pM=cM/tot; let tL=Math.round(pL*15), tM=Math.round(pM*15), tH=15-tL-tM;
  while(tL<0){tL++;tM--;} while(tM<0){tM++;tH--;}
  while(tL+tM+tH<15) tM++; while(tL+tM+tH>15) tM--;
  tL=Math.max(3,Math.min(8,tL)); tH=Math.max(2,Math.min(6,tH)); tM=15-tL-tH;
  return {L:tL,M:tM,H:tH};
}

// ================= Montagem de um bilhete ponderado =================
function buildOneTicketWeighted({
  required=[],
  weightsNum, targetLMH, coocBoost,
  seenSignatures, pickedSoFar,
  overlapPenalty=0.12, perNumberCap=4,
  dailyCountMap, maxTries=2000
}){
  const ALLn = POOL.slice();
  const reqSet = new Set(required);
  let needL = targetLMH.L - required.filter(n=>groupOf(n)==='L').length;
  let needM = targetLMH.M - required.filter(n=>groupOf(n)==='M').length;
  let needH = targetLMH.H - required.filter(n=>groupOf(n)==='H').length;
  needL=Math.max(0,needL); needM=Math.max(0,needM); needH=Math.max(0,needH);

  const candidates = ALLn.filter(n=>!reqSet.has(n));

  function incrementalScore(setChosen, candidate){
    const idx=candidate-1;
    let s = Math.log(Math.max(weightsNum[idx],1e-9));
    for(const x of setChosen){ s += coocBoost[idx][x-1] + coocBoost[x-1][idx]; }
    for(const t of pickedSoFar){ if(t.has(candidate)) s -= overlapPenalty; }
    const used = dailyCountMap.get(candidate)||0;
    if(used>=perNumberCap) s -= 10;
    return s;
  }

  for(let att=1; att<=maxTries; att++){
    const chosen = new Set(required);
    const Lcand = candidates.filter(n=>groupOf(n)==='L');
    const Mcand = candidates.filter(n=>groupOf(n)==='M');
    const Hcand = candidates.filter(n=>groupOf(n)==='H');

    function pickGroup(k, pool){
      if(k<=0) return [];
      const picked=[];
      let local=pool.slice();
      for(let i=0;i<k && local.length>0;i++){
        const keyed = local.map(n=>{
          const u=Math.random(); const g=-Math.log(-Math.log(Math.max(u,1e-12)));
          return {n, s: incrementalScore(chosen,n)+g};
        }).sort((a,b)=>b.s-a.s);
        const best = keyed[0].n;
        picked.push(best); chosen.add(best);
        local = local.filter(x=>x!==best);
      }
      return picked;
    }

    pickGroup(needL, Lcand);
    pickGroup(needM, Mcand);
    pickGroup(needH, Hcand);

    let remain = 15 - chosen.size;
    if(remain>0){
      const rest = candidates.filter(n=>!chosen.has(n))
        .map(n=>({n, s: incrementalScore(chosen,n)}))
        .sort((a,b)=>b.s-a.s);
      for(let i=0;i<rest.length && remain>0;i++){ chosen.add(rest[i].n); remain--; }
    }

    if(chosen.size!==15) continue;
    const arr=[...chosen].sort((a,b)=>a-b);
    const sig=arr.join(',');
    if(seenSignatures.has(sig)) continue;

    for(const n of arr) dailyCountMap.set(n, (dailyCountMap.get(n)||0)+1);
    seenSignatures.add(sig);
    return { nums: arr, requiredUsed: required.slice() };
  }
  throw new Error('Falhou em montar bilhete ponderado único.');
}

// ================= Geração de resultados e bilhetes =================
function randomResultado(history=null){
  const weightsNum = buildNumberWeightsFromHistory(history,{halfLife:20, laplace:1.0, hotColdExpo:1.0});
  const coocBoost = buildPMIPairBoost(history,{laplace:0.1, scale:0.1});
  const targetLMH = targetLMHFromHistory(history);
  const t = buildOneTicketWeighted({
    required: [], weightsNum, targetLMH, coocBoost,
    seenSignatures: new Set(), pickedSoFar: [],
    overlapPenalty: 0, perNumberCap: 99, dailyCountMap: new Map()
  });
  return t.nums;
}

function generateSingleGame(seen, extraRequired, ctx){
  const history = ctx?.history || null;
  const weightsNum = ctx?.weightsNum || buildNumberWeightsFromHistory(history,{halfLife:20, laplace:1.0, hotColdExpo:1.1});
  const coocBoost = ctx?.coocBoost || buildPMIPairBoost(history,{laplace:0.1, scale:0.12});
  const targetLMH = ctx?.targetLMH || targetLMHFromHistory(history);
  const pickedSoFar = ctx?.pickedSoFar || [];
  const dailyCountMap = ctx?.dailyCountMap || new Map();
  const overlapPenalty = ctx?.overlapPenalty ?? 0.12;
  const perNumberCap = ctx?.perNumberCap ?? 4;

  const REQUIRED = uniq((extraRequired||[]).filter(n=>n>=1 && n<=25)).slice(0,15);

  const res = buildOneTicketWeighted({
    required: REQUIRED,
    weightsNum, targetLMH, coocBoost,
    seenSignatures: seen, pickedSoFar,
    overlapPenalty, perNumberCap, dailyCountMap
  });
  return { nums: res.nums, required: REQUIRED };
}

function generateManyGames(total=10, extraRequired=[], ctx=null){
  const seen=new Set(); const games=[]; const pickedSoFar=[]; const dailyCountMap=new Map();
  const history = ctx?.history || null;
  const weightsNum = buildNumberWeightsFromHistory(history,{halfLife:20, laplace:1.0, hotColdExpo:1.1});
  const coocBoost = buildPMIPairBoost(history,{laplace:0.1, scale:0.12});
  const targetLMH = targetLMHFromHistory(history);
  const overlapPenalty = ctx?.overlapPenalty ?? 0.12;
  const perNumberCap = ctx?.perNumberCap ?? Math.max(3, Math.floor(total*0.45));

  for(let i=0;i<total;i++){
    const g = generateSingleGame(seen, extraRequired, {
      history, weightsNum, coocBoost, targetLMH,
      pickedSoFar, overlapPenalty, perNumberCap, dailyCountMap
    });
    games.push({ id:i+1, nums:g.nums, required:g.required });
    pickedSoFar.push(new Set(g.nums));
  }
  return games;
}

// ================= Contagem e Simulação =================
function countHitsForResult(games, resultado){
  const set=new Set(resultado);
  return games.map(g => g.nums.reduce((c,n)=>c+(set.has(n)?1:0),0));
}

function runDailySimulation({
  days=30,
  ticketsPerDay=10,
  resultsPerDay=null,
  requiredEachTicket=[],
  showDailySamples=false
}={}){
  let totalCusto=0, totalPremios=0;
  const aggBuckets={11:0,12:0,13:0,14:0,15:0};
  const internalHistory=[];

  console.log("====================================================");
  console.log(`📅 Temporada: ${days} dias | ${ticketsPerDay} bilhetes/dia`);
  console.log(`🔒 Obrigatórios: [${requiredEachTicket.join(", ")||"-"}]`);
  console.log("====================================================");

  for(let d=1; d<=days; d++){
    const historySource = resultsPerDay ? resultsPerDay : internalHistory;
    const historySoFar = historySource.slice(0, Math.max(0, d-1));

    const tickets = generateManyGames(ticketsPerDay, requiredEachTicket, { history: historySoFar });

    const resultOfDay =
      (resultsPerDay && Array.isArray(resultsPerDay[d-1]) && resultsPerDay[d-1].length===15)
        ? [...resultsPerDay[d-1]].sort((a,b)=>a-b)
        : randomResultado(historySoFar);

    if(!resultsPerDay) internalHistory.push(resultOfDay);

    const hits = countHitsForResult(tickets, resultOfDay);
    const custoDia = ticketsPerDay*CUSTO_POR_BILHETE;
    let premiosDia = 0; const dayBuckets={11:0,12:0,13:0,14:0,15:0};
    for(const h of hits){ if(dayBuckets[h]!==undefined){ dayBuckets[h]+=1; premiosDia+=PREMIO_TABELA[h]; } }

    totalCusto+=custoDia; totalPremios+=premiosDia;
    for(const k of Object.keys(aggBuckets)) aggBuckets[k]+=dayBuckets[k];

    console.log(`Dia ${String(d).padStart(2,"0")} — Resultado: [${resultOfDay.join(", ")}]`);
    console.log(`  💸 Custo: R$ ${custoDia.toFixed(2)} | 🏆 Prêmios: R$ ${premiosDia.toFixed(2)} | ${(premiosDia-custoDia>=0?'✅ Lucro':'❌ Prejuízo')}: R$ ${(premiosDia-custoDia).toFixed(2)}`);
    console.log(`  📊 Acertos: 11:${dayBuckets[11]}  12:${dayBuckets[12]}  13:${dayBuckets[13]}  14:${dayBuckets[14]}  15:${dayBuckets[15]}`);

    if(showDailySamples){
      console.log("  🧾 Amostra (5):");
      tickets.slice(0,5).forEach(g=>console.log(`   • (req: ${g.required.join(", ")}): [${g.nums.join(", ")}]`));
    }
    console.log("----------------------------------------------------");
  }

  const lucro = totalPremios-totalCusto;
  const roi = totalCusto>0 ? (totalPremios/totalCusto)*100 : 0;
  console.log("====================================================");
  console.log(`🧮 RESUMO — ${days} dias | ${ticketsPerDay*days} bilhetes`);
  console.log(`💸 Gasto total: R$ ${totalCusto.toFixed(2)}`);
  console.log(`🏆 Prêmios totais: R$ ${totalPremios.toFixed(2)}`);
  console.log(`${lucro>=0?'✅ LUCRO':'❌ PREJUÍZO'}: R$ ${lucro.toFixed(2)}  (ROI: ${roi.toFixed(2)}%)`);
  console.log(`📈 11→${aggBuckets[11]} | 12→${aggBuckets[12]} | 13→${aggBuckets[13]} | 14→${aggBuckets[14]} | 15→${aggBuckets[15]}`);
  console.log("====================================================");
}

// ===================== EXECUÇÃO (10 jogos/dia × 30 dias) =====================
runDailySimulation({
  days: 300,
  ticketsPerDay: 1000,
  // Se quiser forçar alguns obrigatórios, adicione aqui (máximo 15 números)
  requiredEachTicket: [],        // ex.: [1,3,20]
  showDailySamples: false
});
