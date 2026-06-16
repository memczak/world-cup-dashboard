/* ============================================================
   World Cup 2026 — live dashboard
   Data: TheSportsDB free API (CORS-enabled, no key required).
   Everything is DERIVED from real fixtures:
     • Group stage = eventsround rounds 1-3 (all 72 group matches)
     • Group membership derived from the fixture graph
     • Standings computed live from real results
     • Team list + crests come from the real teams in the data
   ============================================================ */
/* ---------------- State ---------------- */
let matchFilter = "all";
let cdTimer = null;
let pFilter = { q:"", sort:"name", team:"" };

/* TheSportsDB timestamps are UTC; a bare string would be read as LOCAL.
   Force UTC so countdowns and kickoff times are correct. */
/* ---------------- Normalize + classify ---------------- */
/* ---------------- Load ---------------- */
// ESPN event -> our match shape. ESPN is the reliable, keyless primary source.
// official groups + live standings, straight from ESPN (no derivation, no rate limit)
/* Derive group membership from the fixture graph, label by first kickoff. */
/* Compute standings table for a group from finished matches. */
/* ---------------- Top scorers (from real match timelines) ----------------
   TheSportsDB exposes goals per match via lookuptimeline (real player + minute).
   We aggregate only actual goals; own goals never credit a scorer.            */
