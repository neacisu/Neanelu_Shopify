import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { PolarisCard } from '../../../components/polaris/index.js';

export type QueueMetricsPoint = Readonly<{
  ts: number;
  timestamp: string;
  throughputJobsPerSec: number;
  completedDelta: number;
  failedDelta: number;
}>;

export interface QueueStatusDistribution {
  readonly waiting: number;
  readonly active: number;
  readonly delayed: number;
  readonly failed: number;
  readonly completed: number;
}

function formatTs(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return '';
  }
}

export function QueueMetricsCharts(props: {
  points: QueueMetricsPoint[];
  distribution?: QueueStatusDistribution | null;
}) {
  const { points, distribution = null } = props;

  const distData = distribution
    ? [
        { name: 'Waiting', value: distribution.waiting, color: '#f59e0b' },
        { name: 'Active', value: distribution.active, color: '#3b82f6' },
        { name: 'Delayed', value: distribution.delayed, color: '#a855f7' },
        { name: 'Failed', value: distribution.failed, color: '#ef4444' },
        { name: 'Completed', value: distribution.completed, color: '#22c55e' },
      ]
    : [];

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <PolarisCard className="p-4">
        <div className="mb-2 text-h4">Throughput (jobs/sec)</div>
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={points} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="ts" tickFormatter={formatTs} />
              <YAxis />
              <Tooltip labelFormatter={(v) => formatTs(Number(v))} />
              <ReferenceLine
                y={50}
                stroke="#ef4444"
                strokeDasharray="4 4"
                label={{ value: 'Limit 50 jobs/sec', position: 'insideTopRight', fill: '#ef4444' }}
              />
              <Line type="monotone" dataKey="throughputJobsPerSec" stroke="#2563eb" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </PolarisCard>

      <PolarisCard className="p-4">
        <div className="mb-2 text-h4">Outcomes (delta)</div>
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={points} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="ts" tickFormatter={formatTs} />
              <YAxis />
              <Tooltip labelFormatter={(v) => formatTs(Number(v))} />
              <Line type="monotone" dataKey="completedDelta" stroke="#16a34a" dot={false} />
              <Line type="monotone" dataKey="failedDelta" stroke="#dc2626" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </PolarisCard>

      <PolarisCard className="p-4 lg:col-span-2">
        <div className="mb-2 text-h4">Status distribution</div>
        {distData.length ? (
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Tooltip />
                <Pie
                  data={distData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={110}
                  label
                >
                  {distData.map((d) => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="text-sm text-muted">No distribution data.</div>
        )}
      </PolarisCard>
    </div>
  );
}
