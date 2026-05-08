export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      credit_transactions: {
        Row: {
          amount: number
          created_at: string
          id: string
          podcast_id: string | null
          price_paid: number | null
          type: Database["public"]["Enums"]["credit_transaction_type"]
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          podcast_id?: string | null
          price_paid?: number | null
          type: Database["public"]["Enums"]["credit_transaction_type"]
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          podcast_id?: string | null
          price_paid?: number | null
          type?: Database["public"]["Enums"]["credit_transaction_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_credit_transactions_podcast"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "podcasts"
            referencedColumns: ["id"]
          },
        ]
      }
      podcasts: {
        Row: {
          audio_url: string | null
          chapter_markers: Json | null
          chapter_research_map: Json | null
          clarifying_answers: Json | null
          cover_url: string | null
          created_at: string
          deleted_at: string | null
          duration_seconds: number | null
          error_message: string | null
          has_ads: boolean
          id: string
          langgraph_run_id: string | null
          status: Database["public"]["Enums"]["podcast_status"]
          status_history: Json
          status_started_at: string
          topic: string
          transcript: string | null
          user_id: string
          voice: string | null
        }
        Insert: {
          audio_url?: string | null
          chapter_markers?: Json | null
          chapter_research_map?: Json | null
          clarifying_answers?: Json | null
          cover_url?: string | null
          created_at?: string
          deleted_at?: string | null
          duration_seconds?: number | null
          error_message?: string | null
          has_ads?: boolean
          id?: string
          langgraph_run_id?: string | null
          status?: Database["public"]["Enums"]["podcast_status"]
          status_history?: Json
          status_started_at?: string
          topic: string
          transcript?: string | null
          user_id: string
          voice?: string | null
        }
        Update: {
          audio_url?: string | null
          chapter_markers?: Json | null
          chapter_research_map?: Json | null
          clarifying_answers?: Json | null
          cover_url?: string | null
          created_at?: string
          deleted_at?: string | null
          duration_seconds?: number | null
          error_message?: string | null
          has_ads?: boolean
          id?: string
          langgraph_run_id?: string | null
          status?: Database["public"]["Enums"]["podcast_status"]
          status_history?: Json
          status_started_at?: string
          topic?: string
          transcript?: string | null
          user_id?: string
          voice?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          expo_push_token: string | null
          id: string
          notification_preferences: Json | null
          onboarding_complete: boolean
          preferred_voice: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          expo_push_token?: string | null
          id: string
          notification_preferences?: Json | null
          onboarding_complete?: boolean
          preferred_voice?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          expo_push_token?: string | null
          id?: string
          notification_preferences?: Json | null
          onboarding_complete?: boolean
          preferred_voice?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      qa_sessions: {
        Row: {
          chapter_title: string | null
          created_at: string
          duration_seconds: number | null
          elevenlabs_session_id: string | null
          ended_at: string | null
          estimated_cost: number | null
          id: string
          podcast_id: string
          started_at: string
          user_id: string
        }
        Insert: {
          chapter_title?: string | null
          created_at?: string
          duration_seconds?: number | null
          elevenlabs_session_id?: string | null
          ended_at?: string | null
          estimated_cost?: number | null
          id?: string
          podcast_id: string
          started_at?: string
          user_id: string
        }
        Update: {
          chapter_title?: string | null
          created_at?: string
          duration_seconds?: number | null
          elevenlabs_session_id?: string | null
          ended_at?: string | null
          estimated_cost?: number | null
          id?: string
          podcast_id?: string
          started_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qa_sessions_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "podcasts"
            referencedColumns: ["id"]
          },
        ]
      }
      research_contexts: {
        Row: {
          created_at: string
          id: string
          overall_credibility_score: number | null
          podcast_id: string
          raw_response: Json | null
          research_document: Json
          research_iterations: number
          sources: Json
        }
        Insert: {
          created_at?: string
          id?: string
          overall_credibility_score?: number | null
          podcast_id: string
          raw_response?: Json | null
          research_document?: Json
          research_iterations?: number
          sources?: Json
        }
        Update: {
          created_at?: string
          id?: string
          overall_credibility_score?: number | null
          podcast_id?: string
          raw_response?: Json | null
          research_document?: Json
          research_iterations?: number
          sources?: Json
        }
        Relationships: [
          {
            foreignKeyName: "research_contexts_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: true
            referencedRelation: "podcasts"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          billing_period: Database["public"]["Enums"]["billing_period"] | null
          created_at: string
          credits_per_month: number
          credits_remaining: number
          deep_dive_minutes_per_month: number
          deep_dive_minutes_remaining: number
          id: string
          renewal_date: string | null
          revenucat_subscription_id: string | null
          status: Database["public"]["Enums"]["subscription_status"]
          tier: Database["public"]["Enums"]["subscription_tier"]
          updated_at: string
          user_id: string
        }
        Insert: {
          billing_period?: Database["public"]["Enums"]["billing_period"] | null
          created_at?: string
          credits_per_month?: number
          credits_remaining?: number
          deep_dive_minutes_per_month?: number
          deep_dive_minutes_remaining?: number
          id?: string
          renewal_date?: string | null
          revenucat_subscription_id?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          tier?: Database["public"]["Enums"]["subscription_tier"]
          updated_at?: string
          user_id: string
        }
        Update: {
          billing_period?: Database["public"]["Enums"]["billing_period"] | null
          created_at?: string
          credits_per_month?: number
          credits_remaining?: number
          deep_dive_minutes_per_month?: number
          deep_dive_minutes_remaining?: number
          id?: string
          renewal_date?: string | null
          revenucat_subscription_id?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          tier?: Database["public"]["Enums"]["subscription_tier"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      billing_period: "monthly" | "annual"
      credit_transaction_type:
        | "allocation"
        | "purchase"
        | "deduction"
        | "refund"
      podcast_status:
        | "queued"
        | "researching"
        | "fact_checking"
        | "scripting"
        | "generating_audio"
        | "complete"
        | "failed"
      subscription_status: "active" | "cancelled" | "expired" | "billing_issue"
      subscription_tier: "free" | "plus" | "pro"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
