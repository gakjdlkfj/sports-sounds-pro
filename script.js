/* ============================================================
   Sports Sounds Pro — Web  (v7-fix1, July 2025)
   ============================================================ */
import JSZip from "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm";

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2,"0");
const rnd = () => `hsl(${Math.random()*360|0},70%,50%)`;
const fmt = s => isFinite(s)?`${pad(s/60|0)}:${pad(s%60|0)}`:"--:--";

/* ---------- state ---------- */
const LS = "ssp_state_v7";
const letters=[..."ABCDEFGHIJ"];
const state={letters:{},activeLetter:"A",activeCategory:null};

function scaffold(){letters.forEach(l=>state.letters[l]??={categories:{}});}
function load(){Object.assign(state,JSON.parse(localStorage.getItem(LS)||"{}"));scaffold();ensureCat();}
function save(){localStorage.setItem(LS,JSON.stringify(state));}
function ensureCat(){const cats=Object.keys(state.letters[state.activeLetter].categories);state.activeCategory ??= cats[0]||null;}

/* ---------- IndexedDB ---------- */
const idb={db:null,
  open(){return new Promise((res,rej)=>{const r=indexedDB.open("ssp_files",1);
    r.onupgradeneeded=e=>e.target.result.createObjectStore("files");
    r.onsuccess=e=>{this.db=e.target.result;res();};r.onerror=rej;});},
  async put(id,blob){await this.open();return new Promise((res,rej)=>{
    const tx=this.db.transaction("files","readwrite").objectStore("files").put(blob,id);
    tx.onsuccess=res;tx.onerror=rej;});},
  async get(id){await this.open();return new Promise((res,rej)=>{
    const tx=this.db.transaction("files").objectStore("files").get(id);
    tx.onsuccess=e=>res(e.target.result);tx.onerror=rej;});}}
;

/* ---------- UI builders ---------- */
function buildLetters(){
  const box=$("#letter-tabs");box.innerHTML="";
  letters.forEach(l=>{
    const b=document.createElement("button");b.textContent=l;
    if(l===state.activeLetter)b.classList.add("active");
    b.onclick=_=>{state.activeLetter=l;ensureCat();save();refresh();};
    box.appendChild(b);
  });
}
function buildCats(){
  const ul=$("#cat-list");ul.innerHTML="";
  const cats=state.letters[state.activeLetter].categories;
  for(const c in cats){
    const li=document.createElement("li");li.textContent=c;
    if(c===state.activeCategory)li.classList.add("active");
    li.onclick=_=>{state.activeCategory=c;save();refreshGrid();};
    ul.appendChild(li);
  }
}
function buildGrid(){
  const g=$("#grid");g.innerHTML="";
  for(const t of getSounds()){
    const d=document.createElement("div");
    d.className="tile"; if(t.inactive)d.classList.add("inactive");
    if(t.type==="spotify")d.classList.add("spotify");
    d.style.background=t.color ?? rnd();
    d.textContent=t.title;
    d.onclick=_=>play(t);

    const gear=document.createElement("span");
    gear.className="gear"; gear.innerHTML="&#9881;";
    gear.onclick=e=>{e.stopPropagation();editTile(t);};
    d.appendChild(gear);

    g.appendChild(d);
  }
}

/* ---------- tile editor ---------- */
function editTile(t){
  t.title  = prompt("Title:",  t.title)            ?? t.title;
  t.start  = parseFloat(prompt("Start time (seconds):", t.start??0)) || 0;
  t.volume = parseFloat(prompt("Volume 0–1:",        t.volume??1));  if(isNaN(t.volume)||t.volume<0||t.volume>1)t.volume=1;
  save(); refreshGrid();
}

/* ---------- sounds ---------- */
function getSounds(){return state.letters[state.activeLetter].categories[state.activeCategory]||[];}
async function addFiles(files){
  if(!state.activeCategory){alert("Create/select a category first");return;}
  const list=getSounds();
  for(const f of files){
    const id=crypto.randomUUID();
    list.push({id,title:f.name.replace(/\.[^/.]+$/,""),type:"file",src:URL.createObjectURL(f),color:rnd(),start:0,volume:1});
    idb.put(id,f);       /* store asynchronously */
  }
  save(); refreshGrid(); await lockStorage();
}

