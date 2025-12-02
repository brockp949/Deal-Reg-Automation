import { Card, CardContent, CardHeader } from '@/components/ui/card';

interface DealCardSkeletonProps {
  count?: number;
}

export function DealCardSkeleton({ count = 6 }: DealCardSkeletonProps) {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <Card key={index} className="animate-pulse">
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 space-y-2">
                <div className="h-5 w-3/4 bg-muted rounded"></div>
                <div className="h-4 w-1/2 bg-muted rounded"></div>
              </div>
              <div className="h-6 w-20 bg-muted rounded-full"></div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <div className="flex justify-between">
                <div className="h-4 w-16 bg-muted rounded"></div>
                <div className="h-4 w-24 bg-muted rounded"></div>
              </div>
              <div className="flex justify-between">
                <div className="h-4 w-20 bg-muted rounded"></div>
                <div className="h-4 w-28 bg-muted rounded"></div>
              </div>
              <div className="flex justify-between">
                <div className="h-4 w-14 bg-muted rounded"></div>
                <div className="h-4 w-16 bg-muted rounded"></div>
              </div>
              <div className="flex justify-between">
                <div className="h-4 w-24 bg-muted rounded"></div>
                <div className="h-4 w-20 bg-muted rounded"></div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </>
  );
}
