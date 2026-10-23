import re, glob

files = sorted(glob.glob('pages/*/*.wxss')) + ['app.wxss', 'custom-tab-bar/index.wxss']
pat = re.compile(r'font-size:\s*(\d+)rpx')
for f in files:
    lines = open(f, encoding='utf-8').read().split('\n')
    sel = ''
    for i, l in enumerate(lines):
        s = l.strip()
        if s.endswith('{'):
            sel = s[:-1].strip()
        m = pat.search(l)
        if m and int(m.group(1)) not in (22, 24, 28, 30, 36, 48, 72):
            print('%s:%d\t%s\t%s' % (f, i + 1, sel[:44], s))