/* ---------- audio engine ---------- */
const cfg={multi:false,loop:false,autoFade:false};
let current=null,playing=[],analyser=null,meterT=null;

function play(meta){
  if(!cfg.multi) stopAll();

  if(meta.type==="file"){
    const a=new Audio(meta.src);
    a.loop=cfg.loop; a.volume=meta.volume??1;
    a.onloadedmetadata=_=>{a.currentTime=meta.start??0; $("#t-total").textContent=fmt(a.duration);}
    a.ontimeupdate=_=>{
      $("#t-elap").textContent=fmt(a.currentTime);
      $("#t-left").textContent=fmt(a.duration-a.currentTime);
      $("#prog-bar").style.right=(100-a.currentTime/a.duration*100)+"%";
    };
    a.onended=_=>{playing=playing.filter(x=>x!==a); if(!playing.length){clearInterval(meterT);drawMeter(0,0);} }
    a.play(); current=a; playing.push(a); attachMeters(a);
    if(cfg.autoFade&&playing.length>1) fadeOut(playing[0],1500);

  }else if(meta.type==="spotify"){spotify.play(meta);}
  else apple.play(meta);
}

/* meters + helpers */
function attachMeters(a){
  if(!analyser){
    const ctx=new (window.AudioContext||window.webkitAudioContext)();
    analyser=ctx.createAnalyser(); analyser.fftSize=256;
  }
  try{const src=analyser.context.createMediaElementSource(a); src.connect(analyser).connect(analyser.context.destination);}catch{}
  if(!meterT){meterT=setInterval(()=>{const d=new Uint8Array(analyser.frequencyBinCount);analyser.getByteTimeDomainData(d);const rms=Math.sqrt(d.reduce((s,v)=>s+(v-128)**2,0)/d.length)/128;drawMeter(rms,rms);},90);}
}
function drawMeter(l,r){
  const L=$("#meterL").getContext("2d"),R=$("#meterR").getContext("2d");
  L.clearRect(0,0,60,10);R.clearRect(0,0,60,10);L.fillStyle=R.fillStyle="#0f0";
  L.fillRect(0,0,l*60,10);R.fillRect(0,0,r*60,10);
}
function fadeOut(a,d){const dec=a.volume/20,step=d/20;const t=setInterval(()=>{a.volume=Math.max(0,a.volume-dec);if(a.volume===0){a.pause();clearInterval(t);}},step);}
function stopAll(){playing.forEach(a=>{a.pause();a.currentTime=0;});playing=[];current=null;clearInterval(meterT);drawMeter(0,0);$("#prog-bar").style.right="100%";}

/* ---------- command ribbon ---------- */
function cmd(c){
  const flip=f=>$(`[data-cmd='${c}']`).classList.toggle("accent-d",f);
  switch(c){
    case"cue": current&&(current.currentTime=(getSounds().find(x=>x.src===current?.src)?.start||0)); break;
    case"multi": cfg.multi=!cfg.multi; flip(cfg.multi); break;
    case"loop":  cfg.loop=!cfg.loop;   flip(cfg.loop);  break;
    case"autoFade": cfg.autoFade=!cfg.autoFade; flip(cfg.autoFade); break;
    case"pause": current&&(current.paused?current.play():current.pause()); break;
    case"rapid": current&&(current.playbackRate=2,setTimeout(()=>current.playbackRate=1,3000)); break;
    case"stop": stopAll(); break;
    case"next":{
      const arr=getSounds(); if(!arr.length) break;
      const i=arr.indexOf(arr.find(x=>x.src===current?.src));
      play(arr[(i+1)%arr.length]); }break;
    case"shuffle":{
      const arr=getSounds();
      for(let i=arr.length-1;i;i--){const j=Math.random()*(i+1)|0;[arr[i],arr[j]]=[arr[j],arr[i]];}
      save(); refreshGrid(); }break;
    case"find":{
      const q=prompt("Search title:"); if(!q) break;
      const low=q.toLowerCase();
      for(const L of letters)for(const arr of Object.values(state.letters[L].categories)){
        const hit=arr.find(s=>s.title.toLowerCase().includes(low)); if(hit){play(hit);return;}
      } alert("Not found"); }break;
    case"resetPage": getSounds().forEach(s=>s.inactive=false); save(); refreshGrid(); break;
    default:alert("Not yet implemented");
  }
}

