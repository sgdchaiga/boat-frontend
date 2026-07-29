import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,content-type","Access-Control-Allow-Methods":"GET,OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const sha256=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))).map(byte=>byte.toString(16).padStart(2,"0")).join("");

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="GET")return json({error:"Method not allowed"},405);
  const url=Deno.env.get("SUPABASE_URL"),serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!serviceKey)return json({error:"Function environment incomplete"},500);
  const raw=(req.headers.get("Authorization")??"").replace(/^Bearer\s+/i,"").trim();
  if(!raw.startsWith("boat_fm_"))return json({error:"Unauthorized"},401);
  const client=createClient(url,serviceKey),hash=await sha256(raw);
  const {data:apiClient}=await client.from("financial_model_api_clients").select("id,organization_id,scopes,active").eq("key_hash",hash).maybeSingle();
  if(!apiClient?.active||!apiClient.scopes?.includes("models:read"))return json({error:"Unauthorized"},401);
  await client.from("financial_model_api_clients").update({last_used_at:new Date().toISOString()}).eq("id",apiClient.id);
  const modelId=new URL(req.url).searchParams.get("model_id");
  let query=client.from("financial_models").select("id,name,industry,currency,status,model_data,updated_at").eq("organization_id",apiClient.organization_id).eq("status","approved");
  if(modelId)query=query.eq("id",modelId);
  const {data,error}=await query.order("updated_at",{ascending:false});
  if(error)return json({error:"Unable to retrieve approved models"},500);
  return json({data:(data??[]).map(model=>({id:model.id,name:model.name,industry:model.industry,currency:model.currency,status:model.status,updated_at:model.updated_at,outputs:model.model_data?.publishedOutputs??null}))});
});
