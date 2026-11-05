import { Clerk } from "https://esm.sh/@clerk/clerk-js@5";
const $=id=>document.getElementById(id);
let clerk;
const authSection=$("auth-section"),dashboard=$("dashboard");
async function api(path,options={}) {
 const token=await clerk.session?.getToken();
 const response=await fetch(path,{...options,headers:{"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{}),...(options.headers||{})}});
 const data=await response.json().catch(()=>({}));
 if(!response.ok) throw new Error(data.error||"Request failed");
 return data;
}
function showDashboard(user) {
 authSection.classList.add("hidden");dashboard.classList.remove("hidden");
 $("welcome").textContent="Signed in as "+(user?.primaryEmailAddress?.emailAddress||user?.username||"your account");
}
async function loadDashboard() {
 const data=await api("/api/me");
 showDashboard(clerk.user);
 $("business-name").value=data.profile?.business_name||"";
 $("business-type").value=data.profile?.business_type||"Roofing";
 $("business-phone").value=data.profile?.business_phone||"";
 $("service-area").value=data.profile?.service_area||"";
 $("business-hours").value=data.profile?.business_hours||"";
 $("instructions").value=data.profile?.instructions||"";
 $("lead-count").textContent=String(data.leads?.length||0);
 $("leads-list").innerHTML=data.leads?.length?data.leads.map(l=>"<div class='panel' style='margin:10px 0;padding:12px'><strong>"+escapeHtml(l.name||"New lead")+"</strong><div>"+escapeHtml(l.phone||"")+"</div><div class='muted'>"+escapeHtml(l.created_at||"")+"</div></div>").join(""):"No leads yet.";
}
function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
async function start(){
 try{
  const config=await fetch("/api/config").then(r=>r.json());
  if(!config.clerkPublishableKey){$("config-error").classList.remove("hidden");return;}
  clerk=new Clerk(config.clerkPublishableKey);
  await clerk.load();
  if(clerk.user){clerk.mountUserButton($("user-button"));await loadDashboard();}else{
   clerk.mountSignIn($("clerk-sign-in"),{routing:"hash",signInFallbackRedirectUrl:"/app",signUpFallbackRedirectUrl:"/app"});
  }
  clerk.addListener(async ({user})=>{if(user){clerk.mountUserButton($("user-button"));try{await loadDashboard()}catch(e){console.error(e)}}else{dashboard.classList.add("hidden");authSection.classList.remove("hidden")}});
 }catch(error){console.error(error);$("config-error").textContent="Could not load authentication. Check the Clerk configuration."; $("config-error").classList.remove("hidden");}
}
$("profile-form").addEventListener("submit",async e=>{
 e.preventDefault();const f=new FormData(e.currentTarget);const body=Object.fromEntries(f.entries());
 try{await api("/api/profile",{method:"PUT",body:JSON.stringify(body)});$("profile-message").textContent="Saved."; $("profile-message").className="small success";}
 catch(err){$("profile-message").textContent=err.message;$("profile-message").className="small error";}
});
$("sign-out").addEventListener("click",()=>clerk?.signOut({redirectUrl:"/"}));
start();