/* ---------- drag-n-drop ---------- */
function bindDrag(){
  ["dragover","dragenter"].forEach(ev=>document.addEventListener(ev,e=>{e.preventDefault();$("#app").classList.add("drag-hover");}));
  ["dragleave","drop"].forEach(ev=>document.addEventListener(ev,e=>{e.preventDefault();$("#app").classList.remove("drag-hover");}));
  document.addEventListener("drop",e=>e.dataTransfer.files.length&&addFiles(e.dataTransfer.files));
}

/* ---------- export / import ---------- */
async function exportLib(){
  const z=new JSZip(); z.file("library.json",JSON.stringify(state));
  for(const [id,b] of await idb.open().then(()=>idb.db).then(db=>new Promise(res=>{const out=[];db.transaction("files").objectStore("files").openCursor().onsuccess=e=>{const c=e.target.result;if(c){out.push([c.key,c.value]);c.continue();}else{res(out);}}})))
    z.file(`audio/${id}`,b);
  const blob=await z.generateAsync({type:"blob"}); const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);a.download="ssp-library.zip";a.click();
}
async function importLib(f){
  const z=await JSZip.loadAsync(f);
  Object.assign(state,JSON.parse(await z.file("library.json").async("string"))); scaffold(); save();
  const folder=z.folder("audio");
  for(const name of Object.keys(folder.files)){
    await idb.put(name.split("/").pop(), await folder.file(name).async("blob"));
  }
  refresh(); alert("Import complete");
}

/* ---------- persistent quota ---------- */
async function lockStorage(){ if(navigator.storage?.persist){await navigator.storage.persist();}}

