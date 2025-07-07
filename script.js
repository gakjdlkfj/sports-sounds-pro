/* =====================================================
   SPORTS SOUNDS PRO   — WEB EDITION
   ===================================================== */

/* ---------- helpers ---------- */
const $ = s=>document.querySelector(s);
const randColor = ()=>`hsl(${Math.random()*360|0},70%,50%)`;
const pad = n=>String(n).padStart(2,"0");

/* ---------- globals ---------- */
const LS_KEY = "ssp_state_v3";
const letters = "ABCDEFGHIJ".split("");
let currentAudio = null;          // active primary audio
let playing = [];                 // array of all current <audio> (multi-play mode)
const cfg = {multi:false,autoFade:false,loop:false};

/* ---------- state (persisted) ---------- */
const state = {letters:{}};
function ensureStructure(){
  letters.forEach(l=>{
    if(!state.letters[l]) state.letters[l]={categories:{}};
  });
}
function load(){
  try{ Object.assign(state, JSON.parse(localStorage.getItem(LS_KEY)||"{}")); }
  catch{} ensureStructure();
  state.activeLetter ??= "A";
  const cats = Object.keys(state.letters[state.activeLetter].categories);
  state.activeCategory ??= cats[0]||null;
}
function save(){ localStorage.setItem(LS_KEY, JSON.stringify(state)); }

/* ---------- IndexedDB (for file blobs) ---------- */
const idb = {
  db:null,
  async init(){
    if(this.db) return this.db;
    return new Promise((res,rej)=>{
      const open=indexedDB.open("ssp_files",1);
      open.onupgradeneeded=e=>e.target.result.createObjectStore("files");
      open.onsuccess=e=>{this.db=e.target.result;res(this.db);};
      open.onerror=e=>rej(e);
    });
  },
  async put(id,blob){
    const db=await this.init();
    return new Promise((res,rej)=>{
      const t=db.transaction("files","readwrite").objectStore("files").put(blob,id);
      t.onsuccess=_=>res(); t.onerror=e=>rej(e);
    });
  },
  async get(id){
    const db=await this.init();
    return new Promise((res,rej)=>{
      const t=db.transaction("files").objectStore("files").get(id);
      t.onsuccess=e=>res(e.target.result); t.onerror=e=>rej(e);
    });
  }
};

/* ---------- UI builders ---------- */
function buildLetterTabs(){
  const box=$("#letter-tabs"); box.innerHTML="";
  letters.forEach(l=>{
    const b=document.createElement("button"); b.textContent=l;
    if(l===state.activeLetter) b.classList.add("active");
    b.onclick=()=>{state.activeLetter=l;selectFirstCategory();save();refresh();}
    box.appendChild(b);
  });
}
function buildCategoryList(){
  const ul=$("#category-list"); ul.innerHTML="";
  const catObj=state.letters[state.activeLetter].categories;
  Object.keys(catObj).forEach(cat=>{
    const li=document.createElement("li"); li.textContent=cat;
    if(cat===state.activeCategory) li.classList.add("active");
    li.onclick=()=>{state.activeCategory=cat;save();refreshTiles();};
    ul.appendChild(li);
  });
}
function buildTiles(){
  const grid=$("#grid"); grid.innerHTML="";
  getCurrentSounds().forEach(s=>{
    const d=document.createElement("div");
    d.className="tile"; d.style.background=s.color; d.textContent=s.title;
    if(s.inactive) d.classList.add("inactive");
    d.onclick=()=>playSound(s);
    grid.appendChild(d);
  });
}

/* ---------- helpers ---------- */
function selectFirstCategory(){
  const cats=Object.keys(state.letters[state.activeLetter].categories);
  state.activeCategory = cats[0]||null;
}
function getCurrentSounds(){
  const catObj=state.letters[state.activeLetter].categories;
  return catObj[state.activeCategory]||[];
}
async function addFiles(files){
  const catObj=state.letters[state.activeLetter].categories;
  if(!state.activeCategory){
    alert("Create or select a category first"); return;
  }
  if(!catObj[state.activeCategory]) catObj[state.activeCategory]=[];
  for(const f of files){
    const id=crypto.randomUUID();
    await idb.put(id,f);
    catObj[state.activeCategory].push({
      id,title:f.name.replace(/\.[^/.]+$/,""),
      src:"",type:"file",color:randColor()
    });
  }
  await hydrate(); save(); refreshTiles();
}

/* ---------- audio engine ---------- */
function stopAll(){
  playing.forEach(a=>{a.pause();a.currentTime=0;});
  playing=[]; currentAudio=null;
  $("#progress-bar").style.width="0";
}
function playSound(sound){
  if(!cfg.multi) stopAll();
  if(sound.type==="file"){
    const a=new Audio(sound.src);
    a.loop=cfg.loop;
    a.onloadedmetadata=_=>$("#time-total").textContent=fmtTime(a.duration);
    a.ontimeupdate=_=>{
      $("#time-elapsed").textContent=fmtTime(a.currentTime);
      const left=a.duration-a.currentTime;
      $("#time-left").textContent=fmtTime(left);
      $("#progress-bar").style.width=(a.currentTime/a.duration*100).toFixed(1)+"%";
    };
    a.onended=_=>{playing=playing.filter(p=>p!==a);if(cfg.autoFade) fadeOut(a,2000);};
    a.play();
    if(cfg.autoFade && currentAudio) fadeOut(currentAudio,1500);
    currentAudio=a; playing.push(a);
  } else if(sound.type==="spotify") {
    spotify.playURI(sound.src);
  } else if(sound.type==="apple") {
    apple.playId(sound.src);
  }
}
function fadeOut(a,dur){
  const steps=20, stepDur=dur/steps, delta=a.volume/steps;
  const t=setInterval(()=>{
    a.volume=Math.max(0,a.volume-delta);
    if(a.volume===0){a.pause();clearInterval(t);}
  },stepDur);
}
function fmtTime(sec){
  if(!isFinite(sec)) return "--:--";
  return pad(sec/60|0)+":"+pad(sec%60|0);
}

