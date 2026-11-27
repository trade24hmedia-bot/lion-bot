import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar, Cell, ReferenceLine, ReferenceDot } from 'recharts';
import { fmt, vnDate, monthLabel } from './lib.js';

// Biểu đồ: lưới mờ, nhãn mono nhạt, 1 đường vàng, đánh dấu giá trị cuối
const axis = { stroke: 'var(--line)', tick: { fill: 'var(--ink-muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }, tickLine: false, axisLine: false };
export const tip = { contentStyle: { background: 'var(--surface-200)', border: '1px solid var(--line-strong)', borderRadius: 8, color: 'var(--ink)', fontSize: 13 }, labelStyle: { color: 'var(--ink-muted)' }, cursor: { stroke: 'var(--line-strong)' } };
// trục số gọn: $40k, −$10k, $1,2m
export const compact = (v, prefix = '') => {
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  if (a >= 1e6) return s + prefix + fmt(a / 1e6, 1) + 'm';
  if (a >= 1e4) return s + prefix + fmt(a / 1e3, 0) + 'k';
  return s + prefix + fmt(a, 0);
};
const signedFmt = (v, prefix) => (v > 0 ? '+' : v < 0 ? '−' : '') + prefix + fmt(Math.abs(v));

export function LineArea({ data, x, y, height = 280, prefix = '', signed = false, xFmt }) {
  if (!data || !data.length) return null;
  const last = data[data.length - 1];
  const lastTxt = signed ? signedFmt(Number(last[y]), prefix) : prefix + fmt(last[y]);
  const fx = xFmt || (v => vnDate(v).slice(0, 5));
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 28, right: 44, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey={x} {...axis} tickFormatter={fx} minTickGap={32} dy={6} />
          <YAxis {...axis} width={60} tickFormatter={v => compact(v, prefix)} domain={['auto', 'auto']} />
          {signed && <ReferenceLine y={0} stroke="var(--line-strong)" />}
          <Tooltip {...tip} formatter={v => [signed ? signedFmt(Number(v), prefix) : prefix + fmt(v), '']} labelFormatter={v => (xFmt ? xFmt(v) : vnDate(v))} />
          <Line type="monotone" dataKey={y} stroke="var(--brand)" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: 'var(--surface-100)', stroke: 'var(--brand)', strokeWidth: 2 }} isAnimationActive={false} />
          <ReferenceDot x={last[x]} y={last[y]} r={4} fill="var(--surface-100)" stroke="var(--brand)" strokeWidth={2}
            label={{ value: lastTxt, position: 'top', offset: 10, fill: 'var(--ink)', fontSize: 12, fontFamily: 'var(--font-mono)' }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MonthBars({ data, height = 200 }) {
  if (!data || data.length < 2) return null;
  const lastKey = data[data.length - 1].month;
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="month" {...axis} tickFormatter={monthLabel} dy={6} />
          <YAxis {...axis} width={48} tickFormatter={v => fmt(v, 0) + '%'} />
          <ReferenceLine y={0} stroke="var(--line-strong)" />
          <Tooltip {...tip} formatter={v => [fmt(v) + '%', '']} labelFormatter={monthLabel} />
          <Bar dataKey="pct" radius={[4, 4, 0, 0]} maxBarSize={28}>
            {data.map((d, i) => <Cell key={i} fill={d.month === lastKey ? 'var(--brand)' : Number(d.pct) < 0 ? 'var(--loss)' : 'var(--surface-300)'} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
