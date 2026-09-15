import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Boxes,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Gem,
  Leaf,
  PackageOpen,
  Search,
  Shield,
  ShoppingBag,
  Sparkles,
  Zap,
} from 'lucide-react'
import BattleItemSprite from './BattleItemSprite'
import { useIsCompactLayout } from './useMobileLayout'
import { getUnlockedRareItems } from './data/rareRewards.js'
import {
  BATTLE_ITEMS,
  SHOP_CATEGORIES,
} from './data/shopData'

const ITEMS_PER_PAGE = 12
const COMPACT_ITEMS_PER_PAGE = 8

const CATEGORY_ICONS = {
  berry: Leaf,
  held: Shield,
  gimmick: Gem,
}

const CATEGORY_BY_ID = new Map(SHOP_CATEGORIES.map((category) => [category.id, category]))

function normalizeSearchText(value) {
  return String(value ?? '').toLocaleLowerCase().replace(/[\s_-]/g, '')
}

function ItemArtwork({ item, Icon, compact = false }) {
  const className = compact ? 'shop-owned-artwork' : 'shop-item-icon'

  return (
    <span className={className} aria-hidden="true">
      <BattleItemSprite
        item={item}
        size={compact ? 16 : 34}
        loading="lazy"
        decoding="async"
        fallback={<Icon size={compact ? 16 : 25} />}
      />
    </span>
  )
}

