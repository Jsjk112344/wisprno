// Explicit allowlist from this project's environment only. Values go over SSH stdin, never stdout/argv.
import {loadEnvFile, env} from 'node:process';
/* global console, URL */
import {spawnSync} from 'node:child_process';
loadEnvFile(new URL('../../.env',import.meta.url));
const names=['OPENAI_API_KEY','ANTHROPIC_API_KEY','TIGER_DATABASE_URL'];
const values=Object.fromEntries(names.filter(k=>env[k]).map(k=>[k,env[k]]));
const script=`import sys,json,secrets,os
v=json.load(sys.stdin)
os.makedirs('/etc/wisprno',mode=0o700,exist_ok=True)
if os.path.exists('/etc/wisprno/harness.env') or os.path.exists('/etc/wisprno/target.env'): raise SystemExit('Existing configuration preserved. Edit privately on server.')
token=secrets.token_hex(32)
password=secrets.token_urlsafe(32)
h={**v,'TARGET_ADMIN_TOKEN':token,'TARGET_URL':'http://127.0.0.1:4310','MOCK_DIR':'/opt/wisprno-target/current','RESULTS_DIR':'/var/lib/wisprno/results','DEMO_STORIES_FILE':'/opt/wisprno/current/stories.json','PUBLIC_ORIGIN':'https://wisprno.us','DEMO_PASSCODE':password,'LIVE_SPEND_ENABLED':'false','CONCURRENCY':'1','TARGET_REQUEST_CAP':'100','TESTER_MODEL':'openai:gpt-4.1-mini','CALLER_MODEL':'openai:gpt-4.1-mini','FIXER_MODEL':'openai:gpt-4.1','HARNESS_REQUEST_CAP':'40','HARNESS_BUDGET_FILE':'/var/lib/wisprno/harness-budget.json'}
t={'OPENAI_API_KEY':v.get('OPENAI_API_KEY',''),'ADMIN_TOKEN':token,'PORT':'4310','DATA_DIR':'/var/lib/wisprno-target','ENABLE_PROVIDER':'true','CHAT_MODEL':'gpt-4.1-mini','MAX_PROVIDER_REQUESTS':'100'}
for name,data in [('harness',h),('target',t)]:
 path='/etc/wisprno/'+name+'.env'
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w') as f:
  for k,value in data.items(): f.write(k+'='+json.dumps(value)+'\\n')
`;
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const result=spawnSync('ssh',['-i','/Users/justin/.ssh/id_ecdsa','-o','BatchMode=yes','root@66.42.95.122','python3 -c '+quote(script)],{input:JSON.stringify(values),stdio:['pipe','pipe','pipe']});
if(result.status!==0) throw Error('Private configuration failed or already exists; inspect on server.');
console.log('Allowlisted credentials installed privately; deployment tokens generated on server.');
