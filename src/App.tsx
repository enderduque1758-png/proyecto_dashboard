import { useEffect, useMemo, useRef, useState } from 'react';
import { BrainCircuit, ChevronLeft, ChevronRight, Radio, RefreshCw, Search, ShieldCheck, TrendingDown, TrendingUp, Zap } from 'lucide-react';

type Side = 'LONG' | 'SHORT' | 'WATCH';
type Asset = { symbol: string; exchangeSymbol: string; baseAsset: string; quoteAsset: string };
type Backtest = { signals: number; wins: number; hitRate: number; avgReturn: number; avgMfe: number };
type Market = {
  price: number | null;
  funding: number | null;
  openInterest: number | null;
  oiChange: number;
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
  horizon: '1–5m' | '5–15m' | '15–30m';
  state: 'FORMANDO' | 'CERCA' | 'LISTO' | 'NEUTRAL';
  price: number | null;
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
const emptyMarket = (): Market => ({ price: null, funding: null, openInterest: null, oiChange: 0, bookImbalance: 0, flowImbalance: 0, historyReturn20: 0, atrPct: 0, volumeRatio: 1, ema20: null, ema50: null, rsi: null, closes: [], available: false });
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

function ema(values: number[], period: number) {
  if (!values.length) return null;
  const k = 2 / (period + 1);
  let current = values[0];
  for (let i = 1; i < values.length; i += 1) current = values[i] * k + current * (1 - k);
  return current;
}
function rsi(values: number[], period = 14) {
  if (values.length <= period) return null;
  let gains = 0; let losses = 0;
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
  let signals = 0; let wins = 0; const returns: number[] = []; const mfes: number[] = [];
  for (let i = 80; i < v.length - 16; i += 5) {
    const c = closes[i]; if (!Number.isFinite(c) || c <= 0) continue;
    const e20 = ema(closes.slice(i - 40, i + 1), 20) ?? c;
    const e50 = ema(closes.slice(i - 60, i + 1), 50) ?? c;
    const momentum = closes[i - 5] > 0 ? ((c - closes[i - 5]) / closes[i - 5]) * 100 : 0;
    const trend = (e20 - e50) / c * 100;
    const strength = Math.abs(momentum * 8 + trend * 18);
    if (strength < 2.8) continue;
    const side = momentum + trend >= 0 ? 1 : -1;
    const futureHigh = Math.max(...highs.slice(i + 1, i + 16));
    const futureLow = Math.min(...lows.slice(i + 1, i + 16));
    const mfe = side > 0 ? Math.max(0, (futureHigh - c) / c * 100) : Math.max(0, (c - futureLow) / c * 100);
    const ret = ((closes[i + 15] - c) / c * 100) * side;
    signals += 1; wins += mfe >= 0.12 ? 1 : 0; returns.push(ret); mfes.push(mfe);
  }
  const avg = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  return { signals, wins, hitRate: signals ? wins / signals * 100 : 0, avgReturn: avg(returns), avgMfe: avg(mfes) };
}
function buildSignal(asset: Asset, market: Market, bt?: Backtest): Signal {
  const trend = market.ema20 && market.ema50 && market.ema50 !== 0 ? ((market.ema20 - market.ema50) / market.ema50) * 100 : 0;
  const rsiBias = market.rsi === null ? 0 : (market.rsi - 50) / 10;
  const score = Math.round(clamp(50 + market.historyReturn20 * 6 + trend * 16 + market.bookImbalance * 16 + market.flowImbalance * 18 + rsiBias + (market.volumeRatio - 1) * 4, 10, 90));
  const confidence = Math.round(clamp(53 + Math.abs(score - 50) * 0.92, 50, 94));
  const side: Side = score >= 60 ? 'LONG' : score <= 40 ? 'SHORT' : 'WATCH';
  const preScore = clamp(52 + Math.abs(market.historyReturn20) * 8 + Math.abs(trend) * 12 + Math.abs(market.bookImbalance) * 14 + Math.abs(market.flowImbalance) * 16 + Math.max(0, market.volumeRatio - 1) * 8, 35, 96);
  const preSide: Side = preScore < 56 ? 'WATCH' : score >= 50 ? 'LONG' : 'SHORT';
  const state = preSide === 'WATCH' ? 'NEUTRAL' : preScore >= 82 ? 'LISTO' : preScore >= 68 ? 'CERCA' : 'FORMANDO';
  const horizon: Signal['horizon'] = state === 'LISTO' ? '1–5m' : state === 'CERCA' ? '5–15m' : '15–30m';
  const adjustedHit = bt?.signals ? ((bt.wins + 5) / (bt.signals + 10)) * 100 : 50;
  const mfeQuality = bt?.avgMfe ? clamp(bt.avgMfe / Math.max(market.atrPct * 1.5, 0.08) * 65, 35, 95) : 50;
  const projected = Math.round(clamp(preScore * 0.45 + adjustedHit * 0.3 + confidence * 0.15 + mfeQuality * 0.1 + (state === 'LISTO' ? 4 : state === 'CERCA' ? 2 : preSide === 'WATCH' ? -4 : 0), 35, 97));
  const price = market.price;
  const base = clamp((bt?.avgMfe || Math.max(market.atrPct, 0.08) * 1.35) * (0.85 + Math.max(0, projected - 50) / 160), 0.08, 12);
  const displacement = price && preSide !== 'WATCH' ? { conservative: base * 0.68, base, aggressive: clamp(Math.max(base * 1.45, (bt?.avgMfe || base) * 0.95), base, 18) } : null;
  return { asset, side, confidence, projected, score, preSide, preProbability: Math.round(preScore), horizon, state, price, displacement, market };
}
function formatPrice(v: number | null) {
  if (v === null || !Number.isFinite(v)) return '—';
  if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (v >= 1) return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return v.toLocaleString(undefined, { maximumFractionDigits: 7 });
}
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="spark-empty">Histórico cargando…</div>;
  const min = Math.min(...values); const max = Math.max(...values); const span = Math.max(max - min, Number.EPSILON);
  const pts = values.map((v, i) => `${i / (values.length - 1) * 100},${28 - (v - min) / span * 24}`).join(' ');
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
        const baseAsset = String(s.baseAsset ?? ''); const quoteAsset = String(s.quoteAsset ?? 'USDT'); const symbol = String(s.symbol ?? '');
        return { symbol: `${baseAsset}/${quoteAsset}`, exchangeSymbol: symbol.toLowerCase(), baseAsset, quoteAsset };
      }).filter(a => a.exchangeSymbol).sort((a, b) => a.baseAsset.localeCompare(b.baseAsset));
      if (!list.length) return;
      setAssets(list); setMarkets(m => { const n = { ...m }; list.forEach(a => { if (!n[a.exchangeSymbol]) n[a.exchangeSymbol] = emptyMarket(); }); return n; });
    }).catch(() => undefined);
  }, []);

  const searched = useMemo(() => { const q = search.trim().toLowerCase(); return q ? assets.filter(a => `${a.symbol} ${a.baseAsset} ${a.quoteAsset}`.toLowerCase().includes(q)) : assets; }, [assets, search]);
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
    load().catch(() => undefined); const id = window.setInterval(() => load().catch(() => undefined), 60000);
    return () => { active = false; window.clearInterval(id); };
  }, [activeKey]);

  useEffect(() => {
    let alive = true; let timer: number | undefined;
    const streams = pageAssets.flatMap(a => [`${a.exchangeSymbol}@aggTrade`, `${a.exchangeSymbol}@depth20@100ms`]); streams.push('!markPrice@arr@1s');
    const ws = new WebSocket(`wss://fstream.binance.com/stream?streams=${streams.join('/')}`); wsRef.current = ws;
    ws.onopen = () => alive && setConnected(true);
    ws.onmessage = ev => {
      if (!alive) return;
      try {
        const envelope = JSON.parse(ev.data) as { stream?: string; data?: unknown }; const d = envelope.data as any; const now = Date.now();
        if (Array.isArray(d) && envelope.stream?.startsWith('!markPrice')) {
          setMarkets(m => { const n = { ...m }; d.forEach(x => { const k = String(x.s ?? '').toLowerCase(); if (n[k]) n[k] = { ...n[k], price: Number(x.p), funding: Number(x.r ?? 0) * 100, available: true }; }); return n; }); setLastUpdate(new Date(now).toLocaleTimeString()); return;
        }
        if (!d?.s) return; const k = String(d.s).toLowerCase();
        if (d.e === 'aggTrade') {
          const buy = d.m ? -1 : 1;
          setMarkets(m => m[k] ? { ...m, [k]: { ...m[k], price: Number(d.p), flowImbalance: clamp(m[k].flowImbalance * 0.92 + buy * 0.08, -1, 1), available: true } } : m);
        } else if (d.e === 'depthUpdate') {
          const bids = (d.b ?? []) as string[][]; const asks = (d.a ?? []) as string[][];
          const bv = bids.reduce((s, [p, q]) => s + Number(p) * Number(q), 0); const av = asks.reduce((s, [p, q]) => s + Number(p) * Number(q), 0); const t = Math.max(1, bv + av);
          setMarkets(m => m[k] ? { ...m, [k]: { ...m[k], bookImbalance: (bv - av) / t, available: true } } : m);
        }
        setLastUpdate(new Date(now).toLocaleTimeString());
      } catch { /* ignore malformed market event */ }
    };
    ws.onclose = () => { if (!alive) return; setConnected(false); timer = window.setTimeout(() => setReconnectNonce(v => v + 1), 3000); };
    return () => { alive = false; if (timer) window.clearTimeout(timer); ws.close(); };
  }, [activeKey, reconnectNonce]);

  useEffect(() => {
    let active = true;
    const loadOi = async () => {
      const res = await Promise.allSettled(pageAssets.map(async a => ({ key: a.exchangeSymbol, value: Number((await (await fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${a.exchangeSymbol.toUpperCase()}`)).json() as { openInterest: string }).openInterest) })));
      if (!active) return;
      setMarkets(m => { const n = { ...m }; res.forEach(x => { if (x.status === 'fulfilled' && n[x.value.key]) { const old = n[x.value.key].openInterest; n[x.value.key] = { ...n[x.value.key], openInterest: x.value.value, oiChange: old && old > 0 ? (x.value.value - old) / old * 100 : 0 }; } }); return n; });
    };
    loadOi().catch(() => undefined); const id = window.setInterval(() => loadOi().catch(() => undefined), 5000);
    return () => { active = false; window.clearInterval(id); };
  }, [activeKey]);

  const baseCandidates = useMemo(() => pageAssets.map(asset => buildSignal(asset, markets[asset.exchangeSymbol] ?? emptyMarket(), backtests[asset.exchangeSymbol])).filter(s => (direction === 'ALL' || s.side === direction) && s.confidence >= minConfidence), [pageAssets, markets, backtests, direction, minConfidence]);
  const visible = useMemo(() => baseCandidates.filter(s => s.projected >= minProjected).sort((a, b) => b.projected - a.projected || b.preProbability - a.preProbability || b.confidence - a.confidence), [baseCandidates, minProjected]);
  const hiddenCount = baseCandidates.length - visible.length;
  const avgConfidence = pageAssets.length ? Math.round(pageAssets.reduce((sum, a) => sum + buildSignal(a, markets[a.exchangeSymbol] ?? emptyMarket(), backtests[a.exchangeSymbol]).confidence, 0) / pageAssets.length) : 0;

  return <main className="shell">
    <header className="topbar">
      <div><p className="eyebrow"><BrainCircuit size={17}/> MOTOR IA · BINANCE FUTURES</p><h1>Crypto Futures AI</h1><p className="subtitle">Panel independiente en GitHub Pages con señales, backtesting, confianza proyectada y gestión visual de riesgo.</p></div>
      <div className={`status ${connected ? 'online' : ''}`}><Radio size={16}/>{connected ? 'Binance conectado' : 'Reconectando Binance'}</div>
    </header>

    <section className="metrics">
      <article><span>Contratos</span><strong>{assets.length}</strong><small>perpetuos activos</small></article>
      <article><span>Cumplen</span><strong className="positive">{visible.length}</strong><small>conf. proyectada ≥ {minProjected}%</small></article>
      <article><span>Ocultas</span><strong className="negative">{hiddenCount}</strong><small>por filtro proyectado</small></article>
      <article><span>Confianza media</span><strong>{avgConfidence}%</strong><small>página actual</small></article>
    </section>

    <section className="source-strip"><span><Zap size={14}/> Orden descendente por confianza proyectada</span><span><Zap size={14}/> 720 velas para backtest</span><span><Zap size={14}/> OI + funding + depth + trades</span></section>

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

    <section className="filter-summary"><div><span>Cumplen</span><strong>{visible.length}</strong></div><div><span>Ocultas</span><strong>{hiddenCount}</strong></div><p>Contadores calculados después de dirección + confianza actual. Las visibles permanecen ordenadas de mayor a menor confianza proyectada.</p></section>

    <section className="cards">
      {visible.map(signal => {
        const bt = backtests[signal.asset.exchangeSymbol]; const lev = leverages[signal.asset.exchangeSymbol] ?? 20; const sign = signal.preSide === 'SHORT' ? -1 : 1;
        return <article className={`card ${signal.side.toLowerCase()}`} key={signal.asset.exchangeSymbol}>
          <div className="card-head"><div><span className="pair">{signal.asset.symbol}</span><span className="tf">1M</span></div><span className="side">{signal.side === 'LONG' ? <TrendingUp size={16}/> : signal.side === 'SHORT' ? <TrendingDown size={16}/> : <ShieldCheck size={16}/>} {signal.side}</span></div>
          <div className="price"><span>Precio futuro</span><strong>{formatPrice(signal.price)}</strong></div>
          <div className="scores"><div><span>Confianza</span><strong>{signal.confidence}%</strong></div><div><span>Conf. proyectada</span><strong className="blue">{signal.projected}%</strong></div><div><span>Score</span><strong>{signal.score}/100</strong></div><div><span>Backtest</span><strong>{bt ? `${bt.hitRate.toFixed(1)}%` : '—'}</strong></div></div>
          <div className={`pre ${signal.preSide.toLowerCase()}`}><div className="pre-head"><span>Pronóstico anticipado</span><b>{signal.preSide === 'LONG' ? 'PRE-LONG' : signal.preSide === 'SHORT' ? 'PRE-SHORT' : 'NEUTRAL'}</b></div><div className="pre-main"><strong>{signal.preProbability}%</strong><span>{signal.state}</span><span>{signal.horizon}</span></div></div>
          {signal.displacement && signal.price && <div className="displacements">{([['Conservador', signal.displacement.conservative], ['Base', signal.displacement.base], ['Agresivo', signal.displacement.aggressive]] as const).map(([name, pct]) => <div key={name}><span>{name}</span><dl><dt>Desplazamiento</dt><dd>{sign > 0 ? '+' : '-'}{pct.toFixed(2)}%</dd><dt>Δ precio</dt><dd>{sign > 0 ? '+' : '-'}{formatPrice(signal.price! * pct / 100)}</dd><dt>Objetivo</dt><dd>{formatPrice(signal.price * (1 + sign * pct / 100))}</dd></dl></div>)}</div>}
          <div className={`leverage ${lev >= 40 ? 'danger' : lev >= 20 ? 'warn' : ''}`}><div><span>Apalancamiento</span><b>{lev}x</b></div><div className="stepper"><button onClick={() => setLeverages(x => ({ ...x, [signal.asset.exchangeSymbol]: clamp(lev - 1, 1, 75) }))}>−</button><strong>{lev}x</strong><button onClick={() => setLeverages(x => ({ ...x, [signal.asset.exchangeSymbol]: clamp(lev + 1, 1, 75) }))}>+</button></div><input type="range" min="1" max="75" value={lev} onChange={e => setLeverages(x => ({ ...x, [signal.asset.exchangeSymbol]: Number(e.target.value) }))}/><small>Margen relativo {(100 / lev).toFixed(2)}% · simulación informativa, no ejecuta órdenes.</small></div>
          <div className="micro"><span>Book <b>{(signal.market.bookImbalance * 100).toFixed(1)}%</b></span><span>Flujo <b>{(signal.market.flowImbalance * 100).toFixed(1)}%</b></span><span>Δ OI <b>{signal.market.oiChange.toFixed(3)}%</b></span><span>Funding <b>{signal.market.funding === null ? '—' : `${signal.market.funding.toFixed(4)}%`}</b></span></div>
          <div className="history"><div><span>Retorno 20m</span><b>{signal.market.historyReturn20.toFixed(2)}%</b></div><Sparkline values={signal.market.closes}/><p>ATR {signal.market.atrPct.toFixed(2)}% · Vol {signal.market.volumeRatio.toFixed(2)}x · RSI {signal.market.rsi?.toFixed(1) ?? '—'} · MFE hist. {bt?.avgMfe.toFixed(2) ?? '—'}%</p></div>
        </article>;
      })}
    </section>
    {!visible.length && <section className="empty">No hay señales que cumplan los filtros actuales.</section>}
    <footer><ShieldCheck size={15}/> Análisis experimental; no ejecuta operaciones ni garantiza resultados. Último evento: {lastUpdate}</footer>
  </main>;
}
