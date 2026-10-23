"""全量静态校验：JSON / WXML 标签 / WXSS 括号 / 规范残留。"""
import glob
import json
import os
import re
import subprocess
import sys
import shutil
from pathlib import Path

os.chdir(Path(__file__).resolve().parent.parent)

errors = []
warnings = []

# ---------- JSON ----------
for f in glob.glob('**/*.json', recursive=True):
    if 'node_modules' in f or '.workbuddy' in f or 'pages.bak' in f:
        continue
    try:
        json.load(open(f, encoding='utf-8'))
    except Exception as e:
        errors.append('JSON 解析失败 %s: %s' % (f, e))

# ---------- WXML ----------
VOID = {'image', 'input', 'icon', 'progress', 'switch', 'slider', 'textarea', 'canvas'}
for f in glob.glob('pages/**/*.wxml', recursive=True) + glob.glob('components/**/*.wxml', recursive=True) + [
    'custom-tab-bar/index.wxml'
]:
    src = open(f, encoding='utf-8').read()
    src = re.sub(r'<!--.*?-->', '', src, flags=re.S)
    stack = []
    for m in re.finditer(r'<(/?)([a-zA-Z][\w-]*)([^>]*?)(/?)>', src):
        closing, tag, attrs, selfclose = m.group(1), m.group(2), m.group(3), m.group(4)
        if closing:
            if not stack:
                errors.append('%s: 多余的 </%s>' % (f, tag))
            elif stack[-1] != tag:
                errors.append('%s: </%s> 与 <%s> 不匹配' % (f, tag, stack[-1]))
            else:
                stack.pop()
        elif selfclose or tag in VOID:
            continue
        else:
            stack.append(tag)
    if stack:
        errors.append('%s: 未闭合 %s' % (f, stack))

# ---------- WXSS ----------
for f in glob.glob('pages/**/*.wxss', recursive=True) + glob.glob('components/**/*.wxss', recursive=True) + [
    'app.wxss', 'styles/tokens.wxss', 'styles/base.wxss', 'styles/components.wxss',
    'styles/theme.wxss', 'custom-tab-bar/index.wxss'
]:
    src = open(f, encoding='utf-8').read()
    src = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
    if src.count('{') != src.count('}'):
        errors.append('%s: 括号不配对 { %d / } %d' % (f, src.count('{'), src.count('}')))
    if 'transition: all' in src:
        errors.append('%s: 出现 transition: all' % f)
    if 'backdrop-filter' in src:
        errors.append('%s: 出现 backdrop-filter' % f)
    for bad in ['padding', 'width', 'height', 'top', 'left']:
        if re.search(r'transition:[^;]*\b%s\b' % bad, src):
            errors.append('%s: 过渡了布局属性 %s' % (f, bad))

# ---------- 令牌残留 ----------
for f in glob.glob('pages/**/*.wxss', recursive=True) + glob.glob('components/**/*.wxss', recursive=True) + [
    'custom-tab-bar/index.wxss'
]:
    src = open(f, encoding='utf-8').read()
    src = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
    if re.search(r'font-size:\s*\d+rpx', src):
        errors.append('%s: 仍有裸字号' % f)
    if re.search(r'border-radius:\s*\d+rpx', src):
        errors.append('%s: 仍有裸圆角' % f)
    if re.search(r'#[0-9A-Fa-f]{3,8}', src):
        warnings.append('%s: 仍有裸 hex' % f)
    if re.search(r'(transition|animation)[^;]*\d+ms', src):
        errors.append('%s: 仍有裸时长' % f)

# ---------- JS ----------
node = shutil.which('node')
if not node:
    sys.exit('Node.js is required for JavaScript validation')
for f in glob.glob('**/*.js', recursive=True):
    if 'node_modules' in f or '.workbuddy' in f or 'pages.bak' in f or 'scripts' in f:
        continue
    r = subprocess.run([node, '--check', f], capture_output=True, text=True)
    if r.returncode != 0:
        errors.append('JS 语法 %s: %s' % (f, r.stderr.strip().split('\n')[0]))

# ---------- 组件注册 ----------
for page in glob.glob('pages/*/'):
    name = Path(page).name
    wp = 'pages/%s/%s.wxml' % (name, name)
    jp = 'pages/%s/%s.json' % (name, name)
    if not os.path.exists(wp):
        continue
    wxml = open(wp, encoding='utf-8').read()
    cfg = json.load(open(jp, encoding='utf-8'))
    builtins = {'scroll-view', 'swiper-item', 'rich-text', 'web-view', 'cover-view', 'cover-image', 'block'}
    used = set(re.findall(r'<([a-z]+-[a-z-]+)', wxml)) - builtins
    declared = set(cfg.get('usingComponents', {}).keys())
    missing = used - declared
    if missing:
        errors.append('%s: 组件未注册 %s' % (jp, sorted(missing)))

print('错误 %d' % len(errors))
for e in errors:
    print('  ✗', e)
print('提醒 %d' % len(warnings))
for w in warnings:
    print('  ·', w)
sys.exit(1 if errors else 0)
