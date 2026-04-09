import React, { useState } from 'react';
import { useAppContext, LoanProduct } from '@/contexts/AppContext';
import { toast } from '@/components/ui/use-toast';
import {
  Settings, CreditCard, Shield, Plus, Pencil, Trash2, Save, X,
  AlertTriangle, CheckCircle, Info, ChevronDown, ChevronUp, PiggyBank, Percent
} from 'lucide-react';
import { PageNotes } from '@/components/common/PageNotes';

// ============ LOAN PRODUCT FORM ============
interface ProductFormData {
  name: string;
  interestRate: string;
  maxTerm: string;
  minAmount: string;
  maxAmount: string;
  interestBasis: 'flat' | 'declining';
  formFee: string;
  monitoringFee: string;
  processingFeeRate: string;
  insuranceFeeRate: string;
  applicationFeeRate: string;
  compulsorySavingsRate: string;
  minimumShares: string;
  isActive: boolean;
}

const emptyForm: ProductFormData = {
  name: '', interestRate: '12', maxTerm: '36', minAmount: '100000', maxAmount: '10000000',
  interestBasis: 'declining', formFee: '5000', monitoringFee: '0', processingFeeRate: '2', insuranceFeeRate: '1',
  applicationFeeRate: '1', compulsorySavingsRate: '10', minimumShares: '50000', isActive: true,
};

const productToForm = (p: LoanProduct): ProductFormData => ({
  name: p.name, interestRate: String(p.interestRate), maxTerm: String(p.maxTerm),
  minAmount: String(p.minAmount), maxAmount: String(p.maxAmount), interestBasis: p.interestBasis,
  formFee: String(p.fees.formFee), monitoringFee: String(p.fees.monitoringFee ?? 0),
  processingFeeRate: String(p.fees.processingFeeRate),
  insuranceFeeRate: String(p.fees.insuranceFeeRate), applicationFeeRate: String(p.fees.applicationFeeRate),
  compulsorySavingsRate: String(p.compulsorySavingsRate), minimumShares: String(p.minimumShares),
  isActive: p.isActive,
});

