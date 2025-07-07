/* ============================================================
   SPORTS SOUNDS PRO — Web v6  (July 2025)
   ============================================================ */
import JSZip from "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm";

/* ---------- helpers ---------- */
const $  = s => document.querySelector(s);
const pad = n => String(n).padStart(2,"0");
const rnd = () => `hsl(${Math.floor(Math.random()*360)},70%,50%)`;
const fmt = s => isFinite(s) ? `${pad(s/60|0)}:${pad(s%60|0)}` : "--:--";

/* ---------- state ---------- */
const LS = "ssp_state_v6";
const letters = [..."ABCDEFGHIJ"];
const state = {letters:{}, activeLetter:"A", activeCategory:null};

function scaffold(){
  letters.forEach(l=>{state.letters[l] ??= {categories:{}};});
}
function load(){
  Object.assign(state, JSON.parse(localStorage.getItem(LS)||"{}"));
  scaffold();
  ensureCat();
}
function save(){ localStorage.setItem(LS, JSON.stringify(state)); }
function ensureCat(){
  const cats = Object.keys(state.letters[state.activeLetter].categories);
  state.activeCategory ??= cats[0] || null;
}

/* ---------- IndexedDB wrapper ---------- */
const idb = {
  db:null,
  open(){
    return new Promise((res,rej)=>{
      const req=indexedDB.open("ssp_files",1);
      req.onupgradeneeded=e=>e.target.result.createObjectStore("files");
      req.onsuccess=e=>{this.db=e.target.result;res();};
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
  async all(){
    const db=this.db||await this.open();
    return new Promise((res,rej)=>{
      const out=[], cur=db.transaction("files").objectStore("files").openCursor();
      cur.onsuccess=e=>{
        const c=e.target.result;
        if(c){ out.push([c.key,c.value]); c.continue(); }
        else res(out);
      };
      cur.onerror=rej;
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
  const cats = state.letters[state.activeLetter].categories;
  for(const c of Object.keys(cats)){
    const li=document.createElement("li");
    li.textContent=c;
    if(c===state.activeCategory) li.classList.add("active");
    li.onclick=_=>{state.activeCategory=c;save();refreshGrid();};
    ul.appendChild(li);
  }
}
function buildGrid(){
  const grid=$("#grid"); grid.innerHTML="";
  for(const s of getSounds()){
    const d=document.createElement("div");
    d.className="tile";
    if(s.inactive) d.classList.add("inactive");
    if(s.type==="spotify") d.classList.add("spotify");
    d.style.background ??= rnd();
    d.textContent=s.title;
    d.onclick=_=>play(s);
    grid.appendChild(d);
  }
}

/* ---------- sounds ---------- */
function getSounds(){
  return state.letters[state.activeLetter].categories[state.activeCategory] || [];
}
async function addFiles(files){
  if(!state.activeCategory){ alert("Create/select a category first."); return; }
  const list = getSounds();
  for(const f of files){
    const id=crypto.randomUUID();
    await idb.put(id,f);
    list.push({id,title:f.name.replace(/\.[^/.]+$/,""),type:"file",src:"",color:rnd()});
  }
  await hydrate(); save(); refreshGrid(); await lockStorage();
}

/* ---------- hydration ---------- */
async function hydrate(){
  const tasks=[];
  for(const l of letters){
    for(const arr of Object.values(state.letters[l].categories)){
      for(const s of arr){
        if(s.type==="file" && !s.src){
          tasks.push(idb.get(s.id).then(b=>{
            if(b) s.src = URL.createObjectURL(b);
            else   s.inactive = true;
          }));
        }
      }
    }
  }
  await Promise.all(tasks);
}

/* ---------- audio engine ---------- */
const cfg = {multi:false,loop:false,autoFade:false};
let current=null, playing=[], analyser=null, meterTimer=null;

function play(s){
  if(!cfg.multi) stopAll();

  if(s.type==="file"){
    const a=new Audio(s.src);
    a.loop=cfg.loop; a.play();
    current=a; playing.push(a);

    a.onloadedmetadata=_=>$("#t-total").textContent = fmt(a.duration);
    a.ontimeupdate=_=>{
      $("#t-elap").textContent = fmt(a.currentTime);
      $("#t-left").textContent = fmt(a.duration-a.currentTime);
      $("#prog-bar").style.right = (100-a.currentTime/a.duration*100)+"%";
    };
    a.onended=_=>{
      playing = playing.filter(x=>x!==a);
      if(!playing.length){ clearInterval(meterTimer); drawMeter(0,0); }
    };
    attachMeters(a);
    if(cfg.autoFade && playing.length>1) fadeOut(playing[0],1500);

  }else if(s.type==="spotify"){ spotify.play(s.src); }
  else if(s.type==="apple"){ apple.play(s.src); }
}
function stopAll(){
  playing.forEach(a=>{a.pause();a.currentTime=0;});
  playing=[]; current=null;
  clearInterval(meterTimer); drawMeter(0,0);
  $("#prog-bar").style.right = "100%";
}
function fadeOut(a,dur){
  const step=dur/20, dec=a.volume/20;
  const t=setInterval(()=>{a.volume=Math.max(0,a.volume-dec); if(a.volume===0){a.pause();clearInterval(t);} },step);
}
function attachMeters(a){
  if(!analyser){
    const ctx=new (window.AudioContext||window.webkitAudioContext)();
    analyser=ctx.createAnalyser(); analyser.fftSize=256;
  }
  try{
    const src=analyser.context.createMediaElementSource(a);
    src.connect(analyser).connect(analyser.context.destination);
  }catch{}  // multiple connects in Chrome can throw

  if(!meterTimer){
    meterTimer=setInterval(()=>{
      const data=new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteTimeDomainData(data);
      const rms=Math.sqrt(data.reduce((s,v)=>s+(v-128)**2,0)/data.length)/128;
      drawMeter(rms,rms);
    },90);
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
  const toggle = flag => $(`[data-cmd='${c}']`).classList.toggle("accent-d",flag);
  switch(c){
    case"cue": current&&(current.currentTime=0); break;
    case"multi": cfg.multi=!cfg.multi; toggle(cfg.multi); break;
    case"loop": cfg.loop=!cfg.loop; toggle(cfg.loop); break;
    case"autoFade": cfg.autoFade=!cfg.autoFade; toggle(cfg.autoFade); break;
    case"pause": current&&(current.paused?current.play():current.pause()); break;
    case"rapid": current&&(current.playbackRate=2,setTimeout(()=>current.playbackRate=1,3000)); break;
    case"stop": stopAll(); break;
    case"next":{
      const arr=getSounds(); if(!arr.length) break;
      const idx=arr.indexOf(arr.find(x=>x.src===current?.src));
      play(arr[(idx+1)%arr.length]); } break;
    case"shuffle": {
      const arr=getSounds();
      for(let i=arr.length-1;i;i--){const j=Math.random()*(i+1)|0;[arr[i],arr[j]]=[arr[j],arr[i]];}
      save(); refreshGrid(); } break;
    case"find":{
      const q=prompt("Search title:"); if(!q) break;
      const hit=find(q); hit?play(hit):alert("Not found"); } break;
    case"resetPage": getSounds().forEach(t=>t.inactive=false); save(); refreshGrid(); break;
    default: alert("Not yet implemented"); break;
  }
}
function find(q){
  const low=q.toLowerCase();
  for(const l of letters){
    for(const arr of Object.values(state.letters[l].categories)){
      const hit=arr.find(s=>s.title.toLowerCase().includes(low));
      if(hit) return hit;
    }
  }
}

/* ---------- drag-and-drop ---------- */
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
  const zip = await JSZip.loadAsync(file);
  const json = await zip.file("library.json").async("string");
  Object.assign(state, JSON.parse(json)); scaffold(); save();

  const folder = zip.folder("audio");
  for(const name of Object.keys(folder.files)){
    const blob = await folder.file(name).async("blob");
    await idb.put(name.split("/").pop(), blob);
  }
  await hydrate(); refresh(); alert("Import complete");
}

/* ---------- Persistent storage helper ---------- */
async function lockStorage(){
  if('storage' in navigator && 'persist' in navigator.storage){
    const granted = await navigator.storage.persist();
    console.log('Persistent storage', granted ? 'granted' : 'not granted');
  }
}

/* ---------- Spotify helper (PKCE + playlist import) ---------- */
const spotify = {
  device:null, token:null, player:null, client:null,

  async connect(){
    await this._completePKCE();
    if(!this.token){
      await this._startPKCE();    // triggers redirect
      return;
    }
    await this._initPlayer();
    document.body.classList.add("connected");
    $("#btn-spotify-add").disabled=false;
    alert("Spotify connected!  Click 'Add Spotify Track/Playlist'.");
  },
  play(uri){
    fetch(`https://api.spotify.com/v1/me/player/play?device_id=${this.device}`,{
      method:"PUT",
      headers:{Authorization:`Bearer ${this.token}`,"Content-Type":"application/json"},
      body:JSON.stringify({uris:[uri]})
    });
  },

  /* ---- add tiles ---- */
  async addFromUri(input){
    if(!this.token) return alert("Connect Spotify first");
    const {kind,id}=this._parse(input.trim());
    if(!kind) { alert("Not a recognised Spotify link or URI"); return; }

    if(kind==="track"){
      this._pushTile({uri:`spotify:track:${id}`, title:await this._trackName(id)});
    }else if(kind==="album"){
      const tracks=await this._albumTracks(id);
      tracks.forEach(t=>this._pushTile(t));
    }else if(kind==="playlist"){
      const tracks=await this._playlistTracks(id);
      tracks.forEach(t=>this._pushTile(t));
    }
    save(); refreshGrid();
  },
  _pushTile({uri,title}){
    const list=getSounds();
    list.push({id:crypto.randomUUID(),title,type:"spotify",src:uri,color:"#1DB954"});
  },
  _parse(u){
    if(u.startsWith("spotify:track:"))   return {kind:"track",id:u.split(":").pop()};
    if(u.startsWith("spotify:album:"))   return {kind:"album",id:u.split(":").pop()};
    if(u.startsWith("spotify:playlist:"))return {kind:"playlist",id:u.split(":").pop()};
    const m=u.match(/open\.spotify\.com\/(track|album|playlist)\/([A-Za-z0-9]+)/);
    return m?{kind:m[1],id:m[2]}:{kind:null};
  },
  async _trackName(id){
    const r=await fetch(`https://api.spotify.com/v1/tracks/${id}`,{headers:{Authorization:`Bearer ${this.token}`}}
    ); const j=await r.json(); return `${j.name} – ${j.artists.map(a=>a.name).join(", ")}`;
  },
  async _albumTracks(id){
    const r=await fetch(`https://api.spotify.com/v1/albums/${id}/tracks?limit=50`,{headers:{Authorization:`Bearer ${this.token}`}}); const j=await r.json();
    return j.items.map(t=>({uri:`spotify:track:${t.id}`,title:`${t.name} – ${t.artists.map(a=>a.name).join(", ")}`}));
  },
  async _playlistTracks(id){
    const r=await fetch(`https://api.spotify.com/v1/playlists/${id}/tracks?limit=100`,{headers:{Authorization:`Bearer ${this.token}`}}); const j=await r.json();
    return j.items.filter(x=>x.track).map(({track:t})=>({uri:`spotify:track:${t.id}`,title:`${t.name} – ${t.artists.map(a=>a.name).join(", ")}`}));
  },

  /* ---- PKCE flow ---- */
  async _startPKCE(){
    this.client = prompt("Spotify *Client ID*:");
    if(!this.client) return;
    const vf = crypto.randomUUID().replace(/-/g,"");
    const sha = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(vf));
    const chal = btoa(String.fromCharCode(...new Uint8Array(sha))).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");

    sessionStorage.setItem("sp_vf",vf); sessionStorage.setItem("sp_id",this.client);
    const p = new URLSearchParams({
      client_id:this.client,response_type:"code",
      redirect_uri:location.origin+location.pathname,
      scope:"streaming user-read-playback-state user-modify-playback-state",
      code_challenge:chal,code_challenge_method:"S256"
    });
    location.href="https://accounts.spotify.com/authorize?"+p;
  },
  async _completePKCE(){
    const q=new URLSearchParams(location.search);
    if(!q.get("code")) return;
    const code=q.get("code");
    this.client=sessionStorage.getItem("sp_id");
    const vf=sessionStorage.getItem("sp_vf");

    const body=new URLSearchParams({
      client_id:this.client,grant_type:"authorization_code",code,
      redirect_uri:location.origin+location.pathname,code_verifier:vf
    });
    const r=await fetch("https://accounts.spotify.com/api/token",{
      method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body
    });
    const j=await r.json();
    if(j.access_token){
      sessionStorage.setItem("spotify_token",j.access_token);
      history.replaceState({},document.title,location.pathname);   // clean ?code
    }
  },
  async _initPlayer(){
    this.token=sessionStorage.getItem("spotify_token");
    return new Promise(res=>{
      window.onSpotifyWebPlaybackSDKReady=()=>{
        const p=new Spotify.Player({
          name:"SSP-Web", getOAuthToken:cb=>cb(this.token), volume:1
        });
        p.addListener("ready",d=>{this.device=d.device_id;res();});
        p.connect(); this.player=p;
      };
    });
  }
};

/* ---------- Apple Music stub ---------- */
const apple={
  async connect(){ alert("MusicKit needs developer & user tokens – add code in script.js"); },
  play(){ alert("Apple playback not wired in this demo"); }
};

/* ---------- dialogs ---------- */
function addSpotifyDialog(){
  const uri=prompt("Paste Spotify track / album / playlist link or URI:");
  if(uri) spotify.addFromUri(uri);
}

/* ---------- bindings ---------- */
function bind(){
  $("#btn-add-cat").onclick=_=>{
    const n=prompt("Category name:"); if(!n) return;
    state.letters[state.activeLetter].categories[n]=[];
    state.activeCategory=n; save(); refresh();
  };
  $("#controls").onclick=e=>e.target.dataset.cmd && cmd(e.target.dataset.cmd);
  $("#btn-files").onclick=_=>$("#file-input").click();
  $("#file-input").onchange=e=>addFiles(e.target.files);
  bindDrag();

  $("#btn-export").onclick=exportLib;
  $("#btn-import").onclick=_=>$("#import-input").click();
  $("#import-input").onchange=e=>importLib(e.target.files[0]);

  $("#btn-spotify-connect").onclick=_=>spotify.connect();
  $("#btn-spotify-add").onclick=addSpotifyDialog;

  $("#btn-apple").onclick=_=>apple.connect();
}

/* ---------- init ---------- */
(async function init(){
  await spotify._completePKCE();     // finish OAuth if we were redirected
  load();
  await hydrate();
  bind();
  $("#loader").remove(); $("#app").hidden=false;
  refresh();
  navigator.storage?.persist?.();    // request persistent storage
})();

function refresh(){ buildLetters(); buildCats(); buildGrid(); }
function refreshGrid(){ buildGrid(); }
