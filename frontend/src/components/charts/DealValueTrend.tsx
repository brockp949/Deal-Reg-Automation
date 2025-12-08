import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';

interface DealValueTrendProps {
  deals: Array<{
    created_at: string;
    deal_value?: number;
    status: string;
  }>;
}

export function DealValueTrend({ deals }: DealValueTrendProps) {
  const chartData = useMemo(() => {
    // Group deals by month
    const monthlyData: Record<string, { total: number; count: number }> = {};

    deals.forEach((deal) => {
      const date = new Date(deal.created_at);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = { total: 0, count: 0 };
      }

      monthlyData[monthKey].total += deal.deal_value || 0;
      monthlyData[monthKey].count++;
    });

    // Convert to array and sort by date
    return Object.entries(monthlyData)
      .map(([month, data]) => ({
        month,
        value: data.total,
        count: data.count,
        displayMonth: new Date(month + '-01').toLocaleDateString('en-US', {
          month: 'short',
          year: '2-digit',
        }),
      }))
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-12); // Last 12 months
  }, [deals]);

  const totalValue = useMemo(() => {
    return chartData.reduce((sum, item) => sum + item.value, 0);
  }, [chartData]);

  const avgMonthlyValue = useMemo(() => {
    return chartData.length > 0 ? totalValue / chartData.length : 0;
  }, [totalValue, chartData]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="rounded-lg border bg-background p-3 shadow-lg">
          <p className="font-semibold">{data.displayMonth}</p>
          <p className="text-sm text-muted-foreground">
            Value:{' '}
            <span className="font-medium text-foreground">
              {formatCurrency(data.value)}
            </span>
          </p>
          <p className="text-sm text-muted-foreground">
            Deals: <span className="font-medium text-foreground">{data.count}</span>
          </p>
        </div>
      );
    }
    return null;
  };

  if (chartData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Deal Value Trend</CardTitle>
          <CardDescription>Monthly deal value over time</CardDescription>
        </CardHeader>
        <CardContent className="h-[300px] flex items-center justify-center">
          <p className="text-muted-foreground">No data to display</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Deal Value Trend</CardTitle>
            <CardDescription>Monthly deal value over time</CardDescription>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold">{formatCurrency(avgMonthlyValue)}</p>
            <p className="text-xs text-muted-foreground">Avg/Month</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="displayMonth"
              className="text-xs"
              tick={{ fill: 'hsl(var(--muted-foreground))' }}
            />
            <YAxis
              className="text-xs"
              tick={{ fill: 'hsl(var(--muted-foreground))' }}
              tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey="value"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={{ fill: 'hsl(var(--primary))', r: 4 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
