import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface DealFunnelChartProps {
  deals: Array<{
    status: string;
    deal_value?: number;
  }>;
}

const STATUS_ORDER = ['registered', 'approved', 'closed-won', 'rejected', 'closed-lost'];
const STATUS_COLORS: Record<string, string> = {
  registered: '#3b82f6', // blue
  approved: '#10b981', // green
  'closed-won': '#8b5cf6', // purple
  rejected: '#ef4444', // red
  'closed-lost': '#6b7280', // gray
};

const STATUS_LABELS: Record<string, string> = {
  registered: 'Registered',
  approved: 'Approved',
  'closed-won': 'Closed Won',
  rejected: 'Rejected',
  'closed-lost': 'Closed Lost',
};

export function DealFunnelChart({ deals }: DealFunnelChartProps) {
  const chartData = useMemo(() => {
    const statusCounts: Record<string, { count: number; value: number }> = {};

    deals.forEach((deal) => {
      const status = deal.status || 'unknown';
      if (!statusCounts[status]) {
        statusCounts[status] = { count: 0, value: 0 };
      }
      statusCounts[status].count++;
      statusCounts[status].value += deal.deal_value || 0;
    });

    return STATUS_ORDER.map((status) => ({
      name: STATUS_LABELS[status] || status,
      count: statusCounts[status]?.count || 0,
      value: statusCounts[status]?.value || 0,
      color: STATUS_COLORS[status],
    })).filter((item) => item.count > 0);
  }, [deals]);

  const totalDeals = deals.length;
  const conversionRate = useMemo(() => {
    const registered = chartData.find((d) => d.name === 'Registered')?.count || 0;
    const closedWon = chartData.find((d) => d.name === 'Closed Won')?.count || 0;
    return registered > 0 ? ((closedWon / registered) * 100).toFixed(1) : '0.0';
  }, [chartData]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="rounded-lg border bg-background p-3 shadow-lg">
          <p className="font-semibold">{data.name}</p>
          <p className="text-sm text-muted-foreground">
            Count: <span className="font-medium text-foreground">{data.count}</span>
          </p>
          <p className="text-sm text-muted-foreground">
            Value:{' '}
            <span className="font-medium text-foreground">
              ${data.value.toLocaleString()}
            </span>
          </p>
        </div>
      );
    }
    return null;
  };

  if (totalDeals === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Deal Pipeline</CardTitle>
          <CardDescription>Deal distribution by status</CardDescription>
        </CardHeader>
        <CardContent className="h-[300px] flex items-center justify-center">
          <p className="text-muted-foreground">No deals to display</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Deal Pipeline</CardTitle>
            <CardDescription>Deal distribution by status</CardDescription>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-green-600">{conversionRate}%</p>
            <p className="text-xs text-muted-foreground">Conversion Rate</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="name"
              className="text-xs"
              tick={{ fill: 'hsl(var(--muted-foreground))' }}
            />
            <YAxis
              className="text-xs"
              tick={{ fill: 'hsl(var(--muted-foreground))' }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="count" radius={[8, 8, 0, 0]}>
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
