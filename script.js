/* ============================================================
   SPORTS SOUNDS PRO — Web v7   (July 2025)
   ============================================================ */
import JSZip from "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm";

/* ---------- helpers ---------- */
const $  = s => document.querySelector(s);
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
function ensureCat(){const cats=Object.keys(state.letters[state.activeLetter].categories);state.activeCategory??=cats[0]||null;}

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
    tx.onsuccess=e=>res(e.target.result);tx.onerror=rej;});},
  async all(){await this.open();return new Promise((res,rej)=>{
    const out=[],cur=this.db.transaction("files").objectStore("files").openCursor();
    cur.onsuccess=e=>{const c=e.target.result;if(c){out.push([c.key,c.value]);c.continue();}else res(out);};
    cur.onerror=rej;});}
};

/* ---------- UI builders ---------- */
function buildLetters(){
  const box=$("#letter-tabs");box.innerHTML="";
  letters.forEach(l=>{
    const b=document.createElement("button");
    b.textContent=l;
    if(l===state.activeLetter)b.classList.add("active");
    b.onclick=_=>{state.activeLetter=l;ensureCat();save();refresh();};
    box.appendChild(b);
  });
}
function buildCats(){
  const ul=$("#cat-list");ul.innerHTML="";
  const cats=state.letters[state.activeLetter].categories;
  for(const c in cats){
    const li=document.createElement("li");
    li.textContent=c;
    if(c===state.activeCategory)li.classList.add("active");
    li.onclick=_=>{state.activeCategory=c;save();refreshGrid();};
    ul.appendChild(li);
  }
}
function buildGrid(){
  const g=$("#grid");g.innerHTML="";
  for(const s of getSounds()){
    const d=document.createElement("div");
    d.className="tile";
    if(s.inactive)d.classList.add("inactive");
    if(s.type==="spotify")d.classList.add("spotify");
    d.style.background=s.color??rnd();
    d.textContent=s.title;
    d.onclick=_=>play(s);

    /* gear icon */
    const gear=document.createElement("span");
    gear.className="gear";gear.innerHTML="&#9881;";
    gear.onclick=e=>{e.stopPropagation();editSound(s);};
    d.appendChild(gear);

    g.appendChild(d);
  }
}

/* ---------- edit dialog ---------- */
function editSound(s){
  const title = prompt("Tile title:", s.title) ?? s.title;
  let start   = parseFloat(prompt("Start time (seconds):", s.start ?? 0));
  if(isNaN(start)||start<0) start = s.start ?? 0;

  let volume  = parseFloat(prompt("Volume 0–1 :", s.volume ?? 1));
  if(isNaN(volume)||volume<0||volume>1) volume = s.volume ?? 1;

  s.title = title; s.start = start; s.volume = volume;
  save(); refreshGrid();
}

/* ---------- sounds ---------- */
function getSounds(){return state.letters[state.activeLetter].categories[state.activeCategory]||[];}
async function addFiles(files){
  if(!state.activeCategory){alert("Create/select a category first");return;}
  const list=getSounds();
  for(const f of files){
    const id=crypto.randomUUID();
    await idb.put(id,f);
    list.push({id,title:f.name.replace(/\.[^/.]+$/,""),type:"file",src:"",color:rnd(),start:0,volume:1});
  }
  await hydrate();save();refreshGrid();await lockStorage();
}

/* ---------- hydration ---------- */
async function hydrate(){
  const jobs=[];
  for(const l of letters)
    for(const arr of Object.values(state.letters[l].categories))
      for(const s of arr)
        if(s.type==="file" && !s.src)
          jobs.push(idb.get(s.id).then(b=>{if(b)s.src=URL.createObjectURL(b);else s.inactive=true;}));
  await Promise.all(jobs);
}

/* ---------- audio engine ---------- */
const cfg={multi:false,loop:false,autoFade:false};
let current=null,playing=[],analyser=null,meterT=null;

