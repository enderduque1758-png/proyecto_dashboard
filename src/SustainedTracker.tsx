import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Clock3, Volume2, VolumeX, X } from 'lucide-react';

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
  reason: string;
};
type AlertItem = {
  id: string;
  symbol: string;
  state: TrackState;
  reason: string;
  ts: number;
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
  let reason = 'Sin persistencia suficiente para confirmar dirección.';
  if (state === 'LONG_SOSTENIDO') {
    reason = `${longCount}/${recent.length} lecturas LONG, ${consistency}% consistencia, confianza media ${avgProjected.toFixed(0)}%, movimiento 5m ${latest.move5m >= 0 ? '+' : ''}${latest.move5m.toFixed(2)}% y ${latest.regime.toLowerCase()}.`;
  } else if (state === 'SHORT_SOSTENIDO') {
    reason = `${shortCount}/${recent.length} lecturas SHORT, ${consistency}% consistencia, confianza media ${avgProjected.toFixed(0)}%, movimiento 5m ${latest.move5m.toFixed(2)}% y ${latest.regime.toLowerCase()}.`;
  } else if (state === 'TRANSICION') {
    reason = `Cambio de sesgo detectado: hubo lecturas LONG y SHORT en las últimas 4 muestras. OI ${latest.oiChange >= 0 ? '+' : ''}${latest.oiChange.toFixed(3)}%, 5m ${latest.move5m >= 0 ? '+' : ''}${latest.move5m.toFixed(2)}% y régimen ${latest.regime.toLowerCase()}.`;
  } else if (state === 'POTENCIAL_LONG') {
    reason = `Sesgo LONG aún no sostenido: ${longCount}/${recent.length} lecturas, confianza ${latest.projected.toFixed(0)}% y alineación ${latest.alignment.toFixed(0)}%.`;
  } else if (state === 'POTENCIAL_SHORT') {
    reason = `Sesgo SHORT aún no sostenido: ${shortCount}/${recent.length} lecturas, confianza ${latest.projected.toFixed(0)}% y alineación ${latest.alignment.toFixed(0)}%.`;
  }

  return { symbol: latest.symbol, state, score, consistency, projected: latest.projected, move5m: latest.move5m, oiChange: latest.oiChange, regime: latest.regime, samples: recent.length, reason };
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

function playAlertTone(state: TrackState, ctxRef: React.MutableRefObject<AudioContext | null>) {
  const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;
  const ctx = ctxRef.current ?? new AudioCtx();
  ctxRef.current = ctx;
  if (ctx.state === 'suspended') void ctx.resume();
  const now = ctx.currentTime;
  const frequencies = state === 'LONG_SOSTENIDO' ? [660, 880] : state === 'SHORT_SOSTENIDO' ? [440, 330] : [520, 620, 520];
  frequencies.forEach((frequency, index) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, now + index * 0.13);
    gain.gain.exponentialRampToValueAtTime(0.08, now + index * 0.13 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.13 + 0.11);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + index * 0.13);
    osc.stop(now + index * 0.13 + 0.12);
  });
}

