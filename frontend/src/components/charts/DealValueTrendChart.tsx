import { useQuery } from '@tanstack/react-query';
import { dealAPI } from '@/lib/api';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';
import type { DealRegistration } from '@/types';

interface TrendDataItem {
  date: string;
  value: number;
}

const DealValueTrendChart = () => {
  const { data: deals, isLoading } = useQuery({
    queryKey: ['deals-trend'],
    queryFn: async () => {
      const response = await dealAPI.getAll({ limit: 1000 });
      if (!response.data.success) return [];
      return response.data.data.data;
    },
  });

  if (isLoading) {
    return <div>Loading...</div>;
  }

  const dealsByDate = (deals || []).reduce((acc: TrendDataItem[], deal: DealRegistration) => {
    const dateValue = deal.registration_date || deal.created_at;
    if (!dateValue) return acc;
    const date = new Date(dateValue).toLocaleDateString();
    const existingDate = acc.find((d: TrendDataItem) => d.date === date);
    if (existingDate) {
      existingDate.value += deal.deal_value || 0;
    } else {
      acc.push({ date, value: deal.deal_value || 0 });
    }
    return acc;
  }, [] as { date: string; value: number }[]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deal Value Trend</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={dealsByDate}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis tickFormatter={(value) => formatCurrency(value as number)} />
            <Tooltip formatter={(value) => formatCurrency(value as number)} />
            <Legend />
            <Line
              type="monotone"
              dataKey="value"
              stroke="#82ca9d"
              strokeWidth={2}
              name="Deal Value"
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
};

export default DealValueTrendChart;
