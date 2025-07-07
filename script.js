/* ================================================================
   Sports Sounds Pro — Web v5 (ES-module, July 2025)
   ================================================================ */
import JSZip from "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm";

/* ---- tiny helpers ---- */
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2,"0");
const rnd = () => `hsl(${Math.random()*360|0},70%,50%)`;
const fmt = s => isFinite(s)?`${pad(s/60|0)}:${pad(s%60|0)}`:"--:--";

/* ---- persistent state ---- */
const LS = "ssp_state_v5";
const letters = [..."ABCDEFGHIJ"];
const state = {letters:{}, activeLetter:"A", activeCategory:null};

function scaffold(){
  letters.forEach(l=>{
    state.letters[l] ??= {categories:{}};
  });
}
function load(){
  Object.assign(state, JSON.parse(localStorage.getItem(LS)||"{}"));
  scaffold();
  ensureCat();
}
function save(){ localStorage.setItem(LS, JSON.stringify(state)); }
function ensureCat(){
  const cats=Object.keys(state.letters[state.activeLetter].categories);
  state.activeCategory ??= cats[0]||null;
}

/* ---------- IndexedDB ---------- */
const idb = {
  db:null,
  open(){
    return new Promise((res,rej)=>{
      const req=indexedDB.open("ssp_files",1);
      req.onupgradeneeded=e=>e.target.result.createObjectStore("files");
      req.onsuccess=e=>{this.db=e.target.result;res(this.db);};
      req.onerror=rej;
    });
  },
  async put(id,blob){
    const db=this.db||await this.open();
    return new Promise((res,rej)=>{
      const tx=db.transaction("files","readwrite").objectStore("files").put(blob,id);
      tx.onsuccess=res; tx.onerror=rej;
    });
  },
  async get(id){
    const db=this.db||await this.open();
    return new Promise((res,rej)=>{
      const tx=db.transaction("files").objectStore("files").get(id);
      tx.onsuccess=e=>res(e.target.result); tx.onerror=rej;
    });
  },
  async *all(){
    const db=this.db||await this.open();
    const store=db.transaction("files").objectStore("files").openCursor();
    return new Promise((res,rej)=>{
      const out=[];
      store.onsuccess=e=>{
        const c=e.target.result;
        if(c){out.push([c.key,c.value]);c.continue();}
        else res(out);
      };
      store.onerror=rej;
    });
  }
};

/* ---------- UI builders ---------- */
function buildLetters(){
  const box=$("#letter-tabs"); box.innerHTML="";
  letters.forEach(l=>{
    const b=document.createElement("button");
    b.textContent=l;
    if(l===state.activeLetter) b.classList.add("active");
    b.onclick=_=>{state.activeLetter=l;ensureCat();save();refresh();};
    box.appendChild(b);
  });
}
function buildCats(){
  const ul=$("#cat-list"); ul.innerHTML="";
  const cats=state.letters[state.activeLetter].categories;
  for(const c of Object.keys(cats)){
    const li=document.createElement("li"); li.textContent=c;
    if(c===state.activeCategory) li.classList.add("active");
    li.onclick=_=>{state.activeCategory=c;save();refreshGrid();};
    ul.appendChild(li);
  }
}
function buildGrid(){
  const grid=$("#grid"); grid.innerHTML="";
  for(const s of getSounds()){
    const d=document.createElement("div");
    d.className="tile"; if(s.inactive) d.classList.add("inactive");
    d.style.background=s.color; d.textContent=s.title;
    d.onclick=_=>play(s);
    grid.appendChild(d);
  }
}

/* ---------- sounds helpers ---------- */
function getSounds(){
  return state.letters[state.activeLetter].categories[state.activeCategory]||[];
}
async function addFiles(files){
  if(!state.activeCategory){alert("Create/select a category first.");return;}
  const list=getSounds();
  for(const f of files){
    const id=crypto.randomUUID();
    await idb.put(id,f);
    list.push({id,title:f.name.replace(/\.[^/.]+$/,""),type:"file",src:"",color:rnd()});
  }
  await hydrate(); save(); refreshGrid();
}

/* ---------- hydration ---------- */
async function hydrate(){
  const tasks=[];
  for(const l of letters){
    for(const arr of Object.values(state.letters[l].categories)){
      for(const s of arr){
        if(s.type==="file" && !s.src){
          tasks.push(idb.get(s.id).then(b=>{
            if(b)s.src=URL.createObjectURL(b); else s.inactive=true;
          }));
        }
      }
    }
  }
  await Promise.all(tasks);
}

/* ---------- audio engine ---------- */
const cfg={multi:false,loop:false,autoFade:false};
let current=null, playing=[], analyser=null, meterTimer=null;

