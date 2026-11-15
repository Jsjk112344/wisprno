#!/usr/bin/env bash
# Update only Wisprno. Preserve target services, proxy config, secrets and spend state.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
remote=root@66.42.95.122
key=/Users/justin/.ssh/id_ecdsa
release=$(date -u +%Y%m%dT%H%M%SZ)-generic
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cd "$root"
npm run ui:build
COPYFILE_DISABLE=1 tar --exclude='.env*' --exclude='node_modules' --exclude='target-bank' -czf "$stage/harness.tgz" src scripts sql ui/tiger ui/brand faultline-ui/dist package.json package-lock.json deploy/vultr docs/plug-and-play.md
scp -i "$key" -o BatchMode=yes -o StrictHostKeyChecking=yes -o HostKeyAlgorithms=ssh-ed25519 "$stage/harness.tgz" "$remote:/root/wisprno-harness-candidate.tgz"
ssh -i "$key" -o BatchMode=yes -o StrictHostKeyChecking=yes -o HostKeyAlgorithms=ssh-ed25519 "$remote" bash -s -- "$release" <<'REMOTE'
set -euo pipefail
release=$1
previous=$(readlink -f /opt/wisprno/current)
backup=/root/wisprno-backups/$release
mkdir -p "$backup" /opt/wisprno/releases/$release
printf '%s\n' "$previous" > "$backup/harness-previous"
cp -a /etc/systemd/system/wisprno.service /etc/caddy/Caddyfile "$backup/"
tar -xzf /root/wisprno-harness-candidate.tgz -C /opt/wisprno/releases/$release
cp "$previous/stories.json" /opt/wisprno/releases/$release/stories.json
cd /opt/wisprno/releases/$release
PATH=/opt/node/bin:$PATH npm ci --omit=dev --ignore-scripts
ln -s /var/lib/wisprno/results results
chown -R root:root /opt/wisprno/releases/$release
chmod -R a+rX /opt/wisprno/releases/$release
install -m 600 -o wisprno -g wisprno /dev/null /var/lib/wisprno/results/deploying
trap 'rm -f /var/lib/wisprno/results/deploying' EXIT
python3 - <<'PY'
import urllib.request,json,base64
v={}
for line in open('/etc/wisprno/harness.env'):
 k,_,raw=line.strip().partition('=')
 if k=='DEMO_PASSCODE':v[k]=json.loads(raw)
r=urllib.request.Request('http://127.0.0.1:4323/api/status',headers={'Authorization':'Basic '+base64.b64encode(('wisprno:'+v['DEMO_PASSCODE']).encode()).decode()})
if json.load(urllib.request.urlopen(r)).get('activeRunId'):raise SystemExit('Active run or fix approval: deployment refused.')
PY
ln -sfn /opt/wisprno/releases/$release /opt/wisprno/current
if ! systemctl restart wisprno; then ln -sfn "$previous" /opt/wisprno/current; systemctl restart wisprno; exit 1; fi
healthy=false
for attempt in $(seq 1 15); do
 if curl --fail --silent http://127.0.0.1:4323/api/status > /dev/null; then healthy=true; break; fi
 sleep 1
done
if [ "$healthy" != true ]; then ln -sfn "$previous" /opt/wisprno/current; systemctl restart wisprno; echo 'Candidate failed health check; previous release restored.' >&2; exit 1; fi
printf 'Release: %s\nPrevious: %s\nBackup: %s\n' "$release" "$previous" "$backup"
REMOTE
