/* ==========================================================
   SPORTS SOUNDS PRO — Web Edition  (uncompressed source)
   ========================================================== */

/** ------------- DATA MODEL --------------------------------
 * We keep the entire library in `localStorage`.
 * Structure:
 *    state.letters -> {A:{ categories:{Baseball:[sounds…]} }, B:{…}, … }
 * Each sound object:
 *    {
 *      id,                // uuid
 *      title,
 *      src,               // URL, file blob, Spotify URI, or Apple ID
 *      type:'file'|'spotify'|'apple',
 *      color,             // tile background
 *      flags:{loop,rapid,autoFade,…}
 *    }
 */
const LS_KEY = "ssp_state_2";

const defaultLetters = "ABCDEFGHIJ".split("");

const state = {
  letters:{}
};

/* ------------ UTILITIES --------------------------------- */
const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const randColor = _=>`hsl(${Math.random()*360|0},70%,50%)`;
const fmt = s=>String(s).padStart(2,"0");

/* ------------ PERSISTENCE ------------------------------- */
function load(){
  try{
    const str = localStorage.getItem(LS_KEY);
    if(str) Object.assign(state, JSON.parse(str));
  }catch(e){console.warn(e);}
  ensureStructure();
}
function save(){
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}
function ensureStructure(){
  defaultLetters.forEach(l=>{
    if(!state.letters[l]) state.letters[l] = {categories:{}};
  });
}

/* ------------ UI BUILDERS ------------------------------- */
function buildLetterTabs(){
  const box = $("#letter-tabs");
  box.innerHTML="";
  defaultLetters.forEach(l=>{
    const b = document.createElement("button");
    b.textContent=l;
    if(l===state.activeLetter) b.classList.add("active");
    b.onclick=()=>{
      state.activeLetter=l;
      save(); refreshUI();
    };
    box.appendChild(b);
  });
}

function buildCategoryList(){
  const list = $("#category-list");
  list.innerHTML="";
  const catObj = state.letters[state.activeLetter].categories;
  Object.keys(catObj).forEach(cat=>{
    const li=document.createElement("li");
    li.textContent=cat;
    if(cat===state.activeCategory) li.classList.add("active");
    li.onclick=()=>{
      state.activeCategory=cat;
      save(); refreshUI();
    };
    list.appendChild(li);
  });
}

function buildTiles(){
  const grid=$("#grid");
  grid.innerHTML="";
  const sounds = getCurrentSounds();
  sounds.forEach(s=>{
    const div=document.createElement("div");
    div.className="tile";
    div.textContent=s.title;
    div.style.background=s.color;
    if(s.inactive) div.classList.add("inactive");
    div.onclick=()=>playSound(s);
    grid.appendChild(div);
  });
}

/* ------------ HELPERS ----------------------------------- */
function getCurrentSounds(){
  const catObj=state.letters[state.activeLetter].categories;
  return (catObj[state.activeCategory]||[]);
}
function addSounds(files){
  const arr = Array.from(files);
  const catObj=state.letters[state.activeLetter].categories;
  if(!catObj[state.activeCategory]) catObj[state.activeCategory]=[];
  arr.forEach(f=>{
    catObj[state.activeCategory].push({
      id: crypto.randomUUID(),
      title: f.name.replace(/\.[^/.]+$/,""),
      src: URL.createObjectURL(f),
      type:"file",
      color: randColor()
    });
  });
  save(); refreshUI();
}

/* ------------ AUDIO ENGINE ------------------------------ */
let audio=new Audio(), meterTimer, fadeTimer;

function playSound(sound){
  stop();                     // stop any existing
  currentSound=sound;
  if(sound.type==="file"){
    audio=new Audio(sound.src);
    audio.volume=1;
    audio.loop=!!sound.flags?.loop;
    audio.onloadedmetadata=updateTotal;
    audio.ontimeupdate=updateTimes;
    audio.onended=onEnded;
    audio.play();
  }else if(sound.type==="spotify"){
    spotify.playURI(sound.src);
  }else if(sound.type==="apple"){
    apple.playId(sound.src);
  }
  $("#time-elapsed").textContent="00:00";
  $("#time-left").textContent="--:--";
  $("#progress-bar").style.width="0";
  meterTimer=setInterval(sampleMeters,100);
}
function stop(){
  audio.pause(); audio.currentTime=0;
  clearInterval(meterTimer);
  clearInterval(fadeTimer);
  $("#progress-bar").style.width="0";
}
function pause(){ audio.pause(); }
function resume(){ audio.play(); }

