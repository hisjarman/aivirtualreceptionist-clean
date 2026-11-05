const express = require("express");
const path = require("path");
const { verifyRetellSignature, saveRetellEvent } = require("./retell-webhook");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { Pool } = require("pg");
const { clerkMiddleware, getAuth } = require("@clerk/express");

const app = express();
const PORT = process.env.PORT || 10000;
const publicDir = path.join(__dirname, "public");
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  max: 5
}) : null;

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.post("/api/webhooks/retell", express.raw({ type: "application/json", limit: "1mb" }), async (req,res) => {
 const raw=Buffer.isBuffer(req.body)?req.body.toString("utf8"):"";
 if(!verifyRetellSignature(raw,req.get("x-retell-signature"),process.env.RETELL_API_KEY))return res.status(401).json({error:"Invalid Retell webhook signature."});
 let payload;try{payload=JSON.parse(raw)}catch{return res.status(400).json({error:"Invalid webhook JSON."})}
 if(!pool)return res.status(503).json({error:"Database is not configured."});
 try{await saveRetellEvent(pool,payload);return res.status(204).end()}catch(e){console.error("Retell webhook",e);return res.status(500).json({error:"Unable to store call event."})}
});
app.use(express.json({ limit: "100kb" }));
app.use("/api", rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false }));
const authMiddleware = process.env.CLERK_SECRET_KEY ? clerkMiddleware() : (req, res, next) => next();
app.use(authMiddleware);

