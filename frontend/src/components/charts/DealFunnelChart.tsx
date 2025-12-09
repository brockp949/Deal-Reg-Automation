import { useQuery } from '@tanstack/react-query';
import { dealAPI } from '@/lib/api';
import {
  FunnelChart,
  Funnel,
  LabelList,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import type { DealRegistration } from '@/types';

interface FunnelDataItem {
  name: string;
  value: number;
  fill: string;
}

const DealFunnelChart = () => {
  const { data: deals, isLoading } = useQuery({
    queryKey: ['deals-funnel'],
    queryFn: async () => {
      const response = await dealAPI.getAll({ limit: 1000 }); // Fetch more deals for accurate funnel
      if (!response.data.success) return [];
      return response.data.data.data;
    },
  });

  if (isLoading) {
    return <div>Loading...</div>;
  }

  const funnelData = (deals || []).reduce(
    (acc: FunnelDataItem[], deal: DealRegistration) => {
      const stage = deal.status || 'pending';
      const existingStage = acc.find((s: FunnelDataItem) => s.name === stage);
      if (existingStage) {
        existingStage.value += 1;
      } else {
        acc.push({ name: stage, value: 1, fill: `#${Math.floor(Math.random()*16777215).toString(16)}` });
      }
      return acc;
    },
    [] as { name: string; value: number; fill: string }[]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deals Funnel</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <FunnelChart>
            <Tooltip />
            <Funnel dataKey="value" data={funnelData} isAnimationActive>
              <LabelList
                position="right"
                fill="#000"
                stroke="none"
                dataKey="name"
              />
            </Funnel>
          </FunnelChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
};

export default DealFunnelChart;