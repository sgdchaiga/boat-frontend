import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowRight, BarChart3, Check, ChevronRight, Download, FileSpreadsheet, Lightbulb, Plus, Presentation, Save, Sparkles, Target, Trash2, TrendingUp, Upload, Wallet } from "lucide-react";
import { calculateFinancialModel, validateFinancialModel, type FinancialModelInputs, type ModelScenario } from "@/lib/financialModellingEngine";
import { FINANCIAL_MODEL_TEMPLATES, getFinancialModelTemplate } from "@/lib/financialModelTemplates";
import { annualDriverAmount, annualDriverAmountForYear, calculateProjectPortfolio, consolidateProjectPortfolio, driverValuesForYear, hasConfiguredProjects, PROJECT_BUSINESS_SUGGESTIONS, type DriverFrequency, type ModelProject, type ProjectDriver } from "@/lib/projectPortfolioEngine";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { buildLinkedStatements, buildLoanSchedule } from "@/lib/phase1FinancialEngine";
import { downloadFinancialModelWorkbook } from "@/lib/financialModelWorkbook";
import { downloadFinancialModelPdf } from "@/lib/financialModelPdf";
import { downloadFinancialModelPresentation } from "@/lib/financialModelPresentation";
import { PhaseOneStatements } from "@/components/financial-modelling/PhaseOneStatements";
import { PhaseTwoValuation } from "@/components/financial-modelling/PhaseTwoValuation";
import { buildValuationSensitivity, calculateDcfValuation, type ValuationAssumptions } from "@/lib/phase2ValuationEngine";
import { PhaseTwoScenarios } from "@/components/financial-modelling/PhaseTwoScenarios";
import { buildOperationalScenarios, DEFAULT_SCENARIO_CONFIGURATION, type ScenarioConfiguration, type ScenarioDriverSet } from "@/lib/phase2ScenarioEngine";
import { PhaseTwoTaxPack } from "@/components/financial-modelling/PhaseTwoTaxPack";
import { getCountryTaxPack, type CountryTaxProfile } from "@/lib/countryTaxPacks";
import { PhaseTwoAiAssistant } from "@/components/financial-modelling/PhaseTwoAiAssistant";
import { PhaseThreeWorkflow } from "@/components/financial-modelling/PhaseThreeWorkflow";
import { PhaseThreeEnterpriseControls } from "@/components/financial-modelling/PhaseThreeEnterpriseControls";
import * as XLSX from "xlsx";

const industries = FINANCIAL_MODEL_TEMPLATES.map(template => template.name);
const steps = ["Business profile", "Project setup", "Revenue drivers", "Cost drivers", "Customers & sales", "Pricing", "Operating costs", "Personnel costs", "Capital expenditure", "Existing investment", "Funding requirement", "Financing terms", "Tax & accounting", "Scenarios", "Review & validate"];
const defaults: FinancialModelInputs = getFinancialModelTemplate("Education Technology").defaults;
const defaultUses = [{ name: "Product development", value: 0 }, { name: "Working capital", value: 0 }, { name: "Marketing & growth", value: 0 }, { name: "Regional expansion", value: 0 }, { name: "Infrastructure", value: 0 }, { name: "Recruitment", value: 0 }, { name: "Content development", value: 0 }, { name: "AI development", value: 0 }, { name: "Contingency", value: 0 }];
const blankProject = (id = "project-1"): ModelProject => ({ id, name: "", businessType: "education-technology", enabled: true, startingUnits: 0, annualGrowth: 0, revenuePerUnit: 0, directCostRate: 0, annualFixedCosts: 0, startYear: 1, revenueDrivers: [], costDrivers: [] });
type PersonnelRole = { id:string; jobTitle:string; lowerSalary:number; upperSalary:number; annualSalaryGrowth:number; positions:Record<number,number> };
const blankPersonnelRole = (): PersonnelRole => ({ id:`role-${Date.now()}-${Math.random()}`, jobTitle:"", lowerSalary:0, upperSalary:0, annualSalaryGrowth:0, positions:{1:1} });