function attachMeters(a){
  if(!analyser){
    const ctx=new (window.AudioContext||window.webkitAudioContext)();
    analyser=ctx.createAnalyser(); analyser.fftSize=256;
  }
  try{
    const src=analyser.context.createMediaElementSource(a);
    src.connect(analyser).connect(analyser.context.destination);
  }catch{}   // multiple connects may throw
  if(!meterT){
    meterT=setInterval(()=>{
      const d=new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteTimeDomainData(d);
      const rms=Math.sqrt(d.reduce((s,v)=>s+(v-128)**2,0)/d.length)/128;
      drawMeter(rms,rms);
    },90);
  }
}
function drawMeter(l,r){
  const a=$("#meterL").getContext("2d");
  const b=$("#meterR").getContext("2d");
  a.clearRect(0,0,60,10); b.clearRect(0,0,60,10);
  a.fillStyle=b.fillStyle="#0f0";
  a.fillRect(0,0,l*60,10); b.fillRect(0,0,r*60,10);
}
function fadeOut(a,dur){
  const dec=a.volume/20,step=dur/20;
  const t=setInterval(()=>{
    a.volume=Math.max(0,a.volume-dec);
    if(a.volume===0){a.pause();clearInterval(t);}
  },step);
}
function stopAll(){
  playing.forEach(a=>{a.pause();a.currentTime=0;});
  playing=[]; current=null;
  clearInterval(meterT); drawMeter(0,0);
  $("#prog-bar").style.right="100%";
}
function play(s){
  if(!cfg.multi) stopAll();

  if(s.type==="file"){
    const a=new Audio(s.src);
    a.loop=cfg.loop;
    a.volume=s.volume??1;
    a.onloadedmetadata=_=>{
      a.currentTime=s.start??0;
      $("#t-total").textContent=fmt(a.duration);
    };
    a.ontimeupdate=_=>{
      $("#t-elap").textContent=fmt(a.currentTime);
      $("#t-left").textContent=fmt(a.duration-a.currentTime);
      $("#prog-bar").style.right=(100-a.currentTime/a.duration*100)+"%";
    };
    a.onended=_=>{
      playing=playing.filter(x=>x!==a);
      if(!playing.length){clearInterval(meterT);drawMeter(0,0);}
    };
    a.play();
    current=a; playing.push(a);
    attachMeters(a);
    if(cfg.autoFade && playing.length>1) fadeOut(playing[0],1500);

  }else if(s.type==="spotify"){ spotify.play(s); }
  else apple.play(s);
}