function play(s){
  if(!cfg.multi) stopAll();
  if(s.type==="file"){
    const a=new Audio(s.src); a.loop=cfg.loop; a.play();
    a.onloadedmetadata=_=>$("#t-total").textContent=fmt(a.duration);
    a.ontimeupdate=_=>{
      $("#t-elap").textContent=fmt(a.currentTime);
      $("#t-left").textContent=fmt(a.duration-a.currentTime);
      $("#prog-bar").style.right=(100-a.currentTime/a.duration*100)+"%";
    };
    a.onended=_=>{playing=playing.filter(x=>x!==a);if(!playing.length) clearInterval(meterTimer);};
    current=a; playing.push(a);
    attachMeters(a);
    if(cfg.autoFade && playing.length>1) fadeOut(playing[0],1500);
  }else if(s.type==="spotify"){spotify.play(s.src);}
  else if(s.type==="apple"){apple.play(s.src);}
}
function stopAll(){
  playing.forEach(a=>{a.pause();a.currentTime=0;}); playing=[]; current=null;
  clearInterval(meterTimer); $("#prog-bar").style.right="100%";
  drawMeter(0,0);
}
function fadeOut(a,dur){
  const step=dur/20, dec=a.volume/20;
  const t=setInterval(()=>{a.volume=Math.max(0,a.volume-dec);if(a.volume===0){a.pause();clearInterval(t);}},step);
}
function attachMeters(a){
  if(!analyser){
    const ctx=new (window.AudioContext||window.webkitAudioContext)();
    analyser=ctx.createAnalyser(); analyser.fftSize=256;
  }
  const src=analyser.context.createMediaElementSource(a);
  try{src.connect(analyser).connect(analyser.context.destination);}catch{}
  if(!meterTimer){
    meterTimer=setInterval(()=>{
      const data=new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteTimeDomainData(data);
      const rms=Math.sqrt(data.reduce((s,v)=>s+(v-128)**2,0)/data.length)/128;
      drawMeter(rms,rms);
    },80);
  }
}
const cL=$("#meterL"), cR=$("#meterR"), ctxL=cL.getContext("2d"), ctxR=cR.getContext("2d");
function drawMeter(l,r){
  ctxL.clearRect(0,0,60,10); ctxR.clearRect(0,0,60,10);
  ctxL.fillStyle="#0f0"; ctxR.fillStyle="#0f0";
  ctxL.fillRect(0,0,l*60,10); ctxR.fillRect(0,0,r*60,10);
}

/* ---------- commands ---------- */
function cmd(c){
  const toggle=flag=>$(`[data-cmd='${c}']`).classList.toggle("accent-d",flag);
  switch(c){
    case"cue": if(current)current.currentTime=0; break;
    case"multi": cfg.multi=!cfg.multi; toggle(cfg.multi); break;
    case"loop": cfg.loop=!cfg.loop; toggle(cfg.loop); break;
    case"autoFade": cfg.autoFade=!cfg.autoFade; toggle(cfg.autoFade); break;
    case"pause": current&&(current.paused?current.play():current.pause()); break;
    case"rapid": current&&(current.playbackRate=2,setTimeout(()=>current.playbackRate=1,3000)); break;
    case"stop": stopAll(); break;
    case"next":{
      const arr=getSounds(); if(!arr.length)break;
      const idx=arr.indexOf(arr.find(x=>x.src===current?.src));
      play(arr[(idx+1)%arr.length]); } break;
    case"shuffle": {const arr=getSounds();for(let i=arr.length-1;i;i--){const j=Math.random()*(i+1)|0;[arr[i],arr[j]]=[arr[j],arr[i]];}save();refreshGrid();}break;
    case"find": {
      const q=prompt("Search title:"); if(!q)break;
      const hit=find(q); hit?play(hit):alert("Not found");}break;
    case"resetPage": getSounds().forEach(s=>s.inactive=false),save(),refreshGrid(); break;
    default:alert("Not yet implemented");
  }
}
function find(q){
  for(const l of letters){
    for(const arr of Object.values(state.letters[l].categories)){
      const s=arr.find(x=>x.title.toLowerCase().includes(q.toLowerCase()));
      if(s)return s;
    }
  }
}

