const express = require("express");
const path = require("path");
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
app.use(express.json({ limit: "100kb" }));
app.use("/api", rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false }));
const authMiddleware = process.env.CLERK_SECRET_KEY ? clerkMiddleware() : (req, res, next) => next();
app.use(authMiddleware);

function requireDatabase(req,res,next){if(!pool)return res.status(503).json({error:"Database is not configured yet."});next();}
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 );
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
 `);
}
app.get("/healthz",(req,res)=>res.json({ok:true,databaseConfigured:Boolean(pool),clerkConfigured:Boolean(process.env.CLERK_PUBLISHABLE_KEY&&process.env.CLERK_SECRET_KEY)}));
app.get("/api/config",(req,res)=>res.json({clerkPublishableKey:process.env.CLERK_PUBLISHABLE_KEY||""}));
app.get("/api/me",requireUser,requireDatabase,async(req,res)=>{
 try{
  await pool.query("INSERT INTO business_profiles(clerk_user_id) VALUES($1) ON CONFLICT DO NOTHING",[req.userId]);
  const [profile,leads]=await Promise.all([
   pool.query("SELECT business_name,business_type,business_phone,service_area,business_hours,instructions,updated_at FROM business_profiles WHERE clerk_user_id=$1",[req.userId]),
   pool.query("SELECT id,name,phone,email,service_requested,source,created_at FROM leads WHERE clerk_user_id=$1 ORDER BY created_at DESC LIMIT 20",[req.userId])
  ]);
  res.json({profile:profile.rows[0]||null,leads:leads.rows});
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
