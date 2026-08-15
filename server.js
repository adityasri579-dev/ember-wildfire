const http=require('http');
const fs=require('fs');
const path=require('path');
const {URL}=require('url');
const {DatabaseSync}=require('node:sqlite');
const crypto=require('crypto');

// Load a local .env without adding an npm dependency. Existing process
// environment variables win, so production deployments can inject secrets.
function loadEnvFile(file){
  try{
    const text=fs.readFileSync(file,'utf8');
    for(const raw of text.split(/\r?\n/)){
      const line=raw.trim(); if(!line||line.startsWith('#')) continue;
      const m=line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if(!m) continue;
      let value=m[2].trim();
      if((value.startsWith('\"')&&value.endsWith('\"'))||(value.startsWith("'")&&value.endsWith("'"))) value=value.slice(1,-1);
      if(process.env[m[1]]===undefined) process.env[m[1]]=value;
    }
  }catch(e){ if(e.code!=='ENOENT') console.warn('Could not read .env:',e.message); }
}
loadEnvFile(path.join(__dirname,'.env'));

const PORT=Number(process.env.PORT||8787);
const HOST=String(process.env.HOST||'0.0.0.0');
const ROOT=__dirname;
const NODE_ENV=String(process.env.NODE_ENV||'development');
const IS_PROD=NODE_ENV==='production';
const TRUST_PROXY=/^(1|true|yes)$/i.test(String(process.env.TRUST_PROXY||''));
const COOKIE_SECURE=process.env.COOKIE_SECURE!==undefined?/^(1|true|yes)$/i.test(String(process.env.COOKIE_SECURE)):IS_PROD;
const APP_ORIGIN=String(process.env.APP_ORIGIN||'').replace(/\/$/,'');
const DATA=path.resolve(process.env.DATA_DIR||path.join(ROOT,'data')); fs.mkdirSync(DATA,{recursive:true});
const DB_PATH=path.join(DATA,'ember.db');
const db=new DatabaseSync(DB_PATH);
db.exec(`CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 display_name TEXT NOT NULL,
 password_salt TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions(
 token_hash TEXT PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS scenarios(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL,
 payload TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`);
