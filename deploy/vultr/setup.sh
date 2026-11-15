#!/usr/bin/env bash
set -euo pipefail
# Run only after inspecting the existing host. Does not replace websites or firewall policy.
for account in wisprno wisprno-target; do
  id "$account" >/dev/null 2>&1 || useradd --system --home "/var/lib/$account" --shell /usr/sbin/nologin "$account"
  install -d -m 700 -o "$account" -g "$account" "/var/lib/$account"
done
install -d -m 700 -o wisprno -g wisprno /var/lib/wisprno/results
install -d -m 700 /etc/wisprno
install -d /opt/wisprno/releases /opt/wisprno-target/releases /root/wisprno-backups
if [ ! -x /opt/node/bin/node ]; then
  cd /tmp
  curl -fsSLO https://nodejs.org/dist/v24.22.3/node-v24.22.3-linux-x64.tar.xz
  curl -fsSL https://nodejs.org/dist/v24.22.3/SHASUMS256.txt -o node-shasums.txt
  grep ' node-v24.22.3-linux-x64.tar.xz$' node-shasums.txt | sha256sum -c -
  tar -xJf node-v24.22.3-linux-x64.tar.xz -C /opt
  ln -s /opt/node-v24.22.3-linux-x64 /opt/node
fi
