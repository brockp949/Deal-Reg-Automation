import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, CheckCircle, Check } from 'lucide-react';
import { fileAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Stepper, Step } from '@/components/ui/stepper';
import UploadStep from './UploadStep';
import type { SourceFile } from '@/types';

const STEPS: Step[] = [
  {
    title: 'Vendors',
    description: 'Upload vendor list',
  },
  {
    title: 'Deals',
    description: 'Upload deals CSV',
  },
  {
    title: 'MBOX',
    description: 'Upload email archives',
  },
  {
    title: 'Transcripts',
    description: 'Upload meeting transcripts',
  },
];

export default function UploadWizard() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  // Fetch uploaded files
  const { data: uploadedFiles } = useQuery({
    queryKey: ['files'],
    queryFn: async () => {
      const response = await fileAPI.getAll();
      return response.data.data as SourceFile[];
    },
    refetchInterval: (query) => {
      const files = query.state.data;
      const hasProcessing = files?.some((file: SourceFile) =>
        file.processing_status === 'processing' || file.processing_status === 'pending'
      );
      return hasProcessing ? 2000 : false;
    },
  });

  const handleStepComplete = () => {
    setCompletedSteps(prev => new Set([...prev, currentStep]));
  };

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleStepClick = (stepIndex: number) => {
    if (stepIndex <= currentStep) {
      setCurrentStep(stepIndex);
    }
  };

  const handleFinish = () => {
    navigate('/deals');
  };

  const getStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <UploadStep
            title="Step 1: Upload Vendor List"
            description="Upload a CSV file containing your vendor information. This will populate the vendor database with company names, contacts, and details."
            acceptedFormats={['.csv']}
            helpText="Your vendor CSV should include columns like: Vendor Name, Email, Website, Industry, etc. The system will automatically detect the CSV format."
            onUploadSuccess={handleStepComplete}
          />
        );
      case 1:
        return (
          <UploadStep
            title="Step 2: Upload Deals"
            description="Upload your deals CSV file to import deal registrations with associated vendors and customers."
            acceptedFormats={['.csv']}
            helpText='Expected format: "Vendors Vendor Name", "Deals Deal Name", "Deals Organization Name" (customer), "Deals Sales Stage", "Deals Expected Close Date", etc.'
            onUploadSuccess={handleStepComplete}
          />
        );
      case 2:
        return (
          <UploadStep
            title="Step 3: Upload MBOX Email Archives"
            description="Upload MBOX email archives to automatically extract deals from email threads using NLP analysis."
            acceptedFormats={['.mbox']}
            helpText="The system will analyze email threads to identify deal registrations, vendor information, and decision makers. Vendor names will be extracted from email domains (e.g., john@cisco.com → Cisco)."
            onUploadSuccess={handleStepComplete}
          />
        );
      case 3:
        return (
          <UploadStep
            title="Step 4: Upload Meeting Transcripts"
            description="Upload meeting transcripts (TXT or PDF) for AI-powered deal extraction from sales conversations."
            acceptedFormats={['.txt', '.pdf']}
            helpText="The system uses a 5-stage NLP pipeline to extract deal information, vendor details, buying signals, and customer requirements from meeting transcripts."
            onUploadSuccess={handleStepComplete}
          />
        );
      default:
        return null;
    }
  };

  // Get uploaded files for current step
  const getStepFiles = () => {
    if (!uploadedFiles) return [];

    const filterMap: Record<number, string[]> = {
      0: ['csv', 'vtiger_csv'],
      1: ['csv', 'vtiger_csv'],
      2: ['mbox'],
      3: ['txt', 'transcript', 'pdf'],
    };

    const types = filterMap[currentStep] || [];
    return uploadedFiles.filter(file => types.includes(file.file_type));
  };

  const stepFiles = getStepFiles();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2">Deal Registration Upload Wizard</h1>
        <p className="text-muted-foreground">
          Follow these steps to import your deal registration data into the system.
        </p>
      </div>

      <Stepper steps={STEPS} currentStep={currentStep} onStepClick={handleStepClick} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          {getStepContent()}

          <div className="flex justify-between mt-6">
            <Button
              variant="outline"
              onClick={handlePrevious}
              disabled={currentStep === 0}
            >
              <ChevronLeft className="mr-2 h-4 w-4" />
              Previous
            </Button>
            {currentStep === STEPS.length - 1 ? (
              <Button onClick={handleFinish}>
                <Check className="mr-2 h-4 w-4" />
                Finish & View Deals
              </Button>
            ) : (
              <Button onClick={handleNext}>
                Next
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        <div className="lg:col-span-1">
          <Card className="p-6 sticky top-6">
            <h3 className="font-semibold mb-4">Progress Summary</h3>
            <div className="space-y-4">
              {STEPS.map((step, index) => (
                <div key={index} className="flex items-start gap-3">
                  <div className={`
                    w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5
                    ${completedSteps.has(index) ? 'bg-green-500 text-white' : 'bg-muted text-muted-foreground'}
                  `}>
                    {completedSteps.has(index) ? (
                      <CheckCircle className="w-4 h-4" />
                    ) : (
                      <span className="text-xs">{index + 1}</span>
                    )}
                  </div>
                  <div className="flex-1">
                    <p className={`text-sm font-medium ${index === currentStep ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {step.title}
                    </p>
                    <p className="text-xs text-muted-foreground">{step.description}</p>
                  </div>
                </div>
              ))}
            </div>

            {stepFiles.length > 0 && (
              <div className="mt-6 pt-6 border-t">
                <h4 className="text-sm font-semibold mb-3">Uploaded Files ({stepFiles.length})</h4>
                <div className="space-y-2">
                  {stepFiles.slice(0, 3).map((file) => (
                    <div key={file.id} className="text-xs">
                      <p className="font-medium truncate">{file.filename}</p>
                      <p className="text-muted-foreground capitalize">
                        {file.processing_status}
                      </p>
                    </div>
                  ))}
                  {stepFiles.length > 3 && (
                    <p className="text-xs text-muted-foreground">
                      +{stepFiles.length - 3} more files
                    </p>
                  )}
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
