export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          changed_by: string | null
          created_at: string | null
          id: number
          new_values: Json | null
          old_values: Json | null
          record_id: number
          table_name: string
          tenant_id: number | null
        }
        Insert: {
          action: string
          changed_by?: string | null
          created_at?: string | null
          id?: number
          new_values?: Json | null
          old_values?: Json | null
          record_id: number
          table_name: string
          tenant_id?: number | null
        }
        Update: {
          action?: string
          changed_by?: string | null
          created_at?: string | null
          id?: number
          new_values?: Json | null
          old_values?: Json | null
          record_id?: number
          table_name?: string
          tenant_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_customers: {
        Row: {
          created_at: string
          id: number
          stripe_customer_id: string
          user_id: number
        }
        Insert: {
          created_at?: string
          id?: number
          stripe_customer_id: string
          user_id: number
        }
        Update: {
          created_at?: string
          id?: number
          stripe_customer_id?: string
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "billing_customers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_webhook_events: {
        Row: {
          event_type: string
          id: number
          payload: Json
          processed_at: string
          stripe_event_id: string
        }
        Insert: {
          event_type: string
          id?: number
          payload: Json
          processed_at?: string
          stripe_event_id: string
        }
        Update: {
          event_type?: string
          id?: number
          payload?: Json
          processed_at?: string
          stripe_event_id?: string
        }
        Relationships: []
      }
      budget_items: {
        Row: {
          amount_spent: number | null
          budget_allocated: number | null
          created_at: string | null
          description: string | null
          grant_id: number
          id: number
          item_name: string
          status: string
          tenant_id: number
          updated_at: string | null
        }
        Insert: {
          amount_spent?: number | null
          budget_allocated?: number | null
          created_at?: string | null
          description?: string | null
          grant_id: number
          id?: number
          item_name: string
          status?: string
          tenant_id: number
          updated_at?: string | null
        }
        Update: {
          amount_spent?: number | null
          budget_allocated?: number | null
          created_at?: string | null
          description?: string | null
          grant_id?: number
          id?: number
          item_name?: string
          status?: string
          tenant_id?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "budget_items_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "grant_record"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount_spent: number | null
          budget_item_id: number | null
          created_at: string | null
          expense_date: string | null
          grant_id: number
          id: number
          item_name: string | null
          status: string
          tenant_id: number
          updated_at: string | null
        }
        Insert: {
          amount_spent?: number | null
          budget_item_id?: number | null
          created_at?: string | null
          expense_date?: string | null
          grant_id: number
          id?: number
          item_name?: string | null
          status?: string
          tenant_id: number
          updated_at?: string | null
        }
        Update: {
          amount_spent?: number | null
          budget_item_id?: number | null
          created_at?: string | null
          expense_date?: string | null
          grant_id?: number
          id?: number
          item_name?: string | null
          status?: string
          tenant_id?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_budget_item_id_fkey"
            columns: ["budget_item_id"]
            isOneToOne: false
            referencedRelation: "budget_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "grant_record"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_entitlements: {
        Row: {
          created_at: string
          enabled: boolean
          feature_key: string
          grantee_id: number
          id: number
          source: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          feature_key: string
          grantee_id: number
          id?: number
          source?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          feature_key?: string
          grantee_id?: number
          id?: number
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "feature_entitlements_grantee_id_fkey"
            columns: ["grantee_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_agent_listings: {
        Row: {
          about: string | null
          accepting: boolean
          assets_managed: string | null
          blurb: string | null
          created_at: string
          ein: string | null
          email: string | null
          fee_admin_pct: number | null
          focus: string[] | null
          id: number
          location: string | null
          managed_by_user_id: number | null
          name: string | null
          phone: string | null
          projects: string[] | null
          rating: number
          region: string | null
          response_time: string | null
          reviews: number
          services: string[] | null
          sponsored: number
          status: string
          tenant_id: number
          updated_at: string
          verification: string
          verified: boolean
          website: string | null
        }
        Insert: {
          about?: string | null
          accepting?: boolean
          assets_managed?: string | null
          blurb?: string | null
          created_at?: string
          ein?: string | null
          email?: string | null
          fee_admin_pct?: number | null
          focus?: string[] | null
          id?: number
          location?: string | null
          managed_by_user_id?: number | null
          name?: string | null
          phone?: string | null
          projects?: string[] | null
          rating?: number
          region?: string | null
          response_time?: string | null
          reviews?: number
          services?: string[] | null
          sponsored?: number
          status?: string
          tenant_id: number
          updated_at?: string
          verification?: string
          verified?: boolean
          website?: string | null
        }
        Update: {
          about?: string | null
          accepting?: boolean
          assets_managed?: string | null
          blurb?: string | null
          created_at?: string
          ein?: string | null
          email?: string | null
          fee_admin_pct?: number | null
          focus?: string[] | null
          id?: number
          location?: string | null
          managed_by_user_id?: number | null
          name?: string | null
          phone?: string | null
          projects?: string[] | null
          rating?: number
          region?: string | null
          response_time?: string | null
          reviews?: number
          services?: string[] | null
          sponsored?: number
          status?: string
          tenant_id?: number
          updated_at?: string
          verification?: string
          verified?: boolean
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_agent_listings_managed_by_user_id_fkey"
            columns: ["managed_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_agent_listings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      grant_attachments: {
        Row: {
          category: string | null
          created_at: string | null
          description: string | null
          file_name: string
          file_path: string
          file_size: number | null
          file_type: string | null
          grant_id: number
          id: number
          tenant_id: number
          uploaded_by: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          description?: string | null
          file_name: string
          file_path: string
          file_size?: number | null
          file_type?: string | null
          grant_id: number
          id?: number
          tenant_id: number
          uploaded_by?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          description?: string | null
          file_name?: string
          file_path?: string
          file_size?: number | null
          file_type?: string | null
          grant_id?: number
          id?: number
          tenant_id?: number
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "grant_attachments_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "grant_record"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grant_attachments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      grant_comments: {
        Row: {
          comment: string
          created_at: string | null
          grant_id: number
          id: number
          tenant_id: number
          user_id: string
        }
        Insert: {
          comment: string
          created_at?: string | null
          grant_id: number
          id?: number
          tenant_id: number
          user_id: string
        }
        Update: {
          comment?: string
          created_at?: string | null
          grant_id?: number
          id?: number
          tenant_id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grant_comments_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "grant_record"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grant_comments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      grant_record: {
        Row: {
          approval_notes: string | null
          created_at: string | null
          description: string | null
          disbursed_funds: number | null
          end_spend_period: string | null
          grant_amount: number | null
          grant_name: string | null
          id: number
          release_date: string | null
          remaining_balance: number | null
          reviewed_at: string | null
          reviewer_id: string | null
          start_spend_period: string | null
          status: string | null
          submitted_at: string | null
          tenant_id: number
          total_spent: number | null
          updated_at: string | null
          user_id: number
        }
        Insert: {
          approval_notes?: string | null
          created_at?: string | null
          description?: string | null
          disbursed_funds?: number | null
          end_spend_period?: string | null
          grant_amount?: number | null
          grant_name?: string | null
          id?: number
          release_date?: string | null
          remaining_balance?: number | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          start_spend_period?: string | null
          status?: string | null
          submitted_at?: string | null
          tenant_id: number
          total_spent?: number | null
          updated_at?: string | null
          user_id: number
        }
        Update: {
          approval_notes?: string | null
          created_at?: string | null
          description?: string | null
          disbursed_funds?: number | null
          end_spend_period?: string | null
          grant_amount?: number | null
          grant_name?: string | null
          id?: number
          release_date?: string | null
          remaining_balance?: number | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          start_spend_period?: string | null
          status?: string | null
          submitted_at?: string | null
          tenant_id?: number
          total_spent?: number | null
          updated_at?: string | null
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "grant_record_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grant_record_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      grant_status_history: {
        Row: {
          changed_by: string | null
          comment: string | null
          created_at: string | null
          grant_id: number
          id: number
          new_status: string
          old_status: string | null
          tenant_id: number
        }
        Insert: {
          changed_by?: string | null
          comment?: string | null
          created_at?: string | null
          grant_id: number
          id?: number
          new_status: string
          old_status?: string | null
          tenant_id: number
        }
        Update: {
          changed_by?: string | null
          comment?: string | null
          created_at?: string | null
          grant_id?: number
          id?: number
          new_status?: string
          old_status?: string | null
          tenant_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "grant_status_history_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "grant_record"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grant_status_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invites: {
        Row: {
          created_at: string | null
          created_by: string | null
          email: string | null
          expires_at: string
          id: number
          role: string
          tenant_id: number
          token: string
          used_at: string | null
          used_by: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          expires_at?: string
          id?: number
          role?: string
          tenant_id: number
          token?: string
          used_at?: string | null
          used_by?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          expires_at?: string
          id?: number
          role?: string
          tenant_id?: number
          token?: string
          used_at?: string | null
          used_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invites_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string | null
          id: number
          is_read: boolean | null
          link: string | null
          message: string
          tenant_id: number
          title: string
          type: string
          user_id: number
        }
        Insert: {
          created_at?: string | null
          id?: number
          is_read?: boolean | null
          link?: string | null
          message: string
          tenant_id: number
          title: string
          type: string
          user_id: number
        }
        Update: {
          created_at?: string | null
          id?: number
          is_read?: boolean | null
          link?: string | null
          message?: string
          tenant_id?: number
          title?: string
          type?: string
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_settings: {
        Row: {
          alert_webhook_url: string | null
          basic_membership_product_id: string | null
          default_support_email: string
          default_support_phone: string
          id: number
          platform_root_slug: string
          premium_membership_product_id: string | null
        }
        Insert: {
          alert_webhook_url?: string | null
          basic_membership_product_id?: string | null
          default_support_email?: string
          default_support_phone?: string
          id?: number
          platform_root_slug?: string
          premium_membership_product_id?: string | null
        }
        Update: {
          alert_webhook_url?: string | null
          basic_membership_product_id?: string | null
          default_support_email?: string
          default_support_phone?: string
          id?: number
          platform_root_slug?: string
          premium_membership_product_id?: string | null
        }
        Relationships: []
      }
      receipts: {
        Row: {
          created_at: string | null
          expense_id: number | null
          grant_id: number
          id: number
          receipt_files: Json | null
          tenant_id: number
          user_id: number
        }
        Insert: {
          created_at?: string | null
          expense_id?: number | null
          grant_id: number
          id?: number
          receipt_files?: Json | null
          tenant_id: number
          user_id: number
        }
        Update: {
          created_at?: string | null
          expense_id?: number | null
          grant_id?: number
          id?: number
          receipt_files?: Json | null
          tenant_id?: number
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "receipts_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "grant_record"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      sponsorship_inquiries: {
        Row: {
          contact: Json
          created_at: string
          created_by: number | null
          grant_id: number | null
          id: number
          listing_id: number
          message: string | null
          notified_at: string | null
          project: Json
          status: string
          submitted_at: string
          tenant_id: number | null
        }
        Insert: {
          contact: Json
          created_at?: string
          created_by?: number | null
          grant_id?: number | null
          id?: number
          listing_id: number
          message?: string | null
          notified_at?: string | null
          project: Json
          status?: string
          submitted_at?: string
          tenant_id?: number | null
        }
        Update: {
          contact?: Json
          created_at?: string
          created_by?: number | null
          grant_id?: number | null
          id?: number
          listing_id?: number
          message?: string | null
          notified_at?: string | null
          project?: Json
          status?: string
          submitted_at?: string
          tenant_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sponsorship_inquiries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsorship_inquiries_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "grant_record"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsorship_inquiries_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "fiscal_agent_listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsorship_inquiries_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "fiscal_agent_listings_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsorship_inquiries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          canceled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: number
          membership_tier: string
          metadata: Json
          status: string
          stripe_customer_id: string
          stripe_price_id: string
          stripe_product_id: string
          stripe_subscription_id: string
          updated_at: string
          user_id: number
        }
        Insert: {
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: number
          membership_tier: string
          metadata?: Json
          status: string
          stripe_customer_id: string
          stripe_price_id: string
          stripe_product_id: string
          stripe_subscription_id: string
          updated_at?: string
          user_id: number
        }
        Update: {
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: number
          membership_tier?: string
          metadata?: Json
          status?: string
          stripe_customer_id?: string
          stripe_price_id?: string
          stripe_product_id?: string
          stripe_subscription_id?: string
          updated_at?: string
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      system_logs: {
        Row: {
          created_at: string
          error_message: string
          error_stack: string | null
          event_name: string
          id: number
          metadata: Json | null
          severity: string
        }
        Insert: {
          created_at?: string
          error_message: string
          error_stack?: string | null
          event_name: string
          id?: number
          metadata?: Json | null
          severity?: string
        }
        Update: {
          created_at?: string
          error_message?: string
          error_stack?: string | null
          event_name?: string
          id?: number
          metadata?: Json | null
          severity?: string
        }
        Relationships: []
      }
      tenant_settings: {
        Row: {
          require_budget_approval: boolean
          require_expense_approval: boolean
          require_grant_approval: boolean
          require_subscription: boolean
          support_email: string | null
          support_phone: string | null
          tenant_id: number
        }
        Insert: {
          require_budget_approval?: boolean
          require_expense_approval?: boolean
          require_grant_approval?: boolean
          require_subscription?: boolean
          support_email?: string | null
          support_phone?: string | null
          tenant_id: number
        }
        Update: {
          require_budget_approval?: boolean
          require_expense_approval?: boolean
          require_grant_approval?: boolean
          require_subscription?: boolean
          support_email?: string | null
          support_phone?: string | null
          tenant_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "tenant_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          accepts_sponsorships: boolean
          created_at: string | null
          id: number
          is_active: boolean
          name: string
          slug: string
          tenant_type: string
        }
        Insert: {
          accepts_sponsorships?: boolean
          created_at?: string | null
          id?: number
          is_active?: boolean
          name: string
          slug: string
          tenant_type?: string
        }
        Update: {
          accepts_sponsorships?: boolean
          created_at?: string | null
          id?: number
          is_active?: boolean
          name?: string
          slug?: string
          tenant_type?: string
        }
        Relationships: []
      }
      user_memberships: {
        Row: {
          created_at: string
          ends_at: string | null
          id: number
          is_active: boolean
          membership_tier: string
          source: string
          starts_at: string
          subscription_id: number | null
          updated_at: string
          user_id: number
        }
        Insert: {
          created_at?: string
          ends_at?: string | null
          id?: number
          is_active?: boolean
          membership_tier: string
          source?: string
          starts_at?: string
          subscription_id?: number | null
          updated_at?: string
          user_id: number
        }
        Update: {
          created_at?: string
          ends_at?: string | null
          id?: number
          is_active?: boolean
          membership_tier?: string
          source?: string
          starts_at?: string
          subscription_id?: number | null
          updated_at?: string
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_memberships_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string | null
          email: string
          firstname: string
          id: number
          is_active: boolean
          lastname: string
          organization_name: string
          phone_number: string
          role: string | null
          tax_month: number | null
          tenant_id: number
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          firstname: string
          id?: number
          is_active?: boolean
          lastname: string
          organization_name: string
          phone_number: string
          role?: string | null
          tax_month?: number | null
          tenant_id: number
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          firstname?: string
          id?: number
          is_active?: boolean
          lastname?: string
          organization_name?: string
          phone_number?: string
          role?: string | null
          tax_month?: number | null
          tenant_id?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      fiscal_agent_listings_public: {
        Row: {
          accepting: boolean | null
          blurb: string | null
          focus: string[] | null
          id: number | null
          location: string | null
          name: string | null
          rating: number | null
          region: string | null
          reviews: number | null
          sponsored: number | null
          verified: boolean | null
        }
        Insert: {
          accepting?: boolean | null
          blurb?: string | null
          focus?: string[] | null
          id?: number | null
          location?: string | null
          name?: string | null
          rating?: number | null
          region?: string | null
          reviews?: number | null
          sponsored?: number | null
          verified?: boolean | null
        }
        Update: {
          accepting?: boolean | null
          blurb?: string | null
          focus?: string[] | null
          id?: number | null
          location?: string | null
          name?: string | null
          rating?: number | null
          region?: string | null
          reviews?: number | null
          sponsored?: number | null
          verified?: boolean | null
        }
        Relationships: []
      }
      platform_settings_public: {
        Row: {
          basic_membership_product_id: string | null
          default_support_email: string | null
          default_support_phone: string | null
          id: number | null
          platform_root_slug: string | null
          premium_membership_product_id: string | null
        }
        Insert: {
          basic_membership_product_id?: string | null
          default_support_email?: string | null
          default_support_phone?: string | null
          id?: number | null
          platform_root_slug?: string | null
          premium_membership_product_id?: string | null
        }
        Update: {
          basic_membership_product_id?: string | null
          default_support_email?: string | null
          default_support_phone?: string | null
          id?: number | null
          platform_root_slug?: string | null
          premium_membership_product_id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_sponsorship_inquiry: {
        Args: { p_inquiry_id: number }
        Returns: Json
      }
      calculate_grant_budget_totals: {
        Args: { g_id: number }
        Returns: {
          total_budget_allocated: number
          total_budget_items: number
          total_remaining: number
          total_spent: number
        }[]
      }
      consume_invite: {
        Args: { p_token: string; p_user_id: string }
        Returns: boolean
      }
      current_tenant_id: { Args: never; Returns: number }
      get_admin_user_ids: { Args: never; Returns: number[] }
      get_grant_name: { Args: { g_id: number }; Returns: string }
      get_grant_owner: { Args: { g_id: number }; Returns: number }
      get_invite_by_token: {
        Args: { p_token: string }
        Returns: {
          email: string
          expires_at: string
          id: number
          role: string
          tenant_id: number
          tenant_name: string
          used_at: string
        }[]
      }
      get_session_context: { Args: never; Returns: Json }
      has_basic_membership:
        | { Args: never; Returns: boolean }
        | { Args: { p_user_id: number }; Returns: boolean }
      has_feature_access: { Args: { p_feature_key: string }; Returns: boolean }
      has_premium_membership:
        | { Args: never; Returns: boolean }
        | { Args: { p_user_id: number }; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_membership_exempt:
        | { Args: never; Returns: boolean }
        | { Args: { p_user_id: number }; Returns: boolean }
      is_platform_root_tenant: {
        Args: { p_name: string; p_slug: string }
        Returns: boolean
      }
      is_super_admin: { Args: never; Returns: boolean }
      platform_root_slug: { Args: never; Returns: string }
      provision_fiscal_agent_tenant: {
        Args: {
          p_auth_uid: string
          p_email: string
          p_firstname: string
          p_lastname: string
          p_organization: string
          p_phone: string
        }
        Returns: Json
      }
      provision_self_service_tenant: {
        Args: {
          p_auth_uid: string
          p_email: string
          p_firstname: string
          p_lastname: string
          p_organization: string
          p_phone: string
          p_tax_month?: number
        }
        Returns: Json
      }
      register_invited_user: {
        Args: {
          p_firstname: string
          p_lastname: string
          p_organization: string
          p_phone: string
          p_tax_month?: number
          p_token: string
        }
        Returns: Json
      }
      storage_object_tenant_id: { Args: { p_name: string }; Returns: number }
    }
    Enums: {
      [_ in never]: never
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