// Per-match enrichment is being rebuilt on ESPN. Disabled to avoid keying
// TheSportsDB by ESPN ids (which could surface another event's data).
/* ---------------- Statistics (all from real data) ---------------- */
/* ---- small render helpers ---- */
function renderStats(){
  const el=$("#stats");
  if(!STATS){ el.innerHTML = emptyNote("Crunching match data…"); return; }
  const S=STATS, out=[];

  // Tournament pulse
  if(S.played){
    const tot=Object.values(S.cards).reduce((o,c)=>({Y:o.Y+c.Y, R:o.R+c.R}), {Y:0,R:0});
    let tiles = [
      tile(S.played, "Matches played"),
      tile(S.goals, "Goals scored", `${(S.goals/S.played).toFixed(2)} per match`),
      tile(S.cleanSheets, "Clean sheets"),
      tile(`${S.decisive} / ${S.draws}`, "Decisive / Draws"),
      tile(`${tot.Y} / ${tot.R}`, "Yellow / Red cards"),
      tile(S.pens, "Penalties scored")
    ].join("");
    if(S.biggest) tiles += tile(`${S.biggest.m.hs}–${S.biggest.m.as}`, "Biggest win", `${S.biggest.m.home} v ${S.biggest.m.away}`);
    if(S.highest) tiles += tile(`${S.highest.tot} goals`, "Highest-scoring", `${S.highest.m.home} ${S.highest.m.hs}–${S.highest.m.as} ${S.highest.m.away}`);
    out.push(section("Tournament pulse", "Live from completed matches", `<div class="tiles">${tiles}</div>`));
  } else {
    out.push(section("Tournament pulse", "", emptyNote("No matches completed yet — this fills in as games are played.")));
  }

  // Goals by minute & type
  if(S.openPlay+S.pens+S.ownGoals>0){
    const labs=["1-15","16-30","31-45","46-60","61-75","76-90+"], max=Math.max(1,...S.bands);
    const bars=`<div class="minute-bars">${S.bands.map((n,i)=>`<div class="mb"><span class="num">${n}</span><div class="bar" style="height:${Math.round(n/max*100)}%"></div><span class="lab">${labs[i]}</span></div>`).join("")}</div>`;
    const types=barlist([{label:"Open play",val:S.openPlay},{label:"Penalty",val:S.pens},{label:"Own goal",val:S.ownGoals}]);
    out.push(section("Goals by minute & type", "From real match timelines (reflects what the feed has logged so far)",
      `<div class="stat-cols"><div class="card">${bars}</div><div class="card">${types}</div></div>`));
  }

  // Attack & defense
  if(S.played){
    const played=S.teamRows.filter(t=>t.P>0);
    const atk=[...played].sort((a,b)=>b.GF-a.GF).slice(0,8).map(t=>({label:teamLabel(t.team), val:t.GF}));
    const def=[...played].sort((a,b)=>a.GA-b.GA).slice(0,8).map(t=>({label:teamLabel(t.team), val:t.GA}));
    out.push(section("Attack & defense", "Goals scored / conceded (teams that have played)",
      `<div class="stat-cols"><div class="card"><p class="sub">Most goals scored</p>${barlist(atk)}</div>
       <div class="card"><p class="sub">Fewest conceded</p>${barlist(def)}</div></div>`));
  }

  // Shooting
  const shotTeams=Object.entries(S.shots).filter(([,v])=>v.total>0);
  if(shotTeams.length){
    const rows=shotTeams.sort((a,b)=>b[1].total-a[1].total).slice(0,12).map(([team,v])=>
      `<tr><td class="l">${teamLabel(team)}</td><td>${v.g}</td><td>${v.total}</td><td>${v.on}</td><td>${v.total?Math.round(v.on/v.total*100):0}%</td></tr>`).join("");
    out.push(section("Shooting", "Aggregated from match stats — shot data only (possession/corners aren't in this feed)",
      `<div class="card"><table class="mini-table"><thead><tr><th class="l">Team</th><th>GP</th><th>Shots</th><th>On tgt</th><th>Acc</th></tr></thead><tbody>${rows}</tbody></table></div>`));
  }

  // Discipline
  const cardTeams=Object.entries(S.cards).filter(([,c])=>c.Y+c.R>0);
  if(cardTeams.length){
    const rows=cardTeams.sort((a,b)=>(b[1].Y+b[1].R*2)-(a[1].Y+a[1].R*2)).map(([team,c])=>
      `<tr><td class="l">${teamLabel(team)}</td><td>${c.Y}</td><td>${c.R}</td></tr>`).join("");
    out.push(section("Discipline", "Cards from match timelines",
      `<div class="card"><table class="mini-table"><thead><tr><th class="l">Team</th><th>🟨</th><th>🟥</th></tr></thead><tbody>${rows}</tbody></table></div>`));
  }

  // Best third-placed race
  if(S.thirds.length){
    const rows=S.thirds.map((t,i)=>`<tr class="${isFav(t.team)?'fav-row':''}">
      <td class="pos">${i+1}</td><td class="l">${teamLabel(t.team)} <span style="color:var(--muted)">(${t.group})</span></td>
      <td>${t.P}</td><td>${t.GF-t.GA>0?'+':''}${t.GF-t.GA}</td><td class="pts">${t.Pts}</td>
      <td>${i<8?'<span class="pill q">Q</span>':'<span class="pill out">—</span>'}</td></tr>`).join("");
    out.push(section("Best third-placed race", "The 8 best of the 12 third-placed teams reach the Round of 32",
      `<div class="card"><table class="mini-table"><thead><tr><th>#</th><th class="l">Team</th><th>P</th><th>GD</th><th>Pts</th><th>R32</th></tr></thead><tbody>${rows}</tbody></table></div>`));
  }

  // Qualification tracker
  const qBody = (S.clinched.length||S.eliminated.length)
    ? `<div class="stat-cols">
        <div class="card"><p class="sub">✅ Clinched top-2 of group</p>${S.clinched.length?`<div class="barlist">${S.clinched.map(t=>`<div class="barrow"><span class="lab">${teamLabel(t.team)}</span><span class="pill q">Group ${t.group}</span></div>`).join("")}</div>`:emptyNote("None yet")}</div>
        <div class="card"><p class="sub">❌ Eliminated from top-2</p>${S.eliminated.length?`<div class="barlist">${S.eliminated.map(t=>`<div class="barrow"><span class="lab">${teamLabel(t.team)}</span><span class="pill out">Group ${t.group}</span></div>`).join("")}</div>`:emptyNote("None yet")}</div>
      </div>`
    : emptyNote("Nothing decided yet — a team appears here only once it's mathematically certain to advance or be out of the top 2.");
  out.push(section("Qualification tracker", "Conservative: shows only mathematically certain outcomes for the top 2 group places", qBody));

  // Form guide
  const formTeams=Object.entries(S.form);
  if(formTeams.length){
    const pts={}; S.teamRows.forEach(t=>pts[t.team]=t.Pts);
    const rows=formTeams.sort((a,b)=>(pts[b[0]]||0)-(pts[a[0]]||0)).map(([team,f])=>
      `<div class="barrow"><span class="lab">${teamLabel(team)}</span>${formChips(f)}</div>`).join("");
    out.push(section("Form guide", "Most recent results (newest on the right)", `<div class="card"><div class="barlist">${rows}</div></div>`));
  }

  // Venues & hosts
  const hostRows=Object.entries(S.hosts).sort((a,b)=>b[1]-a[1]).map(([c,n])=>({label:c, val:n}));
  const venueRows=Object.entries(S.venues).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([v,n])=>({label:v, val:n}));
  out.push(section("Venues & hosts", `Across ${FIXTURES.length} loaded fixtures`,
    `<div class="stat-cols"><div class="card"><p class="sub">Matches per host nation</p>${barlist(hostRows)}</div>
     <div class="card"><p class="sub">Busiest stadiums</p>${barlist(venueRows)}</div></div>`));

  el.innerHTML = out.join("");
}