/* ---------- command ribbon ---------- */
function cmd(c){
  const tog=flag=>$(`[data-cmd='${c}']`).classList.toggle("accent-d",flag);
  switch(c){
    case"cue": if(current){const meta=getSounds().find(x=>x.src===current.src);current.currentTime=meta?.start||0;}break;
    case"multi": cfg.multi=!cfg.multi; tog(cfg.multi); break;
    case"loop": cfg.loop=!cfg.loop; tog(cfg.loop); break;
    case"autoFade": cfg.autoFade=!cfg.autoFade; tog(cfg.autoFade); break;
    case"pause": current&&(current.paused?current.play():current.pause()); break;
    case"rapid": current&&(current.playbackRate=2,setTimeout(()=>current.playbackRate=1,3000)); break;
    case"stop": stopAll(); break;
    case"next":{
      const arr=getSounds(); if(!arr.length) break;
      const i=arr.indexOf(arr.find(x=>x.src===current?.src));
      play(arr[(i+1)%arr.length]);
    }break;
    case"shuffle":{
      const arr=getSounds();
      for(let i=arr.length-1;i;i--){const j=Math.random()*(i+1)|0;[arr[i],arr[j]]=[arr[j],arr[i]];}
      save(); refreshGrid();
    }break;
    case"find":{
      const q=prompt("Search title:"); if(!q) break;
      const low=q.toLowerCase();
      for(const l of letters)
        for(const arr of Object.values(state.letters[l].categories)){
          const hit=arr.find(s=>s.title.toLowerCase().includes(low));
          if(hit){play(hit);return;}
        }
      alert("Not found");
    }break;
    case"resetPage": getSounds().forEach(s=>s.inactive=false); save(); refreshGrid(); break;
    default: alert("Not yet implemented");
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
  for(const [id,b] of await idb.all()) zip.file(`audio/${id}`,b);
  const blob=await zip.generateAsync({type:"blob"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob); a.download="ssp-library.zip"; a.click();
}
async function importLib(file){
  const zip=await JSZip.loadAsync(file);
  Object.assign(state, JSON.parse(await zip.file("library.json").async("string")));
  scaffold(); save();
  const folder=zip.folder("audio");
  for(const name of Object.keys(folder.files)){
    await idb.put(name.split("/").pop(), await folder.file(name).async("blob"));
  }
  await hydrate(); refresh(); alert("Import complete");
}

/* ---------- persistent quota ---------- */
async function lockStorage(){
  if('storage' in navigator && 'persist' in navigator.storage){
    const granted=await navigator.storage.persist();
    console.log("persistent storage",granted);
  }
}

/* ---------- Spotify helper (PKCE + offset) ---------- */
const spotify={device:null,token:null,player:null,client:null,
  async connect(){await this._complete(); if(!this.token){await this._auth(); return;}
    await this._player(); document.body.classList.add("connected");
    $("#btn-spotify-add").disabled=false; alert("Spotify connected!");
  },
  play(meta){
    fetch(`https://api.spotify.com/v1/me/player/play?device_id=${this.device}`,{
      method:"PUT",
      headers:{Authorization:`Bearer ${this.token}`,"Content-Type":"application/json"},
      body:JSON.stringify({uris:[meta.src],position_ms:((meta.start??0)*1000)|0})
    });
  },
  /* ---- import helpers ---- */
  async addFromUri(u){
    if(!this.token) return;
    const p=this._parse(u.trim());
    if(!p.kind) return alert("Unrecognised Spotify link/URI");
    if(p.kind==="track"){
      this._push({uri:`spotify:track:${p.id}`,title:await this._trackName(p.id)});
    }else if(p.kind==="album"){
      (await this._albumTracks(p.id)).forEach(this._push);
    }else{
      (await this._playlistTracks(p.id)).forEach(this._push);
    }
    save(); refreshGrid();
  },
  _push=({uri,title})=>getSounds().push({
    id:crypto.randomUUID(),title,type:"spotify",src:uri,
    color:"#1DB954",start:0,volume:1}),
  _parse:u=>{if(u.startsWith("spotify:track:"))return{kind:"track",id:u.split(":").pop()};
    if(u.startsWith("spotify:album:"))return{kind:"album",id:u.split(":").pop()};
    if(u.startsWith("spotify:playlist:"))return{kind:"playlist",id:u.split(":").pop()};
    const m=u.match(/open\.spotify\.com\/(track|album|playlist)\/([A-Za-z0-9]+)/);
    return m?{kind:m[1],id:m[2]}:{kind:null};},
  _trackName:async id=>(await(await fetch(`https://api.spotify.com/v1/tracks/${id}`,
    {headers:{Authorization:`Bearer ${this.token}`}})).json()).name,
  _albumTracks:async id=>{
    const j=await(await fetch(`https://api.spotify.com/v1/albums/${id}/tracks?limit=50`,
      {headers:{Authorization:`Bearer ${this.token}`}})).json();
    return j.items.map(t=>({uri:`spotify:track:${t.id}`,title:t.name}));
  },
  _playlistTracks:async id=>{
    const j=await(await fetch(`https://api.spotify.com/v1/playlists/${id}/tracks?limit=100`,
      {headers:{Authorization:`Bearer ${this.token}`}})).json();
    return j.items.filter(x=>x.track).map(({track:t})=>({uri:`spotify:track:${t.id}`,title:t.name}));
  },
  /* ---- PKCE flow ---- */
  async _auth(){
    this.client=prompt("Spotify Client-ID:"); if(!this.client)return;
    const vf=crypto.randomUUID().replace(/-/g,"");
    const sha=await crypto.subtle.digest("SHA-256", new TextEncoder().encode(vf));
    const ch=btoa(String.fromCharCode(...new Uint8Array(sha))).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
    sessionStorage.setItem("sp_vf",vf); sessionStorage.setItem("sp_id",this.client);
    const q=new URLSearchParams({
      client_id:this.client,response_type:"code",
      redirect_uri:location.origin+location.pathname,
      scope:"streaming user-read-playback-state user-modify-playback-state",
      code_challenge:ch,code_challenge_method:"S256"
    });
    location.href="https://accounts.spotify.com/authorize?"+q;
  },
  async _complete(){
    const qs=new URLSearchParams(location.search);
    if(!qs.get("code")){
      this.token=sessionStorage.getItem("spotify_token");
      return;
    }
    const body=new URLSearchParams({
      client_id:sessionStorage.getItem("sp_id"),
      grant_type:"authorization_code",
      code:qs.get("code"),
      redirect_uri:location.origin+location.pathname,
      code_verifier:sessionStorage.getItem("sp_vf")
    });
    const j=await(await fetch("https://accounts.spotify.com/api/token",
      {method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body})).json();
    if(j.access_token){
      sessionStorage.setItem("spotify_token",j.access_token);
      this.token=j.access_token;
      history.replaceState({},document.title,location.pathname);  // strip ?code
    }
  },
  _player(){
    return new Promise(res=>{
      window.onSpotifyWebPlaybackSDKReady=()=>{
        const p=new Spotify.Player({
          name:"SSP-Web",getOAuthToken:cb=>cb(this.token),volume:1
        });
        p.addListener("ready",d=>{this.device=d.device_id;res();});
        p.connect(); this.player=p;
      };
    });
  }
};

/* ---------- Apple Music stub ---------- */
const apple={
  connect(){alert("Add MusicKit developer / user tokens here");},
  play(){alert("Apple playback not wired in this demo");}
};

/* ---------- dialogs ---------- */
const addSpotifyDialog=()=>{const u=prompt("Paste Spotify track / album / playlist");u&&spotify.addFromUri(u);};

/* ---------- bindings ---------- */
function bind(){
  $("#btn-add-cat").onclick=_=>{
    const n=prompt("Category name"); if(!n)return;
    state.letters[state.activeLetter].categories[n]=[];
    state.activeCategory=n; save(); refresh();
  };
  $("#controls").onclick=e=>e.target.dataset.cmd&&cmd(e.target.dataset.cmd);
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
  const loader=$("#loader");
  const safety=setTimeout(()=>loader.classList.add("fade"),10000);
  await spotify._complete();
  load(); await hydrate(); bind();
  loader.remove(); clearTimeout(safety);
  $("#app").hidden=false; refresh();
  navigator.storage?.persist?.();         // ask for persistent quota
})();

function refresh(){buildLetters(); buildCats(); buildGrid();}
function refreshGrid(){buildGrid();}
