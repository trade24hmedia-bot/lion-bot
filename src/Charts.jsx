import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar, Cell, ReferenceLine } from 'recharts';
import { fmt, vnDate, monthLabel } from './lib.js';

const axis = { stroke: 'var(--line)', tick: { fill: 'var(--ink-muted)', fontSize: 12 }, tickLine: false };
const tip = { contentStyle: { background: 'var(--surface-200)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--ink)' }, labelStyle: { color: 'var(--ink-muted)' } };

export function LineArea({ data, x, y, height = 260, prefix = '' }) {
  if (!data || !data.length) return null;
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs><linearGradient id="lbArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--brand)" stopOpacity={0.28} /><stop offset="100%" stopColor="var(--brand)" stopOpacity={0} /></linearGradient></defs>
          <CartesianGrid vertical={false} stroke="var(--line)" strokeOpacity={0.6} />
          <XAxis dataKey={x} {...axis} tickFormatter={v => vnDate(v).slice(0, 5)} minTickGap={24} />
          <YAxis {...axis} width={64} tickFormatter={v => prefix + fmt(v, 0)} />
          <Tooltip {...tip} formatter={v => [prefix + fmt(v), '']} labelFormatter={vnDate} />
          <Area type="monotone" dataKey={y} stroke="var(--brand)" strokeWidth={2} fill="url(#lbArea)" dot={false} activeDot={{ r: 4 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MonthBars({ data, height = 220 }) {
  if (!data || !data.length) return null;
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" strokeOpacity={0.6} />
          <XAxis dataKey="month" {...axis} tickFormatter={monthLabel} />
          <YAxis {...axis} width={48} tickFormatter={v => fmt(v, 1) + '%'} />
          <ReferenceLine y={0} stroke="var(--line-strong)" />
          <Tooltip {...tip} formatter={v => [fmt(v) + '%', '']} labelFormatter={monthLabel} />
          <Bar dataKey="pct" radius={[6, 6, 0, 0]}>
            {data.map((d, i) => <Cell key={i} fill={Number(d.pct) < 0 ? 'var(--loss)' : 'var(--profit)'} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