/* ---------------- Players (real bios, lazy-loaded) ---------------- */
// run async fn over items with a concurrency cap (rate-limit friendly)
// build the registry of players who appeared (goals/cards/subs/lineups) — no bio calls
// fetch bios in the background, re-rendering as they arrive
function renderPlayers(){
  const el = $("#players"); if(!el) return;
  // populate team filter once
  const sel = $("#pTeam");
  if(sel && sel.options.length <= 1){
    const teams = [...new Set(PLAYERS.map(p=>p.nat).filter(Boolean))].sort();
    sel.innerHTML = `<option value="">All teams</option>` + teams.map(t=>`<option>${t}</option>`).join("");
  }
  let list = PLAYERS.map(playerView);
  if(pFilter.team) list = list.filter(v => v.p.nat === pFilter.team);
  if(pFilter.q){ const q = pFilter.q.toLowerCase(); list = list.filter(v => (v.p.name||"").toLowerCase().includes(q) || (v.club||"").toLowerCase().includes(q)); }
  const s = pFilter.sort;
  list.sort((a,b)=>{
    if(s === "goals") return b.p.goals - a.p.goals || (a.p.name||"").localeCompare(b.p.name||"");
    if(s === "age")   return (b.age ?? -1) - (a.age ?? -1) || (a.p.name||"").localeCompare(b.p.name||"");
    if(s === "ageA")  return (a.age ?? 999) - (b.age ?? 999) || (a.p.name||"").localeCompare(b.p.name||"");
    return (a.p.name||"").localeCompare(b.p.name||"");
  });
  if(!list.length){ el.innerHTML = emptyNote("No players yet — profiles appear as matches are played."); renderPlayerInsights([]); return; }
  el.innerHTML = list.map(v=>{
    const { p, age, club, pos, photo } = v;
    const tags = [];
    if(p.goals) tags.push(`<span class="ptag g">${p.goals}⚽</span>`);
    if(p.yc) tags.push(`<span class="ptag y">${p.yc}🟨</span>`);
    if(p.rc) tags.push(`<span class="ptag r">${p.rc}🟥</span>`);
    if(p.inXI && !p.goals && !p.yc && !p.rc) tags.push(`<span class="ptag xi">Lineup</span>`);
    const pic = photo
      ? `<img class="photo" src="${photo}" loading="lazy" alt="">`
      : `<span class="photo" style="display:flex;align-items:center;justify-content:center">${crest(p.nat)}</span>`;
    return `<div class="pcard ${isFav(p.nat)?'fav':''}" data-pid="${p.id}">
      ${pic}
      <div class="pinfo">
        <div class="pname">${p.name || "Unknown"}</div>
        <div class="pmeta">${crest(p.nat)}<span>${p.nat || ""}</span>${age!=null?` · <span class="age">${age}</span>`:""}${pos?` · ${pos}`:""}</div>
        ${club?`<div class="pmeta">${club}</div>`:""}
        <div class="ptags">${tags.join("")}</div>
      </div></div>`;
  }).join("");
  renderPlayerInsights(list);
}
function renderPlayerInsights(list){
  const el = $("#playerInsights"); if(!el) return;
  const withAge = list.filter(v => v.age != null);
  if(!withAge.length){ el.innerHTML = ""; return; }
  const youngest = [...withAge].sort((a,b)=>a.age-b.age)[0];
  const oldest   = [...withAge].sort((a,b)=>b.age-a.age)[0];
  const avg = (withAge.reduce((s,v)=>s+v.age,0) / withAge.length).toFixed(1);
  const clubCount = {}; list.forEach(v=>{ if(v.club) clubCount[v.club] = (clubCount[v.club]||0)+1; });
  const topClub = Object.entries(clubCount).sort((a,b)=>b[1]-a[1])[0];
  const tiles = [
    tile(youngest.age, "Youngest", youngest.p.name),
    tile(oldest.age, "Oldest", oldest.p.name),
    tile(avg, "Average age", `${withAge.length} players profiled`)
  ];
  if(topClub) tiles.push(tile(topClub[1], "Most-represented club", topClub[0]));
  const scorers = withAge.filter(v=>v.p.goals>0).sort((a,b)=>a.age-b.age);
  if(scorers.length) tiles.push(tile(scorers[0].age, "Youngest scorer", scorers[0].p.name));
  el.innerHTML = section("Player insights", "From players who've appeared so far — bios load progressively, never invented",
    `<div class="tiles">${tiles.join("")}</div>`);
}
async function openPlayer(id){
  if(!id) return;
  const md = document.querySelector(".modal"); if(md) md.classList.add("wide");
  $("#modalTitle").textContent = "Player profile";
  $("#modalBody").innerHTML = emptyNote("Loading profile…");
  $("#modalBg").classList.add("show");
  const reg = PLAYERS.find(p=>String(p.id)===String(id));
  const bio = await fetchBio(id);
  if(!bio){ $("#modalBody").innerHTML = emptyNote("No profile data available for this player yet."); return; }
  $("#modalBody").innerHTML = playerProfileHTML(bio, reg);
}
/* ---------------- Init ---------------- */
// ---- Lazy enrichment ---------------------------------------------------------
// Heavy per-match data (scorers/stats/players) is fetched only when its tab is
// first opened, and finished matches are served from localStorage thereafter.
const SKEL = n => '<div class="skeleton"></div>'.repeat(n||3);
const loaded = {};                       // which heavy tabs have loaded this session
const currentTab = () => { const a = document.querySelector(".tab.active"); return a ? a.dataset.tab : "matches"; };
async function ensure(tab){
  if(tab==="scorers" && !loaded.scorers){
    loaded.scorers = true; $("#scorers").innerHTML = SKEL(3);
    await loadScorers(); renderScorers();
  } else if(tab==="stats" && !loaded.stats){
    loaded.stats = true; $("#stats").innerHTML = SKEL(3);
    await loadStats(); renderStats();
  } else if(tab==="players" && !loaded.players){
    loaded.players = true; $("#players").innerHTML = SKEL(6);
    await loadPlayers(); renderPlayers();
    await enrichBios(renderPlayers); renderPlayers();
    if(loaded.scorers) renderScorers();
  }
}
function refreshLoaded(){                 // re-pull only the heavy tabs already opened (cheap: finished matches come from cache)
  if(loaded.scorers) loadScorers().then(renderScorers);
  if(loaded.stats)   loadStats().then(renderStats);
  if(loaded.players) loadPlayers().then(()=>{ renderPlayers(); if(loaded.scorers) renderScorers(); });
}

