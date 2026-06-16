/* wc-engine.js — shared World Cup 2026 data engine (extracted verbatim from the
   verified dashboard). Pure data + helpers: fetch, derive, compute. No page render,
   no event wiring. Loaded by both index.html (desktop) and mobile.html. */

const API = "https://www.thesportsdb.com/api/v1/json/3";

const LEAGUE = "4429";          // FIFA World Cup

const SEASON = "2026";

const STORE_KEY = "wc2026_fav";

let FIXTURES = [];              // all matches (normalized)

let GROUPS = [];               // [{letter, teams:[stat rows], matches:[]}]

let TEAM_OF_GROUP = {};        // team -> group letter

let TEAM_BADGE = {};           // team -> crest url

let TEAMS = [];               // sorted team names

let SCORERS = [];             // [{name, team, goals}]

let fav = localStorage.getItem(STORE_KEY) || "";

const TL_CACHE = {};           // event id -> match timeline (real goal events)

const ES_CACHE = {};           // event id -> eventstats array (real shot data)

const LU_CACHE = {};           // event id -> lineup array

const BIO_CACHE = {};          // player id -> bio object | null

let STATS = null;              // aggregated tournament statistics

let PLAYERS = [];              // registry of players surfaced in match data

const $ = s => document.querySelector(s);

const isFav = n => fav && n && n.toLowerCase() === fav.toLowerCase();

