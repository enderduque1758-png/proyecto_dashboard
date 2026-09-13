import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDownRight, ArrowUpRight, Bell, Eye, History, Radar, SlidersHorizontal, Trash2, Volume2, VolumeX, X } from 'lucide-react';

type Direction = 'LONG' | 'SHORT' | 'WATCH' | 'TRANSITION';
type Tick = { price: number; quoteVolume: number; ts: number };
type Candidate = {
  symbol: string;
  direction: Direction;
  score: number;
  move10s: number;
  move30s: number;
  move60s: number;
  accel: number;
  volumeImpulse: number;
  oiChange: number | null;
  reason: string;
};
type LeaderAlert = { id: number; symbol: string; direction: Direction; title: string; reason: string; score: number };
type LeaderHistory = { id: number; ts: number; symbol: string; direction: Direction; score: number; reason: string; change: string };
type TickerRow = { s?: string; c?: string; q?: string };
type HistoryMap = Record<string, Tick[]>;

const pct = (now: number, then?: number) => then && then > 0 ? ((now - then) / then) * 100 : 0;
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const pair = (symbol: string) => symbol.replace('USDT', '/USDT');

function sampleAt(history: Tick[], secondsAgo: number) {
  const target = Date.now() - secondsAgo * 1000;
  let best: Tick | undefined;
  for (const row of history) {
    if (row.ts <= target) best = row;
    else break;
  }
  return best ?? history[0];
}

function classify(symbol: string, history: Tick[], oiChange: number | null): Candidate | null {
  if (history.length < 3) return null;
  const latest = history.at(-1)!;
  const p10 = sampleAt(history, 10), p30 = sampleAt(history, 30), p60 = sampleAt(history, 60);
  const move10s = pct(latest.price, p10?.price);
  const move30s = pct(latest.price, p30?.price);
  const move60s = pct(latest.price, p60?.price);
  const accel = move10s - move30s / 3;
  const volBase = p30?.quoteVolume ?? latest.quoteVolume;
  const volumeImpulse = volBase > 0 ? Math.max(0, ((latest.quoteVolume - volBase) / volBase) * 100) : 0;
  const longRaw = move10s * 55 + move30s * 24 + move60s * 10 + accel * 75 + clamp(volumeImpulse * 0.15, 0, 12) + (oiChange && oiChange > 0 ? clamp(oiChange * 55, 0, 12) : 0);
  const shortRaw = -move10s * 55 - move30s * 24 - move60s * 10 - accel * 75 + clamp(volumeImpulse * 0.15, 0, 12) + (oiChange && oiChange > 0 ? clamp(oiChange * 55, 0, 12) : 0);
  const gap = Math.abs(longRaw - shortRaw);
  const strength = Math.max(longRaw, shortRaw);
  let direction: Direction = 'WATCH';
  if (move10s * move30s < 0 && Math.abs(move10s) > 0.06 && Math.abs(move30s) > 0.08) direction = 'TRANSITION';
  else if (strength >= 11 && gap >= 4) direction = longRaw > shortRaw ? 'LONG' : 'SHORT';
  const score = Math.round(clamp(50 + Math.max(0, strength) * 2.2, 50, 98));
  const reasons: string[] = [];
  if (Math.abs(move10s) >= 0.05) reasons.push(`10s ${move10s >= 0 ? '+' : ''}${move10s.toFixed(2)}%`);
  if (Math.abs(move30s) >= 0.08) reasons.push(`30s ${move30s >= 0 ? '+' : ''}${move30s.toFixed(2)}%`);
  if (Math.abs(accel) >= 0.03) reasons.push(`aceleración ${accel >= 0 ? '+' : ''}${accel.toFixed(2)}%`);
  if (volumeImpulse >= 0.25) reasons.push(`volumen +${volumeImpulse.toFixed(2)}%`);
  if (oiChange !== null && Math.abs(oiChange) >= 0.004) reasons.push(`OI ${oiChange >= 0 ? '+' : ''}${oiChange.toFixed(3)}%`);
  if (!reasons.length) reasons.push('cambio incipiente');
  return { symbol, direction, score, move10s, move30s, move60s, accel, volumeImpulse, oiChange, reason: reasons.slice(0, 3).join(' · ') };
}

function directionLabel(direction: Direction) {
  if (direction === 'LONG') return 'LONG';
  if (direction === 'SHORT') return 'SHORT';
  if (direction === 'TRANSITION') return 'TRANSICIÓN';
  return 'OBSERVAR';
}

function horizonOf(item: Candidate) {
  if (item.direction === 'TRANSITION') return '30s–5m';
  if (item.score >= 88 && Math.abs(item.move10s) >= 0.10) return '30s–2m';
  if (item.score >= 76 || Math.abs(item.move30s) >= 0.16) return '2–5m';
  return '5–15m';
}

