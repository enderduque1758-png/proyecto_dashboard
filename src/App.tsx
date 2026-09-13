import { useEffect, useMemo, useRef, useState } from 'react';
import { BrainCircuit, ChevronLeft, ChevronRight, Radio, RefreshCw, Search, ShieldCheck, TrendingDown, TrendingUp, Zap } from 'lucide-react';

type Side = 'LONG' | 'SHORT' | 'WATCH';
type Horizon = '1–5m' | '5–15m' | '15–30m';
type PreState = 'FORMANDO' | 'CERCA' | 'LISTO' | 'NEUTRAL';
type InterestRegime = 'LONG_BUILDUP' | 'SHORT_BUILDUP' | 'SHORT_COVERING' | 'LONG_LIQUIDATION' | 'NEUTRAL';
type Asset = { symbol: string; exchangeSymbol: string; baseAsset: string; quoteAsset: string };
type Backtest = { signals: number; wins: number; hitRate: number; avgReturn: number; avgMfe: number };
type Market = {
  price: number | null;
  funding: number | null;
  openInterest: number | null;
  oiChange: number;
  oiPrevChange: number;
  bookImbalance: number;
  flowImbalance: number;
  historyReturn20: number;
  atrPct: number;
  volumeRatio: number;
  ema20: number | null;
  ema50: number | null;
  rsi: number | null;
  closes: number[];
  available: boolean;
};
type Signal = {
  asset: Asset;
  side: Side;
  confidence: number;
  projected: number;
  score: number;
  preSide: Side;
  preProbability: number;
  horizon: Horizon;
  state: PreState;
  price: number | null;
  move1m: number;
  move5m: number;
  oiAcceleration: number;
  interestRegime: InterestRegime;
  alignment: number;
  reasons: string[];
  recommendedLeverage: number;
  leverageMin: number;
  leverageMax: number;
  leverageRisk: 'Bajo' | 'Moderado' | 'Alto';
  displacement: { conservative: number; base: number; aggressive: number } | null;
  market: Market;
};

const fallback: Asset[] = [
  { symbol: 'BTC/USDT', exchangeSymbol: 'btcusdt', baseAsset: 'BTC', quoteAsset: 'USDT' },
  { symbol: 'ETH/USDT', exchangeSymbol: 'ethusdt', baseAsset: 'ETH', quoteAsset: 'USDT' },
  { symbol: 'SOL/USDT', exchangeSymbol: 'solusdt', baseAsset: 'SOL', quoteAsset: 'USDT' },
  { symbol: 'BNB/USDT', exchangeSymbol: 'bnbusdt', baseAsset: 'BNB', quoteAsset: 'USDT' },
  { symbol: 'XRP/USDT', exchangeSymbol: 'xrpusdt', baseAsset: 'XRP', quoteAsset: 'USDT' },
  { symbol: 'DOGE/USDT', exchangeSymbol: 'dogeusdt', baseAsset: 'DOGE', quoteAsset: 'USDT' },
];
const PAGE_SIZE = 12;
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const emptyMarket = (): Market => ({ price: null, funding: null, openInterest: null, oiChange: 0, oiPrevChange: 0, bookImbalance: 0, flowImbalance: 0, historyReturn20: 0, atrPct: 0, volumeRatio: 1, ema20: null, ema50: null, rsi: null, closes: [], available: false });

function ema(values: number[], period: number) {
  if (!values.length) return null;
  const k = 2 / (period + 1);
  let current = values[0];
  for (let i = 1; i < values.length; i += 1) current = values[i] * k + current * (1 - k);
  return current;
}

function rsi(values: number[], period = 14) {
  if (values.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i += 1) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - 100 / (1 + rs);
}