async function init(){
  if(fav) $("#fav").value = fav;
  if(!FIXTURES.length && loadSnapshot()){   // instant paint from last good data while we reconnect
    buildTeamList(); renderAll(); setSource("cache");
  } else {
    setSource("loading");
  }
  try{
    await loadData();
    setSource("ok");
    buildTeamList();
    renderAll();
    refreshLoaded();        // refresh any heavy tab already open (no-op on first load)
    ensure(currentTab());   // lazily load the tab actually being viewed
    maybeNotify();          // fire kick-off / goal / full-time alerts for the fav team (if enabled)
  }catch(err){
    if(FIXTURES.length){    // we have data (live or cached) — keep showing it, just flag staleness
      setSource(FROM_CACHE ? "cache" : "stale");
    } else {
      setSource("err", err.message);
      const msg = /429|rate/i.test(err.message)
        ? "The data provider is rate-limiting right now — the app will keep retrying automatically."
        : `Couldn't reach the live data feed (${err.message}).`;
      $("#matches").innerHTML = `<div class="empty">${msg}<br>You can also hit ↻ Refresh.</div>`;
    }
  }
}
function setSource(state, msg){
  const el = $("#source");
  const stamp = LAST_UPDATED ? new Date(LAST_UPDATED).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"}) : "—";
  if(state === "loading")    el.innerHTML = `<span class="dot warn"></span> Loading live data…`;
  else if(state === "ok")    el.innerHTML = `<span class="dot ok"></span> Live from ESPN · ${FIXTURES.length} fixtures · official groups &amp; standings · updated ${stamp}`;
  else if(state === "cache") el.innerHTML = `<span class="dot warn"></span> Offline — showing saved data from ${stamp} · reconnecting…`;
  else if(state === "stale") el.innerHTML = `<span class="dot warn"></span> Showing data from ${stamp} · couldn't refresh, retrying…`;
  else el.innerHTML = `<span class="dot err"></span> Live feed unavailable: ${msg}. Hit ↻ Refresh to retry.`;
}

/* ---------------- Rendering ---------------- */
function renderAll(){ renderHero(); renderMatches(); renderSchedule(); renderGroups(); renderBracket(); renderDiagnostics(); }

function teamRow(name, score, opp, status){
  const cls = ["team"];
  if(isFav(name)) cls.push("fav");
  if((status==="ft"||status==="live") && score!=null && opp!=null && score>opp) cls.push("winner");
  const sc = score==null ? "" : `<span class="score">${score}</span>`;
  return `<div class="${cls.join(' ')}">${crest(name)}<span class="name">${name}</span>${sc}</div>`;
}
function matchCard(m){
  const map = { live:["live","LIVE"], ft:["ft","FULL TIME"], up:["up","UPCOMING"] };
  const [sc, label] = map[m.status] || map.up;
  const d = toDate(m.date);
  const when = d ? d.toLocaleString([], {weekday:"short", month:"short", day:"numeric", hour:"2-digit", minute:"2-digit"}) : "TBD";
  const g = (m.knockout && m.stage) ? m.stage : (TEAM_OF_GROUP[m.home] ? "Group " + TEAM_OF_GROUP[m.home] : "World Cup");
  return `<div class="card" data-id="${m.id}">
    <div class="row"><span class="league">${g}</span><span class="status ${sc}">${label}</span></div>
    ${teamRow(m.home, m.hs, m.as, m.status)}
    ${teamRow(m.away, m.as, m.hs, m.status)}
    <div class="kick">${m.status==="up" ? "⏱ "+when : (m.venue || when)}</div>
  </div>`;
}
function renderMatches(){
  const el = $("#matches");
  let list = FIXTURES;
  if(matchFilter==="live")     list = list.filter(m=>m.status==="live");
  if(matchFilter==="upcoming") list = list.filter(m=>m.status==="up");
  if(matchFilter==="results")  list = list.filter(m=>m.status==="ft");
  if(matchFilter==="fav")      list = list.filter(m=>isFav(m.home)||isFav(m.away));
  if(!list.length){ el.innerHTML = `<div class="empty">No ${matchFilter==="all"?"":matchFilter+" "}matches to show.</div>`; return; }
  const sorted = [...list].sort((a,b)=>{
    const fa=(isFav(a.home)||isFav(a.away))?0:1, fb=(isFav(b.home)||isFav(b.away))?0:1;
    if(fa!==fb) return fa-fb;
    return TS(a.date)-TS(b.date);
  });
  el.innerHTML = sorted.slice(0,40).map(matchCard).join("");
}

