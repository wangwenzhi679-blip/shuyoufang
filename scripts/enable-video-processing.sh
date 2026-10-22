#!/usr/bin/env bash
# Install the media tools and allow bounded conversion time after upload.
set -eu
if [ "$(id -u)" -ne 0 ]; then
  echo '请使用 sudo bash scripts/enable-video-processing.sh'
  exit 1
fi
apt-get update
apt-get install -y ffmpeg
ffmpeg -version | head -n 1
ffprobe -version | head -n 1
config=/etc/nginx/sites-available/shuyoufang
backup="${config}.before-video-processing-$(date +%Y%m%d%H%M%S)"
cp -p "$config" "$backup"
python3 - "$config" <<'PY'
from pathlib import Path
import re, sys
p=Path(sys.argv[1]);text=p.read_text()
text=re.sub(r'(?m)^\s*proxy_(?:read|send)_timeout\s+[^;]+;\s*$', '', text)
text,count=re.subn(r'(?m)^(\s*server_name\s+[^;]+;)', r'\1\n    proxy_read_timeout 960s;\n    proxy_send_timeout 960s;',text)
if not count: raise SystemExit('未找到网站配置，未写入')
p.write_text(text)
PY
if ! nginx -t; then
  cp -p "$backup" "$config"
  echo '配置检查失败，已恢复原配置'
  exit 1
fi
systemctl reload nginx
echo '视频处理已就绪：MKV 转换、MP4 快速开播、开头第一帧封面'
