import {DatabaseSync} from 'node:sqlite';
// Price snapshot checked 2026-11-14 against official model pricing. USD per million tokens.
// Reserve pessimistically: every serialized input byte + 10,000 framing tokens; all output tokens.
// Never refund failed requests. This is a deployment reservation ceiling, not an account billing limit.
export const PRICES:Record<string,[string,number,number]>={
 'openai:gpt-4.1-mini':['openai',.4,1.6], 'openai:gpt-4.1':['openai',2,8],
 'openai:gpt-5-nano':['openai',.05,.4],
 'gemini:gemini-3.5-flash-lite':['gemini',.3,2.5], 'gemini:gemini-3.1-flash-lite':['gemini',.25,1.5],
 'anthropic:claude-haiku-5-5':['anthropic',.5,2.5],
};
export class SpendLedger {
 readonly db:DatabaseSync;
 constructor(path:string,caps:Record<string,number>){
  this.db=new DatabaseSync(path);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS budgets(provider TEXT PRIMARY KEY,cap INTEGER NOT NULL,reserved INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS reservations(id INTEGER PRIMARY KEY,at TEXT NOT NULL,model TEXT NOT NULL,micros INTEGER NOT NULL);');
  for(const [p,cap] of Object.entries(caps)){if(!Number.isFinite(cap)||cap<0)throw Error('Invalid spend cap');this.db.prepare('INSERT OR IGNORE INTO budgets(provider,cap) VALUES(?,?)').run(p,Math.floor(cap*1e6));const r=this.db.prepare('SELECT cap FROM budgets WHERE provider=?').get(p);if(r?.cap!==Math.floor(cap*1e6))throw Error('Existing cap differs. Explicit budget migration required; no reset performed.');}
 }
 reserve(spec:string,bytes:number,output:number){
  const price=PRICES[spec];if(!price)throw Error('Model has no approved price reservation');
  if(!Number.isSafeInteger(bytes)||bytes<1||bytes>80000||!Number.isSafeInteger(output)||output<1||output>4000)throw Error('Request exceeds approved text bounds');
  const micros=Math.ceil((bytes+10000)*price[1]+output*price[2]);
  this.db.exec('BEGIN IMMEDIATE');
  try{const r=this.db.prepare('UPDATE budgets SET reserved=reserved+? WHERE provider=? AND reserved+?<=cap').run(micros,price[0],micros);if(!r.changes)throw Error('Provider dollar reservation cap reached');this.db.prepare('INSERT INTO reservations(at,model,micros) VALUES(?,?,?)').run(new Date().toISOString(),spec,micros);this.db.exec('COMMIT');return {reservedUsd:micros/1e6};}catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 status(){return this.db.prepare('SELECT provider,cap/1000000.0 AS capUsd,reserved/1000000.0 AS reservedUsd,(cap-reserved)/1000000.0 AS remainingUsd FROM budgets ORDER BY provider').all();}
 close(){this.db.close();}
}
