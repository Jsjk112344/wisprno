#!/usr/bin/env bash
set -euo pipefail
# Packages actual working trees. Excludes environment files, databases and raw results.
root=$(cd "$(dirname "$0")/../.." && pwd)
target=${MOCK_DIR:-/Users/justin/Desktop/Projects/voice_agent_mock}
remote=${DEPLOY_HOST:-root@66.42.95.122}
key=${DEPLOY_KEY:-/Users/justin/.ssh/id_ecdsa}
release=$(date -u +%Y%m%dT%H%M%SZ)
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cd "$root"
node scripts/build-loop-stories.ts --out "$stage/stories.json"
npm run ui:build
COPYFILE_DISABLE=1 tar --exclude='.env*' --exclude='node_modules' -czf "$stage/harness.tgz" src scripts sql ui/tiger ui/brand faultline-ui/dist package.json package-lock.json deploy/vultr
COPYFILE_DISABLE=1 tar --exclude='.env*' --exclude='node_modules' -czf "$stage/target.tgz" -C "$target" src scenarios package.json
rsync -e "ssh -i $key -o ServerAliveInterval=15" "$stage/harness.tgz" "$stage/target.tgz" "$stage/stories.json" "$remote:/root/"
ssh -i "$key" "$remote" bash -s -- "$release" <<'REMOTE'
set -euo pipefail
release=$1
# Never interrupt a current investigation, including a pending approval.
if systemctl is-active --quiet wisprno; then
 python3 - <<'PY'
import urllib.request,json,base64
values={}
for line in open('/etc/wisprno/harness.env'):
 k,_,v=line.strip().partition('=');values[k]=json.loads(v)
r=urllib.request.Request('http://127.0.0.1:4323/api/status',headers={'Authorization':'Basic '+base64.b64encode(('wisprno:'+values['DEMO_PASSCODE']).encode()).decode()})
if json.load(urllib.request.urlopen(r)).get('activeRunId'): raise SystemExit('Active investigation: deployment refused. Finish or decline it first.')
PY
fi
backup=/root/wisprno-backups/$release
mkdir -p "$backup"
cp -a /etc/caddy/Caddyfile "$backup/" 2>/dev/null || true
cp -a /etc/systemd/system/wisprno*.service "$backup/" 2>/dev/null || true
readlink /opt/wisprno/current > "$backup/harness-previous" || true
readlink /opt/wisprno-target/current > "$backup/target-previous" || true
mkdir -p /opt/wisprno/releases/$release /opt/wisprno-target/releases/$release
tar -xzf /root/harness.tgz -C /opt/wisprno/releases/$release
tar -xzf /root/target.tgz -C /opt/wisprno-target/releases/$release
cp /root/stories.json /opt/wisprno/releases/$release/stories.json
cd /opt/wisprno/releases/$release
PATH=/opt/node/bin:$PATH npm ci --omit=dev --ignore-scripts
install -d -m 700 -o wisprno -g wisprno /var/lib/wisprno/results
ln -s /var/lib/wisprno/results results
chown -R root:root /opt/wisprno/releases/$release /opt/wisprno-target/releases/$release
chmod -R a+rX /opt/wisprno/releases/$release /opt/wisprno-target/releases/$release
systemctl stop wisprno.service wisprno-target.service 2>/dev/null || true
ln -sfn /opt/wisprno/releases/$release /opt/wisprno/current
ln -sfn /opt/wisprno-target/releases/$release /opt/wisprno-target/current
cp deploy/vultr/wisprno*.service /etc/systemd/system/
cp deploy/vultr/Caddyfile /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable --now wisprno-spend
systemctl restart wisprno-spend
systemctl enable --now wisprno-target wisprno
systemctl reload caddy
ufw allow 80/tcp
ufw allow 443/tcp
printf 'Release: %s\nBackup: %s\n' "$release" "$backup"
REMOTE
