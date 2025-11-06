import UploadWizard from '@/components/upload/UploadWizard';
import ClearDataDialog from '@/components/ClearDataDialog';

export default function FileUpload() {
  return (
    <div>
      <div className="mb-6 flex justify-end">
        <ClearDataDialog />
      </div>
      <UploadWizard />
    </div>
  );
}
