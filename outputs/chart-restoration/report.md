# Chart of accounts restoration — 7 September 2026

Production deployment: b4f0703. The two chart migrations are applied. Existing organizations are protected from automatic template additions. New organizations can upload CSV/Excel or adopt the business template.

The 9 July 2026 template batch inserted 1,300 accounts across 19 organizations. Twelve organizations had established charts (36–123 accounts) before that batch. Of their 742 additions, 434 unreferenced accounts are now inactive (181 newly deactivated; the remainder were already inactive). 308 referenced accounts were preserved unchanged. Original account IDs, names and active/inactive choices were preserved. No journal entries were changed or deleted.

## Organizations

| Organization | Unused additions inactive | Newly deactivated | Retained references |
|---|---:|---:|---:|
| BA Shop | 30 | 8 | 11 |
| Default property | 26 | 3 | 8 |
| Example Factory | 24 | 20 | 31 |
| Example Sacco | 38 | 15 | 42 |
| Geolly Investments Limited | 38 | 15 | 37 |
| GIL Country Inn | 42 | 16 | 33 |
| GIL Demo_Inn | 48 | 22 | 27 |
| GIL Medical Services | 48 | 25 | 28 |
| Kira Trial Shop | 27 | 6 | 9 |
| Oscod Sacco | 46 | 23 | 34 |
| SteelHaven Co. Ltd | 23 | 12 | 22 |
| TTIMMS Hotel | 44 | 16 | 26 |

## Restoration still required

Full restoration requires identifying the original replacement account for each retained addition before changing its configuration or postings. References include account hierarchies, journal settings, products, allocation rules, expenses and journal entries. The nine accounts with journal entries are listed first below. Some references may be only to inactive child accounts or unused template settings; these can be reviewed without moving posted amounts.

### Added accounts carrying journal entries

| Organization | Code | Added account | Journal lines |
|---|---|---|---:|
| TTIMMS Hotel | 5132 | COGS - Direct Labour | 1 |
| SteelHaven Co. Ltd | 6300 | Utilities | 2 |
| TTIMMS Hotel | 6000 | Operating Expenses | 4 |
| GIL Country Inn | 4120 | Food & Beverage Revenue | 1 |
| TTIMMS Hotel | 8020 | Expired Stock Expense | 1 |
| GIL Country Inn | 8000 | Inventory Loss / Shrinkage | 22 |
| TTIMMS Hotel | 8000 | Inventory Loss / Shrinkage | 5 |
| GIL Country Inn | 4210 | Inventory Variance Gain | 10 |
| SteelHaven Co. Ltd | 1120 | Bank Account - Main | 234 |
| SteelHaven Co. Ltd | 1171 | Raw Materials Inventory | 2 |

### Organizations needing original-chart evidence

Example Shop had only “4010 Sales”; Tuyige Secondary School had only “5010 Student Welfare”; Example Hotel 2 had only “4110 Bar Sales” and “4120 Kitchen Sales” before the batch. These sparse records do not establish a complete original chart, so their accounts were retained. Organizations with no pre-batch chart, and organizations created after the batch, were not stripped of their initial templates. All existing organizations are protected against future automatic template additions.

### All retained references