try{db.exec('ALTER TABLE scenarios ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE')}catch(e){ if(!String(e.message).includes('duplicate column')) throw e; }
db.exec('CREATE INDEX IF NOT EXISTS idx_scenarios_user_updated ON scenarios(user_id,updated_at DESC); CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);');
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
const cache=new Map();
const rateBuckets=new Map();
function securityHeaders(){return {
  'X-Content-Type-Options':'nosniff',
  'X-Frame-Options':'DENY',
  'Referrer-Policy':'no-referrer',
  'Permissions-Policy':'geolocation=(self), camera=(), microphone=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy':'same-origin',
  'Cross-Origin-Resource-Policy':'same-origin',
  'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data: blob: https://*.tile.openstreetmap.org https://unpkg.com; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
};}
function send(res,status,body,type='application/json; charset=utf-8',extra={}){res.writeHead(status,{...securityHeaders(),'Content-Type':type,'Cache-Control':'no-store',...extra});res.end(body);}
function json(res,status,obj){send(res,status,JSON.stringify(obj), 'application/json; charset=utf-8');}
async function readBody(req){let b='';for await(const c of req){b+=c;if(b.length>2_000_000)throw Object.assign(new Error('body too large'),{statusCode:413});}return b;}
function requestIp(req){if(TRUST_PROXY){const x=String(req.headers['x-forwarded-for']||'').split(',')[0].trim();if(x)return x;}return req.socket.remoteAddress||'unknown';}
function hitRateLimit(req,res,key,limit,windowMs){const now=Date.now(), ip=requestIp(req), k=key+'|'+ip; let b=rateBuckets.get(k); if(!b||now>=b.reset){b={count:0,reset:now+windowMs};rateBuckets.set(k,b);} b.count++; res.setHeader('RateLimit-Limit',String(limit));res.setHeader('RateLimit-Remaining',String(Math.max(0,limit-b.count)));res.setHeader('RateLimit-Reset',String(Math.ceil(b.reset/1000))); if(b.count>limit){res.setHeader('Retry-After',String(Math.ceil((b.reset-now)/1000)));json(res,429,{error:'too many requests'});return true;} return false;}
function cookieAttrs(maxAge){return `Path=/; SameSite=Strict${COOKIE_SECURE?'; Secure':''}${maxAge!==undefined?`; Max-Age=${maxAge}`:''}`;}
function issueCsrf(res){const token=b64url(crypto.randomBytes(24));res.setHeader('Set-Cookie',`ember_csrf=${encodeURIComponent(token)}; ${cookieAttrs(3600)}`);return token;}
function validateCsrf(req,res){const token=String(req.headers['x-csrf-token']||''), cookie=String(parseCookies(req).ember_csrf||''); if(!token||!cookie){json(res,403,{error:'CSRF token required'});return false;} const a=Buffer.from(token),b=Buffer.from(cookie); if(a.length!==b.length||!crypto.timingSafeEqual(a,b)){json(res,403,{error:'invalid CSRF token'});return false;} return true;}
function expectedOrigin(req){if(APP_ORIGIN)return APP_ORIGIN;const proto=TRUST_PROXY?String(req.headers['x-forwarded-proto']||'').split(',')[0].trim():(req.socket.encrypted?'https':'http');return `${proto||'http'}://${req.headers.host}`;}
function validateOrigin(req,res){if(!IS_PROD)return true;const origin=String(req.headers.origin||'');if(origin&&origin===expectedOrigin(req))return true;json(res,403,{error:'origin check failed'});return false;}
async function cachedFetch(url,opts={},ttl=300000,timeoutMs=20000){const key=(opts.method||'GET')+' '+url+' '+(opts.body||''); const hit=cache.get(key); if(hit&&Date.now()-hit.t<ttl)return hit; const fetchOpts={...opts,signal:opts.signal||AbortSignal.timeout(timeoutMs)}; const r=await fetch(url,fetchOpts); const buf=Buffer.from(await r.arrayBuffer()); const out={t:Date.now(),status:r.status,ok:r.ok,buf,type:r.headers.get('content-type')||'application/octet-stream'}; if(r.ok){cache.set(key,out);if(cache.size>500){const oldest=[...cache.entries()].sort((a,b)=>a[1].t-b[1].t).slice(0,100);for(const [k] of oldest)cache.delete(k);}} return out;}
function safeNum(v,min,max){const n=Number(v); return Number.isFinite(n)&&n>=min&&n<=max?n:null;}
function parseCsv(text){
  const rows=[]; let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){ if(c==='\"'&&text[i+1]==='\"'){field+='\"';i++;} else if(c==='\"') quoted=false; else field+=c; }
    else if(c==='\"') quoted=true;
    else if(c===','){row.push(field);field='';}
    else if(c==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';}
    else field+=c;
  }
  if(field||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}
  if(!rows.length)return [];
  const head=rows.shift().map(x=>x.trim());
  return rows.filter(r=>r.some(x=>x!=='' )).map(r=>Object.fromEntries(head.map((h,i)=>[h,r[i]??''])));
}

function b64url(buf){return Buffer.from(buf).toString('base64url')}
function hashToken(t){return crypto.createHash('sha256').update(t).digest('hex')}
function parseCookies(req){const out={}; for(const part of String(req.headers.cookie||'').split(';')){const i=part.indexOf('=');if(i>0)out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim())}return out}
function sessionUser(req){const token=parseCookies(req).ember_session;if(!token)return null; const th=hashToken(token); const row=db.prepare(`SELECT u.id,u.email,u.display_name,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`).get(th); if(!row)return null; if(Date.parse(row.expires_at)<=Date.now()){db.prepare('DELETE FROM sessions WHERE token_hash=?').run(th);return null} return {id:Number(row.id),email:row.email,displayName:row.display_name};}
function requireUser(req,res){const u=sessionUser(req); if(!u){json(res,401,{error:'authentication required'}); return null;} return u;}
function setSession(res,userId){const token=b64url(crypto.randomBytes(32)), tokenHash=hashToken(token), exp=new Date(Date.now()+7*86400000); db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(tokenHash,userId,exp.toISOString()); return `ember_session=${encodeURIComponent(token)}; HttpOnly; ${cookieAttrs(7*86400)}`;}
function normalizeEmail(v){const e=String(v||'').trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)&&e.length<=254?e:null;}
function passwordHash(password,salt){return crypto.scryptSync(password,salt,64).toString('hex')}

