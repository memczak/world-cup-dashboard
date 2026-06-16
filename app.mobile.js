/* ===== Mobile UI (uses the shared wc-engine.js data layer) ===== */
const TABS = ["matches","groups","stats","players","verify"];
let tab = "matches";
let mseg = "fixtures";   // fixtures | results
let gseg = "groups";     // groups | bracket
let pQuery = "";
let mcdTimer = null;

/* favorite / My Team hub (opened from the ★ button) */
function setFav(v){ fav=v; localStorage.setItem(STORE_KEY, fav); renderActive(); }
favBtn.onclick = openMyTeam;
refBtn.onclick = ()=> init();

/* Match-alert toggle (kick-off / goals / full-time for your team). Foreground only. */
(function(){
  const btn = document.getElementById("notifyBtn"); if(!btn || !notifySupported()) return;
  btn.hidden = false;
  const paint = on => { btn.classList.toggle("on", on); btn.setAttribute("aria-pressed", on?"true":"false"); };
  paint(notifyOn() && Notification.permission === "granted");
  btn.onclick = async ()=>{
    if(notifyOn()){ disableNotifications(); paint(false); return; }
    paint(await enableNotifications());
  };
})();

/* tab switching + swipe */
function setTab(t){
  if(!TABS.includes(t)) return;
  tab = t;
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
  document.getElementById("v-"+t).classList.add("active");
  document.querySelectorAll(".tabbar button").forEach(b=>{ const on=b.dataset.tab===t; b.classList.toggle("on", on); b.setAttribute("aria-selected", on?"true":"false"); });
  window.scrollTo(0,0);
  if(location.hash.slice(1) !== t) location.hash = t;   // deep-link + Back button
  renderActive();
  ensure(t);                                            // lazy-load this tab's heavy data
}
document.querySelectorAll(".tabbar button").forEach(b=> b.onclick = ()=> setTab(b.dataset.tab));
// ARIA roles for the bottom tab bar + panels (WAI-ARIA tablist pattern).
(function(){
  const bar=document.getElementById("tabbar"); if(bar) bar.setAttribute("role","tablist");
  document.querySelectorAll(".tabbar button").forEach(b=>{ b.setAttribute("role","tab"); b.setAttribute("aria-controls","v-"+b.dataset.tab); b.setAttribute("aria-selected", b.classList.contains("on")?"true":"false"); });
  document.querySelectorAll(".view").forEach(v=> v.setAttribute("role","tabpanel"));
})();
window.addEventListener("hashchange", ()=>{ const h = location.hash.slice(1); if(TABS.includes(h) && h !== tab) setTab(h); });
let tx=0, ty=0;
main.addEventListener("touchstart", e=>{ tx=e.touches[0].clientX; ty=e.touches[0].clientY; }, {passive:true});
main.addEventListener("touchend", e=>{
  const dx=e.changedTouches[0].clientX-tx, dy=e.changedTouches[0].clientY-ty;
  if(Math.abs(dx)>60 && Math.abs(dx)>Math.abs(dy)*1.8){
    const i=TABS.indexOf(tab);
    if(dx<0 && i<TABS.length-1) setTab(TABS[i+1]);
    if(dx>0 && i>0) setTab(TABS[i-1]);
  }
}, {passive:true});

function renderActive(){
  buildTeamDatalist();
  if(tab==="matches") renderMatches();
  else if(tab==="groups") renderGroups();
  else if(tab==="stats") renderStats();
  else if(tab==="players") renderPlayers();
  else if(tab==="verify") renderVerify();
}
function renderIfActive(t){ if(tab===t) renderActive(); }
function buildTeamDatalist(){
  if(TEAMS.length && document.getElementById("teamlist").children.length<=1)
    document.getElementById("teamlist").innerHTML = TEAMS.map(n=>`<option value="${n}">`).join("");
}