function requireDatabase(req,res,next){if(!pool)return res.status(503).json({error:"Database is not configured yet."});next();}
function requireOwner(req,res,next){if(!process.env.OWNER_CLERK_USER_ID || req.userId !== process.env.OWNER_CLERK_USER_ID)return res.status(403).json({error:"Owner access required."});next();}
function requireUser(req,res,next){
  if (!process.env.CLERK_SECRET_KEY) return res.status(503).json({error:"Clerk authentication is not configured yet."});
  const { userId } = getAuth(req);
  if(!userId)return res.status(401).json({error:"Please sign in to continue."});
  req.userId=userId;next();
}
async function initDatabase(){
 if(!pool)return;
 await pool.query(`
 CREATE TABLE IF NOT EXISTS business_profiles(
  clerk_user_id TEXT PRIMARY KEY,
  business_name VARCHAR(120) NOT NULL DEFAULT '',
  business_type VARCHAR(80) NOT NULL DEFAULT 'Roofing',
  business_phone VARCHAR(40) NOT NULL DEFAULT '',
  service_area TEXT NOT NULL DEFAULT '',
  business_hours TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  retell_agent_id VARCHAR(120),
  retell_phone_number VARCHAR(40),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 );
 ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS retell_agent_id VARCHAR(120);
 ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS retell_phone_number VARCHAR(40);
 CREATE TABLE IF NOT EXISTS leads(
  id BIGSERIAL PRIMARY KEY,
  clerk_user_id TEXT NOT NULL,
  name VARCHAR(160) NOT NULL DEFAULT '',
  phone VARCHAR(40) NOT NULL DEFAULT '',
  email VARCHAR(254) NOT NULL DEFAULT '',
  service_requested TEXT NOT NULL DEFAULT '',
  source VARCHAR(80) NOT NULL DEFAULT 'dashboard',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 );
 CREATE INDEX IF NOT EXISTS leads_user_created_idx ON leads(clerk_user_id, created_at DESC);
 CREATE TABLE IF NOT EXISTS retell_calls(call_id TEXT PRIMARY KEY,clerk_user_id TEXT NOT NULL,agent_id TEXT NOT NULL,event VARCHAR(40) NOT NULL DEFAULT 'unknown',call_status VARCHAR(40),from_number VARCHAR(40),to_number VARCHAR(40),transcript TEXT,recording_url TEXT,duration_ms INTEGER,start_timestamp BIGINT,end_timestamp BIGINT,call_analysis JSONB,call_cost JSONB,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE INDEX IF NOT EXISTS retell_calls_user_updated_idx ON retell_calls(clerk_user_id,updated_at DESC);
 `);
}
app.get("/healthz",(req,res)=>res.json({ok:true,databaseConfigured:Boolean(pool),clerkConfigured:Boolean(process.env.CLERK_PUBLISHABLE_KEY&&process.env.CLERK_SECRET_KEY)}));
app.get("/api/config",(req,res)=>res.json({clerkPublishableKey:process.env.CLERK_PUBLISHABLE_KEY||""}));
app.get("/api/me",requireUser,requireDatabase,async(req,res)=>{
 try{
  await pool.query("INSERT INTO business_profiles(clerk_user_id) VALUES($1) ON CONFLICT DO NOTHING",[req.userId]);
  const [profile,leads,calls]=await Promise.all([
   pool.query("SELECT business_name,business_type,business_phone,service_area,business_hours,instructions,retell_agent_id,retell_phone_number,updated_at FROM business_profiles WHERE clerk_user_id=$1",[req.userId]),
   pool.query("SELECT id,name,phone,email,service_requested,source,created_at FROM leads WHERE clerk_user_id=$1 ORDER BY created_at DESC LIMIT 20",[req.userId]),
   pool.query("SELECT call_id,event,call_status,from_number,to_number,transcript,recording_url,duration_ms,call_analysis,updated_at FROM retell_calls WHERE clerk_user_id=$1 ORDER BY updated_at DESC LIMIT 25",[req.userId])
  ]);
  res.json({profile:profile.rows[0]||null,leads:leads.rows,calls:calls.rows});
 }catch(e){console.error("GET /api/me",e);res.status(500).json({error:"Unable to load your account."});}
});
app.put("/api/profile",requireUser,requireDatabase,async(req,res)=>{
 const b=req.body||{};
 const values=[req.userId,String(b.businessName||"").slice(0,120),String(b.businessType||"Roofing").slice(0,80),String(b.businessPhone||"").slice(0,40),String(b.serviceArea||"").slice(0,2000),String(b.businessHours||"").slice(0,500),String(b.instructions||"").slice(0,5000)];
 try{
  await pool.query(`INSERT INTO business_profiles(clerk_user_id,business_name,business_type,business_phone,service_area,business_hours,instructions)
  VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(clerk_user_id) DO UPDATE SET business_name=EXCLUDED.business_name,business_type=EXCLUDED.business_type,business_phone=EXCLUDED.business_phone,service_area=EXCLUDED.service_area,business_hours=EXCLUDED.business_hours,instructions=EXCLUDED.instructions,updated_at=NOW()`,values);
  res.json({ok:true});
 }catch(e){console.error("PUT /api/profile",e);res.status(500).json({error:"Unable to save your business profile."});}
});
app.get("/api/integrations/retell/status",requireUser,requireDatabase,async(req,res)=>{try{const r=await pool.query("SELECT retell_agent_id,retell_phone_number FROM business_profiles WHERE clerk_user_id=$1",[req.userId]);res.json({configured:Boolean(process.env.RETELL_API_KEY),agentAssigned:Boolean(r.rows[0]?.retell_agent_id),phoneAssigned:Boolean(r.rows[0]?.retell_phone_number)});}catch(e){console.error(e);res.status(500).json({error:"Unable to load Retell status."});}});
app.get("/api/admin/customers",requireUser,requireOwner,requireDatabase,async(req,res)=>{try{const r=await pool.query("SELECT clerk_user_id,business_name,business_type,business_phone,retell_agent_id,retell_phone_number,updated_at FROM business_profiles ORDER BY updated_at DESC LIMIT 200");res.json({customers:r.rows});}catch(e){console.error(e);res.status(500).json({error:"Unable to load customers."});}});
app.put("/api/admin/customers/:userId/retell",requireUser,requireOwner,requireDatabase,async(req,res)=>{const agent=String(req.body?.agentId||"").trim().slice(0,120),phone=String(req.body?.phoneNumber||"").trim().slice(0,40);if(!agent)return res.status(400).json({error:"Retell agent ID is required."});try{const r=await pool.query("UPDATE business_profiles SET retell_agent_id=$2,retell_phone_number=$3,updated_at=NOW() WHERE clerk_user_id=$1 RETURNING clerk_user_id,retell_agent_id,retell_phone_number",[req.params.userId,agent,phone]);if(!r.rowCount)return res.status(404).json({error:"Customer not found."});res.json({ok:true,receptionist:r.rows[0]});}catch(e){console.error(e);res.status(500).json({error:"Unable to assign Retell agent."});}});
app.post("/api/leads",requireUser,requireDatabase,async(req,res)=>{
 const b=req.body||{};
 try{
  const result=await pool.query("INSERT INTO leads(clerk_user_id,name,phone,email,service_requested,source) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,created_at",
  [req.userId,String(b.name||"").slice(0,160),String(b.phone||"").slice(0,40),String(b.email||"").slice(0,254),String(b.serviceRequested||"").slice(0,3000),String(b.source||"dashboard").slice(0,80)]);
  res.status(201).json({ok:true,lead:result.rows[0]});
 }catch(e){console.error("POST /api/leads",e);res.status(500).json({error:"Unable to save this lead."});}
});
app.use(express.static(publicDir,{extensions:["html"]}));
app.get("*",(req,res)=>res.sendFile(path.join(publicDir,"index.html")));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:"Unexpected server error."});});

initDatabase().then(()=>app.listen(PORT,"0.0.0.0",()=>console.log(`AIVR app listening on ${PORT}`))).catch(error=>{console.error("Database initialization failed",error);process.exit(1);});