function renderHero(){
  const now = Date.now();
  const live = FIXTURES.find(m=>m.status==="live");
  const upcoming = FIXTURES.filter(m=>m.status==="up" && TS(m.date) > now).sort((a,b)=>TS(a.date)-TS(b.date));
  let target = live || (fav ? upcoming.find(m=>isFav(m.home)||isFav(m.away)) : null) || upcoming[0];
  if(!target){ $("#heroMatch").textContent = "No upcoming matches"; $("#heroMeta").textContent=""; $("#countdown").innerHTML=""; clearInterval(cdTimer); return; }
  const g = TEAM_OF_GROUP[target.home] ? "Group " + TEAM_OF_GROUP[target.home] : "World Cup";
  if(live){
    $("#heroLabel").textContent = "Live now";
    $("#heroMatch").innerHTML = `${crest(target.home)} ${target.home} ${target.hs??0} – ${target.as??0} ${target.away} ${crest(target.away)}`;
    $("#heroMeta").textContent = `${g} · ${target.venue||""}`;
    $("#countdown").innerHTML = `<div class="cd-unit"><div class="num" style="color:var(--live)">●</div><div class="lab">In play</div></div>`;
    clearInterval(cdTimer); return;
  }
  $("#heroLabel").textContent = (fav && (isFav(target.home)||isFav(target.away))) ? `Next for ${fav}` : "Next up";
  $("#heroMatch").innerHTML = `${crest(target.home)} ${target.home} <span style="color:var(--muted)">vs</span> ${target.away} ${crest(target.away)}`;
  $("#heroMeta").textContent = `${g} · ${target.venue||""} · ${toDate(target.date)?.toLocaleString([], {weekday:"short", hour:"2-digit", minute:"2-digit"})||""}`;
  startCountdown(TS(target.date));
}
function startCountdown(ts){
  clearInterval(cdTimer);
  const tick = ()=>{
    let diff = Math.max(0, ts - Date.now());
    const d=Math.floor(diff/864e5); diff-=d*864e5;
    const h=Math.floor(diff/36e5); diff-=h*36e5;
    const m=Math.floor(diff/6e4); diff-=m*6e4;
    const s=Math.floor(diff/1e3);
    const u=(n,l)=>`<div class="cd-unit"><div class="num">${String(n).padStart(2,'0')}</div><div class="lab">${l}</div></div>`;
    $("#countdown").innerHTML = u(d,"Days")+u(h,"Hrs")+u(m,"Min")+u(s,"Sec");
  };
  tick(); cdTimer = setInterval(tick, 1000);
}

function renderSchedule(){
  const el = $("#schedule");
  const now = Date.now(), horizon = now + 7*864e5, floor = now - 3*36e5;
  const list = FIXTURES.filter(m=> m.status!=="ft" && TS(m.date)>=floor && TS(m.date)<=horizon).sort((a,b)=>TS(a.date)-TS(b.date));
  if(!list.length){ el.innerHTML = `<div class="empty">No matches in the next 7 days.</div>`; return; }
  const groups = {};
  list.forEach(m=>{
    const key = toDate(m.date).toLocaleDateString([], {weekday:"long", month:"long", day:"numeric"});
    (groups[key] = groups[key] || []).push(m);
  });
  el.innerHTML = Object.entries(groups).map(([day, ms])=>{
    const rows = ms.map(m=>{
      const d = toDate(m.date);
      const time = d ? d.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"}) : "TBD";
      const live = m.status==="live";
      const favCls = (isFav(m.home)||isFav(m.away)) ? "fav" : "";
      const g = TEAM_OF_GROUP[m.home] ? "Group "+TEAM_OF_GROUP[m.home] : "World Cup";
      return `<div class="fixture ${favCls}" data-id="${m.id}">
        <div class="time">${live ? '<span style="color:var(--live)">● LIVE</span>' : time}</div>
        <div class="teams">${crest(m.home)}<span>${m.home}</span><span class="sep">v</span><span>${m.away}</span>${crest(m.away)}</div>
        <div class="venue"><div class="stage-tag">${g}</div>${m.venue || "Venue TBD"}</div>
      </div>`;
    }).join("");
    return `<div class="day-group"><h3 class="day-head">${day} · ${ms.length} match${ms.length>1?"es":""}</h3>${rows}</div>`;
  }).join("");
}

function renderGroups(){
  const el = $("#groups");
  if(!GROUPS.length){ el.innerHTML = `<div class="empty">Standings appear once fixtures load.</div>`; return; }
  el.innerHTML = GROUPS.map(g=>{
    const played = g.matches.filter(m=>m.status==="ft").length;
    const body = g.teams.map((r,i)=>{
      const cls = [];
      if(i<2) cls.push("q1"); else if(i===2) cls.push("q3");
      if(isFav(r.team)) cls.push("fav-row");
      return `<tr class="${cls.join(' ')}">
        <td class="l team-cell"><span class="pos">${i+1}</span>${crest(r.team)}<span class="name">${r.team}</span></td>
        <td>${r.P}</td><td>${r.W}</td><td>${r.D}</td><td>${r.L}</td>
        <td>${r.GF-r.GA>0?'+':''}${r.GF-r.GA}</td><td class="pts">${r.Pts}</td></tr>`;
    }).join("");
    return `<div class="card group-card">
      <h3>Group ${g.letter}</h3>
      <p class="gnote">${played} of ${g.matches.length} matches played</p>
      <table class="standings"><thead><tr>
        <th class="l">Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th>
      </tr></thead><tbody>${body}</tbody></table></div>`;
  }).join("");
}