/* ---------- drag-&-drop ---------- */
function bindDrag(){
  ["dragover","dragenter"].forEach(ev=>document.addEventListener(ev,e=>{
    e.preventDefault(); $("#app").classList.add("drag-hover");
  }));
  ["dragleave","drop"].forEach(ev=>document.addEventListener(ev,e=>{
    e.preventDefault(); $("#app").classList.remove("drag-hover");
  }));
  document.addEventListener("drop",e=>{
    if(e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });
}

/* ---------- export / import ---------- */
async function exportLib(){
  const zip=new JSZip();
  zip.file("library.json",JSON.stringify(state));
  for(const [id,blob] of await idb.all()){
    zip.file(`audio/${id}`,blob);
  }
  const out=await zip.generateAsync({type:"blob"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(out); a.download="ssp-library.zip"; a.click();
}
async function importLib(file){
  const zip=await JSZip.loadAsync(file);
  const json=await zip.file("library.json").async("string");
  Object.assign(state,JSON.parse(json)); scaffold(); save();
  const audioFolder=zip.folder("audio");
  for(const fname of Object.keys(audioFolder.files)){
    const blob=await audioFolder.file(fname).async("blob");
    await idb.put(fname.split("/").pop(),blob);
  }
  await hydrate(); refresh(); alert("Import complete");
}

/* ---------- Spotify helper (PKCE) ---------- */
const spotify={
  device:null,player:null,
  async connect(){
    const token=sessionStorage.getItem("spotify_token")||await this.auth();
    if(!token)return;
    await new Promise(res=>{
      window.onSpotifyWebPlaybackSDKReady=()=>{
        const p=new Spotify.Player({name:"SSP-Web",getOAuthToken:cb=>cb(token),volume:1});
        p.addListener("ready",d=>{this.device=d.device_id;res();});
        p.connect(); this.player=p;
      };
    });
    alert("Spotify ready! Add tiles with URI e.g. spotify:track:ID");
  },
  async auth(){
    const client=prompt("Your Spotify app client-ID:");
    if(!client)return null;
    const verifier=crypto.randomUUID().replace(/-/g,"");
    const challenge=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier))))).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
    const params=new URLSearchParams({
      client_id:client,response_type:"code",redirect_uri:location.href,
      scope:"streaming user-read-playback-state user-modify-playback-state",
      code_challenge_method:"S256",code_challenge:challenge
    });
    location.href=`https://accounts.spotify.com/authorize?${params}`;
    sessionStorage.setItem("pkce_vf",verifier);
    return null;
  },
  async completePKCE(){
    if(!location.search.includes("code="))return;
    const code=new URLSearchParams(location.search).get("code");
    const verifier=sessionStorage.getItem("pkce_vf");
    const client=prompt("Spotify client-ID again (finish auth):"); if(!client)return;
    const body=new URLSearchParams({
      client_id:client,grant_type:"authorization_code",code,redirect_uri:location.origin+location.pathname,code_verifier:verifier
    });
    const r=await fetch("https://accounts.spotify.com/api/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
    const j=await r.json();
    if(j.access_token){sessionStorage.setItem("spotify_token",j.access_token);history.replaceState({},document.title,location.pathname);}
  },
  play(uri){
    if(!this.device)return alert("Connect Spotify first");
    fetch(`https://api.spotify.com/v1/me/player/play?device_id=${this.device}`,{
      method:"PUT",
      headers:{Authorization:`Bearer ${sessionStorage.getItem("spotify_token")}`,"Content-Type":"application/json"},
      body:JSON.stringify({uris:[uri]})
    });
  }
};

/* ---------- Apple stub ---------- */
const apple={
  async connect(){alert("Insert developer & user token code in script.js");},
  play(){alert("Apple Music playback not wired");}
};

/* ---------- bindings ---------- */
function bind(){
  $("#btn-add-cat").onclick=_=>{
    const n=prompt("Category name:"); if(!n)return;
    state.letters[state.activeLetter].categories[n]=[]; state.activeCategory=n; save(); refresh();
  };
  $("#controls").addEventListener("click",e=>e.target.dataset.cmd&&cmd(e.target.dataset.cmd));
  $("#btn-files").onclick=_=>$("#file-input").click();
  $("#file-input").onchange=e=>addFiles(e.target.files);
  bindDrag();

  $("#btn-export").onclick=exportLib;
  $("#btn-import").onclick=_=>$("#import-input").click();
  $("#import-input").onchange=e=>importLib(e.target.files[0]);

  $("#btn-spotify").onclick=_=>spotify.connect();
  $("#btn-apple").onclick=_=>apple.connect();
}

/* ---------- init ---------- */
(async function init(){
  await spotify.completePKCE();        // finishes OAuth redirect (if any)
  load();
  await hydrate();
  bind();
  $("#loader").remove(); $("#app").hidden=false;
  refresh();
  navigator.storage?.persist?.();      // ask for persistent quota once
})();

function refresh(){buildLetters();buildCats();buildGrid();}
function refreshGrid(){buildGrid();}
