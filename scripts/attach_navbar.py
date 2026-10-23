"""给二级页接入统一导航：自定义导航栏 + 顶部返回条（标题留空，书眉仍承担标题）。"""
import json
import re

PAGES = {
    'edit': '',
    'order-confirm': '',
    'my-orders': '',
    'kitchen': '',
    'user-manage': '',
    'admin-orders': '',
    'category-manage': '',
    'banner-manage': '',
}

for page in PAGES:
    jp = 'pages/%s/%s.json' % (page, page)
    with open(jp, encoding='utf-8') as f:
        cfg = json.load(f)
    cfg['navigationStyle'] = 'custom'
    cfg.setdefault('usingComponents', {})['nav-bar'] = '/components/nav-bar/index'
    with open(jp, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
        f.write('\n')

    wp = 'pages/%s/%s.wxml' % (page, page)
    src = open(wp, encoding='utf-8').read()
    if 'nav-bar' in src:
        continue
    tag = '<nav-bar title="" board="{{true}}" />' if page == 'kitchen' else '<nav-bar title="" />'
    # 在根节点之后插入
    m = re.search(r'^<view class="page[^"]*"[^>]*>\s*$', src, re.M)
    if not m:
        print('!! 未找到根节点', wp)
        continue
    idx = m.end()
    src = src[:idx] + '\n\n  ' + tag + src[idx:]
    open(wp, 'w', encoding='utf-8').write(src)
    print('ok', wp)