export function FinancialModellingStudio() {
  const { user } = useAuth();
  const [currency, setCurrency] = useState("UGX");
  const [industry, setIndustry] = useState("Education Technology");
  const [scenario, setScenario] = useState<ModelScenario>("base");
  const [activeStep, setActiveStep] = useState(0);
  const [inputs, setInputs] = useState(defaults);
  const [earlyYearCustomers, setEarlyYearCustomers] = useState<Record<number, string>>({ 2: "", 3: "" });
  const [existingInvestment, setExistingInvestment] = useState(0);
  const [company, setCompany] = useState("Kampala Learning Technologies");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [modelId, setModelId] = useState<string | null>(null);
  const [modelStatus, setModelStatus] = useState("draft");
  const [projects, setProjects] = useState<ModelProject[]>([blankProject()]);
  const [uses, setUses] = useState(defaultUses);
  const [valuationAssumptions, setValuationAssumptions] = useState<ValuationAssumptions>({ discountRate: 18, terminalGrowthRate: 4, initialInvestment: defaults.fundingRequired });
  const [scenarioConfiguration, setScenarioConfiguration] = useState<ScenarioConfiguration>(DEFAULT_SCENARIO_CONFIGURATION);
  const [taxProfile, setTaxProfile] = useState<CountryTaxProfile>(getCountryTaxPack("UG"));
  const [selectedProjectId, setSelectedProjectId] = useState("project-1");
  const [personnelRoles, setPersonnelRoles] = useState<PersonnelRole[]>([]);
  const [workbookImportMessage, setWorkbookImportMessage] = useState("");
  useEffect(() => {
    const organizationId = user?.organization_id;
    if (!organizationId) return;
    let active = true;
    void (supabase as any).from("organization_onboarding_state").select("currency").eq("organization_id", organizationId).maybeSingle().then((result: { data?: { currency?: string | null } }) => {
      const code = result.data?.currency?.trim().toUpperCase();
      if (active && code) setCurrency(code);
    });
    return () => { active = false; };
  }, [user?.organization_id]);
  useEffect(() => {
    const organizationId = user?.organization_id;
    if (!organizationId) return;
    let active = true;
    const localKey = `boat-financial-model:${organizationId}`;
    const applyDraft = (draft: any) => {
      if (!draft || typeof draft !== "object") return;
      if (typeof draft.company === "string") setCompany(draft.company);
      if (typeof draft.industry === "string") setIndustry(draft.industry);
      if (draft.inputs && typeof draft.inputs === "object") setInputs(current => ({ ...current, ...draft.inputs }));
      if (draft.earlyYearCustomers && typeof draft.earlyYearCustomers === "object") setEarlyYearCustomers(draft.earlyYearCustomers);
      if (Array.isArray(draft.projects) && draft.projects.length) {
        setProjects(draft.projects);
        setSelectedProjectId(draft.projects[0].id);
      }
      if (Number.isFinite(draft.existingInvestment)) setExistingInvestment(draft.existingInvestment);
      if (Array.isArray(draft.uses) && draft.uses.length) setUses(draft.uses);
      if (draft.valuationAssumptions && typeof draft.valuationAssumptions === "object") setValuationAssumptions(current=>({...current,...draft.valuationAssumptions}));
      if (draft.scenarioConfiguration && typeof draft.scenarioConfiguration === "object") setScenarioConfiguration(draft.scenarioConfiguration);
      if (draft.taxProfile && typeof draft.taxProfile === "object") setTaxProfile(draft.taxProfile);
      if (Array.isArray(draft.personnelRoles)) setPersonnelRoles(draft.personnelRoles);
    };
    try { applyDraft(JSON.parse(localStorage.getItem(localKey) ?? "null")); } catch { /* ignore an invalid offline draft */ }
    void (supabase as any).from("financial_models").select("id,name,industry,currency,status,model_data").eq("organization_id", organizationId).neq("status", "archived").order("updated_at", { ascending: false }).limit(1).maybeSingle().then((result: any) => {
      if (!active || result.error || !result.data) return;
      setModelId(result.data.id);
      setModelStatus(result.data.status ?? "draft");
      if (result.data.currency) setCurrency(result.data.currency);
      applyDraft({ ...result.data.model_data, company: result.data.name, industry: result.data.industry });
    });
    return () => { active = false; };
  }, [user?.organization_id]);
  const money = (value: number, compact = false) => {
    try {
      return new Intl.NumberFormat("en", { style: "currency", currency, currencyDisplay: "code", notation: compact ? "compact" : "standard", maximumFractionDigits: compact ? 1 : 0 }).format(value);
    } catch {
      return `${currency} ${new Intl.NumberFormat("en", { notation: compact ? "compact" : "standard", maximumFractionDigits: compact ? 1 : 0 }).format(value)}`;
    }
  };
  const template = useMemo(() => getFinancialModelTemplate(industry), [industry]);
  const customerOverrides = useMemo(() => {
    const overrides: Partial<Record<number, number>> = { 1: inputs.startingCustomers };
    for (const year of [2, 3]) {
      const raw = earlyYearCustomers[year]?.trim();
      if (raw) overrides[year] = Number(raw);
    }
    return overrides;
  }, [inputs.startingCustomers, earlyYearCustomers]);
  const payrollByYear = useMemo(() => Object.fromEntries(Array.from({length:inputs.years},(_,index)=>{const year=index+1;const total=personnelRoles.reduce((sum,role)=>{const midpoint=(role.lowerSalary+role.upperSalary)/2;return sum+midpoint*(role.positions[year]??0)*Math.pow(1+role.annualSalaryGrowth/100,index);},0);return [year,total];})), [inputs.years, personnelRoles]);
  const projections = useMemo(() => calculateFinancialModel(inputs, scenario, customerOverrides, personnelRoles.length?payrollByYear:{}), [inputs, scenario, customerOverrides, payrollByYear, personnelRoles.length]);
  useEffect(()=>{if(personnelRoles.length)setInputs(current=>({...current,annualPayroll:payrollByYear[1]??0}));},[payrollByYear,personnelRoles.length]);
  const loanSchedule = useMemo(() => buildLoanSchedule(inputs), [inputs]);
  const projectRows = useMemo(() => calculateProjectPortfolio(projects, inputs.years), [projects, inputs.years]);
  const portfolio = useMemo(() => consolidateProjectPortfolio(projectRows, inputs.years), [projectRows, inputs.years]);
  const modelProjections = useMemo(() => {
    if (!hasConfiguredProjects(projects)) return projections;
    const depreciation = inputs.capex / Math.max(inputs.years, 5);
    return portfolio.map((projectYear, index) => {
      const operatingExpenses = projectYear.fixedCosts;
      const ebitda = projectYear.ebitda;
      const ebit = ebitda - depreciation;
      const interest = loanSchedule[index]?.interest ?? 0;
      const tax = Math.max(0, ebit - interest) * inputs.taxRate / 100;
      const netProfit = ebit - interest - tax;
      return { year: projectYear.year, customers: 0, revenue: projectYear.revenue, costOfSales: projectYear.directCosts,
        grossProfit: projectYear.revenue - projectYear.directCosts, operatingExpenses, ebitda, depreciation, ebit,
        interest, tax, netProfit, operatingCashFlow: 0, closingCash: 0, debtBalance: loanSchedule[index]?.closingBalance ?? 0,
        dscr: 0, ebitdaMargin: projectYear.revenue ? ebitda / projectYear.revenue * 100 : 0 };
    });
  }, [inputs, loanSchedule, portfolio, projects, projections]);
  const statements = useMemo(() => buildLinkedStatements(inputs, modelProjections), [inputs, modelProjections]);
  const allocated = uses.reduce((a, b) => a + b.value, 0);
  const validations = useMemo(() => {
    const base = validateFinancialModel(inputs, modelProjections, allocated).filter(item => item.level !== "good");
    const extra: { level: "critical" | "warning" | "good"; title: string; detail: string }[] = [];
    if (statements.some(row => Math.abs(row.balanceCheck) > 1)) extra.push({ level:"critical", title:"Balance sheet does not balance", detail:"Review funding, working capital and opening balance assumptions before generating final reports." });
    if (statements.some(row => row.closingCash < 0)) extra.push({ level:"critical", title:"Negative cash balance", detail:"At least one projection year requires additional funding, delayed spending or improved operating cash flow." });
    if (statements.some(row => row.currentRatio > 0 && row.currentRatio < 1)) extra.push({ level:"warning", title:"Weak short-term liquidity", detail:"Current assets fall below current liabilities in at least one year." });
    if (statements.some(row => row.dscr > 0 && row.dscr < 1.2)) extra.push({ level:"warning", title:"Debt service pressure", detail:"DSCR falls below the common lender comfort threshold of 1.20x." });
    if (statements.some(row => row.debtToEbitda > 4)) extra.push({ level:"warning", title:"High financial leverage", detail:"Debt exceeds 4.0x EBITDA in at least one year; confirm lender appetite and repayment capacity." });
    const combined = [...base, ...extra].filter((item,index,all)=>all.findIndex(other=>other.title===item.title)===index);
    return combined.length ? combined : [{ level:"good" as const, title:"Core checks passed", detail:"Funding, statements, liquidity and debt-service assumptions are internally consistent." }];
  }, [allocated, inputs, modelProjections, statements]);
  const last = statements[statements.length - 1]!;
  const valuation = useMemo(() => calculateDcfValuation(statements, valuationAssumptions), [statements, valuationAssumptions]);
  const valuationSensitivity = useMemo(() => buildValuationSensitivity(statements, valuationAssumptions), [statements, valuationAssumptions]);
  const operationalScenarios = useMemo(() => buildOperationalScenarios(inputs, modelProjections, scenarioConfiguration), [inputs, modelProjections, scenarioConfiguration]);
  const update = (key: keyof FinancialModelInputs, value: string) => setInputs(p => ({ ...p, [key]: Number(value) || 0 }));
  const changeIndustry = (name: string) => { setIndustry(name); setInputs({ ...getFinancialModelTemplate(name).defaults }); setEarlyYearCustomers({ 2: "", 3: "" }); };
  const toggleProject = (id: string) => setProjects(current => current.map(project => project.id === id ? { ...project, enabled: !project.enabled } : project));
  const selectedProject = projects.find(project => project.id === selectedProjectId) ?? projects[0];
  const updateProject = (patch: Partial<ModelProject>) => setProjects(current => current.map(project => project.id === selectedProjectId ? { ...project, ...patch } : project));
  const addProject = () => {
    const id = `project-${Date.now()}`;
    setProjects(current => [...current, blankProject(id)]);
    setSelectedProjectId(id);
  };
  const addDriver = (kind: "revenueDrivers" | "costDrivers", name: string) => {
    const current = selectedProject[kind] ?? [];
    if (current.some(driver => driver.name === name)) return;
    updateProject({ [kind]: [...current, { id: `${kind}-${Date.now()}`, name, amount: 0, quantity: 1, unitAmount: 0, frequency: "annual", quantityGrowth:selectedProject.annualGrowth, unitAmountGrowth:0, yearlyOverrides:{} }] });
  };
  const updateDriver = (kind: "revenueDrivers" | "costDrivers", id: string, patch: Partial<ProjectDriver>) => updateProject({ [kind]: (selectedProject[kind] ?? []).map(driver => driver.id === id ? { ...driver, ...patch } : driver) });
  const importEdTechWorkbook = async (file?: File) => {
    if (!file) return;
    setWorkbookImportMessage("Importing workbook...");
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellFormula: true, cellNF: true });
      const required = ["Subscription Econ","Carts Economics","Tablet Economics","Tablet Costs","Human Capital","Capex Investment","Financing","Government"];
      const missing = required.filter(name => !workbook.Sheets[name]);
      if (missing.length) throw new Error(`Workbook not recognised. Missing sheets: ${missing.join(", ")}.`);
      const value = (sheet:string, cell:string) => {
        const raw = workbook.Sheets[sheet]?.[cell]?.v;
        return typeof raw === "number" && Number.isFinite(raw) ? Math.abs(raw) : 0;
      };
      const id = (name:string) => `${name}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
      const tabletRevenueId=id("tablet-revenue"), cartRevenueId=id("cart-revenue"), subscriptionRevenueId=id("subscription-revenue");
      const tabletQuantity=value("Tablet Costs","B6")||value("Tablet Costs","B29");
      const tabletPrice=value("Tablet Economics","B5");
      const tabletCost=value("Tablet Costs","B49")||value("Tablet Economics","B9");
      const cartQuantity=value("Tablet Costs","C6")||20;
      const cartPrice=value("Carts Economics","B5");
      const cartCost=value("Carts Economics","B12")||value("Tablet Costs","C20");
      const importedProjects:ModelProject[]=[
        { ...blankProject(id("project")), name:"EdTechPAD Tablets", businessType:"hardware", startingUnits:0, revenuePerUnit:0,
          revenueDrivers:[{id:tabletRevenueId,name:"Tablet and device sales",amount:0,quantity:tabletQuantity,unitAmount:tabletPrice,frequency:"annual"}],
          costDrivers:[{id:id("cost"),name:"Tablet landed and configuration cost",amount:0,quantity:tabletQuantity,unitAmount:tabletCost,frequency:"annual",linkedDriverId:tabletRevenueId,linkedUnitsPerUnit:1}] },
        { ...blankProject(id("project")), name:"Charging Carts", businessType:"hardware", startingUnits:0, revenuePerUnit:0,
          revenueDrivers:[{id:cartRevenueId,name:"Charging cart sales",amount:0,quantity:cartQuantity,unitAmount:cartPrice,frequency:"annual"}],
          costDrivers:[{id:id("cost"),name:"Charging cart landed cost",amount:0,quantity:cartQuantity,unitAmount:cartCost,frequency:"annual",linkedDriverId:cartRevenueId,linkedUnitsPerUnit:1}] },
        { ...blankProject(id("project")), name:"EdTechPAD Subscriptions", businessType:"subscription", startingUnits:0, revenuePerUnit:0,
          revenueDrivers:[{id:subscriptionRevenueId,name:"Learner subscriptions",amount:0,quantity:value("Government","B5")||1203000,unitAmount:value("Government","C5")||12000,frequency:"annual"}],
          costDrivers:[{id:id("cost"),name:"NCDC content share",amount:0,quantity:value("Government","B5")||1203000,unitAmount:(value("Government","C5")||12000)*.2,frequency:"annual",linkedDriverId:subscriptionRevenueId,linkedUnitsPerUnit:1}] },
        { ...blankProject(id("project")), name:"Training and Onboarding", businessType:"services", startingUnits:0, revenuePerUnit:0,
          costDrivers:["Staff allowance","Meals","Accommodation","Transport and fuel"].map((name,index)=>({id:id("cost"),name,amount:0,quantity:1,unitAmount:value("Training &Onboarding",`J${[13,14,15,18][index]}`),frequency:"annual" as const})) },
        { ...blankProject(id("project")), name:"Government Digital Learning", businessType:"government", startingUnits:0, revenuePerUnit:0, enabled:false,
          revenueDrivers:[
            {id:id("revenue"),name:"Government tablet deployment",amount:0,quantity:value("Government","B3"),unitAmount:value("Government","C3"),frequency:"one-off"},
            {id:id("revenue"),name:"Government subscriptions",amount:0,quantity:value("Government","B5"),unitAmount:value("Government","C5"),frequency:"annual"}
          ],
          costDrivers:[3,4,6,7,8,9,10,11,12,13,14].map(row=>({id:id("cost"),name:String(workbook.Sheets["Government"]?.[`A${row}`]?.v||`Government cost ${row}`),amount:0,quantity:value("Government",`B${row}`)||1,unitAmount:value("Government",`C${row}`)||value("Government",`D${row}`),frequency:row===5?"annual":"one-off"})) }
      ];
      const humanSheet=workbook.Sheets["Human Capital"];
      const importedRoles:PersonnelRole[]=[];
      for(let row=6;row<=70;row++){
        const jobTitle=String(humanSheet?.[`B${row}`]?.v??"").trim();
        const count=Number(humanSheet?.[`C${row}`]?.v)||0;
        const lower=Number(humanSheet?.[`D${row}`]?.v)||0;
        const upper=Number(humanSheet?.[`E${row}`]?.v)||0;
        if(!jobTitle||(!lower&&!upper))continue;
        importedRoles.push({id:id("role"),jobTitle,lowerSalary:Math.abs(lower)*12,upperSalary:Math.abs(upper)*12,annualSalaryGrowth:5,positions:Object.fromEntries(Array.from({length:inputs.years},(_,i)=>[i+1,count]))});
      }
      const capexSheet=workbook.Sheets["Capex Investment"];
      let capex=0;
      for(let row=1;row<=139;row++) for(const column of ["D","E","F"]){const amount=Number(capexSheet?.[`${column}${row}`]?.v);if(Number.isFinite(amount)&&amount>0)capex+=amount;}
      const debt=value("Financing","B4")+value("Financing","B5");
      const rate=((value("Financing","C4")||.18)*100);
      setProjects(importedProjects); setSelectedProjectId(importedProjects[0].id); setPersonnelRoles(importedRoles);
      setIndustry("Education Technology"); setCurrency("UGX");
      setInputs(current=>({...current,capex:capex||current.capex,fundingRequired:debt||current.fundingRequired,debtShare:debt?100:current.debtShare,interestRate:rate,annualPayroll:importedRoles.reduce((sum,role)=>sum+((role.lowerSalary+role.upperSalary)/2)*(role.positions[1]??0),0)}));
      setWorkbookImportMessage(`Imported ${importedProjects.length} projects and ${importedRoles.length} personnel roles from ${file.name}. Review each page before saving.`);
    } catch(error) {
      setWorkbookImportMessage(error instanceof Error?error.message:"The workbook could not be imported.");
    }
  };
  const renderStep = () => {
    if (activeStep === 0) return <><label className="block"><span className="mb-1.5 block text-sm font-semibold">Company name</span><input value={company} onChange={e=>setCompany(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3.5 py-3"/></label><label className="block"><span className="mb-1.5 block text-sm font-semibold">Industry template</span><select value={industry} onChange={e=>changeIndustry(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3">{industries.map(x=><option key={x}>{x}</option>)}</select><span className="mt-1.5 block text-xs text-slate-400">{template.description}</span></label><Field label="Projection period" value={inputs.years} suffix="years" onChange={v=>update("years",v)}/></>;
    if (activeStep === 1) return <><div className="rounded-xl border-2 border-emerald-200 bg-emerald-50/40 p-4"><div className="mb-4 flex items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Project setup</p><p className="mt-1 text-sm text-slate-600">Create projects and switch each one into or out of the consolidated model.</p></div><button type="button" onClick={addProject} className="flex shrink-0 items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white"><Plus size={14}/> Add project</button></div><label className="mb-4 block"><span className="mb-1 block text-xs font-bold">Select project</span><select value={selectedProjectId} onChange={e=>setSelectedProjectId(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5">{projects.map((project,index)=><option key={project.id} value={project.id}>{project.name||`Untitled project ${index+1}`}</option>)}</select></label><div className="grid gap-4 sm:grid-cols-2"><label><span className="mb-1 block text-xs font-bold">Project name</span><input value={selectedProject.name} onChange={e=>updateProject({name:e.target.value})} placeholder="Enter project name" className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5"/></label><label><span className="mb-1 block text-xs font-bold">Type of business</span><select value={selectedProject.businessType} onChange={e=>updateProject({businessType:e.target.value as ModelProject["businessType"]})} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5"><option value="education-technology">Education Technology</option><option value="services">Services</option><option value="hardware">Hardware / product sales</option><option value="subscription">Subscription</option><option value="fintech">Fintech</option><option value="agritech">Agritech</option><option value="government">Government contract</option><option value="social-impact">Social impact</option></select></label></div><button type="button" onClick={()=>toggleProject(selectedProject.id)} className={`mt-4 flex w-full items-center justify-between rounded-lg px-4 py-3 text-sm font-bold ${selectedProject.enabled?"bg-emerald-700 text-white":"bg-slate-200 text-slate-600"}`}><span>Project switch</span><span>{selectedProject.enabled?"ON · Included in model":"OFF · Excluded from model"}</span></button></div><Guidance title={`${industry} project model`} text={template.guidance}/></>;
    if (activeStep === 2 || activeStep === 3) return <><label className="block"><span className="mb-1.5 block text-sm font-semibold">Project</span><select value={selectedProjectId} onChange={e=>setSelectedProjectId(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3">{projects.map((project,index)=><option key={project.id} value={project.id}>{project.name||`Untitled project ${index+1}`}</option>)}</select></label><ProjectDriverBuilder mode={activeStep===2?"revenue":"cost"} years={inputs.years} project={selectedProject} currency={currency} suggestions={PROJECT_BUSINESS_SUGGESTIONS[selectedProject.businessType]} onAdd={addDriver} onChange={updateDriver}/></>;
    if (activeStep === 4) return <><div className="grid gap-4 sm:grid-cols-2"><Field label={template.customerLabel} value={inputs.startingCustomers} onChange={v=>update("startingCustomers",v)}/><Field label="Annual growth" value={inputs.annualCustomerGrowth} suffix="%" onChange={v=>update("annualCustomerGrowth",v)}/><Field label="Churn / attrition" value={inputs.churnRate} suffix="%" onChange={v=>update("churnRate",v)}/></div><div className="rounded-xl border border-blue-100 bg-blue-50 p-4"><p className="mb-3 text-sm font-bold text-blue-950">Early-year volume ramp</p><div className="grid gap-3 sm:grid-cols-3"><ReadOnlyYearField label="Year 1" value={inputs.startingCustomers}/>{[2,3].map(year=><label key={year}><span className="mb-1 block text-xs font-bold text-blue-900">Year {year}</span><input type="number" min="0" value={earlyYearCustomers[year]??""} onChange={e=>setEarlyYearCustomers(c=>({...c,[year]:e.target.value}))} placeholder="Use growth" className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2.5"/></label>)}</div></div></>;
    if (activeStep === 5) return <div className="grid gap-4 sm:grid-cols-2"><Field label={template.priceLabel} value={inputs.annualPrice} prefix={currency} onChange={v=>update("annualPrice",v)}/><Field label="Gross margin" value={inputs.grossMargin} suffix="%" onChange={v=>update("grossMargin",v)}/></div>;
    if (activeStep === 6) return <div className="grid gap-4 sm:grid-cols-2"><Field label="Other annual overheads" value={inputs.annualOverheads} prefix={currency} onChange={v=>update("annualOverheads",v)}/><Field label="General cost inflation" value={inputs.opexInflation} suffix="%" onChange={v=>update("opexInflation",v)}/>{!personnelRoles.length&&<Field label="Annual payroll (quick estimate)" value={inputs.annualPayroll} prefix={currency} onChange={v=>update("annualPayroll",v)}/>}</div>;
    if (activeStep === 7) return <PersonnelCostBuilder roles={personnelRoles} years={inputs.years} currency={currency} payrollByYear={payrollByYear} onChange={setPersonnelRoles}/>;
    if (activeStep === 8) return <Field label="Initial capital expenditure" value={inputs.capex} prefix={currency} onChange={v=>update("capex",v)}/>;
    if (activeStep === 9) return <><Field label="Existing founder and business investment" value={existingInvestment} prefix={currency} onChange={v=>setExistingInvestment(Number(v)||0)}/><Guidance title="Valuation evidence" text="Include cash, equipment, software, intellectual property, licences and documented founder effort at supportable values."/></>;
    if (activeStep === 10) return <><Field label="Funding required" value={inputs.fundingRequired} prefix={currency} onChange={v=>update("fundingRequired",v)}/><div className="space-y-2"><p className="text-sm font-bold">Allocate use of funds</p>{uses.map((item,index)=><label key={item.name} className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 p-2"><span className="min-w-0 flex-1 text-xs font-semibold">{item.name}</span><span className="text-[10px] font-bold text-slate-400">{currency}</span><input type="number" min="0" value={item.value} onChange={e=>setUses(current=>current.map((row,i)=>i===index?{...row,value:Number(e.target.value)||0}:row))} className="w-36 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-right text-sm"/></label>)}<p className={`text-xs font-bold ${Math.abs(allocated-inputs.fundingRequired)<1?"text-emerald-700":"text-red-600"}`}>Allocated {money(allocated)} of {money(inputs.fundingRequired)} required</p></div></>;
    if (activeStep === 11) return <div className="grid gap-4 sm:grid-cols-2"><Field label="Debt portion" value={inputs.debtShare} suffix="%" onChange={v=>update("debtShare",v)}/><Field label="Interest rate" value={inputs.interestRate} suffix="%" onChange={v=>update("interestRate",v)}/><Field label="Loan term" value={inputs.loanTerm} suffix="years" onChange={v=>update("loanTerm",v)}/><Field label="Principal grace period" value={inputs.gracePeriod??0} suffix="years" onChange={v=>update("gracePeriod",v)}/><label><span className="mb-1.5 block text-sm font-semibold">Repayment method</span><select value={inputs.repaymentMethod??"equal-principal"} onChange={e=>setInputs(p=>({...p,repaymentMethod:e.target.value as FinancialModelInputs["repaymentMethod"]}))} className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3"><option value="equal-principal">Equal principal</option><option value="annuity">Equal total payment (annuity)</option><option value="interest-only">Interest only, principal at maturity</option><option value="balloon">Balloon repayment</option></select></label>{inputs.repaymentMethod==="balloon"&&<Field label="Balloon at maturity" value={inputs.balloonPercent??30} suffix="%" onChange={v=>update("balloonPercent",v)}/>}</div>;
    if (activeStep === 12) return <div className="grid gap-4 sm:grid-cols-2"><Field label="Corporate tax" value={inputs.taxRate} suffix="%" onChange={v=>update("taxRate",v)}/><Field label="Receivable days" value={inputs.receivableDays} suffix="days" onChange={v=>update("receivableDays",v)}/><Field label="Inventory days" value={inputs.inventoryDays??0} suffix="days" onChange={v=>update("inventoryDays",v)}/><Field label="Payable days" value={inputs.payableDays} suffix="days" onChange={v=>update("payableDays",v)}/></div>;
    if (activeStep === 13) return <><p className="text-sm text-slate-600">Choose the case to test. Explicit early-year volumes remain fixed; organic growth changes afterward.</p><div className="grid grid-cols-3 gap-2">{(["conservative","base","optimistic"] as ModelScenario[]).map(s=><button key={s} onClick={()=>setScenario(s)} className={`rounded-xl border px-3 py-4 text-sm font-bold capitalize ${scenario===s?"border-emerald-600 bg-emerald-50 text-emerald-800":"border-slate-200"}`}>{s}</button>)}</div></>;
    return <div className="space-y-3">{validations.map(v=><div key={v.title} className="rounded-xl border border-slate-200 p-4"><p className="font-bold">{v.title}</p><p className="mt-1 text-sm text-slate-500">{v.detail}</p></div>)}</div>;
  };

  const exportCsv = () => {
    const head = `Year,Customers,Revenue (${currency}),Gross Profit (${currency}),EBITDA (${currency}),Net Profit (${currency}),Closing Cash (${currency}),Debt Balance (${currency}),DSCR\n`;
    const body = statements.map(r => [r.year,"",r.revenue,r.grossProfit,r.ebitda,r.netProfit,r.closingCash,r.debt,r.dscr.toFixed(2)].join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([head + body], { type: "text/csv" })); a.download = `${company.replace(/\W+/g,"-").toLowerCase()}-financial-model.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  const exportWorkbook = () => downloadFinancialModelWorkbook({ company, currency, inputs, statements, loan: loanSchedule });
  const exportPdf = () => downloadFinancialModelPdf({ company, industry, currency, inputs, statements, loan: loanSchedule, projects, projectRows, findings: validations });
  const exportPresentation = () => void downloadFinancialModelPresentation({ company, industry, currency, inputs, statements, projects, projectRows, uses, findings: validations });
  const saveDraft = async () => {
    if (modelStatus === "submitted") { setSaveError("This model is locked while independent review is pending."); return; }
    const organizationId = user?.organization_id;
    const draft = { company, industry, inputs, earlyYearCustomers, projects, personnelRoles, existingInvestment, uses, valuationAssumptions, scenarioConfiguration, taxProfile,
      publishedOutputs: { statements, loanSchedule, valuation, validations, projectRows } };
    const localKey = `boat-financial-model:${organizationId ?? "offline"}`;
    localStorage.setItem(localKey, JSON.stringify(draft));
    setSaving(true); setSaveError("");
    if (!organizationId) {
      setSaving(false); setSaved(true); setTimeout(()=>setSaved(false),1600); return;
    }
    const nextStatus = modelStatus === "approved" || modelStatus === "changes_requested" ? "draft" : modelStatus;
    const payload = { organization_id: organizationId, name: company.trim() || "Untitled financial model", industry, currency, status: nextStatus, model_data: draft, updated_at: new Date().toISOString() };
    const query = modelId
      ? (supabase as any).from("financial_models").update(payload).eq("id", modelId).eq("organization_id", organizationId).select("id").single()
      : (supabase as any).from("financial_models").insert(payload).select("id").single();
    const result = await query;
    setSaving(false);
    if (result.error) { setSaveError("Saved offline. Cloud sync will be available after the financial-model migration is applied."); return; }
    setModelId(result.data.id);
    if (user?.id) await (supabase as any).from("financial_model_collaborators").upsert({ model_id:result.data.id, organization_id:organizationId, user_id:user.id, role:"owner" },{onConflict:"model_id,user_id"});
    setModelStatus(nextStatus); setSaved(true); setTimeout(()=>setSaved(false),1600);
  };

  return <div className="min-h-screen bg-[#f5f7f4] text-slate-900">
    <div className="border-b border-slate-200 bg-white px-5 py-3 lg:px-8">
      <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4">
        <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-700 text-white"><BarChart3 size={20}/></div><div><p className="text-xs font-bold uppercase tracking-[.18em] text-emerald-700">BOAT</p><h1 className="text-lg font-bold">Financial Modelling Studio</h1></div></div>
        <div className="flex flex-wrap items-center justify-end gap-2"><span className="hidden text-xs text-slate-500 md:block">{saveError || (modelStatus==="submitted"?"Locked for review":modelId?`Cloud · ${modelStatus.replace("_"," ")}`:"New draft")}</span><label className="flex cursor-pointer items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800"><Upload size={16}/> Import EdTech workbook<input type="file" accept=".xlsx,.xls" className="hidden" onChange={e=>{void importEdTechWorkbook(e.target.files?.[0]);e.currentTarget.value="";}}/></label><button onClick={saveDraft} disabled={saving||modelStatus==="submitted"} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60">{saved ? <Check size={16}/> : <Save size={16}/>} {saving ? "Saving..." : saved ? "Saved" : "Save draft"}</button><button onClick={exportWorkbook} className="flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800"><Download size={16}/> Export Excel</button></div>
      </div>
    </div>
    {workbookImportMessage&&<div className={`border-b px-5 py-2 text-center text-xs font-semibold ${workbookImportMessage.startsWith("Imported")?"border-emerald-200 bg-emerald-50 text-emerald-800":"border-amber-200 bg-amber-50 text-amber-800"}`}>{workbookImportMessage}</div>}

    <div className="mx-auto grid max-w-[1500px] lg:grid-cols-[260px_1fr]">
      <aside className="hidden min-h-[calc(100vh-65px)] border-r border-slate-200 bg-white p-5 lg:block">
        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Model progress</p><div className="mb-6 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-emerald-600" style={{width:`${(activeStep+1)/steps.length*100}%`}}/></div>
        <nav className="space-y-1">{steps.map((s,i)=><button key={s} onClick={()=>setActiveStep(i)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm ${i===activeStep?"bg-emerald-50 font-bold text-emerald-800":i<activeStep?"text-slate-700":"text-slate-400"}`}><span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${i<activeStep?"bg-emerald-600 text-white":i===activeStep?"border-2 border-emerald-600":"border border-slate-200"}`}>{i<activeStep?<Check size={13}/>:i+1}</span>{s}</button>)}</nav>
      </aside>

      <main className="min-w-0 p-4 md:p-7 lg:p-9">
        <div className="mx-auto max-w-6xl">
          <div className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><div className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-700"><span>Models</span><ChevronRight size={14}/><span>New investment model</span></div><h2 className="text-3xl font-bold tracking-tight md:text-4xl">Build a bankable financial story</h2><p className="mt-2 max-w-2xl text-slate-500">Answer practical questions. BOAT links the statements, tests the assumptions and prepares an investor-ready case.</p></div><div className="flex rounded-xl border border-slate-200 bg-white p-1">{(["conservative","base","optimistic"] as ModelScenario[]).map(s=><button key={s} onClick={()=>setScenario(s)} className={`rounded-lg px-3 py-2 text-xs font-bold capitalize ${scenario===s?"bg-slate-900 text-white":"text-slate-500"}`}>{s}</button>)}</div></div>

          <section className="mb-6 grid gap-4 md:grid-cols-4">{[
            ["Year 5 revenue", money(last.revenue,true), TrendingUp, "text-emerald-700 bg-emerald-50"], ["Year 5 EBITDA", money(last.ebitda,true), BarChart3, "text-blue-700 bg-blue-50"], ["Closing cash", money(last.closingCash,true), Wallet, last.closingCash>=0?"text-violet-700 bg-violet-50":"text-red-700 bg-red-50"], ["Debt service cover", `${last.dscr.toFixed(2)}x`, Target, last.dscr>=1.2?"text-emerald-700 bg-emerald-50":"text-amber-700 bg-amber-50"]
          ].map(([label,value,Icon,tone]:any)=><div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-3 flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</span><span className={`rounded-lg p-2 ${tone}`}><Icon size={17}/></span></div><p className="text-2xl font-bold">{value}</p></div>)}</section>

          <div className="grid gap-6 xl:grid-cols-[1.08fr_.92fr]">
            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 p-5"><p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Step {activeStep+1} of {steps.length}</p><h3 className="mt-1 text-xl font-bold">{activeStep===0?"Tell us about the business":activeStep===steps.length-1?"Review your investment case":activeStep===1?"Set up your projects":activeStep===2?"Build project revenue drivers":activeStep===3?"Build project cost drivers":"Shape your key assumptions"}</h3></div>
              <div className="space-y-5 p-5">
                {renderStep()}
                {activeStep < 0 && <>
                <label className="block"><span className="mb-1.5 block text-sm font-semibold">Company name</span><input value={company} onChange={e=>setCompany(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3.5 py-3 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"/></label>
                <label className="block"><span className="mb-1.5 block text-sm font-semibold">Industry template</span><select value={industry} onChange={e=>changeIndustry(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3">{industries.map(x=><option key={x}>{x}</option>)}</select><span className="mt-1.5 block text-xs text-slate-400">{template.description} Selecting a template loads its driver assumptions.</span></label>
                <div className="grid gap-4 sm:grid-cols-2"><Field label={template.customerLabel} value={inputs.startingCustomers} onChange={v=>update("startingCustomers",v)}/><Field label={template.priceLabel} value={inputs.annualPrice} prefix={currency} onChange={v=>update("annualPrice",v)}/><Field label="Annual growth" value={inputs.annualCustomerGrowth} suffix="%" onChange={v=>update("annualCustomerGrowth",v)}/><Field label="Churn / attrition" value={inputs.churnRate} suffix="%" onChange={v=>update("churnRate",v)}/><Field label="Gross margin" value={inputs.grossMargin} suffix="%" onChange={v=>update("grossMargin",v)}/><Field label="Annual payroll" value={inputs.annualPayroll} prefix={currency} onChange={v=>update("annualPayroll",v)}/><Field label="Funding required" value={inputs.fundingRequired} prefix={currency} onChange={v=>update("fundingRequired",v)}/><Field label="Debt portion" value={inputs.debtShare} suffix="%" onChange={v=>update("debtShare",v)}/></div>
                <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4"><div className="mb-3"><p className="text-sm font-bold text-blue-950">Early-year volume ramp</p><p className="mt-1 text-xs leading-5 text-blue-800">Enter exceptional Year 2 or Year 3 volumes directly. Leave a year blank for normal growth and churn to take over from the previous year.</p></div><div className="grid gap-3 sm:grid-cols-3"><ReadOnlyYearField label="Year 1" value={inputs.startingCustomers}/>{[2,3].map(year=><label key={year}><span className="mb-1 block text-xs font-bold text-blue-900">Year {year}</span><input type="number" min="0" value={earlyYearCustomers[year] ?? ""} onChange={event=>setEarlyYearCustomers(current=>({ ...current, [year]: event.target.value }))} placeholder="Use normal growth" className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"/></label>)}</div><p className="mt-3 text-[11px] font-semibold text-blue-700">Growth begins automatically after the last explicitly entered year.</p></div>
                <div className="grid gap-3 sm:grid-cols-2"><DriverList title="Revenue streams" items={template.revenueStreams}/><DriverList title="Key cost drivers" items={template.costDrivers}/></div>
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4"><div className="flex gap-3"><Lightbulb className="mt-0.5 shrink-0 text-emerald-700" size={18}/><div><p className="text-sm font-bold text-emerald-900">{industry} guidance</p><p className="mt-1 text-xs leading-5 text-emerald-800">{template.guidance}</p><p className="mt-2 text-[11px] font-bold text-emerald-700">Indicative benchmark: {template.benchmark.grossMargin[0]}â€“{template.benchmark.grossMargin[1]}% gross margin Â· {template.benchmark.growth[0]}â€“{template.benchmark.growth[1]}% growth</p></div></div></div>
                </>}
              </div>
              <div className="flex items-center justify-between border-t border-slate-100 p-5"><button onClick={()=>setActiveStep(x=>Math.max(0,x-1))} className="text-sm font-semibold text-slate-500">Back</button><button onClick={()=>setActiveStep(x=>Math.min(steps.length-1,x+1))} className="flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white">Save & continue <ArrowRight size={16}/></button></div>
            </section>

            <div className="space-y-6">
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><div><h3 className="font-bold">Revenue & cash outlook</h3><p className="text-xs text-slate-400">{scenario[0].toUpperCase()+scenario.slice(1)} case · {currency}{hasConfiguredProjects(projects)?" · consolidated projects":""}</p></div><Sparkles className="text-emerald-600" size={19}/></div><div className="h-56"><ResponsiveContainer width="100%" height="100%"><AreaChart data={statements}><defs><linearGradient id="rev" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#047857" stopOpacity={.25}/><stop offset="95%" stopColor="#047857" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0"/><XAxis dataKey="year" tickFormatter={x=>`Y${x}`} axisLine={false} tickLine={false}/><YAxis tickFormatter={x=>money(x,true)} axisLine={false} tickLine={false}/><Tooltip formatter={(v:number)=>money(v)}/><Area type="monotone" dataKey="revenue" stroke="#047857" strokeWidth={3} fill="url(#rev)"/></AreaChart></ResponsiveContainer></div></section>
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><div><h3 className="font-bold">Readiness checks</h3><p className="text-xs text-slate-400">Live validation of this model</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold">{validations.length} insight{validations.length!==1?"s":""}</span></div><div className="space-y-3">{validations.map(v=><div key={v.title} className={`flex gap-3 rounded-xl border p-3 ${v.level==="critical"?"border-red-100 bg-red-50":v.level==="warning"?"border-amber-100 bg-amber-50":"border-emerald-100 bg-emerald-50"}`}>{v.level==="good"?<Check className="text-emerald-700" size={18}/>:<AlertTriangle className={v.level==="critical"?"text-red-600":"text-amber-600"} size={18}/>}<div><p className="text-sm font-bold">{v.title}</p><p className="mt-0.5 text-xs leading-5 text-slate-600">{v.detail}</p></div></div>)}</div></section>
              <section className="rounded-2xl bg-[#102b25] p-5 text-white shadow-sm"><p className="text-xs font-bold uppercase tracking-widest text-emerald-300">Investor outputs</p><h3 className="mt-2 text-lg font-bold">Your model feeds every document</h3><div className="mt-4 grid grid-cols-3 gap-2"><button onClick={exportWorkbook} className="rounded-xl bg-white/10 p-3 text-center hover:bg-white/15"><FileSpreadsheet className="mx-auto mb-2" size={20}/><span className="text-[11px] font-semibold">Workbook</span></button><button onClick={exportPresentation} className="rounded-xl bg-white/10 p-3 text-center hover:bg-white/15"><Presentation className="mx-auto mb-2" size={20}/><span className="text-[11px] font-semibold">Pitch deck</span></button><button onClick={exportPdf} className="rounded-xl bg-white/10 p-3 text-center hover:bg-white/15"><FileSpreadsheet className="mx-auto mb-2" size={20}/><span className="text-[11px] font-semibold">PDF memo</span></button></div></section>
            </div>
          </div>
          {activeStep===steps.length-1&&<>
          <PhaseOneStatements statements={statements} money={money}/>
          <PhaseTwoValuation assumptions={valuationAssumptions} result={valuation} sensitivity={valuationSensitivity} currency={currency} money={money} onChange={(key,value)=>setValuationAssumptions(current=>({...current,[key]:value}))}/>
          <PhaseTwoScenarios configuration={scenarioConfiguration} cases={operationalScenarios} money={money} onChange={(caseName,key,value)=>setScenarioConfiguration(current=>({...current,[caseName]:{...current[caseName],[key]:value} as ScenarioDriverSet}))}/>
          <PhaseTwoTaxPack profile={taxProfile} onSelect={profile=>{setTaxProfile(profile);setInputs(current=>({...current,taxRate:profile.corporateIncomeTaxRate,opexInflation:profile.inflationRate}));}} onChange={(key,value)=>{setTaxProfile(current=>({...current,[key]:value}));if(key==="corporateIncomeTaxRate")setInputs(current=>({...current,taxRate:value}));if(key==="inflationRate")setInputs(current=>({...current,opexInflation:value}));}}/>
          <PhaseTwoAiAssistant organizationId={user?.organization_id} company={company} industry={industry} currency={currency} inputs={inputs} statements={statements} projects={projects} onApply={(target,value)=>setInputs(current=>({...current,[target]:value}))}/>
          <PhaseThreeWorkflow modelId={modelId} currentUserId={user?.id} status={modelStatus} onStatus={setModelStatus}/>
          <PhaseThreeEnterpriseControls organizationId={user?.organization_id} modelId={modelId} status={modelStatus}/>
          </>}
          {activeStep===1&&
          <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col justify-between gap-3 border-b border-slate-100 p-5 md:flex-row md:items-center"><div><p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Project switchboard</p><h3 className="mt-1 text-xl font-bold">Multi-project and business-unit model</h3><p className="mt-1 text-sm text-slate-500">Adapted from the reviewed development-bank workbook. Toggle a unit to include or exclude its standalone revenue, costs and EBITDA.</p></div><div className="rounded-xl bg-slate-900 px-4 py-3 text-white"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Portfolio year {inputs.years} EBITDA</p><p className="text-xl font-bold">{money(portfolio[portfolio.length-1]?.ebitda ?? 0, true)}</p></div></div>
            <div className="border-b border-slate-100 bg-slate-50/60 p-5"><div className="mb-4 flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Editing project</p><h4 className="text-lg font-bold">{selectedProject.name || "Untitled project"}</h4></div><button type="button" onClick={addProject} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold"><Plus size={14}/> Add project</button></div><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><label><span className="mb-1 block text-xs font-bold">Project name</span><input value={selectedProject.name} onChange={e=>updateProject({name:e.target.value})} placeholder="Enter project name" className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5"/></label><label><span className="mb-1 block text-xs font-bold">Type of business for this project</span><select value={selectedProject.businessType} onChange={e=>updateProject({businessType:e.target.value as ModelProject["businessType"]})} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5"><option value="education-technology">Education Technology</option><option value="services">Services</option><option value="hardware">Hardware / product sales</option><option value="subscription">Subscription</option><option value="fintech">Fintech</option><option value="agritech">Agritech</option><option value="government">Government contract</option><option value="social-impact">Social impact</option></select></label><ProjectField label="Start year" value={selectedProject.startYear} onChange={value=>updateProject({startYear:value})}/><label className="flex items-end"><button type="button" onClick={()=>toggleProject(selectedProject.id)} className={`w-full rounded-lg px-3 py-2.5 text-sm font-bold ${selectedProject.enabled?"bg-emerald-700 text-white":"bg-slate-200 text-slate-600"}`}>{selectedProject.enabled?"Included in model":"Excluded from model"}</button></label><ProjectField label="Starting customers / units" value={selectedProject.startingUnits} onChange={value=>updateProject({startingUnits:value})}/><ProjectField label="Annual growth" value={selectedProject.annualGrowth} suffix="%" onChange={value=>updateProject({annualGrowth:value})}/><ProjectField label="Revenue per unit" value={selectedProject.revenuePerUnit} prefix={currency} onChange={value=>updateProject({revenuePerUnit:value})}/><ProjectField label="Direct cost rate" value={selectedProject.directCostRate} suffix="%" onChange={value=>updateProject({directCostRate:value})}/><ProjectField label="Annual fixed costs" value={selectedProject.annualFixedCosts} prefix={currency} onChange={value=>updateProject({annualFixedCosts:value})}/></div><p className="mt-4 text-xs text-slate-500">Blank projects contribute zero until the user enters assumptions.</p></div>
            <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">{projects.map(project => { const row = projectRows.find(item => item.projectId === project.id && item.year === inputs.years); return <button type="button" key={project.id} onClick={()=>setSelectedProjectId(project.id)} className={`rounded-xl border p-4 text-left transition ${project.id===selectedProjectId?"ring-2 ring-emerald-500":project.enabled?"border-emerald-200 bg-emerald-50/50":"border-slate-200 bg-slate-50 opacity-65"}`}><div className="flex items-start justify-between gap-2"><div><p className="font-bold text-slate-900">{project.name}</p><p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{project.businessType.replace("-"," ")} Â· starts Y{project.startYear}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${project.enabled?"bg-emerald-700 text-white":"bg-slate-200 text-slate-500"}`}>{project.enabled?"ON":"OFF"}</span></div><div className="mt-4 grid grid-cols-2 gap-2 text-xs"><div><p className="text-slate-400">Y{inputs.years} revenue</p><p className="font-bold">{money(row?.revenue ?? 0,true)}</p></div><div><p className="text-slate-400">Y{inputs.years} EBITDA</p><p className={`font-bold ${(row?.ebitda??0)>=0?"text-emerald-700":"text-red-600"}`}>{money(row?.ebitda ?? 0,true)}</p></div></div></button>})}</div>
            <div className="overflow-x-auto border-t border-slate-100"><table className="w-full min-w-[700px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400"><tr><th className="px-5 py-3">Consolidated portfolio</th>{portfolio.map(row=><th key={row.year} className="px-4 py-3 text-right">Year {row.year}</th>)}</tr></thead><tbody>{[["Revenue","revenue"],["Direct costs","directCosts"],["Fixed costs","fixedCosts"],["EBITDA","ebitda"]].map(([label,key])=><tr key={key} className="border-t border-slate-100"><td className="px-5 py-3 font-semibold">{label}</td>{portfolio.map(row=><td key={row.year} className={`px-4 py-3 text-right font-semibold ${key==="ebitda"&&row.ebitda<0?"text-red-600":""}`}>{money(row[key as keyof typeof row] as number,true)}</td>)}</tr>)}</tbody></table></div>
          </section>}
        </div>
      </main>
    </div>
  </div>;
}

function Field({label,value,onChange,prefix,suffix}:{label:string;value:number;onChange:(v:string)=>void;prefix?:string;suffix?:string}) { return <label><span className="mb-1.5 block text-sm font-semibold">{label}</span><div className="flex rounded-xl border border-slate-200 focus-within:border-emerald-600 focus-within:ring-2 focus-within:ring-emerald-100">{prefix&&<span className="grid place-items-center border-r border-slate-200 px-3 text-xs font-bold text-slate-400">{prefix}</span>}<input type="number" value={value} onChange={e=>onChange(e.target.value)} className="min-w-0 flex-1 rounded-xl px-3 py-2.5 outline-none"/>{suffix&&<span className="grid place-items-center px-3 text-sm font-bold text-slate-400">{suffix}</span>}</div></label> }
function DriverList({title,items}:{title:string;items:string[]}) { return <div className="rounded-xl border border-slate-200 p-3"><p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">{title}</p><div className="flex flex-wrap gap-1.5">{items.map(item=><span key={item} className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">{item}</span>)}</div></div> }
function Guidance({title,text}:{title:string;text:string}) { return <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4"><div className="flex gap-3"><Lightbulb className="mt-0.5 shrink-0 text-emerald-700" size={18}/><div><p className="text-sm font-bold text-emerald-900">{title}</p><p className="mt-1 text-xs leading-5 text-emerald-800">{text}</p></div></div></div> }
function ReadOnlyYearField({label,value}:{label:string;value:number}) { return <label><span className="mb-1 block text-xs font-bold text-blue-900">{label}</span><input type="number" value={value} readOnly className="w-full rounded-lg border border-blue-100 bg-blue-100/50 px-3 py-2.5 text-sm font-semibold text-blue-950"/></label> }
function ProjectField({label,value,onChange,prefix,suffix}:{label:string;value:number;onChange:(value:number)=>void;prefix?:string;suffix?:string}) { return <label><span className="mb-1 block text-xs font-bold">{label}</span><div className="flex rounded-lg border border-slate-200 bg-white">{prefix&&<span className="grid place-items-center border-r border-slate-200 px-2 text-[10px] font-bold text-slate-400">{prefix}</span>}<input type="number" min="0" value={value} onChange={e=>onChange(Number(e.target.value)||0)} className="min-w-0 flex-1 rounded-lg px-3 py-2.5 outline-none"/>{suffix&&<span className="grid place-items-center px-2 text-xs font-bold text-slate-400">{suffix}</span>}</div></label> }
function PersonnelCostBuilder({roles,years,currency,payrollByYear,onChange}:{roles:PersonnelRole[];years:number;currency:string;payrollByYear:Record<number,number>;onChange:(roles:PersonnelRole[])=>void}) {
  const [importMessage,setImportMessage]=useState("");
  const yearList=Array.from({length:years},(_,i)=>i+1);
  const patchRole=(id:string,patch:Partial<PersonnelRole>)=>onChange(roles.map(role=>role.id===id?{...role,...patch}:role));
  const normalize=(value:string)=>value.trim().toLowerCase().replace(/[%_\-()]/g," ").replace(/\s+/g," ");
  const importFile=async(file?:File)=>{if(!file)return;setImportMessage("Importing...");try{const workbook=XLSX.read(await file.arrayBuffer(),{type:"array"});const sheetName=workbook.SheetNames[0];if(!sheetName)throw new Error("The workbook has no worksheet.");const rows=XLSX.utils.sheet_to_json<Record<string,unknown>>(workbook.Sheets[sheetName],{defval:"",raw:true});if(!rows.length)throw new Error("The first worksheet has no personnel rows.");const find=(row:Record<string,unknown>,names:string[])=>{const wanted=names.map(normalize);const key=Object.keys(row).find(candidate=>wanted.includes(normalize(candidate)));return key?row[key]:"";};const numberValue=(value:unknown)=>Number(String(value??"").replace(/[^0-9.-]/g,""))||0;const imported=rows.map((row,index)=>({id:`role-import-${Date.now()}-${index}`,jobTitle:String(find(row,["Job Title","JobTitle","Role","Position Name","Designation"])||"").trim(),lowerSalary:numberValue(find(row,["Lower Salary","Minimum Salary","Min Salary","Salary Lower"])),upperSalary:numberValue(find(row,["Upper Salary","Maximum Salary","Max Salary","Salary Upper"])),annualSalaryGrowth:numberValue(find(row,["Annual Salary Growth","Annual Salary Growth %","Salary Growth","Salary Growth %","Growth %"])),positions:Object.fromEntries(yearList.map(year=>[year,numberValue(find(row,[`Year ${year}`,`Year${year}`,`Y${year}`,`Positions Year ${year}`,`Headcount Year ${year}`,`Headcount Y${year}`]))]))})).filter(role=>role.jobTitle);if(!imported.length)throw new Error("No rows with a Job Title were found. Download and use the provided template.");onChange([...roles,...imported]);setImportMessage(`${imported.length} personnel role${imported.length===1?"":"s"} imported successfully.`);}catch(error){setImportMessage(error instanceof Error?error.message:"The personnel file could not be imported.");}};
  const downloadTemplate=()=>{const sample={"Job Title":"Software Engineer","Lower Salary":24000000,"Upper Salary":36000000,"Annual Salary Growth %":8,...Object.fromEntries(yearList.map(year=>[`Year ${year}`,year<3?2:3]))};const instructions={"Personnel Import Instructions":"Keep the column headings unchanged. Salaries must be annual amounts in the organisation currency. Enter headcount for each projection year."};const workbook=XLSX.utils.book_new();const schedule=XLSX.utils.json_to_sheet([sample]);schedule["!cols"]=[{wch:28},{wch:18},{wch:18},{wch:24},...yearList.map(()=>({wch:12}))];XLSX.utils.book_append_sheet(workbook,schedule,"Personnel Schedule");XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet([instructions]),"Instructions");XLSX.writeFile(workbook,"BOAT_Personnel_Import_Template.xlsx");};
  return <div className="space-y-4"><div className="flex flex-col justify-between gap-3 rounded-xl border border-emerald-100 bg-emerald-50 p-4 sm:flex-row sm:items-center"><div><p className="font-bold text-emerald-950">Personnel schedule</p><p className="mt-1 text-xs text-emerald-800">Salaries are annual. The model uses the midpoint of the salary band, headcount by year, and annual salary growth.</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={downloadTemplate} className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-emerald-800"><Download size={14}/> Download template</button><label className="flex cursor-pointer items-center gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-emerald-800"><Upload size={14}/> Import Excel / CSV<input type="file" accept=".xlsx,.xls,.csv,text/csv" className="hidden" onChange={e=>{void importFile(e.target.files?.[0]);e.currentTarget.value="";}}/></label><button type="button" onClick={()=>onChange([...roles,blankPersonnelRole()])} className="flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white"><Plus size={14}/> Add role</button></div></div>{importMessage&&<div className={`rounded-lg border px-3 py-2 text-xs font-semibold ${importMessage.includes("successfully")?"border-emerald-200 bg-emerald-50 text-emerald-800":"border-amber-200 bg-amber-50 text-amber-800"}`}>{importMessage}</div>}<div className="overflow-x-auto rounded-xl border border-slate-200"><table className="min-w-[900px] w-full text-sm"><thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="p-3">Job title</th><th className="p-3 text-right">Lower salary</th><th className="p-3 text-right">Upper salary</th><th className="p-3 text-right">Annual growth</th>{yearList.map(year=><th key={year} className="p-3 text-right">Positions Y{year}</th>)}<th className="p-3"/></tr></thead><tbody>{roles.map(role=><tr key={role.id} className="border-t border-slate-100"><td className="p-2"><input value={role.jobTitle} onChange={e=>patchRole(role.id,{jobTitle:e.target.value})} placeholder="e.g. Software engineer" className="w-44 rounded-lg border border-slate-200 px-2 py-2"/></td><td className="p-2"><input type="number" min="0" value={role.lowerSalary} onChange={e=>patchRole(role.id,{lowerSalary:Number(e.target.value)||0})} className="w-32 rounded-lg border border-slate-200 px-2 py-2 text-right"/></td><td className="p-2"><input type="number" min="0" value={role.upperSalary} onChange={e=>patchRole(role.id,{upperSalary:Number(e.target.value)||0})} className="w-32 rounded-lg border border-slate-200 px-2 py-2 text-right"/></td><td className="p-2"><div className="flex rounded-lg border border-slate-200"><input type="number" min="0" value={role.annualSalaryGrowth} onChange={e=>patchRole(role.id,{annualSalaryGrowth:Number(e.target.value)||0})} className="w-20 px-2 py-2 text-right"/><span className="p-2 text-slate-400">%</span></div></td>{yearList.map(year=><td key={year} className="p-2"><input type="number" min="0" step="1" value={role.positions[year]??0} onChange={e=>patchRole(role.id,{positions:{...role.positions,[year]:Number(e.target.value)||0}})} className="w-20 rounded-lg border border-slate-200 px-2 py-2 text-right"/></td>)}<td className="p-2"><button type="button" onClick={()=>onChange(roles.filter(item=>item.id!==role.id))} className="rounded-lg p-2 text-red-500 hover:bg-red-50" aria-label="Delete role"><Trash2 size={15}/></button></td></tr>)}{!roles.length&&<tr><td colSpan={yearList.length+5} className="p-8 text-center text-sm text-slate-400">Download the template, complete it, then import it—or add roles manually.</td></tr>}</tbody><tfoot><tr className="border-t-2 border-slate-200 bg-slate-50 font-bold"><td className="p-3" colSpan={4}>Total personnel cost</td>{yearList.map(year=><td key={year} className="p-3 text-right text-emerald-700">{currency} {(payrollByYear[year]??0).toLocaleString(undefined,{maximumFractionDigits:0})}</td>)}<td/></tr></tfoot></table></div></div>;
}
function ProjectDriverBuilder({mode,years,project,currency,suggestions,onAdd,onChange}:{mode:"revenue"|"cost";years:number;project:ModelProject;currency:string;suggestions:{revenue:string[];costs:string[]};onAdd:(kind:"revenueDrivers"|"costDrivers",name:string)=>void;onChange:(kind:"revenueDrivers"|"costDrivers",id:string,patch:Partial<ProjectDriver>)=>void}) {
  const [customName,setCustomName]=useState("");
  const [expandedDrivers,setExpandedDrivers]=useState<Record<string,boolean>>({});
  const groups:[string,"revenueDrivers"|"costDrivers",string[]][]=mode==="revenue"?[["Revenue drivers","revenueDrivers",suggestions.revenue]]:[["Cost drivers","costDrivers",suggestions.costs]];
  const kind=mode==="revenue"?"revenueDrivers":"costDrivers";
  const addCustom=()=>{const name=customName.trim();if(!name)return;const duplicate=(project[kind]??[]).some(driver=>driver.name.toLowerCase()===name.toLowerCase());if(!duplicate)onAdd(kind,name);setCustomName("");};
  return <section className="rounded-2xl border border-slate-200 bg-white p-5">
    <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">{mode==="revenue"?"Revenue":"Cost"} driver builder · {project.businessType.replace("-"," ")}</p>
    <h3 className="mt-1 text-xl font-bold">Build {project.name||"this project"}'s {mode} budget</h3>
    <p className="mt-1 text-sm text-slate-500">Activate a suggested driver or create your own, then enter quantity, unit amount, and frequency.</p>
    <form onSubmit={e=>{e.preventDefault();addCustom();}} className="mt-4 flex gap-2 rounded-xl border border-dashed border-emerald-300 bg-emerald-50/50 p-3"><input value={customName} onChange={e=>setCustomName(e.target.value)} placeholder={`Enter a new ${mode} driver`} className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"/><button type="submit" disabled={!customName.trim()} className="flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"><Plus size={14}/> Add custom driver</button></form>
    <div className="mt-5">{groups.map(([title,groupKind,items])=><div key={groupKind}>
      <p className="mb-2 text-sm font-bold">Suggested {title.toLowerCase()}</p>
      <div className="mb-3 flex flex-wrap gap-2">{items.map(name=>{const active=(project[groupKind]??[]).some(driver=>driver.name===name);return <button type="button" key={name} disabled={active} onClick={()=>onAdd(groupKind,name)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${active?"border-emerald-200 bg-emerald-50 text-emerald-700":"border-slate-200 hover:border-emerald-400"}`}>{active?<Check className="mr-1 inline" size={12}/>:<Plus className="mr-1 inline" size={12}/>} {name}</button>})}</div>
      <div className="space-y-3">{(project[groupKind]??[]).map((driver:ProjectDriver)=>{
        const quantity=driver.quantity??1,unitAmount=driver.unitAmount??driver.amount??0,frequency=driver.frequency??"annual";
        const revenueDrivers=project.revenueDrivers??[];
        const createsCycle=(candidate:ProjectDriver)=>{const seen=new Set<string>();let current:ProjectDriver|undefined=candidate;while(current){if(current.id===driver.id)return true;if(seen.has(current.id))return true;seen.add(current.id);const nextId=current.linkedDriverId??current.linkedRevenueDriverId;current=nextId?revenueDrivers.find(item=>item.id===nextId):undefined;}return false;};
        const linkableDrivers=revenueDrivers.filter(item=>item.id!==driver.id&&!createsCycle(item));
        const linkedDriver=linkableDrivers.find(item=>item.id===(driver.linkedDriverId??driver.linkedRevenueDriverId));
        const linkedRatio=driver.linkedUnitsPerUnit??driver.revenueUnitsPerCostUnit??1;
        const calculatedQuantity=linkedDriver?Math.ceil((linkedDriver.quantity??0)/Math.max(1,linkedRatio)):quantity;
        return <div key={driver.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="mb-2 text-xs font-bold">{driver.name}</p>
          {linkableDrivers.length>0&&<div className="mb-3 grid gap-2 rounded-lg border border-blue-100 bg-blue-50 p-3 sm:grid-cols-2"><label><span className="mb-1 block text-[10px] font-bold text-blue-800">Quantity source</span><select value={driver.linkedDriverId??driver.linkedRevenueDriverId??""} onChange={e=>onChange(groupKind,driver.id,{linkedDriverId:e.target.value||undefined,linkedRevenueDriverId:undefined})} className="w-full rounded-md border border-blue-200 bg-white px-2 py-2 text-sm"><option value="">Enter quantity manually</option>{linkableDrivers.map(source=><option key={source.id} value={source.id}>Linked to: {source.name}</option>)}</select></label>{linkedDriver&&<label><span className="mb-1 block text-[10px] font-bold text-blue-800">{linkedDriver.name} units per 1 {driver.name}</span><input type="number" min="1" value={linkedRatio} onChange={e=>onChange(groupKind,driver.id,{linkedUnitsPerUnit:Math.max(1,Number(e.target.value)||1),revenueUnitsPerCostUnit:undefined})} className="w-full rounded-md border border-blue-200 bg-white px-2 py-2 text-right text-sm"/></label>}<p className="text-[11px] text-blue-700 sm:col-span-2">{linkedDriver?`${linkedDriver.quantity??0} ${linkedDriver.name} units produce ${calculatedQuantity} ${driver.name} units.`:`Optionally link this ${mode} driver to any revenue driver in the project.`}</p></div>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3"><label><span className="mb-1 block text-[10px] font-bold text-slate-500">Quantity</span><input type="number" min="0" disabled={Boolean(linkedDriver)} value={calculatedQuantity} onChange={e=>onChange(groupKind,driver.id,{quantity:Number(e.target.value)||0,unitAmount,frequency,amount:0})} className="w-full rounded-md border border-slate-200 bg-white px-2 py-2 text-right text-sm disabled:bg-slate-100"/></label><label><span className="mb-1 block text-[10px] font-bold text-slate-500">Unit amount ({currency})</span><input type="number" min="0" value={unitAmount} onChange={e=>onChange(groupKind,driver.id,{quantity,unitAmount:Number(e.target.value)||0,frequency,amount:0})} className="w-full rounded-md border border-slate-200 bg-white px-2 py-2 text-right text-sm"/></label><label className="col-span-2 sm:col-span-1"><span className="mb-1 block text-[10px] font-bold text-slate-500">Frequency</span><select value={frequency} onChange={e=>onChange(groupKind,driver.id,{quantity,unitAmount,frequency:e.target.value as DriverFrequency,amount:0})} className="w-full rounded-md border border-slate-200 bg-white px-2 py-2 text-sm"><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option><option value="one-off">One-off</option></select></label></div>
          <div className="mt-2 grid grid-cols-2 gap-2"><label><span className="mb-1 block text-[10px] font-bold text-slate-500">Annual quantity growth</span><div className="flex rounded-md border border-slate-200 bg-white"><input type="number" value={driver.quantityGrowth??project.annualGrowth??0} disabled={Boolean(linkedDriver)} onChange={e=>onChange(groupKind,driver.id,{quantityGrowth:Number(e.target.value)||0})} className="min-w-0 flex-1 px-2 py-2 text-right text-sm disabled:bg-slate-100"/><span className="p-2 text-xs text-slate-400">%</span></div></label><label><span className="mb-1 block text-[10px] font-bold text-slate-500">Annual unit-value growth</span><div className="flex rounded-md border border-slate-200 bg-white"><input type="number" value={driver.unitAmountGrowth??0} onChange={e=>onChange(groupKind,driver.id,{unitAmountGrowth:Number(e.target.value)||0})} className="min-w-0 flex-1 px-2 py-2 text-right text-sm"/><span className="p-2 text-xs text-slate-400">%</span></div></label></div>
          <div className="mt-2 flex justify-between rounded-lg bg-white px-3 py-2 text-xs"><span className="font-semibold text-slate-500">Calculated annual amount</span><span className="font-bold text-emerald-700">{currency} {annualDriverAmount({...driver,quantity,unitAmount,frequency},linkedDriver?.quantity).toLocaleString()}</span></div>
          <button type="button" onClick={()=>setExpandedDrivers(current=>({...current,[driver.id]:!current[driver.id]}))} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">{expandedDrivers[driver.id]?"Hide yearly schedule":"Extrapolate and edit yearly schedule"}</button>
          {expandedDrivers[driver.id]&&<div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white"><table className="w-full min-w-[620px] text-xs"><thead className="bg-slate-50 text-left text-[10px] uppercase text-slate-500"><tr><th className="p-2">Year</th><th className="p-2 text-right">Quantity</th><th className="p-2 text-right">Unit amount</th><th className="p-2 text-right">Annual total</th><th className="p-2">Status</th></tr></thead><tbody>{Array.from({length:years},(_,index)=>index+1).map(year=>{const linkedYearQuantity=linkedDriver?driverValuesForYear(linkedDriver,year).quantity:undefined;const values=driverValuesForYear({...driver,quantity,unitAmount,frequency,quantityGrowth:driver.quantityGrowth??project.annualGrowth},year,linkedYearQuantity);const override=driver.yearlyOverrides?.[year];const setOverride=(patch:{quantity?:number;unitAmount?:number})=>onChange(groupKind,driver.id,{yearlyOverrides:{...(driver.yearlyOverrides??{}),[year]:{...(override??{}),...patch}}});return <tr key={year} className="border-t border-slate-100"><td className="p-2 font-bold">Year {year}</td><td className="p-2"><input type="number" min="0" value={values.quantity} onChange={e=>setOverride({quantity:Number(e.target.value)||0})} className="w-28 rounded-md border border-slate-200 px-2 py-1.5 text-right"/></td><td className="p-2"><input type="number" min="0" value={values.unitAmount} onChange={e=>setOverride({unitAmount:Number(e.target.value)||0})} className="w-36 rounded-md border border-slate-200 px-2 py-1.5 text-right"/></td><td className="p-2 text-right font-bold text-emerald-700">{currency} {annualDriverAmountForYear({...driver,quantity,unitAmount,frequency,quantityGrowth:driver.quantityGrowth??project.annualGrowth,yearlyOverrides:{...(driver.yearlyOverrides??{}),[year]:values}},year,linkedYearQuantity).toLocaleString(undefined,{maximumFractionDigits:0})}</td><td className="p-2">{override?<button type="button" onClick={()=>{const next={...(driver.yearlyOverrides??{})};delete next[year];onChange(groupKind,driver.id,{yearlyOverrides:next});}} className="rounded-md bg-amber-50 px-2 py-1 font-bold text-amber-700">Override · reset</button>:<span className="text-slate-400">Extrapolated</span>}</td></tr>})}</tbody></table></div>}
        </div>})}</div>
    </div>)}</div>
  </section>;
}