function toDate(s){
  if(!s) return null;
  let v = String(s).replace(' ', 'T');
  if(!/[zZ]|[+-]\d{2}:?\d{2}$/.test(v)) v += 'Z';
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

const TS = x => { const d = toDate(x); return d ? d.getTime() : 0; };

// Escape any string before it goes into innerHTML. Data is escaped at the source
// (normalizeEspn/loadStandings/espnRosterPlayers) and at render for raw ESPN summary
// fields, so a hostile name from the feed can never inject markup.
const ESC_MAP = { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" };
const esc = s => s==null ? "" : String(s).replace(/[&<>"']/g, c => ESC_MAP[c]);

function crest(name, lg){
  name = name==null ? "" : String(name);           // tolerate non-string input
  const b = TEAM_BADGE[name];
  const cls = "crest" + (lg ? " lg" : "");
  if(b) return `<img class="${cls}" src="${esc(b)}" alt="" loading="lazy">`;
  return `<span class="${cls} fallback">${(name||"?").replace(/[^A-Za-z]/g,"").slice(0,3).toUpperCase()}</span>`;
}

const teamLabel = name => `<span class="tcell">${crest(name)}<span>${name}</span></span>`;

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJSON(url, _try){
  _try = _try || 0;
  let r;
  try { r = await fetch(url, { cache: "no-store" }); }
  catch(e){ if(_try < 2){ await sleep(1200*(_try+1)); return getJSON(url, _try+1); } throw e; }
  if(r.status === 429){
    if(_try < 3){ await sleep(2000*(_try+1)); return getJSON(url, _try+1); }
    throw new Error("rate-limited by data provider (429)");
  }
  if(!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

// ESPN event -> our match shape. ESPN is the reliable, keyless primary source.
// ESPN season.slug -> stage label, knockout flag, and bracket order
const STAGE = {
  "group-stage":  { label:"Group stage",   ko:false, order:0 },
  "round-of-32":  { label:"Round of 32",   ko:true,  order:1 },
  "round-of-16":  { label:"Round of 16",   ko:true,  order:2 },
  "quarterfinals":{ label:"Quarter-finals",ko:true,  order:3 },
  "semifinals":   { label:"Semi-finals",   ko:true,  order:4 },
  "3rd-place":    { label:"Third-place",   ko:true,  order:5 },
  "third-place":  { label:"Third-place",   ko:true,  order:5 },
  "final":        { label:"Final",         ko:true,  order:6 }
};
function normalizeEspn(ev){
  const comp = (ev.competitions||[])[0] || {};
  const cs = comp.competitors || [];
  const h = cs.find(c=>c.homeAway==="home") || cs[0] || {};
  const a = cs.find(c=>c.homeAway==="away") || cs[1] || {};
  const state = (((ev.status||comp.status||{}).type)||{}).state;   // pre | in | post
  const status = state==="post" ? "ft" : state==="in" ? "live" : "up";
  const num = v => { const n = parseInt(v,10); return isNaN(n) ? null : n; };
  const st = STAGE[((ev.season||{}).slug)||""] || { label:"", ko:false, order:0 };
  return {
    id: ev.id, date: ev.date,
    home: esc((h.team||{}).displayName) || "", away: esc((a.team||{}).displayName) || "",
    hs: status==="up" ? null : num(h.score),
    as: status==="up" ? null : num(a.score),
    status,
    venue: esc((comp.venue||{}).fullName) || "",
    country: esc(((comp.venue||{}).address||{}).country) || "",
    stage: st.label, knockout: st.ko, stageOrder: st.order,
    homeBadge: esc((h.team||{}).logo) || "", awayBadge: esc((a.team||{}).logo) || ""
  };
}
// official groups + live standings, straight from ESPN (no derivation, no rate limit)
async function loadStandings(){
  const d = await getJSON(`https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings?season=${SEASON}`);
  const ch = d.children || [];
  if(!ch.length) throw new Error("no standings");
  const tog = {};
  GROUPS = ch.map(c=>{
    const letter = esc((c.name||"").replace(/^Group\s*/i,"").trim() || c.abbreviation || "?");
    const entries = ((c.standings||{}).entries) || [];
    const teams = entries.map(e=>{
      const st = {}; (e.stats||[]).forEach(s=> st[s.name] = s.value!=null ? s.value : parseFloat(s.displayValue));
      const team = esc((e.team||{}).displayName);
      return { team, P:+st.gamesPlayed||0, W:+st.wins||0, D:+st.ties||0, L:+st.losses||0,
               GF:+st.pointsFor||0, GA:+st.pointsAgainst||0, Pts:+st.points||0, rank:+st.rank||0 };
    }).sort((x,y)=> (x.rank&&y.rank) ? x.rank-y.rank : (y.Pts-x.Pts) || ((y.GF-y.GA)-(x.GF-x.GA)) || (y.GF-x.GF));
    teams.forEach(t=> tog[t.team] = letter);
    return { letter, teams, matches: [] };
  });
  TEAM_OF_GROUP = tog;
  GROUPS.forEach(g=>{ const names = new Set(g.teams.map(t=>t.team)); g.matches = FIXTURES.filter(m=> names.has(m.home) && names.has(m.away)); });
}
async function loadData(){
  // PRIMARY: ESPN (free, keyless, reliable). All fixtures in one ranged call;
  // official groups + live standings in another. (TheSportsDB's shared key rate-limits.)
  const sb = await getJSON(`${ESPN}/scoreboard?dates=20260611-20260719`);
  const events = sb.events || [];
  if(!events.length) throw new Error("no fixtures returned");
  FIXTURES = events.map(normalizeEspn).filter(m=> m.home && m.away).sort((a,b)=> TS(a.date)-TS(b.date));
  FIXTURES.forEach(m=>{ if(m.homeBadge) TEAM_BADGE[m.home]=m.homeBadge; if(m.awayBadge) TEAM_BADGE[m.away]=m.awayBadge; });
  try { await loadStandings(); } catch(_){ /* matches still work even if standings hiccups */ }
  TEAMS = [...new Set([...FIXTURES.flatMap(m=>[m.home,m.away]), ...GROUPS.flatMap(g=>g.teams.map(t=>t.team))].filter(Boolean))].sort();
}

// Flatten an ESPN match summary's rosters into per-player records (real names +
// per-match stats: goals, cards, shots…). The backbone of scorers + players.
function espnRosterPlayers(sum){
  const out = [];
  (sum.rosters||[]).forEach(r=>{
    const team = esc((r.team||{}).displayName);
    (r.roster||[]).forEach(p=>{
      const st = {}; (p.stats||[]).forEach(s=> st[s.name] = s.value);
      const ath = p.athlete || {};
      out.push({
        id: ath.id, name: esc(ath.displayName), team,
        goals:+st.totalGoals||0, og:+st.ownGoals||0, yc:+st.yellowCards||0, rc:+st.redCards||0,
        assists:+st.goalAssists||0, shots:+st.totalShots||0, sot:+st.shotsOnTarget||0, saves:+st.saves||0,
        pos:esc((p.position||{}).abbreviation)||"", num:p.jersey, starter:!!p.starter
      });
    });
  });
  return out;
}

async function loadScorers(){
  const finished = FIXTURES.filter(m=>m.status === "ft").slice(0, 120);
  const tally = {};
  await Promise.all(finished.map(async m=>{
    const sum = await espnSummary(m.id); if(!sum) return;
    espnRosterPlayers(sum).forEach(p=>{
      if(!p.goals || !p.name) return;
      const key = p.id || (p.name+"|"+p.team);
      const e = (tally[key] = tally[key] || { name:p.name, team:p.team, goals:0, id:p.id });
      e.goals += p.goals;
    });
  }));
  SCORERS = Object.values(tally).sort((a,b)=> b.goals - a.goals || a.name.localeCompare(b.name)).slice(0, 30);
}

async function loadStats(){
  const finished = FIXTURES.filter(m=>m.status==="ft" && m.hs!=null).sort((a,b)=>TS(a.date)-TS(b.date));

  // --- Tier 1: from results we already hold ---
  let goals=0, cleanSheets=0, draws=0, decisive=0, biggest=null, highest=null;
  const form={};
  finished.forEach(m=>{
    goals += m.hs + m.as;
    if(m.as===0) cleanSheets++;
    if(m.hs===0) cleanSheets++;
    if(m.hs===m.as) draws++; else decisive++;
    const marg=Math.abs(m.hs-m.as), tot=m.hs+m.as;
    if(!biggest || marg>biggest.marg) biggest={m, marg};
    if(!highest || tot>highest.tot) highest={m, tot};
    const r = m.hs>m.as ? ["W","L"] : m.hs<m.as ? ["L","W"] : ["D","D"];
    (form[m.home]=form[m.home]||[]).push(r[0]);
    (form[m.away]=form[m.away]||[]).push(r[1]);
  });

  // team rows + third-placed race + qualification (conservative, top-2 of group)
  const teamRows=[], thirds=[], clinched=[], eliminated=[];
  GROUPS.forEach(g=>{
    g.teams.forEach((t,i)=> teamRows.push({...t, group:g.letter, rank:i+1}));
    if(g.teams[2]) thirds.push({...g.teams[2], group:g.letter});
    g.teams.forEach(t=>{
      const maxPts = t.Pts + 3*(3 - t.P);
      const others = g.teams.filter(o=>o.team!==t.team);
      const canMatchOrBeat = others.filter(o=> (o.Pts + 3*(3-o.P)) >= t.Pts).length;
      const certainlyAbove = others.filter(o=> o.Pts > maxPts).length;
      if(t.P>0 && canMatchOrBeat<=1) clinched.push({...t, group:g.letter});
      else if(certainlyAbove>=2) eliminated.push({...t, group:g.letter});
    });
  });
  thirds.sort((a,b)=> b.Pts-a.Pts || (b.GF-b.GA)-(a.GF-a.GA) || b.GF-a.GF || a.team.localeCompare(b.team));

  // --- Tier 2: per-match detail from ESPN summaries (cached, shared with scorers/players) ---
  const cards={}, shots={};
  let pens=0, openPlay=0, ownGoals=0, subs=0;
  const bands=[0,0,0,0,0,0];   // goal minute: 1-15, 16-30, 31-45, 46-60, 61-75, 76-90+
  await Promise.all(finished.map(async m=>{
    const sum = await espnSummary(m.id); if(!sum) return;
    (sum.keyEvents||[]).forEach(e=>{
      const t = ((e.type||{}).text||"").toLowerCase();
      // ESPN labels: "Goal", "Goal - Header/Volley", "Own Goal", "Penalty - Scored".
      // A penalty does NOT contain "goal", so also match a scored penalty.
      const isGoal = /goal/.test(t) || (/penalt/.test(t) && /scored/.test(t));
      if(isGoal){
        if(t.includes("own")) ownGoals++; else if(t.includes("pen")) pens++; else openPlay++;
        const mn = parseInt(((e.clock||{}).displayValue||""), 10);
        if(!isNaN(mn)) bands[Math.max(0, Math.min(5, Math.floor((mn-1)/15)))]++;
      } else if(t.includes("subst")) subs++;
    });
    ((sum.boxscore||{}).teams||[]).forEach(tm=>{
      const name=(tm.team||{}).displayName; if(!name) return;
      const st={}; (tm.statistics||[]).forEach(s=> st[s.name]=espnNum(s.displayValue));
      const o=(shots[name]=shots[name]||{g:0,total:0,on:0});
      o.g++; o.total+=st.totalShots||0; o.on+=st.shotsOnTarget||0;
      const c=(cards[name]=cards[name]||{Y:0,R:0});
      c.Y+=st.yellowCards||0; c.R+=st.redCards||0;
    });
  }));

  // venues + hosts (from all loaded fixtures)
  const venues={}, hosts={};
  FIXTURES.forEach(m=>{ if(m.venue) venues[m.venue]=(venues[m.venue]||0)+1; if(m.country) hosts[m.country]=(hosts[m.country]||0)+1; });

  STATS = { played:finished.length, goals, cleanSheets, draws, decisive, biggest, highest,
    teamRows, thirds, clinched, eliminated, cards, shots, pens, openPlay, ownGoals, subs, bands, venues, hosts, form };
}

function tile(v,k,x){ return `<div class="tile"><div class="v">${v}</div><div class="k">${k}</div>${x?`<div class="x">${x}</div>`:""}</div>`; }

function barlist(items, max){
  if(!items.length) return emptyNote("No data yet");
  max = max || Math.max(1, ...items.map(i=>i.val));
  return `<div class="barlist">${items.map(i=>`<div class="barrow">
    <span class="lab">${i.label}</span>
    <span class="track"><span class="fill" style="width:${Math.round(i.val/max*100)}%"></span></span>
    <span class="val">${i.val}</span></div>`).join("")}</div>`;
}

function formChips(arr){
  const c=(arr||[]).slice(-5);
  return c.length ? `<span class="form-chips">${c.map(r=>`<span class="fc ${r}">${r}</span>`).join("")}</span>` : `<span style="color:var(--muted)">—</span>`;
}

function section(title, sub, body){ return `<div class="stats-section"><h3>${title}</h3>${sub?`<p class="sub">${sub}</p>`:""}${body}</div>`; }

function emptyNote(t){ return `<div class="empty" style="padding:22px">${t}</div>`; }

function ageFrom(d){
  if(!d) return null;
  const b = new Date(d); if(isNaN(b)) return null;
  const t = new Date(); let a = t.getFullYear() - b.getFullYear();
  const md = t.getMonth() - b.getMonth();
  if(md < 0 || (md === 0 && t.getDate() < b.getDate())) a--;
  return (a >= 0 && a < 120) ? a : null;
}

async function fetchBio(id){
  if(id in BIO_CACHE) return BIO_CACHE[id];
  try{ BIO_CACHE[id] = await getJSON(`https://sports.core.api.espn.com/v2/sports/soccer/athletes/${id}`); }
  catch(_){ BIO_CACHE[id] = null; }
  return BIO_CACHE[id];
}

async function mapLimit(items, limit, fn){
  let i = 0;
  const workers = Array.from({length: Math.min(limit, items.length)}, async ()=>{
    while(i < items.length){ const idx = i++; await fn(items[idx]); }
  });
  await Promise.all(workers);
}

async function loadPlayers(){
  const finished = FIXTURES.filter(m=>m.status === "ft").slice(0, 120);
  const reg = {};
  await Promise.all(finished.map(async m=>{
    const sum = await espnSummary(m.id); if(!sum) return;
    espnRosterPlayers(sum).forEach(p=>{
      if(!p.id) return;
      const e = reg[p.id] = reg[p.id] || { id:p.id, name:p.name, nat:p.team, goals:0, yc:0, rc:0, assists:0, inXI:false, pos:p.pos, num:p.num };
      e.goals += p.goals; e.yc += p.yc; e.rc += p.rc; e.assists += p.assists;
      if(p.starter) e.inXI = true;
      if(p.name) e.name = p.name;
      if(p.pos && !e.pos) e.pos = p.pos;
      if(p.num && !e.num) e.num = p.num;
    });
  }));
  PLAYERS = Object.values(reg);
}

async function enrichBios(onProgress){
  const ids = PLAYERS.map(p=>p.id).filter(id => id && !(id in BIO_CACHE));
  if(!ids.length){ if(onProgress) onProgress(); return; }
  let done = 0;
  await mapLimit(ids, 5, async id=>{ await fetchBio(id); if(++done % 4 === 0 && onProgress) onProgress(); });
  if(onProgress) onProgress();
}

function playerView(p){
  const bio = BIO_CACHE[p.id] || {};
  const age = (typeof bio.age === "number") ? bio.age : ageFrom(bio.dateOfBirth);
  return { p, bio, age, club: "", pos: p.pos || "", photo: "" };
}

function playerProfileHTML(bio, reg){
  bio = bio || {};
  const age = (typeof bio.age === "number") ? bio.age : ageFrom(bio.dateOfBirth);
  const nat = (reg && reg.nat) || esc(bio.citizenship) || "";
  const fact = (k,v) => v ? `<div class="f"><div class="k">${k}</div><div class="v">${v}</div></div>` : "";
  const bp = bio.birthPlace ? [esc(bio.birthPlace.city), esc(bio.birthPlace.country)].filter(Boolean).join(", ") : "";
  const wiki = (bio.links||[]).find(l => /wikipedia/i.test((l.rel||[]).join(" ") + " " + (l.href||"")));
  const tally = reg ? [
    reg.goals ? `${reg.goals} goal${reg.goals===1?"":"s"}` : "",
    reg.assists ? `${reg.assists} assist${reg.assists===1?"":"s"}` : "",
    reg.yc ? `${reg.yc} 🟨` : "", reg.rc ? `${reg.rc} 🟥` : ""
  ].filter(Boolean).join(" · ") : "";
  return `
    <div class="pm-hero">
      <span class="ph" style="display:flex;align-items:center;justify-content:center">${crest(nat)}</span>
      <div>
        <div class="pn">${esc(bio.displayName) || (reg && reg.name) || "Player"}</div>
        <div class="ps">${crest(nat)}<span>${nat}</span>${reg && reg.goals ? ` · <span style="color:var(--accent)">${reg.goals} goal${reg.goals>1?"s":""} this tournament</span>` : ""}</div>
      </div>
    </div>
    <div class="facts">
      ${fact("Age", age!=null ? `${age} years` : "")}
      ${fact("Born", bio.dateOfBirth ? new Date(bio.dateOfBirth).toLocaleDateString([], {year:"numeric", month:"short", day:"numeric"}) : "")}
      ${fact("Birthplace", bp)}
      ${fact("Nationality", esc(bio.citizenship))}
      ${fact("Position", reg && reg.pos)}
      ${fact("Shirt no.", reg && reg.num)}
      ${fact("Height", esc(bio.displayHeight))}
      ${fact("Weight", esc(bio.displayWeight))}
    </div>
    ${tally ? `<div class="pm-bio">This tournament: ${tally}.</div>` : ""}
    ${wiki ? `<div class="pm-links"><a href="${esc(wiki.href)}" target="_blank" rel="noopener">Wikipedia ↗</a></div>` : ""}`;
}

function runInvariants(){
  const out = [];
  const sizeOf = g => Array.isArray(g.teams) ? g.teams.length : -1;   // tolerate malformed groups
  const groupsOK = GROUPS.length===12 && GROUPS.every(g=>sizeOf(g)===4);
  out.push({ pass:groupsOK, name:"Group structure", detail:`${GROUPS.length} groups, sizes ${[...new Set(GROUPS.map(sizeOf))].join("/")||"-"} (expected 12 × 4)` });

  const rows = GROUPS.flatMap(g=>Array.isArray(g.teams)?g.teams:[]);
  const bad = rows.filter(t=> t.Pts !== 3*t.W + t.D || t.P !== t.W + t.D + t.L);
  out.push({ pass:bad.length===0, name:"Standings math: Pts = 3·W + D, P = W+D+L", detail: bad.length ? `${bad.length} violation(s): ${bad.slice(0,3).map(t=>t.team).join(", ")}` : `all ${rows.length} team rows internally consistent` });

  const gf = rows.reduce((s,t)=>s+t.GF,0), ga = rows.reduce((s,t)=>s+t.GA,0);
  out.push({ pass:gf===ga, name:"Goals scored = goals conceded (global)", detail:`GF ${gf} vs GA ${ga}` });

  const teams = new Set(rows.map(t=>t.team));
  out.push({ pass:teams.size===rows.length && teams.size===48, name:"Every team in exactly one group", detail:`${teams.size} unique teams across ${rows.length} slots (expected 48)` });

  const finishedGoals = FIXTURES.filter(m=>m.status==="ft"&&m.hs!=null).reduce((s,m)=>s+m.hs+m.as,0);
  const scorerGoals = SCORERS.reduce((s,x)=>s+x.goals,0);
  out.push({ pass:scorerGoals<=finishedGoals, warn:scorerGoals<finishedGoals, name:"Scorer tally ≤ goals in finished matches", detail:`${scorerGoals} attributed vs ${finishedGoals} scored${scorerGoals<finishedGoals?" — feed lists fewer (expected); never more":""}` });

  out.push({ pass:FIXTURES.length>0, name:"Fixtures loaded from live feed", detail:`${FIXTURES.length} fixtures · ${FIXTURES.filter(m=>m.status==="ft").length} finished · ${FIXTURES.filter(m=>m.status==="up").length} upcoming` });
  return out;
}

// Independent second source (TheSportsDB) used to cross-check ESPN scorelines.
// Fetched once on demand; tolerates the shared key being rate-limited.
let TSDB_PAST = null;
async function espnScoreFor(m){
  if(!TSDB_PAST){
    TSDB_PAST = getJSON(`${API}/eventspastleague.php?id=${LEAGUE}`)
      .then(j => j.events || [])
      .catch(()=>{ TSDB_PAST = null; return null; });   // reset so a later click can retry
  }
  const evs = await TSDB_PAST;
  if(!evs) return null;
  const num = v => (v === "" || v == null) ? null : +v;
  for(const e of evs){
    if(teamsMatch(e.strHomeTeam, m.home) && teamsMatch(e.strAwayTeam, m.away))
      return { hs: num(e.intHomeScore), as: num(e.intAwayScore) };
    if(teamsMatch(e.strHomeTeam, m.away) && teamsMatch(e.strAwayTeam, m.home))
      return { hs: num(e.intAwayScore), as: num(e.intHomeScore) };   // orient to our home/away
  }
  return null;
}

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world";

const ESPN_SUM_CACHE = {};     // event id -> summary (promise, deduped)

const ESPN_ALIAS = {
  usa:"unitedstates", unitedstates:"usa", southkorea:"korearepublic", korearepublic:"southkorea",
  czechrepublic:"czechia", czechia:"czechrepublic", ivorycoast:"cotedivoire", cotedivoire:"ivorycoast",
  capeverde:"caboverde", caboverde:"capeverde", turkey:"turkiye", turkiye:"turkey", drcongo:"congodr", congodr:"drcongo"
};

const espnNorm = s => String(s==null?"":s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]/g,"");

function teamsMatch(a,b){
  const na=espnNorm(a), nb=espnNorm(b);
  if(!na||!nb) return false;
  if(na===nb) return true;
  if(ESPN_ALIAS[na]===nb || ESPN_ALIAS[nb]===na) return true;
  if(na.length>4 && nb.length>4 && (na.includes(nb)||nb.includes(na))) return true;
  return false;
}

const ymd = d => "" + d.getUTCFullYear() + String(d.getUTCMonth()+1).padStart(2,"0") + String(d.getUTCDate()).padStart(2,"0");

// Cache the in-flight promise so the 3 enrichers (scorers/players/stats) that all
// need a match's summary trigger exactly one network request per match.
async function espnSummary(id){
  if(!ESPN_SUM_CACHE[id]) ESPN_SUM_CACHE[id] = getJSON(`${ESPN}/summary?event=${id}`).catch(()=> null);
  return ESPN_SUM_CACHE[id];
}

function tierOf(abbr){
  const a = String(abbr==null?"":abbr).toUpperCase();
  if(a==="G"||a==="GK") return 0;
  if(/(^F|CF|ST|^S|LW|RW|^W|FW)/.test(a)) return 5;
  if(a.includes("AM")) return 4;
  if(a.includes("DM")) return 2;
  if(/(^M|CM|LM|RM|MF)/.test(a) || a.endsWith("M")) return 3;
  if(/[DB]/.test(a)) return 1;
  return 3;
}

const lrKey = abbr => { const a=(abbr||"").toUpperCase(); return /L/.test(a) ? -1 : /R/.test(a) ? 1 : 0; };

function pitchPlayers(roster, isHome){
  const starters = (roster||[]).filter(p=>p.starter);
  const byTier = {};
  starters.forEach(p=>{ const t=tierOf((p.position||{}).abbreviation); (byTier[t]=byTier[t]||[]).push(p); });
  const tiers = Object.keys(byTier).map(Number).sort((a,b)=>a-b);
  const R = tiers.length;
  const out = [];
  tiers.forEach((t,i)=>{
    const row = byTier[t].slice().sort((a,b)=> lrKey((a.position||{}).abbreviation) - lrKey((b.position||{}).abbreviation));
    const k = row.length;
    const spread = R>1 ? (i/(R-1))*34 : 17;
    row.forEach((p,j)=>{
      let left = (j+1)/(k+1)*100;
      const top = isHome ? 92 - spread : 8 + spread;
      if(!isHome) left = 100 - left;       // mirror away team
      out.push({ p, left, top, isHome });
    });
  });
  return out;
}

function pchip(x){
  const name = esc(((x.p.athlete||{}).displayName||"").split(" ").slice(-1)[0]);
  return `<div class="pchip ${x.isHome?'h':'a'}" style="left:${x.left}%;top:${x.top}%"><span class="num">${esc(x.p.jersey)}</span><span class="nm">${name}</span></div>`;
}

function espnPitchHTML(sum){
  const ros = sum.rosters || [];
  const homeR = ros.find(r=>r.homeAway==="home") || ros[0];
  const awayR = ros.find(r=>r.homeAway==="away") || ros[1];
  if(!homeR || !awayR || !(homeR.roster||[]).some(p=>p.starter)) return "";
  const chips = pitchPlayers(awayR.roster,false).map(pchip).join("") + pitchPlayers(homeR.roster,true).map(pchip).join("");
  return `<div class="pitch">
    <div class="pitch-label top">${esc((awayR.team||{}).displayName)} · ${esc(awayR.formation)}</div>
    <div class="pitch-label bot">${esc((homeR.team||{}).displayName)} · ${esc(homeR.formation)}</div>
    ${chips}</div>`;
}

function espnSubsHTML(sum){
  const ros = sum.rosters || []; if(ros.length<2) return "";
  const col = r => {
    const subs = (r.roster||[]).filter(p=>!p.starter);
    const rows = subs.map(p=>`<div class="subrow"><span class="n">${esc(p.jersey)}</span><span>${esc((p.athlete||{}).displayName)}${p.subbedIn?' <span style="color:var(--accent)">▲</span>':''}</span></div>`).join("");
    return `<div class="subs"><h6>${esc((r.team||{}).displayName)} — bench</h6>${rows||'<div class="subrow" style="color:var(--muted)">—</div>'}</div>`;
  };
  return `<div class="lineup-cols">${col(ros[0])}${col(ros[1])}</div>`;
}

const espnNum = d => { if(d==null) return 0; const n=parseFloat(String(d).replace(/[^0-9.\-]/g,"")); return isNaN(n)?0:n; };

function espnStatsHTML(sum){
  const teams = ((sum.boxscore||{}).teams)||[]; if(teams.length<2) return "";
  const toMap = t => { const o={}; (t.statistics||[]).forEach(s=> o[s.name]={d:s.displayValue, n:espnNum(s.displayValue)}); return o; };
  const H=toMap(teams[0]), A=toMap(teams[1]);
  const order=[["possessionPct","Possession",true],["totalShots","Shots"],["shotsOnTarget","Shots on target"],
    ["wonCorners","Corners"],["foulsCommitted","Fouls"],["offsides","Offsides"],["totalPasses","Passes"],
    ["saves","Saves"],["effectiveTackles","Tackles"],["yellowCards","Yellow cards"],["redCards","Red cards"]];
  const rows = order.filter(([k])=>H[k]||A[k]).map(([k,label,pct])=>{
    const h=H[k]||{d:"0",n:0}, a=A[k]||{d:"0",n:0};
    const tot=h.n+a.n||1, hp=Math.round(h.n/tot*100), ap=100-hp;
    const fmt=v=>{ v=esc(v); return pct ? (String(v).includes("%")?v:v+"%") : v; };
    return `<div class="sblock"><div class="slabel">${label}</div>
      <div class="sbar"><span class="hv">${fmt(h.d)}</span>
        <span class="track"><span class="th" style="width:${hp}%"></span><span class="ta" style="width:${ap}%"></span></span>
        <span class="av">${fmt(a.d)}</span></div></div>`;
  }).join("");
  if(!rows) return "";
  const hN=esc((teams[0].team||{}).displayName)||"Home", aN=esc((teams[1].team||{}).displayName)||"Away";
  return `<div class="stat-legend"><span><i style="background:#0bb88f"></i>${hN}</span><span>${aN}<i style="background:#3a6df0"></i></span></div>${rows}`;
}

function espnGoalsHTML(sum){
  const scorers = espnRosterPlayers(sum).filter(p=>p.goals>0).sort((a,b)=> b.goals-a.goals);
  if(!scorers.length) return "";
  return `<h5>⚽ Goalscorers</h5>` + scorers.map(p=>
    `<div class="detail-row"><span>${p.team}</span><span>${p.name}${p.goals>1?` ×${p.goals}`:""}</span></div>`).join("");
}

function espnSectionHTML(sum){
  const goals = espnGoalsHTML(sum);
  const pitch = espnPitchHTML(sum);
  const subs = pitch ? espnSubsHTML(sum) : "";
  const stats = espnStatsHTML(sum);
  const gi = sum.gameInfo || {};
  const att = gi.attendance ? Number(gi.attendance).toLocaleString() : "";
  const ref = ((gi.officials||[]).find(o=>(((o.position||{}).displayName)||"").toLowerCase().includes("referee"))||(gi.officials||[])[0]||{}).displayName || "";
  let extra = "";
  if(att) extra += `<div class="detail-row"><span>Attendance</span><span>${att}</span></div>`;
  if(ref) extra += `<div class="detail-row"><span>Referee</span><span>${esc(ref)}</span></div>`;
  let html = "";
  if(goals) html += goals;
  if(pitch) html += `<h5>👥 Lineups</h5>${pitch}${subs}`;
  if(stats) html += `<h5>📊 Match stats</h5>${stats}`;
  if(extra) html += `<div style="margin-top:10px">${extra}</div>`;
  if(!html) return "";
  return `<div class="espn-sec">${html}<p class="espn-credit">Goals, lineups, stats &amp; attendance via ESPN</p></div>`;
}

const espnUnavail = msg => `<p class="espn-credit">${msg || "Lineups & detailed stats aren't available for this match yet."}</p>`;

// Match ids are ESPN ids, so the summary is a direct lookup (no name/date re-matching).
async function loadEspnInto(m){
  const box = $("#espnBox"); if(!box) return;
  box.innerHTML = `<div class="espn-load">Loading lineups &amp; match stats…</div>`;
  try{
    const sum = await espnSummary(m.id);
    if(!sum){ box.innerHTML = espnUnavail(); return; }
    const html = espnSectionHTML(sum);
    box.innerHTML = html || espnUnavail(m.status==="up" ? "Lineups are usually announced ~1 hour before kickoff." : "Detailed data isn't available for this match.");
  }catch(_){ box.innerHTML = espnUnavail(); }
}