function historyMetrics(rows: unknown[][]) {
  const v = rows as Array<Array<string | number>>;
  const closes = v.map(r => Number(r[4]));
  const highs = v.map(r => Number(r[2]));
  const lows = v.map(r => Number(r[3]));
  const volumes = v.map(r => Number(r[5]));
  const last = closes.at(-1) ?? 0;
  const base20 = closes.at(-21) ?? closes[0] ?? last;
  const trs: number[] = [];
  for (let i = Math.max(1, v.length - 14); i < v.length; i += 1) {
    const pc = closes[i - 1] ?? last;
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - pc), Math.abs(lows[i] - pc)));
  }
  const atr = trs.length ? trs.reduce((a, b) => a + b, 0) / trs.length : 0;
  const recentVol = volumes.slice(-5).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(5, volumes.length));
  const baseVol = volumes.slice(-50).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(50, volumes.length));
  return {
    closes: closes.slice(-40),
    historyReturn20: base20 > 0 ? ((last - base20) / base20) * 100 : 0,
    atrPct: last > 0 ? (atr / last) * 100 : 0,
    volumeRatio: baseVol > 0 ? recentVol / baseVol : 1,
    ema20: ema(closes, 20),
    ema50: ema(closes, 50),
    rsi: rsi(closes),
  };
}

function backtest(rows: unknown[][]): Backtest {
  const v = rows as Array<Array<string | number>>;
  const highs = v.map(r => Number(r[2]));
  const lows = v.map(r => Number(r[3]));
  const closes = v.map(r => Number(r[4]));
  let signals = 0;
  let wins = 0;
  const returns: number[] = [];
  const mfes: number[] = [];
  for (let i = 80; i < v.length - 16; i += 5) {
    const c = closes[i];
    if (!Number.isFinite(c) || c <= 0) continue;
    const e20 = ema(closes.slice(i - 40, i + 1), 20) ?? c;
    const e50 = ema(closes.slice(i - 60, i + 1), 50) ?? c;
    const momentum = closes[i - 5] > 0 ? ((c - closes[i - 5]) / closes[i - 5]) * 100 : 0;
    const trend = ((e20 - e50) / c) * 100;
    const strength = Math.abs(momentum * 8 + trend * 18);
    if (strength < 2.8) continue;
    const side = momentum + trend >= 0 ? 1 : -1;
    const futureHigh = Math.max(...highs.slice(i + 1, i + 16));
    const futureLow = Math.min(...lows.slice(i + 1, i + 16));
    const mfe = side > 0 ? Math.max(0, ((futureHigh - c) / c) * 100) : Math.max(0, ((c - futureLow) / c) * 100);
    const ret = (((closes[i + 15] - c) / c) * 100) * side;
    signals += 1;
    wins += mfe >= 0.12 ? 1 : 0;
    returns.push(ret);
    mfes.push(mfe);
  }
  const avg = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  return { signals, wins, hitRate: signals ? (wins / signals) * 100 : 0, avgReturn: avg(returns), avgMfe: avg(mfes) };
}

function classifyInterest(move1m: number, oiChange: number): InterestRegime {
  if (Math.abs(move1m) < 0.015 || Math.abs(oiChange) < 0.004) return 'NEUTRAL';
  if (move1m > 0 && oiChange > 0) return 'LONG_BUILDUP';
  if (move1m < 0 && oiChange > 0) return 'SHORT_BUILDUP';
  if (move1m > 0 && oiChange < 0) return 'SHORT_COVERING';
  return 'LONG_LIQUIDATION';
}

function regimeLabel(regime: InterestRegime) {
  if (regime === 'LONG_BUILDUP') return 'Nuevos largos';
  if (regime === 'SHORT_BUILDUP') return 'Nuevos cortos';
  if (regime === 'SHORT_COVERING') return 'Cierre de shorts';
  if (regime === 'LONG_LIQUIDATION') return 'Salida de longs';
  return 'OI neutral';
}

