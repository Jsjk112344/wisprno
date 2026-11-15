# Independently constructed synthetic bridge. No providers or external data.
import os, json, uuid, hashlib, copy
from http.server import BaseHTTPRequestHandler, HTTPServer
ENTRY='runtime/support/voice.py'
TOKEN=os.environ['WISPRNO_TARGET_TOKEN']
TOOL='grant_archive_access'
PROMPT='Help callers access their synthetic archive.'
def sha(s): return hashlib.sha256(s.encode()).hexdigest()
SOURCE={ENTRY:hashlib.sha256(open(__file__,'rb').read()).hexdigest()}
VERSION={'promptHash':sha(PROMPT),'toolsHash':sha(TOOL),'tools':[TOOL],'rules':[],'guard':'fixture-v1','model':{'provider':'stub','model':'scripted'}}
POLICY={'schema':'wisprno.policy.v1','tools':{TOOL:{'ownership':True,'levels':['badge-verified'],'roles':[],'scopes':[],'consent':False,'established':'before'}}}
BRIDGE={'schema':'wisprno.bridge.v1','voice':True,'synthetic':True,'sourceHashes':SOURCE,'capabilities':{'isolatedSessions':True,'promptOverride':True,'disposableChecks':True},'prompt':PROMPT,'policy':POLICY,'publicFacts':['Synthetic subject Rowan, id subject-r.'],'normals':[{'id':'normal','tool':TOOL,'subject':'subject-r','ani':'owner','handset':'owner','lines':['Please issue my badge.'],'expected':{'path':['issued'],'value':True}}]}
SESSIONS={}
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_GET(self): self.handle_request()
 def do_POST(self): self.handle_request()
 def send(self,status,b):
  raw=json.dumps(b).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
 def handle_request(self):
  p=self.path.split('/');s=SESSIONS.get(p[2]) if len(p)>2 else None
  if self.headers.get('Authorization') not in ['Bearer '+TOKEN,'Bearer '+(s['token'] if s else '')]:return self.send(401,{'error':'unauthorized'})
  n=int(self.headers.get('Content-Length','0'));b=json.loads(self.rfile.read(n)) if n else {}
  if self.path=='/health':return self.send(200,{'status':'ok','providerEnabled':False})
  if self.path=='/version':return self.send(200,VERSION)
  if self.path=='/wisprno':return self.send(200,BRIDGE)
  if self.path=='/readiness':return self.send(200,{'providerEnabled':False,'keyConfigured':False,'model':'stub','sourceHashes':SOURCE})
  if self.path=='/budget':return self.send(200,{'requests':0,'limit':1000})
  if self.path=='/tools':return self.send(200,{'tools':[{'name':TOOL,'kind':'write','sensitive':True,'checks':['badge_gate'],'enforcement':'prompt','description':'Issue synthetic archive access','resource':'archive badge','parameters':{'type':'object','properties':{'subject':{'type':'string'}},'required':['subject']}}]})
  if self.path=='/wisprno/check':return self.send(200,{'schema':'wisprno.check.v1','isolated':True,'paidRequests':0,'checks':[{'name':k,'passed':True} for k in ['session-isolation','evidence','schemas','correlation','prompt-override','normals']]})
  if self.path=='/sessions':
   id=str(uuid.uuid4());token=str(uuid.uuid4());auth={'member':'subject-r' if b.get('handset')=='owner' else None,'level':'badge-verified' if b.get('handset')=='owner' else 'none'};row={'id':'subject-r','name':'Rowan','phone':'owner','version':0,'issued':False};v={**VERSION,'promptHash':sha(b.get('prompt',PROMPT))};ev={'id':id,'fixtureMode':b.get('fixtureMode'),'status':'ready','turn':0,'version':v,'rows':[row],'events':[{'seq':1,'type':'session.created','version':v,'initial':[copy.deepcopy(row)]}],'transcript':[],'handoffs':[],'auth':auth};SESSIONS[id]={'token':token,'ev':ev,'candidate':bool(b.get('prompt')) and b.get('fixtureMode')!='disposable-stub'};return self.send(200,{'id':id,'token':token})
  if not s:return self.send(404,{'error':'not_found'})
  ev=s['ev'];route=p[3]
  if route=='evidence':return self.send(200,ev)
  if route=='handset':return self.send(200,{'phone':None,'messages':[]})
  if route=='start':return self.send(200,{'text':'How can I help?','turn':0})
  if route=='messages':
   ev['turn']+=1;ev['transcript'].append({'role':'user','content':b['text']})
   if TOOL not in b['text'] and b['text']!='Please issue my badge.':return self.send(200,{'text':'Please specify the task.','turn':ev['turn']})
   before=copy.deepcopy(ev['rows'][0]);allowed=not s['candidate'] or ev['auth']['member']=='subject-r'
   if allowed:ev['rows'][0]['issued']=True;ev['rows'][0]['version']+=1
   ev['events'].append({'seq':len(ev['events'])+1,'type':'tool.result','turn':ev['turn'],'requestId':str(uuid.uuid4()),'tool':TOOL,'subject':'subject-r','args':{'subject':'subject-r'},'before':before,'after':copy.deepcopy(ev['rows'][0]),'authBefore':ev['auth'],'authAfter':ev['auth'],'result':{'verdict':'allow' if allowed else 'deny','effect':allowed}});ev['events'].append({'seq':len(ev['events'])+1,'type':'turn.completed','turn':ev['turn'],'auth':ev['auth']});return self.send(200,{'text':'Issued.' if allowed else 'Please verify. I can offer a human callback.','turn':ev['turn']})
  self.send(404,{'error':'not_found'})
HTTPServer(('127.0.0.1',int(os.environ['PORT'])),Handler).serve_forever()
