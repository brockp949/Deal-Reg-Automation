import { useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface WinLossChartProps {
  deals: Array<{
    status: string;
    deal_value?: number;
  }>;
}

const STATUS_CATEGORIES = {
  won: ['closed-won'],
  lost: ['closed-lost', 'rejected'],
  inProgress: ['registered', 'approved'],
};

const COLORS = {
  won: '#10b981', // green
  lost: '#ef4444', // red
  inProgress: '#3b82f6', // blue
};

const LABELS = {
  won: 'Won',
  lost: 'Lost',
  inProgress: 'In Progress',
};

export function WinLossChart({ deals }: WinLossChartProps) {
  const chartData = useMemo(() => {
    // Guard against undefined deals
    if (!Array.isArray(deals)) {
      return [];
    }

    const categories = {
      won: { count: 0, value: 0 },
      lost: { count: 0, value: 0 },
      inProgress: { count: 0, value: 0 },
    };

    deals.forEach((deal) => {
      const status = deal.status?.toLowerCase() || '';
      let category: keyof typeof categories | null = null;

      if (STATUS_CATEGORIES.won.includes(status)) {
        category = 'won';
      } else if (STATUS_CATEGORIES.lost.includes(status)) {
        category = 'lost';
      } else if (STATUS_CATEGORIES.inProgress.includes(status)) {
        category = 'inProgress';
      }

      if (category) {
        categories[category].count++;
        categories[category].value += deal.deal_value || 0;
      }
    });

    return Object.entries(categories)
      .filter(([, data]) => data.count > 0)
      .map(([key, data]) => ({
        name: LABELS[key as keyof typeof LABELS],
        count: data.count,
        value: data.value,
        color: COLORS[key as keyof typeof COLORS],
      }));
  }, [deals]);

  const totalDeals = deals?.length || 0;
  const wonDeals = chartData.find((d) => d.name === 'Won')?.count || 0;
  const lostDeals = chartData.find((d) => d.name === 'Lost')?.count || 0;
  const closedDeals = wonDeals + lostDeals;

  const winRate = closedDeals > 0 ? ((wonDeals / closedDeals) * 100).toFixed(1) : '0.0';

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0];
      const percentage = totalDeals > 0 ? ((data.value / totalDeals) * 100).toFixed(1) : '0.0';
      return (
        <div className="rounded-lg border bg-background p-3 shadow-lg">
          <p className="font-semibold text-sm mb-1">{data.name}</p>
          <p className="text-sm text-muted-foreground">
            Count: <span className="font-medium text-foreground">{data.payload.count}</span>
          </p>
          <p className="text-sm text-muted-foreground">
            Value:{' '}
            <span className="font-medium text-foreground">
              ${data.payload.value.toLocaleString()}
            </span>
          </p>
          <p className="text-sm text-muted-foreground">
            Percentage: <span className="font-medium text-foreground">{percentage}%</span>
          </p>
        </div>
      );
    }
    return null;
  };

  const renderCustomLabel = (entry: any) => {
    const percentage = totalDeals > 0 ? ((entry.count / totalDeals) * 100).toFixed(0) : '0';
    return `${entry.name} (${percentage}%)`;
  };

  if (totalDeals === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Win/Loss Analysis</CardTitle>
          <CardDescription>Deal outcomes distribution</CardDescription>
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
            <CardTitle>Win/Loss Analysis</CardTitle>
            <CardDescription>Deal outcomes distribution</CardDescription>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-green-600">{winRate}%</p>
            <p className="text-xs text-muted-foreground">Win Rate (Closed)</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={renderCustomLabel}
              outerRadius={100}
              fill="#8884d8"
              dataKey="count"
            >
              {chartData.map((_entry, index) => (
                <Cell key={`cell-${index}`} fill={chartData[index].color} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            <Legend
              verticalAlign="bottom"
              height={36}
              formatter={(value) => {
                const data = chartData.find((d) => d.name === value);
                return `${value}: ${data?.count || 0} deals`;
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