function buildSignal(asset: Asset, market: Market, bt?: Backtest): Signal {
  const price = market.price;
  const last1 = market.closes.at(-2) ?? market.closes.at(-1) ?? price ?? 0;
  const last5 = market.closes.at(-6) ?? market.closes.at(-1) ?? price ?? 0;
  const move1m = price && last1 > 0 ? ((price - last1) / last1) * 100 : 0;
  const move5m = price && last5 > 0 ? ((price - last5) / last5) * 100 : 0;
  const oiAcceleration = market.oiChange - market.oiPrevChange;
  const trend = market.ema20 && market.ema50 && market.ema50 !== 0 ? ((market.ema20 - market.ema50) / market.ema50) * 100 : 0;
  const interestRegime = classifyInterest(move1m, market.oiChange);

  const longOi = interestRegime === 'LONG_BUILDUP' ? clamp(Math.abs(market.oiChange) * 45, 4, 18) : interestRegime === 'SHORT_COVERING' ? 2 : interestRegime === 'LONG_LIQUIDATION' ? -7 : 0;
  const shortOi = interestRegime === 'SHORT_BUILDUP' ? clamp(Math.abs(market.oiChange) * 45, 4, 18) : interestRegime === 'LONG_LIQUIDATION' ? 2 : interestRegime === 'SHORT_COVERING' ? -7 : 0;
  const funding = market.funding ?? 0;
  const longEvidence =
    50 + clamp(move1m * 32, -14, 14) + clamp(move5m * 13, -10, 10) + clamp(trend * 18, -8, 8) +
    clamp(market.bookImbalance * 13, -10, 10) + clamp(market.flowImbalance * 16, -12, 12) + longOi +
    clamp((market.volumeRatio - 1) * 7, -4, 7) - clamp(funding * 160, -4, 4) + clamp(oiAcceleration * 30, -4, 4);
  const shortEvidence =
    50 - clamp(move1m * 32, -14, 14) - clamp(move5m * 13, -10, 10) - clamp(trend * 18, -8, 8) -
    clamp(market.bookImbalance * 13, -10, 10) - clamp(market.flowImbalance * 16, -12, 12) + shortOi +
    clamp((market.volumeRatio - 1) * 7, -4, 7) + clamp(funding * 160, -4, 4) - clamp(oiAcceleration * 30, -4, 4);

  const gap = Math.abs(longEvidence - shortEvidence);
  const rawPre = clamp(Math.max(longEvidence, shortEvidence), 35, 97);
  const preSide: Side = rawPre < 58 || gap < 5 ? 'WATCH' : longEvidence > shortEvidence ? 'LONG' : 'SHORT';
  const preProbability = Math.round(preSide === 'WATCH' ? Math.min(rawPre, 57) : rawPre);
  const state: PreState = preSide === 'WATCH' ? 'NEUTRAL' : preProbability >= 84 && gap >= 13 ? 'LISTO' : preProbability >= 70 ? 'CERCA' : 'FORMANDO';
  const horizon: Horizon = state === 'LISTO' ? '1–5m' : state === 'CERCA' ? '5–15m' : '15–30m';

  const directionalScore = clamp((longEvidence - shortEvidence) * 0.72, -40, 40);
  const score = Math.round(clamp(50 + directionalScore, 10, 90));
  const side: Side = score >= 60 ? 'LONG' : score <= 40 ? 'SHORT' : 'WATCH';
  const confidence = Math.round(clamp(52 + Math.abs(score - 50) * 0.9, 50, 94));
  const adjustedHit = bt?.signals ? ((bt.wins + 5) / (bt.signals + 10)) * 100 : 50;
  const mfeQuality = bt?.avgMfe ? clamp((bt.avgMfe / Math.max(market.atrPct * 1.5, 0.08)) * 65, 35, 95) : 50;

  let alignment = 50;
  if (preSide === 'LONG') {
    alignment += market.flowImbalance > 0 ? 9 : -7;
    alignment += market.bookImbalance > 0 ? 7 : -5;
    alignment += interestRegime === 'LONG_BUILDUP' ? 14 : interestRegime === 'SHORT_COVERING' ? 3 : interestRegime === 'SHORT_BUILDUP' ? -12 : 0;
    alignment += move5m > 0 ? 8 : -6;
  } else if (preSide === 'SHORT') {
    alignment += market.flowImbalance < 0 ? 9 : -7;
    alignment += market.bookImbalance < 0 ? 7 : -5;
    alignment += interestRegime === 'SHORT_BUILDUP' ? 14 : interestRegime === 'LONG_LIQUIDATION' ? 3 : interestRegime === 'LONG_BUILDUP' ? -12 : 0;
    alignment += move5m < 0 ? 8 : -6;
  } else alignment -= 12;
  alignment = Math.round(clamp(alignment, 20, 95));

  const projected = Math.round(clamp(preProbability * 0.38 + adjustedHit * 0.24 + confidence * 0.12 + mfeQuality * 0.08 + alignment * 0.18 + (state === 'LISTO' ? 3 : state === 'CERCA' ? 1 : 0), 35, 97));
  const baseMove = clamp((bt?.avgMfe || Math.max(market.atrPct, 0.08) * 1.35) * (0.8 + Math.max(0, projected - 50) / 150), 0.08, 12);
  const displacement = price && preSide !== 'WATCH' ? { conservative: baseMove * 0.68, base: baseMove, aggressive: clamp(Math.max(baseMove * 1.45, (bt?.avgMfe || baseMove) * 0.95), baseMove, 18) } : null;

  let recommendedLeverage = projected >= 90 ? 10 : projected >= 84 ? 8 : projected >= 76 ? 6 : projected >= 68 ? 4 : 2;
  if (state === 'LISTO' && alignment >= 80) recommendedLeverage += 2;
  if ((preSide === 'LONG' && interestRegime === 'LONG_BUILDUP') || (preSide === 'SHORT' && interestRegime === 'SHORT_BUILDUP')) recommendedLeverage += 1;
  if (market.atrPct >= 1.5) recommendedLeverage = Math.floor(recommendedLeverage * 0.55);
  else if (market.atrPct >= 0.9) recommendedLeverage = Math.floor(recommendedLeverage * 0.72);
  if (preSide === 'WATCH') recommendedLeverage = 2;
  recommendedLeverage = Math.round(clamp(recommendedLeverage, 2, 12));
  const leverageMin = Math.max(1, recommendedLeverage - 2);
  const leverageMax = Math.min(15, recommendedLeverage + 2);
  const leverageRisk: Signal['leverageRisk'] = recommendedLeverage <= 4 ? 'Bajo' : recommendedLeverage <= 8 ? 'Moderado' : 'Alto';

  const reasons: string[] = [];
  if (Math.abs(move1m) >= 0.03) reasons.push(`mov. 1m ${move1m >= 0 ? '+' : ''}${move1m.toFixed(2)}%`);
  if (Math.abs(move5m) >= 0.08) reasons.push(`mov. 5m ${move5m >= 0 ? '+' : ''}${move5m.toFixed(2)}%`);
  if (Math.abs(market.oiChange) >= 0.004) reasons.push(`OI ${market.oiChange >= 0 ? '+' : ''}${market.oiChange.toFixed(3)}%`);
  if (interestRegime !== 'NEUTRAL') reasons.push(regimeLabel(interestRegime));
  if (Math.abs(market.flowImbalance) >= 0.12) reasons.push(`flujo ${market.flowImbalance > 0 ? 'comprador' : 'vendedor'}`);
  if (Math.abs(market.bookImbalance) >= 0.12) reasons.push(`book ${market.bookImbalance > 0 ? 'comprador' : 'vendedor'}`);

  return { asset, side, confidence, projected, score, preSide, preProbability, horizon, state, price, move1m, move5m, oiAcceleration, interestRegime, alignment, reasons: reasons.slice(0, 5), recommendedLeverage, leverageMin, leverageMax, leverageRisk, displacement, market };
}

