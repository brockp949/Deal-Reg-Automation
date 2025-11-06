import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Step {
  title: string;
  description: string;
}

interface StepperProps {
  steps: Step[];
  currentStep: number;
  onStepClick?: (stepIndex: number) => void;
}

export function Stepper({ steps, currentStep, onStepClick }: StepperProps) {
  return (
    <div className="w-full py-4">
      <div className="flex items-center justify-between">
        {steps.map((step, index) => (
          <React.Fragment key={index}>
            <div className="flex flex-col items-center flex-1">
              <button
                onClick={() => onStepClick?.(index)}
                disabled={index > currentStep}
                className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center font-semibold transition-all",
                  index < currentStep && "bg-primary text-primary-foreground",
                  index === currentStep && "bg-primary text-primary-foreground ring-4 ring-primary/20",
                  index > currentStep && "bg-muted text-muted-foreground",
                  onStepClick && index <= currentStep && "cursor-pointer hover:ring-2 hover:ring-primary/30",
                  (!onStepClick || index > currentStep) && "cursor-not-allowed"
                )}
              >
                {index < currentStep ? (
                  <Check className="w-5 h-5" />
                ) : (
                  <span>{index + 1}</span>
                )}
              </button>
              <div className="mt-2 text-center">
                <p className={cn(
                  "text-sm font-medium",
                  index === currentStep && "text-foreground",
                  index !== currentStep && "text-muted-foreground"
                )}>
                  {step.title}
                </p>
                <p className="text-xs text-muted-foreground mt-1 max-w-[120px]">
                  {step.description}
                </p>
              </div>
            </div>
            {index < steps.length - 1 && (
              <div className={cn(
                "h-[2px] flex-1 mx-2 -mt-16 transition-all",
                index < currentStep ? "bg-primary" : "bg-muted"
              )} />
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