const LoanSettings: React.FC = () => {
  const { loanProducts, setLoanProducts, provisioningConfig, setProvisioningConfig, formatCurrency, loans } = useAppContext();

  const [activeTab, setActiveTab] = useState<'products' | 'provisioning'>('products');
  const [editingProduct, setEditingProduct] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState<ProductFormData>(emptyForm);
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);

  // ============ PRODUCT HANDLERS ============
  const handleAddProduct = () => {
    if (!form.name.trim()) { toast({ title: 'Error', description: 'Product name is required.' }); return; }
    if (loanProducts.some(p => p.name.toLowerCase() === form.name.toLowerCase())) {
      toast({ title: 'Error', description: 'A product with this name already exists.' }); return;
    }
    const newProduct: LoanProduct = {
      id: 'LP' + String(loanProducts.length + 1).padStart(3, '0'),
      name: form.name, interestRate: parseFloat(form.interestRate) || 0,
      maxTerm: parseInt(form.maxTerm) || 12, minAmount: parseFloat(form.minAmount) || 0,
      maxAmount: parseFloat(form.maxAmount) || 0, interestBasis: form.interestBasis,
      fees: {
        formFee: parseFloat(form.formFee) || 0,
        monitoringFee: parseFloat(form.monitoringFee) || 0,
        processingFeeRate: parseFloat(form.processingFeeRate) || 0,
        insuranceFeeRate: parseFloat(form.insuranceFeeRate) || 0, applicationFeeRate: parseFloat(form.applicationFeeRate) || 0,
      },
      compulsorySavingsRate: parseFloat(form.compulsorySavingsRate) || 0,
      minimumShares: parseFloat(form.minimumShares) || 0, isActive: form.isActive,
    };
    setLoanProducts(prev => [...prev, newProduct]);
    setForm(emptyForm);
    setShowAddForm(false);
    toast({ title: 'Product Added', description: `${newProduct.name} has been created.` });
  };

  const handleUpdateProduct = (id: string) => {
    setLoanProducts(prev => prev.map(p => {
      if (p.id !== id) return p;
      return {
        ...p, name: form.name, interestRate: parseFloat(form.interestRate) || 0,
        maxTerm: parseInt(form.maxTerm) || 12, minAmount: parseFloat(form.minAmount) || 0,
        maxAmount: parseFloat(form.maxAmount) || 0, interestBasis: form.interestBasis,
        fees: {
          formFee: parseFloat(form.formFee) || 0,
          monitoringFee: parseFloat(form.monitoringFee) || 0,
          processingFeeRate: parseFloat(form.processingFeeRate) || 0,
          insuranceFeeRate: parseFloat(form.insuranceFeeRate) || 0, applicationFeeRate: parseFloat(form.applicationFeeRate) || 0,
        },
        compulsorySavingsRate: parseFloat(form.compulsorySavingsRate) || 0,
        minimumShares: parseFloat(form.minimumShares) || 0, isActive: form.isActive,
      };
    }));
    setEditingProduct(null);
    toast({ title: 'Product Updated', description: `${form.name} has been updated.` });
  };

  const handleDeleteProduct = (id: string) => {
    const product = loanProducts.find(p => p.id === id);
    const activeLoans = loans.filter(l => l.loanType === product?.name && ['pending', 'approved', 'disbursed'].includes(l.status));
    if (activeLoans.length > 0) {
      toast({ title: 'Cannot Delete', description: `${product?.name} has ${activeLoans.length} active loan(s). Deactivate instead.` });
      return;
    }
    setLoanProducts(prev => prev.filter(p => p.id !== id));
    toast({ title: 'Product Deleted', description: `${product?.name} has been removed.` });
  };

  const toggleProductActive = (id: string) => {
    setLoanProducts(prev => prev.map(p => p.id === id ? { ...p, isActive: !p.isActive } : p));
    const product = loanProducts.find(p => p.id === id);
    toast({ title: product?.isActive ? 'Product Deactivated' : 'Product Activated', description: `${product?.name} status changed.` });
  };

  // ============ PROVISIONING HANDLERS ============
  const handleProvisionRateChange = (id: string, field: 'oldRate' | 'newRate', value: string) => {
    setProvisioningConfig(prev => ({
      ...prev,
      rates: prev.rates.map(r => r.id === id ? { ...r, [field]: parseFloat(value) || 0 } : r),
    }));
  };

  const handleProvisionChoiceChange = (choice: 'old' | 'new') => {
    setProvisioningConfig(prev => ({ ...prev, provisionChoice: choice }));
    toast({ title: 'Provision Policy Updated', description: `Now using ${choice === 'new' ? 'New' : 'Old'} provision rates.` });
  };

  const handleGeneralProvisionChange = (type: 'old' | 'new', value: string) => {
    setProvisioningConfig(prev => ({
      ...prev,
      [type === 'old' ? 'generalProvisionOld' : 'generalProvisionNew']: parseFloat(value) || 0,
    }));
  };

  // ============ PRODUCT FORM COMPONENT ============
  const renderProductForm = (isEditing: boolean, productId?: string) => (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="bg-gradient-to-r from-emerald-50 to-teal-50 px-6 py-4 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          {isEditing ? <Pencil size={16} /> : <Plus size={16} />}
          {isEditing ? 'Edit Loan Product' : 'Add New Loan Product'}
        </h3>
      </div>
      <div className="p-6 space-y-6">
        {/* Basic Info */}
        <div>
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Basic Information</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Product Name</label>
              <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500" placeholder="e.g. Normal Loan" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Interest Rate (% p.a.)</label>
              <input type="number" step="0.5" value={form.interestRate} onChange={e => setForm(p => ({ ...p, interestRate: e.target.value }))}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Max Term (Months)</label>
              <input type="number" value={form.maxTerm} onChange={e => setForm(p => ({ ...p, maxTerm: e.target.value }))}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Interest Basis</label>
              <select value={form.interestBasis} onChange={e => setForm(p => ({ ...p, interestBasis: e.target.value as 'flat' | 'declining' }))}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500">
                <option value="declining">Declining Balance</option>
                <option value="flat">Flat Rate</option>
              </select>
            </div>
          </div>
        </div>

        {/* Amount Limits */}
        <div>
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Amount Limits</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Minimum Amount (UGX)</label>
              <input type="number" value={form.minAmount} onChange={e => setForm(p => ({ ...p, minAmount: e.target.value }))}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Maximum Amount (UGX)</label>
              <input type="number" value={form.maxAmount} onChange={e => setForm(p => ({ ...p, maxAmount: e.target.value }))}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
          </div>
        </div>

        {/* Fees */}
        <div>
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Loan Fees</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Loan Form Fee (UGX)</label>
              <input type="number" value={form.formFee} onChange={e => setForm(p => ({ ...p, formFee: e.target.value }))}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Monitoring fee (UGX)</label>
              <input type="number" min={0} value={form.monitoringFee} onChange={e => setForm(p => ({ ...p, monitoringFee: e.target.value }))}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
              <p className="text-[10px] text-slate-400 mt-0.5">Deducted upfront</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Processing Fee (%)</label>
              <input type="number" step="0.1" value={form.processingFeeRate} onChange={e => setForm(p => ({ ...p, processingFeeRate: e.target.value }))}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
              <p className="text-[10px] text-slate-400 mt-0.5">% of amount disbursed</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Insurance Fee (%)</label>
              <input type="number" step="0.1" value={form.insuranceFeeRate} onChange={e => setForm(p => ({ ...p, insuranceFeeRate: e.target.value }))}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
              <p className="text-[10px] text-slate-400 mt-0.5">% of loan amount</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Application Fee (%)</label>
              <input type="number" step="0.1" value={form.applicationFeeRate} onChange={e => setForm(p => ({ ...p, applicationFeeRate: e.target.value }))}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
              <p className="text-[10px] text-slate-400 mt-0.5">% of loan amount</p>
            </div>
          </div>
        </div>

        {/* Requirements */}
        <div>
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Member Requirements</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Compulsory Savings (%)</label>
              <input type="number" step="0.5" value={form.compulsorySavingsRate} onChange={e => setForm(p => ({ ...p, compulsorySavingsRate: e.target.value }))}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
              <p className="text-[10px] text-slate-400 mt-0.5">% of loan amount required in savings before disbursement</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Minimum Shares (UGX)</label>
              <input type="number" value={form.minimumShares} onChange={e => setForm(p => ({ ...p, minimumShares: e.target.value }))}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
              <p className="text-[10px] text-slate-400 mt-0.5">Minimum shares balance required to qualify</p>
            </div>
          </div>
        </div>

        {/* Active Toggle */}
        <div className="flex items-center gap-3">
          <button onClick={() => setForm(p => ({ ...p, isActive: !p.isActive }))}
            className={`relative w-11 h-6 rounded-full transition-colors ${form.isActive ? 'bg-emerald-500' : 'bg-slate-300'}`}>
            <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.isActive ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
          <span className="text-sm text-slate-700">{form.isActive ? 'Active' : 'Inactive'}</span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-4 border-t border-slate-100">
          {isEditing ? (
            <>
              <button onClick={() => handleUpdateProduct(productId!)}
                className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700">
                <Save size={14} /> Save Changes
              </button>
              <button onClick={() => setEditingProduct(null)}
                className="flex items-center gap-2 px-5 py-2.5 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-slate-50">
                <X size={14} /> Cancel
              </button>
            </>
          ) : (
            <>
              <button onClick={handleAddProduct}
                className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700">
                <Plus size={14} /> Add Product
              </button>
              <button onClick={() => { setShowAddForm(false); setForm(emptyForm); }}
                className="flex items-center gap-2 px-5 py-2.5 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-slate-50">
                <X size={14} /> Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  // ============ RENDER ============
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-900">Loan Settings</h1>
          <PageNotes ariaLabel="Loan settings help">
            <p>Configure loan products, fees, interest basis, and provisioning parameters.</p>
          </PageNotes>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        {[
          { id: 'products' as const, label: 'Loan Products & Fees', icon: <CreditCard size={16} /> },
          { id: 'provisioning' as const, label: 'Loan Provisioning', icon: <Shield size={16} /> },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-all ${
              activeTab === tab.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ============ PRODUCTS TAB ============ */}
      {activeTab === 'products' && (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <p className="text-xs text-slate-500 mb-1">Total Products</p>
              <p className="text-2xl font-bold text-slate-900">{loanProducts.length}</p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <p className="text-xs text-slate-500 mb-1">Active Products</p>
              <p className="text-2xl font-bold text-emerald-600">{loanProducts.filter(p => p.isActive).length}</p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <p className="text-xs text-slate-500 mb-1">Flat Rate Products</p>
              <p className="text-2xl font-bold text-blue-600">{loanProducts.filter(p => p.interestBasis === 'flat').length}</p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <p className="text-xs text-slate-500 mb-1">Declining Balance</p>
              <p className="text-2xl font-bold text-violet-600">{loanProducts.filter(p => p.interestBasis === 'declining').length}</p>
            </div>
          </div>

          {/* Interest Basis Info */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-5 border border-blue-100">
            <div className="flex items-start gap-3">
              <Info size={18} className="text-blue-600 mt-0.5 flex-shrink-0" />
              <div>
                <h4 className="text-sm font-semibold text-blue-900 mb-1">Interest Calculation Methods</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
                  <div className="bg-white/60 rounded-lg p-3">
                    <p className="text-xs font-semibold text-blue-800 mb-1">Flat Rate</p>
                    <p className="text-xs text-blue-700">Interest is calculated on the original loan amount for the entire term. Monthly payment = (Principal + Total Interest) / Term. Higher total interest cost.</p>
                  </div>
                  <div className="bg-white/60 rounded-lg p-3">
                    <p className="text-xs font-semibold text-indigo-800 mb-1">Declining Balance (Reducing)</p>
                    <p className="text-xs text-indigo-700">Interest is calculated on the outstanding balance each month. As principal reduces, interest reduces too. Lower total interest cost for borrower.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Add Button */}
          {!showAddForm && !editingProduct && (
            <button onClick={() => { setShowAddForm(true); setForm(emptyForm); }}
              className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 shadow-sm">
              <Plus size={16} /> Add Loan Product
            </button>
          )}

          {/* Add Form */}
          {showAddForm && !editingProduct && renderProductForm(false)}

          {/* Product List */}
          <div className="space-y-4">
            {loanProducts.map(product => {
              const isEditing = editingProduct === product.id;
              const isExpanded = expandedProduct === product.id;
              const productLoans = loans.filter(l => l.loanType === product.name);
              const activeLoansCount = productLoans.filter(l => ['pending', 'approved', 'disbursed'].includes(l.status)).length;
              const totalDisbursed = productLoans.filter(l => l.status === 'disbursed').reduce((s, l) => s + l.amount, 0);

              if (isEditing) return <div key={product.id}>{renderProductForm(true, product.id)}</div>;

              return (
                <div key={product.id} className={`bg-white rounded-xl shadow-sm border overflow-hidden transition-all ${product.isActive ? 'border-slate-100' : 'border-orange-200 bg-orange-50/30'}`}>
                  {/* Header */}
                  <div className="p-5">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${product.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-600'}`}>
                          <CreditCard size={22} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-base font-semibold text-slate-900">{product.name}</h3>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${product.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700'}`}>
                              {product.isActive ? 'Active' : 'Inactive'}
                            </span>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${product.interestBasis === 'flat' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'}`}>
                              {product.interestBasis === 'flat' ? 'Flat Rate' : 'Declining Balance'}
                            </span>
                          </div>
                          <p className="text-sm text-slate-500">{product.interestRate}% p.a. | Max {product.maxTerm} months | {activeLoansCount} active loans</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => { setEditingProduct(product.id); setForm(productToForm(product)); setShowAddForm(false); }}
                          className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg border border-slate-200">
                          <Pencil size={14} /> Edit
                        </button>
                        <button onClick={() => toggleProductActive(product.id)}
                          className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border ${product.isActive ? 'text-orange-600 hover:bg-orange-50 border-orange-200' : 'text-emerald-600 hover:bg-emerald-50 border-emerald-200'}`}>
                          {product.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                        <button onClick={() => handleDeleteProduct(product.id)}
                          className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg border border-red-200">
                          <Trash2 size={14} />
                        </button>
                        <button onClick={() => setExpandedProduct(isExpanded ? null : product.id)}
                          className="p-2 text-slate-400 hover:bg-slate-100 rounded-lg">
                          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                      </div>
                    </div>

                    {/* Quick Stats */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 mt-4">
                      <div className="p-2.5 bg-slate-50 rounded-lg">
                        <p className="text-[10px] text-slate-400 uppercase">Form Fee</p>
                        <p className="text-sm font-semibold text-slate-900">{formatCurrency(product.fees.formFee)}</p>
                      </div>
                      <div className="p-2.5 bg-slate-50 rounded-lg">
                        <p className="text-[10px] text-slate-400 uppercase">Monitoring</p>
                        <p className="text-sm font-semibold text-slate-900">{formatCurrency(product.fees.monitoringFee ?? 0)}</p>
                      </div>
                      <div className="p-2.5 bg-slate-50 rounded-lg">
                        <p className="text-[10px] text-slate-400 uppercase">Processing</p>
                        <p className="text-sm font-semibold text-slate-900">{product.fees.processingFeeRate}%</p>
                      </div>
                      <div className="p-2.5 bg-slate-50 rounded-lg">
                        <p className="text-[10px] text-slate-400 uppercase">Insurance</p>
                        <p className="text-sm font-semibold text-slate-900">{product.fees.insuranceFeeRate}%</p>
                      </div>
                      <div className="p-2.5 bg-slate-50 rounded-lg">
                        <p className="text-[10px] text-slate-400 uppercase">Application</p>
                        <p className="text-sm font-semibold text-slate-900">{product.fees.applicationFeeRate}%</p>
                      </div>
                      <div className="p-2.5 bg-emerald-50 rounded-lg">
                        <p className="text-[10px] text-emerald-600 uppercase">Comp. Savings</p>
                        <p className="text-sm font-semibold text-emerald-700">{product.compulsorySavingsRate}%</p>
                      </div>
                      <div className="p-2.5 bg-blue-50 rounded-lg">
                        <p className="text-[10px] text-blue-600 uppercase">Min. Shares</p>
                        <p className="text-sm font-semibold text-blue-700">{formatCurrency(product.minimumShares)}</p>
                      </div>
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="border-t border-slate-100 bg-slate-50/50 p-5">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        {/* Fee Example */}
                        <div>
                          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Fee Example (UGX 1,000,000 Loan)</h4>
                          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                            <table className="w-full">
                              <tbody className="divide-y divide-slate-100">
                                <tr><td className="px-3 py-2 text-xs text-slate-600">Loan Form Fee</td><td className="px-3 py-2 text-xs font-medium text-right">{formatCurrency(product.fees.formFee)}</td></tr>
                                <tr><td className="px-3 py-2 text-xs text-slate-600">Monitoring fee (upfront)</td><td className="px-3 py-2 text-xs font-medium text-right">{formatCurrency(product.fees.monitoringFee ?? 0)}</td></tr>
                                <tr><td className="px-3 py-2 text-xs text-slate-600">Processing Fee ({product.fees.processingFeeRate}%)</td><td className="px-3 py-2 text-xs font-medium text-right">{formatCurrency(1000000 * product.fees.processingFeeRate / 100)}</td></tr>
                                <tr><td className="px-3 py-2 text-xs text-slate-600">Insurance ({product.fees.insuranceFeeRate}%)</td><td className="px-3 py-2 text-xs font-medium text-right">{formatCurrency(1000000 * product.fees.insuranceFeeRate / 100)}</td></tr>
                                <tr><td className="px-3 py-2 text-xs text-slate-600">Application Fee ({product.fees.applicationFeeRate}%)</td><td className="px-3 py-2 text-xs font-medium text-right">{formatCurrency(1000000 * product.fees.applicationFeeRate / 100)}</td></tr>
                                <tr className="bg-slate-50 font-semibold">
                                  <td className="px-3 py-2 text-xs text-slate-900">Total Fees</td>
                                  <td className="px-3 py-2 text-xs text-right text-red-600">
                                    {formatCurrency(
                                      product.fees.formFee +
                                        (product.fees.monitoringFee ?? 0) +
                                        1000000 * (product.fees.processingFeeRate + product.fees.insuranceFeeRate + product.fees.applicationFeeRate) / 100
                                    )}
                                  </td>
                                </tr>
                                <tr className="bg-emerald-50 font-semibold">
                                  <td className="px-3 py-2 text-xs text-emerald-800">Net Disbursement</td>
                                  <td className="px-3 py-2 text-xs text-right text-emerald-700">
                                    {formatCurrency(
                                      1000000 -
                                        product.fees.formFee -
                                        (product.fees.monitoringFee ?? 0) -
                                        1000000 * (product.fees.processingFeeRate + product.fees.insuranceFeeRate + product.fees.applicationFeeRate) / 100
                                    )}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {/* Requirements & Stats */}
                        <div>
                          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Requirements & Portfolio</h4>
                          <div className="space-y-3">
                            <div className="bg-white rounded-lg border border-slate-200 p-3 flex items-center gap-3">
                              <PiggyBank size={18} className="text-emerald-600" />
                              <div>
                                <p className="text-xs text-slate-500">Compulsory Savings</p>
                                <p className="text-sm font-medium">{product.compulsorySavingsRate}% of loan amount must be in savings</p>
                              </div>
                            </div>
                            <div className="bg-white rounded-lg border border-slate-200 p-3 flex items-center gap-3">
                              <Percent size={18} className="text-blue-600" />
                              <div>
                                <p className="text-xs text-slate-500">Minimum Shares</p>
                                <p className="text-sm font-medium">{formatCurrency(product.minimumShares)} shares balance required</p>
                              </div>
                            </div>
                            <div className="bg-white rounded-lg border border-slate-200 p-3 flex items-center gap-3">
                              <CreditCard size={18} className="text-violet-600" />
                              <div>
                                <p className="text-xs text-slate-500">Portfolio</p>
                                <p className="text-sm font-medium">{activeLoansCount} active loans | {formatCurrency(totalDisbursed)} disbursed</p>
                              </div>
                            </div>
                            <div className="bg-white rounded-lg border border-slate-200 p-3 flex items-center gap-3">
                              <Settings size={18} className="text-slate-500" />
                              <div>
                                <p className="text-xs text-slate-500">Amount Range</p>
                                <p className="text-sm font-medium">{formatCurrency(product.minAmount)} - {formatCurrency(product.maxAmount)}</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ============ PROVISIONING TAB ============ */}
      {activeTab === 'provisioning' && (
        <div className="space-y-6">
          {/* Info Banner */}
          <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl p-5 border border-amber-100">
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="text-amber-600 mt-0.5 flex-shrink-0" />
              <div>
                <h4 className="text-sm font-semibold text-amber-900 mb-1">Loan Loss Provisioning</h4>
                <p className="text-xs text-amber-700">
                  Loan provisioning is the amount set aside to cover potential loan losses. The provision rate increases with the number of days a loan is in arrears.
                  You can choose between the Old and New provision rate schedules below.
                </p>
              </div>
            </div>
          </div>

          {/* Choice Selector */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900 mb-4">Active Provision Policy</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {(['old', 'new'] as const).map(choice => (
                <button key={choice} onClick={() => handleProvisionChoiceChange(choice)}
                  className={`p-4 rounded-xl border-2 text-left transition-all ${
                    provisioningConfig.provisionChoice === choice
                      ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-100'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-slate-900">{choice === 'old' ? 'Old Policy' : 'New Policy'}</span>
                    {provisioningConfig.provisionChoice === choice && (
                      <CheckCircle size={18} className="text-emerald-600" />
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    {choice === 'old'
                      ? 'Traditional provision rates with higher percentages for early arrears.'
                      : 'Revised provision rates with lower early-stage provisions.'}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    General Provision: {choice === 'old' ? provisioningConfig.generalProvisionOld : provisioningConfig.generalProvisionNew}%
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* Provisioning Table */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-slate-100">
              <h3 className="text-sm font-semibold text-slate-900">Loan Loss Provision Rates</h3>
              <p className="text-xs text-slate-500 mt-0.5">Edit the rates below. Changes are applied immediately.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">Days in Arrears</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600 uppercase">Old Rate (%)</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600 uppercase">New Rate (%)</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600 uppercase">
                      Active Rate (%)
                      <span className="block text-[10px] font-normal normal-case text-slate-400">
                        Using: {provisioningConfig.provisionChoice === 'new' ? 'New' : 'Old'}
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {provisioningConfig.rates.map((rate) => {
                    const activeRate = provisioningConfig.provisionChoice === 'new' ? rate.newRate : rate.oldRate;
                    const severity = activeRate >= 75 ? 'bg-red-50 text-red-700' : activeRate >= 25 ? 'bg-amber-50 text-amber-700' : activeRate >= 5 ? 'bg-yellow-50 text-yellow-700' : 'bg-emerald-50 text-emerald-700';
                    return (
                      <tr key={rate.id} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3">
                          <span className="text-sm font-medium text-slate-900">{rate.label}</span>
                          <span className="block text-[10px] text-slate-400">
                            {rate.daysTo === 99999 ? `${rate.daysFrom}+ days` : rate.daysFrom === rate.daysTo ? `${rate.daysFrom} days` : `${rate.daysFrom}-${rate.daysTo} days`}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <input type="number" min="0" max="100" step="1"
                            value={rate.oldRate}
                            onChange={e => handleProvisionRateChange(rate.id, 'oldRate', e.target.value)}
                            className={`w-20 px-2 py-1.5 border rounded-lg text-sm text-center outline-none focus:ring-2 focus:ring-emerald-500 ${
                              provisioningConfig.provisionChoice === 'old' ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200'
                            }`} />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <input type="number" min="0" max="100" step="1"
                            value={rate.newRate}
                            onChange={e => handleProvisionRateChange(rate.id, 'newRate', e.target.value)}
                            className={`w-20 px-2 py-1.5 border rounded-lg text-sm text-center outline-none focus:ring-2 focus:ring-emerald-500 ${
                              provisioningConfig.provisionChoice === 'new' ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200'
                            }`} />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex px-3 py-1 rounded-full text-sm font-bold ${severity}`}>
                            {activeRate}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 border-t-2 border-slate-200">
                    <td className="px-4 py-3 text-sm font-semibold text-slate-900">General Provision</td>
                    <td className="px-4 py-3 text-center">
                      <input type="number" min="0" max="100" step="0.5"
                        value={provisioningConfig.generalProvisionOld}
                        onChange={e => handleGeneralProvisionChange('old', e.target.value)}
                        className={`w-20 px-2 py-1.5 border rounded-lg text-sm text-center outline-none focus:ring-2 focus:ring-emerald-500 ${
                          provisioningConfig.provisionChoice === 'old' ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200'
                        }`} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <input type="number" min="0" max="100" step="0.5"
                        value={provisioningConfig.generalProvisionNew}
                        onChange={e => handleGeneralProvisionChange('new', e.target.value)}
                        className={`w-20 px-2 py-1.5 border rounded-lg text-sm text-center outline-none focus:ring-2 focus:ring-emerald-500 ${
                          provisioningConfig.provisionChoice === 'new' ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200'
                        }`} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex px-3 py-1 rounded-full text-sm font-bold bg-slate-100 text-slate-700">
                        {provisioningConfig.provisionChoice === 'new' ? provisioningConfig.generalProvisionNew : provisioningConfig.generalProvisionOld}%
                      </span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Provision Calculation Preview */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900 mb-4">Portfolio Provision Estimate</h3>
            <p className="text-xs text-slate-500 mb-4">Based on current disbursed loans and active provision policy ({provisioningConfig.provisionChoice === 'new' ? 'New' : 'Old'} rates)</p>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-600">Loan ID</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-600">Member</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold text-slate-600">Outstanding</th>
                    <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-600">Days in Arrears</th>
                    <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-600">Provision Rate</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold text-slate-600">Provision Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {loans.filter(l => l.status === 'disbursed').map(loan => {
                    // Simulate days in arrears
                    const daysInArrears = Math.floor(Math.random() * 60);
                    const applicableRate = provisioningConfig.rates.find(r => daysInArrears >= r.daysFrom && daysInArrears <= r.daysTo);
                    const rate = applicableRate ? (provisioningConfig.provisionChoice === 'new' ? applicableRate.newRate : applicableRate.oldRate) : 0;
                    const provisionAmount = Math.round(loan.balance * rate / 100);
                    return (
                      <tr key={loan.id} className="hover:bg-slate-50/50">
                        <td className="px-3 py-2.5 text-sm font-mono">{loan.id}</td>
                        <td className="px-3 py-2.5 text-sm">{loan.memberName}</td>
                        <td className="px-3 py-2.5 text-sm text-right font-medium">{formatCurrency(loan.balance)}</td>
                        <td className="px-3 py-2.5 text-sm text-center">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            daysInArrears === 0 ? 'bg-emerald-100 text-emerald-700' :
                            daysInArrears <= 30 ? 'bg-yellow-100 text-yellow-700' :
                            daysInArrears <= 60 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                          }`}>
                            {daysInArrears}d
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-sm text-center font-medium">{rate}%</td>
                        <td className="px-3 py-2.5 text-sm text-right font-medium text-red-600">{formatCurrency(provisionAmount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 border-t-2 border-slate-200">
                    <td colSpan={2} className="px-3 py-3 text-sm font-bold">Total</td>
                    <td className="px-3 py-3 text-sm text-right font-bold">
                      {formatCurrency(loans.filter(l => l.status === 'disbursed').reduce((s, l) => s + l.balance, 0))}
                    </td>
                    <td colSpan={2}></td>
                    <td className="px-3 py-3 text-sm text-right font-bold text-red-600">
                      {formatCurrency(
                        loans.filter(l => l.status === 'disbursed').reduce((s, loan) => {
                          const daysInArrears = Math.floor(Math.random() * 60);
                          const applicableRate = provisioningConfig.rates.find(r => daysInArrears >= r.daysFrom && daysInArrears <= r.daysTo);
                          const rate = applicableRate ? (provisioningConfig.provisionChoice === 'new' ? applicableRate.newRate : applicableRate.oldRate) : 0;
                          return s + Math.round(loan.balance * rate / 100);
                        }, 0)
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LoanSettings;