/* ---------- Spotify helper (persistent token) ---------- */
const spotify={device:null,token:null,player:null,
  connect(){
    this.token=localStorage.getItem("spotify_token");
    if(this.token){this.#loadPlayer();return;}
    this.#oauth();
  },
  play(m){
    fetch(`https://api.spotify.com/v1/me/player/play?device_id=${this.device}`,{
      method:"PUT",
      headers:{Authorization:`Bearer ${this.token}`,"Content-Type":"application/json"},
      body:JSON.stringify({uris:[m.src],position_ms:((m.start??0)*1000)|0})
    });
  },
  /* ----- OAuth flow ----- */
  async #oauth(){
    const client=prompt("Spotify Client ID:"); if(!client)return;
    const vf=crypto.randomUUID().replace(/-/g,"");
    const sha=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(vf));
    const chal=btoa(String.fromCharCode(...new Uint8Array(sha))).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
    localStorage.setItem("sp_vf",vf); localStorage.setItem("sp_id",client);
    const q=new URLSearchParams({client_id:client,response_type:"code",
      redirect_uri:location.href.split("?")[0],
      scope:"streaming user-read-playback-state user-modify-playback-state",
      code_challenge:chal,code_challenge_method:"S256"});
    location.href="https://accounts.spotify.com/authorize?"+q;
  },
  async completeOAuth(){
    const qs=new URLSearchParams(location.search); if(!qs.get("code"))return;
    const body=new URLSearchParams({
      client_id:localStorage.getItem("sp_id"),
      grant_type:"authorization_code",
      code:qs.get("code"),
      redirect_uri:location.href.split("?")[0],
      code_verifier:localStorage.getItem("sp_vf")
    });
    const j=await(await fetch("https://accounts.spotify.com/api/token",
      {method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body})).json();
    if(j.access_token){localStorage.setItem("spotify_token",j.access_token);this.token=j.access_token;history.replaceState({},document.title,location.pathname);}
  },
  #loadPlayer(){
    window.onSpotifyWebPlaybackSDKReady=()=>{
      const p=new Spotify.Player({name:"SSP-Web",getOAuthToken:cb=>cb(this.token),volume:1});
      p.addListener("ready",d=>{this.device=d.device_id;document.body.classList.add("connected");$("#btn-spotify-add").disabled=false;});
      p.connect(); this.player=p;
    };
  },
  /* ----- add tiles ----- */
  async addFromUri(u){
    if(!this.token)return alert("Connect Spotify first");
    const info=parseSpotify(u); if(!info.kind)return alert("Bad link/URI");
    if(info.kind==="track"){
      push(getSounds(),info.id,await track(info.id));
    }else if(info.kind==="album"){
      for(const t of await album(info.id)) push(getSounds(),t.id,t.name);
    }else{for(const t of await playlist(info.id)) push(getSounds(),t.id,t.name);}
    save(); refreshGrid();
  }
};
/* small helpers for Spotify import */
const parseSpotify=u=>{
  if(u.startsWith("spotify:track:"))return{kind:"track",id:u.split(":").pop()};
  if(u.startsWith("spotify:album:"))return{kind:"album",id:u.split(":").pop()};
  if(u.startsWith("spotify:playlist:"))return{kind:"playlist",id:u.split(":").pop()};
  const m=u.match(/open\.spotify\.com\/(track|album|playlist)\/([A-Za-z0-9]+)/);return m?{kind:m[1],id:m[2]}:{kind:null};
};
const push=(arr,id,name)=>arr.push({id:crypto.randomUUID(),title:name,type:"spotify",src:`spotify:track:${id}`,color:"#1DB954",start:0,volume:1});
const token=()=>localStorage.getItem("spotify_token");
const track=async id=>(await(await fetch(`https://api.spotify.com/v1/tracks/${id}`,{headers:{Authorization:`Bearer ${token()}`}})).json()).name;
const album=async id=>(await(await fetch(`https://api.spotify.com/v1/albums/${id}/tracks?limit=50`,{headers:{Authorization:`Bearer ${token()}`}})).json()).items;
const playlist=async id=>(await(await fetch(`https://api.spotify.com/v1/playlists/${id}/tracks?limit=100`,{headers:{Authorization:`Bearer ${token()}`}})).json()).items.map(x=>x.track);

/* ---------- Apple stub ---------- */
const apple={connect(){alert("Add MusicKit credentials")},play(){alert("Apple playback not wired")}};

/* ---------- bindings ---------- */
function bind(){
  $("#btn-add-cat").onclick=_=>{const n=prompt("Category name");if(!n)return;state.letters[state.activeLetter].categories[n]=[];state.activeCategory=n;save();refresh();};
  $("#controls").onclick=e=>e.target.dataset.cmd&&cmd(e.target.dataset.cmd);
  $("#btn-files").onclick=_=>$("#file-input").click();
  $("#file-input").onchange=e=>addFiles(e.target.files);
  bindDrag();

  $("#btn-export").onclick=exportLib;
  $("#btn-import").onclick=_=>$("#import-input").click();
  $("#import-input").onchange=e=>importLib(e.target.files[0]);

  $("#btn-spotify-connect").onclick=_=>spotify.connect();
  $("#btn-spotify-add").onclick=_=>{const u=prompt("Paste Spotify track / album / playlist"); u&&spotify.addFromUri(u);}
  $("#btn-apple").onclick=_=>apple.connect();
}

/* ---------- init ---------- */
(async function init(){
  const loader=$("#loader"),safety=setTimeout(()=>loader.classList.add("fade"),10000);
  await spotify.completeOAuth(); load(); bind(); if(localStorage.getItem("spotify_token"))spotify.#loadPlayer();
  loader.remove();clearTimeout(safety);$("#app").hidden=false;refresh();
  navigator.storage?.persist?.();
})();

function refresh(){buildLetters();buildCats();buildGrid();}
function refreshGrid(){buildGrid();}