/* ---------- streaming skeletons ---------- */
const spotify={
  token:null,device:null,ready:false,
  async connect(){
    const t=prompt("Spotify *user* OAuth token (streaming scope):");
    if(!t) return;
    this.token=t; await this.init(); alert("Spotify connected");
  },
  init(){
    if(this.ready) return Promise.resolve();
    return new Promise(res=>{
      window.onSpotifyWebPlaybackSDKReady=()=>{
        const p=new Spotify.Player({name:"SSP-Web",getOAuthToken:cb=>cb(this.token)});
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
  async connect(){alert("Apple Music requires developer/user tokens – see code comments.");},
  playId(id){alert("Apple Music playback not wired in this demo.");}
};

/* ---------- command dispatcher ---------- */
function handleCmd(cmd){
  switch(cmd){
    case"cue": if(currentAudio){currentAudio.currentTime=0;} break;
    case"multi": cfg.multi=!cfg.multi; flash(cmd,cfg.multi); break;
    case"autoFade": cfg.autoFade=!cfg.autoFade; flash(cmd,cfg.autoFade); break;
    case"loop": cfg.loop=!cfg.loop; flash(cmd,cfg.loop); break;
    case"next": {const arr=getCurrentSounds();if(!arr.length) return;
      const idx=arr.indexOf(currentPlayingMeta()); playSound(arr[(idx+1)%arr.length]);} break;
    case"find": {const q=prompt("Search title:"); if(!q) return;
      const s=findSound(q); if(s) playSound(s); else alert("Not found");} break;
    case"pause": {if(!currentAudio) return; currentAudio.paused?currentAudio.play():currentAudio.pause();} break;
    case"rapid": {if(currentAudio) currentAudio.playbackRate=2; setTimeout(()=>{if(currentAudio)currentAudio.playbackRate=1;},3000);} break;
    case"shuffle": shuffleCurrent(); break;
    case"talk": alert("TALK mic ducking not implemented in web demo."); break;
    case"playlist": alert("Playlist window coming soon."); break;
    case"resetPage": resetCurrentPage(); break;
    case"stop": stopAll(); break;
    case"eq": alert("EQ / reverb / tempo UI is beyond this demo scope."); break;
  }
}
function flash(cmd,on){
  const btn=$(`[data-cmd='${cmd}']`);
  btn.style.background=on? "var(--accent-dark)": "";
}
function currentPlayingMeta(){
  const arr=getCurrentSounds();
  return arr.find(s=>currentAudio && s.src===currentAudio.src) || null;
}
function findSound(q){
  for(const l of letters){
    for(const arr of Object.values(state.letters[l].categories)){
      const s=arr.find(x=>x.title.toLowerCase().includes(q.toLowerCase()));
      if(s) return s;
    }
  }
  return null;
}
function shuffleCurrent(){
  const arr=getCurrentSounds();
  for(let i=arr.length-1;i>0;i--){
    const j=Math.random()* (i+1)|0; [arr[i],arr[j]]=[arr[j],arr[i]];
  }
  save(); refreshTiles();
}
function resetCurrentPage(){
  const arr=getCurrentSounds();
  arr.forEach(s=>{s.inactive=false;}); save(); refreshTiles();
}

/* ---------- hydration (restore blobs) ---------- */
async function hydrate(){
  for(const l of letters){
    for(const sounds of Object.values(state.letters[l].categories)){
      for(const s of sounds){
        if(s.type==="file" && !s.src){
          const blob=await idb.get(s.id);
          if(blob) s.src=URL.createObjectURL(blob);
          else s.inactive=true;
        }
      }
    }
  }
}

/* ---------- bindings ---------- */
function bind(){
  $("#btn-add-category").onclick=_=>{
    const n=prompt("Category name:"); if(!n) return;
    state.letters[state.activeLetter].categories[n]={};
    state.activeCategory=n; save(); refresh();
  };
  $("#btn-add-files").onclick=_=>$("#file-input").click();
  $("#file-input").onchange=e=>addFiles(e.target.files);

  $("#btn-spotify").onclick=_=>spotify.connect();
  $("#btn-apple").onclick=_=>apple.connect();

  $("#controls").onclick=e=>{
    const c=e.target.dataset.cmd; if(c) handleCmd(c);
  };
}

/* ---------- init ---------- */
async function init(){
  load(); bind(); await hydrate(); refresh();
}
function refresh(){
  buildLetterTabs(); buildCategoryList(); buildTiles();
}
function refreshTiles(){ buildTiles(); }

window.addEventListener("DOMContentLoaded",init);