function ShopScreen({ balance, inventory, progress, onBack, onPurchase }) {
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const rareItems = useMemo(() => getUnlockedRareItems(progress), [progress])
  const catalogItems = useMemo(() => [...BATTLE_ITEMS, ...rareItems], [rareItems])
  const categories = useMemo(() => rareItems.length > 0 ? [...SHOP_CATEGORIES, { id: 'rewards', label: '업적 보상', eyebrow: 'EARNED REWARDS' }] : SHOP_CATEGORIES, [rareItems.length])
  const rareItemIds = useMemo(() => new Set(rareItems.map((item) => item.id)), [rareItems])

  const categoryCounts = useMemo(() => Object.fromEntries(categories.map((entry) => [
    entry.id,
    entry.id === 'all'
      ? catalogItems.length
      : entry.id === 'rewards' ? rareItems.length : catalogItems.filter((item) => item.category === entry.id).length,
  ])), [categories, catalogItems, rareItems.length])

  const filteredItems = useMemo(() => {
    const normalizedQuery = normalizeSearchText(query)

    return catalogItems.filter((item) => {
      if (category === 'rewards' && !rareItemIds.has(item.id)) return false
      if (category !== 'all' && category !== 'rewards' && item.category !== category) return false
      if (!normalizedQuery) return true

      return [item.name, item.englishName, item.id, item.sourceCategory]
        .some((value) => normalizeSearchText(value).includes(normalizedQuery))
    })
  }, [category, query, catalogItems, rareItemIds])

  // A phone cannot hold the bag and the catalog side by side, so compact
  // layouts show one at a time, give it the whole frame, and page it smaller.
  const compactLayout = useIsCompactLayout()
  const itemsPerPage = compactLayout ? COMPACT_ITEMS_PER_PAGE : ITEMS_PER_PAGE
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / itemsPerPage))
  const visibleItems = filteredItems.slice((page - 1) * itemsPerPage, page * itemsPerPage)
  const ownedItems = useMemo(
    () => catalogItems.filter((item) => rareItemIds.has(item.id) || (inventory[item.id] ?? 0) > 0),
    [inventory, catalogItems, rareItemIds],
  )
  const unownedItemCount = catalogItems.length - ownedItems.length
  const firstVisibleItem = filteredItems.length === 0 ? 0 : ((page - 1) * itemsPerPage) + 1
  const lastVisibleItem = Math.min(page * itemsPerPage, filteredItems.length)

  useEffect(() => {
    setPage(1)
  }, [category, query])

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  const [shopView, setShopView] = useState('catalog')
  const showBag = !compactLayout || shopView === 'bag'
  const showCatalog = !compactLayout || shopView === 'catalog'

  return (
    <main className={`shop-screen${rareItems.length > 0 ? ' shop-has-rewards' : ''}`}>
      <header className="shop-header">
        <button className="screen-back-button" type="button" aria-label="로비로 돌아가기" onClick={onBack}>
          <ArrowLeft size={19} />
          <span>로비</span>
        </button>

        <div className="shop-title">
          <span>CHAMPIONS BATTLE SHOP</span>
          <h1>배틀 상점</h1>
          <p>나무열매, 지닌 도구, 메가진화와 Z기술 등 실제 배틀에 장착하는 아이템만 준비했습니다.</p>
        </div>

        {compactLayout && (
          <div className="shop-view-switch" role="group" aria-label="상점 화면 선택">
            <button
              className={shopView === 'catalog' ? 'active' : ''}
              type="button"
              aria-pressed={shopView === 'catalog'}
              onClick={() => setShopView('catalog')}
            >
              구매
            </button>
            <button
              className={shopView === 'bag' ? 'active' : ''}
              type="button"
              aria-pressed={shopView === 'bag'}
              onClick={() => setShopView('bag')}
            >
              보유 {ownedItems.length}
            </button>
          </div>
        )}

        <div className="shop-wallet" aria-label={`보유 배틀 포인트 ${balance} VP`}>
          <span><Zap size={18} fill="currentColor" /></span>
          <small>보유 VP</small>
          <strong>{balance.toLocaleString()}<em>VP</em></strong>
        </div>
      </header>

      <section className={compactLayout ? `shop-workspace shop-workspace-${shopView}` : 'shop-workspace'}>
        {showBag && <aside className="shop-bag-panel">
          <div className="shop-panel-heading">
            <span><Boxes size={18} /></span>
            <div>
              <small>ITEM BAG</small>
              <h2>배틀 가방</h2>
            </div>
            <strong>{ownedItems.length}<em>종 보유</em></strong>
          </div>

          <div className="shop-bag-summary">
            <span>보유<strong>{ownedItems.length}</strong></span>
            <span>미보유<strong>{unownedItemCount}</strong></span>
          </div>

          <div className="shop-bag-list">
            {ownedItems.length > 0 ? ownedItems.map((item) => {
              const Icon = CATEGORY_ICONS[item.category]
              return (
                <div className={`shop-owned-item category-${item.category}`} key={item.id}>
                  <ItemArtwork item={item} Icon={Icon} compact />
                  <div><strong>{item.name}</strong><small>{item.effect}</small></div>
                  <em><Check size={11} /> 보유</em>
                </div>
              )
            }) : (
              <div className="shop-empty-bag">
                <PackageOpen size={34} />
                <strong>가방이 비어 있습니다</strong>
                <p>배틀 아이템을 구매하면 이곳에서 보유 상태를 확인할 수 있습니다.</p>
              </div>
            )}
          </div>

          <div className="shop-guide-card">
            <Sparkles size={17} />
            <div>
              <strong>장착형 배틀 도구 {catalogItems.length.toLocaleString()}종</strong>
              <p>한글명, 영문명 또는 도구 ID로 검색하고 분류별로 빠르게 찾아보세요.</p>
            </div>
          </div>
        </aside>}

        {showCatalog && <section className="shop-catalog-panel" aria-labelledby="shop-catalog-title">
          <div className="shop-catalog-toolbar">
            <div className="shop-catalog-title-block">
              <small>ITEM CATALOG</small>
              <h2 id="shop-catalog-title">상품 목록</h2>
            </div>

            <label className="shop-search">
              <Search size={16} />
              <input
                type="search"
                value={query}
                placeholder="아이템 이름 검색"
                aria-label="아이템 이름 검색"
                onChange={(event) => setQuery(event.target.value)}
              />
              <span>{filteredItems.length}</span>
            </label>

            <span className="shop-item-count">
              {catalogItems.length.toLocaleString()}<em> TOTAL</em>
            </span>

            <div className="shop-category-tabs" aria-label="상품 분류">
              {categories.map((entry) => (
                <button
                  className={category === entry.id ? 'active' : ''}
                  key={entry.id}
                  type="button"
                  aria-pressed={category === entry.id}
                  onClick={() => setCategory(entry.id)}
                >
                  <small>{entry.eyebrow}</small>
                  <strong>{entry.label}</strong>
                  <em>{categoryCounts[entry.id]}</em>
                </button>
              ))}
            </div>
          </div>

          <div className="shop-item-grid">
            {visibleItems.length > 0 ? visibleItems.map((item) => {
              const Icon = CATEGORY_ICONS[item.category]
              const isReward = rareItemIds.has(item.id)
              const isOwned = isReward || Boolean(inventory[item.id])
              const canAfford = balance >= item.price
              const categoryMeta = CATEGORY_BY_ID.get(item.category)

              return (
                <article className={`shop-item-card category-${item.category}${isOwned ? ' owned' : ''}${isReward ? ' shop-rare-reward' : ''}${!canAfford && !isOwned ? ' insufficient' : ''}`} key={item.id}>
                  <span className="shop-item-grade">{isReward ? '업적 한정' : item.grade}</span>
                  <ItemArtwork item={item} Icon={Icon} />
                  <div className="shop-item-name">
                    <small>{isReward ? 'EARNED REWARD · 희귀 도구' : `${categoryMeta?.eyebrow} · ${item.generation}세대`}</small>
                    <h3 title={item.englishName}>{item.name}</h3>
                  </div>
                  <span className={`shop-owned-badge ${isOwned ? 'owned' : 'unowned'}`}>
                    {isOwned ? <Check size={11} /> : <PackageOpen size={11} />}
                    {isOwned ? '보유' : '미보유'}
                  </span>
                  <p title={item.description}>{item.description}</p>
                  <div className="shop-item-effect"><Sparkles size={13} /><span>{item.effect}</span></div>
                  <footer>
                    <strong>{isReward ? <><Sparkles size={14} /> 업적 보상</> : <><Zap size={14} fill="currentColor" /> {item.price.toLocaleString()}<em>VP</em></>}</strong>
                    <button type="button" disabled={isOwned || isReward} onClick={() => { if (!isReward) onPurchase(item.id) }}>
                      {isOwned ? <Check size={14} /> : <ShoppingBag size={14} />}
                      {isReward ? '획득 완료' : isOwned ? '보유 중' : canAfford ? '구매' : 'VP 부족'}
                    </button>
                  </footer>
                </article>
              )
            }) : (
              <div className="shop-no-results">
                <Search size={30} />
                <strong>검색 결과가 없습니다</strong>
                <p>다른 이름을 입력하거나 전체 분류에서 다시 찾아보세요.</p>
              </div>
            )}
          </div>

          <footer className="shop-pagination">
            <span>{firstVisibleItem.toLocaleString()}–{lastVisibleItem.toLocaleString()} / {filteredItems.length.toLocaleString()}</span>
            <div>
              <button type="button" aria-label="첫 페이지" disabled={page === 1} onClick={() => setPage(1)}><ChevronsLeft size={15} /></button>
              <button type="button" aria-label="이전 페이지" disabled={page === 1} onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}><ChevronLeft size={15} /></button>
              <strong>{page}<em>/</em>{pageCount}</strong>
              <button type="button" aria-label="다음 페이지" disabled={page === pageCount} onClick={() => setPage((currentPage) => Math.min(pageCount, currentPage + 1))}><ChevronRight size={15} /></button>
              <button type="button" aria-label="마지막 페이지" disabled={page === pageCount} onClick={() => setPage(pageCount)}><ChevronsRight size={15} /></button>
            </div>
          </footer>
        </section>}
      </section>
    </main>
  )
}

export default ShopScreen
