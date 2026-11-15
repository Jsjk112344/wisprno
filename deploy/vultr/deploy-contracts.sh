#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../../.." && pwd)
key=${DEPLOY_KEY:-/Users/justin/.ssh/id_ecdsa}
remote=${DEPLOY_HOST:-root@66.42.95.122}
release=$(date -u +%Y%m%dT%H%M%SZ)
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
# Explicit source/package inputs; never inspect or copy target environment files.
for name in pharmacy utility clinic; do
 case "$name" in
 pharmacy) files='src pyproject.toml uv.lock';;
 utility) files='tamarack pyproject.toml uv.lock';;
 clinic) files='src package.json package-lock.json';;
 esac
 COPYFILE_DISABLE=1 tar --exclude='__pycache__' --exclude='.env*' -czf "$stage/$name.tgz" -C "$root/target-$name" $files
done
rsync -e "ssh -i $key" "$stage/"*.tgz "$remote:/root/"
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
for name in pharmacy utility clinic; do
 user=wisprno-$name
 id "$user" >/dev/null 2>&1 || useradd --system --home "/var/lib/$user" --shell /usr/sbin/nologin "$user"
 install -d -m700 -o "$user" -g "$user" "/var/lib/$user"
 path=/opt/wisprno-targets/$name/releases/$release
 mkdir -p "$path"
 tar -xzf /root/$name.tgz -C "$path"
 if [ "$name" = clinic ]; then (cd "$path" && PATH=/opt/node/bin:$PATH npm ci --omit=dev --ignore-scripts); else (cd "$path" && UV_PYTHON_INSTALL_DIR=/opt/wisprno-python /opt/uv/bin/uv sync --frozen --no-dev --python 3.12); fi
 mkdir -p /root/wisprno-backups/contracts-$release
 readlink /opt/wisprno-targets/$name/current > /root/wisprno-backups/contracts-$release/$name-previous || true
 ln -sfn "$path" /opt/wisprno-targets/$name/current
 chmod -R a+rX "$path"
done
REMOTE
