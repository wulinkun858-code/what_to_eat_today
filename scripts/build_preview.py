"""把真实 WXSS 转成浏览器可渲染的预览页。

- rpx → px（375pt 屏：1rpx = 0.5px），保证预览与小程序等比；
- 页面级选择器按屏加作用域前缀，避免三个页面的同名类互相污染；
- 只做视觉转译，不改任何设计值。
"""
import re

def conv(css):
    css = re.sub(r'^\s*@import[^;]+;', '', css, flags=re.M)
    css = re.sub(r'(-?[\d.]+)rpx', lambda m: '%gpx' % (float(m.group(1)) * 0.5), css)
    css = re.sub(r'^page\s*\{', '.screen {', css, flags=re.M)
    return css


def scope(css, prefix):
    out, i = [], 0
    while i < len(css):
        j = css.find('{', i)
        if j < 0:
            out.append(css[i:])
            break
        sel = css[i:j].strip()
        depth, k = 1, j + 1
        while depth > 0 and k < len(css):
            if css[k] == '{':
                depth += 1
            elif css[k] == '}':
                depth -= 1
            k += 1
        body = css[j + 1:k - 1]
        if sel.startswith('@keyframes') or sel.startswith('@media'):
            out.append('%s{%s}' % (sel, body))
        else:
            parts = [p.strip() for p in sel.split(',')]
            scoped = ', '.join('%s %s' % (prefix, p) for p in parts if p)
            out.append('%s{%s}' % (scoped, body))
        i = k
    return '\n'.join(out)


def read(p):
    return conv(open(p, encoding='utf-8').read())


tokens = read('styles/tokens.wxss')
base = read('styles/base.wxss')
components = read('styles/components.wxss')
dock = read('custom-tab-bar/index.wxss')
navbar = read('components/nav-bar/index.wxss')
list_css = scope(read('pages/list/list.wxss'), '.list-scope')
detail_css = scope(read('pages/detail/detail.wxss'), '#s-detail')
my_css = scope(read('pages/my/my.wxss'), '#s-my')

CSS = '\n'.join([tokens, base, components, dock, navbar, list_css, detail_css, my_css])

PREVIEW_CSS = """
body {
  margin: 0;
  padding: 48px 44px 64px;
  background: #0C0C0E;
  font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
  display: flex;
  gap: 36px;
  align-items: flex-start;
}
.stage { display: flex; flex-direction: column; gap: 14px; }
.cap { color: #8B8378; font-size: 13px; letter-spacing: 1px; text-align: center; }
.cap b { color: #E7DCC7; font-weight: 600; }
.device {
  width: 375px; height: 812px; border-radius: 44px; overflow: hidden;
  position: relative; background: #000;
  box-shadow: 0 30px 80px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.07);
}
.screen { width: 375px; height: 812px; position: relative; overflow: hidden; }
* { box-sizing: border-box; }
.screen .page { min-height: 812px !important; }
.screen input { background: transparent; border: 0; outline: none; }
.screen input::placeholder { color: var(--band-ink-3); }
.screen .nav, .screen .dock, .screen .navbar, .screen .bar, .screen .tab-scrim,
.screen .fly { position: absolute; }
.screen .dock { bottom: 8px; }
.screen .tab-scrim { height: 98px; }
"""

