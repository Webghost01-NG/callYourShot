export interface Database {
  public: {
    Tables: {
      league_profiles: {
        Row: {
          id: string;
          user_id: string;
          wallet_address: string;
          display_name: string | null;
          enrolled_at: string;
          formula_version: string;
          updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      challenges: {
        Row: {
          id: string;
          creator_user_id: string;
          creator_wallet: string;
          invited_wallet: string;
          opponent_user_id: string | null;
          opponent_wallet: string | null;
          market_id: string;
          status: string;
          created_at: string;
          accepted_at: string | null;
          cancelled_at: string | null;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      enroll_in_league: { Args: { p_display_name?: string | null }; Returns: string };
      update_display_name: { Args: { p_display_name?: string | null }; Returns: string };
      create_challenge: { Args: { p_market_id: string; p_invited_wallet: string }; Returns: string };
      accept_challenge: { Args: { p_challenge_id: string }; Returns: string };
      cancel_challenge: { Args: { p_challenge_id: string }; Returns: string };
    };
  };
}
