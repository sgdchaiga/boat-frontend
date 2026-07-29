export type CountryTaxProfile = {
  countryCode: "UG" | "KE" | "RW" | "CUSTOM";
  countryName: string;
  corporateIncomeTaxRate: number;
  vatRate: number;
  withholdingTaxRate: number;
  capitalAllowanceRate: number;
  inflationRate: number;
  effectiveDate: string;
  sourceLabel: string;
  sourceUrl: string;
  note: string;
};

export const COUNTRY_TAX_PACKS: CountryTaxProfile[] = [
  { countryCode:"UG", countryName:"Uganda", corporateIncomeTaxRate:30, vatRate:18, withholdingTaxRate:6, capitalAllowanceRate:20, inflationRate:5,
    effectiveDate:"Reviewed 16 July 2026", sourceLabel:"Uganda Revenue Authority", sourceUrl:"https://ura.go.ug/en/corporation-tax/",
    note:"Corporate tax and standard VAT are verified headline rates. The withholding and capital-allowance fields are modelling defaults only because treatment varies by transaction and asset class." },
  { countryCode:"KE", countryName:"Kenya", corporateIncomeTaxRate:30, vatRate:16, withholdingTaxRate:5, capitalAllowanceRate:20, inflationRate:5,
    effectiveDate:"Reviewed 16 July 2026", sourceLabel:"Kenya Revenue Authority", sourceUrl:"https://www.kra.go.ke/business/companies-partnerships/companies-partnerships-pin-taxes",
    note:"Resident corporate tax and general VAT are verified headline rates. Transaction-specific withholding and investment allowances must be confirmed." },
  { countryCode:"RW", countryName:"Rwanda", corporateIncomeTaxRate:28, vatRate:18, withholdingTaxRate:15, capitalAllowanceRate:20, inflationRate:5,
    effectiveDate:"Reviewed 16 July 2026", sourceLabel:"Rwanda Revenue Authority", sourceUrl:"https://www.rra.gov.rw/en/domestic-tax-services",
    note:"The standard corporate rate from 2024 and standard VAT rate are verified. Withholding varies by payment type and taxpayer status." },
  { countryCode:"CUSTOM", countryName:"Custom / other country", corporateIncomeTaxRate:30, vatRate:18, withholdingTaxRate:0, capitalAllowanceRate:20, inflationRate:5,
    effectiveDate:"User supplied", sourceLabel:"User confirmation required", sourceUrl:"", note:"Enter rates confirmed for the entity, transaction, tax year and asset class." },
];

export function getCountryTaxPack(code: CountryTaxProfile["countryCode"]) {
  return { ...(COUNTRY_TAX_PACKS.find(pack=>pack.countryCode===code) ?? COUNTRY_TAX_PACKS[3]) };
}
