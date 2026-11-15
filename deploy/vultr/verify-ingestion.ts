import {readFileSync} from 'node:fs';
import {syncBundle} from '../../src/tiger/investigations.ts';
import {connection} from '../../src/tiger/database.ts';
import assert from 'node:assert/strict';
const id=process.argv[2];
if(!/^[a-zA-Z0-9-]+$/.test(id??''))throw Error('Investigation ID required');
const bundle=JSON.parse(readFileSync('/var/lib/wisprno/results/ui/ingestion/'+id+'.bundle.json','utf8'));
await syncBundle(bundle);await syncBundle(bundle);
const db=connection();await db.connect();
try {
 const q=await db.query('SELECT count(*)::integer AS n FROM ui_investigations WHERE id=$1',[id]);
 assert.equal(q.rows[0].n,1);
 console.log(JSON.stringify({id,mode:bundle.executionMode,rows:q.rows[0].n,repeatedIngestion:true}));
}finally{await db.end();}
