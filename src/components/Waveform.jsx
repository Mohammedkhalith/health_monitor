export default function Waveform({ title, series = [], color = '#10b981', min = 0, max = 4095, caption, empty = 'Waiting for device samples' }) {
  const width = 700, height = 155;
  const range = (max - min) || 1;
  const point = (v, i, n) => {
    const val = Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : min;
    const x = (i / Math.max(n - 1, 1)) * width;
    const y = height - 8 - ((val - min) / range) * (height - 16);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };
  return <article className="chart-card">
    <div className="chart-header"><div className="chart-title-wrap"><span className="chart-dot" style={{ background: color }} /><span className="chart-title">{title}</span></div><span className="chart-tag">{caption}</span></div>
    <div className="canvas-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={title}>
        {[1,2,3].map(i => <line key={`h${i}`} x1="0" x2={width} y1={height*i/4} y2={height*i/4} stroke="#182234" />)}
        {[1,2,3,4,5,6,7].map(i => <line key={`v${i}`} y1="0" y2={height} x1={width*i/8} x2={width*i/8} stroke="#182234" />)}
        {series.map((s, i) => s.values.length > 1 && <polyline key={i} points={s.values.map((v,j) => point(v,j,s.values.length)).join(' ')} fill="none" stroke={s.color || color} strokeWidth="2" vectorEffect="non-scaling-stroke" />)}
      </svg>
      {!series.some(s => s.values.length > 1) && <span className="empty-wave">{empty}</span>}
    </div>
  </article>;
}
