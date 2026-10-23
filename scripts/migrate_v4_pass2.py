"""第二遍：把已落在刻度上的裸字号也换成令牌，并清理残余关键字曲线。"""
import re
import glob

BADGE_SELECTORS = (
    'seal--sm', 'dish-card__idx', 'cart__badge', 'menu__badge',
    'image-cover', 'user-self', 'role-tag', 'status-seal',
)

FS = {
    20: '--fs-badge', 22: '--fs-caption', 24: '--fs-meta',
    28: '--fs-body', 30: '--fs-title', 36: '--fs-h2',
    48: '--fs-h1', 72: '--fs-display',
}


def run(path):
    src = open(path, encoding='utf-8').read()
    out, selector, changed = [], '', 0
    for line in src.split('\n'):
        s = line.strip()
        if '{' in s:
            selector = s.split('{')[0].strip().rstrip(',')
        new = line

        def fs_sub(m):
            nonlocal changed
            v = int(m.group(1))
            if v not in FS:
                return m.group(0)
            if v == 20 and not any(b in selector for b in BADGE_SELECTORS):
                changed += 1
                return 'font-size: var(--fs-badge)'
            changed += 1
            return 'font-size: var(%s)' % FS[v]

        new = re.sub(r'font-size:\s*(\d+)rpx', fs_sub, new)
        if 'transition:' in new or 'animation:' in new:
            new, n1 = re.subn(r'\bease-out\b', 'var(--e-standard)', new)
            new, n2 = re.subn(r'\bease-in-out\b', 'var(--e-standard)', new)
            changed += n1 + n2
        out.append(new)

    if changed:
        open(path, 'w', encoding='utf-8').write('\n'.join(out))
    return changed


total = 0
for f in sorted(glob.glob('pages/*/*.wxss')) + [
    'custom-tab-bar/index.wxss', 'components/theme-reveal/index.wxss'
]:
    n = run(f)
    total += n
    if n:
        print('%-52s %3d 处' % (f, n))
print('合计 %d 处' % total)
