export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      staff: {
        Row: {
          id: string
          full_name: string
          email: string
          role: string
          phone: string | null
          is_active: boolean
          created_at: string
          organization_id: string | null
        }
        Insert: {
          id?: string
          full_name: string
          email: string
          role: string
          phone?: string | null
          is_active?: boolean
          created_at?: string
          organization_id?: string | null
        }
        Update: {
          id?: string
          full_name?: string
          email?: string
          role?: string
          phone?: string | null
          is_active?: boolean
          created_at?: string
          organization_id?: string | null
        }
      }
      organization_role_types: {
        Row: {
          id: string
          organization_id: string
          role_key: string
          display_name: string
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          role_key: string
          display_name: string
          sort_order?: number
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          role_key?: string
          display_name?: string
          sort_order?: number
          created_at?: string
        }
      }
      room_types: {
        Row: {
          id: string
          name: string
          description: string | null
          base_price: number
          max_occupancy: number
          amenities: string[] | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          base_price: number
          max_occupancy?: number
          amenities?: string[] | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          base_price?: number
          max_occupancy?: number
          amenities?: string[] | null
          created_at?: string
        }
      }
      rooms: {
        Row: {
          id: string
          room_number: string
          room_type_id: string | null
          floor: number
          status: 'available' | 'occupied' | 'maintenance' | 'cleaning'
          /** Optional rack override; when null, room type base_price applies. */
          nightly_rate?: number | null
          created_at: string
        }
        Insert: {
          id?: string
          room_number: string
          room_type_id?: string | null
          floor: number
          status?: 'available' | 'occupied' | 'maintenance' | 'cleaning'
          nightly_rate?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          room_number?: string
          room_type_id?: string | null
          floor?: number
          status?: 'available' | 'occupied' | 'maintenance' | 'cleaning'
          nightly_rate?: number | null
          created_at?: string
        }
      }
      /** Hotel/property customers (distinct from retail_customers). */
      hotel_customers: {
        Row: {
          id: string
          organization_id?: string | null
          first_name: string
          last_name: string
          email: string | null
          phone: string | null
          id_type: string | null
          id_number: string | null
          address: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id?: string
          first_name: string
          last_name: string
          email?: string | null
          phone?: string | null
          id_type?: string | null
          id_number?: string | null
          address?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          first_name?: string
          last_name?: string
          email?: string | null
          phone?: string | null
          id_type?: string | null
          id_number?: string | null
          address?: string | null
          created_at?: string
        }
      }
      reservations: {
        Row: {
          id: string
          property_customer_id: string | null
          room_id: string | null
          check_in_date: string
          check_out_date: string
          status: 'pending' | 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled'
          number_of_guests: number
          special_requests: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          property_customer_id?: string | null
          room_id?: string | null
          check_in_date: string
          check_out_date: string
          status?: 'pending' | 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled'
          number_of_guests?: number
          special_requests?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          property_customer_id?: string | null
          room_id?: string | null
          check_in_date?: string
          check_out_date?: string
          status?: 'pending' | 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled'
          number_of_guests?: number
          special_requests?: string | null
          created_by?: string | null
          created_at?: string
        }
      }
      stays: {
        Row: {
          id: string
          reservation_id: string | null
          room_id: string | null
          property_customer_id: string | null
          /** Check-in timestamp (matches DB column `actual_check_in`). */
          actual_check_in: string
          actual_check_out: string | null
          checked_in_by: string | null
          checked_out_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          reservation_id?: string | null
          room_id?: string | null
          property_customer_id?: string | null
          actual_check_in?: string
          actual_check_out?: string | null
          checked_in_by?: string | null
          checked_out_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          reservation_id?: string | null
          room_id?: string | null
          property_customer_id?: string | null
          actual_check_in?: string
          actual_check_out?: string | null
          checked_in_by?: string | null
          checked_out_by?: string | null
          created_at?: string
        }
      }
      billing: {
        Row: {
          id: string
          stay_id: string | null
          description: string
          amount: number
          charge_type: 'room' | 'service' | 'food' | 'other'
          charged_at: string
          created_by: string | null
          stay_night_date?: string | null
          auto_charge_source?: 'manual' | 'checkin' | 'night_audit'
        }
        Insert: {
          id?: string
          stay_id?: string | null
          description: string
          amount: number
          charge_type: 'room' | 'service' | 'food' | 'other'
          charged_at?: string
          created_by?: string | null
          stay_night_date?: string | null
          auto_charge_source?: 'manual' | 'checkin' | 'night_audit'
        }
        Update: {
          id?: string
          stay_id?: string | null
          description?: string
          amount?: number
          charge_type?: 'room' | 'service' | 'food' | 'other'
          charged_at?: string
          created_by?: string | null
          stay_night_date?: string | null
          auto_charge_source?: 'manual' | 'checkin' | 'night_audit'
        }
      }
      payments: {
        Row: {
          id: string
          stay_id: string | null
          organization_id?: string | null
          property_customer_id?: string | null
          retail_customer_id?: string | null
          invoice_allocations?: unknown
          /** pos_hotel | pos_retail | debtor — set by app; backfilled in migration. */
          payment_source?: 'pos_hotel' | 'pos_retail' | 'debtor',
          amount: number
          payment_method: 'cash' | 'card' | 'bank_transfer' | 'mtn_mobile_money' | 'airtel_money'
          payment_status: 'pending' | 'completed' | 'failed' | 'refunded'
          transaction_id: string | null
          paid_at: string
          processed_by: string | null
          edited_at?: string | null
          edited_by_staff_id?: string | null
          edited_by_name?: string | null
          source_documents?: unknown
        }
        Insert: {
          id?: string
          stay_id?: string | null
          organization_id?: string | null
          property_customer_id?: string | null
          retail_customer_id?: string | null
          invoice_allocations?: unknown
          payment_source?: 'pos_hotel' | 'pos_retail' | 'debtor'
          amount: number
          payment_method: 'cash' | 'card' | 'bank_transfer' | 'mtn_mobile_money' | 'airtel_money'
          payment_status?: 'pending' | 'completed' | 'failed' | 'refunded'
          transaction_id?: string | null
          paid_at?: string
          processed_by?: string | null
          edited_at?: string | null
          edited_by_staff_id?: string | null
          edited_by_name?: string | null
          source_documents?: unknown
        }
        Update: {
          id?: string
          stay_id?: string | null
          organization_id?: string | null
          property_customer_id?: string | null
          retail_customer_id?: string | null
          invoice_allocations?: unknown
          payment_source?: 'pos_hotel' | 'pos_retail' | 'debtor'
          amount?: number
          payment_method?: 'cash' | 'card' | 'bank_transfer' | 'mtn_mobile_money' | 'airtel_money'
          payment_status?: 'pending' | 'completed' | 'failed' | 'refunded'
          transaction_id?: string | null
          paid_at?: string
          processed_by?: string | null
          edited_at?: string | null
          edited_by_staff_id?: string | null
          edited_by_name?: string | null
          source_documents?: unknown
        }
      }
      housekeeping_tasks: {
        Row: {
          id: string
          room_id: string | null
          task_type: 'cleaning' | 'maintenance' | 'inspection'
          status: 'pending' | 'in_progress' | 'completed'
          priority: 'low' | 'medium' | 'high' | 'urgent'
          notes: string | null
          assigned_to: string | null
          completed_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          room_id?: string | null
          task_type: 'cleaning' | 'maintenance' | 'inspection'
          status?: 'pending' | 'in_progress' | 'completed'
          priority?: 'low' | 'medium' | 'high' | 'urgent'
          notes?: string | null
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          room_id?: string | null
          task_type?: 'cleaning' | 'maintenance' | 'inspection'
          status?: 'pending' | 'in_progress' | 'completed'
          priority?: 'low' | 'medium' | 'high' | 'urgent'
          notes?: string | null
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
        }
      }
      journal_gl_settings: {
        Row: {
          organization_id: string
          revenue_gl_account_id: string | null
          cash_gl_account_id: string | null
          receivable_gl_account_id: string | null
          expense_gl_account_id: string | null
          payable_gl_account_id: string | null
          vat_gl_account_id: string | null
          default_vat_percent: number | null
          purchases_inventory_gl_account_id: string | null
          pos_bank_gl_account_id: string | null
          pos_mtn_mobile_money_gl_account_id: string | null
          pos_airtel_money_gl_account_id: string | null
          pos_cogs_bar_gl_account_id: string | null
          pos_inventory_bar_gl_account_id: string | null
          pos_cogs_kitchen_gl_account_id: string | null
          pos_inventory_kitchen_gl_account_id: string | null
          pos_cogs_room_gl_account_id: string | null
          pos_inventory_room_gl_account_id: string | null
          pos_revenue_bar_gl_account_id: string | null
          pos_revenue_kitchen_gl_account_id: string | null
          pos_revenue_room_gl_account_id: string | null
          updated_at: string
        }
        Insert: {
          organization_id: string
          revenue_gl_account_id?: string | null
          cash_gl_account_id?: string | null
          receivable_gl_account_id?: string | null
          expense_gl_account_id?: string | null
          payable_gl_account_id?: string | null
          vat_gl_account_id?: string | null
          default_vat_percent?: number | null
          purchases_inventory_gl_account_id?: string | null
          pos_bank_gl_account_id?: string | null
          pos_mtn_mobile_money_gl_account_id?: string | null
          pos_airtel_money_gl_account_id?: string | null
          pos_cogs_bar_gl_account_id?: string | null
          pos_inventory_bar_gl_account_id?: string | null
          pos_cogs_kitchen_gl_account_id?: string | null
          pos_inventory_kitchen_gl_account_id?: string | null
          pos_cogs_room_gl_account_id?: string | null
          pos_inventory_room_gl_account_id?: string | null
          pos_revenue_bar_gl_account_id?: string | null
          pos_revenue_kitchen_gl_account_id?: string | null
          pos_revenue_room_gl_account_id?: string | null
          updated_at?: string
        }
        Update: {
          organization_id?: string
          revenue_gl_account_id?: string | null
          cash_gl_account_id?: string | null
          receivable_gl_account_id?: string | null
          expense_gl_account_id?: string | null
          payable_gl_account_id?: string | null
          vat_gl_account_id?: string | null
          default_vat_percent?: number | null
          purchases_inventory_gl_account_id?: string | null
          pos_bank_gl_account_id?: string | null
          pos_mtn_mobile_money_gl_account_id?: string | null
          pos_airtel_money_gl_account_id?: string | null
          pos_cogs_bar_gl_account_id?: string | null
          pos_inventory_bar_gl_account_id?: string | null
          pos_cogs_kitchen_gl_account_id?: string | null
          pos_inventory_kitchen_gl_account_id?: string | null
          pos_cogs_room_gl_account_id?: string | null
          pos_inventory_room_gl_account_id?: string | null
          pos_revenue_bar_gl_account_id?: string | null
          pos_revenue_kitchen_gl_account_id?: string | null
          pos_revenue_room_gl_account_id?: string | null
          updated_at?: string
        }
      }
      retail_invoices: {
        Row: {
          id: string
          organization_id: string
          invoice_number: string
          customer_id: string | null
          property_customer_id: string | null
          customer_name: string
          customer_email: string | null
          customer_address: string | null
          issue_date: string
          due_date: string | null
          status: 'draft' | 'sent' | 'paid' | 'void'
          notes: string | null
          subtotal: number
          tax_rate: number
          tax_amount: number
          total: number
          created_at: string
          updated_at: string
          created_by: string | null
        }
        Insert: {
          id?: string
          organization_id: string
          invoice_number: string
          customer_id?: string | null
          property_customer_id?: string | null
          customer_name?: string
          customer_email?: string | null
          customer_address?: string | null
          issue_date?: string
          due_date?: string | null
          status?: 'draft' | 'sent' | 'paid' | 'void'
          notes?: string | null
          subtotal?: number
          tax_rate?: number
          tax_amount?: number
          total?: number
          created_at?: string
          updated_at?: string
          created_by?: string | null
        }
        Update: {
          id?: string
          organization_id?: string
          invoice_number?: string
          customer_id?: string | null
          property_customer_id?: string | null
          customer_name?: string
          customer_email?: string | null
          customer_address?: string | null
          issue_date?: string
          due_date?: string | null
          status?: 'draft' | 'sent' | 'paid' | 'void'
          notes?: string | null
          subtotal?: number
          tax_rate?: number
          tax_amount?: number
          total?: number
          created_at?: string
          updated_at?: string
          created_by?: string | null
        }
      }
      retail_customers: {
        Row: {
          id: string
          organization_id: string
          name: string
          email: string | null
          phone: string | null
          address: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          email?: string | null
          phone?: string | null
          address?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          name?: string
          email?: string | null
          phone?: string | null
          address?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      departments: {
        Row: {
          id: string
          organization_id: string | null
          name: string
          /** dish_menu = kitchen menu items; product_catalog = bar/sauna retail SKUs */
          pos_catalog_mode?: "dish_menu" | "product_catalog" | null
          created_at?: string
        }
        Insert: {
          id?: string
          organization_id?: string
          name: string
          pos_catalog_mode?: "dish_menu" | "product_catalog" | null
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string | null
          name?: string
          pos_catalog_mode?: "dish_menu" | "product_catalog" | null
          created_at?: string
        }
      }
      gl_accounts: {
        Row: {
          id: string
          organization_id: string | null
          code: string
          account_name: string
          category?: string | null
          created_at?: string
        }
        Insert: {
          id?: string
          organization_id?: string
          code: string
          account_name: string
          category?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string | null
          code?: string
          account_name?: string
          category?: string | null
          created_at?: string
        }
      }
      products: {
        Row: {
          id: string
          organization_id?: string | null
          name: string
          cost_price?: number | null
          sales_price?: number | null
          department_id?: string | null
          income_account?: string | null
          stock_account?: string | null
          purchases_account?: string | null
          purchasable?: boolean | null
          saleable?: boolean | null
          track_inventory?: boolean | null
          active?: boolean | null
          reorder_level?: number | null
        }
        Insert: {
          id?: string
          organization_id?: string
          name: string
          cost_price?: number | null
          sales_price?: number | null
          department_id?: string | null
          income_account?: string | null
          stock_account?: string | null
          purchases_account?: string | null
          purchasable?: boolean | null
          saleable?: boolean | null
          track_inventory?: boolean | null
          active?: boolean | null
          reorder_level?: number | null
        }
        Update: {
          id?: string
          organization_id?: string | null
          name?: string
          cost_price?: number | null
          sales_price?: number | null
          department_id?: string | null
          income_account?: string | null
          stock_account?: string | null
          purchases_account?: string | null
          purchasable?: boolean | null
          saleable?: boolean | null
          track_inventory?: boolean | null
          active?: boolean | null
          reorder_level?: number | null
        }
      }
      retail_invoice_lines: {
        Row: {
          id: string
          invoice_id: string
          line_no: number
          description: string
          product_id: string | null
          quantity: number
          unit_price: number
          line_total: number
          vat_applies?: boolean
        }
        Insert: {
          id?: string
          invoice_id: string
          line_no: number
          description?: string
          product_id?: string | null
          quantity?: number
          unit_price?: number
          line_total?: number
          vat_applies?: boolean
        }
        Update: {
          id?: string
          invoice_id?: string
          line_no?: number
          description?: string
          product_id?: string | null
          quantity?: number
          unit_price?: number
          line_total?: number
          vat_applies?: boolean
        }
      }
    },
    Functions: {
      create_journal_entry_atomic: {
        Args: {
          p_entry_date: string
          p_description: string
          p_reference_type: string | null
          p_reference_id: string | null
          p_created_by: string | null
          p_lines: Json
          p_organization_id?: string | null
        }
        Returns: string
      }
      post_hotel_room_night_charge: {
        Args: {
          p_organization_id: string
          p_stay_id: string
          p_source: string
          p_created_by?: string | null
          p_folio_night_date?: string | null
        }
        Returns: Json
      }
      run_hotel_night_audit_for_org: {
        Args: {
          p_organization_id: string
          p_folio_night_date?: string | null
          p_created_by?: string | null
        }
        Returns: Json
      }
    }
  }
}
