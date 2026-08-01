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
      admin_unit: {
        Row: {
          created_at: string
          id: string
          level: Database["public"]["Enums"]["admin_unit_level"]
          name: string
          parent_id: string | null
          path: unknown
        }
        Insert: {
          created_at?: string
          id?: string
          level: Database["public"]["Enums"]["admin_unit_level"]
          name: string
          parent_id?: string | null
          path?: unknown
        }
        Update: {
          created_at?: string
          id?: string
          level?: Database["public"]["Enums"]["admin_unit_level"]
          name?: string
          parent_id?: string | null
          path?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "admin_unit_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "admin_unit"
            referencedColumns: ["id"]
          },
        ]
      }
      app_user: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          favorite_council_id: string | null
          id: string
          last_viewed_term_id: string | null
          preferred_term_start_date: string | null
          reputation: number
          role: string
          votes_correct: number
          votes_total: number
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          favorite_council_id?: string | null
          id: string
          last_viewed_term_id?: string | null
          preferred_term_start_date?: string | null
          reputation?: number
          role?: string
          votes_correct?: number
          votes_total?: number
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          favorite_council_id?: string | null
          id?: string
          last_viewed_term_id?: string | null
          preferred_term_start_date?: string | null
          reputation?: number
          role?: string
          votes_correct?: number
          votes_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "app_user_favorite_council_id_fkey"
            columns: ["favorite_council_id"]
            isOneToOne: false
            referencedRelation: "council"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_user_last_viewed_term_id_fkey"
            columns: ["last_viewed_term_id"]
            isOneToOne: false
            referencedRelation: "term"
            referencedColumns: ["id"]
          },
        ]
      }
      city: {
        Row: {
          admin_unit_id: string | null
          coat_of_arms_url: string | null
          created_at: string
          id: string
          lat: number | null
          lng: number | null
          name: string
        }
        Insert: {
          admin_unit_id?: string | null
          coat_of_arms_url?: string | null
          created_at?: string
          id?: string
          lat?: number | null
          lng?: number | null
          name: string
        }
        Update: {
          admin_unit_id?: string | null
          coat_of_arms_url?: string | null
          created_at?: string
          id?: string
          lat?: number | null
          lng?: number | null
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "city_admin_unit_id_fkey"
            columns: ["admin_unit_id"]
            isOneToOne: false
            referencedRelation: "admin_unit"
            referencedColumns: ["id"]
          },
        ]
      }
      council: {
        Row: {
          city_id: string
          created_at: string
          district_id: string | null
          id: string
          name: string
        }
        Insert: {
          city_id: string
          created_at?: string
          district_id?: string | null
          id?: string
          name: string
        }
        Update: {
          city_id?: string
          created_at?: string
          district_id?: string | null
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "council_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "city"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "council_district_id_fkey"
            columns: ["district_id"]
            isOneToOne: false
            referencedRelation: "district"
            referencedColumns: ["id"]
          },
        ]
      }
      councilor: {
        Row: {
          created_at: string
          full_name: string
          id: string
          interpellation_synthesis: string | null
          interpellation_synthesis_updated_at: string | null
          photo_url: string | null
        }
        Insert: {
          created_at?: string
          full_name: string
          id?: string
          interpellation_synthesis?: string | null
          interpellation_synthesis_updated_at?: string | null
          photo_url?: string | null
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          interpellation_synthesis?: string | null
          interpellation_synthesis_updated_at?: string | null
          photo_url?: string | null
        }
        Relationships: []
      }
      councilor_term: {
        Row: {
          councilor_id: string
          created_at: string
          district_seat: string | null
          id: string
          mandate_end_date: string | null
          mandate_start_date: string
          party: string | null
          role: string | null
          term_id: string
        }
        Insert: {
          councilor_id: string
          created_at?: string
          district_seat?: string | null
          id?: string
          mandate_end_date?: string | null
          mandate_start_date: string
          party?: string | null
          role?: string | null
          term_id: string
        }
        Update: {
          councilor_id?: string
          created_at?: string
          district_seat?: string | null
          id?: string
          mandate_end_date?: string | null
          mandate_start_date?: string
          party?: string | null
          role?: string | null
          term_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "councilor_term_councilor_id_fkey"
            columns: ["councilor_id"]
            isOneToOne: false
            referencedRelation: "councilor"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "councilor_term_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "term"
            referencedColumns: ["id"]
          },
        ]
      }
      district: {
        Row: {
          city_id: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          city_id: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          city_id?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "district_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "city"
            referencedColumns: ["id"]
          },
        ]
      }
      flag: {
        Row: {
          app_user_id: string
          created_at: string
          id: string
          reason: string
          segment_id: string
          status: string
        }
        Insert: {
          app_user_id: string
          created_at?: string
          id?: string
          reason: string
          segment_id: string
          status?: string
        }
        Update: {
          app_user_id?: string
          created_at?: string
          id?: string
          reason?: string
          segment_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "flag_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flag_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "segment"
            referencedColumns: ["id"]
          },
        ]
      }
      interpellation: {
        Row: {
          author_councilor_id: string | null
          author_name_raw: string | null
          body_text: string | null
          council_id: string
          created_at: string
          esesja_id: string
          full_text: string | null
          id: string
          pdf_url: string | null
          response_author_name: string | null
          response_date: string | null
          response_pdf_url: string | null
          response_text: string | null
          submitted_date: string | null
          summary: string | null
          title: string
        }
        Insert: {
          author_councilor_id?: string | null
          author_name_raw?: string | null
          body_text?: string | null
          council_id: string
          created_at?: string
          esesja_id: string
          full_text?: string | null
          id?: string
          pdf_url?: string | null
          response_author_name?: string | null
          response_date?: string | null
          response_pdf_url?: string | null
          response_text?: string | null
          submitted_date?: string | null
          summary?: string | null
          title: string
        }
        Update: {
          author_councilor_id?: string | null
          author_name_raw?: string | null
          body_text?: string | null
          council_id?: string
          created_at?: string
          esesja_id?: string
          full_text?: string | null
          id?: string
          pdf_url?: string | null
          response_author_name?: string | null
          response_date?: string | null
          response_pdf_url?: string | null
          response_text?: string | null
          submitted_date?: string | null
          summary?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "interpellation_author_councilor_id_fkey"
            columns: ["author_councilor_id"]
            isOneToOne: false
            referencedRelation: "councilor"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interpellation_council_id_fkey"
            columns: ["council_id"]
            isOneToOne: false
            referencedRelation: "council"
            referencedColumns: ["id"]
          },
        ]
      }
      matter: {
        Row: {
          council_id: string
          created_at: string
          id: string
          notes: string | null
          status: string
          thread_id: string | null
          title: string
        }
        Insert: {
          council_id: string
          created_at?: string
          id?: string
          notes?: string | null
          status?: string
          thread_id?: string | null
          title: string
        }
        Update: {
          council_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          status?: string
          thread_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "matter_council_id_fkey"
            columns: ["council_id"]
            isOneToOne: false
            referencedRelation: "council"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "matter_thread"
            referencedColumns: ["id"]
          },
        ]
      }
      matter_participant: {
        Row: {
          councilor_id: string
          created_at: string
          id: string
          matter_id: string
          role: string
        }
        Insert: {
          councilor_id: string
          created_at?: string
          id?: string
          matter_id: string
          role?: string
        }
        Update: {
          councilor_id?: string
          created_at?: string
          id?: string
          matter_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "matter_participant_councilor_id_fkey"
            columns: ["councilor_id"]
            isOneToOne: false
            referencedRelation: "councilor"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_participant_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matter"
            referencedColumns: ["id"]
          },
        ]
      }
      matter_reference: {
        Row: {
          created_at: string
          id: string
          interpellation_id: string | null
          matter_id: string
          meeting_id: string | null
          note: string | null
          resolution_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          interpellation_id?: string | null
          matter_id: string
          meeting_id?: string | null
          note?: string | null
          resolution_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          interpellation_id?: string | null
          matter_id?: string
          meeting_id?: string | null
          note?: string | null
          resolution_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "matter_reference_interpellation_id_fkey"
            columns: ["interpellation_id"]
            isOneToOne: false
            referencedRelation: "interpellation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_reference_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matter"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_reference_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meeting"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_reference_resolution_id_fkey"
            columns: ["resolution_id"]
            isOneToOne: false
            referencedRelation: "resolution"
            referencedColumns: ["id"]
          },
        ]
      }
      matter_relation: {
        Row: {
          created_at: string
          from_matter_id: string
          id: string
          relation_type: string
          to_matter_id: string
        }
        Insert: {
          created_at?: string
          from_matter_id: string
          id?: string
          relation_type: string
          to_matter_id: string
        }
        Update: {
          created_at?: string
          from_matter_id?: string
          id?: string
          relation_type?: string
          to_matter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "matter_relation_from_matter_id_fkey"
            columns: ["from_matter_id"]
            isOneToOne: false
            referencedRelation: "matter"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_relation_to_matter_id_fkey"
            columns: ["to_matter_id"]
            isOneToOne: false
            referencedRelation: "matter"
            referencedColumns: ["id"]
          },
        ]
      }
      matter_thread: {
        Row: {
          council_id: string
          created_at: string
          description: string | null
          id: string
          title: string
        }
        Insert: {
          council_id: string
          created_at?: string
          description?: string | null
          id?: string
          title: string
        }
        Update: {
          council_id?: string
          created_at?: string
          description?: string | null
          id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "matter_thread_council_id_fkey"
            columns: ["council_id"]
            isOneToOne: false
            referencedRelation: "council"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting: {
        Row: {
          created_at: string
          date: string
          esesja_id: string | null
          id: string
          meeting_type: string
          summary: string | null
          summary_prompt_version: number | null
          term_id: string
          title: string | null
          topics: string[] | null
          transcript_source: string | null
          transcript_status: string
          video_downloaded: boolean
          video_url: string | null
        }
        Insert: {
          created_at?: string
          date: string
          esesja_id?: string | null
          id?: string
          meeting_type: string
          summary?: string | null
          summary_prompt_version?: number | null
          term_id: string
          title?: string | null
          topics?: string[] | null
          transcript_source?: string | null
          transcript_status?: string
          video_downloaded?: boolean
          video_url?: string | null
        }
        Update: {
          created_at?: string
          date?: string
          esesja_id?: string | null
          id?: string
          meeting_type?: string
          summary?: string | null
          summary_prompt_version?: number | null
          term_id?: string
          title?: string | null
          topics?: string[] | null
          transcript_source?: string | null
          transcript_status?: string
          video_downloaded?: boolean
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meeting_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "term"
            referencedColumns: ["id"]
          },
        ]
      }
      official: {
        Row: {
          created_at: string
          full_name: string
          id: string
          role: string
        }
        Insert: {
          created_at?: string
          full_name: string
          id?: string
          role: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          role?: string
        }
        Relationships: []
      }
      resolution: {
        Row: {
          created_at: string
          esesja_glosowanie_id: string | null
          esesja_number: string | null
          id: string
          meeting_id: string | null
          pdf_url: string | null
          title: string
        }
        Insert: {
          created_at?: string
          esesja_glosowanie_id?: string | null
          esesja_number?: string | null
          id?: string
          meeting_id?: string | null
          pdf_url?: string | null
          title: string
        }
        Update: {
          created_at?: string
          esesja_glosowanie_id?: string | null
          esesja_number?: string | null
          id?: string
          meeting_id?: string | null
          pdf_url?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "resolution_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meeting"
            referencedColumns: ["id"]
          },
        ]
      }
      resolution_vote: {
        Row: {
          choice: string
          councilor_id: string
          created_at: string
          id: string
          resolution_id: string
        }
        Insert: {
          choice: string
          councilor_id: string
          created_at?: string
          id?: string
          resolution_id: string
        }
        Update: {
          choice?: string
          councilor_id?: string
          created_at?: string
          id?: string
          resolution_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resolution_vote_councilor_id_fkey"
            columns: ["councilor_id"]
            isOneToOne: false
            referencedRelation: "councilor"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resolution_vote_resolution_id_fkey"
            columns: ["resolution_id"]
            isOneToOne: false
            referencedRelation: "resolution"
            referencedColumns: ["id"]
          },
        ]
      }
      segment: {
        Row: {
          confirmed_councilor_id: string | null
          confirmed_official_id: string | null
          created_at: string
          end_time: number
          finalized_at: string | null
          finalized_by: string | null
          id: string
          meeting_id: string
          search_vector: unknown
          start_time: number
          status: string
          text: string
        }
        Insert: {
          confirmed_councilor_id?: string | null
          confirmed_official_id?: string | null
          created_at?: string
          end_time: number
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          meeting_id: string
          search_vector?: unknown
          start_time: number
          status?: string
          text: string
        }
        Update: {
          confirmed_councilor_id?: string | null
          confirmed_official_id?: string | null
          created_at?: string
          end_time?: number
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          meeting_id?: string
          search_vector?: unknown
          start_time?: number
          status?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "segment_confirmed_councilor_id_fkey"
            columns: ["confirmed_councilor_id"]
            isOneToOne: false
            referencedRelation: "councilor"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "segment_confirmed_official_id_fkey"
            columns: ["confirmed_official_id"]
            isOneToOne: false
            referencedRelation: "official"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "segment_finalized_by_fkey"
            columns: ["finalized_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "segment_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meeting"
            referencedColumns: ["id"]
          },
        ]
      }
      term: {
        Row: {
          council_id: string
          created_at: string
          end_date: string | null
          id: string
          label: string | null
          start_date: string
        }
        Insert: {
          council_id: string
          created_at?: string
          end_date?: string | null
          id?: string
          label?: string | null
          start_date: string
        }
        Update: {
          council_id?: string
          created_at?: string
          end_date?: string | null
          id?: string
          label?: string | null
          start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "term_council_id_fkey"
            columns: ["council_id"]
            isOneToOne: false
            referencedRelation: "council"
            referencedColumns: ["id"]
          },
        ]
      }
      user_role: {
        Row: {
          app_user_id: string
          created_at: string
          id: string
          permissions: string[]
          role: string
          scope_admin_unit_id: string | null
          scope_city_id: string | null
          scope_council_id: string | null
        }
        Insert: {
          app_user_id: string
          created_at?: string
          id?: string
          permissions?: string[]
          role: string
          scope_admin_unit_id?: string | null
          scope_city_id?: string | null
          scope_council_id?: string | null
        }
        Update: {
          app_user_id?: string
          created_at?: string
          id?: string
          permissions?: string[]
          role?: string
          scope_admin_unit_id?: string | null
          scope_city_id?: string | null
          scope_council_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_role_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_role_scope_admin_unit_id_fkey"
            columns: ["scope_admin_unit_id"]
            isOneToOne: false
            referencedRelation: "admin_unit"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_role_scope_city_id_fkey"
            columns: ["scope_city_id"]
            isOneToOne: false
            referencedRelation: "city"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_role_scope_council_id_fkey"
            columns: ["scope_council_id"]
            isOneToOne: false
            referencedRelation: "council"
            referencedColumns: ["id"]
          },
        ]
      }
      vote: {
        Row: {
          app_user_id: string
          councilor_id: string
          created_at: string
          id: string
          segment_id: string
          weight_at_vote: number
        }
        Insert: {
          app_user_id: string
          councilor_id: string
          created_at?: string
          id?: string
          segment_id: string
          weight_at_vote?: number
        }
        Update: {
          app_user_id?: string
          councilor_id?: string
          created_at?: string
          id?: string
          segment_id?: string
          weight_at_vote?: number
        }
        Relationships: [
          {
            foreignKeyName: "vote_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vote_councilor_id_fkey"
            columns: ["councilor_id"]
            isOneToOne: false
            referencedRelation: "councilor"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vote_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "segment"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_unit_is_ancestor_or_self: {
        Args: { ancestor_id: string; unit_id: string }
        Returns: boolean
      }
      councilor_voting_similarity: {
        Args: { target_id: string }
        Returns: {
          agreement_pct: number
          common_votes: number
          councilor_id: string
          full_name: string
        }[]
      }
      is_moderator: { Args: { uid: string }; Returns: boolean }
      meeting_tagging_progress: {
        Args: { p_term_id: string }
        Returns: {
          finalized: number
          meeting_id: string
          total: number
        }[]
      }
      search_segments: {
        Args: { search_query: string }
        Returns: {
          headline: string
          id: string
          meeting_date: string
          meeting_id: string
          meeting_title: string
          start_time: number
        }[]
      }
      text2ltree: { Args: { "": string }; Returns: unknown }
      user_has_permission: {
        Args: {
          perm: string
          target_city_id?: string
          target_council_id?: string
          uid: string
        }
        Returns: boolean
      }
    }
    Enums: {
      admin_unit_level: "kraj" | "wojewodztwo" | "powiat" | "gmina"
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
      admin_unit_level: ["kraj", "wojewodztwo", "powiat", "gmina"],
    },
  },
} as const
