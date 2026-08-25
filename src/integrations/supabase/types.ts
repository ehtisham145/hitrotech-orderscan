export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string
          id: string
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      batches: {
        Row: {
          created_at: string
          created_by: string
          default_branch_name: string | null
          default_employee_name: string | null
          default_store_id: string | null
          duplicate_count: number
          failed_count: number
          id: string
          name: string
          processed_count: number
          status: string
          total_images: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          default_branch_name?: string | null
          default_employee_name?: string | null
          default_store_id?: string | null
          duplicate_count?: number
          failed_count?: number
          id?: string
          name: string
          processed_count?: number
          status?: string
          total_images?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          default_branch_name?: string | null
          default_employee_name?: string | null
          default_store_id?: string | null
          duplicate_count?: number
          failed_count?: number
          id?: string
          name?: string
          processed_count?: number
          status?: string
          total_images?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "batches_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_requests: {
        Row: {
          admin_note: string | null
          amount_pkr: number
          created_at: string
          id: string
          months: number
          payer_note: string | null
          payment_reference: string | null
          plan_tier: Database["public"]["Enums"]["workspace_plan"]
          requested_by: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          admin_note?: string | null
          amount_pkr: number
          created_at?: string
          id?: string
          months?: number
          payer_note?: string | null
          payment_reference?: string | null
          plan_tier: Database["public"]["Enums"]["workspace_plan"]
          requested_by: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          admin_note?: string | null
          amount_pkr?: number
          created_at?: string
          id?: string
          months?: number
          payer_note?: string | null
          payment_reference?: string | null
          plan_tier?: Database["public"]["Enums"]["workspace_plan"]
          requested_by?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_requests_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_settings: {
        Row: {
          account_number: string
          account_title: string
          bank_name: string
          branch: string
          branch_code: string
          contact_email: string
          contact_whatsapp: string
          iban: string
          id: string
          instructions: string
          updated_at: string
        }
        Insert: {
          account_number?: string
          account_title?: string
          bank_name?: string
          branch?: string
          branch_code?: string
          contact_email?: string
          contact_whatsapp?: string
          iban?: string
          id?: string
          instructions?: string
          updated_at?: string
        }
        Update: {
          account_number?: string
          account_title?: string
          bank_name?: string
          branch?: string
          branch_code?: string
          contact_email?: string
          contact_whatsapp?: string
          iban?: string
          id?: string
          instructions?: string
          updated_at?: string
        }
        Relationships: []
      }
      branches: {
        Row: {
          created_at: string
          id: string
          name: string
          sort_order: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "branches_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_slabs: {
        Row: {
          effective_from: string | null
          effective_to: string | null
          active: boolean
          created_at: string
          id: string
          max_count: number | null
          min_count: number
          partner_id: string | null
          rate_pkr: number
          role: Database["public"]["Enums"]["partner_role"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          effective_from?: string | null
          effective_to?: string | null
          active?: boolean
          created_at?: string
          id?: string
          max_count?: number | null
          min_count: number
          partner_id?: string | null
          rate_pkr: number
          role: Database["public"]["Enums"]["partner_role"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          effective_from?: string | null
          effective_to?: string | null
          active?: boolean
          created_at?: string
          id?: string
          max_count?: number | null
          min_count?: number
          partner_id?: string | null
          rate_pkr?: number
          role?: Database["public"]["Enums"]["partner_role"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_slabs_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_slabs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          created_at: string
          id: string
          name: string
          sort_order: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employees_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      extractions: {
        Row: {
          activation_date: string | null
          activation_date_parsed: string | null
          activation_time: string | null
          anomalies: string[]
          avg_confidence: number | null
          batch_id: string
          branch_name: string | null
          cnic: string | null
          commission_amount: number | null
          commission_month: string | null
          confidence: Json | null
          created_at: string
          created_by: string
          current_network: string | null
          customer_name: string | null
          deposit: string | null
          discount: string | null
          duplicate_of: string | null
          edited_fields: Json | null
          email: string | null
          employee_name: string | null
          error_message: string | null
          file_name: string | null
          id: string
          is_duplicate: boolean
          needs_review: boolean
          number_charges: string | null
          number_type: string | null
          order_number: string | null
          order_number_normalized: string | null
          order_status: string | null
          package_name: string | null
          paid_via: string | null
          partner_id: string | null
          phone_number: string | null
          plan_price: string | null
          raw_response: Json | null
          reference: string | null
          remaining_deposit: string | null
          remarks: string | null
          sim_type: string | null
          status: string
          storage_path: string
          store_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          activation_date?: string | null
          activation_date_parsed?: string | null
          activation_time?: string | null
          anomalies?: string[]
          avg_confidence?: number | null
          batch_id: string
          branch_name?: string | null
          cnic?: string | null
          commission_amount?: number | null
          commission_month?: string | null
          confidence?: Json | null
          created_at?: string
          created_by: string
          current_network?: string | null
          customer_name?: string | null
          deposit?: string | null
          discount?: string | null
          duplicate_of?: string | null
          edited_fields?: Json | null
          email?: string | null
          employee_name?: string | null
          error_message?: string | null
          file_name?: string | null
          id?: string
          is_duplicate?: boolean
          needs_review?: boolean
          number_charges?: string | null
          number_type?: string | null
          order_number?: string | null
          order_number_normalized?: string | null
          order_status?: string | null
          package_name?: string | null
          paid_via?: string | null
          partner_id?: string | null
          phone_number?: string | null
          plan_price?: string | null
          raw_response?: Json | null
          reference?: string | null
          remaining_deposit?: string | null
          remarks?: string | null
          sim_type?: string | null
          status?: string
          storage_path: string
          store_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          activation_date?: string | null
          activation_date_parsed?: string | null
          activation_time?: string | null
          anomalies?: string[]
          avg_confidence?: number | null
          batch_id?: string
          branch_name?: string | null
          cnic?: string | null
          commission_amount?: number | null
          commission_month?: string | null
          confidence?: Json | null
          created_at?: string
          created_by?: string
          current_network?: string | null
          customer_name?: string | null
          deposit?: string | null
          discount?: string | null
          duplicate_of?: string | null
          edited_fields?: Json | null
          email?: string | null
          employee_name?: string | null
          error_message?: string | null
          file_name?: string | null
          id?: string
          is_duplicate?: boolean
          needs_review?: boolean
          number_charges?: string | null
          number_type?: string | null
          order_number?: string | null
          order_number_normalized?: string | null
          order_status?: string | null
          package_name?: string | null
          paid_via?: string | null
          partner_id?: string | null
          phone_number?: string | null
          plan_price?: string | null
          raw_response?: Json | null
          reference?: string | null
          remaining_deposit?: string | null
          remarks?: string | null
          sim_type?: string | null
          status?: string
          storage_path?: string
          store_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "extractions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extractions_duplicate_of_fkey"
            columns: ["duplicate_of"]
            isOneToOne: false
            referencedRelation: "extractions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extractions_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extractions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_reports: {
        Row: {
          created_at: string
          id: string
          name: string
          row_count: number
          scheduled_report_id: string | null
          storage_path: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          row_count?: number
          scheduled_report_id?: string | null
          storage_path: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          row_count?: number
          scheduled_report_id?: string | null
          storage_path?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "generated_reports_scheduled_report_id_fkey"
            columns: ["scheduled_report_id"]
            isOneToOne: false
            referencedRelation: "scheduled_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_reports_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      month_locks: {
        Row: {
          locked_at: string
          locked_by: string | null
          month: string
          notes: string | null
          workspace_id: string
        }
        Insert: {
          locked_at?: string
          locked_by?: string | null
          month: string
          notes?: string | null
          workspace_id: string
        }
        Update: {
          locked_at?: string
          locked_by?: string | null
          month?: string
          notes?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "month_locks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          action: string
          actor_id: string | null
          body: string | null
          created_at: string
          data: Json
          entity_id: string | null
          entity_type: string | null
          id: string
          read_at: string | null
          title: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          body?: string | null
          created_at?: string
          data?: Json
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          read_at?: string | null
          title: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          body?: string | null
          created_at?: string
          data?: Json
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          read_at?: string | null
          title?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_payouts: {
        Row: {
          activations_count: number
          amount_pkr: number
          created_at: string
          id: string
          month: string
          notes: string | null
          paid_at: string | null
          paid_by: string | null
          partner_id: string
          payment_reference: string | null
          rate_pkr: number
          snapshot_amount: number | null
          snapshot_at: string | null
          snapshot_count: number | null
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          activations_count?: number
          amount_pkr?: number
          created_at?: string
          id?: string
          month: string
          notes?: string | null
          paid_at?: string | null
          paid_by?: string | null
          partner_id: string
          payment_reference?: string | null
          rate_pkr?: number
          snapshot_amount?: number | null
          snapshot_at?: string | null
          snapshot_count?: number | null
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          activations_count?: number
          amount_pkr?: number
          created_at?: string
          id?: string
          month?: string
          notes?: string | null
          paid_at?: string | null
          paid_by?: string | null
          partner_id?: string
          payment_reference?: string | null
          rate_pkr?: number
          snapshot_amount?: number | null
          snapshot_at?: string | null
          snapshot_count?: number | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_payouts_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_payouts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      partners: {
        Row: {
          active: boolean
          address: string | null
          city: string | null
          cnic: string | null
          created_at: string
          created_by: string | null
          id: string
          invited_email: string | null
          join_date: string
          match_keys: string[]
          name: string
          notes: string | null
          phone: string | null
          role: Database["public"]["Enums"]["partner_role"]
          store_id: string | null
          updated_at: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          active?: boolean
          address?: string | null
          city?: string | null
          cnic?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          invited_email?: string | null
          join_date?: string
          match_keys?: string[]
          name: string
          notes?: string | null
          phone?: string | null
          role: Database["public"]["Enums"]["partner_role"]
          store_id?: string | null
          updated_at?: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          active?: boolean
          address?: string | null
          city?: string | null
          cnic?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          invited_email?: string | null
          join_date?: string
          match_keys?: string[]
          name?: string
          notes?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["partner_role"]
          store_id?: string | null
          updated_at?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "partners_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active_workspace_id: string | null
          created_at: string
          email: string | null
          email_2fa_enabled: boolean
          full_name: string | null
          id: string
          notification_prefs: Json
          preferred_2fa_method: string | null
        }
        Insert: {
          active_workspace_id?: string | null
          created_at?: string
          email?: string | null
          email_2fa_enabled?: boolean
          full_name?: string | null
          id: string
          notification_prefs?: Json
          preferred_2fa_method?: string | null
        }
        Update: {
          active_workspace_id?: string | null
          created_at?: string
          email?: string | null
          email_2fa_enabled?: boolean
          full_name?: string | null
          id?: string
          notification_prefs?: Json
          preferred_2fa_method?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_active_workspace_id_fkey"
            columns: ["active_workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      report_views: {
        Row: {
          created_at: string
          filters: Json
          id: string
          name: string
          scope: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          filters?: Json
          id?: string
          name: string
          scope?: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          filters?: Json
          id?: string
          name?: string
          scope?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_views_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_reports: {
        Row: {
          cadence: string
          created_at: string
          enabled: boolean
          id: string
          last_run_at: string | null
          name: string
          next_run_at: string
          recipients: string[]
          updated_at: string
          user_id: string
          view_id: string
          workspace_id: string
        }
        Insert: {
          cadence: string
          created_at?: string
          enabled?: boolean
          id?: string
          last_run_at?: string | null
          name: string
          next_run_at?: string
          recipients?: string[]
          updated_at?: string
          user_id: string
          view_id: string
          workspace_id: string
        }
        Update: {
          cadence?: string
          created_at?: string
          enabled?: boolean
          id?: string
          last_run_at?: string | null
          name?: string
          next_run_at?: string
          recipients?: string[]
          updated_at?: string
          user_id?: string
          view_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_reports_view_id_fkey"
            columns: ["view_id"]
            isOneToOne: false
            referencedRelation: "report_views"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_reports_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          code: string
          created_at: string
          id: string
          label: string | null
          sort_order: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          label?: string | null
          sort_order?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          label?: string | null
          sort_order?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stores_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      user_recovery_codes: {
        Row: {
          code_hash: string
          created_at: string
          id: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          code_hash: string
          created_at?: string
          id?: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          code_hash?: string
          created_at?: string
          id?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      verification_codes: {
        Row: {
          attempts: number
          code_hash: string
          created_at: string
          email: string
          expires_at: string
          id: string
          purpose: string
          used_at: string | null
        }
        Insert: {
          attempts?: number
          code_hash: string
          created_at?: string
          email: string
          expires_at: string
          id?: string
          purpose: string
          used_at?: string | null
        }
        Update: {
          attempts?: number
          code_hash?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          purpose?: string
          used_at?: string | null
        }
        Relationships: []
      }
      workspace_invites: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          token: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role: Database["public"]["Enums"]["app_role"]
          token?: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          token?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by?: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          locale: string
          logo_url: string | null
          name: string
          owner_id: string
          plan_activated_at: string | null
          plan_expires_at: string | null
          plan_tier: Database["public"]["Enums"]["workspace_plan"]
          seat_limit: number
          slug: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          locale?: string
          logo_url?: string | null
          name: string
          owner_id: string
          plan_activated_at?: string | null
          plan_expires_at?: string | null
          plan_tier?: Database["public"]["Enums"]["workspace_plan"]
          seat_limit?: number
          slug: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          locale?: string
          logo_url?: string | null
          name?: string
          owner_id?: string
          plan_activated_at?: string | null
          plan_expires_at?: string | null
          plan_tier?: Database["public"]["Enums"]["workspace_plan"]
          seat_limit?: number
          slug?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      approve_billing_request: {
        Args: { _admin_note?: string; _request_id: string }
        Returns: undefined
      }
      can_manage_user_files: {
        Args: { _caller?: string; _owner: string }
        Returns: boolean
      }
      current_partner_id: { Args: never; Returns: string }
      expire_workspace_plans: { Args: never; Returns: undefined }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_workspace_role: {
        Args: { _roles: string[]; _user_id?: string; _ws: string }
        Returns: boolean
      }
      is_manager_or_admin: { Args: { _user_id: string }; Returns: boolean }
      is_super_admin: { Args: { _user_id?: string }; Returns: boolean }
      is_super_admin_for: {
        Args: { _user_id?: string; _ws: string }
        Returns: boolean
      }
      is_workspace_member: {
        Args: { _user_id?: string; _ws: string }
        Returns: boolean
      }
      parse_activation_date: { Args: { t: string }; Returns: string }
      recompute_partner_commission: {
        Args: { _month: string; _partner_id: string }
        Returns: undefined
      }
      reject_billing_request: {
        Args: { _admin_note?: string; _request_id: string }
        Returns: undefined
      }
      workspace_seat_usage: {
        Args: { _ws: string }
        Returns: {
          members_count: number
          pending_invites: number
          plan_tier: Database["public"]["Enums"]["workspace_plan"]
          seat_limit: number
          seats_used: number
        }[]
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "manager"
        | "employee"
        | "partner"
        | "owner"
        | "super_admin"
        | "operator"
        | "accountant"
      partner_role:
        | "franchise_owner"
        | "retailer"
        | "franchise_as_retailer"
        | "field_worker"
        | "asm"
      workspace_plan: "free" | "starter" | "pro" | "enterprise"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "admin",
        "manager",
        "employee",
        "partner",
        "owner",
        "super_admin",
        "operator",
        "accountant",
      ],
      partner_role: [
        "franchise_owner",
        "retailer",
        "franchise_as_retailer",
        "field_worker",
        "asm",
      ],
      workspace_plan: ["free", "starter", "pro", "enterprise"],
    },
  },
} as const