function parseBbox(value){
  const a=String(value||'').split(',').map(Number); if(a.length!==4||a.some(x=>!Number.isFinite(x)))return null;
  const [w,s,e,n]=a; if(w < -180||w>180||e<-180||e>180||s<-90||s>90||n<-90||n>90||w>=e||s>=n)return null;
  return {w,s,e,n,text:a.join(',')};
}
async function api(req,res,u){
 if(req.method==='GET'&&u.pathname==='/api/security/csrf') return json(res,200,{token:issueCsrf(res)});
 const isAuthWrite=req.method==='POST'&&['/api/auth/register','/api/auth/login','/api/auth/logout'].includes(u.pathname);
 const isScenarioWrite=(req.method==='POST'&&u.pathname==='/api/scenarios')||(req.method==='DELETE'&&/^\/api\/scenarios\/\d+$/.test(u.pathname));
 if((isAuthWrite||isScenarioWrite)&&(!validateOrigin(req,res)||!validateCsrf(req,res)))return;
 if(isAuthWrite&&hitRateLimit(req,res,'auth',12,15*60_000))return;
 if(u.pathname==='/api/overpass'&&hitRateLimit(req,res,'overpass',30,5*60_000))return;
 if(u.pathname.startsWith('/api/terrain/')&&hitRateLimit(req,res,'terrain',600,60_000))return;
 if(['/api/weather','/api/wildfires','/api/firms/status','/api/firms/hotspots','/api/geocode'].includes(u.pathname)&&hitRateLimit(req,res,'external',120,60_000))return;
 if(req.method==='GET'&&u.pathname==='/api/auth/me'){const user=sessionUser(req); return json(res,200,{authenticated:!!user,user});}
 if(req.method==='POST'&&u.pathname==='/api/auth/register'){
   const b=JSON.parse(await readBody(req)||'{}'), email=normalizeEmail(b.email), displayName=String(b.displayName||'').trim().slice(0,60), password=String(b.password||'');
   if(!email||displayName.length<2||password.length<8||password.length>128)return json(res,400,{error:'valid email, display name, and password of at least 8 characters are required'});
   const salt=b64url(crypto.randomBytes(16)), hash=passwordHash(password,salt); try{const info=db.prepare('INSERT INTO users(email,display_name,password_salt,password_hash) VALUES(?,?,?,?)').run(email,displayName,salt,hash); const cookie=setSession(res,Number(info.lastInsertRowid)); return send(res,201,JSON.stringify({authenticated:true,user:{id:Number(info.lastInsertRowid),email,displayName}}),'application/json; charset=utf-8',{'Set-Cookie':cookie});}catch(e){if(String(e.message).includes('UNIQUE'))return json(res,409,{error:'an account with that email already exists'});throw e;}
 }
 if(req.method==='POST'&&u.pathname==='/api/auth/login'){
   const b=JSON.parse(await readBody(req)||'{}'), email=normalizeEmail(b.email), password=String(b.password||''); if(!email||!password)return json(res,400,{error:'email and password required'});
   const row=db.prepare('SELECT * FROM users WHERE email=? COLLATE NOCASE').get(email); if(!row)return json(res,401,{error:'invalid email or password'}); const got=Buffer.from(passwordHash(password,row.password_salt),'hex'), want=Buffer.from(row.password_hash,'hex'); if(got.length!==want.length||!crypto.timingSafeEqual(got,want))return json(res,401,{error:'invalid email or password'}); const cookie=setSession(res,Number(row.id)); return send(res,200,JSON.stringify({authenticated:true,user:{id:Number(row.id),email:row.email,displayName:row.display_name}}),'application/json; charset=utf-8',{'Set-Cookie':cookie});
 }
 if(req.method==='POST'&&u.pathname==='/api/auth/logout'){const token=parseCookies(req).ember_session;if(token)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));return send(res,200,JSON.stringify({ok:true}),'application/json; charset=utf-8',{'Set-Cookie':`ember_session=; HttpOnly; ${cookieAttrs(0)}`});}
 if(req.method==='GET'&&u.pathname==='/api/health'){let dbOk=true;try{db.prepare('SELECT 1').get();}catch(e){dbOk=false;}return json(res,dbOk?200:503,{ok:dbOk,service:'Ember API',time:new Date().toISOString(),environment:NODE_ENV,firmsConfigured:!!process.env.FIRMS_MAP_KEY});}
 if(req.method==='GET'&&u.pathname==='/api/weather'){
   const lat=safeNum(u.searchParams.get('latitude'),-90,90),lon=safeNum(u.searchParams.get('longitude'),-180,180); if(lat===null||lon===null)return json(res,400,{error:'invalid coordinates'});
   const q=new URLSearchParams({latitude:String(lat),longitude:String(lon),current:'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_direction_10m,wind_gusts_10m',hourly:'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_direction_10m,wind_gusts_10m',wind_speed_unit:'ms',timezone:'auto',timeformat:'unixtime',forecast_days:'2'});
   const r=await cachedFetch('https://api.open-meteo.com/v1/forecast?'+q,{},300000); return send(res,r.status,r.buf,r.type);
 }
 if(req.method==='GET'&&u.pathname==='/api/wildfires'){
   const qs=u.searchParams.toString(); const r=await cachedFetch('https://eonet.gsfc.nasa.gov/api/v3/events/geojson?'+qs,{headers:{Accept:'application/geo+json,application/json'}},180000); return send(res,r.status,r.buf,r.type);
 }
 if(req.method==='GET'&&u.pathname==='/api/firms/status'){
   return json(res,200,{configured:!!process.env.FIRMS_MAP_KEY,sourceDefault:'VIIRS_NOAA20_NRT',dayRangeDefault:2});
 }
 if(req.method==='GET'&&u.pathname==='/api/firms/hotspots'){
   const key=String(process.env.FIRMS_MAP_KEY||'').trim();
   if(!key) return json(res,503,{error:'FIRMS_MAP_KEY is not configured',configured:false});
   const bbox=parseBbox(u.searchParams.get('bbox')); if(!bbox)return json(res,400,{error:'bbox must be west,south,east,north'});
   const allowed=new Set(['VIIRS_NOAA20_NRT','VIIRS_NOAA21_NRT','VIIRS_SNPP_NRT','MODIS_NRT']);
   const source=allowed.has(u.searchParams.get('source'))?u.searchParams.get('source'):'VIIRS_NOAA20_NRT';
   const days=Math.max(1,Math.min(5,Math.trunc(Number(u.searchParams.get('days')||2))||2));
   const url=`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/${source}/${bbox.text}/${days}`;
   const r=await cachedFetch(url,{headers:{Accept:'text/csv'}},120000);
   if(!r.ok){ const msg=r.buf.toString('utf8').slice(0,500); return json(res,r.status,{error:'NASA FIRMS request failed',status:r.status,detail:msg}); }
   const records=parseCsv(r.buf.toString('utf8')).map(x=>({
     latitude:Number(x.latitude), longitude:Number(x.longitude), brightTi4:Number(x.bright_ti4||x.brightness),
     brightTi5:Number(x.bright_ti5||x.bright_t31), scan:Number(x.scan), track:Number(x.track),
     acqDate:x.acq_date||'', acqTime:String(x.acq_time||'').padStart(4,'0'), satellite:x.satellite||'', instrument:x.instrument||'',
     confidence:x.confidence??'', version:x.version||'', frp:Number(x.frp), daynight:x.daynight||'', source
   })).filter(x=>Number.isFinite(x.latitude)&&Number.isFinite(x.longitude));
   return json(res,200,{configured:true,source,days,bbox:bbox.text,count:records.length,hotspots:records,generatedAt:new Date().toISOString()});
 }
 if(req.method==='GET'&&u.pathname==='/api/geocode'){
   const q=(u.searchParams.get('q')||'').slice(0,200); if(!q)return json(res,400,{error:'q required'});
   const r=await cachedFetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q='+encodeURIComponent(q),{headers:{'User-Agent':'EmberHackathon/1.0 (local demo)','Accept':'application/json'}},86400000); return send(res,r.status,r.buf,r.type);
 }
 if(req.method==='POST'&&u.pathname==='/api/overpass'){
   const body=JSON.parse(await readBody(req)||'{}'); const query=String(body.query||''); if(!query||query.length>20000)return json(res,400,{error:'invalid query'});
   const eps=['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter']; let last;
   for(const ep of eps){try{const r=await cachedFetch(ep,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:'data='+encodeURIComponent(query)},900000,35000); if(r.ok)return send(res,200,r.buf,r.type); last=r;}catch(e){last=e;}}
   return json(res,502,{error:'Overpass unavailable',detail:String(last&&last.status||last||'')});
 }
 const tm=u.pathname.match(/^\/api\/terrain\/(\d+)\/(\d+)\/(\d+)\.png$/); if(req.method==='GET'&&tm){
   const [z,x,y]=tm.slice(1).map(Number); if(z<0||z>15)return json(res,400,{error:'invalid tile'}); const r=await cachedFetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,{},7*86400000); return send(res,r.status,r.buf,r.type,{'Cache-Control':'public, max-age=86400'});
 }
 if(u.pathname==='/api/scenarios'&&req.method==='GET'){
   const user=requireUser(req,res); if(!user)return; const rows=db.prepare('SELECT id,name,created_at,updated_at FROM scenarios WHERE user_id=? ORDER BY updated_at DESC LIMIT 50').all(user.id); return json(res,200,{scenarios:rows});
 }
 if(u.pathname==='/api/scenarios'&&req.method==='POST'){
   const user=requireUser(req,res); if(!user)return; const b=JSON.parse(await readBody(req)||'{}'); const name=String(b.name||'Untitled scenario').trim().slice(0,100); if(!b.payload||typeof b.payload!=='object')return json(res,400,{error:'payload required'});
   const info=db.prepare('INSERT INTO scenarios(user_id,name,payload) VALUES(?,?,?)').run(user.id,name,JSON.stringify(b.payload)); return json(res,201,{id:Number(info.lastInsertRowid),name});
 }
 const sm=u.pathname.match(/^\/api\/scenarios\/(\d+)$/); if(sm&&req.method==='GET'){
   const user=requireUser(req,res); if(!user)return; const row=db.prepare('SELECT * FROM scenarios WHERE id=? AND user_id=?').get(Number(sm[1]),user.id); if(!row)return json(res,404,{error:'not found'}); row.payload=JSON.parse(row.payload); return json(res,200,row);
 }
 if(sm&&req.method==='DELETE'){const user=requireUser(req,res); if(!user)return; const info=db.prepare('DELETE FROM scenarios WHERE id=? AND user_id=?').run(Number(sm[1]),user.id); return json(res,info.changes?200:404,info.changes?{ok:true}:{error:'not found'});}
 return json(res,404,{error:'not found'});
}
function staticFile(req,res,u){let p=u.pathname==='/'?'/ember-wildfire.html':u.pathname; p=path.normalize(p).replace(/^(\.\.[/\\])+/, ''); const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory())return false; const ext=path.extname(f); const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.md':'text/markdown; charset=utf-8','.png':'image/png','.json':'application/json'}; send(res,200,fs.readFileSync(f),types[ext]||'application/octet-stream',{'Cache-Control':ext==='.html'?'no-cache':'public,max-age=3600','Vary':'Accept-Encoding'}); return true;}
const server=http.createServer(async(req,res)=>{const started=Date.now();try{const u=new URL(req.url,'http://localhost'); if(u.pathname.startsWith('/api/'))await api(req,res,u); else if(!staticFile(req,res,u))json(res,404,{error:'not found'});}catch(e){console.error(e);const code=Number(e.statusCode)||500;json(res,code,{error:code===413?'request too large':'server error',detail:NODE_ENV==='development'?String(e.message||e):undefined});}finally{if(IS_PROD)console.log(JSON.stringify({ts:new Date().toISOString(),method:req.method,url:req.url,status:res.statusCode,ms:Date.now()-started,ip:requestIp(req)}));}});
server.headersTimeout=25_000;server.requestTimeout=40_000;server.keepAliveTimeout=5_000;
server.listen(PORT,HOST,()=>console.log(`Ember ${NODE_ENV} running at http://${HOST}:${PORT} using ${DB_PATH}`));
function shutdown(signal){console.log(`${signal} received; shutting down`);server.close(()=>{try{db.close()}catch(e){}process.exit(0)});setTimeout(()=>process.exit(1),10_000).unref();}
process.on('SIGTERM',()=>shutdown('SIGTERM'));process.on('SIGINT',()=>shutdown('SIGINT'));
