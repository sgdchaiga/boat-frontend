import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const cors = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods":"POST, OPTIONS" };
const json = (body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok",{headers:cors});
  if (req.method !== "POST") return json({error:"Method not allowed"},405);
  const supabaseUrl=Deno.env.get("SUPABASE_URL"), anonKey=Deno.env.get("SUPABASE_ANON_KEY"), openaiKey=Deno.env.get("OPENAI_API_KEY");
  if(!supabaseUrl||!anonKey) return json({error:"Supabase function environment is incomplete"},500);
  if(!openaiKey) return json({error:"AI modelling is not configured. Add OPENAI_API_KEY to Supabase function secrets."},503);
  const authHeader=req.headers.get("Authorization")??"";
  const client=createClient(supabaseUrl,anonKey,{global:{headers:{Authorization:authHeader}}});
  const {data:userData}=await client.auth.getUser();
  if(!userData.user) return json({error:"Unauthorized"},401);
  const body=await req.json().catch(()=>null) as any;
  const organizationId=String(body?.organization_id??"");
  if(!organizationId) return json({error:"organization_id is required"},400);
  const membership=await client.rpc("user_is_member_of_org",{p_org_id:organizationId});
  const platformAdmin=await client.rpc("is_platform_admin");
  if(!membership.data&&!platformAdmin.data) return json({error:"Forbidden"},403);
  const modelContext=body?.model_context;
  if(!modelContext||JSON.stringify(modelContext).length>30000) return json({error:"Model context is missing or too large"},400);

  const schema={type:"object",additionalProperties:false,required:["summary","suggestions"],properties:{summary:{type:"string"},suggestions:{type:"array",maxItems:8,items:{type:"object",additionalProperties:false,required:["id","category","title","rationale","target","recommendedValue","impact","confidence"],properties:{id:{type:"string"},category:{type:"string",enum:["revenue","cost","working-capital","financing","tax","risk"]},title:{type:"string"},rationale:{type:"string"},target:{type:"string",enum:["annualCustomerGrowth","churnRate","grossMargin","annualPayroll","annualOverheads","opexInflation","interestRate","loanTerm","receivableDays","inventoryDays","payableDays","review-only"]},recommendedValue:{type:["number","null"]},impact:{type:"string"},confidence:{type:"string",enum:["low","medium","high"]}}}}}};
  const prompt=`Review this financial model as an African investment-modelling adviser. Identify missing or implausible assumptions, lender risks, and practical improvements. Never present tax or legal advice as certain. Only recommend a numeric value when the supplied model supports it; otherwise use target review-only and recommendedValue null. Suggestions are proposals requiring explicit user confirmation.\n\nMODEL CONTEXT:\n${JSON.stringify(modelContext)}`;
  const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${openaiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model:Deno.env.get("OPENAI_FINANCIAL_MODEL")??"gpt-5.6-terra",input:[{role:"system",content:[{type:"input_text",text:"You are a cautious financial modelling reviewer. Return only schema-compliant analysis grounded in supplied figures."}]},{role:"user",content:[{type:"input_text",text:prompt}]}],text:{format:{type:"json_schema",name:"financial_model_review",strict:true,schema}}})});
  const result=await response.json();
  if(!response.ok) return json({error:result?.error?.message??"OpenAI request failed"},502);
  const outputText=result.output_text??result.output?.flatMap((item:any)=>item.content??[]).find((item:any)=>item.type==="output_text")?.text;
  if(!outputText) return json({error:"The AI response did not contain review output"},502);
  try{return json({ok:true,review:JSON.parse(outputText),model:result.model});}catch{return json({error:"The AI response could not be validated"},502);}
});
