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
    PostgrestVersion: '13.0.4'
  }
  public: {
    Tables: {
      access_requests: {
        Row: {
          created_at: string | null
          expires_at: string | null
          id: string
          justification: string | null
          request_type: string
          requested_data: Json
          requester_id: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          justification?: string | null
          request_type: string
          requested_data: Json
          requester_id?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          justification?: string | null
          request_type?: string
          requested_data?: Json
          requester_id?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'access_requests_requester_id_fkey'
            columns: ['requester_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'access_requests_reviewer_id_fkey'
            columns: ['reviewer_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      activity_display_config: {
        Row: {
          activity_type: string
          color_override: string | null
          created_at: string | null
          efficiency_weight: number | null
          gantt_bg_class: string | null
          gantt_hover_class: string | null
          gantt_min_width_percent: number | null
          gantt_text_class: string | null
          icon_override: string | null
          id: string
          include_in_efficiency: boolean | null
          label_override: string | null
          organization_id: string | null
          show_in_breakdown: boolean | null
          show_in_summary: boolean | null
          show_on_timeline: boolean | null
          updated_at: string | null
        }
        Insert: {
          activity_type: string
          color_override?: string | null
          created_at?: string | null
          efficiency_weight?: number | null
          gantt_bg_class?: string | null
          gantt_hover_class?: string | null
          gantt_min_width_percent?: number | null
          gantt_text_class?: string | null
          icon_override?: string | null
          id?: string
          include_in_efficiency?: boolean | null
          label_override?: string | null
          organization_id?: string | null
          show_in_breakdown?: boolean | null
          show_in_summary?: boolean | null
          show_on_timeline?: boolean | null
          updated_at?: string | null
        }
        Update: {
          activity_type?: string
          color_override?: string | null
          created_at?: string | null
          efficiency_weight?: number | null
          gantt_bg_class?: string | null
          gantt_hover_class?: string | null
          gantt_min_width_percent?: number | null
          gantt_text_class?: string | null
          icon_override?: string | null
          id?: string
          include_in_efficiency?: boolean | null
          label_override?: string | null
          organization_id?: string | null
          show_in_breakdown?: boolean | null
          show_in_summary?: boolean | null
          show_on_timeline?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'activity_display_config_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      activity_source_config: {
        Row: {
          activity_category: string | null
          activity_description: string | null
          activity_label: string
          activity_type: string
          area_column: string | null
          area_fallback: string | null
          count_column: string | null
          count_enabled: boolean | null
          created_at: string | null
          created_by: string | null
          department: string | null
          display_color: string
          display_icon: string | null
          display_order: number | null
          id: string
          is_active: boolean | null
          is_system: boolean | null
          organization_id: string | null
          organization_id_column: string | null
          source_schema: string | null
          source_table: string
          timestamp_column: string
          updated_at: string | null
          updated_by: string | null
          user_id_column: string
          where_conditions: Json | null
        }
        Insert: {
          activity_category?: string | null
          activity_description?: string | null
          activity_label: string
          activity_type: string
          area_column?: string | null
          area_fallback?: string | null
          count_column?: string | null
          count_enabled?: boolean | null
          created_at?: string | null
          created_by?: string | null
          department?: string | null
          display_color: string
          display_icon?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          is_system?: boolean | null
          organization_id?: string | null
          organization_id_column?: string | null
          source_schema?: string | null
          source_table: string
          timestamp_column: string
          updated_at?: string | null
          updated_by?: string | null
          user_id_column: string
          where_conditions?: Json | null
        }
        Update: {
          activity_category?: string | null
          activity_description?: string | null
          activity_label?: string
          activity_type?: string
          area_column?: string | null
          area_fallback?: string | null
          count_column?: string | null
          count_enabled?: boolean | null
          created_at?: string | null
          created_by?: string | null
          department?: string | null
          display_color?: string
          display_icon?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          is_system?: boolean | null
          organization_id?: string | null
          organization_id_column?: string | null
          source_schema?: string | null
          source_table?: string
          timestamp_column?: string
          updated_at?: string | null
          updated_by?: string | null
          user_id_column?: string
          where_conditions?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: 'activity_source_config_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      applications: {
        Row: {
          api_key_encrypted: string | null
          category: string | null
          config: Json | null
          created_at: string | null
          created_by: string | null
          description: string | null
          icon_url: string | null
          id: string
          name: string
          organization_id: string | null
          permissions: Json | null
          status: Database['public']['Enums']['app_status'] | null
          updated_at: string | null
          usage_stats: Json | null
          webhook_url: string | null
        }
        Insert: {
          api_key_encrypted?: string | null
          category?: string | null
          config?: Json | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          icon_url?: string | null
          id?: string
          name: string
          organization_id?: string | null
          permissions?: Json | null
          status?: Database['public']['Enums']['app_status'] | null
          updated_at?: string | null
          usage_stats?: Json | null
          webhook_url?: string | null
        }
        Update: {
          api_key_encrypted?: string | null
          category?: string | null
          config?: Json | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          icon_url?: string | null
          id?: string
          name?: string
          organization_id?: string | null
          permissions?: Json | null
          status?: Database['public']['Enums']['app_status'] | null
          updated_at?: string | null
          usage_stats?: Json | null
          webhook_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'applications_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'applications_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      approval_workflows: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          is_active: boolean | null
          name: string
          steps: Json
          trigger_conditions: Json
          trigger_type: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          steps: Json
          trigger_conditions: Json
          trigger_type: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          steps?: Json
          trigger_conditions?: Json
          trigger_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'approval_workflows_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      area_type_options: {
        Row: {
          color_code: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          display_order: number | null
          icon_name: string | null
          id: string
          is_active: boolean | null
          organization_id: string
          type_label: string
          type_value: string
          updated_at: string | null
        }
        Insert: {
          color_code?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          display_order?: number | null
          icon_name?: string | null
          id?: string
          is_active?: boolean | null
          organization_id: string
          type_label: string
          type_value: string
          updated_at?: string | null
        }
        Update: {
          color_code?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          display_order?: number | null
          icon_name?: string | null
          id?: string
          is_active?: boolean | null
          organization_id?: string
          type_label?: string
          type_value?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'area_type_options_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      audit_logs: {
        Row: {
          action: Database['public']['Enums']['audit_action']
          changes: Json | null
          created_at: string | null
          id: string
          ip_address: unknown
          metadata: Json | null
          organization_id: string | null
          resource_id: string | null
          resource_type: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: Database['public']['Enums']['audit_action']
          changes?: Json | null
          created_at?: string | null
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          organization_id?: string | null
          resource_id?: string | null
          resource_type?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: Database['public']['Enums']['audit_action']
          changes?: Json | null
          created_at?: string | null
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          organization_id?: string | null
          resource_id?: string | null
          resource_type?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'audit_logs_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'audit_logs_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      chats: {
        Row: {
          created_at: string | null
          id: string
          max_tokens: number | null
          metadata: Json | null
          model: string | null
          organization_id: string | null
          system_prompt: string | null
          temperature: number | null
          title: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          max_tokens?: number | null
          metadata?: Json | null
          model?: string | null
          organization_id?: string | null
          system_prompt?: string | null
          temperature?: number | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          max_tokens?: number | null
          metadata?: Json | null
          model?: string | null
          organization_id?: string | null
          system_prompt?: string | null
          temperature?: number | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'chats_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'chats_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      customer_accounts: {
        Row: {
          company_name: string | null
          contact_name: string | null
          created_at: string | null
          email: string
          id: string
          is_internal_customer: boolean | null
          is_verified: boolean | null
          last_contact_at: string | null
          metadata: Json | null
          notes: string | null
          notification_preferences: Json | null
          organization_id: string | null
          phone: string | null
          preferred_contact_method:
            | Database['public']['Enums']['message_channel']
            | null
          service_tier: string | null
          status: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          company_name?: string | null
          contact_name?: string | null
          created_at?: string | null
          email: string
          id?: string
          is_internal_customer?: boolean | null
          is_verified?: boolean | null
          last_contact_at?: string | null
          metadata?: Json | null
          notes?: string | null
          notification_preferences?: Json | null
          organization_id?: string | null
          phone?: string | null
          preferred_contact_method?:
            | Database['public']['Enums']['message_channel']
            | null
          service_tier?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          company_name?: string | null
          contact_name?: string | null
          created_at?: string | null
          email?: string
          id?: string
          is_internal_customer?: boolean | null
          is_verified?: boolean | null
          last_contact_at?: string | null
          metadata?: Json | null
          notes?: string | null
          notification_preferences?: Json | null
          organization_id?: string | null
          phone?: string | null
          preferred_contact_method?:
            | Database['public']['Enums']['message_channel']
            | null
          service_tier?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'customer_accounts_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      customer_portal_sessions: {
        Row: {
          customer_account_id: string | null
          device_type: string | null
          ended_at: string | null
          expires_at: string
          id: string
          ip_address: unknown
          last_activity_at: string | null
          metadata: Json | null
          organization_id: string | null
          session_token: string
          started_at: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          customer_account_id?: string | null
          device_type?: string | null
          ended_at?: string | null
          expires_at: string
          id?: string
          ip_address?: unknown
          last_activity_at?: string | null
          metadata?: Json | null
          organization_id?: string | null
          session_token: string
          started_at?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          customer_account_id?: string | null
          device_type?: string | null
          ended_at?: string | null
          expires_at?: string
          id?: string
          ip_address?: unknown
          last_activity_at?: string | null
          metadata?: Json | null
          organization_id?: string | null
          session_token?: string
          started_at?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'customer_portal_sessions_customer_account_id_fkey'
            columns: ['customer_account_id']
            isOneToOne: false
            referencedRelation: 'customer_accounts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'customer_portal_sessions_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      delivery_dispositions: {
        Row: {
          color: string | null
          created_at: string | null
          id: string
          name: string
          organization_id: string
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          id?: string
          name: string
          organization_id: string
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'delivery_dispositions_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      delivery_filter_presets: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          filters: Json
          id: string
          is_default: boolean | null
          name: string
          organization_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          filters: Json
          id?: string
          is_default?: boolean | null
          name: string
          organization_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          filters?: Json
          id?: string
          is_default?: boolean | null
          name?: string
          organization_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'delivery_filter_presets_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      department_options: {
        Row: {
          color_code: string | null
          created_at: string | null
          created_by: string | null
          department_label: string
          department_value: string
          description: string | null
          display_order: number | null
          icon_name: string | null
          id: string
          is_active: boolean | null
          organization_id: string
          updated_at: string | null
        }
        Insert: {
          color_code?: string | null
          created_at?: string | null
          created_by?: string | null
          department_label: string
          department_value: string
          description?: string | null
          display_order?: number | null
          icon_name?: string | null
          id?: string
          is_active?: boolean | null
          organization_id: string
          updated_at?: string | null
        }
        Update: {
          color_code?: string | null
          created_at?: string | null
          created_by?: string | null
          department_label?: string
          department_value?: string
          description?: string | null
          display_order?: number | null
          icon_name?: string | null
          id?: string
          is_active?: boolean | null
          organization_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'department_options_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      device_registrations: {
        Row: {
          browser: string | null
          color_depth: number | null
          created_at: string | null
          device_name: string
          device_type: string
          fingerprint_id: string
          first_registered: string | null
          hardware_concurrency: number | null
          id: string
          is_active: boolean | null
          language: string | null
          last_seen: string | null
          organization_id: string | null
          os_name: string | null
          os_version: string | null
          screen_resolution: string | null
          timezone: string | null
          touch_points: number | null
          updated_at: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          browser?: string | null
          color_depth?: number | null
          created_at?: string | null
          device_name: string
          device_type: string
          fingerprint_id: string
          first_registered?: string | null
          hardware_concurrency?: number | null
          id?: string
          is_active?: boolean | null
          language?: string | null
          last_seen?: string | null
          organization_id?: string | null
          os_name?: string | null
          os_version?: string | null
          screen_resolution?: string | null
          timezone?: string | null
          touch_points?: number | null
          updated_at?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          browser?: string | null
          color_depth?: number | null
          created_at?: string | null
          device_name?: string
          device_type?: string
          fingerprint_id?: string
          first_registered?: string | null
          hardware_concurrency?: number | null
          id?: string
          is_active?: boolean | null
          language?: string | null
          last_seen?: string | null
          organization_id?: string | null
          os_name?: string | null
          os_version?: string | null
          screen_resolution?: string | null
          timezone?: string | null
          touch_points?: number | null
          updated_at?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'device_registrations_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      drone_missions: {
        Row: {
          completed_at: string | null
          coverage_zones: string[] | null
          created_at: string | null
          created_by: string | null
          drone_id: string | null
          drone_model: string | null
          estimated_duration_minutes: number | null
          failed_analyses: number | null
          id: string
          mission_name: string
          mission_type: string | null
          organization_id: string
          started_at: string | null
          status: string | null
          successful_analyses: number | null
          total_scans: number | null
          updated_at: string | null
          waypoints: Json | null
        }
        Insert: {
          completed_at?: string | null
          coverage_zones?: string[] | null
          created_at?: string | null
          created_by?: string | null
          drone_id?: string | null
          drone_model?: string | null
          estimated_duration_minutes?: number | null
          failed_analyses?: number | null
          id?: string
          mission_name: string
          mission_type?: string | null
          organization_id: string
          started_at?: string | null
          status?: string | null
          successful_analyses?: number | null
          total_scans?: number | null
          updated_at?: string | null
          waypoints?: Json | null
        }
        Update: {
          completed_at?: string | null
          coverage_zones?: string[] | null
          created_at?: string | null
          created_by?: string | null
          drone_id?: string | null
          drone_model?: string | null
          estimated_duration_minutes?: number | null
          failed_analyses?: number | null
          id?: string
          mission_name?: string
          mission_type?: string | null
          organization_id?: string
          started_at?: string | null
          status?: string | null
          successful_analyses?: number | null
          total_scans?: number | null
          updated_at?: string | null
          waypoints?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: 'drone_missions_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      drone_scans: {
        Row: {
          ai_analysis_completed_at: string | null
          ai_analysis_started_at: string | null
          ai_analysis_status: string | null
          ai_error_message: string | null
          ai_fallback_used: boolean | null
          ai_model_used: string | null
          ai_processing_time_ms: number | null
          ai_retry_count: number | null
          aisle: string | null
          altitude_m: number | null
          captured_at: string
          created_at: string | null
          detected_barcodes: Json | null
          detected_objects: Json | null
          detected_texts: Json | null
          drone_id: string | null
          gps_lat: number | null
          gps_lng: number | null
          heading_degrees: number | null
          id: string
          image_dimensions: string | null
          image_size_bytes: number | null
          image_url: string
          inventory_assessment: Json | null
          mission_id: string | null
          organization_id: string
          rack_level: string | null
          raw_text: string | null
          scanned_by: string | null
          search_vector: unknown
          shelf_position: string | null
          spatial_description: string | null
          thumbnail_url: string | null
          updated_at: string | null
          warehouse_zone: string | null
        }
        Insert: {
          ai_analysis_completed_at?: string | null
          ai_analysis_started_at?: string | null
          ai_analysis_status?: string | null
          ai_error_message?: string | null
          ai_fallback_used?: boolean | null
          ai_model_used?: string | null
          ai_processing_time_ms?: number | null
          ai_retry_count?: number | null
          aisle?: string | null
          altitude_m?: number | null
          captured_at?: string
          created_at?: string | null
          detected_barcodes?: Json | null
          detected_objects?: Json | null
          detected_texts?: Json | null
          drone_id?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          heading_degrees?: number | null
          id?: string
          image_dimensions?: string | null
          image_size_bytes?: number | null
          image_url: string
          inventory_assessment?: Json | null
          mission_id?: string | null
          organization_id: string
          rack_level?: string | null
          raw_text?: string | null
          scanned_by?: string | null
          search_vector?: unknown
          shelf_position?: string | null
          spatial_description?: string | null
          thumbnail_url?: string | null
          updated_at?: string | null
          warehouse_zone?: string | null
        }
        Update: {
          ai_analysis_completed_at?: string | null
          ai_analysis_started_at?: string | null
          ai_analysis_status?: string | null
          ai_error_message?: string | null
          ai_fallback_used?: boolean | null
          ai_model_used?: string | null
          ai_processing_time_ms?: number | null
          ai_retry_count?: number | null
          aisle?: string | null
          altitude_m?: number | null
          captured_at?: string
          created_at?: string | null
          detected_barcodes?: Json | null
          detected_objects?: Json | null
          detected_texts?: Json | null
          drone_id?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          heading_degrees?: number | null
          id?: string
          image_dimensions?: string | null
          image_size_bytes?: number | null
          image_url?: string
          inventory_assessment?: Json | null
          mission_id?: string | null
          organization_id?: string
          rack_level?: string | null
          raw_text?: string | null
          scanned_by?: string | null
          search_vector?: unknown
          shelf_position?: string | null
          spatial_description?: string | null
          thumbnail_url?: string | null
          updated_at?: string | null
          warehouse_zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'drone_scans_mission_id_fkey'
            columns: ['mission_id']
            isOneToOne: false
            referencedRelation: 'drone_missions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'drone_scans_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      employee_certifications: {
        Row: {
          certification_name: string
          certification_number: string | null
          certification_type: string | null
          created_at: string | null
          created_by: string | null
          document_url: string | null
          expiration_date: string | null
          id: string
          is_required: boolean | null
          issue_date: string | null
          issuing_authority: string | null
          notes: string | null
          organization_id: string
          status: string | null
          updated_at: string | null
          user_id: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          certification_name: string
          certification_number?: string | null
          certification_type?: string | null
          created_at?: string | null
          created_by?: string | null
          document_url?: string | null
          expiration_date?: string | null
          id?: string
          is_required?: boolean | null
          issue_date?: string | null
          issuing_authority?: string | null
          notes?: string | null
          organization_id: string
          status?: string | null
          updated_at?: string | null
          user_id: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          certification_name?: string
          certification_number?: string | null
          certification_type?: string | null
          created_at?: string | null
          created_by?: string | null
          document_url?: string | null
          expiration_date?: string | null
          id?: string
          is_required?: boolean | null
          issue_date?: string | null
          issuing_authority?: string | null
          notes?: string | null
          organization_id?: string
          status?: string | null
          updated_at?: string | null
          user_id?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'employee_certifications_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'employee_certifications_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'employee_certifications_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'employee_certifications_verified_by_fkey'
            columns: ['verified_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      employee_devices: {
        Row: {
          asset_tag: string | null
          assigned_by: string | null
          assigned_date: string | null
          assignment_status: string | null
          condition: string | null
          created_at: string | null
          device_id: string | null
          device_name: string | null
          device_type: string
          id: string
          manufacturer: string | null
          model: string | null
          notes: string | null
          organization_id: string
          return_date: string | null
          serial_number: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          asset_tag?: string | null
          assigned_by?: string | null
          assigned_date?: string | null
          assignment_status?: string | null
          condition?: string | null
          created_at?: string | null
          device_id?: string | null
          device_name?: string | null
          device_type: string
          id?: string
          manufacturer?: string | null
          model?: string | null
          notes?: string | null
          organization_id: string
          return_date?: string | null
          serial_number?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          asset_tag?: string | null
          assigned_by?: string | null
          assigned_date?: string | null
          assignment_status?: string | null
          condition?: string | null
          created_at?: string | null
          device_id?: string | null
          device_name?: string | null
          device_type?: string
          id?: string
          manufacturer?: string | null
          model?: string | null
          notes?: string | null
          organization_id?: string
          return_date?: string | null
          serial_number?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'employee_devices_assigned_by_fkey'
            columns: ['assigned_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'employee_devices_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'employee_devices_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      enhanced_user_sessions: {
        Row: {
          created_at: string | null
          device_fingerprint: string | null
          expires_at: string
          id: string
          ip_address: unknown
          is_mobile: boolean | null
          is_trusted_device: boolean | null
          last_activity: string | null
          location_city: string | null
          location_country: string | null
          login_method: string | null
          mfa_verified: boolean | null
          refresh_token_hash: string | null
          revoke_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          session_token_hash: string
          updated_at: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          device_fingerprint?: string | null
          expires_at: string
          id?: string
          ip_address: unknown
          is_mobile?: boolean | null
          is_trusted_device?: boolean | null
          last_activity?: string | null
          location_city?: string | null
          location_country?: string | null
          login_method?: string | null
          mfa_verified?: boolean | null
          refresh_token_hash?: string | null
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          session_token_hash: string
          updated_at?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          device_fingerprint?: string | null
          expires_at?: string
          id?: string
          ip_address?: unknown
          is_mobile?: boolean | null
          is_trusted_device?: boolean | null
          last_activity?: string | null
          location_city?: string | null
          location_country?: string | null
          login_method?: string | null
          mfa_verified?: boolean | null
          refresh_token_hash?: string | null
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          session_token_hash?: string
          updated_at?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'enhanced_user_sessions_user_id_fkey_user_profiles'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      external_customer_profiles: {
        Row: {
          account_manager_id: string | null
          billing_address: string | null
          billing_contact_name: string | null
          billing_email: string | null
          billing_phone: string | null
          company_name: string
          company_size: string | null
          company_website: string | null
          contract_end_date: string | null
          contract_start_date: string | null
          contract_value: number | null
          created_at: string | null
          created_by: string | null
          custom_fields: Json | null
          custom_sla_config: Json | null
          customer_account_id: string
          id: string
          industry: string | null
          max_portal_users: number | null
          metadata: Json | null
          organization_id: string
          portal_enabled: boolean | null
          service_tier: string | null
          sla_level: string | null
          support_hours: string | null
          updated_at: string | null
        }
        Insert: {
          account_manager_id?: string | null
          billing_address?: string | null
          billing_contact_name?: string | null
          billing_email?: string | null
          billing_phone?: string | null
          company_name: string
          company_size?: string | null
          company_website?: string | null
          contract_end_date?: string | null
          contract_start_date?: string | null
          contract_value?: number | null
          created_at?: string | null
          created_by?: string | null
          custom_fields?: Json | null
          custom_sla_config?: Json | null
          customer_account_id: string
          id?: string
          industry?: string | null
          max_portal_users?: number | null
          metadata?: Json | null
          organization_id: string
          portal_enabled?: boolean | null
          service_tier?: string | null
          sla_level?: string | null
          support_hours?: string | null
          updated_at?: string | null
        }
        Update: {
          account_manager_id?: string | null
          billing_address?: string | null
          billing_contact_name?: string | null
          billing_email?: string | null
          billing_phone?: string | null
          company_name?: string
          company_size?: string | null
          company_website?: string | null
          contract_end_date?: string | null
          contract_start_date?: string | null
          contract_value?: number | null
          created_at?: string | null
          created_by?: string | null
          custom_fields?: Json | null
          custom_sla_config?: Json | null
          customer_account_id?: string
          id?: string
          industry?: string | null
          max_portal_users?: number | null
          metadata?: Json | null
          organization_id?: string
          portal_enabled?: boolean | null
          service_tier?: string | null
          sla_level?: string | null
          support_hours?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'external_customer_profiles_account_manager_id_fkey'
            columns: ['account_manager_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'external_customer_profiles_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'external_customer_profiles_customer_account_id_fkey'
            columns: ['customer_account_id']
            isOneToOne: true
            referencedRelation: 'customer_accounts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'external_customer_profiles_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      files: {
        Row: {
          bucket_name: string
          created_at: string | null
          file_name: string
          file_path: string
          id: string
          is_public: boolean | null
          metadata: Json | null
          mime_type: string | null
          organization_id: string | null
          size_bytes: number | null
          tags: string[] | null
          uploaded_by: string | null
        }
        Insert: {
          bucket_name: string
          created_at?: string | null
          file_name: string
          file_path: string
          id?: string
          is_public?: boolean | null
          metadata?: Json | null
          mime_type?: string | null
          organization_id?: string | null
          size_bytes?: number | null
          tags?: string[] | null
          uploaded_by?: string | null
        }
        Update: {
          bucket_name?: string
          created_at?: string | null
          file_name?: string
          file_path?: string
          id?: string
          is_public?: boolean | null
          metadata?: Json | null
          mime_type?: string | null
          organization_id?: string | null
          size_bytes?: number | null
          tags?: string[] | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'files_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'files_uploaded_by_fkey'
            columns: ['uploaded_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      grs_unknown_batches: {
        Row: {
          batch_number: string
          created_at: string | null
          found_at: string | null
          found_at_location: string
          found_by: string | null
          found_by_name: string | null
          grs_notes: string | null
          id: string
          material_number: string | null
          organization_id: string | null
          photo_url: string | null
          serial_number: string | null
          updated_at: string | null
        }
        Insert: {
          batch_number: string
          created_at?: string | null
          found_at?: string | null
          found_at_location: string
          found_by?: string | null
          found_by_name?: string | null
          grs_notes?: string | null
          id?: string
          material_number?: string | null
          organization_id?: string | null
          photo_url?: string | null
          serial_number?: string | null
          updated_at?: string | null
        }
        Update: {
          batch_number?: string
          created_at?: string | null
          found_at?: string | null
          found_at_location?: string
          found_by?: string | null
          found_by_name?: string | null
          grs_notes?: string | null
          id?: string
          material_number?: string | null
          organization_id?: string | null
          photo_url?: string | null
          serial_number?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'grs_unknown_batches_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      kb_article_feedback: {
        Row: {
          article_id: string
          created_at: string | null
          feedback_text: string | null
          id: string
          is_helpful: boolean
          metadata: Json | null
          user_email: string | null
          user_id: string | null
          user_type: string | null
        }
        Insert: {
          article_id: string
          created_at?: string | null
          feedback_text?: string | null
          id?: string
          is_helpful: boolean
          metadata?: Json | null
          user_email?: string | null
          user_id?: string | null
          user_type?: string | null
        }
        Update: {
          article_id?: string
          created_at?: string | null
          feedback_text?: string | null
          id?: string
          is_helpful?: boolean
          metadata?: Json | null
          user_email?: string | null
          user_id?: string | null
          user_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'kb_article_feedback_article_id_fkey'
            columns: ['article_id']
            isOneToOne: false
            referencedRelation: 'kb_articles'
            referencedColumns: ['id']
          },
        ]
      }
      kb_articles: {
        Row: {
          archived_at: string | null
          author_id: string | null
          category_id: string | null
          content: string
          created_at: string | null
          excerpt: string | null
          helpful_count: number | null
          id: string
          last_reviewed_at: string | null
          last_reviewed_by: string | null
          meta_description: string | null
          not_helpful_count: number | null
          organization_id: string
          published_at: string | null
          related_ticket_categories: string[] | null
          search_vector: unknown
          slug: string
          status: Database['public']['Enums']['article_status'] | null
          tags: string[] | null
          title: string
          updated_at: string | null
          view_count: number | null
          visibility: Database['public']['Enums']['article_visibility'] | null
        }
        Insert: {
          archived_at?: string | null
          author_id?: string | null
          category_id?: string | null
          content: string
          created_at?: string | null
          excerpt?: string | null
          helpful_count?: number | null
          id?: string
          last_reviewed_at?: string | null
          last_reviewed_by?: string | null
          meta_description?: string | null
          not_helpful_count?: number | null
          organization_id: string
          published_at?: string | null
          related_ticket_categories?: string[] | null
          search_vector?: unknown
          slug: string
          status?: Database['public']['Enums']['article_status'] | null
          tags?: string[] | null
          title: string
          updated_at?: string | null
          view_count?: number | null
          visibility?: Database['public']['Enums']['article_visibility'] | null
        }
        Update: {
          archived_at?: string | null
          author_id?: string | null
          category_id?: string | null
          content?: string
          created_at?: string | null
          excerpt?: string | null
          helpful_count?: number | null
          id?: string
          last_reviewed_at?: string | null
          last_reviewed_by?: string | null
          meta_description?: string | null
          not_helpful_count?: number | null
          organization_id?: string
          published_at?: string | null
          related_ticket_categories?: string[] | null
          search_vector?: unknown
          slug?: string
          status?: Database['public']['Enums']['article_status'] | null
          tags?: string[] | null
          title?: string
          updated_at?: string | null
          view_count?: number | null
          visibility?: Database['public']['Enums']['article_visibility'] | null
        }
        Relationships: [
          {
            foreignKeyName: 'kb_articles_author_id_fkey'
            columns: ['author_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'kb_articles_category_id_fkey'
            columns: ['category_id']
            isOneToOne: false
            referencedRelation: 'kb_categories'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'kb_articles_last_reviewed_by_fkey'
            columns: ['last_reviewed_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'kb_articles_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      kb_categories: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          display_order: number | null
          icon: string | null
          id: string
          name: string
          organization_id: string
          parent_category_id: string | null
          slug: string
          updated_at: string | null
          visibility: Database['public']['Enums']['article_visibility'] | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          display_order?: number | null
          icon?: string | null
          id?: string
          name: string
          organization_id: string
          parent_category_id?: string | null
          slug: string
          updated_at?: string | null
          visibility?: Database['public']['Enums']['article_visibility'] | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          display_order?: number | null
          icon?: string | null
          id?: string
          name?: string
          organization_id?: string
          parent_category_id?: string | null
          slug?: string
          updated_at?: string | null
          visibility?: Database['public']['Enums']['article_visibility'] | null
        }
        Relationships: [
          {
            foreignKeyName: 'kb_categories_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'kb_categories_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'kb_categories_parent_category_id_fkey'
            columns: ['parent_category_id']
            isOneToOne: false
            referencedRelation: 'kb_categories'
            referencedColumns: ['id']
          },
        ]
      }
      kb_search_history: {
        Row: {
          clicked_article_id: string | null
          created_at: string | null
          from_ticket_id: string | null
          id: string
          metadata: Json | null
          organization_id: string | null
          results_count: number | null
          search_query: string
          user_id: string | null
          user_type: string | null
        }
        Insert: {
          clicked_article_id?: string | null
          created_at?: string | null
          from_ticket_id?: string | null
          id?: string
          metadata?: Json | null
          organization_id?: string | null
          results_count?: number | null
          search_query: string
          user_id?: string | null
          user_type?: string | null
        }
        Update: {
          clicked_article_id?: string | null
          created_at?: string | null
          from_ticket_id?: string | null
          id?: string
          metadata?: Json | null
          organization_id?: string | null
          results_count?: number | null
          search_query?: string
          user_id?: string | null
          user_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'kb_search_history_clicked_article_id_fkey'
            columns: ['clicked_article_id']
            isOneToOne: false
            referencedRelation: 'kb_articles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'kb_search_history_from_ticket_id_fkey'
            columns: ['from_ticket_id']
            isOneToOne: false
            referencedRelation: 'support_tickets'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'kb_search_history_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      kit_build_flags: {
        Row: {
          cleared_by_user: string | null
          cleared_date_time: string | null
          created_at: string | null
          flag_type: string
          id: string
          is_active: boolean | null
          kit_po_number: string
          notes: string | null
          set_by_user: string | null
          set_date_time: string | null
          updated_at: string | null
        }
        Insert: {
          cleared_by_user?: string | null
          cleared_date_time?: string | null
          created_at?: string | null
          flag_type: string
          id?: string
          is_active?: boolean | null
          kit_po_number: string
          notes?: string | null
          set_by_user?: string | null
          set_date_time?: string | null
          updated_at?: string | null
        }
        Update: {
          cleared_by_user?: string | null
          cleared_date_time?: string | null
          created_at?: string | null
          flag_type?: string
          id?: string
          is_active?: boolean | null
          kit_po_number?: string
          notes?: string | null
          set_by_user?: string | null
          set_date_time?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'kit_build_flags_cleared_by_user_fkey'
            columns: ['cleared_by_user']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'kit_build_flags_set_by_user_fkey'
            columns: ['set_by_user']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      kit_kanban_columns: {
        Row: {
          column_color: string | null
          column_description: string | null
          column_display_name: string
          column_name: string
          created_at: string | null
          id: string
          is_active: boolean | null
          is_end_column: boolean | null
          is_start_column: boolean | null
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          column_color?: string | null
          column_description?: string | null
          column_display_name: string
          column_name: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_end_column?: boolean | null
          is_start_column?: boolean | null
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          column_color?: string | null
          column_description?: string | null
          column_display_name?: string
          column_name?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_end_column?: boolean | null
          is_start_column?: boolean | null
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      kit_kanban_tasks: {
        Row: {
          column_id: string
          created_at: string | null
          current_step: string | null
          current_worker_id: string | null
          current_worker_name: string | null
          due_date: string | null
          id: string
          kit_build_number: string | null
          kit_build_plan_id: string | null
          kit_po_number: string | null
          kit_serial_number: string | null
          last_touched_at: string | null
          last_touched_by_id: string | null
          last_touched_by_name: string | null
          position_in_column: number | null
          priority: number | null
          task_description: string | null
          task_title: string
          to_lines_kitted: number | null
          to_lines_picked: number | null
          total_to_lines: number | null
          updated_at: string | null
        }
        Insert: {
          column_id: string
          created_at?: string | null
          current_step?: string | null
          current_worker_id?: string | null
          current_worker_name?: string | null
          due_date?: string | null
          id?: string
          kit_build_number?: string | null
          kit_build_plan_id?: string | null
          kit_po_number?: string | null
          kit_serial_number?: string | null
          last_touched_at?: string | null
          last_touched_by_id?: string | null
          last_touched_by_name?: string | null
          position_in_column?: number | null
          priority?: number | null
          task_description?: string | null
          task_title: string
          to_lines_kitted?: number | null
          to_lines_picked?: number | null
          total_to_lines?: number | null
          updated_at?: string | null
        }
        Update: {
          column_id?: string
          created_at?: string | null
          current_step?: string | null
          current_worker_id?: string | null
          current_worker_name?: string | null
          due_date?: string | null
          id?: string
          kit_build_number?: string | null
          kit_build_plan_id?: string | null
          kit_po_number?: string | null
          kit_serial_number?: string | null
          last_touched_at?: string | null
          last_touched_by_id?: string | null
          last_touched_by_name?: string | null
          position_in_column?: number | null
          priority?: number | null
          task_description?: string | null
          task_title?: string
          to_lines_kitted?: number | null
          to_lines_picked?: number | null
          total_to_lines?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'kit_kanban_tasks_column_id_fkey'
            columns: ['column_id']
            isOneToOne: false
            referencedRelation: 'kit_kanban_columns'
            referencedColumns: ['id']
          },
        ]
      }
      labor_standards: {
        Row: {
          applies_to_days: Json | null
          applies_to_shifts: Json | null
          created_at: string | null
          created_by: string | null
          effective_from: string | null
          effective_to: string | null
          excellent_threshold: number | null
          id: string
          is_active: boolean | null
          maximum_acceptable: number | null
          minimum_acceptable: number | null
          organization_id: string
          position_id: string | null
          standard_name: string
          standard_type: string | null
          target_value: number
          task_type: string | null
          unit_of_measure: string
          updated_at: string | null
          working_area_id: string | null
        }
        Insert: {
          applies_to_days?: Json | null
          applies_to_shifts?: Json | null
          created_at?: string | null
          created_by?: string | null
          effective_from?: string | null
          effective_to?: string | null
          excellent_threshold?: number | null
          id?: string
          is_active?: boolean | null
          maximum_acceptable?: number | null
          minimum_acceptable?: number | null
          organization_id: string
          position_id?: string | null
          standard_name: string
          standard_type?: string | null
          target_value: number
          task_type?: string | null
          unit_of_measure: string
          updated_at?: string | null
          working_area_id?: string | null
        }
        Update: {
          applies_to_days?: Json | null
          applies_to_shifts?: Json | null
          created_at?: string | null
          created_by?: string | null
          effective_from?: string | null
          effective_to?: string | null
          excellent_threshold?: number | null
          id?: string
          is_active?: boolean | null
          maximum_acceptable?: number | null
          minimum_acceptable?: number | null
          organization_id?: string
          position_id?: string | null
          standard_name?: string
          standard_type?: string | null
          target_value?: number
          task_type?: string | null
          unit_of_measure?: string
          updated_at?: string | null
          working_area_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'labor_standards_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'labor_standards_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'labor_standards_position_id_fkey'
            columns: ['position_id']
            isOneToOne: false
            referencedRelation: 'shift_positions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'labor_standards_working_area_id_fkey'
            columns: ['working_area_id']
            isOneToOne: false
            referencedRelation: 'working_areas'
            referencedColumns: ['id']
          },
        ]
      }
      messages: {
        Row: {
          attachments: Json | null
          chat_id: string | null
          content: string
          created_at: string | null
          function_call: Json | null
          id: string
          metadata: Json | null
          role: string
          tokens_used: number | null
        }
        Insert: {
          attachments?: Json | null
          chat_id?: string | null
          content: string
          created_at?: string | null
          function_call?: Json | null
          id?: string
          metadata?: Json | null
          role: string
          tokens_used?: number | null
        }
        Update: {
          attachments?: Json | null
          chat_id?: string | null
          content?: string
          created_at?: string | null
          function_call?: Json | null
          id?: string
          metadata?: Json | null
          role?: string
          tokens_used?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'messages_chat_id_fkey'
            columns: ['chat_id']
            isOneToOne: false
            referencedRelation: 'chats'
            referencedColumns: ['id']
          },
        ]
      }
      navigation_items: {
        Row: {
          created_at: string | null
          description: string | null
          icon: string | null
          id: string
          name: string
          parent_id: string | null
          position: number | null
          title: string
          updated_at: string | null
          url: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          name: string
          parent_id?: string | null
          position?: number | null
          title: string
          updated_at?: string | null
          url?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          position?: number | null
          title?: string
          updated_at?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'navigation_items_parent_id_fkey'
            columns: ['parent_id']
            isOneToOne: false
            referencedRelation: 'navigation_items'
            referencedColumns: ['id']
          },
        ]
      }
      notifications: {
        Row: {
          action_url: string | null
          created_at: string | null
          data: Json | null
          id: string
          message: string | null
          read: boolean | null
          read_at: string | null
          title: string
          type: Database['public']['Enums']['notification_type'] | null
          user_id: string | null
        }
        Insert: {
          action_url?: string | null
          created_at?: string | null
          data?: Json | null
          id?: string
          message?: string | null
          read?: boolean | null
          read_at?: string | null
          title: string
          type?: Database['public']['Enums']['notification_type'] | null
          user_id?: string | null
        }
        Update: {
          action_url?: string | null
          created_at?: string | null
          data?: Json | null
          id?: string
          message?: string | null
          read?: boolean | null
          read_at?: string | null
          title?: string
          type?: Database['public']['Enums']['notification_type'] | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'notifications_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      onboarding_checklists: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string | null
          due_date: string | null
          id: string
          is_completed: boolean | null
          is_required: boolean | null
          onboarding_session_id: string | null
          organization_id: string
          sort_order: number | null
          task_category: string | null
          task_description: string | null
          task_name: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          due_date?: string | null
          id?: string
          is_completed?: boolean | null
          is_required?: boolean | null
          onboarding_session_id?: string | null
          organization_id: string
          sort_order?: number | null
          task_category?: string | null
          task_description?: string | null
          task_name: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          due_date?: string | null
          id?: string
          is_completed?: boolean | null
          is_required?: boolean | null
          onboarding_session_id?: string | null
          organization_id?: string
          sort_order?: number | null
          task_category?: string | null
          task_description?: string | null
          task_name?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'onboarding_checklists_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'onboarding_checklists_completed_by_fkey'
            columns: ['completed_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'onboarding_checklists_onboarding_session_id_fkey'
            columns: ['onboarding_session_id']
            isOneToOne: false
            referencedRelation: 'onboarding_sessions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'onboarding_checklists_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'onboarding_checklists_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      onboarding_sessions: {
        Row: {
          authentication_setup: Json | null
          certifications: Json | null
          completed_at: string | null
          created_at: string | null
          created_by: string
          created_user_id: string | null
          current_step: number | null
          device_registration: Json | null
          expires_at: string | null
          id: string
          organization_id: string
          personal_info: Json | null
          position_assignment: Json | null
          role_assignment: Json | null
          session_status: string | null
          shift_schedule: Json | null
          total_steps: number | null
          updated_at: string | null
          working_area: Json | null
        }
        Insert: {
          authentication_setup?: Json | null
          certifications?: Json | null
          completed_at?: string | null
          created_at?: string | null
          created_by: string
          created_user_id?: string | null
          current_step?: number | null
          device_registration?: Json | null
          expires_at?: string | null
          id?: string
          organization_id: string
          personal_info?: Json | null
          position_assignment?: Json | null
          role_assignment?: Json | null
          session_status?: string | null
          shift_schedule?: Json | null
          total_steps?: number | null
          updated_at?: string | null
          working_area?: Json | null
        }
        Update: {
          authentication_setup?: Json | null
          certifications?: Json | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string
          created_user_id?: string | null
          current_step?: number | null
          device_registration?: Json | null
          expires_at?: string | null
          id?: string
          organization_id?: string
          personal_info?: Json | null
          position_assignment?: Json | null
          role_assignment?: Json | null
          session_status?: string | null
          shift_schedule?: Json | null
          total_steps?: number | null
          updated_at?: string | null
          working_area?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: 'onboarding_sessions_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'onboarding_sessions_created_user_id_fkey'
            columns: ['created_user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'onboarding_sessions_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      organizational_hierarchy: {
        Row: {
          created_at: string | null
          created_by: string | null
          delegation_authority: Json | null
          effective_from: string
          effective_to: string | null
          id: string
          is_active: boolean | null
          level_difference: number | null
          organization_id: string
          relationship_type: string | null
          subordinate_id: string
          supervisor_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          delegation_authority?: Json | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          is_active?: boolean | null
          level_difference?: number | null
          organization_id: string
          relationship_type?: string | null
          subordinate_id: string
          supervisor_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          delegation_authority?: Json | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          is_active?: boolean | null
          level_difference?: number | null
          organization_id?: string
          relationship_type?: string | null
          subordinate_id?: string
          supervisor_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'organizational_hierarchy_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'organizational_hierarchy_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'organizational_hierarchy_subordinate_id_fkey'
            columns: ['subordinate_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'organizational_hierarchy_supervisor_id_fkey'
            columns: ['supervisor_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string | null
          default_role_id: string | null
          default_user_role: Database['public']['Enums']['user_role']
          id: string
          logo_url: string | null
          name: string
          settings: Json | null
          slug: string
          subscription_tier: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          default_role_id?: string | null
          default_user_role?: Database['public']['Enums']['user_role']
          id?: string
          logo_url?: string | null
          name: string
          settings?: Json | null
          slug: string
          subscription_tier?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          default_role_id?: string | null
          default_user_role?: Database['public']['Enums']['user_role']
          id?: string
          logo_url?: string | null
          name?: string
          settings?: Json | null
          slug?: string
          subscription_tier?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'organizations_default_role_id_fkey'
            columns: ['default_role_id']
            isOneToOne: false
            referencedRelation: 'roles'
            referencedColumns: ['id']
          },
        ]
      }
      outbound_to_data: {
        Row: {
          batch: string | null
          created_at: string
          creation_date: string | null
          creation_time: string | null
          delivery: string | null
          dest_storage_type: string | null
          final_packed_at: string | null
          final_packed_by: string | null
          has_8130_3: boolean | null
          id: string
          is_8130_3_signed: boolean | null
          label_printed_at: string | null
          material: string | null
          material_description: string | null
          movement_type_im: string | null
          movement_type_wm: string | null
          organization_id: string | null
          package_height: number | null
          package_length: number | null
          package_weight: number | null
          package_width: number | null
          packed_at: string | null
          packed_by: string | null
          picked_at: string | null
          picked_by: string | null
          plant: string | null
          printer: string | null
          requires_8130_3: boolean | null
          shipped_at: string | null
          shipped_by: string | null
          shipper_type: string | null
          source_storage_bin: string | null
          source_storage_type: string | null
          source_target_qty: number | null
          status: Database['public']['Enums']['outbound_status']
          storage_location: string | null
          tracking_number: string | null
          transfer_order_number: string | null
          transfer_order_priority: string | null
          updated_at: string
          uploaded_by: string | null
          user_name: string | null
          warehouse_number: string | null
          waved_at: string | null
          waved_by: string | null
          wawf_placed_at: string | null
          wawf_placed_by: string | null
          wawf_status: string | null
        }
        Insert: {
          batch?: string | null
          created_at?: string
          creation_date?: string | null
          creation_time?: string | null
          delivery?: string | null
          dest_storage_type?: string | null
          final_packed_at?: string | null
          final_packed_by?: string | null
          has_8130_3?: boolean | null
          id?: string
          is_8130_3_signed?: boolean | null
          label_printed_at?: string | null
          material?: string | null
          material_description?: string | null
          movement_type_im?: string | null
          movement_type_wm?: string | null
          organization_id?: string | null
          package_height?: number | null
          package_length?: number | null
          package_weight?: number | null
          package_width?: number | null
          packed_at?: string | null
          packed_by?: string | null
          picked_at?: string | null
          picked_by?: string | null
          plant?: string | null
          printer?: string | null
          requires_8130_3?: boolean | null
          shipped_at?: string | null
          shipped_by?: string | null
          shipper_type?: string | null
          source_storage_bin?: string | null
          source_storage_type?: string | null
          source_target_qty?: number | null
          status?: Database['public']['Enums']['outbound_status']
          storage_location?: string | null
          tracking_number?: string | null
          transfer_order_number?: string | null
          transfer_order_priority?: string | null
          updated_at?: string
          uploaded_by?: string | null
          user_name?: string | null
          warehouse_number?: string | null
          waved_at?: string | null
          waved_by?: string | null
          wawf_placed_at?: string | null
          wawf_placed_by?: string | null
          wawf_status?: string | null
        }
        Update: {
          batch?: string | null
          created_at?: string
          creation_date?: string | null
          creation_time?: string | null
          delivery?: string | null
          dest_storage_type?: string | null
          final_packed_at?: string | null
          final_packed_by?: string | null
          has_8130_3?: boolean | null
          id?: string
          is_8130_3_signed?: boolean | null
          label_printed_at?: string | null
          material?: string | null
          material_description?: string | null
          movement_type_im?: string | null
          movement_type_wm?: string | null
          organization_id?: string | null
          package_height?: number | null
          package_length?: number | null
          package_weight?: number | null
          package_width?: number | null
          packed_at?: string | null
          packed_by?: string | null
          picked_at?: string | null
          picked_by?: string | null
          plant?: string | null
          printer?: string | null
          requires_8130_3?: boolean | null
          shipped_at?: string | null
          shipped_by?: string | null
          shipper_type?: string | null
          source_storage_bin?: string | null
          source_storage_type?: string | null
          source_target_qty?: number | null
          status?: Database['public']['Enums']['outbound_status']
          storage_location?: string | null
          tracking_number?: string | null
          transfer_order_number?: string | null
          transfer_order_priority?: string | null
          updated_at?: string
          uploaded_by?: string | null
          user_name?: string | null
          warehouse_number?: string | null
          waved_at?: string | null
          waved_by?: string | null
          wawf_placed_at?: string | null
          wawf_placed_by?: string | null
          wawf_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'outbound_to_data_final_packed_by_fkey'
            columns: ['final_packed_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'outbound_to_data_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'outbound_to_data_packed_by_fkey'
            columns: ['packed_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'outbound_to_data_picked_by_fkey'
            columns: ['picked_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'outbound_to_data_shipped_by_fkey'
            columns: ['shipped_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'outbound_to_data_uploaded_by_fkey'
            columns: ['uploaded_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'outbound_to_data_waved_by_fkey'
            columns: ['waved_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'outbound_to_data_wawf_placed_by_fkey'
            columns: ['wawf_placed_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      overtime_requests: {
        Row: {
          actual_duration_minutes: number | null
          actual_end_time: string | null
          approved_at: string | null
          approved_by: string | null
          assigned_user_ids: string[]
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          extended_shift_end: string
          id: string
          is_paid: boolean | null
          is_voluntary: boolean | null
          notes: string | null
          organization_id: string
          original_shift_end: string
          overtime_duration_minutes: number
          pay_multiplier: number | null
          priority: string | null
          reason: string | null
          rejection_reason: string | null
          request_date: string
          request_number: string
          requested_by: string | null
          scope_type: string | null
          status: Database['public']['Enums']['overtime_status'] | null
          updated_at: string | null
          working_area_id: string | null
        }
        Insert: {
          actual_duration_minutes?: number | null
          actual_end_time?: string | null
          approved_at?: string | null
          approved_by?: string | null
          assigned_user_ids: string[]
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          extended_shift_end: string
          id?: string
          is_paid?: boolean | null
          is_voluntary?: boolean | null
          notes?: string | null
          organization_id: string
          original_shift_end: string
          overtime_duration_minutes: number
          pay_multiplier?: number | null
          priority?: string | null
          reason?: string | null
          rejection_reason?: string | null
          request_date?: string
          request_number: string
          requested_by?: string | null
          scope_type?: string | null
          status?: Database['public']['Enums']['overtime_status'] | null
          updated_at?: string | null
          working_area_id?: string | null
        }
        Update: {
          actual_duration_minutes?: number | null
          actual_end_time?: string | null
          approved_at?: string | null
          approved_by?: string | null
          assigned_user_ids?: string[]
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          extended_shift_end?: string
          id?: string
          is_paid?: boolean | null
          is_voluntary?: boolean | null
          notes?: string | null
          organization_id?: string
          original_shift_end?: string
          overtime_duration_minutes?: number
          pay_multiplier?: number | null
          priority?: string | null
          reason?: string | null
          rejection_reason?: string | null
          request_date?: string
          request_number?: string
          requested_by?: string | null
          scope_type?: string | null
          status?: Database['public']['Enums']['overtime_status'] | null
          updated_at?: string | null
          working_area_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'overtime_requests_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'overtime_requests_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'overtime_requests_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'overtime_requests_requested_by_fkey'
            columns: ['requested_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'overtime_requests_working_area_id_fkey'
            columns: ['working_area_id']
            isOneToOne: false
            referencedRelation: 'working_areas'
            referencedColumns: ['id']
          },
        ]
      }
      overtime_signups: {
        Row: {
          checked_in_at: string | null
          checked_out_at: string | null
          created_at: string | null
          decline_reason: string | null
          id: string
          organization_id: string
          overtime_request_id: string | null
          response: string | null
          response_time: string | null
          signup_date: string
          status: Database['public']['Enums']['overtime_status'] | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          checked_in_at?: string | null
          checked_out_at?: string | null
          created_at?: string | null
          decline_reason?: string | null
          id?: string
          organization_id: string
          overtime_request_id?: string | null
          response?: string | null
          response_time?: string | null
          signup_date?: string
          status?: Database['public']['Enums']['overtime_status'] | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          checked_in_at?: string | null
          checked_out_at?: string | null
          created_at?: string | null
          decline_reason?: string | null
          id?: string
          organization_id?: string
          overtime_request_id?: string | null
          response?: string | null
          response_time?: string | null
          signup_date?: string
          status?: Database['public']['Enums']['overtime_status'] | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'overtime_signups_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'overtime_signups_overtime_request_id_fkey'
            columns: ['overtime_request_id']
            isOneToOne: false
            referencedRelation: 'overtime_requests'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'overtime_signups_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      permissions: {
        Row: {
          action: string
          created_at: string | null
          description: string | null
          id: string
          name: string
          resource: string
        }
        Insert: {
          action: string
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          resource: string
        }
        Update: {
          action?: string
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          resource?: string
        }
        Relationships: []
      }
      portal_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string | null
          customer_account_id: string
          email: string
          expires_at: string
          id: string
          invitation_message: string | null
          invitation_token: string
          invited_by: string
          organization_id: string
          portal_role: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string | null
          customer_account_id: string
          email: string
          expires_at?: string
          id?: string
          invitation_message?: string | null
          invitation_token: string
          invited_by: string
          organization_id: string
          portal_role?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string | null
          customer_account_id?: string
          email?: string
          expires_at?: string
          id?: string
          invitation_message?: string | null
          invitation_token?: string
          invited_by?: string
          organization_id?: string
          portal_role?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'portal_invitations_customer_account_id_fkey'
            columns: ['customer_account_id']
            isOneToOne: false
            referencedRelation: 'customer_accounts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'portal_invitations_invited_by_fkey'
            columns: ['invited_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'portal_invitations_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      position_certification_requirements: {
        Row: {
          certification_name: string
          certification_type: string | null
          created_at: string | null
          grace_period_days: number | null
          id: string
          is_mandatory: boolean | null
          organization_id: string
          position_id: string
          updated_at: string | null
        }
        Insert: {
          certification_name: string
          certification_type?: string | null
          created_at?: string | null
          grace_period_days?: number | null
          id?: string
          is_mandatory?: boolean | null
          organization_id: string
          position_id: string
          updated_at?: string | null
        }
        Update: {
          certification_name?: string
          certification_type?: string | null
          created_at?: string | null
          grace_period_days?: number | null
          id?: string
          is_mandatory?: boolean | null
          organization_id?: string
          position_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'position_certification_requirements_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'position_certification_requirements_position_id_fkey'
            columns: ['position_id']
            isOneToOne: false
            referencedRelation: 'shift_positions'
            referencedColumns: ['id']
          },
        ]
      }
      position_level_options: {
        Row: {
          color_code: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          display_order: number | null
          id: string
          is_active: boolean | null
          level_label: string
          level_value: number
          organization_id: string
          updated_at: string | null
        }
        Insert: {
          color_code?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          level_label: string
          level_value: number
          organization_id: string
          updated_at?: string | null
        }
        Update: {
          color_code?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          level_label?: string
          level_value?: number
          organization_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'position_level_options_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'position_level_options_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      position_type_options: {
        Row: {
          color_code: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          display_order: number | null
          icon_name: string | null
          id: string
          is_active: boolean | null
          organization_id: string
          type_label: string
          type_value: string
          updated_at: string | null
        }
        Insert: {
          color_code?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          display_order?: number | null
          icon_name?: string | null
          id?: string
          is_active?: boolean | null
          organization_id: string
          type_label: string
          type_value: string
          updated_at?: string | null
        }
        Update: {
          color_code?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          display_order?: number | null
          icon_name?: string | null
          id?: string
          is_active?: boolean | null
          organization_id?: string
          type_label?: string
          type_value?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'position_type_options_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'position_type_options_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      putback_tickets: {
        Row: {
          created_at: string
          created_by: string
          delivery_id: string
          id: string
          material_description: string | null
          material_number: string
          organization_id: string
          original_delivery_data: Json | null
          original_storage_bin: string | null
          processed_at: string | null
          processed_by: string | null
          putback_number: string
          quantity_returned: number
          status: Database['public']['Enums']['putback_status']
        }
        Insert: {
          created_at?: string
          created_by: string
          delivery_id: string
          id?: string
          material_description?: string | null
          material_number: string
          organization_id: string
          original_delivery_data?: Json | null
          original_storage_bin?: string | null
          processed_at?: string | null
          processed_by?: string | null
          putback_number: string
          quantity_returned: number
          status?: Database['public']['Enums']['putback_status']
        }
        Update: {
          created_at?: string
          created_by?: string
          delivery_id?: string
          id?: string
          material_description?: string | null
          material_number?: string
          organization_id?: string
          original_delivery_data?: Json | null
          original_storage_bin?: string | null
          processed_at?: string | null
          processed_by?: string | null
          putback_number?: string
          quantity_returned?: number
          status?: Database['public']['Enums']['putback_status']
        }
        Relationships: [
          {
            foreignKeyName: 'putback_tickets_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'putback_tickets_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'putback_tickets_processed_by_fkey'
            columns: ['processed_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      queue_rules: {
        Row: {
          actions: Json
          active: boolean | null
          conditions: Json
          created_at: string | null
          created_by: string | null
          end_date: string | null
          id: string
          organization_id: string
          priority: number | null
          rule_name: string
          rule_type: string
          start_date: string | null
          updated_at: string | null
        }
        Insert: {
          actions: Json
          active?: boolean | null
          conditions: Json
          created_at?: string | null
          created_by?: string | null
          end_date?: string | null
          id?: string
          organization_id: string
          priority?: number | null
          rule_name: string
          rule_type: string
          start_date?: string | null
          updated_at?: string | null
        }
        Update: {
          actions?: Json
          active?: boolean | null
          conditions?: Json
          created_at?: string | null
          created_by?: string | null
          end_date?: string | null
          id?: string
          organization_id?: string
          priority?: number | null
          rule_name?: string
          rule_type?: string
          start_date?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'queue_rules_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'queue_rules_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      rf_putaway_operations: {
        Row: {
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string | null
          created_by: string | null
          id: string
          is_mca_workflow: boolean | null
          material_number: string
          mca_drop_location: string | null
          mca_processed_at: string | null
          mca_processed_by: string | null
          mca_reason: string | null
          mca_reason_code: string | null
          mca_redirected_location: string | null
          mca_space_assessment: string | null
          organization_id: string
          putaway_date: string | null
          putaway_driver: string
          putaway_time: string | null
          raw_to_number: string
          scanned_shelf_location: string | null
          scanner_type: string | null
          session_id: string | null
          shelf_location: string
          to_location: string
          to_number: string
          to_status: string | null
          updated_at: string | null
          warehouse: string | null
        }
        Insert: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_mca_workflow?: boolean | null
          material_number: string
          mca_drop_location?: string | null
          mca_processed_at?: string | null
          mca_processed_by?: string | null
          mca_reason?: string | null
          mca_reason_code?: string | null
          mca_redirected_location?: string | null
          mca_space_assessment?: string | null
          organization_id: string
          putaway_date?: string | null
          putaway_driver: string
          putaway_time?: string | null
          raw_to_number: string
          scanned_shelf_location?: string | null
          scanner_type?: string | null
          session_id?: string | null
          shelf_location: string
          to_location: string
          to_number: string
          to_status?: string | null
          updated_at?: string | null
          warehouse?: string | null
        }
        Update: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_mca_workflow?: boolean | null
          material_number?: string
          mca_drop_location?: string | null
          mca_processed_at?: string | null
          mca_processed_by?: string | null
          mca_reason?: string | null
          mca_reason_code?: string | null
          mca_redirected_location?: string | null
          mca_space_assessment?: string | null
          organization_id?: string
          putaway_date?: string | null
          putaway_driver?: string
          putaway_time?: string | null
          raw_to_number?: string
          scanned_shelf_location?: string | null
          scanner_type?: string | null
          session_id?: string | null
          shelf_location?: string
          to_location?: string
          to_number?: string
          to_status?: string | null
          updated_at?: string | null
          warehouse?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'rf_putaway_operations_confirmed_by_fkey'
            columns: ['confirmed_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rf_putaway_operations_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      role_delegation: {
        Row: {
          created_at: string | null
          delegate_id: string | null
          delegator_id: string | null
          expires_at: string | null
          id: string
          is_active: boolean | null
          permissions: Json
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          delegate_id?: string | null
          delegator_id?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          permissions: Json
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          delegate_id?: string | null
          delegator_id?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          permissions?: Json
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'role_delegation_delegate_id_fkey'
            columns: ['delegate_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'role_delegation_delegator_id_fkey'
            columns: ['delegator_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      role_hierarchy: {
        Row: {
          child_role_id: string
          created_at: string | null
          inheritance_type: string | null
          parent_role_id: string
          updated_at: string | null
        }
        Insert: {
          child_role_id: string
          created_at?: string | null
          inheritance_type?: string | null
          parent_role_id: string
          updated_at?: string | null
        }
        Update: {
          child_role_id?: string
          created_at?: string | null
          inheritance_type?: string | null
          parent_role_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'role_hierarchy_child_role_id_fkey'
            columns: ['child_role_id']
            isOneToOne: false
            referencedRelation: 'roles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'role_hierarchy_parent_role_id_fkey'
            columns: ['parent_role_id']
            isOneToOne: false
            referencedRelation: 'roles'
            referencedColumns: ['id']
          },
        ]
      }
      role_navigation_permissions: {
        Row: {
          created_at: string | null
          navigation_item_id: string
          role: Database['public']['Enums']['user_role']
          role_id: string
          visible: boolean | null
        }
        Insert: {
          created_at?: string | null
          navigation_item_id: string
          role: Database['public']['Enums']['user_role']
          role_id: string
          visible?: boolean | null
        }
        Update: {
          created_at?: string | null
          navigation_item_id?: string
          role?: Database['public']['Enums']['user_role']
          role_id?: string
          visible?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: 'role_navigation_permissions_navigation_item_id_fkey'
            columns: ['navigation_item_id']
            isOneToOne: false
            referencedRelation: 'navigation_items'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'role_navigation_permissions_role_id_fkey'
            columns: ['role_id']
            isOneToOne: false
            referencedRelation: 'roles'
            referencedColumns: ['id']
          },
        ]
      }
      role_permissions: {
        Row: {
          condition_logic: string | null
          conditions: Json | null
          created_at: string | null
          geo_restrictions: Json | null
          ip_restrictions: Json | null
          permission_id: string
          requires_conditions: boolean | null
          role: Database['public']['Enums']['user_role']
          role_id: string
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          condition_logic?: string | null
          conditions?: Json | null
          created_at?: string | null
          geo_restrictions?: Json | null
          ip_restrictions?: Json | null
          permission_id: string
          requires_conditions?: boolean | null
          role: Database['public']['Enums']['user_role']
          role_id: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          condition_logic?: string | null
          conditions?: Json | null
          created_at?: string | null
          geo_restrictions?: Json | null
          ip_restrictions?: Json | null
          permission_id?: string
          requires_conditions?: boolean | null
          role?: Database['public']['Enums']['user_role']
          role_id?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'role_permissions_permission_id_fkey'
            columns: ['permission_id']
            isOneToOne: false
            referencedRelation: 'permissions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'role_permissions_role_id_fkey'
            columns: ['role_id']
            isOneToOne: false
            referencedRelation: 'roles'
            referencedColumns: ['id']
          },
        ]
      }
      role_tab_permissions: {
        Row: {
          created_at: string | null
          granted: boolean | null
          id: string
          role_id: string
          tab_definition_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          granted?: boolean | null
          id?: string
          role_id: string
          tab_definition_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          granted?: boolean | null
          id?: string
          role_id?: string
          tab_definition_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'role_tab_permissions_role_id_fkey'
            columns: ['role_id']
            isOneToOne: false
            referencedRelation: 'roles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'role_tab_permissions_tab_definition_id_fkey'
            columns: ['tab_definition_id']
            isOneToOne: false
            referencedRelation: 'tab_definitions'
            referencedColumns: ['id']
          },
        ]
      }
      roles: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          display_name: string
          id: string
          is_active: boolean | null
          is_system: boolean | null
          name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          display_name: string
          id?: string
          is_active?: boolean | null
          is_system?: boolean | null
          name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          display_name?: string
          id?: string
          is_active?: boolean | null
          is_system?: boolean | null
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      rr_all_deliveries: {
        Row: {
          actual_goods_movement_date: string | null
          created_at: string
          customer_name: string | null
          delivery: string
          delivery_block: string | null
          delivery_change_by: string | null
          delivery_change_date: string | null
          delivery_changed_by_name: string | null
          delivery_create_time: string | null
          delivery_created_by: string | null
          delivery_created_name: string | null
          delivery_creation_date: string | null
          delivery_priority: string | null
          dispositions: string | null
          external_identification_1: string | null
          goods_movement_status: string | null
          id: string
          is_deleted: boolean | null
          organization_id: string
          receiving_point: string | null
          sales_organization: string | null
          ship_to_party: string | null
          shipment_create_by: string | null
          shipment_create_date: string | null
          shipment_created_name: string | null
          shipment_number: string | null
          shipping_point: string | null
          transfer_order_confirm_date: string | null
          transfer_order_create_date: string | null
          transfer_order_create_time: string | null
          transfer_order_number: string | null
          updated_at: string
          warehouse_number: string | null
        }
        Insert: {
          actual_goods_movement_date?: string | null
          created_at?: string
          customer_name?: string | null
          delivery: string
          delivery_block?: string | null
          delivery_change_by?: string | null
          delivery_change_date?: string | null
          delivery_changed_by_name?: string | null
          delivery_create_time?: string | null
          delivery_created_by?: string | null
          delivery_created_name?: string | null
          delivery_creation_date?: string | null
          delivery_priority?: string | null
          dispositions?: string | null
          external_identification_1?: string | null
          goods_movement_status?: string | null
          id?: string
          is_deleted?: boolean | null
          organization_id: string
          receiving_point?: string | null
          sales_organization?: string | null
          ship_to_party?: string | null
          shipment_create_by?: string | null
          shipment_create_date?: string | null
          shipment_created_name?: string | null
          shipment_number?: string | null
          shipping_point?: string | null
          transfer_order_confirm_date?: string | null
          transfer_order_create_date?: string | null
          transfer_order_create_time?: string | null
          transfer_order_number?: string | null
          updated_at?: string
          warehouse_number?: string | null
        }
        Update: {
          actual_goods_movement_date?: string | null
          created_at?: string
          customer_name?: string | null
          delivery?: string
          delivery_block?: string | null
          delivery_change_by?: string | null
          delivery_change_date?: string | null
          delivery_changed_by_name?: string | null
          delivery_create_time?: string | null
          delivery_created_by?: string | null
          delivery_created_name?: string | null
          delivery_creation_date?: string | null
          delivery_priority?: string | null
          dispositions?: string | null
          external_identification_1?: string | null
          goods_movement_status?: string | null
          id?: string
          is_deleted?: boolean | null
          organization_id?: string
          receiving_point?: string | null
          sales_organization?: string | null
          ship_to_party?: string | null
          shipment_create_by?: string | null
          shipment_create_date?: string | null
          shipment_created_name?: string | null
          shipment_number?: string | null
          shipping_point?: string | null
          transfer_order_confirm_date?: string | null
          transfer_order_create_date?: string | null
          transfer_order_create_time?: string | null
          transfer_order_number?: string | null
          updated_at?: string
          warehouse_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'rr_all_deliveries_dispositions_fkey'
            columns: ['dispositions']
            isOneToOne: false
            referencedRelation: 'delivery_dispositions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_all_deliveries_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      rr_customer_portal_activity: {
        Row: {
          activity_type: string
          created_at: string | null
          details: Json | null
          error_message: string | null
          id: string
          ip_address: unknown
          request_id: string | null
          row_id: number | null
          sheet_id: number
          status: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          activity_type: string
          created_at?: string | null
          details?: Json | null
          error_message?: string | null
          id?: string
          ip_address?: unknown
          request_id?: string | null
          row_id?: number | null
          sheet_id: number
          status?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          activity_type?: string
          created_at?: string | null
          details?: Json | null
          error_message?: string | null
          id?: string
          ip_address?: unknown
          request_id?: string | null
          row_id?: number | null
          sheet_id?: number
          status?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'rr_customer_portal_activity_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      rr_customer_portal_cache: {
        Row: {
          access_count: number | null
          cache_key: string
          cache_type: string
          created_at: string | null
          data: Json
          expires_at: string
          id: string
          last_accessed_at: string | null
          row_count: number | null
          sheet_id: number
        }
        Insert: {
          access_count?: number | null
          cache_key: string
          cache_type: string
          created_at?: string | null
          data: Json
          expires_at: string
          id?: string
          last_accessed_at?: string | null
          row_count?: number | null
          sheet_id: number
        }
        Update: {
          access_count?: number | null
          cache_key?: string
          cache_type?: string
          created_at?: string | null
          data?: Json
          expires_at?: string
          id?: string
          last_accessed_at?: string | null
          row_count?: number | null
          sheet_id?: number
        }
        Relationships: []
      }
      rr_customer_portal_config: {
        Row: {
          allow_submissions: boolean | null
          created_at: string | null
          created_by: string | null
          customer_email_column_id: number | null
          date_submitted_column_id: number | null
          delivery_number_column_id: number | null
          id: string
          is_active: boolean | null
          material_number_column_id: number | null
          primary_column_id: number | null
          quantity_column_id: number | null
          request_notes_column_id: number | null
          requestor_name_column_id: number | null
          require_approval: boolean | null
          sheet_id: number
          sheet_name: string
          status_column_id: number | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          allow_submissions?: boolean | null
          created_at?: string | null
          created_by?: string | null
          customer_email_column_id?: number | null
          date_submitted_column_id?: number | null
          delivery_number_column_id?: number | null
          id?: string
          is_active?: boolean | null
          material_number_column_id?: number | null
          primary_column_id?: number | null
          quantity_column_id?: number | null
          request_notes_column_id?: number | null
          requestor_name_column_id?: number | null
          require_approval?: boolean | null
          sheet_id: number
          sheet_name: string
          status_column_id?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          allow_submissions?: boolean | null
          created_at?: string | null
          created_by?: string | null
          customer_email_column_id?: number | null
          date_submitted_column_id?: number | null
          delivery_number_column_id?: number | null
          id?: string
          is_active?: boolean | null
          material_number_column_id?: number | null
          primary_column_id?: number | null
          quantity_column_id?: number | null
          request_notes_column_id?: number | null
          requestor_name_column_id?: number | null
          require_approval?: boolean | null
          sheet_id?: number
          sheet_name?: string
          status_column_id?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      rr_customer_portal_permissions: {
        Row: {
          can_delete_own_requests: boolean | null
          can_edit_own_requests: boolean | null
          can_submit_requests: boolean | null
          can_view_all_requests: boolean | null
          can_view_internal_notes: boolean | null
          created_at: string | null
          created_by: string | null
          id: string
          max_requests_per_day: number | null
          max_requests_per_month: number | null
          updated_at: string | null
          updated_by: string | null
          user_id: string
        }
        Insert: {
          can_delete_own_requests?: boolean | null
          can_edit_own_requests?: boolean | null
          can_submit_requests?: boolean | null
          can_view_all_requests?: boolean | null
          can_view_internal_notes?: boolean | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          max_requests_per_day?: number | null
          max_requests_per_month?: number | null
          updated_at?: string | null
          updated_by?: string | null
          user_id: string
        }
        Update: {
          can_delete_own_requests?: boolean | null
          can_edit_own_requests?: boolean | null
          can_submit_requests?: boolean | null
          can_view_all_requests?: boolean | null
          can_view_internal_notes?: boolean | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          max_requests_per_day?: number | null
          max_requests_per_month?: number | null
          updated_at?: string | null
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'rr_customer_portal_permissions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: true
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      rr_cycle_count_recount_history: {
        Row: {
          agreement_status: string | null
          completed_at: string | null
          created_at: string
          id: string
          initiated_at: string
          initiated_by: string
          organization_id: string
          original_count_date: string | null
          original_count_id: string
          original_counted_quantity: number | null
          original_counter_id: string | null
          original_counter_name: string | null
          original_notes: string | null
          original_variance_percentage: number | null
          original_variance_quantity: number | null
          recount_counter_id: string | null
          recount_counter_name: string | null
          recount_date: string | null
          recount_notes: string | null
          recount_number: number | null
          recount_quantity: number | null
          recount_reason: string
          recount_variance_percentage: number | null
          recount_variance_quantity: number | null
          resolution_action: string | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          updated_at: string | null
          variance_difference: number | null
        }
        Insert: {
          agreement_status?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          initiated_at?: string
          initiated_by: string
          organization_id: string
          original_count_date?: string | null
          original_count_id: string
          original_counted_quantity?: number | null
          original_counter_id?: string | null
          original_counter_name?: string | null
          original_notes?: string | null
          original_variance_percentage?: number | null
          original_variance_quantity?: number | null
          recount_counter_id?: string | null
          recount_counter_name?: string | null
          recount_date?: string | null
          recount_notes?: string | null
          recount_number?: number | null
          recount_quantity?: number | null
          recount_reason: string
          recount_variance_percentage?: number | null
          recount_variance_quantity?: number | null
          resolution_action?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          updated_at?: string | null
          variance_difference?: number | null
        }
        Update: {
          agreement_status?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          initiated_at?: string
          initiated_by?: string
          organization_id?: string
          original_count_date?: string | null
          original_count_id?: string
          original_counted_quantity?: number | null
          original_counter_id?: string | null
          original_counter_name?: string | null
          original_notes?: string | null
          original_variance_percentage?: number | null
          original_variance_quantity?: number | null
          recount_counter_id?: string | null
          recount_counter_name?: string | null
          recount_date?: string | null
          recount_notes?: string | null
          recount_number?: number | null
          recount_quantity?: number | null
          recount_reason?: string
          recount_variance_percentage?: number | null
          recount_variance_quantity?: number | null
          resolution_action?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          updated_at?: string | null
          variance_difference?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'rr_cycle_count_recount_history_initiated_by_fkey'
            columns: ['initiated_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_cycle_count_recount_history_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_cycle_count_recount_history_original_count_id_fkey'
            columns: ['original_count_id']
            isOneToOne: false
            referencedRelation: 'rr_cyclecount_data'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_cycle_count_recount_history_original_counter_id_fkey'
            columns: ['original_counter_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_cycle_count_recount_history_recount_counter_id_fkey'
            columns: ['recount_counter_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_cycle_count_recount_history_resolved_by_fkey'
            columns: ['resolved_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      rr_cyclecount_data: {
        Row: {
          approval_comments: string | null
          approved_at: string | null
          approved_by: string | null
          assigned_at: string | null
          assigned_to: string | null
          batch_number: string | null
          completed_at: string | null
          count_date: string | null
          count_number: string
          count_reason: string | null
          count_time: string | null
          count_type: Database['public']['Enums']['count_type_enum'] | null
          counted_quantity: number | null
          counter_name: string | null
          created_at: string
          created_by: string
          id: string
          location: string
          material_description: string | null
          material_number: string
          notes: string | null
          organization_id: string
          priority: Database['public']['Enums']['cycle_count_priority']
          recount_by: string | null
          recount_completed: boolean | null
          recount_date: string | null
          requires_recount: boolean | null
          scanner_type: string | null
          serial_numbers: string[] | null
          session_id: string | null
          status: Database['public']['Enums']['cycle_count_status'] | null
          system_quantity: number
          unit_of_measure: string | null
          updated_at: string | null
          variance_percentage: number | null
          variance_quantity: number | null
          warehouse: string | null
        }
        Insert: {
          approval_comments?: string | null
          approved_at?: string | null
          approved_by?: string | null
          assigned_at?: string | null
          assigned_to?: string | null
          batch_number?: string | null
          completed_at?: string | null
          count_date?: string | null
          count_number: string
          count_reason?: string | null
          count_time?: string | null
          count_type?: Database['public']['Enums']['count_type_enum'] | null
          counted_quantity?: number | null
          counter_name?: string | null
          created_at?: string
          created_by: string
          id?: string
          location: string
          material_description?: string | null
          material_number: string
          notes?: string | null
          organization_id: string
          priority?: Database['public']['Enums']['cycle_count_priority']
          recount_by?: string | null
          recount_completed?: boolean | null
          recount_date?: string | null
          requires_recount?: boolean | null
          scanner_type?: string | null
          serial_numbers?: string[] | null
          session_id?: string | null
          status?: Database['public']['Enums']['cycle_count_status'] | null
          system_quantity?: number
          unit_of_measure?: string | null
          updated_at?: string | null
          variance_percentage?: number | null
          variance_quantity?: number | null
          warehouse?: string | null
        }
        Update: {
          approval_comments?: string | null
          approved_at?: string | null
          approved_by?: string | null
          assigned_at?: string | null
          assigned_to?: string | null
          batch_number?: string | null
          completed_at?: string | null
          count_date?: string | null
          count_number?: string
          count_reason?: string | null
          count_time?: string | null
          count_type?: Database['public']['Enums']['count_type_enum'] | null
          counted_quantity?: number | null
          counter_name?: string | null
          created_at?: string
          created_by?: string
          id?: string
          location?: string
          material_description?: string | null
          material_number?: string
          notes?: string | null
          organization_id?: string
          priority?: Database['public']['Enums']['cycle_count_priority']
          recount_by?: string | null
          recount_completed?: boolean | null
          recount_date?: string | null
          requires_recount?: boolean | null
          scanner_type?: string | null
          serial_numbers?: string[] | null
          session_id?: string | null
          status?: Database['public']['Enums']['cycle_count_status'] | null
          system_quantity?: number
          unit_of_measure?: string | null
          updated_at?: string | null
          variance_percentage?: number | null
          variance_quantity?: number | null
          warehouse?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'rr_cyclecount_data_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_cyclecount_data_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_cyclecount_data_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_cyclecount_data_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      rr_grip_processing: {
        Row: {
          batch_number: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string | null
          grip_priority: string | null
          grip_stage: string | null
          grip_workflow_type: string | null
          id: string
          is_quality_hold: boolean | null
          material_number: string
          notes: string | null
          organization_id: string | null
          processed_by: string
          processed_quantity: number | null
          processing_completed_at: string | null
          processing_location: string
          processing_started_at: string | null
          processing_status: string
          processing_type: string | null
          quality_hold_reason: string | null
          quality_released_at: string | null
          quality_released_by: string | null
          received_quantity: number | null
          rejected_quantity: number | null
          scanner_type: string | null
          session_id: string | null
          supplier_batch_info: string | null
          unit_of_measure: string | null
          updated_at: string
          warehouse_number: string | null
        }
        Insert: {
          batch_number?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          grip_priority?: string | null
          grip_stage?: string | null
          grip_workflow_type?: string | null
          id?: string
          is_quality_hold?: boolean | null
          material_number: string
          notes?: string | null
          organization_id?: string | null
          processed_by: string
          processed_quantity?: number | null
          processing_completed_at?: string | null
          processing_location: string
          processing_started_at?: string | null
          processing_status?: string
          processing_type?: string | null
          quality_hold_reason?: string | null
          quality_released_at?: string | null
          quality_released_by?: string | null
          received_quantity?: number | null
          rejected_quantity?: number | null
          scanner_type?: string | null
          session_id?: string | null
          supplier_batch_info?: string | null
          unit_of_measure?: string | null
          updated_at?: string
          warehouse_number?: string | null
        }
        Update: {
          batch_number?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          grip_priority?: string | null
          grip_stage?: string | null
          grip_workflow_type?: string | null
          id?: string
          is_quality_hold?: boolean | null
          material_number?: string
          notes?: string | null
          organization_id?: string | null
          processed_by?: string
          processed_quantity?: number | null
          processing_completed_at?: string | null
          processing_location?: string
          processing_started_at?: string | null
          processing_status?: string
          processing_type?: string | null
          quality_hold_reason?: string | null
          quality_released_at?: string | null
          quality_released_by?: string | null
          received_quantity?: number | null
          rejected_quantity?: number | null
          scanner_type?: string | null
          session_id?: string | null
          supplier_batch_info?: string | null
          unit_of_measure?: string | null
          updated_at?: string
          warehouse_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'rr_grip_processing_confirmed_by_fkey'
            columns: ['confirmed_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_grip_processing_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      rr_grsgrip_processing: {
        Row: {
          batch_number: string | null
          created_at: string
          created_by: string
          grip_priority: string | null
          grip_stage: string | null
          grip_workflow_type: string | null
          id: string
          is_quality_hold: boolean | null
          material_number: string | null
          notes: string | null
          organization_id: string
          processed_by: string | null
          processed_quantity: number | null
          processing_completed_at: string | null
          processing_location: string | null
          processing_started_at: string | null
          processing_status: string | null
          processing_type: string | null
          quality_hold_reason: string | null
          received_quantity: number | null
          rejected_quantity: number | null
          supplier_batch_info: string | null
          unit_of_measure: string | null
          updated_at: string | null
          warehouse_number: string | null
        }
        Insert: {
          batch_number?: string | null
          created_at?: string
          created_by: string
          grip_priority?: string | null
          grip_stage?: string | null
          grip_workflow_type?: string | null
          id?: string
          is_quality_hold?: boolean | null
          material_number?: string | null
          notes?: string | null
          organization_id: string
          processed_by?: string | null
          processed_quantity?: number | null
          processing_completed_at?: string | null
          processing_location?: string | null
          processing_started_at?: string | null
          processing_status?: string | null
          processing_type?: string | null
          quality_hold_reason?: string | null
          received_quantity?: number | null
          rejected_quantity?: number | null
          supplier_batch_info?: string | null
          unit_of_measure?: string | null
          updated_at?: string | null
          warehouse_number?: string | null
        }
        Update: {
          batch_number?: string | null
          created_at?: string
          created_by?: string
          grip_priority?: string | null
          grip_stage?: string | null
          grip_workflow_type?: string | null
          id?: string
          is_quality_hold?: boolean | null
          material_number?: string | null
          notes?: string | null
          organization_id?: string
          processed_by?: string | null
          processed_quantity?: number | null
          processing_completed_at?: string | null
          processing_location?: string | null
          processing_started_at?: string | null
          processing_status?: string | null
          processing_type?: string | null
          quality_hold_reason?: string | null
          received_quantity?: number | null
          rejected_quantity?: number | null
          supplier_batch_info?: string | null
          unit_of_measure?: string | null
          updated_at?: string | null
          warehouse_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'rr_grsgrip_processing_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_grsgrip_processing_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      rr_inbound_scans: {
        Row: {
          barcode: string | null
          created_at: string | null
          hot_truck: boolean | null
          id: string
          material_number: string | null
          notes: string | null
          organization_id: string
          quantity: number | null
          scan_location: string | null
          scanned_at: string | null
          scanned_by: string
          so_line_rma_afa: string | null
          tka_batch_number: string | null
          tracking_number: string | null
          updated_at: string | null
        }
        Insert: {
          barcode?: string | null
          created_at?: string | null
          hot_truck?: boolean | null
          id?: string
          material_number?: string | null
          notes?: string | null
          organization_id: string
          quantity?: number | null
          scan_location?: string | null
          scanned_at?: string | null
          scanned_by: string
          so_line_rma_afa?: string | null
          tka_batch_number?: string | null
          tracking_number?: string | null
          updated_at?: string | null
        }
        Update: {
          barcode?: string | null
          created_at?: string | null
          hot_truck?: boolean | null
          id?: string
          material_number?: string | null
          notes?: string | null
          organization_id?: string
          quantity?: number | null
          scan_location?: string | null
          scanned_at?: string | null
          scanned_by?: string
          so_line_rma_afa?: string | null
          tka_batch_number?: string | null
          tracking_number?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'rr_inbound_scans_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rr_inbound_scans_scanned_by_fkey'
            columns: ['scanned_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      RR_Kitting_DATA: {
        Row: {
          authorized_ship_short_items: Json | null
          batch: string | null
          created_at: string | null
          creation_date: string | null
          creation_time: string | null
          deliver_to_plant: string
          dest_storage_bin: string | null
          dest_storage_type: string | null
          due_date: string | null
          engine_program: string
          id: string
          incora_items: Json | null
          kanban_task_id: string | null
          kit_added_by_user: string | null
          kit_added_create_date_time: string | null
          kit_build_number: string
          kit_build_status: string | null
          kit_flag_cleared_by_user: string | null
          kit_flag_cleared_date_time: string | null
          kit_flag_set_by_user: string | null
          kit_flag_set_date_time: string | null
          kit_flag_type: string | null
          kit_inspection_by_user: string | null
          kit_inspection_completion_date_time: string | null
          kit_number: string
          kit_po_number: string
          kit_printed_by_user: string | null
          kit_printed_date_time: string | null
          kit_priority: string | null
          kit_priority_change_count: number | null
          kit_priority_set_by_user: string | null
          kit_ready_on_dock_by_user: string | null
          kit_ready_on_dock_date_time: string | null
          kit_serial_number: string | null
          kit_to_line_kitted_by_user: string | null
          kit_to_line_kitted_date_time: string | null
          kit_to_line_picked_by_user: string | null
          kit_to_line_picked_date_time: string | null
          material: string | null
          material_description: string | null
          movement_type_im: string | null
          movement_type_wm: string | null
          part_expedite_part_number: string | null
          part_expedite_request_by_user: string | null
          part_expedite_request_create_date_time: string | null
          part_expedite_request_reason_code: string | null
          part_expedite_requested_by_date: string | null
          plant: string | null
          printer: string | null
          shortage_items: Json | null
          source_storage_bin: string | null
          source_storage_type: string | null
          source_target_qty: string | null
          special_stock_number: string | null
          storage_location: string | null
          to_line_kitted: boolean | null
          to_line_picked: boolean | null
          transfer_order_number: string | null
          updated_at: string | null
          user: string | null
          warehouse_number: string | null
        }
        Insert: {
          authorized_ship_short_items?: Json | null
          batch?: string | null
          created_at?: string | null
          creation_date?: string | null
          creation_time?: string | null
          deliver_to_plant: string
          dest_storage_bin?: string | null
          dest_storage_type?: string | null
          due_date?: string | null
          engine_program: string
          id?: string
          incora_items?: Json | null
          kanban_task_id?: string | null
          kit_added_by_user?: string | null
          kit_added_create_date_time?: string | null
          kit_build_number: string
          kit_build_status?: string | null
          kit_flag_cleared_by_user?: string | null
          kit_flag_cleared_date_time?: string | null
          kit_flag_set_by_user?: string | null
          kit_flag_set_date_time?: string | null
          kit_flag_type?: string | null
          kit_inspection_by_user?: string | null
          kit_inspection_completion_date_time?: string | null
          kit_number: string
          kit_po_number: string
          kit_printed_by_user?: string | null
          kit_printed_date_time?: string | null
          kit_priority?: string | null
          kit_priority_change_count?: number | null
          kit_priority_set_by_user?: string | null
          kit_ready_on_dock_by_user?: string | null
          kit_ready_on_dock_date_time?: string | null
          kit_serial_number?: string | null
          kit_to_line_kitted_by_user?: string | null
          kit_to_line_kitted_date_time?: string | null
          kit_to_line_picked_by_user?: string | null
          kit_to_line_picked_date_time?: string | null
          material?: string | null
          material_description?: string | null
          movement_type_im?: string | null
          movement_type_wm?: string | null
          part_expedite_part_number?: string | null
          part_expedite_request_by_user?: string | null
          part_expedite_request_create_date_time?: string | null
          part_expedite_request_reason_code?: string | null
          part_expedite_requested_by_date?: string | null
          plant?: string | null
          printer?: string | null
          shortage_items?: Json | null
          source_storage_bin?: string | null
          source_storage_type?: string | null
          source_target_qty?: string | null
          special_stock_number?: string | null
          storage_location?: string | null
          to_line_kitted?: boolean | null
          to_line_picked?: boolean | null
          transfer_order_number?: string | null
          updated_at?: string | null
          user?: string | null
          warehouse_number?: string | null
        }
        Update: {
          authorized_ship_short_items?: Json | null
          batch?: string | null
          created_at?: string | null
          creation_date?: string | null
          creation_time?: string | null
          deliver_to_plant?: string
          dest_storage_bin?: string | null
          dest_storage_type?: string | null
          due_date?: string | null
          engine_program?: string
          id?: string
          incora_items?: Json | null
          kanban_task_id?: string | null
          kit_added_by_user?: string | null
          kit_added_create_date_time?: string | null
          kit_build_number?: string
          kit_build_status?: string | null
          kit_flag_cleared_by_user?: string | null
          kit_flag_cleared_date_time?: string | null
          kit_flag_set_by_user?: string | null
          kit_flag_set_date_time?: string | null
          kit_flag_type?: string | null
          kit_inspection_by_user?: string | null
          kit_inspection_completion_date_time?: string | null
          kit_number?: string
          kit_po_number?: string
          kit_printed_by_user?: string | null
          kit_printed_date_time?: string | null
          kit_priority?: string | null
          kit_priority_change_count?: number | null
          kit_priority_set_by_user?: string | null
          kit_ready_on_dock_by_user?: string | null
          kit_ready_on_dock_date_time?: string | null
          kit_serial_number?: string | null
          kit_to_line_kitted_by_user?: string | null
          kit_to_line_kitted_date_time?: string | null
          kit_to_line_picked_by_user?: string | null
          kit_to_line_picked_date_time?: string | null
          material?: string | null
          material_description?: string | null
          movement_type_im?: string | null
          movement_type_wm?: string | null
          part_expedite_part_number?: string | null
          part_expedite_request_by_user?: string | null
          part_expedite_request_create_date_time?: string | null
          part_expedite_request_reason_code?: string | null
          part_expedite_requested_by_date?: string | null
          plant?: string | null
          printer?: string | null
          shortage_items?: Json | null
          source_storage_bin?: string | null
          source_storage_type?: string | null
          source_target_qty?: string | null
          special_stock_number?: string | null
          storage_location?: string | null
          to_line_kitted?: boolean | null
          to_line_picked?: boolean | null
          transfer_order_number?: string | null
          updated_at?: string | null
          user?: string | null
          warehouse_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'RR_Kitting_DATA_kanban_task_id_fkey'
            columns: ['kanban_task_id']
            isOneToOne: false
            referencedRelation: 'kit_kanban_tasks'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'RR_Kitting_DATA_kit_flag_cleared_by_user_fkey'
            columns: ['kit_flag_cleared_by_user']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'RR_Kitting_DATA_kit_flag_set_by_user_fkey'
            columns: ['kit_flag_set_by_user']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      rr_lx03_data: {
        Row: {
          available_stock: number | null
          batch: string | null
          created_at: string | null
          delivery: string | null
          id: string
          inventory_active: string | null
          inventory_record: string | null
          inventory_record_2: string | null
          last_inventory: string | null
          last_movement: string | null
          last_movement_2: string | null
          material: string | null
          organization_id: string | null
          pick_quantity: number | null
          plant: string | null
          putaway_block: string | null
          special_stock: string | null
          special_stock_number: string | null
          stock_category: string | null
          stock_for_putaway: number | null
          stock_removal_block: string | null
          storage_bin: string | null
          storage_location: string | null
          storage_type: string | null
          storage_type_2: string | null
          total_stock: number | null
          updated_at: string | null
          warehouse: string | null
        }
        Insert: {
          available_stock?: number | null
          batch?: string | null
          created_at?: string | null
          delivery?: string | null
          id?: string
          inventory_active?: string | null
          inventory_record?: string | null
          inventory_record_2?: string | null
          last_inventory?: string | null
          last_movement?: string | null
          last_movement_2?: string | null
          material?: string | null
          organization_id?: string | null
          pick_quantity?: number | null
          plant?: string | null
          putaway_block?: string | null
          special_stock?: string | null
          special_stock_number?: string | null
          stock_category?: string | null
          stock_for_putaway?: number | null
          stock_removal_block?: string | null
          storage_bin?: string | null
          storage_location?: string | null
          storage_type?: string | null
          storage_type_2?: string | null
          total_stock?: number | null
          updated_at?: string | null
          warehouse?: string | null
        }
        Update: {
          available_stock?: number | null
          batch?: string | null
          created_at?: string | null
          delivery?: string | null
          id?: string
          inventory_active?: string | null
          inventory_record?: string | null
          inventory_record_2?: string | null
          last_inventory?: string | null
          last_movement?: string | null
          last_movement_2?: string | null
          material?: string | null
          organization_id?: string | null
          pick_quantity?: number | null
          plant?: string | null
          putaway_block?: string | null
          special_stock?: string | null
          special_stock_number?: string | null
          stock_category?: string | null
          stock_for_putaway?: number | null
          stock_removal_block?: string | null
          storage_bin?: string | null
          storage_location?: string | null
          storage_type?: string | null
          storage_type_2?: string | null
          total_stock?: number | null
          updated_at?: string | null
          warehouse?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'rr_lx03_data_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      rr_mlgt_data: {
        Row: {
          created_at: string
          crl_status: string | null
          height: number | null
          id: string
          length: number | null
          material: string | null
          max_quantity: number | null
          min_quantity: number | null
          storage_bin: string | null
          storage_type: string | null
          updated_at: string
          warehouse_number: string | null
          weight: number | null
          width: number | null
        }
        Insert: {
          created_at?: string
          crl_status?: string | null
          height?: number | null
          id?: string
          length?: number | null
          material?: string | null
          max_quantity?: number | null
          min_quantity?: number | null
          storage_bin?: string | null
          storage_type?: string | null
          updated_at?: string
          warehouse_number?: string | null
          weight?: number | null
          width?: number | null
        }
        Update: {
          created_at?: string
          crl_status?: string | null
          height?: number | null
          id?: string
          length?: number | null
          material?: string | null
          max_quantity?: number | null
          min_quantity?: number | null
          storage_bin?: string | null
          storage_type?: string | null
          updated_at?: string
          warehouse_number?: string | null
          weight?: number | null
          width?: number | null
        }
        Relationships: []
      }
      rr_sq01_data: {
        Row: {
          batch: string | null
          blocked: number | null
          conf_cert_ref: string | null
          confirmed_yield: number | null
          created_at: string | null
          created_on: string | null
          ext_mov_avg_price: number | null
          general_info: string | null
          grs_actual_location_found: string | null
          grs_location_scan_completed_at: string | null
          grs_notes: string | null
          grs_scan_status: string | null
          grs_scanned_at: string | null
          grs_scanned_by: string | null
          grs_scanned_by_name: string | null
          id: string
          in_qual_insp: number | null
          last_gr: string | null
          material: string | null
          material_description: string | null
          plant: string | null
          serial_number: string | null
          shelf_life_exp_date: string | null
          sloc: string | null
          unrestricted: number | null
          updated_at: string | null
          val_type: string | null
        }
        Insert: {
          batch?: string | null
          blocked?: number | null
          conf_cert_ref?: string | null
          confirmed_yield?: number | null
          created_at?: string | null
          created_on?: string | null
          ext_mov_avg_price?: number | null
          general_info?: string | null
          grs_actual_location_found?: string | null
          grs_location_scan_completed_at?: string | null
          grs_notes?: string | null
          grs_scan_status?: string | null
          grs_scanned_at?: string | null
          grs_scanned_by?: string | null
          grs_scanned_by_name?: string | null
          id?: string
          in_qual_insp?: number | null
          last_gr?: string | null
          material?: string | null
          material_description?: string | null
          plant?: string | null
          serial_number?: string | null
          shelf_life_exp_date?: string | null
          sloc?: string | null
          unrestricted?: number | null
          updated_at?: string | null
          val_type?: string | null
        }
        Update: {
          batch?: string | null
          blocked?: number | null
          conf_cert_ref?: string | null
          confirmed_yield?: number | null
          created_at?: string | null
          created_on?: string | null
          ext_mov_avg_price?: number | null
          general_info?: string | null
          grs_actual_location_found?: string | null
          grs_location_scan_completed_at?: string | null
          grs_notes?: string | null
          grs_scan_status?: string | null
          grs_scanned_at?: string | null
          grs_scanned_by?: string | null
          grs_scanned_by_name?: string | null
          id?: string
          in_qual_insp?: number | null
          last_gr?: string | null
          material?: string | null
          material_description?: string | null
          plant?: string | null
          serial_number?: string | null
          shelf_life_exp_date?: string | null
          sloc?: string | null
          unrestricted?: number | null
          updated_at?: string | null
          val_type?: string | null
        }
        Relationships: []
      }
      sap_connections: {
        Row: {
          ashost: string
          client: string
          created_at: string | null
          created_by: string | null
          description: string | null
          encrypted_password: string
          id: string
          is_active: boolean | null
          is_default: boolean | null
          lang: string
          last_test_success: boolean | null
          last_tested_at: string | null
          name: string
          organization_id: string | null
          saprouter: string | null
          sysnr: string
          system_type: Database['public']['Enums']['sap_system_type']
          updated_at: string | null
          updated_by: string | null
          username: string
        }
        Insert: {
          ashost: string
          client?: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          encrypted_password: string
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          lang?: string
          last_test_success?: boolean | null
          last_tested_at?: string | null
          name: string
          organization_id?: string | null
          saprouter?: string | null
          sysnr?: string
          system_type?: Database['public']['Enums']['sap_system_type']
          updated_at?: string | null
          updated_by?: string | null
          username: string
        }
        Update: {
          ashost?: string
          client?: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          encrypted_password?: string
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          lang?: string
          last_test_success?: boolean | null
          last_tested_at?: string | null
          name?: string
          organization_id?: string | null
          saprouter?: string | null
          sysnr?: string
          system_type?: Database['public']['Enums']['sap_system_type']
          updated_at?: string | null
          updated_by?: string | null
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: 'sap_connections_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      sap_operation_logs: {
        Row: {
          client_ip: string | null
          completed_at: string | null
          connection_id: string | null
          duration_ms: number | null
          error_message: string | null
          function_name: string | null
          id: string
          operation: string
          organization_id: string | null
          parameters: Json | null
          request_id: string | null
          response_data: Json | null
          started_at: string
          success: boolean
          transfer_order: string | null
          user_id: string | null
          warehouse: string | null
        }
        Insert: {
          client_ip?: string | null
          completed_at?: string | null
          connection_id?: string | null
          duration_ms?: number | null
          error_message?: string | null
          function_name?: string | null
          id?: string
          operation: string
          organization_id?: string | null
          parameters?: Json | null
          request_id?: string | null
          response_data?: Json | null
          started_at?: string
          success: boolean
          transfer_order?: string | null
          user_id?: string | null
          warehouse?: string | null
        }
        Update: {
          client_ip?: string | null
          completed_at?: string | null
          connection_id?: string | null
          duration_ms?: number | null
          error_message?: string | null
          function_name?: string | null
          id?: string
          operation?: string
          organization_id?: string | null
          parameters?: Json | null
          request_id?: string | null
          response_data?: Json | null
          started_at?: string
          success?: boolean
          transfer_order?: string | null
          user_id?: string | null
          warehouse?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'sap_operation_logs_connection_id_fkey'
            columns: ['connection_id']
            isOneToOne: false
            referencedRelation: 'sap_connections'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sap_operation_logs_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      security_alerts: {
        Row: {
          alert_type: string
          description: string
          id: string
          ip_address: unknown
          metadata: Json | null
          organization_id: string | null
          resolved: boolean | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          timestamp: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          alert_type: string
          description: string
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          organization_id?: string | null
          resolved?: boolean | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          timestamp?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          alert_type?: string
          description?: string
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          organization_id?: string | null
          resolved?: boolean | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          timestamp?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'security_alerts_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'security_alerts_resolved_by_fkey'
            columns: ['resolved_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'security_alerts_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      session_activities: {
        Row: {
          details: string | null
          event_type: string
          id: string
          ip_address: unknown
          organization_id: string | null
          session_id: string | null
          timestamp: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          details?: string | null
          event_type: string
          id?: string
          ip_address?: unknown
          organization_id?: string | null
          session_id?: string | null
          timestamp?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          details?: string | null
          event_type?: string
          id?: string
          ip_address?: unknown
          organization_id?: string | null
          session_id?: string | null
          timestamp?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'session_activities_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'session_activities_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      session_timeout_configs: {
        Row: {
          auto_logout_timeout_minutes: number
          created_at: string | null
          id: string
          is_global: boolean
          organization_id: string | null
          role: Database['public']['Enums']['user_role']
          session_timeout_minutes: number
          updated_at: string | null
          warning_time_minutes: number
        }
        Insert: {
          auto_logout_timeout_minutes?: number
          created_at?: string | null
          id?: string
          is_global?: boolean
          organization_id?: string | null
          role: Database['public']['Enums']['user_role']
          session_timeout_minutes?: number
          updated_at?: string | null
          warning_time_minutes?: number
        }
        Update: {
          auto_logout_timeout_minutes?: number
          created_at?: string | null
          id?: string
          is_global?: boolean
          organization_id?: string | null
          role?: Database['public']['Enums']['user_role']
          session_timeout_minutes?: number
          updated_at?: string | null
          warning_time_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: 'session_timeout_configs_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      settings: {
        Row: {
          created_at: string | null
          id: string
          key: string
          organization_id: string | null
          updated_at: string | null
          user_id: string | null
          value: Json
        }
        Insert: {
          created_at?: string | null
          id?: string
          key: string
          organization_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          value: Json
        }
        Update: {
          created_at?: string | null
          id?: string
          key?: string
          organization_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: 'settings_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'settings_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      shift_assignments: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          assignment_notes: string | null
          assignment_type: string | null
          badge_number: string | null
          created_at: string | null
          custom_attributes: Json | null
          direct_supervisor_id: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          end_date: string | null
          id: string
          is_primary_position: boolean | null
          onboarding_completed_at: string | null
          onboarding_session_id: string | null
          organization_id: string
          position_id: string
          productivity_target: number | null
          quality_target: number | null
          shift_pattern: string | null
          shift_schedule: Json | null
          shift_schedule_id: string | null
          start_date: string
          status: string | null
          team_lead_id: string | null
          updated_at: string | null
          user_id: string
          working_area_id: string | null
        }
        Insert: {
          assigned_at?: string | null
          assigned_by?: string | null
          assignment_notes?: string | null
          assignment_type?: string | null
          badge_number?: string | null
          created_at?: string | null
          custom_attributes?: Json | null
          direct_supervisor_id?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          end_date?: string | null
          id?: string
          is_primary_position?: boolean | null
          onboarding_completed_at?: string | null
          onboarding_session_id?: string | null
          organization_id: string
          position_id: string
          productivity_target?: number | null
          quality_target?: number | null
          shift_pattern?: string | null
          shift_schedule?: Json | null
          shift_schedule_id?: string | null
          start_date?: string
          status?: string | null
          team_lead_id?: string | null
          updated_at?: string | null
          user_id: string
          working_area_id?: string | null
        }
        Update: {
          assigned_at?: string | null
          assigned_by?: string | null
          assignment_notes?: string | null
          assignment_type?: string | null
          badge_number?: string | null
          created_at?: string | null
          custom_attributes?: Json | null
          direct_supervisor_id?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          end_date?: string | null
          id?: string
          is_primary_position?: boolean | null
          onboarding_completed_at?: string | null
          onboarding_session_id?: string | null
          organization_id?: string
          position_id?: string
          productivity_target?: number | null
          quality_target?: number | null
          shift_pattern?: string | null
          shift_schedule?: Json | null
          shift_schedule_id?: string | null
          start_date?: string
          status?: string | null
          team_lead_id?: string | null
          updated_at?: string | null
          user_id?: string
          working_area_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'shift_assignments_assigned_by_fkey'
            columns: ['assigned_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'shift_assignments_direct_supervisor_id_fkey'
            columns: ['direct_supervisor_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'shift_assignments_onboarding_session_id_fkey'
            columns: ['onboarding_session_id']
            isOneToOne: false
            referencedRelation: 'onboarding_sessions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'shift_assignments_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'shift_assignments_position_id_fkey'
            columns: ['position_id']
            isOneToOne: false
            referencedRelation: 'shift_positions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'shift_assignments_shift_schedule_id_fkey'
            columns: ['shift_schedule_id']
            isOneToOne: false
            referencedRelation: 'shift_schedules'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'shift_assignments_team_lead_id_fkey'
            columns: ['team_lead_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'shift_assignments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'shift_assignments_working_area_id_fkey'
            columns: ['working_area_id']
            isOneToOne: false
            referencedRelation: 'working_areas'
            referencedColumns: ['id']
          },
        ]
      }
      shift_positions: {
        Row: {
          created_at: string | null
          created_by: string | null
          department: string | null
          description: string | null
          effective_date: string | null
          end_date: string | null
          headcount_budget: number | null
          id: string
          is_active: boolean | null
          is_supervisory: boolean | null
          minimum_experience_years: number | null
          organization_id: string
          pay_grade: string | null
          position_code: string
          position_level: number | null
          position_title: string
          position_type: string | null
          reports_to_position_id: string | null
          required_certifications: Json | null
          required_skills: Json | null
          requires_background_check: boolean | null
          responsibilities: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          department?: string | null
          description?: string | null
          effective_date?: string | null
          end_date?: string | null
          headcount_budget?: number | null
          id?: string
          is_active?: boolean | null
          is_supervisory?: boolean | null
          minimum_experience_years?: number | null
          organization_id: string
          pay_grade?: string | null
          position_code: string
          position_level?: number | null
          position_title: string
          position_type?: string | null
          reports_to_position_id?: string | null
          required_certifications?: Json | null
          required_skills?: Json | null
          requires_background_check?: boolean | null
          responsibilities?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          department?: string | null
          description?: string | null
          effective_date?: string | null
          end_date?: string | null
          headcount_budget?: number | null
          id?: string
          is_active?: boolean | null
          is_supervisory?: boolean | null
          minimum_experience_years?: number | null
          organization_id?: string
          pay_grade?: string | null
          position_code?: string
          position_level?: number | null
          position_title?: string
          position_type?: string | null
          reports_to_position_id?: string | null
          required_certifications?: Json | null
          required_skills?: Json | null
          requires_background_check?: boolean | null
          responsibilities?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'shift_positions_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'shift_positions_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'shift_positions_reports_to_position_id_fkey'
            columns: ['reports_to_position_id']
            isOneToOne: false
            referencedRelation: 'shift_positions'
            referencedColumns: ['id']
          },
        ]
      }
      shift_schedules: {
        Row: {
          applicable_areas: Json | null
          applicable_positions: Json | null
          break_duration_minutes: number | null
          break_start_time: string | null
          breaks: Json | null
          color: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          effective_from: string | null
          effective_to: string | null
          id: string
          is_active: boolean | null
          max_headcount: number | null
          min_headcount: number | null
          operating_days: Json | null
          organization_id: string
          schedule_code: string | null
          schedule_name: string
          schedule_type: string | null
          shift_end_time: string
          shift_start_time: string
          target_headcount: number | null
          updated_at: string | null
        }
        Insert: {
          applicable_areas?: Json | null
          applicable_positions?: Json | null
          break_duration_minutes?: number | null
          break_start_time?: string | null
          breaks?: Json | null
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          is_active?: boolean | null
          max_headcount?: number | null
          min_headcount?: number | null
          operating_days?: Json | null
          organization_id: string
          schedule_code?: string | null
          schedule_name: string
          schedule_type?: string | null
          shift_end_time: string
          shift_start_time: string
          target_headcount?: number | null
          updated_at?: string | null
        }
        Update: {
          applicable_areas?: Json | null
          applicable_positions?: Json | null
          break_duration_minutes?: number | null
          break_start_time?: string | null
          breaks?: Json | null
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          is_active?: boolean | null
          max_headcount?: number | null
          min_headcount?: number | null
          operating_days?: Json | null
          organization_id?: string
          schedule_code?: string | null
          schedule_name?: string
          schedule_type?: string | null
          shift_end_time?: string
          shift_start_time?: string
          target_headcount?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'shift_schedules_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'shift_schedules_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      smartsheet_activity_log: {
        Row: {
          action: string
          created_at: string | null
          details: Json | null
          duration_ms: number | null
          error_message: string | null
          id: string
          ip_address: unknown
          organization_id: string | null
          request_id: string | null
          sheet_id: number | null
          sheet_name: string | null
          status: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          details?: Json | null
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          ip_address?: unknown
          organization_id?: string | null
          request_id?: string | null
          sheet_id?: number | null
          sheet_name?: string | null
          status?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          details?: Json | null
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          ip_address?: unknown
          organization_id?: string | null
          request_id?: string | null
          sheet_id?: number | null
          sheet_name?: string | null
          status?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'smartsheet_activity_log_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      smartsheet_cache: {
        Row: {
          cache_key: string
          cache_value: Json
          created_at: string | null
          expires_at: string
          id: string
          organization_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          cache_key: string
          cache_value: Json
          created_at?: string | null
          expires_at: string
          id?: string
          organization_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          cache_key?: string
          cache_value?: Json
          created_at?: string | null
          expires_at?: string
          id?: string
          organization_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'smartsheet_cache_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      smartsheet_connections: {
        Row: {
          access_token_encrypted: string
          api_base_url: string | null
          connection_metadata: Json | null
          connection_name: string
          created_at: string | null
          id: string
          is_active: boolean | null
          last_test_status: string | null
          last_tested_at: string | null
          organization_id: string | null
          rate_limit_per_second: number | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          access_token_encrypted: string
          api_base_url?: string | null
          connection_metadata?: Json | null
          connection_name: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_test_status?: string | null
          last_tested_at?: string | null
          organization_id?: string | null
          rate_limit_per_second?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          access_token_encrypted?: string
          api_base_url?: string | null
          connection_metadata?: Json | null
          connection_name?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_test_status?: string | null
          last_tested_at?: string | null
          organization_id?: string | null
          rate_limit_per_second?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'smartsheet_connections_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      smartsheet_field_mappings: {
        Row: {
          created_at: string | null
          field_type: string | null
          id: string
          is_key_field: boolean | null
          source_field: string
          sync_job_id: string | null
          target_field: string
          transformation_rule: Json | null
        }
        Insert: {
          created_at?: string | null
          field_type?: string | null
          id?: string
          is_key_field?: boolean | null
          source_field: string
          sync_job_id?: string | null
          target_field: string
          transformation_rule?: Json | null
        }
        Update: {
          created_at?: string | null
          field_type?: string | null
          id?: string
          is_key_field?: boolean | null
          source_field?: string
          sync_job_id?: string | null
          target_field?: string
          transformation_rule?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: 'smartsheet_field_mappings_sync_job_id_fkey'
            columns: ['sync_job_id']
            isOneToOne: false
            referencedRelation: 'smartsheet_sync_jobs'
            referencedColumns: ['id']
          },
        ]
      }
      smartsheet_sync_jobs: {
        Row: {
          completed_at: string | null
          created_at: string | null
          error_details: Json | null
          id: string
          job_name: string
          job_type: string
          organization_id: string | null
          progress_percentage: number | null
          records_processed: number | null
          records_total: number | null
          source_sheet_id: number | null
          started_at: string | null
          status: string | null
          sync_config: Json | null
          target_sheet_id: number | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          error_details?: Json | null
          id?: string
          job_name: string
          job_type: string
          organization_id?: string | null
          progress_percentage?: number | null
          records_processed?: number | null
          records_total?: number | null
          source_sheet_id?: number | null
          started_at?: string | null
          status?: string | null
          sync_config?: Json | null
          target_sheet_id?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          error_details?: Json | null
          id?: string
          job_name?: string
          job_type?: string
          organization_id?: string | null
          progress_percentage?: number | null
          records_processed?: number | null
          records_total?: number | null
          source_sheet_id?: number | null
          started_at?: string | null
          status?: string | null
          sync_config?: Json | null
          target_sheet_id?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'smartsheet_sync_jobs_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      smartsheet_webhooks: {
        Row: {
          callback_url: string
          created_at: string | null
          created_by: string | null
          events: string[]
          id: string
          organization_id: string | null
          secret: string
          sheet_id: number
          status: string | null
          updated_at: string | null
          user_id: string | null
          webhook_id: number
        }
        Insert: {
          callback_url: string
          created_at?: string | null
          created_by?: string | null
          events: string[]
          id?: string
          organization_id?: string | null
          secret: string
          sheet_id: number
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
          webhook_id: number
        }
        Update: {
          callback_url?: string
          created_at?: string | null
          created_by?: string | null
          events?: string[]
          id?: string
          organization_id?: string | null
          secret?: string
          sheet_id?: number
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
          webhook_id?: number
        }
        Relationships: [
          {
            foreignKeyName: 'smartsheet_webhooks_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'smartsheet_webhooks_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      standard_work_audit_log: {
        Row: {
          action: string
          changes: Json | null
          entity_id: string
          entity_type: string
          id: string
          ip_address: string | null
          notes: string | null
          organization_id: string
          performed_at: string | null
          performed_by: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          changes?: Json | null
          entity_id: string
          entity_type: string
          id?: string
          ip_address?: string | null
          notes?: string | null
          organization_id: string
          performed_at?: string | null
          performed_by?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          changes?: Json | null
          entity_id?: string
          entity_type?: string
          id?: string
          ip_address?: string | null
          notes?: string | null
          organization_id?: string
          performed_at?: string | null
          performed_by?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'standard_work_audit_log_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'standard_work_audit_log_performed_by_fkey'
            columns: ['performed_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      standard_work_items: {
        Row: {
          conditional_display: Json | null
          created_at: string | null
          created_by: string | null
          default_value: string | null
          display_order: number | null
          help_text: string | null
          id: string
          is_active: boolean | null
          is_required: boolean | null
          item_description: string | null
          item_title: string
          item_type: string | null
          options: Json | null
          organization_id: string
          placeholder: string | null
          section_name: string | null
          template_id: string
          updated_at: string | null
          updated_by: string | null
          validation_rules: Json | null
        }
        Insert: {
          conditional_display?: Json | null
          created_at?: string | null
          created_by?: string | null
          default_value?: string | null
          display_order?: number | null
          help_text?: string | null
          id?: string
          is_active?: boolean | null
          is_required?: boolean | null
          item_description?: string | null
          item_title: string
          item_type?: string | null
          options?: Json | null
          organization_id: string
          placeholder?: string | null
          section_name?: string | null
          template_id: string
          updated_at?: string | null
          updated_by?: string | null
          validation_rules?: Json | null
        }
        Update: {
          conditional_display?: Json | null
          created_at?: string | null
          created_by?: string | null
          default_value?: string | null
          display_order?: number | null
          help_text?: string | null
          id?: string
          is_active?: boolean | null
          is_required?: boolean | null
          item_description?: string | null
          item_title?: string
          item_type?: string | null
          options?: Json | null
          organization_id?: string
          placeholder?: string | null
          section_name?: string | null
          template_id?: string
          updated_at?: string | null
          updated_by?: string | null
          validation_rules?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: 'standard_work_items_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'standard_work_items_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'standard_work_items_template_id_fkey'
            columns: ['template_id']
            isOneToOne: false
            referencedRelation: 'standard_work_templates'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'standard_work_items_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      standard_work_responses: {
        Row: {
          created_at: string | null
          date_value: string | null
          file_metadata: Json | null
          file_url: string | null
          id: string
          is_checked: boolean | null
          is_valid: boolean | null
          item_id: string
          item_notes: string | null
          numeric_value: number | null
          organization_id: string
          responded_at: string | null
          response_duration_seconds: number | null
          response_type: string | null
          response_value: string | null
          submission_id: string
          time_value: string | null
          updated_at: string | null
          validation_errors: Json | null
        }
        Insert: {
          created_at?: string | null
          date_value?: string | null
          file_metadata?: Json | null
          file_url?: string | null
          id?: string
          is_checked?: boolean | null
          is_valid?: boolean | null
          item_id: string
          item_notes?: string | null
          numeric_value?: number | null
          organization_id: string
          responded_at?: string | null
          response_duration_seconds?: number | null
          response_type?: string | null
          response_value?: string | null
          submission_id: string
          time_value?: string | null
          updated_at?: string | null
          validation_errors?: Json | null
        }
        Update: {
          created_at?: string | null
          date_value?: string | null
          file_metadata?: Json | null
          file_url?: string | null
          id?: string
          is_checked?: boolean | null
          is_valid?: boolean | null
          item_id?: string
          item_notes?: string | null
          numeric_value?: number | null
          organization_id?: string
          responded_at?: string | null
          response_duration_seconds?: number | null
          response_type?: string | null
          response_value?: string | null
          submission_id?: string
          time_value?: string | null
          updated_at?: string | null
          validation_errors?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: 'standard_work_responses_item_id_fkey'
            columns: ['item_id']
            isOneToOne: false
            referencedRelation: 'standard_work_items'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'standard_work_responses_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'standard_work_responses_submission_id_fkey'
            columns: ['submission_id']
            isOneToOne: false
            referencedRelation: 'standard_work_submissions'
            referencedColumns: ['id']
          },
        ]
      }
      standard_work_submissions: {
        Row: {
          attachments: Json | null
          completed_items: number | null
          completion_percentage: number | null
          created_at: string | null
          id: string
          metadata: Json | null
          organization_id: string
          required_completed: number | null
          required_items: number | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_notes: string | null
          shift_date: string | null
          shift_type: string | null
          started_at: string | null
          status: string | null
          submission_notes: string | null
          submission_number: string | null
          submitted_at: string | null
          submitted_by: string
          submitter_name: string | null
          submitter_position: string | null
          template_id: string
          total_items: number | null
          updated_at: string | null
          working_area_id: string | null
        }
        Insert: {
          attachments?: Json | null
          completed_items?: number | null
          completion_percentage?: number | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          organization_id: string
          required_completed?: number | null
          required_items?: number | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          shift_date?: string | null
          shift_type?: string | null
          started_at?: string | null
          status?: string | null
          submission_notes?: string | null
          submission_number?: string | null
          submitted_at?: string | null
          submitted_by: string
          submitter_name?: string | null
          submitter_position?: string | null
          template_id: string
          total_items?: number | null
          updated_at?: string | null
          working_area_id?: string | null
        }
        Update: {
          attachments?: Json | null
          completed_items?: number | null
          completion_percentage?: number | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          organization_id?: string
          required_completed?: number | null
          required_items?: number | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          shift_date?: string | null
          shift_type?: string | null
          started_at?: string | null
          status?: string | null
          submission_notes?: string | null
          submission_number?: string | null
          submitted_at?: string | null
          submitted_by?: string
          submitter_name?: string | null
          submitter_position?: string | null
          template_id?: string
          total_items?: number | null
          updated_at?: string | null
          working_area_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'standard_work_submissions_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'standard_work_submissions_reviewed_by_fkey'
            columns: ['reviewed_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'standard_work_submissions_submitted_by_fkey'
            columns: ['submitted_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'standard_work_submissions_template_id_fkey'
            columns: ['template_id']
            isOneToOne: false
            referencedRelation: 'standard_work_templates'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'standard_work_submissions_working_area_id_fkey'
            columns: ['working_area_id']
            isOneToOne: false
            referencedRelation: 'working_areas'
            referencedColumns: ['id']
          },
        ]
      }
      standard_work_templates: {
        Row: {
          color: string | null
          completion_notes: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          display_order: number | null
          estimated_duration_minutes: number | null
          frequency: string | null
          icon: string | null
          id: string
          instructions: string | null
          is_active: boolean | null
          organization_id: string
          status: string | null
          template_code: string | null
          template_name: string
          updated_at: string | null
          updated_by: string | null
          version: number | null
          working_area_id: string | null
        }
        Insert: {
          color?: string | null
          completion_notes?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          display_order?: number | null
          estimated_duration_minutes?: number | null
          frequency?: string | null
          icon?: string | null
          id?: string
          instructions?: string | null
          is_active?: boolean | null
          organization_id: string
          status?: string | null
          template_code?: string | null
          template_name: string
          updated_at?: string | null
          updated_by?: string | null
          version?: number | null
          working_area_id?: string | null
        }
        Update: {
          color?: string | null
          completion_notes?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          display_order?: number | null
          estimated_duration_minutes?: number | null
          frequency?: string | null
          icon?: string | null
          id?: string
          instructions?: string | null
          is_active?: boolean | null
          organization_id?: string
          status?: string | null
          template_code?: string | null
          template_name?: string
          updated_at?: string | null
          updated_by?: string | null
          version?: number | null
          working_area_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'standard_work_templates_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'standard_work_templates_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'standard_work_templates_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'standard_work_templates_working_area_id_fkey'
            columns: ['working_area_id']
            isOneToOne: false
            referencedRelation: 'working_areas'
            referencedColumns: ['id']
          },
        ]
      }
      support_tickets: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          assigned_to: string | null
          category: string
          closed_at: string | null
          closed_by: string | null
          created_at: string | null
          csat_feedback: string | null
          csat_score: number | null
          csat_submitted_at: string | null
          customer_account_id: string | null
          customer_email: string
          customer_name: string | null
          department: string | null
          description: string
          first_response_at: string | null
          first_response_due_at: string | null
          id: string
          last_activity_at: string | null
          metadata: Json | null
          nps_score: number | null
          organization_id: string | null
          priority: Database['public']['Enums']['ticket_priority']
          related_batch_id: string | null
          related_delivery_id: string | null
          related_material_id: string | null
          related_order_id: string | null
          resolution_due_at: string | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          search_vector: unknown
          sla_pause_reason: string | null
          sla_paused_at: string | null
          sla_status: Database['public']['Enums']['sla_status'] | null
          source: string | null
          status: Database['public']['Enums']['ticket_status']
          subject: string
          tags: string[] | null
          team: string | null
          ticket_number: string
          updated_at: string | null
          warehouse_context: Json | null
        }
        Insert: {
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_to?: string | null
          category?: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string | null
          csat_feedback?: string | null
          csat_score?: number | null
          csat_submitted_at?: string | null
          customer_account_id?: string | null
          customer_email: string
          customer_name?: string | null
          department?: string | null
          description: string
          first_response_at?: string | null
          first_response_due_at?: string | null
          id?: string
          last_activity_at?: string | null
          metadata?: Json | null
          nps_score?: number | null
          organization_id?: string | null
          priority?: Database['public']['Enums']['ticket_priority']
          related_batch_id?: string | null
          related_delivery_id?: string | null
          related_material_id?: string | null
          related_order_id?: string | null
          resolution_due_at?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          search_vector?: unknown
          sla_pause_reason?: string | null
          sla_paused_at?: string | null
          sla_status?: Database['public']['Enums']['sla_status'] | null
          source?: string | null
          status?: Database['public']['Enums']['ticket_status']
          subject: string
          tags?: string[] | null
          team?: string | null
          ticket_number: string
          updated_at?: string | null
          warehouse_context?: Json | null
        }
        Update: {
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_to?: string | null
          category?: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string | null
          csat_feedback?: string | null
          csat_score?: number | null
          csat_submitted_at?: string | null
          customer_account_id?: string | null
          customer_email?: string
          customer_name?: string | null
          department?: string | null
          description?: string
          first_response_at?: string | null
          first_response_due_at?: string | null
          id?: string
          last_activity_at?: string | null
          metadata?: Json | null
          nps_score?: number | null
          organization_id?: string | null
          priority?: Database['public']['Enums']['ticket_priority']
          related_batch_id?: string | null
          related_delivery_id?: string | null
          related_material_id?: string | null
          related_order_id?: string | null
          resolution_due_at?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          search_vector?: unknown
          sla_pause_reason?: string | null
          sla_paused_at?: string | null
          sla_status?: Database['public']['Enums']['sla_status'] | null
          source?: string | null
          status?: Database['public']['Enums']['ticket_status']
          subject?: string
          tags?: string[] | null
          team?: string | null
          ticket_number?: string
          updated_at?: string | null
          warehouse_context?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: 'support_tickets_assigned_by_fkey'
            columns: ['assigned_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'support_tickets_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'support_tickets_closed_by_fkey'
            columns: ['closed_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'support_tickets_customer_account_id_fkey'
            columns: ['customer_account_id']
            isOneToOne: false
            referencedRelation: 'customer_accounts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'support_tickets_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'support_tickets_resolved_by_fkey'
            columns: ['resolved_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      tab_definitions: {
        Row: {
          created_at: string | null
          description: string | null
          display_order: number | null
          id: string
          is_active: boolean | null
          page_resource: string
          tab_id: string
          tab_label: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          page_resource: string
          tab_id: string
          tab_label: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          page_resource?: string
          tab_id?: string
          tab_label?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      task_assignment_history: {
        Row: {
          assigned_at: string | null
          assigned_to: string | null
          created_at: string | null
          duration_minutes: number | null
          id: string
          outcome: string | null
          release_reason: string | null
          released_at: string | null
          task_id: string
        }
        Insert: {
          assigned_at?: string | null
          assigned_to?: string | null
          created_at?: string | null
          duration_minutes?: number | null
          id?: string
          outcome?: string | null
          release_reason?: string | null
          released_at?: string | null
          task_id: string
        }
        Update: {
          assigned_at?: string | null
          assigned_to?: string | null
          created_at?: string | null
          duration_minutes?: number | null
          id?: string
          outcome?: string | null
          release_reason?: string | null
          released_at?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'task_assignment_history_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'task_assignment_history_task_id_fkey'
            columns: ['task_id']
            isOneToOne: false
            referencedRelation: 'work_queue'
            referencedColumns: ['id']
          },
        ]
      }
      task_types: {
        Row: {
          active: boolean | null
          allow_delegation: boolean | null
          allow_partial_completion: boolean | null
          color: string | null
          completion_validations: Json | null
          created_at: string | null
          custom_fields_schema: Json | null
          description: string | null
          display_name: string
          estimated_duration_max: number | null
          estimated_duration_min: number | null
          icon: string | null
          id: string
          organization_id: string
          preferred_skills: Json | null
          required_skills: Json | null
          requires_location: boolean | null
          requires_material: boolean | null
          requires_scanner: boolean | null
          type_code: string
          updated_at: string | null
          workflow_steps: Json | null
        }
        Insert: {
          active?: boolean | null
          allow_delegation?: boolean | null
          allow_partial_completion?: boolean | null
          color?: string | null
          completion_validations?: Json | null
          created_at?: string | null
          custom_fields_schema?: Json | null
          description?: string | null
          display_name: string
          estimated_duration_max?: number | null
          estimated_duration_min?: number | null
          icon?: string | null
          id?: string
          organization_id: string
          preferred_skills?: Json | null
          required_skills?: Json | null
          requires_location?: boolean | null
          requires_material?: boolean | null
          requires_scanner?: boolean | null
          type_code: string
          updated_at?: string | null
          workflow_steps?: Json | null
        }
        Update: {
          active?: boolean | null
          allow_delegation?: boolean | null
          allow_partial_completion?: boolean | null
          color?: string | null
          completion_validations?: Json | null
          created_at?: string | null
          custom_fields_schema?: Json | null
          description?: string | null
          display_name?: string
          estimated_duration_max?: number | null
          estimated_duration_min?: number | null
          icon?: string | null
          id?: string
          organization_id?: string
          preferred_skills?: Json | null
          required_skills?: Json | null
          requires_location?: boolean | null
          requires_material?: boolean | null
          requires_scanner?: boolean | null
          type_code?: string
          updated_at?: string | null
          workflow_steps?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: 'task_types_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      tasks: {
        Row: {
          assigned_to: string | null
          attachments: Json | null
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          due_date: string | null
          id: string
          metadata: Json | null
          organization_id: string | null
          parent_task_id: string | null
          position: number | null
          priority: Database['public']['Enums']['task_priority'] | null
          status: Database['public']['Enums']['task_status'] | null
          tags: string[] | null
          title: string
          updated_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          attachments?: Json | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          metadata?: Json | null
          organization_id?: string | null
          parent_task_id?: string | null
          position?: number | null
          priority?: Database['public']['Enums']['task_priority'] | null
          status?: Database['public']['Enums']['task_status'] | null
          tags?: string[] | null
          title: string
          updated_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          attachments?: Json | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          metadata?: Json | null
          organization_id?: string | null
          parent_task_id?: string | null
          position?: number | null
          priority?: Database['public']['Enums']['task_priority'] | null
          status?: Database['public']['Enums']['task_status'] | null
          tags?: string[] | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'tasks_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tasks_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tasks_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tasks_parent_task_id_fkey'
            columns: ['parent_task_id']
            isOneToOne: false
            referencedRelation: 'tasks'
            referencedColumns: ['id']
          },
        ]
      }
      temporary_role_assignments: {
        Row: {
          created_at: string | null
          expires_at: string
          granted_by: string | null
          id: string
          is_active: boolean | null
          reason: string | null
          role_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          expires_at: string
          granted_by?: string | null
          id?: string
          is_active?: boolean | null
          reason?: string | null
          role_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          granted_by?: string | null
          id?: string
          is_active?: boolean | null
          reason?: string | null
          role_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'temporary_role_assignments_granted_by_fkey'
            columns: ['granted_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'temporary_role_assignments_role_id_fkey'
            columns: ['role_id']
            isOneToOne: false
            referencedRelation: 'roles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'temporary_role_assignments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      ticket_assignments: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          assigned_to: string
          assignment_method: string | null
          id: string
          is_current: boolean | null
          metadata: Json | null
          organization_id: string | null
          ticket_id: string
          unassigned_at: string | null
          unassigned_by: string | null
          unassignment_reason: string | null
        }
        Insert: {
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_to: string
          assignment_method?: string | null
          id?: string
          is_current?: boolean | null
          metadata?: Json | null
          organization_id?: string | null
          ticket_id: string
          unassigned_at?: string | null
          unassigned_by?: string | null
          unassignment_reason?: string | null
        }
        Update: {
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_to?: string
          assignment_method?: string | null
          id?: string
          is_current?: boolean | null
          metadata?: Json | null
          organization_id?: string | null
          ticket_id?: string
          unassigned_at?: string | null
          unassigned_by?: string | null
          unassignment_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'ticket_assignments_assigned_by_fkey'
            columns: ['assigned_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ticket_assignments_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ticket_assignments_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ticket_assignments_ticket_id_fkey'
            columns: ['ticket_id']
            isOneToOne: false
            referencedRelation: 'support_tickets'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ticket_assignments_unassigned_by_fkey'
            columns: ['unassigned_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      ticket_attachments: {
        Row: {
          comment_id: string | null
          created_at: string | null
          file_name: string
          file_size: number
          file_type: string
          id: string
          organization_id: string
          storage_path: string
          ticket_id: string
          uploaded_by: string
        }
        Insert: {
          comment_id?: string | null
          created_at?: string | null
          file_name: string
          file_size: number
          file_type: string
          id?: string
          organization_id: string
          storage_path: string
          ticket_id: string
          uploaded_by: string
        }
        Update: {
          comment_id?: string | null
          created_at?: string | null
          file_name?: string
          file_size?: number
          file_type?: string
          id?: string
          organization_id?: string
          storage_path?: string
          ticket_id?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: 'ticket_attachments_comment_id_fkey'
            columns: ['comment_id']
            isOneToOne: false
            referencedRelation: 'ticket_comments'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ticket_attachments_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ticket_attachments_ticket_id_fkey'
            columns: ['ticket_id']
            isOneToOne: false
            referencedRelation: 'tickets'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ticket_attachments_uploaded_by_fkey'
            columns: ['uploaded_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      ticket_comments: {
        Row: {
          comment_text: string
          created_at: string | null
          created_by: string
          id: string
          is_internal: boolean | null
          is_system_generated: boolean | null
          organization_id: string
          ticket_id: string
          updated_at: string | null
        }
        Insert: {
          comment_text: string
          created_at?: string | null
          created_by: string
          id?: string
          is_internal?: boolean | null
          is_system_generated?: boolean | null
          organization_id: string
          ticket_id: string
          updated_at?: string | null
        }
        Update: {
          comment_text?: string
          created_at?: string | null
          created_by?: string
          id?: string
          is_internal?: boolean | null
          is_system_generated?: boolean | null
          organization_id?: string
          ticket_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'ticket_comments_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ticket_comments_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ticket_comments_ticket_id_fkey'
            columns: ['ticket_id']
            isOneToOne: false
            referencedRelation: 'tickets'
            referencedColumns: ['id']
          },
        ]
      }
      ticket_history: {
        Row: {
          change_type: Database['public']['Enums']['ticket_change_type']
          changed_by: string
          created_at: string | null
          field_name: string | null
          id: string
          new_value: string | null
          old_value: string | null
          organization_id: string
          ticket_id: string
        }
        Insert: {
          change_type: Database['public']['Enums']['ticket_change_type']
          changed_by: string
          created_at?: string | null
          field_name?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          organization_id: string
          ticket_id: string
        }
        Update: {
          change_type?: Database['public']['Enums']['ticket_change_type']
          changed_by?: string
          created_at?: string | null
          field_name?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          organization_id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'ticket_history_changed_by_fkey'
            columns: ['changed_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ticket_history_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ticket_history_ticket_id_fkey'
            columns: ['ticket_id']
            isOneToOne: false
            referencedRelation: 'tickets'
            referencedColumns: ['id']
          },
        ]
      }
      ticket_messages: {
        Row: {
          attachment_count: number | null
          channel: Database['public']['Enums']['message_channel']
          created_at: string | null
          email_cc: string[] | null
          email_from: string | null
          email_in_reply_to: string | null
          email_message_id: string | null
          email_subject: string | null
          email_to: string | null
          has_attachments: boolean | null
          id: string
          is_internal: boolean | null
          message_content: string
          metadata: Json | null
          sender_email: string | null
          sender_id: string | null
          sender_name: string | null
          sender_type: string | null
          ticket_id: string
          updated_at: string | null
        }
        Insert: {
          attachment_count?: number | null
          channel?: Database['public']['Enums']['message_channel']
          created_at?: string | null
          email_cc?: string[] | null
          email_from?: string | null
          email_in_reply_to?: string | null
          email_message_id?: string | null
          email_subject?: string | null
          email_to?: string | null
          has_attachments?: boolean | null
          id?: string
          is_internal?: boolean | null
          message_content: string
          metadata?: Json | null
          sender_email?: string | null
          sender_id?: string | null
          sender_name?: string | null
          sender_type?: string | null
          ticket_id: string
          updated_at?: string | null
        }
        Update: {
          attachment_count?: number | null
          channel?: Database['public']['Enums']['message_channel']
          created_at?: string | null
          email_cc?: string[] | null
          email_from?: string | null
          email_in_reply_to?: string | null
          email_message_id?: string | null
          email_subject?: string | null
          email_to?: string | null
          has_attachments?: boolean | null
          id?: string
          is_internal?: boolean | null
          message_content?: string
          metadata?: Json | null
          sender_email?: string | null
          sender_id?: string | null
          sender_name?: string | null
          sender_type?: string | null
          ticket_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'ticket_messages_sender_id_fkey'
            columns: ['sender_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ticket_messages_ticket_id_fkey'
            columns: ['ticket_id']
            isOneToOne: false
            referencedRelation: 'support_tickets'
            referencedColumns: ['id']
          },
        ]
      }
      ticket_user_actions: {
        Row: {
          id: string
          user_id: string
          organization_id: string
          ticket_row_id: number
          action_type: string
          details: Json | null
          response_time_ms: number | null
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          organization_id: string
          ticket_row_id: number
          action_type: string
          details?: Json | null
          response_time_ms?: number | null
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          organization_id?: string
          ticket_row_id?: number
          action_type?: string
          details?: Json | null
          response_time_ms?: number | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'ticket_user_actions_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      ticket_sla_configs: {
        Row: {
          business_days: number[] | null
          business_hours_end: string | null
          business_hours_only: boolean | null
          business_hours_start: string | null
          category: string | null
          config_name: string
          created_at: string | null
          description: string | null
          escalation_enabled: boolean | null
          escalation_time: number | null
          escalation_to_role: Database['public']['Enums']['user_role'] | null
          first_response_time: number
          id: string
          is_active: boolean | null
          organization_id: string | null
          priority: Database['public']['Enums']['ticket_priority']
          resolution_time: number
          updated_at: string | null
        }
        Insert: {
          business_days?: number[] | null
          business_hours_end?: string | null
          business_hours_only?: boolean | null
          business_hours_start?: string | null
          category?: string | null
          config_name: string
          created_at?: string | null
          description?: string | null
          escalation_enabled?: boolean | null
          escalation_time?: number | null
          escalation_to_role?: Database['public']['Enums']['user_role'] | null
          first_response_time: number
          id?: string
          is_active?: boolean | null
          organization_id?: string | null
          priority: Database['public']['Enums']['ticket_priority']
          resolution_time: number
          updated_at?: string | null
        }
        Update: {
          business_days?: number[] | null
          business_hours_end?: string | null
          business_hours_only?: boolean | null
          business_hours_start?: string | null
          category?: string | null
          config_name?: string
          created_at?: string | null
          description?: string | null
          escalation_enabled?: boolean | null
          escalation_time?: number | null
          escalation_to_role?: Database['public']['Enums']['user_role'] | null
          first_response_time?: number
          id?: string
          is_active?: boolean | null
          organization_id?: string | null
          priority?: Database['public']['Enums']['ticket_priority']
          resolution_time?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'ticket_sla_configs_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      ticket_sla_rules: {
        Row: {
          category: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          organization_id: string
          priority: string
          resolution_time_hours: number
          response_time_hours: number
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          organization_id: string
          priority: string
          resolution_time_hours?: number
          response_time_hours?: number
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          organization_id?: string
          priority?: string
          resolution_time_hours?: number
          response_time_hours?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'ticket_sla_rules_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      tickets: {
        Row: {
          assigned_to: string | null
          category: Database['public']['Enums']['ticket_category']
          closed_at: string | null
          closed_by: string | null
          created_at: string | null
          created_by: string
          customer_email: string | null
          customer_name: string | null
          description: string
          id: string
          last_response_at: string | null
          last_response_by: string | null
          metadata: Json | null
          organization_id: string
          priority: Database['public']['Enums']['ticket_priority']
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          sla_breached: boolean | null
          sla_due_date: string | null
          source: Database['public']['Enums']['ticket_source']
          status: Database['public']['Enums']['ticket_status']
          subject: string
          tags: string[] | null
          ticket_number: string
          updated_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          category?: Database['public']['Enums']['ticket_category']
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string | null
          created_by: string
          customer_email?: string | null
          customer_name?: string | null
          description: string
          id?: string
          last_response_at?: string | null
          last_response_by?: string | null
          metadata?: Json | null
          organization_id: string
          priority?: Database['public']['Enums']['ticket_priority']
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          sla_breached?: boolean | null
          sla_due_date?: string | null
          source?: Database['public']['Enums']['ticket_source']
          status?: Database['public']['Enums']['ticket_status']
          subject: string
          tags?: string[] | null
          ticket_number: string
          updated_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          category?: Database['public']['Enums']['ticket_category']
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string | null
          created_by?: string
          customer_email?: string | null
          customer_name?: string | null
          description?: string
          id?: string
          last_response_at?: string | null
          last_response_by?: string | null
          metadata?: Json | null
          organization_id?: string
          priority?: Database['public']['Enums']['ticket_priority']
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          sla_breached?: boolean | null
          sla_due_date?: string | null
          source?: Database['public']['Enums']['ticket_source']
          status?: Database['public']['Enums']['ticket_status']
          subject?: string
          tags?: string[] | null
          ticket_number?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'tickets_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tickets_closed_by_fkey'
            columns: ['closed_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tickets_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tickets_last_response_by_fkey'
            columns: ['last_response_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tickets_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tickets_resolved_by_fkey'
            columns: ['resolved_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      timeline_event_acknowledgments: {
        Row: {
          acknowledged_at: string | null
          event_id: string
          id: string
          notes: string | null
          user_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          event_id: string
          id?: string
          notes?: string | null
          user_id: string
        }
        Update: {
          acknowledged_at?: string | null
          event_id?: string
          id?: string
          notes?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'timeline_event_acknowledgments_event_id_fkey'
            columns: ['event_id']
            isOneToOne: false
            referencedRelation: 'timeline_events'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'timeline_event_acknowledgments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      timeline_event_categories: {
        Row: {
          category_code: string
          category_name: string
          color: string | null
          created_at: string | null
          created_by: string | null
          default_duration_minutes: number | null
          description: string | null
          display_order: number | null
          icon: string | null
          id: string
          is_active: boolean | null
          is_paid_time: boolean | null
          is_productive_time: boolean | null
          is_recurring_allowed: boolean | null
          is_system: boolean | null
          organization_id: string
          updated_at: string | null
        }
        Insert: {
          category_code: string
          category_name: string
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          default_duration_minutes?: number | null
          description?: string | null
          display_order?: number | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          is_paid_time?: boolean | null
          is_productive_time?: boolean | null
          is_recurring_allowed?: boolean | null
          is_system?: boolean | null
          organization_id: string
          updated_at?: string | null
        }
        Update: {
          category_code?: string
          category_name?: string
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          default_duration_minutes?: number | null
          description?: string | null
          display_order?: number | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          is_paid_time?: boolean | null
          is_productive_time?: boolean | null
          is_recurring_allowed?: boolean | null
          is_system?: boolean | null
          organization_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'timeline_event_categories_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'timeline_event_categories_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      timeline_events: {
        Row: {
          assigned_user_ids: string[] | null
          category_id: string
          created_at: string | null
          created_by: string | null
          custom_attributes: Json | null
          description: string | null
          duration_minutes: number | null
          end_time: string
          event_date: string
          event_name: string
          id: string
          is_mandatory: boolean | null
          is_recurring: boolean | null
          location: string | null
          notes: string | null
          organization_id: string
          parent_event_id: string | null
          recurrence_days: number[] | null
          recurrence_end_date: string | null
          recurrence_pattern: string | null
          requires_acknowledgment: boolean | null
          scope_type: string | null
          shift_schedule_id: string | null
          start_time: string
          status: string | null
          updated_at: string | null
          working_area_id: string | null
        }
        Insert: {
          assigned_user_ids?: string[] | null
          category_id: string
          created_at?: string | null
          created_by?: string | null
          custom_attributes?: Json | null
          description?: string | null
          duration_minutes?: number | null
          end_time: string
          event_date: string
          event_name: string
          id?: string
          is_mandatory?: boolean | null
          is_recurring?: boolean | null
          location?: string | null
          notes?: string | null
          organization_id: string
          parent_event_id?: string | null
          recurrence_days?: number[] | null
          recurrence_end_date?: string | null
          recurrence_pattern?: string | null
          requires_acknowledgment?: boolean | null
          scope_type?: string | null
          shift_schedule_id?: string | null
          start_time: string
          status?: string | null
          updated_at?: string | null
          working_area_id?: string | null
        }
        Update: {
          assigned_user_ids?: string[] | null
          category_id?: string
          created_at?: string | null
          created_by?: string | null
          custom_attributes?: Json | null
          description?: string | null
          duration_minutes?: number | null
          end_time?: string
          event_date?: string
          event_name?: string
          id?: string
          is_mandatory?: boolean | null
          is_recurring?: boolean | null
          location?: string | null
          notes?: string | null
          organization_id?: string
          parent_event_id?: string | null
          recurrence_days?: number[] | null
          recurrence_end_date?: string | null
          recurrence_pattern?: string | null
          requires_acknowledgment?: boolean | null
          scope_type?: string | null
          shift_schedule_id?: string | null
          start_time?: string
          status?: string | null
          updated_at?: string | null
          working_area_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'timeline_events_category_id_fkey'
            columns: ['category_id']
            isOneToOne: false
            referencedRelation: 'timeline_event_categories'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'timeline_events_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'timeline_events_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'timeline_events_parent_event_id_fkey'
            columns: ['parent_event_id']
            isOneToOne: false
            referencedRelation: 'timeline_events'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'timeline_events_shift_schedule_id_fkey'
            columns: ['shift_schedule_id']
            isOneToOne: false
            referencedRelation: 'shift_schedules'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'timeline_events_working_area_id_fkey'
            columns: ['working_area_id']
            isOneToOne: false
            referencedRelation: 'working_areas'
            referencedColumns: ['id']
          },
        ]
      }
      user_permissions: {
        Row: {
          created_at: string | null
          expires_at: string | null
          granted: boolean | null
          permission_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          granted?: boolean | null
          permission_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          granted?: boolean | null
          permission_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_permissions_permission_id_fkey'
            columns: ['permission_id']
            isOneToOne: false
            referencedRelation: 'permissions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_permissions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      user_profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          customer_account_id: string | null
          customer_type: Database['public']['Enums']['customer_type'] | null
          deleted_at: string | null
          email: string
          email_verified: boolean | null
          first_name: string | null
          full_name: string | null
          id: string
          last_name: string | null
          last_seen: string | null
          leave_return_date: string | null
          leave_start_date: string | null
          metadata: Json | null
          organization_id: string | null
          outbound_column_order: Json | null
          phone_number: string | null
          portal_access_status:
            | Database['public']['Enums']['portal_access_status']
            | null
          preferences: Json | null
          role: Database['public']['Enums']['user_role'] | null
          role_id: string
          status: Database['public']['Enums']['user_status'] | null
          status_change_reason: string | null
          status_changed_at: string | null
          status_changed_by: string | null
          termination_date: string | null
          termination_reason: string | null
          two_factor_enabled: boolean | null
          updated_at: string | null
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          customer_account_id?: string | null
          customer_type?: Database['public']['Enums']['customer_type'] | null
          deleted_at?: string | null
          email: string
          email_verified?: boolean | null
          first_name?: string | null
          full_name?: string | null
          id: string
          last_name?: string | null
          last_seen?: string | null
          leave_return_date?: string | null
          leave_start_date?: string | null
          metadata?: Json | null
          organization_id?: string | null
          outbound_column_order?: Json | null
          phone_number?: string | null
          portal_access_status?:
            | Database['public']['Enums']['portal_access_status']
            | null
          preferences?: Json | null
          role?: Database['public']['Enums']['user_role'] | null
          role_id: string
          status?: Database['public']['Enums']['user_status'] | null
          status_change_reason?: string | null
          status_changed_at?: string | null
          status_changed_by?: string | null
          termination_date?: string | null
          termination_reason?: string | null
          two_factor_enabled?: boolean | null
          updated_at?: string | null
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          customer_account_id?: string | null
          customer_type?: Database['public']['Enums']['customer_type'] | null
          deleted_at?: string | null
          email?: string
          email_verified?: boolean | null
          first_name?: string | null
          full_name?: string | null
          id?: string
          last_name?: string | null
          last_seen?: string | null
          leave_return_date?: string | null
          leave_start_date?: string | null
          metadata?: Json | null
          organization_id?: string | null
          outbound_column_order?: Json | null
          phone_number?: string | null
          portal_access_status?:
            | Database['public']['Enums']['portal_access_status']
            | null
          preferences?: Json | null
          role?: Database['public']['Enums']['user_role'] | null
          role_id?: string
          status?: Database['public']['Enums']['user_status'] | null
          status_change_reason?: string | null
          status_changed_at?: string | null
          status_changed_by?: string | null
          termination_date?: string | null
          termination_reason?: string | null
          two_factor_enabled?: boolean | null
          updated_at?: string | null
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'user_profiles_customer_account_id_fkey'
            columns: ['customer_account_id']
            isOneToOne: false
            referencedRelation: 'customer_accounts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_profiles_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_profiles_role_id_fkey'
            columns: ['role_id']
            isOneToOne: false
            referencedRelation: 'roles'
            referencedColumns: ['id']
          },
        ]
      }
      user_sessions: {
        Row: {
          created_at: string | null
          expires_at: string
          id: string
          ip_address: unknown
          last_activity: string | null
          token_hash: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          expires_at: string
          id?: string
          ip_address?: unknown
          last_activity?: string | null
          token_hash: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          id?: string
          ip_address?: unknown
          last_activity?: string | null
          token_hash?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'user_sessions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      user_status_history: {
        Row: {
          changed_by: string | null
          created_at: string | null
          effective_date: string | null
          id: string
          metadata: Json | null
          new_status: string
          notes: string | null
          previous_status: string | null
          reason: string | null
          user_id: string
        }
        Insert: {
          changed_by?: string | null
          created_at?: string | null
          effective_date?: string | null
          id?: string
          metadata?: Json | null
          new_status: string
          notes?: string | null
          previous_status?: string | null
          reason?: string | null
          user_id: string
        }
        Update: {
          changed_by?: string | null
          created_at?: string | null
          effective_date?: string | null
          id?: string
          metadata?: Json | null
          new_status?: string
          notes?: string | null
          previous_status?: string | null
          reason?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_status_history_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      user_tab_permissions: {
        Row: {
          created_at: string | null
          expires_at: string | null
          granted: boolean | null
          id: string
          tab_definition_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          granted?: boolean | null
          id?: string
          tab_definition_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          granted?: boolean | null
          id?: string
          tab_definition_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_tab_permissions_tab_definition_id_fkey'
            columns: ['tab_definition_id']
            isOneToOne: false
            referencedRelation: 'tab_definitions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_tab_permissions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      work_queue: {
        Row: {
          actual_duration_minutes: number | null
          assigned_at: string | null
          assigned_by: string | null
          assigned_to: string | null
          assignment_method: string | null
          blocks: string[] | null
          completed_at: string | null
          complexity_score: number | null
          created_at: string | null
          created_by: string | null
          depends_on: string[] | null
          description: string | null
          due_date: string | null
          escalated_at: string | null
          escalation_level: number | null
          estimated_duration_minutes: number | null
          id: string
          location: string | null
          material_number: string | null
          notes: string | null
          organization_id: string
          priority: number | null
          quantity: number | null
          required_certifications: Json | null
          required_skills: Json | null
          result_data: Json | null
          started_at: string | null
          status: string | null
          tags: string[] | null
          task_data: Json | null
          task_group_id: string | null
          task_reference_id: string | null
          task_type: string
          title: string
          unit_of_measure: string | null
          updated_at: string | null
          warning_sent_at: string | null
          zone: string | null
        }
        Insert: {
          actual_duration_minutes?: number | null
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_to?: string | null
          assignment_method?: string | null
          blocks?: string[] | null
          completed_at?: string | null
          complexity_score?: number | null
          created_at?: string | null
          created_by?: string | null
          depends_on?: string[] | null
          description?: string | null
          due_date?: string | null
          escalated_at?: string | null
          escalation_level?: number | null
          estimated_duration_minutes?: number | null
          id?: string
          location?: string | null
          material_number?: string | null
          notes?: string | null
          organization_id: string
          priority?: number | null
          quantity?: number | null
          required_certifications?: Json | null
          required_skills?: Json | null
          result_data?: Json | null
          started_at?: string | null
          status?: string | null
          tags?: string[] | null
          task_data?: Json | null
          task_group_id?: string | null
          task_reference_id?: string | null
          task_type: string
          title: string
          unit_of_measure?: string | null
          updated_at?: string | null
          warning_sent_at?: string | null
          zone?: string | null
        }
        Update: {
          actual_duration_minutes?: number | null
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_to?: string | null
          assignment_method?: string | null
          blocks?: string[] | null
          completed_at?: string | null
          complexity_score?: number | null
          created_at?: string | null
          created_by?: string | null
          depends_on?: string[] | null
          description?: string | null
          due_date?: string | null
          escalated_at?: string | null
          escalation_level?: number | null
          estimated_duration_minutes?: number | null
          id?: string
          location?: string | null
          material_number?: string | null
          notes?: string | null
          organization_id?: string
          priority?: number | null
          quantity?: number | null
          required_certifications?: Json | null
          required_skills?: Json | null
          result_data?: Json | null
          started_at?: string | null
          status?: string | null
          tags?: string[] | null
          task_data?: Json | null
          task_group_id?: string | null
          task_reference_id?: string | null
          task_type?: string
          title?: string
          unit_of_measure?: string | null
          updated_at?: string | null
          warning_sent_at?: string | null
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'work_queue_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'work_queue_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'work_queue_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      work_queue_config: {
        Row: {
          assignment_strategy: string | null
          created_at: string | null
          enable_auto_assignment: boolean | null
          enable_batch_assignment: boolean | null
          enable_location_optimization: boolean | null
          enable_predictive_assignment: boolean | null
          enable_skill_matching: boolean | null
          id: string
          max_tasks_per_worker: number | null
          organization_id: string
          priority_weight_age: number | null
          priority_weight_custom: number | null
          priority_weight_location: number | null
          priority_weight_urgency: number | null
          task_timeout_minutes: number | null
          updated_at: string | null
          warning_threshold_minutes: number | null
        }
        Insert: {
          assignment_strategy?: string | null
          created_at?: string | null
          enable_auto_assignment?: boolean | null
          enable_batch_assignment?: boolean | null
          enable_location_optimization?: boolean | null
          enable_predictive_assignment?: boolean | null
          enable_skill_matching?: boolean | null
          id?: string
          max_tasks_per_worker?: number | null
          organization_id: string
          priority_weight_age?: number | null
          priority_weight_custom?: number | null
          priority_weight_location?: number | null
          priority_weight_urgency?: number | null
          task_timeout_minutes?: number | null
          updated_at?: string | null
          warning_threshold_minutes?: number | null
        }
        Update: {
          assignment_strategy?: string | null
          created_at?: string | null
          enable_auto_assignment?: boolean | null
          enable_batch_assignment?: boolean | null
          enable_location_optimization?: boolean | null
          enable_predictive_assignment?: boolean | null
          enable_skill_matching?: boolean | null
          id?: string
          max_tasks_per_worker?: number | null
          organization_id?: string
          priority_weight_age?: number | null
          priority_weight_custom?: number | null
          priority_weight_location?: number | null
          priority_weight_urgency?: number | null
          task_timeout_minutes?: number | null
          updated_at?: string | null
          warning_threshold_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'work_queue_config_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: true
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      worker_performance_metrics: {
        Row: {
          accuracy_rate: number | null
          average_task_duration: number | null
          created_at: string | null
          error_count: number | null
          fastest_task_duration: number | null
          id: string
          metric_date: string
          metrics_by_type: Json | null
          organization_id: string
          productivity_score: number | null
          rework_count: number | null
          slowest_task_duration: number | null
          tasks_abandoned: number | null
          tasks_assigned: number | null
          tasks_completed: number | null
          tasks_failed: number | null
          total_active_minutes: number | null
          total_idle_minutes: number | null
          updated_at: string | null
          utilization_rate: number | null
          worker_id: string
        }
        Insert: {
          accuracy_rate?: number | null
          average_task_duration?: number | null
          created_at?: string | null
          error_count?: number | null
          fastest_task_duration?: number | null
          id?: string
          metric_date: string
          metrics_by_type?: Json | null
          organization_id: string
          productivity_score?: number | null
          rework_count?: number | null
          slowest_task_duration?: number | null
          tasks_abandoned?: number | null
          tasks_assigned?: number | null
          tasks_completed?: number | null
          tasks_failed?: number | null
          total_active_minutes?: number | null
          total_idle_minutes?: number | null
          updated_at?: string | null
          utilization_rate?: number | null
          worker_id: string
        }
        Update: {
          accuracy_rate?: number | null
          average_task_duration?: number | null
          created_at?: string | null
          error_count?: number | null
          fastest_task_duration?: number | null
          id?: string
          metric_date?: string
          metrics_by_type?: Json | null
          organization_id?: string
          productivity_score?: number | null
          rework_count?: number | null
          slowest_task_duration?: number | null
          tasks_abandoned?: number | null
          tasks_assigned?: number | null
          tasks_completed?: number | null
          tasks_failed?: number | null
          total_active_minutes?: number | null
          total_idle_minutes?: number | null
          updated_at?: string | null
          utilization_rate?: number | null
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'worker_performance_metrics_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'worker_performance_metrics_worker_id_fkey'
            columns: ['worker_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      worker_profiles: {
        Row: {
          accuracy_rate: number | null
          available_from: string | null
          available_to: string | null
          average_task_duration: number | null
          blocked_task_types: Json | null
          break_duration_minutes: number | null
          break_start: string | null
          certifications: Json | null
          created_at: string | null
          current_zone: string | null
          home_warehouse: string | null
          id: string
          is_available: boolean | null
          max_concurrent_tasks: number | null
          organization_id: string
          preferred_task_types: Json | null
          preferred_zones: Json | null
          productivity_score: number | null
          skills: Json | null
          tasks_completed_today: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          accuracy_rate?: number | null
          available_from?: string | null
          available_to?: string | null
          average_task_duration?: number | null
          blocked_task_types?: Json | null
          break_duration_minutes?: number | null
          break_start?: string | null
          certifications?: Json | null
          created_at?: string | null
          current_zone?: string | null
          home_warehouse?: string | null
          id?: string
          is_available?: boolean | null
          max_concurrent_tasks?: number | null
          organization_id: string
          preferred_task_types?: Json | null
          preferred_zones?: Json | null
          productivity_score?: number | null
          skills?: Json | null
          tasks_completed_today?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          accuracy_rate?: number | null
          available_from?: string | null
          available_to?: string | null
          average_task_duration?: number | null
          blocked_task_types?: Json | null
          break_duration_minutes?: number | null
          break_start?: string | null
          certifications?: Json | null
          created_at?: string | null
          current_zone?: string | null
          home_warehouse?: string | null
          id?: string
          is_available?: boolean | null
          max_concurrent_tasks?: number | null
          organization_id?: string
          preferred_task_types?: Json | null
          preferred_zones?: Json | null
          productivity_score?: number | null
          skills?: Json | null
          tasks_completed_today?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'worker_profiles_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'worker_profiles_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      workflow_instances: {
        Row: {
          completed_at: string | null
          created_at: string | null
          current_step: number | null
          id: string
          status: string | null
          trigger_data: Json
          updated_at: string | null
          workflow_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          current_step?: number | null
          id?: string
          status?: string | null
          trigger_data: Json
          updated_at?: string | null
          workflow_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          current_step?: number | null
          id?: string
          status?: string | null
          trigger_data?: Json
          updated_at?: string | null
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'workflow_instances_workflow_id_fkey'
            columns: ['workflow_id']
            isOneToOne: false
            referencedRelation: 'approval_workflows'
            referencedColumns: ['id']
          },
        ]
      }
      working_areas: {
        Row: {
          area_code: string
          area_name: string
          area_type: string | null
          backup_supervisor_id: string | null
          capacity: number | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean | null
          location_details: Json | null
          operating_days: Json | null
          operating_hours: Json | null
          organization_id: string
          primary_supervisor_id: string | null
          required_certifications: Json | null
          requires_certification: boolean | null
          updated_at: string | null
        }
        Insert: {
          area_code: string
          area_name: string
          area_type?: string | null
          backup_supervisor_id?: string | null
          capacity?: number | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          location_details?: Json | null
          operating_days?: Json | null
          operating_hours?: Json | null
          organization_id: string
          primary_supervisor_id?: string | null
          required_certifications?: Json | null
          requires_certification?: boolean | null
          updated_at?: string | null
        }
        Update: {
          area_code?: string
          area_name?: string
          area_type?: string | null
          backup_supervisor_id?: string | null
          capacity?: number | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          location_details?: Json | null
          operating_days?: Json | null
          operating_hours?: Json | null
          organization_id?: string
          primary_supervisor_id?: string | null
          required_certifications?: Json | null
          requires_certification?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'working_areas_backup_supervisor_id_fkey'
            columns: ['backup_supervisor_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'working_areas_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'working_areas_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'working_areas_primary_supervisor_id_fkey'
            columns: ['primary_supervisor_id']
            isOneToOne: false
            referencedRelation: 'user_profiles'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_release_abandoned_count: {
        Args: { p_count_id: string; p_reason?: string }
        Returns: Json
      }
      assign_cycle_count_to_user: {
        Args: { count_id: string; user_id: string }
        Returns: Json
      }
      assign_next_cycle_count: { Args: { p_user_id: string }; Returns: Json }
      assign_tab_permissions_to_role: {
        Args: { p_role_id: string; p_tab_definition_ids: string[] }
        Returns: undefined
      }
      auto_cleanup_abandoned_counts: { Args: never; Returns: Json }
      bulk_assign_tasks: {
        Args: { p_assignment_strategy?: string; p_task_ids: string[] }
        Returns: Json
      }
      calculate_average_wait_time: {
        Args: { p_hours_back?: number; p_organization_id: string }
        Returns: number
      }
      calculate_sla_due_date: {
        Args: {
          p_category?: Database['public']['Enums']['ticket_category']
          p_organization_id?: string
          p_priority: Database['public']['Enums']['ticket_priority']
        }
        Returns: string
      }
      calculate_sla_due_dates: {
        Args: { p_created_at: string; p_ticket_id: string }
        Returns: Json
      }
      calculate_task_priority: { Args: { p_task_id: string }; Returns: number }
      categorize_storage_area: {
        Args: { storage_bin: string }
        Returns: string
      }
      check_circular_reporting_chain: {
        Args: { p_position_id: string; p_reports_to_id: string }
        Returns: boolean
      }
      check_pending_counts_available: { Args: never; Returns: Json }
      check_permission_conditions: {
        Args: {
          p_conditions: Json
          p_current_time?: string
          p_ip_address?: unknown
          p_location?: Json
          p_user_id: string
        }
        Returns: boolean
      }
      check_sla_breach: { Args: never; Returns: number }
      check_user_tab_permission: {
        Args: { p_page_resource: string; p_tab_id: string; p_user_id: string }
        Returns: boolean
      }
      cleanup_expired_customer_portal_cache: { Args: never; Returns: number }
      cleanup_expired_sessions: { Args: never; Returns: number }
      cleanup_expired_temporary_assignments: { Args: never; Returns: number }
      cleanup_smartsheet_expired_cache: { Args: never; Returns: number }
      create_audit_log:
        | {
            Args: {
              p_action: Database['public']['Enums']['audit_action']
              p_changes?: Json
              p_resource_id: string
              p_resource_type: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_action: string
              p_details?: Json
              p_entity_id: string
              p_entity_type: string
              p_ip_address?: unknown
              p_user_agent?: string
              p_user_id: string
            }
            Returns: string
          }
      create_customer_from_invitation: {
        Args: {
          p_full_name?: string
          p_invitation_token: string
          p_user_id: string
        }
        Returns: Json
      }
      create_default_onboarding_checklist: {
        Args: {
          p_onboarding_session_id: string
          p_organization_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      create_recurring_event_instances: {
        Args: { p_end_date?: string; p_parent_event_id: string }
        Returns: number
      }
      create_temporary_role_assignment: {
        Args: {
          p_expires_at: string
          p_granted_by?: string
          p_reason?: string
          p_role_id: string
          p_user_id: string
        }
        Returns: string
      }
      create_user_session: {
        Args: {
          p_ip_address?: unknown
          p_token_hash: string
          p_user_agent?: string
          p_user_id: string
        }
        Returns: string
      }
      detect_abandoned_cycle_counts: {
        Args: { p_abandonment_threshold_minutes?: number }
        Returns: Json
      }
      escalate_stalled_tasks: { Args: never; Returns: Json }
      escalate_ticket_auto: { Args: { p_ticket_id: string }; Returns: boolean }
      fail_drone_scan_analysis: {
        Args: { p_error_message: string; p_scan_id: string }
        Returns: {
          ai_analysis_completed_at: string | null
          ai_analysis_started_at: string | null
          ai_analysis_status: string | null
          ai_error_message: string | null
          ai_fallback_used: boolean | null
          ai_model_used: string | null
          ai_processing_time_ms: number | null
          ai_retry_count: number | null
          aisle: string | null
          altitude_m: number | null
          captured_at: string
          created_at: string | null
          detected_barcodes: Json | null
          detected_objects: Json | null
          detected_texts: Json | null
          drone_id: string | null
          gps_lat: number | null
          gps_lng: number | null
          heading_degrees: number | null
          id: string
          image_dimensions: string | null
          image_size_bytes: number | null
          image_url: string
          inventory_assessment: Json | null
          mission_id: string | null
          organization_id: string
          rack_level: string | null
          raw_text: string | null
          scanned_by: string | null
          search_vector: unknown
          shelf_position: string | null
          spatial_description: string | null
          thumbnail_url: string | null
          updated_at: string | null
          warehouse_zone: string | null
        }
        SetofOptions: {
          from: '*'
          to: 'drone_scans'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      generate_badge_number: {
        Args: { p_organization_id: string }
        Returns: string
      }
      generate_count_number: { Args: never; Returns: string }
      generate_ticket_number: { Args: { org_id: string }; Returns: string }
      generate_worker_performance_report: {
        Args: {
          p_end_date: string
          p_organization_id?: string
          p_start_date: string
        }
        Returns: Json
      }
      get_abandonment_statistics: { Args: never; Returns: Json }
      get_active_customer_portal_config: {
        Args: never
        Returns: {
          allow_submissions: boolean | null
          created_at: string | null
          created_by: string | null
          customer_email_column_id: number | null
          date_submitted_column_id: number | null
          delivery_number_column_id: number | null
          id: string
          is_active: boolean | null
          material_number_column_id: number | null
          primary_column_id: number | null
          quantity_column_id: number | null
          request_notes_column_id: number | null
          requestor_name_column_id: number | null
          require_approval: boolean | null
          sheet_id: number
          sheet_name: string
          status_column_id: number | null
          updated_at: string | null
          updated_by: string | null
        }[]
        SetofOptions: {
          from: '*'
          to: 'rr_customer_portal_config'
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_activity_configurations: {
        Args: { p_organization_id: string }
        Returns: {
          activity_category: string
          activity_description: string
          activity_label: string
          activity_type: string
          display_color: string
          display_order: number
          efficiency_weight: number
          gantt_bg_class: string
          gantt_hover_class: string
          gantt_text_class: string
          include_in_efficiency: boolean
          show_in_summary: boolean
          show_on_timeline: boolean
        }[]
      }
      get_agent_dashboard_stats: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      get_agent_workload: { Args: { p_agent_id: string }; Returns: Json }
      get_available_activity_tables: {
        Args: never
        Returns: {
          columns: Json
          table_name: string
        }[]
      }
      get_count_type_display_name: {
        Args: { type_enum: Database['public']['Enums']['count_type_enum'] }
        Returns: string
      }
      get_customer_portal_access: { Args: { p_user_id: string }; Returns: Json }
      get_customer_portal_permissions: {
        Args: { p_user_id: string }
        Returns: {
          can_delete_own_requests: boolean
          can_edit_own_requests: boolean
          can_submit_requests: boolean
          can_view_all_requests: boolean
          can_view_internal_notes: boolean
          max_requests_per_day: number
          max_requests_per_month: number
        }[]
      }
      get_customer_ticket_stats: {
        Args: { p_customer_account_id: string }
        Returns: Json
      }
      get_cycle_count_statistics: { Args: never; Returns: Json }
      get_delivery_status_data: {
        Args: { org_id: string }
        Returns: {
          actual_goods_movement_date: string
          created_at: string
          customer_name: string
          delivery: string
          delivery_block: string
          delivery_change_by: string
          delivery_change_date: string
          delivery_changed_by_name: string
          delivery_create_time: string
          delivery_created_by: string
          delivery_created_name: string
          delivery_creation_date: string
          delivery_priority: string
          dispositions: string
          external_identification_1: string
          goods_movement_status: string
          id: string
          organization_id: string
          packed_at: string
          packed_by: string
          receiving_point: string
          sales_organization: string
          ship_to_party: string
          shipment_create_by: string
          shipment_create_date: string
          shipment_created_name: string
          shipment_number: string
          shipped_at: string
          shipped_by: string
          shipping_point: string
          status: string
          status_updated_at: string
          transfer_order_confirm_date: string
          transfer_order_create_date: string
          transfer_order_create_time: string
          transfer_order_number: string
          updated_at: string
          warehouse_number: string
        }[]
      }
      get_drone_scan_statistics: {
        Args: { p_days?: number; p_organization_id: string }
        Returns: {
          avg_processing_time_ms: number
          completed_analyses: number
          damage_detected_count: number
          failed_analyses: number
          items_detected: number
          total_scans: number
          warehouse_zone: string
        }[]
      }
      get_dynamic_productivity_counts: {
        Args: {
          p_end_date: string
          p_organization_id: string
          p_start_date: string
        }
        Returns: {
          activity_type: string
          task_count: number
          user_id: string
        }[]
      }
      get_effective_role_permissions: {
        Args: {
          p_current_time?: string
          p_ip_address?: unknown
          p_location?: Json
          p_user_id: string
        }
        Returns: {
          action: string
          conditions_met: boolean
          permission_id: string
          resource: string
        }[]
      }
      get_grip_processing_statistics: { Args: never; Returns: Json }
      get_grs_grip_processing_statistics: { Args: never; Returns: Json }
      get_inbound_scan_statistics: { Args: never; Returns: Json }
      get_kb_statistics: { Args: { p_organization_id: string }; Returns: Json }
      get_lx03_data: {
        Args: never
        Returns: {
          available_stock: number
          batch: string
          created_at: string
          delivery: string
          id: string
          inventory_active: string
          inventory_record: string
          inventory_record_2: string
          last_inventory: string
          last_movement: string
          last_movement_2: string
          material: string
          pick_quantity: number
          plant: string
          putaway_block: string
          special_stock: string
          special_stock_number: string
          stock_category: string
          stock_for_putaway: number
          stock_removal_block: string
          storage_bin: string
          storage_location: string
          storage_type: string
          storage_type_2: string
          total_stock: number
          updated_at: string
        }[]
      }
      get_lx03_empty_bins_by_filters: {
        Args: {
          filter_storage_area?: string
          filter_storage_type?: string
          filter_warehouse?: string
        }
        Returns: {
          material: string
          record_count: number
          storage_area: string
          storage_bin: string
          storage_location: string
          storage_type: string
          total_stock: number
          warehouse: string
        }[]
      }
      get_lx03_inventory_by_locations: {
        Args: { location_bins: string[] }
        Returns: {
          material: string
          record_count: number
          storage_bin: string
          storage_location: string
          total_stock: number
          warehouse: string
        }[]
      }
      get_lx03_inventory_by_parts: {
        Args: { part_numbers: string[] }
        Returns: {
          material: string
          record_count: number
          storage_bin: string
          storage_location: string
          total_stock: number
          warehouse: string
        }[]
      }
      get_lx03_inventory_by_range: {
        Args: { end_bin: string; start_bin: string }
        Returns: {
          material: string
          record_count: number
          storage_bin: string
          storage_location: string
          total_stock: number
          warehouse: string
        }[]
      }
      get_lx03_statistics: { Args: never; Returns: Json }
      get_lx03_storage_types: {
        Args: never
        Returns: {
          storage_type: string
        }[]
      }
      get_lx03_warehouses: {
        Args: never
        Returns: {
          warehouse: string
        }[]
      }
      get_material_master_statistics: { Args: never; Returns: Json }
      get_next_task_for_worker: {
        Args: {
          p_task_types?: string[]
          p_worker_id: string
          p_zones?: string[]
        }
        Returns: Json
      }
      get_organizational_tree: {
        Args: { p_organization_id: string; p_root_user_id?: string }
        Returns: {
          email: string
          full_name: string
          is_area_supervisor: boolean
          level_in_tree: number
          path_text: string
          position_title: string
          supervisor_id: string
          user_id: string
        }[]
      }
      get_outbound_duplicate_stats: {
        Args: never
        Returns: {
          potential_duplicates: number
          total_records: number
          unique_combinations: number
        }[]
      }
      get_overtime_for_date: {
        Args: { p_date: string; p_organization_id: string }
        Returns: {
          approved_at: string
          approved_by: string
          assigned_user_ids: string[]
          created_at: string
          extended_shift_end: string
          id: string
          is_paid: boolean
          is_voluntary: boolean
          notes: string
          original_shift_end: string
          overtime_duration_minutes: number
          pay_multiplier: number
          priority: string
          reason: string
          request_date: string
          request_number: string
          scope_type: string
          status: Database['public']['Enums']['overtime_status']
          working_area_id: string
        }[]
      }
      get_pending_drone_scans: {
        Args: { p_limit?: number }
        Returns: {
          aisle: string
          captured_at: string
          id: string
          image_url: string
          organization_id: string
          warehouse_zone: string
        }[]
      }
      get_position_hierarchy: {
        Args: { p_organization_id: string }
        Returns: {
          current_headcount: number
          is_active: boolean
          is_supervisory: boolean
          position_code: string
          position_id: string
          position_level: number
          position_title: string
          position_type: string
          reports_to_position_id: string
          reports_to_title: string
        }[]
      }
      get_position_statistics: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      get_putaway_log_statistics: { Args: never; Returns: Json }
      get_putback_log_statistics: { Args: never; Returns: Json }
      get_recount_comparison: { Args: { p_count_id: string }; Returns: Json }
      get_rf_putaway_stats: { Args: { user_org_id?: string }; Returns: Json }
      get_shift_assignments_with_details: {
        Args: { p_organization_id: string }
        Returns: {
          area_code: string
          area_name: string
          area_type: string
          assignment_id: string
          assignment_type: string
          break_duration_minutes: number
          break_start_time: string
          breaks: Json
          department: string
          inline_shift_schedule: Json
          is_supervisory: boolean
          position_id: string
          position_level: number
          position_title: string
          position_type: string
          productivity_target: number
          schedule_name: string
          shift_end_time: string
          shift_pattern: string
          shift_schedule_id: string
          shift_start_time: string
          supervisor_avatar: string
          supervisor_id: string
          supervisor_name: string
          team_lead_avatar: string
          team_lead_id: string
          team_lead_name: string
          user_avatar_url: string
          user_created_at: string
          user_email: string
          user_full_name: string
          user_id: string
          user_phone_number: string
          user_status: string
          working_area_id: string
        }[]
      }
      get_shift_schedules_with_stats: {
        Args: { p_organization_id: string }
        Returns: {
          assigned_count: number
          break_duration_minutes: number
          breaks: Json
          color: string
          description: string
          id: string
          is_active: boolean
          operating_days: Json
          schedule_code: string
          schedule_name: string
          schedule_type: string
          shift_end_time: string
          shift_start_time: string
        }[]
      }
      get_similar_tickets_kb: {
        Args: { p_limit?: number; p_ticket_id: string }
        Returns: {
          article_id: string
          excerpt: string
          helpful_count: number
          title: string
          view_count: number
        }[]
      }
      get_smartsheet_dashboard_stats: {
        Args: { p_days?: number; p_user_id?: string }
        Returns: Json
      }
      get_sq01_statistics: { Args: never; Returns: Json }
      get_standard_work_statistics: {
        Args: {
          p_end_date?: string
          p_organization_id: string
          p_start_date?: string
        }
        Returns: Json
      }
      get_submission_with_responses: {
        Args: { p_submission_id: string }
        Returns: Json
      }
      get_table_columns: {
        Args: { p_table_name: string }
        Returns: {
          column_name: string
          data_type: string
          is_nullable: boolean
        }[]
      }
      get_team_activity_events: {
        Args: {
          p_end_date: string
          p_organization_id: string
          p_start_date: string
        }
        Returns: {
          activity_category: string
          activity_label: string
          area: string
          display_color: string
          event_timestamp: string
          event_type: string
          user_id: string
        }[]
      }
      get_team_productivity_batch: {
        Args: {
          p_end_date?: string
          p_organization_id: string
          p_start_date: string
        }
        Returns: {
          cycle_counts: number
          final_packed: number
          first_activity: string
          inbound_scans: number
          last_activity: string
          packed: number
          picking: number
          put_aways: number
          putbacks: number
          shipped: number
          total_tasks: number
          user_id: string
        }[]
      }
      get_team_productivity_counts: {
        Args: {
          p_end_date: string
          p_organization_id: string
          p_start_date: string
        }
        Returns: {
          cycle_counts: number
          customer_responses: number
          final_packed: number
          inbound_scans: number
          packed: number
          picking: number
          put_aways: number
          putbacks: number
          shipped: number
          total_tasks: number
          user_id: string
        }[]
      }
      get_customer_portal_metrics: {
        Args: {
          p_organization_id: string
          p_start_date: string
          p_end_date: string
        }
        Returns: {
          user_id: string
          user_first_name: string | null
          user_last_name: string | null
          user_full_name: string | null
          user_email: string | null
          tickets_handled: number
          comments_made: number
          status_changes: number
          field_updates: number
          attachments_added: number
          tickets_created: number
          total_actions: number
          avg_response_time_ms: number
        }[]
      }
      get_ticket_statistics: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      get_timeline_events_for_date: {
        Args: {
          p_area_id?: string
          p_date: string
          p_organization_id: string
          p_user_id?: string
        }
        Returns: {
          category_code: string
          category_name: string
          color: string
          description: string
          duration_minutes: number
          end_time: string
          event_id: string
          event_name: string
          icon: string
          is_mandatory: boolean
          is_paid_time: boolean
          is_productive_time: boolean
          location: string
          scope_type: string
          start_time: string
          status: string
        }[]
      }
      get_user_assigned_counts: { Args: { p_user_id: string }; Returns: Json }
      get_user_current_position: {
        Args: { p_user_id: string }
        Returns: {
          area_name: string
          position_code: string
          position_id: string
          position_level: number
          position_title: string
          supervisor_id: string
          supervisor_name: string
          working_area_id: string
        }[]
      }
      get_user_organization_id:
        | { Args: never; Returns: string }
        | { Args: { user_uuid: string }; Returns: string }
      get_user_overtime: {
        Args: { p_date?: string; p_user_id: string }
        Returns: {
          extended_shift_end: string
          is_approved: boolean
          original_shift_end: string
          overtime_duration_minutes: number
          overtime_id: string
          request_date: string
          request_number: string
          signup_status: string
          status: Database['public']['Enums']['overtime_status']
        }[]
      }
      get_user_potentially_abandoned_counts: {
        Args: { p_user_id: string; p_warning_threshold_minutes?: number }
        Returns: Json
      }
      get_user_role:
        | { Args: never; Returns: Database['public']['Enums']['user_role'] }
        | { Args: { user_uuid: string }; Returns: string }
      get_user_session_config: {
        Args: { p_user_id: string }
        Returns: {
          auto_logout_timeout_minutes: number
          session_timeout_minutes: number
          warning_time_minutes: number
        }[]
      }
      get_user_status_statistics: { Args: never; Returns: Json }
      get_user_tab_permissions: {
        Args: { p_page_resource?: string; p_user_id: string }
        Returns: {
          description: string
          display_order: number
          granted: boolean
          page_resource: string
          tab_definition_id: string
          tab_id: string
          tab_label: string
        }[]
      }
      get_weekly_productivity_summary: {
        Args: { p_end_date?: string; p_organization_id: string }
        Returns: {
          active_associates: number
          cycle_counts: number
          day_date: string
          day_name: string
          final_packed: number
          inbound_scans: number
          packed: number
          picking: number
          put_aways: number
          putbacks: number
          shipped: number
          total_associates: number
          total_tasks: number
        }[]
      }
      get_working_area_statistics: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      has_permission:
        | {
            Args: { action_name: string; resource_name: string }
            Returns: boolean
          }
        | {
            Args: { permission_name: string; user_uuid: string }
            Returns: boolean
          }
      initialize_timeline_event_categories: {
        Args: { p_organization_id: string }
        Returns: undefined
      }
      initiate_recount_with_history: {
        Args: {
          p_count_id: string
          p_initiated_by?: string
          p_recount_reason: string
        }
        Returns: Json
      }
      log_customer_portal_activity: {
        Args: {
          p_activity_type: string
          p_details?: Json
          p_error_message?: string
          p_request_id?: string
          p_row_id?: number
          p_sheet_id: number
          p_status?: string
          p_user_id: string
        }
        Returns: string
      }
      rebalance_work_queue: { Args: never; Returns: Json }
      record_article_view: {
        Args: { p_article_id: string; p_user_id?: string }
        Returns: boolean
      }
      release_abandoned_cycle_counts: {
        Args: {
          p_abandonment_threshold_minutes?: number
          p_max_releases?: number
        }
        Returns: Json
      }
      release_cycle_count_assignment: {
        Args: { p_count_id: string; p_user_id: string }
        Returns: Json
      }
      release_my_cycle_count: {
        Args: { p_count_id: string; p_reason?: string }
        Returns: Json
      }
      revoke_portal_access: {
        Args: {
          p_customer_account_id: string
          p_reason?: string
          p_revoked_by: string
        }
        Returns: boolean
      }
      revoke_temporary_role_assignment: {
        Args: { p_assignment_id: string }
        Returns: boolean
      }
      save_drone_scan_analysis: {
        Args: {
          p_ai_model: string
          p_detected_barcodes: Json
          p_detected_objects: Json
          p_detected_texts: Json
          p_fallback_used?: boolean
          p_inventory_assessment: Json
          p_processing_time_ms?: number
          p_raw_text: string
          p_scan_id: string
          p_spatial_description: string
        }
        Returns: {
          ai_analysis_completed_at: string | null
          ai_analysis_started_at: string | null
          ai_analysis_status: string | null
          ai_error_message: string | null
          ai_fallback_used: boolean | null
          ai_model_used: string | null
          ai_processing_time_ms: number | null
          ai_retry_count: number | null
          aisle: string | null
          altitude_m: number | null
          captured_at: string
          created_at: string | null
          detected_barcodes: Json | null
          detected_objects: Json | null
          detected_texts: Json | null
          drone_id: string | null
          gps_lat: number | null
          gps_lng: number | null
          heading_degrees: number | null
          id: string
          image_dimensions: string | null
          image_size_bytes: number | null
          image_url: string
          inventory_assessment: Json | null
          mission_id: string | null
          organization_id: string
          rack_level: string | null
          raw_text: string | null
          scanned_by: string | null
          search_vector: unknown
          shelf_position: string | null
          spatial_description: string | null
          thumbnail_url: string | null
          updated_at: string | null
          warehouse_zone: string | null
        }
        SetofOptions: {
          from: '*'
          to: 'drone_scans'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      search_drone_scans: {
        Args: {
          p_aisle?: string
          p_limit?: number
          p_offset?: number
          p_organization_id: string
          p_query: string
          p_warehouse_zone?: string
        }
        Returns: {
          ai_analysis_status: string
          aisle: string
          captured_at: string
          detected_barcodes: Json
          detected_texts: Json
          id: string
          image_url: string
          inventory_assessment: Json
          rank: number
          raw_text: string
          shelf_position: string
          spatial_description: string
          thumbnail_url: string
          warehouse_zone: string
        }[]
      }
      search_kb_articles: {
        Args: {
          p_limit?: number
          p_organization_id: string
          p_search_query: string
          p_visibility?: Database['public']['Enums']['article_visibility']
        }
        Returns: {
          article_id: string
          category_name: string
          excerpt: string
          helpful_count: number
          rank: number
          title: string
          view_count: number
        }[]
      }
      search_tickets: {
        Args: {
          p_assigned_to_filter?: string
          p_category_filter?: string[]
          p_limit?: number
          p_offset?: number
          p_organization_id: string
          p_priority_filter?: string[]
          p_search_query?: string
          p_status_filter?: string[]
        }
        Returns: {
          assigned_to: string
          category: Database['public']['Enums']['ticket_category']
          created_at: string
          customer_name: string
          id: string
          priority: Database['public']['Enums']['ticket_priority']
          sla_breached: boolean
          sla_due_date: string
          status: Database['public']['Enums']['ticket_status']
          subject: string
          ticket_number: string
        }[]
      }
      search_tickets_full_text: {
        Args: {
          p_limit?: number
          p_organization_id: string
          p_search_query: string
        }
        Returns: {
          created_at: string
          priority: Database['public']['Enums']['ticket_priority']
          rank: number
          status: Database['public']['Enums']['ticket_status']
          subject: string
          ticket_id: string
          ticket_number: string
        }[]
      }
      seed_area_and_department_options: {
        Args: { p_organization_id: string }
        Returns: undefined
      }
      seed_position_options: {
        Args: { p_organization_id: string }
        Returns: undefined
      }
      send_portal_invitation: {
        Args: {
          p_customer_account_id: string
          p_email: string
          p_invitation_message?: string
          p_invited_by: string
          p_portal_role?: string
        }
        Returns: Json
      }
      submit_article_feedback: {
        Args: {
          p_article_id: string
          p_feedback_text?: string
          p_is_helpful: boolean
          p_user_email?: string
          p_user_id?: string
          p_user_type?: string
        }
        Returns: string
      }
      unassign_cycle_count: { Args: { count_id: string }; Returns: Json }
      update_cycle_count_priority: {
        Args: {
          count_id: string
          new_priority: Database['public']['Enums']['cycle_count_priority']
        }
        Returns: Json
      }
      update_session_activity: {
        Args: { p_ip_address?: unknown; p_token_hash: string }
        Returns: boolean
      }
      update_user_last_seen: { Args: { user_uuid: string }; Returns: undefined }
      update_user_status_with_tracking: {
        Args: {
          p_effective_date?: string
          p_leave_return_date?: string
          p_new_status: string
          p_notes?: string
          p_reason?: string
          p_user_id: string
        }
        Returns: Json
      }
      upsert_device_registration: {
        Args: {
          p_browser: string
          p_color_depth: number
          p_device_name: string
          p_device_type: string
          p_fingerprint_id: string
          p_hardware_concurrency: number
          p_language: string
          p_organization_id: string
          p_os_name: string
          p_os_version: string
          p_screen_resolution: string
          p_timezone: string
          p_touch_points: number
          p_user_agent: string
          p_user_id: string
        }
        Returns: {
          browser: string | null
          color_depth: number | null
          created_at: string | null
          device_name: string
          device_type: string
          fingerprint_id: string
          first_registered: string | null
          hardware_concurrency: number | null
          id: string
          is_active: boolean | null
          language: string | null
          last_seen: string | null
          organization_id: string | null
          os_name: string | null
          os_version: string | null
          screen_resolution: string | null
          timezone: string | null
          touch_points: number | null
          updated_at: string | null
          user_agent: string | null
          user_id: string | null
        }
        SetofOptions: {
          from: '*'
          to: 'device_registrations'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      user_can_see_navigation_item:
        | {
            Args: { navigation_item_id: string; user_id: string }
            Returns: boolean
          }
        | { Args: { item_id: number; user_uuid: string }; Returns: boolean }
      validate_invitation_token: { Args: { p_token: string }; Returns: Json }
    }
    Enums: {
      app_status: 'active' | 'inactive' | 'maintenance' | 'deprecated'
      article_status: 'draft' | 'published' | 'archived' | 'under_review'
      article_visibility: 'public' | 'customers_only' | 'internal_only'
      audit_action: 'create' | 'update' | 'delete' | 'view' | 'login' | 'logout'
      count_type_enum:
        | 'part_verification'
        | 'quantity_check'
        | 're_count'
        | 'second_count'
        | 'third_count'
        | '999_count'
        | 'empty_location_check'
        | 'cycle_count'
        | 'physical_count'
        | 'spot_count'
      customer_type: 'internal' | 'external_customer' | 'external_portal_user'
      cycle_count_priority: 'critical' | 'hot' | 'normal' | 'low'
      cycle_count_status:
        | 'pending'
        | 'in_progress'
        | 'completed'
        | 'variance_review'
        | 'approved'
        | 'cancelled'
        | 'markForRecount'
        | 'recount'
      message_channel:
        | 'email'
        | 'chat'
        | 'internal_note'
        | 'sms'
        | 'phone'
        | 'system'
      notification_type: 'info' | 'warning' | 'error' | 'success'
      outbound_status:
        | 'pending'
        | 'processing'
        | 'completed'
        | 'cancelled'
        | 'on_hold'
        | 'packed'
        | 'final_packed'
        | 'shipped'
        | 'picked'
        | 'picked_short'
        | 'picked_bulk'
        | 'not_in_location'
      overtime_status:
        | 'pending'
        | 'approved'
        | 'rejected'
        | 'cancelled'
        | 'completed'
      portal_access_status: 'invited' | 'active' | 'suspended' | 'revoked'
      putback_status: 'open' | 'in_progress' | 'completed' | 'cancelled'
      sap_system_type: 'ECC' | 'S4HANA'
      sla_status: 'met' | 'at_risk' | 'breached' | 'paused' | 'exempt'
      task_priority: 'low' | 'medium' | 'high' | 'urgent'
      task_status: 'todo' | 'in_progress' | 'done' | 'cancelled'
      ticket_category:
        | 'technical'
        | 'billing'
        | 'general'
        | 'feature_request'
        | 'bug_report'
      ticket_change_type:
        | 'created'
        | 'updated'
        | 'commented'
        | 'assigned'
        | 'status_changed'
        | 'resolved'
        | 'closed'
      ticket_priority: 'low' | 'normal' | 'high' | 'urgent' | 'critical'
      ticket_source: 'web_portal' | 'email' | 'phone' | 'chat'
      ticket_status:
        | 'new'
        | 'open'
        | 'in_progress'
        | 'pending_customer'
        | 'pending_internal'
        | 'resolved'
        | 'closed'
        | 'cancelled'
        | 'on_hold'
        | 'escalated'
      user_role:
        | 'superadmin'
        | 'admin'
        | 'manager'
        | 'cashier'
        | 'viewer'
        | 'tka_associate'
        | 'inventory_specialist'
        | 'logistics_coordinator'
        | 'quality_specialist'
      user_status: 'active' | 'inactive' | 'invited' | 'suspended'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] &
        DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_status: ['active', 'inactive', 'maintenance', 'deprecated'],
      article_status: ['draft', 'published', 'archived', 'under_review'],
      article_visibility: ['public', 'customers_only', 'internal_only'],
      audit_action: ['create', 'update', 'delete', 'view', 'login', 'logout'],
      count_type_enum: [
        'part_verification',
        'quantity_check',
        're_count',
        'second_count',
        'third_count',
        '999_count',
        'empty_location_check',
        'cycle_count',
        'physical_count',
        'spot_count',
      ],
      customer_type: ['internal', 'external_customer', 'external_portal_user'],
      cycle_count_priority: ['critical', 'hot', 'normal', 'low'],
      cycle_count_status: [
        'pending',
        'in_progress',
        'completed',
        'variance_review',
        'approved',
        'cancelled',
        'markForRecount',
        'recount',
      ],
      message_channel: [
        'email',
        'chat',
        'internal_note',
        'sms',
        'phone',
        'system',
      ],
      notification_type: ['info', 'warning', 'error', 'success'],
      outbound_status: [
        'pending',
        'processing',
        'completed',
        'cancelled',
        'on_hold',
        'packed',
        'final_packed',
        'shipped',
        'picked',
        'picked_short',
        'picked_bulk',
        'not_in_location',
      ],
      overtime_status: [
        'pending',
        'approved',
        'rejected',
        'cancelled',
        'completed',
      ],
      portal_access_status: ['invited', 'active', 'suspended', 'revoked'],
      putback_status: ['open', 'in_progress', 'completed', 'cancelled'],
      sap_system_type: ['ECC', 'S4HANA'],
      sla_status: ['met', 'at_risk', 'breached', 'paused', 'exempt'],
      task_priority: ['low', 'medium', 'high', 'urgent'],
      task_status: ['todo', 'in_progress', 'done', 'cancelled'],
      ticket_category: [
        'technical',
        'billing',
        'general',
        'feature_request',
        'bug_report',
      ],
      ticket_change_type: [
        'created',
        'updated',
        'commented',
        'assigned',
        'status_changed',
        'resolved',
        'closed',
      ],
      ticket_priority: ['low', 'normal', 'high', 'urgent', 'critical'],
      ticket_source: ['web_portal', 'email', 'phone', 'chat'],
      ticket_status: [
        'new',
        'open',
        'in_progress',
        'pending_customer',
        'pending_internal',
        'resolved',
        'closed',
        'cancelled',
        'on_hold',
        'escalated',
      ],
      user_role: [
        'superadmin',
        'admin',
        'manager',
        'cashier',
        'viewer',
        'tka_associate',
        'inventory_specialist',
        'logistics_coordinator',
        'quality_specialist',
      ],
      user_status: ['active', 'inactive', 'invited', 'suspended'],
    },
  },
} as const

// Convenience type exports for commonly used table types
export type UserProfile = Database['public']['Tables']['user_profiles']['Row']
export type UserRole = Database['public']['Enums']['user_role']
export type Organization = Database['public']['Tables']['organizations']['Row']
export type NavigationItem =
  Database['public']['Tables']['navigation_items']['Row']
export type Permission = Database['public']['Tables']['permissions']['Row']
export type Role = Database['public']['Tables']['roles']['Row']
export type RoleInsert = Database['public']['Tables']['roles']['Insert']
export type RoleUpdate = Database['public']['Tables']['roles']['Update']
export type PutbackTicket =
  Database['public']['Tables']['putback_tickets']['Row']
export type PutbackTicketInsert =
  Database['public']['Tables']['putback_tickets']['Insert']
export type PutbackTicketUpdate =
  Database['public']['Tables']['putback_tickets']['Update']

// Drone scanner types
export type DroneScan = Database['public']['Tables']['drone_scans']['Row']
export type DroneScanInsert =
  Database['public']['Tables']['drone_scans']['Insert']
export type DroneScanUpdate =
  Database['public']['Tables']['drone_scans']['Update']
export type DroneMission = Database['public']['Tables']['drone_missions']['Row']
export type DroneMissionInsert =
  Database['public']['Tables']['drone_missions']['Insert']
export type DroneMissionUpdate =
  Database['public']['Tables']['drone_missions']['Update']
