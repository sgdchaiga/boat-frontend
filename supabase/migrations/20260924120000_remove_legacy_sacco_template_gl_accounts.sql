-- Before chart selection became explicit, the standard setup migration added a
-- generic chart to every organization. SACCOs with an existing chart ended up
-- with both their own accounts and those generic template rows.
--
-- This one-time cleanup affects only SACCOs that have evidence of a separate
-- chart. It never removes posted accounts or accounts still selected in the GL
-- settings. If another later feature has a restrictive foreign key to an
-- otherwise unused template row, the row is kept but made inactive instead.

DO $$
DECLARE
  candidate record;
BEGIN
  FOR candidate IN
    WITH generic_template_accounts(account_code, account_name) AS (
      VALUES
        ('1000', 'Assets'), ('1100', 'Current Assets'), ('1110', 'Cash on Hand'),
        ('1120', 'Bank Account - Main'), ('1130', 'Mobile Money Account'),
        ('1140', 'Accounts Receivable'), ('1150', 'Inventory'), ('1160', 'Prepayments'),
        ('1170', 'Work in Progress'), ('1171', 'Raw Materials Inventory'),
        ('1172', 'Finished Goods Inventory'), ('1173', 'Packaging Materials Inventory'),
        ('1174', 'Consumables Inventory'), ('1175', 'Spare Parts Inventory'),
        ('1176', 'Semi-Finished Goods Inventory'), ('1200', 'Non-Current Assets'),
        ('1210', 'Furniture & Fittings'), ('1220', 'Plant & Equipment'),
        ('1230', 'Motor Vehicles'), ('1240', 'Accumulated Depreciation'),
        ('1250', 'Factory Buildings'), ('2000', 'Liabilities'),
        ('2100', 'Current Liabilities'), ('2110', 'Accounts Payable'),
        ('2120', 'Customer Deposits'), ('2130', 'Taxes Payable'),
        ('2140', 'Wages Payable'), ('2150', 'Wallet / Member Deposits Payable'),
        ('2200', 'Long-Term Liabilities'), ('3000', 'Equity'),
        ('3100', 'Owner Capital'), ('3200', 'Retained Earnings'),
        ('3300', 'Drawings / Distributions'), ('4000', 'Revenue'),
        ('4100', 'Sales / Service Revenue'), ('4110', 'Rooms Revenue'),
        ('4120', 'Food & Beverage Revenue'), ('4130', 'School Fees Revenue'),
        ('4140', 'Interest & Fee Income'), ('4150', 'Clinic Service Revenue'),
        ('4160', 'Product Sales'), ('4161', 'Manufacturing Service Income'),
        ('4162', 'Scrap Sales'), ('4200', 'Other Income'),
        ('4290', 'Inventory Variance Gain'), ('5000', 'Cost of Sales'),
        ('5100', 'Cost of Goods Sold'), ('5110', 'Food Cost of Sales'),
        ('5120', 'Beverage Cost of Sales'), ('5130', 'Manufacturing Cost of Sales'),
        ('5131', 'COGS - Raw Material Cost'), ('5132', 'COGS - Direct Labour'),
        ('5133', 'COGS - Manufacturing Overhead'), ('5134', 'COGS - Packaging Cost'),
        ('5135', 'COGS - Freight In'), ('5136', 'COGS - Production Variances'),
        ('6000', 'Operating Expenses'), ('6100', 'Salaries & Wages'),
        ('6200', 'Rent Expense'), ('6300', 'Utilities'), ('6400', 'Bank Charges'),
        ('6500', 'Transport & Delivery'), ('6600', 'Advertising & Promotion'),
        ('6700', 'Depreciation Expense'), ('6800', 'Factory Overhead Applied'),
        ('6810', 'Factory Electricity'), ('6811', 'Factory Water'),
        ('6812', 'Factory Rent'), ('6813', 'Factory Security'),
        ('6814', 'Factory Maintenance'), ('6815', 'Factory Fuel'),
        ('6816', 'Factory Cleaning'), ('6817', 'Factory Depreciation'),
        ('6818', 'Production Supervisor Salaries'), ('6819', 'Quality Control Costs'),
        ('6900', 'Allocated Department Overheads'), ('8000', 'Inventory Loss / Shrinkage'),
        ('8010', 'Damaged Goods Expense'), ('8020', 'Expired Stock Expense'),
        ('8030', 'Internal Consumption Expense')
    )
    SELECT account.id
    FROM public.gl_accounts AS account
    JOIN public.organizations AS organization ON organization.id = account.organization_id
    JOIN generic_template_accounts AS template
      ON template.account_code = account.account_code
     AND template.account_name = account.account_name
    WHERE lower(organization.business_type) = 'sacco'
      -- A non-template account proves this organization had a separate chart.
      AND EXISTS (
        SELECT 1
        FROM public.gl_accounts AS existing_account
        LEFT JOIN generic_template_accounts AS existing_template
          ON existing_template.account_code = existing_account.account_code
         AND existing_template.account_name = existing_account.account_name
        WHERE existing_account.organization_id = account.organization_id
          AND existing_template.account_code IS NULL
      )
      -- Never alter the chart behind an already posted journal line.
      AND NOT EXISTS (
        SELECT 1 FROM public.journal_entry_lines AS line
        WHERE line.gl_account_id = account.id
      )
      -- Retain an account selected in any GL setting; replacing it needs an
      -- organization-specific accounting decision, not an automatic deletion.
      AND NOT EXISTS (
        SELECT 1
        FROM public.journal_gl_settings AS settings
        CROSS JOIN LATERAL jsonb_each_text(to_jsonb(settings)) AS setting(key, value)
        WHERE setting.value = account.id::text
      )
  LOOP
    BEGIN
      DELETE FROM public.gl_accounts WHERE id = candidate.id;
    EXCEPTION
      WHEN foreign_key_violation THEN
        UPDATE public.gl_accounts SET is_active = false WHERE id = candidate.id;
    END;
  END LOOP;
END $$;