function renderScorers(){
  const el = $("#scorers");
  if(!SCORERS.length){
    el.innerHTML = `<div class="empty" style="border:none;padding:28px">No goals reported by the feed yet.<br>The Golden Boot race fills in from real match timelines as games are played.</div>`;
    return;
  }
  el.innerHTML = SCORERS.map((s,i)=>{
    const bio = BIO_CACHE[s.id] || {};
    const age = (typeof bio.age === "number") ? bio.age : ageFrom(bio.dateOfBirth);
    const pic = crest(s.team);
    const pen = "";
    const meta = [s.team, age!=null?age+"y":""].filter(Boolean).join(" · ");
    return `<div class="scorer ${isFav(s.team)?'fav':''}" data-pid="${s.id||''}" style="cursor:${s.id?'pointer':'default'}">
      <div class="rank">${i+1}</div>${pic}
      <div class="who"><span class="nm">${s.name}${pen}</span><span class="tm">${meta}</span></div>
      <div class="goals">${s.goals} ⚽</div>
    </div>`;
  }).join("");
}

function renderBracket(){
  const el = $("#bracket");
  const ko = FIXTURES.filter(m=> m.knockout && m.home && m.away);
  if(!ko.length){
    el.innerHTML = `<div class="bracket-note">🏆 The knockout bracket is set after the group stage.<br>
      Round of 32 begins <strong>June 28, 2026</strong> — fixtures will appear here automatically as they're confirmed.</div>`;
    return;
  }
  const byStage = {};
  ko.forEach(m=>{ (byStage[m.stage] = byStage[m.stage] || { order:m.stageOrder, list:[] }).list.push(m); });
  el.innerHTML = Object.entries(byStage).sort((a,b)=> a[1].order - b[1].order).map(([stage, {list}])=>
    `<div class="section-title" style="margin-top:18px">${stage}</div>
     <div class="match-grid">${list.sort((a,b)=>TS(a.date)-TS(b.date)).map(matchCard).join("")}</div>`
  ).join("");
}

function buildTeamList(){
  $("#teamlist").innerHTML = TEAMS.map(n=>`<option value="${n}">`).join("");
}

/* ---------------- Diagnostics / trust (verify the data is real) ---------------- */
// read ESPN's independent scoreline for one of our matches, oriented to our home/away
async function runCrossChecks(){
  const el = $("#xcheck"); if(!el) return;
  el.innerHTML = `<div class="espn-load">Cross-checking TheSportsDB scores against ESPN…</div>`;
  const finished = FIXTURES.filter(m=>m.status==="ft"&&m.hs!=null).sort((a,b)=>TS(b.date)-TS(a.date)).slice(0,25);
  if(!finished.length){ el.innerHTML = emptyNote("No finished matches to cross-check yet."); return; }
  const rows = [];
  for(const m of finished){
    const e = await espnScoreFor(m);
    rows.push({ m, tsdb:`${m.hs}-${m.as}`, espn:(e && e.hs!=null) ? `${e.hs}-${e.as}` : null, agree:(e && e.hs!=null) ? (e.hs===m.hs && e.as===m.as) : null });
  }
  const checked = rows.filter(r=>r.agree!=null).length;
  const agree = rows.filter(r=>r.agree===true).length;
  const head = `<div class="check"><div class="ico ${checked&&agree===checked?'ok':checked?'bad':'warn'}">${checked&&agree===checked?'✓':checked?'!':'–'}</div>
    <div class="c-body"><div class="c-name">${agree}/${checked} finished scorelines independently confirmed</div>
    <div class="c-detail">TheSportsDB and ESPN are separate providers — agreement is strong evidence the scores are real.</div></div></div>`;
  el.innerHTML = head + rows.map(r=>`<div class="xrow"><span>${r.m.home} v ${r.m.away}</span>
    <span class="v">${r.tsdb} · ${r.espn||'—'}</span>
    ${r.agree==null?'<span class="ag" style="color:var(--muted)">n/a</span>':r.agree?'<span class="ag y">match</span>':'<span class="ag n">DIFFERS</span>'}</div>`).join("");
}
function renderDiagnostics(){
  const el = $("#diag"); if(!el) return;
  const inv = runInvariants();
  const ico = c => c.pass ? (c.warn ? '<div class="ico warn">!</div>' : '<div class="ico ok">✓</div>') : '<div class="ico bad">✕</div>';
  const checks = inv.map(c=>`<div class="check">${ico(c)}<div class="c-body"><div class="c-name">${c.name}</div><div class="c-detail">${c.detail}</div></div></div>`).join("");
  const passN = inv.filter(c=>c.pass).length;
  el.innerHTML = `
    <div class="diag-group">
      <h3>Integrity checks · <span style="color:${passN===inv.length?'var(--accent)':'var(--live)'}">${passN}/${inv.length} passing</span></h3>
      <p class="sub">Math that must hold if the data is genuine — recomputed live from what's loaded.</p>
      ${checks}
    </div>
    <div class="diag-group">
      <h3>Cross-source verification</h3>
      <p class="sub">Compare every finished scoreline against a second, independent provider (ESPN).</p>
      <div class="diag-actions"><button class="btn" id="xrun">↔ Run TheSportsDB ↔ ESPN check</button></div>
      <div id="xcheck"></div>
    </div>
    <div class="diag-group">
      <h3>Sources &amp; raw data</h3>
      <p class="sub">Open the actual API responses the dashboard reads — confirm any figure yourself.</p>
      <div class="raw-links">
        <a href="${ESPN}/scoreboard?dates=20260611-20260719" target="_blank" rel="noopener">ESPN · all fixtures &amp; scores ↗</a>
        <a href="https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings?season=${SEASON}" target="_blank" rel="noopener">ESPN · groups &amp; standings ↗</a>
        <a href="${ESPN}/scoreboard?dates=${ymd(new Date())}" target="_blank" rel="noopener">ESPN · today's scoreboard ↗</a>
      </div>
    </div>`;
  const b = $("#xrun"); if(b) b.addEventListener("click", runCrossChecks);
}

