/* =========================================================
   SPORTS SOUNDS PRO — full client-only runtime
   ========================================================= */

/* ---------- utilities ---------- */
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const pad = n => String(n).padStart(2,"0");
const rndColor = () => `hsl(${Math.random()*360|0},70%,50%)`;

/* ---------- persistent state ---------- */
const LS_KEY = "ssp_state_v4";
const letters = "ABCDEFGHIJ".split("");

const state = {letters:{}, activeLetter:"A", activeCategory:null};
function ensureScaffold(){
  letters.forEach(l=>{
    if(!state.letters[l]) state.letters[l] = {categories:{}};
  });
}
function load(){
  try{ Object.assign(state, JSON.parse(localStorage.getItem(LS_KEY)||"{}")); }
  catch{}
  ensureScaffold();
  if(!state.activeCategory) pickFirstCat();
}
function save(){ localStorage.setItem(LS_KEY, JSON.stringify(state)); }
function pickFirstCat(){
  const cats = Object.keys(state.letters[state.activeLetter].categories);
  state.activeCategory = cats[0] || null;
}

/* ---------- IndexedDB wrapper ---------- */
const idb = {
  db:null,
  async init(){
    if(this.db) return this.db;
    return new Promise((res,rej)=>{
      const open = indexedDB.open("ssp_files",1);
      open.onupgradeneeded = e => e.target.result.createObjectStore("files");
      open.onsuccess = e => {this.db=e.target.result; res(this.db);};
      open.onerror  = rej;
    });
  },
  async put(id,blob){
    const db = await this.init();
    return new Promise((res,rej)=>{
      const tx=db.transaction("files","readwrite").objectStore("files").put(blob,id);
      tx.onsuccess=_=>res(); tx.onerror=rej;
    });
  },
  async get(id){
    const db = await this.init();
    return new Promise((res,rej)=>{
      const tx=db.transaction("files").objectStore("files").get(id);
      tx.onsuccess=e=>res(e.target.result); tx.onerror=rej;
    });
  }
};

/* ---------- DOM builders ---------- */
function buildLetterTabs(){
  const box=$("#letter-tabs"); box.innerHTML="";
  letters.forEach(l=>{
    const b=document.createElement("button");
    if(l===state.activeLetter) b.classList.add("active");
    b.textContent=l;
    b.onclick=_=>{state.activeLetter=l; pickFirstCat(); save(); refresh();}
    box.appendChild(b);
  });
}
function buildCategories(){
  const ul=$("#cat-list"); ul.innerHTML="";
  const cats = state.letters[state.activeLetter].categories;
  Object.keys(cats).forEach(c=>{
    const li=document.createElement("li");
    li.textContent=c;
    if(c===state.activeCategory) li.classList.add("active");
    li.onclick=_=>{state.activeCategory=c; save(); refreshGrid();};
    ul.appendChild(li);
  });
}
function buildGrid(){
  const grid=$("#grid"); grid.innerHTML="";
  getSounds().forEach(s=>{
    const d=document.createElement("div");
    d.className="tile"; if(s.inactive) d.classList.add("inactive");
    d.style.background=s.color; d.textContent=s.title;
    d.onclick=_=>playSound(s);
    grid.appendChild(d);
  });
}

/* ---------- helpers ---------- */
function getSounds(){
  const cats = state.letters[state.activeLetter].categories;
  return cats[state.activeCategory] || [];
}
async function addFiles(files){
  if(!state.activeCategory){
    alert("Create/select a category first."); return;
  }
  const cats = state.letters[state.activeLetter].categories;
  if(!cats[state.activeCategory]) cats[state.activeCategory]=[];
  for(const f of files){
    const id=crypto.randomUUID();
    await idb.put(id,f);
    cats[state.activeCategory].push({
      id, title:f.name.replace(/\.[^/.]+$/,""),
      type:"file", src:"", color:rndColor()
    });
  }
  await hydrate(); save(); refreshGrid();
}

/* ---------- audio engine ---------- */
const cfg = {multi:false, loop:false, autoFade:false};
let current = null;          // currently “focused” <audio>
let playing = [];            // every active <audio>
let meterTimer = null;

function playSound(snd){
  if(!cfg.multi) stopAll();
  if(snd.type==="file"){
    const a=new Audio(snd.src);
    a.loop = cfg.loop;
    a.play();
    current=a; playing.push(a);

    a.onloadedmetadata=_=>$("#t-total").textContent=fmt(a.duration);
    a.ontimeupdate=_=>{
      $("#t-elap").textContent = fmt(a.currentTime);
      $("#t-left").textContent = fmt(a.duration-a.currentTime);
      $("#prog-bar").style.width = (a.currentTime/a.duration*100).toFixed(1)+"%";
    };
    a.onended=_=>{playing=playing.filter(x=>x!==a);};
    if(cfg.autoFade && playing.length>1) fadeOut(playing[0],2000);

    if(!meterTimer){
      meterTimer=setInterval(sampleMeters,120);
    }
  }else if(snd.type==="spotify"){
    spotify.playURI(snd.src);
  }else if(snd.type==="apple"){
    apple.playId(snd.src);
  }
}
function stopAll(){
  playing.forEach(a=>{a.pause();a.currentTime=0;});
  playing=[]; current=null;
  $("#prog-bar").style.width="0";
}
function fadeOut(a,dur){
  const step=dur/20; const delta=a.volume/20;
  const t=setInterval(_=>{
    a.volume=Math.max(0,a.volume-delta);
    if(a.volume===0){a.pause();clearInterval(t);}
  },step);
}
function sampleMeters(){
  if(!playing.length) {$("#meterL").style.width="0";$("#meterR").style.width="0";return;}
  $("#meterL").style.width = (Math.random()*100|0)+"%";
  $("#meterR").style.width = (Math.random()*100|0)+"%";
}
const fmt = s=>isFinite(s)? pad(s/60|0)+":"+pad(s%60|0):"--:--";

