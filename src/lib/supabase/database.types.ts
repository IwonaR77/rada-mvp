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
      app_user: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          reputation: number
          role: string
          votes_correct: number
          votes_total: number
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          reputation?: number
          role?: string
          votes_correct?: number
          votes_total?: number
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          reputation?: number
          role?: string
          votes_correct?: number
          votes_total?: number
        }
        Relationships: []
      }
      city: {
        Row: {
          created_at: string
          id: string
          lat: number | null
          lng: number | null
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          lat?: number | null
          lng?: number | null
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          lat?: number | null
          lng?: number | null
          name?: string
        }
        Relationships: []
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
          photo_url: string | null
        }
        Insert: {
          created_at?: string
          full_name: string
          id?: string
          photo_url?: string | null
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
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
      meeting: {
        Row: {
          created_at: string
          date: string
          id: string
          meeting_type: string
          term_id: string
          title: string | null
          transcript_source: string | null
          video_url: string | null
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          meeting_type: string
          term_id: string
          title?: string | null
          transcript_source?: string | null
          video_url?: string | null
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          meeting_type?: string
          term_id?: string
          title?: string | null
          transcript_source?: string | null
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
      segment: {
        Row: {
          confirmed_councilor_id: string | null
          created_at: string
          end_time: number
          finalized_at: string | null
          finalized_by: string | null
          id: string
          meeting_id: string
          start_time: number
          status: string
          text: string
        }
        Insert: {
          confirmed_councilor_id?: string | null
          created_at?: string
          end_time: number
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          meeting_id: string
          start_time: number
          status?: string
          text: string
        }
        Update: {
          confirmed_councilor_id?: string | null
          created_at?: string
          end_time?: number
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          meeting_id?: string
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
          role: string
          scope_city_id: string | null
          scope_council_id: string | null
        }
        Insert: {
          app_user_id: string
          created_at?: string
          id?: string
          role: string
          scope_city_id?: string | null
          scope_council_id?: string | null
        }
        Update: {
          app_user_id?: string
          created_at?: string
          id?: string
          role?: string
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
      is_moderator: { Args: { uid: string }; Returns: boolean }
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
  public: {
    Enums: {},
  },
} as const
