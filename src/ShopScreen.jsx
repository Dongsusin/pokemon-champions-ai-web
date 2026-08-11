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
import {
  BATTLE_ITEM_META,
  BATTLE_ITEMS,
  SHOP_CATEGORIES,
} from './data/shopData'

const ITEMS_PER_PAGE = 12

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
  const [imageFailed, setImageFailed] = useState(false)
  const className = compact ? 'shop-owned-artwork' : 'shop-item-icon'

  return (
    <span className={className} aria-hidden="true">
      {item.sprite && !imageFailed ? (
        <img
          src={item.sprite}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <Icon size={compact ? 16 : 25} />
      )}
    </span>
  )
}

function ShopScreen({ balance, inventory, onBack, onPurchase }) {
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  const categoryCounts = useMemo(() => Object.fromEntries(SHOP_CATEGORIES.map((entry) => [
    entry.id,
    entry.id === 'all'
      ? BATTLE_ITEMS.length
      : BATTLE_ITEMS.filter((item) => item.category === entry.id).length,
  ])), [])

  const filteredItems = useMemo(() => {
    const normalizedQuery = normalizeSearchText(query)

    return BATTLE_ITEMS.filter((item) => {
      if (category !== 'all' && item.category !== category) return false
      if (!normalizedQuery) return true

      return [item.name, item.englishName, item.id, item.sourceCategory]
        .some((value) => normalizeSearchText(value).includes(normalizedQuery))
    })
  }, [category, query])

  const pageCount = Math.max(1, Math.ceil(filteredItems.length / ITEMS_PER_PAGE))
  const visibleItems = filteredItems.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)
  const ownedItems = useMemo(
    () => BATTLE_ITEMS.filter((item) => (inventory[item.id] ?? 0) > 0),
    [inventory],
  )
  const unownedItemCount = BATTLE_ITEMS.length - ownedItems.length
  const firstVisibleItem = filteredItems.length === 0 ? 0 : ((page - 1) * ITEMS_PER_PAGE) + 1
  const lastVisibleItem = Math.min(page * ITEMS_PER_PAGE, filteredItems.length)

  useEffect(() => {
    setPage(1)
  }, [category, query])

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  return (
    <main className="shop-screen">
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

        <div className="shop-wallet" aria-label={`보유 배틀 포인트 ${balance} VP`}>
          <span><Zap size={18} fill="currentColor" /></span>
          <small>보유 VP</small>
          <strong>{balance.toLocaleString()}<em>VP</em></strong>
        </div>
      </header>

      <section className="shop-workspace">
        <aside className="shop-bag-panel">
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
              <strong>장착형 배틀 도구 {BATTLE_ITEM_META.count.toLocaleString()}종</strong>
              <p>한글명, 영문명 또는 도구 ID로 검색하고 분류별로 빠르게 찾아보세요.</p>
            </div>
          </div>
        </aside>

        <section className="shop-catalog-panel" aria-labelledby="shop-catalog-title">
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
              {BATTLE_ITEMS.length.toLocaleString()}<em> TOTAL</em>
            </span>

            <div className="shop-category-tabs" aria-label="상품 분류">
              {SHOP_CATEGORIES.map((entry) => (
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
              const isOwned = Boolean(inventory[item.id])
              const canAfford = balance >= item.price
              const categoryMeta = CATEGORY_BY_ID.get(item.category)

              return (
                <article className={`shop-item-card category-${item.category}${isOwned ? ' owned' : ''}${!canAfford && !isOwned ? ' insufficient' : ''}`} key={item.id}>
                  <span className="shop-item-grade">{item.grade}</span>
                  <ItemArtwork item={item} Icon={Icon} />
                  <div className="shop-item-name">
                    <small>{categoryMeta?.eyebrow} · {item.generation}세대</small>
                    <h3 title={item.englishName}>{item.name}</h3>
                  </div>
                  <span className={`shop-owned-badge ${isOwned ? 'owned' : 'unowned'}`}>
                    {isOwned ? <Check size={11} /> : <PackageOpen size={11} />}
                    {isOwned ? '보유' : '미보유'}
                  </span>
                  <p title={item.description}>{item.description}</p>
                  <div className="shop-item-effect"><Sparkles size={13} /><span>{item.effect}</span></div>
                  <footer>
                    <strong><Zap size={14} fill="currentColor" /> {item.price.toLocaleString()}<em>VP</em></strong>
                    <button type="button" disabled={isOwned} onClick={() => onPurchase(item.id)}>
                      {isOwned ? <Check size={14} /> : <ShoppingBag size={14} />}
                      {isOwned ? '보유 중' : canAfford ? '구매' : 'VP 부족'}
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
        </section>
      </section>
    </main>
  )
}

export default ShopScreen
