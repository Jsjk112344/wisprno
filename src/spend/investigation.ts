import {AsyncLocalStorage} from 'node:async_hooks';
import {DatabaseSync} from 'node:sqlite';
import {PRICES} from './ledger.ts';
export const investigationScope=new AsyncLocalStorage<InvestigationBudget>();
// Synchronous SQLite transactions reserve before dispatch, including every retry.
export class InvestigationBudget {
 readonly db:DatabaseSync; readonly id:string;
 constructor(path:string,id:string){this.id=id;this.db=new DatabaseSync(path);this.db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS investigation_budget(id TEXT PRIMARY KEY,reserved INTEGER NOT NULL DEFAULT 0,requests INTEGER NOT NULL DEFAULT 0);');this.db.prepare('INSERT OR IGNORE INTO investigation_budget(id) VALUES(?)').run(id);}
 reserve(model:string,bytes:number,output:number,count=1){const p=PRICES[model];if(!p||!Number.isSafeInteger(count)||count<1||count>8||bytes<1||bytes>80000||output<1||output>4000)throw Error('Unmetered model path or invalid request bounds.');const amount=Math.ceil(((bytes+10000)*p[1]+output*p[2])*count);const r=this.db.prepare('UPDATE investigation_budget SET reserved=reserved+?,requests=requests+? WHERE id=? AND reserved+?<=1000000 AND requests+?<=100').run(amount,count,this.id,amount,count);if(!r.changes)throw Error('Investigation $1 reservation or 100-request ceiling exhausted; evidence retained.');}
 carry(sourceId:string){const prior=this.db.prepare('SELECT reserved,requests FROM investigation_budget WHERE id=?').get(sourceId);if(!prior)return;const r=this.db.prepare('UPDATE investigation_budget SET reserved=reserved+?,requests=requests+? WHERE id=? AND reserved+?<=1000000 AND requests+?<=100').run(prior.reserved,prior.requests,this.id,prior.reserved,prior.requests);if(!r.changes)throw Error('Source mapping reservations leave insufficient investigation budget.');}
 status(){return this.db.prepare('SELECT reserved/1000000.0 AS reservedUsd,requests,1.0 AS capUsd FROM investigation_budget WHERE id=?').get(this.id);}
}