LIST = """
<div class="screen theme-paper list-scope" id="s-list">
  <div class="page">
    <div class="nav" style="padding-top:44px">
      <div class="nav__bar" style="height:44px">
        <div class="theme-seal"><span class="theme-seal__char">日</span></div>
        <div class="nav__brand">
          <span class="nav__brand-main">坤坤食帖</span>
          <span class="nav__brand-sub">今日 · 第 296 帖</span>
        </div>
      </div>
      <div class="nav__search">
        <div class="search">
          <div class="search__lens"></div>
          <input class="search__input" placeholder="寻味：菜名 / 食材 / 口味" />
        </div>
        <div class="search__btn">寻</div>
      </div>
    </div>
    <div class="nav__placeholder" style="height:142px"></div>

    <div class="masthead">
      <div class="masthead__side"><div class="vlabel">食帖</div></div>
      <div class="masthead__main">
        <div class="kicker">灶火正旺 · 今日</div>
        <div class="masthead__title">今天吃什么</div>
        <div class="masthead__meta"><span class="num">12</span><span>道菜 · 现点现炒</span></div>
      </div>
      <div class="masthead__actions">
        <div class="write"><span class="write__char">写</span><span class="write__label">菜牌</span></div>
      </div>
    </div>

    <div class="feature">
      <div class="feature__swiper" style="display:flex;align-items:center;padding:0 16px">
        <div class="feature__item feature__item--on" style="width:100%">
          <img class="feature__img" src="v4/img/braise.jpg" />
          <div class="feature__veil"></div>
          <div class="feature__mark">今日灶火</div>
          <div class="feature__caption">红烧肉</div>
        </div>
      </div>
      <div class="feature__dots">
        <div class="feature__dot feature__dot--on"></div>
        <div class="feature__dot"></div>
        <div class="feature__dot"></div>
      </div>
    </div>

    <div class="cats">
      <div class="cats__row">
        <div class="cat cat--on"><span class="cat__text">全部</span></div>
        <div class="cat"><span class="cat__text">硬菜</span></div>
        <div class="cat"><span class="cat__text">时蔬</span></div>
        <div class="cat"><span class="cat__text">汤水</span></div>
        <div class="cat"><span class="cat__text">主食</span></div>
      </div>
    </div>

    <div class="list-head">
      <span class="list-head__title">全部菜品</span>
      <span class="list-head__count num">12 道</span>
    </div>

    <div class="menu-grid">
      {{CARDS}}
    </div>
    <div class="feed-foot"><span>到底了</span></div>
    <div class="tab-scrim"></div>
  </div>

  <div class="dock theme-paper">
    <div class="dock__tabs">
      <div class="dock__mark"></div>
      <div class="dock__tab dock__tab--on"><span class="dock__tab-text">首页</span></div>
      <div class="dock__tab"><span class="dock__tab-text">留言</span></div>
      <div class="dock__tab"><span class="dock__tab-text">档案</span></div>
    </div>
    <div class="dock__cart dock__cart--on">
      <span class="dock__cart-count num">3</span>
      <span class="dock__cart-label">去落单</span>
    </div>
  </div>
</div>
"""

CARD = """
<div class="dish-cell">
  <div class="dish-card">
    <div class="dish-card__media">
      <img class="dish-card__img" src="v4/img/%s.jpg" />
      <div class="dish-card__idx num">%s</div>
    </div>
    <div class="dish-card__body">
      <span class="dish-card__name clamp2">%s</span>
      <span class="dish-card__desc text-ellipsis">%s</span>
      <div class="dish-card__foot">
        <div class="dish-card__tags">%s</div>
        <div class="want">想吃</div>
      </div>
    </div>
  </div>
</div>
"""

cards = [
    ('braise', '01', '红烧肉', '五花三层，慢火收汁', '硬菜 家常'),
    ('green', '02', '清炒时蔬', '当季青菜，蒜香起锅', '清淡'),
    ('soup', '03', '老火例汤', '筒骨玉米，煲足三小时', '汤水'),
    ('noodle', '04', '葱油拌面', '手擀面，葱油现熬', '主食'),
]
cards_html = ''.join(
    CARD % (img, idx, name, desc, ''.join('<span class="dish-card__tag">%s</span>' % t for t in tags.split()))
    for img, idx, name, desc, tags in cards
)

