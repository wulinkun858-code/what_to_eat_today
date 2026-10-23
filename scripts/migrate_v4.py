"""v4 样式迁移：把页面里的裸值收敛为令牌。

原则：
  1) 只改数值形态，不改布局结构；
  2) 字号按"语义 + 语境"映射，角标类选择器保留 20rpx 档；
  3) 动效时长/曲线全部替换为 var(--d-*) / var(--e-*)；
  4) 硬编码色只替换主题色，保留图片遮罩类的纯黑/纯白。
"""
import re
import glob

BADGE_SELECTORS = (
    'seal--sm', 'dish-card__idx', 'cart__badge', 'menu__badge',
    'image-cover', 'user-self', 'role-tag', 'status-seal',
)

FONT_MAP = {
    18: 'badge', 20: 'badge',
    26: '--fs-meta', 32: '--fs-h2', 34: '--fs-h2', 38: '--fs-h2', 40: '--fs-h2',
    44: '--fs-h1', 52: '--fs-h1', 56: '--fs-h1',
    64: '--fs-display', 68: '--fs-display', 84: '--fs-display',
}

DUR_MAP = {
    100: '--d-micro', 120: '--d-micro', 160: '--d-micro',
    180: '--d-short', 200: '--d-short', 220: '--d-short',
    240: '--d-medium', 250: '--d-medium', 260: '--d-medium',
    280: '--d-medium', 300: '--d-medium', 320: '--d-medium', 440: '--d-medium',
    360: '--d-long', 420: '--d-long', 460: '--d-long', 480: '--d-long', 520: '--d-long',
    560: '--d-sweep', 600: '--d-sweep', 1000: '--d-sweep',
    750: '--d-loop', 760: '--d-loop',
}

CURVE_MAP = [
    (r'cubic-bezier\(\s*0?\.34\s*,\s*1\.56\s*,\s*0?\.64\s*,\s*1\s*\)', 'var(--e-spring)'),
    (r'cubic-bezier\(\s*0?\.34\s*,\s*1\.4\s*,\s*0?\.64\s*,\s*1\s*\)', 'var(--e-standard)'),
    (r'cubic-bezier\(\s*0?\.22\s*,\s*1\s*,\s*0?\.36\s*,\s*1\s*\)', 'var(--e-decelerate)'),
    (r'cubic-bezier\(\s*0?\.4\s*,\s*0\s*,\s*0?\.2\s*,\s*1\s*\)', 'var(--e-standard)'),
]

COLOR_MAP = [
    (r'#FFF8EC', 'var(--seal-ink)'),
    (r'#B4381F', 'var(--seal-bg)'),
    (r'#171009', 'var(--accent-ink)'),
    (r'#EFE6D3', 'var(--bg)'),
    (r'#F8F1E1', 'var(--surface)'),
    (r'#1B1712', 'var(--ink)'),
]

BAND_ALPHA = {
    '0.62': '--band-ink-2', '0.6': '--band-ink-2', '0.55': '--band-ink-2',
    '0.5': '--band-ink-2', '0.48': 'var(--ink)',
    '0.42': '--band-ink-3', '0.36': '--band-ink-3',
    '0.25': '--band-line', '0.22': '--band-line',
    '0.18': '--band-ink-4', '0.16': '--band-ink-4',
    '0.08': '--band-fill', '0.06': '--band-fill',
}

RADIUS_MAP = {
    4: '--r-xs', 6: '--r-xs', 8: '--r-xs', 10: '--r-xs', 12: '--r-xs',
    16: '--r-md', 18: '--r-md', 20: '--r-md',
    24: '--r-lg', 28: '--r-lg', 999: '--r-pill',
}


def migrate(path):
    src = open(path, encoding='utf-8').read()
    out = []
    selector = ''
    changed = 0

    for line in src.split('\n'):
        stripped = line.strip()
        if '{' in stripped:
            selector = stripped.split('{')[0].strip().rstrip(',')

        is_motion = ('transition:' in line) or ('animation:' in line)
        new = line

        # 1. 字号
        def font_sub(m):
            nonlocal changed
            size = int(m.group(1))
            if size not in FONT_MAP:
                return m.group(0)
            target = FONT_MAP[size]
            if target == 'badge':
                if any(b in selector for b in BADGE_SELECTORS):
                    changed += 1
                    return 'font-size: var(--fs-badge)'
                changed += 1
                return 'font-size: var(--fs-caption)'
            changed += 1
            return 'font-size: var(%s)' % target

        new = re.sub(r'font-size:\s*(\d+)rpx', font_sub, new)

        # 2. 圆角
        def radius_sub(m):
            nonlocal changed
            size = int(m.group(1))
            if size not in RADIUS_MAP:
                return m.group(0)
            changed += 1
            return 'border-radius: var(%s)' % RADIUS_MAP[size]

        new = re.sub(r'border-radius:\s*(\d+)rpx', radius_sub, new)

        # 3. 动效：时长 + 曲线 + 裸 ease
        if is_motion:
            def dur_sub(m):
                nonlocal changed
                val = int(m.group(1))
                if val not in DUR_MAP:
                    return m.group(0)
                changed += 1
                return 'var(%s)' % DUR_MAP[val]

            new = re.sub(r'\b(\d{2,4})ms\b', dur_sub, new)
            for pattern, repl in CURVE_MAP:
                new, n = re.subn(pattern, repl, new)
                changed += n
            new, n = re.subn(r'(?<!-)\bease\b(?!-)', 'var(--e-standard)', new)
            changed += n

        # 4. 颜色
        for pattern, repl in COLOR_MAP:
            new, n = re.subn(pattern, repl, new)
            changed += n

        def band_sub(m):
            nonlocal changed
            alpha = m.group(1).rstrip('0').rstrip('.') if '.' in m.group(1) else m.group(1)
            key = m.group(1)
            if key in BAND_ALPHA:
                target = BAND_ALPHA[key]
                changed += 1
                return target if target.startswith('var(') else 'var(%s)' % target
            return m.group(0)

        new = re.sub(r'rgba\(246,\s*238,\s*220,\s*([0-9.]+)\)', band_sub, new)
        out.append(new)

    if changed:
        open(path, 'w', encoding='utf-8').write('\n'.join(out))
    return changed


total = 0
for f in sorted(glob.glob('pages/*/*.wxss')) + [
    'custom-tab-bar/index.wxss', 'components/theme-reveal/index.wxss'
]:
    n = migrate(f)
    total += n
    if n:
        print('%-52s %3d 处' % (f, n))
print('合计 %d 处' % total)
