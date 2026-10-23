"""第三遍：语句级处理多行动效声明（line-based 无法覆盖续行）。"""
import re
import glob

DUR = {
    100: '--d-micro', 120: '--d-micro', 160: '--d-micro',
    180: '--d-short', 200: '--d-short', 220: '--d-short',
    240: '--d-medium', 250: '--d-medium', 260: '--d-medium',
    280: '--d-medium', 300: '--d-medium', 320: '--d-medium', 440: '--d-medium',
    360: '--d-long', 420: '--d-long', 460: '--d-long', 480: '--d-long', 520: '--d-long',
    560: '--d-sweep', 600: '--d-sweep', 1000: '--d-sweep',
}
CURVES = [
    (r'cubic-bezier\(\s*0?\.34\s*,\s*1\.56\s*,\s*0?\.64\s*,\s*1\s*\)', 'var(--e-spring)'),
    (r'cubic-bezier\(\s*0?\.34\s*,\s*1\.4\s*,\s*0?\.64\s*,\s*1\s*\)', 'var(--e-standard)'),
    (r'cubic-bezier\(\s*0?\.22\s*,\s*1\s*,\s*0?\.36\s*,\s*1\s*\)', 'var(--e-decelerate)'),
    (r'cubic-bezier\(\s*0?\.4\s*,\s*0\s*,\s*0?\.2\s*,\s*1\s*\)', 'var(--e-standard)'),
]

count = [0]


def transform(m):
    text = m.group(0)
    head, body = text.split(':', 1)
    n = 0

    def dur_sub(mm):
        nonlocal n
        v = int(mm.group(1))
        if v not in DUR:
            return mm.group(0)
        n += 1
        return 'var(%s)' % DUR[v]

    body = re.sub(r'\b(\d{2,4})ms\b', dur_sub, body)
    for pat, repl in CURVES:
        body, k = re.subn(pat, repl, body)
        n += k
    body, k = re.subn(r'(?<!-)\bease\b(?!-)', 'var(--e-standard)', body)
    n += k
    body, k = re.subn(r'\bease-out\b|\bease-in-out\b', 'var(--e-standard)', body)
    n += k
    count[0] += n
    return head + ':' + body


for f in sorted(glob.glob('pages/*/*.wxss')) + [
    'custom-tab-bar/index.wxss', 'components/theme-reveal/index.wxss'
]:
    src = open(f, encoding='utf-8').read()
    before = count[0]
    out = re.sub(r'(?:transition|animation)\s*:[^;]+;', transform, src, flags=re.S)
    n = count[0] - before
    if n:
        open(f, 'w', encoding='utf-8').write(out)
        print('%-52s %3d 处' % (f, n))
print('合计 %d 处' % count[0])
