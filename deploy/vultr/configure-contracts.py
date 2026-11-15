# Run privately on the existing server after deploying source. Does not invoke models.
import pathlib,json,secrets,subprocess,hashlib,urllib.request,time,shutil,datetime
base=pathlib.Path('/etc/wisprno');base.chmod(0o711)
def load(p):return {k:json.loads(v) for k,v in (l.split('=',1) for l in p.read_text().splitlines() if '=' in l)}
harness=load(base/'harness.env');registry=[]
backup=pathlib.Path('/root/wisprno-backups')/('register-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'));backup.mkdir()
shutil.copy2(base/'harness.env',backup/'harness.env')
for name,provider,port,source,command,key in [
 ('pharmacy','gemini',4411,'src/pharmacy','/opt/wisprno-targets/pharmacy/current/.venv/bin/python -m pharmacy.server','GOOGLE_API_KEY'),
 ('utility','openai',4412,'tamarack','/opt/wisprno-targets/utility/current/.venv/bin/python -m tamarack','OPENAI_API_KEY'),
 ('clinic','anthropic',4413,'src','/opt/node/bin/node src/main.mjs','ANTHROPIC_API_KEY')]:
 path=pathlib.Path('/opt/wisprno-targets')/name/'current';user='wisprno-'+name;envfile=base/(name+'.env')
 values=load(envfile) if envfile.exists() else {'ADMIN_TOKEN':secrets.token_hex(32)}
 if envfile.exists():shutil.copy2(envfile,backup/envfile.name)
 values.setdefault('MODEL_REQUEST_LIMIT','15')
 if name=='pharmacy':values.setdefault('GEMINI_MODEL','gemini-3.5-flash-lite')
 values.update(MODEL_PROVIDER=provider,VOICE_ENABLED='false',PORT=str(port),DB_PATH='/var/lib/'+user+'/target.sqlite',CLINIC_DB_PATH='/var/lib/'+user+'/target.sqlite',SPEND_URL=harness['SPEND_URL'],SPEND_TOKEN=harness['SPEND_TOKEN'])
 values[key]=harness['GEMINI_API_KEY' if provider=='gemini' else key]
 envfile.write_text(''.join(k+'='+json.dumps(v)+'\n' for k,v in values.items()));envfile.chmod(0o600)
 tokenenv='TARGET_'+name.upper()+'_ADMIN_TOKEN';harness[tokenenv]=values['ADMIN_TOKEN']
 unit=pathlib.Path('/etc/systemd/system')/(user+'.service')
 if unit.exists():shutil.copy2(unit,backup/unit.name)
 unit.write_text(f'''[Unit]
Description=Wisprno owned synthetic {name} target
After=network.target wisprno-spend.service
[Service]
User={user}
Group={user}
WorkingDirectory={path}
EnvironmentFile={envfile}
Environment=PYTHONDONTWRITEBYTECODE=1
ExecStart={command}
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/{user}
[Install]
WantedBy=multi-user.target
''')
 files=sorted(str(p.relative_to(path)) for p in (path/source).rglob('*') if p.suffix in ('.mjs','.py') and '__pycache__' not in str(p))
 mapping={'pharmacy':['tools.py','core.py','prompt.py','store.py'],'utility':['agent.py','backend.py','prompt.py','core.py'],'clinic':['tools.mjs','guard.mjs','prompt.mjs','core.mjs','store.mjs']}[name]
 registry.append(dict(id=name,name='Owned '+name+' target',adapter='contract',scoringPolicy={'handoffLevel':'otp'} if name=='clinic' else {},directory=str(path),url='http://127.0.0.1:'+str(port),tokenEnv=tokenenv,files=files,mappingFiles=[source+'/'+f for f in mapping],stampFile=str(base/(name+'-stamp.json'))))
subprocess.run(['systemctl','daemon-reload'],check=True)
for r in registry:
 subprocess.run(['systemctl','enable','--now','wisprno-'+r['id']],check=True)
 for attempt in range(30):
  try:
   req=urllib.request.Request(r['url']+'/readiness',headers={'Authorization':'Bearer '+harness[r['tokenEnv']]})
   remote=json.load(urllib.request.urlopen(req,timeout=5));break
  except Exception:
   if attempt==29:raise
   time.sleep(1)
 digest=hashlib.sha256(json.dumps(sorted([[f,hashlib.sha256((pathlib.Path(r['directory'])/f).read_bytes()).hexdigest()] for f in r['files']]),separators=(',',':')).encode()).hexdigest()
 pathlib.Path(r['stampFile']).write_text(json.dumps({'sourceIdentity':digest,'sourceHashes':remote['sourceHashes']}))
 print(r['id'],'provider enabled:',remote['providerEnabled'],'key configured:',remote['keyConfigured'],'source files:',len(r['files']))
harness['WISPRNO_TARGETS_FILE']=str(base/'targets.json')
(base/'targets.json').write_text(json.dumps(registry));(base/'targets.json').chmod(0o644)
(base/'harness.env').write_text(''.join(k+'='+json.dumps(v)+'\n' for k,v in harness.items()));(base/'harness.env').chmod(0o600)
print('Target registry configured. No model requests sent.')