/* ---------------- ESPN: lineups, formations, full match stats (free, keyless) ---------------- */
// classify a position abbreviation into a pitch row (0=GK ... 5=forward)
/* ---------------- Match detail modal ---------------- */
let lastFocus = null;
async function openMatch(id){
  const m = FIXTURES.find(x=>String(x.id)===String(id));
  if(!m) return;
  lastFocus = document.activeElement;   // remember focus to restore on close
  const md = document.querySelector(".modal"); if(md) md.classList.add("wide");
  $("#modalTitle").textContent = TEAM_OF_GROUP[m.home] ? "Group "+TEAM_OF_GROUP[m.home] : "Match details";
  const score = (m.hs!=null && m.as!=null) ? `${m.hs} <span class="vs">–</span> ${m.as}` : `<span class="vs">vs</span>`;
  const d = toDate(m.date);
  const when = d ? d.toLocaleString([], {weekday:"long", month:"long", day:"numeric", hour:"2-digit", minute:"2-digit"}) : "Date TBD";
  $("#modalBody").innerHTML = `
    <div class="score-big">
      <div class="t">${crest(m.home,true)}${m.home}</div><div>${score}</div><div class="t">${crest(m.away,true)}${m.away}</div>
    </div>
    <div class="detail-row"><span>Status</span><span>${({live:"🔴 Live",ft:"Full time",up:"Upcoming"})[m.status]||"—"}</span></div>
    <div class="detail-row"><span>Stage</span><span>${(m.knockout && m.stage) ? m.stage : (TEAM_OF_GROUP[m.home] ? "Group "+TEAM_OF_GROUP[m.home] : (m.stage||"—"))}</span></div>
    <div class="detail-row"><span>Kickoff</span><span>${when}</span></div>
    <div class="detail-row"><span>Venue</span><span>${m.venue||"—"}</span></div>
    <div class="detail-row"><span>Host country</span><span>${m.country||"—"}</span></div>
    <div class="detail-row"><span>Add to calendar</span><span><button class="cal-btn" id="icsBtn" type="button">＋ Calendar (.ics)</button></span></div>
    <div class="detail-row"><span>Raw data</span><span><a href="${ESPN}/summary?event=${m.id}" target="_blank" rel="noopener">ESPN ↗</a></span></div>
    <div id="espnBox"></div>`;
  const ib = $("#icsBtn"); if(ib) ib.onclick = ()=> downloadIcs(m);
  $("#modalBg").classList.add("show");
  $("#modalClose").focus();   // move focus into the dialog for keyboard users
  await loadEspnInto(m);   // goals, lineups, formations, full stats, attendance, referee (ESPN)
}
function closeModal(){ $("#modalBg").classList.remove("show"); const md=document.querySelector(".modal"); if(md) md.classList.remove("wide"); if(lastFocus && lastFocus.focus){ lastFocus.focus(); lastFocus = null; } }

/* ---------------- Events ---------------- */
$("#matches").addEventListener("click", e=>{ const c=e.target.closest(".card[data-id]"); if(c) openMatch(c.dataset.id); });
$("#schedule").addEventListener("click", e=>{ const r=e.target.closest(".fixture[data-id]"); if(r) openMatch(r.dataset.id); });
$("#bracket").addEventListener("click", e=>{ const c=e.target.closest(".card[data-id]"); if(c) openMatch(c.dataset.id); });
$("#scorers").addEventListener("click", e=>{ const r=e.target.closest(".scorer[data-pid]"); if(r && r.dataset.pid) openPlayer(r.dataset.pid); });
$("#players").addEventListener("click", e=>{ const c=e.target.closest(".pcard[data-pid]"); if(c) openPlayer(c.dataset.pid); });
$("#modalBody").addEventListener("click", e=>{ const x=e.target.closest("[data-pid]"); if(x && x.dataset.pid) openPlayer(x.dataset.pid); });
$("#pSearch").addEventListener("input", e=>{ pFilter.q = e.target.value; renderPlayers(); });
$("#pSort").addEventListener("change", e=>{ pFilter.sort = e.target.value; renderPlayers(); });
$("#pTeam").addEventListener("change", e=>{ pFilter.team = e.target.value; renderPlayers(); });
$("#modalBg").addEventListener("click", e=>{ if(e.target.id==="modalBg") closeModal(); });
$("#modalClose").addEventListener("click", closeModal);
document.addEventListener("keydown", e=>{ if(e.key==="Escape") closeModal(); });

