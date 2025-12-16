import { useQuery } from '@tanstack/react-query';
import { dealAPI } from '@/lib/api';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { DealRegistration } from '@/types';

interface VendorDataItem {
  name: string;
  deals: number;
}

const DealsByVendorChart = () => {
  const { data: deals, isLoading } = useQuery({
    queryKey: ['deals-by-vendor'],
    queryFn: async (): Promise<DealRegistration[]> => {
      const response = await dealAPI.getAll({ limit: 1000 });
      if (!response.data.success) return [];
      return (response.data.data || []) as unknown as DealRegistration[];
    },
  });

  if (isLoading) {
    return <div>Loading...</div>;
  }

  const dealsByVendor = (deals || []).reduce(
    (acc: VendorDataItem[], deal: DealRegistration) => {
      const vendorName = deal.vendor_name || 'Unknown';
      const existingVendor = acc.find((v: VendorDataItem) => v.name === vendorName);
      if (existingVendor) {
        existingVendor.deals += 1;
      } else {
        acc.push({ name: vendorName, deals: 1 });
      }
      return acc;
    },
    [] as { name: string; deals: number }[]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deals by Vendor</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={dealsByVendor}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="deals" fill="#8884d8" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
};

export default DealsByVendorChart;