function pendingConfirmations(item: Candidate) {
  const pending: string[] = [];
  if (item.direction === 'TRANSITION') pending.push('Definir dirección entre 10s y 30s');
  if (item.oiChange === null) pending.push('Esperar lectura de Open Interest');
  else if ((item.direction === 'LONG' || item.direction === 'SHORT') && item.oiChange <= 0) pending.push('OI debe expandirse con el movimiento');
  if (item.volumeImpulse < 0.35) pending.push('Mayor expansión de volumen');
  if (Math.abs(item.accel) < 0.03) pending.push('Aceleración todavía débil');
  if (item.direction === 'LONG' && item.move10s <= 0) pending.push('10s debe volver a positivo');
  if (item.direction === 'SHORT' && item.move10s >= 0) pending.push('10s debe volver a negativo');
  return pending.slice(0, 3);
}

function playAlertTone(direction: Direction) {
  try {
    const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const frequencies = direction === 'LONG' ? [660, 880] : direction === 'SHORT' ? [520, 360] : [520, 660, 520];
    frequencies.forEach((frequency, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = now + index * 0.12;
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.11, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.10);
      osc.connect(gain); gain.connect(ctx.destination); osc.start(start); osc.stop(start + 0.11);
    });
    window.setTimeout(() => ctx.close().catch(() => undefined), 900);
  } catch { /* browser may require user interaction */ }
}

