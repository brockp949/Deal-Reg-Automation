import { Card, CardContent } from '@/components/ui/card';

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
}

export function TableSkeleton({ rows = 5, columns = 4 }: TableSkeletonProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="space-y-3 animate-pulse">
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <div key={rowIndex} className="flex gap-4">
              {Array.from({ length: columns }).map((_, colIndex) => (
                <div
                  key={colIndex}
                  className={`h-4 bg-muted rounded ${
                    colIndex === 0 ? 'w-1/4' : 'w-1/6'
                  }`}
                ></div>
              ))}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
