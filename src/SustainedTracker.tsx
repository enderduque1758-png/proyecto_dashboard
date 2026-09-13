import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowDownRight, ArrowUpRight, Clock3 } from 'lucide-react';

type Direction = 'LONG' | 'SHORT' | 'NEUTRAL';
type Reading = {
  symbol: string;
  direction: Direction;
  projected: number;
  alignment: number;
  move5m: number;
  oiChange: number;
  regime: string;
  ts: number;
};
type TrackState = 'LONG_SOSTENIDO' | 'SHORT_SOSTENIDO' | 'POTENCIAL_LONG' | 'POTENCIAL_SHORT' | 'TRANSICION' | 'NEUTRAL';
type TrackView = {
  symbol: string;
  state: TrackState;
  score: number;
  consistency: number;
  projected: number;
  move5m: number;
  oiChange: number;
  regime: string;
  samples: number;
};

const parseNumber = (value = '') => {
  const match = value.replace(',', '.').match(/[-+]?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
};

function readWalletRows(): Reading[] {
  return [...document.querySelectorAll<HTMLElement>('.wallet-asset')].map(card => {
    const symbol = card.querySelector('.asset-title strong')?.textContent?.trim() || '—';
    const action = card.querySelector('.mini-pill')?.textContent?.trim().toUpperCase() || '';
    const direction: Direction = action.includes('LONG') ? 'LONG' : action.includes('SHORT') ? 'SHORT' : 'NEUTRAL';
    const sub = [...card.querySelectorAll('.asset-sub span')].map(x => x.textContent?.trim() || '');
    const projected = parseNumber(sub.find(x => x.includes('proyectada')) || '0');
    const alignment = parseNumber(sub.find(x => x.includes('alineación')) || '0');
    const move5m = parseNumber(card.querySelector('.asset-side strong')?.textContent || '0');
    const detailCells = [...card.querySelectorAll<HTMLElement>('.detail-grid > div')];
    const oiCell = detailCells.find(x => x.textContent?.includes('OI 5s'));
    const regimeCell = detailCells.find(x => x.textContent?.includes('Régimen'));
    const oiChange = parseNumber(oiCell?.querySelector('b')?.textContent || '0');
    const regime = regimeCell?.querySelector('b')?.textContent?.trim() || 'OI neutral';
    return { symbol, direction, projected, alignment, move5m, oiChange, regime, ts: Date.now() };
  }).filter(x => x.symbol !== '—');
}

function classify(history: Reading[]): TrackView | null {
  if (!history.length) return null;
  const recent = history.slice(-6);
  const latest = recent.at(-1)!;
  const last3 = recent.slice(-3);
  const longCount = recent.filter(x => x.direction === 'LONG').length;
  const shortCount = recent.filter(x => x.direction === 'SHORT').length;
  const last3Long = last3.length >= 3 && last3.every(x => x.direction === 'LONG');
  const last3Short = last3.length >= 3 && last3.every(x => x.direction === 'SHORT');
  const recentDirs = recent.slice(-4).map(x => x.direction).filter(x => x !== 'NEUTRAL');
  const hasFlip = recentDirs.includes('LONG') && recentDirs.includes('SHORT');
  const avgProjected = recent.reduce((s, x) => s + x.projected, 0) / recent.length;
  const avgAlignment = recent.reduce((s, x) => s + x.alignment, 0) / recent.length;
  const consistency = Math.round(Math.max(longCount, shortCount) / recent.length * 100);
  const longSupport = latest.regime.toLowerCase().includes('largos') || latest.oiChange > 0;
  const shortSupport = latest.regime.toLowerCase().includes('cortos') || latest.oiChange > 0;

  let state: TrackState = 'NEUTRAL';
  if (hasFlip) state = 'TRANSICION';
  else if (last3Long && longCount >= 4 && avgProjected >= 65 && avgAlignment >= 55 && latest.move5m >= 0 && longSupport) state = 'LONG_SOSTENIDO';
  else if (last3Short && shortCount >= 4 && avgProjected >= 65 && avgAlignment >= 55 && latest.move5m <= 0 && shortSupport) state = 'SHORT_SOSTENIDO';
  else if (latest.direction === 'LONG' && latest.projected >= 58) state = 'POTENCIAL_LONG';
  else if (latest.direction === 'SHORT' && latest.projected >= 58) state = 'POTENCIAL_SHORT';

  const score = Math.round(Math.min(99, avgProjected * 0.55 + avgAlignment * 0.25 + consistency * 0.2));
  return { symbol: latest.symbol, state, score, consistency, projected: latest.projected, move5m: latest.move5m, oiChange: latest.oiChange, regime: latest.regime, samples: recent.length };
}

function stateLabel(state: TrackState) {
  if (state === 'LONG_SOSTENIDO') return 'LONG SOSTENIDO';
  if (state === 'SHORT_SOSTENIDO') return 'SHORT SOSTENIDO';
  if (state === 'POTENCIAL_LONG') return 'POTENCIAL LONG';
  if (state === 'POTENCIAL_SHORT') return 'POTENCIAL SHORT';
  if (state === 'TRANSICION') return 'TRANSICIÓN';
  return 'NEUTRAL';
}

function tone(state: TrackState) {
  if (state.includes('LONG')) return 'long';
  if (state.includes('SHORT')) return 'short';
  if (state === 'TRANSICION') return 'transition';
  return 'neutral';
}

export default function SustainedTracker() {
  const [history, setHistory] = useState<Record<string, Reading[]>>({});

  useEffect(() => {
    const sample = () => {
      const rows = readWalletRows();
      if (!rows.length) return;
      setHistory(prev => {
        const next = { ...prev };
        rows.forEach(row => {
          next[row.symbol] = [...(next[row.symbol] || []), row].slice(-12);
        });
        return next;
      });
    };
    const first = window.setTimeout(sample, 1800);
    const id = window.setInterval(sample, 5000);
    return () => { window.clearTimeout(first); window.clearInterval(id); };
  }, []);

  const tracked = useMemo(() => Object.values(history)
    .map(classify)
    .filter((x): x is TrackView => Boolean(x))
    .sort((a, b) => {
      const priority = (s: TrackState) => s.includes('SOSTENIDO') ? 3 : s.includes('POTENCIAL') ? 2 : s === 'TRANSICION' ? 1 : 0;
      return priority(b.state) - priority(a.state) || b.score - a.score;
    }), [history]);

  if (!tracked.length) return null;
  const top = tracked[0];

  return <section className="sustained-tracker">
    <div className="tracker-head">
      <div><span><Activity size={15}/> Seguimiento sostenido</span><small>6 lecturas recientes · actualización cada 5s</small></div>
      <div className={`tracker-main-state ${tone(top.state)}`}>{stateLabel(top.state)}</div>
    </div>
    <div className="tracker-top">
      <div className={`tracker-icon ${tone(top.state)}`}>{top.state.includes('LONG') ? <ArrowUpRight size={20}/> : top.state.includes('SHORT') ? <ArrowDownRight size={20}/> : <Clock3 size={20}/>}</div>
      <div className="tracker-top-copy"><strong>{top.symbol}</strong><span>{top.score}% persistencia · {top.consistency}% consistencia</span></div>
      <div className="tracker-top-metrics"><span>5m <b>{top.move5m >= 0 ? '+' : ''}{top.move5m.toFixed(2)}%</b></span><span>OI <b>{top.oiChange >= 0 ? '+' : ''}{top.oiChange.toFixed(3)}%</b></span></div>
    </div>
    <div className="tracker-list">
      {tracked.slice(0, 6).map(item => <div className="tracker-row" key={item.symbol}>
        <div><strong>{item.symbol}</strong><small>{item.regime}</small></div>
        <span className={`tracker-state ${tone(item.state)}`}>{stateLabel(item.state)}</span>
        <span className="tracker-score">{item.score}%</span>
      </div>)}
    </div>
    <p className="tracker-note">“Sostenido” requiere varias lecturas consecutivas en la misma dirección; una sola señal no basta. El estado puede cambiar cuando precio, OI o flujo pierden confirmación.</p>
  </section>;
}