export default function GlobalMarketMonitor() {
  const [perpetuals, setPerpetuals] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<HistoryMap>({});
  const [oi, setOi] = useState<Record<string, { value: number; change: number | null }>>({});
  const [connected, setConnected] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem('marketLeaderSound') !== 'off');
  const [confidenceThreshold, setConfidenceThreshold] = useState(() => clamp(Number(localStorage.getItem('marketConfidenceThreshold') ?? 65), 55, 90));
  const [alert, setAlert] = useState<LeaderAlert | null>(null);
  const [leaderHistory, setLeaderHistory] = useState<LeaderHistory[]>(() => {
    try { return JSON.parse(localStorage.getItem('marketLeaderHistory') ?? '[]').slice(0, 20); } catch { return []; }
  });
  const previousLeaderRef = useRef<Candidate | null>(null);

  useEffect(() => {
    fetch('https://fapi.binance.com/fapi/v1/exchangeInfo').then(r => r.json()).then((data: { symbols?: Array<{ symbol?: string; status?: string; contractType?: string }> }) => {
      setPerpetuals(new Set((data.symbols ?? []).filter(x => x.status === 'TRADING' && x.contractType === 'PERPETUAL').map(x => String(x.symbol ?? '')).filter(Boolean)));
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!perpetuals.size) return;
    let alive = true;
    const ws = new WebSocket('wss://fstream.binance.com/ws/!ticker@arr');
    ws.onopen = () => alive && setConnected(true);
    ws.onmessage = ev => {
      if (!alive) return;
      try {
        const rows = JSON.parse(ev.data) as TickerRow[];
        const now = Date.now();
        setHistory(prev => {
          const next = { ...prev };
          rows.forEach(row => {
            const symbol = String(row.s ?? '');
            if (!perpetuals.has(symbol)) return;
            const price = Number(row.c ?? 0), quoteVolume = Number(row.q ?? 0);
            if (!price) return;
            const list = [...(next[symbol] ?? []), { price, quoteVolume, ts: now }].filter(x => now - x.ts <= 75000);
            next[symbol] = list.length > 90 ? list.slice(-90) : list;
          });
          return next;
        });
      } catch { /* ignore malformed packets */ }
    };
    ws.onclose = () => alive && setConnected(false);
    return () => { alive = false; ws.close(); };
  }, [perpetuals]);

  const rawCandidates = useMemo(() => Object.entries(history).map(([symbol, rows]) => classify(symbol, rows, oi[symbol]?.change ?? null)).filter((x): x is Candidate => Boolean(x)).filter(x => x.direction !== 'WATCH' || x.score >= 60).sort((a, b) => b.score - a.score), [history, oi]);
  const topSymbols = useMemo(() => rawCandidates.slice(0, 8).map(x => x.symbol), [rawCandidates]);

  useEffect(() => {
    if (!topSymbols.length) return;
    let active = true;
    const enrich = async () => {
      const rows = await Promise.allSettled(topSymbols.map(async symbol => {
        const res = await fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`);
        const data = await res.json() as { openInterest?: string };
        return { symbol, value: Number(data.openInterest ?? 0) };
      }));
      if (!active) return;
      setOi(prev => {
        const next = { ...prev };
        rows.forEach(row => {
          if (row.status !== 'fulfilled' || !row.value.value) return;
          const old = prev[row.value.symbol]?.value;
          next[row.value.symbol] = { value: row.value.value, change: old && old > 0 ? ((row.value.value - old) / old) * 100 : null };
        });
        return next;
      });
    };
    enrich().catch(() => undefined);
    const id = window.setInterval(() => enrich().catch(() => undefined), 15000);
    return () => { active = false; window.clearInterval(id); };
  }, [topSymbols.join('|')]);

  const candidates = useMemo(() => Object.entries(history).map(([symbol, rows]) => classify(symbol, rows, oi[symbol]?.change ?? null)).filter((x): x is Candidate => Boolean(x)).sort((a, b) => b.score - a.score), [history, oi]);
  const visibleCandidates = useMemo(() => candidates.filter(x => x.score >= confidenceThreshold).slice(0, 8), [candidates, confidenceThreshold]);
  const leader = visibleCandidates.find(x => x.direction !== 'WATCH') ?? visibleCandidates[0];
  const leaderPending = leader ? pendingConfirmations(leader) : [];

  useEffect(() => {
    localStorage.setItem('marketConfidenceThreshold', String(confidenceThreshold));
  }, [confidenceThreshold]);

  useEffect(() => {
    if (!leader) return;
    const previous = previousLeaderRef.current;
    if (!previous) { previousLeaderRef.current = leader; return; }
    const leaderChanged = previous.symbol !== leader.symbol;
    const directionChanged = previous.direction !== leader.direction;
    const confidenceDelta = leader.score - previous.score;
    const confidenceChanged = Math.abs(confidenceDelta) >= 5;
    if (leaderChanged || directionChanged || confidenceChanged) {
      const changes: string[] = [];
      if (leaderChanged) changes.push(`líder ${pair(previous.symbol)} → ${pair(leader.symbol)}`);
      if (directionChanged) changes.push(`dirección ${directionLabel(previous.direction)} → ${directionLabel(leader.direction)}`);
      if (confidenceChanged) changes.push(`confianza ${previous.score}% → ${leader.score}% (${confidenceDelta >= 0 ? '+' : ''}${confidenceDelta})`);
      const change = changes.join(' · ');
      const reason = `${change}. Señal actual: ${leader.reason}.`;
      const entry: LeaderHistory = { id: Date.now(), ts: Date.now(), symbol: leader.symbol, direction: leader.direction, score: leader.score, reason: leader.reason, change };
      setLeaderHistory(prev => {
        const next = [entry, ...prev].slice(0, 20);
        localStorage.setItem('marketLeaderHistory', JSON.stringify(next));
        return next;
      });
      setAlert({ id: entry.id, symbol: leader.symbol, direction: leader.direction, title: 'Cambió la señal líder', reason, score: leader.score });
      if (soundEnabled) playAlertTone(leader.direction);
    }
    previousLeaderRef.current = leader;
  }, [leader?.symbol, leader?.direction, leader?.score, leader?.reason, soundEnabled]);

  useEffect(() => {
    if (!alert) return;
    const id = window.setTimeout(() => setAlert(null), 12000);
    return () => window.clearTimeout(id);
  }, [alert?.id]);

  const toggleSound = () => setSoundEnabled(value => {
    const next = !value;
    localStorage.setItem('marketLeaderSound', next ? 'on' : 'off');
    if (next) playAlertTone('TRANSITION');
    return next;
  });

  const clearLeaderHistory = () => { setLeaderHistory([]); localStorage.removeItem('marketLeaderHistory'); };

  return <section className="global-monitor">
    {alert && <div className={`leader-alert ${alert.direction.toLowerCase()}`} role="status" aria-live="polite">
      <div className="leader-alert-icon"><Bell size={18}/></div>
      <div className="leader-alert-copy"><strong>{alert.title}</strong><span>{pair(alert.symbol)} · {directionLabel(alert.direction)} · {alert.score}%</span><p>{alert.reason}</p></div>
      <button type="button" onClick={() => setAlert(null)} aria-label="Cerrar alerta"><X size={16}/></button>
    </div>}

    <div className="signal-console-head">
      <div><span className="signal-kicker">CRYPTO MARKET SIGNALS</span><h1>Centro de señales</h1><p>Detecta aceleraciones, cambios de líder y posibles movimientos antes de que se consoliden.</p></div>
      <div className="signal-console-status"><span className={connected ? 'dot live' : 'dot'}></span><b>{connected ? 'Mercado en vivo' : 'Reconectando'}</b><small>{perpetuals.size} perpetuos</small></div>
    </div>

    <div className="signal-toolbar">
      <div className="threshold-control"><div><SlidersHorizontal size={14}/><span>Umbral de confianza</span><b>{confidenceThreshold}%</b></div><input aria-label="Umbral de confianza" type="range" min="55" max="90" step="1" value={confidenceThreshold} onChange={e => setConfidenceThreshold(Number(e.target.value))}/><small>Solo se muestran y alertan señales con score igual o superior.</small></div>
      <button type="button" className="global-sound" onClick={toggleSound}>{soundEnabled ? <Volume2 size={14}/> : <VolumeX size={14}/>}<span>{soundEnabled ? 'Alertas sonoras' : 'Sonido desactivado'}</span></button>
      <div className={connected ? 'global-live online' : 'global-live'}><Activity size={13}/>{connected ? 'LIVE' : 'OFF'}</div>
    </div>

    <div className={`next-market-move ${leader ? leader.direction.toLowerCase() : 'watch'}`}>
      <div className="next-market-head"><span>Señal líder · siguiente movimiento probable</span><b>{leader ? directionLabel(leader.direction) : 'SIN SEÑAL'}</b></div>
      {leader ? <>
        <div className="next-market-main">
          <div className="next-market-asset"><small>Cripto líder</small><strong>{pair(leader.symbol)}</strong><span>{leader.reason}</span></div>
          <div className="next-market-stats"><div><small>Dirección</small><strong>{directionLabel(leader.direction)}</strong></div><div><small>Confianza</small><strong>{leader.score}%</strong></div><div><small>Horizonte</small><strong>{horizonOf(leader)}</strong></div></div>
        </div>
        <div className="next-confirmations"><span>Confirmaciones pendientes</span><div>{leaderPending.length ? leaderPending.map(item => <b key={item}>{item}</b>) : <b className="confirmed">Sin confirmaciones críticas pendientes</b>}</div></div>
      </> : <div className="next-market-loading">No hay señales por encima del umbral de {confidenceThreshold}%. Reduce el umbral o espera una nueva aceleración.</div>}
    </div>

    <div className="signal-section-title"><div><Radar size={15}/><span>Ranking de oportunidades</span></div><small>{visibleCandidates.length} señales ≥ {confidenceThreshold}%</small></div>
    <div className="global-monitor-grid">
      {visibleCandidates.slice(0, 6).map(item => <article className={`global-candidate ${item.direction.toLowerCase()}`} key={item.symbol}>
        <div className="global-candidate-top"><div className="global-icon">{item.direction === 'LONG' ? <ArrowUpRight size={18}/> : item.direction === 'SHORT' ? <ArrowDownRight size={18}/> : <Eye size={18}/>}</div><div><strong>{pair(item.symbol)}</strong><small>{item.reason}</small></div><span>{item.score}%</span></div>
        <div className="global-metrics"><span>10s <b>{item.move10s >= 0 ? '+' : ''}{item.move10s.toFixed(2)}%</b></span><span>30s <b>{item.move30s >= 0 ? '+' : ''}{item.move30s.toFixed(2)}%</b></span><span>60s <b>{item.move60s >= 0 ? '+' : ''}{item.move60s.toFixed(2)}%</b></span><span>OI <b>{item.oiChange === null ? '—' : `${item.oiChange >= 0 ? '+' : ''}${item.oiChange.toFixed(3)}%`}</b></span></div>
        <div className={`global-action ${item.direction.toLowerCase()}`}>{item.direction === 'LONG' ? 'IMPULSO LONG' : item.direction === 'SHORT' ? 'IMPULSO SHORT' : item.direction === 'TRANSITION' ? 'TRANSICIÓN' : 'OBSERVAR'}</div>
      </article>)}
    </div>

    <div className="leader-history-panel">
      <div className="leader-history-head"><div><History size={15}/><span>Historial de cambios del líder</span></div><button type="button" onClick={clearLeaderHistory} disabled={!leaderHistory.length}><Trash2 size={13}/> Limpiar</button></div>
      {leaderHistory.length ? <div className="leader-history-list">{leaderHistory.slice(0, 8).map(item => <div className="leader-history-row" key={item.id}><time>{new Date(item.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><div><strong>{pair(item.symbol)}</strong><small>{item.change}</small><span>{item.reason}</span></div><b className={item.direction.toLowerCase()}>{directionLabel(item.direction)} · {item.score}%</b></div>)}</div> : <div className="leader-history-empty">El historial aparecerá cuando cambie la cripto líder, la dirección o la confianza en ≥ 5 puntos.</div>}
    </div>

    <p className="global-monitor-note">Datos públicos de Binance Futures. La confianza es un score heurístico de confluencia, no una probabilidad garantizada ni una instrucción automática de trading.</p>
  </section>;
}