/* ---- Matches ---- */
function sideRow(name, score, opp, status){
  const cls=["side"]; if(isFav(name)) cls.push("fav");
  if((status==="ft"||status==="live") && score!=null && opp!=null && score>opp) cls.push("win");
  return `<div class="${cls.join(' ')}">${crest(name)}<span class="nm2">${name}</span>${score==null?"":`<span class="sc">${score}</span>`}</div>`;
}
function matchRow(m){
  const map={live:["live","LIVE"],ft:["ft","FT"],up:["up","UPCOMING"]};
  const [c,l]=map[m.status]||map.up;
  const d=toDate(m.date);
  const when=d?d.toLocaleString([],{weekday:"short",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}):"TBD";
  const g=(m.knockout&&m.stage)?m.stage:(TEAM_OF_GROUP[m.home]?"Group "+TEAM_OF_GROUP[m.home]:"World Cup");
  return `<div class="mrow" data-id="${m.id}">
    <div class="top"><span class="lg">${g}</span><span class="pill ${c}">${l}</span></div>
    ${sideRow(m.home,m.hs,m.as,m.status)}${sideRow(m.away,m.as,m.hs,m.status)}
    <div class="when">${m.status==="up"?"⏱ "+when:(m.venue||when)}</div></div>`;
}
function renderMatches(){
  const el=document.getElementById("v-matches");
  if(!FIXTURES.length){ el.innerHTML=`<div class="empty">Loading live fixtures…</div>`; return; }
  const now=Date.now();
  // next-match hero
  const live=FIXTURES.find(m=>m.status==="live");
  const up=FIXTURES.filter(m=>m.status==="up"&&TS(m.date)>now).sort((a,b)=>TS(a.date)-TS(b.date));
  const target=live||(fav?up.find(m=>isFav(m.home)||isFav(m.away)):null)||up[0];
  let hero="";
  if(target){
    const g=TEAM_OF_GROUP[target.home]?"Group "+TEAM_OF_GROUP[target.home]:"World Cup";
    if(live){
      hero=`<div class="nm"><div class="lab">Live now</div>
        <div class="mt">${crest(target.home)} ${target.home} ${target.hs??0}–${target.as??0} ${target.away} ${crest(target.away)}</div>
        <div class="meta">${g} · ${target.venue||""}</div></div>`;
    }else{
      hero=`<div class="nm"><div class="lab">${fav&&(isFav(target.home)||isFav(target.away))?"Next for "+fav:"Next up"}</div>
        <div class="mt">${crest(target.home)} ${target.home} <span style="color:var(--muted)">vs</span> ${target.away} ${crest(target.away)}</div>
        <div class="meta">${g} · ${target.venue||""}</div>
        <div class="cd" id="cd"></div></div>`;
    }
  }
  const seg=`<div class="seg">
    <button class="${mseg==='fixtures'?'on':''}" data-seg="fixtures">Upcoming</button>
    <button class="${mseg==='results'?'on':''}" data-seg="results">Results</button></div>`;
  let list;
  if(mseg==="results") list=FIXTURES.filter(m=>m.status==="ft").sort((a,b)=>TS(b.date)-TS(a.date));
  else list=FIXTURES.filter(m=>m.status!=="ft").sort((a,b)=>TS(a.date)-TS(b.date));
  // favorite first
  list.sort((a,b)=>{ const fa=(isFav(a.home)||isFav(a.away))?0:1,fb=(isFav(b.home)||isFav(b.away))?0:1; return fa-fb; });
  const body=list.length?list.slice(0,60).map(matchRow).join(""):`<div class="empty">No ${mseg==="results"?"results":"upcoming matches"} yet.</div>`;
  el.innerHTML=hero+seg+body;
  el.querySelectorAll(".seg button").forEach(b=> b.onclick=()=>{ mseg=b.dataset.seg; renderMatches(); });
  el.querySelectorAll(".mrow").forEach(r=> r.onclick=()=> openMatch(r.dataset.id));
  if(target&&!live) startCountdown(TS(target.date));
}
function startCountdown(ts){
  clearInterval(mcdTimer);
  const tick=()=>{ const cd=document.getElementById("cd"); if(!cd){clearInterval(mcdTimer);return;}
    let df=Math.max(0,ts-Date.now());
    const d=Math.floor(df/864e5);df-=d*864e5;const h=Math.floor(df/36e5);df-=h*36e5;const m=Math.floor(df/6e4);df-=m*6e4;const s=Math.floor(df/1e3);
    const u=(n,x)=>`<div class="u"><b>${String(n).padStart(2,"0")}</b><span>${x}</span></div>`;
    cd.innerHTML=u(d,"Days")+u(h,"Hrs")+u(m,"Min")+u(s,"Sec");
  };
  tick(); mcdTimer=setInterval(tick,1000);
}