DETAIL = """
<div class="screen theme-paper" id="s-detail">
  <div class="page">
    <div class="navbar theme-paper navbar--overlay" style="padding-top:44px">
      <div class="navbar__bar" style="height:44px">
        <div class="navbar__back"><div class="navbar__arrow"></div></div>
      </div>
    </div>

    <div class="hero">
      <img class="hero__img" src="v4/img/braise.jpg" />
      <div class="hero__veil"></div>
      <div class="hero__dots">
        <div class="hero__dot hero__dot--on"></div>
        <div class="hero__dot"></div>
        <div class="hero__dot"></div>
      </div>
    </div>

    <div class="plate">
      <div class="plate__top">
        <div class="plate__text">
          <div class="plate__kicker">今日 · 一菜</div>
          <div class="plate__name">红烧肉</div>
          <div class="plate__chef">掌勺 · 坤叔</div>
        </div>
        <div class="seal seal--lg">坤</div>
      </div>
      <div class="plate__tags">
        <span class="chip chip--plate">硬菜</span>
        <span class="chip chip--plate">家常</span>
      </div>
    </div>

    <div class="sheet">
      <div class="section">
        <div class="section__head"><span class="section__label">简介</span><div class="section__line"></div></div>
        <div class="section__text">选五花三层，先煸后炖。冰糖炒色，黄酒代水，小火慢煨一小时，收汁到能挂住勺背。入口先甜后咸，肥而不腻。</div>
      </div>

      <div class="section">
        <div class="section__head"><span class="section__label">食材</span><div class="section__line"></div></div>
        <div class="ingredients">
          <div class="ingredient"><div class="ingredient__dot"></div><span class="ingredient__text">五花肉 800g</span></div>
          <div class="ingredient"><div class="ingredient__dot"></div><span class="ingredient__text">冰糖 40g</span></div>
          <div class="ingredient"><div class="ingredient__dot"></div><span class="ingredient__text">黄酒 300ml</span></div>
          <div class="ingredient"><div class="ingredient__dot"></div><span class="ingredient__text">生抽 2 勺</span></div>
        </div>
      </div>

      <div class="section">
        <div class="section__head"><span class="section__label">做法</span><div class="section__line"></div></div>
        <div class="step"><span class="step__no num">01</span><span class="step__text">肉切三厘米见方，冷水下锅焯净血沫，捞出擦干。</span></div>
        <div class="step"><span class="step__no num">02</span><span class="step__text">热锅下冰糖炒至枣红，下肉翻匀，加黄酒与生抽，小火一小时。</span></div>
      </div>

      <div class="section section--comment">
        <div class="section__head"><span class="section__label">留言</span><div class="section__line"></div><span class="comment-head__count num">2</span></div>
        <div class="composer">
          <div class="seal seal--sm composer__seal">坤</div>
          <input class="composer__input" placeholder="写下这次的心得" />
          <div class="composer__send">发送</div>
        </div>
        <div class="cmt">
          <div class="seal seal--sm cmt__seal">坤</div>
          <div class="cmt__body">
            <div class="cmt__text">收汁这一步真的关键，挂勺背的浓度刚好。</div>
            <div class="cmt__time">3 小时前</div>
          </div>
        </div>
        <div class="cmt">
          <div class="seal seal--sm cmt__seal">坤</div>
          <div class="cmt__body">
            <div class="cmt__text">照这个方子做了一次，家里人说比外面馆子强。</div>
            <div class="cmt__time">昨天</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
"""

