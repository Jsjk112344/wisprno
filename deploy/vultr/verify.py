# Execute on the host. Reads private configuration without displaying credentials.
import json,base64,urllib.request,urllib.error
values={}
for line in open('/etc/wisprno/harness.env'):
 k,_,v=line.strip().partition('=');values[k]=json.loads(v)
auth='Basic '+base64.b64encode(('wisprno:'+values['DEMO_PASSCODE']).encode()).decode()
def request(path,method='GET',body=None,authenticated=True,origin=None):
 headers={}
 if authenticated: headers['Authorization']=auth
 if origin: headers['Origin']=origin
 req=urllib.request.Request('http://127.0.0.1:4323'+path,headers=headers,method=method,data=json.dumps(body).encode() if body is not None else None)
 try:
  with urllib.request.urlopen(req) as r:return r.status,r.read()
 except urllib.error.HTTPError as e:return e.code,e.read()
for path in ['/','/api/status','/api/history','/api/stories','/api/metrics','/tiger']:
 status,body=request(path);assert status==200,(path,status);print(path,status,len(body))
 assert request(path,authenticated=False)[0]==401
status,body=request('/api/status');data=json.loads(body);print(json.dumps(data))
assert request('/api/live','POST',{'mode':'loop','spendAuthorized':True},origin='https://evil.invalid')[0]==403
assert request('/api/live','POST',{'mode':'loop','spendAuthorized':True},origin='https://wisprno.us')[0]==503
assert request('/api/discovery/analyze','POST',{'approved':False},origin='https://wisprno.us')[0]==403
assert request('/api/live','POST',{'mode':'sip','spendAuthorized':True},origin='https://wisprno.us')[0]==403
print('Authentication, CSRF and paid-call lock verified; no model calls made.')