/* ---- Groups + Knockout ---- */
function renderGroups(){
  const el=document.getElementById("v-groups");
  const seg=`<div class="seg">
    <button class="${gseg==='groups'?'on':''}" data-gseg="groups">Groups</button>
    <button class="${gseg==='bracket'?'on':''}" data-gseg="bracket">Knockout</button></div>`;
  el.innerHTML = seg + (gseg==="bracket" ? bracketHTML() : groupsHTML());
  el.querySelectorAll(".seg button").forEach(b=> b.onclick=()=>{ gseg=b.dataset.gseg; renderGroups(); });
  el.querySelectorAll(".mrow[data-id]").forEach(r=> r.onclick=()=> openMatch(r.dataset.id));
}
function groupsHTML(){
  if(!GROUPS.length) return `<div class="empty">Standings appear once fixtures load.</div>`;
  return `<div class="h">Group stage — top 2 advance · 3rd in best-thirds race</div>`+GROUPS.map(g=>{
    const played=g.matches.filter(m=>m.status==="ft").length;
    const rows=g.teams.map((r,i)=>{
      const cls=[]; if(i<2)cls.push("q1"); else if(i===2)cls.push("q3"); if(isFav(r.team))cls.push("favr");
      return `<tr class="${cls.join(' ')}"><td class="l"><span class="tname">${crest(r.team)}${r.team}</span></td>
        <td>${r.P}</td><td>${r.W}</td><td>${r.D}</td><td>${r.GF-r.GA>0?'+':''}${r.GF-r.GA}</td><td class="pts">${r.Pts}</td></tr>`;
    }).join("");
    return `<div class="gcard"><h3>Group ${g.letter} <span style="color:var(--muted);font-size:11px;font-weight:400">· ${played}/${g.matches.length} played</span></h3>
      <table><thead><tr><th class="l">Team</th><th>P</th><th>W</th><th>D</th><th>GD</th><th>Pts</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }).join("");
}
function bracketHTML(){
  const ko=FIXTURES.filter(m=>m.knockout && m.home && m.away);
  if(!ko.length) return `<div class="empty">🏆 The knockout bracket fills in after the group stage.<br>Round of 32 begins June 28 — it'll appear here automatically.</div>`;
  const byStage={};
  ko.forEach(m=>{ (byStage[m.stage]=byStage[m.stage]||{order:m.stageOrder,list:[]}).list.push(m); });
  return Object.entries(byStage).sort((a,b)=>a[1].order-b[1].order).map(([stage,o])=>
    `<div class="h">${stage}</div>`+o.list.sort((a,b)=>TS(a.date)-TS(b.date)).map(matchRow).join("")
  ).join("");
}

/* ---- Stats (pulse + scorers) ---- */
function renderStats(){
  const el=document.getElementById("v-stats");
  let html=`<div class="h">Tournament pulse</div>`;
  if(STATS&&STATS.played){
    const S=STATS;
    html+=`<div class="tiles">
      <div class="tile"><b>${S.played}</b><span>Matches played</span></div>
      <div class="tile"><b>${S.goals}</b><span>Goals · ${(S.goals/S.played).toFixed(2)}/match</span></div>
      <div class="tile"><b>${S.cleanSheets}</b><span>Clean sheets</span></div>
      <div class="tile"><b>${S.pens}</b><span>Penalties</span></div></div>`;
  }else html+=`<div class="empty" style="margin-bottom:16px">Fills in as matches are played.</div>`;
  html+=`<div class="h">Golden Boot</div>`;
  if(SCORERS&&SCORERS.length){
    html+=SCORERS.slice(0,25).map((s,i)=>{
      const bio=BIO_CACHE[s.id]||{}; const age=(typeof bio.age==="number")?bio.age:ageFrom(bio.dateOfBirth);
      const pic=`<span class="ph">${crest(s.team)}</span>`;
      const meta=[s.team,age!=null?age+"y":""].filter(Boolean).join(" · ");
      return `<div class="lrow" data-pid="${s.id||''}"><span class="rk">${i+1}</span>${pic}
        <div><div class="nm3">${s.name}</div><div class="sub">${meta}</div></div><span class="rt">${s.goals} ⚽</span></div>`;
    }).join("");
  }else html+=`<div class="empty">No goals reported by the feed yet.</div>`;
  html+=statsExtraHTML();
  el.innerHTML=html;
  el.querySelectorAll(".lrow[data-pid]").forEach(r=>{ if(r.dataset.pid) r.onclick=()=>openPlayer(r.dataset.pid); });
}
function statsExtraHTML(){
  const S=STATS; if(!S) return "";
  let h="";
  if(S.thirds && S.thirds.length){
    h+=`<div class="h">Best third-placed race</div><div class="gcard">
      <table><thead><tr><th>#</th><th class="l">Team</th><th>P</th><th>GD</th><th>Pts</th><th></th></tr></thead><tbody>`+
      S.thirds.map((t,i)=>`<tr class="${i<8?'q1':''} ${isFav(t.team)?'favr':''}"><td>${i+1}</td>
        <td class="l"><span class="tname">${crest(t.team)}${t.team} <span style="color:var(--muted)">(${t.group})</span></span></td>
        <td>${t.P}</td><td>${t.GF-t.GA>0?'+':''}${t.GF-t.GA}</td><td class="pts">${t.Pts}</td>
        <td>${i<8?'<span class="tag g">Q</span>':''}</td></tr>`).join("")+
      `</tbody></table><div style="font-size:11px;color:var(--muted);padding:7px 2px 0">Top 8 of 12 reach the Round of 32</div></div>`;
  }
  if((S.clinched&&S.clinched.length)||(S.eliminated&&S.eliminated.length)){
    h+=`<div class="h">Qualification</div><div class="gcard">`+
      (S.clinched||[]).map(t=>`<div class="lrow" style="cursor:default"><span class="ph">${crest(t.team)}</span><div><div class="nm3">${t.team}</div><div class="sub">Group ${t.group}</div></div><span class="tag g">Through ✓</span></div>`).join("")+
      (S.eliminated||[]).map(t=>`<div class="lrow" style="cursor:default"><span class="ph">${crest(t.team)}</span><div><div class="nm3">${t.team}</div><div class="sub">Group ${t.group}</div></div><span class="tag r">Out</span></div>`).join("")+
      `</div>`;
  }
  if((S.openPlay+S.pens+S.ownGoals)>0){
    const labs=["1-15","16-30","31-45","46-60","61-75","76+"], max=Math.max(1,...S.bands);
    h+=`<div class="h">Goals by minute</div><div class="gcard"><div class="mbars">`+
      S.bands.map((n,i)=>`<div class="mb"><span class="mn">${n}</span><div class="mbar" style="height:${Math.round(n/max*72)}px"></div><span class="ml">${labs[i]}</span></div>`).join("")+
      `</div></div>`;
  }
  const shotTeams=Object.entries(S.shots||{}).filter(([,v])=>v.total>0).sort((a,b)=>b[1].total-a[1].total).slice(0,12);
  if(shotTeams.length){
    h+=`<div class="h">Shooting</div><div class="gcard"><table><thead><tr><th class="l">Team</th><th>GP</th><th>Shots</th><th>On</th></tr></thead><tbody>`+
      shotTeams.map(([team,v])=>`<tr><td class="l"><span class="tname">${crest(team)}${team}</span></td><td>${v.g}</td><td>${v.total}</td><td>${v.on}</td></tr>`).join("")+
      `</tbody></table></div>`;
  }
  const cardTeams=Object.entries(S.cards||{}).filter(([,c])=>c.Y+c.R>0).sort((a,b)=>(b[1].Y+b[1].R*2)-(a[1].Y+a[1].R*2));
  if(cardTeams.length){
    h+=`<div class="h">Discipline</div><div class="gcard"><table><thead><tr><th class="l">Team</th><th>🟨</th><th>🟥</th></tr></thead><tbody>`+
      cardTeams.map(([team,c])=>`<tr><td class="l"><span class="tname">${crest(team)}${team}</span></td><td>${c.Y}</td><td>${c.R}</td></tr>`).join("")+
      `</tbody></table></div>`;
  }
  return h;
}

/* ---- Players ---- */
function renderPlayers(){
  const el=document.getElementById("v-players");
  let list=PLAYERS.map(playerView);
  if(pQuery){ const q=pQuery.toLowerCase(); list=list.filter(v=>(v.p.name||"").toLowerCase().includes(q)||(v.club||"").toLowerCase().includes(q)); }
  list.sort((a,b)=>(b.p.goals-a.p.goals)||(a.p.name||"").localeCompare(b.p.name||""));
  const rows=list.length?list.map(v=>{
    const {p,age,club,pos,photo}=v;
    const tags=(p.goals?`<span class="tag g">${p.goals}⚽</span>`:"")+(p.rc?`<span class="tag r">${p.rc}🟥</span>`:"")+(p.yc?`<span class="tag y">${p.yc}🟨</span>`:"");
    const pic=photo?`<img class="ph" src="${photo}" alt="">`:`<span class="ph">${crest(p.nat)}</span>`;
    const meta=[p.nat,age!=null?age+"y":"",pos,club].filter(Boolean).join(" · ");
    return `<div class="lrow" data-pid="${p.id}">${pic}<div><div class="nm3">${p.name||"Unknown"}${tags}</div><div class="sub">${meta}</div></div></div>`;
  }).join(""):`<div class="empty">Players appear as matches are played.</div>`;
  el.innerHTML=`<input class="search" id="pSearch" placeholder="Search player or club…" value="${pQuery}">${rows}`;
  const s=document.getElementById("pSearch");
  s.oninput=e=>{ pQuery=e.target.value; const at=s.selectionStart; renderPlayers(); const ns=document.getElementById("pSearch"); ns.focus(); ns.setSelectionRange(at,at); };
  el.querySelectorAll(".lrow[data-pid]").forEach(r=> r.onclick=()=>openPlayer(r.dataset.pid));
}

/* ---- Verify ---- */
function renderVerify(){
  const el=document.getElementById("v-verify");
  const inv=runInvariants().slice(5);   // mobile: drop the first 5 integrity checks
  const ic=c=> c.pass?(c.warn?'<div class="ic warn">!</div>':'<div class="ic ok">✓</div>'):'<div class="ic bad">✕</div>';
  const passN=inv.filter(c=>c.pass).length;
  el.innerHTML=`<div class="h">Integrity checks · ${passN}/${inv.length} passing</div>`+
    inv.map(c=>`<div class="chk">${ic(c)}<div><div class="cn">${c.name}</div><div class="cd2">${c.detail}</div></div></div>`).join("")+
    `<div class="h" style="margin-top:18px">Cross-source verification</div>
     <button class="btn" id="xrun">↔ Check TheSportsDB vs ESPN</button><div id="xout"></div>
     <div class="h" style="margin-top:18px">Raw data</div>
     <div class="raw">
       <a href="${ESPN}/scoreboard?dates=20260611-20260719" target="_blank" rel="noopener">ESPN · fixtures &amp; scores ↗</a>
       <a href="https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings?season=${SEASON}" target="_blank" rel="noopener">ESPN · standings ↗</a>
       <a href="${ESPN}/scoreboard?dates=${ymd(new Date())}" target="_blank" rel="noopener">ESPN · today ↗</a>
     </div>`;
  document.getElementById("xrun").onclick=runCross;
}
async function runCross(){
  const out=document.getElementById("xout"); out.innerHTML=`<div class="espn-load">Checking…</div>`;
  const fin=FIXTURES.filter(m=>m.status==="ft"&&m.hs!=null).sort((a,b)=>TS(b.date)-TS(a.date)).slice(0,25);
  if(!fin.length){ out.innerHTML=`<div class="empty">No finished matches yet.</div>`; return; }
  const rows=[];
  for(const m of fin){ const e=await espnScoreFor(m); rows.push({m,tsdb:`${m.hs}-${m.as}`,espn:(e&&e.hs!=null)?`${e.hs}-${e.as}`:null,ag:(e&&e.hs!=null)?(e.hs===m.hs&&e.as===m.as):null}); }
  const checked=rows.filter(r=>r.ag!=null).length, agree=rows.filter(r=>r.ag===true).length;
  out.innerHTML=`<div class="chk"><div class="ic ${checked&&agree===checked?'ok':checked?'bad':'warn'}">${checked&&agree===checked?'✓':checked?'!':'–'}</div>
    <div><div class="cn">${agree}/${checked} scorelines confirmed by ESPN</div><div class="cd2">Two independent providers agreeing = strong proof.</div></div></div>`+
    rows.map(r=>`<div class="xr"><span>${r.m.home} v ${r.m.away}</span><span>${r.tsdb} · ${r.espn||'—'} ${r.ag==null?'':r.ag?'<span class="ag y2">match</span>':'<span class="ag n2">DIFF</span>'}</span></div>`).join("");
}

/* ---- Sheets (match + player detail) ---- */
let sheetLastFocus=null;
function openSheet(title){ sheetLastFocus=document.activeElement; sheetTitle.textContent=title; sheetBg.classList.add("show"); sheet.classList.add("show"); sheetClose.focus(); }
function closeSheet(){ sheetBg.classList.remove("show"); sheet.classList.remove("show"); if(sheetLastFocus&&sheetLastFocus.focus){ sheetLastFocus.focus(); sheetLastFocus=null; } }
sheetBg.onclick=closeSheet; sheetClose.onclick=closeSheet;
document.addEventListener("keydown", e=>{ if(e.key==="Escape" && sheet.classList.contains("show")) closeSheet(); });

async function openMatch(id){
  const m=FIXTURES.find(x=>String(x.id)===String(id)); if(!m) return;
  const score=(m.hs!=null&&m.as!=null)?`${m.hs} <span class="vs">–</span> ${m.as}`:`<span class="vs">vs</span>`;
  const d=toDate(m.date); const when=d?d.toLocaleString([],{weekday:"long",month:"long",day:"numeric",hour:"2-digit",minute:"2-digit"}):"TBD";
  openSheet((m.knockout&&m.stage)?m.stage:(TEAM_OF_GROUP[m.home]?"Group "+TEAM_OF_GROUP[m.home]:"Match"));
  sheetBody.innerHTML=`
    <div class="score-big"><div class="t">${crest(m.home)}${m.home}</div><div>${score}</div><div class="t">${crest(m.away)}${m.away}</div></div>
    <div class="drow"><span>Status</span><span>${({live:"🔴 Live",ft:"Full time",up:"Upcoming"})[m.status]||"—"}</span></div>
    <div class="drow"><span>Kickoff</span><span>${when}</span></div>
    <div class="drow"><span>Venue</span><span>${m.venue||"—"}</span></div>
    <div class="drow"><span>Add to calendar</span><span><button class="cal-btn" id="icsBtn" type="button">＋ Calendar (.ics)</button></span></div>
    <div class="drow"><span>Raw data</span><span><a href="${ESPN}/summary?event=${m.id}" target="_blank" rel="noopener">ESPN ↗</a></span></div>
    <div id="espnBox"></div>`;
  const ib = document.getElementById("icsBtn"); if(ib) ib.onclick = ()=> downloadIcs(m);
  await loadEspnInto(m);
  sheetBody.querySelectorAll("[data-pid]").forEach(x=>{ if(x.dataset.pid) x.onclick=()=>openPlayer(x.dataset.pid); });
}
async function openPlayer(id){
  if(!id) return;
  openSheet("Player profile"); sheetBody.innerHTML=`<div class="espn-load">Loading profile…</div>`;
  const reg=PLAYERS.find(p=>String(p.id)===String(id));
  const bio=await fetchBio(id);
  sheetBody.innerHTML = bio ? playerProfileHTML(bio,reg) : `<div class="empty">No profile data for this player yet.</div>`;
}

/* ---- My Team hub ---- */
function openMyTeam(){
  if(!fav){
    openSheet("My Team");
    sheetBody.innerHTML=`<p style="color:var(--muted);font-size:14px;margin:0 0 12px">Pick your team for a dedicated view — next match, group position, results and squad.</p>
      <input class="search" id="mtInput" list="teamlist" placeholder="Type a team…" autocomplete="off">`;
    const inp=document.getElementById("mtInput"); inp.focus();
    inp.addEventListener("change", e=>{ const v=e.target.value.trim(); if(v){ setFav(v); openMyTeam(); } });
    return;
  }
  openSheet(fav);
  const up=FIXTURES.filter(m=>m.status!=="ft"&&(isFav(m.home)||isFav(m.away))).sort((a,b)=>TS(a.date)-TS(b.date));
  const res=FIXTURES.filter(m=>m.status==="ft"&&(isFav(m.home)||isFav(m.away))).sort((a,b)=>TS(b.date)-TS(a.date)).slice(0,4);
  let gpos="";
  for(const g of GROUPS){ const i=g.teams.findIndex(t=>isFav(t.team)); if(i>=0){ const t=g.teams[i]; gpos=`Group ${g.letter} · ${i+1}${["st","nd","rd","th"][Math.min(i,3)]} · ${t.Pts} pts (${t.W}-${t.D}-${t.L})`; break; } }
  const squad=PLAYERS.filter(p=>isFav(p.nat)).sort((a,b)=>b.goals-a.goals);
  let html=`<div style="display:flex;gap:13px;align-items:center"><span style="font-size:28px">${crest(fav)}</span>
    <div><div style="font-weight:800;font-size:19px">${fav}</div>${gpos?`<div style="font-size:12px;color:var(--muted);margin-top:2px">${gpos}</div>`:""}</div></div>
    <button class="btn" id="mtChange" style="margin:12px 0 4px">Change team</button>`;
  if(up[0]) html+=`<div class="h">Next match</div>${matchRow(up[0])}`;
  if(res.length) html+=`<div class="h" style="margin-top:16px">Recent results</div>${res.map(matchRow).join("")}`;
  if(squad.length){
    html+=`<div class="h" style="margin-top:16px">Squad seen (${squad.length})</div>`+squad.map(p=>{
      const tags=(p.goals?`<span class="tag g">${p.goals}⚽</span>`:"")+(p.rc?`<span class="tag r">${p.rc}🟥</span>`:"")+(p.yc?`<span class="tag y">${p.yc}🟨</span>`:"");
      return `<div class="lrow" data-pid="${p.id}"><span class="ph">${crest(p.nat)}</span><div><div class="nm3">${p.name}${tags}</div><div class="sub">${[p.pos,p.num?"#"+p.num:""].filter(Boolean).join(" · ")}</div></div></div>`;
    }).join("");
  } else html+=`<div class="empty" style="margin-top:16px">Squad appears once ${fav} have played.</div>`;
  sheetBody.innerHTML=html;
  document.getElementById("mtChange").onclick=()=>{ setFav(""); openMyTeam(); };
  sheetBody.querySelectorAll(".mrow[data-id]").forEach(r=> r.onclick=()=> openMatch(r.dataset.id));
  sheetBody.querySelectorAll(".lrow[data-pid]").forEach(r=> r.onclick=()=> openPlayer(r.dataset.pid));
}

/* ---- lazy enrichment: fetch per-match data only when its tab is opened ---- */
const SKEL = n => '<div class="skel"></div>'.repeat(n||3);
const mloaded = {};
async function ensure(t){
  if(t==="stats" && !mloaded.stats){
    mloaded.stats = true; document.getElementById("v-stats").innerHTML = SKEL(4);
    await Promise.all([loadScorers(), loadStats()]); renderIfActive("stats");
  } else if(t==="players" && !mloaded.players){
    mloaded.players = true; document.getElementById("v-players").innerHTML = SKEL(6);
    await loadPlayers(); renderIfActive("players");
    await enrichBios(()=> renderIfActive("players")); renderIfActive("players");
  }
}
function refreshLoaded(){   // re-pull only the heavy tabs already opened (finished matches come from cache)
  if(mloaded.stats)   Promise.all([loadScorers(), loadStats()]).then(()=> renderIfActive("stats"));
  if(mloaded.players) loadPlayers().then(()=> renderIfActive("players"));
}

/* ---- freshness / offline indicator ---- */
function setFresh(state){
  const el = document.getElementById("freshness");
  const stamp = LAST_UPDATED ? new Date(LAST_UPDATED).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"}) : "—";
  if(state==="cache")      { el.textContent = "Offline — showing saved data from " + stamp; el.classList.add("show"); }
  else if(state==="stale") { el.textContent = "Couldn't refresh — showing data from " + stamp; el.classList.add("show"); }
  else                     { el.classList.remove("show"); }   // ok / loading -> hidden
}

/* ---- init ---- */
async function init(){
  if(!FIXTURES.length && loadSnapshot()){ renderActive(); setFresh("cache"); }   // instant paint from last good data
  try{
    await loadData();
    setFresh("ok");
    renderActive();
    refreshLoaded();   // refresh any heavy tab already open (no-op on first load)
    ensure(tab);       // lazily load the tab being viewed
    maybeNotify();     // fire kick-off / goal / full-time alerts for the fav team (if enabled)
  }catch(e){
    if(FIXTURES.length){
      setFresh(FROM_CACHE ? "cache" : "stale");   // keep showing what we have
    } else {
      const msg=/429|rate/i.test(e.message)
        ? "The data provider is rate-limiting right now — the app will keep retrying automatically."
        : `Couldn't reach the live feed (${e.message}).`;
      document.getElementById("v-matches").innerHTML=`<div class="empty">${msg}<br>Tap ↻ to retry.</div>`;
    }
  }
}
// Live-aware auto-refresh: ~30s while a match is live, 3 min otherwise.
let refreshTimer = null;
function scheduleRefresh(){
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async ()=>{
    if(document.visibilityState==="visible"){ try{ await init(); }catch(_){ } }
    scheduleRefresh();
  }, nextRefreshMs());
}
// Honour a deep-link tab on first load (init's ensure() lazy-loads it once data arrives).
(function(){ const h = location.hash.slice(1); if(TABS.includes(h)){
  tab = h;
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
  document.getElementById("v-"+h).classList.add("active");
  document.querySelectorAll(".tabbar button").forEach(b=>b.classList.toggle("on", b.dataset.tab===h));
} })();
init().finally(scheduleRefresh);

if("serviceWorker" in navigator){ window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{})); }

/* Fail-safe error boundary: never leave a blank screen. */
(function(){
  var shown = false;
  function fatal(){
    if(shown || (typeof FIXTURES !== "undefined" && FIXTURES.length)) return;
    shown = true;
    var b = document.createElement("div");
    b.textContent = "⚠ Couldn't load live data — tap to reload";
    b.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#ff4d5e;color:#fff;padding:16px;text-align:center;font:600 14px -apple-system,sans-serif;cursor:pointer";
    b.onclick = function(){ location.reload(); };
    (document.body || document.documentElement).appendChild(b);
  }
  window.addEventListener("error", fatal);
  window.addEventListener("unhandledrejection", function(e){ if(e && e.preventDefault) e.preventDefault(); fatal(); });
})();
