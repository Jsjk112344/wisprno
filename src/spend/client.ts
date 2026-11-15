export async function reserveSpend(model:string,body:unknown,outputTokens:number){
 if(!process.env.SPEND_URL){if(process.env.PUBLIC_ORIGIN)throw Error('Spend service is not configured');return;}
 const r=await fetch(process.env.SPEND_URL+'/reserve',{method:'POST',headers:{Authorization:'Bearer '+process.env.SPEND_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({model,inputBytes:Buffer.byteLength(JSON.stringify(body)),outputTokens}),signal:AbortSignal.timeout(5000)});
 if(!r.ok)throw Error('Spend reservation refused. Check provider cap and spend service; no model request sent.');
}
export async function spendStatus(){
 if(!process.env.SPEND_URL)return {configured:false,providers:[]};
 const r=await fetch(process.env.SPEND_URL+'/status',{headers:{Authorization:'Bearer '+process.env.SPEND_TOKEN},signal:AbortSignal.timeout(5000)});
 if(!r.ok)throw Error('Spend service unavailable');return {...await r.json() as object,configured:true};
}