function fade(volFrom,volTo,dur){
  const steps=20, stepDur=dur/steps;
  let cur=0;
  fadeTimer=setInterval(()=>{
    cur++; audio.volume = volFrom + (volTo-volFrom)*(cur/steps);
    if(cur>=steps){ clearInterval(fadeTimer); if(volTo===0) stop(); }
  }, stepDur);
}
function updateTotal(){ $("#time-total").textContent=fmt(audio.duration/60|0)+":"+fmt(audio.duration%60|0); }
function updateTimes(){
  $("#time-elapsed").textContent=fmt(audio.currentTime/60|0)+":"+fmt(audio.currentTime%60|0);
  const left=audio.duration-audio.currentTime;
  $("#time-left").textContent=fmt(left/60|0)+":"+fmt(left%60|0);
  $("#progress-bar").style.width=(audio.currentTime/audio.duration*100).toFixed(1)+"%";
}
function onEnded(){
  if(state.flags?.autoNext) playNext();
}

/* Fake meters using random heights (replace with Web Audio API analyser for real) */
function sampleMeters(){
  $("#meterL").style.width=(Math.random()*100|0)+"%";
  $("#meterR").style.width=(Math.random()*100|0)+"%";
}

/* ------------ STREAMING HOOKS --------------------------- */
const spotify={
  deviceId:null, token:null, sdkReady:false,
  async connect(){
    this.token=prompt("Paste Spotify OAuth token:");
    if(!this.token) return;
    await this.init();
    alert("Spotify connected!");
  },
  init(){
    return new Promise(resolve=>{
      if(this.sdkReady) return resolve();
      window.onSpotifyWebPlaybackSDKReady=()=>{
        const player=new Spotify.Player({
          name:"SSP-Web",
          getOAuthToken:cb=>cb(this.token),
          volume:1
        });
        player.addListener('ready',({device_id})=>{
          this.deviceId=device_id; this.sdkReady=true; resolve();
        });
        player.connect();
      };
    });
  },
  playURI(uri){
    if(!this.sdkReady) return alert("Connect Spotify first");
    fetch(`https://api.spotify.com/v1/me/player/play?device_id=${this.deviceId}`,{
      method:"PUT",
      headers:{Authorization:`Bearer ${this.token}`,"Content-Type":"application/json"},
      body:JSON.stringify({uris:[uri]})
    });
  }
};

const apple={
  music:null,
  async connect(){
    alert("Apple MusicKit support requires developer & user tokens.\nOpen script.js to insert them.");
  },
  playId(id){
    if(!this.music) return alert("Connect Apple Music first");
    this.music.setQueue({song:id}).then(()=>this.music.play());
  }
};

/* ------------ EVENT BINDINGS ---------------------------- */
function bindControls(){
  $("#btn-add-category").onclick=()=>{
    const name=prompt("Category name:");
    if(!name) return;
    state.letters[state.activeLetter].categories[name]=[];
    state.activeCategory=name; save(); refreshUI();
  };
  $("#file-input").onchange=e=>addSounds(e.target.files);

  // control ribbon commands
  $("#controls").onclick=e=>{
    const cmd=e.target.dataset.cmd; if(!cmd) return;
    switch(cmd){
      case"stop": stop(); break;
      case"pause": audio.paused?resume():pause(); break;
      case"fade-in": fade(0,1,2000); break;
      case"fade-out": fade(audio.volume,0,2000); break;
      case"find":{
        const q=prompt("Search title:");
        if(!q) return;
        const match=Object.values(state.letters).flatMap(l=>Object.values(l.categories)).flat().find(s=>s.title.toLowerCase().includes(q.toLowerCase()));
        if(match) playSound(match); else alert("Not found");
      }break;
      case"rapid": audio.playbackRate=2; break;
      default:alert("Command '"+cmd+"' not yet implemented.");
    }
  };
}

/* ============ INITIALISE =============================== */
function refreshUI(){
  buildLetterTabs();
  buildCategoryList();
  buildTiles();
}
function init(){
  load();
  // default selections
  state.activeLetter = state.activeLetter || "A";
  if(!state.activeCategory){
    const cats=Object.keys(state.letters[state.activeLetter].categories);
    state.activeCategory = cats[0] || null;
  }
  bindControls();
  refreshUI();
}

window.addEventListener("DOMContentLoaded",init);