MY = """
<div class="screen theme-ink" id="s-my">
  <div class="page" style="padding-top:44px">
    <div class="bookband page-head">
      <div class="page-head__text">
        <div class="bookband__title">档案</div>
        <div class="bookband__meta">厨师 · 记录每一道拿手菜</div>
      </div>
      <div class="seal">档</div>
    </div>

    <div class="archive">
      <div class="archive__top"><span class="archive__label">身份卡</span></div>
      <div class="archive__body">
        <div class="avatar">
          <div class="avatar__ph">坤</div>
          <div class="seal seal--sm avatar__badge">勺</div>
        </div>
        <div class="archive__info">
          <div class="archive__name text-ellipsis">阿坤</div>
          <div class="archive__meta"><span class="archive__role">厨师</span><span class="archive__dot">·</span><span>点一下改昵称</span></div>
        </div>
        <div class="archive__chev"></div>
      </div>
    </div>

    <div class="stats">
      <div class="stat">
        <span class="stat__num num">12</span>
        <div class="stat__label"><div class="seal seal--sm">菜</div><span>菜品</span></div>
      </div>
      <div class="stats__rule"></div>
      <div class="stat">
        <span class="stat__num num">8</span>
        <div class="stat__label"><div class="seal seal--sm">签</div><span>标签</span></div>
      </div>
    </div>

    <div class="panel">
      <div class="panel__row">
        <div class="panel__text">
          <div class="panel__label">墨夜模式</div>
          <div class="panel__desc">日间宣纸 / 灯下墨夜</div>
        </div>
        <div class="switch switch--on"><div class="switch__knob"></div></div>
      </div>
      <div class="panel__row panel__row--last">
        <div class="panel__text">
          <div class="panel__label">减弱动效</div>
          <div class="panel__desc">去掉位移与弹性，只保留淡入</div>
        </div>
        <div class="switch"><div class="switch__knob"></div></div>
      </div>
    </div>

    <div class="ledger menu">
      <div class="ledger__row menu__row">
        <div class="menu__diamond"></div>
        <div class="menu__text">
          <div class="menu__title-line"><span class="menu__title">我的食单</span></div>
          <span class="menu__desc">报餐单与制作状态</span>
        </div>
        <div class="menu__chev"></div>
      </div>
      <div class="ledger__row menu__row">
        <div class="menu__diamond"></div>
        <div class="menu__text">
          <div class="menu__title-line"><span class="menu__title">灶房</span><span class="menu__badge num">3</span></div>
          <span class="menu__desc">飞帖与在灶单</span>
        </div>
        <div class="menu__chev"></div>
      </div>
      <div class="ledger__row menu__row">
        <div class="menu__diamond"></div>
        <div class="menu__text">
          <div class="menu__title-line"><span class="menu__title">海报墙</span></div>
          <span class="menu__desc">首页顶部轮播图片</span>
        </div>
        <div class="menu__chev"></div>
      </div>
    </div>

    <div class="about">
      <div class="seal seal--sm">坤</div>
      <span class="about__line">坤坤食帖 · 云开发版</span>
    </div>

    <div class="tab-scrim"></div>
  </div>

  <div class="dock theme-ink">
    <div class="dock__tabs">
      <div class="dock__mark" style="transform:translate3d(200%,0,0)"></div>
      <div class="dock__tab"><span class="dock__tab-text">首页</span></div>
      <div class="dock__tab"><span class="dock__tab-text">留言</span></div>
      <div class="dock__tab dock__tab--on"><span class="dock__tab-text">档案</span></div>
    </div>
    <div class="dock__cart">
      <span class="dock__cart-count num">0</span>
      <span class="dock__cart-label">点菜单</span>
    </div>
  </div>
</div>
"""

LIST_INK = LIST.replace('id="s-list"', 'id="s-list-ink"').replace(
    'class="screen theme-paper"', 'class="screen theme-ink"'
).replace('theme-paper', 'theme-ink').replace('<span class="theme-seal__char">日</span>', '<span class="theme-seal__char">月</span>')

TMPL = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>坤坤食帖 · v4 重构预览</title>
<style>
{{CSS}}
{{PREVIEW}}
</style>
</head>
<body>
  <div class="stage"><div class="device">{{LIST}}</div><div class="cap"><b>首页 · 宣纸</b> · 刊头压成一行 / 单层 Dock</div></div>
  <div class="stage"><div class="device">{{LISTINK}}</div><div class="cap"><b>首页 · 墨夜</b> · 同一套结构变量</div></div>
  <div class="stage"><div class="device">{{DETAIL}}</div><div class="cap"><b>菜之一页</b> · 沉浸头图 / 横排分区</div></div>
  <div class="stage"><div class="device">{{MY}}</div><div class="cap"><b>档案</b> · 语义化开关 / 墨夜主题</div></div>
</body>
</html>
"""

LIST = LIST.replace('{{CARDS}}', cards_html)
LIST_INK = LIST_INK.replace('{{CARDS}}', cards_html)
html = (TMPL.replace('{{CSS}}', CSS)
            .replace('{{PREVIEW}}', PREVIEW_CSS)
            .replace('{{LIST}}', LIST)
            .replace('{{LISTINK}}', LIST_INK)
            .replace('{{DETAIL}}', DETAIL)
            .replace('{{MY}}', MY))

open('preview/v4-preview.html', 'w', encoding='utf-8').write(html)
print('written', len(html))
