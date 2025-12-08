import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, TrendingDown, Clock, Target, DollarSign } from 'lucide-react';

interface DealVelocityMetricsProps {
  deals: Array<{
    created_at: string;
    status: string;
    deal_value?: number;
    updated_at?: string;
  }>;
}

interface MetricCardProps {
  title: string;
  value: string | number;
  description: string;
  icon: React.ReactNode;
  trend?: {
    value: number;
    isPositive: boolean;
  };
}

function MetricCard({ title, value, description, icon, trend }: MetricCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
        {trend && (
          <div className="flex items-center mt-2 text-xs">
            {trend.isPositive ? (
              <TrendingUp className="h-3 w-3 text-green-600 mr-1" />
            ) : (
              <TrendingDown className="h-3 w-3 text-red-600 mr-1" />
            )}
            <span className={trend.isPositive ? 'text-green-600' : 'text-red-600'}>
              {Math.abs(trend.value).toFixed(1)}%
            </span>
            <span className="text-muted-foreground ml-1">vs last period</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function DealVelocityMetrics({ deals }: DealVelocityMetricsProps) {
  const metrics = useMemo(() => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    // Current period (last 30 days)
    const currentPeriodDeals = deals.filter((deal) => {
      const createdDate = new Date(deal.created_at);
      return createdDate >= thirtyDaysAgo && createdDate <= now;
    });

    // Previous period (30-60 days ago)
    const previousPeriodDeals = deals.filter((deal) => {
      const createdDate = new Date(deal.created_at);
      return createdDate >= sixtyDaysAgo && createdDate < thirtyDaysAgo;
    });

    // Average deal value
    const avgDealValue =
      currentPeriodDeals.length > 0
        ? currentPeriodDeals.reduce((sum, deal) => sum + (deal.deal_value || 0), 0) /
          currentPeriodDeals.length
        : 0;

    const prevAvgDealValue =
      previousPeriodDeals.length > 0
        ? previousPeriodDeals.reduce((sum, deal) => sum + (deal.deal_value || 0), 0) /
          previousPeriodDeals.length
        : 0;

    const avgDealValueTrend =
      prevAvgDealValue > 0 ? ((avgDealValue - prevAvgDealValue) / prevAvgDealValue) * 100 : 0;

    // Deals per month
    const dealsPerMonth = currentPeriodDeals.length;
    const prevDealsPerMonth = previousPeriodDeals.length;
    const dealsPerMonthTrend =
      prevDealsPerMonth > 0
        ? ((dealsPerMonth - prevDealsPerMonth) / prevDealsPerMonth) * 100
        : 0;

    // Average time to close (for closed deals)
    const closedDeals = currentPeriodDeals.filter(
      (deal) => deal.status === 'closed-won' || deal.status === 'closed-lost'
    );

    let avgTimeToClose = 0;
    if (closedDeals.length > 0) {
      const totalDays = closedDeals.reduce((sum, deal) => {
        const created = new Date(deal.created_at);
        const updated = deal.updated_at ? new Date(deal.updated_at) : new Date();
        const days = Math.floor((updated.getTime() - created.getTime()) / (24 * 60 * 60 * 1000));
        return sum + days;
      }, 0);
      avgTimeToClose = totalDays / closedDeals.length;
    }

    const prevClosedDeals = previousPeriodDeals.filter(
      (deal) => deal.status === 'closed-won' || deal.status === 'closed-lost'
    );

    let prevAvgTimeToClose = 0;
    if (prevClosedDeals.length > 0) {
      const totalDays = prevClosedDeals.reduce((sum, deal) => {
        const created = new Date(deal.created_at);
        const updated = deal.updated_at ? new Date(deal.updated_at) : new Date();
        const days = Math.floor((updated.getTime() - created.getTime()) / (24 * 60 * 60 * 1000));
        return sum + days;
      }, 0);
      prevAvgTimeToClose = totalDays / prevClosedDeals.length;
    }

    const timeToCloseTrend =
      prevAvgTimeToClose > 0
        ? ((avgTimeToClose - prevAvgTimeToClose) / prevAvgTimeToClose) * 100
        : 0;

    // Win rate
    const wonDeals = currentPeriodDeals.filter((deal) => deal.status === 'closed-won').length;
    const winRate = closedDeals.length > 0 ? (wonDeals / closedDeals.length) * 100 : 0;

    const prevWonDeals = prevClosedDeals.filter((deal) => deal.status === 'closed-won').length;
    const prevWinRate =
      prevClosedDeals.length > 0 ? (prevWonDeals / prevClosedDeals.length) * 100 : 0;
    const winRateTrend = prevWinRate > 0 ? ((winRate - prevWinRate) / prevWinRate) * 100 : 0;

    // Total pipeline value (current period)
    const pipelineValue = currentPeriodDeals.reduce(
      (sum, deal) => sum + (deal.deal_value || 0),
      0
    );
    const prevPipelineValue = previousPeriodDeals.reduce(
      (sum, deal) => sum + (deal.deal_value || 0),
      0
    );
    const pipelineValueTrend =
      prevPipelineValue > 0
        ? ((pipelineValue - prevPipelineValue) / prevPipelineValue) * 100
        : 0;

    return {
      dealsPerMonth,
      dealsPerMonthTrend,
      avgDealValue,
      avgDealValueTrend,
      avgTimeToClose,
      timeToCloseTrend,
      winRate,
      winRateTrend,
      pipelineValue,
      pipelineValueTrend,
    };
  }, [deals]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold mb-1">Deal Velocity Metrics</h3>
        <p className="text-sm text-muted-foreground">
          Performance metrics for the last 30 days
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          title="Deals per Month"
          value={metrics.dealsPerMonth}
          description="New deals created"
          icon={<Target className="h-4 w-4 text-muted-foreground" />}
          trend={{
            value: metrics.dealsPerMonthTrend,
            isPositive: metrics.dealsPerMonthTrend >= 0,
          }}
        />

        <MetricCard
          title="Avg Deal Value"
          value={`$${metrics.avgDealValue.toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          })}`}
          description="Average value per deal"
          icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
          trend={{
            value: metrics.avgDealValueTrend,
            isPositive: metrics.avgDealValueTrend >= 0,
          }}
        />

        <MetricCard
          title="Avg Time to Close"
          value={`${metrics.avgTimeToClose.toFixed(0)} days`}
          description="Average sales cycle length"
          icon={<Clock className="h-4 w-4 text-muted-foreground" />}
          trend={{
            value: metrics.timeToCloseTrend,
            isPositive: metrics.timeToCloseTrend <= 0, // Lower is better
          }}
        />

        <MetricCard
          title="Win Rate"
          value={`${metrics.winRate.toFixed(1)}%`}
          description="Percentage of closed deals won"
          icon={<Target className="h-4 w-4 text-muted-foreground" />}
          trend={{
            value: metrics.winRateTrend,
            isPositive: metrics.winRateTrend >= 0,
          }}
        />

        <MetricCard
          title="Pipeline Value"
          value={`$${(metrics.pipelineValue / 1000).toFixed(0)}k`}
          description="Total value of new deals"
          icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
          trend={{
            value: metrics.pipelineValueTrend,
            isPositive: metrics.pipelineValueTrend >= 0,
          }}
        />
      </div>
    </div>
  );
}
