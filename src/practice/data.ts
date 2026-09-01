import type { Player } from '../types';
import { parseSgf, type SgfNode } from './sgf';

export type PracticeCategory = 'tsumego' | 'games' | 'joseki';

export interface PracticeItem {
  id: string;
  category: PracticeCategory;
  collection: string;
  title: string;
  file?: string;
  n?: number;
  level?: number;
  toPlay?: Player;
  size?: number;
  hasSolutions?: boolean;
  /** For Go Game Guru problems the index already contains the complete SGF. */
  sgf?: string;
}

export interface PracticeGroup {
  id: string;
  title: string;
  subtitle?: string;
  category: PracticeCategory;
  items: PracticeItem[];
}

interface TsumegoIndex {
  collections: Record<
    string,
    {
      id: string;
      title: string;
      file: string;
      count: number;
      levelRange?: [number, number];
      credit?: string;
      hasSolutions?: boolean;
    }
  >;
  problems: Array<{
    id: string;
    collection: string;
    n: number;
    title: string;
    level?: number;
    toPlay?: string;
    size?: number;
    hasSolutions?: boolean;
    sgf?: string;
  }>;
}

interface GameIndex {
  games: Array<{
    file: string;
    title: string;
    black?: string;
    white?: string;
    date?: string;
    result?: string;
    why?: string;
    manga?: string;
    trivia?: string;
  }>;
}

let tsumegoPromise: Promise<TsumegoIndex> | null = null;
let gamesPromise: Promise<GameIndex> | null = null;
let hikaruPromise: Promise<GameIndex> | null = null;

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`无法读取 ${url}（${response.status}）`);
  return response.json() as Promise<T>;
}

export function loadTsumegoIndex(): Promise<TsumegoIndex> {
  tsumegoPromise ??= fetchJson<TsumegoIndex>('/data/tsumego/index.json');
  return tsumegoPromise;
}

export function loadGamesIndex(): Promise<GameIndex> {
  gamesPromise ??= fetchJson<GameIndex>('/data/games/index.json');
  return gamesPromise;
}

export function loadHikaruIndex(): Promise<GameIndex> {
  hikaruPromise ??= fetchJson<GameIndex>('/data/games/hikaru/index.json');
  return hikaruPromise;
}

const publicDataUrl = (path: string): string => `/data/${path.replace(/^\/+/, '')}`;

export async function loadPracticeGroups(): Promise<PracticeGroup[]> {
  const [tsumego, games, hikaru] = await Promise.all([
    loadTsumegoIndex(),
    loadGamesIndex(),
    loadHikaruIndex(),
  ]);

  const tsumegoItems = tsumego.problems.map((problem): PracticeItem => ({
    id: problem.id,
    category: 'tsumego',
    collection: problem.collection,
    title: problem.title,
    n: problem.n,
    level: problem.level,
    toPlay: problem.toPlay === 'W' ? 'white' : 'black',
    size: problem.size,
    hasSolutions: problem.hasSolutions === true,
    sgf: problem.sgf,
  }));

  const groups: PracticeGroup[] = [];
  for (const collection of Object.values(tsumego.collections)) {
    const items = tsumegoItems.filter((item) => item.collection === collection.id);
    if (!items.length) continue;
    groups.push({
      id: `tsumego-${collection.id}`,
      title: collection.title,
      subtitle: `${collection.count} 题${collection.levelRange ? ` · 难度 ${collection.levelRange[0]}-${collection.levelRange[1]}` : ''}${collection.credit ? ` · ${collection.credit}` : ''}`,
      category: 'tsumego',
      items,
    });
  }
  groups.sort((a, b) => a.id.localeCompare(b.id));

  const famousItems: PracticeItem[] = games.games.map((game) => ({
    id: `famous/${game.file.replace(/^famous\//, '').replace(/\.sgf$/, '')}`,
    category: 'games',
    collection: 'famous',
    title: game.title,
    file: game.file,
  }));
  groups.push({
    id: 'games-famous',
    title: '名局谱',
    subtitle: 'Andries Brouwer 围棋棋谱数据库 · 精选名局',
    category: 'games',
    items: famousItems,
  });

  const hikaruItems: PracticeItem[] = hikaru.games.map((game) => ({
    id: `hikaru/${game.file.replace(/\.sgf$/, '')}`,
    category: 'games',
    collection: 'hikaru',
    title: game.title,
    file: `hikaru/${game.file}`,
  }));
  groups.push({
    id: 'games-hikaru',
    title: '棋魂对局',
    subtitle: '漫画中的真实职业棋谱',
    category: 'games',
    items: hikaruItems,
  });

  groups.push({
    id: 'joseki-kogo',
    title: "Kogo's Joseki Dictionary",
    subtitle: '1998–2014 · Gary Odom，禁止未经许可商业分发',
    category: 'joseki',
    items: [
      {
        id: 'joseki/kogo',
        category: 'joseki',
        collection: 'joseki',
        title: "Kogo's Joseki Dictionary",
        file: 'joseki/kogos-joseki-dictionary.sgf',
      },
    ],
  });

  return groups;
}

export async function loadProblemRoot(item: PracticeItem): Promise<{ root: SgfNode; sgf: string }> {
  if (item.category === 'tsumego') {
    if (item.sgf) {
      const parsed = parseSgf(item.sgf);
      const root = parsed.roots[0] ?? null;
      if (!root) throw new Error('题目 SGF 为空');
      return { root, sgf: item.sgf };
    }

    const index = await loadTsumegoIndex();
    const collection = index.collections[item.collection];
    if (!collection) throw new Error(`未知死活题集：${item.collection}`);
    const text = await fetch(publicDataUrl(`tsumego/${collection.file}`)).then((response) => {
      if (!response.ok) throw new Error(`无法读取题目文件（${response.status}）`);
      return response.text();
    });
    const parsed = parseSgf(text);
    const root = parsed.roots[0] ?? null;
    if (!root) throw new Error('题目文件为空');
    const problemIndex = Math.max(0, (item.n ?? 1) - 1);
    const problemRoot = root.children[problemIndex] ?? root;
    return { root: problemRoot, sgf: text };
  }

  if (!item.file) throw new Error('题目缺少文件路径');
  const base = item.category === 'joseki' ? item.file : `games/${item.file}`;
  const text = await fetch(publicDataUrl(base)).then((response) => {
    if (!response.ok) throw new Error(`无法读取题目文件（${response.status}）`);
    return response.text();
  });
  const parsed = parseSgf(text);
  const root = parsed.roots[0] ?? null;
  if (!root) throw new Error('题目文件为空');
  return { root, sgf: text };
}
