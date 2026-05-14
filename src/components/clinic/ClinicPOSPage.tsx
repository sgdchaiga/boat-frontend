import { RetailPOSPage } from "../RetailPOSPage";

/** Dedicated pharmacy dispensing workspace (separate route from `retail_pos`). */
export function ClinicPOSPage({ readOnly }: { readOnly?: boolean }) {
  return <RetailPOSPage readOnly={readOnly} leftPanelMode="clinic_workspace" posExperience="pharmacy" />;
}