/* ---------- command handler ---------- */
function doCmd(cmd){
  const btn = $(`[data-cmd='${cmd}']`);
  const toggle = on => btn.style.background=on?"var(--accent-dark)":"" ;

  switch(cmd){
    case"cue": if(current) current.currentTime=0; break;
    case"multi": cfg.multi=!cfg.multi; toggle(cfg.multi); break;
    case"autoFade": cfg.autoFade=!cfg.autoFade; toggle(cfg.autoFade); break;
    case"loop": cfg.loop=!cfg.loop; toggle(cfg.loop); break;
    case"next": {
      const arr=getSounds(); if(!arr.length) break;
      const i=arr.indexOf(arr.find(x=>x.src===current?.src));
      playSound(arr[(i+1)%arr.length]); } break;
    case"find": {
      const q=prompt("Search title:"); if(!q) break;
      const match=findSound(q); match?playSound(match):alert("Not found"); } break;
    case"pause": if(current) current.paused?current.play():current.pause(); break;
    case"rapid": if(current){current.playbackRate=2;setTimeout(()=>current.playbackRate=1,3000);} break;
    case"shuffle": shuffle(); break;
    case"talk": alert("Talk mic ducking not implemented (browser input perms)."); break;
    case"playlist": alert("Playlist window is TODO."); break;
    case"resetPage": {getSounds().forEach(t=>t.inactive=false); save(); refreshGrid();} break;
    case"stop": stopAll(); break;
    case"eq": alert("EQ / Reverb / Tempo UI is beyond this demo scope."); break;
  }
}
function findSound(q){
  for(const l of letters){
    for(const arr of Object.values(state.letters[l].categories)){
      const hit=arr.find(s=>s.title.toLowerCase().includes(q.toLowerCase()));
      if(hit) return hit;
    }
  }
}
function shuffle(){
  const arr=getSounds();
  for(let i=arr.length-1;i>0;i--){
    const j=Math.random()*(i+1)|0; [arr[i],arr[j]]=[arr[j],arr[i]];
  }
  save(); refreshGrid();
}

/* ---------- streaming skeletons ---------- */
const spotify={
  token:null, device:null, ready:false,
  async connect(){
    const t=prompt("Paste user OAuth token (Premium account, streaming scope):");
    if(!t) return;
    this.token=t; await this.init();
    alert("Spotify connected!");
  },
  init(){
    if(this.ready) return Promise.resolve();
    return new Promise(res=>{
      window.onSpotifyWebPlaybackSDKReady = () => {
        const p=new Spotify.Player({
          name:"SSP-Web",
          getOAuthToken:cb=>cb(this.token),
          volume:1
        });
        p.addListener('ready',d=>{this.device=d.device_id;this.ready=true;res();});
        p.connect();
      };
    });
  },
  playURI(uri){
    if(!this.ready) return alert("Connect Spotify first");
    fetch(`https://api.spotify.com/v1/me/player/play?device_id=${this.device}`,{
      method:"PUT",
      headers:{Authorization:`Bearer ${this.token}`,"Content-Type":"application/json"},
      body:JSON.stringify({uris:[uri]})
    });
  }
};
const apple={
  music:null,
  async connect(){alert("Apple MusicKit needs developer & user tokens (see docs).");},
  playId(id){alert("Apple playback not wired in demo.");}
};

/* ---------- hydration ---------- */
async function hydrate(){
  for(const l of letters){
    for(const arr of Object.values(state.letters[l].categories)){
      for(const s of arr){
        if(s.type==="file" && !s.src){
          const blob = await idb.get(s.id);
          if(blob) s.src = URL.createObjectURL(blob);
          else s.inactive=true;
        }
      }
    }
  }
}

/* ---------- bindings ---------- */
function bind(){
  $("#btn-add-cat").onclick=_=>{
    const name=prompt("Category name:"); if(!name) return;
    state.letters[state.activeLetter].categories[name]=[];
    state.activeCategory=name; save(); refresh();
  };
  $("#controls").onclick=e=>{if(e.target.dataset.cmd) doCmd(e.target.dataset.cmd);};
  $("#btn-files").onclick=_=>$("#file-input").click();
  $("#file-input").onchange=e=>addFiles(e.target.files);
  $("#btn-spotify").onclick=_=>spotify.connect();
  $("#btn-apple").onclick=_=>apple.connect();
}

/* ---------- init ---------- */
async function init(){
  load(); await hydrate(); bind(); refresh();
  /* Ask for persistent storage once */
  if('storage' in navigator && 'persist' in navigator.storage){
    navigator.storage.persist();
  }
}
function refresh(){
  buildLetterTabs(); buildCategories(); buildGrid();
}
function refreshGrid(){ buildGrid(); }

window.addEventListener("DOMContentLoaded",init);
