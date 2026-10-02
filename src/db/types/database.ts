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
      ai_actions: {
        Row: {
          ai_request_id: string
          business_id: string
          conversation_id: string | null
          created_at: string
          duration_ms: number | null
          error: string | null
          id: string
          input: Json
          output: Json | null
          status: string
          tool_name: string
        }
        Insert: {
          ai_request_id: string
          business_id: string
          conversation_id?: string | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          input?: Json
          output?: Json | null
          status?: string
          tool_name: string
        }
        Update: {
          ai_request_id?: string
          business_id?: string
          conversation_id?: string | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          input?: Json
          output?: Json | null
          status?: string
          tool_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_actions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_actions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_agents: {
        Row: {
          business_id: string
          created_at: string
          enabled: boolean
          greeting: string | null
          id: string
          language: string
          model: string | null
          name: string
          tone: string
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          enabled?: boolean
          greeting?: string | null
          id?: string
          language?: string
          model?: string | null
          name?: string
          tone?: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          enabled?: boolean
          greeting?: string | null
          id?: string
          language?: string
          model?: string | null
          name?: string
          tone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_agents_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_settings: {
        Row: {
          attribution_window_hours: number
          business_hours: Json
          business_id: string
          created_at: string
          delivery_policy: string | null
          delivery_zones: Json
          discount_rules: string | null
          escalation_rules: string | null
          follow_up_delay_minutes: number
          follow_up_enabled: boolean
          follow_up_max: number
          follow_up_message: string | null
          follow_up_respect_hours: boolean
          follow_up_template_language: string
          follow_up_template_name: string | null
          follow_up_window_end: number
          follow_up_window_start: number
          id: string
          max_discount_percent: number
          payment_rules: string | null
          return_policy: string | null
          updated_at: string
        }
        Insert: {
          attribution_window_hours?: number
          business_hours?: Json
          business_id: string
          created_at?: string
          delivery_policy?: string | null
          delivery_zones?: Json
          discount_rules?: string | null
          escalation_rules?: string | null
          follow_up_delay_minutes?: number
          follow_up_enabled?: boolean
          follow_up_max?: number
          follow_up_message?: string | null
          follow_up_respect_hours?: boolean
          follow_up_template_language?: string
          follow_up_template_name?: string | null
          follow_up_window_end?: number
          follow_up_window_start?: number
          id?: string
          max_discount_percent?: number
          payment_rules?: string | null
          return_policy?: string | null
          updated_at?: string
        }
        Update: {
          attribution_window_hours?: number
          business_hours?: Json
          business_id?: string
          created_at?: string
          delivery_policy?: string | null
          delivery_zones?: Json
          discount_rules?: string | null
          escalation_rules?: string | null
          follow_up_delay_minutes?: number
          follow_up_enabled?: boolean
          follow_up_max?: number
          follow_up_message?: string | null
          follow_up_respect_hours?: boolean
          follow_up_template_language?: string
          follow_up_template_name?: string | null
          follow_up_window_end?: number
          follow_up_window_start?: number
          id?: string
          max_discount_percent?: number
          payment_rules?: string | null
          return_policy?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_settings_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage: {
        Row: {
          ai_request_id: string
          business_id: string
          conversation_id: string | null
          cost_micro_usd: number | null
          created_at: string
          id: string
          input_tokens: number
          latency_ms: number | null
          model: string
          output_tokens: number
        }
        Insert: {
          ai_request_id: string
          business_id: string
          conversation_id?: string | null
          cost_micro_usd?: number | null
          created_at?: string
          id?: string
          input_tokens?: number
          latency_ms?: number | null
          model: string
          output_tokens?: number
        }
        Update: {
          ai_request_id?: string
          business_id?: string
          conversation_id?: string | null
          cost_micro_usd?: number | null
          created_at?: string
          id?: string
          input_tokens?: number
          latency_ms?: number | null
          model?: string
          output_tokens?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_type: string
          actor_user_id: string | null
          business_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: unknown
          metadata: Json
          request_id: string | null
        }
        Insert: {
          action: string
          actor_type?: string
          actor_user_id?: string | null
          business_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          metadata?: Json
          request_id?: string | null
        }
        Update: {
          action?: string
          actor_type?: string
          actor_user_id?: string | null
          business_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          metadata?: Json
          request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_transfer_settings: {
        Row: {
          account_name: string
          account_number: string
          bank_name: string
          business_id: string
          created_at: string
          enabled: boolean
          instructions: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_name: string
          account_number: string
          bank_name: string
          business_id: string
          created_at?: string
          enabled?: boolean
          instructions?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_name?: string
          account_number?: string
          bank_name?: string
          business_id?: string
          created_at?: string
          enabled?: boolean
          instructions?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_transfer_settings_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_events: {
        Row: {
          amount_minor: number | null
          business_id: string | null
          created_at: string
          id: string
          payload: Json
          provider_event_key: string | null
          subscription_id: string | null
          type: string
        }
        Insert: {
          amount_minor?: number | null
          business_id?: string | null
          created_at?: string
          id?: string
          payload?: Json
          provider_event_key?: string | null
          subscription_id?: string | null
          type: string
        }
        Update: {
          amount_minor?: number | null
          business_id?: string | null
          created_at?: string
          id?: string
          payload?: Json
          provider_event_key?: string | null
          subscription_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_events_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_invoices: {
        Row: {
          amount_minor: number
          authorization_url: string | null
          business_id: string
          created_at: string
          created_by: string | null
          currency: string
          failure_reason: string | null
          id: string
          kind: Database["public"]["Enums"]["invoice_kind"]
          paid_at: string | null
          period_end: string | null
          period_start: string | null
          plan_id: string
          provider_response: Json
          reference: string
          status: Database["public"]["Enums"]["invoice_status"]
          subscription_id: string
          updated_at: string
        }
        Insert: {
          amount_minor: number
          authorization_url?: string | null
          business_id: string
          created_at?: string
          created_by?: string | null
          currency: string
          failure_reason?: string | null
          id?: string
          kind: Database["public"]["Enums"]["invoice_kind"]
          paid_at?: string | null
          period_end?: string | null
          period_start?: string | null
          plan_id: string
          provider_response?: Json
          reference: string
          status?: Database["public"]["Enums"]["invoice_status"]
          subscription_id: string
          updated_at?: string
        }
        Update: {
          amount_minor?: number
          authorization_url?: string | null
          business_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          failure_reason?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["invoice_kind"]
          paid_at?: string | null
          period_end?: string | null
          period_start?: string | null
          plan_id?: string
          provider_response?: Json
          reference?: string
          status?: Database["public"]["Enums"]["invoice_status"]
          subscription_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_invoices_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_invoices_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_invoices_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      business_credentials: {
        Row: {
          business_id: string
          ciphertext: string
          created_at: string
          expires_at: string | null
          id: string
          key_version: number
          label: string
          last_four: string | null
          provider: string
          updated_at: string
        }
        Insert: {
          business_id: string
          ciphertext: string
          created_at?: string
          expires_at?: string | null
          id?: string
          key_version?: number
          label?: string
          last_four?: string | null
          provider: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          ciphertext?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          key_version?: number
          label?: string
          last_four?: string | null
          provider?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_credentials_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_invitations: {
        Row: {
          accepted_at: string | null
          business_id: string
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          permissions: string[]
          role: Database["public"]["Enums"]["member_role"]
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          business_id: string
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          permissions?: string[]
          role?: Database["public"]["Enums"]["member_role"]
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          business_id?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          permissions?: string[]
          role?: Database["public"]["Enums"]["member_role"]
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_invitations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_members: {
        Row: {
          business_id: string
          created_at: string
          id: string
          invited_by: string | null
          permissions: string[]
          role: Database["public"]["Enums"]["member_role"]
          status: Database["public"]["Enums"]["member_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          invited_by?: string | null
          permissions?: string[]
          role?: Database["public"]["Enums"]["member_role"]
          status?: Database["public"]["Enums"]["member_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          invited_by?: string | null
          permissions?: string[]
          role?: Database["public"]["Enums"]["member_role"]
          status?: Database["public"]["Enums"]["member_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_members_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      businesses: {
        Row: {
          address: string | null
          country: string
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          id: string
          industry: string | null
          logo_path: string | null
          name: string
          onboarding_completed_at: string | null
          onboarding_step: string
          order_seq: number
          phone: string | null
          slug: string
          social_links: Json
          status: Database["public"]["Enums"]["business_status"]
          suspended_reason: string | null
          timezone: string
          updated_at: string
          website: string | null
        }
        Insert: {
          address?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          id?: string
          industry?: string | null
          logo_path?: string | null
          name: string
          onboarding_completed_at?: string | null
          onboarding_step?: string
          order_seq?: number
          phone?: string | null
          slug: string
          social_links?: Json
          status?: Database["public"]["Enums"]["business_status"]
          suspended_reason?: string | null
          timezone?: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          address?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          id?: string
          industry?: string | null
          logo_path?: string | null
          name?: string
          onboarding_completed_at?: string | null
          onboarding_step?: string
          order_seq?: number
          phone?: string | null
          slug?: string
          social_links?: Json
          status?: Database["public"]["Enums"]["business_status"]
          suspended_reason?: string | null
          timezone?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      campaign_recipients: {
        Row: {
          business_id: string
          campaign_id: string
          converted_order_id: string | null
          created_at: string
          customer_id: string
          delivered_at: string | null
          error: string | null
          id: string
          read_at: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["campaign_recipient_status"]
          wa_message_id: string | null
        }
        Insert: {
          business_id: string
          campaign_id: string
          converted_order_id?: string | null
          created_at?: string
          customer_id: string
          delivered_at?: string | null
          error?: string | null
          id?: string
          read_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["campaign_recipient_status"]
          wa_message_id?: string | null
        }
        Update: {
          business_id?: string
          campaign_id?: string
          converted_order_id?: string | null
          created_at?: string
          customer_id?: string
          delivered_at?: string | null
          error?: string | null
          id?: string
          read_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["campaign_recipient_status"]
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_recipients_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_recipients_converted_order_id_fkey"
            columns: ["converted_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_recipients_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          business_id: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          product_id: string | null
          scheduled_at: string | null
          segment: Json
          started_at: string | null
          stats: Json
          status: Database["public"]["Enums"]["campaign_status"]
          template_language: string | null
          template_name: string | null
          template_params: Json
          updated_at: string
        }
        Insert: {
          business_id: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          product_id?: string | null
          scheduled_at?: string | null
          segment?: Json
          started_at?: string | null
          stats?: Json
          status?: Database["public"]["Enums"]["campaign_status"]
          template_language?: string | null
          template_name?: string | null
          template_params?: Json
          updated_at?: string
        }
        Update: {
          business_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          product_id?: string | null
          scheduled_at?: string | null
          segment?: Json
          started_at?: string | null
          stats?: Json
          status?: Database["public"]["Enums"]["campaign_status"]
          template_language?: string | null
          template_name?: string | null
          template_params?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_events: {
        Row: {
          actor_type: string
          actor_user_id: string | null
          business_id: string
          conversation_id: string
          created_at: string
          data: Json
          id: string
          type: string
        }
        Insert: {
          actor_type?: string
          actor_user_id?: string | null
          business_id: string
          conversation_id: string
          created_at?: string
          data?: Json
          id?: string
          type: string
        }
        Update: {
          actor_type?: string
          actor_user_id?: string | null
          business_id?: string
          conversation_id?: string
          created_at?: string
          data?: Json
          id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_events_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          ai_mode: Database["public"]["Enums"]["ai_mode"]
          assigned_to: string | null
          business_id: string
          created_at: string
          customer_id: string
          id: string
          last_customer_message_at: string | null
          last_message_at: string | null
          last_message_preview: string | null
          needs_attention: boolean
          purchase_intent_at: string | null
          purchase_stage: Database["public"]["Enums"]["purchase_stage"]
          sales_outcome: Database["public"]["Enums"]["sales_outcome"]
          state: Json
          status: Database["public"]["Enums"]["conversation_status"]
          summary: string | null
          unread_count: number
          updated_at: string
          whatsapp_account_id: string | null
        }
        Insert: {
          ai_mode?: Database["public"]["Enums"]["ai_mode"]
          assigned_to?: string | null
          business_id: string
          created_at?: string
          customer_id: string
          id?: string
          last_customer_message_at?: string | null
          last_message_at?: string | null
          last_message_preview?: string | null
          needs_attention?: boolean
          purchase_intent_at?: string | null
          purchase_stage?: Database["public"]["Enums"]["purchase_stage"]
          sales_outcome?: Database["public"]["Enums"]["sales_outcome"]
          state?: Json
          status?: Database["public"]["Enums"]["conversation_status"]
          summary?: string | null
          unread_count?: number
          updated_at?: string
          whatsapp_account_id?: string | null
        }
        Update: {
          ai_mode?: Database["public"]["Enums"]["ai_mode"]
          assigned_to?: string | null
          business_id?: string
          created_at?: string
          customer_id?: string
          id?: string
          last_customer_message_at?: string | null
          last_message_at?: string | null
          last_message_preview?: string | null
          needs_attention?: boolean
          purchase_intent_at?: string | null
          purchase_stage?: Database["public"]["Enums"]["purchase_stage"]
          sales_outcome?: Database["public"]["Enums"]["sales_outcome"]
          state?: Json
          status?: Database["public"]["Enums"]["conversation_status"]
          summary?: string | null
          unread_count?: number
          updated_at?: string
          whatsapp_account_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_whatsapp_account_id_fkey"
            columns: ["whatsapp_account_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_tags: {
        Row: {
          business_id: string
          created_at: string
          customer_id: string
          id: string
          tag: string
        }
        Insert: {
          business_id: string
          created_at?: string
          customer_id: string
          id?: string
          tag: string
        }
        Update: {
          business_id?: string
          created_at?: string
          customer_id?: string
          id?: string
          tag?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_tags_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_tags_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: Json | null
          business_id: string
          created_at: string
          email: string | null
          id: string
          last_interaction_at: string | null
          last_purchase_at: string | null
          marketing_opt_in: boolean
          metadata: Json
          name: string | null
          notes: string | null
          opted_out_at: string | null
          phone: string
          profile_name: string | null
          status: Database["public"]["Enums"]["customer_status"]
          total_orders: number
          total_spend_minor: number
          updated_at: string
          wa_id: string
        }
        Insert: {
          address?: Json | null
          business_id: string
          created_at?: string
          email?: string | null
          id?: string
          last_interaction_at?: string | null
          last_purchase_at?: string | null
          marketing_opt_in?: boolean
          metadata?: Json
          name?: string | null
          notes?: string | null
          opted_out_at?: string | null
          phone: string
          profile_name?: string | null
          status?: Database["public"]["Enums"]["customer_status"]
          total_orders?: number
          total_spend_minor?: number
          updated_at?: string
          wa_id: string
        }
        Update: {
          address?: Json | null
          business_id?: string
          created_at?: string
          email?: string | null
          id?: string
          last_interaction_at?: string | null
          last_purchase_at?: string | null
          marketing_opt_in?: boolean
          metadata?: Json
          name?: string | null
          notes?: string | null
          opted_out_at?: string | null
          phone?: string
          profile_name?: string | null
          status?: Database["public"]["Enums"]["customer_status"]
          total_orders?: number
          total_spend_minor?: number
          updated_at?: string
          wa_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      follow_ups: {
        Row: {
          business_id: string
          cancel_reason: string | null
          channel: string | null
          conversation_id: string
          created_at: string
          customer_id: string
          id: string
          message: string | null
          message_id: string | null
          order_id: string | null
          scheduled_for: string
          sent_at: string | null
          sequence_number: number
          status: Database["public"]["Enums"]["follow_up_status"]
          updated_at: string
        }
        Insert: {
          business_id: string
          cancel_reason?: string | null
          channel?: string | null
          conversation_id: string
          created_at?: string
          customer_id: string
          id?: string
          message?: string | null
          message_id?: string | null
          order_id?: string | null
          scheduled_for: string
          sent_at?: string | null
          sequence_number?: number
          status?: Database["public"]["Enums"]["follow_up_status"]
          updated_at?: string
        }
        Update: {
          business_id?: string
          cancel_reason?: string | null
          channel?: string | null
          conversation_id?: string
          created_at?: string
          customer_id?: string
          id?: string
          message?: string | null
          message_id?: string | null
          order_id?: string | null
          scheduled_for?: string
          sent_at?: string | null
          sequence_number?: number
          status?: Database["public"]["Enums"]["follow_up_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_ups_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_ups_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_ups_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_ups_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_ups_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          actor_user_id: string | null
          business_id: string
          created_at: string
          delta: number
          id: string
          note: string | null
          order_id: string | null
          product_id: string
          reason: string
          variant_id: string | null
        }
        Insert: {
          actor_user_id?: string | null
          business_id: string
          created_at?: string
          delta: number
          id?: string
          note?: string | null
          order_id?: string | null
          product_id: string
          reason: string
          variant_id?: string | null
        }
        Update: {
          actor_user_id?: string | null
          business_id?: string
          created_at?: string
          delta?: number
          id?: string
          note?: string | null
          order_id?: string | null
          product_id?: string
          reason?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          ai_request_id: string | null
          body: string | null
          business_id: string
          content: Json
          conversation_id: string
          created_at: string
          direction: Database["public"]["Enums"]["message_direction"]
          error: string | null
          id: string
          sender: Database["public"]["Enums"]["message_sender"]
          sender_user_id: string | null
          status: Database["public"]["Enums"]["message_status"]
          type: string
          updated_at: string
          wa_message_id: string | null
        }
        Insert: {
          ai_request_id?: string | null
          body?: string | null
          business_id: string
          content?: Json
          conversation_id: string
          created_at?: string
          direction: Database["public"]["Enums"]["message_direction"]
          error?: string | null
          id?: string
          sender: Database["public"]["Enums"]["message_sender"]
          sender_user_id?: string | null
          status: Database["public"]["Enums"]["message_status"]
          type?: string
          updated_at?: string
          wa_message_id?: string | null
        }
        Update: {
          ai_request_id?: string | null
          body?: string | null
          business_id?: string
          content?: Json
          conversation_id?: string
          created_at?: string
          direction?: Database["public"]["Enums"]["message_direction"]
          error?: string | null
          id?: string
          sender?: Database["public"]["Enums"]["message_sender"]
          sender_user_id?: string | null
          status?: Database["public"]["Enums"]["message_status"]
          type?: string
          updated_at?: string
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          business_id: string
          created_at: string
          data: Json
          id: string
          read_at: string | null
          title: string
          type: string
          user_id: string | null
        }
        Insert: {
          body?: string | null
          business_id: string
          created_at?: string
          data?: Json
          id?: string
          read_at?: string | null
          title: string
          type: string
          user_id?: string | null
        }
        Update: {
          body?: string | null
          business_id?: string
          created_at?: string
          data?: Json
          id?: string
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          business_id: string
          created_at: string
          id: string
          name: string
          order_id: string
          product_id: string | null
          quantity: number
          total_minor: number
          unit_price_minor: number
          variant_id: string | null
          variant_label: string | null
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          name: string
          order_id: string
          product_id?: string | null
          quantity: number
          total_minor: number
          unit_price_minor: number
          variant_id?: string | null
          variant_label?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          name?: string
          order_id?: string
          product_id?: string | null
          quantity?: number
          total_minor?: number
          unit_price_minor?: number
          variant_id?: string | null
          variant_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          ai_assisted: boolean
          business_id: string
          campaign_id: string | null
          cancelled_at: string | null
          confirmed_by_customer_at: string | null
          conversation_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          customer_id: string
          customer_name: string
          customer_phone: string
          delivery_address: Json
          delivery_fee_minor: number
          discount_minor: number
          id: string
          idempotency_key: string | null
          notes: string | null
          order_number: number
          paid_at: string | null
          recovered_by_follow_up_id: string | null
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          subtotal_minor: number
          total_minor: number
          updated_at: string
        }
        Insert: {
          ai_assisted?: boolean
          business_id: string
          campaign_id?: string | null
          cancelled_at?: string | null
          confirmed_by_customer_at?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_id: string
          customer_name: string
          customer_phone: string
          delivery_address?: Json
          delivery_fee_minor?: number
          discount_minor?: number
          id?: string
          idempotency_key?: string | null
          notes?: string | null
          order_number: number
          paid_at?: string | null
          recovered_by_follow_up_id?: string | null
          source?: Database["public"]["Enums"]["order_source"]
          status?: Database["public"]["Enums"]["order_status"]
          subtotal_minor: number
          total_minor: number
          updated_at?: string
        }
        Update: {
          ai_assisted?: boolean
          business_id?: string
          campaign_id?: string | null
          cancelled_at?: string | null
          confirmed_by_customer_at?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_id?: string
          customer_name?: string
          customer_phone?: string
          delivery_address?: Json
          delivery_fee_minor?: number
          discount_minor?: number
          id?: string
          idempotency_key?: string | null
          notes?: string | null
          order_number?: number
          paid_at?: string | null
          recovered_by_follow_up_id?: string | null
          source?: Database["public"]["Enums"]["order_source"]
          status?: Database["public"]["Enums"]["order_status"]
          subtotal_minor?: number
          total_minor?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_campaign_fk"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_recovered_by_follow_up_fk"
            columns: ["recovered_by_follow_up_id"]
            isOneToOne: false
            referencedRelation: "follow_ups"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_events: {
        Row: {
          business_id: string | null
          error: string | null
          event_key: string
          event_type: string
          id: string
          payload: Json
          payment_id: string | null
          processed_at: string | null
          provider: string
          received_at: string
          request_id: string | null
          status: Database["public"]["Enums"]["event_status"]
        }
        Insert: {
          business_id?: string | null
          error?: string | null
          event_key: string
          event_type: string
          id?: string
          payload: Json
          payment_id?: string | null
          processed_at?: string | null
          provider?: string
          received_at?: string
          request_id?: string | null
          status?: Database["public"]["Enums"]["event_status"]
        }
        Update: {
          business_id?: string | null
          error?: string | null
          event_key?: string
          event_type?: string
          id?: string
          payload?: Json
          payment_id?: string | null
          processed_at?: string | null
          provider?: string
          received_at?: string
          request_id?: string | null
          status?: Database["public"]["Enums"]["event_status"]
        }
        Relationships: [
          {
            foreignKeyName: "payment_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_events_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          access_code: string | null
          amount_minor: number
          authorization_url: string | null
          business_id: string
          channel: string | null
          claimed_at: string | null
          collection_mode: string
          confirmed_by: string | null
          created_at: string
          currency: string
          failure_reason: string | null
          id: string
          order_id: string
          paid_at: string | null
          platform_fee_minor: number
          proof_message_id: string | null
          provider: string
          provider_response: Json
          provider_transaction_id: string | null
          reference: string
          refund_requested_at: string | null
          refunded_amount_minor: number | null
          refunded_at: string | null
          rejected_at: string | null
          rejection_note: string | null
          status: Database["public"]["Enums"]["payment_status"]
          subaccount_code: string | null
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          access_code?: string | null
          amount_minor: number
          authorization_url?: string | null
          business_id: string
          channel?: string | null
          claimed_at?: string | null
          collection_mode?: string
          confirmed_by?: string | null
          created_at?: string
          currency: string
          failure_reason?: string | null
          id?: string
          order_id: string
          paid_at?: string | null
          platform_fee_minor?: number
          proof_message_id?: string | null
          provider?: string
          provider_response?: Json
          provider_transaction_id?: string | null
          reference: string
          refund_requested_at?: string | null
          refunded_amount_minor?: number | null
          refunded_at?: string | null
          rejected_at?: string | null
          rejection_note?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          subaccount_code?: string | null
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          access_code?: string | null
          amount_minor?: number
          authorization_url?: string | null
          business_id?: string
          channel?: string | null
          claimed_at?: string | null
          collection_mode?: string
          confirmed_by?: string | null
          created_at?: string
          currency?: string
          failure_reason?: string | null
          id?: string
          order_id?: string
          paid_at?: string | null
          platform_fee_minor?: number
          proof_message_id?: string | null
          provider?: string
          provider_response?: Json
          provider_transaction_id?: string | null
          reference?: string
          refund_requested_at?: string | null
          refunded_amount_minor?: number | null
          refunded_at?: string | null
          rejected_at?: string | null
          rejection_note?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          subaccount_code?: string | null
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_proof_message_id_fkey"
            columns: ["proof_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_accounts: {
        Row: {
          account_name: string
          account_number_last4: string
          bank_code: string
          bank_name: string
          business_id: string
          created_at: string
          created_by: string | null
          id: string
          provider: string
          status: string
          subaccount_code: string
          updated_at: string
        }
        Insert: {
          account_name: string
          account_number_last4: string
          bank_code: string
          bank_name: string
          business_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          provider?: string
          status?: string
          subaccount_code: string
          updated_at?: string
        }
        Update: {
          account_name?: string
          account_number_last4?: string
          bank_code?: string
          bank_name?: string
          business_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          provider?: string
          status?: string
          subaccount_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payout_accounts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          description: string
          key: string
        }
        Insert: {
          description: string
          key: string
        }
        Update: {
          description?: string
          key?: string
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      product_images: {
        Row: {
          alt: string | null
          business_id: string
          created_at: string
          id: string
          position: number
          product_id: string
          storage_path: string
        }
        Insert: {
          alt?: string | null
          business_id: string
          created_at?: string
          id?: string
          position?: number
          product_id: string
          storage_path: string
        }
        Update: {
          alt?: string | null
          business_id?: string
          created_at?: string
          id?: string
          position?: number
          product_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_images_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          business_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          options: Json
          price_minor: number | null
          product_id: string
          sku: string | null
          stock_quantity: number
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          options?: Json
          price_minor?: number | null
          product_id: string
          sku?: string | null
          stock_quantity?: number
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          options?: Json
          price_minor?: number | null
          product_id?: string
          sku?: string | null
          stock_quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          brand: string | null
          business_id: string
          category: string | null
          created_at: string
          currency: string
          description: string | null
          id: string
          metadata: Json
          name: string
          price_minor: number
          search_vector: unknown
          sku: string | null
          status: Database["public"]["Enums"]["product_status"]
          stock_quantity: number
          track_inventory: boolean
          updated_at: string
        }
        Insert: {
          brand?: string | null
          business_id: string
          category?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          metadata?: Json
          name: string
          price_minor: number
          search_vector?: unknown
          sku?: string | null
          status?: Database["public"]["Enums"]["product_status"]
          stock_quantity?: number
          track_inventory?: boolean
          updated_at?: string
        }
        Update: {
          brand?: string | null
          business_id?: string
          category?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          metadata?: Json
          name?: string
          price_minor?: number
          search_vector?: unknown
          sku?: string | null
          status?: Database["public"]["Enums"]["product_status"]
          stock_quantity?: number
          track_inventory?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          is_platform_admin: boolean
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          is_platform_admin?: boolean
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          is_platform_admin?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      subscription_plans: {
        Row: {
          code: string
          created_at: string
          currency: string
          description: string | null
          features: Json
          id: string
          interval: string
          is_active: boolean
          is_public: boolean
          limits: Json
          name: string
          paystack_plan_code: string | null
          price_minor: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          currency?: string
          description?: string | null
          features?: Json
          id?: string
          interval?: string
          is_active?: boolean
          is_public?: boolean
          limits?: Json
          name: string
          paystack_plan_code?: string | null
          price_minor: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          currency?: string
          description?: string | null
          features?: Json
          id?: string
          interval?: string
          is_active?: boolean
          is_public?: boolean
          limits?: Json
          name?: string
          paystack_plan_code?: string | null
          price_minor?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          billing_email: string | null
          business_id: string
          cancel_at_period_end: boolean
          cancelled_at: string | null
          card_brand: string | null
          card_exp: string | null
          card_last4: string | null
          created_at: string
          current_period_end: string
          current_period_start: string
          id: string
          is_complimentary: boolean
          next_renewal_attempt_at: string | null
          past_due_since: string | null
          paystack_customer_code: string | null
          paystack_email_token: string | null
          paystack_subscription_code: string | null
          pending_plan_id: string | null
          plan_id: string
          renewal_attempts: number
          status: Database["public"]["Enums"]["subscription_status"]
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          billing_email?: string | null
          business_id: string
          cancel_at_period_end?: boolean
          cancelled_at?: string | null
          card_brand?: string | null
          card_exp?: string | null
          card_last4?: string | null
          created_at?: string
          current_period_end?: string
          current_period_start?: string
          id?: string
          is_complimentary?: boolean
          next_renewal_attempt_at?: string | null
          past_due_since?: string | null
          paystack_customer_code?: string | null
          paystack_email_token?: string | null
          paystack_subscription_code?: string | null
          pending_plan_id?: string | null
          plan_id: string
          renewal_attempts?: number
          status?: Database["public"]["Enums"]["subscription_status"]
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          billing_email?: string | null
          business_id?: string
          cancel_at_period_end?: boolean
          cancelled_at?: string | null
          card_brand?: string | null
          card_exp?: string | null
          card_last4?: string | null
          created_at?: string
          current_period_end?: string
          current_period_start?: string
          id?: string
          is_complimentary?: boolean
          next_renewal_attempt_at?: string | null
          past_due_since?: string | null
          paystack_customer_code?: string | null
          paystack_email_token?: string | null
          paystack_subscription_code?: string | null
          pending_plan_id?: string | null
          plan_id?: string
          renewal_attempts?: number
          status?: Database["public"]["Enums"]["subscription_status"]
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_pending_plan_id_fkey"
            columns: ["pending_plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_records: {
        Row: {
          business_id: string
          id: string
          metric: string
          period_start: string
          quantity: number
          updated_at: string
        }
        Insert: {
          business_id: string
          id?: string
          metric: string
          period_start: string
          quantity?: number
          updated_at?: string
        }
        Update: {
          business_id?: string
          id?: string
          metric?: string
          period_start?: string
          quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_records_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_accounts: {
        Row: {
          business_id: string
          connected_at: string | null
          created_at: string
          credential_id: string | null
          display_phone_number: string | null
          id: string
          last_error: string | null
          meta_business_id: string | null
          phone_number_id: string
          quality_rating: string | null
          status: Database["public"]["Enums"]["whatsapp_account_status"]
          updated_at: string
          verified_name: string | null
          waba_id: string
        }
        Insert: {
          business_id: string
          connected_at?: string | null
          created_at?: string
          credential_id?: string | null
          display_phone_number?: string | null
          id?: string
          last_error?: string | null
          meta_business_id?: string | null
          phone_number_id: string
          quality_rating?: string | null
          status?: Database["public"]["Enums"]["whatsapp_account_status"]
          updated_at?: string
          verified_name?: string | null
          waba_id: string
        }
        Update: {
          business_id?: string
          connected_at?: string | null
          created_at?: string
          credential_id?: string | null
          display_phone_number?: string | null
          id?: string
          last_error?: string | null
          meta_business_id?: string | null
          phone_number_id?: string
          quality_rating?: string | null
          status?: Database["public"]["Enums"]["whatsapp_account_status"]
          updated_at?: string
          verified_name?: string | null
          waba_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_accounts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_accounts_credential_id_fkey"
            columns: ["credential_id"]
            isOneToOne: false
            referencedRelation: "business_credentials"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_events: {
        Row: {
          attempts: number
          business_id: string | null
          error: string | null
          event_key: string
          event_type: string
          id: string
          payload: Json
          phone_number_id: string | null
          processed_at: string | null
          received_at: string
          request_id: string | null
          status: Database["public"]["Enums"]["event_status"]
          whatsapp_account_id: string | null
        }
        Insert: {
          attempts?: number
          business_id?: string | null
          error?: string | null
          event_key: string
          event_type: string
          id?: string
          payload: Json
          phone_number_id?: string | null
          processed_at?: string | null
          received_at?: string
          request_id?: string | null
          status?: Database["public"]["Enums"]["event_status"]
          whatsapp_account_id?: string | null
        }
        Update: {
          attempts?: number
          business_id?: string | null
          error?: string | null
          event_key?: string
          event_type?: string
          id?: string
          payload?: Json
          phone_number_id?: string | null
          processed_at?: string | null
          received_at?: string
          request_id?: string | null
          status?: Database["public"]["Enums"]["event_status"]
          whatsapp_account_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_events_whatsapp_account_id_fkey"
            columns: ["whatsapp_account_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invitation: { Args: { p_token: string }; Returns: string }
      admin_platform_stats: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      advance_subscription_states: { Args: { p_grace?: string }; Returns: Json }
      analytics_report: {
        Args: { p_business_id: string; p_from: string; p_to: string }
        Returns: Json
      }
      apply_billing_payment: {
        Args: {
          p_amount_minor: number
          p_card?: Json
          p_currency: string
          p_paid_at: string
          p_provider_response?: Json
          p_reference: string
        }
        Returns: Json
      }
      cancel_order: {
        Args: {
          p_actor?: string
          p_business_id: string
          p_order_id: string
          p_reason: string
        }
        Returns: boolean
      }
      claim_ai_conversation: {
        Args: {
          p_business_id: string
          p_conversation_id: string
          p_limit: number
        }
        Returns: boolean
      }
      claim_follow_up: {
        Args: {
          p_channel: string
          p_follow_up_id: string
          p_message: string
          p_order_id: string
        }
        Returns: boolean
      }
      confirm_bank_transfer: {
        Args: { p_business_id: string; p_payment_id: string; p_user_id: string }
        Returns: Json
      }
      create_business: {
        Args: {
          p_country?: string
          p_currency?: string
          p_industry?: string
          p_name: string
          p_timezone?: string
        }
        Returns: string
      }
      create_order: {
        Args: {
          p_ai_assisted: boolean
          p_business_id: string
          p_conversation_id: string
          p_created_by?: string
          p_customer_id: string
          p_customer_name: string
          p_delivery_address: string
          p_delivery_zone: string
          p_idempotency_key: string
          p_items: Json
          p_notes?: string
          p_source: Database["public"]["Enums"]["order_source"]
        }
        Returns: string
      }
      expire_stale_orders: { Args: { p_older_than?: string }; Returns: number }
      follow_up_stop_reason: {
        Args: { p_conversation_id: string }
        Returns: string
      }
      get_invitation: {
        Args: { p_token: string }
        Returns: {
          accepted: boolean
          business_name: string
          email: string
          expired: boolean
          role: Database["public"]["Enums"]["member_role"]
        }[]
      }
      import_products: {
        Args: { p_business_id: string; p_rows: Json }
        Returns: {
          inserted: number
          updated: number
        }[]
      }
      mark_payment_failed: {
        Args: {
          p_business_id: string
          p_payment_id: string
          p_reason: string
          p_status: Database["public"]["Enums"]["payment_status"]
        }
        Returns: boolean
      }
      mark_payment_refunded: {
        Args: {
          p_amount_minor: number
          p_business_id: string
          p_payment_id: string
        }
        Returns: boolean
      }
      mark_payment_succeeded: {
        Args: {
          p_amount_minor: number
          p_business_id: string
          p_channel: string
          p_currency: string
          p_paid_at: string
          p_payment_id: string
          p_provider_response: Json
          p_provider_transaction_id: string
        }
        Returns: Json
      }
      mark_renewal_failed: {
        Args: { p_invoice_id: string; p_next_attempt: string; p_reason: string }
        Returns: undefined
      }
      quote_order: {
        Args: { p_business_id: string; p_delivery_zone?: string; p_items: Json }
        Returns: Json
      }
      record_usage: {
        Args: {
          p_at?: string
          p_business_id: string
          p_metric: string
          p_quantity?: number
          p_subject_id?: string
        }
        Returns: number
      }
      reject_bank_transfer: {
        Args: {
          p_business_id: string
          p_note: string
          p_payment_id: string
          p_user_id: string
        }
        Returns: boolean
      }
      schedule_follow_ups: { Args: { p_limit?: number }; Returns: Json }
      search_products: {
        Args: { p_business_id: string; p_limit?: number; p_query: string }
        Returns: {
          brand: string
          category: string
          currency: string
          description: string
          id: string
          name: string
          price_minor: number
          score: number
          sku: string
          stock_quantity: number
          track_inventory: boolean
          variant_count: number
        }[]
      }
      set_subscription_schedule: {
        Args: {
          p_business_id: string
          p_cancel_at_period_end: boolean
          p_pending_plan_code: string
        }
        Returns: undefined
      }
    }
    Enums: {
      ai_mode: "AI_ACTIVE" | "HUMAN_ACTIVE" | "PAUSED"
      business_status: "active" | "suspended" | "closed"
      campaign_recipient_status:
        | "pending"
        | "sent"
        | "delivered"
        | "read"
        | "failed"
        | "skipped"
      campaign_status:
        | "draft"
        | "scheduled"
        | "sending"
        | "completed"
        | "cancelled"
        | "failed"
      conversation_status: "open" | "closed"
      customer_status:
        | "lead"
        | "interested"
        | "customer"
        | "repeat_customer"
        | "inactive"
      event_status:
        | "received"
        | "processing"
        | "processed"
        | "ignored"
        | "failed"
      follow_up_status:
        | "scheduled"
        | "sent"
        | "cancelled"
        | "failed"
        | "skipped"
      invoice_kind: "subscribe" | "upgrade" | "renewal"
      invoice_status: "pending" | "paid" | "failed" | "void"
      member_role: "owner" | "admin" | "staff"
      member_status: "active" | "invited" | "disabled"
      message_direction: "inbound" | "outbound"
      message_sender: "customer" | "ai" | "staff" | "system" | "automation"
      message_status:
        | "received"
        | "queued"
        | "sent"
        | "delivered"
        | "read"
        | "failed"
      order_source: "ai" | "staff" | "campaign"
      order_status:
        | "draft"
        | "pending_payment"
        | "paid"
        | "processing"
        | "shipped"
        | "delivered"
        | "cancelled"
        | "refunded"
      payment_status:
        | "initialized"
        | "pending"
        | "success"
        | "failed"
        | "abandoned"
        | "reversed"
        | "refunded"
      product_status: "active" | "draft" | "archived"
      purchase_stage:
        | "new"
        | "product_discovery"
        | "product_question"
        | "purchase_intent"
        | "collecting_customer_details"
        | "order_confirmation"
        | "payment_pending"
        | "paid"
        | "delivery"
        | "completed"
        | "human_handoff"
      sales_outcome: "none" | "interested_not_purchased" | "purchased" | "lost"
      subscription_status:
        | "trialing"
        | "active"
        | "past_due"
        | "cancelled"
        | "expired"
      whatsapp_account_status:
        | "pending"
        | "connected"
        | "disconnected"
        | "error"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      ai_mode: ["AI_ACTIVE", "HUMAN_ACTIVE", "PAUSED"],
      business_status: ["active", "suspended", "closed"],
      campaign_recipient_status: [
        "pending",
        "sent",
        "delivered",
        "read",
        "failed",
        "skipped",
      ],
      campaign_status: [
        "draft",
        "scheduled",
        "sending",
        "completed",
        "cancelled",
        "failed",
      ],
      conversation_status: ["open", "closed"],
      customer_status: [
        "lead",
        "interested",
        "customer",
        "repeat_customer",
        "inactive",
      ],
      event_status: [
        "received",
        "processing",
        "processed",
        "ignored",
        "failed",
      ],
      follow_up_status: ["scheduled", "sent", "cancelled", "failed", "skipped"],
      invoice_kind: ["subscribe", "upgrade", "renewal"],
      invoice_status: ["pending", "paid", "failed", "void"],
      member_role: ["owner", "admin", "staff"],
      member_status: ["active", "invited", "disabled"],
      message_direction: ["inbound", "outbound"],
      message_sender: ["customer", "ai", "staff", "system", "automation"],
      message_status: [
        "received",
        "queued",
        "sent",
        "delivered",
        "read",
        "failed",
      ],
      order_source: ["ai", "staff", "campaign"],
      order_status: [
        "draft",
        "pending_payment",
        "paid",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
        "refunded",
      ],
      payment_status: [
        "initialized",
        "pending",
        "success",
        "failed",
        "abandoned",
        "reversed",
        "refunded",
      ],
      product_status: ["active", "draft", "archived"],
      purchase_stage: [
        "new",
        "product_discovery",
        "product_question",
        "purchase_intent",
        "collecting_customer_details",
        "order_confirmation",
        "payment_pending",
        "paid",
        "delivery",
        "completed",
        "human_handoff",
      ],
      sales_outcome: ["none", "interested_not_purchased", "purchased", "lost"],
      subscription_status: [
        "trialing",
        "active",
        "past_due",
        "cancelled",
        "expired",
      ],
      whatsapp_account_status: [
        "pending",
        "connected",
        "disconnected",
        "error",
      ],
    },
  },
} as const
