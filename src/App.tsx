import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, CircleDollarSign, Radio, RefreshCw, Search, ShieldCheck, Sparkles, WalletCards } from 'lucide-react';

type Side = 'LONG' | 'SHORT' | 'WATCH';
type Horizon = '1–5m' | '5–15m' | '15–30m';
type PreState = 'FORMANDO' | 'CERCA' | 'LISTO' | 'NEUTRAL';
type InterestRegime = 'LONG_BUILDUP' | 'SHORT_BUILDUP' | 'SHORT_COVERING' | 'LONG_LIQUIDATION' | 'NEUTRAL';
type Asset = { symbol: string; exchangeSymbol: string; baseAsset: string; quoteAsset: string };
type LeverageStat = { leverage: number; trades: number; survived: number; wins: number; survivalRate: number; winRate: number; avgLeveragedReturn: number };
type Backtest = { signals: number; wins: number; hitRate: number; avgReturn: number; avgMfe: number; avgMae: number; validatedLeverage: number; leverageStats: LeverageStat[] };
type TradePlan = { entry: number | null; stop: number | null; tp1: number | null; tp2: number | null; tp3: number | null; stopPct: number; rrBase: number; entryRule: string; invalidationRule: string };
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
  leverageValidated: boolean;
  displacement: { conservative: number; base: number; aggressive: number } | null;
  tradePlan: TradePlan | null;
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
  let gains = 0, losses = 0;
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
  const levels = [2, 3, 5, 8, 10, 12];
  const levRaw = new Map(levels.map(l => [l, { trades: 0, survived: 0, wins: 0, returns: [] as number[] }]));
  let signals = 0, wins = 0;
  const returns: number[] = [], mfes: number[] = [], maes: number[] = [];
  for (let i = 80; i < v.length - 16; i += 5) {
    const c = closes[i];
    if (!Number.isFinite(c) || c <= 0) continue;
    const e20 = ema(closes.slice(i - 40, i + 1), 20) ?? c;
    const e50 = ema(closes.slice(i - 60, i + 1), 50) ?? c;
    const momentum = closes[i - 5] > 0 ? ((c - closes[i - 5]) / closes[i - 5]) * 100 : 0;
    const trend = ((e20 - e50) / c) * 100;
    const strength = Math.abs(momentum * 8 + trend * 18);
    if (strength < 2.8) continue;
    const dir = momentum + trend >= 0 ? 1 : -1;
    const futureHigh = Math.max(...highs.slice(i + 1, i + 16));
    const futureLow = Math.min(...lows.slice(i + 1, i + 16));
    const mfe = dir > 0 ? Math.max(0, ((futureHigh - c) / c) * 100) : Math.max(0, ((c - futureLow) / c) * 100);
    const mae = dir > 0 ? Math.max(0, ((c - futureLow) / c) * 100) : Math.max(0, ((futureHigh - c) / c) * 100);
    const ret = (((closes[i + 15] - c) / c) * 100) * dir;
    signals += 1; wins += mfe >= 0.12 ? 1 : 0; returns.push(ret); mfes.push(mfe); maes.push(mae);
    levels.forEach(l => {
      const stat = levRaw.get(l)!;
      stat.trades += 1;
      const liqBuffer = (100 / l) * 0.88;
      const survived = mae < liqBuffer;
      if (survived) stat.survived += 1;
      if (survived && ret > 0) stat.wins += 1;
      stat.returns.push(survived ? ret * l : -100);
    });
  }
  const avg = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const leverageStats = levels.map(l => {
    const s = levRaw.get(l)!;
    return { leverage: l, trades: s.trades, survived: s.survived, wins: s.wins, survivalRate: s.trades ? s.survived / s.trades * 100 : 0, winRate: s.trades ? s.wins / s.trades * 100 : 0, avgLeveragedReturn: avg(s.returns) };
  });
  const eligible = leverageStats.filter(s => s.trades >= 8 && s.survivalRate >= 95 && s.avgLeveragedReturn > 0);
  const validatedLeverage = eligible.length ? eligible.sort((a, b) => b.leverage - a.leverage)[0].leverage : 2;
  return { signals, wins, hitRate: signals ? wins / signals * 100 : 0, avgReturn: avg(returns), avgMfe: avg(mfes), avgMae: avg(maes), validatedLeverage, leverageStats };
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
  const funding = market.funding ?? 0;
  const longOi = interestRegime === 'LONG_BUILDUP' ? clamp(Math.abs(market.oiChange) * 45, 4, 18) : interestRegime === 'SHORT_COVERING' ? 2 : interestRegime === 'LONG_LIQUIDATION' ? -7 : 0;
  const shortOi = interestRegime === 'SHORT_BUILDUP' ? clamp(Math.abs(market.oiChange) * 45, 4, 18) : interestRegime === 'LONG_LIQUIDATION' ? 2 : interestRegime === 'SHORT_COVERING' ? -7 : 0;
  const longEvidence = 50 + clamp(move1m * 32, -14, 14) + clamp(move5m * 13, -10, 10) + clamp(trend * 18, -8, 8) + clamp(market.bookImbalance * 13, -10, 10) + clamp(market.flowImbalance * 16, -12, 12) + longOi + clamp((market.volumeRatio - 1) * 7, -4, 7) - clamp(funding * 160, -4, 4) + clamp(oiAcceleration * 30, -4, 4);
  const shortEvidence = 50 - clamp(move1m * 32, -14, 14) - clamp(move5m * 13, -10, 10) - clamp(trend * 18, -8, 8) - clamp(market.bookImbalance * 13, -10, 10) - clamp(market.flowImbalance * 16, -12, 12) + shortOi + clamp((market.volumeRatio - 1) * 7, -4, 7) + clamp(funding * 160, -4, 4) - clamp(oiAcceleration * 30, -4, 4);
  const gap = Math.abs(longEvidence - shortEvidence);
  const rawPre = clamp(Math.max(longEvidence, shortEvidence), 35, 97);
  const preSide: Side = rawPre < 58 || gap < 5 ? 'WATCH' : longEvidence > shortEvidence ? 'LONG' : 'SHORT';
  const preProbability = Math.round(preSide === 'WATCH' ? Math.min(rawPre, 57) : rawPre);
  const state: PreState = preSide === 'WATCH' ? 'NEUTRAL' : preProbability >= 84 && gap >= 13 ? 'LISTO' : preProbability >= 70 ? 'CERCA' : 'FORMANDO';
  const horizon: Horizon = state === 'LISTO' ? '1–5m' : state === 'CERCA' ? '5–15m' : '15–30m';
  const score = Math.round(clamp(50 + clamp((longEvidence - shortEvidence) * 0.72, -40, 40), 10, 90));
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
  let modelLeverage = projected >= 90 ? 10 : projected >= 84 ? 8 : projected >= 76 ? 6 : projected >= 68 ? 4 : 2;
  if (state === 'LISTO' && alignment >= 80) modelLeverage += 2;
  if ((preSide === 'LONG' && interestRegime === 'LONG_BUILDUP') || (preSide === 'SHORT' && interestRegime === 'SHORT_BUILDUP')) modelLeverage += 1;
  if (market.atrPct >= 1.5) modelLeverage = Math.floor(modelLeverage * 0.55);
  else if (market.atrPct >= 0.9) modelLeverage = Math.floor(modelLeverage * 0.72);
  if (preSide === 'WATCH') modelLeverage = 2;
  modelLeverage = Math.round(clamp(modelLeverage, 2, 12));
  const validatedCap = bt?.validatedLeverage ?? 12;
  const recommendedLeverage = Math.max(2, Math.min(modelLeverage, validatedCap));
  const leverageValidated = Boolean(bt?.signals && bt.signals >= 8);
  const leverageMin = Math.max(1, recommendedLeverage - 2);
  const leverageMax = Math.min(15, Math.max(recommendedLeverage, validatedCap));
  const leverageRisk: Signal['leverageRisk'] = recommendedLeverage <= 4 ? 'Bajo' : recommendedLeverage <= 8 ? 'Moderado' : 'Alto';
  const reasons: string[] = [];
  if (Math.abs(move1m) >= 0.03) reasons.push(`Mov. 1m ${move1m >= 0 ? '+' : ''}${move1m.toFixed(2)}%`);
  if (Math.abs(move5m) >= 0.08) reasons.push(`Mov. 5m ${move5m >= 0 ? '+' : ''}${move5m.toFixed(2)}%`);
  if (Math.abs(market.oiChange) >= 0.004) reasons.push(`OI ${market.oiChange >= 0 ? '+' : ''}${market.oiChange.toFixed(3)}%`);
  if (interestRegime !== 'NEUTRAL') reasons.push(regimeLabel(interestRegime));
  if (Math.abs(market.flowImbalance) >= 0.12) reasons.push(`Flujo ${market.flowImbalance > 0 ? 'comprador' : 'vendedor'}`);
  if (Math.abs(market.bookImbalance) >= 0.12) reasons.push(`Book ${market.bookImbalance > 0 ? 'comprador' : 'vendedor'}`);
  let tradePlan: TradePlan | null = null;
  if (price && displacement && preSide !== 'WATCH') {
    const dir = preSide === 'LONG' ? 1 : -1;
    const entryBuffer = Math.max(0.025, market.atrPct * 0.12);
    const stopPct = clamp(Math.max(market.atrPct * 0.85, displacement.base * 0.42, 0.09), 0.09, 4);
    const entry = price * (1 + dir * entryBuffer / 100);
    const stop = entry * (1 - dir * stopPct / 100);
    const tp1 = entry * (1 + dir * displacement.conservative / 100);
    const tp2 = entry * (1 + dir * displacement.base / 100);
    const tp3 = entry * (1 + dir * displacement.aggressive / 100);
    const rrBase = displacement.base / stopPct;
    const entryRule = preSide === 'LONG' ? 'Confirmar ruptura al alza con OI y flujo aún compradores.' : 'Confirmar ruptura a la baja con OI y flujo aún vendedores.';
    const invalidationRule = preSide === 'LONG' ? 'Cancelar si el OI gira a buildup SHORT, domina flujo vendedor o pierde el stop.' : 'Cancelar si el OI gira a buildup LONG, domina flujo comprador o supera el stop.';
    tradePlan = { entry, stop, tp1, tp2, tp3, stopPct, rrBase, entryRule, invalidationRule };
  }
  return { asset, side, confidence, projected, preSide, preProbability, horizon, state, price, move1m, move5m, oiAcceleration, interestRegime, alignment, reasons: reasons.slice(0, 5), recommendedLeverage, leverageMin, leverageMax, leverageRisk, leverageValidated, displacement, tradePlan, market };
}

