export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  private: {
    Tables: {
      game_players: {
        Row: {
          game_id: string
          id: string
          is_host: boolean
          joined_at: string
          left_at: string | null
          nickname: string
          total_score: number
          user_id: string
        }
        Insert: {
          game_id: string
          id?: string
          is_host?: boolean
          joined_at?: string
          left_at?: string | null
          nickname: string
          total_score?: number
          user_id: string
        }
        Update: {
          game_id?: string
          id?: string
          is_host?: boolean
          joined_at?: string
          left_at?: string | null
          nickname?: string
          total_score?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_players_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      game_rounds: {
        Row: {
          completed_at: string | null
          ends_at: string | null
          game_id: string
          id: string
          revealed_at: string | null
          round_number: number
          started_at: string | null
          status: Database["public"]["Enums"]["round_status"]
          target_street_id: string
        }
        Insert: {
          completed_at?: string | null
          ends_at?: string | null
          game_id: string
          id?: string
          revealed_at?: string | null
          round_number: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["round_status"]
          target_street_id: string
        }
        Update: {
          completed_at?: string | null
          ends_at?: string | null
          game_id?: string
          id?: string
          revealed_at?: string | null
          round_number?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["round_status"]
          target_street_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_rounds_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_rounds_target_street_id_fkey"
            columns: ["target_street_id"]
            isOneToOne: false
            referencedRelation: "streets"
            referencedColumns: ["id"]
          },
        ]
      }
      games: {
        Row: {
          city_id: string
          created_at: string
          current_round_number: number
          difficulty: Database["public"]["Enums"]["difficulty"]
          expires_at: string
          finished_at: string | null
          host_player_id: string | null
          id: string
          lobby_code: string | null
          mode: Database["public"]["Enums"]["game_mode"]
          rematch_of_game_id: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["game_status"]
          updated_at: string
        }
        Insert: {
          city_id: string
          created_at?: string
          current_round_number?: number
          difficulty: Database["public"]["Enums"]["difficulty"]
          expires_at?: string
          finished_at?: string | null
          host_player_id?: string | null
          id?: string
          lobby_code?: string | null
          mode: Database["public"]["Enums"]["game_mode"]
          rematch_of_game_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["game_status"]
          updated_at?: string
        }
        Update: {
          city_id?: string
          created_at?: string
          current_round_number?: number
          difficulty?: Database["public"]["Enums"]["difficulty"]
          expires_at?: string
          finished_at?: string | null
          host_player_id?: string | null
          id?: string
          lobby_code?: string | null
          mode?: Database["public"]["Enums"]["game_mode"]
          rematch_of_game_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["game_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "games_host_player_id_fkey"
            columns: ["host_player_id"]
            isOneToOne: false
            referencedRelation: "game_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "games_rematch_of_game_id_fkey"
            columns: ["rematch_of_game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      guesses: {
        Row: {
          distance_m: number
          id: string
          location: unknown
          player_id: string
          round_id: string
          score: number
          seconds_remaining: number
          submitted_at: string
        }
        Insert: {
          distance_m: number
          id?: string
          location: unknown
          player_id: string
          round_id: string
          score: number
          seconds_remaining: number
          submitted_at?: string
        }
        Update: {
          distance_m?: number
          id?: string
          location?: unknown
          player_id?: string
          round_id?: string
          score?: number
          seconds_remaining?: number
          submitted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guesses_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "game_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guesses_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "game_rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      streets: {
        Row: {
          city_id: string
          difficulty: Database["public"]["Enums"]["difficulty"]
          exclusion_reasons: string[]
          geom: unknown
          highway_types: string[]
          id: string
          imported_at: string
          is_playable: boolean
          length_m: number
          name: string
          normalized_name: string
          osm_ids: number[]
          source: Json
          source_updated_at: string | null
        }
        Insert: {
          city_id: string
          difficulty: Database["public"]["Enums"]["difficulty"]
          exclusion_reasons?: string[]
          geom: unknown
          highway_types?: string[]
          id?: string
          imported_at?: string
          is_playable?: boolean
          length_m: number
          name: string
          normalized_name: string
          osm_ids?: number[]
          source?: Json
          source_updated_at?: string | null
        }
        Update: {
          city_id?: string
          difficulty?: Database["public"]["Enums"]["difficulty"]
          exclusion_reasons?: string[]
          geom?: unknown
          highway_types?: string[]
          id?: string
          imported_at?: string
          is_playable?: boolean
          length_m?: number
          name?: string
          normalized_name?: string
          osm_ids?: number[]
          source?: Json
          source_updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      assert_actor: { Args: { p_user_id: string }; Returns: undefined }
      assert_game_member: {
        Args: { p_game_id: string; p_user_id: string }
        Returns: {
          game_id: string
          id: string
          is_host: boolean
          joined_at: string
          left_at: string | null
          nickname: string
          total_score: number
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "game_players"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      build_catalog: {
        Args: {
          p_limit: number
          p_locale: Database["public"]["Enums"]["locale"]
          p_query: string
        }
        Returns: Json
      }
      build_game_state: {
        Args: { p_game_id: string; p_user_id: string }
        Returns: Json
      }
      generate_lobby_code: { Args: never; Returns: string }
      is_game_member: { Args: { p_topic: string }; Returns: boolean }
      normalize_catalog_search: { Args: { p_value: string }; Returns: string }
      populate_rounds: { Args: { p_game_id: string }; Returns: undefined }
      start_game_internal: {
        Args: { p_game_id: string; p_now: string }
        Returns: undefined
      }
      synchronize_game_locked: {
        Args: { p_game_id: string; p_now: string }
        Returns: undefined
      }
      validate_nickname: { Args: { p_nickname: string }; Returns: string }
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
      cities: {
        Row: {
          admin_level: number | null
          bounds: unknown
          bounds_bbox: number[]
          center: unknown
          country_id: string
          created_at: string
          enabled: boolean
          featured: boolean
          featured_order: number | null
          id: string
          official_code: string | null
          osm_relation_id: number | null
          population: number | null
          settlement_type: string | null
          slug: string
          source: Json
          source_updated_at: string | null
          updated_at: string
          wikidata_id: string | null
        }
        Insert: {
          admin_level?: number | null
          bounds: unknown
          bounds_bbox: number[]
          center: unknown
          country_id: string
          created_at?: string
          enabled?: boolean
          featured?: boolean
          featured_order?: number | null
          id?: string
          official_code?: string | null
          osm_relation_id?: number | null
          population?: number | null
          settlement_type?: string | null
          slug: string
          source?: Json
          source_updated_at?: string | null
          updated_at?: string
          wikidata_id?: string | null
        }
        Update: {
          admin_level?: number | null
          bounds?: unknown
          bounds_bbox?: number[]
          center?: unknown
          country_id?: string
          created_at?: string
          enabled?: boolean
          featured?: boolean
          featured_order?: number | null
          id?: string
          official_code?: string | null
          osm_relation_id?: number | null
          population?: number | null
          settlement_type?: string | null
          slug?: string
          source?: Json
          source_updated_at?: string | null
          updated_at?: string
          wikidata_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cities_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["id"]
          },
        ]
      }
      city_admin_area_translations: {
        Row: {
          city_id: string
          district_name: string | null
          locale: Database["public"]["Enums"]["locale"]
          state_name: string
        }
        Insert: {
          city_id: string
          district_name?: string | null
          locale: Database["public"]["Enums"]["locale"]
          state_name: string
        }
        Update: {
          city_id?: string
          district_name?: string | null
          locale?: Database["public"]["Enums"]["locale"]
          state_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "city_admin_area_translations_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
        ]
      }
      city_translations: {
        Row: {
          city_id: string
          locale: Database["public"]["Enums"]["locale"]
          name: string
          search_name: string | null
        }
        Insert: {
          city_id: string
          locale: Database["public"]["Enums"]["locale"]
          name: string
          search_name?: string | null
        }
        Update: {
          city_id?: string
          locale?: Database["public"]["Enums"]["locale"]
          name?: string
          search_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "city_translations_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
        ]
      }
      countries: {
        Row: {
          code: string
          created_at: string
          default_locale: Database["public"]["Enums"]["locale"]
          id: string
        }
        Insert: {
          code: string
          created_at?: string
          default_locale?: Database["public"]["Enums"]["locale"]
          id?: string
        }
        Update: {
          code?: string
          created_at?: string
          default_locale?: Database["public"]["Enums"]["locale"]
          id?: string
        }
        Relationships: []
      }
      country_translations: {
        Row: {
          country_id: string
          locale: Database["public"]["Enums"]["locale"]
          name: string
        }
        Insert: {
          country_id: string
          locale: Database["public"]["Enums"]["locale"]
          name: string
        }
        Update: {
          country_id?: string
          locale?: Database["public"]["Enums"]["locale"]
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "country_translations_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      calculate_score: {
        Args: { p_distance_m: number; p_seconds_remaining: number }
        Returns: number
      }
      classify_difficulty: {
        Args: { p_highway_types: string[]; p_length_m: number }
        Returns: Database["public"]["Enums"]["difficulty"]
      }
      cleanup_expired_data: {
        Args: { p_delete_anonymous_users?: boolean }
        Returns: Json
      }
      create_game: {
        Args: {
          p_city_slug: string
          p_difficulty: Database["public"]["Enums"]["difficulty"]
          p_mode: Database["public"]["Enums"]["game_mode"]
          p_nickname: string
          p_user_id: string
        }
        Returns: Json
      }
      create_rematch: {
        Args: { p_game_id: string; p_user_id: string }
        Returns: Json
      }
      get_game_state: {
        Args: { p_game_id: string; p_user_id: string }
        Returns: Json
      }
      join_game: {
        Args: { p_code: string; p_nickname: string; p_user_id: string }
        Returns: Json
      }
      leave_game: {
        Args: { p_game_id: string; p_user_id: string }
        Returns: Json
      }
      list_catalog: {
        Args: { p_locale?: Database["public"]["Enums"]["locale"] }
        Returns: Json
      }
      normalize_street_name: { Args: { p_name: string }; Returns: string }
      search_catalog: {
        Args: {
          p_limit?: number
          p_locale?: Database["public"]["Enums"]["locale"]
          p_query?: string
        }
        Returns: Json
      }
      start_game: {
        Args: { p_game_id: string; p_user_id: string }
        Returns: Json
      }
      submit_guess: {
        Args: {
          p_game_id: string
          p_lat: number
          p_lng: number
          p_round_id: string
          p_user_id: string
        }
        Returns: Json
      }
      synchronize_game: {
        Args: { p_game_id: string; p_user_id: string }
        Returns: Json
      }
    }
    Enums: {
      difficulty: "easy" | "medium" | "hard" | "insane"
      game_mode: "solo" | "lobby"
      game_status: "waiting" | "playing" | "revealing" | "finished"
      locale: "de" | "en"
      round_status: "pending" | "playing" | "revealing" | "complete"
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
  private: {
    Enums: {},
  },
  public: {
    Enums: {
      difficulty: ["easy", "medium", "hard", "insane"],
      game_mode: ["solo", "lobby"],
      game_status: ["waiting", "playing", "revealing", "finished"],
      locale: ["de", "en"],
      round_status: ["pending", "playing", "revealing", "complete"],
    },
  },
} as const