export default function SustainedTracker() {
  const [history, setHistory] = useState<Record<string, Reading[]>>({});
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem('crypto-alert-sound') !== 'off');
  const previousStates = useRef<Record<string, TrackState>>({});
  const audioContext = useRef<AudioContext | null>(null);

  useEffect(() => {
    const unlock = () => {
      const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = audioContext.current ?? new AudioCtx();
      audioContext.current = ctx;
      if (ctx.state === 'suspended') void ctx.resume();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

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

  useEffect(() => {
    if (!tracked.length) return;
    const nextPrevious = { ...previousStates.current };
    const newAlerts: AlertItem[] = [];
    tracked.forEach(item => {
      const prev = previousStates.current[item.symbol];
      nextPrevious[item.symbol] = item.state;
      const target = item.state === 'LONG_SOSTENIDO' || item.state === 'SHORT_SOSTENIDO' || item.state === 'TRANSICION';
      if (!prev || prev === item.state || !target) return;
      newAlerts.push({ id: `${item.symbol}-${item.state}-${Date.now()}`, symbol: item.symbol, state: item.state, reason: item.reason, ts: Date.now() });
      if (soundEnabled) playAlertTone(item.state, audioContext);
    });
    previousStates.current = nextPrevious;
    if (newAlerts.length) {
      setAlerts(prev => [...newAlerts, ...prev].slice(0, 4));
      const ids = newAlerts.map(x => x.id);
      window.setTimeout(() => setAlerts(prev => prev.filter(x => !ids.includes(x.id))), 12000);
    }
  }, [tracked, soundEnabled]);

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    localStorage.setItem('crypto-alert-sound', next ? 'on' : 'off');
    if (next) playAlertTone('TRANSICION', audioContext);
  };

  if (!tracked.length) return null;
  const top = tracked[0];

  return <>
    <div className="market-alert-stack" aria-live="assertive">
      {alerts.map(alert => <article className={`market-alert ${tone(alert.state)}`} key={alert.id}>
        <div className="market-alert-icon">{alert.state === 'LONG_SOSTENIDO' ? <ArrowUpRight size={20}/> : alert.state === 'SHORT_SOSTENIDO' ? <ArrowDownRight size={20}/> : <AlertTriangle size={20}/>}</div>
        <div className="market-alert-copy"><span>{alert.symbol}</span><strong>{stateLabel(alert.state)}</strong><p>{alert.reason}</p></div>
        <button aria-label="Cerrar alerta" onClick={() => setAlerts(prev => prev.filter(x => x.id !== alert.id))}><X size={16}/></button>
      </article>)}
    </div>

    <section className="sustained-tracker">
      <div className="tracker-head">
        <div><span><Activity size={15}/> Seguimiento sostenido</span><small>6 lecturas recientes · actualización cada 5s</small></div>
        <div className="tracker-actions"><button className={`sound-toggle ${soundEnabled ? 'on' : ''}`} onClick={toggleSound}>{soundEnabled ? <Volume2 size={14}/> : <VolumeX size={14}/>} {soundEnabled ? 'Sonido ON' : 'Sonido OFF'}</button><div className={`tracker-main-state ${tone(top.state)}`}>{stateLabel(top.state)}</div></div>
      </div>
      <div className="tracker-top">
        <div className={`tracker-icon ${tone(top.state)}`}>{top.state.includes('LONG') ? <ArrowUpRight size={20}/> : top.state.includes('SHORT') ? <ArrowDownRight size={20}/> : <Clock3 size={20}/>}</div>
        <div className="tracker-top-copy"><strong>{top.symbol}</strong><span>{top.score}% persistencia · {top.consistency}% consistencia</span><p>{top.reason}</p></div>
        <div className="tracker-top-metrics"><span>5m <b>{top.move5m >= 0 ? '+' : ''}{top.move5m.toFixed(2)}%</b></span><span>OI <b>{top.oiChange >= 0 ? '+' : ''}{top.oiChange.toFixed(3)}%</b></span></div>
      </div>
      <div className="tracker-list">
        {tracked.slice(0, 6).map(item => <div className="tracker-row" key={item.symbol}>
          <div><strong>{item.symbol}</strong><small>{item.reason}</small></div>
          <span className={`tracker-state ${tone(item.state)}`}>{stateLabel(item.state)}</span>
          <span className="tracker-score">{item.score}%</span>
        </div>)}
      </div>
      <p className="tracker-note">Las alertas solo se disparan cuando el estado cambia a LONG SOSTENIDO, SHORT SOSTENIDO o TRANSICIÓN; no se repiten en cada refresco. Algunos navegadores requieren una interacción con la página antes de permitir sonido.</p>
    </section>
  </>;
}
