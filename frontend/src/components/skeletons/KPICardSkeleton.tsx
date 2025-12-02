import { Card, CardContent } from '@/components/ui/card';

interface KPICardSkeletonProps {
  count?: number;
}

export function KPICardSkeleton({ count = 4 }: KPICardSkeletonProps) {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <Card key={index} className="animate-pulse">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex-1 space-y-2">
                <div className="h-4 w-24 bg-muted rounded"></div>
                <div className="h-8 w-16 bg-muted rounded"></div>
                <div className="h-3 w-20 bg-muted rounded"></div>
              </div>
              <div className="h-10 w-10 bg-muted rounded-full"></div>
            </div>
          </CardContent>
        </Card>
      ))}
    </>
  );
}