document.querySelectorAll(".chip").forEach(c=> c.addEventListener("click", ()=>{
  document.querySelectorAll(".chip").forEach(x=>x.classList.remove("active"));
  c.classList.add("active"); matchFilter = c.dataset.filter; renderMatches();
}));
// Tab switching + deep-link routing (#scorers, #stats, …) with working Back button.
function activate(name){
  const btn = document.querySelector('.tab[data-tab="'+name+'"]'); if(!btn) return false;
  document.querySelectorAll(".tab").forEach(x=>{ x.classList.remove("active"); x.setAttribute("aria-selected","false"); x.tabIndex = -1; });
  document.querySelectorAll(".panel").forEach(x=>x.classList.remove("active"));
  btn.classList.add("active"); btn.setAttribute("aria-selected","true"); btn.tabIndex = 0;
  const p = $("#tab-"+name); if(p) p.classList.add("active");
  return true;
}
// Decorate tabs/panels with ARIA roles + arrow-key navigation (WAI-ARIA tablist pattern).
(function(){
  const nav = document.querySelector(".tabs"); if(nav) nav.setAttribute("role","tablist");
  document.querySelectorAll(".tab").forEach(t=>{ t.setAttribute("role","tab"); t.setAttribute("aria-controls","tab-"+t.dataset.tab); t.setAttribute("aria-selected", t.classList.contains("active")?"true":"false"); t.tabIndex = t.classList.contains("active")?0:-1; });
  document.querySelectorAll(".panel").forEach(p=>{ p.setAttribute("role","tabpanel"); p.setAttribute("tabindex","0"); });
  if(nav) nav.addEventListener("keydown", e=>{
    if(e.key!=="ArrowRight" && e.key!=="ArrowLeft" && e.key!=="Home" && e.key!=="End") return;
    const tabs = [...document.querySelectorAll(".tab")]; const i = tabs.findIndex(t=>t.classList.contains("active")); if(i<0) return;
    let j = e.key==="Home" ? 0 : e.key==="End" ? tabs.length-1 : e.key==="ArrowRight" ? (i+1)%tabs.length : (i-1+tabs.length)%tabs.length;
    e.preventDefault(); tabs[j].click(); tabs[j].focus();
  });
})();
document.querySelectorAll(".tab").forEach(t=> t.addEventListener("click", ()=>{
  if(activate(t.dataset.tab)){
    if(location.hash.slice(1) !== t.dataset.tab) location.hash = t.dataset.tab;
    ensure(t.dataset.tab);
  }
}));
window.addEventListener("hashchange", ()=>{
  const h = location.hash.slice(1);
  if(h && h !== currentTab() && activate(h)) ensure(h);
});
$("#fav").addEventListener("change", e=>{
  fav = e.target.value.trim(); localStorage.setItem(STORE_KEY, fav);
  renderAll();
  if(loaded.scorers) renderScorers();
  if(loaded.stats)   renderStats();
  if(loaded.players) renderPlayers();
});
$("#refresh").addEventListener("click", ()=>{
  $("#matches").innerHTML='<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>'; init();
});

// Match-alert toggle (kick-off / goals / full-time for your team). Foreground only.
(function(){
  const btn = $("#notifyBtn"); if(!btn || !notifySupported()) return;
  btn.hidden = false;
  const paint = on => { btn.classList.toggle("on", on); btn.setAttribute("aria-pressed", on?"true":"false"); btn.textContent = on ? "🔔 Alerts on" : "🔔 Alerts"; };
  paint(notifyOn() && Notification.permission === "granted");
  btn.addEventListener("click", async ()=>{
    if(notifyOn()){ disableNotifications(); paint(false); return; }
    const ok = await enableNotifications();
    paint(ok);
    if(!ok && Notification.permission === "denied")
      btn.title = "Notifications are blocked in your browser settings";
  });
})();

// Live-aware auto-refresh: poll every ~30s while a match is live, every 3 min otherwise.
let refreshTimer = null;
function scheduleRefresh(){
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async ()=>{
    if(document.visibilityState === "visible"){ try{ await init(); }catch(_){ } }
    scheduleRefresh();
  }, nextRefreshMs());
}

// Honour a deep-link tab on first load (init's ensure() will lazy-load it after data arrives).
(function(){ const h = location.hash.slice(1); if(h) activate(h); })();
init().finally(scheduleRefresh);

// Register the service worker for offline launch + home-screen install (no-op on file://).
if("serviceWorker" in navigator){
  window.addEventListener("load", ()=> navigator.serviceWorker.register("sw.js").catch(()=>{}));
}

/* Fail-safe error boundary: never leave a blank screen. Surface a reload prompt
   only if the app genuinely has no data — ignore non-fatal background hiccups. */
(function(){
  var shown = false;
  function fatal(){
    if(shown || (typeof FIXTURES !== "undefined" && FIXTURES.length)) return;
    shown = true;
    var b = document.createElement("div");
    b.textContent = "⚠ Couldn't load live data — tap to reload";
    b.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#ff4d5e;color:#fff;padding:14px;text-align:center;font:600 14px -apple-system,sans-serif;cursor:pointer";
    b.onclick = function(){ location.reload(); };
    (document.body || document.documentElement).appendChild(b);
  }
  window.addEventListener("error", fatal);
  window.addEventListener("unhandledrejection", function(e){ if(e && e.preventDefault) e.preventDefault(); fatal(); });
})();