function formatPrice(v: number | null) {
  if (v === null || !Number.isFinite(v)) return '—';
  if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (v >= 1) return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return v.toLocaleString(undefined, { maximumFractionDigits: 7 });
}

function decisionOf(signal?: Signal) {
  if (!signal || signal.preSide === 'WATCH') return { label: 'ESPERAR', tone: 'wait', detail: 'Sin confluencia suficiente. Mantener observación.' };
  if (signal.state === 'LISTO') return { label: signal.preSide === 'LONG' ? 'ENTRADA LONG LISTA' : 'ENTRADA SHORT LISTA', tone: signal.preSide.toLowerCase(), detail: signal.tradePlan?.entryRule ?? 'Esperar confirmación final.' };
  if (signal.state === 'CERCA') return { label: signal.preSide === 'LONG' ? 'PREPARAR LONG' : 'PREPARAR SHORT', tone: signal.preSide.toLowerCase(), detail: signal.tradePlan?.entryRule ?? 'Falta una confirmación.' };
  return { label: signal.preSide === 'LONG' ? 'VIGILAR LONG' : 'VIGILAR SHORT', tone: signal.preSide.toLowerCase(), detail: 'La oportunidad se está formando.' };
}

export default function App() {
  const [assets, setAssets] = useState<Asset[]>(fallback);
  const [markets, setMarkets] = useState<Record<string, Market>>(() => Object.fromEntries(fallback.map(a => [a.exchangeSymbol, emptyMarket()])));
  const [backtests, setBacktests] = useState<Record<string, Backtest>>({});
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [direction, setDirection] = useState<'ALL' | Side>('ALL');
  const [minProjected, setMinProjected] = useState(55);
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState('—');
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
    let alive = true, timer: number | undefined;
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
        if (Array.isArray(d) && envelope.stream?.startsWith('!markPrice')) {
          setMarkets(m => {
            const n = { ...m };
            d.forEach(x => {
              const k = String(x.s ?? '').toLowerCase();
              if (n[k]) n[k] = { ...n[k], price: Number(x.p), funding: Number(x.r ?? 0) * 100, available: true };
            });
            return n;
          });
          setLastUpdate(new Date().toLocaleTimeString());
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
        setLastUpdate(new Date().toLocaleTimeString());
      } catch { /* ignore */ }
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
      const res = await Promise.allSettled(pageAssets.map(async a => ({ key: a.exchangeSymbol, value: Number((await (await fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${a.exchangeSymbol.toUpperCase()}`)).json() as { openInterest: string }).openInterest) })));
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

  const allSignals = useMemo(() => pageAssets.map(asset => buildSignal(asset, markets[asset.exchangeSymbol] ?? emptyMarket(), backtests[asset.exchangeSymbol])), [pageAssets, markets, backtests]);
  const ranked = useMemo(() => allSignals.filter(s => (direction === 'ALL' || s.preSide === direction || s.side === direction) && s.projected >= minProjected).sort((a, b) => b.projected - a.projected || b.preProbability - a.preProbability || b.alignment - a.alignment), [allSignals, direction, minProjected]);
  const nextSignal = ranked[0] ?? allSignals.sort((a, b) => b.projected - a.projected)[0];
  const nextDecision = decisionOf(nextSignal);
  const hiddenCount = Math.max(0, allSignals.length - ranked.length);

  return <main className="wallet-shell">
    <header className="wallet-topbar">
      <div className="brand"><div className="brand-mark"><WalletCards size={20}/></div><div><strong>Crypto Wallet AI</strong><small>Futures decision wallet</small></div></div>
      <div className={`connection ${connected ? 'online' : ''}`}><Radio size={14}/>{connected ? 'Binance live' : 'Reconectando'}</div>
    </header>

    <section className="decision-card">
      <div className="decision-top"><span><Sparkles size={16}/> Próxima decisión</span><span className={`decision-pill ${nextDecision.tone}`}>{nextDecision.label}</span></div>
      <div className="decision-main">
        <div className="decision-asset"><span>{nextSignal?.asset.symbol ?? '—'}</span><strong>{formatPrice(nextSignal?.price ?? null)}</strong><small>{nextSignal ? `${nextSignal.projected}% confianza proyectada · ${nextSignal.horizon}` : 'Cargando mercado'}</small></div>
        <div className="decision-copy"><p>{nextDecision.detail}</p><div className="decision-tags">{nextSignal?.reasons.slice(0, 3).map(reason => <span key={reason}>{reason}</span>)}</div></div>
      </div>
      {nextSignal?.tradePlan && <div className="next-plan">
        <div><span>Entrada</span><strong>{formatPrice(nextSignal.tradePlan.entry)}</strong></div>
        <div><span>Stop</span><strong>{formatPrice(nextSignal.tradePlan.stop)}</strong></div>
        <div><span>TP base</span><strong>{formatPrice(nextSignal.tradePlan.tp2)}</strong></div>
        <div><span>Leverage</span><strong>{nextSignal.recommendedLeverage}x</strong></div>
      </div>}
    </section>

    <section className="wallet-summary">
      <article><CircleDollarSign size={17}/><div><span>Mercados</span><strong>{assets.length}</strong></div></article>
      <article><Activity size={17}/><div><span>Visibles</span><strong>{ranked.length}</strong></div></article>
      <article><ShieldCheck size={17}/><div><span>Ocultas</span><strong>{hiddenCount}</strong></div></article>
    </section>

    <section className="wallet-controls">
      <label className="wallet-search"><Search size={16}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar activo"/></label>
      <div className="wallet-tabs">{(['ALL','LONG','SHORT','WATCH'] as const).map(x => <button key={x} className={direction === x ? 'active' : ''} onClick={() => setDirection(x)}>{x === 'ALL' ? 'Todos' : x}</button>)}</div>
      <label className="confidence-filter"><span>Conf. mínima</span><b>{minProjected}%</b><input type="range" min="35" max="95" step="5" value={minProjected} onChange={e => setMinProjected(Number(e.target.value))}/></label>
      <button className="refresh" onClick={() => { wsRef.current?.close(); setReconnectNonce(v => v + 1); }}><RefreshCw size={16}/></button>
    </section>

    <section className="asset-list">
      {ranked.map(signal => {
        const d = decisionOf(signal);
        const bt = backtests[signal.asset.exchangeSymbol];
        return <article className="wallet-asset" key={signal.asset.exchangeSymbol}>
          <div className={`asset-icon ${signal.preSide.toLowerCase()}`}>{signal.preSide === 'LONG' ? <ArrowUpRight/> : signal.preSide === 'SHORT' ? <ArrowDownRight/> : <Activity/>}</div>
          <div className="asset-core"><div className="asset-title"><strong>{signal.asset.symbol}</strong><span className={`mini-pill ${d.tone}`}>{d.label}</span></div><div className="asset-sub"><span>{formatPrice(signal.price)}</span><span>{signal.projected}% proyectada</span><span>{signal.alignment}% alineación</span></div></div>
          <div className="asset-side"><strong className={signal.move5m >= 0 ? 'positive' : 'negative'}>{signal.move5m >= 0 ? '+' : ''}{signal.move5m.toFixed(2)}%</strong><small>5m</small></div>
          <div className="wallet-detail">
            <div className="detail-row"><span>Próxima acción</span><strong>{d.label}</strong></div>
            <p>{d.detail}</p>
            <div className="detail-grid"><div><span>OI 5s</span><b>{signal.market.oiChange >= 0 ? '+' : ''}{signal.market.oiChange.toFixed(3)}%</b></div><div><span>Régimen</span><b>{regimeLabel(signal.interestRegime)}</b></div><div><span>Backtest</span><b>{bt ? `${bt.hitRate.toFixed(1)}%` : '—'}</b></div><div><span>Leverage</span><b>{signal.recommendedLeverage}x</b></div></div>
            {signal.tradePlan && <div className="compact-plan"><div><span>Entrada</span><b>{formatPrice(signal.tradePlan.entry)}</b></div><div><span>Stop</span><b>{formatPrice(signal.tradePlan.stop)}</b></div><div><span>TP1</span><b>{formatPrice(signal.tradePlan.tp1)}</b></div><div><span>TP2</span><b>{formatPrice(signal.tradePlan.tp2)}</b></div></div>}
          </div>
        </article>;
      })}
    </section>

    {!ranked.length && <section className="wallet-empty">No hay oportunidades que superen el filtro actual.</section>}

    <footer className="wallet-footer">
      <button disabled={safePage === 0} onClick={() => setPage(v => Math.max(0, v - 1))}><ChevronLeft size={16}/></button>
      <span>Página {safePage + 1} de {pages} · actualizado {lastUpdate}</span>
      <button disabled={safePage >= pages - 1} onClick={() => setPage(v => Math.min(pages - 1, v + 1))}><ChevronRight size={16}/></button>
    </footer>
  </main>;
}
