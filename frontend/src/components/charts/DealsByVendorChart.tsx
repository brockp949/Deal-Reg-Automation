import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface DealsByVendorChartProps {
  deals: Array<{
    vendor_name?: string;
    deal_value?: number;
    status: string;
  }>;
}

const CHART_COLORS = [
  '#3b82f6', // blue
  '#10b981', // green
  '#8b5cf6', // purple
  '#f59e0b', // amber
  '#ef4444', // red
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#14b8a6', // teal
];

export function DealsByVendorChart({ deals }: DealsByVendorChartProps) {
  const chartData = useMemo(() => {
    const vendorData: Record<string, { count: number; value: number; wonCount: number }> = {};

    deals.forEach((deal) => {
      const vendorName = deal.vendor_name || 'Unknown Vendor';
      if (!vendorData[vendorName]) {
        vendorData[vendorName] = { count: 0, value: 0, wonCount: 0 };
      }
      vendorData[vendorName].count++;
      vendorData[vendorName].value += deal.deal_value || 0;
      if (deal.status === 'closed-won') {
        vendorData[vendorName].wonCount++;
      }
    });

    return Object.entries(vendorData)
      .map(([name, data]) => ({
        name: name.length > 20 ? name.substring(0, 20) + '...' : name,
        fullName: name,
        count: data.count,
        value: data.value,
        wonCount: data.wonCount,
        winRate: data.count > 0 ? ((data.wonCount / data.count) * 100).toFixed(1) : '0.0',
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10); // Top 10 vendors
  }, [deals]);

  const totalDeals = deals.length;

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="rounded-lg border bg-background p-3 shadow-lg">
          <p className="font-semibold text-sm mb-1">{data.fullName}</p>
          <p className="text-sm text-muted-foreground">
            Deals: <span className="font-medium text-foreground">{data.count}</span>
          </p>
          <p className="text-sm text-muted-foreground">
            Value:{' '}
            <span className="font-medium text-foreground">
              ${data.value.toLocaleString()}
            </span>
          </p>
          <p className="text-sm text-muted-foreground">
            Won: <span className="font-medium text-green-600">{data.wonCount}</span>
          </p>
          <p className="text-sm text-muted-foreground">
            Win Rate: <span className="font-medium text-foreground">{data.winRate}%</span>
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
          <CardTitle>Deals by Vendor</CardTitle>
          <CardDescription>Top vendors by deal value</CardDescription>
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
        <CardTitle>Deals by Vendor</CardTitle>
        <CardDescription>Top 10 vendors by total deal value</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="name"
              className="text-xs"
              tick={{ fill: 'hsl(var(--muted-foreground))' }}
              angle={-45}
              textAnchor="end"
              height={80}
            />
            <YAxis
              className="text-xs"
              tick={{ fill: 'hsl(var(--muted-foreground))' }}
              tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="value" radius={[8, 8, 0, 0]}>
              {chartData.map((_entry, index) => (
                <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
