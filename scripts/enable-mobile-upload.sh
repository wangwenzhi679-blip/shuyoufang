#!/usr/bin/env bash
# Run on the Ubuntu deployment after pulling the current server code.
set -eu
if [ "$(id -u)" -ne 0 ]; then
  echo '请使用 sudo bash scripts/enable-mobile-upload.sh'
  exit 1
fi
config=/etc/nginx/sites-available/shuyoufang
backup="${config}.before-mobile-upload-$(date +%Y%m%d%H%M%S)"
test -f "$config"
cp -p "$config" "$backup"
python3 - "$config" <<'PY'
from pathlib import Path
import re
import sys
path = Path(sys.argv[1])
text = path.read_text()
if re.search(r'(?m)^\s*client_max_body_size\s+[^;]+;', text):
    text = re.sub(r'(?m)^(\s*)client_max_body_size\s+[^;]+;', r'\1client_max_body_size 510m;', text)
else:
    text, count = re.subn(r'(?m)^(\s*server_name\s+[^;]+;)', r'\1\n    client_max_body_size 510m;', text)
    if not count:
        raise SystemExit('未找到网站 server_name，配置未修改')
path.write_text(text)
PY
if ! nginx -t; then
  cp -p "$backup" "$config"
  echo '配置检查失败，已恢复原配置'
  exit 1
fi
systemctl reload nginx
echo '视频上传入口已支持小于 500 MB 的文件'