function formatPrice(v: number | null) {
  if (v === null || !Number.isFinite(v)) return '—';
  if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (v >= 1) return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return v.toLocaleString(undefined, { maximumFractionDigits: 7 });
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="spark-empty">Histórico cargando…</div>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, Number.EPSILON);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - min) / span) * 24}`).join(' ');
  return <svg className="sparkline" viewBox="0 0 100 32" preserveAspectRatio="none"><polyline points={pts} fill="none" /></svg>;
}

export default function App() {
  const [assets, setAssets] = useState<Asset[]>(fallback);
  const [markets, setMarkets] = useState<Record<string, Market>>(() => Object.fromEntries(fallback.map(a => [a.exchangeSymbol, emptyMarket()])));
  const [backtests, setBacktests] = useState<Record<string, Backtest>>({});
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [direction, setDirection] = useState<'ALL' | Side>('ALL');
  const [minConfidence, setMinConfidence] = useState(50);
  const [minProjected, setMinProjected] = useState(35);
  const [leverages, setLeverages] = useState<Record<string, number>>({});
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState('—');
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    fetch('https://fapi.binance.com/fapi/v1/exchangeInfo').then(r => r.json()).then((data: { symbols?: Array<Record<string, unknown>> }) => {
      const list = (data.symbols ?? []).filter(s => s.status === 'TRADING' && s.contractType === 'PERPETUAL').map(s => {
        const baseAsset = String(s.baseAsset ?? '');
        const quoteAsset = String(s.quoteAsset ?? 'USDT');
        const symbol = String(s.symbol ?? '');
        return { symbol: `${baseAsset}/${quoteAsset}`, exchangeSymbol: symbol.toLowerCase(), baseAsset, quoteAsset };
      }).filter(a => a.exchangeSymbol).sort((a, b) => a.baseAsset.localeCompare(b.baseAsset));
      if (!list.length) return;
      setAssets(list);
      setMarkets(m => { const n = { ...m }; list.forEach(a => { if (!n[a.exchangeSymbol]) n[a.exchangeSymbol] = emptyMarket(); }); return n; });
    }).catch(() => undefined);
  }, []);

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? assets.filter(a => `${a.symbol} ${a.baseAsset} ${a.quoteAsset}`.toLowerCase().includes(q)) : assets;
  }, [assets, search]);
  const pages = Math.max(1, Math.ceil(searched.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const pageAssets = useMemo(() => searched.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE), [searched, safePage]);
  const activeKey = pageAssets.map(a => a.exchangeSymbol).join('|');
  useEffect(() => setPage(0), [search]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const rows = await Promise.allSettled(pageAssets.map(async a => {
        const r = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${a.exchangeSymbol.toUpperCase()}&interval=1m&limit=720`);
        const data = await r.json() as unknown[][];
        return { key: a.exchangeSymbol, metrics: historyMetrics(data.slice(-100)), bt: backtest(data) };
      }));
      if (!active) return;
      setMarkets(m => { const n = { ...m }; rows.forEach(x => { if (x.status === 'fulfilled') n[x.value.key] = { ...(n[x.value.key] ?? emptyMarket()), ...x.value.metrics }; }); return n; });
      setBacktests(b => { const n = { ...b }; rows.forEach(x => { if (x.status === 'fulfilled') n[x.value.key] = x.value.bt; }); return n; });
    };
    load().catch(() => undefined);
    const id = window.setInterval(() => load().catch(() => undefined), 60000);
    return () => { active = false; window.clearInterval(id); };
  }, [activeKey]);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const streams = pageAssets.flatMap(a => [`${a.exchangeSymbol}@aggTrade`, `${a.exchangeSymbol}@depth20@100ms`]);
    streams.push('!markPrice@arr@1s');
    const ws = new WebSocket(`wss://fstream.binance.com/stream?streams=${streams.join('/')}`);
    wsRef.current = ws;
    ws.onopen = () => alive && setConnected(true);
    ws.onmessage = ev => {
      if (!alive) return;
      try {
        const envelope = JSON.parse(ev.data) as { stream?: string; data?: unknown };
        const d = envelope.data as any;
        const now = Date.now();
        if (Array.isArray(d) && envelope.stream?.startsWith('!markPrice')) {
          setMarkets(m => {
            const n = { ...m };
            d.forEach(x => {
              const k = String(x.s ?? '').toLowerCase();
              if (n[k]) n[k] = { ...n[k], price: Number(x.p), funding: Number(x.r ?? 0) * 100, available: true };
            });
            return n;
          });
          setLastUpdate(new Date(now).toLocaleTimeString());
          return;
        }
        if (!d?.s) return;
        const k = String(d.s).toLowerCase();
        if (d.e === 'aggTrade') {
          const buy = d.m ? -1 : 1;
          setMarkets(m => m[k] ? { ...m, [k]: { ...m[k], price: Number(d.p), flowImbalance: clamp(m[k].flowImbalance * 0.92 + buy * 0.08, -1, 1), available: true } } : m);
        } else if (d.e === 'depthUpdate') {
          const bids = (d.b ?? []) as string[][];
          const asks = (d.a ?? []) as string[][];
          const bv = bids.reduce((s, [p, q]) => s + Number(p) * Number(q), 0);
          const av = asks.reduce((s, [p, q]) => s + Number(p) * Number(q), 0);
          const total = Math.max(1, bv + av);
          setMarkets(m => m[k] ? { ...m, [k]: { ...m[k], bookImbalance: (bv - av) / total, available: true } } : m);
        }
        setLastUpdate(new Date(now).toLocaleTimeString());
      } catch { /* evento malformado */ }
    };
    ws.onclose = () => {
      if (!alive) return;
      setConnected(false);
      timer = window.setTimeout(() => setReconnectNonce(v => v + 1), 3000);
    };
    return () => { alive = false; if (timer) window.clearTimeout(timer); ws.close(); };
  }, [activeKey, reconnectNonce]);

  useEffect(() => {
    let active = true;
    const loadOi = async () => {
      const res = await Promise.allSettled(pageAssets.map(async a => ({
        key: a.exchangeSymbol,
        value: Number((await (await fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${a.exchangeSymbol.toUpperCase()}`)).json() as { openInterest: string }).openInterest),
      })));
      if (!active) return;
      setMarkets(m => {
        const n = { ...m };
        res.forEach(x => {
          if (x.status !== 'fulfilled' || !n[x.value.key]) return;
          const old = n[x.value.key].openInterest;
          const nextChange = old && old > 0 ? ((x.value.value - old) / old) * 100 : 0;
          n[x.value.key] = { ...n[x.value.key], openInterest: x.value.value, oiPrevChange: n[x.value.key].oiChange, oiChange: nextChange };
        });
        return n;
      });
    };
    loadOi().catch(() => undefined);
    const id = window.setInterval(() => loadOi().catch(() => undefined), 5000);
    return () => { active = false; window.clearInterval(id); };
  }, [activeKey]);

  const baseCandidates = useMemo(() => pageAssets.map(asset => buildSignal(asset, markets[asset.exchangeSymbol] ?? emptyMarket(), backtests[asset.exchangeSymbol])).filter(s => (direction === 'ALL' || s.side === direction) && s.confidence >= minConfidence), [pageAssets, markets, backtests, direction, minConfidence]);
  const visible = useMemo(() => baseCandidates.filter(s => s.projected >= minProjected).sort((a, b) => b.projected - a.projected || b.preProbability - a.preProbability || b.alignment - a.alignment || b.confidence - a.confidence), [baseCandidates, minProjected]);
  const hiddenCount = baseCandidates.length - visible.length;
  const avgConfidence = pageAssets.length ? Math.round(pageAssets.reduce((sum, a) => sum + buildSignal(a, markets[a.exchangeSymbol] ?? emptyMarket(), backtests[a.exchangeSymbol]).confidence, 0) / pageAssets.length) : 0;

  return <main className="shell">
    <header className="topbar">
      <div><p className="eyebrow"><BrainCircuit size={17}/> MOTOR IA · BINANCE FUTURES</p><h1>Crypto Futures AI</h1><p className="subtitle">Señales anticipadas con movimiento real, interés abierto, funding, flujo, order book y backtesting.</p></div>
      <div className={`status ${connected ? 'online' : ''}`}><Radio size={16}/>{connected ? 'Binance conectado' : 'Reconectando Binance'}</div>
    </header>

    <section className="metrics">
      <article><span>Contratos</span><strong>{assets.length}</strong><small>perpetuos activos</small></article>
      <article><span>Cumplen</span><strong className="positive">{visible.length}</strong><small>conf. proyectada ≥ {minProjected}%</small></article>
      <article><span>Ocultas</span><strong className="negative">{hiddenCount}</strong><small>por filtro proyectado</small></article>
      <article><span>Confianza media</span><strong>{avgConfidence}%</strong><small>página actual</small></article>
    </section>

    <section className="source-strip"><span><Zap size={14}/> Precio real + OI cada 5s</span><span><Zap size={14}/> Detecta buildup LONG / SHORT</span><span><Zap size={14}/> Apalancamiento recomendado dinámico</span></section>

    <section className="browser">
      <label className="search"><Search size={17}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar BTC, ETH, PEPE…"/></label>
      <span>{searched.length} contratos encontrados</span>
      <div className="pager"><button disabled={safePage === 0} onClick={() => setPage(v => Math.max(0, v - 1))}><ChevronLeft size={17}/></button><b>{safePage + 1}/{pages}</b><button disabled={safePage >= pages - 1} onClick={() => setPage(v => Math.min(pages - 1, v + 1))}><ChevronRight size={17}/></button></div>
    </section>

    <section className="toolbar">
      <div className="tabs">{(['ALL','LONG','SHORT','WATCH'] as const).map(x => <button key={x} className={direction === x ? 'active' : ''} onClick={() => setDirection(x)}>{x === 'ALL' ? 'TODAS' : x}</button>)}</div>
      <label>Confianza ≥ <b>{minConfidence}%</b><input type="range" min="50" max="90" step="5" value={minConfidence} onChange={e => setMinConfidence(Number(e.target.value))}/></label>
      <label>Conf. proyectada ≥ <b>{minProjected}%</b><input type="range" min="35" max="95" step="5" value={minProjected} onChange={e => setMinProjected(Number(e.target.value))}/></label>
      <button className="reconnect" onClick={() => { wsRef.current?.close(); setReconnectNonce(v => v + 1); }}><RefreshCw size={16}/> Reconectar</button>
    </section>

    <section className="filter-summary"><div><span>Cumplen</span><strong>{visible.length}</strong></div><div><span>Ocultas</span><strong>{hiddenCount}</strong></div><p>Ranking descendente por confianza proyectada; el OI se interpreta junto con la dirección real del precio para distinguir buildup de cierres de posiciones.</p></section>

    <section className="cards">
      {visible.map(signal => {
        const bt = backtests[signal.asset.exchangeSymbol];
        const lev = leverages[signal.asset.exchangeSymbol] ?? signal.recommendedLeverage;
        const sign = signal.preSide === 'SHORT' ? -1 : 1;
        return <article className={`card ${signal.side.toLowerCase()}`} key={signal.asset.exchangeSymbol}>
          <div className="card-head"><div><span className="pair">{signal.asset.symbol}</span><span className="tf">1M</span></div><span className="side">{signal.side === 'LONG' ? <TrendingUp size={16}/> : signal.side === 'SHORT' ? <TrendingDown size={16}/> : <ShieldCheck size={16}/>} {signal.side}</span></div>
          <div className="price"><span>Precio futuro</span><strong>{formatPrice(signal.price)}</strong></div>
          <div className="scores"><div><span>Confianza</span><strong>{signal.confidence}%</strong></div><div><span>Conf. proyectada</span><strong className="blue">{signal.projected}%</strong></div><div><span>Alineación</span><strong>{signal.alignment}%</strong></div><div><span>Backtest</span><strong>{bt ? `${bt.hitRate.toFixed(1)}%` : '—'}</strong></div></div>

          <div className={`pre ${signal.preSide.toLowerCase()}`}>
            <div className="pre-head"><span>Señal anticipada</span><b>{signal.preSide === 'LONG' ? 'PRE-LONG' : signal.preSide === 'SHORT' ? 'PRE-SHORT' : 'NEUTRAL'}</b></div>
            <div className="pre-main"><strong>{signal.preProbability}%</strong><span>{signal.state}</span><span>{signal.horizon}</span></div>
            <div className="opportunity-grid"><span>Mov. 1m <b className={signal.move1m >= 0 ? 'positive' : 'negative'}>{signal.move1m >= 0 ? '+' : ''}{signal.move1m.toFixed(3)}%</b></span><span>Mov. 5m <b className={signal.move5m >= 0 ? 'positive' : 'negative'}>{signal.move5m >= 0 ? '+' : ''}{signal.move5m.toFixed(3)}%</b></span><span>Δ OI 5s <b className={signal.market.oiChange >= 0 ? 'positive' : 'negative'}>{signal.market.oiChange >= 0 ? '+' : ''}{signal.market.oiChange.toFixed(4)}%</b></span><span>Régimen OI <b>{regimeLabel(signal.interestRegime)}</b></span></div>
            <div className="reason-row">{signal.reasons.length ? signal.reasons.map(reason => <small key={reason}>{reason}</small>) : <small>Esperando mayor confluencia real.</small>}</div>
          </div>

          {signal.displacement && signal.price && <div className="displacements">{([['Conservador', signal.displacement.conservative], ['Base', signal.displacement.base], ['Agresivo', signal.displacement.aggressive]] as const).map(([name, pct]) => <div key={name}><span>{name}</span><dl><dt>Desplazamiento</dt><dd>{sign > 0 ? '+' : '-'}{pct.toFixed(2)}%</dd><dt>Δ precio</dt><dd>{sign > 0 ? '+' : '-'}{formatPrice(signal.price! * pct / 100)}</dd><dt>Objetivo</dt><dd>{formatPrice(signal.price * (1 + sign * pct / 100))}</dd></dl></div>)}</div>}

          <div className={`leverage ${lev >= 10 ? 'danger' : lev >= 6 ? 'warn' : ''}`}>
            <div><span>Apalancamiento</span><b>{lev}x</b></div>
            <div className="leverage-recommendation"><span>Recomendado por señal</span><strong>{signal.recommendedLeverage}x</strong><small>Rango {signal.leverageMin}x–{signal.leverageMax}x · riesgo {signal.leverageRisk}</small><button onClick={() => setLeverages(x => ({ ...x, [signal.asset.exchangeSymbol]: signal.recommendedLeverage }))}>Aplicar recomendado</button></div>
            <div className="stepper"><button onClick={() => setLeverages(x => ({ ...x, [signal.asset.exchangeSymbol]: clamp(lev - 1, 1, 75) }))}>−</button><strong>{lev}x</strong><button onClick={() => setLeverages(x => ({ ...x, [signal.asset.exchangeSymbol]: clamp(lev + 1, 1, 75) }))}>+</button></div>
            <input type="range" min="1" max="75" value={lev} onChange={e => setLeverages(x => ({ ...x, [signal.asset.exchangeSymbol]: Number(e.target.value) }))}/>
            <small>Margen relativo {(100 / lev).toFixed(2)}% · la recomendación baja automáticamente cuando el ATR/volatilidad aumenta. No ejecuta órdenes.</small>
          </div>

          <div className="micro"><span>Book <b>{(signal.market.bookImbalance * 100).toFixed(1)}%</b></span><span>Flujo <b>{(signal.market.flowImbalance * 100).toFixed(1)}%</b></span><span>OI acel. <b>{signal.oiAcceleration >= 0 ? '+' : ''}{signal.oiAcceleration.toFixed(4)}%</b></span><span>Funding <b>{signal.market.funding === null ? '—' : `${signal.market.funding.toFixed(4)}%`}</b></span></div>
          <div className="history"><div><span>Retorno 20m</span><b>{signal.market.historyReturn20.toFixed(2)}%</b></div><Sparkline values={signal.market.closes}/><p>ATR {signal.market.atrPct.toFixed(2)}% · Vol {signal.market.volumeRatio.toFixed(2)}x · RSI {signal.market.rsi?.toFixed(1) ?? '—'} · MFE hist. {bt?.avgMfe.toFixed(2) ?? '—'}%</p></div>
        </article>;
      })}
    </section>
    {!visible.length && <section className="empty">No hay señales que cumplan los filtros actuales.</section>}
    <footer><ShieldCheck size={15}/> Motor experimental de oportunidad; no garantiza resultados y no ejecuta operaciones. Último evento: {lastUpdate}</footer>
  </main>;
}