| Organization | Code | Account | References |
|---|---|---|---|
| BA Shop | 1170 | Work in Progress | journal_gl_settings.manufacturing_wip_gl_account_id (1); journal_gl_settings.stock_adjustment_work_in_progress_gl_account_id (1) |
| BA Shop | 1171 | Raw Materials Inventory | journal_gl_settings.manufacturing_raw_materials_gl_account_id (1); journal_gl_settings.stock_adjustment_raw_materials_inventory_gl_account_id (1) |
| BA Shop | 1172 | Finished Goods Inventory | journal_gl_settings.manufacturing_finished_goods_gl_account_id (1); journal_gl_settings.stock_adjustment_finished_goods_inventory_gl_account_id (1) |
| BA Shop | 4210 | Inventory Variance Gain | journal_gl_settings.stock_adjustment_inventory_variance_gain_gl_account_id (1) |
| BA Shop | 5100 | Cost of Goods Sold | journal_gl_settings.pos_cogs_room_gl_account_id (1) |
| BA Shop | 5130 | Manufacturing Cost of Sales | gl_accounts.parent_id (6) |
| BA Shop | 6800 | Factory Overhead Applied | journal_gl_settings.manufacturing_overhead_gl_account_id (1) |
| BA Shop | 6900 | Allocated Department Overheads | cost_allocation_rules.debit_gl_account_id (6) |
| BA Shop | 8010 | Damaged Goods Expense | journal_gl_settings.stock_adjustment_damaged_goods_expense_gl_account_id (1) |
| BA Shop | 8020 | Expired Stock Expense | journal_gl_settings.stock_adjustment_expired_stock_expense_gl_account_id (1) |
| BA Shop | 8030 | Internal Consumption Expense | journal_gl_settings.manufacturing_consumables_expense_gl_account_id (1); journal_gl_settings.stock_adjustment_internal_consumption_expense_gl_account_id (1) |
| Default property | 1171 | Raw Materials Inventory | journal_gl_settings.manufacturing_raw_materials_gl_account_id (1); journal_gl_settings.stock_adjustment_raw_materials_inventory_gl_account_id (1) |
| Default property | 1172 | Finished Goods Inventory | journal_gl_settings.manufacturing_finished_goods_gl_account_id (1); journal_gl_settings.stock_adjustment_finished_goods_inventory_gl_account_id (1) |
| Default property | 2150 | Wallet / Member Deposits Payable | journal_gl_settings.wallet_liability_gl_account_id (1) |
| Default property | 4210 | Inventory Variance Gain | journal_gl_settings.stock_adjustment_inventory_variance_gain_gl_account_id (1) |
| Default property | 5130 | Manufacturing Cost of Sales | gl_accounts.parent_id (6) |
| Default property | 8010 | Damaged Goods Expense | journal_gl_settings.stock_adjustment_damaged_goods_expense_gl_account_id (1) |
| Default property | 8020 | Expired Stock Expense | journal_gl_settings.stock_adjustment_expired_stock_expense_gl_account_id (1) |
| Default property | 8030 | Internal Consumption Expense | journal_gl_settings.manufacturing_consumables_expense_gl_account_id (1); journal_gl_settings.stock_adjustment_internal_consumption_expense_gl_account_id (1) |
| Example Factory | 1000 | Assets | gl_accounts.parent_id (2) |
| Example Factory | 1100 | Current Assets | gl_accounts.parent_id (9) |
| Example Factory | 1120 | Bank Account - Main | journal_gl_settings.wallet_clearing_gl_account_id (1) |
| Example Factory | 1170 | Work in Progress | journal_gl_settings.stock_adjustment_work_in_progress_gl_account_id (1) |
| Example Factory | 1171 | Raw Materials Inventory | journal_gl_settings.manufacturing_raw_materials_gl_account_id (1); journal_gl_settings.stock_adjustment_raw_materials_inventory_gl_account_id (1) |
| Example Factory | 1172 | Finished Goods Inventory | journal_gl_settings.pos_inventory_room_gl_account_id (1); journal_gl_settings.stock_adjustment_finished_goods_inventory_gl_account_id (1) |
| Example Factory | 1200 | Non-Current Assets | gl_accounts.parent_id (4) |
| Example Factory | 2000 | Liabilities | gl_accounts.parent_id (1) |
| Example Factory | 2140 | Wages Payable | journal_gl_settings.manufacturing_wages_payable_gl_account_id (1) |
| Example Factory | 2150 | Wallet / Member Deposits Payable | journal_gl_settings.wallet_liability_gl_account_id (1) |
| Example Factory | 3000 | Equity | gl_accounts.parent_id (3) |
| Example Factory | 3200 | Retained Earnings | journal_gl_settings.retained_earnings_gl_account_id (1) |
| Example Factory | 4000 | Revenue | gl_accounts.parent_id (8) |
| Example Factory | 4110 | Rooms Revenue | journal_gl_settings.pos_revenue_room_gl_account_id (1) |
| Example Factory | 4120 | Food & Beverage Revenue | journal_gl_settings.pos_revenue_bar_gl_account_id (1); journal_gl_settings.pos_revenue_kitchen_gl_account_id (1) |
| Example Factory | 4210 | Inventory Variance Gain | journal_gl_settings.stock_adjustment_inventory_variance_gain_gl_account_id (1) |
| Example Factory | 5000 | Cost of Sales | gl_accounts.parent_id (4) |
| Example Factory | 5100 | Cost of Goods Sold | journal_gl_settings.pos_cogs_room_gl_account_id (1) |
| Example Factory | 6000 | Operating Expenses | gl_accounts.parent_id (13) |
| Example Factory | 6100 | Salaries & Wages | cost_allocation_rules.expense_gl_account_id (1); journal_gl_settings.expense_gl_account_id (1) |
| Example Factory | 6200 | Rent Expense | cost_allocation_rules.expense_gl_account_id (1) |
| Example Factory | 6300 | Utilities | cost_allocation_rules.expense_gl_account_id (1) |
| Example Factory | 6500 | Transport & Delivery | cost_allocation_rules.expense_gl_account_id (1) |
| Example Factory | 6600 | Advertising & Promotion | cost_allocation_rules.expense_gl_account_id (1) |
| Example Factory | 6700 | Depreciation Expense | cost_allocation_rules.expense_gl_account_id (1) |
| Example Factory | 6800 | Factory Overhead Applied | journal_gl_settings.manufacturing_overhead_gl_account_id (1) |
| Example Factory | 6900 | Allocated Department Overheads | cost_allocation_rules.debit_gl_account_id (6) |
| Example Factory | 8000 | Inventory Loss / Shrinkage | journal_gl_settings.stock_adjustment_inventory_shrinkage_expense_gl_account_id (1); journal_gl_settings.stock_adjustment_inventory_variance_expense_gl_account_id (1) |
| Example Factory | 8010 | Damaged Goods Expense | journal_gl_settings.stock_adjustment_damaged_goods_expense_gl_account_id (1) |
| Example Factory | 8020 | Expired Stock Expense | journal_gl_settings.stock_adjustment_expired_stock_expense_gl_account_id (1) |
| Example Factory | 8030 | Internal Consumption Expense | journal_gl_settings.stock_adjustment_internal_consumption_expense_gl_account_id (1) |
| Example Sacco | 1000 | Assets | gl_accounts.parent_id (2) |
| Example Sacco | 1100 | Current Assets | gl_accounts.parent_id (13) |
| Example Sacco | 1120 | Bank Account - Main | journal_gl_settings.cash_gl_account_id (1); journal_gl_settings.pos_bank_gl_account_id (1); journal_gl_settings.wallet_clearing_gl_account_id (1) |
| Example Sacco | 1130 | Mobile Money Account | journal_gl_settings.pos_airtel_money_gl_account_id (1); journal_gl_settings.pos_mtn_mobile_money_gl_account_id (1) |
| Example Sacco | 1140 | Accounts Receivable | journal_gl_settings.receivable_gl_account_id (1) |
| Example Sacco | 1150 | Inventory | journal_gl_settings.manufacturing_scrap_inventory_gl_account_id (1); journal_gl_settings.pos_inventory_bar_gl_account_id (1); journal_gl_settings.pos_inventory_kitchen_gl_account_id (1); journal_gl_settings.pos_inventory_room_gl_account_id (1); journal_gl_settings.purchases_inventory_gl_account_id (1) |
| Example Sacco | 1170 | Work in Progress | journal_gl_settings.manufacturing_wip_gl_account_id (1); journal_gl_settings.stock_adjustment_work_in_progress_gl_account_id (1) |
| Example Sacco | 1171 | Raw Materials Inventory | journal_gl_settings.manufacturing_raw_materials_gl_account_id (1); journal_gl_settings.stock_adjustment_raw_materials_inventory_gl_account_id (1) |
| Example Sacco | 1172 | Finished Goods Inventory | journal_gl_settings.manufacturing_finished_goods_gl_account_id (1); journal_gl_settings.stock_adjustment_finished_goods_inventory_gl_account_id (1) |
| Example Sacco | 1200 | Non-Current Assets | gl_accounts.parent_id (5) |
| Example Sacco | 1220 | Plant & Equipment | journal_gl_settings.fixed_asset_cost_gl_account_id (1) |
| Example Sacco | 1240 | Accumulated Depreciation | journal_gl_settings.accumulated_depreciation_gl_account_id (1) |
| Example Sacco | 2000 | Liabilities | gl_accounts.parent_id (2) |
| Example Sacco | 2100 | Current Liabilities | gl_accounts.parent_id (5) |
| Example Sacco | 2110 | Accounts Payable | journal_gl_settings.payable_gl_account_id (1) |
| Example Sacco | 2140 | Wages Payable | journal_gl_settings.manufacturing_wages_payable_gl_account_id (1) |
| Example Sacco | 2150 | Wallet / Member Deposits Payable | journal_gl_settings.wallet_liability_gl_account_id (1) |
| Example Sacco | 3000 | Equity | gl_accounts.parent_id (3) |
| Example Sacco | 3200 | Retained Earnings | journal_gl_settings.retained_earnings_gl_account_id (1) |
| Example Sacco | 4000 | Revenue | gl_accounts.parent_id (11) |
| Example Sacco | 4110 | Rooms Revenue | journal_gl_settings.pos_revenue_room_gl_account_id (1) |
| Example Sacco | 4120 | Food & Beverage Revenue | journal_gl_settings.pos_revenue_bar_gl_account_id (1); journal_gl_settings.pos_revenue_kitchen_gl_account_id (1) |
| Example Sacco | 4140 | Interest & Fee Income | journal_gl_settings.revenue_gl_account_id (1) |
| Example Sacco | 4210 | Inventory Variance Gain | journal_gl_settings.stock_adjustment_inventory_variance_gain_gl_account_id (1) |
| Example Sacco | 5000 | Cost of Sales | gl_accounts.parent_id (4) |
| Example Sacco | 5100 | Cost of Goods Sold | journal_gl_settings.pos_cogs_room_gl_account_id (1) |
| Example Sacco | 5110 | Food Cost of Sales | journal_gl_settings.pos_cogs_kitchen_gl_account_id (1) |
| Example Sacco | 5120 | Beverage Cost of Sales | journal_gl_settings.pos_cogs_bar_gl_account_id (1) |
| Example Sacco | 5130 | Manufacturing Cost of Sales | gl_accounts.parent_id (6) |
| Example Sacco | 6000 | Operating Expenses | gl_accounts.parent_id (23) |
| Example Sacco | 6100 | Salaries & Wages | cost_allocation_rules.expense_gl_account_id (1); journal_gl_settings.expense_gl_account_id (1) |
| Example Sacco | 6200 | Rent Expense | cost_allocation_rules.expense_gl_account_id (1) |
| Example Sacco | 6300 | Utilities | cost_allocation_rules.expense_gl_account_id (1) |
| Example Sacco | 6500 | Transport & Delivery | cost_allocation_rules.expense_gl_account_id (1); journal_gl_settings.pos_agent_commission_expense_gl_account_id (1); journal_gl_settings.pos_transport_expense_gl_account_id (1) |
| Example Sacco | 6600 | Advertising & Promotion | cost_allocation_rules.expense_gl_account_id (1) |
| Example Sacco | 6700 | Depreciation Expense | cost_allocation_rules.expense_gl_account_id (1); journal_gl_settings.depreciation_expense_gl_account_id (1) |
| Example Sacco | 6800 | Factory Overhead Applied | journal_gl_settings.manufacturing_overhead_gl_account_id (1) |
| Example Sacco | 6900 | Allocated Department Overheads | cost_allocation_rules.debit_gl_account_id (6) |
| Example Sacco | 8000 | Inventory Loss / Shrinkage | journal_gl_settings.stock_adjustment_inventory_shrinkage_expense_gl_account_id (1); journal_gl_settings.stock_adjustment_inventory_variance_expense_gl_account_id (1) |
| Example Sacco | 8010 | Damaged Goods Expense | journal_gl_settings.stock_adjustment_damaged_goods_expense_gl_account_id (1) |
| Example Sacco | 8020 | Expired Stock Expense | journal_gl_settings.stock_adjustment_expired_stock_expense_gl_account_id (1) |
| Example Sacco | 8030 | Internal Consumption Expense | journal_gl_settings.manufacturing_consumables_expense_gl_account_id (1); journal_gl_settings.stock_adjustment_internal_consumption_expense_gl_account_id (1) |
| Geolly Investments Limited | 1000 | Assets | gl_accounts.parent_id (2) |
| Geolly Investments Limited | 1100 | Current Assets | gl_accounts.parent_id (13) |
| Geolly Investments Limited | 1120 | Bank Account - Main | journal_gl_settings.cash_gl_account_id (1); journal_gl_settings.pos_bank_gl_account_id (1); journal_gl_settings.wallet_clearing_gl_account_id (1) |
| Geolly Investments Limited | 1130 | Mobile Money Account | journal_gl_settings.pos_airtel_money_gl_account_id (1); journal_gl_settings.pos_mtn_mobile_money_gl_account_id (1) |
| Geolly Investments Limited | 1140 | Accounts Receivable | journal_gl_settings.receivable_gl_account_id (1) |
| Geolly Investments Limited | 1150 | Inventory | journal_gl_settings.manufacturing_scrap_inventory_gl_account_id (1); journal_gl_settings.pos_inventory_bar_gl_account_id (1); journal_gl_settings.pos_inventory_kitchen_gl_account_id (1); journal_gl_settings.pos_inventory_room_gl_account_id (1); journal_gl_settings.purchases_inventory_gl_account_id (1) |
| Geolly Investments Limited | 1170 | Work in Progress | journal_gl_settings.manufacturing_wip_gl_account_id (1); journal_gl_settings.stock_adjustment_work_in_progress_gl_account_id (1) |
| Geolly Investments Limited | 1171 | Raw Materials Inventory | journal_gl_settings.manufacturing_raw_materials_gl_account_id (1); journal_gl_settings.stock_adjustment_raw_materials_inventory_gl_account_id (1) |
| Geolly Investments Limited | 1172 | Finished Goods Inventory | journal_gl_settings.manufacturing_finished_goods_gl_account_id (1); journal_gl_settings.stock_adjustment_finished_goods_inventory_gl_account_id (1) |
| Geolly Investments Limited | 1200 | Non-Current Assets | gl_accounts.parent_id (5) |
| Geolly Investments Limited | 1220 | Plant & Equipment | journal_gl_settings.fixed_asset_cost_gl_account_id (1) |
| Geolly Investments Limited | 1240 | Accumulated Depreciation | journal_gl_settings.accumulated_depreciation_gl_account_id (1) |
| Geolly Investments Limited | 2100 | Current Liabilities | gl_accounts.parent_id (5) |
| Geolly Investments Limited | 2110 | Accounts Payable | journal_gl_settings.payable_gl_account_id (1) |
| Geolly Investments Limited | 2140 | Wages Payable | journal_gl_settings.manufacturing_wages_payable_gl_account_id (1) |
| Geolly Investments Limited | 2150 | Wallet / Member Deposits Payable | journal_gl_settings.wallet_liability_gl_account_id (1) |
| Geolly Investments Limited | 3200 | Retained Earnings | journal_gl_settings.retained_earnings_gl_account_id (1) |
| Geolly Investments Limited | 4100 | Sales / Service Revenue | journal_gl_settings.revenue_gl_account_id (1) |
| Geolly Investments Limited | 4110 | Rooms Revenue | journal_gl_settings.pos_revenue_room_gl_account_id (1) |
| Geolly Investments Limited | 4120 | Food & Beverage Revenue | journal_gl_settings.pos_revenue_bar_gl_account_id (1); journal_gl_settings.pos_revenue_kitchen_gl_account_id (1) |
| Geolly Investments Limited | 4210 | Inventory Variance Gain | journal_gl_settings.stock_adjustment_inventory_variance_gain_gl_account_id (1) |
| Geolly Investments Limited | 5110 | Food Cost of Sales | journal_gl_settings.pos_cogs_kitchen_gl_account_id (1) |
| Geolly Investments Limited | 5120 | Beverage Cost of Sales | journal_gl_settings.pos_cogs_bar_gl_account_id (1) |
| Geolly Investments Limited | 5130 | Manufacturing Cost of Sales | gl_accounts.parent_id (6) |
| Geolly Investments Limited | 6000 | Operating Expenses | gl_accounts.parent_id (23) |
| Geolly Investments Limited | 6100 | Salaries & Wages | cost_allocation_rules.expense_gl_account_id (1); journal_gl_settings.expense_gl_account_id (1) |
| Geolly Investments Limited | 6200 | Rent Expense | cost_allocation_rules.expense_gl_account_id (1) |
| Geolly Investments Limited | 6300 | Utilities | cost_allocation_rules.expense_gl_account_id (1) |
| Geolly Investments Limited | 6500 | Transport & Delivery | cost_allocation_rules.expense_gl_account_id (1); journal_gl_settings.pos_agent_commission_expense_gl_account_id (1); journal_gl_settings.pos_transport_expense_gl_account_id (1) |
| Geolly Investments Limited | 6600 | Advertising & Promotion | cost_allocation_rules.expense_gl_account_id (1) |
| Geolly Investments Limited | 6700 | Depreciation Expense | cost_allocation_rules.expense_gl_account_id (1); journal_gl_settings.depreciation_expense_gl_account_id (1) |
| Geolly Investments Limited | 6800 | Factory Overhead Applied | journal_gl_settings.manufacturing_overhead_gl_account_id (1) |
| Geolly Investments Limited | 6900 | Allocated Department Overheads | cost_allocation_rules.debit_gl_account_id (6) |
| Geolly Investments Limited | 8000 | Inventory Loss / Shrinkage | journal_gl_settings.stock_adjustment_inventory_shrinkage_expense_gl_account_id (1); journal_gl_settings.stock_adjustment_inventory_variance_expense_gl_account_id (1) |
| Geolly Investments Limited | 8010 | Damaged Goods Expense | journal_gl_settings.stock_adjustment_damaged_goods_expense_gl_account_id (1) |
| Geolly Investments Limited | 8020 | Expired Stock Expense | journal_gl_settings.stock_adjustment_expired_stock_expense_gl_account_id (1) |
| Geolly Investments Limited | 8030 | Internal Consumption Expense | journal_gl_settings.manufacturing_consumables_expense_gl_account_id (1); journal_gl_settings.stock_adjustment_internal_consumption_expense_gl_account_id (1) |
| GIL Country Inn | 1100 | Current Assets | gl_accounts.parent_id (13) |
| GIL Country Inn | 1120 | Bank Account - Main | journal_gl_settings.wallet_clearing_gl_account_id (1) |
| GIL Country Inn | 1150 | Inventory | journal_gl_settings.manufacturing_scrap_inventory_gl_account_id (1); journal_gl_settings.pos_inventory_bar_gl_account_id (1); journal_gl_settings.pos_inventory_kitchen_gl_account_id (1); journal_gl_settings.pos_inventory_room_gl_account_id (1); products.stock_account (1) |
| GIL Country Inn | 1170 | Work in Progress | journal_gl_settings.manufacturing_wip_gl_account_id (1); journal_gl_settings.stock_adjustment_work_in_progress_gl_account_id (1) |
| GIL Country Inn | 1171 | Raw Materials Inventory | journal_gl_settings.manufacturing_raw_materials_gl_account_id (1); journal_gl_settings.stock_adjustment_raw_materials_inventory_gl_account_id (1) |
| GIL Country Inn | 1172 | Finished Goods Inventory | journal_gl_settings.manufacturing_finished_goods_gl_account_id (1); journal_gl_settings.stock_adjustment_finished_goods_inventory_gl_account_id (1) |
| GIL Country Inn | 1200 | Non-Current Assets | gl_accounts.parent_id (5) |
| GIL Country Inn | 1220 | Plant & Equipment | journal_gl_settings.fixed_asset_cost_gl_account_id (1) |
| GIL Country Inn | 1240 | Accumulated Depreciation | journal_gl_settings.accumulated_depreciation_gl_account_id (1) |
| GIL Country Inn | 2100 | Current Liabilities | gl_accounts.parent_id (5) |
| GIL Country Inn | 2140 | Wages Payable | journal_gl_settings.manufacturing_wages_payable_gl_account_id (1) |
| GIL Country Inn | 2150 | Wallet / Member Deposits Payable | journal_gl_settings.wallet_liability_gl_account_id (1) |
| GIL Country Inn | 3200 | Retained Earnings | journal_gl_settings.retained_earnings_gl_account_id (1) |
| GIL Country Inn | 4000 | Revenue | gl_accounts.parent_id (11); products.income_account (1) |
| GIL Country Inn | 4110 | Rooms Revenue | journal_gl_settings.pos_revenue_room_gl_account_id (1) |
| GIL Country Inn | 4120 | Food & Beverage Revenue | journal_entry_lines.gl_account_id (1); journal_gl_settings.pos_revenue_bar_gl_account_id (1); journal_gl_settings.pos_revenue_kitchen_gl_account_id (1) |
| GIL Country Inn | 4210 | Inventory Variance Gain | journal_entry_lines.gl_account_id (10); journal_gl_settings.stock_adjustment_inventory_variance_gain_gl_account_id (1) |
| GIL Country Inn | 5000 | Cost of Sales | gl_accounts.parent_id (3); products.purchases_account (1) |
| GIL Country Inn | 5110 | Food Cost of Sales | journal_gl_settings.pos_cogs_kitchen_gl_account_id (1) |
| GIL Country Inn | 5120 | Beverage Cost of Sales | journal_gl_settings.pos_cogs_bar_gl_account_id (1) |
| GIL Country Inn | 5130 | Manufacturing Cost of Sales | gl_accounts.parent_id (6) |
| GIL Country Inn | 6100 | Salaries & Wages | cost_allocation_rules.expense_gl_account_id (1); journal_gl_settings.expense_gl_account_id (1) |
| GIL Country Inn | 6200 | Rent Expense | cost_allocation_rules.expense_gl_account_id (1) |
| GIL Country Inn | 6300 | Utilities | cost_allocation_rules.expense_gl_account_id (1) |
| GIL Country Inn | 6500 | Transport & Delivery | cost_allocation_rules.expense_gl_account_id (1); journal_gl_settings.pos_agent_commission_expense_gl_account_id (1) |
| GIL Country Inn | 6600 | Advertising & Promotion | cost_allocation_rules.expense_gl_account_id (1) |
| GIL Country Inn | 6700 | Depreciation Expense | cost_allocation_rules.expense_gl_account_id (1); journal_gl_settings.depreciation_expense_gl_account_id (1) |
| GIL Country Inn | 6800 | Factory Overhead Applied | journal_gl_settings.manufacturing_overhead_gl_account_id (1) |
| GIL Country Inn | 6900 | Allocated Department Overheads | cost_allocation_rules.debit_gl_account_id (6) |
| GIL Country Inn | 8000 | Inventory Loss / Shrinkage | journal_entry_lines.gl_account_id (22); journal_gl_settings.stock_adjustment_inventory_shrinkage_expense_gl_account_id (1); journal_gl_settings.stock_adjustment_inventory_variance_expense_gl_account_id (1) |
| GIL Country Inn | 8010 | Damaged Goods Expense | journal_gl_settings.stock_adjustment_damaged_goods_expense_gl_account_id (1) |
| GIL Country Inn | 8020 | Expired Stock Expense | journal_gl_settings.stock_adjustment_expired_stock_expense_gl_account_id (1) |
| GIL Country Inn | 8030 | Internal Consumption Expense | journal_gl_settings.manufacturing_consumables_expense_gl_account_id (1); journal_gl_settings.stock_adjustment_internal_consumption_expense_gl_account_id (1) |
| GIL Demo_Inn | 1100 | Current Assets | gl_accounts.parent_id (13) |
| GIL Demo_Inn | 1120 | Bank Account - Main | journal_gl_settings.wallet_clearing_gl_account_id (1) |
| GIL Demo_Inn | 1150 | Inventory | journal_gl_settings.manufacturing_scrap_inventory_gl_account_id (1); journal_gl_settings.pos_inventory_room_gl_account_id (1) |
| GIL Demo_Inn | 1170 | Work in Progress | journal_gl_settings.manufacturing_wip_gl_account_id (1); journal_gl_settings.stock_adjustment_work_in_progress_gl_account_id (1) |
| GIL Demo_Inn | 1171 | Raw Materials Inventory | journal_gl_settings.manufacturing_raw_materials_gl_account_id (1); journal_gl_settings.stock_adjustment_raw_materials_inventory_gl_account_id (1) |
| GIL Demo_Inn | 1172 | Finished Goods Inventory | journal_gl_settings.manufacturing_finished_goods_gl_account_id (1); journal_gl_settings.stock_adjustment_finished_goods_inventory_gl_account_id (1) |
| GIL Demo_Inn | 1200 | Non-Current Assets | gl_accounts.parent_id (5) |
| GIL Demo_Inn | 2100 | Current Liabilities | gl_accounts.parent_id (5) |
| GIL Demo_Inn | 2140 | Wages Payable | journal_gl_settings.manufacturing_wages_payable_gl_account_id (1) |
| GIL Demo_Inn | 2150 | Wallet / Member Deposits Payable | journal_gl_settings.wallet_liability_gl_account_id (1) |
| GIL Demo_Inn | 3200 | Retained Earnings | journal_gl_settings.retained_earnings_gl_account_id (1) |
| GIL Demo_Inn | 4000 | Revenue | gl_accounts.parent_id (11) |
| GIL Demo_Inn | 4210 | Inventory Variance Gain | journal_gl_settings.stock_adjustment_inventory_variance_gain_gl_account_id (1) |
| GIL Demo_Inn | 5000 | Cost of Sales | gl_accounts.parent_id (3) |
| GIL Demo_Inn | 5130 | Manufacturing Cost of Sales | gl_accounts.parent_id (6) |
| GIL Demo_Inn | 6100 | Salaries & Wages | cost_allocation_rules.expense_gl_account_id (1); journal_gl_settings.expense_gl_account_id (1) |
| GIL Demo_Inn | 6200 | Rent Expense | cost_allocation_rules.expense_gl_account_id (1) |
| GIL Demo_Inn | 6300 | Utilities | cost_allocation_rules.expense_gl_account_id (1) |
| GIL Demo_Inn | 6500 | Transport & Delivery | cost_allocation_rules.expense_gl_account_id (1); journal_gl_settings.pos_agent_commission_expense_gl_account_id (1) |
| GIL Demo_Inn | 6600 | Advertising & Promotion | cost_allocation_rules.expense_gl_account_id (1) |
| GIL Demo_Inn | 6700 | Depreciation Expense | cost_allocation_rules.expense_gl_account_id (1); journal_gl_settings.depreciation_expense_gl_account_id (1) |
| GIL Demo_Inn | 6800 | Factory Overhead Applied | journal_gl_settings.manufacturing_overhead_gl_account_id (1) |
| GIL Demo_Inn | 6900 | Allocated Department Overheads | cost_allocation_rules.debit_gl_account_id (6) |
| GIL Demo_Inn | 8000 | Inventory Loss / Shrinkage | journal_gl_settings.stock_adjustment_inventory_shrinkage_expense_gl_account_id (1); journal_gl_settings.stock_adjustment_inventory_variance_expense_gl_account_id (1) |
| GIL Demo_Inn | 8010 | Damaged Goods Expense | journal_gl_settings.stock_adjustment_damaged_goods_expense_gl_account_id (1) |
| GIL Demo_Inn | 8020 | Expired Stock Expense | journal_gl_settings.stock_adjustment_expired_stock_expense_gl_account_id (1) |
| GIL Demo_Inn | 8030 | Internal Consumption Expense | journal_gl_settings.manufacturing_consumables_expense_gl_account_id (1); journal_gl_settings.stock_adjustment_internal_consumption_expense_gl_account_id (1) |
| GIL Medical Services | 1000 | Assets | gl_accounts.parent_id (2) |
| GIL Medical Services | 1100 | Current Assets | gl_accounts.parent_id (13) |
| GIL Medical Services | 1120 | Bank Account - Main | journal_gl_settings.wallet_clearing_gl_account_id (1) |
| GIL Medical Services | 1150 | Inventory | journal_gl_settings.manufacturing_scrap_inventory_gl_account_id (1); journal_gl_settings.pos_inventory_room_gl_account_id (1) |
| GIL Medical Services | 1170 | Work in Progress | journal_gl_settings.manufacturing_wip_gl_account_id (1); journal_gl_settings.stock_adjustment_work_in_progress_gl_account_id (1) |
| GIL Medical Services | 1171 | Raw Materials Inventory | journal_gl_settings.manufacturing_raw_materials_gl_account_id (1); journal_gl_settings.stock_adjustment_raw_materials_inventory_gl_account_id (1) |
| GIL Medical Services | 1172 | Finished Goods Inventory | journal_gl_settings.manufacturing_finished_goods_gl_account_id (1); journal_gl_settings.stock_adjustment_finished_goods_inventory_gl_account_id (1) |
| GIL Medical Services | 1200 | Non-Current Assets | gl_accounts.parent_id (5) |
| GIL Medical Services | 2100 | Current Liabilities | gl_accounts.parent_id (5) |
| GIL Medical Services | 2140 | Wages Payable | journal_gl_settings.manufacturing_wages_payable_gl_account_id (1) |
| GIL Medical Services | 2150 | Wallet / Member Deposits Payable | journal_gl_settings.wallet_liability_gl_account_id (1) |
| GIL Medical Services | 3200 | Retained Earnings | journal_gl_settings.retained_earnings_gl_account_id (1) |
| GIL Medical Services | 4210 | Inventory Variance Gain | journal_gl_settings.stock_adjustment_inventory_variance_gain_gl_account_id (1) |
| GIL Medical Services | 5100 | Cost of Goods Sold | journal_gl_settings.pos_cogs_room_gl_account_id (1) |
| GIL Medical Services | 5130 | Manufacturing Cost of Sales | gl_accounts.parent_id (6) |
| GIL Medical Services | 6000 | Operating Expenses | gl_accounts.parent_id (23) |
| GIL Medical Services | 6100 | Salaries & Wages | cost_allocation_rules.expense_gl_account_id (1); journal_gl_settings.expense_gl_account_id (1) |
| GIL Medical Services | 6200 | Rent Expense | cost_allocation_rules.expense_gl_account_id (1) |
| GIL Medical Services | 6300 | Utilities | cost_allocation_rules.expense_gl_account_id (1) |
| GIL Medical Services | 6500 | Transport & Delivery | cost_allocation_rules.expense_gl_account_id (1); journal_gl_settings.pos_agent_commission_expense_gl_account_id (1); journal_gl_settings.pos_transport_expense_gl_account_id (1) |
| GIL Medical Services | 6600 | Advertising & Promotion | cost_allocation_rules.expense_gl_account_id (1) |
| GIL Medical Services | 6700 | Depreciation Expense | cost_allocation_rules.expense_gl_account_id (1); journal_gl_settings.depreciation_expense_gl_account_id (1) |
| GIL Medical Services | 6800 | Factory Overhead Applied | journal_gl_settings.manufacturing_overhead_gl_account_id (1) |
| GIL Medical Services | 6900 | Allocated Department Overheads | cost_allocation_rules.debit_gl_account_id (6) |
| GIL Medical Services | 8000 | Inventory Loss / Shrinkage | journal_gl_settings.stock_adjustment_inventory_shrinkage_expense_gl_account_id (1); journal_gl_settings.stock_adjustment_inventory_variance_expense_gl_account_id (1) |
| GIL Medical Services | 8010 | Damaged Goods Expense | journal_gl_settings.stock_adjustment_damaged_goods_expense_gl_account_id (1) |
| GIL Medical Services | 8020 | Expired Stock Expense | journal_gl_settings.stock_adjustment_expired_stock_expense_gl_account_id (1) |
| GIL Medical Services | 8030 | Internal Consumption Expense | journal_gl_settings.manufacturing_consumables_expense_gl_account_id (1); journal_gl_settings.stock_adjustment_internal_consumption_expense_gl_account_id (1) |
| Kira Trial Shop | 1171 | Raw Materials Inventory | journal_gl_settings.manufacturing_raw_materials_gl_account_id (1); journal_gl_settings.stock_adjustment_raw_materials_inventory_gl_account_id (1) |
| Kira Trial Shop | 1172 | Finished Goods Inventory | journal_gl_settings.manufacturing_finished_goods_gl_account_id (1); journal_gl_settings.stock_adjustment_finished_goods_inventory_gl_account_id (1) |
| Kira Trial Shop | 4210 | Inventory Variance Gain | journal_gl_settings.stock_adjustment_inventory_variance_gain_gl_account_id (1) |
| Kira Trial Shop | 5100 | Cost of Goods Sold | journal_gl_settings.pos_cogs_room_gl_account_id (1) |
| Kira Trial Shop | 5130 | Manufacturing Cost of Sales | gl_accounts.parent_id (6) |
| Kira Trial Shop | 6900 | Allocated Department Overheads | cost_allocation_rules.debit_gl_account_id (6) |
| Kira Trial Shop | 8010 | Damaged Goods Expense | journal_gl_settings.stock_adjustment_damaged_goods_expense_gl_account_id (1) |
| Kira Trial Shop | 8020 | Expired Stock Expense | journal_gl_settings.stock_adjustment_expired_stock_expense_gl_account_id (1) |
| Kira Trial Shop | 8030 | Internal Consumption Expense | journal_gl_settings.manufacturing_consumables_expense_gl_account_id (1); journal_gl_settings.stock_adjustment_internal_consumption_expense_gl_account_id (1) |
| Oscod Sacco | 1000 | Assets | gl_accounts.parent_id (2) |
| Oscod Sacco | 1100 | Current Assets | gl_accounts.parent_id (13) |
| Oscod Sacco | 1120 | Bank Account - Main | journal_gl_settings.wallet_clearing_gl_account_id (1) |
| Oscod Sacco | 1150 | Inventory | journal_gl_settings.manufacturing_scrap_inventory_gl_account_id (1); journal_gl_settings.pos_inventory_room_gl_account_id (1) |
| Oscod Sacco | 1170 | Work in Progress | journal_gl_settings.manufacturing_wip_gl_account_id (1); journal_gl_settings.stock_adjustment_work_in_progress_gl_account_id (1) |
| Oscod Sacco | 1171 | Raw Materials Inventory | journal_gl_settings.manufacturing_raw_materials_gl_account_id (1); journal_gl_settings.stock_adjustment_raw_materials_inventory_gl_account_id (1) |
| Oscod Sacco | 1172 | Finished Goods Inventory | journal_gl_settings.manufacturing_finished_goods_gl_account_id (1); journal_gl_settings.stock_adjustment_finished_goods_inventory_gl_account_id (1) |
| Oscod Sacco | 1200 | Non-Current Assets | gl_accounts.parent_id (5) |
| Oscod Sacco | 2000 | Liabilities | gl_accounts.parent_id (2) |
| Oscod Sacco | 2100 | Current Liabilities | gl_accounts.parent_id (5) |
| Oscod Sacco | 2140 | Wages Payable | journal_gl_settings.manufacturing_wages_payable_gl_account_id (1) |
| Oscod Sacco | 2150 | Wallet / Member Deposits Payable | journal_gl_settings.wallet_liability_gl_account_id (1) |
| Oscod Sacco | 3000 | Equity | gl_accounts.parent_id (3) |
| Oscod Sacco | 3200 | Retained Earnings | journal_gl_settings.retained_earnings_gl_account_id (1) |
| Oscod Sacco | 4000 | Revenue | gl_accounts.parent_id (11) |
| Oscod Sacco | 4110 | Rooms Revenue | journal_gl_settings.pos_revenue_room_gl_account_id (1) |
| Oscod Sacco | 4120 | Food & Beverage Revenue | journal_gl_settings.pos_revenue_bar_gl_account_id (1); journal_gl_settings.pos_revenue_kitchen_gl_account_id (1) |
| Oscod Sacco | 4210 | Inventory Variance Gain | journal_gl_settings.stock_adjustment_inventory_variance_gain_gl_account_id (1) |
| Oscod Sacco | 5000 | Cost of Sales | gl_accounts.parent_id (4) |
| Oscod Sacco | 5100 | Cost of Goods Sold | journal_gl_settings.pos_cogs_room_gl_account_id (1) |
| Oscod Sacco | 5130 | Manufacturing Cost of Sales | gl_accounts.parent_id (6) |
| Oscod Sacco | 6000 | Operating Expenses | gl_accounts.parent_id (23) |
| Oscod Sacco | 6100 | Salaries & Wages | cost_allocation_rules.expense_gl_account_id (1); journal_gl_settings.expense_gl_account_id (1) |
| Oscod Sacco | 6200 | Rent Expense | cost_allocation_rules.expense_gl_account_id (1) |
| Oscod Sacco | 6300 | Utilities | cost_allocation_rules.expense_gl_account_id (1) |
| Oscod Sacco | 6500 | Transport & Delivery | cost_allocation_rules.expense_gl_account_id (1); journal_gl_settings.pos_agent_commission_expense_gl_account_id (1); journal_gl_settings.pos_transport_expense_gl_account_id (1) |
| Oscod Sacco | 6600 | Advertising & Promotion | cost_allocation_rules.expense_gl_account_id (1) |
| Oscod Sacco | 6700 | Depreciation Expense | cost_allocation_rules.expense_gl_account_id (1) |
| Oscod Sacco | 6800 | Factory Overhead Applied | journal_gl_settings.manufacturing_overhead_gl_account_id (1) |
| Oscod Sacco | 6900 | Allocated Department Overheads | cost_allocation_rules.debit_gl_account_id (6) |
| Oscod Sacco | 8000 | Inventory Loss / Shrinkage | journal_gl_settings.stock_adjustment_inventory_shrinkage_expense_gl_account_id (1); journal_gl_settings.stock_adjustment_inventory_variance_expense_gl_account_id (1) |
| Oscod Sacco | 8010 | Damaged Goods Expense | journal_gl_settings.stock_adjustment_damaged_goods_expense_gl_account_id (1) |
| Oscod Sacco | 8020 | Expired Stock Expense | journal_gl_settings.stock_adjustment_expired_stock_expense_gl_account_id (1) |
| Oscod Sacco | 8030 | Internal Consumption Expense | journal_gl_settings.manufacturing_consumables_expense_gl_account_id (1); journal_gl_settings.stock_adjustment_internal_consumption_expense_gl_account_id (1) |
| SteelHaven Co. Ltd | 1000 | Assets | gl_accounts.parent_id (1) |
| SteelHaven Co. Ltd | 1100 | Current Assets | gl_accounts.parent_id (9) |
| SteelHaven Co. Ltd | 1120 | Bank Account - Main | journal_entry_lines.gl_account_id (234); journal_gl_settings.wallet_clearing_gl_account_id (1) |
| SteelHaven Co. Ltd | 1130 | Mobile Money Account | gl_accounts.parent_id (2) |
| SteelHaven Co. Ltd | 1171 | Raw Materials Inventory | journal_entry_lines.gl_account_id (2); products.stock_account (1) |
| SteelHaven Co. Ltd | 1172 | Finished Goods Inventory | journal_gl_settings.pos_inventory_room_gl_account_id (1); products.stock_account (5) |
| SteelHaven Co. Ltd | 2150 | Wallet / Member Deposits Payable | journal_gl_settings.wallet_liability_gl_account_id (1) |
| SteelHaven Co. Ltd | 4000 | Revenue | gl_accounts.parent_id (6); products.income_account (1) |
| SteelHaven Co. Ltd | 4210 | Inventory Variance Gain | journal_gl_settings.stock_adjustment_inventory_variance_gain_gl_account_id (1) |
| SteelHaven Co. Ltd | 5000 | Cost of Sales | gl_accounts.parent_id (3) |
| SteelHaven Co. Ltd | 6000 | Operating Expenses | expense_lines.expense_gl_account_id (1); gl_accounts.parent_id (11) |
| SteelHaven Co. Ltd | 6300 | Utilities | cost_allocation_rules.expense_gl_account_id (1); expense_lines.expense_gl_account_id (5); journal_entry_lines.gl_account_id (2) |
| SteelHaven Co. Ltd | 6400 | Bank Charges | expense_lines.expense_gl_account_id (1) |
| SteelHaven Co. Ltd | 6500 | Transport & Delivery | cost_allocation_rules.expense_gl_account_id (1); expense_lines.expense_gl_account_id (1) |
| SteelHaven Co. Ltd | 6600 | Advertising & Promotion | cost_allocation_rules.expense_gl_account_id (1) |
| SteelHaven Co. Ltd | 6700 | Depreciation Expense | cost_allocation_rules.expense_gl_account_id (1); journal_gl_settings.depreciation_expense_gl_account_id (1) |
| SteelHaven Co. Ltd | 6800 | Factory Overhead Applied | journal_gl_settings.manufacturing_overhead_gl_account_id (1) |
| SteelHaven Co. Ltd | 6900 | Allocated Department Overheads | cost_allocation_rules.debit_gl_account_id (6) |
| SteelHaven Co. Ltd | 8000 | Inventory Loss / Shrinkage | journal_gl_settings.stock_adjustment_inventory_shrinkage_expense_gl_account_id (1); journal_gl_settings.stock_adjustment_inventory_variance_expense_gl_account_id (1) |
| SteelHaven Co. Ltd | 8010 | Damaged Goods Expense | journal_gl_settings.stock_adjustment_damaged_goods_expense_gl_account_id (1) |
| SteelHaven Co. Ltd | 8020 | Expired Stock Expense | journal_gl_settings.stock_adjustment_expired_stock_expense_gl_account_id (1) |
| SteelHaven Co. Ltd | 8030 | Internal Consumption Expense | journal_gl_settings.stock_adjustment_internal_consumption_expense_gl_account_id (1) |
| TTIMMS Hotel | 1100 | Current Assets | gl_accounts.parent_id (13) |
| TTIMMS Hotel | 1120 | Bank Account - Main | journal_gl_settings.wallet_clearing_gl_account_id (1) |
| TTIMMS Hotel | 1150 | Inventory | journal_gl_settings.manufacturing_scrap_inventory_gl_account_id (1); journal_gl_settings.pos_inventory_room_gl_account_id (1) |
| TTIMMS Hotel | 1170 | Work in Progress | journal_gl_settings.manufacturing_wip_gl_account_id (1); journal_gl_settings.stock_adjustment_work_in_progress_gl_account_id (1) |
| TTIMMS Hotel | 1171 | Raw Materials Inventory | journal_gl_settings.manufacturing_raw_materials_gl_account_id (1); journal_gl_settings.stock_adjustment_raw_materials_inventory_gl_account_id (1) |
| TTIMMS Hotel | 1172 | Finished Goods Inventory | journal_gl_settings.manufacturing_finished_goods_gl_account_id (1); journal_gl_settings.stock_adjustment_finished_goods_inventory_gl_account_id (1) |
| TTIMMS Hotel | 1200 | Non-Current Assets | gl_accounts.parent_id (5) |
| TTIMMS Hotel | 2100 | Current Liabilities | gl_accounts.parent_id (5) |
| TTIMMS Hotel | 2140 | Wages Payable | journal_gl_settings.manufacturing_wages_payable_gl_account_id (1) |
| TTIMMS Hotel | 2150 | Wallet / Member Deposits Payable | journal_gl_settings.wallet_liability_gl_account_id (1) |
| TTIMMS Hotel | 3200 | Retained Earnings | journal_gl_settings.retained_earnings_gl_account_id (1) |
| TTIMMS Hotel | 4100 | Sales / Service Revenue | products.income_account (6) |
| TTIMMS Hotel | 4200 | Other Income | gl_accounts.parent_id (1) |
| TTIMMS Hotel | 5100 | Cost of Goods Sold | journal_gl_settings.pos_cogs_room_gl_account_id (1) |
| TTIMMS Hotel | 5130 | Manufacturing Cost of Sales | gl_accounts.parent_id (6) |
| TTIMMS Hotel | 5132 | COGS - Direct Labour | journal_entry_lines.gl_account_id (1) |
| TTIMMS Hotel | 6000 | Operating Expenses | gl_accounts.parent_id (19); journal_entry_lines.gl_account_id (4); journal_gl_settings.expense_gl_account_id (1) |
| TTIMMS Hotel | 6500 | Transport & Delivery | cost_allocation_rules.expense_gl_account_id (1); journal_gl_settings.pos_agent_commission_expense_gl_account_id (1); journal_gl_settings.pos_transport_expense_gl_account_id (1) |
| TTIMMS Hotel | 6600 | Advertising & Promotion | cost_allocation_rules.expense_gl_account_id (1) |
| TTIMMS Hotel | 6700 | Depreciation Expense | cost_allocation_rules.expense_gl_account_id (1); journal_gl_settings.depreciation_expense_gl_account_id (1) |
| TTIMMS Hotel | 6800 | Factory Overhead Applied | journal_gl_settings.manufacturing_overhead_gl_account_id (1) |
| TTIMMS Hotel | 6900 | Allocated Department Overheads | cost_allocation_rules.debit_gl_account_id (6) |
| TTIMMS Hotel | 8000 | Inventory Loss / Shrinkage | journal_entry_lines.gl_account_id (5); journal_gl_settings.stock_adjustment_inventory_shrinkage_expense_gl_account_id (1); journal_gl_settings.stock_adjustment_inventory_variance_expense_gl_account_id (1) |
| TTIMMS Hotel | 8010 | Damaged Goods Expense | journal_gl_settings.stock_adjustment_damaged_goods_expense_gl_account_id (1) |
| TTIMMS Hotel | 8020 | Expired Stock Expense | journal_entry_lines.gl_account_id (1); journal_gl_settings.stock_adjustment_expired_stock_expense_gl_account_id (1) |
| TTIMMS Hotel | 8030 | Internal Consumption Expense | journal_gl_settings.manufacturing_consumables_expense_gl_account_id (1); journal_gl_settings.stock_adjustment_internal_consumption_expense_gl_account_id (1) |

## Verification and recovery

Production checks found 0 unused template accounts incorrectly active and 0 retained accounts changed. Before-images and reference counts are stored in the restricted `public.chart_restoration_audit` table. Previously inactive original accounts were not blindly reactivated because no before-template activity audit was available.
