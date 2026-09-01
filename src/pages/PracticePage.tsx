import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FaChevronDown, FaChevronRight, FaHome, FaSitemap } from 'react-icons/fa';
import { loadPracticeGroups, type PracticeGroup, type PracticeItem } from '../practice/data';

const CATEGORY_LABELS: Record<string, string> = {
  tsumego: '死活题',
  games: '棋谱',
  joseki: '定式',
};

const MAX_VISIBLE_ITEMS = 120;

function itemHref(item: PracticeItem): string {
  return `/practice/item?id=${encodeURIComponent(item.id)}`;
}

export function PracticePage() {
  const [groups, setGroups] = useState<PracticeGroup[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['tsumego', 'games', 'joseki']));
  const [limits, setLimits] = useState<Record<string, number>>({});

  useEffect(() => {
    let alive = true;
    void loadPracticeGroups()
      .then((nextGroups) => {
        if (!alive) return;
        setGroups(nextGroups);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const byCategory = useMemo(() => {
    const map = new Map<string, PracticeGroup[]>();
    for (const group of groups) {
      const list = map.get(group.category) ?? [];
      list.push(group);
      map.set(group.category, list);
    }
    return ['tsumego', 'games', 'joseki']
      .map((category) => ({ category, label: CATEGORY_LABELS[category] ?? category, groups: map.get(category) ?? [] }))
      .filter((entry) => entry.groups.length > 0);
  }, [groups]);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const showMore = (key: string) => {
    setLimits((prev) => ({ ...prev, [key]: (prev[key] ?? MAX_VISIBLE_ITEMS) + MAX_VISIBLE_ITEMS }));
  };

  return (
    <main className="practice-shell">
      <header className="practice-header">
        <div>
          <Link to="/" className="home-button" aria-label="返回主页">
            <FaHome aria-hidden="true" />主页
          </Link>
        </div>
        <h1><FaSitemap aria-hidden="true" />练习题库</h1>
      </header>

      {loading && <div className="practice-status">正在载入题库…</div>}
      {error && <div className="practice-status practice-error">{error}</div>}

      {!loading && !error && (
        <div className="practice-tree">
          {byCategory.map(({ category, label, groups }) => {
            const isOpen = expanded.has(category);
            return (
              <section className="practice-category" key={category}>
                <button
                  type="button"
                  className="practice-category-toggle"
                  onClick={() => toggle(category)}
                  aria-expanded={isOpen}
                >
                  {isOpen ? <FaChevronDown /> : <FaChevronRight />}
                  <span>{label}</span>
                  <small>{groups.reduce((sum, group) => sum + group.items.length, 0)}</small>
                </button>
                {isOpen && (
                  <div className="practice-group-list">
                    {groups.map((group) => {
                      const groupKey = group.id;
                      const groupOpen = expanded.has(groupKey);
                      const visible = group.items.slice(0, limits[groupKey] ?? MAX_VISIBLE_ITEMS);
                      return (
                        <div className="practice-group" key={groupKey}>
                          <button
                            type="button"
                            className="practice-group-toggle"
                            onClick={() => toggle(groupKey)}
                            aria-expanded={groupOpen}
                          >
                            {groupOpen ? <FaChevronDown /> : <FaChevronRight />}
                            <span>{group.title}</span>
                            <small>{group.items.length}</small>
                          </button>
                          {group.subtitle && <p className="practice-group-subtitle">{group.subtitle}</p>}
                          {groupOpen && (
                            <div className="practice-item-list">
                              {visible.map((item) => (
                                <Link className="practice-item" to={itemHref(item)} key={item.id}>
                                  <span className="practice-item-title">{item.title}</span>
                                  {item.level != null && <span className="practice-level">L{item.level}</span>}
                                  {item.hasSolutions && <span className="practice-solution-badge">有解</span>}
                                  {!item.hasSolutions && item.category === 'tsumego' && <span className="practice-position-badge">摆题</span>}
                                </Link>
                              ))}
                              {group.items.length > visible.length && (
                                <button type="button" className="practice-more" onClick={() => showMore(groupKey)}>
                                  再显示 {MAX_VISIBLE_ITEMS} 题
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
      <footer className="practice-source">
        <a href="/data/SOURCES.md" target="_blank" rel="noreferrer">数据来源与授权说明</a>
      </footer>
    </main>
  );
}
